// BLOQUEADOR 2 — reconciliação de FUNCIONÁRIOS na revalidação pré-período: decisão pura + fluxo com banco falso.
// (A função SQL escala_divergencias_funcionarios — semântica de interseção, atraso aberto, inativo, equipe, retorno — é testada em supabase/tests/escala_reconciliacao_funcionarios.test.sql.)
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assinaturaDivergencias, decidirDivergenciasFuncionarios, ORIGEM_REVALIDACAO_FUNCIONARIOS, revalidarDisponibilidade, type DivergenciaFuncionario, type EventoDaSemana } from "../revalidarDisponibilidade";
import { epochMsNoFuso } from "@/features/escala/tempo";

const DIA = "2026-10-20";
const agora = (hhmm: string) => epochMsNoFuso(DIA, hhmm);
const div = (periodoId = "m2", funcionarioId = "adriana", tipo: DivergenciaFuncionario["tipo"] = "alocado_ausente", previsaoId = "P1"): DivergenciaFuncionario => ({ previsaoId, data: DIA, periodoId, funcionarioId, tipo, causaId: "aus1" });
const ev = (o: Partial<EventoDaSemana> = {}): EventoDaSemana => ({ previsaoId: "P1", tipo: "ausencia", status: "processado", tentativas: 1, criadoEm: new Date(agora("08:00")).toISOString(), origem: null, assinatura: null, ...o });

describe("decisão: idempotente, sem laço", () => {
  it("sem divergência: nada (NO-OP)", () => {
    expect(decidirDivergenciasFuncionarios([], [], agora("08:43"))).toEqual({ registrar: [], aguardando: [], persistentes: [] });
  });
  it("divergência e nenhum evento na fila: registra UM evento para a semana, com assinatura", () => {
    const r = decidirDivergenciasFuncionarios([div("m2"), div("m3")], [], agora("08:43"));
    expect(r.registrar).toHaveLength(1);
    expect(r.registrar[0]).toMatchObject({ previsaoId: "P1", divergencias: 2, tipos: ["alocado_ausente"] });
    expect(r.registrar[0].assinatura).toBe(assinaturaDivergencias([div("m3"), div("m2")])); // independe da ordem
  });
  it("já há evento de replanejamento pendente/processando/erro<3: reutiliza (aguarda a drenagem), não cria outro", () => {
    for (const status of ["pendente", "processando"]) expect(decidirDivergenciasFuncionarios([div()], [ev({ status })], agora("08:43")).aguardando).toEqual(["P1"]);
    expect(decidirDivergenciasFuncionarios([div()], [ev({ status: "erro", tentativas: 2 })], agora("08:43")).aguardando).toEqual(["P1"]);
    expect(decidirDivergenciasFuncionarios([div()], [ev({ tipo: "previsao", status: "pendente" })], agora("08:43")).registrar).toEqual([]);
  });
  it("a MESMA assinatura já tentada pela revalidação (processada/erro esgotado) e ainda divergente: persistente — NÃO repete o evento", () => {
    const a = assinaturaDivergencias([div()]);
    const tentada = ev({ origem: ORIGEM_REVALIDACAO_FUNCIONARIOS, assinatura: a, criadoEm: new Date(agora("08:44")).toISOString() });
    const r = decidirDivergenciasFuncionarios([div()], [tentada], agora("08:46"));
    expect(r.registrar).toEqual([]); expect(r.persistentes).toHaveLength(1);
    expect(decidirDivergenciasFuncionarios([div()], [{ ...tentada, status: "erro", tentativas: 3 }], agora("08:46")).registrar).toEqual([]);
  });
  it("assinatura DIFERENTE (nova divergência) ou tentativa muito antiga (> 6 h): registra de novo", () => {
    const outra = ev({ origem: ORIGEM_REVALIDACAO_FUNCIONARIOS, assinatura: assinaturaDivergencias([div("t1")]), criadoEm: new Date(agora("08:44")).toISOString() });
    expect(decidirDivergenciasFuncionarios([div("m2")], [outra], agora("08:46")).registrar).toHaveLength(1);
    const velha = ev({ origem: ORIGEM_REVALIDACAO_FUNCIONARIOS, assinatura: assinaturaDivergencias([div()]), criadoEm: new Date(agora("08:00") - 7 * 3600_000).toISOString() });
    expect(decidirDivergenciasFuncionarios([div()], [velha], agora("08:46")).registrar).toHaveLength(1);
  });
  it("a MESMA divergência causada por uma ausência NOVA (outro id) não é 'repetição': registra de novo", () => {
    const tentada = ev({ origem: ORIGEM_REVALIDACAO_FUNCIONARIOS, assinatura: assinaturaDivergencias([div()]), criadoEm: new Date(agora("08:44")).toISOString() });
    const nova = { ...div(), causaId: "aus2" };
    expect(decidirDivergenciasFuncionarios([nova], [tentada], agora("08:46")).registrar).toHaveLength(1);
  });
  it("semanas independentes", () => {
    const r = decidirDivergenciasFuncionarios([div("m2", "a", "alocado_ausente", "P1"), div("m2", "b", "alocado_inativo", "P2")], [ev({ previsaoId: "P1", status: "pendente" })], agora("08:43"));
    expect(r.aguardando).toEqual(["P1"]); expect(r.registrar.map((x) => x.previsaoId)).toEqual(["P2"]);
  });
});

// banco falso: registra as chamadas; devolve o que o teste configurar
function banco(cfg: { divergencias?: unknown[]; eventos?: unknown[]; falhaDivergencias?: boolean; violacoes?: unknown[] }) {
  const chamadas: { nome: string; args?: Record<string, unknown> }[] = [];
  const cadeia = (data: unknown) => { const c: Record<string, unknown> = {}; ["select", "eq", "in", "gte", "order", "limit"].forEach((m) => (c[m] = () => c)); c.then = (ok: (v: unknown) => void) => ok({ data, error: null }); return c; };
  const periodos = ["07:12", "08:48", "10:24", "13:00", "14:20", "15:40"].map((inicio) => ({ inicio: `${inicio}:00` }));
  const cliente = {
    rpc: async (nome: string, args?: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      if (nome === "escala_reconciliar_indisponibilidades") return { data: { criadas: 0, atualizadas: 0, removidas: 0 }, error: null };
      if (nome === "escala_violacoes_disponibilidade") return { data: cfg.violacoes ?? [], error: null };
      if (nome === "escala_divergencias_funcionarios") return cfg.falhaDivergencias ? { data: null, error: { message: "falhou" } } : { data: cfg.divergencias ?? [], error: null };
      if (nome === "escala_registrar_evento") return { data: "evt", error: null };
      return { data: null, error: null };
    },
    from: (tabela: string) => ({ select: () => cadeia(tabela === "periodos" ? periodos : (cfg.eventos ?? [])) }),
  };
  return { cliente: cliente as unknown as SupabaseClient, chamadas };
}
const linhaRpc = (periodo = "m2", func = "adriana", tipo = "alocado_ausente") => ({ previsao_id: "P1", data: DIA, periodo_id: periodo, funcionario_id: func, tipo, causa_id: "aus1" });
const registrados = (c: { nome: string; args?: Record<string, unknown> }[]) => c.filter((x) => x.nome === "escala_registrar_evento");

describe("fluxo da revalidação pré-período (funcionários)", () => {
  it("CASO REAL 20/10: falta de dia inteiro registrada 07:46, evento imediato PERDIDO — a checagem das 08:43 vê a Adriana alocada em M2 e registra o replanejamento", async () => {
    const { cliente, chamadas } = banco({ divergencias: [linhaRpc("m2")], eventos: [] });
    const r = await revalidarDisponibilidade(cliente, agora("08:43"));
    expect(r.dentroDaJanela).toBe(true);
    expect(r.funcionarios).toMatchObject({ divergencias: 1, eventosRegistrados: 1 });
    expect(registrados(chamadas)).toHaveLength(1);
    expect(registrados(chamadas)[0].args).toMatchObject({ p_tipo: "ausencia", p_previsao_id: "P1" });
  });
  it("execução repetida sem mudança = NO-OP (sem divergência: nenhum evento; com evento já na fila: nenhum evento novo)", async () => {
    const limpo = banco({});
    await revalidarDisponibilidade(limpo.cliente, agora("12:55")); await revalidarDisponibilidade(limpo.cliente, agora("12:58"));
    expect(registrados(limpo.chamadas)).toHaveLength(0);
    const naFila = banco({ divergencias: [linhaRpc()], eventos: [{ previsao_id: "P1", tipo: "ausencia", status: "pendente", tentativas: 0, criado_em: new Date(agora("08:30")).toISOString(), payload: {} }] });
    await revalidarDisponibilidade(naFila.cliente, agora("08:43")); await revalidarDisponibilidade(naFila.cliente, agora("08:46"));
    expect(registrados(naFila.chamadas)).toHaveLength(0);
  });
  it("o retorno também: funcionário disponível sem linha no plano (chegada registrada e evento perdido) pede replanejamento", async () => {
    const { cliente, chamadas } = banco({ divergencias: [linhaRpc("m3", "ana", "disponivel_sem_linha"), linhaRpc("t1", "ana", "disponivel_sem_linha")] });
    const r = await revalidarDisponibilidade(cliente, agora("10:19"));
    expect(r.funcionarios.eventosRegistrados).toBe(1);
    expect(registrados(chamadas)).toHaveLength(1);
  });
  it("fora da janela de um período: nem consulta divergências (barato) — a rede de segurança é só pré-período", async () => {
    const { cliente, chamadas } = banco({ divergencias: [linhaRpc()] });
    const r = await revalidarDisponibilidade(cliente, agora("11:30"));
    expect(r.dentroDaJanela).toBe(false);
    expect(chamadas.map((c) => c.nome)).not.toContain("escala_divergencias_funcionarios");
  });
  it("falha na parte de funcionários não derruba a de máquinas (e vice-versa) e nunca lança", async () => {
    const { cliente, chamadas } = banco({ falhaDivergencias: true });
    const r = await revalidarDisponibilidade(cliente, agora("12:55"));
    expect(r.erro).toContain("escala_divergencias_funcionarios");
    expect(chamadas.map((c) => c.nome)).toContain("escala_violacoes_disponibilidade");
  });
  it("máquinas e funcionários numa só revalidação: a mesma janela confere os dois", async () => {
    const { cliente, chamadas } = banco({});
    await revalidarDisponibilidade(cliente, agora("14:15"));
    expect(chamadas.map((c) => c.nome)).toEqual(["escala_reconciliar_indisponibilidades", "escala_violacoes_disponibilidade", "escala_divergencias_funcionarios"]);
  });
});

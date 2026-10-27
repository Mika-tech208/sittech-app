// FRENTE A — reconciliação do CADASTRO de máquinas (ativo / roteiro / seleção da Previsão) na revalidação pré-período.
// A semântica SQL (elegibilidade igual à do motor, só períodos futuros) é testada em supabase/tests/escala_maquina_cadastro.test.sql.
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decidirDivergenciasCadastroMaquinas, ORIGEM_REVALIDACAO_CADASTRO_MAQUINAS, revalidarDisponibilidade, type DivergenciaCadastroMaquina, type EventoDaSemana, assinaturaDeChaves } from "../revalidarDisponibilidade";
import { epochMsNoFuso } from "@/features/escala/tempo";

const DIA = "2026-10-28";
const agora = (hhmm: string) => epochMsNoFuso("2026-10-27", hhmm);
const div = (periodoId = "m1", tipo: DivergenciaCadastroMaquina["tipo"] = "maquina_inativa", previsaoId = "P1"): DivergenciaCadastroMaquina => ({ previsaoId, data: DIA, periodoId, maquinaId: "m5", etapaId: "e1", tipo });
const chave = (d: DivergenciaCadastroMaquina) => `${d.data}|${d.periodoId}|${d.maquinaId}|${d.etapaId ?? ""}|${d.tipo}`;
const ev = (o: Partial<EventoDaSemana> = {}): EventoDaSemana => ({ previsaoId: "P1", tipo: "recurso_bloqueado", status: "processado", tentativas: 1, criadoEm: new Date(agora("14:00")).toISOString(), origem: null, assinatura: null, ...o });

describe("decisão do cadastro de máquinas: idempotente, sem laço", () => {
  it("sem divergência: nada", () => {
    expect(decidirDivergenciasCadastroMaquinas([], [], agora("15:35"))).toEqual({ registrar: [], aguardando: [], persistentes: [] });
  });
  it("máquina inativa ainda alocada no futuro e sem evento na fila: registra UM evento", () => {
    const r = decidirDivergenciasCadastroMaquinas([div("m1"), div("m2")], [], agora("15:35"));
    expect(r.registrar).toHaveLength(1);
    expect(r.registrar[0]).toMatchObject({ previsaoId: "P1", divergencias: 2, tipos: ["maquina_inativa"] });
  });
  it("evento de replanejamento já na fila: reutiliza (retry não duplica)", () => {
    expect(decidirDivergenciasCadastroMaquinas([div()], [ev({ status: "pendente" })], agora("15:35")).aguardando).toEqual(["P1"]);
    expect(decidirDivergenciasCadastroMaquinas([div()], [ev({ status: "pendente" })], agora("15:35")).registrar).toEqual([]);
  });
  it("mesma assinatura já tentada e ainda divergente: persistente, sem novo evento (sem laço)", () => {
    const a = assinaturaDeChaves([chave(div())]);
    const tentada = ev({ origem: ORIGEM_REVALIDACAO_CADASTRO_MAQUINAS, assinatura: a, criadoEm: new Date(agora("15:30")).toISOString() });
    const r = decidirDivergenciasCadastroMaquinas([div()], [tentada], agora("15:35"));
    expect(r.registrar).toEqual([]); expect(r.persistentes).toHaveLength(1);
  });
  it("a origem da funcionária NÃO se confunde com a do cadastro de máquinas", () => {
    const a = assinaturaDeChaves([chave(div())]);
    const deFuncionario = ev({ origem: "revalidacao_funcionarios", assinatura: a });
    expect(decidirDivergenciasCadastroMaquinas([div()], [deFuncionario], agora("15:35")).registrar).toHaveLength(1);
  });
});

function banco(cfg: { cadastro?: unknown[]; eventos?: unknown[] }) {
  const chamadas: { nome: string; args?: Record<string, unknown> }[] = [];
  const cadeia = (data: unknown) => { const c: Record<string, unknown> = {}; ["select", "eq", "in", "gte", "order", "limit"].forEach((m) => (c[m] = () => c)); c.then = (ok: (v: unknown) => void) => ok({ data, error: null }); return c; };
  const periodos = ["07:12", "08:48", "10:24", "13:00", "14:20", "15:40"].map((inicio) => ({ inicio: `${inicio}:00` }));
  const cliente = {
    rpc: async (nome: string, args?: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      if (nome === "escala_reconciliar_indisponibilidades") return { data: { criadas: 0, atualizadas: 0, removidas: 0 }, error: null };
      if (nome === "escala_divergencias_cadastro_maquinas") return { data: cfg.cadastro ?? [], error: null };
      if (nome === "escala_registrar_evento") return { data: "evt", error: null };
      return { data: [], error: null };
    },
    from: (tabela: string) => ({ select: () => cadeia(tabela === "periodos" ? periodos : (cfg.eventos ?? [])) }),
  };
  return { cliente: cliente as unknown as SupabaseClient, chamadas };
}
const linha = (periodo = "m1", tipo = "maquina_inativa") => ({ previsao_id: "P1", data: DIA, periodo_id: periodo, maquina_id: "m5", etapa_id: "e1", tipo });

describe("fluxo: o evento perdido do cadastro é recuperado antes do próximo período", () => {
  it("máquina desativada, evento imediato perdido: a checagem das 15:35 vê a alocação futura e registra o bloqueio (recurso_bloqueado)", async () => {
    const { cliente, chamadas } = banco({ cadastro: [linha("m1"), linha("m2")] });
    const r = await revalidarDisponibilidade(cliente, agora("15:35"));
    expect(r.cadastroMaquinas).toMatchObject({ divergencias: 2, eventosRegistrados: 1 });
    const reg = chamadas.filter((c) => c.nome === "escala_registrar_evento");
    expect(reg).toHaveLength(1);
    expect(reg[0].args).toMatchObject({ p_tipo: "recurso_bloqueado", p_previsao_id: "P1" });
  });
  it("execução repetida: sem divergência nada; com evento já na fila nada novo (NO-OP)", async () => {
    const limpo = banco({});
    await revalidarDisponibilidade(limpo.cliente, agora("15:35")); await revalidarDisponibilidade(limpo.cliente, agora("15:38"));
    expect(limpo.chamadas.filter((c) => c.nome === "escala_registrar_evento")).toHaveLength(0);
    const fila = banco({ cadastro: [linha()], eventos: [{ previsao_id: "P1", tipo: "recurso_bloqueado", status: "pendente", tentativas: 0, criado_em: new Date(agora("15:30")).toISOString(), payload: {} }] });
    await revalidarDisponibilidade(fila.cliente, agora("15:35")); await revalidarDisponibilidade(fila.cliente, agora("15:38"));
    expect(fila.chamadas.filter((c) => c.nome === "escala_registrar_evento")).toHaveLength(0);
  });
  it("roteiro que deixou de autorizar a máquina e fora da seleção da Previsão também são recuperados", async () => {
    const { cliente } = banco({ cadastro: [linha("t1", "roteiro_nao_autoriza"), linha("t2", "fora_da_selecao_previsao")] });
    const r = await revalidarDisponibilidade(cliente, agora("12:55"));
    expect(r.cadastroMaquinas.eventosRegistrados).toBe(1);
  });
  it("fora da janela de um período: nem consulta (só pré-período)", async () => {
    const { cliente, chamadas } = banco({ cadastro: [linha()] });
    await revalidarDisponibilidade(cliente, agora("11:30"));
    expect(chamadas.map((c) => c.nome)).not.toContain("escala_divergencias_cadastro_maquinas");
  });
});

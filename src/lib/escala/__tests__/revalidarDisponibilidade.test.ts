import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decidirViolacoes, revalidarDisponibilidadeMaquinas, type ViolacaoDisponibilidade } from "../revalidarDisponibilidade";
import { epochMsNoFuso } from "@/features/escala/tempo";

const PERIODOS = ["07:12", "08:48", "10:24", "13:00", "14:20", "15:40"].map((inicio) => ({ inicio: `${inicio}:00` }));
const DIA = "2026-10-27";
const agora = (hhmm: string) => epochMsNoFuso(DIA, hhmm);
const viol = (desde: string, previsaoId = "P1", causaId = "C1"): ViolacaoDisponibilidade => ({ previsaoId, data: DIA, periodoId: "t1", maquinaId: "m8", desde, causaId });
const evt = (status: string, causaId: string | null = "C1", previsaoId = "P1", criadoEm = "2026-10-27T12:34:05Z") => ({ previsaoId, criadoEm, status, causaId });

describe("decidirViolacoes — fail closed sem laço", () => {
  it("violação sem nenhum evento de bloqueio da causa: registra evento", () => {
    expect(decidirViolacoes([viol("2026-10-27T12:34:00Z")], [])).toEqual({ registrar: [{ previsaoId: "P1", violacoes: 1, causaId: "C1" }], aguardando: [], persistentes: [] });
  });
  it("evento do bloqueio ainda na fila: aguarda (a drenagem processa) — não duplica", () => {
    const r = decidirViolacoes([viol("2026-10-27T12:34:00Z")], [evt("pendente")]);
    expect(r.registrar).toEqual([]); expect(r.aguardando).toEqual(["P1"]);
  });
  it("evento já processado e o plano ainda viola: persistente — NÃO registra de novo (evita recálculo em laço)", () => {
    const r = decidirViolacoes([viol("2026-10-27T12:34:00Z")], [evt("processado")]);
    expect(r.registrar).toEqual([]); expect(r.persistentes).toHaveLength(1);
  });
  it("evento de OUTRA causa (mesmo recente, mesma semana) não cobre a causa violada: identidade, não relógio", () => {
    const r = decidirViolacoes([viol("2026-10-27T12:34:00Z", "P1", "C2")], [evt("processado", "C1", "P1", "2026-10-27T12:33:30Z")]);
    expect(r.registrar).toHaveLength(1);
  });
  it("evento sem identificação da causa (formato antigo) não cobre ninguém: pede recálculo (fail closed)", () => {
    expect(decidirViolacoes([viol("2026-10-27T12:34:00Z")], [evt("processado", null)]).registrar).toHaveLength(1);
  });
  it("semanas independentes", () => {
    const r = decidirViolacoes([viol("2026-10-27T12:34:00Z", "P1"), viol("2026-10-27T12:34:00Z", "P2")], [evt("pendente")]);
    expect(r.registrar.map((x) => x.previsaoId)).toEqual(["P2"]); expect(r.aguardando).toEqual(["P1"]);
  });
});

// admin falso: registra as chamadas e devolve o que o teste configurar
function admin(cfg: { reconciliar?: unknown; violacoes?: unknown[]; eventos?: unknown[]; erroReconciliar?: boolean }) {
  const chamadas: string[] = [];
  const cadeia = (data: unknown) => { const c: Record<string, unknown> = { eq: () => c, in: () => c, then: (ok: (v: unknown) => void) => ok({ data, error: null }) }; return c; };
  const cliente = {
    rpc: async (nome: string) => {
      chamadas.push(nome);
      if (nome === "escala_reconciliar_indisponibilidades") return cfg.erroReconciliar ? { data: null, error: { message: "falhou" } } : { data: cfg.reconciliar ?? { criadas: 0, atualizadas: 0, removidas: 0 }, error: null };
      if (nome === "escala_violacoes_disponibilidade") return { data: cfg.violacoes ?? [], error: null };
      if (nome === "escala_registrar_evento") return { data: "evt", error: null };
      return { data: null, error: null };
    },
    from: (tabela: string) => ({ select: () => cadeia(tabela === "periodos" ? PERIODOS : (cfg.eventos ?? [])) }),
  };
  return { cliente: cliente as unknown as SupabaseClient, chamadas };
}

describe("revalidarDisponibilidadeMaquinas — idempotente, sem mudança = nada", () => {
  it("fora da janela de um período: só reconcilia (barato), não confere nem registra nada", async () => {
    const { cliente, chamadas } = admin({});
    const r = await revalidarDisponibilidadeMaquinas(cliente, agora("11:30"));
    expect(chamadas).toEqual(["escala_reconciliar_indisponibilidades"]);
    expect(r.dentroDaJanela).toBe(false); expect(r.eventosRegistrados).toBe(0);
  });
  it("12:55 sem violações e sem mudança: NO-OP (nenhum evento => nenhuma versão nova)", async () => {
    const { cliente, chamadas } = admin({});
    const r = await revalidarDisponibilidadeMaquinas(cliente, agora("12:55"));
    expect(chamadas).toEqual(["escala_reconciliar_indisponibilidades", "escala_violacoes_disponibilidade", "escala_divergencias_funcionarios", "escala_divergencias_cadastro_maquinas"]); // máquinas + funcionários na mesma janela
    expect(r).toMatchObject({ dentroDaJanela: true, violacoes: 0, eventosRegistrados: 0 });
  });
  it("checagem repetida (três vezes) sem mudança continua sem registrar nada", async () => {
    const { cliente, chamadas } = admin({});
    for (let i = 0; i < 3; i++) await revalidarDisponibilidadeMaquinas(cliente, agora("12:56"));
    expect(chamadas.filter((c) => c === "escala_registrar_evento")).toEqual([]);
  });
  it("evento imediato perdido: a checagem das 12:55 vê a M8 alocada com Parada aberta e registra o bloqueio (recuperação)", async () => {
    const { cliente, chamadas } = admin({ violacoes: [{ previsao_id: "P1", data: DIA, periodo_id: "t1", maquina_id: "m8", funcionario_id: "f1", desde: "2026-10-27T12:34:00Z", origem_tipo: "ocorrencia_maquina", indisponibilidade_id: "C1" }] });
    const r = await revalidarDisponibilidadeMaquinas(cliente, agora("12:55"));
    expect(r.eventosRegistrados).toBe(1);
    expect(chamadas.filter((c) => c === "escala_registrar_evento")).toHaveLength(1);
  });
  it("atraso de 2 min (12:57) ainda confere; depois da janela (13:20) não", async () => {
    expect((await revalidarDisponibilidadeMaquinas(admin({}).cliente, agora("12:57"))).dentroDaJanela).toBe(true);
    expect((await revalidarDisponibilidadeMaquinas(admin({}).cliente, agora("13:20"))).dentroDaJanela).toBe(false);
  });
  it("falha da reconciliação: não lança, registra o erro e as invariantes seguem sendo conferidas (nada é 'liberado' por falta de resposta)", async () => {
    const { cliente, chamadas } = admin({ erroReconciliar: true });
    const r = await revalidarDisponibilidadeMaquinas(cliente, agora("12:55"));
    expect(r.erro).toContain("escala_reconciliar_indisponibilidades");
    expect(chamadas).toContain("escala_violacoes_disponibilidade");
    expect(chamadas.filter((c) => c === "escala_registrar_evento")).toEqual([]);
  });
});

// BLOQUEADOR 1 — GUARDA CONTRA APAGAR A ESCALA HISTÓRICA.
// Regra absoluta: nenhuma alteração de Previsão (dia produtivo, produto, equipe, máquina, quantidade) apaga ou reescreve período que JÁ COMEÇOU.
// Sem nenhum período futuro recalculável => NO-OP operacional (nada é gravado nem apagado). O banco em memória reproduz a RPC escala_aplicar_recalculo,
// inclusive a guarda "o ponto de corte precisa ser um período que ainda não começou" (a RPC real é testada em supabase/tests/escala_guarda_historico.test.sql).
import { describe, it, expect } from "vitest";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { pontoDeCorte } from "../processar";
import { Mundo, estadoDeTeste, type AlocacaoComOrigem } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const SEG = "2026-11-02", TER = "2026-11-03", QUA = "2026-11-04", QUI = "2026-11-05", SEX = "2026-11-06";
const DIAS = [SEG, TER, QUA, QUI, SEX];
const em = (dia: string, hhmm: string) => epochMsNoFuso(dia, hhmm);
const inicioDe = (a: AlocacaoComOrigem) => epochMsNoFuso(a.data, PERIODOS_REAIS.find((p) => p.id === a.periodoId)!.inicio);
const sig = (l: AlocacaoComOrigem[]) => Mundo.assinatura(l);
const iniciadas = (m: Mundo, agora: number) => sig(m.alocacoes.filter((a) => inicioDe(a) <= agora));
const doDia = (m: Mundo, dia: string) => m.alocacoes.filter((a) => a.data === dia);

// semana gerada na segunda 05:00 (nada iniciado); depois o relógio avança até `agora`
async function mundo(agora: number, geradoEm = em(SEG, "05:00")) {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
  await m.recalcular(geradoEm, true);
  if (agora !== geradoEm) await m.recalcular(agora); // plano "vivo" no instante da alteração
  return m;
}
const semDia = (m: Mundo, dia: string) => m.editar((e) => { e.diasProdutivos = e.diasProdutivos.filter((d) => d !== dia); });

describe("remover dia produtivo — o que já começou NUNCA é apagado", () => {
  it("remover o dia produtivo de ONTEM: nada do histórico muda; o dia continua gravado", async () => {
    const agora = em(QUA, "10:00");
    const m = await mundo(agora);
    const antes = iniciadas(m, agora);
    const terAntes = sig(doDia(m, TER));
    semDia(m, TER);
    await m.recalcular(agora);
    expect(iniciadas(m, agora)).toBe(antes);
    expect(sig(doDia(m, TER))).toBe(terAntes);
    expect(m.dias.has(TER)).toBe(true);
  });

  it("remover o dia produtivo da SEMANA ANTERIOR (semana inteira já ocorrida): NO-OP, nada apagado, nada gravado", async () => {
    const m = await mundo(em(QUA, "10:00"));
    const aposSemana = em("2026-11-09", "09:00"); // segunda da semana seguinte
    await m.recalcular(aposSemana); // estabiliza o relógio; nada mutável
    const antes = sig(m.alocacoes);
    const versoes = JSON.stringify([...m.dias].map(([d, x]) => [d, x.versao]));
    semDia(m, QUA);
    const r = await m.recalcular(aposSemana);
    expect(r.status).toBe("sem_alteracao");
    expect(sig(m.alocacoes)).toBe(antes);
    expect(JSON.stringify([...m.dias].map(([d, x]) => [d, x.versao]))).toBe(versoes);
  });

  it("remover HOJE depois de M1 (08:00): M1 fica; M2..T3 de hoje somem; os outros dias seguem", async () => {
    const agora = em(QUA, "08:00");
    const m = await mundo(agora);
    const antes = iniciadas(m, agora);
    semDia(m, QUA);
    await m.recalcular(agora);
    expect(iniciadas(m, agora)).toBe(antes);
    expect(doDia(m, QUA).map((a) => a.periodoId).sort()).toEqual(doDia(m, QUA).map((a) => a.periodoId).filter((p) => p === "m1").sort());
    expect(doDia(m, QUA).length).toBeGreaterThan(0); // as linhas de M1 permanecem
    expect(doDia(m, QUI).length).toBeGreaterThan(0);
    expect(doDia(m, SEX).length).toBeGreaterThan(0);
  });

  it("remover HOJE antes de T1 (12:30, almoço): M1..M3 ficam; T1..T3 de hoje somem", async () => {
    const agora = em(QUA, "12:30");
    const m = await mundo(agora);
    const antes = iniciadas(m, agora);
    semDia(m, QUA);
    await m.recalcular(agora);
    expect(iniciadas(m, agora)).toBe(antes);
    expect([...new Set(doDia(m, QUA).map((a) => a.periodoId))].sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("semana SEM nenhum período futuro (sexta 17:30): NO-OP mesmo removendo um dia", async () => {
    const agora = em(SEX, "17:30");
    const m = await mundo(agora);
    const antes = sig(m.alocacoes);
    semDia(m, QUA);
    const r = await m.recalcular(agora);
    expect(r.status).toBe("sem_alteracao");
    expect(sig(m.alocacoes)).toBe(antes);
    expect(m.dias.has(QUA)).toBe(true);
  });

  it("remover o ÚLTIMO dia futuro (quinta 17:30, sexta ainda não começou): só sexta some; segunda..quinta intactos", async () => {
    const agora = em(QUI, "17:30");
    const m = await mundo(agora);
    const antes = iniciadas(m, agora);
    semDia(m, SEX);
    await m.recalcular(agora);
    expect(iniciadas(m, agora)).toBe(antes);
    expect(doDia(m, SEX)).toHaveLength(0);
    expect(m.dias.has(SEX)).toBe(false);
    expect(doDia(m, QUI).length).toBeGreaterThan(0);
  });

  it("dia removido INTEIRAMENTE no passado + nenhum dia futuro: nada de histórico some mesmo com vários dias removidos", async () => {
    const agora = em(SEX, "18:00");
    const m = await mundo(agora);
    const antes = sig(m.alocacoes);
    m.editar((e) => { e.diasProdutivos = [SEX]; }); // segunda a quinta deixam de ser produtivos
    const r = await m.recalcular(agora);
    expect(r.status).toBe("sem_alteracao");
    expect(sig(m.alocacoes)).toBe(antes);
  });
});

describe("outras alterações sem slot futuro — nenhum período iniciado é apagado", () => {
  const depoisDaSemana = em("2026-11-07", "10:00"); // sábado, depois do último período

  it("alterar produto (retirar um) sem slots futuros: NO-OP", async () => {
    const m = await mundo(depoisDaSemana);
    const antes = sig(m.alocacoes);
    m.editar((e) => { e.itens = e.itens.filter((i) => i.produtoId !== "pD"); });
    const r = await m.recalcular(depoisDaSemana);
    expect(r.status).toBe("sem_alteracao");
    expect(sig(m.alocacoes)).toBe(antes);
  });

  it("alterar equipe (retirar pessoas) sem slots futuros: NO-OP", async () => {
    const m = await mundo(depoisDaSemana);
    const antes = sig(m.alocacoes);
    m.editar((e) => { e.equipeProdutiva = e.equipeProdutiva.slice(0, 3); });
    const r = await m.recalcular(depoisDaSemana);
    expect(r.status).toBe("sem_alteracao");
    expect(sig(m.alocacoes)).toBe(antes);
  });

  it("quantidade zerada com semana em andamento: o iniciado permanece", async () => {
    const agora = em(QUA, "10:00");
    const m = await mundo(agora);
    const antes = iniciadas(m, agora);
    m.editar((e) => { e.itens = e.itens.map((i) => ({ ...i, quantidade: 0 })); });
    await m.recalcular(agora);
    expect(iniciadas(m, agora)).toBe(antes);
  });

  it("máquina trocada/indisponível e equipe reduzida com semana em andamento: o iniciado permanece", async () => {
    const agora = em(QUA, "10:00");
    const m = await mundo(agora);
    const antes = iniciadas(m, agora);
    m.editar((e) => { e.maquinasIndisponiveisPrevisao = ["m1", "m2"]; e.equipeProdutiva = e.equipeProdutiva.slice(0, 4); });
    await m.recalcular(agora);
    expect(iniciadas(m, agora)).toBe(antes);
  });
});

describe("pontoDeCorte — primeiro período que ainda não começou", () => {
  const periodosPorDia = new Map(DIAS.map((d) => [d, PERIODOS_REAIS]));
  const slots = (dia: string, ids: string[]) => ids.map((id, i) => ({ data: dia, periodoId: id, indice: i, inicioMs: em(dia, PERIODOS_REAIS.find((p) => p.id === id)!.inicio), fimMs: 0, inicioMin: 0, fimMin: 0, primeiroDoDia: false }));

  it("sem slot e sem período futuro nos dias removidos => null", () => {
    expect(pontoDeCorte({ slots: slots(TER, ["m1", "m2", "m3", "t1", "t2", "t3"]), aPartirDe: 6 }, [TER], periodosPorDia, em(QUA, "10:00"))).toBeNull();
  });
  it("dia removido tem períodos futuros e não há slot: corta no 1º período não iniciado dele (nunca no 1º do dia)", () => {
    const c = pontoDeCorte({ slots: [], aPartirDe: 0 }, [QUA], periodosPorDia, em(QUA, "12:30"));
    expect(c).toEqual({ data: QUA, periodoId: "t1" });
  });
  it("com slot futuro e dia removido de hoje parcialmente iniciado: vale o mais cedo dos dois", () => {
    const c = pontoDeCorte({ slots: slots(QUI, ["m1"]), aPartirDe: 0 }, [QUA], periodosPorDia, em(QUA, "08:00"));
    expect(c).toEqual({ data: QUA, periodoId: "m2" });
  });
  it("período que começa exatamente agora já começou (fronteira [início, fim))", () => {
    const c = pontoDeCorte({ slots: [], aPartirDe: 0 }, [QUA], periodosPorDia, em(QUA, "13:00"));
    expect(c).toEqual({ data: QUA, periodoId: "t2" });
  });
});

describe("a proteção do BANCO: mesmo que o processador envie um corte no passado, nada é apagado", () => {
  it("aplicar com corte em período já iniciado é recusado (ESCALA_CORTE_NO_PASSADO) e o histórico permanece", async () => {
    const agora = em(QUA, "10:00");
    const m = await mundo(agora);
    const antes = sig(m.alocacoes);
    // simula o comportamento ANTIGO: sem slot futuro, cortar no 1º período do dia removido (que já ocorreu)
    const io = (m as unknown as { io(): { aplicar(p: unknown): Promise<unknown> } }).io();
    await expect(io.aplicar({
      previsaoId: "prev1", dias: [{ data: SEG, versao_base: 1, periodos_snapshot: PERIODOS_REAIS }], aPartirDeData: SEG, aPartirDePeriodo: "m1",
      alocacoes: [], removerDias: [SEG, TER], usuarioId: null, eventoIds: [], resumo: {},
    })).rejects.toThrow(/ESCALA_CORTE_NO_PASSADO/);
    expect(sig(m.alocacoes)).toBe(antes);
  });
});

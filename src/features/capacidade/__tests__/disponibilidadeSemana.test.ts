// FRENTE B — disponibilidade efetiva por máquina na semana (a mesma verdade da Escala) e seu efeito em "Possível".
import { describe, it, expect } from "vitest";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { calcularHorasPorMaquinaDaSemana, periodosProdutivosDaSemana, fimDaSemanaIso, type CausaMaquina } from "../disponibilidadeSemana";
import { calcularAnaliseCapacidadeSemanal, calcularCapacidadeMaximaProduto, calcularCapacidadeMaximaSemana, calcularCapacidadeInicialPorMaquina } from "../calculations";
import type { Maquina, PeriodoComDuracao, PrevisaoItem, Produto } from "@/types/domain";

const dur = (a: string, b: string) => { const [h1, m1] = a.split(":").map(Number); const [h2, m2] = b.split(":").map(Number); return (h2 * 60 + m2 - h1 * 60 - m1) / 60; };
const PER: PeriodoComDuracao[] = [["m1", "07:12", "08:48"], ["m2", "08:48", "10:24"], ["m3", "10:24", "11:55"], ["t1", "13:00", "14:20"], ["t2", "14:20", "15:40"], ["t3", "15:40", "17:00"]]
  .map(([id, inicio, fim]) => ({ id, nome: id.toUpperCase(), inicio, fim, duracaoHoras: dur(inicio, fim) }));
const SEMANA = "2026-10-26";
const DIAS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
const HORAS_DIA = PER.reduce((s, p) => s + p.duracaoHoras, 0);
const NOMINAL = HORAS_DIA * DIAS.length;
const periodos = periodosProdutivosDaSemana(DIAS, PER);
const t = (dia: string, hhmm: string) => epochMsNoFuso(dia, hhmm);
const maquinas: Maquina[] = ["m8", "m9", "m5"].map((id) => ({ id, nome: id, operacao: "Rosquear", ativo: true }));
const base = { maquinas, semanaInicio: SEMANA, hojeIso: "2026-10-27", indisponiveisNaSemana: [] as string[], causas: [] as CausaMaquina[], periodos, horasPorMaquinaSemana: NOMINAL };
const h = (id: string, r: ReturnType<typeof calcularHorasPorMaquinaDaSemana>) => (r ? r[id] : undefined);
const arred = (n: number | undefined) => (n === undefined ? n : Math.round(n * 1000) / 1000);

describe("calcularHorasPorMaquinaDaSemana", () => {
  it("sem nenhuma indisponibilidade: undefined (caminho antigo, números idênticos)", () => {
    expect(calcularHorasPorMaquinaDaSemana(base)).toBeUndefined();
  });
  it("semana ENCERRADA: undefined mesmo com Parada, bloqueio, inativa e marcada (histórico nunca recalculado)", () => {
    const r = calcularHorasPorMaquinaDaSemana({ ...base, hojeIso: "2026-11-02", indisponiveisNaSemana: ["m9"], maquinas: [{ id: "m5", ativo: false }, ...maquinas.slice(0, 2)], causas: [{ maquinaId: "m8", desdeMs: t("2026-10-27", "09:34"), liberadaEmMs: null }] });
    expect(r).toBeUndefined();
  });
  it("máquina inativa e máquina marcada na semana: 0 h", () => {
    const r = calcularHorasPorMaquinaDaSemana({ ...base, indisponiveisNaSemana: ["m9"], maquinas: [{ id: "m5", ativo: false }, ...maquinas.slice(0, 2)] });
    expect(h("m5", r)).toBe(0); expect(h("m9", r)).toBe(0); expect(h("m8", r)).toBeUndefined(); // m8 segue nominal (sem chave)
  });
  it("Parada ABERTA desde terça 09:34: a segunda e terça M1 NÃO são tiradas; perde M2 de terça (afetado por sobreposição) + o resto da semana", () => {
    const r = calcularHorasPorMaquinaDaSemana({ ...base, causas: [{ maquinaId: "m8", desdeMs: t("2026-10-27", "09:34"), liberadaEmMs: null }] });
    const perdidas = (HORAS_DIA - PER[0].duracaoHoras) /* terça sem M1 */ + HORAS_DIA * 3;
    expect(arred(h("m8", r))).toBe(arred(NOMINAL - perdidas));
    expect(h("m8", r)).toBeGreaterThan(HORAS_DIA + PER[0].duracaoHoras - 0.0001); // segunda inteira + terça M1 preservadas
  });
  it("Parada ENCERRADA 09:34–11:54: só M2 e M3 de terça (já ocorridos) — T1 em diante e os outros dias intactos", () => {
    const r = calcularHorasPorMaquinaDaSemana({ ...base, causas: [{ maquinaId: "m8", desdeMs: t("2026-10-27", "09:34"), liberadaEmMs: t("2026-10-27", "11:54") }] });
    expect(arred(h("m8", r))).toBe(arred(NOMINAL - PER[1].duracaoHoras - PER[2].duracaoHoras));
  });
  it("Parada + bloqueio manual sobrepostos na mesma máquina: perda é a UNIÃO (não dobra)", () => {
    const um = calcularHorasPorMaquinaDaSemana({ ...base, causas: [{ maquinaId: "m8", desdeMs: t("2026-10-28", "07:00"), liberadaEmMs: null }] });
    const dois = calcularHorasPorMaquinaDaSemana({ ...base, causas: [{ maquinaId: "m8", desdeMs: t("2026-10-28", "07:00"), liberadaEmMs: null }, { maquinaId: "m8", desdeMs: t("2026-10-29", "08:00"), liberadaEmMs: null }] });
    expect(h("m8", dois)).toBe(h("m8", um));
  });
  it("capacidade RESTANTE (daqui para frente): só os períodos que começam depois do instante, menos o que as causas tiram", () => {
    const agora = t("2026-10-27", "10:30"); // M3 de terça em andamento
    const r = calcularHorasPorMaquinaDaSemana({ ...base, somenteFuturoAPartirDeMs: agora, causas: [{ maquinaId: "m8", desdeMs: t("2026-10-27", "09:34"), liberadaEmMs: null }] });
    const futuras = periodos.filter((p) => p.inicioMs > agora).reduce((s, p) => s + p.horas, 0);
    expect(arred(h("m9", r))).toBe(arred(futuras)); // máquina sem causa = todas as horas futuras
    expect(h("m8", r)).toBe(0); // Parada aberta cobre todo o futuro
  });
  it("fimDaSemanaIso", () => { expect(fimDaSemanaIso("2026-10-26")).toBe("2026-11-01"); });
});

// ---- efeito em "Possível" (calcularCapacidadeMaximaSemana) e no resto da análise ----
const produto = (id: string, etapas: { id: string; metas: number }[]): Produto => ({
  id, nome: id, referencia: "", valorUnitario: 1, ativo: true, prioridade: "media",
  roteiro: etapas.map((e) => ({ id: e.id, operacao: "Rosquear", metas: { m1: e.metas, m2: e.metas, m3: e.metas, t1: e.metas, t2: e.metas, t3: e.metas }, maquinasIds: [] })),
});
const item = (produtoId: string, quantidade: number, maquinasPorEtapa: Record<string, string[]>): PrevisaoItem => ({ id: `i-${produtoId}`, produtoId, produtoNome: produtoId, valorUnitario: 1, quantidade, maquinasPorEtapa });

describe("'Possível' com horas por máquina", () => {
  const P = [produto("A", [{ id: "A1", metas: 100 }])];
  const itens = [item("A", 5_000, { A1: ["m8", "m9"] })];
  const semHoras = calcularCapacidadeMaximaSemana(itens, P, maquinas, PER, NOMINAL);
  it("horasPorMaquina ausente ou vazio: resultado IDÊNTICO ao de sempre", () => {
    expect(calcularCapacidadeMaximaSemana(itens, P, maquinas, PER, NOMINAL, undefined)).toEqual(semHoras);
    expect(calcularCapacidadeMaximaSemana(itens, P, maquinas, PER, NOMINAL, {})).toEqual(semHoras);
    expect(calcularAnaliseCapacidadeSemanal(itens, P, maquinas, PER, NOMINAL, {})).toEqual(calcularAnaliseCapacidadeSemanal(itens, P, maquinas, PER, NOMINAL));
  });
  it("uma das duas máquinas da etapa com 0 h: a outra segura sozinha; possível cai (e nunca fica maior que o previsto)", () => {
    const r = calcularCapacidadeMaximaSemana([item("A", 100_000, { A1: ["m8", "m9"] })], P, maquinas, PER, NOMINAL, { m8: 0 });
    const cheio = calcularCapacidadeMaximaSemana([item("A", 100_000, { A1: ["m8", "m9"] })], P, maquinas, PER, NOMINAL);
    expect(r.resultadosPorItem[0].maximoPossivel).toBeLessThan(cheio.resultadosPorItem[0].maximoPossivel);
    expect(r.resultadosPorItem[0].maximoPossivel).toBeGreaterThan(0);
  });
  it("calcularCapacidadeMaximaProduto soma as horas REAIS das máquinas da etapa", () => {
    const nominal = calcularCapacidadeMaximaProduto("A", { A1: ["m8", "m9"] }, P, PER, NOMINAL);
    const metade = calcularCapacidadeMaximaProduto("A", { A1: ["m8", "m9"] }, P, PER, NOMINAL, { m8: NOMINAL / 2 });
    expect(metade.maxPecas).toBe(Math.floor(nominal.maxPecas * 0.75));
  });
  it("etapa só com máquina de 0 h: possível 0 para o item; análise marca gargalo (999%) em vez de Infinity", () => {
    const so8 = [item("A", 1_000, { A1: ["m8"] })];
    const r = calcularCapacidadeMaximaSemana(so8, P, maquinas, PER, NOMINAL, { m8: 0 });
    expect(r.resultadosPorItem[0].maximoPossivel).toBe(0);
    const a = calcularAnaliseCapacidadeSemanal(so8, P, maquinas, PER, NOMINAL, { m8: 0 });
    expect(a.maquinas[0].pct).toBe(999); expect(a.maquinas[0].status).toBe("gargalo"); expect(a.atingivel).toBe(false);
  });
  it("capacidade inicial por máquina (página Capacidade) usa as horas reais; marcada/inativa seguem fora", () => {
    const m = calcularCapacidadeInicialPorMaquina([...maquinas, { id: "x", nome: "x", operacao: "Rosquear", ativo: false }], ["m9"], NOMINAL, { m8: 10 });
    expect(m).toEqual({ m8: 10, m5: NOMINAL });
  });
});

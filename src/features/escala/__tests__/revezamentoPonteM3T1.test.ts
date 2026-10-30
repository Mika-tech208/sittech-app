// PONTE M3 → T1 (flag `revezamento_ponte_m3_t1`, DESLIGADA por padrão) — além do bloco, a mesma pessoa NÃO repete em T1 a operação que fez em M3 (mesmo dia).
// Casos do pedido: A (M3 Embalar/T1 Embalar PROIBIDO), B (M3 Embalar/T1 Etiquetar PERMITIDO), C (outra máquina, mesma operação PROIBIDO), D (T3 → M1 do dia seguinte PERMITIDO),
// E (troca manual registrada é exposição; o funcionario_id do apontamento NUNCA é). Mais: flag desligada = byte-idêntico, verificador, auditor, troca manual TS, fluxo, estabilização.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { MemoriaBloco, ehPeriodoPonte, repeticoesPorBloco } from "../exposicaoBloco";
import { estabilizarPessoas, reatribuirPessoasBloco } from "../estabilidade";
import { MENSAGEM_TROCA_BLOQUEADA_PONTE, validarTroca, type LinhaRotacao } from "../rotacao";
import { lerParametros } from "../parametros";
import { verificarRestricoesDuras } from "../fluxo/restricoes";
import { planejarComFluxo } from "../fluxo";
import { MOTIVO_REVEZAMENTO, type AlocacaoEscala, type EntradaEscala } from "../types";
import { entrada, equipe, IDS_PERIODOS, pool } from "./helpers";

const D1 = "2026-10-28";
const D2 = "2026-10-29";
const bloco = (e: EntradaEscala): EntradaEscala => ({ ...e, revezamentoDuro: true, revezamentoEscopo: "bloco" });
const ponte = (e: EntradaEscala): EntradaEscala => ({ ...bloco(e), revezamentoPonteM3T1: true });
const linha = (periodoId: string, f: string, op: string | null, maq: string | null, data = D1, extra: Partial<AlocacaoEscala> = {}): AlocacaoEscala => ({
  data, periodoId, funcionarioId: f, maquinaId: maq, produtoId: maq ? "P" : null, etapaId: maq ? "P-e1" : null, operacaoId: op, pecas: 0, motivoSemPosto: maq ? null : "x", excecaoRevezamento: false, motivoExcecao: null, ...extra,
});
const L = (periodoId: string, funcionarioId: string, op: string | null, maq: string | null): LinhaRotacao => ({ periodoId, funcionarioId, operacaoId: op, maquinaId: maq });
const doPeriodo = (r: AlocacaoEscala[], pid: string, data = D1) => r.filter((a) => a.data === data && a.periodoId === pid);
/** Congela de M1 até `ate` (inclusive); a pessoa f01 faz `ops[periodo]` (null = sem posto). */
function congelar(e: EntradaEscala, ate: string, porPeriodo: Record<string, { f: string; op: string; maq: string; extra?: Partial<AlocacaoEscala> }[]>, data = D1): EntradaEscala {
  const i = e.slots.findIndex((s) => s.data === data && s.periodoId === ate);
  const cong: AlocacaoEscala[] = [];
  e.slots.slice(0, i + 1).forEach((s) => (porPeriodo[`${s.data}|${s.periodoId}`] ?? porPeriodo[s.periodoId] ?? []).forEach((x) => cong.push(linha(s.periodoId, x.f, x.op, x.maq, s.data, x.extra))));
  return { ...e, aPartirDe: i + 1, congeladas: cong };
}
const reps = (e: EntradaEscala, rows: AlocacaoEscala[], comPonte: boolean) => repeticoesPorBloco([...e.congeladas, ...rows], e.slots, e.equivalenciaOperacoes, comPonte);
const base1 = (n: number, pools: ReturnType<typeof pool>[], dias = [D1]) => entrada({ funcionarios: equipe(n), pools }, dias);

describe("núcleo: ehPeriodoPonte, memória, parâmetro", () => {
  it("só T1 logo após M3 do mesmo dia é período-ponte (T2/T3, M1 do dia seguinte e o 1º slot da semana não)", () => {
    const e = base1(1, [pool({ produto: "P", op: "Em", q: 100, maquinas: ["a"] })], [D1, D2]);
    const pontes = e.slots.filter((s) => ehPeriodoPonte(e.slots, s.indice)).map((s) => `${s.data}|${s.periodoId}`);
    expect(pontes).toEqual([`${D1}|t1`, `${D2}|t1`]);
  });
  it("MemoriaBloco: a ponte entra em `proibido`, expande equivalências e é zerada por limparPonte/limpar", () => {
    const m = new MemoriaBloco({ RP: ["R"] });
    m.registrarPonte("f", "R");
    expect(m.proibido("f", "R")).toBe(true);
    expect(m.proibido("f", "RP")).toBe(true);
    expect(m.proibido("g", "R")).toBe(false);
    m.limparPonte();
    expect(m.proibido("f", "R")).toBe(false);
    m.registrarPonte("f", "R");
    m.limpar();
    expect(m.proibido("f", "R")).toBe(false);
  });
  it("parâmetro: ausente/desconhecido = desligado (chave omitida: saída idêntica à anterior); só `true` liga", () => {
    expect("revezamentoPonteM3T1" in lerParametros([])).toBe(false);
    expect("revezamentoPonteM3T1" in lerParametros([{ chave: "revezamento_ponte_m3_t1", valor: "sim" }])).toBe(false);
    expect(lerParametros([{ chave: "revezamento_ponte_m3_t1", valor: true }]).revezamentoPonteM3T1).toBe(true);
  });
});

describe("A–D no motor (gerarEscala)", () => {
  const pEm = pool({ produto: "P", op: "Em", q: 900, maquinas: ["mA"] });
  it("A) M3 Embalar → T1 Embalar: PROIBIDO com a ponte (posto vazio + diagnóstico) e PERMITIDO sem ela (regra de bloco atual)", () => {
    const b = base1(1, [pEm]);
    const e = congelar(b, "m3", { m3: [{ f: "f01", op: "Em", maq: "mA" }] });
    const sem = gerarEscala(bloco(e));
    expect(doPeriodo(sem.alocacoes, "t1")[0].maquinaId).toBe("mA"); // hoje em PROD: permitido
    const com = gerarEscala(ponte(e));
    const t1 = doPeriodo(com.alocacoes, "t1")[0];
    expect(t1.maquinaId).toBeNull();
    expect(t1.motivoSemPosto).toBe(MOTIVO_REVEZAMENTO);
    expect(com.alertas.find((a) => a.tipo === "rotacao_sem_solucao" && a.periodoId === "t1")?.motivo).toContain("M3 para T1");
    expect(reps(e, com.alocacoes, true)).toEqual([]);
    expect(reps(e, sem.alocacoes, true).map((r) => `${r.funcionarioId}|${r.periodos.join("/")}`)).toEqual([`f01|m3/t1`]);
    // T2 e T3 não olham para a manhã: a pessoa volta a Embalar em T2 (a ponte vale só em T1)
    expect(doPeriodo(com.alocacoes, "t2")[0].maquinaId).toBe("mA");
  });
  it("A') com 2 pessoas, quem fez Embalar em M3 não repete em T1; a outra assume", () => {
    const e = congelar(base1(2, [pEm]), "m3", { m3: [{ f: "f01", op: "Em", maq: "mA" }] });
    const t1 = doPeriodo(gerarEscala(ponte(e)).alocacoes, "t1").filter((a) => a.maquinaId);
    expect(t1.map((a) => a.funcionarioId)).toEqual(["f02"]);
  });
  it("B) M3 Embalar → T1 Etiquetar: PERMITIDO (operação diferente)", () => {
    const pools = [pEm, pool({ produto: "Q", op: "Et", q: 900, maquinas: ["mB"] })];
    const e = congelar(base1(2, pools), "m3", { m3: [{ f: "f01", op: "Em", maq: "mA" }, { f: "f02", op: "Et", maq: "mB" }] });
    const t1 = doPeriodo(gerarEscala(ponte(e)).alocacoes, "t1").filter((a) => a.maquinaId);
    expect(t1.map((a) => `${a.funcionarioId}:${a.operacaoId}`).sort()).toEqual(["f01:Et", "f02:Em"]); // ambos trocam de operação, nenhum posto vazio
  });
  it("C) M3 Embalar na máquina A → T1 Embalar na máquina B: PROIBIDO (a identidade é a operação, não a máquina)", () => {
    const e = congelar(base1(1, [pool({ produto: "P", op: "Em", q: 900, maquinas: ["mB"] })]), "m3", { m3: [{ f: "f01", op: "Em", maq: "mA" }] });
    expect(doPeriodo(gerarEscala(bloco(e)).alocacoes, "t1")[0].maquinaId).toBe("mB"); // só bloco: permitido
    expect(doPeriodo(gerarEscala(ponte(e)).alocacoes, "t1")[0].maquinaId).toBeNull();
  });
  it("D) T3 Embalar → M1 Embalar do dia seguinte: PERMITIDO (descanso da noite; a ponte é só M3 → T1)", () => {
    const b = base1(1, [pool({ produto: "P", op: "Em", q: 2000, maquinas: ["mA"] })], [D1, D2]);
    const e = congelar(b, "t3", { t3: [{ f: "f01", op: "Em", maq: "mA" }] });
    const r = gerarEscala(ponte(e));
    expect(doPeriodo(r.alocacoes, "m1", D2)[0].maquinaId).toBe("mA");
    expect(reps(e, r.alocacoes, true)).toEqual([]);
  });
  it("T1 Etiquetar → T2 Embalar depois de M3 Embalar é PERMITIDO (só T1 olha M3)", () => {
    const pools = [pEm, pool({ produto: "Q", op: "Et", q: 900, maquinas: ["mB"] })];
    const e = congelar(base1(2, pools), "t1", { m3: [{ f: "f01", op: "Em", maq: "mA" }, { f: "f02", op: "Et", maq: "mB" }], t1: [{ f: "f01", op: "Et", maq: "mB" }, { f: "f02", op: "Em", maq: "mA" }] });
    const t2 = doPeriodo(gerarEscala(ponte(e)).alocacoes, "t2").filter((a) => a.maquinaId);
    expect(t2.map((a) => `${a.funcionarioId}:${a.operacaoId}`).sort()).toEqual(["f01:Em", "f02:Et"]); // f01 volta a Embalar em T2 (já fez Et em T1; Em só em M3)
  });
  it("recálculo com aPartirDe = T1 reconstrói a ponte de M3 congelado; aPartirDe = T2 não aplica ponte", () => {
    const e = congelar(base1(1, [pEm]), "m3", { m3: [{ f: "f01", op: "Em", maq: "mA" }] });
    expect(doPeriodo(gerarEscala(ponte(e)).alocacoes, "t1")[0].maquinaId).toBeNull();
    const e2 = congelar(base1(1, [pEm]), "t1", { m3: [{ f: "f01", op: "Em", maq: "mA" }], t1: [] });
    expect(doPeriodo(gerarEscala(ponte(e2)).alocacoes, "t2")[0].maquinaId).toBe("mA");
  });
  it("flag desligada (ausente ou false) é BYTE-IDÊNTICA à regra de bloco atual", () => {
    const pools = [pEm, pool({ produto: "Q", op: "Et", q: 900, maquinas: ["mB"] }), pool({ produto: "R", op: "Mo", q: 900, maquinas: ["mC"] })];
    const e = bloco(entrada({ funcionarios: equipe(5), pools }, [D1, D2]));
    const ref = JSON.stringify(gerarEscala(e));
    expect(JSON.stringify(gerarEscala({ ...e, revezamentoPonteM3T1: false }))).toBe(ref);
    expect(JSON.stringify(gerarEscala({ ...e, revezamentoPonteM3T1: undefined }))).toBe(ref);
    // a flag sem o escopo bloco não tem efeito (consecutivo já conta M3 → T1)
    const cons: EntradaEscala = { ...e, revezamentoEscopo: "consecutivo" };
    expect(JSON.stringify(gerarEscala({ ...cons, revezamentoPonteM3T1: true }))).toBe(JSON.stringify(gerarEscala(cons)));
  });
  it("propriedade: com a ponte, o motor nunca viola (0 repetição de bloco, 0 ponte, verificador limpo) em cenários variados", () => {
    for (let n = 2; n <= 8; n++) {
      const pools = [pEm, pool({ produto: "Q", op: "Et", q: 700, maquinas: ["mB", "mC"] }), pool({ produto: "R", op: "Mo", q: 700, maquinas: ["mD"] }), pool({ produto: "S", op: "Pa", q: 500, maquinas: ["mE"] })];
      const e = ponte(entrada({ funcionarios: equipe(n), pools }, [D1, D2]));
      const r = gerarEscala(e);
      expect(reps(e, r.alocacoes, true)).toEqual([]);
      expect(verificarRestricoesDuras(e, r.alocacoes).filter((v) => v.tipo === "revezamento")).toEqual([]);
      expect(r.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
    }
  });
});

describe("E) exposição = troca manual registrada / alocação congelada (nunca o lançador)", () => {
  const pEm = pool({ produto: "P", op: "Em", q: 900, maquinas: ["mA"] });
  it("troca manual (origem 'manual') congelada em M3 expõe a operação que a troca deu à pessoa", () => {
    const e = congelar(base1(2, [pEm]), "m3", { m3: [{ f: "f01", op: "Em", maq: "mA", extra: { origem: "manual" } }] });
    const t1 = doPeriodo(gerarEscala(ponte(e)).alocacoes, "t1").filter((a) => a.maquinaId);
    expect(t1.map((a) => a.funcionarioId)).toEqual(["f02"]);
  });
  it("evidência de execução (exposicaoExecutada) substitui a congelada de M3 SE for entregue — e o motor/verificador concordam; sem ela vale a congelada", () => {
    const e = congelar(base1(1, [pEm]), "m3", { m3: [{ f: "f01", op: "Em", maq: "mA" }] });
    // sem evidência: f01 expõe Em
    expect(doPeriodo(gerarEscala(ponte(e)).alocacoes, "t1")[0].maquinaId).toBeNull();
    // verificador independente: a linha T1 Em de f01 é violação; Et não
    const viol = verificarRestricoesDuras(ponte(e), [linha("t1", "f01", "Em", "mA")], { somenteLinhasNovas: true }).filter((v) => v.tipo === "revezamento");
    expect(viol.length).toBe(1);
    expect(viol[0].detalhe).toContain("ponte M3");
    expect(verificarRestricoesDuras(ponte(e), [linha("t1", "f01", "Et", "mA")], { somenteLinhasNovas: true }).filter((v) => v.tipo === "revezamento")).toEqual([]);
    // flag desligada: o mesmo T1 Em é aceito (regra atual)
    expect(verificarRestricoesDuras(bloco(e), [linha("t1", "f01", "Em", "mA")], { somenteLinhasNovas: true }).filter((v) => v.tipo === "revezamento")).toEqual([]);
  });
});

describe("verificador independente e auditor (repeticoesPorBloco)", () => {
  it("verificador: linha NOVA em T1 repete M3 de plano (não só congelado); M3→T2 não conta; dia seguinte não conta", () => {
    const e = ponte(base1(1, [pool({ produto: "P", op: "Em", q: 100, maquinas: ["mA"] })], [D1, D2]));
    const plano = [linha("m3", "f01", "Em", "mA"), linha("t1", "f01", "Em", "mA"), linha("t3", "f01", "Em", "mA"), linha("m1", "f01", "Em", "mA", D2)];
    const v = verificarRestricoesDuras(e, plano).filter((x) => x.tipo === "revezamento");
    expect(v.map((x) => x.periodoId).sort()).toEqual(["t1", "t3"]); // t1 (ponte) e t3 (bloco: t1 e t3 na tarde)
  });
  it("equivalência (opcional) também vale na ponte", () => {
    const e = { ...ponte(base1(1, [pool({ produto: "P", op: "Pa", q: 100, maquinas: ["mA"] })])), equivalenciaOperacoes: { Pa: ["PaPino"], PaPino: ["Pa"] } };
    const v = verificarRestricoesDuras(e, [linha("m3", "f01", "PaPino", "mA"), linha("t1", "f01", "Pa", "mA")]).filter((x) => x.tipo === "revezamento");
    expect(v.length).toBe(1);
  });
  it("auditor: ponte só conta quando pedida (ponte=false mantém a contagem de hoje)", () => {
    const e = base1(1, [pool({ produto: "P", op: "Em", q: 100, maquinas: ["mA"] })]);
    const rows = [linha("m3", "f01", "Em", "mA"), linha("t1", "f01", "Em", "mB")];
    expect(repeticoesPorBloco(rows, e.slots)).toEqual([]);
    expect(repeticoesPorBloco(rows, e.slots, undefined, true).map((r) => `${r.bloco}|${r.periodos.join("/")}|${r.excesso}`)).toEqual(["tarde|m3/t1|1"]);
  });
});

describe("troca manual (TS) com a ponte", () => {
  const R = { escopo: "bloco" as const, ponteM3T1: true };
  it("M3 Embalar de A; trocar T1 para dar Embalar a A → PROIBIDO (mensagem da ponte); sem a ponte → permitido", () => {
    const d = [L("m3", "A", "Em", "mA"), L("t1", "A", "Z", "mB"), L("m3", "B", "Z", "mC"), L("t1", "B", "Em", "mD")];
    expect(validarTroca(d, IDS_PERIODOS, "t1", "A", "B", R)).toEqual({ ok: false, funcionarioId: "A", mensagem: MENSAGEM_TROCA_BLOQUEADA_PONTE });
    expect(validarTroca(d, IDS_PERIODOS, "t1", "A", "B", { escopo: "bloco" }).ok).toBe(true);
  });
  it("trocar M3 para dar a A a operação que ele faz em T1 → PROIBIDO; trocar entre operações distintas → permitido", () => {
    const d = [L("m3", "A", "Z", "mA"), L("t1", "A", "Em", "mB"), L("m3", "B", "Em", "mC"), L("t1", "B", "Z", "mD")];
    expect(validarTroca(d, IDS_PERIODOS, "m3", "A", "B", R).ok).toBe(false);
    const d2 = [L("m3", "A", "Z", "mA"), L("t1", "A", "Y", "mB"), L("m3", "B", "W", "mC"), L("t1", "B", "X", "mD")];
    expect(validarTroca(d2, IDS_PERIODOS, "m3", "A", "B", R).ok).toBe(true);
  });
  it("violação antiga da ponte (plano já gravado) e alheia à troca não bloqueia; troca em T2 não olha a ponte; T3 → M1 não existe no mesmo dia", () => {
    const d = [L("m3", "A", "Em", "mA"), L("t1", "A", "Em", "mB"), L("t2", "A", "Z", "mC"), L("t2", "B", "Y", "mD")];
    expect(validarTroca(d, IDS_PERIODOS, "t2", "A", "B", R).ok).toBe(true);
  });
});

describe("estabilização e reatribuição respeitam a ponte", () => {
  const pools = [pool({ produto: "P", op: "Em", q: 900, maquinas: ["mA"] }), pool({ produto: "Q", op: "Et", q: 900, maquinas: ["mB"] })];
  const e = ponte(base1(2, pools));
  it("estabilizarPessoas não devolve a pessoa a M3→T1 repetido", () => {
    const antes = [linha("m3", "f01", "Em", "mA"), linha("m3", "f02", "Et", "mB")];
    // oficial: f01 continuaria em Em no T1 (custo 0), mas a ponte proíbe → f01 vai para Et
    const proposta = [linha("t1", "f01", "Em", "mA"), linha("t1", "f02", "Et", "mB")];
    const r = estabilizarPessoas(proposta, proposta, antes, e.slots, { escopo: "bloco", ponteM3T1: true });
    expect(r.estabilizou).toBe(true);
    expect(r.linhas.map((a) => `${a.funcionarioId}:${a.operacaoId}`).sort()).toEqual(["f01:Et", "f02:Em"]);
    // sem a ponte: o oficial permanece (nada a ajustar)
    expect(estabilizarPessoas(proposta, proposta, antes, e.slots, { escopo: "bloco" }).estabilizou).toBe(false);
  });
  it("reatribuirPessoasBloco: escolhe M3 já pensando em T1 (cadeia manhã+tarde) e zera bloco + ponte mantendo os postos", () => {
    const mk = (pid: string, ops: [string, string][]): AlocacaoEscala[] => ops.map(([f, op]) => linha(pid, f, op, op === "Em" ? "mA" : "mB"));
    // mesmos postos todos os períodos (Em+Et): M1 f01=Em,f02=Et; M2 f01=Et,f02=Em; M3 f01=Em,f02=Et (viola bloco); T1 f01=Em,f02=Et (viola ponte)
    const vig = [...mk("m1", [["f01", "Em"], ["f02", "Et"]]), ...mk("m2", [["f01", "Et"], ["f02", "Em"]]), ...mk("m3", [["f01", "Em"], ["f02", "Et"]]), ...mk("t1", [["f01", "Em"], ["f02", "Et"]])];
    // com 2 operações e 2 pessoas, M3 só tem solução se a manhã for [Em,Et,?]... M3 repete sempre (2 pessoas, 2 ops, 3 períodos) → sem solução
    expect(reatribuirPessoasBloco(vig, [], e.slots, { escopo: "bloco", ponteM3T1: true })).toBeNull();
    // com M3 vazio de uma das operações a ponte é decisiva: M3 só Et (f01/f02 revezam), T1 Em+Et
    const vig2 = [...mk("m1", [["f01", "Em"], ["f02", "Et"]]), ...mk("m2", [["f01", "Et"], ["f02", "Em"]]), ...mk("t1", [["f01", "Em"], ["f02", "Et"]])];
    const r = reatribuirPessoasBloco(vig2, [], e.slots, { escopo: "bloco", ponteM3T1: true });
    expect(r).not.toBeNull();
    expect(repeticoesPorBloco(r!.linhas, e.slots, undefined, true)).toEqual([]);
  });
});

describe("fluxo ativo (planejarComFluxo) com a ponte", () => {
  it("nenhum plano viola (bloco + ponte); verificador independente limpo; flag desligada = mesmo plano de hoje", () => {
    const pools = [
      pool({ produto: "P", etapa: "P-e1", op: "Et", ordem: 1, q: 500, maquinas: ["m1", "m2"] }),
      pool({ produto: "P", etapa: "P-e2", op: "Em", ordem: 2, q: 500, maquinas: ["m3"] }),
      pool({ produto: "Q", etapa: "Q-e1", op: "Mo", ordem: 1, q: 400, maquinas: ["m4"] }),
    ];
    const base = ponte(entrada({ funcionarios: equipe(6), pools }, [D1, D2]));
    const agoraMs = base.slots[0].inicioMs - 3600_000;
    const r = planejarComFluxo(base, { apontamentos: [], agoraMs, planoVigente: [] });
    expect(verificarRestricoesDuras(r.entradaFluxo, r.resultado.alocacoes)).toEqual([]);
    expect(reps(base, r.resultado.alocacoes, true)).toEqual([]);
    const off = planejarComFluxo({ ...base, revezamentoPonteM3T1: false }, { apontamentos: [], agoraMs, planoVigente: [] });
    const ref = planejarComFluxo(bloco(entrada({ funcionarios: equipe(6), pools }, [D1, D2])), { apontamentos: [], agoraMs, planoVigente: [] });
    expect(JSON.stringify(off.resultado.alocacoes)).toBe(JSON.stringify(ref.resultado.alocacoes));
  });
});

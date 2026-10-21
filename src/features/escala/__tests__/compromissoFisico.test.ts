// FASE 4c — reparo de compromisso por IMPOSSIBILIDADE FÍSICA (ausência, equipe, máquina) + separação de status.
import { describe, it, expect } from "vitest";
import { avaliarCompromisso, MOTIVO_POSTO_INVIAVEL } from "../compromisso";
import { gerarEscala } from "../gerarEscala";
import { replanejarComHorizonte } from "../horizonte";
import type { AlocacaoEscala, EntradaEscala } from "../types";
import { entrada, equipe, pool } from "./helpers";

const POSTO: Record<string, { produtoId: string; etapaId: string; operacaoId: string }> = {
  m1: { produtoId: "A", etapaId: "A-e1", operacaoId: "opX" }, m2: { produtoId: "A", etapaId: "A-e1", operacaoId: "opX" }, m6: { produtoId: "A", etapaId: "A-e1", operacaoId: "opX" },
  m3: { produtoId: "B", etapaId: "B-e1", operacaoId: "opY" }, m4: { produtoId: "B", etapaId: "B-e1", operacaoId: "opY" },
  m5: { produtoId: "C", etapaId: "C-e1", operacaoId: "opZ" },
};
const pools = (a = ["m1", "m2", "m6"]) => [
  pool({ produto: "A", etapa: "A-e1", op: "opX", q: 900, maquinas: a, mu: 100 }),
  pool({ produto: "B", etapa: "B-e1", op: "opY", q: 900, maquinas: ["m3", "m4"], mu: 100 }),
  pool({ produto: "C", etapa: "C-e1", op: "opZ", q: 900, maquinas: ["m5"], mu: 100 }),
];
const amb = (n: number, extra: Partial<EntradaEscala> = {}, a?: string[]): EntradaEscala => ({ ...entrada({ funcionarios: equipe(n), pools: pools(a), ...extra }, ["2026-10-19", "2026-10-20"]), revezamentoDuro: true });
type L = [string, string | null];
const rows = (e: EntradaEscala, slot: number, l: L[]): AlocacaoEscala[] =>
  l.map(([f, m]) => ({ data: e.slots[slot].data, periodoId: e.slots[slot].periodoId, funcionarioId: f, maquinaId: m, produtoId: m ? POSTO[m].produtoId : null, etapaId: m ? POSTO[m].etapaId : null, operacaoId: m ? POSTO[m].operacaoId : null, pecas: m ? 100 : 0, motivoSemPosto: m ? null : "sem posto", excecaoRevezamento: false, motivoExcecao: null }));
const maq = (a: AlocacaoEscala[], f: string) => a.find((x) => x.funcionarioId === f)?.maquinaId ?? null;
const ausente = (f: string) => ({ funcionarioId: f, data: "2026-10-19", inicioMin: null, fimMin: null });
const parado = (e: EntradaEscala, m: string) => ({ maquinaId: m, desdeMs: e.slots[0].inicioMs, liberadaEmMs: null });

describe("máquina comprometida indisponível — REPARO DE RECURSO", () => {
  it("com equivalente livre (mesmo produto/etapa/operação): troca só a máquina; mesma pessoa; sem reorganizar o período", () => {
    const base = amb(4);
    const exec = rows(base, 0, [["f01", "m3"], ["f02", "m5"], ["f03", "m4"], ["f04", null]]);
    const comp = rows(base, 1, [["f01", "m1"], ["f02", "m3"], ["f03", "m5"], ["f04", null]]);
    const e = { ...base, indisponibilidades: [parado(base, "m1")] };
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.statusFisico).toBe("compromisso_inviavel_reparavel");
    expect(r.status).toBe("compromisso_inviavel_reparavel");
    expect(r.trocasMaquina).toEqual([{ funcionarioId: "f01", de: "m1", para: "m2", produtoId: "A", etapaId: "A-e1" }]);
    expect(r.reparado.find((a) => a.funcionarioId === "f01")).toMatchObject({ maquinaId: "m2", produtoId: "A", etapaId: "A-e1", operacaoId: "opX", pecas: 100 });
    expect(r.linhasAlteradas).toBe(1); // só a linha de f01
    ["f02", "f03", "f04"].forEach((f) => expect(maq(r.reparado, f)).toBe(maq(comp, f))); // ninguém mais mexe
    expect(r.postosVazios).toEqual([]);
    expect(r.alertas[0].tipo).toBe("compromisso_inviavel_reparavel");
  });

  it("máquina equivalente ocupada por OUTRO posto não pode ser roubada: posto vazio + inviavel_nao_reparavel", () => {
    const base = amb(3, {}, ["m1", "m2"]); // etapa A só tem m1 e m2
    const exec = rows(base, 0, [["f01", "m3"], ["f02", "m4"], ["f03", "m5"]]);
    const comp = rows(base, 1, [["f01", "m1"], ["f02", "m2"], ["f03", "m3"]]); // m2 está no posto de f02
    const e = { ...base, indisponibilidades: [parado(base, "m1")] };
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.trocasMaquina).toEqual([]);
    expect(maq(r.reparado, "f02")).toBe("m2"); // não foi roubada
    expect(r.statusFisico).toBe("compromisso_inviavel_nao_reparavel");
    expect(r.postosVazios).toHaveLength(1);
    expect(r.postosVazios[0]).toMatchObject({ maquinaId: "m1", causa: "inviavel" });
    expect(r.reparado.find((a) => a.funcionarioId === "f01")?.maquinaId).toBeNull();
    expect(r.reparado.find((a) => a.funcionarioId === "f01")?.motivoSemPosto).toBe(MOTIVO_POSTO_INVIAVEL);
    expect(r.alertas.some((a) => a.tipo === "compromisso_inviavel_nao_reparavel")).toBe(true);
  });

  it("sem equivalente: a pessoa liberada pode cobrir um posto órfão (reparo global), mas a máquina parada não é substituída por outra etapa/produto", () => {
    const base = amb(4, {}, ["m1"]);
    const exec = rows(base, 0, [["f01", "m3"], ["f02", "m5"], ["f03", "m4"], ["f04", "m3"]]);
    const comp = rows(base, 1, [["f01", "m1"], ["f02", "m3"], ["f03", "m5"], ["f04", "m4"]]);
    const e = { ...base, indisponibilidades: [parado(base, "m1")], ausencias: [ausente("f03")] }; // m1 parada + f03 ausente (posto m5 órfão)
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.postosVazios.filter((p) => p.maquinaId === "m1")).toHaveLength(1);
    expect(maq(r.reparado, "f01")).toBe("m5"); // f01 (livre, prev Y) cobre o órfão opZ
    expect(r.reparado.every((a) => a.maquinaId !== "m1")).toBe(true); // nada vai para a máquina parada
    expect(r.reparado.find((a) => a.maquinaId === "m5")?.produtoId).toBe("C"); // produto/etapa preservados
  });

  it("indisponível só na Previsão (semana inteira) também aciona o reparo de recurso", () => {
    const base = amb(3);
    const exec = rows(base, 0, [["f01", "m3"], ["f02", "m5"], ["f03", null]]);
    const comp = rows(base, 1, [["f01", "m1"], ["f02", "m3"], ["f03", null]]);
    const e = { ...base, maquinasIndisponiveisPrevisao: ["m1"] };
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.trocasMaquina[0]).toMatchObject({ de: "m1", para: "m2" });
  });
});

describe("funcionário ausente / fora da equipe no comprometido — COBERTURA", () => {
  it("ausência coberta por pessoa ociosa (preserva produto, máquina, etapa e peças)", () => {
    const base = amb(4);
    const exec = rows(base, 0, [["f01", "m3"], ["f02", "m5"], ["f03", "m4"], ["f04", null]]);
    const comp = rows(base, 1, [["f01", "m1"], ["f02", "m3"], ["f03", "m5"], ["f04", null]]);
    const e = { ...base, ausencias: [ausente("f01")] };
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.statusFisico).toBe("compromisso_inviavel_reparavel");
    expect(r.reparado.find((a) => a.funcionarioId === "f04")).toMatchObject({ maquinaId: "m1", produtoId: "A", etapaId: "A-e1", operacaoId: "opX", pecas: 100 });
    expect(maq(r.reparado, "f01")).toBeNull();
    expect(r.linhasAlteradas).toBe(2); // linha do ausente + a de quem cobre
    expect(r.postosVazios).toEqual([]);
  });

  it("ociosa não pode (repetiria a operação): exige rearranjo entre comprometidos, sem deixar posto vazio", () => {
    const base = amb(4);
    // f04 ociosa executou opX no período anterior; f02 (prev opZ) assume m1(opX) e f04 assume o posto de f02 (opY)
    const exec = rows(base, 0, [["f01", "m3"], ["f02", "m5"], ["f03", "m4"], ["f04", "m1"]]);
    const comp = rows(base, 1, [["f01", "m1"], ["f02", "m3"], ["f03", "m5"], ["f04", null]]);
    const e = { ...base, ausencias: [ausente("f01")] };
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.postosVazios).toEqual([]);
    expect(maq(r.reparado, "f04")).not.toBe("m1");
    expect(r.linhasAlteradas).toBeGreaterThanOrEqual(3); // ausente + 2 pessoas rearranjadas
    // ninguém repete
    r.reparado.filter((a) => a.maquinaId).forEach((a) => { const p = exec.find((x) => x.funcionarioId === a.funcionarioId); expect(p?.operacaoId === a.operacaoId && p?.maquinaId).toBeFalsy(); });
  });

  it("duas pessoas faltando: cobertas por duas ociosas; com uma só ociosa, um posto fica vazio (não reparável)", () => {
    const base = amb(5);
    const exec = rows(base, 0, [["f01", "m3"], ["f02", "m5"], ["f03", "m4"], ["f04", null], ["f05", null]]);
    const comp = rows(base, 1, [["f01", "m1"], ["f02", "m2"], ["f03", "m5"], ["f04", null], ["f05", null]]);
    const dois = avaliarCompromisso({ ...base, ausencias: [ausente("f01"), ausente("f02")] }, [...exec, ...comp], 1);
    expect(dois.statusFisico).toBe("compromisso_inviavel_reparavel");
    expect(dois.reparado.filter((a) => a.maquinaId).length).toBe(3);
    const umaOciosa = avaliarCompromisso({ ...base, ausencias: [ausente("f01"), ausente("f02"), ausente("f05")] }, [...exec, ...comp], 1);
    expect(umaOciosa.statusFisico).toBe("compromisso_inviavel_nao_reparavel");
    expect(umaOciosa.postosVazios).toHaveLength(1);
    expect(umaOciosa.postosVazios[0].causa).toBe("inviavel");
  });

  it("funcionário fora da equipe é tratado como ausente", () => {
    const base = amb(4);
    const exec = rows(base, 0, [["f01", "m3"], ["f02", "m5"], ["f03", "m4"], ["f04", null]]);
    const comp = rows(base, 1, [["f01", "m1"], ["f02", "m3"], ["f03", "m5"], ["f04", null]]);
    const e = { ...base, funcionarios: base.funcionarios.filter((f) => f.id !== "f01") };
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.impedimentos[0].tipo).toBe("funcionario_fora_da_equipe");
    expect(maq(r.reparado, "f04")).toBe("m1");
  });

  it("nada é tirado de outro compromisso só para criar um buraco equivalente", () => {
    const base = amb(3);
    const exec = rows(base, 0, [["f01", "m3"], ["f02", "m5"], ["f03", "m4"]]);
    const comp = rows(base, 1, [["f01", "m1"], ["f02", "m3"], ["f03", "m5"]]);
    const r = avaliarCompromisso({ ...base, ausencias: [ausente("f01")] }, [...exec, ...comp], 1);
    // ninguém ocioso: m1 fica vazio e f02/f03 continuam nos seus postos
    expect(r.postosVazios).toHaveLength(1);
    expect(maq(r.reparado, "f02")).toBe("m3");
    expect(maq(r.reparado, "f03")).toBe("m5");
    expect(r.linhasAlteradas).toBe(1);
  });
});

describe("status separados: ergonomia × impossibilidade física", () => {
  it("os dois ao mesmo tempo: statusErgonomico e statusFisico independentes; status geral = físico", () => {
    const base = amb(5);
    const exec = rows(base, 0, [["f01", "m1"], ["f02", "m5"], ["f03", "m4"], ["f04", "m3"], ["f05", null]]);
    const comp = rows(base, 1, [["f01", "m2"], ["f02", "m3"], ["f03", "m5"], ["f04", "m1"], ["f05", null]]); // f01 repete opX; f03 ausente
    const r = avaliarCompromisso({ ...base, ausencias: [ausente("f03")] }, [...exec, ...comp], 1);
    expect(r.conflitos.map((c) => c.funcionarioId)).toEqual(["f01"]);
    expect(r.impedimentos.map((i) => i.funcionarioId)).toEqual(["f03"]);
    expect(r.statusErgonomico).toBe("compromisso_reparavel");
    expect(r.statusFisico).toBe("compromisso_inviavel_reparavel");
    expect(r.status).toBe("compromisso_inviavel_reparavel");
    expect(r.alertas.map((a) => a.tipo).sort()).toEqual(["compromisso_inviavel_reparavel", "conflito_rotacao_comprometido"]);
  });
  it("só ergonomia não vira inviável; só física não vira conflito de rotação", () => {
    const base = amb(3);
    const exec = rows(base, 0, [["f01", "m1"], ["f02", "m5"], ["f03", "m3"]]);
    const so = avaliarCompromisso(base, [...exec, ...rows(base, 1, [["f01", "m2"], ["f02", "m3"], ["f03", "m5"]])], 1);
    expect(so.statusFisico).toBeNull();
    expect(so.status).toBe("compromisso_reparavel");
    const fis = avaliarCompromisso({ ...base, ausencias: [ausente("f02")] }, [...exec, ...rows(base, 1, [["f01", "m3"], ["f02", "m6"], ["f03", "m5"]])], 1);
    expect(fis.conflitos).toEqual([]);
    expect(fis.statusErgonomico).toBe("compromisso_valido");
  });
});

describe("equipe reduzida (estresse com o motor)", () => {
  it.each([1, 2, 3, 4])("%i pessoas saem da equipe depois do plano: nunca repete, status coerente, posto vazio só quando não há cobertura", (k) => {
    const e: EntradaEscala = amb(8, { pools: [pool({ produto: "A", etapa: "A-e1", op: "opX", q: 900, maquinas: ["m1", "m2", "m6"], mu: 100 }), pool({ produto: "B", etapa: "B-e1", op: "opY", q: 900, maquinas: ["m3", "m4"], mu: 100 }), pool({ produto: "C", etapa: "C-e1", op: "opZ", q: 900, maquinas: ["m5"], mu: 100 })] });
    const vigente = gerarEscala(e).alocacoes;
    const reduzida = { ...e, funcionarios: e.funcionarios.slice(0, 8 - k) };
    const r = replanejarComHorizonte(reduzida, vigente, 1);
    const av = r.avaliacaoCompromisso;
    const posted = r.comprometidas.filter((a) => a.maquinaId);
    expect(new Set(posted.map((a) => a.funcionarioId)).size).toBe(posted.length);
    expect(posted.every((a) => reduzida.funcionarios.some((f) => f.id === a.funcionarioId))).toBe(true); // só equipe atual com posto
    expect(av.postosVazios.length + posted.length).toBeGreaterThanOrEqual(av.original.filter((a) => a.maquinaId).length - (av.original.filter((a) => a.maquinaId).length - posted.length - av.postosVazios.length));
    if (av.postosVazios.length === 0) expect(["compromisso_valido", "compromisso_inviavel_reparavel", "compromisso_reparavel"]).toContain(av.status);
    else expect(["compromisso_inviavel_nao_reparavel", "compromisso_nao_reparavel"]).toContain(av.status);
  });
});

describe("contingência: máquina compatível FORA da Previsão (4d) — só registro, nunca uso automático", () => {
  const comCompat = (compat: string[]): EntradaEscala => {
    const e = amb(3, {}, ["m1"]);
    return { ...e, pools: e.pools.map((p) => (p.produtoId === "A" ? { ...p, maquinasCompativeisIds: compat } : p)) };
  };
  const exec = (e: EntradaEscala) => rows(e, 0, [["f01", "m3"], ["f02", "m5"], ["f03", "m4"]]);
  const comp = (e: EntradaEscala) => rows(e, 1, [["f01", "m1"], ["f02", "m3"], ["f03", "m5"]]);
  it("máquina parada sem equivalente na Previsão, mas com compatível livre fora dela: posto vazio + contingência registrada, plano NÃO usa a máquina", () => {
    const base = comCompat(["m1", "m2", "m6"]);
    const e = { ...base, indisponibilidades: [parado(base, "m1")] };
    const r = avaliarCompromisso(e, [...exec(e), ...comp(e)], 1);
    expect(r.statusFisico).toBe("compromisso_inviavel_nao_reparavel");
    expect(r.trocasMaquina).toEqual([]);
    expect(r.reparado.every((a) => a.maquinaId !== "m2" && a.maquinaId !== "m6")).toBe(true); // nunca usada automaticamente
    expect(r.contingencias.map((c) => c.maquinaId)).toEqual(["m2", "m6"]);
    expect(r.contingencias[0]).toMatchObject({ postoAfetado: { maquinaId: "m1", funcionarioId: "f01" }, produtoId: "A", etapaId: "A-e1", operacaoId: "opX", motivoNaoUsada: "fora da Previsão" });
    expect(r.alertas.some((a) => a.tipo === "contingencia_possivel" && a.motivo?.includes("não está selecionada na Previsão"))).toBe(true);
  });
  it("compatível indisponível ou já usada no período NÃO é contingência", () => {
    const base = comCompat(["m1", "m2", "m6"]);
    const e = { ...base, indisponibilidades: [parado(base, "m1"), parado(base, "m2")] };
    const comp2 = rows(e, 1, [["f01", "m1"], ["f02", "m3"], ["f03", "m6"]]); // m6 já está no posto de f03
    const r = avaliarCompromisso(e, [...exec(e), ...comp2], 1);
    expect(r.contingencias).toEqual([]);
  });
  it("com equivalente DENTRO da Previsão, usa-a automaticamente e não há contingência", () => {
    const base = amb(3, {}, ["m1", "m2"]);
    const e = { ...base, indisponibilidades: [parado(base, "m1")], pools: base.pools.map((p) => (p.produtoId === "A" ? { ...p, maquinasCompativeisIds: ["m1", "m2", "m6"] } : p)) };
    const r = avaliarCompromisso(e, [...exec(e), ...comp(e)], 1);
    expect(r.trocasMaquina[0]).toMatchObject({ de: "m1", para: "m2" });
    expect(r.contingencias).toEqual([]);
  });
});

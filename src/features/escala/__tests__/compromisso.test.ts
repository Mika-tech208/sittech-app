// FASE 4b (extensão) — REVEZAMENTO DURO > PERÍODO COMPROMETIDO: reparo mínimo do comprometido quando a execução real o torna inválido.
import { describe, it, expect } from "vitest";
import { avaliarCompromisso, MOTIVO_CONFLITO_ERGONOMICO } from "../compromisso";
import { gerarEscala } from "../gerarEscala";
import { hashAlocacoes, replanejarComHorizonte } from "../horizonte";
import type { AlocacaoEscala, EntradaEscala } from "../types";
import { entrada, equipe, pool } from "./helpers";

const POSTO: Record<string, { produtoId: string; etapaId: string; operacaoId: string }> = {
  m1: { produtoId: "A", etapaId: "A-e1", operacaoId: "opX" },
  m2: { produtoId: "A", etapaId: "A-e1", operacaoId: "opX" },
  m3: { produtoId: "B", etapaId: "B-e1", operacaoId: "opY" },
  m4: { produtoId: "B", etapaId: "B-e1", operacaoId: "opY" },
  m5: { produtoId: "C", etapaId: "C-e1", operacaoId: "opZ" },
};
const pools = () => [
  pool({ produto: "A", etapa: "A-e1", op: "opX", q: 900, maquinas: ["m1", "m2"], mu: 100 }),
  pool({ produto: "B", etapa: "B-e1", op: "opY", q: 900, maquinas: ["m3", "m4"], mu: 100 }),
  pool({ produto: "C", etapa: "C-e1", op: "opZ", q: 900, maquinas: ["m5"], mu: 100 }),
];
const DIAS = ["2026-10-19", "2026-10-20"];
const amb = (n: number, extra: Partial<EntradaEscala> = {}) => ({ ...entrada({ funcionarios: equipe(n), pools: pools(), ...extra }, DIAS), revezamentoDuro: true });
type L = [string, string | null, ("manual" | "auto")?]; // [funcionário, máquina|null, origem]
const rows = (e: EntradaEscala, slot: number, l: L[]): AlocacaoEscala[] =>
  l.map(([f, m, o]) => ({
    data: e.slots[slot].data, periodoId: e.slots[slot].periodoId, funcionarioId: f, maquinaId: m,
    produtoId: m ? POSTO[m].produtoId : null, etapaId: m ? POSTO[m].etapaId : null, operacaoId: m ? POSTO[m].operacaoId : null,
    pecas: m ? 100 : 0, motivoSemPosto: m ? null : "sem posto", excecaoRevezamento: false, motivoExcecao: null, ...(o ? { origem: o } : {}),
  }));
const maq = (a: AlocacaoEscala[], f: string) => a.find((x) => x.funcionarioId === f)?.maquinaId ?? null;
const repete = (e: EntradaEscala, anterior: AlocacaoEscala[], atual: AlocacaoEscala[]) =>
  atual.filter((a) => a.maquinaId && anterior.some((p) => p.funcionarioId === a.funcionarioId && p.maquinaId && p.operacaoId === a.operacaoId && p.data === a.data)).length;

describe("compromisso — detecção (revezamento duro > comprometido)", () => {
  it("sem conflito: compromisso_valido, nada muda", () => {
    const e = amb(3);
    const exec = rows(e, 0, [["f01", "m1"], ["f02", "m3"], ["f03", "m5"]]);
    const comp = rows(e, 1, [["f01", "m3"], ["f02", "m5"], ["f03", "m1"]]);
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.status).toBe("compromisso_valido");
    expect(r.reparado).toEqual(comp);
    expect(r.linhasAlteradas).toBe(0);
  });
  it("execução real cria repetição: conflito detectado com pessoa, operação anterior, operação repetida e posto", () => {
    const e = amb(3);
    const exec = rows(e, 0, [["f01", "m1"], ["f02", "m5"], ["f03", "m3"]]);
    const comp = rows(e, 1, [["f01", "m2"], ["f02", "m3"], ["f03", "m5"]]); // f01 executou opX e o comprometido manda opX de novo
    const r = avaliarCompromisso(e, [...exec, ...comp], 1, { reparar: false });
    expect(r.status).toBe("conflito_rotacao_comprometido");
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({ funcionarioId: "f01", operacaoAnterior: "opX", operacaoRepetida: "opX" });
    expect(r.conflitos[0].posto.maquinaId).toBe("m2");
    expect(r.conflitos[0].periodoAnterior.periodoId).toBe("m1");
    expect(r.reparado).toEqual(comp); // só detectar não mexe
  });
  it("M3 executado diferente torna o T1 comprometido inválido (M3→T1 conta)", () => {
    const e = amb(3);
    const exec = rows(e, 2, [["f01", "m3"], ["f02", "m1"], ["f03", "m5"]]); // M3
    const comp = rows(e, 3, [["f01", "m4"], ["f02", "m5"], ["f03", "m3"]]); // T1: f01 repete opY
    const r = avaliarCompromisso(e, [...exec, ...comp], 3);
    expect(r.conflitos.map((c) => c.funcionarioId)).toEqual(["f01"]);
    expect(r.status).toBe("compromisso_reparavel");
    expect(repete(e, exec, r.reparado)).toBe(0);
  });
  it("dia seguinte respeita o reset: T3 → M1 do outro dia pode repetir operação", () => {
    const e = amb(3);
    const exec = rows(e, 5, [["f01", "m1"], ["f02", "m3"], ["f03", "m5"]]); // T3 de 19/10
    const comp = rows(e, 6, [["f01", "m2"], ["f02", "m4"], ["f03", "m5"]]); // M1 de 20/10 repete as operações
    const r = avaliarCompromisso(e, [...exec, ...comp], 6);
    expect(r.status).toBe("compromisso_valido");
    expect(r.reparado).toEqual(comp);
  });
});

describe("compromisso — reparo mínimo", () => {
  it("uma única troca (2 linhas) basta; postos preservados", () => {
    const e = amb(3);
    const exec = rows(e, 0, [["f01", "m1"], ["f02", "m5"], ["f03", "m3"]]);
    const comp = rows(e, 1, [["f01", "m2"], ["f02", "m3"], ["f03", "m5"]]);
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.status).toBe("compromisso_reparavel");
    expect(r.linhasAlteradas).toBe(2);
    expect(r.trocas).toHaveLength(2);
    expect(r.postosPreservados).toBe(true);
    expect(r.postosVazios).toEqual([]);
    expect(repete(e, exec, r.reparado)).toBe(0);
    expect(r.reparado.map((a) => a.maquinaId).sort()).toEqual(comp.map((a) => a.maquinaId).sort()); // mesmos postos
    expect(r.alertas[0].tipo).toBe("conflito_rotacao_comprometido");
  });

  it("dois conflitos independentes exigem duas trocas (4 linhas)", () => {
    const e = amb(4);
    const exec = rows(e, 0, [["f01", "m1"], ["f02", "m2"], ["f03", "m3"], ["f04", "m4"]]);
    const comp = rows(e, 1, [["f01", "m2"], ["f02", "m1"], ["f03", "m4"], ["f04", "m3"]]); // 4 repetições
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.conflitos).toHaveLength(4);
    expect(r.status).toBe("compromisso_reparavel");
    expect(r.linhasAlteradas).toBe(4);
    expect(repete(e, exec, r.reparado)).toBe(0);
  });

  it("a primeira troca possível cria conflito em outra pessoa e é rejeitada", () => {
    const e = amb(3);
    // f01 repete opX em m1. Colega f02 (ordem alfabética primeiro) executou opX: assumir m1 repetiria. f03 serve.
    const exec = rows(e, 0, [["f01", "m2"], ["f02", "m1"], ["f03", "m3"]]);
    const comp = rows(e, 1, [["f01", "m1"], ["f02", "m3"], ["f03", "m5"]]);
    const r = avaliarCompromisso(e, [...exec, ...comp], 1, { reparar: false });
    const alt = r.conflitos[0].alternativas;
    expect(alt.find((a) => a.com === "f02")).toMatchObject({ viavel: false });
    expect(alt.find((a) => a.com === "f02")?.motivo).toContain("repetiria");
    expect(alt.find((a) => a.com === "f03")?.viavel).toBe(true);
    const rep = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(repete(e, exec, rep.reparado)).toBe(0);
    expect(rep.trocas.map((t) => t.funcionarioId).sort()).toEqual(["f01", "f03"]); // f02 (rejeitada) intacta
    expect(maq(rep.reparado, "f02")).toBe("m3");
  });

  it("não altera quem não precisa: pessoas sem conflito e sem papel no reparo ficam intactas", () => {
    const e = amb(5);
    const exec = rows(e, 0, [["f01", "m1"], ["f02", "m5"], ["f03", "m3"], ["f04", "m4"], ["f05", null]]);
    const comp = rows(e, 1, [["f01", "m2"], ["f02", "m3"], ["f03", "m5"], ["f04", "m1"], ["f05", null]]);
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.linhasAlteradas).toBe(2);
    ["f04", "f05"].forEach((f) => expect(maq(r.reparado, f)).toBe(maq(comp, f)));
    expect(r.reparado.find((a) => a.funcionarioId === "f05")).toEqual(comp.find((a) => a.funcionarioId === "f05"));
  });

  it("pessoa ociosa pode assumir o posto (mesmo nº de linhas) quando a troca entre alocados não existe", () => {
    const e = amb(3);
    // f01 e f02 ocupam as duas máquinas opX e ambos executaram opX; f03 ociosa e livre
    const exec = rows(e, 0, [["f01", "m1"], ["f02", "m2"], ["f03", null]]);
    const comp = rows(e, 1, [["f01", "m2"], ["f02", "m1"], ["f03", null]]);
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.status).toBe("compromisso_nao_reparavel"); // só f03 pode cobrir UM dos dois postos: o outro fica vazio
    expect(r.postosVazios).toHaveLength(1);
    expect(r.reparado.filter((a) => a.maquinaId).length).toBe(1);
    expect(maq(r.reparado, "f03")).not.toBeNull();
    expect(repete(e, exec, r.reparado)).toBe(0);
  });

  it("nenhuma solução válida: postos vazios, alerta crítico com a mensagem e jamais repetição", () => {
    const e = amb(2);
    const exec = rows(e, 0, [["f01", "m1"], ["f02", "m2"]]);
    const comp = rows(e, 1, [["f01", "m2"], ["f02", "m1"]]);
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.status).toBe("compromisso_nao_reparavel");
    expect(r.postosPreservados).toBe(false);
    expect(r.postosVazios).toHaveLength(2);
    expect(r.reparado.every((a) => a.maquinaId === null && a.motivoSemPosto === MOTIVO_CONFLITO_ERGONOMICO)).toBe(true);
    const al = r.alertas.find((a) => a.tipo === "compromisso_nao_reparavel");
    expect(al?.motivo).toContain("Conflito ergonômico no período M2");
    expect(al?.motivo).toContain("A execução real do M1 tornou a escala comprometida inválida");
    expect(al?.motivo).toContain("Não existe redistribuição válida que mantenha todos os postos sem repetição de operação");
    expect(al?.motivo).toContain("f01: executou opX"); // funcionário, operação anterior, posto, alternativas
    expect(repete(e, exec, r.reparado)).toBe(0);
  });

  it("colega ausente nunca é usado como substituto (e a linha dele deixa de ser posto)", () => {
    const base = amb(3);
    const exec = rows(base, 0, [["f01", "m1"], ["f02", "m5"], ["f03", "m3"]]);
    const comp = rows(base, 1, [["f01", "m2"], ["f02", "m3"], ["f03", "m5"]]);
    const e = { ...base, ausencias: [{ funcionarioId: "f02", data: "2026-10-19", inicioMin: null, fimMin: null }] };
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.conflitos[0].alternativas.find((a) => a.com === "f02")?.motivo).toBe("ausente no período");
    expect(maq(r.reparado, "f02")).toBeNull(); // ausente não pode manter posto
    expect(r.reparado.filter((a) => a.maquinaId).every((a) => a.funcionarioId !== "f02")).toBe(true);
    expect(repete(e, exec, r.reparado)).toBe(0);
  });

  it("linha manual só muda em último caso (equivalentes: altera a automática)", () => {
    const e = amb(3);
    const exec = rows(e, 0, [["f01", "m1"], ["f02", "m5"], ["f03", "m3"]]);
    const comp = rows(e, 1, [["f01", "m2"], ["f02", "m3", "manual"], ["f03", "m5"]]);
    const r = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(r.linhasAlteradas).toBe(2);
    expect(r.reparado.find((a) => a.funcionarioId === "f02")).toEqual(comp.find((a) => a.funcionarioId === "f02")); // f02 (manual) intacta
  });

  it("determinístico: mesma entrada (em qualquer ordem de linhas) gera o mesmo reparo", () => {
    const e = amb(4);
    const exec = rows(e, 0, [["f01", "m1"], ["f02", "m2"], ["f03", "m3"], ["f04", "m5"]]);
    const comp = rows(e, 1, [["f01", "m2"], ["f02", "m4"], ["f03", "m1"], ["f04", "m3"]]);
    const a = avaliarCompromisso(e, [...exec, ...comp], 1);
    const b = avaliarCompromisso(e, [...[...comp].reverse(), ...[...exec].reverse()], 1);
    const c = avaliarCompromisso(e, [...exec, ...comp], 1);
    expect(hashAlocacoes(b.reparado)).toBe(hashAlocacoes(a.reparado));
    expect(hashAlocacoes(c.reparado)).toBe(hashAlocacoes(a.reparado));
  });

  it("propriedade (600 cenários): ótimo = força bruta (postos preservados, depois menos linhas); nunca repete; ausente intocado", () => {
    let seed = 20261021;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const MAQS = ["m1", "m2", "m3", "m4", "m5"];
    const OPS = ["opX", "opY", "opZ", null];
    for (let t = 0; t < 600; t++) {
      const n = 3 + Math.floor(rnd() * 4); // 3..6
      const ids = equipe(n).map((x) => x.id);
      const base = amb(n);
      const maqs = [...MAQS].sort(() => rnd() - 0.5);
      const execL: L[] = [];
      const compL: L[] = [];
      const prev: Record<string, string | null> = {};
      ids.forEach((f, i) => {
        const mc = i < maqs.length && rnd() < 0.85 ? maqs[i] : null;
        compL.push([f, mc, rnd() < 0.15 ? "manual" : "auto"]);
        const op = OPS[Math.floor(rnd() * OPS.length)];
        const me = op === null ? null : MAQS.find((m) => POSTO[m].operacaoId === op) ?? null;
        prev[f] = me ? POSTO[me].operacaoId : null;
        execL.push([f, me]);
      });
      const ausentes = ids.filter(() => rnd() < 0.12);
      const e = { ...base, ausencias: ausentes.map((f) => ({ funcionarioId: f, data: "2026-10-19", inicioMin: null, fimMin: null })) };
      const exec = rows(e, 0, execL);
      const comp = rows(e, 1, compL);
      const r = avaliarCompromisso(e, [...exec, ...comp], 1);
      // força bruta sobre pessoas utilizáveis × TODOS os postos (inclui os órfãos de ausentes)
      const uso = comp.filter((a) => !ausentes.includes(a.funcionarioId));
      const postos = comp.filter((a) => a.maquinaId);
      let melhor: [number, number] | null = null;
      const usado = new Set<number>();
      const rec = (i: number, vazios: number, mud: number) => {
        void vazios;
        if (i === uso.length) {
          const preenchidos = usado.size;
          const cand: [number, number] = [postos.length - preenchidos, mud];
          if (!melhor || cand[0] < melhor[0] || (cand[0] === melhor[0] && cand[1] < melhor[1])) melhor = cand;
          return;
        }
        const pe = uso[i];
        // ocioso
        rec(i + 1, 0, mud + (pe.maquinaId ? 1 : 0));
        postos.forEach((po, j) => {
          if (usado.has(j) || (prev[pe.funcionarioId] && prev[pe.funcionarioId] === po.operacaoId)) return;
          usado.add(j);
          rec(i + 1, 0, mud + (pe.maquinaId === po.maquinaId ? 0 : 1));
          usado.delete(j);
        });
      };
      rec(0, 0, 0);
      const comConflito = uso.some((a) => a.maquinaId && prev[a.funcionarioId] === a.operacaoId) || comp.some((a) => a.maquinaId && ausentes.includes(a.funcionarioId));
      if (!comConflito) {
        expect(r.status).toBe("compromisso_valido");
        continue;
      }
      const vaziosAlg = r.postosVazios.length;
      const mudAlg = r.reparado.filter((a, i) => !ausentes.includes(a.funcionarioId) && (a.maquinaId ?? "") !== (comp[i].maquinaId ?? "")).length;
      expect([vaziosAlg, mudAlg]).toEqual(melhor);
      // nunca repete, ausentes intactos
      expect(r.reparado.filter((a) => a.maquinaId && prev[a.funcionarioId] && prev[a.funcionarioId] === a.operacaoId && !ausentes.includes(a.funcionarioId))).toEqual([]);
      ausentes.forEach((f) => expect(r.reparado.find((a) => a.funcionarioId === f)?.maquinaId).toBeNull());
      // sem posto duplicado
      const ms = r.reparado.filter((a) => a.maquinaId).map((a) => a.maquinaId);
      expect(new Set(ms).size).toBe(ms.length);
      if (vaziosAlg === 0) expect(ms.sort()).toEqual(comp.filter((a) => a.maquinaId).map((a) => a.maquinaId).sort());
    }
  });
});

describe("compromisso — integração no replanejamento do horizonte (sombra)", () => {
  const e: EntradaEscala = { ...amb(8), pools: [...pools().slice(0, 2), pool({ produto: "C", etapa: "C-e1", op: "opZ", q: 900, maquinas: ["m5"], mu: 100 })] };
  const vigente = gerarEscala(e).alocacoes;
  const c = 1; // M2 fechado => M3 (slot 2) comprometido
  // a execução real do M2 foi diferente da planejada: alguém executou a operação que o M3 comprometido lhe dá de novo
  const comp3 = vigente.find((a) => a.data === e.slots[2].data && a.periodoId === e.slots[2].periodoId && a.maquinaId)!;
  const execModificada = vigente.map((a) => (a.funcionarioId === comp3.funcionarioId && a.periodoId === e.slots[c].periodoId && a.data === e.slots[c].data ? { ...a, maquinaId: comp3.maquinaId, produtoId: comp3.produtoId, etapaId: comp3.etapaId, operacaoId: comp3.operacaoId } : a));

  it("o repetido vira reparo mínimo (original preservado no snapshot) e a sombra replaneja o alterável a partir do reparado", () => {
    const r = replanejarComHorizonte(e, execModificada, c);
    expect(r.avaliacaoCompromisso.status).toBe("compromisso_reparavel");
    expect(r.snapshot.statusCompromisso).toBe("compromisso_reparavel");
    expect(r.snapshot.reparo.linhasAlteradas).toBeGreaterThanOrEqual(2);
    expect(r.snapshot.hashComprometido).not.toBe(r.snapshot.hashComprometidoReparado); // original ≠ reparado, ambos auditáveis
    expect(hashAlocacoes(r.comprometidasOriginais)).toBe(r.snapshot.hashComprometido);
    expect(r.alertas.some((a) => a.tipo === "conflito_rotacao_comprometido")).toBe(true);
    // rotação absoluta: executado(c) → reparado(c+1) → alterável(c+2) sem repetir
    const todo = [...r.congeladas, ...r.comprometidas, ...r.alteravel];
    const idx = (a: AlocacaoEscala) => e.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)!.indice;
    const por = new Map<string, AlocacaoEscala[]>();
    todo.forEach((a) => por.set(a.funcionarioId, [...(por.get(a.funcionarioId) ?? []), a]));
    let rep = 0;
    por.forEach((l) => { l.sort((x, y) => idx(x) - idx(y)); for (let i = 1; i < l.length; i++) if (idx(l[i]) >= c + 1 && idx(l[i]) - idx(l[i - 1]) === 1 && l[i].data === l[i - 1].data && l[i].maquinaId && l[i].operacaoId === l[i - 1].operacaoId) rep++; });
    expect(rep).toBe(0);
    // o reparo é mínimo: o comprometido mantém os postos
    expect(r.comprometidas.filter((a) => a.maquinaId).map((a) => a.maquinaId).sort()).toEqual(r.comprometidasOriginais.filter((a) => a.maquinaId).map((a) => a.maquinaId).sort());
  });
  it("sem conflito o reparo não existe: comprometido idêntico e idempotente", () => {
    const a = replanejarComHorizonte(e, vigente, c);
    expect(a.avaliacaoCompromisso.status).toBe("compromisso_valido");
    expect(a.snapshot.hashComprometidoReparado).toBe(a.snapshot.hashComprometido);
    const b = replanejarComHorizonte(e, vigente, c);
    expect(JSON.stringify(b.snapshot)).toBe(JSON.stringify(a.snapshot));
  });
  it("com repararRotacao=false só detecta (status conflito_rotacao_comprometido) e não mexe", () => {
    const r = replanejarComHorizonte(e, execModificada, c, { repararRotacao: false });
    expect(r.avaliacaoCompromisso.status).toBe("conflito_rotacao_comprometido");
    expect(r.snapshot.hashComprometidoReparado).toBe(r.snapshot.hashComprometido);
  });
});

// FASE 4b — HORIZONTE OPERACIONAL COMPROMETIDO (modo sombra): congelado ≤ c, comprometido c+1, alterável ≥ c+2.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import {
  alertaCompromissoInviavel,
  detectarCompromissoInviavel,
  hashAlocacoes,
  horizonteAposPeriodo,
  horizonteNoInstante,
  linhasQueOMotorMudariaNoComprometido,
  periodoAtual,
  replanejarComHorizonte,
} from "../horizonte";
import type { AlocacaoEscala, EntradaEscala, SlotEscala } from "../types";
import { checarInvariantes, entrada, equipe, pool } from "./helpers";

const duro = (e: EntradaEscala): EntradaEscala => ({ ...e, revezamentoDuro: true });
const rot = (s: SlotEscala[], i: number | null) => (i === null ? null : `${s[i].data.slice(8)}${s[i].periodoId}`);

// cenário com folga de gente e vários postos: o motor varia as operações entre os períodos
const pools = () => [
  pool({ produto: "A", op: "opX", q: 900, maquinas: ["m1", "m2"], mu: 100 }),
  pool({ produto: "B", op: "opY", q: 700, maquinas: ["m3", "m4"], mu: 100 }),
  pool({ produto: "C", op: "opZ", q: 500, maquinas: ["m5"], mu: 100 }),
];
const cenario = (dias: string[], n = 8, extra: Partial<EntradaEscala> = {}) => duro(entrada({ funcionarios: equipe(n), pools: pools(), ...extra }, dias));
const idxDe = (s: SlotEscala[], a: { data: string; periodoId: string }) => s.find((x) => x.data === a.data && x.periodoId === a.periodoId)!.indice;

const DIAS2 = ["2026-10-19", "2026-10-20"]; // seg, ter

describe("horizonte — regra do período comprometido (sequência M1→M2→M3→T1→T2→T3→M1…)", () => {
  const e = cenario(DIAS2);
  const s = e.slots;
  // [período fechado/atual, comprometido, primeiro alterável]
  const ESPERADO: [number, string, string][] = [
    [0, "19m2", "19m3"], // após M1: M2 comprometido, M3 alterável
    [1, "19m3", "19t1"], // após M2: M3, T1
    [2, "19t1", "19t2"], // após M3: T1, T2
    [3, "19t2", "19t3"], // após T1: T2, T3
    [4, "19t3", "20m1"], // após T2: T3 comprometido, M1 do dia seguinte alterável
    [5, "20m1", "20m2"], // após T3: M1 do dia seguinte comprometido, M2 alterável (o conceito NÃO zera na virada do dia)
  ];
  ESPERADO.forEach(([c, comp, alt]) => {
    it(`após ${rot(s, c)}: comprometido ${comp}, primeiro alterável ${alt}`, () => {
      const h = horizonteAposPeriodo(s, c);
      expect(rot(s, h.comprometido)).toBe(comp);
      expect(rot(s, h.primeiroAlteravel)).toBe(alt);
      expect(h.congeladoAte).toBe(c);
    });
  });

  it("modo antigo (só para comparar): o próximo período já é alterável", () => {
    const h = horizonteAposPeriodo(s, 2, "antigo");
    expect(h.comprometido).toBeNull();
    expect(rot(s, h.primeiroAlteravel)).toBe("19t1");
  });

  it("fim da semana: sem período à frente => sem comprometido / sem alterável (não inventa período)", () => {
    const n = s.length;
    expect(horizonteAposPeriodo(s, n - 2).primeiroAlteravel).toBeNull();
    expect(horizonteAposPeriodo(s, n - 2).comprometido).toBe(n - 1);
    expect(horizonteAposPeriodo(s, n - 1).comprometido).toBeNull();
  });

  it("fim de semana e dia não produtivo: sem período fantasma", () => {
    const sexSeg = cenario(["2026-10-23", "2026-10-26"]).slots; // sex, (sáb/dom fora), seg
    const h = horizonteAposPeriodo(sexSeg, 5); // sexta T3 encerrada
    expect(rot(sexSeg, h.comprometido)).toBe("26m1");
    expect(rot(sexSeg, h.primeiroAlteravel)).toBe("26m2");
    const feriado = cenario(["2026-10-19", "2026-10-21"]).slots; // terça desmarcada na Previsão
    const h2 = horizonteAposPeriodo(feriado, 5);
    expect(rot(feriado, h2.comprometido)).toBe("21m1");
    expect(rot(feriado, h2.primeiroAlteravel)).toBe("21m2");
    expect(feriado.every((x) => x.data !== "2026-10-20")).toBe(true);
  });
});

describe("horizonte — derivado do relógio (sem botão)", () => {
  const s = cenario(DIAS2).slots;
  it("antes de começar a semana: nada congelado; comprometido = primeiro período", () => {
    const h = horizonteNoInstante(s, s[0].inicioMs - 1);
    expect(periodoAtual(s, s[0].inicioMs - 1)).toBeNull();
    expect(h.congeladoAte).toBe(-1);
    expect(h.comprometido).toBe(0);
    expect(h.primeiroAlteravel).toBe(1);
  });
  it("durante o M2: M2 congelado (atual), M3 comprometido, T1 alterável", () => {
    const agora = s[1].inicioMs + 60_000;
    const h = horizonteNoInstante(s, agora);
    expect(h.atual).toBe(1);
    expect(rot(s, h.comprometido)).toBe("19m3");
    expect(rot(s, h.primeiroAlteravel)).toBe("19t1");
  });
  it("o período fechado pode ficar para trás do atual: vale o que for mais avançado (nunca altera período iniciado)", () => {
    const h = horizonteNoInstante(s, s[3].inicioMs + 1000, 1);
    expect(h.referencia).toBe(3);
    expect(rot(s, h.comprometido)).toBe("19t2");
  });
});

describe("replanejarComHorizonte — só o alterável muda; o comprometido é entrada congelada", () => {
  const e = cenario(DIAS2);
  const vigente = gerarEscala(e).alocacoes;

  it.each([0, 1, 2, 3, 4, 5])("após fechar o período %i: congelado e comprometido idênticos ao vigente; só ≥ primeiro alterável é proposto", (c) => {
    const r = replanejarComHorizonte(e, vigente, c);
    const h = r.horizonte;
    const doSlot = (i: number) => vigente.filter((a) => idxDe(e.slots, a) === i);
    expect(hashAlocacoes(r.comprometidas)).toBe(hashAlocacoes(doSlot(h.comprometido as number)));
    expect(r.congeladas.every((a) => idxDe(e.slots, a) <= c)).toBe(true);
    expect(r.alteravel.every((a) => idxDe(e.slots, a) >= (h.primeiroAlteravel as number))).toBe(true);
    expect(r.alteravel.some((a) => idxDe(e.slots, a) <= (h.comprometido as number))).toBe(false);
    expect(r.compromissoInviavel).toBeNull();
    if (r.resultado) expect(checarInvariantes(e, { alocacoes: [...r.congeladas, ...r.comprometidas, ...r.alteravel] })).toEqual([]);
  });

  it("sem período alterável (comprometido é o último): não roda o motor", () => {
    const r = replanejarComHorizonte(e, vigente, e.slots.length - 2);
    expect(r.resultado).toBeNull();
    expect(r.alteravel).toEqual([]);
    expect(r.comprometidas.length).toBeGreaterThan(0);
  });

  it("idempotente: recalcular repetidamente dá o mesmo resultado e o mesmo snapshot", () => {
    const a = replanejarComHorizonte(e, vigente, 2, { agoraMs: 123 });
    const b = replanejarComHorizonte(e, vigente, 2, { agoraMs: 123 });
    const c = replanejarComHorizonte(e, [...a.congeladas, ...a.comprometidas, ...a.alteravel], 2, { agoraMs: 123 }); // realimentando a própria saída
    expect(JSON.stringify(b.snapshot)).toBe(JSON.stringify(a.snapshot));
    expect(JSON.stringify(c.snapshot)).toBe(JSON.stringify(a.snapshot));
    expect(hashAlocacoes(c.alteravel)).toBe(hashAlocacoes(a.alteravel));
  });

  it("reprodutibilidade: o futuro alterável antigo NÃO é entrada — só o passado, o atual e o comprometido", () => {
    const outro = gerarEscala(cenario(DIAS2, 8, { pools: [pool({ produto: "Q", op: "opQ", q: 50, maquinas: ["m9"], mu: 10 })] })).alocacoes; // lixo no futuro
    const futuroTrocado = vigente.map((a) => (idxDe(e.slots, a) >= 4 ? { ...outro[0], data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId } : a));
    const r1 = replanejarComHorizonte(e, vigente, 2);
    const r2 = replanejarComHorizonte(e, futuroTrocado, 2);
    expect(r2.snapshot.hashAlteravel).toBe(r1.snapshot.hashAlteravel);
    expect(r2.snapshot.hashComprometido).toBe(r1.snapshot.hashComprometido);
    expect(r2.snapshot.hashCongelado).toBe(r1.snapshot.hashCongelado);
  });

  it("snapshot automático: período de referência, atual, comprometido, primeiro alterável, hashes e carimbo — sem ação manual", () => {
    const r = replanejarComHorizonte(e, vigente, 2, { agoraMs: 999 });
    expect(r.snapshot.referencia).toEqual({ slot: 2, data: "2026-10-19", periodoId: "m3" });
    expect(r.snapshot.comprometido).toEqual({ slot: 3, data: "2026-10-19", periodoId: "t1" });
    expect(r.snapshot.primeiroAlteravel).toEqual({ slot: 4, data: "2026-10-19", periodoId: "t2" });
    expect(r.snapshot.geradoEm).toBe(999);
    expect([r.snapshot.hashCongelado, r.snapshot.hashComprometido, r.snapshot.hashAlteravel].every((h) => /^[0-9a-f]{14}$/.test(h))).toBe(true);
    expect(new Set([r.snapshot.hashCongelado, r.snapshot.hashComprometido, r.snapshot.hashAlteravel]).size).toBe(3);
  });

  it("modo antigo altera o próximo período (é o que a 4b deixa de fazer)", () => {
    const r = replanejarComHorizonte(e, vigente, 2, { modo: "antigo" });
    expect(r.comprometidas).toEqual([]);
    expect(r.alteravel.some((a) => idxDe(e.slots, a) === 3)).toBe(true);
  });
});

describe("compromisso inviável — detecta, marca e alerta; NÃO recalcula em silêncio", () => {
  const e = cenario(DIAS2);
  const vigente = gerarEscala(e).alocacoes;
  const c = 1; // M2 fechado => M3 comprometido (slot 2)
  const comp = vigente.filter((a) => idxDe(e.slots, a) === 2 && a.maquinaId);
  const alvo = comp[0];

  it("funcionário do comprometido ficou ausente (falta nova)", () => {
    const e2 = { ...e, ausencias: [{ funcionarioId: alvo.funcionarioId, data: alvo.data, inicioMin: null, fimMin: null }] };
    const r = replanejarComHorizonte(e2, vigente, c);
    expect(r.compromissoInviavel?.itens).toEqual([{ tipo: "funcionario_ausente", funcionarioId: alvo.funcionarioId }]);
    expect(r.alertas.some((a) => a.tipo === "compromisso_inviavel" && a.periodoId === "m3")).toBe(true);
    // linha preservada exatamente como estava (nada de substituição silenciosa)
    expect(hashAlocacoes(r.comprometidas)).toBe(hashAlocacoes(vigente.filter((a) => idxDe(e.slots, a) === 2)));
    expect(r.alteravel.some((a) => idxDe(e.slots, a) <= 2)).toBe(false);
  });

  it("ausência parcial que NÃO cobre o período não torna inviável; a que cobre, sim", () => {
    const s = e.slots[2];
    const fora = { funcionarioId: alvo.funcionarioId, data: alvo.data, inicioMin: s.fimMin, fimMin: s.fimMin + 60 };
    const dentro = { funcionarioId: alvo.funcionarioId, data: alvo.data, inicioMin: s.inicioMin + 10, fimMin: s.inicioMin + 30 };
    expect(replanejarComHorizonte({ ...e, ausencias: [fora] }, vigente, c).compromissoInviavel).toBeNull();
    expect(replanejarComHorizonte({ ...e, ausencias: [dentro] }, vigente, c).compromissoInviavel).not.toBeNull();
  });

  it("funcionário retirado da equipe produtiva", () => {
    const e2 = { ...e, funcionarios: e.funcionarios.filter((f) => f.id !== alvo.funcionarioId) };
    const r = replanejarComHorizonte(e2, vigente, c);
    expect(r.compromissoInviavel?.itens.some((i) => i.tipo === "funcionario_fora_da_equipe" && i.funcionarioId === alvo.funcionarioId)).toBe(true);
  });

  it("máquina do comprometido ficou indisponível (parada / manutenção)", () => {
    const e2 = { ...e, indisponibilidades: [{ maquinaId: alvo.maquinaId as string, desdeMs: e.slots[1].inicioMs, liberadaEmMs: null }] };
    const r = replanejarComHorizonte(e2, vigente, c);
    expect(r.compromissoInviavel?.itens.some((i) => i.tipo === "maquina_indisponivel" && i.maquinaId === alvo.maquinaId)).toBe(true);
    expect(hashAlocacoes(r.comprometidas)).toBe(hashAlocacoes(vigente.filter((a) => idxDe(e.slots, a) === 2)));
    // o alterável (≥ T1) segue sendo replanejado sabendo da máquina parada
    expect(r.alteravel.filter((a) => a.maquinaId === alvo.maquinaId)).toEqual([]);
  });

  it("ausência em período congelado ou alterável NÃO gera compromisso inviável", () => {
    const congelado = vigente.find((a) => idxDe(e.slots, a) === 0 && a.maquinaId)!;
    const alteravel = vigente.find((a) => idxDe(e.slots, a) === 4 && a.maquinaId)!;
    const e2 = { ...e, ausencias: [congelado, alteravel].map((a) => ({ funcionarioId: a.funcionarioId, data: a.data, inicioMin: e.slots[a.periodoId === "m1" ? 0 : 4].inicioMin, fimMin: e.slots[a.periodoId === "m1" ? 0 : 4].fimMin })) };
    // a ausência em T2 afeta só o alterável (que o motor replaneja) — comprometido (M3) continua viável
    expect(replanejarComHorizonte(e2, vigente, c).compromissoInviavel).toBeNull();
  });

  it("linha sem posto (sem máquina) não é compromisso", () => {
    const livre = vigente.filter((a) => idxDe(e.slots, a) === 2 && !a.maquinaId);
    const e2 = { ...e, ausencias: livre.map((a) => ({ funcionarioId: a.funcionarioId, data: a.data, inicioMin: null, fimMin: null })) };
    expect(detectarCompromissoInviavel(e2, vigente.filter((a) => idxDe(e.slots, a) === 2 && !a.maquinaId), e.slots[2])).toBeNull();
  });

  it("alerta descreve o período e não promete recálculo", () => {
    const al = alertaCompromissoInviavel({ slot: 2, data: "2026-10-19", periodoId: "m3", itens: [{ tipo: "funcionario_ausente", funcionarioId: "f01" }] });
    expect(al.tipo).toBe("compromisso_inviavel");
    expect(al.motivo).toContain("M3");
    expect(al.motivo).toContain("Não foi recalculado");
  });

  it("o custo da inviabilidade aparece na métrica 'o motor mudaria'", () => {
    const e2 = { ...e, ausencias: [{ funcionarioId: alvo.funcionarioId, data: alvo.data, inicioMin: null, fimMin: null }] };
    const m = linhasQueOMotorMudariaNoComprometido(e2, vigente, c);
    expect(m.comprometidas).toBeGreaterThan(0);
    expect(m.mudariam).toBeGreaterThan(0); // sem o compromisso o motor trocaria o ausente
    expect(m.preservadas).toBe(m.mudariam);
  });
});

describe("troca manual no período comprometido", () => {
  const e = cenario(DIAS2);
  const vigente = gerarEscala(e).alocacoes;
  const c = 1; // comprometido = M3 (slot 2)

  // troca dois operadores com máquinas/operações diferentes no M3, respeitando o revezamento (M2→M3 e M3→T1 do vigente)
  const m3 = vigente.filter((a) => idxDe(e.slots, a) === 2 && a.maquinaId);
  const par = (() => {
    for (const x of m3) for (const y of m3) {
      if (x.funcionarioId >= y.funcionarioId || x.operacaoId === y.operacaoId) continue;
      const doDia = (id: string) => vigente.filter((a) => a.funcionarioId === id && a.data === x.data && a.maquinaId);
      const ok = (p: AlocacaoEscala, novaOp: string | null) => !doDia(p.funcionarioId).some((a) => Math.abs(idxDe(e.slots, a) - 2) === 1 && a.operacaoId === novaOp);
      if (ok(x, y.operacaoId) && ok(y, x.operacaoId)) return [x, y];
    }
    return null;
  })();

  it("a troca manual vira instrução oficial: a sombra a aceita como congelada e jamais a desfaz", () => {
    expect(par).not.toBeNull();
    const [x, y] = par as AlocacaoEscala[];
    const trocar = (a: AlocacaoEscala): AlocacaoEscala => {
      const o = a.funcionarioId === x.funcionarioId ? y : a.funcionarioId === y.funcionarioId ? x : null;
      return o ? { ...a, maquinaId: o.maquinaId, produtoId: o.produtoId, etapaId: o.etapaId, operacaoId: o.operacaoId, pecas: o.pecas, origem: "manual" } : a;
    };
    const comTroca = vigente.map((a) => (idxDe(e.slots, a) === 2 ? trocar(a) : a));
    const r = replanejarComHorizonte(e, comTroca, c);
    const manual = r.comprometidas.filter((a) => a.origem === "manual");
    expect(manual.map((a) => a.funcionarioId).sort()).toEqual([x.funcionarioId, y.funcionarioId].sort());
    expect(hashAlocacoes(r.comprometidas)).toBe(hashAlocacoes(comTroca.filter((a) => idxDe(e.slots, a) === 2)));
    expect(r.compromissoInviavel).toBeNull();
    // revezamento duro vale também para o que vem depois da troca manual (T1 ... não repete a op da pessoa em M3)
    const tudo = [...r.congeladas, ...r.comprometidas, ...r.alteravel];
    const op3 = new Map(tudo.filter((a) => idxDe(e.slots, a) === 2 && a.maquinaId).map((a) => [a.funcionarioId, a.operacaoId]));
    tudo.filter((a) => idxDe(e.slots, a) === 3 && a.maquinaId).forEach((a) => expect(op3.get(a.funcionarioId)).not.toBe(a.operacaoId));
  });
});

// verificador independente: repetição de operação em períodos consecutivos do mesmo dia
function repeticoes(e: EntradaEscala, rows: AlocacaoEscala[]): number {
  let n = 0;
  const por = new Map<string, AlocacaoEscala[]>();
  rows.forEach((a) => por.set(`${a.data}|${a.funcionarioId}`, [...(por.get(`${a.data}|${a.funcionarioId}`) ?? []), a]));
  por.forEach((l) => {
    l.sort((p, q) => idxDe(e.slots, p) - idxDe(e.slots, q));
    for (let i = 1; i < l.length; i++) if (idxDe(e.slots, l[i]) - idxDe(e.slots, l[i - 1]) === 1 && l[i].maquinaId && l[i - 1].maquinaId && l[i].operacaoId === l[i - 1].operacaoId) n++;
  });
  return n;
}

describe("revezamento duro atravessando o limite congelado/comprometido/alterável", () => {
  const e = cenario(DIAS2, 5); // equipe curta => rotação aperta
  const vigente = gerarEscala(e).alocacoes;
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("fechado %i: plano combinado (congelado+comprometido+alterável) nunca repete operação (inclui M3→T1)", (c) => {
    const r = replanejarComHorizonte(e, vigente, c);
    const tudo = [...r.congeladas, ...r.comprometidas, ...r.alteravel];
    expect(repeticoes(e, tudo)).toBe(0);
    expect(r.alteravel.some((a) => a.excecaoRevezamento)).toBe(false);
  });
  it("M3 comprometido => o primeiro alterável (T1) respeita M3→T1", () => {
    const r = replanejarComHorizonte(e, vigente, 1);
    expect(rot(e.slots, r.horizonte.comprometido)).toBe("19m3");
    expect(rot(e.slots, r.horizonte.primeiroAlteravel)).toBe("19t1");
    const op = new Map(r.comprometidas.filter((a) => a.maquinaId).map((a) => [a.funcionarioId, a.operacaoId]));
    r.alteravel.filter((a) => a.periodoId === "t1" && a.maquinaId).forEach((a) => expect(op.get(a.funcionarioId)).not.toBe(a.operacaoId));
  });
  it("novo dia reseta o revezamento, mas o comprometido não: T3 fechado => M1 do dia seguinte congelado como está; M2 alterável sem repetir M1", () => {
    const r = replanejarComHorizonte(e, vigente, 5);
    expect(rot(e.slots, r.horizonte.comprometido)).toBe("20m1");
    expect(hashAlocacoes(r.comprometidas)).toBe(hashAlocacoes(vigente.filter((a) => idxDe(e.slots, a) === 6)));
    const op = new Map(r.comprometidas.filter((a) => a.maquinaId).map((a) => [a.funcionarioId, a.operacaoId]));
    r.alteravel.filter((a) => a.periodoId === "m2" && a.maquinaId).forEach((a) => expect(op.get(a.funcionarioId)).not.toBe(a.operacaoId));
    expect(repeticoes(e, [...r.congeladas, ...r.comprometidas, ...r.alteravel])).toBe(0);
  });
  it("sem solução de rotação no alterável: posto vazio + alerta (regra da 4a intacta), nunca exceção", () => {
    const apertado = duro(entrada({ funcionarios: equipe(2), pools: [pool({ produto: "A", op: "opX", q: 1800, maquinas: ["m1", "m2", "m3"], mu: 100 })] }, DIAS2));
    const v = gerarEscala(apertado).alocacoes;
    const r = replanejarComHorizonte(apertado, v, 1);
    expect(repeticoes(apertado, [...r.congeladas, ...r.comprometidas, ...r.alteravel])).toBe(0);
    expect(r.alteravel.some((a) => a.excecaoRevezamento)).toBe(false);
  });
});

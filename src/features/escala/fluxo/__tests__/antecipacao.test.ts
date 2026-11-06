// ANTECIPAÇÃO PARA A SEMANA SEGUINTE + FORMAÇÃO DELIBERADA DE ESTOQUE — fase 2 do planejador (motor REAL, fixtures determinísticas). Ver docs/antecipacao-semana-seguinte.md.
// Cobre os 10 testes obrigatórios + política de estoque (teto some), prioridade da demanda atual por construção, limite físico, Conector/4x2, desligado byte-idêntico e ausência de regra por nome.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { planejarFuturo, type EntradaPlanejador, type SaidaPlanejador } from "../planejadorFuturo";
import type { ProdutoRev, RecursoRev } from "../planoReverso";
import type { SlotEscala } from "../../types";
import { MOTIVO_DEMANDA_ESGOTADA } from "../../types";
import {
  ORIGEM_ANTECIPACAO, ORIGEM_FORMACAO, SEM_LIMITE_FISICO, descontarAntecipadoNoDestino, montarEntradaAntecipacao, relatorioMetaEstoque, metaFuturaRestante, wipNaoTocado,
  type DadosAntecipacao, type EntradaAntecipacao, type ProdutoAntecipavel, type RegistroAntecipacao,
} from "../antecipacao";

const ids = ["m1", "m2", "m3", "t1", "t2", "t3"];
const slots: SlotEscala[] = ids.map((p, i) => ({ data: "2026-11-06", periodoId: p, indice: i, primeiroDoDia: i === 0, inicioMin: 420 + i * 90, fimMin: 510 + i * 90, inicioMs: (420 + i * 90) * 60000, fimMs: (510 + i * 90) * 60000 }));
const H = 6;
const rec = (id: string): RecursoRev => ({ id, rotulo: id, unidades: new Array(H).fill(1) });
const alt = (r: string, v: number) => ({ recursoId: r, pecasPorPosto: new Array(H).fill(v) });
const etapa = (id: string, ...rs: [string, number][]) => ({ id, rotulo: id, alternativas: rs.map(([r, v]) => alt(r, v)) });
// S = etapa única (Pino/Plug), C = cadeia de 2 etapas com buffer (Caixa 4x4), D = produto da demanda atual com 3 etapas
const prod = (id: string, etapas: ProdutoRev["etapas"], demandaFinal: number, wipInicial: number[] = []): ProdutoRev => ({ id, rotulo: id, etapas, demandaFinal, wipInicial, valorUnitario: 1 });
const S0 = (demanda = 0) => prod("S", [etapa("S0", ["s0", 1000], ["s0b", 1000])], demanda);
const C0 = (demanda = 0, wip: number[] = [0]) => prod("C", [etapa("C0", ["c0", 1000]), etapa("C1", ["c1", 1000], ["c1b", 1000])], demanda, wip);
const D0 = (demanda: number) => prod("D", [etapa("D0", ["d0", 1000]), etapa("D1", ["d1", 1000]), etapa("D2", ["d2", 1000])], demanda, [0, 0]);
const maqs = ["s0", "s0b", "t0", "c0", "c1", "c1b", "d0", "d1", "d2"];
const base = (produtos: ProdutoRev[], extra: Partial<EntradaPlanejador> = {}): EntradaPlanejador => ({
  slots, aPartirDe: 0, recursos: maqs.map(rec), produtos, equipe: ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => ({ id })), linhasCongeladas: [], producaoCongelada: {},
  operacaoDe: (_p, e) => `op-${e}`, objetivo: "MAX_PECAS_FINAIS", busca: { iter: 40000, reinicios: 1 }, ...extra,
});
const ant = (...p: ProdutoAntecipavel[]): EntradaAntecipacao => ({ produtos: p });
const ANT = (produtoId: string, maxFinal: number, extra: Partial<ProdutoAntecipavel> = {}): ProdutoAntecipavel => ({ produtoId, origem: ORIGEM_ANTECIPACAO, maxFinal, ...extra });
const FOR = (produtoId: string, maxFinal: number, extra: Partial<ProdutoAntecipavel> = {}): ProdutoAntecipavel => ({ produtoId, origem: ORIGEM_FORMACAO, maxFinal, ...extra });
const hash = (s: SaidaPlanejador) => createHash("sha256").update(JSON.stringify([s.linhas.map((l) => [l.periodoId, l.funcionarioId, l.maquinaId, l.produtoId, l.etapaId, l.operacaoId, l.pecas, l.distribuicao]), s.producao, s.wip, s.porProduto, s.validacao])).digest("hex");
const somaFin = (s: SaidaPlanejador, pid: string, filtro: (o: string) => boolean = () => true) => (s.antecipacoes ?? []).filter((a) => a.produtoId === pid && a.etapaFinal && filtro(a.origem)).reduce((x, a) => x + a.pecas, 0);
const prodTotal = (s: SaidaPlanejador, pid: string, eid: string) => s.producao[pid][eid].reduce((a, b) => a + b, 0);
const sanidade = (s: SaidaPlanejador) => {
  expect(s.validacao.cadeiaValida).toBe(true);
  expect(s.validacao.semMaterial).toBe(0);
  expect(s.validacao.atribuicaoOk).toBe(true);
  expect(s.validacao.violacoesDuras ?? 0).toBe(0);
  const k = new Set<string>();
  s.linhas.filter((l) => l.maquinaId).forEach((l) => { const a = `${l.periodoId}|${l.maquinaId}`, b = `${l.periodoId}|${l.funcionarioId}`; expect(k.has(a)).toBe(false); expect(k.has(b)).toBe(false); k.add(a); k.add(b); });
};

describe("ANTECIPAÇÃO — regras obrigatórias", () => {
  it("1. sem demanda futura ⇒ não antecipa (nenhum produto elegível = saída byte-idêntica ao planejador sem a regra)", () => {
    const sem = planejarFuturo(base([S0(0), D0(3000)]));
    const vazio = planejarFuturo(base([S0(0), D0(3000)], { antecipacao: ant() }));
    expect(hash(vazio)).toBe(hash(sem));
    expect(vazio.antecipacoes).toBeUndefined();
    // teto 0 (Forecast futuro já coberto) também não antecipa
    const zero = planejarFuturo(base([S0(0), D0(3000)], { antecipacao: ant(ANT("S", 0)) }));
    expect(hash(zero)).toBe(hash(sem));
  });

  it("2 e 9. produto de ETAPA ÚNICA com demanda futura antecipa, usa a capacidade que sobra e respeita o teto", () => {
    const s = planejarFuturo(base([S0(0), D0(3000)], { antecipacao: ant(ANT("S", 2500)) }));
    sanidade(s);
    expect(somaFin(s, "S")).toBeGreaterThan(0);
    expect(somaFin(s, "S")).toBeLessThanOrEqual(2500);
    expect(s.antecipacoes!.every((a) => a.origem === ORIGEM_ANTECIPACAO && a.produtoId === "S")).toBe(true);
    // rastreio completo por posto
    s.antecipacoes!.forEach((a) => { expect(a.data).toBe("2026-11-06"); expect(a.funcionarioId).toMatch(/^p/); expect(a.maquinaId).toMatch(/^s0/); expect(a.operacaoId).toBe("op-S0"); });
    // a linha do posto soma demanda + extra (uma entrada por produto × etapa)
    const soma = s.linhas.filter((l) => l.produtoId === "S").reduce((x, l) => x + l.pecas, 0);
    expect(soma).toBeCloseTo(somaFin(s, "S"), 6);
  });

  it("3. demanda ATUAL tem prioridade absoluta: a antecipação só ocupa o que sobra e nunca altera o plano da demanda", () => {
    // demanda atual de S e de D ocupa tudo o que cabe; mesmo com antecipação pedida, a produção da DEMANDA (total − extra) é a de sempre e nenhum posto da fase 1 some
    const demandaS = 6000; // 6 períodos × 1000 em 1 máquina... e 2 máquinas disponíveis
    const semAnt = planejarFuturo(base([S0(demandaS), D0(6000)]));
    const comAnt = planejarFuturo(base([S0(demandaS), D0(6000)], { antecipacao: ant(ANT("S", 50000), ANT("D", 50000)) }));
    sanidade(comAnt);
    for (const [pid, eid] of [["S", "S0"], ["D", "D0"], ["D", "D1"], ["D", "D2"]] as const) {
      const extra = (comAnt.antecipacoes ?? []).filter((a) => a.produtoId === pid && a.etapaId === eid).reduce((x, a) => x + a.pecas, 0);
      expect(prodTotal(comAnt, pid, eid) - extra).toBeCloseTo(prodTotal(semAnt, pid, eid), 6);
    }
    // cada posto (período × máquina) do plano da demanda continua existindo
    const postos = (s: SaidaPlanejador) => new Set(s.linhas.filter((l) => l.maquinaId).map((l) => `${l.periodoId}|${l.maquinaId}`));
    const pAnt = postos(comAnt);
    postos(semAnt).forEach((k) => expect(pAnt.has(k)).toBe(true));
    // demanda atual cumprida igualmente
    comAnt.porProduto.forEach((p) => { const e = comAnt.finalExtra?.[p.produtoId] ?? 0; const b = semAnt.porProduto.find((x) => x.produtoId === p.produtoId)!; expect(p.programado - e).toBeCloseTo(b.programado, 6); });
  });

  it("3b. sem pessoa livre não há antecipação (pessoas ≤ disponíveis; demanda atual nunca perde posto)", () => {
    const e = base([S0(0), D0(6000)], { equipe: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] }); // D (3 etapas) ocupa as 3 pessoas
    const sem = planejarFuturo(e);
    const com = planejarFuturo({ ...e, antecipacao: ant(ANT("S", 9000)) });
    sanidade(com);
    expect(com.linhas.filter((l) => l.maquinaId).length).toBeGreaterThanOrEqual(sem.linhas.filter((l) => l.maquinaId).length);
    sem.linhas.filter((l) => l.maquinaId && l.produtoId === "D").forEach((l) => expect(com.linhas.some((x) => x.periodoId === l.periodoId && x.maquinaId === l.maquinaId)).toBe(true));
    com.porProduto.forEach((p) => { const b = sem.porProduto.find((x) => x.produtoId === p.produtoId)!; expect(p.programado - (com.finalExtra?.[p.produtoId] ?? 0)).toBeCloseTo(b.programado, 6); });
  });

  it("4. antecipação que já cobre o Forecast futuro PARA de produzir (metaFuturaRestante)", () => {
    expect(metaFuturaRestante(54000, 8000)).toBe(46000);
    expect(metaFuturaRestante(54000, 54000)).toBe(0);
    expect(metaFuturaRestante(54000, 60000)).toBe(0);
    const s1 = planejarFuturo(base([S0(0)], { antecipacao: ant(ANT("S", 1500)) }));
    expect(somaFin(s1, "S")).toBeLessThanOrEqual(1500);
    expect(somaFin(s1, "S")).toBeGreaterThan(0);
    const s0 = planejarFuturo(base([S0(0)], { antecipacao: ant(ANT("S", metaFuturaRestante(1500, 1500))) }));
    expect(s0.antecipacoes).toBeUndefined();
    expect(s0.linhas.every((l) => !l.maquinaId)).toBe(true);
  });

  it("5. o antecipado é DESCONTADO da semana seguinte (54.000 − 8.000 = 46.000; nunca produz 54.000 de novo); formação só desconta se decidido", () => {
    const regs: RegistroAntecipacao[] = [
      { origem: ORIGEM_ANTECIPACAO, data: "2026-11-06", periodoId: "t1", produtoId: "pino", etapaId: "e", etapaFinal: true, quantidade: 5000 },
      { origem: ORIGEM_ANTECIPACAO, data: "2026-11-06", periodoId: "t2", produtoId: "pino", etapaId: "e", etapaFinal: true, quantidade: 3000 },
      { origem: ORIGEM_ANTECIPACAO, data: "2026-11-06", periodoId: "t2", produtoId: "pino", etapaId: "x", etapaFinal: false, quantidade: 9999 }, // etapa intermediária: não é peça final
      { origem: ORIGEM_FORMACAO, data: "2026-11-06", periodoId: "t3", produtoId: "plug", etapaId: "e", etapaFinal: true, quantidade: 4000 },
    ];
    const r = descontarAntecipadoNoDestino({ pino: 54000, plug: 33000, outro: 10 }, regs, false);
    expect(r.quantidades).toEqual({ pino: 46000, plug: 33000, outro: 10 });
    expect(r.descontos).toEqual([{ produtoId: "pino", origem: ORIGEM_ANTECIPACAO, pecas: 8000, aplicado: true }, { produtoId: "plug", origem: ORIGEM_FORMACAO, pecas: 4000, aplicado: false }]);
    expect(descontarAntecipadoNoDestino({ pino: 54000, plug: 33000 }, regs, true).quantidades).toEqual({ pino: 46000, plug: 29000 });
    expect(descontarAntecipadoNoDestino({ pino: 54000 }, [], false).quantidades).toEqual({ pino: 54000 });
  });

  it("6. máquina fora do Forecast/seleção não é usada (interseção); sem máquina permitida ⇒ produto não elegível", () => {
    const so = planejarFuturo(base([S0(0)], { antecipacao: ant(ANT("S", 5000, { maquinasPorEtapa: { S0: ["s0b"] } })) }));
    sanidade(so);
    expect(so.antecipacoes!.length).toBeGreaterThan(0);
    expect(so.antecipacoes!.every((a) => a.maquinaId === "s0b")).toBe(true);
    const nenhuma = planejarFuturo(base([S0(0)], { antecipacao: ant(ANT("S", 5000, { maquinasPorEtapa: { S0: ["maquina-que-nao-existe"] } })) }));
    expect(nenhuma.antecipacoes).toBeUndefined();
    expect(nenhuma.linhas.every((l) => !l.maquinaId)).toBe(true);
  });

  it("7. funcionário que violaria o revezamento não é usado: a mesma pessoa não repete a operação na manhã nem na tarde", () => {
    // 1 pessoa só: no máximo 1 linha da MESMA operação por bloco (manhã M1–M3 / tarde T1–T3)
    const s = planejarFuturo(base([S0(0)], { equipe: [{ id: "p1" }], antecipacao: ant(ANT("S", 50000)) }));
    sanidade(s);
    const manha = s.linhas.filter((l) => l.maquinaId && l.periodoId.startsWith("m")).length, tarde = s.linhas.filter((l) => l.maquinaId && l.periodoId.startsWith("t")).length;
    expect(manha).toBeLessThanOrEqual(1);
    expect(tarde).toBeLessThanOrEqual(1);
    // com 2 pessoas: nenhuma pessoa repete a operação no bloco
    const s2 = planejarFuturo(base([S0(0)], { equipe: [{ id: "p1" }, { id: "p2" }], antecipacao: ant(ANT("S", 50000)) }));
    for (const bloco of ["m", "t"]) {
      const porPessoa = new Map<string, number>();
      s2.linhas.filter((l) => l.maquinaId && l.periodoId.startsWith(bloco)).forEach((l) => porPessoa.set(`${l.funcionarioId}|${l.operacaoId}`, (porPessoa.get(`${l.funcionarioId}|${l.operacaoId}`) ?? 0) + 1));
      porPessoa.forEach((n) => expect(n).toBeLessThanOrEqual(1));
    }
  });

  it("8. WIP suficiente ⇒ não produz upstream desnecessário (monta o que já está etiquetado em vez de etiquetar mais)", () => {
    const s = planejarFuturo(base([C0(0, [2000])], { antecipacao: ant(ANT("C", 2000)) }));
    sanidade(s);
    expect(prodTotal(s, "C", "C0")).toBe(0); // WIP de 2000 já cobre o Forecast: nada de upstream
    expect(prodTotal(s, "C", "C1")).toBeGreaterThan(0);
    expect(prodTotal(s, "C", "C1")).toBeLessThanOrEqual(2000);
    // sem WIP: precisa etiquetar para montar
    const s0 = planejarFuturo(base([C0(0, [0])], { antecipacao: ant(ANT("C", 2000)) }));
    expect(prodTotal(s0, "C", "C0")).toBeGreaterThan(0);
  });

  it("10. cadeia com buffer: respeita o lote (produção de Tn só vale a jusante em Tn+1), nunca no mesmo período, e o buffer nunca fica negativo", () => {
    const s = planejarFuturo(base([C0(0, [0])], { antecipacao: ant(ANT("C", 3000)) }));
    sanidade(s);
    const c0 = s.producao.C.C0, c1 = s.producao.C.C1;
    let estoque = 0;
    for (let t = 0; t < H; t++) {
      expect(c1[t]).toBeLessThanOrEqual(estoque + 1e-6); // só consome o que existia no INÍCIO do período
      estoque = Math.max(0, estoque - c1[t]) + c0[t];
    }
    expect(prodTotal(s, "C", "C1")).toBeGreaterThan(0);
    expect(somaFin(s, "C")).toBeLessThanOrEqual(3000);
    expect(s.antecipacoes!.some((a) => !a.etapaFinal)).toBe(true); // rastreia também a etapa intermediária
  });

  it("antecipação respeita o WIP da demanda atual: o que a demanda vai consumir não é emprestado à antecipação", () => {
    // demanda atual de C consome o WIP de 1000 e o resto; a parte que a demanda nunca toca é que a sombra herda
    const d = planejarFuturo(base([C0(3000, [1000])]));
    const wnt = wipNaoTocado(C0(3000, [1000]), [1000], d.producao.C, 0, H);
    expect(wnt[0]).toBeGreaterThanOrEqual(0);
    expect(wnt[0]).toBeLessThanOrEqual(1000);
    const s = planejarFuturo(base([C0(3000, [1000])], { antecipacao: ant(ANT("C", 4000)) }));
    sanidade(s);
    expect(prodTotal(s, "C", "C1") - (s.antecipacoes ?? []).filter((a) => a.etapaId === "C1").reduce((x, a) => x + a.pecas, 0)).toBeCloseTo(prodTotal(d, "C", "C1"), 6);
  });
});

describe("FORMAÇÃO DELIBERADA DE ESTOQUE — política por produto, sem teto de Forecast", () => {
  it("política DESLIGADA para o produto ⇒ o teto do Forecast continua; LIGADA ⇒ passa do Forecast futuro e da demanda atual", () => {
    const dadosBase = (politicas: DadosAntecipacao["politicasFormacao"]): DadosAntecipacao => ({
      modo: "ativo", antecipacaoSolicitada: true, semanaOrigem: "2026-11-02", semanaDestino: "2026-11-09", politicasFormacao: politicas, excluidos: [], registros: [],
      forecastDestino: [{ produtoId: "S", quantidade: 1500, maquinasPorEtapa: { S0: ["s0", "s0b"] } }],
    });
    const pools = [{ produtoId: "S", etapaId: "S0", ordemEtapa: 0, quantidade: 1000, maquinasIds: ["s0", "s0b"] }];
    const comum = { pools, indiceDoSlot: () => 99, aPartirDe: 0 };
    const sem = montarEntradaAntecipacao({ dados: dadosBase([]), ...comum });
    expect(sem.entrada.produtos).toEqual([{ produtoId: "S", origem: ORIGEM_ANTECIPACAO, maxFinal: 1500, metaMinima: 1000, maquinasPorEtapa: { S0: ["s0", "s0b"] } }]);
    // sem o opt-in da antecipação, produto não autorizado simplesmente para na meta
    const optOut = montarEntradaAntecipacao({ dados: { ...dadosBase([]), antecipacaoSolicitada: false }, ...comum });
    expect(optOut.entrada.produtos).toEqual([]);
    const com = montarEntradaAntecipacao({ dados: dadosBase([{ produtoId: "S" }]), ...comum });
    expect(com.entrada.produtos).toEqual([{ produtoId: "S", origem: ORIGEM_FORMACAO, maxFinal: SEM_LIMITE_FISICO, metaMinima: 1000 }]); // a meta mínima é PISO: sem limite comercial; só o limite físico (capacidade)
    const alto = montarEntradaAntecipacao({ dados: dadosBase([{ produtoId: "S", limiteFisicoPecas: 40000 }]), ...comum });
    expect(alto.entrada.produtos[0].maxFinal).toBe(40000);
    // motor: sem política, teto 1500 (Forecast futuro); com política e teto físico 40000, produz bem mais que o Forecast futuro e que a demanda atual (0)
    const sTeto = planejarFuturo(base([S0(0)], { antecipacao: sem.entrada }));
    const sPol = planejarFuturo(base([S0(0)], { antecipacao: alto.entrada }));
    sanidade(sTeto); sanidade(sPol);
    expect(somaFin(sTeto, "S")).toBeLessThanOrEqual(1500);
    expect(somaFin(sPol, "S", (o) => o === ORIGEM_FORMACAO)).toBeGreaterThan(1500);
    expect(somaFin(sPol, "S")).toBeLessThanOrEqual(40000);
    expect(sPol.antecipacoes!.every((a) => a.origem === ORIGEM_FORMACAO)).toBe(true);
  });

  it("formação NUNCA tira recurso da demanda atual (também quando os dois disputam as mesmas máquinas e pessoas)", () => {
    const demanda = planejarFuturo(base([S0(5000), C0(4000, [0])]));
    const com = planejarFuturo(base([S0(5000), C0(4000, [0])], { antecipacao: ant(FOR("S", 90000), FOR("C", 90000)) }));
    sanidade(com);
    for (const [pid, eid] of [["S", "S0"], ["C", "C0"], ["C", "C1"]] as const) {
      const extra = (com.antecipacoes ?? []).filter((a) => a.produtoId === pid && a.etapaId === eid).reduce((x, a) => x + a.pecas, 0);
      expect(prodTotal(com, pid, eid) - extra).toBeCloseTo(prodTotal(demanda, pid, eid), 6);
    }
    const postos = (s: SaidaPlanejador) => new Set(s.linhas.filter((l) => l.maquinaId).map((l) => `${l.periodoId}|${l.maquinaId}`));
    postos(demanda).forEach((k) => expect(postos(com).has(k)).toBe(true));
  });

  it("peso: demanda confirmada (antecipação) vence estoque especulativo quando disputam a pessoa", () => {
    // 1 pessoa e a MESMA operação nos dois produtos ⇒ só 1 posto por bloco: o produto com antecipação (peso 1) ocupa o posto; a formação (peso 0,25) fica sem
    const T = prod("T", [etapa("S0", ["t0", 1000])], 0);
    const s = planejarFuturo({ ...base([T, S0(0)], { equipe: [{ id: "p1" }], antecipacao: ant(FOR("T", 9000), ANT("S", 9000)) }), operacaoDe: (_p, e) => `op-${e}` });
    sanidade(s);
    const porOrigem = (o: string) => s.antecipacoes!.filter((a) => a.origem === o).reduce((x, a) => x + a.pecas, 0);
    expect(porOrigem(ORIGEM_ANTECIPACAO)).toBeGreaterThan(0);
    expect(porOrigem(ORIGEM_FORMACAO)).toBe(0);
  });

  it("limite FÍSICO: o buffer nunca passa do que o consumidor absorve até o fim da semana (sem WIP absurdo); teto final respeitado", () => {
    // consumidor C1 tem 1 máquina de 100 pç/período: o buffer de C0→C1 não pode passar de ~ (períodos restantes × 100)
    const lento = prod("C", [etapa("C0", ["c0", 1000]), etapa("C1", ["c1", 100])], 0, [0]);
    const s = planejarFuturo(base([lento], { antecipacao: ant(FOR("C", 1e9)) }));
    sanidade(s);
    const capConsumidor = 100 * (H - 1); // capacidade do consumidor (livre: a demanda atual de C é 0)
    s.wip.C[0].forEach((nivel) => expect(nivel).toBeLessThanOrEqual(capConsumidor + 1e-6));
    // consumidor ocupado pela demanda atual ⇒ a capacidade LIVRE é menor ⇒ buffer de formação ainda menor
    const ocupado = planejarFuturo(base([prod("C", [etapa("C0", ["c0", 1000]), etapa("C1", ["c1", 100])], 400, [0])], { antecipacao: ant(FOR("C", 1e9)) }));
    sanidade(ocupado);
    const extra0 = (x: SaidaPlanejador) => (x.antecipacoes ?? []).filter((a) => a.etapaIdx === 0).reduce((q, a) => q + a.pecas, 0);
    expect(extra0(ocupado)).toBeLessThanOrEqual(extra0(s) - 1); // a demanda atual ocupa 400 da capacidade do consumidor ⇒ sobra menos para formar buffer
    // folga física EXPLÍCITA por produto aumenta o nível permitido
    const folga = planejarFuturo(base([lento], { antecipacao: ant(FOR("C", 1e9, { bufferExtraPecas: 300 })) }));
    expect(Math.max(...folga.wip.C[0])).toBeGreaterThanOrEqual(Math.max(...s.wip.C[0]));
    expect(Math.max(...s.wip.C[0])).toBeGreaterThan(0); // houve formação de buffer (dentro do limite)
    // teto final físico explícito
    const t = planejarFuturo(base([S0(0)], { antecipacao: ant(FOR("S", 700)) }));
    expect(somaFin(t, "S")).toBeLessThanOrEqual(700);
  });

  it("sem trabalho fisicamente válido ⇒ a pessoa continua SEM posto (nada de posto só para ocupar gente)", () => {
    // máquinas do produto todas ocupadas pela própria demanda e teto esgotado: ninguém é colocado em posto inútil
    const s = planejarFuturo(base([S0(0)], { antecipacao: ant(FOR("S", 0)) }));
    expect(s.linhas.every((l) => !l.maquinaId && l.motivoSemPosto === MOTIVO_DEMANDA_ESGOTADA)).toBe(true);
    // WIP já cobre o teto e não há máquina para montar: nada a fazer
    const w = planejarFuturo(base([C0(0, [0])], { antecipacao: ant(ANT("C", 1000, { maquinasPorEtapa: { C0: ["c0"], C1: [] } })) }));
    expect(w.linhas.every((l) => !l.maquinaId)).toBe(true);
  });

  it("estoque formado do passado e excedente real contam no teto físico (Pino: o excesso já produzido não é corrigido para baixo, mas ocupa o teto)", () => {
    const dados: DadosAntecipacao = { modo: "ativo", semanaOrigem: "s", semanaDestino: "d", forecastDestino: [], politicasFormacao: [{ produtoId: "S", limiteFisicoPecas: 10000 }], excluidos: [], registros: [{ origem: ORIGEM_FORMACAO, data: "2026-11-05", periodoId: "t1", produtoId: "S", etapaId: "S0", etapaFinal: true, quantidade: 3000 }] };
    const pools = [{ produtoId: "S", etapaId: "S0", ordemEtapa: 0, quantidade: 43200, maquinasIds: ["s0"] }];
    const idx = (d: string) => (d === "2026-11-05" ? 0 : 5);
    const r = montarEntradaAntecipacao({ dados, pools, indiceDoSlot: idx, aPartirDe: 3, excedenteReal: { S: 8580 } });
    expect(r.entrada.produtos[0].maxFinal).toBe(10000 - 8580); // max(formado 3000, excedente 8580)
    const r2 = montarEntradaAntecipacao({ dados, pools, indiceDoSlot: idx, aPartirDe: 3, excedenteReal: { S: 0 } });
    expect(r2.entrada.produtos[0].maxFinal).toBe(7000);
  });
});

describe("Propriedade (sementes fixas): invariantes HARD e prioridade da demanda em cenários aleatórios", () => {
  const prng = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  it("40 cenários: cadeia válida, sem material, ≤ pessoas, demanda atual intacta, tetos respeitados, extra só em produto elegível", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = prng(seed);
      const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
      const produtos = [S0(pick([0, 0, 2000, 6000])), C0(pick([0, 1500, 4000]), [pick([0, 500, 2000])]), D0(pick([0, 3000, 9000]))];
      const equipe = ["p1", "p2", "p3", "p4", "p5", "p6"].slice(0, 2 + Math.floor(r() * 5)).map((id) => ({ id }));
      const aus: Record<number, string[]> = r() < 0.4 ? { [2 + Math.floor(r() * 3)]: ["p1"] } : {};
      const antProdutos: ProdutoAntecipavel[] = [];
      if (r() < 0.8) antProdutos.push(r() < 0.5 ? ANT("S", pick([800, 3000, 20000])) : FOR("S", pick([800, 3000, 20000])));
      if (r() < 0.8) antProdutos.push(r() < 0.5 ? ANT("C", pick([800, 3000, 20000])) : FOR("C", pick([800, 3000, 20000]), { bufferExtraPecas: pick([0, 300]) }));
      if (r() < 0.5) antProdutos.push(ANT("D", pick([800, 3000])));
      const e = base(produtos, { equipe, ausentes: aus });
      const sem = planejarFuturo(e), com = planejarFuturo({ ...e, antecipacao: ant(...antProdutos) });
      const tag = `seed ${seed}`;
      expect(com.validacao.cadeiaValida, tag).toBe(true);
      expect(com.validacao.semMaterial, tag).toBe(0);
      expect(com.validacao.atribuicaoOk, tag).toBe(true);
      const porSlot = new Map<string, number>();
      com.linhas.filter((l) => l.maquinaId).forEach((l) => porSlot.set(l.periodoId, (porSlot.get(l.periodoId) ?? 0) + 1));
      [...porSlot.entries()].forEach(([per, n]) => expect(n, `${tag} ${per}`).toBeLessThanOrEqual(equipe.length - (aus[ids.indexOf(per)]?.length ?? 0)));
      const k = new Set<string>();
      com.linhas.filter((l) => l.maquinaId).forEach((l) => { const a = `${l.periodoId}|${l.maquinaId}`, b = `${l.periodoId}|${l.funcionarioId}`; expect(k.has(a), tag).toBe(false); expect(k.has(b), tag).toBe(false); k.add(a); k.add(b); });
      // demanda atual intacta (produção − extra = a de antes) e nenhum posto da demanda some
      for (const p of produtos) for (const et of p.etapas) {
        const extra = (com.antecipacoes ?? []).filter((a) => a.produtoId === p.id && a.etapaId === et.id).reduce((x, a) => x + a.pecas, 0);
        expect(prodTotal(com, p.id, et.id) - extra, `${tag} ${p.id}/${et.id}`).toBeCloseTo(prodTotal(sem, p.id, et.id), 6);
      }
      // tetos: ANTECIPAÇÃO ≤ teto líquido; FORMAÇÃO ≤ teto físico; produto fora da lista não recebe extra
      for (const ap of antProdutos) expect(somaFin(com, ap.produtoId, (o) => o === ap.origem), tag).toBeLessThanOrEqual(ap.maxFinal + 1e-6);
      (com.antecipacoes ?? []).forEach((a) => expect(antProdutos.some((x) => x.produtoId === a.produtoId && x.origem === a.origem), tag).toBe(true));
    }
  }, 120_000);
});

describe("Exclusões por construção, desligado byte-idêntico e nenhuma regra por nome", () => {
  const dados = (extra: Partial<DadosAntecipacao>): DadosAntecipacao => ({
    modo: "ativo", antecipacaoSolicitada: true, semanaOrigem: "2026-11-02", semanaDestino: "2026-11-09", registros: [], politicasFormacao: [], excluidos: [],
    forecastDestino: [{ produtoId: "pino", quantidade: 54000, maquinasPorEtapa: { e1: ["m20"] } }, { produtoId: "conector", quantidade: 76125, maquinasPorEtapa: { e2: ["m"] } }, { produtoId: "caixa42", quantidade: 5, maquinasPorEtapa: { e3: ["m"] } }], ...extra,
  });
  const pools = [
    { produtoId: "pino", etapaId: "e1", ordemEtapa: 0, quantidade: 43200, maquinasIds: ["m20"] },
    { produtoId: "conector", etapaId: "e2", ordemEtapa: 0, quantidade: 64800, maquinasIds: ["m"] },
    { produtoId: "caixa42", etapaId: "e3", ordemEtapa: 0, quantidade: 0, maquinasIds: ["m"] },
  ];
  const comum = { pools, indiceDoSlot: () => 9, aPartirDe: 0 };

  it("Conector 3/4 (excluído por segurança do cutover) NUNCA antecipa nem forma estoque — mesmo com Forecast ou política", () => {
    const r = montarEntradaAntecipacao({ dados: dados({ excluidos: ["conector"], politicasFormacao: [{ produtoId: "conector" }] }), ...comum });
    expect(r.entrada.produtos.map((p) => p.produtoId)).toEqual(["pino"]);
    expect(r.diagnostico.find((d) => d.produtoId === "conector")!.situacao).toBe("NAO");
  });

  it("Caixa 4x2 encerrada (quantidade 0 na semana atual) nunca antecipa nem forma estoque — mesmo com Forecast e política", () => {
    const r = montarEntradaAntecipacao({ dados: dados({ politicasFormacao: [{ produtoId: "caixa42" }] }), ...comum });
    expect(r.entrada.produtos.map((p) => p.produtoId)).not.toContain("caixa42");
    expect(r.diagnostico.find((d) => d.produtoId === "caixa42")!.motivo).toMatch(/encerrado/);
  });

  it("produto só na semana seguinte (sem pool na atual) ou sem Forecast confirmado não antecipa; interseção de máquinas; Forecast ausente = nada inventado", () => {
    const r = montarEntradaAntecipacao({ dados: dados({ forecastDestino: [{ produtoId: "so-no-futuro", quantidade: 10, maquinasPorEtapa: {} }] }), ...comum });
    expect(r.entrada.produtos).toEqual([]);
    const r2 = montarEntradaAntecipacao({ dados: dados({}), ...comum });
    expect(r2.entrada.produtos.find((p) => p.produtoId === "pino")!.maquinasPorEtapa).toEqual({ e1: ["m20"] });
    const r3 = montarEntradaAntecipacao({ dados: dados({ forecastDestino: [{ produtoId: "pino", quantidade: 54000, maquinasPorEtapa: { e1: ["m20", "maquina-so-da-semana-seguinte"] } }] }), ...comum });
    expect(r3.entrada.produtos[0].maquinasPorEtapa).toEqual({ e1: ["m20"] });
  });

  it("antecipado em períodos já iniciados (registro) já conta contra o Forecast: continua só com o LÍQUIDO", () => {
    const regs: RegistroAntecipacao[] = [{ origem: ORIGEM_ANTECIPACAO, data: "2026-11-05", periodoId: "t3", produtoId: "pino", etapaId: "e1", etapaFinal: true, quantidade: 8000 }];
    const r = montarEntradaAntecipacao({ dados: dados({ registros: regs }), pools, indiceDoSlot: () => 0, aPartirDe: 2 });
    expect(r.entrada.produtos.find((p) => p.produtoId === "pino")!.maxFinal).toBe(46000);
    // registro de período FUTURO (será substituído pelo novo plano) não conta
    const r2 = montarEntradaAntecipacao({ dados: dados({ registros: regs }), pools, indiceDoSlot: () => 5, aPartirDe: 2 });
    expect(r2.entrada.produtos.find((p) => p.produtoId === "pino")!.maxFinal).toBe(54000);
  });

  it("DESLIGADO é byte-idêntico: sem `antecipacao` (ou vazia) a saída do planejador é exatamente a de antes, em vários cenários", () => {
    const cenarios: EntradaPlanejador[] = [
      base([S0(4000), C0(3000, [500]), D0(2500)]),
      base([S0(0), D0(9000)], { ausentes: { 2: ["p1"], 3: ["p1"] } }),
      base([C0(2000, [100])], { objetivo: "EQUILIBRIO" }),
    ];
    for (const c of cenarios) {
      const a = planejarFuturo(c), b = planejarFuturo({ ...c, antecipacao: ant() }), d = planejarFuturo({ ...c, antecipacao: undefined });
      expect(hash(b)).toBe(hash(a));
      expect(hash(d)).toBe(hash(a));
      expect(a.antecipacoes).toBeUndefined();
    }
  });

  it("nenhuma regra por nome de produto/pessoa: os módulos da regra não citam nomes", () => {
    const arquivos = ["antecipacao.ts", "planejadorFuturo.ts", "postosDespacho.ts"].map((f) => readFileSync(join(process.cwd(), "src/features/escala/fluxo", f), "utf8"));
    const codigo = arquivos.join("\n").split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    for (const nome of ["Pino", "Plug", "Elizabeth", "Samantha", "Aly", "Sara", "Conector", "Caixa", "4x2", "4x4"]) expect(codigo.includes(nome), nome).toBe(false);
  });
});

describe("Fallback de 06/11 13:08 — retentativa aperta TAMBÉM as linhas de partida (revezamento de bloco com ausência no meio da tarde)", () => {
  it("mais postos da mesma operação do que pessoas elegíveis na tarde: o planejador reduz os postos e fecha um plano válido (antes: 'sem plano executável')", () => {
    // 5 pessoas; p5 ausente em t2/t3 (a ausência entra depois do começo do dia ⇒ max(pessoas) continua 5); em t1 (congelado) p1 e p2 fizeram a operação X
    // elegíveis a X em t2+t3 = {p3,p4} (2). Com 4 máquinas de X e demanda grande, a 1ª tentativa (limite 5 − 2 = 3 linhas) pede 3 postos de X ⇒ atribuição impossível; o aperto do limite precisa derrubar linhas de verdade.
    const X = prod("X", [etapa("X0", ["x0", 1000], ["x1", 1000], ["x2", 1000], ["x3", 1000])], 40000);
    const congeladas = [
      { data: "2026-11-06", periodoId: "t1", funcionarioId: "p1", maquinaId: "x0", produtoId: "X", etapaId: "X0", operacaoId: "op-X0", pecas: 1000, pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" as const },
      { data: "2026-11-06", periodoId: "t1", funcionarioId: "p2", maquinaId: "x1", produtoId: "X", etapaId: "X0", operacaoId: "op-X0", pecas: 1000, pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" as const },
    ];
    const e: EntradaPlanejador = {
      ...base([X], { aPartirDe: 4, equipe: ["p1", "p2", "p3", "p4", "p5"].map((id) => ({ id })), ausentes: { 4: ["p5"], 5: ["p5"] }, linhasCongeladas: congeladas, revezamento: { ponteM3T1: true } }),
      recursos: ["x0", "x1", "x2", "x3"].map(rec),
    };
    const s = planejarFuturo(e);
    sanidade(s);
    // elegíveis a X em t2+t3 são só p3 e p4 ⇒ no máximo 2 linhas de X no bloco
    expect(s.linhas.filter((l) => l.maquinaId && l.operacaoId === "op-X0").length).toBeLessThanOrEqual(2);
    expect(s.linhas.filter((l) => l.maquinaId).length).toBeGreaterThan(0);
    const porPessoa = new Map<string, number>();
    s.linhas.filter((l) => l.maquinaId).forEach((l) => porPessoa.set(l.funcionarioId, (porPessoa.get(l.funcionarioId) ?? 0) + 1));
    expect(porPessoa.get("p1") ?? 0).toBe(0); // p1 e p2 já fizeram X na tarde
    expect(porPessoa.get("p2") ?? 0).toBe(0);
    expect(porPessoa.get("p5") ?? 0).toBe(0); // ausente
  });
});

describe("META MÍNIMA de produção × FORMAÇÃO DE ESTOQUE (a quantidade da Previsão é piso, não teto)", () => {
  // produto de etapa única com UMA máquina de 1000 peças/período: capacidade da semana = 6.000 (6 períodos)
  const U = (id: string, maq: string, demanda: number) => prod(id, [etapa(`${id}0`, [maq, 1000])], demanda);
  const rec2 = (...ms: string[]) => ({ recursos: ms.map(rec) });
  const finalTotal = (s: SaidaPlanejador, pid: string) => s.linhas.reduce((x, l) => x + (l.produtoId === pid ? l.pecas : 0), 0);

  it("1. meta = capacidade ⇒ produz exatamente a meta (nada além), autorizado ou não", () => {
    const sem = planejarFuturo(base([U("M", "m0", 6000)], rec2("m0")));
    const aut = planejarFuturo(base([U("M", "m0", 6000)], { ...rec2("m0"), antecipacao: ant(FOR("M", SEM_LIMITE_FISICO)) }));
    expect(finalTotal(sem, "M")).toBe(6000);
    expect(finalTotal(aut, "M")).toBe(6000);
    expect(aut.antecipacoes).toBeUndefined();
  });

  it("2. meta < capacidade e produto AUTORIZADO ⇒ passa da meta (a meta é piso); NÃO autorizado ⇒ para na meta", () => {
    const naoAut = planejarFuturo(base([U("M", "m0", 3000)], rec2("m0")));
    const aut = planejarFuturo(base([U("M", "m0", 3000)], { ...rec2("m0"), antecipacao: ant(FOR("M", SEM_LIMITE_FISICO)) }));
    sanidade(aut);
    expect(finalTotal(naoAut, "M")).toBe(3000);
    expect(finalTotal(aut, "M")).toBeGreaterThan(3000);
    expect(finalTotal(aut, "M")).toBeLessThanOrEqual(6000); // limite físico: a máquina
    expect(somaFin(aut, "M", (o) => o === ORIGEM_FORMACAO)).toBe(finalTotal(aut, "M") - 3000); // tudo além da meta é FORMACAO_ESTOQUE, e só isso
    expect(aut.antecipacoes!.every((a) => a.origem === ORIGEM_FORMACAO)).toBe(true);
  });

  it("3. A já atingiu a meta, B ainda abaixo, recurso (pessoa) compartilhado ⇒ B primeiro; A (autorizado) só fica com o que sobra", () => {
    // 1 pessoa ⇒ 1 posto por bloco com a MESMA operação (A e B compartilham a operação 'op-X'): só 2 postos na semana, e B precisa deles
    const A = prod("A", [etapa("X", ["ma", 1000])], 0);
    const B = prod("B", [etapa("X", ["mb", 1000])], 5000);
    const e = base([A, B], { equipe: [{ id: "p1" }], recursos: ["ma", "mb"].map(rec), antecipacao: ant(FOR("A", SEM_LIMITE_FISICO)) });
    const s = planejarFuturo(e);
    sanidade(s);
    expect(prodTotal(s, "B", "X")).toBe(2000); // os dois postos possíveis vão para B (abaixo da meta)
    expect(s.antecipacoes).toBeUndefined(); // A não tirou nada de B
    // com B já na meta, A (autorizado) usa os postos
    const e2 = base([A, prod("B", [etapa("X", ["mb", 1000])], 0)], { equipe: [{ id: "p1" }], recursos: ["ma", "mb"].map(rec), antecipacao: ant(FOR("A", SEM_LIMITE_FISICO)) });
    const s2 = planejarFuturo(e2);
    expect(somaFin(s2, "A")).toBe(2000);
  });

  it("4. todas as metas atendidas e capacidade livre ⇒ forma estoque dos autorizados (cada um com suas máquinas); não autorizados ficam parados", () => {
    const s = planejarFuturo(base([U("P", "mp", 1000), U("Q", "mq", 1000), U("N", "mn", 1000)], { ...rec2("mp", "mq", "mn"), equipe: ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => ({ id })), antecipacao: ant(FOR("P", SEM_LIMITE_FISICO), FOR("Q", SEM_LIMITE_FISICO)) }));
    sanidade(s);
    expect(somaFin(s, "P")).toBeGreaterThan(0);
    expect(somaFin(s, "Q")).toBeGreaterThan(0);
    expect(finalTotal(s, "N")).toBe(1000); // 5. NÃO autorizado: para na meta
    expect((s.antecipacoes ?? []).some((a) => a.produtoId === "N")).toBe(false);
  });

  it("6. cadeia com buffer (etiquetar → montar) acima da meta: lote Tn→Tn+1, buffer nunca negativo nem maior que a capacidade LIVRE do consumidor, HARD gates 0", () => {
    const Cx = prod("C", [etapa("C0", ["c0", 1000]), etapa("C1", ["c1", 400])], 1500, [0]);
    const s = planejarFuturo(base([Cx], { antecipacao: ant(FOR("C", SEM_LIMITE_FISICO)) }));
    sanidade(s);
    const c0 = s.producao.C.C0, c1 = s.producao.C.C1;
    let estoque = 0;
    for (let t = 0; t < H; t++) { expect(c1[t]).toBeLessThanOrEqual(estoque + 1e-6); estoque = Math.max(0, estoque - c1[t]) + c0[t]; expect(estoque).toBeGreaterThanOrEqual(0); }
    expect(finalTotal(s, "C")).toBeGreaterThanOrEqual(1500); // meta atendida primeiro
    expect(prodTotal(s, "C", "C1")).toBeGreaterThan(1500); // e continua (consumidor tinha capacidade livre)
    // nível do buffer nunca passa da capacidade do consumidor (400 × períodos restantes) + o que a meta consome
    s.wip.C[0].forEach((n) => expect(n).toBeLessThanOrEqual(400 * (H - 1) + 1e-6));
  });

  it("7. formação de estoque NÃO altera a meta mínima futura: a meta aparece inteira; o desconto só vale se decidido; relatório separa meta × planejada × real × formação", () => {
    const regs: RegistroAntecipacao[] = [{ origem: ORIGEM_FORMACAO, data: "2026-11-06", periodoId: "t2", produtoId: "pino", etapaId: "e", etapaFinal: true, quantidade: 6500 }];
    expect(descontarAntecipadoNoDestino({ pino: 108000 }, regs, false).quantidades.pino).toBe(108000);
    const rel = relatorioMetaEstoque({ metas: { pino: 108000 }, planejada: { pino: 116000 }, real: { pino: 114500 }, formacao: { pino: 6500 } })[0];
    expect(rel).toEqual({ produtoId: "pino", metaMinima: 108000, producaoPlanejada: 116000, producaoReal: 114500, formacaoEstoqueRegistrada: 6500, alemDaMetaPlanejado: 8000, alemDaMetaReal: 6500, faltaParaMeta: 0 });
    expect(relatorioMetaEstoque({ metas: { x: 100 }, real: { x: 40 } })[0]).toMatchObject({ faltaParaMeta: 60, alemDaMetaReal: 0, alemDaMetaPlanejado: 0 });
  });

  it("8. a formação nunca tira posto nem peça da meta: produção da meta com e sem formação é idêntica (cadeia + produtos compartilhando operação)", () => {
    const prods = [U("P", "mp", 4000), prod("C", [etapa("C0", ["c0", 1000]), etapa("C1", ["c1", 1000])], 2500, [0])];
    const e = base(prods, { ...rec2("mp", "c0", "c1") });
    const sem = planejarFuturo(e), com = planejarFuturo({ ...e, antecipacao: ant(FOR("P", SEM_LIMITE_FISICO), FOR("C", SEM_LIMITE_FISICO)) });
    sanidade(com);
    for (const [pid, eid] of [["P", "P0"], ["C", "C0"], ["C", "C1"]] as const) {
      const extra = (com.antecipacoes ?? []).filter((a) => a.produtoId === pid && a.etapaId === eid).reduce((x, a) => x + a.pecas, 0);
      expect(prodTotal(com, pid, eid) - extra).toBeCloseTo(prodTotal(sem, pid, eid), 6);
    }
  });
});

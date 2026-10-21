// FASE 4c — execução (A/B/C/D), recuperação e orquestração de UM corte, sem informação futura.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { classificarSituacao, faltaProjetada, resumirRecuperacao, restanteAcabado, toleranciaFalta } from "../execucao";
import { executarCorteSombra, visaoNoCorte, type ParametrosCorte } from "../sombraCorte";
import { hashAlocacoes } from "../horizonte";
import type { ApontamentoReal } from "../producaoReal";
import type { AlocacaoEscala, EntradaEscala } from "../types";
import { entrada, equipe, pool } from "./helpers";

const DIAS = ["2026-10-19", "2026-10-20"];
const mk = (qA: number, qB: number, qC: number, n = 8): EntradaEscala => ({
  ...entrada({ funcionarios: equipe(n), pools: [
    pool({ produto: "A", etapa: "A-e1", op: "opX", q: qA, maquinas: ["m1", "m2"], mu: 100 }),
    pool({ produto: "B", etapa: "B-e1", op: "opY", q: qB, maquinas: ["m3", "m4"], mu: 100 }),
    pool({ produto: "C", etapa: "C-e1", op: "opZ", q: qC, maquinas: ["m5"], mu: 100 }),
  ] }, DIAS), revezamentoDuro: true,
});
const idx = (e: EntradaEscala, a: { data: string; periodoId: string }) => e.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)!.indice;

// apontamentos fiéis ao plano até o slot `ate`, com rendimento g (boas = peças × g)
function apontar(e: EntradaEscala, plano: AlocacaoEscala[], ate: number, g: number): ApontamentoReal[] {
  return plano.filter((a) => a.maquinaId && idx(e, a) <= ate).map((a) => {
    const s = e.slots[idx(e, a)];
    return { data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, boas: Math.round(a.pecas * g), refugo: 0, meta: a.pecas, status: "produzindo" as const, motivo: null, lancadoEmMs: s.fimMs + 5 * 60_000 };
  });
}
const parametros = (e: EntradaEscala, c: number, g: number, extra: Partial<ParametrosCorte> = {}): ParametrosCorte => {
  const plano = gerarEscala(e).alocacoes;
  return { base: e, ausencias: [], indisponibilidades: [], apontamentos: apontar(e, plano, c, g), planoOficial: plano, c, corteMs: e.slots[c].fimMs + 10 * 60_000, ...extra };
};

describe("execução — A/B/C/D, falta projetada e tolerância", () => {
  it("classificarSituacao: A tem precedência; OK; B→C; B→D", () => {
    expect(classificarSituacao({ impossivelNaOrigem: true, faltaOficial: 0, faltaSombra: 0, tolerancia: 1 })).toBe("A");
    expect(classificarSituacao({ impossivelNaOrigem: false, faltaOficial: 0.5, faltaSombra: 0, tolerancia: 1 })).toBe("OK");
    expect(classificarSituacao({ impossivelNaOrigem: false, faltaOficial: 500, faltaSombra: 0, tolerancia: 1 })).toBe("B→C");
    expect(classificarSituacao({ impossivelNaOrigem: false, faltaOficial: 500, faltaSombra: 200, tolerancia: 1 })).toBe("B→D");
  });
  it("faltaProjetada: pior elo da cadeia, gargalo e capacidade", () => {
    const e = mk(900, 700, 500);
    const f = faltaProjetada(e.pools, { "A|A-e1": 900, "B|B-e1": 700, "C|C-e1": 500 }, { "A|A-e1": 1000, "B|B-e1": 300, "C|C-e1": 0 });
    expect(f.porPool).toEqual({ "A|A-e1": 0, "B|B-e1": 400, "C|C-e1": 500 });
    expect(f.total).toBe(900);
    expect(f.gargalo).toEqual({ poolKey: "C|C-e1", falta: 500 });
    expect(f.capacidade).toBe(900 + 300);
  });
  it("tolerância = max(1; 1% do restante do acabado)", () => {
    const e = mk(900, 700, 500);
    expect(restanteAcabado(e.pools, { "A|A-e1": 900, "B|B-e1": 700, "C|C-e1": 500 })).toBe(2100);
    expect(toleranciaFalta(2100)).toBe(21);
    expect(toleranciaFalta(10)).toBe(1);
  });
  it("resumirRecuperacao: quanto recuperou e quanto de adicional/WIP foi cedido ao previsto", () => {
    const linha = (adic: number, tipo?: "intermediario" | "acabado"): AlocacaoEscala => ({ data: "d", periodoId: "m1", funcionarioId: "f", maquinaId: "m", produtoId: "A", etapaId: "A-e1", operacaoId: "o", pecas: 0, pecasAdicional: adic, tipoAdicional: tipo, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null });
    const r = resumirRecuperacao(800, 300, [linha(500, "acabado"), linha(200, "intermediario")], [linha(100, "acabado")]);
    expect(r).toMatchObject({ recuperado: 500, adicionalOficial: 700, adicionalSombra: 100, adicionalRetirado: 600, wipOficial: 200, wipSombra: 0 });
  });
});

describe("corte — NÃO usa informação futura", () => {
  const e = mk(900, 700, 500);
  const p = parametros(e, 3, 0.9);
  const base = executarCorteSombra(p);
  const comp = p.planoOficial.filter((a) => a.maquinaId && idx(e, a) === 4)[0];

  it("apontamentos de períodos posteriores ou lançados depois do corte não mudam a decisão", () => {
    const futuros = apontar(e, p.planoOficial, 8, 0.1).filter((a) => idx(e, a) > 3).map((a) => ({ ...a, boas: 1 }));
    const tardio = apontar(e, p.planoOficial, 3, 0.1).map((a) => ({ ...a, lancadoEmMs: p.corteMs + 60_000, boas: 7 }));
    const r = executarCorteSombra({ ...p, apontamentos: [...p.apontamentos, ...futuros, ...tardio] });
    expect(r.hashDecisao).toBe(base.hashDecisao);
    expect(r.restantePorPool).toEqual(base.restantePorPool);
    expect(r.visao.apontamentosUsados).toBe(base.visao.apontamentosUsados);
  });
  it("ausência registrada e indisponibilidade iniciada DEPOIS do corte são ignoradas; antes do corte, valem", () => {
    const posterior = executarCorteSombra({ ...p, ausencias: [{ funcionarioId: comp.funcionarioId, data: comp.data, inicioMin: null, fimMin: null, registradaEmMs: p.corteMs + 1 }], indisponibilidades: [{ maquinaId: comp.maquinaId as string, desdeMs: p.corteMs + 1, liberadaEmMs: null }] });
    expect(posterior.hashDecisao).toBe(base.hashDecisao);
    expect(posterior.horizonte.avaliacaoCompromisso.status).toBe(base.horizonte.avaliacaoCompromisso.status);
    const anterior = executarCorteSombra({ ...p, ausencias: [{ funcionarioId: comp.funcionarioId, data: comp.data, inicioMin: null, fimMin: null, registradaEmMs: p.corteMs - 1 }] });
    expect(anterior.horizonte.avaliacaoCompromisso.impedimentos).toHaveLength(1);
  });
  it("liberação da máquina POSTERIOR ao corte é desconhecida: continua indisponível", () => {
    const v = visaoNoCorte({ ...p, indisponibilidades: [{ maquinaId: "m1", desdeMs: p.corteMs - 10, liberadaEmMs: p.corteMs + 500 }] });
    expect(v.indisponibilidades[0].liberadaEmMs).toBeNull();
  });
  it("determinístico e idempotente", () => {
    const b = executarCorteSombra(p);
    expect(b.hashDecisao).toBe(base.hashDecisao);
    expect(JSON.stringify(b.horizonte.snapshot)).toBe(JSON.stringify(base.horizonte.snapshot));
  });
});

describe("corte — restante real, performance, horizonte e recuperação", () => {
  it("restante real desconta as boas; performance < 1 reduz a capacidade projetada; só o alterável (≥ c+2) é proposto", () => {
    const e = mk(900, 700, 500);
    const rapido = executarCorteSombra(parametros(e, 3, 1));
    const lento = executarCorteSombra(parametros(e, 3, 0.5));
    expect(lento.restanteAcabado).toBeGreaterThan(rapido.restanteAcabado);
    const k = Object.keys(lento.desempenho)[0];
    expect(lento.desempenho[k].f).toBeLessThan(1);
    expect(lento.desempenho[k].f).toBeGreaterThanOrEqual(0.3);
    expect(rapido.desempenho[k].f).toBeCloseTo(1, 10);
    expect(lento.horizonte.alteravel.every((a) => idx(e, a) >= 5)).toBe(true);
    expect(lento.horizonte.horizonte.primeiroAlteravel).toBe(5);
    expect(lento.horizonte.horizonte.comprometido).toBe(4);
  });
  it("comprometido válido chega intacto (hash do oficial); o original sempre fica no snapshot", () => {
    const e = mk(900, 700, 500);
    const p = parametros(e, 3, 0.9);
    const r = executarCorteSombra(p);
    const original = p.planoOficial.filter((a) => idx(e, a) === 4);
    expect(r.horizonte.avaliacaoCompromisso.status).toBe("compromisso_valido");
    expect(hashAlocacoes(r.horizonte.comprometidas)).toBe(hashAlocacoes(original));
    expect(r.horizonte.snapshot.hashComprometido).toBe(hashAlocacoes(original));
  });
  it("capacidade folgada + atraso real => B→C e a recuperação reduz a falta projetada", () => {
    const e = mk(300, 300, 300); // plano termina cedo, muita folga
    const r = executarCorteSombra(parametros(e, 2, 0)); // nada foi produzido de fato nos 3 primeiros períodos
    expect(r.situacao).toBe("B→C");
    expect(r.faltaOficial.total).toBeGreaterThan(r.faltaSombra.total);
    expect(r.recuperacao.recuperado).toBeGreaterThan(0);
    expect(r.horizonte.alteravel.every((a) => idx(e, a) >= 4)).toBe(true);
  });
  it("sem capacidade futura suficiente => B→D (nem a melhor escala válida fecha)", () => {
    const e = mk(1100, 1100, 1100);
    const r = executarCorteSombra(parametros(e, 9, 0)); // quase no fim da semana, nada produzido
    expect(r.situacao).toBe("B→D");
    expect(r.faltaSombra.total).toBeGreaterThan(0);
  });
  it("impossível na origem => A (mesmo que a execução esteja boa)", () => {
    const e = mk(900, 700, 500);
    expect(executarCorteSombra(parametros(e, 3, 1, { impossivelNaOrigem: true })).situacao).toBe("A");
  });
  it("plano em dia => OK", () => {
    const e = mk(300, 300, 300);
    const r = executarCorteSombra(parametros(e, 3, 1));
    expect(r.situacao).toBe("OK");
  });
});

describe("corte — compromisso e exposição incerta dentro da decisão", () => {
  it("ausência nova no comprometido: reparo mínimo registrado, postos vazios por inviabilidade contados à parte do revezamento", () => {
    const e = mk(900, 700, 500, 5); // equipe curta => pouca ociosa
    const p = parametros(e, 3, 0.9);
    const alvo = p.planoOficial.find((a) => a.maquinaId && idx(e, a) === 4)!;
    const r = executarCorteSombra({ ...p, ausencias: [{ funcionarioId: alvo.funcionarioId, data: alvo.data, inicioMin: null, fimMin: null, registradaEmMs: p.corteMs - 1 }] });
    const av = r.horizonte.avaliacaoCompromisso;
    expect(av.statusFisico).not.toBeNull();
    expect(r.postosVazios.inviavelNoComprometido + (av.postosPreservados ? 0 : 0)).toBe(av.postosVazios.filter((v) => v.causa === "inviavel").length);
    expect(r.horizonte.snapshot.hashComprometido).not.toBe(r.horizonte.snapshot.hashComprometidoReparado);
  });
  it("sem_producao com funcionário e sem vínculo: incerteza registrada e conflito conservador", () => {
    const e = mk(900, 700, 500);
    const p = parametros(e, 3, 0.9);
    const comp = p.planoOficial.find((a) => a.maquinaId && idx(e, a) === 4)!;
    // a mesma pessoa, no período 3, "sem produção" numa máquina da MESMA etapa do compromisso (sem vínculo oficial)
    const poolDoComp = e.pools.find((x) => x.produtoId === comp.produtoId)!;
    const outraMaq = poolDoComp.maquinasIds.find((m) => !p.planoOficial.some((a) => idx(e, a) === 3 && a.funcionarioId === comp.funcionarioId && a.maquinaId === m)) ?? poolDoComp.maquinasIds[0];
    const s3 = e.slots[3];
    const semProd: ApontamentoReal = { data: s3.data, periodoId: s3.periodoId, funcionarioId: comp.funcionarioId, maquinaId: outraMaq, produtoId: null, etapaId: null, operacaoId: null, boas: 0, refugo: 0, meta: 0, status: "sem_producao", motivo: "falta_material", lancadoEmMs: s3.fimMs + 60_000 };
    const aps = p.apontamentos.filter((a) => !(a.funcionarioId === comp.funcionarioId && a.periodoId === s3.periodoId && a.data === s3.data));
    const planoSemOficialDele = p.planoOficial.map((a) => (a.funcionarioId === comp.funcionarioId && idx(e, a) === 3 ? { ...a, maquinaId: "mX", operacaoId: "opQ" } : a)); // sem vínculo oficial inequívoco
    const r = executarCorteSombra({ ...p, apontamentos: [...aps, semProd], planoOficial: planoSemOficialDele });
    expect(r.incertezas.some((i) => i.tipo === "sem_producao_sem_vinculo" && i.funcionarioId === comp.funcionarioId)).toBe(true);
    const conf = r.horizonte.avaliacaoCompromisso.conflitos.find((c) => c.funcionarioId === comp.funcionarioId);
    expect(conf?.exposicaoIncerta).toBe(true);
  });
});

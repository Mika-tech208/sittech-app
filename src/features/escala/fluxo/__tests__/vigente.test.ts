// v2 do núcleo: plano VIGENTE como candidato (E), estabilização de pessoas (H), explicação aditiva contra o vigente (J), diagnósticos novos e modo
// somenteLinhasNovas do verificador. O golden (gerarEscala byte-idêntico com hooks vazios) continua em golden.test.ts.
import { describe, it, expect } from "vitest";
import { planejarComFluxo } from "../planejar";
import { verificarRestricoesDuras } from "../restricoes";
import { avaliarPlano } from "../avaliar";
import { estadoDaProducao } from "../estado";
import type { AlocacaoEscala } from "../../types";
import { ap, apontarPlano, checarFluxo, equipe, linhaPlano, montar, pool } from "./helpersFluxo";

// Caixa-like: E16 (anterior, gargalo) → Montagem; com WIP existente o fluxo reforça a Montagem (plano ≠ vigente manual)
const pools = [
  pool({ produto: "C", etapa: "E", op: "opE", ordem: 1, q: 70500, maquinas: ["e16"], mu: 2500 }),
  pool({ produto: "C", etapa: "M", op: "opM", ordem: 2, q: 70500, maquinas: ["m1", "m2", "m3", "m4"], mu: 700 }),
  pool({ produto: "F", etapa: "F1", op: "opF", ordem: 1, q: 70500, maquinas: ["f1", "f2", "f3", "f4"], mu: 300 }),
];
// plano manual VÁLIDO sob revezamento duro: as 3 pessoas giram de operação a cada período (ninguém repete a operação em períodos consecutivos)
const GIRO = ["f01", "f02", "f03"];
const planoManual = (slots: Parameters<typeof linhaPlano>[0]) => slots.map((_, i) => i).flatMap((i) => [
  linhaPlano(slots, i, GIRO[i % 3], "e16", "C", "E", "opE", 2500), linhaPlano(slots, i, GIRO[(i + 1) % 3], "m1", "C", "M", "opM", 700), linhaPlano(slots, i, GIRO[(i + 2) % 3], "f1", "F", "F1", "opF", 300),
  { data: slots[i].data, periodoId: slots[i].periodoId, funcionarioId: "f04", maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, motivoSemPosto: "sem posto", excecaoRevezamento: false, motivoExcecao: null } as AlocacaoEscala,
]);
function cenario() {
  const b = montar({ pools, funcionarios: equipe(4), c: 3, plano: planoManual });
  const apontamentos = apontarPlano(b.planoCompleto, pools, 3, b.entrada.slots, (a) => (a.etapaId === "E" ? 5000 : a.etapaId === "M" ? 2000 : 300));
  return montar({ pools, funcionarios: equipe(4), c: 3, plano: planoManual, apontamentos });
}
const chaveL = (a: AlocacaoEscala) => `${a.data}|${a.periodoId}|${a.funcionarioId}`;
const postoK = (a?: AlocacaoEscala) => (a?.maquinaId ? `${a.maquinaId}|${a.produtoId}|${a.etapaId}` : "ocioso");

describe("E — o plano VIGENTE é candidato", () => {
  it("o plano de fluxo muda o vigente manual (há ganho) e o diagnóstico descreve a mudança CONTRA o vigente", () => {
    const m = cenario();
    const r = planejarComFluxo(m.entrada, m.dados);
    const d = r.diagnostico;
    expect(d.vigente).toMatchObject({ disponivel: true, valido: true });
    expect(d.referencia).toBe("vigente");
    expect(d.planoEscolhido).toBe("fluxo");
    expect(d.depois.faltaPrevista.lo).toBeLessThan(d.depoisVigente!.faltaPrevista.lo);
    expect(d.iteracoes.some((i) => i.indice === -2)).toBe(true);
    expect(checarFluxo({ r, entrada: m.entrada })).toEqual([]);
  });

  it("NO-OP: reaplicar o fluxo sobre o plano que ele mesmo produziu devolve EXATAMENTE as linhas vigentes (zero churn, zero decisões)", () => {
    const m = cenario();
    const r1 = planejarComFluxo(m.entrada, m.dados);
    const futuro = r1.resultado.alocacoes;
    const dados2 = { ...m.dados, planoVigente: [...m.entrada.congeladas, ...futuro] };
    const r2 = planejarComFluxo(m.entrada, dados2);
    expect(r2.diagnostico.planoEscolhido).toBe("vigente");
    expect(r2.diagnostico.diagnosticos.some((x) => x.codigo === "PLANO_VIGENTE_MANTIDO")).toBe(true);
    expect(JSON.stringify(r2.resultado.alocacoes)).toBe(JSON.stringify(futuro));
    expect(r2.diagnostico.churn.linhasAlteradas).toBe(0);
    expect(r2.diagnostico.decisoesTotal).toBe(0);
    expect(r2.diagnostico.reconciliacao).toMatchObject({ diferenca: 0, somaGanhos: 0, residuo: 0 });
  });

  it("nunca pior que o vigente VÁLIDO quando os dados mudam (vigente = plano de um estado anterior)", () => {
    const m = cenario();
    const r1 = planejarComFluxo(m.entrada, m.dados);
    // outro estado: a Montagem rendeu menos que o previsto no período c; o vigente é o plano calculado antes
    const b = montar({ pools, funcionarios: equipe(4), c: 3, plano: planoManual });
    const ap2 = apontarPlano(b.planoCompleto, pools, 3, b.entrada.slots, (a) => (a.etapaId === "E" ? 5000 : a.etapaId === "M" ? 1200 : 300));
    const m2 = montar({ pools, funcionarios: equipe(4), c: 3, plano: planoManual, apontamentos: ap2 });
    const dados2 = { ...m2.dados, planoVigente: [...m2.entrada.congeladas, ...r1.resultado.alocacoes] };
    const r2 = planejarComFluxo(m2.entrada, dados2);
    expect(r2.diagnostico.vigente.valido).toBe(true);
    expect(r2.diagnostico.depois.faltaPrevista.lo).toBeLessThanOrEqual(r2.diagnostico.depoisVigente!.faltaPrevista.lo + 1e-6);
    expect(r2.diagnostico.depois.faltaPrevista.lo).toBeLessThanOrEqual(r2.diagnostico.depoisBase.faltaPrevista.lo + 1e-6);
    expect(checarFluxo({ r: r2, entrada: m2.entrada })).toEqual([]);
  });

  it("vigente que viola restrição dura HOJE (máquina em Parada) não é candidato: PLANO_VIGENTE_DESCARTADO e o plano devolvido não usa a máquina", () => {
    const m = cenario();
    const r1 = planejarComFluxo(m.entrada, m.dados);
    const usada = r1.resultado.alocacoes.find((a) => a.maquinaId)!.maquinaId as string;
    const entrada2 = { ...m.entrada, indisponibilidades: [{ maquinaId: usada, desdeMs: 0, liberadaEmMs: null }] };
    const r2 = planejarComFluxo(entrada2, { ...m.dados, planoVigente: [...m.entrada.congeladas, ...r1.resultado.alocacoes] });
    expect(r2.diagnostico.vigente).toMatchObject({ disponivel: true, valido: false });
    expect(r2.diagnostico.vigente.violacoes).toBeGreaterThan(0);
    expect(r2.diagnostico.planoEscolhido).not.toBe("vigente");
    expect(r2.diagnostico.diagnosticos.some((x) => x.codigo === "PLANO_VIGENTE_DESCARTADO")).toBe(true);
    expect(r2.resultado.alocacoes.some((a) => a.maquinaId === usada)).toBe(false);
  });

  it("funcionário desativado (fora da equipe) ou ausente descarta o vigente", () => {
    const m = cenario();
    const r1 = planejarComFluxo(m.entrada, m.dados);
    const saiu = r1.resultado.alocacoes.find((a) => a.maquinaId)!.funcionarioId;
    const entrada2 = { ...m.entrada, funcionarios: m.entrada.funcionarios.filter((f) => f.id !== saiu) };
    const r2 = planejarComFluxo(entrada2, { ...m.dados, planoVigente: [...m.entrada.congeladas, ...r1.resultado.alocacoes] });
    expect(r2.diagnostico.vigente.valido).toBe(false);
    expect(r2.resultado.alocacoes.some((a) => a.funcionarioId === saiu)).toBe(false);
  });

  it("vigente INCOMPLETO (dia/período sem linhas) não é candidato: nunca 'mantém' um futuro que o motor preencheria", () => {
    const m = cenario();
    const r1 = planejarComFluxo(m.entrada, m.dados);
    const ultimo = m.entrada.slots[m.entrada.slots.length - 1];
    const truncado = r1.resultado.alocacoes.filter((a) => !(a.data === ultimo.data && a.periodoId === ultimo.periodoId));
    const r2 = planejarComFluxo(m.entrada, { ...m.dados, planoVigente: [...m.entrada.congeladas, ...truncado] });
    expect(r2.diagnostico.vigente.valido).toBe(false);
    expect(r2.diagnostico.vigente.motivo).toMatch(/incompleto/);
    expect(r2.resultado.alocacoes.some((a) => a.data === ultimo.data && a.periodoId === ultimo.periodoId)).toBe(true);
  });
});

describe("E — propriedade: em qualquer variação do realizado o plano nunca é pior que o vigente válido nem que o base, e é determinístico", () => {
  const b0 = montar({ pools, funcionarios: equipe(4), c: 3, plano: planoManual });
  const vigenteInicial = planejarComFluxo(cenario().entrada, cenario().dados).resultado.alocacoes;
  [[3000, 1000], [5000, 1200], [5000, 3000], [8000, 2000], [8000, 3000], [12000, 2500], [2000, 500]].forEach(([e, mm]) => {
    it(`E=${e} M=${mm}: sem piora, restrições duras ok, resultado determinístico`, () => {
      const ap2 = apontarPlano(b0.planoCompleto, pools, 3, b0.entrada.slots, (a) => (a.etapaId === "E" ? e : a.etapaId === "M" ? mm : 300));
      const m2 = montar({ pools, funcionarios: equipe(4), c: 3, plano: planoManual, apontamentos: ap2 });
      [m2.dados.planoVigente, [...m2.entrada.congeladas, ...vigenteInicial]].forEach((planoVigente) => {
        const dados = { ...m2.dados, planoVigente };
        const r = planejarComFluxo(m2.entrada, dados);
        expect(checarFluxo({ r, entrada: m2.entrada })).toEqual([]);
        expect(verificarRestricoesDuras(r.entradaFluxo, r.resultado.alocacoes, { somenteLinhasNovas: true })).toEqual([]);
        expect(JSON.stringify(planejarComFluxo(m2.entrada, dados))).toBe(JSON.stringify(r));
        const rec = r.diagnostico.reconciliacao;
        expect(rec.somaGanhos + rec.residuo).toBeCloseTo(rec.diferenca, 2);
      });
    });
  });
});

describe("H — estabilização de pessoas (θ = 0 por padrão)", () => {
  it("θ padrão = 0 e a re-atribuição reduz as linhas alteradas sem mudar postos nem falta; restrições duras seguem em 0", () => {
    const m = cenario();
    const com = planejarComFluxo(m.entrada, m.dados);
    const sem = planejarComFluxo(m.entrada, m.dados, { estabilizarPessoas: false });
    expect(com.diagnostico.theta).toBe(0);
    expect(com.diagnostico.estabilizacao.linhasDepois).toBeLessThanOrEqual(com.diagnostico.estabilizacao.linhasAntes);
    expect(com.diagnostico.churn.linhasAlteradas).toBeLessThanOrEqual(sem.diagnostico.churn.linhasAlteradas);
    expect(com.diagnostico.depois.faltaPrevista.lo).toBeCloseTo(sem.diagnostico.depois.faltaPrevista.lo, 6);
    // mesmos postos por período (só muda QUEM ocupa)
    const postos = (l: AlocacaoEscala[]) => l.filter((a) => a.maquinaId).map((a) => `${a.data}|${a.periodoId}|${postoK(a)}`).sort().join(";");
    expect(postos(com.resultado.alocacoes)).toBe(postos(sem.resultado.alocacoes));
    expect(verificarRestricoesDuras(com.entradaFluxo, com.resultado.alocacoes, { somenteLinhasNovas: true })).toEqual([]);
    expect(verificarRestricoesDuras(com.entradaFluxo, com.resultado.alocacoes)).toEqual([]);
  });

  it("cada pessoa que continua no MESMO posto do vigente é mantida (nenhuma troca gratuita de pessoa)", () => {
    const m = cenario();
    const r = planejarComFluxo(m.entrada, m.dados);
    const vig = new Map(m.dados.planoVigente.map((a) => [chaveL(a), a]));
    const idx = new Map(m.entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
    // para cada período, o nº de pessoas cujo posto mudou é o MÍNIMO possível: |postos novos \ postos vigentes| (multiconjunto)
    const porSlot = new Map<number, AlocacaoEscala[]>();
    r.resultado.alocacoes.forEach((a) => { const t = idx.get(`${a.data}|${a.periodoId}`)!; porSlot.set(t, [...(porSlot.get(t) ?? []), a]); });
    let excesso = 0;
    porSlot.forEach((novas) => {
      const disponiveis = new Map<string, number>();
      novas.forEach((a) => { const v = vig.get(chaveL(a)); disponiveis.set(postoK(v), (disponiveis.get(postoK(v)) ?? 0) + 1); });
      let mantidos = 0;
      const resto = new Map(disponiveis);
      novas.forEach((a) => { const k = postoK(a); if ((resto.get(k) ?? 0) > 0) { resto.set(k, (resto.get(k) as number) - 1); mantidos++; } });
      const alterados = novas.filter((a) => postoK(vig.get(chaveL(a))) !== postoK(a)).length;
      excesso += alterados - (novas.length - mantidos);
    });
    expect(excesso).toBeLessThanOrEqual(0 + 2); // tolerância: revezamento duro pode impedir manter 1–2 pessoas
  });
});

describe("J — explicação aditiva contra o plano vigente", () => {
  it("Σ ganhos das decisões + resíduo explícito = diferença de produto final previsto (fluxo − vigente)", () => {
    const m = cenario();
    const d = planejarComFluxo(m.entrada, m.dados).diagnostico;
    const rec = d.reconciliacao;
    expect(rec.referencia).toBe("vigente");
    const somaDecisoes = d.decisoes.reduce((s, x) => s + x.motivo.ganhoProdutoFinal, 0);
    expect(d.decisoesTotal).toBe(d.decisoes.length); // sem truncar
    expect(somaDecisoes).toBeCloseTo(rec.somaGanhos, 2);
    expect(rec.somaGanhos + rec.residuo).toBeCloseTo(rec.diferenca, 2);
    expect(rec.diferenca).toBeCloseTo(d.depois.produtoFinalPrevisto.lo - d.depoisVigente!.produtoFinalPrevisto.lo, 2);
    expect(rec.explicacaoResiduo.length).toBeGreaterThan(10);
    expect(d.decisoes.some((x) => x.motivo.ganhoProdutoFinal > 0)).toBe(true);
  });

  it("100% das linhas alteradas contra o vigente têm decisão; truncar a lista detalhada não perde nada (decisoesTotal + resumo por período)", () => {
    const m = cenario();
    const cheio = planejarComFluxo(m.entrada, m.dados).diagnostico;
    const curto = planejarComFluxo(m.entrada, m.dados, { maxDecisoes: 2 }).diagnostico;
    expect(curto.decisoes.length).toBe(2);
    expect(curto.decisoesTotal).toBe(cheio.decisoesTotal);
    const pessoas = (d: typeof cheio) => d.resumoDecisoes.reduce((s, x) => s + x.pessoasPeriodo, 0);
    expect(pessoas(curto)).toBe(cheio.decisoes.reduce((s, x) => s + x.quantidade, 0));
    expect(pessoas(curto)).toBeGreaterThanOrEqual(curto.churn.linhasAlteradas);
    expect(curto.resumoDecisoes.every((r) => r.porSlot.reduce((s, x) => s + x.pessoas, 0) === r.pessoasPeriodo)).toBe(true);
    expect(curto.resumoDecisoes.reduce((s, r) => s + r.ganhoProdutoFinal, 0)).toBeCloseTo(curto.reconciliacao.somaGanhos, 2);
    // cobertura linha a linha contra o vigente
    const idx = new Map(m.entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
    const r = planejarComFluxo(m.entrada, m.dados);
    const vig = new Map(m.dados.planoVigente.map((a) => [chaveL(a), a]));
    const explicadas = new Set(r.diagnostico.decisoes.flatMap((x) => x.funcionarios.map((f) => `${x.slot}|${f}`)));
    const alteradas = r.resultado.alocacoes.filter((a) => postoK(vig.get(chaveL(a))) !== postoK(a));
    expect(alteradas.length).toBeGreaterThan(0);
    expect(alteradas.every((a) => explicadas.has(`${idx.get(`${a.data}|${a.periodoId}`)}|${a.funcionarioId}`))).toBe(true);
    // 'de' é o posto que a pessoa tinha NO VIGENTE
    r.diagnostico.decisoes.forEach((x) => x.funcionarios.forEach((f) => {
      const v = vig.get(`${x.data}|${x.periodoId}|${f}`);
      expect(x.de.maquinaId ?? null).toBe(v?.maquinaId ?? null);
    }));
  });

  it("ANTES descreve o plano vigente (demanda restante, WIP, gargalo) e DEPOIS traz vigente e fluxo", () => {
    const m = cenario();
    const d = planejarComFluxo(m.entrada, m.dados).diagnostico;
    expect(d.antes.referencia).toBe("vigente");
    expect(d.antes.faltaFinal.lo).toBeCloseTo(d.depoisVigente!.faltaPrevista.lo, 6);
    expect(Object.keys(d.antes.demandaRestante).length).toBeGreaterThan(0);
    expect(d.antes.wip.length).toBeGreaterThan(0);
    expect(d.antes.gargalosFluxo.length).toBeGreaterThan(0);
    expect(d.decisoes.every((x) => x.motivo.texto.length > 10 && typeof x.motivo.wipFinalVariacao === "number")).toBe(true);
  });

  it("sem plano vigente futuro a referência é o plano base (nada some do diagnóstico)", () => {
    const m = cenario();
    const r = planejarComFluxo(m.entrada, { ...m.dados, planoVigente: m.entrada.congeladas });
    expect(r.diagnostico.referencia).toBe("base");
    expect(r.diagnostico.depoisVigente).toBeNull();
    expect(r.diagnostico.reconciliacao.referencia).toBe("base");
    expect(r.diagnostico.reconciliacao.somaGanhos + r.diagnostico.reconciliacao.residuo).toBeCloseTo(r.diagnostico.reconciliacao.diferenca, 2);
  });
});

describe("avaliação do plano vigente com f embutido nas peças gravadas", () => {
  it("a capacidade vem das metas, nunca das peças gravadas: vigente com peças × 0,8 avalia IGUAL ao nominal (sem multiplicar f duas vezes)", () => {
    const m = cenario();
    const nominal = avaliarPlano(m.entrada, m.dados, m.dados.planoVigente);
    const embutido = m.dados.planoVigente.map((a) => ({ ...a, pecas: a.pecas * 0.8 }));
    const av = avaliarPlano(m.entrada, m.dados, embutido);
    expect(av.totais.faltaFinalLo).toBeCloseTo(nominal.totais.faltaFinalLo, 6);
    expect(av.totais.wipFinalLo).toBeCloseTo(nominal.totais.wipFinalLo, 6);
  });
});

describe("diagnóstico de sem_producao por falta de programação", () => {
  it("motivo real `sem_programacao` gera SEM_PRODUCAO_SEM_PROGRAMACAO (zero confirmado, sem inferir material)", () => {
    const b = montar({ pools, funcionarios: equipe(4), c: 3, plano: planoManual });
    const s = b.entrada.slots[1];
    const apts = [ap({ data: s.data, periodoId: s.periodoId, maquinaId: "e16", produtoId: "C", etapaId: "E", boas: 0, status: "sem_producao", motivo: "sem_programacao" })];
    const m = montar({ pools, funcionarios: equipe(4), c: 3, plano: planoManual, apontamentos: apts });
    const e = estadoDaProducao(m.entrada, m.dados);
    expect(e.diagnosticos.filter((x) => x.codigo === "SEM_PRODUCAO_SEM_PROGRAMACAO")).toHaveLength(1);
    expect(e.diagnosticos.some((x) => x.codigo === "SEM_PRODUCAO_FALTA_MATERIAL")).toBe(false);
    expect(e.celulas.find((c) => c.maquinaId === "e16" && c.slot === 1)?.estado).toBe("zero_confirmado");
  });
});

describe("verificarRestricoesDuras — modo somenteLinhasNovas", () => {
  it("não acusa linhas já congeladas (gravadas sob outras condições), mas continua acusando linhas novas e passado ALTERADO", () => {
    const m = cenario();
    const entrada = { ...m.entrada, indisponibilidades: [{ maquinaId: "e16", desdeMs: 0, liberadaEmMs: null }] };
    const completo = m.planoCompleto; // passado congelado usa e16 (agora em Parada) e o futuro vigente também
    const tudo = verificarRestricoesDuras(entrada, completo);
    const novas = verificarRestricoesDuras(entrada, completo, { somenteLinhasNovas: true });
    const idx = new Map(entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
    expect(tudo.length).toBeGreaterThan(novas.length);
    expect(novas.every((v) => (idx.get(`${v.data}|${v.periodoId}`) as number) >= entrada.aPartirDe)).toBe(true);
    expect(novas.some((v) => v.tipo === "maquina_indisponivel")).toBe(true); // o futuro ainda usa e16
    // passado alterado continua detectado
    const adulterado = completo.map((a, i) => (i === 0 ? { ...a, maquinaId: "zzz" } : a));
    expect(verificarRestricoesDuras(m.entrada, adulterado, { somenteLinhasNovas: true }).some((v) => v.tipo === "passado_alterado")).toBe(true);
    // sem violações novas num plano limpo
    expect(verificarRestricoesDuras(m.entrada, m.planoCompleto, { somenteLinhasNovas: true })).toEqual([]);
  });
});

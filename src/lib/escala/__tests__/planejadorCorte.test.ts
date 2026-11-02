// PLANEJADOR DE CORTE — integração com o recálculo oficial (semana ATIVADA). O motor LEGADO (`gerarEscala`) está BLOQUEADO neste arquivo: se qualquer caminho o chamar, o teste quebra.
// Cobre: geração e recálculo pelo planejador; ausência (10→9); produção real maior/menor; passado nunca reescrito; ≤ pessoas; cadeia/material; revezamento de bloco + ponte;
// distribuição por produto íntegra (Σ = peças da linha) com PK/máquina únicas; falha ⇒ plano vigente mantido (nunca legado); semana não ativada intocada.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/features/escala/gerarEscala", async (orig) => {
  const real = await orig<typeof import("@/features/escala/gerarEscala")>();
  return { ...real, gerarEscala: () => { throw new Error("MOTOR LEGADO (gerarEscala) CHAMADO NUMA SEMANA ATIVADA NO PLANEJADOR DE CORTE"); }, gerarEscalaReal: real.gerarEscala };
});

import * as gerarModulo from "@/features/escala/gerarEscala";
import { lerParametros } from "@/features/escala/parametros";
import { expandirPorProduto, distribuicaoEfetiva, validarDistribuicao } from "@/features/escala/distribuicao";
import { verificarRestricoesDuras } from "@/features/escala/fluxo/restricoes";
import { montarProblemaCorte, repartirApontamentosCompartilhados } from "@/features/escala/fluxo/planoCorte";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala } from "@/features/escala/types";
import { chavePool } from "@/features/escala/types";
import { montarEntradaEscala } from "../montarEntrada";
import { Mundo, estadoDeTeste } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const GERA = epochMsNoFuso("2026-11-02", "18:00"); // véspera: nada começou
const T1_DIA3 = epochMsNoFuso("2026-11-03", "12:50"); // M1–M3 de 03/11 fechados; T1 é o 1º livre
const CFG = { objetivo: "EQUILIBRIO" as const, busca: { iter: 30000, reinicios: 1, semente: 1 }, buscaComVigente: { iter: 15000, reinicios: 1, semente: 1 } };
const legado = (gerarModulo as unknown as { gerarEscalaReal: typeof gerarModulo.gerarEscala }).gerarEscalaReal;

function mundo(pessoas = 10, planejador = true) {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS, { pessoas }));
  m.editar((e) => {
    e.parametros = { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true };
    e.producaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: [], apontamentos: [], mesmoPeriodo: false };
    if (planejador) e.planejadorCorte = { config: CFG, vigenteDoPlanejador: false, distribuicaoSuportada: true };
  });
  return m;
}
const ultimoPlanejador = (m: Mundo) => m.registrosFluxo[m.registrosFluxo.length - 1];
const pessoasNoSlot = (m: Mundo, data: string, periodoId: string) => m.alocacoes.filter((a) => a.data === data && a.periodoId === periodoId);
const passado = (m: Mundo, ateMs: number) => {
  const { entrada } = montarEntradaEscala({ ...m.entradas, diasExistentes: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: d.snapshot })), alocacoes: [] }, ateMs);
  const idx = new Map(entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  return JSON.stringify(m.alocacoes.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? 0) < entrada.aPartirDe).sort((x, y) => (x.data + x.periodoId + x.funcionarioId < y.data + y.periodoId + y.funcionarioId ? -1 : 1)));
};
function estadoAtual(m: Mundo, agora: number) {
  const estado = { ...m.entradas, diasExistentes: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: d.snapshot })), alocacoes: m.alocacoes.map((a) => ({ ...a })) };
  return { estado, montada: montarEntradaEscala(estado, agora) };
}
// auditoria independente do plano gravado (futuro): verificador de restrições duras da entrada real + cadeia por produto com lote de 1 período
function auditar(m: Mundo, agora: number) {
  const { estado, montada } = estadoAtual(m, agora);
  const e = montada.entrada;
  const idx = new Map(e.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const futuras = m.alocacoes.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= e.aPartirDe);
  const duras = verificarRestricoesDuras(e, futuras, { somenteLinhasNovas: true });
  const porSlot = new Map<number, number>();
  futuras.forEach((a) => { if (a.maquinaId) porSlot.set(idx.get(`${a.data}|${a.periodoId}`)!, (porSlot.get(idx.get(`${a.data}|${a.periodoId}`)!) ?? 0) + 1); });
  const excedePessoas = e.slots.filter((s) => s.indice >= e.aPartirDe).filter((s) => (porSlot.get(s.indice) ?? 0) > e.funcionarios.length - e.ausencias.filter((x) => x.data === s.data).length).length;
  // distribuição íntegra + máquina da Previsão por item
  const poolPor = new Map(e.pools.map((p) => [chavePool(p.produtoId, p.etapaId), p]));
  let distRuim = 0, foraPrevisao = 0;
  m.alocacoes.forEach((a) => {
    distRuim += validarDistribuicao(a).length;
    (distribuicaoEfetiva(a) ?? (a.maquinaId ? [{ produtoId: a.produtoId!, etapaId: a.etapaId!, pecas: a.pecas }] : [])).forEach((it) => { if (!poolPor.get(chavePool(it.produtoId, it.etapaId))?.maquinasIds.includes(a.maquinaId!)) foraPrevisao++; });
  });
  // cadeia (lote de 1 período): produção de Tn só existe para a etapa seguinte em Tn+1; partindo do WIP real do corte
  const prods = [...new Set(e.pools.map((p) => p.produtoId))];
  let semMaterial = 0;
  void estado;
  prods.forEach((pid) => {
    const ps = e.pools.filter((p) => p.produtoId === pid).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
    for (let k = 1; k < ps.length; k++) {
      let estoque = 0; // WIP inicial 0 nos testes (sem contagem)
      e.slots.filter((s) => s.indice >= e.aPartirDe).forEach((s) => {
        const prod = (et: string) => expandirPorProduto(futuras).filter((a) => a.data === s.data && a.periodoId === s.periodoId && a.produtoId === pid && a.etapaId === et).reduce((x, a) => x + a.pecas, 0);
        const sai = prod(ps[k].etapaId);
        if (sai > estoque + 1e-6) semMaterial++;
        estoque = Math.max(0, estoque - sai) + prod(ps[k - 1].etapaId);
      });
    }
  });
  return { duras: duras.length, excedePessoas, distRuim, foraPrevisao, semMaterial, futuras };
}

describe("PLANEJADOR DE CORTE: a semana ativada é gerada e recalculada SEM o motor legado", () => {
  it("geração: plano válido, cadeia sem material, ≤ pessoas, distribuição íntegra; registrado como corte-v1", async () => {
    const m = mundo();
    const r = await m.recalcular(GERA, true);
    expect(r.status).toBe("processado");
    expect(m.alocacoes.length).toBeGreaterThan(0);
    const a = auditar(m, GERA);
    expect(a.duras).toBe(0);
    expect(a.excedePessoas).toBe(0);
    expect(a.distRuim).toBe(0);
    expect(a.foraPrevisao).toBe(0);
    expect(a.semMaterial).toBe(0);
    expect(ultimoPlanejador(m).avaliacaoFluxo).toMatchObject({ motor: "corte-v1", usado: true });
    expect(ultimoPlanejador(m).resultado).toBe("ok");
    // 1 linha por pessoa disponível por período (nenhuma duplicada)
    const chaves = m.alocacoes.map((x) => `${x.data}|${x.periodoId}|${x.funcionarioId}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("ausência 10→9 durante 03/11 NÃO volta ao legado: recalcula só o futuro, ausente sem posto, passado idêntico, plano diferente do que o legado faria", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const antes = passado(m, T1_DIA3);
    m.editar((e) => { e.ausencias.push({ funcionarioId: "f03", data: "2026-11-03", horarioInicio: "13:00:00", horarioFim: null }); }); // some a partir de T1 (ausência com janela aberta até o fim do dia)
    const r = await m.recalcular(T1_DIA3);
    expect(r.status).toBe("processado");
    expect(passado(m, T1_DIA3)).toBe(antes); // passado nunca reescrito
    const t1 = pessoasNoSlot(m, "2026-11-03", "t1");
    expect(t1.some((x) => x.funcionarioId === "f03")).toBe(false); // a ausente nem tem linha
    expect(t1.length).toBe(9);
    const a = auditar(m, T1_DIA3);
    expect(a.duras).toBe(0);
    expect(a.excedePessoas).toBe(0);
    expect(a.semMaterial).toBe(0);
    expect(a.distRuim).toBe(0);
    expect(ultimoPlanejador(m).avaliacaoFluxo).toMatchObject({ motor: "corte-v1", usado: true });
    // contra-prova: o motor legado, com as mesmas entradas, produziria OUTRO plano (o do planejador não é o legado)
    const { montada } = estadoAtual(m, T1_DIA3);
    const leg = legado(montada.entrada);
    const chave = (l: AlocacaoEscala[]) => JSON.stringify(l.map((x) => [x.data, x.periodoId, x.funcionarioId, x.maquinaId, x.produtoId, x.pecas]).sort());
    expect(chave(leg.alocacoes)).not.toBe(chave(a.futuras));
  });

  it("produção real MAIOR/MENOR dos períodos fechados muda a demanda restante e o WIP do planejador (nunca reescreve o passado)", () => {
    const m = mundo();
    const { montada, estado } = estadoAtual(m, T1_DIA3);
    void estado;
    const e = montada.entrada;
    const final = e.pools.filter((p) => p.produtoId === "pC")[0]; // pC tem 1 etapa: produção real reduz a demanda restante
    const apont = (boas: number): ApontamentoReal => ({ data: "2026-11-03", periodoId: "m1", funcionarioId: null, maquinaId: final.maquinasIds[0], produtoId: "pC", etapaId: final.etapaId, operacaoId: final.operacaoId, boas, refugo: 0, meta: 60, status: "produzindo", motivo: null, lancadoEmMs: epochMsNoFuso("2026-11-03", "09:00") });
    const dem = (boas: number) => {
      const dados = { apontamentos: boas > 0 ? [apont(boas)] : [], agoraMs: T1_DIA3, planoVigente: [] as AlocacaoEscala[] };
      return montarProblemaCorte(e, dados, { fluxoMesmoPeriodo: false }, CFG, []).entradaPlanejador.produtos.find((p) => p.id === "pC")!.demandaFinal;
    };
    const base = dem(0), maior = dem(400), menor = dem(50);
    expect(maior).toBeLessThan(menor);
    expect(menor).toBeLessThan(base);
    expect(base - maior).toBe(400);
    expect(base - menor).toBe(50);
    // produção real de upstream maior ⇒ WIP inicial do downstream maior (a etapa 2 de pA parte com mais estoque)
    const eA1 = e.pools.find((p) => p.etapaId === "eA1")!;
    const apA = (boas: number): ApontamentoReal => ({ ...apont(boas), maquinaId: eA1.maquinasIds[0], produtoId: "pA", etapaId: "eA1", operacaoId: eA1.operacaoId });
    const wip = (boas: number) => montarProblemaCorte(e, { apontamentos: [apA(boas)], agoraMs: T1_DIA3, planoVigente: [] }, { fluxoMesmoPeriodo: false }, CFG, []).entradaPlanejador.produtos.find((p) => p.id === "pA")!.wipInicial[0];
    expect(wip(300)).toBeGreaterThan(wip(100));
  });

  it("produção real maior no meio da semana ⇒ recálculo com menos produção futura do produto; passado idêntico; ainda corte-v1", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const antes = passado(m, T1_DIA3);
    const futuroAntes = auditar(m, T1_DIA3).futuras;
    const { montada } = estadoAtual(m, T1_DIA3);
    const pC = montada.entrada.pools.find((p) => p.produtoId === "pC")!;
    // lança produção real ENORME de pC em M1 (acima da demanda semanal) ⇒ demanda restante 0 ⇒ nenhuma produção futura de pC
    m.editar((e) => {
      e.producaoReal!.apontamentos.push({ data: "2026-11-03", periodoId: "m1", funcionarioId: null, maquinaId: pC.maquinasIds[0], produtoId: "pC", etapaId: pC.etapaId, operacaoId: pC.operacaoId, boas: 5000, refugo: 0, meta: 60, status: "produzindo", motivo: null, lancadoEmMs: epochMsNoFuso("2026-11-03", "09:00") });
    });
    await m.recalcular(T1_DIA3);
    expect(passado(m, T1_DIA3)).toBe(antes);
    const depois = auditar(m, T1_DIA3);
    const pcFuturoAntes = futuroAntes.filter((a) => a.produtoId === "pC" && a.maquinaId).length;
    const pcFuturoDepois = depois.futuras.filter((a) => a.produtoId === "pC" && a.maquinaId).length;
    expect(pcFuturoAntes).toBeGreaterThan(0);
    expect(pcFuturoDepois).toBe(0);
    expect(depois.duras).toBe(0);
    expect(depois.semMaterial).toBe(0);
  });

  it("recálculo repetido sem mudança é NO-OP (determinístico: nenhuma versão sobe)", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const apl = m.aplicacoes;
    const r = await m.recalcular(T1_DIA3);
    // o primeiro recálculo após a geração pode mudar o corte do que é futuro; o segundo, com as MESMAS entradas, não pode gravar nada
    const apl2 = m.aplicacoes;
    const r2 = await m.recalcular(T1_DIA3);
    expect(r2.status).toBe("sem_alteracao");
    expect(m.aplicacoes).toBe(apl2);
    void r; void apl;
  });

  it("falha do planejador: plano vigente MANTIDO + alerta, motor legado NUNCA chamado", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const futuroAntes = JSON.stringify(auditar(m, T1_DIA3).futuras);
    m.editar((e) => { e.ausencias.push({ funcionarioId: "f04", data: "2026-11-04", horarioInicio: null, horarioFim: null }); });
    const r = await m.recalcular(T1_DIA3, false, { planejadorCorte: () => { throw new Error("planejador indisponível"); } });
    expect(r.status).toBe("processado"); // grava o MESMO plano com o motivo (alerta novo)
    expect(JSON.stringify(auditar(m, T1_DIA3).futuras)).toBe(futuroAntes);
    expect(r.alertas.some((a) => (a as { tipo?: string }).tipo === "planejador_corte_falhou")).toBe(true);
    expect(ultimoPlanejador(m).resultado).toBe("fallback");
    expect(ultimoPlanejador(m).avaliacaoFluxo).toMatchObject({ usado: false });
    // a mesma falha de novo é NO-OP (assinatura de alertas igual)
    const r2 = await m.recalcular(T1_DIA3, false, { planejadorCorte: () => { throw new Error("planejador indisponível"); } });
    expect(r2.status).toBe("sem_alteracao");
  });

  it("pré-condição ausente (coluna distribuicao / Produção Real): plano mantido, sem planejar", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const futuroAntes = JSON.stringify(auditar(m, T1_DIA3).futuras);
    m.editar((e) => { e.planejadorCorte = { ...e.planejadorCorte!, distribuicaoSuportada: false, indisponivel: "coluna distribuicao ausente" }; e.ausencias.push({ funcionarioId: "f05", data: "2026-11-05", horarioInicio: null, horarioFim: null }); });
    const r = await m.recalcular(T1_DIA3);
    expect(JSON.stringify(auditar(m, T1_DIA3).futuras)).toBe(futuroAntes);
    expect(r.alertas.some((a) => (a as { tipo?: string }).tipo === "planejador_corte_falhou")).toBe(true);
  });

  it("revezamento de bloco + ponte M3→T1: 0 violações em toda a semana gerada", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const { montada } = estadoAtual(m, GERA);
    const v = verificarRestricoesDuras(montada.entrada, m.alocacoes, { somenteLinhasNovas: true });
    expect(v.filter((x) => x.tipo === "revezamento").length).toBe(0);
    expect(v.length).toBe(0);
  });
});

describe("A2 — orçamento de tempo: estourou ⇒ plano vigente mantido + alerta; nunca grava parcial", () => {
  it("orçamento forçado ao mínimo num recálculo: plano idêntico, alerta explícito, motor legado nunca chamado", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const futuroAntes = JSON.stringify(auditar(m, T1_DIA3).futuras);
    m.editar((e) => { e.planejadorCorte = { ...e.planejadorCorte!, config: { ...CFG, orcamentoMs: -1 } }; e.ausencias.push({ funcionarioId: "f04", data: "2026-11-04", horarioInicio: null, horarioFim: null }); });
    const r = await m.recalcular(T1_DIA3);
    expect(JSON.stringify(auditar(m, T1_DIA3).futuras)).toBe(futuroAntes);
    const alerta = r.alertas.find((a) => (a as { tipo?: string }).tipo === "planejador_corte_falhou") as { motivo?: string } | undefined;
    expect(alerta?.motivo).toMatch(/or[cç]amento de tempo estourado/i);
    expect(ultimoPlanejador(m).avaliacaoFluxo).toMatchObject({ usado: false });
  });

  it("relógio injetado: o orçamento é medido e cada tentativa registra `ms`; estourado ⇒ ok:false, sem resultado", async () => {
    const m = mundo();
    const { montada } = estadoAtual(m, GERA);
    const e = montada.entrada;
    let agora = 0;
    const { planejarSemanaComCorte } = await import("@/features/escala/fluxo/planoCorte");
    const dados = { apontamentos: [], agoraMs: GERA, planoVigente: [] as AlocacaoEscala[] };
    const lento = planejarSemanaComCorte(e, dados, { fluxoMesmoPeriodo: false }, { ...CFG, orcamentoMs: 50, relogio: () => (agora += 100) }, []);
    expect(lento.ok).toBe(false);
    expect(lento.resultado).toBeNull();
    expect(lento.motivo).toMatch(/or[cç]amento/i);
    expect(lento.tentativas.every((t) => typeof t.ms === "number")).toBe(true);
    agora = 0;
    const folgado = planejarSemanaComCorte(e, dados, { fluxoMesmoPeriodo: false }, { ...CFG, orcamentoMs: 1e12, relogio: () => (agora += 1) }, []);
    expect(folgado.ok).toBe(true);
    expect(folgado.tentativas[0].ms).toBeGreaterThan(0);
  });

  it("geração da semana com o planejador indisponível e SEM plano vigente: não grava linhas vazias nem usa o legado — falha o evento", async () => {
    const m = mundo();
    m.editar((e) => { e.planejadorCorte = { ...e.planejadorCorte!, config: { ...CFG, orcamentoMs: -1 } }; });
    await expect(m.recalcular(GERA, true)).rejects.toThrow(/planejador de corte indispon/i);
    expect(m.alocacoes.length).toBe(0);
  });
});

describe("outros eventos e estabilidade", () => {
  it("parada de máquina no futuro: o planejador recalcula e nenhuma linha usa a máquina parada", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const usada = m.alocacoes.find((a) => a.data === "2026-11-05" && a.maquinaId)!.maquinaId!;
    m.editar((e) => { e.indisponibilidades.push({ maquinaId: usada, desde: epochMsNoFuso("2026-11-02", "19:00") ? new Date("2026-11-02T22:00:00Z").toISOString() : "", liberadaEm: null }); });
    await m.recalcular(epochMsNoFuso("2026-11-02", "19:30"));
    expect(m.alocacoes.some((a) => a.maquinaId === usada)).toBe(false);
    expect(auditar(m, epochMsNoFuso("2026-11-02", "19:30")).duras).toBe(0);
    expect(ultimoPlanejador(m).avaliacaoFluxo).toMatchObject({ motor: "corte-v1", usado: true });
  });

  it("evento COM período em andamento (M2 de 03/11 rodando): corte no próximo período não iniciado; M1–M2 congelados; checagens do planejador todas zeradas", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const meio = epochMsNoFuso("2026-11-03", "09:30"); // M2 em andamento (08:48–10:24); M3 é o primeiro livre
    const antes = passado(m, meio);
    m.editar((e) => { e.ausencias.push({ funcionarioId: "f02", data: "2026-11-03", horarioInicio: "10:24:00", horarioFim: null }); }); // some a partir de M3
    const r = await m.recalcular(meio);
    expect(r.status).toBe("processado");
    expect(passado(m, meio)).toBe(antes);
    const ck = (ultimoPlanejador(m).avaliacaoFluxo as { checagens: Record<string, number> }).checagens;
    expect(ck).toMatchObject({ cadeiaInvalida: 0, semMaterial: 0, violacoesDuras: 0, maquinaForaDaPrevisao: 0, distribuicaoInvalida: 0, excedePessoas: 0, passadoAlterado: 0, duplicidade: 0 });
    expect(pessoasNoSlot(m, "2026-11-03", "m3").some((x) => x.funcionarioId === "f02")).toBe(false);
    expect(pessoasNoSlot(m, "2026-11-03", "m2").some((x) => x.funcionarioId === "f02")).toBe(true); // período em andamento: intocado
    expect(auditar(m, meio).duras).toBe(0);
  });

  it("ausência PESADA (7 de 10 pessoas na tarde de 03/11): ou replaneja válido (cadeia/material/revezamento) ou MANTÉM o plano e avisa — nunca grava plano inválido nem usa o legado", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    m.editar((e) => { ["f01", "f02", "f03", "f04", "f05", "f06", "f07"].forEach((f) => e.ausencias.push({ funcionarioId: f, data: "2026-11-03", horarioInicio: "13:00:00", horarioFim: null })); });
    const r = await m.recalcular(T1_DIA3);
    const reg = ultimoPlanejador(m);
    if ((reg.avaliacaoFluxo as { usado?: boolean }).usado) {
      expect(pessoasNoSlot(m, "2026-11-03", "t1").length).toBe(3);
      const a = auditar(m, T1_DIA3);
      expect(a.duras).toBe(0);
      expect(a.semMaterial).toBe(0);
    } else {
      expect(r.alertas.some((a) => (a as { tipo?: string }).tipo === "planejador_corte_falhou")).toBe(true); // plano mantido + alerta
    }
  });

  it("contagem física nova muda o WIP inicial do planejador (e o plano), sem tocar no passado", () => {
    const m = mundo();
    const { montada } = estadoAtual(m, T1_DIA3);
    const e = montada.entrada;
    const par = (saldo: number) => ({ produtoId: "pA", etapaOrigemId: "eA1", etapaSeguinteId: "eA2", saldo, contadoEmMs: T1_DIA3 - 3600_000 });
    const wip = (saldo: number) => montarProblemaCorte(e, { apontamentos: [], agoraMs: T1_DIA3, planoVigente: [], contagensFisicas: [par(saldo)] }, { fluxoMesmoPeriodo: false }, CFG, []).entradaPlanejador.produtos.find((p) => p.id === "pA")!.wipInicial[0];
    expect(wip(1500)).toBe(1500);
    expect(wip(300)).toBe(300);
  });

  it("execução EXATAMENTE como planejada ⇒ o replanejamento do período seguinte mexe pouco no futuro (estabilidade por hash/θ/pessoas)", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const antes = auditar(m, T1_DIA3).futuras.filter((a) => a.data > "2026-11-03");
    // lança, como real, tudo que foi planejado em M1–M3 de 03/11
    const exec = m.alocacoes.filter((a) => a.data === "2026-11-03" && ["m1", "m2", "m3"].includes(a.periodoId) && a.maquinaId);
    m.editar((e) => { exec.forEach((a) => e.producaoReal!.apontamentos.push({ data: a.data, periodoId: a.periodoId, funcionarioId: null, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, boas: a.pecas, refugo: 0, meta: a.pecas, status: "produzindo", motivo: null, lancadoEmMs: epochMsNoFuso("2026-11-03", "12:00") })); });
    await m.recalcular(T1_DIA3);
    const depois = auditar(m, T1_DIA3).futuras.filter((a) => a.data > "2026-11-03");
    const k = (a: AlocacaoEscala) => `${a.data}|${a.periodoId}|${a.funcionarioId}`;
    const A = new Map(antes.map((a) => [k(a), `${a.maquinaId}|${a.produtoId}`]));
    const mudou = depois.filter((a) => A.get(k(a)) !== `${a.maquinaId}|${a.produtoId}`).length;
    expect(mudou / depois.length).toBeLessThan(0.15); // < 15% das linhas futuras trocam de posto/produto sem nenhuma surpresa
    expect(auditar(m, T1_DIA3).duras).toBe(0);
  });
});

describe("LINHAS COMPARTILHADAS: ALOCACAO_FISICA × DISTRIBUICAO_DA_QUANTIDADE_POR_PRODUTO", () => {
  it("máquina compartilhada entre produtos da mesma operação ⇒ uma linha física com distribuição que soma a peça da linha; produto da linha = dominante", async () => {
    const m = mundo();
    await m.recalcular(GERA, true);
    const comp = m.alocacoes.filter((a) => a.distribuicao && a.distribuicao.length >= 2);
    for (const a of comp) {
      expect(a.distribuicao!.reduce((s, d) => s + d.pecas, 0)).toBeCloseTo(a.pecas, 3);
      const dom = a.distribuicao!.reduce((x, y) => (y.pecas > x.pecas ? y : x));
      expect(a.produtoId).toBe(dom.produtoId);
      expect(validarDistribuicao(a)).toEqual([]);
    }
    // máquina e pessoa nunca duplicadas
    const mq = m.alocacoes.filter((a) => a.maquinaId).map((a) => `${a.data}|${a.periodoId}|${a.maquinaId}`);
    expect(new Set(mq).size).toBe(mq.length);
    // a visão por produto soma o MESMO total de peças da visão física
    const fis = m.alocacoes.reduce((s, a) => s + a.pecas, 0), prod = expandirPorProduto(m.alocacoes).reduce((s, a) => s + a.pecas, 0);
    expect(prod).toBeCloseTo(fis, 3);
  });

  it("apontamento (um por máquina×período) é repartido entre os produtos da linha pela distribuição planejada; total preservado; produto estranho fica intacto", () => {
    const linha: AlocacaoEscala = { data: "2026-11-03", periodoId: "m1", funcionarioId: "f01", maquinaId: "mq", produtoId: "pConv", etapaId: "eConv", operacaoId: "opEtiq", pecas: 300, pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, distribuicao: [{ produtoId: "pConv", etapaId: "eConv", pecas: 200 }, { produtoId: "pAut", etapaId: "eAut", pecas: 100 }] };
    const ap = (produtoId: string | null): ApontamentoReal => ({ data: "2026-11-03", periodoId: "m1", funcionarioId: null, maquinaId: "mq", produtoId, etapaId: produtoId ? "eConv" : null, operacaoId: "opEtiq", boas: 301, refugo: 10, meta: 300, status: "produzindo", motivo: null, lancadoEmMs: 1 });
    const r = repartirApontamentosCompartilhados([ap("pConv")], [linha]);
    expect(r.repartidos).toBe(1);
    expect(r.apontamentos.map((a) => a.produtoId).sort()).toEqual(["pAut", "pConv"]);
    expect(r.apontamentos.reduce((s, a) => s + a.boas, 0)).toBe(301);
    expect(r.apontamentos.reduce((s, a) => s + a.refugo, 0)).toBe(10);
    expect(r.apontamentos.find((a) => a.produtoId === "pConv")!.boas).toBeGreaterThan(r.apontamentos.find((a) => a.produtoId === "pAut")!.boas); // 2/3 × 1/3
    expect(repartirApontamentosCompartilhados([ap("pOutro")], [linha]).repartidos).toBe(0);
    expect(repartirApontamentosCompartilhados([ap("pConv")], [{ ...linha, distribuicao: undefined }]).repartidos).toBe(0); // linha de um só produto: intacto
  });

  it("expandirPorProduto atribui cada quantidade ao SEU produto (a Automática nunca vira Convencional); linha de um só produto passa por referência", () => {
    const base = { data: "d", periodoId: "m1", funcionarioId: "f", maquinaId: "mq", operacaoId: "op", pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null } as const;
    const comp: AlocacaoEscala = { ...base, produtoId: "pConv", etapaId: "eConv", pecas: 300, distribuicao: [{ produtoId: "pConv", etapaId: "eConv", pecas: 200 }, { produtoId: "pAut", etapaId: "eAut", pecas: 100 }] };
    const simples: AlocacaoEscala = { ...base, funcionarioId: "g", maquinaId: "mq2", produtoId: "pX", etapaId: "eX", pecas: 50 };
    const ex = expandirPorProduto([comp, simples]);
    expect(ex.filter((a) => a.produtoId === "pAut").reduce((s, a) => s + a.pecas, 0)).toBe(100);
    expect(ex.filter((a) => a.produtoId === "pConv").reduce((s, a) => s + a.pecas, 0)).toBe(200);
    expect(ex.find((a) => a.produtoId === "pX")).toBe(simples);
    expect(expandirPorProduto([simples])).toEqual([simples]);
  });
});

describe("semana NÃO ativada no planejador: caminho anterior (legado) intacto", () => {
  it("sem estado.planejadorCorte o motor legado roda como antes (o mock o bloqueia ⇒ aqui prova-se o contrário: ele É chamado)", async () => {
    const m = mundo(10, false);
    m.editar((e) => { delete e.producaoReal; });
    await expect(m.recalcular(GERA, true)).rejects.toThrow(/MOTOR LEGADO/);
  });
});

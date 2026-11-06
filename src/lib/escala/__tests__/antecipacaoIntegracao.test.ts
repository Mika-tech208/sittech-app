// ANTECIPAÇÃO / FORMAÇÃO DE ESTOQUE — integração com o recálculo oficial (processarSemana + planejador de corte, banco em memória). Ver docs/antecipacao-semana-seguinte.md.
// O motor LEGADO está bloqueado: a semana é do planejador de corte.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/features/escala/gerarEscala", async (orig) => {
  const real = await orig<typeof import("@/features/escala/gerarEscala")>();
  return { ...real, gerarEscala: () => { throw new Error("MOTOR LEGADO CHAMADO NUMA SEMANA ATIVADA NO PLANEJADOR DE CORTE"); } };
});

import { lerParametros } from "@/features/escala/parametros";
import { montarProblemaCorte } from "@/features/escala/fluxo/planoCorte";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import { aplicarDescontoNosItens, type DadosAntecipacao, type RegistroAntecipacao } from "@/features/escala/fluxo/antecipacao";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala } from "@/features/escala/types";
import { montarEntradaEscala } from "../montarEntrada";
import { registrosParaGravar } from "../processar";
import { lerConfigAntecipacao, lerPoliticasFormacao } from "../fluxo/parametrosAntecipacao";
import type { PayloadAplicacao } from "../estado";
import { Mundo, estadoDeTeste } from "./bancoMemoria";

const SEMANA = "2026-11-02", DESTINO = "2026-11-09";
const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const GERA = epochMsNoFuso("2026-11-02", "18:00");
const T1_DIA3 = epochMsNoFuso("2026-11-03", "12:50");
const CFG = { objetivo: "EQUILIBRIO" as const, busca: { iter: 30000, reinicios: 1, semente: 1 }, buscaComVigente: { iter: 15000, reinicios: 1, semente: 1 } };

function dadosAnt(extra: Partial<DadosAntecipacao> = {}): DadosAntecipacao {
  return {
    modo: "ativo", semanaOrigem: SEMANA, semanaDestino: DESTINO, politicasFormacao: [], excluidos: ["pD"], registros: [],
    forecastDestino: [{ produtoId: "pC", quantidade: 3000, maquinasPorEtapa: { eC1: ["m4"] } }, { produtoId: "pD", quantidade: 9999, maquinasPorEtapa: { eD1: ["m3", "m8"], eD2: ["m6"] } }, { produtoId: "pZ", quantidade: 500, maquinasPorEtapa: {} }],
    ...extra,
  };
}
/** semana com demanda atual pequena (sobra capacidade e gente) para a regra ter o que fazer */
function mundo(ant?: DadosAntecipacao, pessoas = 10) {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS, { pessoas }));
  m.editar((e) => {
    e.parametros = { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true };
    e.producaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: [], apontamentos: [], mesmoPeriodo: false };
    e.planejadorCorte = { config: CFG, vigenteDoPlanejador: false, distribuicaoSuportada: true };
    e.itens = e.itens.map((i) => ({ ...i, quantidade: i.produtoId === "pC" ? 1500 : i.produtoId === "pA" ? 1200 : 600 }));
    if (ant) e.antecipacao = ant;
  });
  return m;
}
async function recalcular(m: Mundo, agora: number, criar = false) {
  const payloads: PayloadAplicacao[] = [];
  const io = m.io();
  const aplicar = io.aplicar.bind(io);
  m.io = () => ({ ...io, aplicar: async (p: PayloadAplicacao) => { payloads.push(p); return aplicar(p); } });
  const r = await m.recalcular(agora, criar);
  return { r, payloads };
}
const hashPlano = (m: Mundo) => Mundo.assinatura(m.alocacoes.slice().sort((x, y) => (x.data + x.periodoId + x.funcionarioId < y.data + y.periodoId + y.funcionarioId ? -1 : 1)));
const reg = (m: Mundo) => m.registrosFluxo[m.registrosFluxo.length - 1];

describe("ANTECIPAÇÃO no recálculo oficial", () => {
  it("DESLIGADO (sem dados / modo desligado + sem registros): plano byte-idêntico, nenhum registro gravado, RPC antiga", async () => {
    const a = mundo();
    const ra = await recalcular(a, GERA, true);
    const b = mundo(dadosAnt({ modo: "desligado", forecastDestino: [], politicasFormacao: [] }));
    const rb = await recalcular(b, GERA, true);
    expect(hashPlano(b)).toBe(hashPlano(a));
    expect(ra.payloads.every((p) => p.antecipacoes === undefined)).toBe(true);
    // modo 'desligado' com dados presentes (só para limpar/descontar): como não há `modo ativo`, nenhuma produção extra
    expect(rb.payloads.every((p) => (p.antecipacoes?.linhas.length ?? 0) === 0)).toBe(true);
  });

  it("ATIVO: antecipa o que tem Forecast confirmado, só com máquina da interseção; Conector/excluídos e produto sem pool nunca; registro completo por posto", async () => {
    const base = mundo();
    await recalcular(base, GERA, true);
    const m = mundo(dadosAnt());
    const { r, payloads } = await recalcular(m, GERA, true);
    expect(r.status).toBe("processado");
    const p = payloads[payloads.length - 1];
    expect(p.antecipacoes).toBeDefined();
    const ls = p.antecipacoes!.linhas.filter((l) => l.origem === "ANTECIPACAO_SEMANA_SEGUINTE");
    expect(ls.length).toBeGreaterThan(0);
    expect(new Set(ls.map((l) => l.produtoId))).toEqual(new Set(["pC"])); // pD excluído, pZ sem pool na semana atual
    expect(ls.every((l) => l.maquinaId === "m4")).toBe(true); // m7 também é de pC na semana atual, mas NÃO está no Forecast futuro
    expect(ls.every((l) => l.semanaDestino === DESTINO && l.funcionarioId && l.operacaoId && l.data >= "2026-11-03")).toBe(true);
    const total = ls.filter((l) => l.etapaFinal).reduce((x, l) => x + l.quantidade, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(3000); // Forecast futuro
    // ledger: hash do plano que autorizou
    expect(p.antecipacoes!.planoHash).toMatch(/^[0-9a-f]{16,}$/);
    expect(p.antecipacoes!.semanaOrigem).toBe(SEMANA);
    // checagens independentes do corte: 0 violações da regra
    const chk = (reg(m).avaliacaoFluxo as { checagens: { antecipacao?: Record<string, number>; duplicidade: number; violacoesDuras: number; semMaterial: number } }).checagens;
    expect(chk.antecipacao).toMatchObject({ foraDoDestino: 0, antecipacaoAcimaDaMetaFutura: 0, limiteFisicoUltrapassado: 0, produtoProibido: 0 });
    expect(chk.violacoesDuras + chk.duplicidade + chk.semMaterial).toBe(0);
    // a DEMANDA da semana não perdeu nada: cada posto do plano sem antecipação continua no plano com antecipação
    const postos = (x: Mundo) => new Set(x.alocacoes.filter((a) => a.maquinaId).map((a) => `${a.data}|${a.periodoId}|${a.maquinaId}`));
    const com = postos(m);
    postos(base).forEach((k) => expect(com.has(k)).toBe(true));
    // nenhuma pessoa em 2 postos / máquina duplicada
    const k = new Set(m.alocacoes.map((a) => `${a.data}|${a.periodoId}|${a.funcionarioId}`));
    expect(k.size).toBe(m.alocacoes.length);
  });

  it("política de formação ligada para o produto ⇒ origem FORMACAO_ESTOQUE, passa do Forecast futuro e da demanda atual; semana de disponibilidade na linha", async () => {
    const pequeno = [{ produtoId: "pC", quantidade: 800, maquinasPorEtapa: { eC1: ["m4"] } }];
    // sem política: antecipação limitada ao Forecast futuro (800)
    const so = mundo(dadosAnt({ forecastDestino: pequeno }));
    const rs = await recalcular(so, GERA, true);
    expect(rs.payloads[rs.payloads.length - 1].antecipacoes!.linhas.filter((l) => l.etapaFinal).reduce((x, l) => x + l.quantidade, 0)).toBeLessThanOrEqual(800);
    const m = mundo(dadosAnt({ forecastDestino: pequeno, politicasFormacao: [{ produtoId: "pC", limiteFisicoPecas: 60000 }] }));
    const { payloads } = await recalcular(m, GERA, true);
    const ls = payloads[payloads.length - 1].antecipacoes!.linhas;
    const form = ls.filter((l) => l.origem === "FORMACAO_ESTOQUE");
    expect(form.length).toBeGreaterThan(0);
    expect(ls.some((l) => l.origem === "ANTECIPACAO_SEMANA_SEGUINTE")).toBe(false);
    expect(form.every((l) => l.semanaDestino === DESTINO)).toBe(true); // semana em que o estoque estará disponível (não é antecipação)
    const total = form.filter((l) => l.etapaFinal).reduce((x, l) => x + l.quantidade, 0);
    expect(total).toBeGreaterThan(800); // acima do Forecast da semana seguinte (800) e usando máquinas da Previsão ATUAL (m4 e m7)
    expect(total).toBeLessThanOrEqual(60000);
    expect(new Set(form.map((l) => l.maquinaId)).size).toBeGreaterThan(1); // sem a interseção com o futuro: m4 e m7
    // a produção do produto na semana passa da demanda atual (1500) — formação NÃO é "demanda ultrapassada": nenhuma violação
    const chk = (reg(m).avaliacaoFluxo as { checagens: { antecipacao?: Record<string, number> } }).checagens;
    expect(chk.antecipacao).toMatchObject({ antecipacaoAcimaDaMetaFutura: 0, limiteFisicoUltrapassado: 0, produtoProibido: 0 });
    // produto excluído (pD) com política: continua sem formar
    const x = mundo(dadosAnt({ politicasFormacao: [{ produtoId: "pD" }], excluidos: ["pD"] }));
    const rx = await recalcular(x, GERA, true);
    expect(rx.payloads[rx.payloads.length - 1].antecipacoes!.linhas.some((l) => l.produtoId === "pD")).toBe(false);
  });

  it("recálculo seguinte com o mesmo estado é estável (sem churn) e o registro não é tocado quando o plano é mantido", async () => {
    const m = mundo(dadosAnt());
    await recalcular(m, GERA, true);
    const antes = hashPlano(m);
    const r2 = await recalcular(m, GERA, false);
    expect(hashPlano(m)).toBe(antes);
    expect(["sem_alteracao", "processado"]).toContain(r2.r.status);
    if (r2.r.status === "processado") expect(r2.payloads[r2.payloads.length - 1].antecipacoes).toBeDefined();
  });

  it("antecipação/formação JÁ EXECUTADA é devolvida ao restante da semana atual (não mascara falta de demanda atual)", () => {
    const m = mundo(dadosAnt());
    const estado = { ...m.entradas, diasExistentes: [], alocacoes: [] };
    const sem = montarEntradaEscala(estado, T1_DIA3).entrada;
    const pC = sem.pools.find((p) => p.produtoId === "pC")!;
    const ap = (boas: number): ApontamentoReal => ({ data: "2026-11-03", periodoId: "m1", funcionarioId: null, maquinaId: pC.maquinasIds[0], produtoId: "pC", etapaId: pC.etapaId, operacaoId: pC.operacaoId, boas, refugo: 0, meta: 60, status: "produzindo", motivo: null, lancadoEmMs: epochMsNoFuso("2026-11-03", "09:00") });
    const dem = (extraExec: number) => {
      const regs: RegistroAntecipacao[] = extraExec > 0 ? [{ origem: "ANTECIPACAO_SEMANA_SEGUINTE", data: "2026-11-03", periodoId: "m1", produtoId: "pC", etapaId: pC.etapaId, etapaFinal: true, quantidade: extraExec, maquinaId: pC.maquinasIds[0] }] : [];
      const e = { ...sem, antecipacao: dadosAnt({ registros: regs, modo: "desligado" }) };
      return montarProblemaCorte(e, { apontamentos: [ap(400)], agoraMs: T1_DIA3, planoVigente: [] as AlocacaoEscala[] }, { fluxoMesmoPeriodo: false }, CFG, []).entradaPlanejador.produtos.find((p) => p.id === "pC")!.demandaFinal;
    };
    expect(dem(0)).toBe(1100); // 1500 − 400 produzidos
    expect(dem(300)).toBe(1400); // 300 dos 400 eram extra: restante da demanda = 1500 − 100
    expect(dem(400)).toBe(1500);
  });

  it("registro para gravar: extras + parte DEMANDA dos postos mistos; ANTECIPAÇÃO e FORMAÇÃO levam a semana de destino/disponibilidade", () => {
    const aloc: AlocacaoEscala[] = [
      { data: "2026-11-03", periodoId: "t1", funcionarioId: "f1", maquinaId: "m4", produtoId: "pC", etapaId: "eC1", operacaoId: "opEtiq", pecas: 1000, pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" },
      { data: "2026-11-03", periodoId: "t1", funcionarioId: "f2", maquinaId: "m7", produtoId: "pC", etapaId: "eC1", operacaoId: "opEtiq", pecas: 400, pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" },
    ];
    const r = registrosParaGravar(SEMANA, DESTINO, [
      { data: "2026-11-03", periodoId: "t1", funcionarioId: "f1", maquinaId: "m4", operacaoId: "opEtiq", produtoId: "pC", etapaId: "eC1", etapaIdx: 0, etapaFinal: true, pecas: 700, origem: "ANTECIPACAO_SEMANA_SEGUINTE" },
      { data: "2026-11-03", periodoId: "t1", funcionarioId: "f2", maquinaId: "m7", operacaoId: "opEtiq", produtoId: "pC", etapaId: "eC1", etapaIdx: 0, etapaFinal: true, pecas: 400, origem: "FORMACAO_ESTOQUE" },
    ], aloc, "h1");
    expect(r.linhas.map((l) => [l.origem, l.semanaDestino, l.quantidade])).toEqual([["ANTECIPACAO_SEMANA_SEGUINTE", DESTINO, 700], ["FORMACAO_ESTOQUE", DESTINO, 400], ["DEMANDA_SEMANA", null, 300]]);
  });

  it("desconto na semana de DESTINO: quantidade líquida nos itens; formação só desconta com a decisão explícita; sem registro = mesmos itens", () => {
    const itens = [{ produtoId: "pino", quantidade: 54000, x: 1 }, { produtoId: "plug", quantidade: 33000, x: 2 }];
    const regs: RegistroAntecipacao[] = [
      { origem: "ANTECIPACAO_SEMANA_SEGUINTE", data: "2026-11-06", periodoId: "t1", produtoId: "pino", etapaId: "e", etapaFinal: true, quantidade: 8000 },
      { origem: "FORMACAO_ESTOQUE", data: "2026-11-06", periodoId: "t2", produtoId: "plug", etapaId: "e", etapaFinal: true, quantidade: 5000 },
    ];
    expect(aplicarDescontoNosItens(itens, [], false).itens).toBe(itens);
    const a = aplicarDescontoNosItens(itens, regs, false);
    expect(a.itens.map((i) => i.quantidade)).toEqual([46000, 33000]);
    expect(a.itens[0].x).toBe(1);
    expect(a.descontos.find((d) => d.produtoId === "plug")).toMatchObject({ aplicado: false });
    expect(aplicarDescontoNosItens(itens, regs, true).itens.map((i) => i.quantidade)).toEqual([46000, 28000]);
    expect(aplicarDescontoNosItens([{ produtoId: "pino", quantidade: 5000 }], regs, false).itens[0].quantidade).toBe(0); // nunca negativo
  });

  it("parâmetros: ausente/desconhecido = desligado; política lê ids e objetos, ignora lixo", () => {
    expect(lerConfigAntecipacao([]).modo).toBe("desligado");
    expect(lerConfigAntecipacao([{ chave: "escala_antecipacao_modo", valor: "ligado" }]).modo).toBe("desligado");
    expect(lerConfigAntecipacao([{ chave: "escala_antecipacao_modo", valor: "ativo" }]).modo).toBe("ativo");
    expect(lerConfigAntecipacao([{ chave: "escala_formacao_estoque_desconta_destino", valor: true }]).descontaFormacao).toBe(true);
    expect(lerConfigAntecipacao([{ chave: "escala_formacao_estoque_desconta_destino", valor: "true" }]).descontaFormacao).toBe(false);
    const id1 = "cace499f-2c0d-4cc5-b8e0-53f692ddbe92", id2 = "fa08e7c6-1a44-4625-a9e4-9b9cebf1031e";
    expect(lerPoliticasFormacao([id2, { produtoId: id1, limiteFisicoPecas: 5000 }, { produtoId: id1 }, "Pino", 7, null, { produtoId: "nome" }, { produtoId: id2, limiteFisicoPecas: -1 }])).toEqual([{ produtoId: id1, limiteFisicoPecas: 5000 }, { produtoId: id2 }]);
    expect(lerPoliticasFormacao("x")).toEqual([]);
  });
});

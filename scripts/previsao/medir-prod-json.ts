/* eslint-disable @typescript-eslint/no-explicit-any */
// MEDIÇÃO OFFLINE (sem rede): números da Previsão com as funções REAIS do app a partir de dois JSON lidos de PROD (somente leitura).
// Uso: APONTADO_JSON=/tmp/prod_apontado.json SEMANA_JSON=/tmp/prod_sem.json scripts/fechamento/ts.sh scripts/previsao/medir-prod-json.ts
import { readFileSync } from "node:fs";
import { calcularApontadoReal } from "@/features/previsao/apontadoReal";
import { calcularProdutosProgramados, calcularResumoProgramacaoPecas } from "@/features/previsao/progressoSemana";
import { lerEncerramentos, aplicarEncerramentosAosItens } from "@/features/previsao/encerramento";
import { calcularResumoSemana } from "@/features/capacidade/selectors";
import { calcularHistoricoSemanal } from "@/features/previsao/progressoSemana";

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ap = JSON.parse(readFileSync(process.env.APONTADO_JSON ?? "", "utf8")) as any[];
const sem = JSON.parse(readFileSync(process.env.SEMANA_JSON ?? "", "utf8")) as any;
const mapa = calcularApontadoReal(ap.map((r) => ({ produtoId: r.produto_id, etapaId: r.etapa_id, operacaoId: r.operacao_id, quantidadeBoa: Number(r.quantidade_boa), nApontamentos: Number(r.n_apontamentos), etapaOrdem: r.etapa_ordem, etapaOperacaoId: r.etapa_operacao_id, ultimaOrdem: r.ultima_ordem, nNaUltimaOrdem: Number(r.n_na_ultima_ordem ?? 0), ultimaOperacaoId: r.ultima_operacao_id })));
const previstos = (sem.itens as any[]).filter((i) => i.tipo === "previsto").map((i) => ({ id: i.id, produtoId: i.produto_id, produtoNome: i.produto_nome, valorUnitario: Number(i.valor_unitario), quantidade: Number(i.quantidade) }));
const itens = aplicarEncerramentosAosItens(previstos as any, lerEncerramentos(sem.enc));
const prod = calcularProdutosProgramados(itens as any, [], mapa);
const r = calcularResumoProgramacaoPecas(prod);
for (const p of prod) console.log(`${p.produtoNome.padEnd(30)} unit=${p.valorUnitario}  apontado=${p.apontadoReal}  R$ realizado=${fmt(p.valorRealizado)}  R$ previsto=${fmt(p.valorPrevisto)}${p.encerrado ? "  [ENCERRADO]" : ""}`);
console.log(`TOTAL R$ realizado (Previsão, apontado real × preço congelado) = ${fmt(r.valorRealizado)}  | previsto original = ${fmt(r.valorPrevisto)} | previsto operacional = ${fmt(r.valorPrevistoOperacional)}`);
const leg = calcularResumoSemana({ itens: itens as any, itensRealizados: [] });
console.log(`calcularResumoSemana (Meta semanal / Visão Geral / demais telas): previsto=${fmt(leg.valorPrevisto)} realizado(manual)=${fmt(leg.valorRealizado)}`);
console.log("mapa apontado 4x2:", JSON.stringify([...mapa.entries()].filter(([id]) => id.startsWith("238ca607")).map(([, v]) => v)));

const hist = calcularHistoricoSemanal([{ semanaInicio: process.env.SEMANA ?? "2026-11-02", itens: itens as any, itensRealizados: [] }] as any, new Map([[process.env.SEMANA ?? "2026-11-02", mapa]]));
console.log("Histórico semanal:", JSON.stringify(hist.map((h) => ({ semana: h.semanaInicio, metodologia: h.metodologia, previsto: Number(h.previsto.toFixed(2)), realizado: h.realizado === null ? null : Number(h.realizado.toFixed(2)), pct: h.pct === null ? null : Number(h.pct.toFixed(2)) }))));
// SEM a 4x2 (o que seria o faturamento se o produto encerrado fosse ignorado)
const sem4x2 = calcularResumoProgramacaoPecas(calcularProdutosProgramados((itens as any[]).filter((i) => !i.encerrado), [], mapa));
console.log(`R$ realizado SEM a 4x2 = ${fmt(sem4x2.valorRealizado)}  → a 4x2 acrescenta ${fmt((r.valorRealizado ?? 0) - (sem4x2.valorRealizado ?? 0))}`);

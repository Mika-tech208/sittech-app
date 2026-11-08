/* eslint-disable @typescript-eslint/no-explicit-any */
// MEDIÇÃO (clone; NUNCA PROD): números da Previsão semanal com as funções REAIS do app (apontado real, produtos programados, resumo) sobre os dados de uma semana.
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; SEMANA=2026-11-02 scripts/fechamento/ts.sh scripts/previsao/medir-semana.ts
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { calcularApontadoReal, type LinhaApontadoEtapa } from "@/features/previsao/apontadoReal";
import { calcularProdutosProgramados, calcularResumoProgramacaoPecas } from "@/features/previsao/progressoSemana";
import { lerEncerramentos, aplicarEncerramentosAosItens } from "@/features/previsao/encerramento";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const SEMANA = process.env.SEMANA ?? "2026-11-02";
const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR"));

async function main() {
  const prev = await admin.from("previsoes").select("id, semana_inicio, previsao_itens(id, tipo, produto_id, produto_nome, valor_unitario, quantidade, quantidade_adicional), previsao_encerramentos(produto_id, quantidade_original, adicional_original, encerrado_em, motivo, reaberto_em)").eq("semana_inicio", SEMANA).maybeSingle();
  if (prev.error || !prev.data) throw new Error(`previsão: ${prev.error?.message}`);
  const itens0 = ((prev.data as any).previsao_itens as any[]).filter((i) => i.tipo === "previsto").map((i) => ({ id: i.id, produtoId: i.produto_id, produtoNome: i.produto_nome, valorUnitario: Number(i.valor_unitario), quantidade: Number(i.quantidade) }));
  const encs = lerEncerramentos((prev.data as any).previsao_encerramentos);
  const itens = process.env.MODO === "antes" ? itens0 : aplicarEncerramentosAosItens(itens0 as any, encs);
  // a RPC só executa para usuário autenticado: a saída dela (obter_apontado_real_previsao_por_semana) vem de um arquivo gerado por psql no clone (APONTADO_JSON)
  const dados = JSON.parse(readFileSync(process.env.APONTADO_JSON ?? "", "utf8")) as any[];
  const linhas: LinhaApontadoEtapa[] = (dados as any[]).map((r) => ({ produtoId: r.produto_id, etapaId: r.etapa_id, operacaoId: r.operacao_id, quantidadeBoa: Number(r.quantidade_boa), nApontamentos: Number(r.n_apontamentos), etapaOrdem: r.etapa_ordem, etapaOperacaoId: r.etapa_operacao_id, ultimaOrdem: r.ultima_ordem, nNaUltimaOrdem: Number(r.n_na_ultima_ordem ?? 0), ultimaOperacaoId: r.ultima_operacao_id }));
  const mapa = calcularApontadoReal(linhas);
  const produtos = calcularProdutosProgramados(itens as any, [], mapa);
  const r = calcularResumoProgramacaoPecas(produtos);
  console.log(`\n=== Semana ${SEMANA} (${process.env.MODO ?? "depois"}) ===`);
  for (const p of produtos) console.log(`${p.produtoNome.padEnd(34)} previsto=${fmt(p.previsto).padStart(8)}  apontado=${fmt(p.apontadoReal).padStart(8)}  falta=${fmt(p.falta).padStart(8)}  excedente=${fmt(p.excedente).padStart(7)}  %=${p.concluidoPct === null ? "N/A" : p.concluidoPct.toFixed(1)}${(p as any).encerrado ? "  [ENCERRADO]" : ""}`);
  console.log(`TOTAL previsto=${fmt(r.totalPrevisto)}  APONTADO REAL=${fmt(r.totalApontadoReal)}  falta=${fmt(r.totalFalta)}  excedente=${fmt(r.totalExcedente)}  %=${r.concluidoPct === null ? "N/A" : r.concluidoPct.toFixed(2)}`);
  const extra = r as any;
  if (extra.totalCancelado !== undefined) console.log(`   previsto operacional=${fmt(extra.totalPrevistoOperacional)}  cancelado=${fmt(extra.totalCancelado)}  apontado de produtos encerrados=${fmt(extra.totalApontadoEncerrados)}  encerrados=${extra.itensEncerrados}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

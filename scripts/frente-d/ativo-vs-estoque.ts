/* eslint-disable @typescript-eslint/no-explicit-any */
// O plano ATIVO de PROD (dump) sobrevive às contagens físicas D? Simula o plano tal como está gravado contra os estoques iniciais B (estimado) e D (físico), lote de 1 período.
// Rodar: SQL_DIR=<D12/dumps> fb/ts.sh scripts/frente-d/ativo-vs-estoque.ts   (env: OUT=arquivo.json)
import * as fs from "node:fs";
import { montarEstado as carregar } from "../ativacao-0211/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { D12, carregarPlanoAtivo, simular, rotuloSlot, n0, cadeiasDe } from "./lib";

process.env.SQL_DIR = process.env.SQL_DIR ?? `${D12}/dumps`;
const { estado } = carregar();
const AGORA = Date.parse("2026-11-02T20:25:00-03:00");
const entrada = montarEntradaEscala(estado, AGORA).entrada;
const nomeP = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const nomeO = (id: string) => estado.nomesOperacao[id] ?? id;
const prods = [...new Set(entrada.pools.map((p) => p.produtoId))];
const ehAut = (id: string) => /Autom/i.test(nomeP(id));
const conv = prods.find((id) => nomeP(id).startsWith('Conector 3/4"') && !ehAut(id))!, aut = prods.find(ehAut)!, cx = prods.find((id) => /Caixa/i.test(nomeP(id)))!;
export const CEN: Record<string, Record<string, number[]>> = {
  "B (estimado, plano ativo)": { [conv]: [3200, 3700, 3600], [aut]: [0, 0], [cx]: [2300] },
  "D(i) M8→Etiq = 0": { [conv]: [4000, 2400, 3600], [aut]: [0, 0], [cx]: [2500] },
  "D(ii) M8→Etiq = 2.400 (pilha da M8 além das 2.400)": { [conv]: [4000, 2400, 3600], [aut]: [2400, 0], [cx]: [2500] },
  "D(iii) as 2.400 são TODAS da M8": { [conv]: [4000, 0, 3600], [aut]: [2400, 0], [cx]: [2500] },
};
const plano = carregarPlanoAtivo(process.env.SQL_DIR!);
console.log(`plano ativo: ${plano.length} linhas · com posto ${plano.filter((a) => a.maquinaId).length} · compartilhadas ${plano.filter((a) => a.distribuicao).length}`);
const saida: any = {};
for (const [nome, wip] of Object.entries(CEN)) {
  const tr = simular(entrada, plano, wip);
  console.log(`\n=== ${nome}`);
  saida[nome] = {};
  for (const t of tr) {
    const ch = cadeiasDe(entrada).find((c) => c.produtoId === t.produtoId)!;
    if (ch.etapas.length < 2) continue;
    const rupt = t.ruptura.map((v) => v.reduce((a, b) => a + b, 0));
    const primeira: string[] = [];
    t.ruptura.forEach((v, k) => { const i = v.findIndex((x) => x > 0.5); if (i >= 0) primeira.push(`${nomeO(ch.etapas[k].operacaoId)}: ${rotuloSlot(entrada, i)} (${n0(v[i])} pç)`); });
    const finalPlan = t.planejado[ch.etapas.length - 1].reduce((a, b) => a + b, 0), finalEf = t.efetivo[ch.etapas.length - 1].reduce((a, b) => a + b, 0);
    console.log(`${nomeP(t.produtoId)}: final planejado ${n0(finalPlan)} → efetivo ${n0(finalEf)} (perda ${n0(finalPlan - finalEf)}) · ruptura por etapa ${rupt.map((x) => n0(x)).join("/")} · 1ª ruptura: ${primeira.join(" | ") || "nenhuma"}`);
    saida[nome][nomeP(t.produtoId)] = { finalPlan, finalEf, rupt, primeira };
  }
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(saida, null, 1));

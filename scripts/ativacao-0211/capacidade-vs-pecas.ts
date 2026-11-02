/* eslint-disable @typescript-eslint/no-explicit-any */
// Diagnóstico: as violações do validador da Camada 1 (capacidade das metas × material) no plano do planejador são só "posto parcial por falta de material"?
// Compara, por violação, a capacidade desejada, o disponível e as PEÇAS planejadas no nó × slot. Rodar: fb/ts.sh scripts/ativacao-0211/capacidade-vs-pecas.ts
import { montarEstado as carregar } from "./carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { montarProblemaCorte, planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { simularCadeia } from "@/features/escala/fluxo/cadeia";
import { expandirPorProduto } from "@/features/escala/distribuicao";
import type { DadosProducaoReal, ContagemFisicaPar } from "@/features/escala/fluxo/tipos";

const { estado } = carregar();
estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
const AGORA = Date.parse("2026-11-02T18:00:00-03:00");
const entrada = montarEntradaEscala(estado, AGORA).entrada;
const nome = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const prods = [...new Set(entrada.pools.map((p) => p.produtoId))];
const ehAut = (id: string) => /Autom/i.test(nome(id));
const conv = prods.find((id) => nome(id).startsWith('Conector 3/4"') && !ehAut(id))!, aut = prods.find(ehAut)!, cx = prods.find((id) => /Caixa/i.test(nome(id)))!;
const B: Record<string, number[]> = { [conv]: [3200, 3700, 3600], [aut]: [0, 0], [cx]: [2300] };
const contagens: ContagemFisicaPar[] = [];
Object.entries(B).forEach(([pid, v]) => { const ps = entrada.pools.filter((p) => p.produtoId === pid).sort((a, b) => a.ordemEtapa - b.ordemEtapa); for (let k = 0; k + 1 < ps.length; k++) contagens.push({ produtoId: pid, etapaOrigemId: ps[k].etapaId, etapaSeguinteId: ps[k + 1].etapaId, saldo: v[k] ?? 0, contadoEmMs: AGORA }); });
const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: contagens };
const cfg = { objetivo: "EQUILIBRIO" as const, busca: { iter: 60000, reinicios: 1, semente: 1 } };
const r = planejarSemanaComCorte(entrada, dados, { fluxoMesmoPeriodo: false }, cfg);
const m = montarProblemaCorte(entrada, dados, { fluxoMesmoPeriodo: false }, cfg, []);
const linhas = r.resultado!.alocacoes;
const sim = simularCadeia(m.ctx, expandirPorProduto(linhas));
console.log("violações Camada 1:", sim.violacoes.length);
const pecas = (pid: string, eid: string, slot: number) => expandirPorProduto(linhas).filter((a) => a.produtoId === pid && a.etapaId === eid && entrada.slots[slot].data === a.data && entrada.slots[slot].periodoId === a.periodoId).reduce((s, a) => s + a.pecas, 0);
let reais = 0;
sim.violacoes.slice(0, 64).forEach((v, i) => {
  const p = pecas(v.produtoId, v.etapaId, v.slot);
  const real = p > v.disponivel + 1e-6;
  if (real) reais++;
  if (real) console.log(nome(v.produtoId), v.etapaId.slice(0, 4), "slot", v.slot, "desejada(cap)", Math.round(v.desejada), "disponivel", Math.round(v.disponivel), "pecasPlanejadas", p, real ? "REAL" : "parcial");
});
console.log("violações em que as PEÇAS planejadas excedem o disponível:", reais, "de", sim.violacoes.length);

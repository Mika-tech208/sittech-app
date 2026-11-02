/* eslint-disable @typescript-eslint/no-explicit-any */
// BENCH OFFLINE do planejador de corte sobre o estado REAL da semana 02/11 (SELECTs de PROD já gravados em SQL_DIR). Nada é gravado.
// Rodar: scratchpad/fb/ts.sh scripts/ativacao-0211/bench.ts   (env: AGORA=ISO, ITER, REINICIOS, SEMENTE, OBJ)
import { montarEstado as carregar } from "./carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo/tipos";

const { estado } = carregar();
estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
const AGORA = Date.parse(process.env.AGORA ?? "2026-11-02T18:00:00-03:00");
const montada = montarEntradaEscala(estado, AGORA);
const entrada = montada.entrada;
const nome = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const prods = [...new Set(entrada.pools.map((p) => p.produtoId))];
const ehAut = (id: string) => /Autom/i.test(nome(id));
const conv = prods.find((id) => nome(id).startsWith('Conector 3/4"') && !ehAut(id))!;
const aut = prods.find(ehAut)!;
const cx = prods.find((id) => /Caixa/i.test(nome(id)))!;
const B: Record<string, number[]> = { [conv]: [3200, 3700, 3600], [aut]: [0, 0], [cx]: [2300] };
const contagens: ContagemFisicaPar[] = [];
Object.entries(B).forEach(([pid, v]) => {
  const ps = entrada.pools.filter((p) => p.produtoId === pid).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
  for (let k = 0; k + 1 < ps.length; k++) contagens.push({ produtoId: pid, etapaOrigemId: ps[k].etapaId, etapaSeguinteId: ps[k + 1].etapaId, saldo: v[k] ?? 0, contadoEmMs: AGORA, informadoPor: "cenário B (estimado)" });
});
const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: contagens };
console.log("funcionários:", entrada.funcionarios.length, "slots:", entrada.slots.length, "aPartirDe:", entrada.aPartirDe, "pools:", entrada.pools.length);
const t0 = Date.now();
const r = planejarSemanaComCorte(entrada, dados, { fluxoMesmoPeriodo: false }, {
  objetivo: (process.env.OBJ as any) ?? "EQUILIBRIO",
  busca: { iter: Number(process.env.ITER ?? 400000), reinicios: Number(process.env.REINICIOS ?? 2), semente: Number(process.env.SEMENTE ?? 1) },
});
console.log("ms:", Date.now() - t0, "ok:", r.ok, r.motivo ?? "");
console.log("tentativas:", JSON.stringify(r.tentativas));
console.log("checagens:", JSON.stringify(r.checagens));
if (r.saida) {
  console.log("porProduto:", r.saida.porProduto.map((p) => `${nome(p.produtoId)}: demanda ${Math.round(p.demanda)} prog ${Math.round(p.programado)} cort ${Math.round(p.cortado)}`).join(" | "));
  const tot = r.saida.porProduto.reduce((s, p) => s + p.programado, 0);
  console.log("total programado:", Math.round(tot), "avisos:", r.saida.avisos.slice(0, 3));
  const linhas = r.resultado!.alocacoes;
  console.log("linhas:", linhas.length, "com posto:", linhas.filter((l) => l.maquinaId).length, "sem posto:", linhas.filter((l) => !l.maquinaId).length, "compartilhadas:", linhas.filter((l) => l.distribuicao).length);
}

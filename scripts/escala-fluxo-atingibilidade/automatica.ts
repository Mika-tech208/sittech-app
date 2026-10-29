/* eslint-disable @typescript-eslint/no-explicit-any */
// Conector AUTOMÁTICA × convencional: lucro/h da tela vs valor marginal REAL por posto/período (Máquina 8 e etapas comuns limitam). Uso: ts.sh automatica.ts [--desloc 2] [--bloco]
import { buscar, carregar } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { planejarComFluxo, avaliarPlano } from "@/features/escala/fluxo";
import { analisarCapacidade } from "@/features/escala/fluxo/capacidade";
const arg = (k: string) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : undefined; };
const d = carregar(buscar({ semana: "2026-10-26", antesIso: "x", depoisIso: "x", usarCache: true }));
const nome = (id: string) => (d.nomes[id] ?? id.slice(0, 8)).trim().replace('Conector 3/4" - Maquina Automatica', "Autom.").replace('Conector 3/4"', "Conv.");
const opPorEtapa = new Map(d.decisao.entrada.pools.map((p) => [p.etapaId, p.operacaoId]));
const e = montarEstadoAting(d, Date.parse(arg("agora") ?? "2026-10-28T09:45:00-03:00"), d.planoAtual, Number(arg("desloc") ?? 2), { objetivo: "lucro_hora", atingibilidadeModo: "ativo", atingibilidadeK: 2, economiaSlots: 99 }, process.argv.includes("--bloco"));
const r = planejarComFluxo(e.entrada, e.dados, e.opcoes);
const an = analisarCapacidade(e.ctx, r.resultado.alocacoes);
const av = avaliarPlano(e.entrada, e.dados, r.resultado.alocacoes, e.opcoes);
const alvo = an.capacidade.filter((c) => /Conector 3\/4/.test(nome(c.produtoId)) || /Conv|Autom/.test(nome(c.produtoId)));
const nos = [...new Set(alvo.map((c) => c.no))];
console.log("grupo Conector (fundido):", av.financeiro!.produtos.filter((p) => /Conector 3\/4/.test(d.nomes[p.produtoId] ?? "")).map((p) => `${nome(p.produtoId)}: máx ${Math.round(p.maximoProduzivel)} projetado ${Math.round(p.finalProjetado)} lucro R$ ${p.rsProjetadoFechamento}`).join(" | "));
for (const n of nos) {
  const [p, et] = n.split("|");
  const linhas = alvo.filter((c) => c.no === n);
  console.log(`\n${nome(p)}·${(d.nomes[opPorEtapa.get(et) ?? ""] ?? "").trim()}  (postos máx ${linhas[0].postosMaximos}, produtividade ${Math.round(linhas[0].produtividadeEsperada)}):`);
  console.log("  slot:     ", linhas.map((c) => `${c.data.slice(8)}${c.periodoId}`).join(" "));
  console.log("  ocupados: ", linhas.map((c) => String(c.postosOcupados).padStart(5)).join(" "));
  console.log("  V último: ", linhas.map((c) => c.valorMarginalUltimo.toFixed(0).padStart(5)).join(" "));
  console.log("  V +1:     ", linhas.map((c) => c.valorMarginalAdicionar.toFixed(0).padStart(5)).join(" "));
  console.log("  diag:     ", linhas.map((c) => c.diagnostico.slice(0, 5).padStart(5)).join(" "));
}

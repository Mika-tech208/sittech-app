/* eslint-disable @typescript-eslint/no-explicit-any */
// Tabela por produto (meta, preço, produzido, capacidade física, postos, produtividade nominal/real, receita/h, gargalo, R$ capturável) + log de decisão econômica.
// Uso: ts.sh tabela.ts [--agora ISO] [--desloc N] [--bloco] [--out arq.md]
import * as fs from "node:fs";
import { buscar, carregar } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { avaliarPlano, planejarComFluxo, type OpcoesFluxo } from "@/features/escala/fluxo";
import { analisarCapacidade } from "@/features/escala/fluxo/capacidade";
import { contagensDoPlano, varrerContagensPreservando } from "@/features/escala/fluxo/otimizar";
import { maximosPossiveis } from "@/features/escala/fluxo/atingibilidade";
import type { AlocacaoEscala } from "@/features/escala/types";

const arg = (k: string) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : undefined; };
const agoraMs = Date.parse(arg("agora") ?? "2026-10-28T09:45:00-03:00");
const desloc = Number(arg("desloc") ?? 2);
const bloco = process.argv.includes("--bloco");
const d = carregar(buscar({ semana: "2026-10-26", antesIso: "2026-10-28T08:50:00-03:00", depoisIso: "2999-01-01T00:00:00Z", usarCache: true }));
const nome = (id: string) => (d.nomes[id] ?? id.slice(0, 8)).trim().replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Autom.").replace('Conector 3/4"', "Conector 3/4 Conv.");
const opPorEtapa = new Map(d.decisao.entrada.pools.map((p) => [p.etapaId, p.operacaoId]));
const nomeNo = (k: string) => { const [p, e] = k.split("|"); const op = opPorEtapa.get(e); return `${nome(p)}·${op ? nome(op) : e.slice(0, 6)}`; };
const med: Partial<OpcoesFluxo> = { objetivo: "financeiro", atingibilidadeModo: "sombra", economiaSlots: 99 };
const est = montarEstadoAting(d, agoraMs, d.planoAtual, desloc, med, bloco);
const idx = new Map(est.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
const fut = (l: AlocacaoEscala[]) => l.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= est.aPartirDe);
const eB = montarEstadoAting(d, agoraMs, d.planoAtual, desloc, { objetivo: "financeiro", atingibilidadeModo: "ativo", atingibilidadeK: 2, economiaSlots: 99 }, bloco);
const r = planejarComFluxo(eB.entrada, eB.dados, eB.opcoes);
const planos: Record<string, AlocacaoEscala[]> = { vigente_PROD: fut(d.planoAtual), B_receita_k2: fut(r.resultado.alocacoes) };
const L: string[] = [];
const T = est.slots.length;
for (const [nm, aloc] of Object.entries(planos)) {
  const completo = [...est.entrada.congeladas, ...aloc];
  const av = avaliarPlano(est.entrada, est.dados, completo, est.opcoes);
  const cnt = contagensDoPlano(est.ctx, aloc);
  const mins = varrerContagensPreservando(est.ctx, cnt, {}, true).minimos;
  const an = analisarCapacidade(est.ctx, completo, mins);
  const mx = maximosPossiveis(est.ctx);
  L.push(`\n## ${nm} — primeiro período mutável ${est.slots[est.aPartirDe].data} ${est.slots[est.aPartirDe].periodoId}`);
  L.push("| Produto | Meta pç | Preço | Meta R$ | Produzido final pç | R$ | Restante pç | Cap. máq. restante (etapa final) pç | Máx. atingível pç | Meta atingível | Selecionadas/Disponíveis/Ocupadas (etapa final) | Prod. nominal | Prod. real | Receita/h posto | Margem/h | Gargalo atual | R$ ainda capturável | R$ proj. fechamento | R$ falta inevitável |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  av.financeiro!.produtos.forEach((p) => {
    const sinkRow = an.capacidade.filter((c) => c.produtoId === p.produtoId && c.etapaId === p.etapaFinalId);
    const primeiro = sinkRow.find((c) => c.slot === est.aPartirDe);
    const capRest = sinkRow.reduce((s, c) => s + c.capMaquinas, 0);
    const sel = est.entrada.pools.find((q) => q.produtoId === p.produtoId && q.etapaId === p.etapaFinalId)?.maquinasIds.length ?? 0;
    const garg = av.produtos.find((q) => q.produtoId === p.produtoId)?.gargaloFluxo;
    L.push(`| ${nome(p.produtoId)} | ${Math.round(p.meta)} | ${p.precoCongelado} | ${p.rsMeta.toFixed(0)} | ${Math.round(p.realizadoFinal)} | ${p.rsRealizado.toFixed(0)} | ${Math.round(p.restante)} | ${Math.round(capRest)} | ${Math.round(p.maximoProduzivel)} | ${p.metaAtingivel ? "SIM" : "NÃO"} | ${sel}/${primeiro?.postosMaximos ?? "-"}/${primeiro?.postosOcupados ?? "-"} | ${primeiro ? Math.round(primeiro.produtividadeNominal) : "-"} | ${primeiro ? Math.round(primeiro.produtividadeEsperada) : "-"} | ${primeiro?.receitaPorHoraPosto ?? "-"} | indisponível | ${garg ? nomeNo(`${garg.produtoId}|${garg.etapaId}`) : "-"} | ${(p.rsMaximoAtingivel - p.rsRealizado).toFixed(0)} | ${p.rsProjetadoFechamento.toFixed(0)} | ${p.rsFaltaInevitavel.toFixed(0)} |`);
  });
  L.push(`\nCapacidade por etapa no 1º período mutável (${nm}):`);
  L.push("| Etapa | Máx | Ocup. | Disp. | Mín. atingib. | Pessoas | Nominal | Real | R$/h posto | CAP_ETAPA pç | V+1 pessoa R$ | V último R$ | Diagnóstico |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  an.capacidade.filter((c) => c.slot === est.aPartirDe).forEach((c) => L.push(`| ${nomeNo(c.no)} | ${c.postosMaximos} | ${c.postosOcupados} | ${c.postosDisponiveis} | ${c.postosMinimos} | ${c.pessoasElegiveis} | ${Math.round(c.produtividadeNominal)} | ${Math.round(c.produtividadeEsperada)} | ${c.receitaPorHoraPosto} | ${Math.round(c.capEtapa)} | ${c.valorMarginalAdicionar} | ${c.valorMarginalUltimo} | ${c.diagnostico} |`));
  if (nm !== "vigente_PROD") {
    L.push(`\nLog de decisão (1º período mutável):`);
    an.decisoes.filter((x) => x.slot === est.aPartirDe).forEach((x) => L.push("- " + x.texto.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (id) => nome(id)).replace(/\(([^)]*\|[^)]*)\)/g, (_m, k) => `(${nomeNo(k)})`)));
  }
  void T;
}
const txt = L.join("\n");
if (arg("out")) fs.writeFileSync(arg("out") as string, txt); else console.log(txt);

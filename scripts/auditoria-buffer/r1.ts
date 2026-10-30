/* eslint-disable @typescript-eslint/no-explicit-any */
import { carregarTudo, versoes, hhmm, nomeador, montarEstadoAting, slotsDa } from "./lib";
import { planejarComFluxo } from "@/features/escala/fluxo";
import { chavePool } from "@/features/escala/types";

const { d } = carregarTudo();
const nome = nomeador(d.nomes);
const slots = slotsDa(d);
console.log("decisao snapshot", d.decisao.data, d.decisao.periodoId, d.decisao.criadoEm, "c", d.decisao.entrada.c);
console.log("slots", slots.length, slots.map((s) => `${s.indice}:${s.data.slice(5)}${s.periodoId}`).join(" "));
const V = versoes();
console.log(Object.keys(V));
const iT1 = slots.find((s) => s.data === "2026-10-30" && s.periodoId === "t1")!.indice;
console.log("iT1", iT1);
const agoraMs = Date.parse("2026-10-30T15:36:30Z");
const plano = V["08:59"].linhas;
const e = montarEstadoAting(d, agoraMs, plano, 100 + iT1, { fluxoMesmoPeriodo: false }, true);
console.log("aPartirDe", e.aPartirDe, "ufech", e.ufech, "opcoes", JSON.stringify(e.opcoes).slice(0, 300));
const r = planejarComFluxo(e.entrada, e.dados, e.opcoes);
const st = r.diagnostico.estado;
console.log("planoEscolhido", r.diagnostico.planoEscolhido);
console.log("PARES"); st.pares.forEach((p) => console.log(" ", nome(p.produtoId), nome(p.etapaOrigemId), "->", nome(p.etapaSeguinteId), JSON.stringify(p.wip), p.confianca, p.fonteConfirmacao ?? "", JSON.stringify(p.contagem ?? {})));
console.log("DEMANDA"); st.demanda.forEach((x) => console.log(" ", nome(x.produtoId), x.etapaId.slice(0, 8), nome(x.etapaId), JSON.stringify({ final: x.final, remLegado: x.remLegado, need: x.demandaFluxo, allowed: x.tetoUtilidade, consumoDown: x.consumoDownstream, tetoPer: x.tetoPeriodo, pipe: x.pipeline, rem: x.remFluxo, lim: x.limitadoPorUtilidade })));
console.log("PRODUTOS", JSON.stringify(st.produtos.map((p) => ({ p: nome(p.produtoId), q: p.quantidadeFinal, boas: p.boasFinais, restante: p.restanteEmAPartirDe }))));

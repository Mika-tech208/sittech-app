/* eslint-disable @typescript-eslint/no-explicit-any */
import { carregarTudo, versoes, nomeador, montarEstadoAting } from "./lib";
import { planejarComFluxo } from "@/features/escala/fluxo";
const { d } = carregarTudo();
const nome = nomeador(d.nomes);
const V = versoes();
const e = montarEstadoAting(d, Date.parse("2026-10-30T15:36:30Z"), V["08:59"].linhas, 127, { fluxoMesmoPeriodo: false }, true);
const r = planejarComFluxo(e.entrada, e.dados, e.opcoes);
console.log("ALERTAS do motor (plano escolhido):");
r.resultado.alertas.forEach((a: any) => console.log(" ", JSON.stringify({ ...a, produto: nome(a.produtoId), etapa: nome(a.etapaId) })));
console.log("DIAGNOSTICOS do fluxo:");
const cont: Record<string, number> = {};
r.diagnostico.diagnosticos.forEach((x: any) => { cont[x.codigo] = (cont[x.codigo] ?? 0) + 1; });
console.log(JSON.stringify(cont));
r.diagnostico.diagnosticos.filter((x: any) => /MATERIAL|TETO|WIP|CONTAGEM|SEM_|FALTA/.test(x.codigo)).forEach((x: any) => console.log(" ", x.codigo, x.severidade, nome(x.produtoId), nome(x.etapaId), "|", x.mensagem));
console.log("RESUMO decisões:", JSON.stringify(r.diagnostico.resumoDecisoes).slice(0, 1500));
console.log("DEPOIS", JSON.stringify(r.diagnostico.depois), "ANTES", JSON.stringify(r.diagnostico.antes.faltaFinal));

/* eslint-disable @typescript-eslint/no-explicit-any */
import { carregarTudo, nomeador, montarEstadoAting } from "./lib";
import { montarEstado } from "@/features/escala/fluxo/estado";
const { d } = carregarTudo("2999-01-01T00:00:00Z");
const nome = nomeador(d.nomes);
const e = montarEstadoAting(d, Date.parse("2026-10-30T17:30:00Z"), d.versaoAntes!.linhas, 128, { fluxoMesmoPeriodo: false }, true);
const st = montarEstado(e.ctx);
console.log("ufech", e.ufech);
st.pares.forEach((p: any) => console.log(nome(p.produtoId), nome(p.etapaOrigemId), "->", nome(p.etapaSeguinteId), "wip", JSON.stringify(p.wip), "bruto", JSON.stringify(p.bruto), p.confianca, JSON.stringify(p.contagem ?? {})));
e.ctx.diagnosticos.filter((x: any) => /CONTAGEM|WIP_/.test(x.codigo)).forEach((x: any) => console.log(x.codigo, x.mensagem.slice(0, 250)));
const ini = e.ctx.iniAPartirDe;
for (const n of Object.keys(e.ctx.grafo.nos)) if (n.startsWith("27c229d7") || n.startsWith("a027")) console.log("B0", nome(n.split("|")[0]), nome(n.split("|")[1]), JSON.stringify(ini.lo.B0[n]), JSON.stringify(ini.hi.B0[n]), "membros", e.ctx.grafo.nos[n].membros.length);
const sl = e.ctx.entrada.slots; console.log(sl.slice(25).map((s: any) => s.indice + ":" + s.periodoId + ":" + new Date(s.inicioMs - 3*3600e3).toISOString().slice(11,16) + "-" + new Date(s.fimMs - 3*3600e3).toISOString().slice(11,16)).join(" "));
e.ctx.diagnosticos.filter((x: any) => /PRODUCAO_NAO|AJUSTE|FORA_DO/.test(x.codigo)).forEach((x: any) => console.log(x.codigo, nome(x.produtoId), nome(x.etapaId), x.mensagem.slice(0, 200)));

/* eslint-disable @typescript-eslint/no-explicit-any */
// Aderência à Escala por período (postos planejados × executados). Dados: SELECT em PROD (cache). Uso: ATING_CACHE=<dir> ts.sh aderencia.ts [--agora ISO] [--janela-ate ISO]
// ATENÇÃO: o plano usado é `escala_producao_alocacoes` ATUAL (linhas de períodos passados ficam congeladas como planejadas). Aderência por PESSOA não é medível (funcionario_id = quem lançou).
import { buscar, carregar } from "./carga";
import { slotsDa } from "./estado";
import { aderenciaPorPeriodo } from "@/features/escala/fluxo";
const arg = (k: string) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : undefined; };
const agoraMs = Date.parse(arg("agora") ?? new Date().toISOString());
const janela = Date.parse(arg("janela-ate") ?? "2026-10-28T13:00:00-03:00");
const d = carregar(buscar({ semana: "2026-10-26", antesIso: new Date(agoraMs).toISOString(), depoisIso: "2999-01-01T00:00:00Z", usarCache: process.argv.includes("--cache") }));
const r = aderenciaPorPeriodo(slotsDa(d), d.planoAtual, d.apontamentos, { agoraMs, janelaConfiavelAteMs: janela });
console.log("data    per | fech | plan igual div nãoExec semApt fora manual | aderência (apontados) | bruta | janela | motivos");
r.filter((x) => x.fechado).forEach((x) => console.log(`${x.data.slice(5)} ${x.periodoId} | ${x.planejados.toString().padStart(3)} ${x.igual.toString().padStart(4)} ${x.divergente.toString().padStart(3)} ${x.naoExecutado.toString().padStart(5)} ${x.semApontamento.toString().padStart(5)} ${x.foraDoPlano.toString().padStart(4)} ${x.intervencoesManuais.toString().padStart(5)} | ${x.aderencia === null ? "-" : (x.aderencia * 100).toFixed(0) + "%"} | ${x.aderenciaBruta === null ? "-" : (x.aderenciaBruta * 100).toFixed(0) + "%"} | ${x.janela} | ${JSON.stringify(x.motivos)}`));

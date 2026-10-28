// PROVA matemática da Caixa (3 × 4 pessoas na Montagem) com os dados reais: capacidade por posto/período, oferta de material, máximo possível e folga.
import { buscar, carregar } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { modelo, Avaliador, contagensDoPlano } from "@/features/escala/fluxo/otimizar";
import { montarEstado } from "@/features/escala/fluxo/estado";
import { postosMinimosUltimoElo } from "@/features/escala/fluxo/atingibilidade";

const arg = (k: string) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : undefined; };
const agoraMs = Date.parse(arg("agora") ?? "2026-10-28T09:00:00-03:00");
const desloc = Number(arg("desloc") ?? 1) as 1 | 2;
const d = carregar(buscar({ semana: "2026-10-26", antesIso: "2026-10-28T08:50:00-03:00", depoisIso: "2999-01-01T00:00:00Z", usarCache: true }));
const nome = (id: string) => (d.nomes[id] ?? id.slice(0, 8)).trim();
const e = montarEstadoAting(d, agoraMs, d.planoAtual, desloc, { preservarAtingibilidade: true });
const ctx = e.ctx;
const m = modelo(ctx);
const T = e.slots.length;
const g = ctx.grafo.grupos.find((x) => ctx.grafo.nos[x.sink].membros.some((k) => nome(k.split("|")[0]).startsWith("Caixa")))!;
const gi = ctx.grafo.grupos.indexOf(g);
const nos = g.nos;
const estado = montarEstado(ctx);
console.log(`aPartirDe = ${e.slots[e.aPartirDe].data} ${e.slots[e.aPartirDe].periodoId}; Q=${ctx.grafo.nos[g.sink].quantidade}; B0(lo) final=${ctx.iniAPartirDe.lo.B0[g.sink]}; restante=${ctx.grafo.nos[g.sink].quantidade - ctx.iniAPartirDe.lo.B0[g.sink]}`);
nos.forEach((n) => console.log(`nó ${n.split("|")[1].slice(0, 8)}: B0=${ctx.iniAPartirDe.lo.B0[n]} W0(aresta)=${ctx.iniAPartirDe.lo.W0[n] ?? "-"}`));
const linhas: string[] = ["slot | " + nos.map((n) => `mu(${n.slice(-4)})×maq`).join(" | ")];
for (let t = e.aPartirDe; t < T; t++) linhas.push(`${e.slots[t].data.slice(5)} ${e.slots[t].periodoId} | ` + nos.map((n) => `${Math.round(m.mu[n][t])}×${m.maquinas[n][t].length}`).join(" | "));
console.log(linhas.join("\n"));
const cnt = contagensDoPlano(ctx, e.plano.filter((a) => (ctx.idxSlot.get(`${a.data}|${a.periodoId}`) ?? -1) >= e.aPartirDe));
const av = new Avaliador(ctx, m, cnt, estado.remPorPool);
// anda até o cursor = aPartirDe (já está). Alcance com tudo no máximo e variando o nº de postos da Montagem no 1º período mutável
const montagem = nos[nos.length - 1];
const et = nos[0];
const t0 = e.aPartirDe;
const maxAll = (k: number) => {
  nos.forEach((n) => av.set(n, t0, n === montagem ? k : m.maquinas[n][t0].length));
  return av.valorFuturoMax(gi);
};
for (let k = 4; k >= 0; k--) console.log(`Montagem com ${k} posto(s) no 1º período mutável, demais no máximo: final = ${maxAll(k).toFixed(1)}`);
// somatórios
const sum = (n: string, de: number) => { let s = 0; for (let t = de; t < T; t++) s += m.maquinas[n][t].length * m.mu[n][t]; return s; };
const W0 = ctx.iniAPartirDe.lo.W0[et] ?? 0;
console.log(`Σ cap. Montagem (4 postos, desde 1º período) = ${sum(montagem, t0).toFixed(0)}; Σ cap. Montagem DEPOIS do 1º período = ${sum(montagem, t0 + 1).toFixed(0)}; Σ cap. Etiquetadora = ${sum(et, t0).toFixed(0)}; WIP = ${W0.toFixed(0)}; oferta = ${(W0 + sum(et, t0)).toFixed(0)}`);
const R = ctx.grafo.nos[g.sink].quantidade - ctx.iniAPartirDe.lo.B0[g.sink];
const oferta = W0 + sum(et, t0);
console.log(`restante=${R.toFixed(0)}; máx. possível restante = min(oferta, Σ Montagem) = ${Math.min(oferta, sum(montagem, t0)).toFixed(0)}; falta inevitável = ${(R - Math.min(oferta, sum(montagem, t0))).toFixed(0)}`);
console.log("fórmula último elo (alvo = máximo possível):", JSON.stringify(postosMinimosUltimoElo({ restanteFinal: Math.min(oferta, sum(montagem, t0)), capacidadeMaximaDepois: sum(montagem, t0 + 1), capacidadePorPosto: m.mu[montagem][t0], postosMaximos: 4 })));
console.log("fórmula último elo (alvo = meta cheia):", JSON.stringify(postosMinimosUltimoElo({ restanteFinal: R, capacidadeMaximaDepois: sum(montagem, t0 + 1), capacidadePorPosto: m.mu[montagem][t0], postosMaximos: 4 })));

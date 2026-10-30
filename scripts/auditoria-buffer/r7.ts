/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from "node:fs";
import { carregarTudo, nomeador, montarEstadoAting, slotsDa, SCR } from "./lib";
import { planejarComFluxo } from "@/features/escala/fluxo";
import { desempacotarLinha } from "@/features/escala/snapshotSombra";
import { chavePool, type AlocacaoEscala } from "@/features/escala/types";

const { d } = carregarTudo();
const nome = nomeador(d.nomes);
const slots = slotsDa(d);
const t = fs.readFileSync(SCR + "/v3.sql.out", "utf8");
const vers: { valido: string; ms: number; linhas: AlocacaoEscala[] }[] = JSON.parse(t.slice(t.indexOf("{"))).rows.map((r: any) => ({ valido: r.valido, ms: Number(r.valido_ms), linhas: r.linhas.map(desempacotarLinha) }));
const PC = "27c229d7-f192-41eb-aad1-0c69ece53eba", PA = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const NODES: Record<string, string> = { Ros: `${PC}|ca90456c-9077-40f4-a058-bd0f467e87ec`, Paf: `${PC}|78aaa207-b8cc-412a-8a8b-d17bd95a1930`, M8: `${PA}|1b72bf46-5d13-43c5-89b4-6169436085b7`, Eti: `${PC}|34371af3-2608-42cc-9ded-1f7815a635a8`, Emb: `${PC}|b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4` };
const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
const cnt = (l: AlocacaoEscala[], t: number) => Object.fromEntries(Object.keys(NODES).map((k) => [k, l.filter((a) => a.maquinaId && idx.get(`${a.data}|${a.periodoId}`) === t && chavePool(a.produtoId!, a.etapaId!) === NODES[k] || (k === "Eti" && a.maquinaId && idx.get(`${a.data}|${a.periodoId}`) === t && a.produtoId === PA && a.etapaId === "1863b452-77f3-4d5c-9c49-a6d28ae77131")).length]));
const fmt = (c: any) => Object.entries(c).map(([k, v]) => `${k}${v}`).join(" ");

const casos = [
  { nome: "28/10 12:06 fech", agora: "2026-10-28T15:06:15Z", ap: 15 },
  { nome: "28/10 13:49 evento", agora: "2026-10-28T16:49:40Z", ap: 16 },
  { nome: "29/10 12:06 fech", agora: "2026-10-29T15:06:15Z", ap: 21 },
  { nome: "29/10 14:11 evento", agora: "2026-10-29T17:11:23Z", ap: 22 },
  { nome: "29/10 17:42 evento", agora: "2026-10-29T20:42:32Z", ap: 24 },
  { nome: "30/10 07:10 evento", agora: "2026-10-30T10:10:05Z", ap: 24 },
  { nome: "30/10 08:59 fech", agora: "2026-10-30T11:59:13Z", ap: 26 },
  { nome: "30/10 10:35 fech", agora: "2026-10-30T13:35:22Z", ap: 27 },
];
const alvo = process.argv[2];
for (const c of casos) {
  if (alvo && !c.nome.startsWith(alvo)) continue;
  const agoraMs = Date.parse(c.agora);
  const vigente = [...vers].filter((v) => v.ms < agoraMs - 1000).pop()!;
  const depois = vers.find((v) => v.ms >= agoraMs - 1000 && v.ms <= agoraMs + 120000); // versão gravada por este recálculo
  const e = montarEstadoAting(d, agoraMs, vigente.linhas, 100 + c.ap, { fluxoMesmoPeriodo: false }, true);
  const r = planejarComFluxo(e.entrada, e.dados, e.opcoes);
  const dem = r.diagnostico.estado.demanda;
  const g = (k: string) => dem.find((x) => chavePool(x.produtoId, x.etapaId) === NODES[k])!;
  const par = (a: string) => { const p = r.diagnostico.estado.pares.find((x) => x.etapaOrigemId === a && x.produtoId === PC); return p ? `${Math.round(p.wip.lo)}-${Math.round(p.wip.hi)}(${p.confianca})` : "-"; };
  console.log(`\n=== ${c.nome} | aPartirDe ${slots[c.ap].data.slice(5)} ${slots[c.ap].periodoId} | vigente=${vigente.valido} | gravou=${depois?.valido ?? "-"} | escolhido(replay)=${r.diagnostico.planoEscolhido}`);
  console.log(`  WIP Ros>Paf ${par("ca90456c-9077-40f4-a058-bd0f467e87ec")} Paf>Eti ${par("78aaa207-b8cc-412a-8a8b-d17bd95a1930")} Eti>Emb ${par("34371af3-2608-42cc-9ded-1f7815a635a8")}`);
  console.log("  rem/allowed/need/pipeHi: " + ["Ros", "Paf", "M8", "Eti"].map((k) => { const x = g(k); return `${k} rem ${Math.round(x.remFluxo)} allowed ${x.tetoUtilidade === null ? "-" : Math.round(x.tetoUtilidade)} need ${Math.round(x.demandaFluxo)} pipeHi ${Math.round(x.pipeline.hi)}`; }).join(" | "));
  for (let t2 = c.ap; t2 < Math.min(c.ap + 6, slots.length); t2++) {
    const rp = cnt(r.resultado.alocacoes, t2);
    const pp = depois ? cnt(depois.linhas, t2) : null;
    console.log(`  ${slots[t2].data.slice(5)} ${slots[t2].periodoId}: replay ${fmt(rp)}${pp ? "   | PROD " + fmt(pp) : ""}`);
  }
}

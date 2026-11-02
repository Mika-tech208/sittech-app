/* eslint-disable @typescript-eslint/no-explicit-any */
// Gera as tabelas (markdown) da Frente D a partir dos planos gravados por replanejar-D.ts: por operação, 24 períodos do Conector 3/4 (consumos, buffers, quando acabam os estoques), Caixa, M1–T1 posto a posto.
// Rodar: fb/ts.sh scripts/frente-d/relatorio-D.ts  → D12/frente-D-tabelas.md
import * as fs from "node:fs";
import { montarEstado as carregar } from "../ativacao-0211/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { expandirPorProduto } from "@/features/escala/distribuicao";
import type { AlocacaoEscala } from "@/features/escala/types";
import { D12, simular, cadeiasDe, rotuloSlot, n0 } from "./lib";

process.env.SQL_DIR = process.env.SQL_DIR ?? `${D12}/dumps`;
const { estado } = carregar();
estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
const entrada = montarEntradaEscala(estado, Date.parse("2026-11-02T20:25:00-03:00")).entrada;
const H = entrada.slots.length;
const nomeP = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const nomeO = (id: string) => (estado.nomesOperacao[id] ?? id).trim();
const nomeM = (id: string | null) => (id ? ((estado.nomesMaquinas?.[id] ?? id).trim().replace("Maquina Automatica", "M8")) : "—");
const prods = [...new Set(entrada.pools.map((p) => p.produtoId))];
const ehAut = (id: string) => /Autom/i.test(nomeP(id));
const conv = prods.find((id) => nomeP(id).startsWith('Conector 3/4"') && !ehAut(id))!, aut = prods.find(ehAut)!, cx = prods.find((id) => /Caixa/i.test(nomeP(id)))!;
const curto = (id: string) => (id === conv ? "Conv" : id === aut ? "Autom" : id === cx ? "Caixa" : nomeP(id));
const plano = (nome: string): AlocacaoEscala[] => JSON.parse(fs.readFileSync(`${D12}/planos/${nome}.json`, "utf8"));
const WIP: Record<string, Record<string, number[]>> = {
  B: { [conv]: [3200, 3700, 3600], [aut]: [0, 0], [cx]: [2300] },
  Di: { [conv]: [4000, 2400, 3600], [aut]: [0, 0], [cx]: [2500] },
  Dii: { [conv]: [4000, 2400, 3600], [aut]: [2400, 0], [cx]: [2500] },
  Diii: { [conv]: [4000, 0, 3600], [aut]: [2400, 0], [cx]: [2500] },
};
const out: string[] = [];
const P = (s = "") => out.push(s);
const idx = new Map(entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
const cad = cadeiasDe(entrada);
const etapaDe = (pid: string, k: number) => cad.find((c) => c.produtoId === pid)!.etapas[k];
const porOp = (linhas: AlocacaoEscala[], pid: string, k: number) => {
  const e = etapaDe(pid, k);
  const ex = expandirPorProduto(linhas).filter((a) => a.maquinaId && a.produtoId === pid && a.etapaId === e.etapaId);
  return { pecas: ex.reduce((s, a) => s + a.pecas, 0), pp: new Set(ex.map((a) => `${idx.get(`${a.data}|${a.periodoId}`)}|${a.maquinaId}`)).size, maqs: [...new Set(ex.map((a) => nomeM(a.maquinaId)))].sort() };
};

// ---------- T2: por produto × operação ----------
const comp: [string, string][] = [["ATIVO", "B"], ["Di-motor-s1", "Di"], ["Dii-motor-s1", "Dii"], ["Diii-motor-s1", "Diii"], ["Di-limpo-s1", "Di"]];
P("## T2 — peças e posto-períodos por produto × operação (plano completo, 24 períodos)");
P("| Produto · operação | " + comp.map(([n]) => n).join(" | ") + " |");
P("|---|" + comp.map(() => "---:|").join(""));
[conv, aut, cx].forEach((pid) => cad.find((c) => c.produtoId === pid)!.etapas.forEach((e, k) => {
  P(`| ${curto(pid)} · ${nomeO(e.operacaoId)} | ` + comp.map(([n]) => { const r = porOp(plano(n), pid, k); return `${n0(r.pecas)} pç · ${r.pp} pp`; }).join(" | ") + " |");
}));
["Pino", "Plug"].forEach((nm) => {
  const pid = prods.find((id) => nomeP(id).startsWith(nm))!;
  P(`| ${nm} · ${nomeO(etapaDe(pid, 0).operacaoId)} | ` + comp.map(([n]) => { const r = porOp(plano(n), pid, 0); return `${n0(r.pecas)} pç · ${r.pp} pp`; }).join(" | ") + " |");
});
P();

// ---------- T3: Conector 3/4, 24 períodos ----------
function tabelaConector(titulo: string, linhas: AlocacaoEscala[], wip: Record<string, number[]>) {
  const sim = simular(entrada, linhas, wip);
  const sc = sim.find((s) => s.produtoId === conv)!, sa = sim.find((s) => s.produtoId === aut)!;
  P(`### ${titulo}`);
  P("| Período | Ros (plan) | Paf (plan) | M8 | Etiq15 Conv plan→efet | Etiq15 Autom | Emb17 Conv plan→efet | Emb17 Autom | saldo Ros→Paf | saldo Paf→Etiq | saldo M8→Etiq | saldo Etiq→Emb (Conv/Autom) | ruptura |");
  P("|---|---:|---:|---:|---|---:|---|---:|---:|---:|---:|---|---|");
  for (let t = 0; t < H; t++) {
    const rup = [sc.ruptura[2][t] > 0.5 ? `Etiq −${n0(sc.ruptura[2][t])}` : "", sc.ruptura[3][t] > 0.5 ? `Emb −${n0(sc.ruptura[3][t])}` : "", sc.ruptura[1][t] > 0.5 ? `Paf −${n0(sc.ruptura[1][t])}` : "", sa.ruptura[1][t] > 0.5 ? `AutEtiq −${n0(sa.ruptura[1][t])}` : "", sa.ruptura[2][t] > 0.5 ? `AutEmb −${n0(sa.ruptura[2][t])}` : ""].filter(Boolean).join(" ");
    P(`| ${rotuloSlot(entrada, t)} | ${n0(sc.planejado[0][t])} | ${n0(sc.planejado[1][t])} | ${n0(sa.planejado[0][t])} | ${n0(sc.planejado[2][t])}→${n0(sc.efetivo[2][t])} | ${n0(sa.planejado[1][t])} | ${n0(sc.planejado[3][t])}→${n0(sc.efetivo[3][t])} | ${n0(sa.planejado[2][t])} | ${n0(sc.saldo[0][t + 1])} | ${n0(sc.saldo[1][t + 1])} | ${n0(sa.saldo[0][t + 1])} | ${n0(sc.saldo[2][t + 1])} / ${n0(sa.saldo[1][t + 1])} | ${rup || "—"} |`);
  }
  // quando acabam os estoques iniciais (sem reposição) e "último período seguro" do upstream — pelo consumo PLANEJADO de cada etapa
  const cumprim = (v: number[], lim: number) => { let s = 0; for (let t = 0; t < H; t++) { s += v[t]; if (s > lim) return t; } return -1; };
  const w = wip[conv];
  const tPaf = cumprim(sc.planejado[2], w[1]), tRos = cumprim(sc.planejado[1], w[0]), tEmb = cumprim(sc.planejado[3], w[2]);
  P();
  P(`- Consumo planejado cumulativo da **Etiquetadora 15 (Conv)** passa das ${n0(w[1])} parafusadas em **${tPaf >= 0 ? rotuloSlot(entrada, tPaf) : "nunca"}** ⇒ a Parafusar precisa ter produzido o excedente até o fim de **${tPaf > 0 ? rotuloSlot(entrada, tPaf - 1) : "—"}** (lote de 1 período) — i.e. **ligada em ${tPaf > 0 ? rotuloSlot(entrada, tPaf - 1) : "—"} ou antes**.`);
  P(`- Consumo planejado cumulativo da **Parafusar** passa das ${n0(w[0])} rosqueadas em **${tRos >= 0 ? rotuloSlot(entrada, tRos) : "nunca"}** ⇒ a Rosquear precisa estar **ligada em ${tRos > 0 ? rotuloSlot(entrada, tRos - 1) : "—"} ou antes**.`);
  P(`- Consumo planejado cumulativo da **Embalagem 17 (Conv)** passa das ${n0(w[2])} etiquetadas em **${tEmb >= 0 ? rotuloSlot(entrada, tEmb) : "nunca"}** ⇒ a Etiquetadora precisa ter entregue o excedente até o fim de ${tEmb > 0 ? rotuloSlot(entrada, tEmb - 1) : "—"}.`);
  const mu8 = sa.planejado[0].reduce((a, b) => a + b, 0);
  P(`- Máquina 8 no plano: ${n0(mu8)} pç na semana (Autom: M8→Etiq→Emb); no Convencional a M8 não entra (cadeias separadas).`);
  P();
}
P("## T3 — Conector 3/4, período a período (4.000 rosqueadas / 2.400 parafusadas / 3.600 etiquetadas)");
tabelaConector("T3a — plano ATIVO (B) contra o estoque FÍSICO D(i) — onde rompe", plano("ATIVO"), WIP.Di);
tabelaConector("T3b — plano ATIVO (B) contra o estoque B (como foi desenhado)", plano("ATIVO"), WIP.B);
tabelaConector("T3c — plano RECALCULADO pelo motor com D(i) (parte do ativo; θ; pessoas estáveis)", plano("Di-motor-s1"), WIP.Di);
tabelaConector("T3d — plano ATIVO contra D(iii) (as 2.400 são todas da M8)", plano("ATIVO"), WIP.Diii);
tabelaConector("T3e — plano RECALCULADO com D(iii)", plano("Diii-motor-s1"), WIP.Diii);

// ---------- T4: Caixa ----------
P("## T4 — Caixa Amarela 4x2 (2.500 etiquetadas esperando Montar Presilha)");
P("| Plano | Etiquetar (Etiq 16) pç/pp | Montar Presilha (Mont 18/18B/19/19B) pç/pp | final Caixa | corte |");
P("|---|---|---|---:|---:|");
[["ATIVO (B 2.300)", "ATIVO", "B"], ["motor com D(i) (2.500)", "Di-motor-s1", "Di"], ["limpo D(i) s1", "Di-limpo-s1", "Di"]].forEach(([r, n, w]) => {
  const e = porOp(plano(n), cx, 0), m = porOp(plano(n), cx, 1);
  const s = simular(entrada, plano(n), WIP[w]).find((x) => x.produtoId === cx)!;
  P(`| ${r} | ${n0(e.pecas)} / ${e.pp} (${e.maqs.join(", ")}) | ${n0(m.pecas)} / ${m.pp} (${m.maqs.join(", ")}) | ${n0(m.pecas)} | ${n0(56400 - m.pecas)} |`);
  void s;
});
const sCx = (n: string, w: string) => simular(entrada, plano(n), WIP[w]).find((x) => x.produtoId === cx)!;
P();
P("Saldo Etiquetar→Montar ao fim de cada período (ATIVO@B / ATIVO@D / motor@D): " + [0, 3, 7, 11, 15, 19, 23].map((t) => `${rotuloSlot(entrada, t)}: ${n0(sCx("ATIVO", "B").saldo[0][t + 1])}/${n0(sCx("ATIVO", "Di").saldo[0][t + 1])}/${n0(sCx("Di-motor-s1", "Di").saldo[0][t + 1])}`).join(" · "));
P();

// ---------- T5: M1–T1 posto a posto ----------
function periodoLinhas(linhas: AlocacaoEscala[], t: number) {
  return linhas.filter((a) => a.maquinaId && idx.get(`${a.data}|${a.periodoId}`) === t).map((a) => `${nomeM(a.maquinaId)}: ${(a.distribuicao ?? [{ produtoId: a.produtoId!, etapaId: a.etapaId!, pecas: a.pecas }]).map((d) => `${curto(d.produtoId)} ${nomeO(entrada.pools.find((p) => p.produtoId === d.produtoId && p.etapaId === d.etapaId)!.operacaoId).slice(0, 8)} ${n0(d.pecas)}`).join(" + ")}`).sort();
}
P("## T5 — primeiros períodos de 03/11, posto a posto: ATIVO × motor com D(i)");
for (let t = 0; t < 4; t++) {
  const a = new Set(periodoLinhas(plano("ATIVO"), t)), b = new Set(periodoLinhas(plano("Di-motor-s1"), t));
  const ig = [...a].filter((x) => b.has(x)).length;
  P(`### ${rotuloSlot(entrada, t)} — ${a.size} postos no ativo · ${b.size} no recalculado · idênticos (máquina+produto+operação+peças) ${ig}`);
  P("- só no ATIVO: " + ([...a].filter((x) => !b.has(x)).join(" ; ") || "—"));
  P("- só no RECALCULADO: " + ([...b].filter((x) => !a.has(x)).join(" ; ") || "—"));
}
fs.writeFileSync(`${D12}/frente-D-tabelas.md`, out.join("\n") + "\n");
console.log("ok", out.length, "linhas");

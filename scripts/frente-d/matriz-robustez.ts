/* eslint-disable @typescript-eslint/no-explicit-any */
// Matriz de robustez: cada plano (ATIVO, motor D(i)/(ii)/(iii)) simulado contra cada verdade possível (D(i)/(ii)/(iii)). Mostra o custo de errar a hipótese sobre a M8→Etiquetar.
// Rodar: fb/ts.sh scripts/frente-d/matriz-robustez.ts  (usa D12/planos/*.json e D12/dumps)
import * as fs from "node:fs";
import { montarEstado as carregar } from "../ativacao-0211/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { expandirPorProduto } from "@/features/escala/distribuicao";
import type { AlocacaoEscala } from "@/features/escala/types";
import { D12, simular, cadeiasDe, rotuloSlot } from "./lib";

process.env.SQL_DIR = process.env.SQL_DIR ?? `${D12}/dumps`;
const { estado } = carregar();
const entrada = montarEntradaEscala(estado, Date.parse("2026-11-02T20:25:00-03:00")).entrada;
const nomeP = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const prods = [...new Set(entrada.pools.map((p) => p.produtoId))];
const ehAut = (id: string) => /Autom/i.test(nomeP(id));
const conv = prods.find((id) => nomeP(id).startsWith('Conector 3/4"') && !ehAut(id))!, aut = prods.find(ehAut)!, cx = prods.find((id) => /Caixa/i.test(nomeP(id)))!;
const VERDADE: Record<string, Record<string, number[]>> = {
  "D(i)": { [conv]: [4000, 2400, 3600], [aut]: [0, 0], [cx]: [2500] },
  "D(ii)": { [conv]: [4000, 2400, 3600], [aut]: [2400, 0], [cx]: [2500] },
  "D(iii)": { [conv]: [4000, 0, 3600], [aut]: [2400, 0], [cx]: [2500] },
};
const PLANOS: [string, string][] = [["ATIVO (B)", "ATIVO"], ["motor D(i)", "Di-motor-s1"], ["motor D(ii)", "Dii-motor-s1"], ["motor D(iii)", "Diii-motor-s1"], ["motor D(iv) conservador (Conv Paf→Etiq 0, M8 0)", "Div-motor-s1"]];
const margem: Record<string, number> = { [cx]: 0.1282, [conv]: 0.1007, [aut]: 0.1205 };
const linhas: string[] = ["| Plano \\ verdade | " + Object.keys(VERDADE).join(" | ") + " |", "|---|" + Object.keys(VERDADE).map(() => "---|").join("")];
for (const [rot, arq] of PLANOS) {
  const plano = JSON.parse(fs.readFileSync(`${D12}/planos/${arq}.json`, "utf8")) as AlocacaoEscala[];
  const cel = Object.entries(VERDADE).map(([, wip]) => {
    const sim = simular(entrada, plano, wip);
    const rupt = sim.reduce((s, t) => s + t.ruptura.reduce((a, v) => a + v.reduce((x, y) => x + y, 0), 0), 0);
    const perdaConv = (() => { const t = sim.find((x) => x.produtoId === conv)!; const n = t.planejado.length - 1; return t.planejado[n].reduce((a, b) => a + b, 0) - t.efetivo[n].reduce((a, b) => a + b, 0); })();
    const perdaAut = (() => { const t = sim.find((x) => x.produtoId === aut)!; const n = t.planejado.length - 1; return t.planejado[n].reduce((a, b) => a + b, 0) - t.efetivo[n].reduce((a, b) => a + b, 0); })();
    const primeira = sim.map((t) => t.ruptura.map((v, k) => ({ k, i: v.findIndex((x) => x > 0.5) })).filter((x) => x.i >= 0).map((x) => x.i)).flat().sort((a, b) => a - b)[0];
    const exp = expandirPorProduto(plano);
    void exp;
    return rupt < 0.5 ? "sem ruptura" : `ruptura ${Math.round(rupt)} pç (perda final Conv ${Math.round(perdaConv)}, Autom ${Math.round(perdaAut)} ≈ R$ ${Math.round(perdaConv * margem[conv] + perdaAut * margem[aut])}; 1ª em ${rotuloSlot(entrada, primeira)})`;
  });
  linhas.push(`| ${rot} | ${cel.join(" | ")} |`);
}
const saida = linhas.join("\n");
console.log(saida);
fs.writeFileSync(`${D12}/matriz-robustez.md`, saida + "\n");

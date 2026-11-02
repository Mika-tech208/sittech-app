/* eslint-disable @typescript-eslint/no-explicit-any */
// Replaneja a 02/11 com os cenários de contagem (B, D(i), D(ii), D(iii)) e compara com o plano ATIVO de PROD. OFFLINE; nada é gravado.
//  - "limpo": planejador sem partida (o que o preview mostra);  - "motor": como o recálculo real faria ao chegar a contagem (parte do plano ativo + θ + estabilidade de pessoas).
// Rodar: fb/ts.sh scripts/frente-d/replanejar-D.ts   (env: SQL_DIR, SEMENTES="1,2,3")
import * as fs from "node:fs";
import { montarEstado as carregar } from "../ativacao-0211/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { expandirPorProduto } from "@/features/escala/distribuicao";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo/tipos";
import type { AlocacaoEscala } from "@/features/escala/types";
import { D12, carregarPlanoAtivo, simular, cadeiasDe, chavePosto } from "./lib";

process.env.SQL_DIR = process.env.SQL_DIR ?? `${D12}/dumps`;
const { estado } = carregar();
estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
const AGORA = Date.parse("2026-11-02T20:25:00-03:00");
const entrada = montarEntradaEscala(estado, AGORA).entrada;
const nomeP = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const prods = [...new Set(entrada.pools.map((p) => p.produtoId))];
const ehAut = (id: string) => /Autom/i.test(nomeP(id));
const conv = prods.find((id) => nomeP(id).startsWith('Conector 3/4"') && !ehAut(id))!, aut = prods.find(ehAut)!, cx = prods.find((id) => /Caixa/i.test(nomeP(id)))!;
const CEN: Record<string, { wip: Record<string, number[]>; contadoEm: string }> = {
  B: { wip: { [conv]: [3200, 3700, 3600], [aut]: [0, 0], [cx]: [2300] }, contadoEm: "2026-11-02T06:00:00-03:00" },
  "D(i)": { wip: { [conv]: [4000, 2400, 3600], [aut]: [0, 0], [cx]: [2500] }, contadoEm: "2026-11-02T20:20:00-03:00" },
  "D(ii)": { wip: { [conv]: [4000, 2400, 3600], [aut]: [2400, 0], [cx]: [2500] }, contadoEm: "2026-11-02T20:20:00-03:00" },
  "D(iii)": { wip: { [conv]: [4000, 0, 3600], [aut]: [2400, 0], [cx]: [2500] }, contadoEm: "2026-11-02T20:20:00-03:00" },
  "D(iv)": { wip: { [conv]: [4000, 0, 3600], [aut]: [0, 0], [cx]: [2500] }, contadoEm: "2026-11-02T20:20:00-03:00" }, // conservador: nem as 2.400 são do Conv nem há pilha da M8
};
const CONFIG = lerConfigPlanejador(JSON.parse(fs.readFileSync("scripts/ativacao-0211/config-planejador.json", "utf8")));
const ativo = carregarPlanoAtivo(process.env.SQL_DIR!);
const margem = CONFIG.margemPorPeca!;
const sementes = (process.env.SEMENTES ?? "1,2,3").split(",").map(Number);

function contagens(wip: Record<string, number[]>, contadoEm: string): ContagemFisicaPar[] {
  const out: ContagemFisicaPar[] = [];
  Object.entries(wip).forEach(([pid, v]) => {
    const ps = entrada.pools.filter((p) => p.produtoId === pid).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
    for (let k = 0; k + 1 < ps.length; k++) out.push({ produtoId: pid, etapaOrigemId: ps[k].etapaId, etapaSeguinteId: ps[k + 1].etapaId, saldo: v[k] ?? 0, contadoEmMs: Date.parse(contadoEm), informadoPor: "frente-d" });
  });
  return out;
}
const finais = (linhas: AlocacaoEscala[]) => {
  const ex = expandirPorProduto(linhas);
  return Object.fromEntries(cadeiasDe(entrada).map((c) => [nomeP(c.produtoId), ex.filter((a) => a.produtoId === c.produtoId && a.etapaId === c.etapas[c.etapas.length - 1].etapaId).reduce((s, a) => s + a.pecas, 0)]));
};
const margemDe = (linhas: AlocacaoEscala[]) => { const ex = expandirPorProduto(linhas); return cadeiasDe(entrada).reduce((s, c) => s + ex.filter((a) => a.produtoId === c.produtoId && a.etapaId === c.etapas[c.etapas.length - 1].etapaId).reduce((x, a) => x + a.pecas, 0) * (margem[c.produtoId] ?? 0), 0); };
const idxS = new Map(entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
const postosSet = (l: AlocacaoEscala[]) => new Set(expandirPorProduto(l).filter((a) => a.maquinaId).map((a) => `${idxS.get(`${a.data}|${a.periodoId}`)}|${chavePosto(a)}`));
const pessoaPosto = (l: AlocacaoEscala[]) => new Map(l.map((a) => [`${idxS.get(`${a.data}|${a.periodoId}`)}|${a.funcionarioId}`, a.maquinaId ? chavePosto(a) : "-"]));

function comparar(novo: AlocacaoEscala[], base: AlocacaoEscala[]) {
  const A = postosSet(base), B = postosSet(novo);
  let saem = 0, entram = 0, primeiros: string[] = [];
  A.forEach((k) => { if (!B.has(k)) saem++; });
  B.forEach((k) => { if (!A.has(k)) entram++; });
  const pa = pessoaPosto(base), pb = pessoaPosto(novo);
  let trocaPessoa = 0;
  pb.forEach((v, k) => { if (pa.get(k) !== v) trocaPessoa++; });
  const lim = 4; // 03/11 M1–T1
  const ate = (S: Set<string>) => [...S].filter((k) => Number(k.split("|")[0]) < lim);
  const A4 = new Set(ate(A)), B4 = new Set(ate(B));
  const sai4 = [...A4].filter((k) => !B4.has(k)), ent4 = [...B4].filter((k) => !A4.has(k));
  primeiros = [...sai4.map((k) => "-" + k), ...ent4.map((k) => "+" + k)];
  return { postosSaem: saem, postosEntram: entram, pessoaPostoMudou: trocaPessoa, saem4: sai4.length, entram4: ent4.length, de: A.size, para: B.size, primeiros };
}

const resultados: any[] = [];
const planos: Record<string, AlocacaoEscala[]> = { ATIVO: ativo };
function rodar(rotulo: string, cen: string, modo: "limpo" | "motor", semente: number) {
  const c = CEN[cen];
  const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: modo === "motor" ? ativo : [], contagensFisicas: contagens(c.wip, c.contadoEm) };
  const cfg = { ...CONFIG, busca: { ...(CONFIG.busca ?? {}), semente }, buscaComVigente: { ...(CONFIG.buscaComVigente ?? {}), semente }, ...(modo === "motor" ? { partirDoVigente: true } : {}) };
  const t0 = Date.now();
  const r = planejarSemanaComCorte(entrada, dados, { fluxoMesmoPeriodo: false }, cfg, modo === "motor" ? ativo : []);
  const ms = Date.now() - t0;
  if (!r.ok || !r.resultado) { console.log(`${rotulo}: FALHOU ${r.motivo}`); resultados.push({ rotulo, ok: false, motivo: r.motivo }); return; }
  const linhas = r.resultado.alocacoes;
  planos[rotulo] = linhas;
  const fin = finais(linhas);
  const sim = simular(entrada, linhas, c.wip);
  const ruptura = sim.reduce((s, t) => s + t.ruptura.reduce((a, v) => a + v.reduce((x, y) => x + y, 0), 0), 0);
  const cmp = comparar(linhas, ativo);
  const res = {
    rotulo, cen, modo, semente, ok: true, ms, hash: hashAlocacoes(linhas).slice(0, 16), total: Object.values(fin).reduce((a, b) => a + b, 0), margem: margemDe(linhas), fin, semPosto: linhas.filter((l) => !l.maquinaId).length,
    compartilhadas: linhas.filter((l) => l.distribuicao).length, checagens: r.checagens, rupturaSimulada: ruptura, mantidoPorEntradaIgual: r.mantidoPorEntradaIgual, vsAtivo: { ...cmp, primeiros: undefined }, primeiros: cmp.primeiros,
    diag: r.diagnosticos.map((d) => d.codigo).filter((x, i, a) => a.indexOf(x) === i),
  };
  resultados.push(res);
  console.log(`${rotulo.padEnd(22)} ok · ${ms} ms · total ${Math.round(res.total)} · margem R$ ${Math.round(res.margem)} · semPosto ${res.semPosto} · ruptura(sim) ${ruptura} · vs ativo: postos −${cmp.postosSaem}/+${cmp.postosEntram} de ${cmp.de} · M1–T1 −${cmp.saem4}/+${cmp.entram4} · pessoa×posto mudou ${cmp.pessoaPostoMudou} · hash ${res.hash}`);
}
// referência: o plano ATIVO simulado contra cada estoque
for (const cen of Object.keys(CEN)) {
  const sim = simular(entrada, ativo, CEN[cen].wip);
  const ruptura = sim.reduce((s, t) => s + t.ruptura.reduce((a, v) => a + v.reduce((x, y) => x + y, 0), 0), 0);
  const fin = finais(ativo);
  resultados.push({ rotulo: `ATIVO×${cen}`, cen, ruptura, fin, total: Object.values(fin).reduce((a, b) => a + b, 0), margem: margemDe(ativo) });
  console.log(`ATIVO contra ${cen}: ruptura total ${ruptura} pç`);
}
rodar("B-limpo-s1", "B", "limpo", 1);
rodar("B-motor-s1", "B", "motor", 1);
for (const s of sementes) rodar(`D(i)-limpo-s${s}`, "D(i)", "limpo", s);
for (const s of sementes) rodar(`D(i)-motor-s${s}`, "D(i)", "motor", s);
rodar("D(ii)-limpo-s1", "D(ii)", "limpo", 1);
rodar("D(ii)-motor-s1", "D(ii)", "motor", 1);
rodar("D(iii)-limpo-s1", "D(iii)", "limpo", 1);
rodar("D(iii)-motor-s1", "D(iii)", "motor", 1);
rodar("D(iv)-motor-s1", "D(iv)", "motor", 1);
fs.writeFileSync(`${D12}/resultados-replanejamento.json`, JSON.stringify({ resultados }, null, 1));
fs.mkdirSync(`${D12}/planos`, { recursive: true });
Object.entries(planos).forEach(([k, v]) => fs.writeFileSync(`${D12}/planos/${k.replace(/[()]/g, "")}.json`, JSON.stringify(v)));

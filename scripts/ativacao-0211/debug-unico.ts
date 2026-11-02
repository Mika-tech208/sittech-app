/* eslint-disable @typescript-eslint/no-explicit-any */
// DEBUG offline do produto único: roda planejarFuturo direto com a entrada montada e mostra violações de cadeia por produto.
import * as fs from "node:fs";
import { montarEstado as carregar } from "./carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { montarProblemaCorte } from "@/features/escala/fluxo/planoCorte";
import { planejarFuturo } from "@/features/escala/fluxo/planejadorFuturo";
import { validarPlanoCadeia } from "@/features/escala/fluxo/planoReverso";
import type { ContagemFisicaPar, DadosProducaoReal, ParLegado } from "@/features/escala/fluxo/tipos";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";

const { estado, raw } = carregar();
estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
const AGORA = Date.parse("2026-11-02T18:00:00-03:00");
const entrada = montarEntradaEscala(estado, AGORA).entrada;
const CONFIG = lerConfigPlanejador(JSON.parse(fs.readFileSync("scripts/ativacao-0211/config-planejador.json", "utf8")));
const nome = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const conv = "27c229d7-f192-41eb-aad1-0c69ece53eba", aut = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee", cx = "238ca607-2111-4aff-9a19-a9ae6f20da7e";
const WIP: Record<string, number[]> = { [conv]: [3200, 3700, 3600], [aut]: [0, 0], [cx]: [2300] };
const contagens: ContagemFisicaPar[] = [];
Object.entries(WIP).forEach(([pid, v]) => {
  const ps = entrada.pools.filter((p) => p.produtoId === pid).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
  for (let k = 0; k + 1 < ps.length; k++) contagens.push({ produtoId: pid, etapaOrigemId: ps[k].etapaId, etapaSeguinteId: ps[k + 1].etapaId, saldo: v[k] ?? 0, contadoEmMs: Date.parse("2026-11-02T06:00:00-03:00"), informadoPor: "B" });
});
const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: contagens };
const parRaw = raw.q_params.find((r: any) => r.chave === "producao_real_pares_legado")?.valor;
const paresLegado: ParLegado[] = typeof parRaw === "string" ? JSON.parse(parRaw) : parRaw;
const m = montarProblemaCorte(entrada, dados, { fluxoMesmoPeriodo: false, paresLegado }, { ...CONFIG, produtoUnico: true }, []);
console.log("info:", JSON.stringify({ ...m.unico!.info, config: undefined }));
m.produtos.forEach((p) => console.log(nome(p.id), "demanda", p.demandaFinal, "wip", JSON.stringify(p.wipInicial), "etapas", p.etapas.map((e) => `${e.rotulo.slice(0, 6)}[${e.alternativas.length}]`).join(">"), "alimenta", JSON.stringify(p.alimenta ?? null)));
const s = planejarFuturo({ ...m.entradaPlanejador, busca: { iter: 40000, reinicios: 1, semente: 1 } });
console.log("validacao", JSON.stringify(s.validacao));
for (const p of m.produtos) {
  const plano: Record<string, number[]> = { ...s.producao[p.id] };
  p.etapas.forEach((et, k) => { m.produtos.filter((f) => f.alimenta?.produtoId === p.id && f.alimenta.ligacao === k).forEach((f) => { plano[et.id] = plano[et.id].map((v, t) => v + s.producao[f.id][f.etapas[f.etapas.length - 1].id][t]); }); });
  const sim = validarPlanoCadeia({ etapas: p.etapas.map((x) => ({ id: x.id, rotulo: x.rotulo })), wipInicial: p.wipInicial, periodos: entrada.slots.map((sl) => ({ rotulo: `${sl.data} ${sl.periodoId}`, duracaoMin: sl.fimMin - sl.inicioMin })) }, plano);
  console.log(nome(p.id), "violações", sim.violacoes.length, JSON.stringify(sim.violacoes.slice(0, 3)).slice(0, 600));
  console.log("  producao por etapa:", p.etapas.map((e) => `${e.rotulo.slice(0, 6)}=${Math.round(s.producao[p.id][e.id].reduce((a, b) => a + b, 0))}`).join(" "));
}

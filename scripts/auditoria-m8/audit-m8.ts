/* eslint-disable @typescript-eslint/no-explicit-any */
// AUDITORIA DA MÁQUINA 8 DESMARCADA (OFFLINE; nada é gravado; a Previsão é alterada SÓ na entrada em memória).
// Reproduz, com os SELECTs de PROD (SQL_DIR), o que cada caminho do motor faz quando a M8 sai da seleção da Previsão do item "Conector Automática".
// Rodar: SQL_DIR=<dumps> fe/ts.sh scripts/auditoria-m8/audit-m8.ts   (env: DESMARCAR=0|1 (default roda os dois); SO=corte|legado|cobertura|fluxo|restricoes)
import * as fs from "node:fs";
import { montarEstado as carregar } from "../ativacao-0211/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { distribuicaoEfetiva } from "@/features/escala/distribuicao";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";
import { simularSemana, simularCobertura } from "@/lib/escala/simularCobertura";
import { planejarComFluxo } from "@/features/escala/fluxo";
import { verificarRestricoesDuras } from "@/features/escala/fluxo/restricoes";
import { validarPlanoCadeia } from "@/features/escala/fluxo/planoReverso";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo/tipos";
import type { AlocacaoEscala, EntradaEscala } from "@/features/escala/types";

const AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee", CONV = "27c229d7-f192-41eb-aad1-0c69ece53eba", CX = "238ca607-2111-4aff-9a19-a9ae6f20da7e";
const M8 = "a118f430-f854-4e89-9e3c-ce6fcbbc52cf", ETAPA_M8 = "1b72bf46-5d13-43c5-89b4-6169436085b7", AUTO_ETIQ = "1863b452-77f3-4d5c-9c49-a6d28ae77131", AUTO_EMB = "fb96d08d-bd64-43d3-8694-40230c695c39";
const AGORA = Date.parse(process.env.AGORA ?? "2026-11-02T18:00:00-03:00");
const CONFIG = lerConfigPlanejador(JSON.parse(fs.readFileSync("scripts/ativacao-0211/config-planejador.json", "utf8")));
const ROT: Record<string, string> = { [AUTO + "|" + ETAPA_M8]: "Auto/M8", [AUTO + "|" + AUTO_ETIQ]: "Auto/Etiquetar", [AUTO + "|" + AUTO_EMB]: "Auto/Embalar" };

function estadoVariante(desmarcarM8: boolean, modo = "desmarcar") {
  const { estado, raw } = carregar();
  if (desmarcarM8 && modo === "indisponivel") { // M8 SELECIONADA mas marcada como indisponível na Previsão (máquina parada): não é o bug, serve de contraste
    estado.maquinasIndisponiveisPrevisao = [...estado.maquinasIndisponiveisPrevisao, M8];
    desmarcarM8 = false;
  }
  if (desmarcarM8) {
    estado.itens = estado.itens.map((i) => (i.produtoId === AUTO ? { ...i, maquinasPorEtapa: { ...i.maquinasPorEtapa, [ETAPA_M8]: (i.maquinasPorEtapa[ETAPA_M8] ?? []).filter((m) => m !== M8) } } : i));
  }
  estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
  return { estado, raw };
}
function contagensB(entrada: EntradaEscala): ContagemFisicaPar[] {
  // cenário B de 02-ativar.sql (idêntico ao preview): Conv [3200,3700,3600], Auto [0,0], Caixa [2300] — pelos pares de etapas do roteiro COMPLETO do produto
  const WIP: Record<string, number[]> = { [CONV]: [3200, 3700, 3600], [AUTO]: [0, 0], [CX]: [2300] };
  const out: ContagemFisicaPar[] = [];
  const todas = [...entrada.pools, ...(entrada.poolsSemMaquina ?? [])];
  Object.entries(WIP).forEach(([pid, v]) => {
    const ps = todas.filter((p) => p.produtoId === pid).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
    for (let k = 0; k + 1 < ps.length; k++) out.push({ produtoId: pid, etapaOrigemId: ps[k].etapaId, etapaSeguinteId: ps[k + 1].etapaId, saldo: v[k] ?? 0, contadoEmMs: Date.parse("2026-11-02T06:00:00-03:00"), informadoPor: "Cenário B (ESTIMADO)" });
  });
  return out;
}
function pecasPor(linhas: AlocacaoEscala[]) {
  const m = new Map<string, number>(), primeiro = new Map<string, string>();
  linhas.forEach((l) => {
    if (!l.maquinaId) return;
    (distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId as string, etapaId: l.etapaId as string, pecas: l.pecas }]).forEach((it) => {
      const k = `${it.produtoId}|${it.etapaId}`;
      m.set(k, (m.get(k) ?? 0) + it.pecas);
      if (it.pecas > 0 && !primeiro.has(k)) primeiro.set(k, `${l.data} ${l.periodoId}`);
    });
  });
  return { m, primeiro };
}
const fmt = (m: Map<string, number>) => [...m.entries()].filter(([k]) => k.startsWith(AUTO)).sort().map(([k, v]) => `${ROT[k] ?? k}=${Math.round(v)}`).join(" · ") || "(nenhuma peça Auto)";
const totalProd = (m: Map<string, number>, pid: string) => [...m.entries()].filter(([k]) => k.startsWith(pid)).reduce((s, [, v]) => s + v, 0);

// Validador INDEPENDENTE com a cadeia COMPLETA do roteiro (inclui a etapa sem máquina): mostra o que as checagens do planejador não enxergam
function cadeiaCompleta(entrada: EntradaEscala, linhas: AlocacaoEscala[], pid: string) {
  const ps = [...entrada.pools, ...(entrada.poolsSemMaquina ?? [])].filter((p) => p.produtoId === pid).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
  const H = entrada.slots.length, idx = new Map(entrada.slots.map((sl) => [`${sl.data}|${sl.periodoId}`, sl.indice]));
  const plano: Record<string, number[]> = Object.fromEntries(ps.map((p) => [p.etapaId, new Array(H).fill(0)]));
  linhas.forEach((l) => { if (!l.maquinaId) return; (distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId as string, etapaId: l.etapaId as string, pecas: l.pecas }]).forEach((it) => { if (it.produtoId === pid && plano[it.etapaId]) plano[it.etapaId][idx.get(`${l.data}|${l.periodoId}`) as number] += it.pecas; }); });
  const sim = validarPlanoCadeia({ etapas: ps.map((p) => ({ id: p.etapaId, rotulo: ROT[pid + "|" + p.etapaId] ?? p.etapaId })), wipInicial: new Array(ps.length - 1).fill(0), periodos: entrada.slots.map((sl) => ({ rotulo: sl.data + " " + sl.periodoId, duracaoMin: sl.fimMin - sl.inicioMin })) }, plano);
  return `${sim.violacoes.length} violações · semMaterial ${Math.round(sim.nos.reduce((a, n) => a + n.semMaterial.reduce((x, y) => x + y, 0), 0))} · 1ª: ${sim.violacoes[0] ? sim.violacoes[0].periodoRotulo + " " + sim.violacoes[0].rotulo : "—"}`;
}

function cenario(desmarcar: boolean, modo = "desmarcar") {
  const rot = desmarcar ? (modo === "indisponivel" ? "M8 SELECIONADA porém INDISPONÍVEL na Previsão (contraste)" : "M8 DESMARCADA") : "M8 SELECIONADA (baseline)";
  const so = process.env.SO;
  const { estado } = estadoVariante(desmarcar, modo);
  const montada = montarEntradaEscala(estado, AGORA);
  const entrada = montada.entrada;
  console.log(`\n################ ${rot}`);
  const poolsAuto = entrada.pools.filter((p) => p.produtoId === AUTO).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
  console.log(`montarEntrada: pools Auto = [${poolsAuto.map((p) => `${ROT[AUTO + "|" + p.etapaId] ?? p.etapaId}(ordem ${p.ordemEtapa}, máq ${p.maquinasIds.length}, Q ${p.quantidade})`).join(", ")}] · poolsSemMaquina = [${(entrada.poolsSemMaquina ?? []).map((p) => `${ROT[p.produtoId + "|" + p.etapaId] ?? p.etapaId}(Q ${p.quantidade})`).join(", ")}] · avisos ${JSON.stringify(montada.avisos.map((a) => a.tipo + ":" + (ROT[a.produtoId + "|" + a.etapaId] ?? "")))}`);
  const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: contagensB(entrada) };

  if (!so || so === "corte") {
    const t0 = Date.now();
    const r = planejarSemanaComCorte(entrada, dados, { fluxoMesmoPeriodo: false }, CONFIG);
    console.log(`\n(a) PLANEJADOR DE CORTE (corte-v1, semana ativa) · ms ${Date.now() - t0} · ok ${r.ok} ${r.motivo ?? ""}`);
    if (r.ok && r.resultado) {
      const { m, primeiro } = pecasPor(r.resultado.alocacoes);
      console.log(`  checagens: cadeiaInvalida ${r.checagens.cadeiaInvalida} · semMaterial ${r.checagens.semMaterial} · violacoesDuras ${r.checagens.violacoesDuras} · foraPrevisao ${r.checagens.maquinaForaDaPrevisao} · postos ${r.checagens.maxPostosSimultaneos}`);
      console.log(`  peças Auto: ${fmt(m)} · Conv total ${Math.round(totalProd(m, CONV))} · 1º período com Auto/Etiquetar: ${primeiro.get(AUTO + "|" + AUTO_ETIQ) ?? "—"} · 1º com Auto/Embalar: ${primeiro.get(AUTO + "|" + AUTO_EMB) ?? "—"}`);
      console.log(`  saida.porProduto Auto: ${JSON.stringify(r.saida!.porProduto.filter((p) => p.produtoId === AUTO).map((p) => ({ demanda: Math.round(p.demanda), programado: Math.round(p.programado), cortado: Math.round(p.cortado) })))} · alertas do resultado: ${JSON.stringify(r.resultado.alertas.map((a) => a.tipo))}`);
      console.log(`  validador INDEPENDENTE com a cadeia COMPLETA (M8→Etiquetar→Embalar, WIP Auto inicial 0): ${cadeiaCompleta(entrada, r.resultado.alocacoes, AUTO)}`);
      const wipAuto = r.saida!.wip[AUTO];
      console.log(`  WIP Auto por ligação (início dos 8 primeiros períodos): ${wipAuto ? wipAuto.map((l) => l.slice(0, 8).map(Math.round).join(",") + "…").join(" | ") : "—"} · cadeia do Auto no planejador: ${r.entradaPlanejador!.produtos.find((p) => p.id === AUTO)?.etapas.map((e) => ROT[AUTO + "|" + e.id] ?? e.id).join(" → ") ?? "(produto Auto fora do plano)"}`);
    }
  }
  if (!so || so === "legado") {
    const res = gerarEscala(entrada);
    const { m, primeiro } = pecasPor(res.alocacoes);
    console.log(`\n(b) validador completo no plano LEGADO: ${cadeiaCompleta(entrada, res.alocacoes, AUTO)}`);
    console.log(`(b) LEGADO gerarEscala · peças Auto: ${fmt(m)} · 1º Auto/Etiquetar: ${primeiro.get(AUTO + "|" + AUTO_ETIQ) ?? "—"} · alertas: ${JSON.stringify(res.alertas.map((a) => a.tipo + ":" + (a.produtoId === AUTO ? "Auto" : "")))}`);
  }
  if (!so || so === "cobertura") {
    try {
      const sim = simularSemana(estado, AGORA);
      const { m } = pecasPor(sim.resultado.alocacoes);
      const cob = simularCobertura(estado, AGORA);
      console.log(`\n(c) SIMULADOR DE COBERTURA (Previsão) · peças Auto no resultado simulado: ${fmt(m)} · etapasSemMaquina ${JSON.stringify((cob as any).etapasSemMaquina?.map((e: any) => ROT[AUTO + "|" + e.etapaId] ?? e.etapaId))} · chaves: ${Object.keys(cob).join(",")}`);
    } catch (e) { console.log("(c) falhou:", (e as Error).message); }
  }
  if (!so || so === "fluxo") {
    try {
      const f = planejarComFluxo(entrada, dados, { fluxoMesmoPeriodo: false });
      const { m, primeiro } = pecasPor(f.resultado.alocacoes);
      console.log(`\n(e) FLUXO/planejarComFluxo (modo ativo antigo; validarCadeia) · peças Auto: ${fmt(m)} · 1º Auto/Etiquetar: ${primeiro.get(AUTO + "|" + AUTO_ETIQ) ?? "—"} · diag: ${[...new Set((f.diagnostico as any).itens?.map((d: any) => d.codigo) ?? Object.keys(f.diagnostico))].join(",")}`);
    } catch (e) { console.log("(e) fluxo falhou:", (e as Error).stack?.split("\n").slice(0,4).join(" | ")); }
  }
  if (!so || so === "restricoes") {
    const res = gerarEscala(entrada);
    const v = verificarRestricoesDuras(entrada, res.alocacoes);
    console.log(`\n(f) restricoes.ts sobre o plano do legado: ${v.length} violação(ões) ${JSON.stringify([...new Set(v.map((x) => x.tipo))])}`);
  }
}
const only = process.env.DESMARCAR;
if (only === undefined || only === "0") cenario(false);
if (only === undefined || only === "1") cenario(true);
if (only === "2") cenario(true, "indisponivel");

/* eslint-disable @typescript-eslint/no-explicit-any */
// CENÁRIOS DE WIP FÍSICO (D de 02/11 20:20) — OFFLINE/SOMBRA, nada é gravado. Estado = SELECTs de PROD (SQL_DIR) com as contagens REAIS do parâmetro (inclui D 20:20); o planejador de corte roda
// com a MESMA configuração de PROD. Variações só na entrada em memória (OVERRIDE) e no modo (MODO=base: dois produtos como em PROD; MODO=unico: produto único com rotas).
// Env: SQL_DIR, MODO=base|unico, PAF=<saldo Parafusar→Etiquetar>, ETIQ_EMB=<saldo Etiquetar→Embalar> (default: o contado), SEMENTE, AGORA (default 2026-11-02T21:00-03:00), OUT=json, VIGENTE=<plano-ativo.sql.out> (usa o plano gravado como vigente, como no recálculo real), LIBERA_M1=1
import * as fs from "node:fs";
import { montarEstado as carregar } from "./carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { distribuicaoEfetiva, lerDistribuicao } from "@/features/escala/distribuicao";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";
import type { ContagemFisicaPar, DadosProducaoReal, ParLegado } from "@/features/escala/fluxo/tipos";
import type { AlocacaoEscala } from "@/features/escala/types";

const CONV = "27c229d7-f192-41eb-aad1-0c69ece53eba", AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const PAF_ETIQ = ["78aaa207-b8cc-412a-8a8b-d17bd95a1930", "34371af3-2608-42cc-9ded-1f7815a635a8"], ETIQ_EMB = ["34371af3-2608-42cc-9ded-1f7815a635a8", "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4"];
const MODO = process.env.MODO ?? "base";
const AGORA = Date.parse(process.env.AGORA ?? "2026-11-02T21:00:00-03:00");
const { estado, raw } = carregar();
estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
const entrada = montarEntradaEscala(estado, AGORA).entrada;
const nome = (id: string | null) => (id ? (estado.nomesProdutos?.[id] ?? id).trim() : "—");
const nm = (id: string | null) => (id ? (estado.nomesMaquinas?.[id] ?? id).trim().replace("Maquina Automatica", "M8") : "—");
const cfgJson = JSON.parse(fs.readFileSync("scripts/ativacao-0211/config-planejador.json", "utf8"));
if (process.env.SEMENTE) { cfgJson.busca = { ...cfgJson.busca, semente: Number(process.env.SEMENTE) }; cfgJson.buscaComVigente = { ...cfgJson.buscaComVigente, semente: Number(process.env.SEMENTE) }; }
if (process.env.THETA !== undefined) cfgJson.ganhoMinimoRel = Number(process.env.THETA);
const CONFIG = lerConfigPlanejador(cfgJson);
const param = (k: string) => { const v = raw.q_params.find((x: any) => x.chave === k)?.valor; return typeof v === "string" ? JSON.parse(v) : v; };
let contagens: ContagemFisicaPar[] = (param("producao_real_contagens_fisicas") ?? []).map((c: any) => ({ produtoId: c.produtoId, etapaOrigemId: c.etapaOrigemId, etapaSeguinteId: c.etapaSeguinteId, saldo: Number(c.saldo), contadoEmMs: Date.parse(c.contadoEm), informadoPor: c.informadoPor, observacao: c.observacao }));
const ehD = (c: ContagemFisicaPar) => /contagem física D/i.test(c.informadoPor ?? "");
const par = (c: ContagemFisicaPar, p: string[]) => c.produtoId === CONV && c.etapaOrigemId === p[0] && c.etapaSeguinteId === p[1];
if (process.env.PAF !== undefined) contagens = contagens.map((c) => (ehD(c) && par(c, PAF_ETIQ) ? { ...c, saldo: Number(process.env.PAF) } : c));
if (process.env.ETIQ_EMB !== undefined) contagens = contagens.map((c) => (ehD(c) && par(c, ETIQ_EMB) ? { ...c, saldo: Number(process.env.ETIQ_EMB) } : c));
// PAF_AUTO: contagem da ligação M8→Etiquetar do produto Automática (origem desconhecida repartida/atribuída à rota automática) — só para testar a equivalência de atribuição no motor de dois produtos
if (process.env.PAF_AUTO !== undefined) contagens = [...contagens, { produtoId: AUTO, etapaOrigemId: "1b72bf46-5d13-43c5-89b4-6169436085b7", etapaSeguinteId: "1863b452-77f3-4d5c-9c49-a6d28ae77131", saldo: Number(process.env.PAF_AUTO), contadoEmMs: Date.parse("2026-11-02T20:20:00-03:00"), informadoPor: "Mikael (contagem física D teste atribuição)" }];
const parRaw = param("producao_real_pares_legado");
const paresLegado: ParLegado[] = parRaw ?? [];
let vigente: AlocacaoEscala[] = [];
if (process.env.VIGENTE) {
  const t = fs.readFileSync(process.env.VIGENTE, "utf8");
  vigente = JSON.parse(t.slice(t.indexOf("{"))).rows.map((r: any) => ({ data: r.d, periodoId: r.p, funcionarioId: r.f, maquinaId: r.m || null, produtoId: r.pr || null, etapaId: r.e || null, operacaoId: r.o || null, pecas: Number(r.pc), pecasAdicional: Number(r.pa), motivoSemPosto: r.ms || null, excecaoRevezamento: !!r.exc, motivoExcecao: null, origem: r.orig || "auto", ...(lerDistribuicao(r.dist) ? { distribuicao: lerDistribuicao(r.dist) } : {}) }));
}
const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: vigente, contagensFisicas: contagens };
const unico = MODO === "unico";
console.log(`MODO ${MODO} · AGORA ${new Date(AGORA).toISOString()} · contagens D: ${contagens.filter(ehD).map((c) => `${nome(c.produtoId).slice(0, 8)} ${c.etapaOrigemId.slice(0, 6)}→${c.etapaSeguinteId.slice(0, 6)}=${c.saldo}`).join(" · ")} · vigente ${vigente.length} linhas (hash ${vigente.length ? hashAlocacoes(vigente) : "—"})`);
const t0 = Date.now();
const r = planejarSemanaComCorte(entrada, dados, { fluxoMesmoPeriodo: false, ...(unico ? { paresLegado } : {}) }, { ...CONFIG, ...(vigente.length ? { partirDoVigente: true } : {}), ...(unico ? { produtoUnico: true } : {}) });
console.log(`ms ${Date.now() - t0} · ok ${r.ok} ${r.motivo ?? ""} · mantidoPorEntradaIgual ${r.mantidoPorEntradaIgual}`);
if (!r.ok || !r.resultado || !r.saida) { console.log("NO-GO:", r.motivo); process.exit(3); }
const linhas = r.resultado.alocacoes;
console.log("checagens:", JSON.stringify(r.checagens));
const ent = r.entradaPlanejador!;
ent.produtos.forEach((p) => console.log(`  planejador: ${nome(p.id).slice(0, 30)} demanda ${p.demandaFinal} wipInicial ${JSON.stringify(p.wipInicial)}`));
// peças finais por produto
const mg = (CONFIG.margemPorPeca ?? {}) as Record<string, number>;
let valor = 0, total = 0;
const porProd = r.saida.porProduto.filter((p) => !(unico && p.produtoId === AUTO));
porProd.forEach((p) => { valor += (mg[p.produtoId] ?? 0) * p.programado; total += p.programado; });
if (unico && r.unico?.resumo) { const a = r.unico.resumo.porRota.find((x) => x.produtoId === AUTO); valor += ((mg[AUTO] ?? 0) - (mg[CONV] ?? 0)) * Math.min(a?.entregue ?? 0, r.unico.resumo.finalPlanejado); console.log(`  rotas: ${r.unico.resumo.porRota.map((x) => `${x.rotulo} ${x.entregue} (${x.pctDoTotal}%)`).join(" · ")}`); }
const finais = new Map<string, number>();
linhas.forEach((l) => { if (!l.maquinaId) return; (distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId as string, etapaId: l.etapaId as string, pecas: l.pecas }]).forEach((it) => { const k = `${it.produtoId}|${it.etapaId}`; finais.set(k, (finais.get(k) ?? 0) + it.pecas); }); });
console.log("FINAIS:", porProd.map((p) => `${nome(p.produtoId).slice(0, 22)}${unico && p.produtoId === CONV ? " (Conector único)" : ""} ${Math.round(p.programado)}/${Math.round(p.demanda)}`).join(" · "), `· TOTAL ${Math.round(total)} · VALOR R$ ${valor.toFixed(2)}`);
// sem posto por período
const slots = entrada.slots.filter((s) => s.indice >= entrada.aPartirDe);
const semPosto = slots.map((s) => linhas.filter((l) => l.data === s.data && l.periodoId === s.periodoId && !l.maquinaId).length);
console.log("SEM POSTO por período:", slots.map((s, i) => `${s.data.slice(8)}${s.periodoId.toUpperCase()}:${semPosto[i]}`).filter((x) => !x.endsWith(":0")).join(" ") || "nenhum", `· total pessoas-período sem posto ${semPosto.reduce((a, b) => a + b, 0)}`);
// M1/M2/M3 de 03/11 posto a posto + máquinas-chave
const KEY = ["Rosqueadeira", "Parafusadeira 9", "Parafusadeira 12", "M8", "Etiquetadora 15", "Embalagem 17"];
const porMaq = (s: { data: string; periodoId: string }) => linhas.filter((l) => l.data === s.data && l.periodoId === s.periodoId && l.maquinaId);
for (const s of slots.slice(0, 6)) {
  const ls = porMaq(s);
  console.log(`${s.data.slice(8)}/${s.data.slice(5, 7)} ${s.periodoId.toUpperCase()} · ${ls.length} postos · sem posto ${linhas.filter((l) => l.data === s.data && l.periodoId === s.periodoId && !l.maquinaId).length} · ` + ls.map((a) => `${nm(a.maquinaId)}:${(distribuicaoEfetiva(a) ?? [{ produtoId: a.produtoId!, pecas: a.pecas }]).map((d) => `${nome(d.produtoId).slice(0, 5)}${Math.round(d.pecas)}`).join("+")}`).sort().join(" "));
}
// utilização das máquinas-chave
const util = (pat: RegExp) => { const ls = linhas.filter((l) => l.maquinaId && pat.test(nm(l.maquinaId))); const ocup = new Set(ls.map((l) => `${l.data}|${l.periodoId}|${l.maquinaId}`)).size; return `${ocup}/${slots.length * new Set(entrada.pools.flatMap((p) => p.maquinasIds).filter((m) => pat.test(nm(m)))).size} (${Math.round(ls.reduce((s, l) => s + l.pecas, 0))} peças)`; };
console.log("UTILIZAÇÃO (períodos ocupados/disponíveis):", KEY.map((k) => `${k} ${util(new RegExp("^" + k))}`).join(" · "));
// WIP por ligação (Conector) e primeira ruptura (Etiquetadora 15 / Embalagem 17 sem material)
const wipConv = r.saida.wip[CONV] ?? [], wipAut = r.saida.wip[AUTO] ?? [];
const pc = r.saida.producao;
const etiqPeriodo = slots.map((s) => linhas.filter((l) => l.data === s.data && l.periodoId === s.periodoId && /^Etiquetadora 15/.test(nm(l.maquinaId))).reduce((x, l) => x + l.pecas, 0));
const embPeriodo = slots.map((s) => linhas.filter((l) => l.data === s.data && l.periodoId === s.periodoId && /^Embalagem 17/.test(nm(l.maquinaId))).reduce((x, l) => x + l.pecas, 0));
const capEtiq = slots.map((s) => (s.periodoId.startsWith("m") ? 3500 : 3000)), capEmb = slots.map((s) => (s.periodoId.startsWith("m") ? 5000 : 4500));
const ligLabel = unico ? ["Rosquear→Parafusar", "ENTRADA ETIQUETADORA (Σ rotas)", "Etiquetar→Embalar"] : ["Rosquear→Parafusar", "Parafusar→Etiquetar", "Etiquetar→Embalar"];
const wipAt = (k: number, t: number) => Math.round((wipConv[k]?.[t] ?? 0) + (!unico && k === 1 ? 0 : 0));
const entradaEtiq = (t: number) => Math.round((wipConv[1]?.[t] ?? 0) + (unico ? 0 : (wipAut[0]?.[t] ?? 0)));
const etiqEmb = (t: number) => Math.round((wipConv[2]?.[t] ?? 0) + (unico ? 0 : (wipAut[1]?.[t] ?? 0)));
void wipAt;
console.log("WIP (início de cada período, 1º ao 12º):");
console.log("  Rosquear→Parafusar:", Array.from({ length: 12 }, (_, t) => Math.round(wipConv[0]?.[t] ?? 0)).join(","));
console.log(`  ${unico ? "Entrada Etiquetadora (Σ)" : "Parafusar→Etiq (Conv)+M8→Etiq"}:`, Array.from({ length: 12 }, (_, t) => entradaEtiq(t)).join(","));
console.log("  Etiquetar→Embalar:", Array.from({ length: 12 }, (_, t) => etiqEmb(t)).join(","));
void ligLabel; void pc;
// ruptura = período em que a máquina consumiu TODO o material disponível no início e ainda ficou abaixo da capacidade (starvation), ocupada ou não
const starved = (prod: number[], cap: number[], estoque: (t: number) => number) => prod.map((v, i) => v < cap[i] - 1 && v >= estoque(i) - 1);
const stEtiq = starved(etiqPeriodo, capEtiq, entradaEtiq), stEmb = starved(embPeriodo, capEmb, etiqEmb);
const ruptEtiq = stEtiq.findIndex(Boolean), ruptEmb = stEmb.findIndex(Boolean);
const lista = (st: boolean[]) => st.map((x, i) => (x ? `${slots[i].data.slice(8)}${slots[i].periodoId.toUpperCase()}` : "")).filter(Boolean).slice(0, 10).join(",") || "nenhum";
const rot = (i: number) => (i < 0 ? "nenhuma na semana" : `${slots[i].data.slice(8)}/${slots[i].data.slice(5, 7)} ${slots[i].periodoId.toUpperCase()} (${i + 1}º período)`);
console.log(`ETIQUETADORA 15 por período (peças): ${etiqPeriodo.slice(0, 12).join(",")} · EMBALAGEM 17: ${embPeriodo.slice(0, 12).join(",")}`);
console.log(`PRIMEIRA RUPTURA PREVISTA (consumiu todo o material e ficou abaixo da capacidade) — Etiquetadora 15: ${rot(ruptEtiq)} [períodos: ${lista(stEtiq)}] · Embalagem 17: ${rot(ruptEmb)} [períodos: ${lista(stEmb)}]`);
console.log("ESTABILIDADE/diagnósticos:", r.diagnosticos.filter((d) => /ESTAB|WIP_|CONTAGEM_COMUM|PRODUTO_UNICO/.test(d.codigo)).map((d) => `${d.codigo}: ${d.mensagem.slice(0, 220)}`).join(" | ") || "—");
const hash = hashAlocacoes(linhas);
console.log("HASH", hash, "· hashEntrada", r.hashEntrada);
// churn vs plano atual (postos: data|período|máquina)
if (vigente.length) {
  const set = (ls: AlocacaoEscala[]) => new Set(ls.filter((l) => l.maquinaId).map((l) => `${l.data}|${l.periodoId}|${l.maquinaId}|${l.operacaoId}`));
  const a = set(vigente), b = set(linhas);
  let ig = 0; b.forEach((k) => { if (a.has(k)) ig++; });
  console.log(`CHURN vs plano atual: postos iguais ${ig}/${a.size} · diferentes ${b.size - ig}`);
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ modo: MODO, hash, total: Math.round(total), valor, finais: porProd.map((p) => ({ p: nome(p.produtoId), v: Math.round(p.programado) })), semPosto, etiqPeriodo, embPeriodo, checagens: r.checagens, ruptEtiq, ruptEmb }, null, 1));

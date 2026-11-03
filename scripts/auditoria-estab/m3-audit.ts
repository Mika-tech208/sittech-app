/* eslint-disable @typescript-eslint/no-explicit-any */
// URGENTE 03/11 ~10:20 — AUDITORIA DO M3 do plano atual com o MESMO estado do motor (corte-v1). OFFLINE: SELECTs de PROD (SQL_DIR=d16/dumps), nada gravado.
// Reconstrói exatamente o que processarSemana/tentarPlanoCorte faz: insumosFluxo (f de desempenho embutido), dadosProducaoReal (apontamentos reais de M1, contagens D, plano vigente), montarProblemaCorte.
import * as fs from "node:fs";
import { montarEstado as carregar, rows } from "../ativacao-0211/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { dadosProducaoReal, insumosFluxo } from "@/lib/escala/fluxo/integracao";
import { montarProblemaCorte, planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";
import { paraReal, type ApontamentoBanco } from "@/lib/escala/sombraServico";
import { fatoresDeDesempenho } from "@/features/escala/fluxo/fatores";
import { lerDistribuicao, distribuicaoEfetiva } from "@/features/escala/distribuicao";
import { chavePool } from "@/features/escala/types";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";

const D16 = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/d16";
const AGORA = Date.parse(process.env.AGORA ?? "2026-11-03T10:20:00-03:00");
const { estado, raw } = carregar();
const lerRows = (arq: string): any[] => { const t = fs.readFileSync(arq, "utf8"); return JSON.parse(t.slice(t.indexOf("{"))).rows; };
const plano: AlocacaoEscala[] = lerRows(`${process.env.SQL_DIR}/q_plano_ativo.sql.out`).map((r: any) => ({ data: r.d, periodoId: r.p, funcionarioId: r.f, maquinaId: r.m || null, produtoId: r.pr || null, etapaId: r.e || null, operacaoId: r.o || null, pecas: Number(r.pc), pecasAdicional: Number(r.pa), motivoSemPosto: r.ms || null, excecaoRevezamento: !!r.exc, motivoExcecao: null, origem: r.orig || "auto", ...(lerDistribuicao(r.dist) ? { distribuicao: lerDistribuicao(r.dist) } : {}) }));
const iso = (s: string | null) => (s ? s.replace(" ", "T").replace(/\+00$/, "Z").replace(/([+-]\d\d)$/, "$1:00") : null);
const aptBanco: ApontamentoBanco[] = lerRows(`${process.env.SQL_DIR}/q_apontamentos.sql.out`).map((r: any) => ({ data: r.data, periodoId: r.periodo_id, funcionarioId: r.funcionario_id, maquinaId: r.maquina_id, produtoId: r.produto_id, etapaId: r.etapa_id, operacaoId: r.operacao_id, quantidadeProduzida: Number(r.quantidade_produzida ?? 0), quantidadeRefugo: Number(r.quantidade_refugo ?? 0), meta: Number(r.meta ?? 0), status: r.status, motivo: r.motivo, criadoEmMs: Date.parse(iso(r.criado_em) as string), atualizadoEmMs: r.atualizado_em ? Date.parse(iso(r.atualizado_em) as string) : null }));
const apontamentos = aptBanco.map(paraReal);
const param = (k: string) => { const v = raw.q_params.find((x: any) => x.chave === k)?.valor; return typeof v === "string" ? JSON.parse(v) : v; };
const contagens: ContagemFisicaPar[] = (param("producao_real_contagens_fisicas") ?? []).map((c: any) => ({ produtoId: c.produtoId, etapaOrigemId: c.etapaOrigemId, etapaSeguinteId: c.etapaSeguinteId, saldo: Number(c.saldo), contadoEmMs: Date.parse(c.contadoEm), informadoPor: c.informadoPor, observacao: c.observacao }));
const CONFIG = lerConfigPlanejador(param("producao_real_planejador_config"));
estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
estado.diasExistentes = rows("q_existentes").map((d: any) => ({ data: d.data, versao: Number(d.versao), periodosSnapshot: d.periodos_snapshot })) as any;
estado.alocacoes = plano;
(estado as any).producaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: param("producao_real_pares_legado") ?? [], contagensFisicas: contagens, apontamentos, mesmoPeriodo: false, cadeia: { diagnostico: true } };
const nome = (id: string | null) => (id ? (estado.nomesProdutos?.[id] ?? id).trim() : "—");
const nm = (id: string | null) => (id ? (estado.nomesMaquinas?.[id] ?? id).trim().replace("Maquina Automatica", "M8") : "—");
const CONV = "27c229d7-f192-41eb-aad1-0c69ece53eba", AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const ETQ_C = "34371af3-2608-42cc-9ded-1f7815a635a8", PAF_C = "78aaa207-b8cc-412a-8a8b-d17bd95a1930", EMB_C = "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4", ROS_C = "ca90456c-9077-40f4-a058-bd0f467e87ec";
const M8E = "1b72bf46-5d13-43c5-89b4-6169436085b7", ETQ_A = "1863b452-77f3-4d5c-9c49-a6d28ae77131", EMB_A = "fb96d08d-bd64-43d3-8694-40230c695c39";

const montada = montarEntradaEscala(estado, AGORA);
const entrada = montada.entrada;
console.log(`AGORA ${new Date(AGORA).toISOString()} · aPartirDe=${entrada.aPartirDe} (${entrada.slots[entrada.aPartirDe].data} ${entrada.slots[entrada.aPartirDe].periodoId}) · congeladas ${entrada.congeladas.length} linhas · apontamentos ${apontamentos.length} (M1 produzindo ${apontamentos.filter((a) => a.status === "produzindo").length}) · plano vigente ${plano.length} linhas`);
const fator = fatoresDeDesempenho(entrada, apontamentos, AGORA, (estado as any).producaoReal.paresLegado);
console.log("fator de desempenho f por pool (≠1):", Object.entries(fator).map(([k, v]) => `${nome(k.split("|")[0]).slice(0, 8)}|${k.split("|")[1].slice(0, 6)}=${(v as number).toFixed(3)}`).join(" · ") || "nenhum");
const { entrada: entradaF, opcoes } = insumosFluxo(estado, entrada, AGORA);
const dados = dadosProducaoReal(estado, AGORA);
const cfg: any = { ...CONFIG, partirDoVigente: true, hashEntradaAnterior: null };
const m = montarProblemaCorte(entradaF, dados, opcoes, cfg, plano);
const E = m.estado, ap = E.aPartirDe;
console.log(`estado do motor: ultimoFechado=${E.ultimoFechado} aPartirDe=${ap}`);

// (1) WIP no início de M3 como o planejador o recebe
const wipIn = (pid: string) => m.entradaPlanejador.produtos.find((p) => p.id === pid)?.wipInicial;
console.log("\n(1) WIP INICIAL do planejador em aPartirDe (ligações por produto):");
console.log("  Conv  [Rosquear→Parafusar, Parafusar→Etiquetar, Etiquetar→Embalar] =", JSON.stringify(wipIn(CONV)));
console.log("  Auto  [M8→Etiquetar, Etiquetar→Embalar]                            =", JSON.stringify(wipIn(AUTO)));
const proj = (pid: string, et: string) => E.projecao.wip[chavePool(pid, et)];
console.log(`  projecao.wip lo/hi: Conv Paf→Etiq ${JSON.stringify(proj(CONV, PAF_C))} · Conv Etiq→Emb ${JSON.stringify(proj(CONV, ETQ_C))} · Conv Ros→Paf ${JSON.stringify(proj(CONV, ROS_C))} · Auto M8→Etiq ${JSON.stringify(proj(AUTO, M8E))} · Auto Etiq→Emb ${JSON.stringify(proj(AUTO, ETQ_A))}`);

// composição
const real1 = (pid: string, et: string, per: string) => apontamentos.filter((a) => a.periodoId === per && a.status === "produzindo" && a.produtoId === pid && a.etapaId === et).reduce((s, a) => s + a.boas, 0);
console.log("\n  COMPOSIÇÃO (Conv Parafusar→Etiquetar no início de M3):");
console.log(`    contagem D (20:20) = ${contagens.filter((c) => c.produtoId === CONV && c.etapaOrigemId === PAF_C).slice(-1)[0]?.saldo} (a mais recente do par)`);
console.log(`    + Parafusar REAL M1 = ${real1(CONV, PAF_C, "m1")}  (Paf9 + Paf12 apontados)`);
const congM2 = entrada.congeladas.filter((l) => l.periodoId === "m2" && l.data === "2026-11-03" && l.maquinaId);
console.log("    linhas CONGELADAS (período EM ANDAMENTO M2, produção PLANEJADA/capacidade):", congM2.map((l) => `${nm(l.maquinaId)}:${(distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId, pecas: l.pecas }]).map((d) => `${nome(d.produtoId!).slice(0, 5)}${Math.round(d.pecas)}`).join("+")}`).join(" "));
const mu = (pid: string, et: string, per: string) => { const p = entrada.pools.find((x) => x.produtoId === pid && x.etapaId === et); return Math.round(((p?.metas as any)?.[per] ?? 0) * (fator[chavePool(pid, et)] ?? 1)); };
console.log(`    capacidade projetada de M2 (meta×f): Paf Conv ${mu(CONV, PAF_C, "m2")} por máquina · Etiq Conv ${mu(CONV, ETQ_C, "m2")} · M8 ${mu(AUTO, M8E, "m2")} · Etiq Auto ${mu(AUTO, ETQ_A, "m2")}`);
console.log(`    M8 REAL em M1 = ${real1(AUTO, M8E, "m1")} (planejado ${plano.find((l) => l.periodoId === "m1" && l.data === "2026-11-03" && /Maquina Auto/i.test(nm(l.maquinaId)) )?.pecas ?? "?"})`);

// (3/1) o plano re-planejado com o estado atual — e o plano vigente em M3
const r = planejarSemanaComCorte(entradaF, dados, opcoes, cfg, plano);
console.log(`\nreplanejamento (mesmo estado): ok ${r.ok} ${r.motivo ?? ""} · checagens ${JSON.stringify(r.checagens)}`);
const linhasDe = (ls: AlocacaoEscala[], per: string) => ls.filter((l) => l.data === "2026-11-03" && l.periodoId === per && l.maquinaId).map((l) => `${nm(l.maquinaId)}:${(distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId, pecas: l.pecas }]).map((d) => `${nome(d.produtoId!).slice(0, 5)}${Math.round(d.pecas)}`).join("+")}`).sort().join(" ");
console.log("PLANO ATUAL (DB) M3:", linhasDe(plano, "m3"));
console.log("PLANO ATUAL (DB) T1:", linhasDe(plano, "t1"));
if (r.ok && r.resultado && r.saida) {
  console.log("REPLAN (mesmo estado) M3:", linhasDe(r.resultado.alocacoes, "m3"));
  const w = r.saida.wip, pr = r.saida.producao;
  const ser = (a?: number[]) => (a ? a.slice(ap, ap + 6).map(Math.round).join(",") : "—");
  console.log(`  WIP (início de M3,T1,T2,T3,...): Conv Paf→Etiq ${ser(w[CONV]?.[1])} | Auto M8→Etiq ${ser(w[AUTO]?.[0])} | Conv Etiq→Emb ${ser(w[CONV]?.[2])} | Auto Etiq→Emb ${ser(w[AUTO]?.[1])}`);
  console.log(`  produção por período a partir de M3: Paf Conv ${ser(pr[CONV]?.[PAF_C])} | M8 ${ser(pr[AUTO]?.[M8E])} | Etiq Conv ${ser(pr[CONV]?.[ETQ_C])} | Etiq Auto ${ser(pr[AUTO]?.[ETQ_A])} | Emb Conv ${ser(pr[CONV]?.[EMB_C])}`);
  const disp = (t: number) => Math.round((w[CONV]?.[1]?.[t] ?? 0) + (w[AUTO]?.[0]?.[t] ?? 0));
  const etq = (t: number) => Math.round((pr[CONV]?.[ETQ_C]?.[t] ?? 0) + (pr[AUTO]?.[ETQ_A]?.[t] ?? 0));
  console.log(`  LOTE: disponível no início de M3 = ${disp(ap)} ; Etiquetadora 15 em M3 = ${etq(ap)} ⇒ ${etq(ap) <= disp(ap) + 1e-6 ? "respeita (≤ disponível)" : "VIOLA"}; T1: disp ${disp(ap + 1)} etiq ${etq(ap + 1)}`);
}
fs.writeFileSync(`${D16}/m3-estado.json`, JSON.stringify({ aPartirDe: ap, wipConv: wipIn(CONV), wipAuto: wipIn(AUTO), fator }, null, 1));

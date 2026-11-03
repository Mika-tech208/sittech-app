/* eslint-disable @typescript-eslint/no-explicit-any */
// URGENTE 03/11 — passos 3, 4 e 5: por que a Etiquetadora 15 aparece em quase todos os períodos; a validação usa o momento certo?; correção mínima para o FUTURO (comparação V0 × V1 × V2).
import * as fs from "node:fs";
import { montarEstado as carregar, rows } from "../ativacao-0211/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { dadosProducaoReal, insumosFluxo } from "@/lib/escala/fluxo/integracao";
import { montarProblemaCorte, planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";
import { paraReal, type ApontamentoBanco } from "@/lib/escala/sombraServico";
import { lerDistribuicao, distribuicaoEfetiva } from "@/features/escala/distribuicao";
import { validarPlanoCadeia } from "@/features/escala/fluxo/planoReverso";
import { configDespacho } from "./lib";
import { despachar, linhasParaOcc, prepararDespacho } from "@/features/escala/fluxo/postosDespacho";
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
const entrada0 = montarEntradaEscala(estado, AGORA).entrada;
const { entrada: entradaF0, opcoes } = insumosFluxo(estado, entrada0, AGORA);
const dados = dadosProducaoReal(estado, AGORA);
const cfgP: any = { ...CONFIG, partirDoVigente: true, hashEntradaAnterior: null };
const ap = entradaF0.aPartirDe;
const S = entradaF0.slots;
const sl = (t: number) => `${S[t].data.slice(8)}${S[t].periodoId.toUpperCase()}`;

// ---- fatores por máquina a partir do último período FECHADO (M1): real / planejado
const m1 = apontamentos.filter((a) => a.data === "2026-11-03" && a.periodoId === "m1");
const gMaq = (maqId: string): number => {
  const a = m1.find((x) => x.maquinaId === maqId);
  if (!a) return 1;
  if (a.status !== "produzindo") return 0; // sem_producao no último período fechado ⇒ taxa 0
  return a.meta > 0 ? Math.max(0, Math.min(1, a.boas / a.meta)) : 1;
};
const ehConsumidor = (maqId: string | null) => /^(Etiquetadora|Embalagem)/.test(nm(maqId));
function variante(rot: "V0" | "V1" | "V2" | "V3") {
  if (rot === "V0") return { entradaF: entradaF0, dadosV: dados, plano };
  const mod = (l: AlocacaoEscala): AlocacaoEscala => {
    const t = S.find((s) => s.data === l.data && s.periodoId === l.periodoId)!.indice;
    if (t <= (ap - 1) && t > 0 && l.maquinaId) { // período(s) entre o último fechado e aPartirDe (M2: em andamento)
      const g = rot === "V1" ? gMaq(l.maquinaId) : rot === "V3" ? (ehConsumidor(l.maquinaId) ? 1 : gMaq(l.maquinaId)) : ehConsumidor(l.maquinaId) ? 1 : 0;
      if (g >= 1) return l;
      const pool = entradaF0.pools.find((p) => p.produtoId === l.produtoId && p.etapaId === l.etapaId);
      const mu = (pool?.metas as any)?.[l.periodoId] ?? l.pecas;
      return { ...l, limiteCapacidade: g * mu } as any;
    }
    return l;
  };
  const entradaF = { ...entradaF0, congeladas: entradaF0.congeladas.map(mod) };
  return { entradaF, dadosV: { ...dados, planoVigente: plano.map(mod) }, plano };
}
const linhasDe = (ls: AlocacaoEscala[], per: string) => ls.filter((l) => l.data === "2026-11-03" && l.periodoId === per && l.maquinaId).map((l) => `${nm(l.maquinaId)}:${(distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId, pecas: l.pecas }]).map((d) => `${nome(d.produtoId!).slice(0, 4)}${Math.round(d.pecas)}`).join("+")}`).sort().join(" ");
const res: Record<string, any> = {};
for (const v of ["V0", "V1", "V2", "V3"] as const) {
  const { entradaF, dadosV } = variante(v);
  const m = montarProblemaCorte(entradaF, dadosV, opcoes, cfgP, plano);
  const r = planejarSemanaComCorte(entradaF, dadosV, opcoes, cfgP, plano);
  const w = (pid: string) => m.entradaPlanejador.produtos.find((p) => p.id === pid)?.wipInicial;
  res[v] = { m, r, wConv: w(CONV), wAuto: w(AUTO) };
}
const fmtWip = (x: any) => `Conv [Ros→Paf ${x.wConv?.[0]}, Paf→Etiq ${x.wConv?.[1]}, Etiq→Emb ${x.wConv?.[2]}] · Auto [M8→Etiq ${x.wAuto?.[0]}, Etiq→Emb ${x.wAuto?.[1]}] ⇒ disponível p/ Etiq15 = ${(x.wConv?.[1] ?? 0) + (x.wAuto?.[0] ?? 0)}`;

// ===== (3) por que a Etiquetadora 15 em quase todos os períodos
{
  const { r, m } = res.V0;
  const cfg = configDespacho(m.entradaPlanejador, m.entradaPlanejador.equipe.length);
  const D = prepararDespacho(cfg);
  const postos = r.resultado.alocacoes.filter((l: AlocacaoEscala) => l.maquinaId && l.operacaoId).map((l: AlocacaoEscala) => ({ t: S.find((s) => s.data === l.data && s.periodoId === l.periodoId)!.indice, recursoId: l.maquinaId as string, operacaoId: l.operacaoId as string }));
  const obj = (ps: any[]) => despachar(cfg, D, linhasParaOcc(cfg, D, ps), true);
  const base = obj(postos);
  const etqIds = cfg.recursos.filter((q) => /^Etiquetadora 15/.test(nm(q.id))).map((q) => q.id);
  const out: string[] = [];
  for (let t = ap; t < S.length; t++) {
    const tem = postos.some((p: any) => p.t === t && etqIds.includes(p.recursoId));
    if (!tem) { out.push(`${sl(t)}: —`); continue; }
    const d = obj(postos.filter((p: any) => !(p.t === t && etqIds.includes(p.recursoId))));
    out.push(`${sl(t)}: Δobj sem a Etiq15 = ${(d.obj - base.obj).toFixed(1)}`);
  }
  console.log(`\n(3) Etiquetadora 15 ligada em ${postos.filter((p: any) => etqIds.includes(p.recursoId)).length} dos ${S.length - ap} períodos livres. Contrafactual (remove a Etiq15 do período; objetivo base ${base.obj.toFixed(1)}):\n  ${out.join(" | ")}`);
  const capEtq = 78000, finalsConector = (res.V0.r.saida.porProduto as any[]).filter((p) => p.produtoId === CONV || p.produtoId === AUTO).reduce((s, p) => s + p.programado, 0);
  console.log(`  Conector programado ${Math.round(finalsConector)} de ${(res.V0.r.saida.porProduto as any[]).filter((p) => p.produtoId === CONV || p.produtoId === AUTO).reduce((s, p) => s + p.demanda, 0)} de demanda restante; capacidade da Etiquetadora 15 ≈ 3.500×3 + 3.000×3 por dia ⇒ GARGALO (a demanda do Conector excede o que ela processa).`);
}

// ===== (4) validação: momento do estoque
{
  const { r, m } = res.V0;
  const prod = r.saida.producao;
  const periodos = S.slice(ap).map((s: any) => ({ rotulo: `${s.data} ${s.periodoId}`, duracaoMin: s.fimMin - s.inicioMin }));
  const cadeia = (pid: string, et: string[], wip: number[]) => {
    const plan = Object.fromEntries(et.map((e) => [e, (prod[pid]?.[e] ?? new Array(S.length).fill(0)).slice(ap)]));
    return validarPlanoCadeia({ etapas: et.map((e) => ({ id: e, rotulo: e.slice(0, 6) })), wipInicial: wip, periodos }, plan);
  };
  const ETAPAS_C = ["ca90456c-9077-40f4-a058-bd0f467e87ec", "78aaa207-b8cc-412a-8a8b-d17bd95a1930", "34371af3-2608-42cc-9ded-1f7815a635a8", "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4"];
  const ETAPAS_A = ["1b72bf46-5d13-43c5-89b4-6169436085b7", "1863b452-77f3-4d5c-9c49-a6d28ae77131", "fb96d08d-bd64-43d3-8694-40230c695c39"];
  const cen: [string, number[], number[]][] = [["WIP do motor (M2 planejado como produzido)", m.entradaPlanejador.produtos.find((p: any) => p.id === CONV)!.wipInicial, m.entradaPlanejador.produtos.find((p: any) => p.id === AUTO)!.wipInicial],
    ["WIP só com o REALIZADO + consumo planejado de M2 (Paf9 e M8 de M2 = 0)", [5000, 1900, 7100], [0, 0]],
    ["WIP só com o REALIZADO (M2 inteiro = 0, nem produz nem consome)", [5000, 5400, 3600], [0, 0]]];
  console.log("\n(4) Validação (validarPlanoCadeia do plano ATUAL de M3 em diante) sob 3 hipóteses de estoque no início de M3:");
  for (const [rot, wc, wa] of cen) {
    const vc = cadeia(CONV, ETAPAS_C, wc), va = cadeia(AUTO, ETAPAS_A, wa);
    const sem = (v: any) => Math.round(v.nos.reduce((a: number, n: any) => a + n.semMaterial.reduce((x: number, y: number) => x + y, 0), 0));
    const prim = [...vc.violacoes, ...va.violacoes].sort((a: any, b: any) => a.periodo - b.periodo)[0];
    console.log(`  - ${rot}: violações Conv ${vc.violacoes.length} (semMaterial ${sem(vc)}) · Auto ${va.violacoes.length} (semMaterial ${sem(va)}) · 1ª violação: ${prim ? `${prim.periodoRotulo} ${String(prim.rotulo).slice(0, 8)} desejada ${Math.round(prim.desejada)} disponível ${Math.round(prim.disponivel)}` : "—"}`);
  }
  console.log("  (a checagem do planejador, r.checagens do plano atual, usa a 1ª hipótese: ", JSON.stringify({ cadeiaInvalida: r.checagens.cadeiaInvalida, semMaterial: r.checagens.semMaterial }), ")");
}

// ===== (5) V0 × V1 × V2
console.log("\n(5) Correção proposta para o FUTURO: período EM ANDAMENTO (M2) entra no estoque de M3 com a taxa do último período fechado por máquina (V1) ou só com consumidores (V2)");
console.log("   g por máquina (M1 real/meta): " + [...new Set(plano.filter((l) => l.periodoId === "m2" && l.maquinaId).map((l) => l.maquinaId as string))].map((q) => `${nm(q)}=${gMaq(q).toFixed(2)}`).join(" · "));
for (const v of ["V0", "V1", "V2", "V3"] as const) {
  const { r } = res[v];
  console.log(`\n--- ${v} ---  ${fmtWip(res[v])}`);
  if (!r.ok) { console.log("   NO-GO", r.motivo); continue; }
  const L = r.resultado.alocacoes;
  const prod = r.saida.producao;
  const ser = (a?: number[]) => (a ? a.slice(ap, ap + 4).map(Math.round).join(",") : "—");
  for (const per of ["m3", "t1", "t2", "t3"]) console.log(`   ${per.toUpperCase()}: ${linhasDe(L, per)}`);
  const porProd = (r.saida.porProduto as any[]).map((p) => `${nome(p.produtoId).slice(0, 8)} ${Math.round(p.programado)}`).join(" · ");
  const sp = L.filter((l: AlocacaoEscala) => !l.maquinaId).length;
  const pk = (L2: AlocacaoEscala[]) => new Set(L2.filter((l) => l.maquinaId && S.find((s) => s.data === l.data && s.periodoId === l.periodoId)!.indice >= ap).map((l) => `${l.data}|${l.periodoId}|${l.maquinaId}`));
  const a = pk(plano), b = pk(L); let ig = 0; b.forEach((k) => a.has(k) && ig++);
  console.log(`   M8 (4 períodos) ${ser(prod[AUTO]?.[ "1b72bf46-5d13-43c5-89b4-6169436085b7"])} · Paf Conv ${ser(prod[CONV]?.["78aaa207-b8cc-412a-8a8b-d17bd95a1930"])} · Etiq Conv ${ser(prod[CONV]?.["34371af3-2608-42cc-9ded-1f7815a635a8"])} · Etiq Auto ${ser(prod[AUTO]?.["1863b452-77f3-4d5c-9c49-a6d28ae77131"])} · Emb Conv ${ser(prod[CONV]?.["b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4"])}`);
  console.log(`   finais: ${porProd} · pessoas-período sem posto ${sp} · churn vs plano atual: postos iguais ${ig}/${b.size} · checagens cadeiaInvalida ${r.checagens.cadeiaInvalida} semMaterial ${r.checagens.semMaterial} duras ${r.checagens.violacoesDuras}`);
}

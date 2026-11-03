/* eslint-disable @typescript-eslint/no-explicit-any */
// BENCHMARK OFFLINE do fechamento físico com DADOS REAIS de 03/11 (dumps de PROD, só SELECT): mede, por etapa, o que roda no servidor depois do clique final —
//   entrada (carregar/montar estado), corte-v1, validação (portão HARD), persistência (em memória aqui: o custo de rede/banco do Supabase é medido na fase SOMBRA) — e o TOTAL.
// Cenários: o recálculo do fechamento do M2 (10:35) e do M3 (12:06) com as contagens físicas reconstruídas. N execuções cada; imprime p50/p95/pior caso.
// Rodar: SQL_DIR=<dumps> VERSOES=<b_versoes_dia.json> N=15 scripts/fechamento/ts.sh scripts/fechamento/benchmark.ts
import * as fs from "node:fs";
import { montarEstado as carregar, rows } from "../ativacao-0211/carga";
import { processarSemana, type EscalaIO } from "@/lib/escala/processar";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";
import { linhasParaApontamentosBanco } from "@/lib/escala/fluxo/supabaseFluxo";
import { paraReal } from "@/lib/escala/sombraServico";
import { portaoHard } from "@/features/escala/fechamento/validacao";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { EstadoBruto, PayloadAplicacao } from "@/lib/escala/estado";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";

const CV = "27c229d7-f192-41eb-aad1-0c69ece53eba", AU = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const RQ = "ca90456c-9077-40f4-a058-bd0f467e87ec", PF = "78aaa207-b8cc-412a-8a8b-d17bd95a1930", ET = "34371af3-2608-42cc-9ded-1f7815a635a8", EM = "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4";
const M8 = "1b72bf46-5d13-43c5-89b4-6169436085b7", AE = "1863b452-77f3-4d5c-9c49-a6d28ae77131", AM = "fb96d08d-bd64-43d3-8694-40230c695c39";
const N = Number(process.env.N ?? 15);
const dist = (d: any) => (Array.isArray(d) ? d.map((x: any) => ({ produtoId: x.produto_id, etapaId: x.etapa_id, pecas: Number(x.pecas) })) : undefined);
const doRow = (r: any[]): AlocacaoEscala => ({ data: r[0], periodoId: r[1], funcionarioId: r[2], maquinaId: r[3] || null, produtoId: r[4] || null, etapaId: r[5] || null, operacaoId: r[6] || null, pecas: Number(r[7]), pecasAdicional: Number(r[8]), motivoSemPosto: r[10] || null, excecaoRevezamento: false, motivoExcecao: null, origem: r[11] === "m" ? "manual" : "auto", ...(dist(r[12]) ? { distribuicao: dist(r[12]) } : {}) } as any);
const versoes = JSON.parse(fs.readFileSync(process.env.VERSOES as string, "utf8"));
const { estado, raw } = carregar();
const param = (k: string) => { const v = raw.q_params.find((x: any) => x.chave === k)?.valor; return typeof v === "string" ? JSON.parse(v) : v; };
const cfg = lerConfigPlanejador(JSON.parse(fs.readFileSync("scripts/ativacao-0211/config-planejador.json", "utf8")));
const tt = fs.readFileSync(`${process.env.SQL_DIR}/q_apontamentos.sql.out`, "utf8");
const iso = (s: string) => Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z"));
const aptTodas = JSON.parse(tt.slice(tt.indexOf("{"))).rows;
const par = (p: string, o: string, s: string, saldo: number, emMs: number): ContagemFisicaPar => ({ produtoId: p, etapaOrigemId: o, etapaSeguinteId: s, saldo, contadoEmMs: emMs, informadoPor: "bench", observacao: "bench" });
const inventario = (r: number, p: number, e: number, emMs: number) => [par(CV, RQ, PF, r, emMs), par(CV, PF, ET, p, emMs), par(CV, ET, EM, e, emMs), par(AU, M8, AE, 0, emMs), par(AU, AE, AM, 0, emMs)];

interface Cenario { nome: string; entrada: string; agora: string; fim: string; proximo: { data: string; periodoId: string }; contagens: ContagemFisicaPar[] }
const CENARIOS: Cenario[] = [
  { nome: "fechamento M2 (10:35)", entrada: "53cb3c8f", agora: "2026-11-03T10:35:17-03:00", fim: "2026-11-03T10:24:00-03:00", proximo: { data: "2026-11-03", periodoId: "m3" }, contagens: inventario(4150, 750, 9000, Date.parse("2026-11-03T10:24:00-03:00")) },
  { nome: "fechamento M3 (12:06)", entrada: "13ccb8da", agora: "2026-11-03T12:06:15-03:00", fim: "2026-11-03T11:55:00-03:00", proximo: { data: "2026-11-03", periodoId: "t1" }, contagens: inventario(1200, 4800, 9000, Date.parse("2026-11-03T11:55:00-03:00")) },
];

const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

async function uma(c: Cenario) {
  const agora = Date.parse(c.agora), fimMs = Date.parse(c.fim);
  const plano = versoes.find((v: any) => v.hash_plano.startsWith(c.entrada)).linhas.map(doRow) as AlocacaoEscala[];
  const apt = linhasParaApontamentosBanco(aptTodas.filter((r: any) => iso(r.criado_em) <= agora)).map(paraReal);
  const contagens = [...(param("producao_real_contagens_fisicas") ?? []).filter((x: any) => Date.parse(x.contadoEm) <= agora).map((x: any) => ({ ...x, contadoEmMs: Date.parse(x.contadoEm) })), ...c.contagens];
  const t = { entrada: 0, aplicar: 0, validacao: 0 };
  let payload: PayloadAplicacao | null = null;
  const montar = (): EstadoBruto => ({
    ...estado, parametros: { ...estado.parametros!, revezamentoPonteM3T1: true } as any, corteExplicito: c.proximo,
    diasExistentes: rows("q_existentes").map((d: any) => ({ data: d.data, versao: Number(d.versao), periodosSnapshot: d.periodos_snapshot })), alocacoes: plano,
    producaoReal: { modoEfetivo: "ativo", limiar: null, paresLegado: param("producao_real_pares_legado") ?? [], contagensFisicas: contagens, apontamentos: apt, mesmoPeriodo: false, cadeia: { diagnostico: true }, fechamentoFisicoFimMs: fimMs } as any,
    planejadorCorte: { config: cfg as any, vigenteDoPlanejador: true, distribuicaoSuportada: true, hashEntradaAnterior: null },
  });
  const io: EscalaIO = {
    carregarEstado: async () => { const t0 = performance.now(); const e = montar(); t.entrada += performance.now() - t0; return e; },
    aplicar: async (p) => { const t0 = performance.now(); payload = p; t.aplicar += performance.now() - t0; return { versoes: Object.fromEntries(p.dias.map((d) => [d.data, 1])) }; },
    registrarFluxo: async () => undefined, gravarSnapshotsWip: async () => undefined,
  };
  const t0 = performance.now();
  const r = await processarSemana(io, {
    agoraMs: agora, criarSeNaoExiste: false, gatilhoFluxo: "fechamento", corteFluxo: { data: "2026-11-03", periodoId: c.nome.includes("M2") ? "m2" : "m3" }, corteExplicito: { ...c.proximo, agoraEquidadeMs: Date.parse(`${c.proximo.data}T00:00:00-03:00`) },
    portaoPublicacao: (x) => { const a = performance.now(); try { return portaoHard({ corteUsado: x.corteUsado, corteMotivoFalha: x.corteMotivoFalha, checagens: x.checagens as any, contagens: c.contagens, paresDoEstado: (x.registro?.wip as any)?.pares ?? null }); } finally { t.validacao += performance.now() - a; } },
  });
  const total = performance.now() - t0;
  return { status: r.status, motivo: r.motivoIgnorado ?? null, total, entrada: t.entrada, validacao: t.validacao, persistencia: t.aplicar, corte: Math.max(0, total - t.entrada - t.validacao - t.aplicar), linhas: (payload as PayloadAplicacao | null)?.alocacoes.length ?? 0 };
}

(async () => {
  const saida: Record<string, any> = {};
  for (const c of CENARIOS) {
    await uma(c); // aquecimento (JIT) fora da medição
    const rs: Awaited<ReturnType<typeof uma>>[] = [];
    for (let i = 0; i < N; i++) rs.push(await uma(c));
    const ok = rs.filter((r) => r.status === "processado" || r.status === "sem_alteracao").length;
    const col = (k: "total" | "entrada" | "corte" | "validacao" | "persistencia") => rs.map((r) => r[k]);
    const linha = (k: "total" | "entrada" | "corte" | "validacao" | "persistencia") => ({ p50: Math.round(pct(col(k), 50)), p95: Math.round(pct(col(k), 95)), max: Math.round(Math.max(...col(k))) });
    saida[c.nome] = { execucoes: N, aprovadas: ok, status: [...new Set(rs.map((r) => `${r.status}${r.motivo ? `(${r.motivo.slice(0, 80)})` : ""}`))], total: linha("total"), entrada: linha("entrada"), corte: linha("corte"), validacao: linha("validacao"), persistencia: linha("persistencia") };
    console.log(`\n== ${c.nome}: ${ok}/${N} publicáveis · status ${JSON.stringify(saida[c.nome].status)}`);
    (["total", "entrada", "corte", "validacao", "persistencia"] as const).forEach((k) => console.log(`   ${k.padEnd(12)} p50 ${String(saida[c.nome][k].p50).padStart(6)} ms   p95 ${String(saida[c.nome][k].p95).padStart(6)} ms   pior ${String(saida[c.nome][k].max).padStart(6)} ms`));
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(saida, null, 2));
})();

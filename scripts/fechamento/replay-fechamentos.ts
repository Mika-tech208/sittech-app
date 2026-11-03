/* eslint-disable @typescript-eslint/no-explicit-any */
// OFFLINE (nada é gravado). Replay do corte-v1 em um instante AGORA de 03/11 com (a) o plano "gravado" de entrada, (b) só os apontamentos criados até AGORA, (c) as contagens físicas
// que existiam até AGORA + EXTRA (contagens do FECHAMENTO FÍSICO hipotético, reconstruídas). Mesma entrada real do recálculo oficial; o `io` é em memória.
// Rodar: SQL_DIR=<dumps> VERSOES=<b_versoes_dia.json> ENTRADA=<prefixo do hash da versão> | PLANO_JSON=<json de AlocacaoEscala[]> AGORA=<iso> [EXTRA=<json>] [ESPERADO=<prefixo do hash>] OUT=<arquivo> scripts/fechamento/ts.sh scripts/fechamento/replay-fechamentos.ts
import * as fs from "node:fs";
import { montarEstado as carregar, rows } from "../ativacao-0211/carga";
import { processarSemana } from "@/lib/escala/processar";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";
import { distribuicaoEfetiva } from "@/features/escala/distribuicao";
import { hashAlocacoes } from "@/features/escala/horizonte";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { EstadoBruto, PayloadAplicacao } from "@/lib/escala/estado";
import { linhasParaApontamentosBanco } from "@/lib/escala/fluxo/supabaseFluxo";
import { paraReal } from "@/lib/escala/sombraServico";

const CONV = "27c229d7-f192-41eb-aad1-0c69ece53eba", AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const AGORA = Date.parse(process.env.AGORA as string);
const { estado, raw } = carregar();
const dist = (d: any) => (Array.isArray(d) ? d.map((x: any) => ({ produtoId: x.produto_id, etapaId: x.etapa_id, pecas: Number(x.pecas) })) : undefined);
const doRow = (r: any[]): AlocacaoEscala => ({ data: r[0], periodoId: r[1], funcionarioId: r[2], maquinaId: r[3] || null, produtoId: r[4] || null, etapaId: r[5] || null, operacaoId: r[6] || null, pecas: Number(r[7]), pecasAdicional: Number(r[8]), motivoSemPosto: r[10] || null, excecaoRevezamento: false, motivoExcecao: null, origem: r[11] === "m" ? "manual" : "auto", ...(dist(r[12]) ? { distribuicao: dist(r[12]) } : {}) } as any);
const versoes = JSON.parse(fs.readFileSync(process.env.VERSOES as string, "utf8"));
const porPrefixo = (p: string) => versoes.find((v: any) => v.hash_plano.startsWith(p));
const plano: AlocacaoEscala[] = process.env.PLANO_JSON ? JSON.parse(fs.readFileSync(process.env.PLANO_JSON, "utf8")) : porPrefixo(process.env.ENTRADA as string).linhas.map(doRow);
const param = (k: string) => { const v = raw.q_params.find((x: any) => x.chave === k)?.valor; return typeof v === "string" ? JSON.parse(v) : v; };
const extra = (JSON.parse(process.env.EXTRA ?? "[]") as any[]).map((c) => ({ ...c, informadoPor: "REPLAY", observacao: "fechamento físico hipotético (reconstruído)" }));
const contagens = [...(param("producao_real_contagens_fisicas") ?? []).filter((c: any) => Date.parse(c.contadoEm) <= AGORA), ...extra].map((c: any) => ({ ...c, contadoEmMs: Date.parse(c.contadoEm) }));
const tt = fs.readFileSync(`${process.env.SQL_DIR}/q_apontamentos.sql.out`, "utf8");
const iso = (s: string) => Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z"));
const aptRows = JSON.parse(tt.slice(tt.indexOf("{"))).rows.filter((r: any) => iso(r.criado_em) <= AGORA);
const apt = linhasParaApontamentosBanco(aptRows).map(paraReal);
const cfg = lerConfigPlanejador(JSON.parse(fs.readFileSync("scripts/ativacao-0211/config-planejador.json", "utf8")));
const base: EstadoBruto = {
  ...estado, parametros: { ...estado.parametros!, revezamentoPonteM3T1: true } as any,
  diasExistentes: rows("q_existentes").map((d: any) => ({ data: d.data, versao: Number(d.versao), periodosSnapshot: d.periodos_snapshot })), alocacoes: plano,
  producaoReal: { modoEfetivo: "ativo", limiar: null, paresLegado: param("producao_real_pares_legado") ?? [], contagensFisicas: contagens, apontamentos: apt, mesmoPeriodo: false, cadeia: { diagnostico: true } } as any,
  planejadorCorte: { config: cfg as any, vigenteDoPlanejador: true, distribuicaoSuportada: true, hashEntradaAnterior: null },
};
let payload: PayloadAplicacao | null = null;
let diag: any = null;
const io: any = { carregarEstado: async () => base, aplicar: async (p: PayloadAplicacao) => { payload = p; return { versoes: Object.fromEntries(p.dias.map((d) => [d.data, 1])) }; }, registrarFluxo: async (reg: any) => { diag = reg; }, gravarSnapshotsWip: async () => undefined };
const nome = (id: string | null) => (id ? (estado.nomesMaquinas?.[id] ?? id).trim().replace("Maquina Automatica", "M8").replace("Parafusadeira", "Paf").replace("Rosqueadeira", "Rosq").replace("Etiquetadora", "Etiq").replace("Embalagem", "Emb") : "—");
const resumo = (ls: AlocacaoEscala[]) => {
  const m = new Map<string, number>();
  ls.filter((l) => l.data === "2026-11-03" && l.maquinaId && ["m3", "t1", "t2", "t3"].includes(l.periodoId)).forEach((l) => (distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId, etapaId: l.etapaId, pecas: l.pecas }]).forEach((i) => { const k = `${l.periodoId}|${nome(l.maquinaId)}`; m.set(k, (m.get(k) ?? 0) + Math.round(i.pecas)); }));
  return m;
};
(async () => {
  console.log(`AGORA ${process.env.AGORA} · plano de entrada ${plano.length} linhas hash ${hashAlocacoes(plano)} · contagens ${contagens.length} (extra ${extra.length}) · apontamentos ${apt.length}`);
  const r = await processarSemana(io, { agoraMs: AGORA, criarSeNaoExiste: false });
  console.log("status:", r.status, "·", (r as any).motivoIgnorado ?? "");
  if (!payload) { console.log("nada foi gravado (NO-OP/mantido)"); if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(plano)); return; }
  const p = payload as PayloadAplicacao;
  console.log("PLANO CALCULADO hash", hashAlocacoes(p.alocacoes as any), "linhas", p.alocacoes.length);
  if (process.env.ESPERADO) { const e = porPrefixo(process.env.ESPERADO); if (e) console.log("ESPERADO (versão", process.env.ESPERADO, ") hash", hashAlocacoes(e.linhas.map(doRow))); }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(p.alocacoes));
  const calc = resumo(p.alocacoes as any);
  const ref = process.env.ESPERADO ? resumo(porPrefixo(process.env.ESPERADO).linhas.map(doRow)) : null;
  const chaves = [...new Set([...calc.keys(), ...(ref ? [...ref.keys()] : [])])].filter((k) => /Etiq|Emb|Paf|M8|Rosq/.test(k)).sort((a, b) => ["m3", "t1", "t2", "t3"].indexOf(a.split("|")[0]) - ["m3", "t1", "t2", "t3"].indexOf(b.split("|")[0]) || a.localeCompare(b));
  chaves.forEach((k) => console.log(`  ${k.padEnd(24)} calculado ${String(calc.get(k) ?? 0).padStart(6)}${ref ? `  esperado ${String(ref.get(k) ?? 0).padStart(6)}` : ""}`));
  if (process.env.ESPERADO) {
    const fut = (ls: any[]) => new Set(ls.filter((l) => l.data > "2026-11-03" || ["t1", "t2", "t3"].includes(l.periodoId)).map((l) => `${l.data}|${l.periodoId}|${l.funcionarioId}|${l.maquinaId}|${l.produtoId}|${l.etapaId}|${Math.round(l.pecas)}`));
    const A = fut(p.alocacoes as any), B = fut(porPrefixo(process.env.ESPERADO).linhas.map(doRow));
    console.log(`  FUTURO (T1+ e dias seguintes): ${A.size} linhas calculadas × ${B.size} esperadas · só no calculado ${[...A].filter((x) => !B.has(x)).length} · só no esperado ${[...B].filter((x) => !A.has(x)).length}`);
  }
  const pares = (diag?.wip?.pares ?? []).filter((q: any) => [CONV, AUTO].includes(q.produtoId));
  console.log("WIP no início do futuro (T1) usado pelo motor:", pares.map((q: any) => `${q.produtoId === CONV ? "Conv" : "Auto"}:${String(q.etapaOrigemId).slice(0, 4)}=${Math.round(q.wip?.lo)}${q.wip?.hi !== q.wip?.lo ? `..${Math.round(q.wip?.hi)}` : ""}[${q.fonteConfirmacao ?? "est"}]`).join(" "));
  const pre = p.alocacoes.filter((l: any) => l.data === "2026-11-03" && ["t1", "t2", "t3"].includes(l.periodoId) && l.maquinaId).map((l: any) => `${l.periodoId}:${nome(l.maquinaId)}`).sort();
  console.log("postos T1-T3 (calc):", pre.join(" "));
})();

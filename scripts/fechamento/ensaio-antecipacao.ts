/* eslint-disable @typescript-eslint/no-explicit-any */
// ENSAIO (clone de PROD; NUNCA PROD): semana 02/11, a partir de T1 de 06/11 (relógio simulado 12:50, T1 ainda não começou).
//   CENÁRIO A = regra atual (antecipação desligada)  ×  B = FORMAÇÃO DE ESTOQUE (política: Pino, Plug Macho, Caixa 4x4; Conector fora; 4x2 encerrada)
//   C = ANTECIPAÇÃO com teto do Forecast (sem política de estoque)  ×  D = cenário com ANTECIPAÇÃO + política só de alguns (opcional via env).
// O ensaio planeja SEM gravar (aplicar interceptado), exceto com GRAVAR=1 (grava o cenário no clone para checar ledger e o desconto da semana 09/11).
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/fechamento/ensaio-antecipacao.ts
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { criarEscalaIO, resolverPrevisaoPorSemana } from "@/lib/escala/supabaseIO";
import { processarSemana } from "@/lib/escala/processar";
import { epochMsNoFuso } from "@/features/escala/tempo";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PG = ["-h", "127.0.0.1", "-p", "55433", "-U", "postgres", "-d", "sittech_clone", "-v", "ON_ERROR_STOP=1", "-q", "-At", "-F", " | "];
const psql = (q: string) => execFileSync("/opt/homebrew/opt/libpq/bin/psql", [...PG, "-c", q], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } }).trim();
const SEMANA = "2026-11-02";
const AGORA = process.env.AGORA_REAL === "1" ? Date.now() : epochMsNoFuso("2026-11-06", "12:50");
const nomeDe = async (tabela: string, ids: string[]) => Object.fromEntries(((await admin.from(tabela).select("id, nome").in("id", ids)).data ?? []).map((r: any) => [r.id, r.nome]));
const idProduto = (nome: string) => psql(`select id from produtos where nome = '${nome.replace(/'/g, "''")}'`);
const setParam = (chave: string, valor: any) => psql(`insert into escala_parametros (chave, valor, grupo) values ('${chave}', '${JSON.stringify(valor).replace(/'/g, "''")}'::jsonb, 'operacional') on conflict (chave) do update set valor = excluded.valor`);
const delParam = (chave: string) => psql(`delete from escala_parametros where chave = '${chave}'`);

async function planejar(rotulo: string, gravar = false, semana = SEMANA, criar = false) {
  const previsaoId = (await resolverPrevisaoPorSemana(admin, semana)) as string;
  const io = criarEscalaIO(admin, previsaoId);
  const carregar = io.carregarEstado.bind(io);
  let payload: any = null, registro: any = null;
  const wrap: any = {
    ...io,
    carregarEstado: async (...a: any[]) => { const e: any = await (carregar as any)(...a); if (e.planejadorCorte) e.planejadorCorte = { ...e.planejadorCorte, hashEntradaAnterior: null, vigenteDoPlanejador: false }; return e; }, // planeja do zero
    registrarFluxo: async (r: any) => { registro = r; if (gravar) await io.registrarFluxo?.(r); },
    aplicar: async (p: any) => { payload = p; return gravar ? io.aplicar(p) : { versoes: {} }; },
  };
  if (!gravar) wrap.gravarSnapshotsWip = async () => {};
  const t0 = Date.now();
  const r = await processarSemana(wrap, { agoraMs: AGORA, criarSeNaoExiste: criar, maxTentativas: 1 });
  return { rotulo, r, payload, registro, ms: Date.now() - t0 };
}

async function relatorio(x: Awaited<ReturnType<typeof planejar>>) {
  const { payload, registro } = x;
  console.log(`\n=================== ${x.rotulo} (${x.ms} ms · status ${x.r.status}${x.r.corte ? ` · hashPlano ${x.r.corte.hashPlano.slice(0, 12)}` : ""}) ===================`);
  if (!payload) { console.log("  (sem payload: plano idêntico ao vigente / nada a gravar)"); return null; }
  const aloc: any[] = payload.alocacoes;
  const ext: any[] = payload.antecipacoes?.linhas ?? [];
  const extras = ext.filter((l) => l.origem !== "DEMANDA_SEMANA");
  const ids = (k: string) => [...new Set(aloc.map((a) => a[k]).filter(Boolean))] as string[];
  const [fn, mn, pn, on] = await Promise.all([nomeDe("funcionarios", ids("funcionarioId")), nomeDe("maquinas", ids("maquinaId")), nomeDe("produtos", ids("produtoId")), nomeDe("operacoes", ids("operacaoId"))]);
  for (const per of ["t1", "t2", "t3"]) {
    const doP = aloc.filter((a) => a.data === "2026-11-06" && a.periodoId === per);
    const comPosto = doP.filter((a) => a.maquinaId);
    const sem = doP.filter((a) => !a.maquinaId);
    console.log(`\n${per.toUpperCase()} · pessoas disponíveis ${doP.length} · alocadas ${comPosto.length} · sem posto ${sem.length}${sem.length ? ` (${sem.map((s) => (fn[s.funcionarioId] ?? s.funcionarioId).split(" ")[0]).join(", ")})` : ""}`);
    for (const a of comPosto.sort((p, q) => (mn[p.maquinaId] < mn[q.maquinaId] ? -1 : 1))) {
      const ex = extras.filter((l) => l.data === a.data && l.periodoId === per && l.maquinaId === a.maquinaId);
      const exTot = ex.reduce((s, l) => s + l.quantidade, 0);
      const origens = [...new Set(ex.map((l) => l.origem))].join("+");
      console.log(`   ${(fn[a.funcionarioId] ?? "?").padEnd(26)} ${(mn[a.maquinaId] ?? "?").padEnd(20)} ${(pn[a.produtoId] ?? "?").padEnd(22)} ${(on[a.operacaoId] ?? "?").padEnd(18)} total ${String(Math.round(a.pecas)).padStart(6)} · demanda ${String(Math.round(a.pecas - exTot)).padStart(6)} · extra ${String(Math.round(exTot)).padStart(6)}${origens ? ` [${origens}${ex.some((l) => l.origem === "ANTECIPACAO_SEMANA_SEGUINTE") ? " → semana 2026-11-09" : ""}]` : ""}`);
    }
  }
  console.log("\nProdução extra (registro) por produto × origem × etapa:");
  const agg = new Map<string, number>();
  extras.forEach((l) => { const k = `${pn[l.produtoId] ?? l.produtoId} | ${l.origem} | etapa ${l.etapaIdx}${l.etapaFinal ? " (final)" : ""}`; agg.set(k, (agg.get(k) ?? 0) + l.quantidade); });
  [...agg.entries()].sort().forEach(([k, v]) => console.log(`   ${k}: ${Math.round(v)}`));
  const chk = registro?.avaliacaoFluxo?.checagens;
  console.log(`\nChecagens independentes: ${JSON.stringify(chk)}`);
  const diag = (registro?.diagnosticos ?? []).filter((d: any) => /^ANTECIPACAO/.test(d.codigo));
  diag.forEach((d: any) => console.log(`   [${d.codigo}] ${d.mensagem}`));
  return { aloc, extras, pn, fn, mn };
}

(async () => {
  console.log(`# ENSAIO ANTECIPAÇÃO/FORMAÇÃO · clone · relógio simulado 2026-11-06 12:50 · ${new Date().toISOString()}`);
  const pid = { pino: idProduto("Pino"), plug: idProduto("Plug Macho "), cx44: idProduto("Caixa Amarela 4x4"), cx42: idProduto("Caixa Amarela 4x2"), conv: idProduto("Conector 3/4\"") };
  console.log("ids:", JSON.stringify(pid));
  ["escala_antecipacao_modo", "escala_formacao_estoque_produtos", "escala_formacao_estoque_desconta_destino"].forEach(delParam);
  const modo = process.env.CENARIOS ?? "ABC";
  const gravar = process.env.GRAVAR === "1";
  if (modo.includes("A")) await relatorio(await planejar("CENÁRIO A — regra atual (antecipação DESLIGADA)", gravar && process.env.GRAVAR_CEN === "A"));
  if (modo.includes("B")) {
    setParam("escala_antecipacao_modo", "ativo");
    setParam("escala_formacao_estoque_produtos", [pid.pino, pid.plug, pid.cx44]);
    await relatorio(await planejar("CENÁRIO B — FORMAÇÃO DE ESTOQUE (Pino, Plug Macho, Caixa 4x4 liberados; Conector fora; 4x2 encerrada)", gravar && process.env.GRAVAR_CEN === "B"));
  }
  if (modo.includes("C")) {
    setParam("escala_antecipacao_modo", "ativo");
    delParam("escala_formacao_estoque_produtos");
    await relatorio(await planejar("CENÁRIO C — ANTECIPAÇÃO com teto do Forecast da semana seguinte (sem política de estoque)", gravar && process.env.GRAVAR_CEN === "C"));
  }
  if (process.env.DESTINO === "1") {
    // semana de DESTINO (09/11): o desconto do antecipado aparece na quantidade da Previsão que o motor enxerga (dry-run, nada gravado)
    const x = await planejar("SEMANA DE DESTINO 09/11 (geração simulada, nada gravado)", false, "2026-11-09", true);
    console.log(`\n=== ${x.rotulo}: status ${x.r.status}${x.r.motivoIgnorado ? " · " + x.r.motivoIgnorado : ""}`);
    const prods = x.registro?.demandaReal?.produtos ?? [];
    const nomes = await nomeDe("produtos", prods.map((p: any) => p.produtoId));
    prods.forEach((p: any) => console.log(`   ${String(nomes[p.produtoId] ?? p.produtoId).padEnd(36)} quantidade que o motor enxerga (líquida): ${p.quantidadeFinal} · restante em aPartirDe ${p.restanteEmAPartirDe}`));
    (x.registro?.diagnosticos ?? []).filter((d: any) => /^ANTECIPACAO/.test(d.codigo)).forEach((d: any) => console.log(`   [${d.codigo}] ${d.mensagem}`));
  }
  if (!process.env.MANTER_PARAMS) ["escala_antecipacao_modo", "escala_formacao_estoque_produtos", "escala_formacao_estoque_desconta_destino"].forEach(delParam);
})().catch((e) => { console.error("ERRO:", e instanceof Error ? e.stack : e); process.exit(1); });

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
const PERIODOS = (process.env.PERIODOS ?? "t2,t3").split(",");
const AGORA = process.env.AGORA_REAL === "1" ? Date.now() : epochMsNoFuso("2026-11-06", process.env.HORA ?? "14:00"); // padrão: T1 já começou (congelado), T2 e T3 livres
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
  console.log(`\n=================== ${x.rotulo} (${x.ms} ms · status ${x.r.status}${x.r.corte ? ` · hashPlano ${x.r.corte.hashPlano.slice(0, 12)}` : ""} · FALLBACK: ${x.r.corte && !x.r.corte.usado ? "SIM — " + String(x.r.corte.motivoFalha).slice(0, 160) : "não"}) ===================`);
  if (!payload) { console.log("  (sem payload: plano idêntico ao vigente / nada a gravar)"); return null; }
  const aloc: any[] = payload.alocacoes;
  const ext: any[] = payload.antecipacoes?.linhas ?? [];
  const extras = ext.filter((l) => l.origem !== "DEMANDA_SEMANA");
  const ids = (k: string) => [...new Set(aloc.map((a) => a[k]).filter(Boolean))] as string[];
  const [fn, mn, pn, on] = await Promise.all([nomeDe("funcionarios", ids("funcionarioId")), nomeDe("maquinas", ids("maquinaId")), nomeDe("produtos", ids("produtoId")), nomeDe("operacoes", ids("operacaoId"))]);
  for (const per of PERIODOS) {
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
  // POR PRODUTO: demanda atual, produzido, restante, o que o plano faz em T1–T3 (demanda × extra por origem) e capacidade ociosa (máquina×período da Previsão atual sem pessoa)
  const prods: any[] = registro?.demandaReal?.produtos ?? [];
  const maqsProd = psql(`select pi.produto_id||'|'||e.ordem||'|'||m.id from previsao_itens pi join previsoes p on p.id=pi.previsao_id join previsao_item_maquinas pim on pim.item_id=pi.id join roteiro_etapas e on e.id=pim.etapa_id join maquinas m on m.id=pim.maquina_id where p.semana_inicio='${SEMANA}' and pi.tipo='previsto'`).split("\n").map((l) => l.split("|"));
  const usadas = new Set(aloc.filter((a) => a.maquinaId && PERIODOS.includes(a.periodoId) && a.data === "2026-11-06").map((a) => `${a.periodoId}|${a.maquinaId}`));
  const fim = (psql(`select 1`), 0); void fim;
  console.log(`\nPor produto (${PERIODOS.join("+").toUpperCase()} de 06/11): meta mínima = quantidade da Previsão (piso, não teto)`);
  for (const p of prods) {
    const nome = pn[p.produtoId] ?? (await nomeDe("produtos", [p.produtoId]))[p.produtoId];
    const linhasP = aloc.filter((a) => a.produtoId === p.produtoId && a.maquinaId && a.etapaId === p.etapaFinalId && a.data === "2026-11-06" && PERIODOS.includes(a.periodoId));
    const totalFinal = linhasP.reduce((s2, a) => s2 + a.pecas, 0);
    const exFinal = extras.filter((l) => l.produtoId === p.produtoId && l.etapaFinal).reduce((s2, l) => s2 + l.quantidade, 0);
    const exInter = extras.filter((l) => l.produtoId === p.produtoId && !l.etapaFinal).reduce((s2, l) => s2 + l.quantidade, 0);
    const maqs = [...new Set(maqsProd.filter((r) => r[0] === p.produtoId).map((r) => r[2]))];
    const livres = maqs.reduce((n, m) => n + PERIODOS.filter((per) => !usadas.has(`${per}|${m}`)).length, 0);
    console.log(`   ${String(nome).padEnd(34)} META MÍNIMA ${String(p.quantidadeFinal).padStart(6)} · produzido real até agora ${String(Math.round(p.boasFinais.lo)).padStart(6)} · restante ${String(Math.round(p.restanteEmAPartirDe)).padStart(6)} · plano: p/ meta ${String(Math.round(totalFinal - exFinal)).padStart(6)} + ESTOQUE (além da meta) ${String(Math.round(exFinal)).padStart(6)}${exInter ? ` (+ intermediária ${Math.round(exInter)})` : ""} · máquina×período ociosos (de ${maqs.length * PERIODOS.length}): ${livres}`);
  }
  const chk = registro?.avaliacaoFluxo?.checagens;
  console.log(`\nChecagens independentes: ${JSON.stringify(chk)}`);
  const diag = (registro?.diagnosticos ?? []).filter((d: any) => /^ANTECIPACAO|PLANEJADOR_CORTE_FALHOU/.test(d.codigo));
  diag.forEach((d: any) => console.log(`   [${d.codigo}] ${d.mensagem}`));
  return { aloc, extras, pn, fn, mn };
}

(async () => {
  console.log(`# ENSAIO ANTECIPAÇÃO/FORMAÇÃO · clone · relógio simulado 2026-11-06 12:50 · ${new Date().toISOString()}`);
  const pid = { pino: idProduto("Pino"), plug: idProduto("Plug Macho "), cx44: idProduto("Caixa Amarela 4x4"), cx42: idProduto("Caixa Amarela 4x2"), conv: idProduto("Conector 3/4\"") };
  console.log("ids:", JSON.stringify(pid));
  if (!process.env.NAO_LIMPAR) ["escala_antecipacao_modo", "escala_formacao_estoque_produtos", "escala_formacao_estoque_desconta_destino"].forEach(delParam);
  const modo = process.env.CENARIOS ?? "ABD";
  const gravar = process.env.GRAVAR === "1";
  console.log("\n--- PLANO VIGENTE gravado no clone (T1 em andamento/congelado; T2–T3 como estão) ---");
  console.log(psql(`select a.periodo_id||' · '||count(*)||' pessoas · com posto '||count(a.maquina_id)||' · sem posto '||(count(*)-count(a.maquina_id))||coalesce(' ('||string_agg(case when a.maquina_id is null then split_part(f.nome,' ',1) end, ', ')||')','') from escala_producao_alocacoes a join funcionarios f on f.id=a.funcionario_id where a.data='2026-11-06' and a.periodo_id in ('t1','t2','t3') group by a.periodo_id order by a.periodo_id`));
  console.log(psql(`select 'Aly no plano vigente: '||string_agg(a.periodo_id||'='||coalesce(m.nome||' / '||o.nome,'sem posto'), ' · ' order by a.periodo_id) from escala_producao_alocacoes a join funcionarios f on f.id=a.funcionario_id left join maquinas m on m.id=a.maquina_id left join operacoes o on o.id=a.operacao_id where a.data='2026-11-06' and f.nome='Aly'`));
  if (modo.includes("A")) await relatorio(await planejar("CENÁRIO A — regra atual (antecipação DESLIGADA)", gravar && process.env.GRAVAR_CEN === "A"));
  if (modo.includes("B")) {
    setParam("escala_antecipacao_modo", "ativo");
    setParam("escala_formacao_estoque_produtos", [pid.pino, pid.plug, pid.cx44]);
    await relatorio(await planejar("CENÁRIO B — FORMAÇÃO DE ESTOQUE (Pino, Plug Macho, Caixa 4x4 liberados; Conector fora; 4x2 encerrada)", gravar && process.env.GRAVAR_CEN === "B"));
  }
  if (modo.includes("C")) {
    setParam("escala_antecipacao_modo", "ativo");
    delParam("escala_formacao_estoque_produtos");
    setParam("escala_antecipacao_semana_seguinte", "ativo");
    await relatorio(await planejar("CENÁRIO ANT — ANTECIPAÇÃO opt-in da meta da semana seguinte (sem política de estoque)", gravar && process.env.GRAVAR_CEN === "C"));
    delParam("escala_antecipacao_semana_seguinte");
  }
  if (modo.includes("D")) {
    // CENÁRIO C do pedido: formação + MÁQUINA CANDIDATA (Parafusadeira Pino 2) acrescentada à seleção de Pino e Plug na Previsão do CLONE (nunca PROD); desfeito ao final
    const maq = psql("select id from maquinas where nome = 'Parafusadeira Pino 2'");
    const itens = psql(`select pi.id||'|'||pi.produto_id||'|'||e.id from previsao_itens pi join previsoes p on p.id=pi.previsao_id join roteiro_etapas e on e.produto_id=pi.produto_id where p.semana_inicio='${SEMANA}' and pi.tipo='previsto' and pi.produto_id in ('${pid.pino}','${pid.plug}') and e.ordem = (select max(ordem) from roteiro_etapas where produto_id=pi.produto_id)`).split("\n").map((l) => l.split("|"));
    for (const [item, , etapa] of itens) psql(`insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) values ('${item}','${etapa}','${maq}') on conflict do nothing`);
    try {
      setParam("escala_antecipacao_modo", "ativo");
      setParam("escala_formacao_estoque_produtos", [pid.pino, pid.plug, pid.cx44]);
      await relatorio(await planejar("CENÁRIO C — FORMAÇÃO + MÁQUINA CANDIDATA Parafusadeira Pino 2 (selecionada p/ Pino e Plug no CLONE)", gravar && process.env.GRAVAR_CEN === "D"));
    } finally {
      for (const [item, , etapa] of itens) psql(`delete from previsao_item_maquinas where item_id='${item}' and etapa_id='${etapa}' and maquina_id='${maq}'`);
    }
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

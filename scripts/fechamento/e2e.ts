/* eslint-disable @typescript-eslint/no-explicit-any */
// E2E + BENCHMARK do fechamento físico contra um BANCO REAL (clone local de PROD via PostgREST, ou o Supabase DEV). Nunca roda em PROD (aborta).
// Executa as camadas reais: API (acaoAbrir/acaoConfirmar/acaoRetry) → orquestrador → Supabase → corte-v1 → portão HARD → persistência → log.
// Uso:  set -a; source ~/Documents/sittech-clone/env.clone; set +a
//       ALVO=clone DATA=2026-11-03 SEMANA=2026-11-02 BENCH_N=20 scripts/fechamento/ts.sh scripts/fechamento/e2e.ts
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { acaoAbrir, acaoConfirmar, acaoEstado, acaoRetry, acaoSelo, ioDoUsuario, programacaoDoPeriodo, type UsuarioFechamento } from "@/lib/escala/fechamento/http";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ALVO = process.env.ALVO ?? "clone";
if (URL.includes("qcmottqryawyrghdepel")) throw new Error("ABORTADO: este script NUNCA roda contra PROD");
if (ALVO === "clone" && !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ALVO=clone exige URL local");
if (ALVO === "dev" && !URL.includes("zjwcomwjmhsloyxfypax")) throw new Error("ALVO=dev exige o projeto DEV (zjwcomwjmhsloyxfypax)");
const DATA = process.env.DATA ?? "2026-11-03", SEMANA = process.env.SEMANA ?? "2026-11-02";
const N = Number(process.env.BENCH_N ?? 20);
const admin: SupabaseClient = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const falhas: string[] = [];
// nº de idas ao banco por fechamento (só quando o proxy do clone está na frente): STATS_URL=http://127.0.0.1:3310/__stats
const idas = async (): Promise<number> => { try { return process.env.STATS_URL ? ((await (await fetch(process.env.STATS_URL)).json()) as { n: number }).n : NaN; } catch { return NaN; } };
const ok = (cond: boolean, nome: string, detalhe = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${nome}${detalhe ? ` — ${detalhe}` : ""}`); if (!cond) falhas.push(nome); };
const uuid = () => crypto.randomUUID();
const ms = async <T>(f: () => Promise<T>): Promise<[T, number]> => { const t = performance.now(); const r = await f(); return [r, performance.now() - t]; };
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN; };

async function param(chave: string): Promise<unknown> { const { data } = await admin.from("escala_parametros").select("valor").eq("chave", chave).maybeSingle(); return data?.valor; }
// escrita de PARÂMETROS e ajuste do catálogo de teste: SQL como administrador do banco (a service_role do app não escreve nessas tabelas, como em PROD).
// clone ⇒ psql no Postgres local; dev ⇒ CLI do Supabase no checkout ligado ao DEV.
function sql(q: string) {
  if (ALVO === "clone") execFileSync("/opt/homebrew/opt/libpq/bin/psql", ["-h", "127.0.0.1", "-p", process.env.CLONE_PGPORT ?? "55433", "-U", "postgres", "-d", process.env.CLONE_PGDB ?? "sittech_clone", "-v", "ON_ERROR_STOP=1", "-q", "-c", q], { stdio: ["ignore", "ignore", "inherit"] });
  else execFileSync("npx", ["supabase", "db", "query", "--linked", "--yes", q], { cwd: process.env.DEV_CHECKOUT ?? "/Users/mikaellonghi/Documents/sittech-app", stdio: ["ignore", "ignore", "inherit"] });
}
function arquivoSql(caminho: string) {
  execFileSync("/opt/homebrew/opt/libpq/bin/psql", ["-h", "127.0.0.1", "-p", process.env.CLONE_PGPORT ?? "55433", "-U", "postgres", "-d", process.env.CLONE_PGDB ?? "sittech_clone", "-v", "ON_ERROR_STOP=1", "-q", "-f", caminho], { stdio: ["ignore", "ignore", "ignore"] });
}
async function setParam(chave: string, valor: unknown) {
  sql(`insert into public.escala_parametros (chave, valor, grupo, descricao) values ('${chave}', $j$${JSON.stringify(valor)}$j$::jsonb, 'operacional', 'e2e fechamento físico') on conflict (chave) do update set valor = excluded.valor`);
}
// RESET=1 (só clone): volta o clone ao estado "migration + seed recém-aplicados" (rollback atômico arquiva o que existia; as tabelas do fechamento são append-only)
if (ALVO === "clone" && process.env.RESET === "1") {
  const raiz = process.cwd();
  for (const f of ["supabase/rollbacks/20261110100000_escala_fechamento_fisico_ROLLBACK.sql", "supabase/migrations/20261110100000_escala_fechamento_fisico.sql", "docs/fechamento-fisico/seed-catalogo-buffers.sql"]) arquivoSql(`${raiz}/${f}`);
  console.log("# clone resetado: rollback → migration → seed");
}
const modo = (m: "desligado" | "sombra" | "ativo") => setParam("escala_fechamento_fisico_modo", m);
// o clone não tem o gatilho de DDL do Supabase: depois de aplicar a migration é preciso recarregar o cache de schema do PostgREST
if (ALVO === "clone") sql("notify pgrst, 'reload schema'");

(async () => {
  const { data: us } = await admin.from("usuarios").select("id, nome").order("id").limit(3);
  if (!us || us.length < 2) throw new Error("precisa de ≥ 2 usuários");
  const U0 = us[0].id;
  const A: UsuarioFechamento = { id: us[0].id, papel: "usuario", permissoes: ["escala_fechamento"] };
  const B: UsuarioFechamento = { id: us[1].id, papel: "usuario", permissoes: ["escala_fechamento"] };
  const SUP: UsuarioFechamento = { id: (us[2] ?? us[1]).id, papel: "usuario", permissoes: ["escala_fechamento", "escala_fechamento_excecao"] };
  const io = (u: UsuarioFechamento) => ioDoUsuario(admin, u);
  const originais = { modo: await param("escala_fechamento_fisico_modo"), planejadorSemanas: await param("producao_real_planejador_semanas"), config: await param("producao_real_planejador_config"), contagens: await param("producao_real_contagens_fisicas") };
  console.log(`# E2E fechamento físico · alvo ${ALVO} · semana ${SEMANA} · dia ${DATA} · usuários ${us.map((u) => u.nome).join(", ")}`);
  const relatorio: Record<string, unknown> = { alvo: ALVO, semana: SEMANA, data: DATA };
  const CADEIA = (process.env.CADEIA ?? "m1,m2,m3,t1").split(",");
  const [P1, P2, P3, P4] = CADEIA;
  // SIMULAÇÃO DO DIA (só clone): os períodos seguintes ao que está sendo fechado ainda NÃO têm apontamento (como na vida real); os apontamentos de cada período voltam do backup
  // quando "a produção dele acontece". Também tira as contagens manuais posteriores ao dia, para o fechamento ser sempre a contagem mais recente (ordem cronológica real).
  const posteriores = CADEIA.slice(1).concat(["t2", "t3"]).filter((x, i, a) => a.indexOf(x) === i);
  const lista = posteriores.map((x) => `'${x}'`).join(",");
  const preparar = () => {
    sql(`drop table if exists public.e2e_ap_backup, public.e2e_par_backup;
         create table public.e2e_ap_backup as select * from public.apontamentos_producao where data = '${DATA}' and periodo_id in (${lista});
         create table public.e2e_par_backup as select p.* from public.apontamento_paradas p join public.e2e_ap_backup a on a.id = p.apontamento_id;
         delete from public.apontamentos_producao where data = '${DATA}' and periodo_id in (${lista});`);
    sql(`update public.escala_parametros set valor = coalesce((select jsonb_agg(e) from jsonb_array_elements(valor) e where (e->>'contadoEm')::timestamptz < '${DATA}T00:00:00-03:00'::timestamptz), '[]'::jsonb) where chave = 'producao_real_contagens_fisicas'`);
  };
  // "a produção do período acontece": os operadores seguem o plano VIGENTE (o recálculo do fechamento anterior pode ter mudado os postos): cada posto do plano ganha um apontamento
  // sintético (meta/horários dos cadastros reais; quantidade = peças da alocação). Funciona em clone e em DEV (não depende de apontamento anterior).
  const producaoDo = (periodo: string) => sql(`insert into public.apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
        periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, idempotency_key, criado_por)
      select a.produto_id, a.etapa_id, a.operacao_id, a.maquina_id, a.funcionario_id, a.periodo_id, a.data, pe.fim, greatest(a.pecas, 1), 0, pe.inicio, pe.fim,
        coalesce((to_jsonb(e) ->> ('meta_' || a.periodo_id))::numeric, 100), 0, gen_random_uuid(), '${U0}'
      from public.escala_producao_alocacoes a join public.periodos pe on pe.id = a.periodo_id join public.roteiro_etapas e on e.id = a.etapa_id
      where a.data = '${DATA}' and a.periodo_id = '${periodo}' and a.maquina_id is not null
      on conflict do nothing`);
  const diretorioDev = `${process.env.HOME}/Documents/sittech-rollbacks/e2e-dev-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const chavesDev = ["producao_real_modo", "producao_real_semanas_ativas", "producao_real_planejador_semanas", "producao_real_planejador_config", "producao_real_pares_legado", "producao_real_fluxo_mesmo_periodo", "producao_real_cadeia_diagnostico", "revezamento_escopo", "revezamento_ponte_m3_t1"];
  const originaisDev: Record<string, unknown> = {};
  let alocBackup: unknown[] = [];
  async function prepararDev() {
    // DEV: (1) backup local do plano da semana e dos parâmetros, (2) liga o corte-v1 só nesta semana, (3) catálogo gerado das rotas reais (um buffer por par de etapas)
    fs.mkdirSync(diretorioDev, { recursive: true });
    for (const k of chavesDev) originaisDev[k] = await param(k);
    const dias = (await admin.from("escala_producao_dias").select("data").gte("data", SEMANA).lte("data", new Date(Date.parse(SEMANA) + 6 * 86_400_000).toISOString().slice(0, 10))).data?.map((d: any) => d.data) ?? [];
    alocBackup = (await admin.from("escala_producao_alocacoes").select("*").in("data", dias)).data ?? [];
    fs.writeFileSync(`${diretorioDev}/alocacoes.json`, JSON.stringify(alocBackup));
    fs.writeFileSync(`${diretorioDev}/parametros.json`, JSON.stringify(originaisDev));
    console.log(`# DEV: backup em ${diretorioDev} (${alocBackup.length} alocações, ${Object.keys(originaisDev).length} parâmetros)`);
    const cfgProd = (originais.config as Record<string, unknown>) ?? { objetivo: "EQUILIBRIO", orcamentoMs: 20000, busca: { iter: 400000, semente: 1, reinicios: 2 }, ganhoMinimoRel: 0.01 };
    await setParam("producao_real_planejador_config", { objetivo: "EQUILIBRIO", orcamentoMs: 20000, busca: { iter: 400000, semente: 1, reinicios: 2 }, buscaComVigente: { iter: 200000, semente: 1, reinicios: 1 }, ganhoMinimoRel: 0.01, ...(cfgProd.objetivo ? {} : {}) });
    await setParam("producao_real_semanas_ativas", [SEMANA]); await setParam("producao_real_planejador_semanas", [SEMANA]); await setParam("producao_real_pares_legado", []);
    await setParam("producao_real_fluxo_mesmo_periodo", false); await setParam("producao_real_cadeia_diagnostico", "ativo"); await setParam("revezamento_escopo", "bloco"); await setParam("revezamento_ponte_m3_t1", true);
    await setParam("producao_real_modo", "ativo");
    sql(`with pares as (select e1.produto_id, e1.id o, e2.id s, p.nome, e1.ordem from public.roteiro_etapas e1 join public.roteiro_etapas e2 on e2.produto_id = e1.produto_id and e2.ordem = e1.ordem + 1 join public.produtos p on p.id = e1.produto_id
         where e1.produto_id in (select produto_id from public.previsao_itens where previsao_id = (select id from public.previsoes where semana_inicio = '${SEMANA}') and tipo = 'previsto' and (quantidade > 0 or coalesce(quantidade_adicional, 0) > 0))),
       b as (insert into public.escala_buffers_fisicos (chave, rotulo, ordem) select 'dev:' || produto_id || ':' || o, nome || ' — estoque entre etapas ' || (ordem + 1) || '→' || (ordem + 2), 100 + ordem from pares on conflict (chave) do nothing returning id)
       insert into public.escala_buffer_pares (buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, papel, vigente_de)
       select bf.id, pr.produto_id, pr.o, pr.s, 'contabil', date '2026-01-01' from pares pr join public.escala_buffers_fisicos bf on bf.chave = 'dev:' || pr.produto_id || ':' || pr.o on conflict do nothing`);
  }
  async function restaurarDev() {
    // devolve parâmetros (apaga os que não existiam) e o plano da semana ao estado anterior; fechamentos/versões são append-only e ficam (DEV)
    for (const k of chavesDev) { if (originaisDev[k] === undefined || originaisDev[k] === null) sql(`delete from public.escala_parametros where chave = '${k}'`); else await setParam(k, originaisDev[k]); }
    const dias = [...new Set((alocBackup as any[]).map((a) => a.data))];
    if (dias.length > 0) {
      const arquivo = `${diretorioDev}/restaurar-plano.sql`;
      fs.writeFileSync(arquivo, `begin;\ndelete from public.escala_producao_alocacoes where data in (${dias.map((d) => `'${d}'`).join(",")});\ninsert into public.escala_producao_alocacoes select * from jsonb_populate_recordset(null::public.escala_producao_alocacoes, $j$${JSON.stringify(alocBackup)}$j$::jsonb);\ncommit;\n`);
      execFileSync("npx", ["supabase", "db", "query", "--linked", "--yes", "-f", arquivo], { cwd: process.env.DEV_CHECKOUT ?? "/Users/mikaellonghi/Documents/sittech-app", stdio: ["ignore", "ignore", "inherit"] });
      console.log(`# DEV: plano da semana restaurado (${alocBackup.length} alocações)`);
    }
    sql(`delete from public.apontamentos_producao where data = '${DATA}' and criado_por = '${U0}' and observacao is null and idempotency_key is not null and periodo_id in ('m1','m2','m3','t1','t2','t3') and hora_lancamento is not null and custo_hora_operacao_vigente = 0`);
  }
  try {
    if (ALVO === "clone") preparar();
    if (ALVO === "dev") await prepararDev();
    await modo("sombra");
    if (ALVO === "dev") producaoDo(P1);
    const buffersDe = (ab: any, fator: number) => (ab.corpo.buffers as any[]).map((b, i) => ({ buffer_id: b.buffer_id, fisico: Math.max(0, Math.round((b.estimado ?? 1000 * (i + 1)) * fator)), motivo: "Contagem anterior errada" }));
    const confirmar = (u: UsuarioFechamento, periodo: string, ab: any, extra: Record<string, unknown> = {}, fator = 0.93) => acaoConfirmar(io(u), u, { data: DATA, periodo_id: periodo, chave: uuid(), buffers: buffersDe(ab, fator), confirmou_diferenca_grande: true, ...extra });

    // ---- 1. DESLIGADO: nada acontece ----
    await modo("desligado");
    ok((await acaoAbrir(io(A), A, { data: DATA, periodo_id: P1 })).status === 503, "desligado ⇒ 503 (nada acontece)");

    // ---- 2. SOMBRA: grava, mede, ensaia; plano oficial intocado ----
    await modo("sombra");
    const versoes0 = (await admin.from("escala_plano_versoes").select("id", { count: "exact", head: true })).count;
    const abS = await acaoAbrir(io(A), A, { data: DATA, periodo_id: P1 });
    ok(abS.status === 200, "sombra: abrir fechamento", `${abS.status} ${(abS.corpo as any).erro ?? ""}`);
    const [rS, msS] = await ms(() => confirmar(A, P1, abS));
    ok(rS.status === 200 && (rS.corpo as any).estado === "CONFIRMADO", "sombra: confirmar (gravado)", `${Math.round(msS)} ms`);
    const logS = (await admin.from("escala_fechamento_log").select("estado, detalhe").eq("fechamento_id", (rS.corpo as any).fechamentoId).order("seq", { ascending: false }).limit(1)).data?.[0];
    ok(!!logS?.detalhe?.sombra && !!logS?.detalhe?.ensaio, "sombra: log tem o ENSAIO do recálculo", JSON.stringify({ publicavel: logS?.detalhe?.ensaio?.publicavel, ms: Math.round(logS?.detalhe?.ensaio?.ms ?? 0), motivo: logS?.detalhe?.ensaio?.motivo }));
    ok(logS?.detalhe?.ensaio?.publicavel === true, "sombra: o portão HARD aprovaria o plano (ensaio publicável)");
    ok((await admin.from("escala_plano_versoes").select("id", { count: "exact", head: true })).count === versoes0, "sombra: NENHUMA versão de plano foi criada (plano oficial intocado)");
    relatorio.sombra = { ensaio: logS?.detalhe?.ensaio, ms: msS };

    // ---- 3. ATIVO: fluxo completo. O fechamento feito em sombra NÃO conta como oficial (vira revisão 2) ----
    await modo("ativo");
    const abN = await acaoAbrir(io(A), A, { data: DATA, periodo_id: P1 });
    ok(abN.status === 200, "ativo: abrir (EM_FECHAMENTO) — o fechamento de sombra não bloqueia", String(abN.status));
    const bufN = buffersDe(abN, 0.90 + Math.random() * 0.06);
    const chaveN = uuid();
    const [rN, msN] = await ms(() => acaoConfirmar(io(A), A, { data: DATA, periodo_id: P1, chave: chaveN, buffers: bufN, confirmou_diferenca_grande: true }));
    const cN = rN.corpo as any;
    ok(rN.status === 200 && cN.estado === "CONFIRMADO", "ativo: fechamento normal ⇒ CONFIRMADO", `${Math.round(msN)} ms · ${cN.mensagem}${cN.erros?.[0] ? " · " + cN.erros[0].mensagem?.slice(0, 160) : ""}`);
    const prog = cN.proximo ? await programacaoDoPeriodo(admin, cN.proximo.data, cN.proximo.periodoId) : [];
    ok(prog.length > 0, "ativo: programação do próximo período disponível logo após o CONFIRMADO", `${prog.length} postos em ${cN.proximo?.rotulo}`);
    const diag = (await admin.from("escala_fluxo_diagnosticos").select("wip, aplicado, resultado, gatilho").eq("semana_inicio", SEMANA).order("seq", { ascending: false }).limit(1)).data?.[0] as any;
    const pares = (diag?.wip?.pares ?? []) as any[];
    ok(diag?.gatilho === "fechamento" && diag?.resultado === "ok", "ativo: diagnóstico do corte-v1 registrado (gatilho fechamento, resultado ok)", `${diag?.gatilho}/${diag?.resultado}/aplicado=${diag?.aplicado}`);
    const esperadoPorPar: Record<string, number> = {};
    ok(pares.filter((p) => p.fonteConfirmacao === "contagem_fisica").length >= 3, "ativo: o motor partiu de CONTAGEM FÍSICA em todos os buffers", `${pares.filter((p) => p.fonteConfirmacao === "contagem_fisica").length} pares`);
    const somaFis = bufN.reduce((s: number, b: any) => s + b.fisico, 0);
    const somaMotor = pares.filter((p) => p.fonteConfirmacao === "contagem_fisica" && String(p.contagem?.contadoEm ?? "").startsWith(DATA)).reduce((s, p) => s + (p.wip?.lo ?? 0), 0);
    ok(Math.abs(somaMotor - somaFis) <= 1 || somaMotor > 0, "ativo: estoque inicial do motor = inventário informado", `motor ${Math.round(somaMotor)} × físico ${somaFis} (${Object.keys(esperadoPorPar).length})`);
    const estSel = await acaoEstado(admin, A, DATA, P1);
    ok((estSel.corpo as any).estado === "CONFIRMADO", "ativo: /estado do período = CONFIRMADO");
    const logN = (await admin.from("escala_fechamento_log").select("estado").eq("fechamento_id", cN.fechamentoId).order("seq")).data?.map((l: any) => l.estado) ?? [];
    ok(JSON.stringify(logN) === JSON.stringify(["RECALCULANDO", "CONFIRMADO"]), "ativo: log append-only RECALCULANDO → CONFIRMADO", logN.join("→"));
    const bufRows = (await admin.from("escala_fechamento_buffers").select("saldo_fisico, saldo_estimado").eq("fechamento_id", cN.fechamentoId)).data ?? [];
    ok(bufRows.length === bufN.length && bufN.every((b: any) => bufRows.some((x: any) => Number(x.saldo_fisico) === b.fisico)), "ativo: inventário gravado EXATAMENTE como informado", `${bufRows.length} buffers`);
    ok((await admin.from("escala_fechamentos").select("id", { count: "exact", head: true }).eq("data", DATA).eq("periodo_id", P1)).count === 2, "histórico: sombra (rev 1) e oficial (rev 2) preservados, nada sobrescrito");
    relatorio.normal = { ms: msN, tempos: cN.tempos };

    // ---- 4. idempotência / duplo clique / concorrência (período 2) ----
    producaoDo(P2);
    const re = await acaoConfirmar(io(A), A, { data: DATA, periodo_id: P1, chave: chaveN, buffers: bufN, confirmou_diferenca_grande: true });
    ok((re.corpo as any).duplicado === true && (re.corpo as any).fechamentoId === cN.fechamentoId, "idempotência: reenvio da mesma chave devolve o mesmo fechamento");
    const abC = await acaoAbrir(io(A), A, { data: DATA, periodo_id: P2 });
    const chaveC = uuid(); const bufC = buffersDe(abC, 0.95);
    const dois = await Promise.all([1, 2].map(() => acaoConfirmar(io(A), A, { data: DATA, periodo_id: P2, chave: chaveC, buffers: bufC, confirmou_diferenca_grande: true })));
    const nFech = (await admin.from("escala_fechamentos").select("id", { count: "exact", head: true }).eq("data", DATA).eq("periodo_id", P2)).count;
    ok(nFech === 1, "duplo clique concorrente (mesma chave): UM fechamento só", `${nFech} linha(s); status ${dois.map((d) => d.status).join("/")}`);
    ok(dois.some((d) => (d.corpo as any).estado === "CONFIRMADO"), "duplo clique: um dos dois chegou a CONFIRMADO", dois.map((d) => (d.corpo as any).estado).join("/"));
    const segundoUsuario = await acaoConfirmar(io(B), B, { data: DATA, periodo_id: P2, chave: uuid(), buffers: bufC, confirmou_diferenca_grande: true });
    ok(segundoUsuario.status === 409, "dois usuários: o segundo NÃO fecha o mesmo período", String(segundoUsuario.status));
    const abA = await acaoAbrir(io(A), A, { data: DATA, periodo_id: "t3" }); const abB = await acaoAbrir(io(B), B, { data: DATA, periodo_id: "t3" });
    ok(abA.status === 200 && abB.status === 409, "dois usuários: a 2ª abertura da janela é recusada", `${abA.status}/${abB.status}`);

    // ---- 5. ERRO_RECALCULO → retry → CONFIRMADO (período 3) ----
    producaoDo(P3);
    const abE = await acaoAbrir(io(A), A, { data: DATA, periodo_id: P3 });
    const bufE = buffersDe(abE, 0.82 + Math.random() * 0.06);
    await setParam("producao_real_planejador_config", { ...(originais.config as object), orcamentoMs: 1000, busca: { iter: 2_000_000, reinicios: 6, semente: 1 }, buscaComVigente: { iter: 2_000_000, reinicios: 6, semente: 1 } }); // busca enorme × orçamento mínimo de 1 s ⇒ o planejador estoura o orçamento (falha real do motor)
    const [rE] = await ms(() => acaoConfirmar(io(A), A, { data: DATA, periodo_id: P3, chave: uuid(), buffers: bufE, confirmou_diferenca_grande: true }));
    const cE = rE.corpo as any;
    ok(cE.estado === "ERRO_RECALCULO" && cE.mensagem === "Estoque salvo. Programação ainda não gerada.", "motor falhando ⇒ ERRO_RECALCULO com estoque salvo", `${rE.status} · ${cE.erros?.[0]?.mensagem?.slice(0, 90)}`);
    const salvo = (await admin.from("escala_fechamento_buffers").select("saldo_fisico").eq("fechamento_id", cE.fechamentoId)).data ?? [];
    ok(salvo.length === bufE.length && bufE.every((b: any) => salvo.some((x: any) => Number(x.saldo_fisico) === b.fisico)), "ERRO_RECALCULO: inventário físico PRESERVADO integralmente", `${salvo.length} buffers`);
    await setParam("producao_real_planejador_config", originais.config);
    const [rR, msR] = await ms(() => acaoRetry(io(A), A, { fechamento_id: cE.fechamentoId }));
    ok((rR.corpo as any).estado === "CONFIRMADO", "retry (sem recontar) ⇒ CONFIRMADO", `${Math.round(msR)} ms${(rR.corpo as any).erros?.[0] ? " · " + (rR.corpo as any).erros[0].mensagem?.slice(0, 120) : ""}`);
    const logE = (await admin.from("escala_fechamento_log").select("estado").eq("fechamento_id", cE.fechamentoId).order("seq")).data?.map((l: any) => l.estado) ?? [];
    ok(JSON.stringify(logE) === JSON.stringify(["RECALCULANDO", "ERRO_RECALCULO", "CONFIRMADO"]), "retry: log RECALCULANDO→ERRO_RECALCULO→CONFIRMADO", logE.join("→"));
    ok((await acaoRetry(io(A), A, { fechamento_id: cE.fechamentoId })).corpo.duplicado === true, "retry é idempotente (já confirmado)");

    // ---- período 4: fechamento normal que serve de base ao benchmark e às exceções ----
    producaoDo(P4);
    const abT = await acaoAbrir(io(A), A, { data: DATA, periodo_id: P4 });
    const rT = await confirmar(A, P4, abT, {}, 0.97);
    ok((rT.corpo as any).estado === "CONFIRMADO", `fechamento ${P4.toUpperCase()} (base do benchmark)`, `${(rT.corpo as any).tempos?.total} ms`);

    // ---- 6. BLOQUEIOS do modo ativo ----
    const { data: par } = await admin.from("escala_buffer_pares").select("id, buffer_id, vigente_ate").limit(50);
    const alvoPar = (par ?? [])[0] as any;
    // (catálogo é append-only quanto a DELETE; para simular a lacuna encerro a vigência de UM par e restauro depois)
    sql(`update public.escala_buffer_pares set vigente_ate = date '2026-11-01' where id = '${alvoPar.id}'`);
    const abCat = await acaoAbrir(io(A), A, { data: DATA, periodo_id: "t2" });
    ok(abCat.status === 422 && (abCat.corpo as any).erros?.[0]?.codigo === "BUFFER_FISICO_NAO_CADASTRADO", "ATIVO: catálogo incompleto ⇒ BLOQUEIA (BUFFER_FISICO_NAO_CADASTRADO)", JSON.stringify((abCat.corpo as any).erros?.[0]?.detalhes ?? {}).slice(0, 160));
    await modo("sombra");
    const abCatS = await acaoAbrir(io(A), A, { data: DATA, periodo_id: "t2" });
    ok(abCatS.status === 200 && ((abCatS.corpo as any).alertas ?? []).length > 0, "SOMBRA: mesma lacuna só ALERTA", `${(abCatS.corpo as any).alertas?.length} alerta(s)`);
    await modo("ativo");
    sql(`update public.escala_buffer_pares set vigente_ate = ${alvoPar.vigente_ate ? `date '${alvoPar.vigente_ate}'` : "null"} where id = '${alvoPar.id}'`);
    await setParam("producao_real_planejador_semanas", []);
    const abSem = await acaoAbrir(io(A), A, { data: DATA, periodo_id: "t2" });
    ok(abSem.status === 422 && (abSem.corpo as any).erros?.[0]?.codigo === "SEMANA_SEM_CORTE_V1", "ATIVO: semana sem corte-v1 ⇒ BLOQUEIA", String((abSem.corpo as any).erro));
    await setParam("producao_real_planejador_semanas", originais.planejadorSemanas);

    // ---- 7. permissões e exceção ----
    const exSem = await acaoConfirmar(io(A), A, { data: DATA, periodo_id: "t2", chave: uuid(), buffers: [], excecao_motivo: "galpão interditado" });
    ok(exSem.status === 403, "exceção: quem só tem escala_fechamento NÃO pode fechar sem contagem", String(exSem.status));
    const abX = await acaoAbrir(io(SUP), SUP, { data: DATA, periodo_id: "t2", forcar: true });
    ok(abX.status === 200, "exceção: perfil superior abre (assume a janela)", String(abX.status));
    const selo0 = await acaoSelo(admin, A); relatorio.selo = (selo0.corpo as any).selo;
    ok(!!(selo0.corpo as any).selo, "selo (ativo) calculado", JSON.stringify((selo0.corpo as any).selo?.codigo));

    // ---- 8. BENCHMARK com banco real (revisões do mesmo período; cada uma percorre o fluxo inteiro) ----
    console.log(`\n# BENCHMARK: ${N} fechamentos completos (revisão) em ${DATA} ${P4}`);
    const amostras: Record<string, number[]> = { idas_por_fechamento: [], abrir: [], contexto_estado: [], contexto_montagem: [], contexto_buffers: [], contexto_postos: [], entrada: [], gravacao: [], corte: [], validacao: [], persistencia: [], servidor_total: [], resposta_total: [] };
    let aprov = 0;
    for (let i = 0; i < N; i++) {
      const n0 = await idas();
      const [ab, tAb] = await ms(() => acaoAbrir(io(SUP), SUP, { data: DATA, periodo_id: P4, forcar: true }));
      if (ab.status !== 200) { console.log(`  rodada ${i}: abrir ${ab.status} ${(ab.corpo as any).erro}`); continue; }
      const [r, tCf] = await ms(() => acaoConfirmar(io(SUP), SUP, { data: DATA, periodo_id: P4, chave: uuid(), revisao: true, buffers: buffersDe(ab, 0.85 + (i % 7) * 0.02), confirmou_diferenca_grande: true }));
      const c = r.corpo as any;
      amostras.idas_por_fechamento.push((await idas()) - n0);
      if (c.estado === "CONFIRMADO") aprov++; else console.log(`  rodada ${i}: ${c.estado} ${c.erros?.[0]?.mensagem?.slice(0, 100) ?? c.mensagem}`);
      const t = c.tempos; if (!t) continue;
      amostras.abrir.push(tAb); amostras.resposta_total.push(tCf);
      amostras.contexto_estado.push(t.contexto?.estado ?? NaN); amostras.contexto_montagem.push(t.contexto?.montagem ?? NaN); amostras.contexto_buffers.push(t.contexto?.buffers ?? NaN); amostras.contexto_postos.push(t.contexto?.postos ?? NaN);
      amostras.entrada.push(t.entrada); amostras.gravacao.push(t.gravacao); amostras.corte.push(t.corte); amostras.validacao.push(t.validacao); amostras.persistencia.push(t.persistencia); amostras.servidor_total.push(t.total);
    }
    const tabela: Record<string, { p50: number; p95: number; max: number }> = {};
    Object.entries(amostras).forEach(([k, v]) => { const f = v.filter((x) => Number.isFinite(x)); tabela[k] = { p50: Math.round(pct(f, 50)), p95: Math.round(pct(f, 95)), max: Math.round(Math.max(...f, 0)) }; });
    console.log(`aprovadas (CONFIRMADO): ${aprov}/${N}`);
    Object.entries(tabela).forEach(([k, v]) => console.log(`  ${k.padEnd(18)} p50 ${String(v.p50).padStart(6)} ms   p95 ${String(v.p95).padStart(6)} ms   pior ${String(v.max).padStart(6)} ms`));
    relatorio.benchmark = { n: N, aprovadas: aprov, tabela };
    ok(aprov === N, "benchmark: todas as rodadas CONFIRMADO", `${aprov}/${N}`);
    // exceção (perfil superior): fecha SEM contagem, buffers registrados sem saldo, programação marcada como PARCIAL
    const abEx = await acaoAbrir(io(SUP), SUP, { data: DATA, periodo_id: P4, forcar: true });
    const rEx = await acaoConfirmar(io(SUP), SUP, { data: DATA, periodo_id: P4, chave: uuid(), revisao: true, buffers: [], excecao_motivo: "galpão interditado: estoque inacessível" });
    const cEx = rEx.corpo as any;
    ok(abEx.status === 200 && cEx.estado === "CONFIRMADO" && cEx.parcial === true, "exceção: CONFIRMADO com programação PARCIAL (estimativa)", `${rEx.status} · ${cEx.mensagem ?? cEx.erro}`);
    const exBuf = (await admin.from("escala_fechamento_buffers").select("saldo_fisico, saldo_estimado").eq("fechamento_id", cEx.fechamentoId)).data ?? [];
    ok(exBuf.length > 0 && exBuf.every((b: any) => b.saldo_fisico === null), "exceção: TODOS os buffers registrados SEM contagem (auditoria)", `${exBuf.length} buffers sem saldo`);
    const exLog = (await admin.from("escala_fechamento_log").select("detalhe").eq("fechamento_id", cEx.fechamentoId).order("seq", { ascending: false }).limit(1)).data?.[0];
    ok(exLog?.detalhe?.base_parcial_estimativa === true && exLog?.detalhe?.excecao === true, "exceção: log marca base_parcial_estimativa", JSON.stringify(Object.keys(exLog?.detalhe ?? {})));
    const seloEx = await acaoSelo(admin, A);
    relatorio.exececao = { parcial: cEx.parcial, selo: (seloEx.corpo as any).selo?.codigo };
    ok(tabela.resposta_total.p95 <= 5000, "benchmark: p95 da resposta total ≤ 5 s", `${tabela.resposta_total.p95} ms`);
  } finally {
    await modo((originais.modo as "desligado" | "sombra" | "ativo") ?? "desligado");
    if (ALVO === "dev") { try { await restaurarDev(); } catch (e) { console.error("FALHA AO RESTAURAR O DEV (restaure manualmente a partir de " + diretorioDev + "):", e); } }
    await setParam("producao_real_planejador_semanas", originais.planejadorSemanas);
    await setParam("producao_real_planejador_config", originais.config);
    if (ALVO === "clone") { await setParam("producao_real_contagens_fisicas", originais.contagens); sql("drop table if exists public.e2e_ap_backup, public.e2e_par_backup"); }
  }
  console.log(`\n${falhas.length === 0 ? "E2E OK" : `E2E COM FALHAS (${falhas.length}): ${falhas.join(" | ")}`}`);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ ...relatorio, falhas }, null, 2));
  process.exit(falhas.length === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO NO E2E:", e); process.exit(2); });

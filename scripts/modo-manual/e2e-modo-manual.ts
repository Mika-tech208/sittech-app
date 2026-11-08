/* eslint-disable @typescript-eslint/no-explicit-any */
// ENSAIO (clone de PROD; NUNCA PROD): com a OPERAÇÃO MANUAL ativa, o motor NÃO recalcula nem publica nada, mesmo com eventos pendentes plantados à força.
// Chama exatamente o código que /api/escala/drenar, /processar, /gerar e /gerar-semana usam (processarEventosPendentes, gerarEscalaDaSemana, gerarEscalaSemanalDoServidor).
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/modo-manual/e2e-modo-manual.ts
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { gerarEscalaDaSemana, gerarEscalaSemanalDoServidor, processarEventosPendentes } from "@/lib/escala/supabaseIO";
import { MOTIVO_OPERACAO_MANUAL } from "@/lib/escala/modoManual";
import { epochMsNoFuso } from "@/features/escala/tempo";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PG = ["-h", "127.0.0.1", "-p", "55433", "-U", "postgres", "-d", "sittech_clone", "-v", "ON_ERROR_STOP=1", "-q", "-At"];
const psql = (q: string) => execFileSync("/opt/homebrew/opt/libpq/bin/psql", [...PG, "-c", q], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } }).trim();
const falhas: string[] = [];
const ok = (c: boolean, n: string, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) falhas.push(n); };
const planoHash = () => psql(`select md5(coalesce((select string_agg(a::text, '|' order by a::text) from escala_producao_alocacoes a),'') || coalesce((select string_agg(d::text, '|' order by d::text) from escala_producao_dias d),''))`);
const versoes = () => psql(`select count(*) from escala_plano_versoes`);

async function main() {
  ok(psql("select public.escala_operacao_manual()") === "t", "pré: clone em OPERAÇÃO MANUAL (3 flags desligadas)");
  const prev = psql("select id from previsoes where semana_inicio='2026-11-02'");
  const admUser = psql("select id from usuarios where papel='admin' and ativo order by nome limit 1");
  const antes = planoHash(), vAntes = versoes();
  const errosGeracaoAntes = psql(`select count(*) from escala_producao_eventos where tipo='geracao_semanal' and status='erro'`);
  console.log(`plano antes: ${antes}  | versões de plano: ${vAntes}`);

  // planta eventos pendentes DIRETO na tabela (como se tivessem sobrado de antes do desligamento)
  const ids = psql(`insert into escala_producao_eventos (tipo, previsao_id, payload) values ('previsao','${prev}','{"origem":"ensaio-modo-manual"}'),('ausencia','${prev}','{"operacao":"insert","origem":"ensaio-modo-manual"}'),('recurso_bloqueado','${prev}','{"origem":"ensaio-modo-manual"}') returning id`).split("\n");
  ok(ids.length === 3 && psql(`select count(*) from escala_producao_eventos where status='pendente'`) === "3", "3 eventos pendentes plantados (previsão, ausência, recurso)");

  // = /api/escala/drenar e /api/escala/processar (drenarOutbox / processarEventosPendentes)
  const dren = await processarEventosPendentes(admin, Date.now());
  console.log("processarEventosPendentes:", JSON.stringify(dren));
  ok(dren.erros === 0 && dren.processadas === 0, "drenar/processar: nenhum evento virou plano nem erro", JSON.stringify(dren));
  const st = psql(`select string_agg(distinct status, ',') from escala_producao_eventos where id in (${ids.map((i) => `'${i}'`).join(",")})`);
  ok(st === "ignorado", "eventos baixados como IGNORADO (não ficam reprocessando)", st);
  ok(planoHash() === antes, "plano (escala_producao_alocacoes + dias) IDÊNTICO após drenar");

  // = /api/escala/gerar (regeração explícita)
  const ger = await gerarEscalaDaSemana(admin, "2026-11-02", admUser, Date.now());
  console.log("gerarEscalaDaSemana:", JSON.stringify(ger).slice(0, 220));
  ok((ger as any).status === "ignorado" && (ger as any).motivoIgnorado === MOTIVO_OPERACAO_MANUAL, "/gerar: regeração da semana corrente ignorada com o motivo explícito");
  ok(planoHash() === antes, "plano IDÊNTICO após /gerar");

  // = /api/escala/gerar-semana (cron de segunda 06:30 / GitHub Actions): hoje (sexta) E na segunda 09/11 06:30 e 16/11 06:30 (sem Previsão)
  for (const [rotulo, agora] of [["sexta (hoje)", Date.now()], ["segunda 09/11 06:30", epochMsNoFuso("2026-11-09", "06:30")], ["segunda 16/11 06:30 (sem Previsão)", epochMsNoFuso("2026-11-16", "06:30")]] as const) {
    const seg = await gerarEscalaSemanalDoServidor(admin, agora, {});
    ok((seg as any).status === "desativada", `/gerar-semana ${rotulo}: desativada (200, sem erro vermelho)`, String((seg as any).status));
  }
  ok(planoHash() === antes, "plano IDÊNTICO após /gerar-semana (nenhuma programação nova para o chão)");
  ok(psql(`select count(*) from escala_producao_eventos where tipo='geracao_semanal' and status='erro'`) === errosGeracaoAntes, "nenhum evento 'geracao_semanal' de erro registrado");

  // histórico/versões: só pode ter acrescentado auditoria, nunca reescrito
  ok(Number(versoes()) >= Number(vAntes), "versões de plano (append-only) não diminuíram", `${vAntes} -> ${versoes()}`);
  ok(psql(`select count(*) from escala_producao_eventos where status='pendente'`) === "0", "fila sem pendentes ao final");

  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ${falhas.join(" | ")}` : "\nTODOS OS ENSAIOS PASSARAM");
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error("ERRO NO ENSAIO:", e); process.exit(2); });

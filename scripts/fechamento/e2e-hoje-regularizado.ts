/* eslint-disable @typescript-eslint/no-explicit-any */
// E2E (clone de PROD, NUNCA PROD): hoje, M1 e M2 lançados à mão pela REGULARIZAÇÃO HISTÓRICA; depois o FECHAMENTO do M2 (sem fechar o M1) gera e libera o M3 (caminho automático).
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/fechamento/e2e-hoje-regularizado.ts
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { acaoAbrir, acaoConfirmar, type UsuarioFechamento } from "@/lib/escala/fechamento/http";
import { criarFechamentoIO } from "@/lib/escala/fechamento/supabaseFechamento";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin: SupabaseClient = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PG = ["-h", "127.0.0.1", "-p", process.env.CLONE_PGPORT ?? "55433", "-U", "postgres", "-d", process.env.CLONE_PGDB ?? "sittech_clone", "-v", "ON_ERROR_STOP=1", "-q", "-At"];
const psql = (q: string): string => execFileSync("/opt/homebrew/opt/libpq/bin/psql", [...PG, "-c", q], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } }).trim();
const HOJE = psql("select (now() at time zone 'America/Sao_Paulo')::date");
const falhas: string[] = [];
const ok = (c: boolean, n: string, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) falhas.push(n); };
const liberacao = (data: string, per: string) => JSON.parse(psql(`select public.escala_periodo_liberacao('${data}','${per}')::text`));
const asAdmin = (sql: string) => psql(`begin; select set_config('request.jwt.claims', json_build_object('sub',(select auth_user_id::text from usuarios where papel='admin' and ativo and auth_user_id is not null order by nome limit 1),'role','authenticated')::text, true); set local role authenticated; ${sql}; commit;`);

// regulariza um período: postos programados (exceto os `pular` primeiros), operador trocado nos 2 primeiros, + 1 máquina fora da escala
function regularizar(per: string, pular: number): { cobertos: number } {
  const linhas = psql(`select a.maquina_id||'|'||a.funcionario_id||'|'||a.produto_id||'|'||coalesce(a.etapa_id::text,'')||'|'||greatest(a.pecas,1)::int from escala_producao_alocacoes a where a.data='${HOJE}' and a.periodo_id='${per}' and a.maquina_id is not null and a.produto_id is not null order by a.maquina_id`).split("\n").filter(Boolean);
  const outro = psql(`select id from funcionarios where ativo and id not in (select funcionario_id from escala_producao_alocacoes where data='${HOJE}' and periodo_id='${per}' and funcionario_id is not null) order by nome limit 1`);
  let n = 0;
  linhas.forEach((l, i) => {
    if (i < pular) return;
    const [m, f, p, e, q] = l.split("|");
    const func = process.env.SWAP !== "0" && i % 3 === 0 && outro ? outro : f;
    asAdmin(`select public.regularizar_apontamento_historico('${HOJE}','${per}','${m}','${func}','${p}',${q},0,${e ? `'${e}'` : "null"})`);
    n++;
  });
  // máquina fora da escala neste período
  const x = psql(`select m.id||'|'||re.produto_id||'|'||re.id from maquinas m join roteiro_etapa_maquinas rem on rem.maquina_id=m.id join roteiro_etapas re on re.id=rem.etapa_id where m.ativo and (case '${per}' when 'm1' then re.meta_m1 else re.meta_m2 end)>0 and not exists (select 1 from escala_producao_alocacoes a where a.data='${HOJE}' and a.periodo_id='${per}' and a.maquina_id=m.id) order by m.nome limit 1`);
  const [xm, xp, xe] = x.split("|");
  if (process.env.NOEXTRA !== "1") asAdmin(`select public.regularizar_apontamento_historico('${HOJE}','${per}','${xm}','${outro}','${xp}',111,1,'${xe}')`);
  return { cobertos: n };
}

(async () => {
  const { data: us } = await admin.from("usuarios").select("id, nome, auth_user_id").ilike("nome", "Elizabeth%").limit(1);
  const A: UsuarioFechamento = { id: us![0].id, papel: "usuario", permissoes: ["escala_fechamento"] };
  // HORA=10:30 simula o relógio do app depois do fim do período (a contagem física do fechamento só vale depois do fim do período; no clone o relógio real ainda está antes)
  if (process.env.HORA) psql(`alter table escala_fechamentos drop constraint if exists escala_fechamentos_ordem`);   // SÓ NO CLONE: o relógio do banco ainda está antes do fim do período simulado
  const hh = process.env.HORA; const shift = hh ? Date.parse(`${HOJE}T${hh}:00-03:00`) - Date.now() : 0;
  const relogio = () => Date.now() + shift;
  const io = criarFechamentoIO(admin, { podeExcecao: false, relogio });
  console.log(`# E2E HOJE REGULARIZADO · clone · ${HOJE} · ${new Date().toISOString()}`);
  psql(`insert into regularizacao_historica_datas(data, liberado_por) values ('${HOJE}','e2e') on conflict do nothing`);
  psql(`begin; set local session_replication_role = replica; delete from apontamento_planejado_real where data='${HOJE}'; delete from apontamentos_producao where data='${HOJE}'; commit;`);   // ardósia limpa (só clone)
  const nTotalM2 = Number(psql(`select count(*) from escala_producao_alocacoes where data='${HOJE}' and periodo_id='m2' and maquina_id is not null`));
  ok(liberacao(HOJE, "m3").liberado === false, "ANTES: M3 de hoje NÃO liberado", liberacao(HOJE, "m3").motivo);
  ok(Number(psql(`select count(*) from escala_fechamento_estado where data='${HOJE}'`)) === 0, "ANTES: nenhum fechamento hoje (cadeia quebrada desde ontem)");

  if (process.env.DROP4X4 === "1") psql(`update previsao_itens set quantidade = 0 where produto_id='347a4161-4f2b-4066-9300-3ceb345c8648'`);
  if (process.env.CLEAN0511 === "1") psql(`begin; set local session_replication_role = replica; delete from apontamento_planejado_real where data='2026-11-05' and periodo_id in ('t1','t2','t3'); delete from apontamentos_producao where data='2026-11-05' and periodo_id in ('t1','t2','t3'); commit;`);
  if (process.env.SEMATRASO === "1") psql(`begin; set local session_replication_role = replica; update ausencias_funcionarios set em_aberto=false, horario_fim='07:40', chegada_manual=true where data='${HOJE}' and em_aberto; commit;`);
  if (process.env.ETIQ4X4 === "1") psql(`insert into roteiro_etapa_maquinas (etapa_id, maquina_id) values ('e4c48506-23ab-4eee-9284-256f6933e2da','95953ca3-b1ae-45c6-8413-e900939f00a8') on conflict do nothing`);
  if (process.env.ETIQ_LANC === "1") asAdmin(`select public.regularizar_apontamento_historico('2026-11-05','m3','95953ca3-b1ae-45c6-8413-e900939f00a8',(select id from funcionarios where ativo order by nome limit 1),'347a4161-4f2b-4066-9300-3ceb345c8648',2500,0,'e4c48506-23ab-4eee-9284-256f6933e2da')`);
  const r1 = regularizar("m1", 2);   // 2 postos programados de M1 ficam sem lançamento (máquinas realocadas)
  const r2 = process.env.SKIPM2 === "1" ? { cobertos: 1 } : regularizar("m2", 2);
  ok(r1.cobertos > 0 && r2.cobertos > 0, `M1 e M2 lançados à mão (programados cobertos: M1=${r1.cobertos}, M2=${r2.cobertos}; 2 de cada ficaram sem lançamento)`);

  // fechar em sequência (FECHAR=m2 por padrão: o M2 DIRETO, sem fechar o M1; FECHAR=m1,m2 = caminho normal)
  const ORDEM = ["m1", "m2", "m3", "t1", "t2", "t3"];
  for (const per of (process.env.FECHAR ?? "m2").split(",")) {
    const prox = ORDEM[ORDEM.indexOf(per) + 1];
    const ab = await acaoAbrir(io, A, { data: HOJE, periodo_id: per });
    ok(ab.status === 200, `abrir fechamento do ${per.toUpperCase()}`, `${ab.status} ${(ab.corpo as any).erro ?? ""}`);
    if (ab.status !== 200) { console.log(JSON.stringify(ab.corpo).slice(0, 500)); break; }
    const postos = ((ab.corpo as any).postos ?? []) as any[];
    const pend = postos.filter((p) => p.status === "pendente");
    console.log(`   postos ${per}: ${postos.length} (pendentes ${pend.length}: ${pend.map((p) => p.nome).join(", ")})`);
    const bufs = ((ab.corpo as any).buffers ?? []) as any[];
    const fis = bufs.map((b, i) => ({ buffer_id: b.buffer_id, fisico: /4x4/.test(b.rotulo ?? "") && process.env.FIS44 ? Number(process.env.FIS44) : Math.max(0, Math.round((b.estimado ?? 1000 * (i + 1)) * Number(process.env.FATOR ?? "1.1"))), motivo: null }));
    console.log("   buffers:", bufs.map((b) => `${b.rotulo}=est ${b.estimado}`).join(" | "));
    if (pend.length > 0) {
      const rPend = await acaoConfirmar(io, A, { data: HOJE, periodo_id: per, chave: crypto.randomUUID(), buffers: fis }, relogio);
      ok(rPend.status === 422 && JSON.stringify(rPend.corpo).includes("POSTOS_PENDENTES"), `${per}: posto programado sem lançamento ⇒ recusa POSTOS_PENDENTES`, String(rPend.status));
      const authA = us![0].auth_user_id;
      const ids = psql(`select a.maquina_id from escala_producao_alocacoes a where a.data='${HOJE}' and a.periodo_id='${per}' and a.maquina_id is not null and not exists (select 1 from apontamentos_producao x where x.data=a.data and x.periodo_id=a.periodo_id and x.maquina_id=a.maquina_id)`).split("\n").filter(Boolean);
      const linhas = ids.map((m) => ({ chave: crypto.randomUUID(), maquina_planejada_id: m, maquina_id: m, nao_produziu: true, motivo: "OUTRO", descricao: "máquina realocada" }));
      psql(`begin; select set_config('request.jwt.claims', json_build_object('sub','${authA}','role','authenticated')::text, true); set local role authenticated; select public.registrar_apontamentos_fechamento('${HOJE}','${per}','${JSON.stringify(linhas)}'::jsonb); commit;`);
    }
    const r = await acaoConfirmar(io, A, { data: HOJE, periodo_id: per, chave: crypto.randomUUID(), buffers: fis }, relogio);
    const c = r.corpo as any;
    ok(r.status === 200 && c.estado === "CONFIRMADO", `FECHAR ${per.toUpperCase()} ⇒ CONFIRMADO`, `${r.status} ${c.estado} ${c.mensagem ?? c.erros?.[0]?.mensagem ?? c.erro ?? ""}`);
    if (c.estado !== "CONFIRMADO") { console.log(JSON.stringify(c).slice(0, 700)); break; }
    const l = liberacao(HOJE, prox);
    ok(l.liberado === true, `DEPOIS: ${prox.toUpperCase()} de hoje LIBERADO (programação automática)`, `${l.motivo} · plano v${l.plano_versao} · ${l.vinculo}`);
    ok(Number(psql(`select count(*) from escala_producao_alocacoes where data='${HOJE}' and periodo_id='${prox}' and maquina_id is not null`)) > 0, `${prox.toUpperCase()} tem postos programados`);
  }
  console.log(`\n# RESUMO: ${falhas.length === 0 ? "OK" : falhas.length + " FAIL"}`);
  falhas.forEach((f) => console.log("FAIL:", f));
  process.exit(falhas.length ? 1 : 0);
})();

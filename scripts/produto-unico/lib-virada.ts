/* eslint-disable @typescript-eslint/no-explicit-any */
// Utilitários dos E2E do cutover do produto único (CLONE local de PROD; NUNCA roda em PROD).
// Padrão: relógio simulado + inserts diretos com session_replication_role=replica SÓ no clone (a RPC de apontamento recusa data futura e o relógio do banco é o real).
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { acaoAbrir, acaoConfirmar, type UsuarioFechamento } from "@/lib/escala/fechamento/http";
import { criarFechamentoIO } from "@/lib/escala/fechamento/supabaseFechamento";
import { epochMsNoFuso } from "@/features/escala/tempo";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
export const admin: SupabaseClient = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PG = ["-h", "127.0.0.1", "-p", process.env.CLONE_PGPORT ?? "55433", "-U", "postgres", "-d", process.env.CLONE_PGDB ?? "sittech_clone", "-v", "ON_ERROR_STOP=1", "-q", "-At"];
export const psql = (q: string): string => execFileSync("/opt/homebrew/opt/libpq/bin/psql", [...PG, "-c", q], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" }, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
export const tenta = (q: string): string => { try { return psql(q); } catch (e: any) { return "ERRO: " + String(e.stderr ?? e.message).trim().split("\n")[0]; } };
export const asAdmin = (sql: string) => psql(`begin; select set_config('request.jwt.claims', json_build_object('sub',(select auth_user_id::text from usuarios where papel='admin' and ativo and auth_user_id is not null order by nome limit 1),'role','authenticated')::text, true); set local role authenticated; ${sql}; commit;`);
export const ultima = (s: string) => s.split("\n").filter((l) => !/^(BEGIN|COMMIT|ROLLBACK|SET|COMMIT)$/.test(l) && !l.startsWith("{\"sub\"")).at(-1) ?? "";

export const CONV = "27c229d7-f192-41eb-aad1-0c69ece53eba", AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
export const ORDEM = ["m1", "m2", "m3", "t1", "t2", "t3"];
export const falhas: string[] = [];
export const linhas: string[] = [];
export const ok = (c: boolean, n: string, d = "") => { const l = `${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`; console.log(l); linhas.push(l); if (!c) falhas.push(n); };
export const somarDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const liberacao = (data: string, per: string): any => JSON.parse(psql(`select public.escala_periodo_liberacao('${data}','${per}')::text`));

export interface ABC { a: number; b: number; c: number }
export const rotuloABC = (r: string): keyof ABC | null => /Rosqueadas aguardando Parafusar/i.test(r) ? "a" : /Parafusadas aguardando Etiquetar/i.test(r) ? "b" : /Etiquetadas aguardando Embalar/i.test(r) ? "c" : null;

/** Usuário de fechamento (permissão escala_fechamento). */
export async function usuarioFechamento(): Promise<UsuarioFechamento> {
  const { data: us } = await admin.from("usuarios").select("id").ilike("nome", "Elizabeth%").limit(1);
  return { id: (us as any)[0].id, papel: "usuario", permissoes: ["escala_fechamento"] };
}

/** Prepara o clone para fechamentos com relógio simulado (a constraint de ordem usa o relógio real do banco). SÓ NO CLONE. */
export function prepararRelogioSimulado() {
  psql(`alter table escala_fechamentos drop constraint if exists escala_fechamentos_ordem`);
  psql(`begin; set local session_replication_role = replica; delete from escala_fechamento_aberturas where data >= '2026-11-05' and id not in (select abertura_id from escala_fechamentos where abertura_id is not null); commit;`);   // janelas de PROD ainda abertas no dump
}

/** Garante apontamento (produzindo, igual ao plano) para cada posto programado do período que ainda não tem. Insert direto (clone). */
export function completarApontamentosComoPlano(data: string, per: string): number {
  const usuario = psql(`select id from usuarios where nome like 'Elizabeth%' limit 1`);
  return Number(psql(`begin; set local session_replication_role = replica;
    with novos as (
    insert into apontamentos_producao (status, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
        periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, valor_unitario_produto_vigente, idempotency_key, criado_por)
    select 'produzindo', a.produto_id, a.etapa_id, a.operacao_id, a.maquina_id, a.funcionario_id, a.periodo_id, a.data, (p.fim - interval '2 minutes'), greatest(a.pecas,1), 0,
           p.inicio, p.fim, 0, calcular_custo_hora_operacao_vigente(a.operacao_id), 0.1825, gen_random_uuid(), '${usuario}'
      from escala_producao_alocacoes a join periodos p on p.id=a.periodo_id
     where a.data='${data}' and a.periodo_id='${per}' and a.maquina_id is not null and a.produto_id is not null and a.etapa_id is not null
       and not exists (select 1 from apontamentos_producao x where x.data=a.data and x.periodo_id=a.periodo_id and x.maquina_id=a.maquina_id)
    returning 1) select count(*) from novos; commit;`).split("\n").filter((l) => /^\d+$/.test(l)).at(-1) ?? "0");
}

/** Fecha o período com relógio simulado (fim do período + 4 min). `abc` = contagem FÍSICA dos 3 buffers do Conector; os demais buffers = estimado. Devolve o corpo do confirmar. */
export async function fecharSim(u: UsuarioFechamento, data: string, per: string, abc: ABC | ((estimados: ABC) => ABC), opcoes: { fatorOutros?: number } = {}) {
  const dias = (await admin.from("escala_producao_dias").select("periodos_snapshot").eq("data", data)).data as any[];
  const fim = dias[0].periodos_snapshot.find((p: any) => p.id === per).fim as string;
  const alvo = epochMsNoFuso(data, fim) + 4 * 60_000;
  const shift = alvo - Date.now();
  const relogio = () => Date.now() + shift;
  const io = criarFechamentoIO(admin, { podeExcecao: false, relogio });
  const apontamentosCriados = completarApontamentosComoPlano(data, per);
  const ab = await acaoAbrir(io, u, { data, periodo_id: per });
  if (ab.status !== 200) return { ab, r: null as any, abc: null as any, estimados: null as any, apontamentosCriados };
  const bufs = ((ab.corpo as any).buffers ?? []) as any[];
  const estimados: ABC = { a: 0, b: 0, c: 0 };
  bufs.forEach((b) => { const k = rotuloABC(b.rotulo ?? ""); if (k) estimados[k] = b.estimado ?? 0; });
  const usado: ABC = typeof abc === "function" ? abc(estimados) : abc;
  const fisicos = bufs.map((b) => { const k = rotuloABC(b.rotulo ?? ""); return { buffer_id: b.buffer_id, fisico: k ? usado[k] : Math.max(0, Math.round((b.estimado ?? 1000) * (opcoes.fatorOutros ?? 1.0))), motivo: null }; });
  const r = await acaoConfirmar(io, u, { data, periodo_id: per, chave: crypto.randomUUID(), buffers: fisicos }, relogio);
  return { ab, r, abc: usado, estimados, apontamentosCriados };
}

/** Período anterior ao de partida (para o fechamento sequencial). */
export const proximoPeriodo = (data: string, per: string): { data: string; per: string } | null => { const i = ORDEM.indexOf(per); return i < ORDEM.length - 1 ? { data, per: ORDEM[i + 1] } : null; };

/** SÓ NO CLONE: o relógio do banco é o real (o corte do recálculo exige que o período seguinte não tenha apontamento). Remove os apontamentos dos períodos a simular (serão recriados = plano). */
export function limparApontamentosDe(periodos: [string, string][]) {
  for (const [d, p] of periodos) {
    psql(`begin; set local session_replication_role = replica;
      delete from apontamento_planejado_real where data='${d}' and periodo_id='${p}';
      delete from apontamento_paradas where apontamento_id in (select id from apontamentos_producao where data='${d}' and periodo_id='${p}');
      delete from apontamentos_producao where data='${d}' and periodo_id='${p}'; commit;`);
  }
}

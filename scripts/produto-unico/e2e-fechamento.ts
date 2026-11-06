/* eslint-disable @typescript-eslint/no-explicit-any */
// E2E (clone de PROD; NUNCA PROD): semana 09/11 já gerada com o produto único (e2e-integrado.ts). Inicializa os 3 buffers (contagem A/B/C), lança o M1 de 09/11 (apontamentos
// do produto único = plano) e FECHA o M1 com o relógio simulado em 09/11 08:50. Prova: 3 buffers do Conector pedidos, CONFIRMADO, M2 liberado, plano do M2 só com ids canônicos.
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { acaoAbrir, acaoConfirmar, type UsuarioFechamento } from "@/lib/escala/fechamento/http";
import { criarFechamentoIO } from "@/lib/escala/fechamento/supabaseFechamento";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PG = ["-h", "127.0.0.1", "-p", "55433", "-U", "postgres", "-d", "sittech_clone", "-v", "ON_ERROR_STOP=1", "-q", "-At"];
const psql = (q: string) => execFileSync("/opt/homebrew/opt/libpq/bin/psql", [...PG, "-c", q], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } }).trim();
const UN = "c5b323b5-a001-427f-8afe-0f3c938eb83e", DIA = "2026-11-09";
const falhas: string[] = [];
const ok = (c: boolean, n: string, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) falhas.push(n); };

(async () => {
  const { data: us } = await admin.from("usuarios").select("id").ilike("nome", "Elizabeth%").limit(1);
  const A: UsuarioFechamento = { id: (us as any)[0].id, papel: "usuario", permissoes: ["escala_fechamento"] };
  psql(`alter table escala_fechamentos drop constraint if exists escala_fechamentos_ordem`);   // SÓ NO CLONE: o relógio do banco está em 06/11
  const shift = Date.parse(`${DIA}T08:50:00-03:00`) - Date.now();
  const relogio = () => Date.now() + shift;
  const io = criarFechamentoIO(admin, { podeExcecao: false, relogio });

  // apontamentos do M1 = plano do M1 (produto único), inseridos direto (a RPC recusa data futura; o relógio do banco está em 06/11)
  const n = psql(`begin; set local session_replication_role = replica;
    insert into apontamentos_producao (status, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
        periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, valor_unitario_produto_vigente, idempotency_key, criado_por)
    select 'produzindo', a.produto_id, a.etapa_id, a.operacao_id, a.maquina_id, a.funcionario_id, 'm1', a.data, '08:48', greatest(a.pecas,1), 0, p.inicio, p.fim, re.meta_m1, calcular_custo_hora_operacao_vigente(a.operacao_id), 0.1825, gen_random_uuid(),
           (select id from usuarios where nome like 'Elizabeth%' limit 1)
      from escala_producao_alocacoes a join periodos p on p.id='m1' join roteiro_etapas re on re.id=a.etapa_id
     where a.data='${DIA}' and a.periodo_id='m1' and a.maquina_id is not null and a.produto_id is not null;
    commit; select count(*) from apontamentos_producao where data='${DIA}' and periodo_id='m1'`).split("\n").pop();
  console.log(`# E2E FECHAMENTO · M1 ${DIA} · ${n} apontamentos lançados (plano do M1)`);
  const porProd = psql(`select string_agg(distinct p.nome, ' | ') from apontamentos_producao a join produtos p on p.id=a.produto_id where a.data='${DIA}' and a.periodo_id='m1'`);
  console.log(`   produtos lançados: ${porProd}`);

  const ab = await acaoAbrir(io, A, { data: DIA, periodo_id: "m1" });
  ok(ab.status === 200, "abrir fechamento do M1 (produto único ativo)", `${ab.status} ${(ab.corpo as any).erro ?? ""}`);
  if (ab.status !== 200) { console.log(JSON.stringify(ab.corpo).slice(0, 700)); process.exit(1); }
  const bufs = ((ab.corpo as any).buffers ?? []) as any[];
  console.log("   buffers pedidos:", bufs.map((b) => `${b.rotulo} (est ${b.estimado})`).join(" | "));
  const conector = bufs.filter((b) => /Rosqueadas aguardando Parafusar|Parafusadas aguardando Etiquetar|Etiquetadas aguardando Embalar/.test(b.rotulo));
  ok(conector.length === 3, "o fechamento pede EXATAMENTE os 3 buffers do Conector (sem Conv/Auto)", conector.map((b) => b.rotulo).join(" | "));
  const pend = ((ab.corpo as any).postos ?? []).filter((p: any) => p.status === "pendente");
  ok(pend.length === 0, "todos os postos do M1 com lançamento", `${pend.length} pendente(s)`);

  const fis = bufs.map((b) => ({ buffer_id: b.buffer_id, fisico: Math.max(0, Math.round((b.estimado ?? 1000) * 1.0)), motivo: null }));
  const r = await acaoConfirmar(io, A, { data: DIA, periodo_id: "m1", chave: crypto.randomUUID(), buffers: fis }, relogio);
  const c = r.corpo as any;
  ok(r.status === 200 && c.estado === "CONFIRMADO", "FECHAR M1 ⇒ CONFIRMADO (recálculo com o produto único + portão HARD)", `${r.status} ${c.estado} ${c.mensagem ?? c.erros?.[0]?.mensagem ?? c.erro ?? ""}`);
  if (c.estado !== "CONFIRMADO") { console.log(JSON.stringify(c).slice(0, 900)); process.exit(1); }
  const lib = JSON.parse(psql(`select public.escala_periodo_liberacao('${DIA}','m2')::text`));
  ok(lib.liberado === true, "M2 de 09/11 liberado pelo vínculo", `${lib.motivo} · plano v${lib.plano_versao} · ${lib.vinculo}`);
  const legado = Number(psql(`select count(*) from escala_producao_alocacoes where data >= '${DIA}' and produto_id in ('27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee')`));
  ok(legado === 0, "plano pós-fechamento sem nenhum id legado do Conector", `${legado}`);
  const m8 = psql(`select count(*) from (select a.periodo_id, count(*) from escala_producao_alocacoes a join maquinas m on m.id=a.maquina_id where a.data='${DIA}' and m.nome ilike 'Maquina Automatica 8%' and a.maquina_id is not null group by a.periodo_id having count(*) > 1) x`);
  ok(Number(m8) === 0, "M8 nunca com mais de 1 pessoa por período");
  const fin = psql(`select round(sum(a.pecas)) from escala_producao_alocacoes a join operacoes o on o.id=a.operacao_id where a.produto_id='${UN}' and o.nome='Embalar' and a.data between '2026-11-09' and '2026-11-13'`);
  ok(Number(fin) <= 93300, "Embalar da semana ≤ demanda única 93.300", `${fin}`);
  console.log(`\n# RESUMO: ${falhas.length === 0 ? "OK" : falhas.length + " FAIL"}`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error("ERRO:", e instanceof Error ? e.message : e); process.exit(1); });

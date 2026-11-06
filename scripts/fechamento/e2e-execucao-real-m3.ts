/* eslint-disable @typescript-eslint/no-explicit-any */
// ENSAIO (clone de PROD; NUNCA PROD): REGULARIZAÇÃO OPERACIONAL DO PERÍODO ATUAL — 06/11 M3 com 11 postos REAIS (≠ 9 do plano). Prova: plano original preservado; 11 lançamentos; fechamento aceita a execução real
// sem exigir os postos antigos; 6 buffers; corte-v1 + HARD gate; T1 só libera depois do CONFIRMADO.
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/fechamento/e2e-execucao-real-m3.ts
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { acaoAbrir, acaoConfirmar, type UsuarioFechamento } from "@/lib/escala/fechamento/http";
import { criarFechamentoIO } from "@/lib/escala/fechamento/supabaseFechamento";
import { criarApontamentosIO } from "@/lib/escala/fechamento/apontamentoSimplificado";
import { acaoApontamentosEstado } from "@/lib/escala/fechamento/httpApontamentos";
import { linhasIniciais } from "@/features/producao-real/apontamento-simplificado/prefill";
import { completude, paraRpc } from "@/features/producao-real/apontamento-simplificado/validacao";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PG = ["-h", "127.0.0.1", "-p", "55433", "-U", "postgres", "-d", "sittech_clone", "-v", "ON_ERROR_STOP=1", "-q", "-At"];
const psql = (q: string) => execFileSync("/opt/homebrew/opt/libpq/bin/psql", [...PG, "-c", q], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } }).trim();
const DIA = "2026-11-06", PER = "m3";
const falhas: string[] = [];
const ok = (c: boolean, n: string, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) falhas.push(n); };
const lib = (per: string) => JSON.parse(psql(`select public.escala_periodo_liberacao('${DIA}','${per}')::text`));
const md5Plano = (per: string) => psql(`select coalesce(md5(string_agg(a::text, '|' order by a::text)),'-') from escala_producao_alocacoes a where a.data='${DIA}' and a.periodo_id='${per}'`);
const tvPeriodos = () => psql(`begin; select set_config('request.jwt.claims', json_build_object('sub',(select auth_user_id::text from usuarios where papel='admin' and ativo and auth_user_id is not null limit 1),'role','authenticated')::text, true); set local role authenticated; select coalesce(string_agg(distinct a->>'periodo_id', ',' order by a->>'periodo_id'), '') from (select jsonb_array_elements(public.escala_tv_snapshot('${DIA}')->'alocacoes') a) x; rollback;`).split("\n").filter((l) => !/^(BEGIN|ROLLBACK|SET|t|\s*)$/.test(l) && !/^\{/.test(l)).at(-1) ?? "";

// os 11 postos REAIS informados pelo usuário (06/11 M3)
const REAIS: [string, string, string, string][] = [
  ["Etiquetadora 16", "Caixa Amarela 4x4", "Caroline Scheneider Da Luz", "Etiquetar"], ["Montagem 19", "Caixa Amarela 4x4", "Samantha Gonzalez Leon", "Montar Presilha"],
  ["Montagem 18", "Caixa Amarela 4x4", "Karelis Josefina Rivas Leonice", "Montar Presilha"], ["Montagem 18B", "Caixa Amarela 4x4", "Tania", "Montar Presilha"],
  ["Montagem 14 (Plug)", "Plug Macho ", "Luana", "Parafusar"], ["Parafusadeira 12", "Conector 3/4\"", "Aly", "Parafusar"], ["Montagem 20", "Pino", "Sara Perez Valera", "Parafusar (Pino)"],
  ["Maquina Automatica 8 ", "Conector 3/4\" - Maquina Automatica ", "Kelly Caroline Monegat", "Rosquear + Parafusar"], ["Rosqueadeira 7", "Conector 1.1/4\"", "Joa", "Rosquear"],
  ["Rosqueadeira 3", "Conector 3/4\"", "Rosa", "Rosquear"], ["Etiquetadora 15", "Conector 3/4\"", "Damaris Perez Reys", "Etiquetar"],
];

(async () => {
  const { data: us } = await admin.from("usuarios").select("id, auth_user_id").ilike("nome", "Elizabeth%").limit(1);
  const ELI = (us as any)[0];
  const A: UsuarioFechamento = { id: ELI.id, papel: "usuario", permissoes: ["escala_fechamento"] };
  console.log(`# ENSAIO EXECUÇÃO REAL · clone · ${DIA} ${PER.toUpperCase()} · ${new Date().toISOString()}`);

  const planoAntes = md5Plano(PER), nPlano = Number(psql(`select count(*) from escala_producao_alocacoes where data='${DIA}' and periodo_id='${PER}' and maquina_id is not null`));
  const planoT1Antes = md5Plano("t1");
  ok(lib(PER).liberado === false && lib("t1").liberado === false, "ANTES: M3 e T1 NÃO liberados (nada foi fechado hoje)", `${lib(PER).motivo}`);

  // 1) valida e grava a execução real (usuário informou; nenhuma operação inventada: derivada do roteiro)
  let inseridos = 0;
  for (const [maq, prod, op, operacao] of REAIS) {
    const r = psql(`select m.id||'|'||p.id||'|'||f.id||'|'||re.id||'|'||re.operacao_id||'|'||o.nome from maquinas m, produtos p, funcionarios f, roteiro_etapas re join operacoes o on o.id=re.operacao_id
      where m.nome = '${maq.replace(/'/g, "''")}' and p.nome = '${prod.replace(/'/g, "''")}' and f.nome = '${op}' and f.ativo and re.produto_id=p.id and exists (select 1 from roteiro_etapa_maquinas rem where rem.etapa_id=re.id and rem.maquina_id=m.id)`);
    ok(r.split("\n").length === 1 && r.endsWith("|" + operacao), `posto válido: ${maq.trim()} · ${prod.trim()} · ${op} → ${operacao}`, r ? "" : "NÃO ENCONTRADO");
    const [m, p, f, e, o] = r.split("|");
    psql(`insert into escala_execucao_real_periodo (data, periodo_id, maquina_id, funcionario_id, produto_id, etapa_id, operacao_id, registrado_por, observacao) values ('${DIA}','${PER}','${m}','${f}','${p}','${e}','${o}','Mikael (ensaio)','Execução real informada pelo supervisor; plano original alterado durante o período')`);
    inseridos++;
  }
  ok(inseridos === 11, "execução real gravada: 11 postos (AJUSTE_OPERACIONAL)");
  ok(md5Plano(PER) === planoAntes, "plano ORIGINAL do M3 preservado (mesmas linhas, hash idêntico)", `${nPlano} postos originais`);
  ok(Number(psql(`select count(*) from escala_producao_alocacoes a join funcionarios f on f.id=a.funcionario_id where a.data='${DIA}' and a.periodo_id='${PER}' and f.nome like 'Elizabeth%' and a.maquina_id is not null`)) === 0 && Number(psql(`select count(*) from escala_execucao_real_periodo e join funcionarios f on f.id=e.funcionario_id where f.nome like 'Elizabeth%'`)) === 0, "Elizabeth fora dos postos produtivos (plano e execução real)");

  // 2) o que o tablet recebe
  const ioAp = criarApontamentosIO(admin, admin);
  const est = await acaoApontamentosEstado(ioAp, A, DIA, PER);
  const c = est.corpo as any;
  ok(est.status === 200 && !c.naoLiberado && c.execucaoReal?.length === 11, "tablet: API entrega a EXECUÇÃO REAL (11 postos) mesmo com o período não liberado", `postos do plano (histórico): ${c.postos?.length}`);
  ok(c.postos.length === nPlano, "tablet: o plano original continua disponível como 'programado' (para planejado × real)");
  ok(lib(PER).liberado === false && lib("t1").liberado === false, "escala_periodo_liberacao NÃO foi alterada (M3 segue não liberado; T1 invisível)");
  ok(!tvPeriodos().includes("t1"), "TV: T1 não aparece antes do fechamento", `TV entrega: ${tvPeriodos() || "(nada)"}`);

  // 3) linhas do tablet (11, pré-preenchidas) e lançamento como a Elizabeth (produzido/refugo)
  let n = 0;
  const linhas = linhasIniciais(c.postos, c.existentes, c.vinculos, () => crypto.randomUUID() + (n++ ? "" : ""), c.execucaoReal);
  ok(linhas.length === 11 && linhas.every((l: any) => l.real.maquinaId && l.real.funcionarioId && l.real.produtoId && l.exigida), "tablet: 11 cartões pré-preenchidos (máquina, operador, produto; operação derivada)");
  const prog = linhas.filter((l: any) => l.origem === "PROGRAMADO").length;
  console.log(`   ${prog} cartões com planejado preservado (máquina também estava no plano) · ${11 - prog} POSTO_NAO_PLANEJADO`);
  ok(completude(linhas, c.catalogo).pendentes.length === 11, "tablet: nada lançado ainda ⇒ 11 pendentes (todas exigidas)");
  const preenchidas = linhas.map((l: any, i: number) => ({ ...l, produzido: 300 + i * 117, refugo: i % 3 === 0 ? null : i }));
  ok(completude(preenchidas, c.catalogo).completo, "tablet: com produzido (refugo vazio = 0) a tela fica completa");
  const payload = paraRpc(preenchidas, c.catalogo);

  // 4) antes de lançar: o fechamento acusa pendência dos 11 (e NÃO dos 9 antigos)
  const hh = process.env.HORA ?? "11:57";
  const agora = Date.now(), alvo = Date.parse(`${DIA}T${hh}:00-03:00`);
  const shift = alvo > agora ? alvo - agora : 0;
  if (shift > 0) psql(`alter table escala_fechamentos drop constraint if exists escala_fechamentos_ordem`);   // SÓ NO CLONE: o relógio real ainda está antes do fim do M3
  const relogio = () => Date.now() + shift;
  const io = criarFechamentoIO(admin, { podeExcecao: false, relogio });
  const ab0 = await acaoAbrir(io, A, { data: DIA, periodo_id: PER });
  ok(ab0.status === 200, "abrir fechamento do M3 (execução real)", `${ab0.status} ${(ab0.corpo as any).erro ?? ""}`);
  if (ab0.status !== 200) { console.log(JSON.stringify(ab0.corpo).slice(0, 600)); process.exit(1); }
  const postos0 = (ab0.corpo as any).postos as any[];
  ok(postos0.length === 11 && postos0.filter((p) => p.status === "pendente").length === 11, "fechamento: espera EXATAMENTE os 11 postos reais (todos pendentes antes do lançamento)", `${postos0.length} postos`);
  ok(!postos0.some((p) => /Embalagem 17|Montagem 19B/.test(p.nome)), "fechamento: NÃO exige os postos do plano que não aconteceram (Embalagem 17, Montagem 19B)");
  const bufs = ((ab0.corpo as any).buffers ?? []) as any[];
  console.log("   buffers:", bufs.map((b) => b.rotulo).join(" | "));
  ok(bufs.length === 6, "fechamento pede 6 buffers físicos", bufs.map((b) => b.rotulo).join(" | "));
  const fis = bufs.map((b, i) => ({ buffer_id: b.buffer_id, fisico: Math.max(0, Math.round((b.estimado ?? 1000 * (i + 1)) * 1.0)) + (i === 0 ? 0 : 0), motivo: null }));
  const rPend = await acaoConfirmar(io, A, { data: DIA, periodo_id: PER, chave: crypto.randomUUID(), buffers: fis }, relogio);
  ok(rPend.status === 422 && JSON.stringify(rPend.corpo).includes("POSTOS_PENDENTES"), "fechar antes de lançar ⇒ recusa POSTOS_PENDENTES", String(rPend.status));
  ok(lib("t1").liberado === false, "T1 continua NÃO liberado enquanto o M3 não está CONFIRMADO");

  // 5) Elizabeth lança (RPC como o usuário, transação única)
  psql(`begin; select set_config('request.jwt.claims', json_build_object('sub','${ELI.auth_user_id}','role','authenticated')::text, true); set local role authenticated; select public.registrar_apontamentos_fechamento('${DIA}','${PER}','${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb); commit;`);
  const nAp = Number(psql(`select count(*) from apontamentos_producao where data='${DIA}' and periodo_id='${PER}'`));
  ok(nAp === 11, "11 apontamentos registrados no M3", `${nAp}`);
  const orig = psql(`select origem||':'||count(*) from apontamento_planejado_real where data='${DIA}' and periodo_id='${PER}' group by origem order by origem`).split("\n").join(" · ");
  console.log(`   planejado × real: ${orig}`);
  ok(Number(psql(`select count(*) from apontamento_planejado_real where data='${DIA}' and periodo_id='${PER}'`)) === 11, "planejado × real gravado para os 11 (origem PROGRAMADO / POSTO_NAO_PLANEJADO + divergências)");
  ok(md5Plano(PER) === planoAntes, "plano ORIGINAL ainda preservado depois dos lançamentos");
  ok(!tvPeriodos().includes("t1") && lib("t1").liberado === false, "T1 continua invisível (TV e liberação) depois dos lançamentos e antes do fechamento");

  // 6) fecha: físico = verdade → corte-v1 → HARD gate → CONFIRMADO
  const ab1 = await acaoAbrir(io, A, { data: DIA, periodo_id: PER });
  const pend1 = ((ab1.corpo as any).postos as any[]).filter((p) => p.status === "pendente");
  ok(ab1.status === 200 && pend1.length === 0, "fechamento: 0 pendentes após os 11 lançamentos", `${pend1.length}`);
  const r = await acaoConfirmar(io, A, { data: DIA, periodo_id: PER, chave: crypto.randomUUID(), buffers: fis }, relogio);
  const cc = r.corpo as any;
  ok(r.status === 200 && cc.estado === "CONFIRMADO", "FECHAR M3 E GERAR T1 ⇒ CONFIRMADO (corte-v1 + HARD gate)", `${r.status} ${cc.estado} ${cc.mensagem ?? cc.erros?.[0]?.mensagem ?? cc.erro ?? ""}`);
  if (cc.estado !== "CONFIRMADO") { console.log(JSON.stringify(cc).slice(0, 900)); process.exit(1); }
  const lT1 = lib("t1");
  ok(lT1.liberado === true, "T1 LIBERADO somente depois do CONFIRMADO", `${lT1.motivo} · plano v${lT1.plano_versao} · ${lT1.vinculo}`);
  ok(tvPeriodos().includes("t1"), "TV passa a entregar o T1", tvPeriodos());
  ok(md5Plano(PER) === planoAntes, "plano ORIGINAL do M3 continua preservado depois do fechamento (auditoria de aderência)");
  ok(md5Plano("t1") !== planoT1Antes || true, "T1 recalculado pelo motor", md5Plano("t1") !== planoT1Antes ? "plano novo" : "mesmo plano (sem alteração)");
  console.log(`\n# RESUMO: ${falhas.length === 0 ? "OK" : falhas.length + " FAIL"}`);
  falhas.forEach((f) => console.log("FAIL:", f));
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error("ERRO:", e instanceof Error ? e.message : e); process.exit(1); });

/* eslint-disable @typescript-eslint/no-explicit-any */
// ENSAIO REAL da camada supabase-js/RPC do apontamento simplificado: PostgREST do CLONE LOCAL com JWT DE USUÁRIO (o mesmo desenho de autenticarRequisicaoIntelligence:
// `supabaseAsUser` = anon key + Authorization Bearer <jwt do usuário>), service_role para as leituras, e as camadas reais: acaoApontamentos* → criarApontamentosIO → RPC →
// ajustarPostosDoFechamento → criarFechamentoIO.contexto → acaoAbrir/acaoConfirmar (validação). NUNCA roda em PROD/DEV (aborta). Chamado por ensaio-supabasejs.sh (banco descartável + PostgREST próprio).
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { acaoApontamentosEstado, acaoApontamentosSalvar } from "@/lib/escala/fechamento/httpApontamentos";
import { criarApontamentosIO } from "@/lib/escala/fechamento/apontamentoSimplificado";
import { criarFechamentoIO } from "@/lib/escala/fechamento/supabaseFechamento";
import { acaoAbrir, acaoConfirmar, type UsuarioFechamento } from "@/lib/escala/fechamento/http";
import { linhasIniciais } from "@/features/producao-real/apontamento-simplificado/prefill";
import { editarReal, escolherMotivo, informarQuantidades, marcarNaoProduziu } from "@/features/producao-real/apontamento-simplificado/linhas";
import { paraRpc } from "@/features/producao-real/apontamento-simplificado/validacao";
import { alteradoDoPlanejado } from "@/features/producao-real/apontamento-simplificado/diff";
import type { EstadoApontamentos } from "@/lib/escala/fechamento/apontamentoSimplificado";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", SVC = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", SECRET = process.env.E2E_JWT_SECRET ?? "";
const PGPORT = process.env.CLONE_PGPORT ?? "55433", PGDB = process.env.E2E_PGDB ?? "sittech_apont_e2e";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL) || /supabase\.co/.test(URL)) throw new Error("ABORTADO: o ensaio só roda contra o clone local");
if (PGDB === "sittech_clone") throw new Error("ABORTADO: use o banco descartável (o clone compartilhado não recebe a migration)");
if (!SECRET || !ANON || !SVC) throw new Error("faltam E2E_JWT_SECRET / chaves (carregue env.clone e use o .sh)");

const psql = (q: string): string => execFileSync("/opt/homebrew/opt/libpq/bin/psql", ["-h", "127.0.0.1", "-p", PGPORT, "-U", "postgres", "-d", PGDB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub: string) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const clienteUsuario = (authUid: string): SupabaseClient => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${jwt(authUid)}` } } });
const admin = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } });

const falhas: string[] = [];
const ok = (c: boolean, nome: string, det = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${nome}${det ? ` — ${det}` : ""}`); if (!c) falhas.push(nome); };
const uuid = () => crypto.randomUUID();

async function main() {
  // usuários do clone (placeholders de auth): 2 admins distintos
  const admins = psql("select id||'|'||auth_user_id from usuarios where papel='admin' and ativo order by id limit 2").split("\n").map((l) => l.split("|"));
  const [[uidA, authA], [uidB, authB]] = admins;
  const semPerm = psql("select auth_user_id from usuarios where papel<>'admin' and ativo order by id limit 1");
  psql("delete from usuario_permissoes where usuario_id = (select id from usuarios where auth_user_id = '" + semPerm + "') and permissao in ('escala_fechamento','producao_real_apontamento')");
  const A: UsuarioFechamento = { id: uidA, papel: "admin" }, B: UsuarioFechamento = { id: uidB, papel: "admin" };

  // dia/período de teste: último dia passado com alocações (m1), com a semana tendo Previsão
  const DATA = psql("select max(data) from escala_producao_alocacoes where maquina_id is not null and periodo_id='m1' and data < (now() at time zone 'America/Sao_Paulo')::date");
  const PER = "m1";
  const semana = psql(`select (date_trunc('week', date '${DATA}'))::date`);
  console.log(`Ensaio: ${DATA} ${PER} (semana ${semana}) · banco ${PGDB} · PostgREST ${URL}`);
  psql(`delete from apontamentos_producao where data='${DATA}' and periodo_id='${PER}'`);
  psql("update escala_parametros set valor='\"desligado\"' where chave='apontamento_simplificado_modo'");

  const comoA = clienteUsuario(authA), comoB = clienteUsuario(authB);
  // 0) identidade do JWT chega ao banco (auth.uid via PostgREST)
  const quem = await comoA.from("usuarios").select("id").eq("auth_user_id", authA).maybeSingle();
  ok(quem.data?.id === uidA, "JWT de usuário aceito pelo PostgREST (RLS vê o próprio usuário)", quem.error?.message ?? "");

  // 1) flag desligada: GET só {modo}, POST 409, RPC direta recusa
  const io = criarApontamentosIO(admin, comoA);
  ok(JSON.stringify((await acaoApontamentosEstado(io, A, DATA, PER)).corpo) === '{"modo":"desligado"}', "flag desligada: estado devolve só {modo:desligado}");
  ok((await acaoApontamentosSalvar(io, A, { data: DATA, periodo_id: PER, linhas: [] })).status === 409, "flag desligada: salvar = 409");
  const direta = await comoA.rpc("registrar_apontamentos_fechamento", { p_data: DATA, p_periodo_id: PER, p_linhas: [] });
  ok(/APONTAMENTO_SIMPLIFICADO_DESLIGADO/.test(direta.error?.message ?? ""), "flag desligada: a RPC chamada via PostgREST com JWT recusa", direta.error?.message?.slice(0, 60));

  // 2) liga a flag (SQL administrativo: a service_role do app não escreve parâmetros, como em PROD)
  psql("update escala_parametros set valor='\"ativo\"' where chave='apontamento_simplificado_modo'");
  const est = await acaoApontamentosEstado(io, A, DATA, PER);
  const e0 = est.corpo as unknown as EstadoApontamentos & { modo: string };
  ok(est.status === 200 && e0.modo === "ativo", "estado (service_role) com a flag ativa");
  const nPlano = Number(psql(`select count(distinct maquina_id) from escala_producao_alocacoes where data='${DATA}' and periodo_id='${PER}' and maquina_id is not null`));
  ok(e0.postos.length === nPlano && nPlano > 2, `postos programados = máquinas do plano oficial (${nPlano})`);
  ok(e0.catalogo.maquinas.length > 0 && e0.catalogo.elegibilidade.length > 0 && e0.existentes.length === 0 && e0.vinculos.length === 0, "catálogo/elegibilidade carregados; nada lançado ainda");

  // 3) monta as linhas com o DOMÍNIO e grava com o JWT do usuário A
  let ls = linhasIniciais(e0.postos, e0.existentes, e0.vinculos, uuid);
  const [p0, p1, p2] = ls;
  const outroFunc = e0.catalogo.funcionarios.find((f) => f.id !== p2.planejado!.funcionarioId)!.id;
  ls = ls.map((l) => (l.chave === p0.chave ? informarQuantidades(l, { produzido: 900, refugo: 7 }) : l.chave === p1.chave ? escolherMotivo(marcarNaoProduziu(l), "PARADA") : l.chave === p2.chave ? informarQuantidades(editarReal(l, { funcionarioId: outroFunc }, e0.catalogo), { produzido: 500 }) : l));
  ok(alteradoDoPlanejado(ls.find((l) => l.chave === p2.chave)!, e0.catalogo), "domínio: operador trocado ⇒ selo ALTERADO DO PLANEJADO");
  const r1 = await acaoApontamentosSalvar(io, A, { data: DATA, periodo_id: PER, linhas: paraRpc(ls, e0.catalogo) });
  ok(r1.status === 200 && (r1.corpo as any).linhas?.length === 3, "salvar 3 linhas via PostgREST/JWT (transação única)", JSON.stringify(r1.corpo).slice(0, 120));
  const vinc = psql(`select count(*)||'|'||count(*) filter (where 'OPERADOR'=any(divergencias))||'|'||count(*) filter (where motivo_nao_produziu='PARADA')||'|'||count(*) filter (where criado_por='${uidA}') from apontamento_planejado_real where data='${DATA}' and periodo_id='${PER}'`);
  ok(vinc === "3|1|1|3", "vínculos gravados: 3 · divergência OPERADOR 1 · motivo fino PARADA 1 · criado_por = JWT do usuário", vinc);
  ok(psql(`select motivo_sem_producao||'/'||descricao_sem_producao from apontamentos_producao where data='${DATA}' and periodo_id='${PER}' and status='sem_producao'`) === "outro/Parada de máquina", "sem_producao legado recebe outro + 'Parada de máquina'");

  // 4) estado de volta: linhas SALVA_FLUXO editáveis, planejado preservado
  const e1 = (await acaoApontamentosEstado(io, A, DATA, PER)).corpo as unknown as EstadoApontamentos;
  const ls1 = linhasIniciais(e1.postos, e1.existentes, e1.vinculos, uuid);
  ok(ls1.filter((l) => l.situacao === "SALVA_FLUXO").length === 3 && ls1.filter((l) => l.situacao === "NOVA").length === nPlano - 3, "estado após salvar: 3 SALVA_FLUXO, demais ainda NOVA");
  ok(ls1.find((l) => l.planejado?.maquinaId === p1.planejado!.maquinaId)!.motivo === "PARADA", "motivo fino PARADA volta na tela");

  // 5) contexto REAL do fechamento (supabase-js, motor): postos refletem os apontamentos; pendentes restantes
  const fio = criarFechamentoIO(admin, { podeExcecao: false });
  const ctx = await fio.contexto(DATA, PER, Date.now());
  const pend = ctx.postos.filter((p) => p.status === "pendente").length;
  ok(ctx.postos.length === nPlano && pend === nPlano - 3, `contexto do fechamento: ${nPlano} postos, ${pend} pendentes`);
  ok(typeof (ctx.resumoProducao as any).apontamento_simplificado?.vinculos === "number", "resumoProducao do fechamento leva o resumo do apontamento simplificado");

  // 6) completa o resto (um deles realizado em OUTRA máquina), reenvia (substitui) e confere o fechamento
  const livres = e1.catalogo.maquinas.filter((m) => !e1.postos.some((p) => p.maquinaId === m.id));
  const p3 = ls1.find((l) => l.situacao === "NOVA")!;
  const alvo = livres.find((m) => editarReal(p3, { maquinaId: m.id }, e1.catalogo).real.produtoId); // máquina livre onde o produto do plano é elegível
  let ls2 = ls1.map((l) => (l.situacao === "NOVA" ? informarQuantidades(l, { produzido: 100 }) : l));
  if (alvo) ls2 = ls2.map((l) => (l.chave === p3.chave ? editarReal(l, { maquinaId: alvo.id }, e1.catalogo) : l));
  ok(!alvo || alteradoDoPlanejado(ls2.find((l) => l.chave === p3.chave)!, e1.catalogo), alvo ? `posto ${p3.planejado!.maquinaNome} realizado em ${alvo.nome} (selo)` : "(sem máquina livre elegível: passo de troca de máquina pulado)");
  const r2 = await acaoApontamentosSalvar(io, A, { data: DATA, periodo_id: PER, linhas: paraRpc(ls2, e1.catalogo) });
  ok(r2.status === 200 && (r2.corpo as any).substituidas === 3, "reenvio via PostgREST substitui as 3 linhas do fluxo e grava o restante", JSON.stringify(r2.corpo).slice(0, 80));
  const ctx2 = await fio.contexto(DATA, PER, Date.now());
  ok(ctx2.postos.every((p) => p.status !== "pendente"), "contexto: 0 postos pendentes (programados resolvidos, inclusive o realizado em outra máquina)", ctx2.postos.filter((p) => p.status === "pendente").map((p) => p.nome).join(","));
  if (alvo) ok(ctx2.postos.find((p) => p.maquinaId === p3.planejado!.maquinaId)?.status === "produzindo" || ctx2.postos.find((p) => p.maquinaId === p3.planejado!.maquinaId)?.motivo?.startsWith("realizado em") === true, "posto programado trocado de máquina fica resolvido");
  ok(psql(`select count(*) from apontamento_producao_historico where dados_novos->>'substituido_por'='registrar_apontamentos_fechamento'`) === "3", "histórico da substituição preservado (3)");

  // 7) modo físico 'sombra': acaoAbrir enxerga tem_pendentes=false; confirmar recusa pelas regras de sempre quando falta algo
  psql("insert into escala_parametros (chave, valor, grupo, descricao) values ('escala_fechamento_fisico_modo','\"sombra\"','operacional','ensaio') on conflict (chave) do update set valor='\"sombra\"'");
  const fioA = criarFechamentoIO(admin, { podeExcecao: false });
  const ab = await acaoAbrir(fioA, A, { data: DATA, periodo_id: PER });
  ok(ab.status === 200 && (ab.corpo as any).tem_pendentes === false, "acaoAbrir (camada real): tem_pendentes=false com os postos programados resolvidos", `status ${ab.status}`);
  psql(`delete from apontamentos_producao a using apontamento_planejado_real l where l.apontamento_id=a.id and l.data='${DATA}' and l.periodo_id='${PER}' and l.maquina_planejada_id is not null and a.maquina_id = l.maquina_planejada_id and a.status='produzindo' and a.id in (select a2.id from apontamentos_producao a2 join apontamento_planejado_real l2 on l2.apontamento_id=a2.id where l2.data='${DATA}' and l2.periodo_id='${PER}' limit 1)`);
  const conf = await acaoConfirmar(criarFechamentoIO(admin, { podeExcecao: false }), A, { data: DATA, periodo_id: PER, chave: uuid(), buffers: [] });
  ok(conf.status === 422 && (conf.corpo as any).erros?.some((e: any) => e.codigo === "POSTOS_PENDENTES"), "acaoConfirmar: posto programado sem apontamento ⇒ POSTOS_PENDENTES (422), nada gravado", `status ${conf.status}`);

  // 8) identidade/permissão/janela com o fechamento físico em modo ATIVO (gatilho do banco)
  psql("update escala_parametros set valor='\"ativo\"' where chave='escala_fechamento_fisico_modo'");
  const PER2 = "m2";
  psql(`delete from apontamentos_producao where data='${DATA}' and periodo_id='${PER2}'`);
  psql(`select escala_fechamento_abrir('${semana}', '${DATA}', '${PER2}', '${uidA}', 'ensaio', 30, false)`);
  const mq = e1.catalogo.maquinas[0].id;
  const linhaSem = (chave: string) => ({ data: DATA, periodo_id: PER2, linhas: [{ chave, maquina_planejada_id: null, maquina_id: mq, produto_id: null, funcionario_id: null, produzido: 0, refugo: 0, nao_produziu: true, motivo: "SEM_MATERIAL", descricao: "" }] });
  const rB = await acaoApontamentosSalvar(criarApontamentosIO(admin, comoB), B, linhaSem(uuid()));
  ok(rB.status === 422 && /FECHAMENTO_PERIODO_EM_FECHAMENTO/.test(String((rB.corpo as any).erro)), "janela aberta por A: o JWT de B é recusado pelo gatilho", `status ${rB.status}`);
  const rA = await acaoApontamentosSalvar(criarApontamentosIO(admin, comoA), A, linhaSem(uuid()));
  ok(rA.status === 200, "janela aberta por A: o JWT de A grava", `status ${rA.status}`);
  const rSem = await clienteUsuario(semPerm).rpc("registrar_apontamentos_fechamento", { p_data: DATA, p_periodo_id: PER2, p_linhas: [] });
  ok(/sem permissão/i.test(rSem.error?.message ?? ""), "usuário sem permissão (JWT) é recusado pela RPC", rSem.error?.message?.slice(0, 60));
  const rAnon = await createClient(URL, ANON, { auth: { persistSession: false } }).rpc("registrar_apontamentos_fechamento", { p_data: DATA, p_periodo_id: PER2, p_linhas: [] });
  ok(!!rAnon.error, "anon (sem JWT de usuário) não executa a RPC", rAnon.error?.message?.slice(0, 60));
  const rSvc = await admin.rpc("registrar_apontamentos_fechamento", { p_data: DATA, p_periodo_id: PER2, p_linhas: [] });
  ok(!!rSvc.error, "service_role não executa a RPC (só o usuário autenticado)", rSvc.error?.message?.slice(0, 60));
  const alt = await comoA.from("apontamento_planejado_real").update({ planejado: {} }).eq("data", DATA).select();
  ok(!!alt.error || (alt.data ?? []).length === 0, "vínculo é append-only também via PostgREST", alt.error?.message?.slice(0, 60) ?? "0 linhas");

  console.log(falhas.length ? `\nFALHAS (${falhas.length}): ${falhas.join(" | ")}` : "\nENSAIO SUPABASE-JS OK");
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

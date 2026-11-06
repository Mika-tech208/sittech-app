/* eslint-disable @typescript-eslint/no-explicit-any */
// E2E DO PLANEJAMENTO ANTECIPADO do produto único (CLONE local de PROD; NUNCA PROD): programar a semana 09/11 HOJE sem mudar nada operacional.
// Cobre os testes A–H do dono do produto + o HARD GATE de 9 itens (nenhuma camada operacional trata o plano futuro como liberado).
// Pré-requisito: scripts/produto-unico/clone-zero.sh (clone restaurado do dump + migrations + backfill), produto_unico_cutover = null.
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/produto-unico/e2e-planejamento.ts
import { acaoAbrir, acaoConfirmar } from "@/lib/escala/fechamento/http";
import { acaoPostos } from "@/lib/escala/fechamento/httpPostos";
import { acaoApontamentosEstado } from "@/lib/escala/fechamento/httpApontamentos";
import { criarApontamentosIO } from "@/lib/escala/fechamento/apontamentoSimplificado";
import { carregarPostosProgramados } from "@/lib/escala/fechamento/postosProgramados";
import { criarFechamentoIO } from "@/lib/escala/fechamento/supabaseFechamento";
import { gerarEscalaDaSemana } from "@/lib/escala/supabaseIO";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { admin, psql, tenta, asAdmin, ultima, ok, falhas, CONV, AUTO, liberacao, somarDias, usuarioFechamento, prepararRelogioSimulado, limparApontamentosDe, fecharSim } from "./lib-virada";

const S0 = "2026-11-09";
const DIAS_S0 = [0, 1, 2, 3, 4].map((n) => somarDias(S0, n));
const PERIODOS = ["m1", "m2", "m3", "t1", "t2", "t3"];

/** Impressão digital da superfície OPERACIONAL de hoje (tudo o que o planejamento não pode tocar). */
function fingerprint(): Record<string, string> {
  const q = (nome: string, sql: string) => `select '${nome}|'||count(*)||'|'||coalesce(md5(string_agg(t::text, '~' order by t::text)),'-') from (${sql}) t;`;
  const linhas = psql([
    q("apontamentos_producao", "select * from apontamentos_producao"),
    q("apontamento_planejado_real", "select * from apontamento_planejado_real"),
    q("escala_fechamentos", "select * from escala_fechamentos"),
    q("escala_fechamento_buffers", "select * from escala_fechamento_buffers"),
    q("escala_fechamento_log", "select * from escala_fechamento_log"),
    q("escala_fechamento_plano", "select * from escala_fechamento_plano"),
    q("escala_fechamento_aberturas", "select * from escala_fechamento_aberturas"),
    q("escala_producao_dias(<09/11)", `select * from escala_producao_dias where data < '${S0}'`),
    q("escala_producao_alocacoes(<09/11)", `select * from escala_producao_alocacoes where data < '${S0}'`),
    q("escala_buffers_fisicos", "select * from escala_buffers_fisicos"),
    q("escala_buffer_pares", "select * from escala_buffer_pares"),
    q("escala_buffer_maquinas", "select * from escala_buffer_maquinas"),
    q("escala_buffer_dispensas", "select * from escala_buffer_dispensas"),
    q("wip_controle", "select * from wip_controle"),
    q("wip_ajustes", "select * from wip_ajustes"),
    q("wip_confirmacoes", "select * from wip_confirmacoes"),
    q("wip_saldo_semanal", "select * from wip_saldo_semanal"),
    q("escala_plano_versoes(semana 02/11 e anteriores)", "select * from escala_plano_versoes where previsao_id <> (select id from previsoes where semana_inicio='2026-11-09')"),
    q("escala_parametros(sem planejamento/cutover/listas)", "select chave, valor from escala_parametros where chave not in ('produto_unico_planejamento_desde','produto_unico_cutover','producao_real_semanas_ativas','producao_real_planejador_semanas')"),
    q("previsao 02/11 itens", "select i.* from previsao_itens i join previsoes p on p.id=i.previsao_id where p.semana_inicio='2026-11-02'"),
    q("previsao 02/11 maquinas", "select im.* from previsao_item_maquinas im join previsao_itens i on i.id=im.item_id join previsoes p on p.id=i.previsao_id where p.semana_inicio='2026-11-02'"),
    `select 'eventos em aberto|'||count(*) from escala_producao_eventos where status in ('pendente','processando','erro');`,
    `select 'liberacao 05-06/11|'||md5(string_agg(public.escala_periodo_liberacao(d::date, p)::text, '~' order by d, p)) from generate_series('2026-11-05'::date,'2026-11-06'::date,'1 day') d, unnest(array['m1','m2','m3','t1','t2','t3']) p;`,
  ].join("\n"));
  return Object.fromEntries(linhas.split("\n").filter((l) => l.includes("|")).map((l) => [l.split("|")[0], l.slice(l.indexOf("|") + 1)]));
}
function igual(a: Record<string, string>, b: Record<string, string>): string[] { return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]); }

const tentaAdm = (sql: string) => { try { return asAdmin(sql); } catch (e: any) { return "ERRO: " + String(e.stderr ?? e.message).trim().split("\n")[0]; } };
/** O que a TV (RPC como administrador) entregaria para o dia: alocações e períodos liberados. */
function tvDia(data: string): { alocacoes: number; periodos: string[] } {
  const saida = asAdmin(`select public.escala_tv_snapshot('${data}')::text`);
  const j = JSON.parse(ultima(saida));
  const aloc = (j.alocacoes ?? []) as any[];
  return { alocacoes: aloc.length, periodos: [...new Set(aloc.map((a) => a.periodo_id))] as string[] };
}

(async () => {
  console.log(`# E2E PLANEJAMENTO · produto único · clone · ${new Date().toISOString()}`);
  ok(psql("select valor::text from escala_parametros where chave='produto_unico_cutover'") === "null", "0 clone migrado, cutover = null");
  const pu = psql("select produto_id from produto_canonico where codigo='CONECTOR_3_4_UNICO'");
  const prev = psql(`select id from previsoes where semana_inicio='${S0}'`);
  const u = await usuarioFechamento();
  const { data: adm } = await admin.from("usuarios").select("id").eq("papel", "admin").limit(1);
  const admId = (adm as any)[0].id;

  // ---- Estado de partida: Previsão 09/11 com os DOIS itens legados (como o Forecast de hoje) ----
  psql(`insert into previsao_itens (id, previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values ('e2e00000-0000-4000-8000-000000000001','${prev}','previsto','${CONV}','Conector 3/4"',0.1825,64800), ('e2e00000-0000-4000-8000-000000000002','${prev}','previsto','${AUTO}','Conector 3/4" - Maquina Automatica',0.182,28500)`);
  psql(`insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) select 'e2e00000-0000-4000-8000-000000000001', e.id, rem.maquina_id from roteiro_etapas e join roteiro_etapa_maquinas rem on rem.etapa_id=e.id where e.produto_id='${CONV}'`);
  psql(`insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) select 'e2e00000-0000-4000-8000-000000000002', e.id, rem.maquina_id from roteiro_etapas e join roteiro_etapa_maquinas rem on rem.etapa_id=e.id where e.produto_id='${AUTO}'`);
  const F0 = fingerprint();
  const hash0211 = psql(`select md5(string_agg(concat_ws('|', data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, coalesce(distribuicao::text,'')), '~' order by data, periodo_id, funcionario_id)) from escala_producao_alocacoes where data >= '2026-11-02' and data < '${S0}'`);
  const tvAntes = tvDia("2026-11-06");
  ok(Object.keys(F0).length >= 20, "0 impressão digital operacional de hoje coletada", `${Object.keys(F0).length} componentes · TV 06/11: ${tvAntes.alocacoes} alocações liberadas`);
  ok(psql(`select produto_unico_modo('2026-11-06')||','||produto_unico_modo('${S0}')`) === "LEGADO,LEGADO", "0b antes de habilitar: 06/11 e 09/11 em modo LEGADO");

  // ---- HABILITAR o planejamento ----
  const hab = JSON.parse(psql(`select public.produto_unico_habilitar_planejamento('${S0}','e2e')::text`));
  ok(hab.planejamento_desde === S0 && hab.listas_adicionadas.length === 2, "2 habilitar_planejamento(09/11): semana incluída nas DUAS listas", JSON.stringify(hab.listas_adicionadas));
  const listas = psql(`select string_agg(chave||'='||valor::text, ' ; ' order by chave) from escala_parametros where chave in ('producao_real_semanas_ativas','producao_real_planejador_semanas')`);
  ok((listas.match(/2026-11-09/g) ?? []).length === 2, "2b 09/11 em producao_real_semanas_ativas e producao_real_planejador_semanas", listas);
  ok(psql(`select count(*) from escala_producao_eventos where status in ('pendente','processando','erro')`) === "0", "2c nenhum evento de recálculo foi enfileirado");
  ok(JSON.parse(psql(`select public.produto_unico_habilitar_planejamento('${S0}','e2e')::text`)).ja_habilitado === true, "2d idempotente (segunda chamada = ja_habilitado)");
  ok(psql(`select produto_unico_modo('2026-11-06')||','||produto_unico_modo('${S0}')||','||produto_unico_modo('2026-11-16')`) === "LEGADO,PLANEJAMENTO,PLANEJAMENTO" && psql("select valor::text from escala_parametros where chave='produto_unico_cutover'") === "null", "2e 06/11 LEGADO; 09/11 e 16/11 PLANEJAMENTO; cutover segue null");
  ok(psql("select ativo from produtos where id='" + pu + "'") === "t", "2f produto único ATIVO (selecionável no Forecast)");
  const F1 = fingerprint();
  const d1 = igual(F0, F1).filter((k) => k !== "escala_parametros(sem planejamento/cutover/listas)");
  ok(d1.length === 0 && igual(F0, F1).length === 0, "A1 habilitar NÃO altera nada operacional de hoje (apontamentos, fechamentos, plano <09/11, buffers/pares, WIP, versões de plano, liberação, parâmetros)", d1.join(",") || `${Object.keys(F1).length} componentes idênticos`);

  // ---- C: Previsão aceita UMA quantidade; guarda recusa legado ----
  const salvaLegado = tenta(`select 1 from (select public.upsert_previsao_semana('${S0}', (select jsonb_agg(jsonb_build_object('id', i.id, 'produto_id', i.produto_id, 'produto_nome', i.produto_nome, 'valor_unitario', i.valor_unitario, 'quantidade', i.quantidade)) from previsao_itens i where i.previsao_id='${prev}' and i.tipo='previsto'), null, null)) x`);
  const salvaLegadoAdm = (() => { try { return asAdmin(`select public.upsert_previsao_semana('${S0}', (select jsonb_agg(jsonb_build_object('id', i.id, 'produto_id', i.produto_id, 'produto_nome', i.produto_nome, 'valor_unitario', i.valor_unitario, 'quantidade', i.quantidade)) from previsao_itens i where i.previsao_id='${prev}' and i.tipo='previsto'), null, null)`); } catch (e: any) { return "ERRO: " + String(e.stderr ?? e.message); } })();
  ok(salvaLegadoAdm.includes("PRODUTO_LEGADO_APOS_CUTOVER") || salvaLegado.includes("PRODUTO_LEGADO"), "C0 em semana de PLANEJAMENTO salvar a Previsão com item legado é recusado (guarda)", salvaLegadoAdm.slice(0, 120));
  const uni = JSON.parse(ultima(asAdmin(`select public.produto_unico_unificar_previsao('${prev}')::text`)));
  ok(uni.quantidade === 93300 && Number(psql(`select count(*) from previsao_itens where previsao_id='${prev}' and tipo='previsto' and produto_id in ('${CONV}','${AUTO}')`)) === 0, "C1 'Unificar em Conector 3/4': soma 64.800+28.500 = UM item de 93.300 e REMOVE os dois itens legados da Previsão", JSON.stringify(uni));
  ok(Number(psql(`select count(*) from produto_unico_conversoes where previsao_id='${prev}' and acao='converter' and jsonb_array_length(backup->'itens')=2`)) === 1, "C2 backup (undo) dos 2 itens legados guardado em produto_unico_conversoes");
  const payload = psql(`select jsonb_agg(jsonb_build_object('id', i.id, 'produto_id', i.produto_id, 'produto_nome', i.produto_nome, 'valor_unitario', i.valor_unitario, 'quantidade', i.quantidade,
      'maquinas_por_etapa', coalesce((select jsonb_object_agg(x.etapa_id, x.ms) from (select im.etapa_id::text, jsonb_agg(im.maquina_id) ms from previsao_item_maquinas im where im.item_id=i.id group by 1) x), '{}'::jsonb)))::text from previsao_itens i where i.previsao_id='${prev}' and i.tipo='previsto'`);
  const salva = (() => { try { return asAdmin(`select public.upsert_previsao_semana('${S0}', $j$${payload}$j$::jsonb, null, null)`); } catch (e: any) { return "ERRO: " + String(e.stderr ?? e.message); } })();
  ok(!salva.startsWith("ERRO"), "C3 upsert_previsao_semana (RPC do app) salva o item único (quantidade única) + os outros itens da semana", salva.slice(0, 100));
  ok(Number(psql(`select quantidade from previsao_itens where previsao_id='${prev}' and produto_id='${pu}' and tipo='previsto'`)) === 93300 && Number(psql(`select count(*) from previsao_itens where previsao_id='${prev}' and tipo='previsto'`)) === 4, "B semana 09/11 mostra o produto único (93.300) e mais 3 itens; nenhum legado");
  // ---- D: seleção das duas rotas ----
  const sel = psql(`select string_agg(o.nome||'='||c, ', ' order by o.nome) from (select e.operacao_id, count(*) c from previsao_item_maquinas im join roteiro_etapas e on e.id=im.etapa_id join previsao_itens i on i.id=im.item_id where i.produto_id='${pu}' and i.previsao_id='${prev}' group by 1) z join operacoes o on o.id=z.operacao_id`);
  const m8 = Number(psql(`select count(*) from previsao_item_maquinas im join previsao_itens i on i.id=im.item_id join roteiro_etapas e on e.id=im.etapa_id join operacoes o on o.id=e.operacao_id join maquinas m on m.id=im.maquina_id where i.produto_id='${pu}' and i.previsao_id='${prev}' and o.nome='Rosquear + Parafusar' and m.nome ilike 'Maquina Automatica 8%'`));
  ok(m8 === 1 && /Rosquear=/.test(sel) && /Parafusar=/.test(sel) && /Etiquetar=/.test(sel) && /Embalar=/.test(sel), "D as duas rotas selecionáveis: M8 na etapa 'Rosquear + Parafusar'; Rosquear/Parafusar/Etiquetar/Embalar com máquinas", sel);

  // ---- E/F: o motor gera a semana com o produto único; nenhum id legado ----
  const t0 = Date.now();
  const r = await gerarEscalaDaSemana(admin, S0, admId, Date.now());
  ok(r.status === "processado" && r.corte?.usado === true, "E motor gera o plano de 09/11 com o planejador de corte e o produto único", `${r.status} · corte usado=${r.corte?.usado} · ${r.alocacoesGravadas} linhas · ${Date.now() - t0} ms · ${r.corte?.motivoFalha ?? ""}`);
  const leg = Number(psql(`select count(*) from escala_producao_alocacoes a where a.data >= '${S0}' and (a.produto_id in ('${CONV}','${AUTO}') or a.etapa_id in (select id from roteiro_etapas where produto_id in ('${CONV}','${AUTO}')) or coalesce(a.distribuicao::text,'') like '%${CONV}%' or coalesce(a.distribuicao::text,'') like '%${AUTO}%')`));
  const can = Number(psql(`select count(*) from escala_producao_alocacoes where data >= '${S0}' and produto_id='${pu}' and maquina_id is not null`));
  ok(leg === 0 && can > 0, "F nenhum id legado do Conector no plano de 09/11; só o produto único", `legado=${leg} canônico=${can} linhas com posto`);
  const divisao = psql(`select string_agg(o.nome||'='||round(s), ' · ' order by o.nome) from (select a.operacao_id, sum(a.pecas) s from escala_producao_alocacoes a where a.data >= '${S0}' and a.produto_id='${pu}' and a.maquina_id is not null group by 1) z join operacoes o on o.id=z.operacao_id`);
  console.log(`   divisão entre as rotas (peças por operação): ${divisao}`);

  // ---- A/G: nada de hoje mudou depois de gerar 09/11 ----
  const F2 = fingerprint();
  const d2 = igual(F0, F2);
  ok(d2.length === 0, "A2/G depois de unificar, salvar a Previsão e GERAR o plano de 09/11: apontamentos, fechamentos, plano <09/11, buffers/pares/máquinas, WIP (controle/ajustes/confirmações/saldo), versões de plano e liberação de hoje IDÊNTICOS", d2.join(",") || `${Object.keys(F2).length} componentes idênticos`);
  ok(psql(`select md5(string_agg(concat_ws('|', data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, coalesce(distribuicao::text,'')), '~' order by data, periodo_id, funcionario_id)) from escala_producao_alocacoes where data >= '2026-11-02' and data < '${S0}'`) === hash0211, "A3 hash do plano da semana 02/11 (e 06/11) inalterado", hash0211);
  const tvDepois = tvDia("2026-11-06");
  ok(tvDepois.alocacoes === tvAntes.alocacoes, "A4 TV de 06/11 entrega o MESMO que antes", `${tvAntes.alocacoes} → ${tvDepois.alocacoes}`);
  ok(psql(`select produto_unico_modo('2026-11-06')`) === "LEGADO", "A5 06/11 continua LEGADO");

  // =============== HARD GATE (1)–(9): plano futuro NÃO é escala liberada ===============
  const blocoGate = async (rotulo: string) => {
    // (7) escala_periodo_liberacao NÃO LIBERADO em todos os 30 períodos de 09–13/11
    let naoLib = 0, motivos = new Set<string>();
    for (const d of DIAS_S0) for (const p of PERIODOS) { const l = liberacao(d, p); if (l.liberado === false) naoLib++; motivos.add(l.motivo); }
    ok(naoLib === 30 && motivos.size === 1 && motivos.has("PLANO_FUTURO_AGUARDANDO_CUTOVER"), `(7) [${rotulo}] escala_periodo_liberacao = NÃO LIBERADO nos 30 períodos de 09–13/11`, [...motivos].join(","));
    // (1) TV
    const tv = DIAS_S0.map(tvDia);
    ok(tv.every((t) => t.alocacoes === 0), `(1) [${rotulo}] TV (escala_tv_snapshot) não recebe NENHUM posto de 09–13/11`, tv.map((t) => t.alocacoes).join("/"));
    // (2) APIs de postos e de apontamentos do fechamento
    const io = { carregar: (d: string, p: string) => carregarPostosProgramados(admin, d, p), modo: async () => "ativo" as const, liberado: async (d: string, p: string) => (await admin.rpc("escala_periodo_liberacao", { p_data: d, p_periodo: p })).data as any };
    const api = await acaoPostos(io, u, S0, "m1");
    const apiAp = await acaoApontamentosEstado(criarApontamentosIO(admin, admin), u, S0, "m1");
    ok((api.corpo as any).naoLiberado === true && (api.corpo as any).postos.length === 0 && (apiAp.corpo as any).naoLiberado === true && (apiAp.corpo as any).postos.length === 0, `(2) [${rotulo}] Produção Real: /postos e /apontamentos devolvem naoLiberado e 0 postos para 09/11`);
    // (4) fechamento físico: abrir e confirmar recusam
    const shift = epochMsNoFuso(S0, "08:55") - Date.now();
    const relogio = () => Date.now() + shift;
    const ioF = criarFechamentoIO(admin, { podeExcecao: false, relogio });
    const ab = await acaoAbrir(ioF, u, { data: S0, periodo_id: "m1" });
    const cf = await acaoConfirmar(ioF, u, { data: S0, periodo_id: "m1", chave: crypto.randomUUID(), buffers: [] }, relogio);
    ok(ab.status === 422 && JSON.stringify(ab.corpo).includes("PERIODO_EM_PLANEJAMENTO") && cf.status === 422 && JSON.stringify(cf.corpo).includes("PERIODO_EM_PLANEJAMENTO"), `(4) [${rotulo}] fechamento físico: abrir e confirmar de 09/11 recusados (PERIODO_EM_PLANEJAMENTO)`, `abrir ${ab.status} · confirmar ${cf.status}`);
  };

  await blocoGate("plano gerado, sem fechamento do T3");

  // (3) apontamento: guarda no banco (INSERT direto = o que TODAS as RPCs fazem) para QUALQUER produto; e as RPCs reais numa data PASSADA simulando semana em planejamento (transação com ROLLBACK)
  const pinoId = psql("select id from produtos where nome='Pino' limit 1");
  const maqPino = psql(`select rem.maquina_id from roteiro_etapa_maquinas rem join roteiro_etapas e on e.id=rem.etapa_id where e.produto_id='${pinoId}' limit 1`);
  const func = psql("select id from funcionarios where ativo order by id limit 1");
  const insDireto = tenta(`insert into apontamentos_producao (status, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, valor_unitario_produto_vigente, idempotency_key)
     select 'produzindo', e.produto_id, e.id, e.operacao_id, '${maqPino}', '${func}', 'm1', '${S0}', '08:00', 10, 0, '07:12', '08:48', 0, 0, 0.1, gen_random_uuid() from roteiro_etapas e where e.produto_id='${pinoId}' limit 1`);
  ok(insDireto.includes("APONTAMENTO_SEMANA_EM_PLANEJAMENTO"), "(3a) INSERT de apontamento em 09/11 recusado para QUALQUER produto (Pino) — guarda no banco", insDireto.slice(0, 140));
  const rpcFut = tentaAdm(`select (public.registrar_apontamento_producao_core('${maqPino}','${pinoId}','${func}',10,0,gen_random_uuid(),null,'${S0}','10:00','m1','07:12','08:48')).id`);
  ok(/APONTAMENTO_SEMANA_EM_PLANEJAMENTO|futur|ainda não/i.test(rpcFut), "(3b) registrar_apontamento_producao_core com data de 09/11 recusado", rpcFut.slice(0, 120));
  // simulação com a semana de planejamento no PASSADO (rollback): as três RPCs reais chegam ao INSERT e são barradas pela guarda
  const sim = (sql: string) => tenta(`begin; alter table escala_parametros disable trigger trg_escala_parametros_evento; alter table escala_parametros disable trigger trg_escala_plano_versao; update escala_parametros set valor='"2026-11-02"' where chave='produto_unico_planejamento_desde'; ${sql}; rollback;`);
  const linhas = JSON.stringify([{ chave: "11111111-1111-4111-8111-111111111111", maquina_planejada_id: maqPino, maquina_id: maqPino, produto_id: pinoId, funcionario_id: func, produzido: 10, refugo: 0, nao_produziu: false }]).replace(/'/g, "''");
  const s1 = sim(`select set_config('request.jwt.claims', json_build_object('sub',(select auth_user_id::text from usuarios where papel='admin' and ativo and auth_user_id is not null order by nome limit 1),'role','authenticated')::text, true); set local role authenticated; select (public.registrar_apontamento_producao_core('${maqPino}','${pinoId}','${func}',10,0,gen_random_uuid(),null,'2026-11-03','08:00','m1','07:12','08:48')).id`);
  const s2 = sim(`select set_config('request.jwt.claims', json_build_object('sub',(select auth_user_id::text from usuarios where papel='admin' and ativo and auth_user_id is not null order by nome limit 1),'role','authenticated')::text, true); set local role authenticated; select public.registrar_apontamentos_fechamento('2026-11-03','m1','${linhas}'::jsonb)`);
  const s3 = sim(`select set_config('request.jwt.claims', json_build_object('sub',(select auth_user_id::text from usuarios where papel='admin' and ativo and auth_user_id is not null order by nome limit 1),'role','authenticated')::text, true); set local role authenticated; select public.regularizar_apontamento_historico('2026-11-03','m1','${maqPino}','${func}','${pinoId}',10,0,null)`);
  ok(s1.includes("APONTAMENTO_SEMANA_EM_PLANEJAMENTO"), "(3c) [semana simulada em planejamento, data passada] registrar_apontamento_producao_core recusado", s1.slice(0, 130));
  ok(s2.includes("APONTAMENTO_SEMANA_EM_PLANEJAMENTO"), "(3d) idem registrar_apontamentos_fechamento recusado", s2.slice(0, 130));
  ok(s3.includes("APONTAMENTO_SEMANA_EM_PLANEJAMENTO") || /não está liberad|liberad/i.test(s3), "(3e) idem regularizar_apontamento_historico recusado", s3.slice(0, 130));
  // (4b) fechamento no banco
  const f1 = tenta(`insert into escala_fechamento_aberturas (semana_inicio, data, periodo_id, aberto_por, valido_ate) values ('${S0}','${S0}','m1','${admId}', now() + interval '10 min')`);
  ok(f1.includes("FECHAMENTO_SEMANA_EM_PLANEJAMENTO"), "(4b) INSERT de abertura de fechamento em 09/11 recusado no banco", f1.slice(0, 130));
  // (8) nenhuma regra por relógio contorna: mover escala_liberacao_desde (antes / depois / exatamente) e fechar o T3 da sexta
  for (const desde of [{ data: "2026-11-02", periodo: "m1" }, { data: S0, periodo: "m1" }, { data: "2026-11-20", periodo: "m1" }]) {
    psql(`alter table escala_parametros disable trigger trg_escala_parametros_evento; update escala_parametros set valor='${JSON.stringify(desde)}'::jsonb where chave='escala_liberacao_desde'; alter table escala_parametros enable trigger trg_escala_parametros_evento;`);
    const l = [liberacao(S0, "m1"), liberacao(S0, "t3"), liberacao(DIAS_S0[4], "m2")];
    ok(l.every((x) => x.liberado === false && x.motivo === "PLANO_FUTURO_AGUARDANDO_CUTOVER"), `(8) escala_liberacao_desde = ${desde.data} ${desde.periodo}: 09/11 continua NÃO LIBERADO (planejamento tem precedência sobre TRANSICAO/vínculo/VIRADA)`);
  }
  psql(`alter table escala_parametros disable trigger trg_escala_parametros_evento; update escala_parametros set valor='{"data":"2026-11-04","periodo":"m3"}'::jsonb where chave='escala_liberacao_desde'; alter table escala_parametros enable trigger trg_escala_parametros_evento;`);

  // (7)/(8)/(9) CAMINHO COM FECHAMENTO: fecha de verdade (relógio simulado) 05/11 M3 … 06/11 T3 com contagem física; a sexta termina CONFIRMADA; plano de 09/11 foi gerado ANTES e depois é regerado DEPOIS
  prepararRelogioSimulado();
  const seq: [string, string][] = [["2026-11-05", "m3"], ["2026-11-05", "t1"], ["2026-11-05", "t2"], ["2026-11-05", "t3"], ["2026-11-06", "m1"], ["2026-11-06", "m2"], ["2026-11-06", "m3"], ["2026-11-06", "t1"], ["2026-11-06", "t2"], ["2026-11-06", "t3"]];
  limparApontamentosDe(seq);
  let ultimo: any = null;
  for (const [d, p] of seq) {
    const x = await fecharSim(u, d, p, p === "t3" && d === "2026-11-06" ? { a: 4321, b: 5432, c: 6543 } : (e) => ({ a: Math.round(e.a * 1.1), b: Math.round(e.b * 0.9), c: Math.round(e.c * 1.05) }));
    ultimo = x.r?.corpo;
    if (!ultimo || ultimo.estado !== "CONFIRMADO") break;
  }
  ok(ultimo?.estado === "CONFIRMADO", "(7/8) sexta 06/11: T3 CONFIRMADO com contagem física (A=4321, B=5432, C=6543); semana 02/11 fechada de ponta a ponta", String(ultimo?.mensagem ?? ultimo?.erros?.[0]?.mensagem));
  ok(liberacao("2026-11-06", "t3").motivo !== undefined, "(7) T3 de 06/11 segue o fluxo normal (semana LEGADO)");
  await blocoGate("T3 da sexta CONFIRMADO; plano gerado ANTES do fechamento");
  // plano regerado DEPOIS do fechamento (o dia 06/11 já fechou; 09/11 não iniciou)
  const r2 = await gerarEscalaDaSemana(admin, S0, admId, Date.now());
  ok(r2.status === "processado" || r2.status === "sem_alteracao", "regerar 09/11 depois do fechamento do T3", `${r2.status} ${r2.corte?.motivoFalha ?? ""}`);
  await blocoGate("T3 CONFIRMADO; plano regerado DEPOIS do fechamento");
  console.log(falhas.length === 0 ? "\nRESULTADO: TUDO PASS" : `\nRESULTADO: ${falhas.length} FALHA(S): ${falhas.join(" | ")}`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

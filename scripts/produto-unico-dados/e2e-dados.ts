/* eslint-disable @typescript-eslint/no-explicit-any */
// E2E PARCIAL DE DADOS do produto único (clone local de PROD; NUNCA PROD). NÃO depende do motor da trilha A.
// Pré-requisito: clone migrado (scripts/produto-unico-dados/clone-aplicar.sh --restaurar) com produto_unico_cutover = null.
// Uso: set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/produto-unico-dados/e2e-dados.ts
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buffersObrigatorios, contagensDoInventario, somaPorBuffer } from "@/features/escala/fechamento/catalogo";
import type { BufferCatalogo } from "@/features/escala/fechamento/tipos";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL.includes("qcmottqryawyrghdepel") || !/127\.0\.0\.1|localhost/.test(URL)) throw new Error("ABORTADO: só roda no clone local");
const admin: SupabaseClient = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PG = ["-h", "127.0.0.1", "-p", "55433", "-U", "postgres", "-d", "sittech_clone", "-v", "ON_ERROR_STOP=1", "-q", "-At"];
const psql = (q: string): string => execFileSync("/opt/homebrew/opt/libpq/bin/psql", [...PG, "-c", q], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
const tenta = (q: string): string => { try { return psql(q); } catch (e: any) { return "ERRO: " + String(e.stderr ?? e.message).trim().split("\n")[0]; } };
const asAdmin = (sql: string) => psql(`begin; select set_config('request.jwt.claims', json_build_object('sub',(select auth_user_id::text from usuarios where papel='admin' and ativo and auth_user_id is not null order by nome limit 1),'role','authenticated')::text, true); set local role authenticated; ${sql}; commit;`);
const tentaAdmin = (sql: string) => { try { return asAdmin(sql); } catch (e: any) { return "ERRO: " + String(e.stderr ?? e.message).trim().split("\n")[0]; } };
const ultima = (s: string) => s.split("\n").filter((l) => !/^(BEGIN|COMMIT|ROLLBACK|SET|COMMIT)$/.test(l) && !l.startsWith("{\"sub\"")).at(-1) ?? "";
const falhas: string[] = [];
const ok = (c: boolean, n: string, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) falhas.push(n); };

const CONV = "27c229d7-f192-41eb-aad1-0c69ece53eba", AUTO = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee", S0 = "2026-11-09";
const M8 = "a118f430-f854-4e89-9e3c-ce6fcbbc52cf";

(async () => {
  console.log(`# E2E DADOS · produto único · clone · ${new Date().toISOString()}`);
  ok(psql("select valor::text from escala_parametros where chave='produto_unico_cutover'") === "null", "E0 clone migrado, sem cutover");
  const pu = psql("select produto_id from produto_canonico where codigo='CONECTOR_3_4_UNICO'");
  const prev = psql(`select id from previsoes where semana_inicio='${S0}'`);

  // ---- E1: Previsão 09/11 com os DOIS itens legados (como estaria se copiada) ----
  psql(`insert into previsao_itens (id, previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values ('e2e00000-0000-4000-8000-000000000001','${prev}','previsto','${CONV}','Conector 3/4"',0.1825,64800), ('e2e00000-0000-4000-8000-000000000002','${prev}','previsto','${AUTO}','Conector 3/4" - Maquina Automatica',0.182,28500)`);
  psql(`insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) select 'e2e00000-0000-4000-8000-000000000001', e.id, rem.maquina_id from roteiro_etapas e join roteiro_etapa_maquinas rem on rem.etapa_id=e.id where e.produto_id='${CONV}'`);
  psql(`insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) select 'e2e00000-0000-4000-8000-000000000002', e.id, rem.maquina_id from roteiro_etapas e join roteiro_etapa_maquinas rem on rem.etapa_id=e.id where e.produto_id='${AUTO}'`);
  ok(Number(psql(`select sum(quantidade) from previsao_itens where previsao_id='${prev}' and produto_id in ('${CONV}','${AUTO}')`)) === 93300, "E1 Previsão 09/11 com itens legados 64.800 + 28.500 (antes do cutover)");

  // ---- E2: ativar o cutover ----
  const r = JSON.parse(psql(`select public.produto_unico_ativar('${S0}','e2e')::text`));
  ok(r.cutover === S0 && r.estado.buffers_conector34_n === 3, "E2 produto_unico_ativar(2026-11-09): 3 buffers Conector no estado", JSON.stringify({ pares_novos: r.pares_novos, legado_encerrados: r.pares_legado_encerrados }));
  ok(Number(psql(`select sum(quantidade) from previsao_itens where previsao_id='${prev}' and produto_id in ('${CONV}','${AUTO}')`)) === 93300, "E2b ativar NÃO mexeu nos itens da Previsão (a soma é ação explícita)");

  // ---- E3: guarda: salvar a Previsão com itens legados após o cutover é recusado (cliente antigo / aba aberta) ----
  const salvaLegado = tentaAdmin(`select public.upsert_previsao_semana('${S0}', (select jsonb_agg(jsonb_build_object('id', i.id, 'produto_id', i.produto_id, 'produto_nome', i.produto_nome, 'valor_unitario', i.valor_unitario, 'quantidade', i.quantidade)) from previsao_itens i where i.previsao_id='${prev}' and i.tipo='previsto'), null, null)`);
  ok(salvaLegado.includes("PRODUTO_LEGADO_APOS_CUTOVER"), "E3 salvar a Previsão com itens legados após o cutover é recusado e nada é perdido", salvaLegado.slice(0, 100));
  ok(Number(psql(`select count(*) from previsao_itens where previsao_id='${prev}' and tipo='previsto' and produto_id in ('${CONV}','${AUTO}')`)) === 2, "E3b os 2 itens legados continuam lá (a transação do salvamento foi desfeita)");

  // ---- E4: UNIFICAR (ação explícita) e SEPARAR ----
  const uni = JSON.parse(ultima(asAdmin(`select public.produto_unico_unificar_previsao('${prev}')::text`)));
  ok(uni.quantidade === 93300 && uni.maquinas_canonicas > 0, "E4 unificar: UM item com 93.300 e máquinas mapeadas", JSON.stringify(uni));
  const maqPorEtapa = psql(`select string_agg(o.nome||'='||c, ', ' order by o.nome) from (select e.operacao_id, count(*) c from previsao_item_maquinas im join roteiro_etapas e on e.id=im.etapa_id join previsao_itens i on i.id=im.item_id where i.produto_id='${pu}' and i.previsao_id='${prev}' group by 1) z join operacoes o on o.id=z.operacao_id`);
  ok(Number(psql(`select count(*) from previsao_item_maquinas im join previsao_itens i on i.id=im.item_id where i.produto_id='${pu}' and im.maquina_id='${M8}' and im.etapa_id=(select etapa_id from produto_canonico_etapas ce join roteiro_etapas e on e.id=ce.etapa_id join operacoes o on o.id=e.operacao_id where o.nome='Rosquear + Parafusar')`)) === 1, "E4b M8 selecionada na etapa 'Rosquear + Parafusar' do item único", maqPorEtapa);
  ok(Number(psql(`select count(*) from previsao_itens where previsao_id='${prev}' and produto_id in ('${CONV}','${AUTO}')`)) === 0, "E4c itens legados removidos da Previsão (backup guardado em produto_unico_conversoes)");
  const sep = JSON.parse(ultima(asAdmin(`select public.produto_unico_separar_previsao('${prev}')::text`)));
  ok(sep.itens_restaurados === 2 && Number(psql(`select sum(quantidade) from previsao_itens where previsao_id='${prev}' and produto_id in ('${CONV}','${AUTO}')`)) === 93300, "E4d separar restaura os 2 itens legados do backup (64.800 + 28.500)");
  asAdmin(`select public.produto_unico_unificar_previsao('${prev}')`);

  // ---- E5: salvar a Previsão pelo RPC do app com o item único + demais itens + máquinas ----
  const payload = psql(`select jsonb_agg(jsonb_build_object('id', i.id, 'produto_id', i.produto_id, 'produto_nome', i.produto_nome, 'valor_unitario', i.valor_unitario, 'quantidade', i.quantidade,
      'maquinas_por_etapa', coalesce((select jsonb_object_agg(x.etapa_id, x.ms) from (select im.etapa_id::text, jsonb_agg(im.maquina_id) ms from previsao_item_maquinas im where im.item_id=i.id group by 1) x), '{}'::jsonb)))::text from previsao_itens i where i.previsao_id='${prev}' and i.tipo='previsto'`);
  const salva = tentaAdmin(`select public.upsert_previsao_semana('${S0}', $j$${payload}$j$::jsonb, null, null)`);
  ok(!salva.startsWith("ERRO"), "E5 upsert_previsao_semana (RPC do app) salva o item único + os outros 3 itens da semana", salva.slice(0, 100));
  ok(psql(`select string_agg(p.nome||'='||i.quantidade, ' | ' order by p.nome) from previsao_itens i join produtos p on p.id=i.produto_id where i.previsao_id='${prev}' and i.tipo='previsto' and p.nome like 'Conector 3/4%'`).includes("93300"), "E5b item único com UMA quantidade (93.300) na Previsão");

  // ---- E6: apontamentos do produto único em 09/11 (core: o RPC do fluxo único proíbe data futura; ele foi provado em retroativo em 03-apontamentos.sql) ----
  const f = psql("select id from funcionarios where ativo order by id limit 1");
  const linhas: [string, string, number][] = [["M8", M8, 1000], ["Parafusadeira 9", "ddb9fd47-614d-467a-980f-88b4b89c708c", 800], ["Rosqueadeira 3", "4b48df30-62cb-4763-8749-1b2abae1b451", 900], ["Etiquetadora 15", "49472af4-f5af-4427-992b-17a3f00a6c38", 1500], ["Embalagem 17", "ba7adcbd-835c-45a3-92c6-f93fa87d3775", 1400]];
  for (const [, maq, q] of linhas) asAdmin(`select (public.registrar_apontamento_producao_core('${maq}','${pu}','${f}',${q},0,gen_random_uuid(),null,'${S0}','10:00','m1','05:00','07:30')).id`);
  ok(psql(`select string_agg(m.nome||'='||o.nome, '; ' order by m.nome) from apontamentos_producao a join maquinas m on m.id=a.maquina_id join operacoes o on o.id=a.operacao_id where a.data='${S0}' and a.produto_id='${pu}'`).includes("Maquina Automatica 8 =Rosquear + Parafusar"), "E6 5 apontamentos do produto único; M8 resolvida para 'Rosquear + Parafusar'");
  ok(tentaAdmin(`select (public.registrar_apontamento_producao_core('ddb9fd47-614d-467a-980f-88b4b89c708c','${CONV}','${f}',10,0,gen_random_uuid(),null,'${S0}','10:00','m2','07:30','10:00')).id`).includes("APONTAMENTO_LEGADO_APOS_CUTOVER"), "E6b apontamento com produto legado em 09/11 é recusado");
  ok(Number(psql(`select sum(quantidade_boa) filter (where conta_como_final) from vw_apontamentos_canonicos where data='${S0}' and produto_canonico_id='${pu}'`)) === 1400, "E6c produção final do dia = só Embalagem (1.400), sem somar M8/Rosquear/Parafusar");

  // ---- E7: FECHAMENTO FÍSICO — buffers obrigatórios lidos pela MESMA função do app (TS) sobre o catálogo do clone ----
  const { data: bufs } = await admin.from("escala_buffers_fisicos").select("id, chave, rotulo, ordem").eq("ativo", true);
  const { data: pares } = await admin.from("escala_buffer_pares").select("buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, papel, vigente_de, vigente_ate");
  const catalogoEm = (data: string): BufferCatalogo[] => (bufs as any[]).map((b) => ({ id: b.id, chave: b.chave, rotulo: b.rotulo, ordem: b.ordem,
    pares: (pares as any[]).filter((p) => p.buffer_id === b.id && p.vigente_de <= data && (!p.vigente_ate || p.vigente_ate >= data)).map((p) => ({ produtoId: p.produto_id, etapaOrigemId: p.etapa_origem_id, etapaSeguinteId: p.etapa_seguinte_id, papel: p.papel })) }));
  const obrig = buffersObrigatorios(catalogoEm(S0), new Set([pu]));
  const conector = obrig.filter((b) => b.chave.startsWith("conector34:"));
  ok(conector.length === 3, "E7 fechamento do produto único em 09/11 pede EXATAMENTE 3 buffers Conector", conector.map((b) => b.chave).join(", "));
  ok(buffersObrigatorios(catalogoEm("2026-11-06"), new Set([CONV, AUTO])).filter((b) => b.chave.startsWith("conector34:")).length === 3, "E7b semana anterior (06/11) com os legados segue pedindo 3 (como hoje)");
  ok(buffersObrigatorios(catalogoEm(S0), new Set([CONV, AUTO])).filter((b) => b.chave.startsWith("conector34:")).length === 0, "E7c legados em 09/11 não pedem nenhum buffer");
  // inicialização física A/B/C -> contagens do motor
  const A = 3000, B = 5000, C = 2000;
  const informados = conector.map((b) => ({ bufferId: b.id, fisico: b.chave.endsWith("rosqueadas") ? A : b.chave.endsWith("parafusadas") ? B : C }));
  const contagens = contagensDoInventario(conector, informados, Date.parse(`${S0}T05:00:00-03:00`), "e2e", "inicialização física");
  const soma = somaPorBuffer(conector, contagens);
  const buf2 = conector.find((b) => b.chave.endsWith("parafusadas"))!;
  ok(soma[buf2.id] === B, "E7d contagensDoInventario (TS, trilha A) mantém o buffer 'parafusadas' = 5.000 (sem duplicar)", `soma entregue ao motor = ${soma[buf2.id]} (esperado ${B}) — ${soma[buf2.id] === B ? "OK" : "DUPLICA: 2 pares 'contabil' recebem o total cada; a view do banco já trata, o TS precisa tratar igual"}`);

  // ---- E8: ROLLBACK ----
  const rb1 = tenta(`select public.produto_unico_desativar('e2e')`);
  ok(rb1.includes("DESATIVAR_ABORTADO"), "E8 rollback recusa enquanto a Previsão tem o item único", rb1.slice(0, 110));
  psql(`delete from previsao_itens where previsao_id='${prev}' and produto_id='${pu}'`);
  const rb2 = JSON.parse(psql(`select public.produto_unico_desativar('e2e')::text`));
  ok(rb2.modo === "preservando_dados" && Number(psql(`select count(*) from apontamentos_producao where produto_id='${pu}'`)) === 5, "E8b rollback com apontamentos do produto único: modo preservando_dados, os 5 apontamentos continuam", JSON.stringify(rb2));
  ok(psql("select valor::text from escala_parametros where chave='produto_unico_cutover'") === "null" && tentaAdmin(`insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values ('${prev}','previsto','${CONV}','x',0.18,1)`).includes("COMMIT") === false, "E8c cutover = null; legados voltam a aceitar item de Previsão");
  psql(`delete from previsao_itens where produto_nome='x'`);

  console.log(falhas.length === 0 ? "\nRESULTADO: TUDO PASS" : `\nRESULTADO: ${falhas.length} FALHA(S): ${falhas.join(" | ")}`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

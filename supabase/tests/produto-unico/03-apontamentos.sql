\i _ok.sql
\echo == 03 APONTAMENTOS COM O PRODUTO ÚNICO (RPC registrar_apontamentos_fechamento, regularização histórica, REABRIR) — cutover retroativo 02/11 SÓ dentro da transação
begin;
select u.id as uid, u.auth_user_id::text as auth_uid from usuarios u where u.papel='admin' and u.ativo and u.auth_user_id is not null order by u.id limit 1 \gset
select id as func from funcionarios where ativo order by id limit 1 \gset
select produto_id as pu from produto_canonico \gset
-- cutover retroativo (apenas para poder usar datas passadas; gatilhos de evento/versão desligados como na ativação)
alter table escala_parametros disable trigger trg_escala_parametros_evento;
alter table escala_parametros disable trigger trg_escala_plano_versao;
update escala_parametros set valor='"2026-11-02"' where chave='produto_unico_cutover';
alter table escala_parametros enable trigger trg_escala_plano_versao;
alter table escala_parametros enable trigger trg_escala_parametros_evento;
update produtos set ativo=true where id=:'pu';
-- limpa 05/11 t3 (periodo sem fechamento) para registrar do zero
set local session_replication_role = replica;
delete from apontamento_planejado_real where data='2026-11-05' and periodo_id='t3';
delete from apontamento_paradas where apontamento_id in (select id from apontamentos_producao where data='2026-11-05' and periodo_id='t3');
delete from apontamentos_producao where data='2026-11-05' and periodo_id='t3';
delete from apontamento_planejado_real where data='2026-10-30' and periodo_id='t3';
delete from apontamento_paradas where apontamento_id in (select id from apontamentos_producao where data='2026-10-30' and periodo_id='t3');
delete from apontamentos_producao where data='2026-10-30' and periodo_id='t3';
delete from apontamento_planejado_real where data='2026-11-04' and periodo_id in ('t2','t3');
delete from apontamento_paradas where apontamento_id in (select id from apontamentos_producao where data='2026-11-04' and periodo_id in ('t2','t3'));
delete from apontamentos_producao where data='2026-11-04' and periodo_id in ('t2','t3');
set local session_replication_role = origin;
select set_config('request.jwt.claims', json_build_object('sub', :'auth_uid', 'role','authenticated')::text, true);

create temp table _ctx as select :'func'::uuid as func;
grant select on _ctx to authenticated;
create or replace function pg_temp.linhas(p_prod uuid) returns jsonb language sql stable as $$
  select jsonb_build_array(
    jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', 'a118f430-f854-4e89-9e3c-ce6fcbbc52cf', 'funcionario_id', (select func from _ctx), 'produto_id', p_prod, 'produzido', 1000, 'refugo', 5),
    jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', 'ddb9fd47-614d-467a-980f-88b4b89c708c', 'funcionario_id', (select func from _ctx), 'produto_id', p_prod, 'produzido', 800, 'refugo', 0),
    jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', '4b48df30-62cb-4763-8749-1b2abae1b451', 'funcionario_id', (select func from _ctx), 'produto_id', p_prod, 'produzido', 900, 'refugo', 0),
    jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', '49472af4-f5af-4427-992b-17a3f00a6c38', 'funcionario_id', (select func from _ctx), 'produto_id', p_prod, 'produzido', 1500, 'refugo', 0),
    jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', 'ba7adcbd-835c-45a3-92c6-f93fa87d3775', 'funcionario_id', (select func from _ctx), 'produto_id', p_prod, 'produzido', 1400, 'refugo', 0)) $$;

set local role authenticated;
select pg_temp.falha($$select public.registrar_apontamentos_fechamento('2026-11-05','t3', jsonb_build_array(jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', 'ddb9fd47-614d-467a-980f-88b4b89c708c', 'funcionario_id', (select func from _ctx), 'produto_id', '27c229d7-f192-41eb-aad1-0c69ece53eba', 'produzido', 10, 'refugo', 0)))$$, 'APONTAMENTO_LEGADO_APOS_CUTOVER', 'A1 apontamento com produto LEGADO em data >= cutover é recusado (novos apontamentos só no produto único)');
select public.registrar_apontamentos_fechamento('2026-11-05','t3', pg_temp.linhas(:'pu')) as reg \gset
reset role;
select pg_temp.ok((:'reg'::jsonb ->> 'ok')::boolean and jsonb_array_length(:'reg'::jsonb -> 'linhas') = 5, 'A2 RPC do fluxo único lançou 5 apontamentos do produto único (M8, Parafusadeira 9, Rosqueadeira 3, Etiquetadora 15, Embalagem 17)');
select pg_temp.ok((select string_agg(m.nome||'='||o.nome, '; ' order by m.nome) from apontamentos_producao a join maquinas m on m.id=a.maquina_id join operacoes o on o.id=a.operacao_id where a.data='2026-11-05' and a.periodo_id='t3' and a.produto_id=:'pu')
  = 'Embalagem 17=Embalar; Etiquetadora 15=Etiquetar; Maquina Automatica 8 =Rosquear + Parafusar; Parafusadeira 9=Parafusar; Rosqueadeira 3=Rosquear',
  'A3 operação resolvida por máquina: M8 -> "Rosquear + Parafusar"; Parafusadeira -> Parafusar; Rosqueadeira -> Rosquear; Etiquetadora -> Etiquetar; Embalagem -> Embalar',
  (select string_agg(m.nome||'='||o.nome, '; ' order by m.nome) from apontamentos_producao a join maquinas m on m.id=a.maquina_id join operacoes o on o.id=a.operacao_id where a.data='2026-11-05' and a.periodo_id='t3' and a.produto_id=:'pu'));
select pg_temp.ok((select count(*) from apontamentos_producao a join produto_canonico_etapas ce on ce.etapa_id=a.etapa_id where a.data='2026-11-05' and a.periodo_id='t3')=5 and (select count(*) from apontamento_planejado_real where data='2026-11-05' and periodo_id='t3')=5, 'A4 etapa_id dos 5 apontamentos pertence ao produto único; vínculo planejado×real criado (5)');
select pg_temp.ok((select meta_periodo_vigente from apontamentos_producao a where a.data='2026-11-05' and a.periodo_id='t3' and a.maquina_id='a118f430-f854-4e89-9e3c-ce6fcbbc52cf') > 0 and (select valor_unitario_produto_vigente from apontamentos_producao where data='2026-11-05' and periodo_id='t3' limit 1) = 0.1825, 'A5 meta do período e valor unitário vigentes preenchidos (R$ 0,1825)');
-- views canônicas
select pg_temp.ok((select sum(quantidade_boa) filter (where conta_como_final) from vw_apontamentos_canonicos where data='2026-11-05' and periodo_id='t3' and produto_canonico_id=:'pu') = 1400, 'A6 produção final do produto único = só Embalagem (1.400); M8/Rosquear/Parafusar/Etiquetar não contam como final');
select pg_temp.ok((select count(distinct rota_id) from vw_apontamentos_canonicos where data='2026-11-05' and periodo_id='t3' and produto_canonico_id=:'pu' and papel='ROTA')=2, 'A7 a rota é identificável pela máquina: M8 = AUTOMATICA, Parafusadeira/Rosqueadeira = CONVENCIONAL');
-- reenvio (substitui só o que o fluxo criou) com o produto único
set local role authenticated;
select public.registrar_apontamentos_fechamento('2026-11-05','t3', pg_temp.linhas(:'pu')) as reg2 \gset
reset role;
select pg_temp.ok((:'reg2'::jsonb ->> 'substituidas')::int = 5 and (select count(*) from apontamentos_producao where data='2026-11-05' and periodo_id='t3')=5, 'A8 reenvio do período substitui os 5 (histórico guardado), sem duplicar');
-- FECHAMENTO + REABRIR
with f as (insert into escala_fechamentos (semana_inicio, data, periodo_id, tipo, revisao, iniciado_em, contado_em, instante_motor, postos_esperados, postos_coletados, buffers_obrigatorios, resumo_producao, hash_resumo, chave_idempotencia, excecao)
  values ('2026-11-02','2026-11-05','t3','periodo',1, now(), now(), '2026-11-05T22:00:00-03:00', 0,0,3,'{}','h', gen_random_uuid(), false) returning id)
insert into escala_fechamento_log (fechamento_id, estado, detalhe) select id, 'CONFIRMADO', '{}' from f;
select pg_temp.ok(not public.escala_fechamento_apontamento_permitido('2026-11-05','t3', :'uid'), 'F1 período confirmado: apontamento NÃO permitido sem reabertura');
set local role authenticated;
select pg_temp.falha(format($$select public.registrar_apontamentos_fechamento('2026-11-05','t3', pg_temp.linhas(%L))$$, :'pu'), 'FECHAMENTO_PERIODO_EM_FECHAMENTO', 'F2 reenvio do período confirmado é recusado');
reset role;
insert into escala_fechamento_aberturas (semana_inicio, data, periodo_id, aberto_por, dispositivo, aberto_em, valido_ate) values ('2026-11-02','2026-11-05','t3', :'uid', 'teste', now() + interval '1 second', now() + interval '60 minutes');
select pg_temp.ok(public.escala_fechamento_apontamento_permitido('2026-11-05','t3', :'uid'), 'F3 REABRIR período (60 min): apontamento volta a ser permitido');
set local role authenticated;
select public.registrar_apontamentos_fechamento('2026-11-05','t3', pg_temp.linhas(:'pu')) as reg3 \gset
reset role;
select pg_temp.ok((:'reg3'::jsonb ->> 'substituidas')::int = 5, 'F4 após REABRIR o produto único é re-lançado normalmente (5 substituídos)');
-- regularização histórica
insert into regularizacao_historica_datas (data) values ('2026-11-04'), ('2026-10-30') on conflict do nothing;
set local role authenticated;
select pg_temp.falha(format($$select public.regularizar_apontamento_historico('2026-11-04','t2','4b48df30-62cb-4763-8749-1b2abae1b451',%L,'27c229d7-f192-41eb-aad1-0c69ece53eba',100,0)$$, :'func'), 'APONTAMENTO_LEGADO_APOS_CUTOVER', 'H1 regularização histórica com produto LEGADO após o cutover é recusada');
select pg_temp.ok((select (public.regularizar_apontamento_historico('2026-11-04','t3','a118f430-f854-4e89-9e3c-ce6fcbbc52cf', :'func', :'pu', 777, 0)) ->> 'ok')::boolean, 'H2 regularização histórica de M8 com o produto único (04/11 t3) aceita');
select pg_temp.ok((select o.nome from apontamentos_producao a join operacoes o on o.id=a.operacao_id where a.data='2026-11-04' and a.periodo_id='t3' and a.maquina_id='a118f430-f854-4e89-9e3c-ce6fcbbc52cf')='Rosquear + Parafusar', 'H3 ... resolvida para a operação "Rosquear + Parafusar"');
select pg_temp.falha(format($$select public.regularizar_apontamento_historico('2026-10-30','t3','a118f430-f854-4e89-9e3c-ce6fcbbc52cf',%L,%L,100,0)$$, :'func', :'pu'), 'APONTAMENTO_CANONICO_ANTES_DO_CUTOVER', 'H4 produto único em data ANTERIOR ao cutover é recusado (histórico fica nos legados)');
reset role;
-- produto inativo (rollback sem uso) não aceita novos apontamentos
set local role authenticated;
select pg_temp.falha(format($$select public.regularizar_apontamento_historico('2026-11-04','t2','ddb9fd47-614d-467a-980f-88b4b89c708c',%L,%L,100,0)$$, :'func', '27c229d7-f192-41eb-aad1-0c69ece53eba'), 'APONTAMENTO_LEGADO_APOS_CUTOVER', 'H5 legado continua recusado em 04/11 com cutover 02/11');
reset role;
update escala_parametros set valor='null'::jsonb where chave='produto_unico_cutover';
set local role authenticated;
select pg_temp.falha(format($$select public.regularizar_apontamento_historico('2026-11-04','t2','ddb9fd47-614d-467a-980f-88b4b89c708c',%L,%L,100,0)$$, :'func', :'pu'), 'APONTAMENTO_CANONICO_ANTES_DO_CUTOVER', 'H6 sem cutover (rollback) o produto único não recebe apontamento novo');
reset role;
rollback;

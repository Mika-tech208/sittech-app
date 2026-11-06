-- Teste do ledger escala_antecipacoes e da RPC de registro (rodar no CLONE; tudo dentro de uma transação revertida).
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 55433 -U postgres -d sittech_clone -v ON_ERROR_STOP=1 -f supabase/tests/escala_antecipacao.test.sql
\set ON_ERROR_STOP on
begin;
create temp table res(caso text, esperado text, obtido text, ok boolean);
create or replace function pg_temp.reg(c text, e text, o text) returns void language sql as $$ insert into res values (c, e, o, e = o) $$;
create or replace function pg_temp.tenta(q text) returns text language plpgsql as $$ begin execute q; return 'executou'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.regp(c text, pref text, o text) returns void language sql as $$ insert into res values (c, pref||'…', left(o, 60), o like pref||'%') $$;

-- cenário: semana de origem 02/11 (dias 05 e 06 existem no clone), destino 09/11
create temp table ctx as select (select id from public.previsoes where semana_inicio='2026-11-02') as prev_o, (select id from public.previsoes where semana_inicio='2026-11-09') as prev_d,
  (select id from public.produtos limit 1) as prod, (select id from public.roteiro_etapas limit 1) as et, (select id from public.maquinas limit 1) as maq, (select id from public.funcionarios limit 1) as func;
select pg_temp.reg('ctx completo', 'true', (select (prev_o is not null and prev_d is not null and prod is not null)::text from ctx));

-- 1ª gravação (corte = T1 de 06/11): 2 linhas ANT (T1, T2) + 1 FORMACAO (T3) + 1 DEMANDA (posto misto T1)
select public.escala_antecipacao_registrar((select prev_o from ctx), '2026-11-02', '2026-11-06', 't1', (
  select jsonb_build_array(
    jsonb_build_object('origem','ANTECIPACAO_SEMANA_SEGUINTE','semana_destino','2026-11-09','data','2026-11-06','periodo_id','t1','produto_id',prod,'etapa_id',et,'etapa_idx',0,'etapa_final',true,'maquina_id',maq,'funcionario_id',func,'quantidade',5000),
    jsonb_build_object('origem','ANTECIPACAO_SEMANA_SEGUINTE','semana_destino','2026-11-09','data','2026-11-06','periodo_id','t2','produto_id',prod,'etapa_id',et,'etapa_idx',0,'etapa_final',true,'maquina_id',maq,'funcionario_id',func,'quantidade',3000),
    jsonb_build_object('origem','FORMACAO_ESTOQUE','data','2026-11-06','periodo_id','t3','produto_id',prod,'etapa_id',et,'etapa_idx',0,'etapa_final',true,'maquina_id',maq,'funcionario_id',func,'quantidade',1000),
    jsonb_build_object('origem','DEMANDA_SEMANA','data','2026-11-06','periodo_id','t1','produto_id',prod,'etapa_id',et,'etapa_idx',0,'etapa_final',true,'maquina_id',maq,'funcionario_id',func,'quantidade',200)) from ctx), 'hashA', null);
select pg_temp.reg('1ª gravação: 4 linhas vigentes', '4', (select count(*)::text from public.escala_antecipacoes where substituida_em is null));
select pg_temp.reg('evento de recálculo registrado para a semana de destino (total antecipado mudou)', '1', (select count(*)::text from public.escala_producao_eventos e, ctx where e.tipo='previsao' and e.previsao_id=ctx.prev_d and e.payload->>'tabela'='escala_antecipacoes' and e.status='pendente'));
select pg_temp.reg('plano_hash e versão do dia gravados', 'hashA:true', (select plano_hash||':'||(plano_versao_dia is not null)::text from public.escala_antecipacoes order by id limit 1));

-- REGRA DE SUBSTITUIÇÃO: nova geração com corte em T2 ⇒ T1 (iniciado) fica; T2/T3 viram 'substituída' e entram as novas
select public.escala_antecipacao_registrar((select prev_o from ctx), '2026-11-02', '2026-11-06', 't2', (
  select jsonb_build_array(jsonb_build_object('origem','ANTECIPACAO_SEMANA_SEGUINTE','semana_destino','2026-11-09','data','2026-11-06','periodo_id','t3','produto_id',prod,'etapa_id',et,'etapa_idx',0,'etapa_final',true,'maquina_id',maq,'funcionario_id',func,'quantidade',2000,'meta_minima_producao',108000,'quantidade_alem_da_meta',0)) from ctx), 'hashB', null);
select pg_temp.reg('T1 (período iniciado) continua vigente (ANT 5000 + DEMANDA 200)', '2', (select count(*)::text from public.escala_antecipacoes where periodo_id='t1' and substituida_em is null));
select pg_temp.reg('T2/T3 antigas substituídas por hashB', '2', (select count(*)::text from public.escala_antecipacoes where substituida_em is not null and substituida_por_hash='hashB' and periodo_id in ('t2','t3')));
select pg_temp.reg('vigentes de T2 = 0; de T3 = 1 (2000)', '0:2000', (select (select count(*) from public.escala_antecipacoes where periodo_id='t2' and substituida_em is null)::text||':'||(select quantidade::int from public.escala_antecipacoes where periodo_id='t3' and substituida_em is null)));
select pg_temp.reg('nada é apagado: histórico completo (5 linhas até aqui)', '5', (select count(*)::text from public.escala_antecipacoes));
-- gravar em período congelado é recusado
select pg_temp.regp('linha em período congelado (T1 com corte T2) recusada', 'ANTECIPACAO_PERIODO_CONGELADO', pg_temp.tenta($q$select public.escala_antecipacao_registrar((select prev_o from ctx), '2026-11-02', '2026-11-06', 't2', jsonb_build_array(jsonb_build_object('origem','FORMACAO_ESTOQUE','data','2026-11-06','periodo_id','t1','produto_id',(select prod from ctx),'etapa_id',(select et from ctx),'etapa_idx',0,'etapa_final',true,'maquina_id',(select maq from ctx),'quantidade',1)), 'hashC', null)$q$));

-- META MÍNIMA: colunas novas gravadas e lidas; linhas antigas (sem as chaves) ficam NULL/0; a view responde sem erro
select public.escala_antecipacao_registrar((select prev_o from ctx), '2026-11-02', '2026-11-06', 't3', (
  select jsonb_build_array(jsonb_build_object('origem','FORMACAO_ESTOQUE','semana_destino','2026-11-09','data','2026-11-06','periodo_id','t3','produto_id',prod,'etapa_id',et,'etapa_idx',0,'etapa_final',true,'maquina_id',maq,'funcionario_id',func,'quantidade',500,'meta_minima_producao',108000,'quantidade_alem_da_meta',500)) from ctx), 'hashD', null);
select pg_temp.reg('meta mínima e quantidade além da meta gravadas', '108000:500', (select meta_minima_producao::int||':'||quantidade_alem_da_meta::int from public.escala_antecipacoes where plano_hash='hashD' and substituida_em is null));
select pg_temp.reg('linha sem as chaves novas: meta NULL e além da meta 0', 'true', (select (meta_minima_producao is null and quantidade_alem_da_meta = 0)::text from public.escala_antecipacoes where plano_hash='hashA' limit 1));
select pg_temp.reg('view escala_meta_estoque_v responde (meta × planejada × real × formação)', 'true', (select (count(*) >= 0)::text from public.escala_meta_estoque_v));

-- APPEND-ONLY
select pg_temp.regp('DELETE recusado', 'ANTECIPACAO_APPEND_ONLY', pg_temp.tenta('delete from public.escala_antecipacoes'));
select pg_temp.regp('UPDATE de quantidade recusado', 'ANTECIPACAO_APPEND_ONLY', pg_temp.tenta($q$update public.escala_antecipacoes set quantidade = 1$q$));
select pg_temp.regp('TRUNCATE recusado', 'ANTECIPACAO_APPEND_ONLY', pg_temp.tenta('truncate public.escala_antecipacoes'));
select pg_temp.regp('reabrir linha substituída recusado', 'ANTECIPACAO_APPEND_ONLY', pg_temp.tenta($q$update public.escala_antecipacoes set substituida_em = null where substituida_em is not null$q$));
select pg_temp.regp('ORIGEM inválida recusada', 'new row for relation "escala_antecipacoes" violates check constraint', pg_temp.tenta($q$insert into public.escala_antecipacoes (origem,semana_origem,previsao_origem_id,data,periodo_id,produto_id,etapa_id,etapa_idx,etapa_final,maquina_id,quantidade,plano_hash) select 'OUTRA','2026-11-02',prev_o,'2026-11-06','t3',prod,et,0,true,maq,1,'h' from ctx$q$));
select pg_temp.regp('ANTECIPAÇÃO sem semana_destino recusada', 'new row for relation "escala_antecipacoes" violates check constraint', pg_temp.tenta($q$insert into public.escala_antecipacoes (origem,semana_origem,previsao_origem_id,data,periodo_id,produto_id,etapa_id,etapa_idx,etapa_final,maquina_id,quantidade,plano_hash) select 'ANTECIPACAO_SEMANA_SEGUINTE','2026-11-02',prev_o,'2026-11-06','t3',prod,et,0,true,maq,1,'h' from ctx$q$));

-- RLS: sem políticas e sem grant para anon/authenticated
select pg_temp.reg('RLS ligada', 'true', (select relrowsecurity::text from pg_class where oid='public.escala_antecipacoes'::regclass));
select pg_temp.reg('anon/authenticated sem acesso', '0', (select count(*)::text from information_schema.role_table_grants where table_name='escala_antecipacoes' and grantee in ('anon','authenticated','PUBLIC') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')));

-- chaves de parâmetro NÃO disparam recálculo
create temp table antes as select count(*) n from public.escala_producao_eventos;
insert into public.escala_parametros (chave, valor, grupo) values ('escala_antecipacao_modo','"ativo"','operacional'), ('escala_formacao_estoque_produtos','[]','operacional'), ('escala_formacao_estoque_desconta_destino','false','operacional')
  on conflict (chave) do update set valor = excluded.valor;
update public.escala_parametros set valor='"desligado"' where chave='escala_antecipacao_modo';
select pg_temp.reg('parâmetros da regra não geram evento de recálculo', '0', (select (count(*) - (select n from antes))::text from public.escala_producao_eventos));
delete from public.escala_producao_eventos where tipo = 'previsao' and status = 'pendente'; -- o registrar_evento deduplica pendentes do mesmo tipo/previsão
create temp table antes2 as select count(*) n from public.escala_producao_eventos;
insert into public.escala_parametros (chave, valor, grupo) values ('chave_generica_teste','1','operacional');
select pg_temp.reg('outra chave de parâmetro continua disparando recálculo (padrão preservado)', 'true', ((select count(*) from public.escala_producao_eventos) > (select n from antes2))::text);

select caso, esperado, obtido, case when ok then 'OK' else 'FALHOU' end as r from res order by ok, caso;
select 'TESTES: ' || count(*) filter (where ok) || ' ok / ' || count(*) filter (where not ok) || ' falharam' from res;
rollback;

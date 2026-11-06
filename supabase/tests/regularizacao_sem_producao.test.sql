-- Regularização SEM PRODUÇÃO (clone de PROD). Transação com rollback.
begin;
create or replace function pg_temp.chk(ok boolean, msg text) returns void language plpgsql as $f$ begin if not coalesce(ok,false) then raise exception 'FALHOU: %', msg; end if; raise notice 'PASS: %', msg; end $f$;
create or replace function pg_temp.tenta(q text) returns text language plpgsql as $f$ begin execute q; return 'ok'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.tenta(text) to public;
create temp table ctx as select (select auth_user_id from usuarios where papel='admin' and ativo and auth_user_id is not null order by nome limit 1) adm_auth;
grant select on ctx to public;
select set_config('request.jwt.claims', json_build_object('sub',(select adm_auth from ctx),'role','authenticated')::text, true);
create temp table antes as select (select count(*) from escala_producao_eventos) ev, (select count(*) from escala_fechamentos) fech, (select count(*) from escala_buffers_fisicos) inv,
  (select md5(string_agg(a::text,'|' order by a::text)) from escala_producao_alocacoes a where a.data >= '2026-11-06') aloc;
create temp table m as select ma.id mq from maquinas ma where ma.ativo and not exists (select 1 from apontamentos_producao x where x.data='2026-11-05' and x.periodo_id in ('t1','t2') and x.maquina_id=ma.id)
  and exists (select 1 from roteiro_etapa_maquinas rem join roteiro_etapas re on re.id=rem.etapa_id where rem.maquina_id=ma.id and re.meta_t2>0) order by ma.nome limit 1;
grant select on m to public;
set local role authenticated;
create temp table r1 as select regularizar_sem_producao_historico('2026-11-05','t1',(select mq from m),'outro','máquina realocada') j;
select pg_temp.chk((select j->>'acao' from r1)='INCLUIDO', 'sem produção: INCLUIDO (data de ontem, período confirmado/aberto, máquina qualquer)');
select pg_temp.chk(pg_temp.tenta(format('select regularizar_sem_producao_historico(%L,%L,%L,%L)','2026-11-05','t1',(select mq from m),'falta_material')) like 'REGULARIZACAO_JA_EXISTE%', 'não duplica');
select pg_temp.chk(pg_temp.tenta(format('select regularizar_sem_producao_historico(%L,%L,%L,%L)','2026-11-05','t2',(select mq from m),'outro')) like 'MOTIVO_INVALIDO%', 'motivo outro exige descrição');
select pg_temp.chk(pg_temp.tenta(format('select regularizar_sem_producao_historico(%L,%L,%L,%L)','2026-11-05','t2',(select mq from m),'xyz')) like 'MOTIVO_INVALIDO%', 'motivo inválido bloqueia');
select regularizar_sem_producao_historico('2026-11-05','t1',(select mq from m),'falta_operador',null,(select (j->>'apontamento_id')::uuid from r1)) j2 \gset
reset role;
select pg_temp.chk((select motivo_sem_producao='falta_operador' and descricao_sem_producao is null and status='sem_producao' and quantidade_produzida=0 from apontamentos_producao where id=(select (j->>'apontamento_id')::uuid from r1)), 'editar sem produção por id (motivo trocado)');
select pg_temp.chk((select count(*) from apontamento_regularizacao_historica where acao in ('INCLUIDO','ALTERADO') and novo->>'status'='sem_producao')=2, 'auditoria: 2 linhas (incluído + alterado) com anterior/novo');
-- converter produção → sem produção e de volta
set local role authenticated;
create temp table prod as select regularizar_apontamento_historico('2026-11-05','t2',(select mq from m),(select id from funcionarios_elegibilidade where ativo order by nome limit 1),
  (select re.produto_id from roteiro_etapa_maquinas rem join roteiro_etapas re on re.id=rem.etapa_id where rem.maquina_id=(select mq from m) and re.meta_t2>0 limit 1),100,0) j;
select regularizar_sem_producao_historico('2026-11-05','t2',(select mq from m),'sem_programacao',null,(select (j->>'apontamento_id')::uuid from prod)) j3 \gset
reset role;
select pg_temp.chk((select status='sem_producao' and produto_id is null and funcionario_id is null and meta_periodo_vigente is null from apontamentos_producao where id=(select (j->>'apontamento_id')::uuid from prod)), 'produção → sem produção em linha existente');
select pg_temp.chk((select count(*) from escala_producao_eventos)=(select ev from antes) and (select count(*) from escala_fechamentos)=(select fech from antes) and (select count(*) from escala_buffers_fisicos)=(select inv from antes)
  and (select md5(string_agg(a::text,'|' order by a::text)) from escala_producao_alocacoes a where a.data >= '2026-11-06') is not distinct from (select aloc from antes), 'sem recálculo: eventos, fechamentos, inventário e escala de hoje idênticos');
rollback;

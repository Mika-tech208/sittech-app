-- Regularização histórica para HOJE (M1) — clone de PROD, transação com rollback. Rodar com o relógio entre 08:48 e 12:59 (M1 iniciado; T1–T3 ainda não).
begin;
create or replace function pg_temp.chk(ok boolean, msg text) returns void language plpgsql as $f$ begin if not coalesce(ok,false) then raise exception 'FALHOU: %', msg; end if; raise notice 'PASS: %', msg; end $f$;
create or replace function pg_temp.tenta(q text) returns text language plpgsql as $f$ begin execute q; return 'ok'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.tenta(text) to public;
create temp table ctx as select (select auth_user_id from usuarios where papel='admin' and ativo and auth_user_id is not null order by nome limit 1) adm_auth, (select auth_user_id from usuarios where nome like 'Elizabeth%' limit 1) eli_auth,
  (now() at time zone 'America/Sao_Paulo')::date hoje;
grant select on ctx to public;
select set_config('request.jwt.claims', json_build_object('sub',(select adm_auth from ctx),'role','authenticated')::text, true);
create temp table antes as select (select count(*) from escala_producao_eventos) ev, (select md5(string_agg(a::text,'|' order by a::text)) from escala_producao_alocacoes a where a.data >= (select hoje from ctx)) aloc,
  (select md5(string_agg(a::text,'|' order by a::text)) from escala_producao_dias a where a.data >= (select hoje from ctx)) dias,
  (select count(*) from escala_buffers_fisicos) inv, (select count(*) from escala_fechamentos) fech, (select count(*) from escala_fechamento_log) logf, (select count(*) from escala_fechamento_plano) plano;
create temp table esc as select a.maquina_id mp, a.funcionario_id fp, a.produto_id pp, a.etapa_id ep from escala_producao_alocacoes a where a.data=(select hoje from ctx) and a.periodo_id='m1' and a.maquina_id is not null and a.produto_id is not null order by a.maquina_id limit 2;
create temp table nao as select m.id mn, re.produto_id pn, re.id en from maquinas m join roteiro_etapa_maquinas rem on rem.maquina_id=m.id join roteiro_etapas re on re.id=rem.etapa_id join produtos p on p.id=re.produto_id and p.ativo
  where m.ativo and re.meta_m1>0 and not exists (select 1 from escala_producao_alocacoes a where a.data=(select hoje from ctx) and a.periodo_id='m1' and a.maquina_id=m.id) order by m.nome limit 1;
create temp table fun as select (select id from funcionarios_elegibilidade where ativo order by nome limit 1) f1, (select id from funcionarios_elegibilidade where ativo order by nome desc limit 1) f2;
grant select on esc, nao, fun to public;
set local role authenticated;
-- sem liberar a data de hoje: recusa
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,10,0)',(select hoje from ctx),'m1',(select mn from nao),(select f1 from fun),(select pn from nao))) like 'REGULARIZACAO_DATA_NAO_LIBERADA%', 'hoje NÃO liberado ⇒ recusa');
reset role;
insert into regularizacao_historica_datas(data, liberado_por) values ((select hoje from ctx), 'teste');
set local role authenticated;
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,10,0)',(select hoje from ctx)+1,'m1',(select mn from nao),(select f1 from fun),(select pn from nao))) like 'REGULARIZACAO_DATA_INVALIDA%', 'data futura sempre recusada');
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,10,0)',(select hoje from ctx),'t3',(select mn from nao),(select f1 from fun),(select pn from nao))) like 'PERIODO_NAO_INICIADO%', 'período de hoje que ainda não começou ⇒ recusa');
create temp table r1 as select regularizar_apontamento_historico((select hoje from ctx),'m1',(select mn from nao),(select f2 from fun),(select pn from nao),321,3,(select en from nao)) j;
create temp table r2 as select regularizar_apontamento_historico((select hoje from ctx),'m1',(select mp from esc limit 1),(select f1 from fun),(select pp from esc limit 1),1500,10) j;
select regularizacao_historica_estado((select hoje from ctx)) est \gset
reset role;
select pg_temp.chk((select j->>'acao' from r1)='INCLUIDO' and (select j->>'acao' from r2)='INCLUIDO', 'hoje M1 liberado: máquina NÃO programada e posto programado (operador diferente) ⇒ INCLUIDO');
select pg_temp.chk((:'est'::jsonb->'datas') @> to_jsonb(array[(select hoje::text from ctx)]) and jsonb_array_length(:'est'::jsonb->'apontamentos')=2, 'tela lista a data de hoje e os 2 apontamentos');
select pg_temp.chk((select count(*) from apontamento_regularizacao_historica where data=(select hoje from ctx) and origem='REGULARIZACAO_HISTORICA')=2, 'auditoria dos 2 lançamentos de hoje');
-- nada de recálculo
select pg_temp.chk((select count(*) from escala_producao_eventos)=(select ev from antes), 'nenhum evento de recálculo criado');
select pg_temp.chk((select md5(string_agg(a::text,'|' order by a::text)) from escala_producao_alocacoes a where a.data >= (select hoje from ctx)) is not distinct from (select aloc from antes) and (select md5(string_agg(a::text,'|' order by a::text)) from escala_producao_dias a where a.data >= (select hoje from ctx)) is not distinct from (select dias from antes), 'escala de hoje/futuro idêntica');
select pg_temp.chk((select count(*) from escala_buffers_fisicos)=(select inv from antes) and (select count(*) from escala_fechamentos)=(select fech from antes) and (select count(*) from escala_fechamento_log)=(select logf from antes) and (select count(*) from escala_fechamento_plano)=(select plano from antes), 'inventário e fechamentos idênticos');
-- convivência com o fluxo normal
create temp table outra as select a.maquina_id mo, a.funcionario_id fo, a.produto_id po from escala_producao_alocacoes a where a.data=(select hoje from ctx) and a.periodo_id='m1' and a.maquina_id is not null and a.produto_id is not null and a.maquina_id <> (select mp from esc limit 1) order by a.maquina_id desc limit 1;
grant select on outra to public;
-- a Elizabeth ainda lança as OUTRAS máquinas pelo fluxo único e o apontamento regularizado é preservado
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select eli_auth from ctx),'role','authenticated')::text, true);

select pg_temp.tenta(format('select registrar_apontamentos_fechamento(%L,%L,%L::jsonb)',(select hoje from ctx),'m1',
  (select jsonb_build_array(jsonb_build_object('chave',gen_random_uuid(),'maquina_planejada_id',mo,'maquina_id',mo,'produto_id',po,'funcionario_id',fo,'produzido',700,'refugo',0,'nao_produziu',false))::text from outra))) fluxo \gset
reset role;
select pg_temp.chk(:'fluxo' = 'ok', 'fluxo normal (Elizabeth) lança outra máquina do M1 mesmo com regularização feita (resultado: ' || :'fluxo' || ')');
select pg_temp.chk((select count(*) from apontamentos_producao where data=(select hoje from ctx) and periodo_id='m1')=3, 'M1 de hoje com 3 apontamentos (2 regularizados preservados + 1 do fluxo normal)');
rollback;

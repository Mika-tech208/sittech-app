-- Testes da REGULARIZAÇÃO HISTÓRICA (rodar no clone de PROD; tudo em transação com rollback)
begin;
create or replace function pg_temp.chk(ok boolean, msg text) returns void language plpgsql as $f$ begin if not coalesce(ok,false) then raise exception 'FALHOU: %', msg; end if; raise notice 'PASS: %', msg; end $f$;
create or replace function pg_temp.tenta(q text) returns text language plpgsql as $f$ begin execute q; return 'ok'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.tenta(text) to public;

create temp table ctx as select
  (select auth_user_id from usuarios where papel='admin' and ativo and auth_user_id is not null order by nome limit 1) adm_auth,
  (select auth_user_id from usuarios where nome like 'Elizabeth%' limit 1) eli_auth,
  (select id from usuarios where nome like 'Elizabeth%' limit 1) eli;
grant select on ctx to public;
select set_config('request.jwt.claims', json_build_object('sub',(select adm_auth from ctx),'role','authenticated')::text, true);   -- a view funcionarios_elegibilidade filtra por auth.uid()
insert into regularizacao_historica_datas(data, observacao) values ('2026-11-05', 'teste');
-- escolhas: uma máquina QUE NÃO tinha apontamento no m1 de ontem + produto elegível; outro operador; outro produto
create temp table esc as
select m.id maq, re.produto_id prod, re.id etapa from maquinas m join roteiro_etapa_maquinas rem on rem.maquina_id=m.id join roteiro_etapas re on re.id=rem.etapa_id join produtos p on p.id=re.produto_id and p.ativo
 where m.ativo and re.meta_m1 > 0 and re.meta_t3 > 0 and not exists (select 1 from apontamentos_producao a where a.maquina_id=m.id and a.data='2026-11-05' and a.periodo_id='m1')
 order by m.nome, p.nome limit 1;
create temp table esc2 as
select re.produto_id prod2, re.id etapa2 from roteiro_etapas re join roteiro_etapa_maquinas rem on rem.etapa_id=re.id join produtos p on p.id=re.produto_id and p.ativo
 where rem.maquina_id=(select maq from esc) and re.id <> (select etapa from esc) and re.meta_m1>0 limit 1;
create temp table fun as select (select id from funcionarios_elegibilidade where ativo order by nome limit 1) f1, (select id from funcionarios_elegibilidade where ativo order by nome desc limit 1) f2;
grant select on esc, esc2, fun to public;
create temp table antes as select
  (select count(*) from escala_producao_eventos) ev, (select count(*) from escala_producao_eventos where status='pendente') ev_pend,
  (select md5(string_agg(a::text, '|' order by a::text)) from escala_producao_alocacoes a where a.data >= '2026-11-06') aloc_hoje,
  (select count(*) from escala_fechamentos) fech, (select count(*) from escala_fechamento_plano) plano,
  (select count(*) from escala_buffers_fisicos) cont, (select count(*) from escala_fechamento_log) logf,
  (select string_agg(periodo_id||estado, ',' order by periodo_id) from escala_fechamento_estado where data='2026-11-05') est;
select pg_temp.chk((select estado from escala_fechamento_estado where data='2026-11-05' and periodo_id='m1')='CONFIRMADO', 'pré: M1 de ontem está CONFIRMADO');
select pg_temp.chk((select maq from esc) is not null, 'pré: máquina sem apontamento no M1 de ontem encontrada');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select adm_auth from ctx),'role','authenticated')::text, true);

-- A/B/C/D: máquina fora da escala, operador e produto quaisquer, período CONFIRMADO ⇒ permite
create temp table r1 as select regularizar_apontamento_historico('2026-11-05','m1',(select maq from esc),(select f1 from fun),(select prod from esc),1234,12) j;
select pg_temp.chk((select j->>'acao' from r1)='INCLUIDO', 'A/B/C/D: máquina não programada + operador/produto livres em período CONFIRMADO ⇒ INCLUIDO');
reset role;
select pg_temp.chk((select quantidade_produzida=1234 and quantidade_refugo=12 and observacao='Ajuste devido à realocação física de máquinas e operadores' and status='produzindo' from apontamentos_producao where id=(select (j->>'apontamento_id')::uuid from r1)), 'registro gravado com produzido/refugo e observação automática');
select pg_temp.chk((select acao='INCLUIDO' and origem='REGULARIZACAO_HISTORICA' and usuario_id is not null and anterior is null and novo is not null and em is not null from apontamento_regularizacao_historica order by em desc limit 1), 'auditoria: usuário, timestamp, origem, anterior nulo, novo');

-- F: já existe ⇒ não duplica sem pedir; edita (por id) e substitui (por chave) sem duplicata
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select adm_auth from ctx),'role','authenticated')::text, true);
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,5,0)','2026-11-05','m1',(select maq from esc),(select f2 from fun),(select prod from esc))) like 'REGULARIZACAO_JA_EXISTE%', 'F: lançar de novo na mesma máquina/período é recusado (sem duplicata acidental)');
select regularizar_apontamento_historico('2026-11-05','m1',(select maq from esc),(select f2 from fun),(select prod from esc),2000,20,null,(select (j->>'apontamento_id')::uuid from r1)) j2 \gset
select regularizar_apontamento_historico('2026-11-05','m1',(select maq from esc),(select f1 from fun),(select prod from esc),2100,21,null,null,true) j3 \gset
reset role;
select pg_temp.chk((select count(*) from apontamentos_producao where data='2026-11-05' and periodo_id='m1' and maquina_id=(select maq from esc))=1, 'F: editar e substituir mantêm UMA linha (sem duplicata)');
select pg_temp.chk((select quantidade_produzida=2100 from apontamentos_producao where data='2026-11-05' and periodo_id='m1' and maquina_id=(select maq from esc)), 'F: substituição aplicada');
select pg_temp.chk((select count(*) from apontamento_regularizacao_historica where acao='ALTERADO' and anterior is not null and novo is not null)=2, 'auditoria: 2 ALTERADO com anterior e novo');
select pg_temp.chk((select count(*) from apontamento_producao_historico h where h.apontamento_id=(select (j->>'apontamento_id')::uuid from r1) and h.motivo like 'REGULARIZACAO_HISTORICA%')=2, 'histórico de edição do apontamento também registrado');

-- C (produto diferente) na mesma máquina, trocando de produto
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select adm_auth from ctx),'role','authenticated')::text, true);
select regularizar_apontamento_historico('2026-11-05','m1',(select maq from esc),(select f1 from fun),(select prod2 from esc2),300,0,(select etapa2 from esc2),null,true) j4 \gset
reset role;
select pg_temp.chk((select produto_id=(select prod2 from esc2) from apontamentos_producao where data='2026-11-05' and periodo_id='m1' and maquina_id=(select maq from esc)), 'C: produto diferente aceito');

-- E: combinação inválida / quantidades / entidades inválidas bloqueiam
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select adm_auth from ctx),'role','authenticated')::text, true);
create temp table inval as select p.id prod_x from produtos p where p.ativo and not exists (select 1 from roteiro_etapas re join roteiro_etapa_maquinas rem on rem.etapa_id=re.id where re.produto_id=p.id and rem.maquina_id=(select maq from esc)) limit 1;
grant select on inval to public;
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,10,0)','2026-11-05','m2',(select maq from esc),(select f1 from fun),(select prod_x from inval))) like 'COMBINACAO_INVALIDA%', 'E: combinação máquina/produto impossível ⇒ bloqueia');
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,-1,0)','2026-11-05','m2',(select maq from esc),(select f1 from fun),(select prod from esc))) like 'QUANTIDADE_INVALIDA%', 'quantidade negativa ⇒ bloqueia');
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,10,11)','2026-11-05','m2',(select maq from esc),(select f1 from fun),(select prod from esc))) like 'QUANTIDADE_INVALIDA%', 'refugo > produzido ⇒ bloqueia');
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,10,0)','2026-11-05','zz',(select maq from esc),(select f1 from fun),(select prod from esc))) like 'PERIODO_INVALIDO%', 'período inválido ⇒ bloqueia');
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,10,0)','2026-11-05','m2',(select maq from esc),gen_random_uuid(),(select prod from esc))) like 'FUNCIONARIO_INVALIDO%', 'funcionário inexistente ⇒ bloqueia');
-- escopo: hoje / data não liberada / sem permissão
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,10,0)',(now() at time zone 'America/Sao_Paulo')::date,'m2',(select maq from esc),(select f1 from fun),(select prod from esc))) like 'REGULARIZACAO_DATA_INVALIDA%', 'hoje nunca é regularizável');
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,10,0)','2026-11-03','m2',(select maq from esc),(select f1 from fun),(select prod from esc))) like 'REGULARIZACAO_DATA_NAO_LIBERADA%', 'data não liberada ⇒ bloqueia');
select set_config('request.jwt.claims', json_build_object('sub',(select eli_auth from ctx),'role','authenticated')::text, true);
select pg_temp.chk(pg_temp.tenta(format('select regularizar_apontamento_historico(%L,%L,%L,%L,%L,10,0)','2026-11-05','m2',(select maq from esc),(select f1 from fun),(select prod from esc))) like 'REGULARIZACAO_SEM_PERMISSAO%', 'Elizabeth (sem perfil superior) não usa a regularização');
select pg_temp.chk(pg_temp.tenta('select regularizacao_historica_estado(''2026-11-05'')') like 'REGULARIZACAO_SEM_PERMISSAO%', 'estado da tela também restrito');
-- fluxo normal continua bloqueando período confirmado (linha criada pela própria Elizabeth: a RLS deixa chegar ao gatilho)
select pg_temp.chk(pg_temp.tenta('update apontamentos_producao set quantidade_produzida=quantidade_produzida+1 where id=(select id from apontamentos_producao where data=''2026-11-05'' and periodo_id=''m1'' and criado_por=(select eli from ctx) limit 1)') like 'FECHAMENTO_PERIODO_EM_FECHAMENTO%', 'fluxo normal: edição direta de período CONFIRMADO segue BLOQUEADA');
select set_config('request.jwt.claims', json_build_object('sub',(select adm_auth from ctx),'role','authenticated')::text, true);

-- exclusão auditada
create temp table r5 as select regularizar_apontamento_historico('2026-11-05','t3',(select maq from esc),(select f1 from fun),(select prod from esc),10,0) j;
select regularizar_excluir_apontamento_historico((select (j->>'apontamento_id')::uuid from r5)) ex \gset
select regularizacao_historica_estado('2026-11-05') est \gset
reset role;
select pg_temp.chk((select acao='EXCLUIDO' and anterior is not null and novo is null from apontamento_regularizacao_historica order by em desc limit 1), 'exclusão auditada com o registro anterior completo');
select pg_temp.chk(not exists (select 1 from apontamentos_producao where id=(select (j->>'apontamento_id')::uuid from r5)), 'registro excluído');
select pg_temp.chk((:'est'::jsonb->'apontamentos') is not null and jsonb_array_length(:'est'::jsonb->'combinacoes')>0 and jsonb_array_length(:'est'::jsonb->'maquinas')=22, 'estado da tela: apontamentos do dia, combinações e as 22 máquinas ativas');

-- G: NADA de recálculo / escala de hoje / inventário / fechamento foi tocado
select pg_temp.chk((select count(*) from escala_producao_eventos)=(select ev from antes), 'G: nenhum evento de recálculo criado');
select pg_temp.chk((select count(*) from escala_producao_eventos where status='pendente')=(select ev_pend from antes), 'G: fila pendente inalterada');
select pg_temp.chk((select md5(string_agg(a::text, '|' order by a::text)) from escala_producao_alocacoes a where a.data >= '2026-11-06') is not distinct from (select aloc_hoje from antes), 'G: escala de hoje/futuro idêntica');
select pg_temp.chk((select count(*) from escala_fechamentos)=(select fech from antes) and (select count(*) from escala_fechamento_plano)=(select plano from antes) and (select count(*) from escala_fechamento_log)=(select logf from antes), 'G: fechamentos/vínculos/log inalterados');
select pg_temp.chk((select count(*) from escala_buffers_fisicos)=(select cont from antes), 'G: inventário físico inalterado');
select pg_temp.chk((select string_agg(periodo_id||estado, ',' order by periodo_id) from escala_fechamento_estado where data='2026-11-05') is not distinct from (select est from antes), 'G: estados dos períodos de ontem seguem CONFIRMADO');
rollback;

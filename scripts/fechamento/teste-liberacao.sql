\set ON_ERROR_STOP on
begin;
update public.escala_parametros set valor='"ativo"'::jsonb where chave='escala_fechamento_fisico_modo';
create temp table res(caso text, esperado text, obtido text, ok boolean);
create or replace function pg_temp.lib(p_data date, p_per text) returns text language sql as $$ select (public.escala_periodo_liberacao(p_data,p_per) ->> 'liberado') || ':' || (public.escala_periodo_liberacao(p_data,p_per) ->> 'motivo') $$;
create or replace function pg_temp.reg(c text, e text, o text) returns void language sql as $$ insert into res values (c, e, o, e = o) $$;

select pg_temp.reg('M1 04/11 (transição)', 'true:TRANSICAO', pg_temp.lib('2026-11-04','m1'));
select pg_temp.reg('M2 04/11 (transição)', 'true:TRANSICAO', pg_temp.lib('2026-11-04','m2'));
select pg_temp.reg('T1: M3 antiga no banco, nenhum fechamento (teste 1/2: apontamentos 8/12 ou 12/12 sem WIP)', 'false:AGUARDANDO_FECHAMENTO', pg_temp.lib('2026-11-04','m3'));
select pg_temp.reg('T1 04/11 sem fechamento de M3', 'false:AGUARDANDO_FECHAMENTO', pg_temp.lib('2026-11-04','t1'));

-- fechamento M2 em RECALCULANDO (teste 3)
insert into public.escala_fechamentos (semana_inicio,data,periodo_id,revisao,iniciado_em,contado_em,instante_motor,postos_esperados,postos_coletados,buffers_obrigatorios,hash_resumo,chave_idempotencia)
 values ('2026-11-02','2026-11-04','m2',1,now(),now(),now(),12,12,5,'x','11111111-1111-4111-8111-111111111111');
insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) select id,'RECALCULANDO','{}' from public.escala_fechamentos where chave_idempotencia='11111111-1111-4111-8111-111111111111';
select pg_temp.reg('teste 3: RECALCULANDO', 'false:RECALCULANDO', pg_temp.lib('2026-11-04','m3'));
-- ERRO_RECALCULO (teste 4)
insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) select id,'ERRO_RECALCULO','{"erro":"x"}' from public.escala_fechamentos where chave_idempotencia='11111111-1111-4111-8111-111111111111';
select pg_temp.reg('teste 4: ERRO_RECALCULO', 'false:ERRO_RECALCULO', pg_temp.lib('2026-11-04','m3'));
-- CONFIRMADO mas SEM o plano gerado por ele (teste 5) — existe um diagnóstico 'fechamento' OUTRO (hash diferente), como o recálculo legado das 08:59
insert into public.escala_fluxo_diagnosticos (previsao_id,semana_inicio,gatilho,modo,versao_motor,hash_entrada,hash_plano_fluxo,aplicado)
 select id,'2026-11-02','fechamento','ativo','fluxo-v2','h0','OUTROHASH',true from public.previsoes limit 1;
insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) select id,'CONFIRMADO','{"hash_plano_novo":"HASHM3"}' from public.escala_fechamentos where chave_idempotencia='11111111-1111-4111-8111-111111111111';
select pg_temp.reg('teste 5: CONFIRMADO sem o plano gerado por este fechamento', 'false:CONFIRMADO_SEM_PLANO', pg_temp.lib('2026-11-04','m3'));
-- plano existe mas NÃO aplicado
insert into public.escala_fluxo_diagnosticos (previsao_id,semana_inicio,gatilho,modo,versao_motor,hash_entrada,hash_plano_fluxo,aplicado)
 select id,'2026-11-02','fechamento','ativo','fluxo-v2','h1','HASHM3',false from public.previsoes limit 1;
select pg_temp.reg('plano com o hash certo mas NÃO aplicado', 'false:CONFIRMADO_SEM_PLANO', pg_temp.lib('2026-11-04','m3'));
-- hash aplicado, mas o plano do dia NÃO foi regravado depois do fechamento (plano antigo) — não libera
insert into public.escala_fluxo_diagnosticos (previsao_id,semana_inicio,gatilho,modo,versao_motor,hash_entrada,hash_plano_fluxo,aplicado)
 select id,'2026-11-02','fechamento','ativo','fluxo-v2','h1b','HASHM3',true from public.previsoes limit 1;
update public.escala_producao_dias set atualizado_em = now() - interval '1 day' where data = '2026-11-04';
select pg_temp.reg('hash aplicado mas plano do dia NÃO regravado após o fechamento', 'false:CONFIRMADO_SEM_PLANO', pg_temp.lib('2026-11-04','m3'));
update public.escala_producao_dias set atualizado_em = now() + interval '5 seconds' where data = '2026-11-04';
-- plano gerado POR ESTE fechamento persistido (teste 6)
insert into public.escala_fluxo_diagnosticos (previsao_id,semana_inicio,gatilho,modo,versao_motor,hash_entrada,hash_plano_fluxo,aplicado)
 select id,'2026-11-02','fechamento','ativo','fluxo-v2','h2','HASHM3',true from public.previsoes limit 1;
select pg_temp.reg('teste 6: CONFIRMADO + plano gerado persistido', 'true:CONFIRMADO', pg_temp.lib('2026-11-04','m3'));
-- T1 depende do fechamento de M3, não do de M2
select pg_temp.reg('T1 continua invisível mesmo com M2 confirmado e T1 planejada no banco', 'false:AGUARDANDO_FECHAMENTO', pg_temp.lib('2026-11-04','t1'));
insert into public.escala_fechamentos (semana_inicio,data,periodo_id,revisao,iniciado_em,contado_em,instante_motor,postos_esperados,postos_coletados,buffers_obrigatorios,hash_resumo,chave_idempotencia)
 values ('2026-11-02','2026-11-04','m3',1,now(),now(),now(),12,12,5,'x','22222222-2222-4222-8222-222222222222');
insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) select id,'RECALCULANDO','{}' from public.escala_fechamentos where chave_idempotencia='22222222-2222-4222-8222-222222222222';
insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) select id,'CONFIRMADO','{"hash_plano_novo":"HASHT1"}' from public.escala_fechamentos where chave_idempotencia='22222222-2222-4222-8222-222222222222';
select pg_temp.reg('M3 confirmado SEM plano T1 persistido: T1 invisível', 'false:CONFIRMADO_SEM_PLANO', pg_temp.lib('2026-11-04','t1'));
update public.escala_producao_dias set atualizado_em = now() + interval '10 seconds' where data = '2026-11-04';
insert into public.escala_fluxo_diagnosticos (previsao_id,semana_inicio,gatilho,modo,versao_motor,hash_entrada,hash_plano_fluxo,aplicado)
 select id,'2026-11-02','fechamento','ativo','fluxo-v2','h3','HASHT1',true from public.previsoes limit 1;
select pg_temp.reg('M3 confirmado + plano T1 persistido: T1 visível', 'true:CONFIRMADO', pg_temp.lib('2026-11-04','t1'));
select pg_temp.reg('T2 ainda invisível (depende de T1)', 'false:AGUARDANDO_FECHAMENTO', pg_temp.lib('2026-11-04','t2'));
select pg_temp.reg('M1 do dia seguinte depende de T3 de hoje', 'false:AGUARDANDO_FECHAMENTO', pg_temp.lib('2026-11-05','m1'));
-- T3 → M1 do dia seguinte: mesma regra
insert into public.escala_fechamentos (semana_inicio,data,periodo_id,revisao,iniciado_em,contado_em,instante_motor,postos_esperados,postos_coletados,buffers_obrigatorios,hash_resumo,chave_idempotencia)
 values ('2026-11-02','2026-11-04','t3',1,now(),now(),now(),12,12,5,'x','33333333-3333-4333-8333-333333333333');
insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) select id,'CONFIRMADO','{"hash_plano_novo":"HASHM1"}' from public.escala_fechamentos where chave_idempotencia='33333333-3333-4333-8333-333333333333';
select pg_temp.reg('T3 confirmado SEM plano do M1 seguinte: M1 invisível', 'false:CONFIRMADO_SEM_PLANO', pg_temp.lib('2026-11-05','m1'));
insert into public.escala_fluxo_diagnosticos (previsao_id,semana_inicio,gatilho,modo,versao_motor,hash_entrada,hash_plano_fluxo,aplicado)
 select id,'2026-11-02','fechamento','ativo','fluxo-v2','h4','HASHM1',true from public.previsoes limit 1;
update public.escala_producao_dias set atualizado_em = now() + interval '20 seconds' where data = '2026-11-05';
select pg_temp.reg('T3 confirmado + plano do M1 seguinte persistido: M1 visível', 'true:CONFIRMADO', pg_temp.lib('2026-11-05','m1'));
-- fechamento em SOMBRA não libera
update public.escala_parametros set valor='"sombra"'::jsonb where chave='escala_fechamento_fisico_modo';
select pg_temp.reg('modo sombra: não bloqueia (como antes)', 'true:MODO_NAO_ATIVO', pg_temp.lib('2026-11-04','t2'));
update public.escala_parametros set valor='"ativo"'::jsonb where chave='escala_fechamento_fisico_modo';
select pg_temp.reg('período inexistente: fail-closed', 'false:PERIODO_DESCONHECIDO', pg_temp.lib('2026-11-04','zz'));

-- RPC da TV como administrador: alocações só de períodos liberados + chave liberacao
select set_config('request.jwt.claim.sub', (select auth_user_id::text from public.usuarios where papel='admin' and ativo and auth_user_id is not null limit 1), true), set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id::text from public.usuarios where papel='admin' and ativo and auth_user_id is not null limit 1), 'role','authenticated')::text, true);
set local role authenticated;
create temp table tv as select public.escala_tv_snapshot('2026-11-04') j;
reset role;
select pg_temp.reg('TV: períodos que aparecem nas alocações', 'm1,m2,m3,t1', (select string_agg(distinct a ->> 'periodo_id', ',' order by a ->> 'periodo_id') from tv, jsonb_array_elements(j -> 'alocacoes') a));
select pg_temp.reg('TV: chave liberacao presente', 'true', (select (j ? 'liberacao')::text from tv));
select pg_temp.reg('TV: t2/t3 sem nenhuma linha', '0', (select count(*)::text from tv, jsonb_array_elements(j -> 'alocacoes') a where a ->> 'periodo_id' in ('t2','t3')));
select caso, esperado, obtido, case when ok then 'OK' else 'FALHA' end from res order by ok, caso;
select 'RESUMO: ' || count(*) filter (where ok) || ' OK / ' || count(*) filter (where not ok) || ' FALHA' from res;
rollback;

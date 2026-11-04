-- Teste (SQL puro, clone local; termina em ROLLBACK) da LIBERAÇÃO pelo VÍNCULO EXPLÍCITO fechamento→plano + gates de apontamento.
-- Uso: psql -h 127.0.0.1 -p 55433 -U postgres -d sittech_clone -v ON_ERROR_STOP=1 -f scripts/fechamento/teste-liberacao-vinculo.sql   (nunca contra PROD)
\set ON_ERROR_STOP on
begin;
update public.escala_parametros set valor='"ativo"'::jsonb where chave='escala_fechamento_fisico_modo';
-- ardósia limpa só dentro desta transação (tabelas append-only: desliga os gatilhos localmente; nada disto sobrevive ao ROLLBACK)
set local session_replication_role = replica;
delete from public.escala_fechamento_plano; delete from public.escala_fechamento_log; delete from public.escala_fechamento_buffers; delete from public.escala_fechamentos; delete from public.escala_fechamento_aberturas;
set local session_replication_role = origin;

create temp table res(caso text, esperado text, obtido text, ok boolean);
create or replace function pg_temp.lib(p_data date, p_per text) returns text language sql as $$ select (public.escala_periodo_liberacao(p_data,p_per) ->> 'liberado') || ':' || (public.escala_periodo_liberacao(p_data,p_per) ->> 'motivo') $$;
create or replace function pg_temp.reg(c text, e text, o text) returns void language sql as $$ insert into res values (c, e, o, e = o) $$;
create or replace function pg_temp.fech(p_chave text, p_data date, p_per text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.escala_fechamentos (semana_inicio,data,periodo_id,revisao,iniciado_em,contado_em,instante_motor,postos_esperados,postos_coletados,buffers_obrigatorios,hash_resumo,chave_idempotencia)
  values ('2026-11-02',p_data,p_per,1,now(),now(),now(),12,12,5,'x',p_chave::uuid) returning id into v;
  return v;
end $$;
create or replace function pg_temp.dias_versao(p_data date) returns integer language sql as $$ select versao from public.escala_producao_dias where data = p_data $$;

-- G: plano interno/estimado existe, nenhum fechamento => NÃO libera
select pg_temp.reg('G: plano antigo de M3 existe no banco, sem fechamento', 'false:AGUARDANDO_FECHAMENTO', pg_temp.lib('2026-11-04','m3'));
select pg_temp.reg('G2: T1 também', 'false:AGUARDANDO_FECHAMENTO', pg_temp.lib('2026-11-04','t1'));

-- J: RECALCULANDO
select pg_temp.fech('11111111-1111-4111-8111-111111111111','2026-11-04','m2') as f \gset m2_
select public.escala_fechamento_resultado(:'m2_f', 'RECALCULANDO', '{}');
select pg_temp.reg('J: RECALCULANDO não libera', 'false:RECALCULANDO', pg_temp.lib('2026-11-04','m3'));
-- K: ERRO_RECALCULO
select public.escala_fechamento_resultado(:'m2_f', 'ERRO_RECALCULO', '{"erro":"x","hash_plano_novo":null}');
select pg_temp.reg('K: ERRO_RECALCULO não libera', 'false:ERRO_RECALCULO', pg_temp.lib('2026-11-04','m3'));
select pg_temp.reg('K2: ERRO_RECALCULO não grava vínculo', '0', (select count(*)::text from public.escala_fechamento_plano));

-- L: CONFIRMADO + plano sem vínculo (mesmo com diagnóstico de hash igual e dia regravado depois) => NÃO libera: o hash é auditoria, não a chave
insert into public.escala_fluxo_diagnosticos (previsao_id,semana_inicio,gatilho,modo,versao_motor,hash_entrada,hash_plano_fluxo,aplicado)
  select id,'2026-11-02','fechamento','ativo','fluxo-v2','h2','HASHM3',true from public.previsoes limit 1;
update public.escala_producao_dias set atualizado_em = now() + interval '5 seconds' where data = '2026-11-04';
set local session_replication_role = replica;                       -- simula um CONFIRMADO legado/forjado SEM passar pela função oficial (log escrito direto)
insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) values (:'m2_f', 'CONFIRMADO', '{"hash_plano_novo":"HASHM3"}');
set local session_replication_role = origin;
select pg_temp.reg('L: CONFIRMADO + hash+horário batendo, mas SEM vínculo explícito', 'false:CONFIRMADO_SEM_PLANO', pg_temp.lib('2026-11-04','m3'));

-- M: CONFIRMADO pela função oficial com plano_versoes => vínculo gravado na mesma transação e libera
select pg_temp.fech('22222222-2222-4222-8222-222222222222','2026-11-04','m3') as f \gset m3_
select public.escala_fechamento_resultado(:'m3_f', 'RECALCULANDO', '{}');
select pg_temp.reg('T1 antes do CONFIRMADO de M3', 'false:RECALCULANDO', pg_temp.lib('2026-11-04','t1'));
select public.escala_fechamento_resultado(:'m3_f', 'CONFIRMADO', jsonb_build_object('hash_plano_novo','HASHT1','plano_versoes', jsonb_build_object('2026-11-04', pg_temp.dias_versao('2026-11-04'))));
select pg_temp.reg('M: CONFIRMADO + vínculo explícito => T1 liberada', 'true:CONFIRMADO', pg_temp.lib('2026-11-04','t1'));
select pg_temp.reg('M2: dia aplicado = APLICADO, demais dias da semana = INALTERADO', 'APLICADO:1|INALTERADO:' || (select count(*) - 1 from public.escala_producao_dias where data >= '2026-11-04' and previsao_id = (select previsao_id from public.escala_producao_dias where data='2026-11-04')),
  (select string_agg(metodo || ':' || n, '|' order by metodo) from (select metodo, count(*) n from public.escala_fechamento_plano where fechamento_id = :'m3_f' group by metodo) x));
select pg_temp.reg('M3: T2 continua bloqueada (depende do fechamento de T1)', 'false:AGUARDANDO_FECHAMENTO', pg_temp.lib('2026-11-04','t2'));

-- P: retry/reenvio do CONFIRMADO não duplica vínculo
select public.escala_fechamento_resultado(:'m3_f', 'CONFIRMADO', jsonb_build_object('hash_plano_novo','HASHT1','plano_versoes', jsonb_build_object('2026-11-04', pg_temp.dias_versao('2026-11-04'))));
select pg_temp.reg('P: retry não duplica o vínculo', (select count(*)::text from public.escala_producao_dias where data >= '2026-11-04' and previsao_id = (select previsao_id from public.escala_producao_dias where data='2026-11-04')),
  (select count(*)::text from public.escala_fechamento_plano where fechamento_id = :'m3_f'));

-- plano regrediu (versão atual < versão vinculada) => fail-closed
update public.escala_producao_dias set versao = versao - 1 where data = '2026-11-04';
select pg_temp.reg('plano com versão MENOR que a vinculada => PLANO_DIVERGENTE', 'false:PLANO_DIVERGENTE', pg_temp.lib('2026-11-04','t1'));
update public.escala_producao_dias set versao = versao + 2 where data = '2026-11-04';
select pg_temp.reg('replanejamento legítimo posterior (versão maior) mantém liberada', 'true:CONFIRMADO', pg_temp.lib('2026-11-04','t1'));

-- sombra não vincula
select pg_temp.fech('33333333-3333-4333-8333-333333333333','2026-11-04','t1') as f \gset t1_
select public.escala_fechamento_resultado(:'t1_f', 'CONFIRMADO', '{"sombra":true,"hash_plano_novo":"X"}');
select pg_temp.reg('modo sombra não grava vínculo', '0', (select count(*)::text from public.escala_fechamento_plano where fechamento_id = :'t1_f'));
-- CONFIRMADO sem hash (último período da semana / nada gerado) não vincula
select pg_temp.fech('44444444-4444-4444-8444-444444444444','2026-11-04','t2') as f \gset t2_
select public.escala_fechamento_resultado(:'t2_f', 'CONFIRMADO', '{"hash_plano_novo":null}');
select pg_temp.reg('CONFIRMADO sem plano gerado não vincula => T3 não libera', 'false:CONFIRMADO_SEM_PLANO', pg_temp.lib('2026-11-04','t3'));

-- VIRADA DE SEMANA: T3 confirmado (sem plano gerado) + M1 da OUTRA Previsão: só libera se o plano dela foi gravado DEPOIS do fechamento
insert into public.previsoes (id, semana_inicio) select '99999999-9999-4999-8999-999999999999', date '2026-11-09' where not exists (select 1 from public.previsoes where semana_inicio = '2026-11-09');
select pg_temp.fech('55555555-5555-4555-8555-555555555555','2026-11-04','t3') as f \gset t3_
select public.escala_fechamento_resultado(:'t3_f', 'CONFIRMADO', '{"hash_plano_novo":null}');
update public.escala_producao_dias set previsao_id = (select id from public.previsoes where semana_inicio = '2026-11-09' limit 1), atualizado_em = now() - interval '1 hour' where data = '2026-11-05';
select pg_temp.reg('VIRADA DE SEMANA: plano da semana nova ANTERIOR ao fechamento ⇒ NÃO libera', 'false:CONFIRMADO_SEM_PLANO', pg_temp.lib('2026-11-05','m1'));
update public.escala_producao_dias set atualizado_em = now() + interval '1 minute' where data = '2026-11-05';
select pg_temp.reg('VIRADA DE SEMANA: plano gerado DEPOIS do fechamento ⇒ libera (VIRADA_SEMANA)', 'true:CONFIRMADO', pg_temp.lib('2026-11-05','m1'));
select pg_temp.reg('VIRADA DE SEMANA: marcado para auditoria', 'VIRADA_SEMANA', public.escala_periodo_liberacao('2026-11-05','m1') ->> 'vinculo');

-- vínculo é imutável
do $$ begin
  begin update public.escala_fechamento_plano set versao = 999; insert into pg_temp.res values ('vínculo imutável (UPDATE)', 'bloqueado', 'PERMITIU', false); exception when others then insert into pg_temp.res values ('vínculo imutável (UPDATE)', 'bloqueado', 'bloqueado', true); end;
  begin delete from public.escala_fechamento_plano; insert into pg_temp.res values ('vínculo imutável (DELETE)', 'bloqueado', 'PERMITIU', false); exception when others then insert into pg_temp.res values ('vínculo imutável (DELETE)', 'bloqueado', 'bloqueado', true); end;
end $$;

-- ESTOQUE FÍSICO É A VERDADE: o banco aceita divergência enorme e zero, sem motivo
do $$ declare v_b uuid; v_f uuid;
begin
  select id into v_b from public.escala_buffers_fisicos limit 1;
  select id into v_f from public.escala_fechamentos where chave_idempotencia = '22222222-2222-4222-8222-222222222222';
  begin
    insert into public.escala_fechamento_buffers (fechamento_id, buffer_id, saldo_estimado, estimado_lo, estimado_hi, saldo_fisico, motivo) values (v_f, v_b, 7122, 7122, 7122, 4800, null);
    insert into pg_temp.res values ('D: estimado 7.122 / físico 4.800 sem motivo', 'aceito', 'aceito', true);
  exception when others then insert into pg_temp.res values ('D: estimado 7.122 / físico 4.800 sem motivo', 'aceito', sqlerrm, false); end;
end $$;
select pg_temp.reg('diferença absoluta e percentual armazenadas', '-2322.00|-32.60', (select diferenca::numeric(10,2) || '|' || diferenca_pct::numeric(10,2) from public.escala_fechamento_buffers where saldo_fisico = 4800 and saldo_estimado = 7122));
do $$ declare v_b uuid; v_f uuid;
begin
  select id into v_b from public.escala_buffers_fisicos offset 1 limit 1;
  select id into v_f from public.escala_fechamentos where chave_idempotencia = '22222222-2222-4222-8222-222222222222';
  begin
    insert into public.escala_fechamento_buffers (fechamento_id, buffer_id, saldo_estimado, estimado_lo, estimado_hi, saldo_fisico, motivo) values (v_f, v_b, 3000, 3000, 3000, 0, null);
    insert into pg_temp.res values ('F: físico = 0 (>50% de diferença) sem motivo', 'aceito', 'aceito', true);
  exception when others then insert into pg_temp.res values ('F: físico = 0 (>50% de diferença) sem motivo', 'aceito', sqlerrm, false); end;
end $$;

select caso, esperado, obtido, case when ok then 'OK' else 'FALHA' end from res order by ok, caso;
select 'RESUMO: ' || count(*) filter (where ok) || ' OK / ' || count(*) filter (where not ok) || ' FALHA' from res;
rollback;

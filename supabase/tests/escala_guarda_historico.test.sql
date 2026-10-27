-- Teste de banco (DEV/local) da GUARDA DO HISTÓRICO em escala_aplicar_recalculo. Transação com ROLLBACK; dados sintéticos (semanas de 2020 = passado, 2035 = futuro),
-- portanto independe do calendário. Nunca em PROD:  npx supabase db query --linked -f supabase/tests/escala_guarda_historico.test.sql
begin;
create temp table t_res (n serial, res text);
do $$
declare
  v_snap jsonb := (select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', to_char(inicio, 'HH24:MI'), 'fim', to_char(fim, 'HH24:MI')) order by id) from periodos);
  v_func uuid := (select id from funcionarios limit 1);
  v_pass uuid; v_fut uuid; v_n int; v_erro text; d date; p text;
begin
  insert into previsoes (semana_inicio) values ('2020-01-06') returning id into v_pass;
  insert into previsoes (semana_inicio) values ('2035-01-01') returning id into v_fut;
  foreach d in array array['2020-01-06','2020-01-07','2020-01-08']::date[] loop
    insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (d, v_pass, v_snap, 5);
  end loop;
  foreach d in array array['2035-01-01','2035-01-02','2035-01-03']::date[] loop
    insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (d, v_fut, v_snap, 5);
  end loop;
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, motivo_sem_posto)
    select dd.data, per.id, v_func, 'teste' from escala_producao_dias dd cross join periodos per where dd.previsao_id in (v_pass, v_fut);

  -- G1) o chamado do bug: sem slot futuro, "cortar no 1º período do dia removido" (passado) => RECUSADO, nada apagado
  v_erro := '-';
  begin
    perform escala_aplicar_recalculo(v_pass, '[]'::jsonb, '2020-01-06', 'm1', '[]'::jsonb, null, '{}'::uuid[], '{}'::jsonb, array['2020-01-06'::date, '2020-01-07'::date]);
  exception when others then v_erro := sqlerrm; end;
  select count(*) into v_n from escala_producao_alocacoes where data between '2020-01-06' and '2020-01-08';
  if v_erro not like 'ESCALA_CORTE_NO_PASSADO%' or v_n <> 18 then raise exception 'G1 falhou: erro=% alocacoes=%', v_erro, v_n; end if;
  insert into t_res(res) values ('ok G1 corte em período JÁ INICIADO é recusado (ESCALA_CORTE_NO_PASSADO); 18/18 alocações históricas preservadas');

  -- G2) corte no meio de um dia passado também recusado (nenhum período iniciado é tocado, nem o 1º nem o último)
  foreach p in array array['m1','m3','t3'] loop
    v_erro := '-';
    begin
      perform escala_aplicar_recalculo(v_pass, '[]'::jsonb, '2020-01-08', p, '[]'::jsonb, null, '{}'::uuid[], '{}'::jsonb, array['2020-01-08'::date]);
    exception when others then v_erro := sqlerrm; end;
    if v_erro not like 'ESCALA_CORTE_NO_PASSADO%' then raise exception 'G2 falhou (%): %', p, v_erro; end if;
  end loop;
  select count(*) into v_n from escala_producao_alocacoes where data between '2020-01-06' and '2020-01-08';
  if v_n <> 18 then raise exception 'G2 falhou: alocacoes=%', v_n; end if;
  insert into t_res(res) values ('ok G2 cortes m1/m3/t3 de um dia passado: todos recusados, histórico intacto');

  -- G3) corte inexistente/dia sem escala => recusado
  v_erro := '-';
  begin
    perform escala_aplicar_recalculo(v_fut, '[]'::jsonb, '2035-02-01', 'm1', '[]'::jsonb, null, '{}'::uuid[], '{}'::jsonb, '{}');
  exception when others then v_erro := sqlerrm; end;
  if v_erro not like 'ESCALA_CORTE_INVALIDO%' then raise exception 'G3 falhou: %', v_erro; end if;
  insert into t_res(res) values ('ok G3 corte em dia sem escala é recusado (ESCALA_CORTE_INVALIDO)');

  -- G4) corte FUTURO no 1º período de um dia removido: o dia inteiro (e os removidos seguintes) deixam de existir; o dia anterior fica intacto
  perform escala_aplicar_recalculo(v_fut, '[]'::jsonb, '2035-01-02', 'm1', '[]'::jsonb, null, '{}'::uuid[], '{}'::jsonb, array['2035-01-02'::date, '2035-01-03'::date]);
  select count(*) into v_n from escala_producao_dias where previsao_id = v_fut;
  if v_n <> 1 or (select count(*) from escala_producao_alocacoes where data = '2035-01-01') <> 6 then raise exception 'G4 falhou: dias=%', v_n; end if;
  insert into t_res(res) values ('ok G4 corte futuro no 1º período do dia removido: dias 02 e 03 somem por inteiro; dia 01 (anterior ao corte) intacto');

  -- G5) corte futuro no MEIO do dia (t1): m1..m3 permanecem, t1..t3 somem; a linha do dia fica
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values ('2035-01-03', v_fut, v_snap, 5);
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, motivo_sem_posto) select '2035-01-03', per.id, v_func, 'teste' from periodos per;
  perform escala_aplicar_recalculo(v_fut, '[]'::jsonb, '2035-01-03', 't1', '[]'::jsonb, null, '{}'::uuid[], '{}'::jsonb, array['2035-01-03'::date]);
  select count(*) into v_n from escala_producao_alocacoes where data = '2035-01-03';
  if v_n <> 3 or not exists (select 1 from escala_producao_dias where data = '2035-01-03') then raise exception 'G5 falhou: alocacoes=%', v_n; end if;
  insert into t_res(res) values ('ok G5 corte futuro em t1: M1..M3 do dia permanecem (3), T1..T3 removidos; linha do dia mantida');

  -- G6) regravar o futuro normalmente continua funcionando (corte futuro, alocação nova >= corte)
  perform escala_aplicar_recalculo(v_fut, jsonb_build_array(jsonb_build_object('data', '2035-01-03', 'versao_base', (select versao from escala_producao_dias where data = '2035-01-03'), 'periodos_snapshot', v_snap)),
    '2035-01-03', 't1', jsonb_build_array(jsonb_build_object('data', '2035-01-03', 'periodo_id', 't1', 'funcionario_id', v_func, 'motivo_sem_posto', 'novo')), null, '{}'::uuid[], '{}'::jsonb, '{}');
  select count(*) into v_n from escala_producao_alocacoes where data = '2035-01-03';
  if v_n <> 4 then raise exception 'G6 falhou: alocacoes=%', v_n; end if;
  insert into t_res(res) values ('ok G6 recálculo normal de período futuro segue gravando (3 antigos + 1 novo)');
end $$;
select res from t_res order by n;
rollback;

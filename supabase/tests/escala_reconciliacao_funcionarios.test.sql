-- Teste de banco (DEV/local) de escala_divergencias_funcionarios. Transação com ROLLBACK; semana sintética de 2035 (todos os períodos no futuro) => independe do calendário.
-- Nunca em PROD:  npx supabase db query --linked -f supabase/tests/escala_reconciliacao_funcionarios.test.sql
begin;
create temp table t_res (n serial, res text);
do $$
declare
  v_snap jsonb := (select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', to_char(inicio, 'HH24:MI'), 'fim', to_char(fim, 'HH24:MI')) order by id) from periodos);
  v_f uuid[] := array(select id from funcionarios where ativo order by id limit 3);
  v_user uuid := (select id from usuarios where ativo limit 1);
  v_prev uuid; v_aus uuid; v_n int; v_txt text; v_agora timestamptz := now();
  f1 uuid; f2 uuid; f3 uuid;
  mon constant date := '2035-01-01'; tue constant date := '2035-01-02';

  -- helper: divergências por tipo como "tipo:periodo,periodo" para um funcionário/dia
  r record;
begin
  f1 := v_f[1]; f2 := v_f[2]; f3 := v_f[3];
  insert into previsoes (semana_inicio) values (mon) returning id into v_prev;
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (mon, v_prev, v_snap, 1), (tue, v_prev, v_snap, 1);
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo) select v_prev, x, true from unnest(v_f) x;
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, motivo_sem_posto)
    select d.data, p.id, x, 'teste' from escala_producao_dias d cross join periodos p cross join unnest(v_f) x where d.previsao_id = v_prev;

  -- K) base sem divergência; execução repetida = mesmo resultado (no-op)
  select count(*) into v_n from escala_divergencias_funcionarios(v_agora) where previsao_id = v_prev;
  if v_n <> 0 then raise exception 'K falhou: base com % divergências', v_n; end if;
  insert into t_res(res) values ('ok K base consistente = 0 divergências (e repetir a consulta não muda nada)');

  -- A) falta de dia inteiro (segunda): as 6 linhas do funcionário na segunda são incompatíveis; terça não
  insert into ausencias_funcionarios (funcionario_id, data, tipo, duracao_minutos, periodos_snapshot, criado_por) values (f1, mon, 'falta_dia_inteiro', 480, v_snap, v_user) returning id into v_aus;
  select count(*) into v_n from escala_divergencias_funcionarios(v_agora) where previsao_id = v_prev and funcionario_id = f1 and tipo = 'alocado_ausente' and data = mon and causa_id = v_aus;
  if v_n <> 6 or exists (select 1 from escala_divergencias_funcionarios(v_agora) where data = tue) then raise exception 'A falhou: %', v_n; end if;
  insert into t_res(res) values ('ok A falta dia inteiro: 6 períodos da segunda divergentes (causa = a ausência); terça intacta');
  delete from ausencias_funcionarios where id = v_aus;

  -- B/C) atraso em aberto desde 07:12: o plano (como o motor faz) NÃO tem linha dele na segunda => consistente; ao registrar a chegada 09:10, M3 em diante voltam a ser elegíveis
  delete from escala_producao_alocacoes where data = mon and funcionario_id = f2;
  insert into ausencias_funcionarios (funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, criado_por, em_aberto) values (f2, mon, 'atraso', '07:12', null, 0, v_snap, v_user, true) returning id into v_aus;
  select count(*) into v_n from escala_divergencias_funcionarios(v_agora) where previsao_id = v_prev;
  if v_n <> 0 then raise exception 'B falhou: atraso aberto com plano coerente gerou % divergências', v_n; end if;
  insert into t_res(res) values ('ok B atraso em aberto desde 07:12: bloqueia a segunda inteira (até o fim da jornada) e o plano sem linha dele é consistente');
  update ausencias_funcionarios set em_aberto = false, horario_fim = '09:10', encerrada_em = now(), chegada_manual = true where id = v_aus;
  select string_agg(periodo_id, ',' order by periodo_id) into v_txt from escala_divergencias_funcionarios(v_agora) where funcionario_id = f2 and tipo = 'disponivel_sem_linha' and data = mon;
  if v_txt is distinct from 'm3,t1,t2,t3' then raise exception 'C falhou: %', v_txt; end if;
  insert into t_res(res) values ('ok C chegada 09:10: M1 e M2 afetados (sobreposição); M3,T1,T2,T3 voltam elegíveis => "disponivel_sem_linha" aponta o plano desatualizado');
  update ausencias_funcionarios set horario_fim = '10:25' where id = v_aus;
  select string_agg(periodo_id, ',' order by periodo_id) into v_txt from escala_divergencias_funcionarios(v_agora) where funcionario_id = f2 and tipo = 'disponivel_sem_linha' and data = mon;
  if v_txt is distinct from 't1,t2,t3' then raise exception 'D falhou: %', v_txt; end if;
  insert into t_res(res) values ('ok D chegada 10:25: M3 (10:24) já começou com ele ausente => primeiro elegível é T1');
  delete from ausencias_funcionarios where id = v_aus;
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, motivo_sem_posto) select mon, p.id, f2, 'teste' from periodos p;  -- plano volta ao normal

  -- E) ausência parcial 09:10–09:30: afeta só M2 (08:48–10:24)
  insert into ausencias_funcionarios (funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, criado_por) values (f3, mon, 'outro', '09:10', '09:30', 20, v_snap, v_user) returning id into v_aus;
  select string_agg(periodo_id, ',') into v_txt from escala_divergencias_funcionarios(v_agora) where funcionario_id = f3 and tipo = 'alocado_ausente';
  if v_txt is distinct from 'm2' then raise exception 'E falhou: %', v_txt; end if;
  insert into t_res(res) values ('ok E ausência parcial 09:10–09:30: só M2 é afetado (interseção [início,fim))');
  delete from ausencias_funcionarios where id = v_aus;

  -- F) saída antecipada 14:05–17:00: T1 (13:00–14:20) por sobreposição, T2 e T3
  insert into ausencias_funcionarios (funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, criado_por) values (f1, tue, 'saida_antecipada', '14:05', '17:00', 175, v_snap, v_user) returning id into v_aus;
  select string_agg(periodo_id, ',' order by periodo_id) into v_txt from escala_divergencias_funcionarios(v_agora) where funcionario_id = f1 and tipo = 'alocado_ausente' and data = tue;
  if v_txt is distinct from 't1,t2,t3' then raise exception 'F falhou: %', v_txt; end if;
  insert into t_res(res) values ('ok F saída 14:05: T1 (afetado por sobreposição), T2 e T3 divergentes; M1..M3 não');
  delete from ausencias_funcionarios where id = v_aus;

  -- L) passado não é considerado: com "agora" = segunda 10:00 só os períodos que começam depois (M3 10:24, T1..T3) entram
  insert into ausencias_funcionarios (funcionario_id, data, tipo, duracao_minutos, periodos_snapshot, criado_por, criado_em) values (f1, mon, 'falta_dia_inteiro', 480, v_snap, v_user, '2034-12-31') returning id into v_aus;
  select string_agg(periodo_id, ',' order by periodo_id) into v_txt from escala_divergencias_funcionarios('2035-01-01 10:00-03') where funcionario_id = f1 and tipo = 'alocado_ausente' and data = mon;
  if v_txt is distinct from 'm3,t1,t2,t3' then raise exception 'L falhou: %', v_txt; end if;
  select count(*) into v_n from escala_divergencias_funcionarios('2035-01-01 18:00-03') where data = mon;
  if v_n <> 0 then raise exception 'L2 falhou: dia inteiro já ocorrido ainda divergente (%)', v_n; end if;
  insert into t_res(res) values ('ok L períodos que já começaram nunca entram: às 10:00 só M3,T1,T2,T3; às 18:00 nada (o passado permanece)');
  delete from ausencias_funcionarios where id = v_aus;

  -- G) funcionário inativo: hard constraint em todos os períodos futuros (não depende de evento antigo)
  perform set_config('app.funcionario_situacao_rpc', '1', true); -- o mesmo atalho que as RPCs desativar/reativar usam (guarda de UPDATE direto)
  update funcionarios set ativo = false where id = f3;
  select count(*) into v_n from escala_divergencias_funcionarios(v_agora) where previsao_id = v_prev and funcionario_id = f3 and tipo = 'alocado_inativo';
  if v_n <> 12 then raise exception 'G falhou: %', v_n; end if;
  insert into t_res(res) values ('ok G funcionário inativo: 12 períodos futuros (2 dias × 6) divergentes');
  update funcionarios set ativo = true where id = f3;

  -- H) removido da equipe semanal (ou produtivo=false)
  update previsao_equipe_semana set produtivo = false where previsao_id = v_prev and funcionario_id = f2;
  select count(*) into v_n from escala_divergencias_funcionarios(v_agora) where previsao_id = v_prev and funcionario_id = f2 and tipo = 'alocado_fora_equipe';
  if v_n <> 12 then raise exception 'H falhou: %', v_n; end if;
  delete from previsao_equipe_semana where previsao_id = v_prev and funcionario_id = f2;
  select count(*) into v_n from escala_divergencias_funcionarios(v_agora) where previsao_id = v_prev and funcionario_id = f2 and tipo = 'alocado_fora_equipe';
  if v_n <> 12 then raise exception 'H2 falhou: %', v_n; end if;
  insert into t_res(res) values ('ok H saída da equipe semanal (produtivo=false ou linha removida): 12 períodos futuros divergentes');
  -- volta à equipe sem linha no plano => "disponivel_sem_linha" (entrada na equipe também é detectada)
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo) values (v_prev, f2, true);
  delete from escala_producao_alocacoes where data = tue and funcionario_id = f2;
  select count(*) into v_n from escala_divergencias_funcionarios(v_agora) where funcionario_id = f2 and tipo = 'disponivel_sem_linha';
  if v_n <> 6 then raise exception 'H3 falhou: %', v_n; end if;
  insert into t_res(res) values ('ok H3 funcionário que entra/volta à equipe sem linha no plano: detectado (6 períodos)');
end $$;
select res from t_res order by n;
rollback;

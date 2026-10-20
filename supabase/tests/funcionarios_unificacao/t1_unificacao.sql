-- T1: unificação completa (conflitos de equipe, custos, ausências, apontamentos, Escala), permissões, assinatura
do $$
declare
  v_auth uuid := 'a27f42df-54fe-4718-93a7-0085f5ed5a09';
  v_usr uuid := 'dea8545a-dbdc-4ed7-9dc9-f44215389d91';
  v_op uuid; v_etapa uuid; v_prod uuid; v_opet uuid; v_maq uuid[]; v_snap jsonb;
  X uuid := gen_random_uuid(); K uuid := gen_random_uuid();
  PA uuid := gen_random_uuid(); PB uuid := gen_random_uuid(); P3 uuid := gen_random_uuid();
  v_sim jsonb; v_res jsonb; v_ass text; v_err text; v_n bigint; v_ok boolean;
  c_plano uuid := gen_random_uuid(); c_bonus uuid := gen_random_uuid();
  v_before record; v_after record; v_log record;
begin
  select id into v_op from operacoes order by id limit 1;
  select id, produto_id, operacao_id into v_etapa, v_prod, v_opet from roteiro_etapas order by id limit 1;
  v_maq := array(select id from maquinas where ativo order by id limit 8);
  select periodos_snapshot into v_snap from escala_producao_dias limit 1;

  insert into funcionarios (id, nome, operacao_id, salario_base, ativo, created_at) values
    (X, 'TESTE-UNIF Luana', v_op, 2000, true, '2026-10-15'), (K, 'TESTE-UNIF Luana', v_op, 2000, true, '2026-09-15');
  insert into funcionario_custos (id, funcionario_id, descricao, valor) values
    (gen_random_uuid(), X, 'Vale Transporte', 100), (c_plano, X, 'Plano', 50), (c_bonus, X, 'Bônus', 30),
    (gen_random_uuid(), K, '  vale transporte ', 100), (gen_random_uuid(), K, 'Outro', 10);
  insert into previsoes (id, semana_inicio) values (PA, '2026-03-02'), (PB, '2026-03-09'), (P3, '2026-01-05');
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id) values
    (PA, X, true, v_op), (PA, K, false, v_op), (PB, X, false, v_op);
  insert into ausencias_funcionarios (funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, idempotency_key, criado_por) values
    (X, '2026-02-02', 'falta_dia_inteiro', null, null, 528, '[]', gen_random_uuid(), v_usr),
    (X, '2026-02-03', 'atraso', '08:00', '09:00', 60, '[]', gen_random_uuid(), v_usr),
    (K, '2026-02-02', 'falta_dia_inteiro', null, null, 528, '[]', gen_random_uuid(), v_usr),
    (K, '2026-02-10', 'atestado', null, null, 528, '[]', gen_random_uuid(), v_usr);
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
    periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente) values
    (v_prod, v_etapa, v_opet, v_maq[1], X, 'm1', '2026-02-02', '09:00', 100, 5, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2),
    (v_prod, v_etapa, v_opet, v_maq[2], X, 'm2', '2026-02-02', '10:00', 200, 0, '08:48', '10:24', 100, 10, v_usr, 'produzindo', 2),
    (v_prod, v_etapa, v_opet, v_maq[3], X, 'm1', '2026-02-03', '09:00', 300, 10, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2),
    (v_prod, v_etapa, v_opet, v_maq[4], K, 'm1', '2026-02-04', '09:00', 50, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2);
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot) values ('2026-01-05', P3, v_snap), ('2030-01-07', P3, v_snap);
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas) values
    ('2026-01-05', 'm1', X, v_maq[1], v_prod, v_etapa, v_opet, 10),
    ('2026-01-05', 'm2', X, v_maq[2], v_prod, v_etapa, v_opet, 10),
    ('2030-01-07', 't1', X, v_maq[1], v_prod, v_etapa, v_opet, 10);
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, motivo_sem_posto) values ('2026-01-05', 'm2', K, 'teste');

  select count(*) as n, sum(quantidade_produzida) as prod, sum(quantidade_refugo) as ref into v_before from apontamentos_producao where funcionario_id in (X, K);

  -- (1) NÃO-ADMIN é recusado
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.funcionario_exclusao_simular(X, K, '{}');
    v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('FUNC_SOMENTE_ADMIN' in v_err) > 0;
  end;
  if not v_ok then raise exception 'FALHOU (1) não-admin deveria ser recusado: %', v_err; end if;
  begin
    perform public.funcionario_resumo(X); v_ok := false;
  exception when others then v_ok := position('FUNC_SOMENTE_ADMIN' in sqlerrm) > 0;
  end;
  if not v_ok then raise exception 'FALHOU (1b) resumo para não-admin'; end if;
  begin
    perform public.funcionario_exclusao_executar(X, K, '{}', 'x'); v_ok := false;
  exception when others then v_ok := position('FUNC_SOMENTE_ADMIN' in sqlerrm) > 0;
  end;
  if not v_ok then raise exception 'FALHOU (1c) executar para não-admin'; end if;
  reset role;

  -- (2) ADMIN simula sem decisões: pendências de custo, nada gravado
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_sim := public.funcionario_exclusao_simular(X, K, '{}');
  reset role;
  if (v_sim->>'pode_executar')::boolean then raise exception 'FALHOU (2) deveria ter pendências: %', v_sim; end if;
  if jsonb_array_length(v_sim->'pendencias') <> 2 then raise exception 'FALHOU (2) esperava 2 pendências de custo (Plano e Bônus): %', v_sim->'pendencias'; end if;
  if jsonb_array_length(v_sim->'bloqueios') <> 0 then raise exception 'FALHOU (2) sem bloqueios esperado: %', v_sim->'bloqueios'; end if;
  if (v_sim#>>'{transferir,apontamentos}')::int <> 3 then raise exception 'FALHOU (2) transferir apontamentos: %', v_sim->'transferir'; end if;
  if (v_sim#>>'{transferir,ausencias}')::int <> 1 or (v_sim#>>'{consolidar,ausencias_identicas}')::int <> 1 then raise exception 'FALHOU (2) ausências: % %', v_sim->'transferir', v_sim->'consolidar'; end if;
  if (v_sim#>>'{transferir,semanas_equipe}')::int <> 1 or jsonb_array_length(v_sim#>'{consolidar,semanas_equipe}') <> 1 then raise exception 'FALHOU (2) equipe: %', v_sim->'consolidar'; end if;
  if (v_sim#>>'{consolidar,semanas_equipe,0,produtivo_final}')::boolean is not true or (v_sim#>>'{consolidar,semanas_equipe,0,difere}')::boolean is not true then raise exception 'FALHOU (2) produtivo OR: %', v_sim->'consolidar'; end if;
  if (v_sim#>>'{transferir,alocacoes_passadas}')::int <> 1 or jsonb_array_length(v_sim#>'{consolidar,alocacoes_passadas_mesmo_periodo}') <> 1 or jsonb_array_length(v_sim#>'{descartar,alocacoes_futuras}') <> 1 then
    raise exception 'FALHOU (2) alocações: % % %', v_sim->'transferir', v_sim->'consolidar', v_sim->'descartar'; end if;
  if jsonb_array_length(v_sim#>'{consolidar,custos_duplicados}') <> 1 then raise exception 'FALHOU (2) custo duplicado (equivalência sem caixa/espaços): %', v_sim->'consolidar'; end if;
  select count(*) into v_n from funcionarios where id in (X, K);
  if v_n <> 2 then raise exception 'FALHOU (2) a simulação não pode gravar nada'; end if;

  -- (3) executar COM pendências é recusado
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.funcionario_exclusao_executar(X, K, '{}', v_sim->>'assinatura'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('FUNC_PENDENCIAS' in v_err) > 0;
  end;
  reset role;
  if not v_ok then raise exception 'FALHOU (3) executar com pendência: %', v_err; end if;

  -- (4) decisão inválida é recusada
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.funcionario_exclusao_simular(X, K, jsonb_build_object(c_plano::text, 'apagar')); v_ok := false;
  exception when others then v_ok := position('FUNC_DECISAO_INVALIDA' in sqlerrm) > 0;
  end;
  reset role;
  if not v_ok then raise exception 'FALHOU (4) decisão inválida'; end if;

  -- (5) com decisões: pronto; assinatura errada é recusada; assinatura certa executa
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_sim := public.funcionario_exclusao_simular(X, K, jsonb_build_object(c_plano::text, 'copiar', c_bonus::text, 'descartar'));
  reset role;
  -- os custos precisam ter os ids que o teste conhece: confere que as decisões casaram com os custos "Plano"/"Bônus"
  if not (v_sim->>'pode_executar')::boolean then raise exception 'FALHOU (5) deveria estar pronto: % / %', v_sim->'pendencias', v_sim->'bloqueios'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.funcionario_exclusao_executar(X, K, jsonb_build_object(c_plano::text, 'copiar', c_bonus::text, 'descartar'), 'assinatura-errada'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('FUNC_ASSINATURA_DESATUALIZADA' in v_err) > 0;
  end;
  if not v_ok then raise exception 'FALHOU (5) assinatura errada: %', v_err; end if;
  v_res := public.funcionario_exclusao_executar(X, K, jsonb_build_object(c_plano::text, 'copiar', c_bonus::text, 'descartar'), v_sim->>'assinatura');
  reset role;

  -- (6) conferências do resultado
  if exists (select 1 from funcionarios where id = X) then raise exception 'FALHOU (6) o excluído deveria ter sumido'; end if;
  if not exists (select 1 from funcionarios where id = K) then raise exception 'FALHOU (6) o mantido sumiu'; end if;
  select count(*) as n, sum(quantidade_produzida) as prod, sum(quantidade_refugo) as ref into v_after from apontamentos_producao where funcionario_id = K;
  if v_after.n <> v_before.n or v_after.prod <> v_before.prod or v_after.ref <> v_before.ref then raise exception 'FALHOU (6) totais de produção: % vs %', v_before, v_after; end if;
  select count(*) into v_n from apontamento_producao_historico where motivo like 'Unificação de funcionário%' and (dados_novos->>'funcionario_id')::uuid = K;
  if v_n <> 3 then raise exception 'FALHOU (6) histórico de apontamentos: %', v_n; end if;
  select count(*) into v_n from ausencias_funcionarios where funcionario_id = K;
  if v_n <> 3 then raise exception 'FALHOU (6) ausências do mantido (esperado 3): %', v_n; end if;
  if exists (select 1 from ausencias_funcionarios where funcionario_id = X) then raise exception 'FALHOU (6) ausência órfã'; end if;
  if (select produtivo from previsao_equipe_semana where previsao_id = PA and funcionario_id = K) is not true then raise exception 'FALHOU (6) produtivo OR'; end if;
  if not exists (select 1 from previsao_equipe_semana where previsao_id = PB and funcionario_id = K) then raise exception 'FALHOU (6) semana movida'; end if;
  if (select count(*) from previsao_equipe_semana where funcionario_id = X) <> 0 then raise exception 'FALHOU (6) equipe órfã'; end if;
  select count(*) into v_n from funcionario_custos where funcionario_id = K;
  if v_n <> 3 then raise exception 'FALHOU (6) custos do mantido (2 originais + Plano copiado = 3): %', v_n; end if;
  if not exists (select 1 from funcionario_custos where funcionario_id = K and descricao = 'Plano') or exists (select 1 from funcionario_custos where funcionario_id = K and descricao in ('Bônus')) then raise exception 'FALHOU (6) custos copiar/descartar'; end if;
  if exists (select 1 from funcionario_custos where funcionario_id = K and lower(btrim(descricao)) = 'vale transporte' and valor = 100 and descricao <> '  vale transporte ') then raise exception 'FALHOU (6) custo duplicado não pode ser copiado'; end if;
  if not exists (select 1 from escala_producao_alocacoes where funcionario_id = K and data = '2026-01-05' and periodo_id = 'm1' and maquina_id = v_maq[1]) then raise exception 'FALHOU (6) alocação passada deveria ter sido transferida'; end if;
  if (select maquina_id from escala_producao_alocacoes where funcionario_id = K and data = '2026-01-05' and periodo_id = 'm2') is not null then raise exception 'FALHOU (6) o mantido deveria prevalecer no período em conflito'; end if;
  if exists (select 1 from escala_producao_alocacoes where funcionario_id = X) or exists (select 1 from escala_producao_alocacoes where data = '2030-01-07') then raise exception 'FALHOU (6) alocação futura/órfã'; end if;
  select * into v_log from funcionarios_exclusoes_log where funcionario_excluido_id = X;
  if not found or v_log.modo <> 'unificacao' or v_log.funcionario_mantido_id <> K or jsonb_array_length(v_log.movidos->'apontamentos') <> 3 or (v_log.snapshot->'funcionario'->>'nome') <> 'TESTE-UNIF Luana' then raise exception 'FALHOU (6) log: %', v_log; end if;
  if jsonb_array_length(v_log.descartados->'alocacoes_removidas') <> 2 then raise exception 'FALHOU (6) log descartados: %', v_log.descartados; end if;
  select count(*) into v_n from escala_producao_eventos where tipo = 'previsao' and payload->>'origem' = 'unificacao_funcionario' and previsao_id = P3;
  if v_n < 1 then raise exception 'FALHOU (6) evento de recálculo da Escala não registrado'; end if;

  -- (7) DELETE direto pelo navegador não existe mais (mesmo para admin): RLS nega
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from funcionarios where id = K;
  reset role;
  if not exists (select 1 from funcionarios where id = K) then raise exception 'FALHOU (7) DELETE direto não deveria funcionar'; end if;

  raise exception 'TESTE_OK T1: unificação, permissões, pendências, decisões, assinatura, totais, histórico, log e DELETE direto bloqueado';
end $$;


do $$
declare
  v_auth uuid := 'a27f42df-54fe-4718-93a7-0085f5ed5a09';
  v_usr uuid := 'dea8545a-dbdc-4ed7-9dc9-f44215389d91';
  v_op uuid; v_etapa uuid; v_prod uuid; v_opet uuid; v_maq uuid[]; v_snap jsonb;
  X uuid := gen_random_uuid(); K uuid := gen_random_uuid();
  PA uuid := gen_random_uuid(); P3 uuid := gen_random_uuid();
  v_sim jsonb; v_res jsonb; v_err text; v_n bigint; v_ok boolean;
  s1 text; s2 text;
begin
  select id into v_op from operacoes order by id limit 1;
  select id, produto_id, operacao_id into v_etapa, v_prod, v_opet from roteiro_etapas order by id limit 1;
  v_maq := array(select id from maquinas where ativo order by id limit 8);
  select periodos_snapshot into v_snap from escala_producao_dias limit 1;
  insert into funcionarios (id, nome, operacao_id, salario_base, ativo, created_at) values
    (X, 'TESTE-UNIF Luana', v_op, 2000, true, '2026-10-15'), (K, 'TESTE-UNIF Luana', v_op, 2000, true, '2026-09-15');
  insert into previsoes (id, semana_inicio) values (PA, '2026-03-02'), (P3, '2026-01-05');
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot) values ('2026-01-05', P3, v_snap), ('2030-01-07', P3, v_snap);

  -- sobreposição de apontamento (mesmo dia/período) + ausência conflitante (falta o dia todo x atraso no mesmo dia)
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente) values
(v_prod, v_etapa, v_opet, v_maq[1], X, 'm1', '2026-02-02', '09:00', 100, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2),
    (v_prod, v_etapa, v_opet, v_maq[2], K, 'm1', '2026-02-02', '09:00', 100, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2);
  insert into ausencias_funcionarios (funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, idempotency_key, criado_por) values
    (X, '2026-02-05', 'falta_dia_inteiro', null, null, 528, '[]', gen_random_uuid(), v_usr),
    (K, '2026-02-05', 'atraso', '08:00', '09:00', 60, '[]', gen_random_uuid(), v_usr);
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_sim := public.funcionario_exclusao_simular(X, K, '{}');
  if (v_sim->>'pode_executar')::boolean then raise exception 'FALHOU (T3) deveria estar bloqueado'; end if;
  if not (select bool_or(b->>'codigo' = 'APONTAMENTO_SOBREPOSTO') from jsonb_array_elements(v_sim->'bloqueios') b) then raise exception 'FALHOU (T3) sobreposição: %', v_sim->'bloqueios'; end if;
  if not (select bool_or(b->>'codigo' = 'AUSENCIA_CONFLITANTE') from jsonb_array_elements(v_sim->'bloqueios') b) then raise exception 'FALHOU (T3) ausência: %', v_sim->'bloqueios'; end if;
  
    s1 := (select md5(coalesce(string_agg(chave, '|' order by chave), '')) from (
      select 'f:'||id::text chave from funcionarios where nome='TESTE-UNIF Luana'
      union all select 'ap:'||id::text||funcionario_id::text from apontamentos_producao where funcionario_id in (X,K)
      union all select 'au:'||id::text||funcionario_id::text from ausencias_funcionarios where funcionario_id in (X,K)
      union all select 'eq:'||previsao_id::text||funcionario_id::text||produtivo::text from previsao_equipe_semana where funcionario_id in (X,K)
      union all select 'al:'||data::text||periodo_id||funcionario_id::text||coalesce(maquina_id::text,'-') from escala_producao_alocacoes where funcionario_id in (X,K)
      union all select 'cu:'||id::text||funcionario_id::text from funcionario_custos where funcionario_id in (X,K)
      union all select 'lg:'||id::text from funcionarios_exclusoes_log where funcionario_excluido_id in (X,K)
      union all select 'hi:'||id::text from apontamento_producao_historico where motivo like 'Unificação%') t);

  begin
    perform public.funcionario_exclusao_executar(X, K, '{}', v_sim->>'assinatura'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('FUNC_BLOQUEADO' in v_err) > 0;
  end;
  if not v_ok then raise exception 'FALHOU (T3) execução bloqueada: %', v_err; end if;
  begin perform public.funcionario_exclusao_simular(X, X, '{}'); v_ok := false;
  exception when others then v_ok := position('FUNC_MESMO_REGISTRO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (T3) mesmo registro'; end if;
  begin perform public.funcionario_exclusao_simular(X, gen_random_uuid(), '{}'); v_ok := false;
  exception when others then v_ok := position('FUNC_DESTINO_NAO_ENCONTRADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (T3) destino inexistente'; end if;
  reset role;
  
    s2 := (select md5(coalesce(string_agg(chave, '|' order by chave), '')) from (
      select 'f:'||id::text chave from funcionarios where nome='TESTE-UNIF Luana'
      union all select 'ap:'||id::text||funcionario_id::text from apontamentos_producao where funcionario_id in (X,K)
      union all select 'au:'||id::text||funcionario_id::text from ausencias_funcionarios where funcionario_id in (X,K)
      union all select 'eq:'||previsao_id::text||funcionario_id::text||produtivo::text from previsao_equipe_semana where funcionario_id in (X,K)
      union all select 'al:'||data::text||periodo_id||funcionario_id::text||coalesce(maquina_id::text,'-') from escala_producao_alocacoes where funcionario_id in (X,K)
      union all select 'cu:'||id::text||funcionario_id::text from funcionario_custos where funcionario_id in (X,K)
      union all select 'lg:'||id::text from funcionarios_exclusoes_log where funcionario_excluido_id in (X,K)
      union all select 'hi:'||id::text from apontamento_producao_historico where motivo like 'Unificação%') t);

  if s1 <> s2 then raise exception 'FALHOU (T3) estado mudou apesar do bloqueio'; end if;
  raise exception 'TESTE_OK T3: sobreposição de apontamento, ausência conflitante, mesmo registro e destino inexistente — nada alterado';
end $$;

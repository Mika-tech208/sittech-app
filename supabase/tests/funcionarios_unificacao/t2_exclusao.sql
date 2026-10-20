
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

  insert into funcionario_custos (funcionario_id, descricao, valor) values (X, 'Plano', 50);
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id) values (PA, X, true, v_op);
  insert into ausencias_funcionarios (funcionario_id, data, tipo, duracao_minutos, periodos_snapshot, idempotency_key, criado_por) values (X, '2026-02-02', 'falta_dia_inteiro', 528, '[]', gen_random_uuid(), v_usr);
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas) values
    ('2026-01-05', 'm1', X, v_maq[1], v_prod, v_etapa, v_opet, 10), ('2030-01-07', 't1', X, v_maq[1], v_prod, v_etapa, v_opet, 10);
  -- K tem apontamento => exclusão simples bloqueada
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente) values
(v_prod, v_etapa, v_opet, v_maq[2], K, 'm1', '2026-02-04', '09:00', 100, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2);
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- X (sem apontamentos): exclusão simples permitida
  v_sim := public.funcionario_exclusao_simular(X, null, '{}');
  if not (v_sim->>'pode_executar')::boolean then raise exception 'FALHOU (T2) exclusão simples de X deveria ser permitida: %', v_sim; end if;
  if (v_sim#>>'{descartar,ausencias}')::int <> 1 or (v_sim#>>'{descartar,semanas_equipe}')::int <> 1 or jsonb_array_length(v_sim#>'{descartar,custos}') <> 1 then raise exception 'FALHOU (T2) resumo do que será removido: %', v_sim->'descartar'; end if;
  v_res := public.funcionario_exclusao_executar(X, null, '{}', v_sim->>'assinatura');
  -- K (com apontamento): agora PERMITIDO (decisão do administrador); o impacto aparece na simulação
  v_sim := public.funcionario_exclusao_simular(K, null, '{}');
  if not (v_sim->>'pode_executar')::boolean or (v_sim#>>'{remover,apontamentos}')::int <> 1 then raise exception 'FALHOU (T2) K deveria poder ser excluído: %', v_sim; end if;
  v_res := public.funcionario_exclusao_executar(K, null, '{}', v_sim->>'assinatura'); v_ok := true;
  reset role;
  if not v_ok then raise exception 'FALHOU (T2) executar bloqueado: %', v_err; end if;
  if exists (select 1 from funcionarios where id = X) then raise exception 'FALHOU (T2) X deveria ter sido excluído'; end if;
  if exists (select 1 from funcionarios where id = K) then raise exception 'FALHOU (T2) K deveria ter sido excluído'; end if;
  if exists (select 1 from escala_producao_alocacoes where funcionario_id = X) or exists (select 1 from previsao_equipe_semana where funcionario_id = X) or exists (select 1 from ausencias_funcionarios where funcionario_id = X) or exists (select 1 from funcionario_custos where funcionario_id = X) then raise exception 'FALHOU (T2) referências órfãs de X'; end if;
  if not exists (select 1 from funcionarios_exclusoes_log where funcionario_excluido_id = X and modo = 'exclusao_sem_unificacao' and jsonb_array_length(descartados->'alocacoes_removidas') = 2) then raise exception 'FALHOU (T2) log da exclusão'; end if;
  raise exception 'TESTE_OK T2: exclusão sem unificar com e sem apontamentos; log';
end $$;

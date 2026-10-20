
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

  insert into funcionario_custos (funcionario_id, descricao, valor) values (X, 'Plano', 50), (K, 'Plano', 50);
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id) values (PA, X, true, v_op), (PA, K, false, v_op);
  insert into ausencias_funcionarios (funcionario_id, data, tipo, duracao_minutos, periodos_snapshot, idempotency_key, criado_por) values (X, '2026-02-03', 'falta_dia_inteiro', 528, '[]', gen_random_uuid(), v_usr);
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas) values
    ('2026-01-05', 'm1', X, v_maq[1], v_prod, v_etapa, v_opet, 10), ('2030-01-07', 't1', X, v_maq[1], v_prod, v_etapa, v_opet, 10);
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente) values
(v_prod, v_etapa, v_opet, v_maq[2], X, 'm1', '2026-02-02', '09:00', 100, 5, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2),
    (v_prod, v_etapa, v_opet, v_maq[3], X, 'm1', '2026-02-03', '09:00', 200, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2),
    (v_prod, v_etapa, v_opet, v_maq[4], K, 'm1', '2026-02-04', '09:00', 50, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2);

  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_sim := public.funcionario_exclusao_simular(X, K, '{}');
  if not (v_sim->>'pode_executar')::boolean then raise exception 'FALHOU (T4) deveria estar pronto: %', v_sim; end if;
  reset role;
  
    s1 := (select md5(coalesce(string_agg(chave, '|' order by chave), '')) from (
      select 'f:'||id::text chave from funcionarios where nome='TESTE-UNIF Luana'
      union all select 'ap:'||id::text||funcionario_id::text from apontamentos_producao where funcionario_id in (X,K)
      union all select 'au:'||id::text||funcionario_id::text from ausencias_funcionarios where funcionario_id in (X,K)
      union all select 'eq:'||previsao_id::text||funcionario_id::text||produtivo::text from previsao_equipe_semana where funcionario_id in (X,K)
      union all select 'al:'||data::text||periodo_id||funcionario_id::text||coalesce(maquina_id::text,'-') from escala_producao_alocacoes where funcionario_id in (X,K)
      union all select 'cu:'||id::text||funcionario_id::text from funcionario_custos where funcionario_id in (X,K)
      union all select 'lg:'||id::text from funcionarios_exclusoes_log where funcionario_excluido_id in (X,K)
      union all select 'hi:'||id::text from apontamento_producao_historico where motivo like 'Unificação%') t);

  -- (a) falha FORÇADA no último passo (DELETE do cadastro): tudo antes precisa ser desfeito
  execute 'create function pg_temp.zz_falha() returns trigger language plpgsql as $f$ begin raise exception ''FALHA_FORCADA''; end $f$';
  execute 'create trigger zz_falha before delete on public.funcionarios for each row execute function pg_temp.zz_falha()';
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.funcionario_exclusao_executar(X, K, '{}', v_sim->>'assinatura'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('FALHA_FORCADA' in v_err) > 0;
  end;
  reset role;
  if not v_ok then raise exception 'FALHOU (T4a) deveria ter falhado: %', v_err; end if;
  
    s2 := (select md5(coalesce(string_agg(chave, '|' order by chave), '')) from (
      select 'f:'||id::text chave from funcionarios where nome='TESTE-UNIF Luana'
      union all select 'ap:'||id::text||funcionario_id::text from apontamentos_producao where funcionario_id in (X,K)
      union all select 'au:'||id::text||funcionario_id::text from ausencias_funcionarios where funcionario_id in (X,K)
      union all select 'eq:'||previsao_id::text||funcionario_id::text||produtivo::text from previsao_equipe_semana where funcionario_id in (X,K)
      union all select 'al:'||data::text||periodo_id||funcionario_id::text||coalesce(maquina_id::text,'-') from escala_producao_alocacoes where funcionario_id in (X,K)
      union all select 'cu:'||id::text||funcionario_id::text from funcionario_custos where funcionario_id in (X,K)
      union all select 'lg:'||id::text from funcionarios_exclusoes_log where funcionario_excluido_id in (X,K)
      union all select 'hi:'||id::text from apontamento_producao_historico where motivo like 'Unificação%') t);

  if s1 <> s2 then raise exception 'FALHOU (T4a) rollback incompleto'; end if;
  execute 'drop trigger zz_falha on public.funcionarios';
  -- (b) referência RESIDUAL (nova tabela com FK para funcionarios): aborta com mensagem explícita e desfaz tudo
  execute 'create table public.zz_ref_teste (f uuid references public.funcionarios(id))';
  execute format('insert into public.zz_ref_teste values (%L)', X);
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.funcionario_exclusao_executar(X, K, '{}', v_sim->>'assinatura'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('FUNC_REFERENCIAS_RESIDUAIS' in v_err) > 0 and position('zz_ref_teste' in v_err) > 0;
  end;
  reset role;
  if not v_ok then raise exception 'FALHOU (T4b) referência residual: %', v_err; end if;
  
    s2 := (select md5(coalesce(string_agg(chave, '|' order by chave), '')) from (
      select 'f:'||id::text chave from funcionarios where nome='TESTE-UNIF Luana'
      union all select 'ap:'||id::text||funcionario_id::text from apontamentos_producao where funcionario_id in (X,K)
      union all select 'au:'||id::text||funcionario_id::text from ausencias_funcionarios where funcionario_id in (X,K)
      union all select 'eq:'||previsao_id::text||funcionario_id::text||produtivo::text from previsao_equipe_semana where funcionario_id in (X,K)
      union all select 'al:'||data::text||periodo_id||funcionario_id::text||coalesce(maquina_id::text,'-') from escala_producao_alocacoes where funcionario_id in (X,K)
      union all select 'cu:'||id::text||funcionario_id::text from funcionario_custos where funcionario_id in (X,K)
      union all select 'lg:'||id::text from funcionarios_exclusoes_log where funcionario_excluido_id in (X,K)
      union all select 'hi:'||id::text from apontamento_producao_historico where motivo like 'Unificação%') t);

  if s1 <> s2 then raise exception 'FALHOU (T4b) rollback incompleto'; end if;
  execute 'drop table public.zz_ref_teste';
  -- (c) sem a falha, a mesma operação conclui (prova que o rollback não foi acaso)
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_res := public.funcionario_exclusao_executar(X, K, '{}', v_sim->>'assinatura');
  reset role;
  if exists (select 1 from funcionarios where id = X) or (select count(*) from apontamentos_producao where funcionario_id = K) <> 3 then raise exception 'FALHOU (T4c) conclusão'; end if;
  raise exception 'TESTE_OK T4: falha forçada e referência residual desfazem tudo (snapshot idêntico); sem falha, conclui';
end $$;

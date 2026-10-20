-- T6: ensaio geral com a MESMA forma dos dados reais das duas Luanas (A mantida: 91 apontamentos; B excluída: 15)
do $$
declare
  v_auth uuid := 'a27f42df-54fe-4718-93a7-0085f5ed5a09';
  v_usr uuid := 'dea8545a-dbdc-4ed7-9dc9-f44215389d91';
  v_op uuid; v_etapa uuid; v_prod uuid; v_opet uuid; v_maq uuid[]; v_snap jsonb;
  A uuid := gen_random_uuid(); B uuid := gen_random_uuid(); P3 uuid := gen_random_uuid();
  prevs uuid[]; i int; v_sim jsonb; v_res jsonb; v_n bigint;
begin
  select id into v_op from operacoes order by id limit 1;
  select id, produto_id, operacao_id into v_etapa, v_prod, v_opet from roteiro_etapas order by id limit 1;
  v_maq := array(select id from maquinas where ativo order by id limit 8);
  select periodos_snapshot into v_snap from escala_producao_dias limit 1;
  insert into funcionarios (id, nome, operacao_id, salario_base, ativo, created_at) values
    (A, 'TESTE-UNIF Luana', v_op, 2536.77, true, '2026-09-15'), (B, 'TESTE-UNIF Luana', v_op, 2536.77, true, '2026-10-15');
  -- 11 custos idênticos em cada cadastro
  insert into funcionario_custos (funcionario_id, descricao, valor) select f, 'Custo ' || g, g * 10 from generate_series(1, 11) g, unnest(array[A, B]) f;
  -- 9 semanas de equipe: padrão real (7 semanas ambos produtivos; semana 8: A não / B sim; semana 9: A sim / B não)
  for i in 0..8 loop
    prevs := prevs || gen_random_uuid();
    insert into previsoes (id, semana_inicio) values (prevs[i+1], date '2025-08-25' + i * 7);
    insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id) values
      (prevs[i+1], A, case when i = 7 then false else true end, v_op), (prevs[i+1], B, case when i = 8 then false else true end, v_op);
  end loop;
  -- apontamentos: A 91, B 15 (datas distintas)
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
    periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente)
  select v_prod, v_etapa, v_opet, v_maq[1], A, 'm1', date '2026-02-01' + g, '09:00', 100 + g, g % 7, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2 from generate_series(1, 91) g;
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
    periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente)
  select v_prod, v_etapa, v_opet, v_maq[2], B, 'm2', date '2026-06-01' + g, '10:00', 200 + g, 0, '08:48', '10:24', 100, 10, v_usr, 'produzindo', 2 from generate_series(1, 15) g;
  -- A: 1 ausência e 23 alocações de Escala (4 passadas + 19 futuras)
  insert into ausencias_funcionarios (funcionario_id, data, tipo, duracao_minutos, periodos_snapshot, idempotency_key, criado_por) values (A, '2026-10-06', 'falta_dia_inteiro', 528, '[]', gen_random_uuid(), v_usr);
  insert into previsoes (id, semana_inicio) values (P3, '2026-01-05');
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot) select d, P3, v_snap from unnest(array['2026-01-05'::date, '2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10']) d;
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas)
  select date '2026-01-05', p, A, v_maq[1], v_prod, v_etapa, v_opet, 1 from unnest(array['m1','m2','m3','t1']) p;
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas)
  select q.d, q.p, A, v_maq[1], v_prod, v_etapa, v_opet, 1 from (
    select d, p from unnest(array['2030-01-07'::date,'2030-01-08','2030-01-09','2030-01-10']) d, unnest(array['m1','m2','m3','t1','t2','t3']) p order by d, p limit 19) q;
  select count(*) into v_n from escala_producao_alocacoes where funcionario_id = A;
  if v_n <> 23 then raise exception 'FALHOU preparo: % alocações', v_n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_sim := public.funcionario_exclusao_simular(B, A, '{}');
  reset role;
  raise notice 'SIMULAÇÃO: transferir=% | consolidar(semanas conflitantes que diferem)=% de % | custos duplicados=% | pendências=% | bloqueios=% | pronto=%',
    v_sim->'transferir', (select count(*) from jsonb_array_elements(v_sim#>'{consolidar,semanas_equipe}') s where (s->>'difere')::boolean), jsonb_array_length(v_sim#>'{consolidar,semanas_equipe}'),
    jsonb_array_length(v_sim#>'{consolidar,custos_duplicados}'), jsonb_array_length(v_sim->'pendencias'), jsonb_array_length(v_sim->'bloqueios'), v_sim->>'pode_executar';
  if not (v_sim->>'pode_executar')::boolean then raise exception 'FALHOU ensaio: %', v_sim; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.funcionario_exclusao_executar(B, A, '{}', v_sim->>'assinatura');
  reset role;
  select count(*) into v_n from apontamentos_producao where funcionario_id = A;
  if v_n <> 106 or exists (select 1 from funcionarios where id = B) then raise exception 'FALHOU ensaio: apontamentos de A=% (esperado 106)', v_n; end if;
  if (select count(*) from previsao_equipe_semana where funcionario_id = A and produtivo) <> 9 then raise exception 'FALHOU ensaio: produtivo OR (A deveria estar produtivo nas 9 semanas)'; end if;
  if (select count(*) from funcionario_custos where funcionario_id = A) <> 11 then raise exception 'FALHOU ensaio: custos de A deveriam continuar 11 (duplicatas descartadas)'; end if;
  if (select count(*) from escala_producao_alocacoes where funcionario_id = A) <> 23 then raise exception 'FALHOU ensaio: alocações de A inalteradas'; end if;
  raise exception 'TESTE_OK T6 ensaio Luanas: B→A concluído — A com 106 apontamentos (91+15), produtivo nas 9 semanas, 11 custos (11 duplicatas descartadas), 23 alocações intactas';
end $$;

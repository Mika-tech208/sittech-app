-- T11: infraestrutura do MODO SOMBRA (Fase 4d) — evento lógico único por (semana, data, período), reivindicação sem consumir tentativa enquanto
-- aguarda, snapshot append-only e idempotente, lançamento tardio sem reescrever, grants, parâmetro e ausência de efeito no oficial.
-- Tudo desfeito no final (RAISE EXCEPTION 'TESTE_OK T11 ...'). Rodar só em DEV/local.
do $$
declare
  v_auth uuid; v_user uuid; v_prev uuid; v_snap jsonb;
  F1 uuid; M1 uuid; M2 uuid; M3 uuid; M4 uuid; P1 uuid; E1 uuid; O1 uuid;
  D1 date := '2031-03-04';
  v_ini time; v_fim time;
  v_id uuid; v_id2 uuid; v_n integer; v_t integer; v_ok boolean; v_err text; v_r jsonb; v_hash text; v_ev integer;
  v_dados jsonb;
begin
  select auth_user_id, id into v_auth, v_user from usuarios where papel = 'admin' and ativo order by id limit 1;
  select id into F1 from funcionarios where ativo order by id limit 1;
  select (array_agg(id order by id))[1], (array_agg(id order by id))[2], (array_agg(id order by id))[3], (array_agg(id order by id))[4] into M1, M2, M3, M4 from (select id from maquinas where ativo order by id limit 4) t;
  select produto_id, id, operacao_id into P1, E1, O1 from roteiro_etapas order by id limit 1;
  select inicio, fim into v_ini, v_fim from periodos where id = 'm1';
  if v_auth is null or F1 is null or M4 is null or E1 is null then raise exception 'FALHOU setup do DEV'; end if;

  insert into previsoes (semana_inicio) values ('2031-03-03') returning id into v_prev;
  select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', inicio, 'fim', fim) order by id) into v_snap from periodos;
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (D1, v_prev, v_snap, 0);

  select count(*) into v_ev from escala_producao_eventos where tipo = 'previsao';

  -- (1) modo desligado (padrão): o trigger não registra nada
  update escala_parametros set valor = '"desligado"' where chave = 'replanejamento_modo';
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por)
    values (P1, E1, O1, M1, F1, 'm1', D1, '08:00', 10, v_ini, v_fim, 100, 1, v_user);
  select count(*) into v_n from escala_producao_eventos where tipo = 'apontamento_periodo';
  if v_n <> 0 then raise exception 'FALHOU (1) desligado não deveria registrar evento: %', v_n; end if;

  -- (2) modo sombra: 20 lançamentos do MESMO período = UM evento lógico (4 inserts + 16 updates)
  update escala_parametros set valor = '"sombra"' where chave = 'replanejamento_modo';
  select count(*) into v_t from escala_producao_eventos where tipo = 'previsao';
  if v_t <> v_ev then raise exception 'FALHOU (2) trocar o modo não pode gerar recálculo do oficial (% -> %)', v_ev, v_t; end if;
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por) values
    (P1, E1, O1, M2, F1, 'm1', D1, '08:01', 10, v_ini, v_fim, 100, 1, v_user),
    (P1, E1, O1, M3, F1, 'm1', D1, '08:02', 10, v_ini, v_fim, 100, 1, v_user),
    (P1, E1, O1, M4, F1, 'm1', D1, '08:03', 10, v_ini, v_fim, 100, 1, v_user);
  for v_n in 1..16 loop update apontamentos_producao set quantidade_produzida = quantidade_produzida + 1 where data = D1 and periodo_id = 'm1' and maquina_id = M1; end loop;
  select count(*), max(lancamentos), max(id::text)::uuid into v_n, v_t, v_id from escala_producao_eventos where tipo = 'apontamento_periodo' and previsao_id = v_prev;
  if v_n <> 1 then raise exception 'FALHOU (2) esperado 1 evento lógico, veio %', v_n; end if;
  if v_t <> 19 then raise exception 'FALHOU (2) lançamentos contados: esperado 19 (3 inserts + 16 updates; o 1º insert foi com o modo desligado), veio %', v_t; end if;
  if (select status from escala_producao_eventos where id = v_id) <> 'pendente' or (select tentativas from escala_producao_eventos where id = v_id) <> 0 then raise exception 'FALHOU (2) evento deveria estar pendente e sem tentativas'; end if;
  if (select chave from escala_producao_eventos where id = v_id) <> v_prev::text || '|2031-03-04|m1' then raise exception 'FALHOU (2) chave lógica incorreta'; end if;

  -- (3) outro período = outro evento
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por)
    values (P1, E1, O1, M1, F1, 'm2', D1, '09:00', 10, v_ini, v_fim, 100, 1, v_user);
  select count(*) into v_n from escala_producao_eventos where tipo = 'apontamento_periodo' and previsao_id = v_prev;
  if v_n <> 2 then raise exception 'FALHOU (3) esperado 2 eventos (m1 e m2), veio %', v_n; end if;

  -- (4) o worker (service_role) lista sem consumir tentativa; só a reivindicação consome, e só uma vez
  set local role service_role;
  select count(*) into v_n from escala_sombra_listar_eventos() where previsao_id = v_prev;
  if v_n <> 2 then raise exception 'FALHOU (4) listar deveria devolver 2, veio %', v_n; end if;
  select count(*) into v_n from escala_sombra_listar_eventos() where previsao_id = v_prev;  -- listar de novo: nada muda
  reset role;
  if (select max(tentativas) from escala_producao_eventos where previsao_id = v_prev and tipo = 'apontamento_periodo') <> 0 then raise exception 'FALHOU (4) aguardar não pode consumir tentativa'; end if;
  set local role service_role;
  if not escala_sombra_reivindicar(v_id) then raise exception 'FALHOU (4) primeira reivindicação deveria vencer'; end if;
  if escala_sombra_reivindicar(v_id) then raise exception 'FALHOU (4) segunda reivindicação (concorrente) deveria perder'; end if;
  reset role;
  if (select tentativas from escala_producao_eventos where id = v_id) <> 1 then raise exception 'FALHOU (4) tentativas deveria ser 1'; end if;

  -- (5) snapshot idempotente (a 1ª vale) e append-only
  v_dados := jsonb_build_object(
    'previsao_id', v_prev, 'semana_inicio', '2031-03-03', 'data', D1, 'periodo_id', 'm1', 'slot', 0, 'corte_em', '2031-03-04T11:10:00Z', 'motivo_fechamento', 'prazo', 'dados_completos', false,
    'completude_percentual', 75, 'postos_esperados', 4, 'postos_recebidos', 3, 'postos_faltantes', '["x"]'::jsonb, 'ultimo_lancamento_em', '2031-03-04T11:05:00Z',
    'lancamentos_tardios_na_leitura', 0, 'latencia_ms', 1000, 'horizonte', '{}'::jsonb, 'compromisso', '{}'::jsonb, 'entradas', '{}'::jsonb, 'planos', '{}'::jsonb, 'diagnostico', '{}'::jsonb,
    'entrada', '{"versao":1}'::jsonb, 'hash_entrada', 'h1', 'hash_plano_oficial', 'h2', 'hash_plano_sombra', 'h3', 'hash_decisao', 'h4', 'situacao', 'B→C', 'versao_motor', '4d.1', 'replanejamento_modo', 'sombra');
  set local role service_role;
  v_r := escala_sombra_gravar_decisao(v_id, v_dados);
  if (v_r->>'inserida') <> 'true' then raise exception 'FALHOU (5) primeira gravação deveria inserir'; end if;
  v_id2 := (v_r->>'id')::uuid;
  v_r := escala_sombra_gravar_decisao(v_id, v_dados || '{"hash_decisao":"OUTRO","situacao":"A"}'::jsonb);
  if (v_r->>'inserida') <> 'false' or (v_r->>'id')::uuid <> v_id2 then raise exception 'FALHOU (5) segunda gravação deveria devolver a mesma decisão sem inserir'; end if;
  perform escala_concluir_eventos(array[v_id], 'processado', null);
  reset role;
  select count(*), max(hash_decisao) into v_n, v_hash from escala_sombra_decisoes where previsao_id = v_prev and data = D1 and periodo_id = 'm1';
  if v_n <> 1 or v_hash <> 'h4' then raise exception 'FALHOU (5) deveria existir 1 decisão intacta (h4), veio % / %', v_n, v_hash; end if;
  begin update escala_sombra_decisoes set situacao = 'A' where id = v_id2; v_ok := false; exception when others then v_err := sqlerrm; v_ok := position('ESCALA_SOMBRA_IMUTAVEL' in v_err) > 0; end;
  if not v_ok then raise exception 'FALHOU (5) update do snapshot deveria ser bloqueado: %', v_err; end if;
  begin delete from escala_sombra_decisoes where id = v_id2; v_ok := false; exception when others then v_err := sqlerrm; v_ok := position('ESCALA_SOMBRA_IMUTAVEL' in v_err) > 0; end;
  if not v_ok then raise exception 'FALHOU (5) delete do snapshot deveria ser bloqueado: %', v_err; end if;

  -- (6) lançamento TARDIO (depois da decisão) só conta no evento; o snapshot não muda e nenhuma 2ª decisão nasce
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por)
    values (P1, E1, O1, M4, F1, 'm3', D1, '11:00', 10, v_ini, v_fim, 100, 1, v_user);
  update apontamentos_producao set quantidade_produzida = quantidade_produzida + 5 where data = D1 and periodo_id = 'm1' and maquina_id = M2;
  if (select lancamentos_tardios from escala_producao_eventos where id = v_id) <> 1 or (select status from escala_producao_eventos where id = v_id) <> 'processado' then raise exception 'FALHOU (6) tardio deveria ser contado no evento processado'; end if;
  select count(*), max(hash_decisao) into v_n, v_hash from escala_sombra_decisoes where previsao_id = v_prev and data = D1 and periodo_id = 'm1';
  if v_n <> 1 or v_hash <> 'h4' then raise exception 'FALHOU (6) o snapshot não pode mudar por lançamento tardio'; end if;
  if (select count(*) from escala_producao_eventos where tipo = 'apontamento_periodo' and previsao_id = v_prev and (payload->>'periodo_id') = 'm1') <> 1 then raise exception 'FALHOU (6) não pode nascer 2º evento do mesmo período'; end if;

  -- (7) resultado posterior é separado e também imutável; não toca a decisão
  set local role service_role;
  insert into escala_sombra_resultados (decisao_id, realizado, falta_efetiva, observacoes) values (v_id2, '{"boas":123}'::jsonb, '{"falta":9}'::jsonb, 'teste');
  reset role;
  begin update escala_sombra_resultados set observacoes = 'x'; v_ok := false; exception when others then v_ok := position('ESCALA_SOMBRA_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7) resultado deveria ser append-only'; end if;

  -- (8) grants: o navegador (authenticated) lê (admin) mas não escreve nem executa as RPCs
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from escala_sombra_decisoes where previsao_id = v_prev;
  if v_n <> 1 then raise exception 'FALHOU (8) admin deveria ler a decisão'; end if;
  begin insert into escala_sombra_decisoes (previsao_id, semana_inicio, data, periodo_id, slot, corte_em, motivo_fechamento, dados_completos, completude_percentual, postos_esperados, postos_recebidos, horizonte, compromisso, entradas, planos, diagnostico, entrada, hash_entrada, hash_plano_oficial, hash_plano_sombra, hash_decisao, situacao, versao_motor, replanejamento_modo)
      values (v_prev, D1, D1, 'm9', 1, now(), 'prazo', false, 0, 0, 0, '{}', '{}', '{}', '{}', '{}', '{}', 'a', 'b', 'c', 'd', 'A', 'x', 'sombra'); v_ok := false;
  exception when others then v_ok := position('permission denied' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (8) authenticated não pode inserir decisão'; end if;
  begin perform escala_sombra_reivindicar(v_id); v_ok := false; exception when others then v_ok := position('permission denied' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (8) authenticated não pode reivindicar'; end if;
  begin perform escala_sombra_apontamentos(D1); v_ok := false; exception when others then v_ok := position('permission denied' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (8) authenticated não pode ler apontamentos pela RPC'; end if;
  reset role;

  -- (9) parâmetro: só desligado/sombra/ativo
  begin update escala_parametros set valor = '"loucura"' where chave = 'replanejamento_modo'; v_ok := false; exception when others then v_ok := position('escala_parametros_replanejamento_modo' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (9) valor inválido deveria ser recusado'; end if;
  update escala_parametros set valor = '"ativo"' where chave = 'replanejamento_modo';
  if escala_replanejamento_modo() <> 'ativo' then raise exception 'FALHOU (9) leitura do modo'; end if;

  -- (10) nada disso tocou a Escala oficial
  if (select count(*) from escala_producao_alocacoes where data = D1) <> 0 or (select versao from escala_producao_dias where data = D1) <> 0 then raise exception 'FALHOU (10) a escala oficial não pode ser alterada'; end if;

  raise exception 'TESTE_OK T11: evento lógico único (19 lançamentos = 1 evento), aguardar não consome tentativa, reivindicação atômica, snapshot idempotente e append-only, tardio só contado, resultado separado, grants, parâmetro, oficial intacto';
end $$;

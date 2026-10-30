-- NÃO APLICADO — teste do rascunho docs/NAO-APLICADO-revezamento-ponte-m3-t1.sql. Rodar SÓ em Postgres local/DEV, dentro de transação com rollback:
--   begin; \i docs/NAO-APLICADO-revezamento-ponte-m3-t1.sql; \i docs/NAO-APLICADO-t16-revezamento-ponte-m3-t1.sql; rollback;
do $$
declare
  v_auth uuid; v_prev uuid; v_snap jsonb; FA uuid; FB uuid; MA uuid; MB uuid; MC uuid; MD uuid;
  EX uuid; EY uuid; PX uuid; PY uuid; OX uuid; OY uuid;
  D1 date := '2031-03-04'; D2 date := '2031-03-05'; D3 date := '2031-03-06';
  v_ok boolean; v_err text;
begin
  select auth_user_id into v_auth from usuarios where papel = 'admin' and ativo order by id limit 1;
  select id into FA from funcionarios where ativo order by id limit 1;
  select id into FB from funcionarios where ativo and id <> FA order by id limit 1;
  select (array_agg(id order by id))[1], (array_agg(id order by id))[2], (array_agg(id order by id))[3], (array_agg(id order by id))[4] into MA, MB, MC, MD from (select id from maquinas where ativo order by id limit 4) t;
  select x[1], x[2], p[1], p[2], o[1], o[2] into EX, EY, PX, PY, OX, OY
    from (select array_agg(id order by operacao_id) x, array_agg(produto_id order by operacao_id) p, array_agg(operacao_id order by operacao_id) o
            from (select distinct on (operacao_id) id, produto_id, operacao_id from roteiro_etapas order by operacao_id, id limit 2) q) z;
  insert into previsoes (semana_inicio) values ('2031-03-03') returning id into v_prev;
  select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', inicio, 'fim', fim) order by id) into v_snap from periodos;
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (D1, v_prev, v_snap, 0), (D2, v_prev, v_snap, 0), (D3, v_prev, v_snap, 0);
  -- D1: FA: m3 X, t1 Y | FB: m3 Y, t1 X  (nenhuma repetição M3→T1); trocar t1 faria FA repetir X em t1 (e FB repetir Y)
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values
    (D1,'m3',FA,MA,PX,EX,OX,0,null),(D1,'t1',FA,MB,PY,EY,OY,0,null),(D1,'m3',FB,MC,PY,EY,OY,0,null),(D1,'t1',FB,MD,PX,EX,OX,0,null),
    (D2,'t1',FA,MA,PX,EX,OX,0,null),(D2,'t1',FB,MB,PY,EY,OY,0,null),
    (D3,'m3',FA,MA,PX,EX,OX,0,null),(D3,'t1',FA,MB,PY,EY,OY,0,null),(D3,'m3',FB,MC,PY,EY,OY,0,null),(D3,'t1',FB,MD,PX,EX,OX,0,null);
  update escala_parametros set valor = '"bloco"' where chave = 'revezamento_escopo';

  -- (0) flag: padrão false; só boolean; inefetiva sem o escopo bloco
  if (select public.escala_revezamento_regras() ->> 'ponte_m3_t1') is distinct from 'false' then raise exception 'FALHOU (0) padrão deveria ser false'; end if;
  begin update escala_parametros set valor = '"sim"' where chave = 'revezamento_ponte_m3_t1'; v_ok := false; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU (0) valor não booleano deveria ser recusado'; end if;

  -- (1) flag DESLIGADA: a troca em t1 (FA passa a X depois de X em m3) é PERMITIDA (regra de bloco atual) — e é revertida a seguir
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.escala_trocar_alocacoes(D1, 't1', FA, FB, 'ponte desligada permite');
  reset role;
  if (select operacao_id from escala_producao_alocacoes where data = D1 and periodo_id = 't1' and funcionario_id = FA) is distinct from OX then raise exception 'FALHOU (1) a troca deveria ter sido aplicada'; end if;
  if public.escala_repeticoes_ponte(D1, FA) <> 1 then raise exception 'FALHOU (1) repeticoes_ponte deveria contar 1 (FA: X em m3 e t1)'; end if;

  -- (2) liga a ponte: a mesma troca (no dia D3, idêntico a D1 antes da troca) é BLOQUEADA (mesmo com motivo), sem rastro
  update escala_parametros set valor = 'true' where chave = 'revezamento_ponte_m3_t1';
  if (select public.escala_revezamento_regras() ->> 'ponte_m3_t1') is distinct from 'true' then raise exception 'FALHOU (2) flag não mudou'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.escala_trocar_alocacoes(D3, 't1', FA, FB, 'urgente, autorizado'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('ESCALA_ROTACAO_VIOLADA' in v_err) > 0 and position('último período da manhã' in v_err) > 0; end;
  reset role;
  if not v_ok then raise exception 'FALHOU (2) a ponte deveria bloquear: %', v_err; end if;
  if (select count(*) from escala_producao_alocacoes where data = D3 and (origem = 'manual' or excecao_revezamento)) <> 0 then raise exception 'FALHOU (2) rastro da troca bloqueada'; end if;

  -- (3) a ponte NÃO vale com o escopo consecutivo (o consecutivo já conta M3→T1 do seu jeito) e é só M3→T1: D2 não tem m3 ⇒ 0
  update escala_parametros set valor = '"consecutivo"' where chave = 'revezamento_escopo';
  if public.escala_ponte_m3_t1_ativa() then raise exception 'FALHOU (3) ponte não deveria estar ativa sem o escopo bloco'; end if;
  update escala_parametros set valor = '"bloco"' where chave = 'revezamento_escopo';
  if public.escala_repeticoes_ponte(D2, FA) <> 0 then raise exception 'FALHOU (3) dia sem m3 não tem ponte'; end if;

  -- (4) equivalência vale na ponte: Y ≡ expõe X; FA fez X em m3 e Y em t1 ⇒ ponte
  update escala_parametros set valor = jsonb_build_object(OY::text, jsonb_build_array(OX::text)) where chave = 'revezamento_equivalencias';
  if public.escala_repeticoes_ponte(D3, FA) <> 1 then raise exception 'FALHOU (4) equivalência deveria gerar ponte'; end if;

  raise exception 'TESTE_OK T16: ponte M3→T1 (parâmetro, leitura, bloqueio da troca, desligada permite, escopo, equivalência)';
end $$;

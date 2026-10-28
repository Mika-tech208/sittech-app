-- T12: REVEZAMENTO POR BLOCO (migration 20261105200000) — escala_trocar_alocacoes com revezamento_escopo = 'bloco':
-- bloqueia a troca que AUMENTA as repetições da mesma operação na mesma manhã (m1-m3) / tarde (t1-t3); M3→T1 é permitido; o dia seguinte é livre;
-- equivalência de operações (opcional) vale; escopo 'consecutivo' (padrão) mantém a regra anterior; parâmetros validados. Tudo desfeito no final. Rodar só em DEV/local.
do $$
declare
  v_auth uuid; v_prev uuid; v_snap jsonb;
  FA uuid; FB uuid;
  MA uuid; MB uuid; MC uuid; MD uuid;
  EX uuid; EY uuid; EZ uuid; PX uuid; PY uuid; PZ uuid; OX uuid; OY uuid; OZ uuid;
  D1 date := '2031-03-04'; D2 date := '2031-03-05'; D3 date := '2031-03-06'; D4 date := '2031-03-07';
  v_ok boolean; v_err text; v_n integer;
begin
  select auth_user_id into v_auth from usuarios where papel = 'admin' and ativo order by id limit 1;
  select id into FA from funcionarios where ativo order by id limit 1;
  select id into FB from funcionarios where ativo and id <> FA order by id limit 1;
  select (array_agg(id order by id))[1], (array_agg(id order by id))[2], (array_agg(id order by id))[3], (array_agg(id order by id))[4] into MA, MB, MC, MD from (select id from maquinas where ativo order by id limit 4) t;
  select x[1], x[2], x[3], p[1], p[2], p[3], o[1], o[2], o[3] into EX, EY, EZ, PX, PY, PZ, OX, OY, OZ
    from (select array_agg(id order by operacao_id) x, array_agg(produto_id order by operacao_id) p, array_agg(operacao_id order by operacao_id) o
            from (select distinct on (operacao_id) id, produto_id, operacao_id from roteiro_etapas order by operacao_id, id limit 3) q) z;
  if FA is null or FB is null or MD is null or OZ is null then raise exception 'FALHOU setup: o DEV precisa de 2 funcionários, 4 máquinas e 3 operações distintas'; end if;

  insert into previsoes (semana_inicio) values ('2031-03-03') returning id into v_prev;
  select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', inicio, 'fim', fim) order by id) into v_snap from periodos;
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (D1, v_prev, v_snap, 0), (D2, v_prev, v_snap, 0), (D3, v_prev, v_snap, 0), (D4, v_prev, v_snap, 0);

  -- D1: FA: m1 X, m2 Z, m3 Y, t1 X | FB: m1 Z, m2 -, m3 X, t1 Y   (nenhuma repetição no bloco)
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values
    (D1,'m1',FA,MA,PX,EX,OX,0,null),(D1,'m2',FA,MB,PZ,EZ,OZ,0,null),(D1,'m3',FA,MC,PY,EY,OY,0,null),(D1,'t1',FA,MA,PX,EX,OX,0,null),
    (D1,'m1',FB,MD,PZ,EZ,OZ,0,null),(D1,'m2',FB,null,null,null,null,0,'sem carga'),(D1,'m3',FB,MA,PX,EX,OX,0,null),(D1,'t1',FB,MB,PY,EY,OY,0,null);
  -- D2: FA: m1 Y, m3 X | FB: m3 Z   (para a equivalência Y ≡ expõe Z)
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values
    (D2,'m1',FA,MA,PY,EY,OY,0,null),(D2,'m3',FA,MB,PX,EX,OX,0,null),(D2,'m3',FB,MC,PZ,EZ,OZ,0,null);
  -- D3: sem histórico (dia seguinte livre)
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values
    (D3,'m1',FA,MA,PX,EX,OX,0,null),(D3,'m1',FB,MB,PY,EY,OY,0,null);
  -- D4: escopo consecutivo (FA: X Y | FB: Z X)
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values
    (D4,'m1',FA,MA,PX,EX,OX,0,null),(D4,'m2',FA,MB,PY,EY,OY,0,null),(D4,'m1',FB,MC,PZ,EZ,OZ,0,null),(D4,'m2',FB,MD,PX,EX,OX,0,null);

  -- (0) parâmetros: padrão consecutivo, equivalências vazias; valor inválido recusado
  if (select public.escala_revezamento_regras() ->> 'escopo') is distinct from 'consecutivo' then raise exception 'FALHOU (0) padrão deveria ser consecutivo'; end if;
  if (select public.escala_revezamento_regras() -> 'equivalencias') is distinct from '{}'::jsonb then raise exception 'FALHOU (0) equivalências deveriam ser vazias'; end if;
  begin update escala_parametros set valor = '"talvez"' where chave = 'revezamento_escopo'; v_ok := false; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU (0) valor inválido de revezamento_escopo'; end if;
  begin update escala_parametros set valor = '[1]'::jsonb where chave = 'revezamento_equivalencias'; v_ok := false; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU (0) revezamento_equivalencias deve ser objeto'; end if;

  -- (1) escopo CONSECUTIVO (padrão): X Y consecutivo é bloqueado; a troca "m1 X ... m3 X" (mesmo bloco, não consecutivos) é PERMITIDA
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.escala_trocar_alocacoes(D4, 'm2', FA, FB, 'consecutivo bloqueia'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('ESCALA_ROTACAO_VIOLADA' in v_err) > 0 and position('períodos consecutivos' in v_err) > 0; end;
  if not v_ok then raise exception 'FALHOU (1) consecutivo deveria bloquear: %', v_err; end if;
  reset role;

  -- (2) liga o escopo BLOCO
  update escala_parametros set valor = '"bloco"' where chave = 'revezamento_escopo';
  if (select public.escala_revezamento_regras() ->> 'escopo') is distinct from 'bloco' then raise exception 'FALHOU (2) escopo não mudou'; end if;
  if public.escala_repeticoes_bloco(D1, FA, 'm') <> 0 or public.escala_repeticoes_bloco(D1, FA, 't') <> 0 then raise exception 'FALHOU (2) D1 não deveria ter repetição'; end if;

  -- (3) M3: FA faria X (já fez X no m1, na mesma manhã; m2 foi Z — NÃO consecutivo): BLOQUEADA no bloco, mesmo com administrador e com motivo
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.escala_trocar_alocacoes(D1, 'm3', FA, FB, 'urgente, autorizado pelo diretor'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('ESCALA_ROTACAO_VIOLADA' in v_err) > 0 and position('na mesma manhã ou na mesma tarde' in v_err) > 0; end;
  if not v_ok then raise exception 'FALHOU (3) troca no mesmo bloco deveria ser bloqueada: %', v_err; end if;
  reset role;
  select count(*) into v_n from escala_producao_alocacoes where data = D1 and (excecao_revezamento or origem = 'manual');
  if v_n <> 0 then raise exception 'FALHOU (3) a troca bloqueada deixou rastro: %', v_n; end if;
  if (select operacao_id from escala_producao_alocacoes where data = D1 and periodo_id = 'm3' and funcionario_id = FA) is distinct from OY then raise exception 'FALHOU (3) a alocação mudou'; end if;

  -- (4) M3 → T1 é PERMITIDO: FA faria Y no t1 (fez Y no m3); FB faria X no t1 (fez X no m3)
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.escala_trocar_alocacoes(D1, 't1', FA, FB, 'manhã e tarde são blocos distintos');
  reset role;
  if (select operacao_id from escala_producao_alocacoes where data = D1 and periodo_id = 't1' and funcionario_id = FA) is distinct from OY then raise exception 'FALHOU (4) a troca M3→T1 deveria ter sido feita'; end if;
  select count(*) into v_n from escala_producao_alocacoes where data = D1 and excecao_revezamento;
  if v_n <> 0 then raise exception 'FALHOU (4) nenhuma exceção deve ser criada: %', v_n; end if;

  -- (5) EQUIVALÊNCIA (opcional): com {Y:[Z]} o Y do m1 expõe também Z: FA no m3 faria Z → bloqueada; sem o mapa seria permitida
  update escala_parametros set valor = jsonb_build_object(OY::text, jsonb_build_array(OZ::text)) where chave = 'revezamento_equivalencias';
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.escala_trocar_alocacoes(D2, 'm3', FA, FB, 'equivalência'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('ESCALA_ROTACAO_VIOLADA' in v_err) > 0; end;
  if not v_ok then raise exception 'FALHOU (5) equivalência deveria bloquear: %', v_err; end if;
  reset role;
  update escala_parametros set valor = '{}'::jsonb where chave = 'revezamento_equivalencias';
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.escala_trocar_alocacoes(D2, 'm3', FA, FB, 'sem equivalência a identidade é a operação');
  reset role;

  -- (6) dia seguinte livre: sem histórico a troca passa
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.escala_trocar_alocacoes(D3, 'm1', FA, FB, 'dia novo');
  reset role;

  -- (7) repetição ANTIGA e alheia à troca não bloqueia (FA ganha uma repetição existente em D4, a troca de outro período não a agrava)
  update escala_producao_alocacoes set operacao_id = OX, produto_id = PX, etapa_id = EX where data = D4 and periodo_id = 'm2' and funcionario_id = FA; -- FA: X, X no mesmo bloco (preexistente)
  if public.escala_repeticoes_bloco(D4, FA, 'm') <> 1 then raise exception 'FALHOU (7) contagem de repetições esperada 1'; end if;
  if not public.escala_linha_repete_no_bloco(D4, FA, 'm2') or public.escala_linha_repete_no_bloco(D4, FA, 'm1') then raise exception 'FALHOU (7) marca da linha repetida'; end if;

  -- (8) volta ao padrão: consecutivo de novo
  update escala_parametros set valor = '"consecutivo"' where chave = 'revezamento_escopo';
  if (select public.escala_revezamento_regras() ->> 'escopo') is distinct from 'consecutivo' then raise exception 'FALHOU (8) rollback do escopo'; end if;

  raise exception 'TESTE_OK T12: revezamento por bloco — bloqueia mesma operação no mesmo bloco (com motivo/administrador), permite M3→T1 e dia seguinte, equivalência opcional, repetição antiga não bloqueia, consecutivo preservado (tudo desfeito)';
end $$;

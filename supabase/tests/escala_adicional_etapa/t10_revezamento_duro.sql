-- T10: REVEZAMENTO DURO na troca manual (RPC escala_trocar_alocacoes) — bloqueia SEMPRE a repetição da mesma operação em períodos
-- consecutivos (outra máquina conta; M3→T1 conta; o dia seguinte zera; sem exceção, sem motivo que libere, sem bypass do administrador).
-- Tudo desfeito no final (RAISE EXCEPTION 'TESTE_OK T10 ...'). Rodar só em DEV/local.
do $$
declare
  v_auth uuid; v_prev uuid; v_snap jsonb;
  FA uuid; FB uuid;
  MA uuid; MB uuid; MC uuid; MD uuid;
  EX uuid; EY uuid; EZ uuid; PX uuid; PY uuid; PZ uuid; OX uuid; OY uuid; OZ uuid;
  D1 date := '2031-03-04'; D2 date := '2031-03-05';
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
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (D1, v_prev, v_snap, 0), (D2, v_prev, v_snap, 0);

  -- dia 1 — FA: X Y Z Y idle X | FB: Z X Y X idle idle (nenhuma repetição consecutiva)
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values
    (D1,'m1',FA,MA,PX,EX,OX,0,null),(D1,'m2',FA,MB,PY,EY,OY,0,null),(D1,'m3',FA,MC,PZ,EZ,OZ,0,null),(D1,'t1',FA,MB,PY,EY,OY,0,null),
    (D1,'t2',FA,null,null,null,null,0,'sem carga'),(D1,'t3',FA,MD,PX,EX,OX,0,null),
    (D1,'m1',FB,MC,PZ,EZ,OZ,0,null),(D1,'m2',FB,MD,PX,EX,OX,0,null),(D1,'m3',FB,MB,PY,EY,OY,0,null),(D1,'t1',FB,MA,PX,EX,OX,0,null),
    (D1,'t2',FB,null,null,null,null,0,'sem carga'),(D1,'t3',FB,null,null,null,null,0,'sem carga');
  -- dia 2 — FA: Y... | FB: X...
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values
    (D2,'m1',FA,MB,PY,EY,OY,0,null),(D2,'m1',FB,MA,PX,EX,OX,0,null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- (1) mesma operação do período anterior em OUTRA máquina (X@MA em m1; troca no m2 daria X@MD): BLOQUEADA, mesmo como administrador e com motivo
  begin perform public.escala_trocar_alocacoes(D1, 'm2', FA, FB, 'urgente, autorizado pelo diretor'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('ESCALA_ROTACAO_VIOLADA' in v_err) > 0 and position('repetir a mesma operação em períodos consecutivos' in v_err) > 0; end;
  if not v_ok then raise exception 'FALHOU (1) troca com repetição (outra máquina) deveria ser bloqueada: %', v_err; end if;

  -- (2) M3 → T1 conta como consecutivo (FB faz Y em m3; a troca no t1 daria Y em t1)
  begin perform public.escala_trocar_alocacoes(D1, 't1', FA, FB, 'qualquer motivo'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('ESCALA_ROTACAO_VIOLADA' in v_err) > 0; end;
  if not v_ok then raise exception 'FALHOU (2) M3→T1 deveria ser bloqueada: %', v_err; end if;

  -- (3) o bloqueio não deixa rastro: nada mudou e nenhuma exceção foi criada
  reset role;
  select count(*) into v_n from escala_producao_alocacoes where data = D1 and (excecao_revezamento or origem = 'manual');
  if v_n <> 0 then raise exception 'FALHOU (3) a troca bloqueada deixou rastro: %', v_n; end if;
  if (select maquina_id from escala_producao_alocacoes where data = D1 and periodo_id = 'm2' and funcionario_id = FA) is distinct from MB then raise exception 'FALHOU (3) a alocação mudou'; end if;

  -- (4) dia seguinte zera: FA faz X no t3 do dia 1 e a troca no m1 do dia 2 lhe daria X — PERMITIDA
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.escala_trocar_alocacoes(D2, 'm1', FA, FB, 'reset no dia seguinte');
  reset role;
  if (select operacao_id from escala_producao_alocacoes where data = D2 and periodo_id = 'm1' and funcionario_id = FA) is distinct from OX then raise exception 'FALHOU (4) a troca do dia seguinte deveria ter sido feita'; end if;
  select count(*) into v_n from escala_producao_alocacoes where data = D2 and excecao_revezamento;
  if v_n <> 0 then raise exception 'FALHOU (4) nenhuma exceção deve ser criada: %', v_n; end if;

  -- (5) troca entre quem está sem posto (sem efeito de revezamento) é permitida
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.escala_trocar_alocacoes(D1, 't2', FA, FB, 'sem posto nos dois');
  reset role;

  -- (6) o parâmetro aceita só duro/mole
  begin update escala_parametros set valor = '"talvez"' where chave = 'revezamento_modo'; v_ok := false;
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU (6) valor inválido do parâmetro'; end if;

  raise exception 'TESTE_OK T10: revezamento duro na troca manual — bloqueia outra máquina e M3→T1, dia seguinte zera, sem exceção nem rastro (tudo desfeito)';
end $$;

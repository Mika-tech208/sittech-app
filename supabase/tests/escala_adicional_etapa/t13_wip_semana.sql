-- T13: limite de WIP POR SEMANA (wip_dias_limite_semanas) + parâmetros de WIP dentro da versão do plano. Tudo desfeito no final. Rodar só em DEV/local.
do $$
declare
  v_prev uuid; v_ent jsonb; v_ok boolean; v_global text;
begin
  -- (1) a chave existe, objeto vazio por padrão; o padrão global não foi tocado
  if (select valor from escala_parametros where chave = 'wip_dias_limite_semanas') <> '{}'::jsonb then raise exception 'FALHOU (1) deveria nascer vazio'; end if;
  select valor #>> '{}' into v_global from escala_parametros where chave = 'wip_dias_limite';

  -- (2) só aceita objeto
  begin update escala_parametros set valor = '[1,2]'::jsonb where chave = 'wip_dias_limite_semanas'; v_ok := false; exception when others then v_ok := position('escala_parametros_wip_dias_semanas' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2) valor que não é objeto deveria ser recusado'; end if;

  -- (3) a versão do plano carrega os parâmetros de WIP; o limite por semana vale só para a semana configurada
  insert into previsoes (semana_inicio) values ('2031-03-03') returning id into v_prev;
  v_ent := escala_plano_entrada(v_prev);
  if v_ent->'parametros'->>'wipModo' is null or (v_ent->'parametros'->'wipDiasLimitePorSemana') <> 'null'::jsonb then raise exception 'FALHOU (3) sem configuração por semana: %', v_ent->'parametros'; end if;
  update escala_parametros set valor = '{"2031-03-03": 2}'::jsonb where chave = 'wip_dias_limite_semanas';
  v_ent := escala_plano_entrada(v_prev);
  if (v_ent->'parametros'->>'wipDiasLimitePorSemana')::numeric <> 2 then raise exception 'FALHOU (3) semana configurada deveria ter 2: %', v_ent->'parametros'; end if;
  if (v_ent->'parametros'->>'wipDiasLimite')::numeric <> v_global::numeric then raise exception 'FALHOU (3) o limite global não pode mudar'; end if;
  insert into previsoes (semana_inicio) values ('2031-03-10');
  if (escala_plano_entrada((select id from previsoes where semana_inicio = '2031-03-10'))->'parametros'->'wipDiasLimitePorSemana') <> 'null'::jsonb then raise exception 'FALHOU (3) outra semana não pode herdar o limite'; end if;
  if (select valor #>> '{}' from escala_parametros where chave = 'wip_dias_limite') <> v_global then raise exception 'FALHOU (3) padrão global alterado'; end if;

  raise exception 'TESTE_OK T13: limite por semana só para a semana configurada, padrão global intacto, parâmetros de WIP na versão do plano';
end $$;

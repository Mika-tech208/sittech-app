-- T8: adicional por etapa — RPC, preservação no upsert, validações, parâmetros, permissões e tipo_adicional
do $$
declare
  v_auth uuid := 'a27f42df-54fe-4718-93a7-0085f5ed5a09';
  PROD uuid := '27c229d7-f192-41eb-aad1-0c69ece53eba';              -- 4 etapas
  E uuid[] := array['ca90456c-9077-40f4-a058-bd0f467e87ec','78aaa207-b8cc-412a-8a8b-d17bd95a1930','34371af3-2608-42cc-9ded-1f7815a635a8','b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4']::uuid[];
  OUTRO_PROD_ETAPA uuid := '6ce19ea6-baf9-4e1e-b3b9-c84eec3125c0';  -- etapa de OUTRO produto
  SEM date := '2031-03-03';
  v_prev uuid; v_item uuid; v_item2 uuid; v_n bigint; v_ok boolean; v_err text; v_q numeric; v_em1 timestamptz; v_em2 timestamptz; v_ev0 bigint; v_ev1 bigint;
  itens jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- (1) cria a semana com adicional por etapa: 1000 / 600 / 600 / 400
  itens := jsonb_build_array(jsonb_build_object('produto_id', PROD, 'produto_nome', 'TESTE', 'valor_unitario', 2, 'quantidade', 500,
      'maquinas_por_etapa', '{}'::jsonb, 'adicional_etapas', jsonb_build_object(E[1]::text, 1000, E[2]::text, 600, E[3]::text, 600, E[4]::text, 400)));
  v_prev := public.upsert_previsao_semana(SEM, itens, '[]', '[]');
  select id into v_item from previsao_itens where previsao_id = v_prev and tipo = 'previsto';
  select count(*) into v_n from previsao_item_adicional_etapa where item_id = v_item;
  if v_n <> 4 then raise exception 'FALHOU (1) esperava 4 linhas por etapa: %', v_n; end if;
  select quantidade_adicional into v_q from previsao_itens where id = v_item;
  if v_q <> 400 then raise exception 'FALHOU (1) quantidade_adicional (acabado) deveria acompanhar a última etapa: %', v_q; end if;
  select adicional_atualizado_em into v_em1 from previsao_itens where id = v_item;
  if v_em1 is null then raise exception 'FALHOU (1) carimbo do adicional'; end if;

  -- (2) salvar o previsto por um cliente que NÃO manda adicional_etapas PRESERVA os valores por etapa (itens são recriados)
  itens := jsonb_build_array(jsonb_build_object('id', v_item, 'produto_id', PROD, 'produto_nome', 'TESTE', 'valor_unitario', 2, 'quantidade', 700, 'maquinas_por_etapa', '{}'::jsonb));
  perform public.upsert_previsao_semana(SEM, itens, '[]', '[]');
  select id into v_item2 from previsao_itens where previsao_id = v_prev and tipo = 'previsto';
  if v_item2 = v_item then raise exception 'FALHOU (2) premissa: o upsert recria os itens'; end if;
  select count(*) into v_n from previsao_item_adicional_etapa where item_id = v_item2;
  select quantidade_adicional, adicional_atualizado_em into v_q, v_em2 from previsao_itens where id = v_item2;
  if v_n <> 4 or v_q <> 400 then raise exception 'FALHOU (2) valores por etapa não foram preservados (% linhas, acabado %)', v_n, v_q; end if;
  if v_em2 is distinct from v_em1 then raise exception 'FALHOU (2) o carimbo não pode mudar quando o adicional não mudou'; end if;
  select quantidade into v_q from previsao_itens where id = v_item2;
  if v_q <> 700 then raise exception 'FALHOU (2) o previsto salvo deveria ser 700: %', v_q; end if;

  -- (3) validações
  begin
    perform public.upsert_previsao_semana(SEM, jsonb_build_array(jsonb_build_object('id', v_item2, 'produto_id', PROD, 'produto_nome', 'T', 'valor_unitario', 2, 'quantidade', 700, 'maquinas_por_etapa', '{}'::jsonb,
      'adicional_etapas', jsonb_build_object(E[1]::text, 100, E[2]::text, 600))), '[]', '[]'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('ESCALA_ADICIONAL_ETAPA_INVALIDO' in v_err) > 0 and position('seguinte' in v_err) > 0;
  end;
  if not v_ok then raise exception 'FALHOU (3a) etapa seguinte acima da anterior deveria ser recusada: %', v_err; end if;
  begin
    perform public.upsert_previsao_semana(SEM, jsonb_build_array(jsonb_build_object('id', v_item2, 'produto_id', PROD, 'produto_nome', 'T', 'valor_unitario', 2, 'quantidade', 700, 'maquinas_por_etapa', '{}'::jsonb,
      'adicional_etapas', jsonb_build_object(OUTRO_PROD_ETAPA::text, 100))), '[]', '[]'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('ESCALA_ADICIONAL_ETAPA_INVALIDO' in v_err) > 0;
  end;
  if not v_ok then raise exception 'FALHOU (3b) etapa de outro produto deveria ser recusada: %', v_err; end if;
  begin
    perform public.upsert_previsao_semana(SEM, jsonb_build_array(jsonb_build_object('id', v_item2, 'produto_id', PROD, 'produto_nome', 'T', 'valor_unitario', 2, 'quantidade', 700, 'maquinas_por_etapa', '{}'::jsonb,
      'adicional_etapas', jsonb_build_object(E[1]::text, -5))), '[]', '[]'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('ESCALA_ADICIONAL_ETAPA_INVALIDO' in v_err) > 0;
  end;
  if not v_ok then raise exception 'FALHOU (3c) quantidade negativa deveria ser recusada: %', v_err; end if;
  -- as recusas não alteraram nada
  select count(*) into v_n from previsao_item_adicional_etapa a join previsao_itens i on i.id = a.item_id where i.previsao_id = v_prev;
  if v_n <> 4 then raise exception 'FALHOU (3) estado mudou apesar das recusas: %', v_n; end if;

  -- (4) cliente antigo que muda só quantidade_adicional INVALIDA os valores por etapa (o acabado mudou)
  select id into v_item2 from previsao_itens where previsao_id = v_prev and tipo = 'previsto';
  perform public.upsert_previsao_semana(SEM, jsonb_build_array(jsonb_build_object('id', v_item2, 'produto_id', PROD, 'produto_nome', 'T', 'valor_unitario', 2, 'quantidade', 700, 'maquinas_por_etapa', '{}'::jsonb, 'quantidade_adicional', 250)), '[]', '[]');
  select id into v_item2 from previsao_itens where previsao_id = v_prev and tipo = 'previsto';
  select count(*) into v_n from previsao_item_adicional_etapa where item_id = v_item2;
  select quantidade_adicional into v_q from previsao_itens where id = v_item2;
  if v_n <> 0 or v_q <> 250 then raise exception 'FALHOU (4) os valores por etapa deveriam ser descartados (% linhas), acabado %', v_n, v_q; end if;

  -- (5) trocar o adicional por etapa preservando/atualizando o carimbo e o legado
  perform public.upsert_previsao_semana(SEM, jsonb_build_array(jsonb_build_object('id', v_item2, 'produto_id', PROD, 'produto_nome', 'T', 'valor_unitario', 2, 'quantidade', 700, 'maquinas_por_etapa', '{}'::jsonb,
      'adicional_etapas', jsonb_build_object(E[1]::text, 900, E[2]::text, 900, E[3]::text, 300, E[4]::text, 300))), '[]', '[]');
  select id into v_item2 from previsao_itens where previsao_id = v_prev and tipo = 'previsto';
  select quantidade_adicional into v_q from previsao_itens where id = v_item2;
  if v_q <> 300 then raise exception 'FALHOU (5) legado deveria acompanhar a última etapa: %', v_q; end if;

  -- (6) excluir o item remove os valores por etapa (cascata), sem órfãos
  perform public.upsert_previsao_semana(SEM, '[]'::jsonb, '[]', '[]');
  select count(*) into v_n from previsao_item_adicional_etapa a where not exists (select 1 from previsao_itens i where i.id = a.item_id);
  if v_n <> 0 then raise exception 'FALHOU (6) valores por etapa órfãos'; end if;
  reset role;

  -- (7) parâmetros: não-admin não lê nem altera; admin altera; valor inválido é recusado; alteração gera recálculo
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from escala_parametros;
  if v_n <> 0 then raise exception 'FALHOU (7a) não-admin não deveria ler escala_parametros'; end if;
  update escala_parametros set valor = '"ativo"' where chave = 'wip_modo';
  reset role;
  if (select valor from escala_parametros where chave = 'wip_modo') <> '"desligado"' then raise exception 'FALHOU (7b) não-admin alterou o parâmetro'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin update escala_parametros set valor = '"sombra"' where chave = 'wip_modo'; v_ok := false; exception when others then v_ok := sqlstate = '23514'; end;
  if not v_ok then raise exception 'FALHOU (7c) valor inválido de wip_modo deveria ser recusado'; end if;
  begin update escala_parametros set valor = '-1' where chave = 'wip_dias_limite'; v_ok := false; exception when others then v_ok := sqlstate = '23514'; end;
  if not v_ok then raise exception 'FALHOU (7d) limite negativo deveria ser recusado'; end if;
  reset role;
  select count(*) into v_ev0 from escala_producao_eventos where payload->>'tabela' = 'escala_parametros';
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update escala_parametros set valor = '"ativo"', atualizado_por = (select id from usuarios where auth_user_id = v_auth) where chave = 'wip_modo';
  if public.escala_wip_modo() <> 'ativo' then raise exception 'FALHOU (7e) escala_wip_modo'; end if;
  reset role;
  select count(*) into v_ev1 from escala_producao_eventos where payload->>'tabela' = 'escala_parametros';
  if v_ev1 <= v_ev0 then raise exception 'FALHOU (7f) alterar parâmetro deveria gerar recálculo (eventos % -> %)', v_ev0, v_ev1; end if;

  -- (8) tipo_adicional só com adicional > 0 e valores válidos
  begin
    update escala_producao_alocacoes set tipo_adicional = 'acabado' where (data, periodo_id, funcionario_id) = (select data, periodo_id, funcionario_id from escala_producao_alocacoes where pecas_adicional = 0 limit 1); v_ok := false;
  exception when others then v_ok := sqlstate = '23514'; end;
  if not v_ok then raise exception 'FALHOU (8a) tipo_adicional sem adicional deveria ser recusado'; end if;
  begin
    update escala_producao_alocacoes set tipo_adicional = 'qualquer' where (data, periodo_id, funcionario_id) = (select data, periodo_id, funcionario_id from escala_producao_alocacoes limit 1); v_ok := false;
  exception when others then v_ok := sqlstate = '23514'; end;
  if not v_ok then raise exception 'FALHOU (8b) tipo inválido'; end if;

  raise exception 'TESTE_OK T8: adicional por etapa — RPC, preservação, validações, cascata, parâmetros (RLS, valores, recálculo) e tipo_adicional';
end $$;

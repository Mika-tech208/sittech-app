-- ROLLBACK F1 (dados) — desfaz o BACKFILL do produto canônico (supabase/ops/produto-unico/10-backfill-conector-unico.sql). NÃO é migration; executar à mão (orquestrador).
-- Remove SOMENTE o que o backfill criou: produto canônico + etapas + máquinas elegíveis + rotas + grafo + mapas. NUNCA toca nos produtos/etapas/apontamentos/alocações/previsões legados.
-- RECUSA (aborta sem apagar nada) se QUALQUER dado de negócio já referencia o canônico ou suas etapas: apontamento, alocação (inclusive dentro de `distribuicao`), item de Previsão
-- (e máquinas/adicional), controle de WIP, ocorrência de máquina, ou parâmetro JSON (contagens físicas/margens) que cite os ids. Nesse caso o canônico já foi USADO: reverta primeiro o cutover
-- (rollback do plano da semana + produto_unico_cutover = null) e converta/descarte os dados da semana explicitamente — este script não apaga histórico.
-- Idempotente: sem canônico, não faz nada. Reversível: reexecutar o backfill recria (ids novos).
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
do $rb$
declare
  v_prod uuid;
  v_etapas uuid[];
  v_usos text := '';
  v_n bigint;
begin
  select produto_id into v_prod from public.produto_canonico where codigo = 'CONECTOR_3_4_UNICO';
  if v_prod is null then
    raise notice 'rollback backfill: não há produto canônico CONECTOR_3_4_UNICO — nada a fazer';
    return;
  end if;
  select coalesce(array_agg(id), '{}') into v_etapas from public.roteiro_etapas where produto_id = v_prod;

  select count(*) into v_n from public.apontamentos_producao where produto_id = v_prod or etapa_id = any(v_etapas);                                   if v_n > 0 then v_usos := v_usos || format(' apontamentos=%s', v_n); end if;
  select count(*) into v_n from public.escala_producao_alocacoes where produto_id = v_prod or etapa_id = any(v_etapas) or distribuicao::text like '%' || v_prod::text || '%'; if v_n > 0 then v_usos := v_usos || format(' alocacoes=%s', v_n); end if;
  select count(*) into v_n from public.previsao_itens where produto_id = v_prod;                                                                         if v_n > 0 then v_usos := v_usos || format(' previsao_itens=%s', v_n); end if;
  select count(*) into v_n from public.previsao_item_maquinas where etapa_id = any(v_etapas);                                                            if v_n > 0 then v_usos := v_usos || format(' previsao_item_maquinas=%s', v_n); end if;
  select count(*) into v_n from public.previsao_item_adicional_etapa where etapa_id = any(v_etapas);                                                     if v_n > 0 then v_usos := v_usos || format(' previsao_item_adicional_etapa=%s', v_n); end if;
  select count(*) into v_n from public.wip_controle where produto_id = v_prod or etapa_origem_id = any(v_etapas) or etapa_seguinte_id = any(v_etapas);  if v_n > 0 then v_usos := v_usos || format(' wip_controle=%s', v_n); end if;
  select count(*) into v_n from public.escala_buffer_pares where produto_id = v_prod;                                                             if v_n > 0 then v_usos := v_usos || format(' escala_buffer_pares=%s', v_n); end if;
  select count(*) into v_n from public.ocorrencias_maquina where produto_id = v_prod or etapa_id = any(v_etapas);                                       if v_n > 0 then v_usos := v_usos || format(' ocorrencias_maquina=%s', v_n); end if;
  select count(*) into v_n from public.escala_parametros where chave <> 'produto_unico_cutover' and valor::text like '%' || v_prod::text || '%';          if v_n > 0 then v_usos := v_usos || format(' escala_parametros=%s', v_n); end if;
  if public.produto_unico_cutover() is not null then v_usos := v_usos || ' produto_unico_cutover_ativo'; end if;
  if v_usos <> '' then
    raise exception 'ROLLBACK_BACKFILL_ABORTADO: o produto canônico já foi USADO (%). Reverta o cutover e trate os dados da semana antes.', v_usos;
  end if;

  delete from public.etapa_legado_mapa where etapa_canonica_id = any(v_etapas);
  delete from public.produto_legado_mapa where produto_canonico_id = v_prod;
  delete from public.produto_canonico_arestas where origem_etapa_id = any(v_etapas) or destino_etapa_id = any(v_etapas);
  delete from public.produto_canonico_etapas where produto_id = v_prod;
  delete from public.produto_rotas where produto_id = v_prod;
  delete from public.produto_canonico where produto_id = v_prod;
  delete from public.roteiro_etapa_maquinas where etapa_id = any(v_etapas);
  delete from public.roteiro_etapas where produto_id = v_prod;
  delete from public.produtos where id = v_prod;
  insert into public.produto_canonico_ativacoes (acao, feito_por, detalhes) values ('rollback_backfill', 'rollback 1_backfill', jsonb_build_object('produto_canonico_id', v_prod));
  raise notice 'rollback backfill: canônico % removido (legados intactos)', v_prod;
end
$rb$;
commit;

-- ROLLBACK da migration 20261115110000_produto_canonico_conversao (F2). NÃO é migration; executar à mão (orquestrador).
-- Remove os 2 gatilhos de guarda (previsao_itens, apontamentos_producao), as funções de conversão/reversão e as 2 visões; descarta a tabela de conversões.
-- RECUSA se alguma Previsão ainda está convertida (última ação 'converter' sem 'reverter' posterior): chame antes produto_unico_reverter_previsao(previsao) — o backup está nessa tabela.
-- Depois desta reversão o banco volta ao estado da F0 (fingerprint do legado idêntico; ver supabase/tests/produto-canonico).
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
do $rb$
begin
  if exists (
    select 1 from public.produto_unico_conversoes c
     where c.acao = 'converter' and not exists (select 1 from public.produto_unico_conversoes r where r.previsao_id = c.previsao_id and r.id > c.id and r.acao = 'reverter')
  ) then
    raise exception 'ROLLBACK_F2_ABORTADO: há Previsão convertida; reverta com produto_unico_reverter_previsao antes (o backup mora em produto_unico_conversoes)';
  end if;
end
$rb$;
drop trigger if exists trg_produto_unico_guarda_previsao_item on public.previsao_itens;
drop trigger if exists trg_produto_unico_guarda_apontamento on public.apontamentos_producao;
drop trigger if exists trg_produto_unico_guarda_adicional_etapa on public.previsao_item_adicional_etapa;
drop function if exists public.produto_unico_trg_guarda_adicional_etapa();
drop function if exists public.produto_unico_unificar_previsao(uuid);
drop function if exists public.produto_unico_separar_previsao(uuid);
drop function if exists public.produto_unico_trg_guarda_previsao_item();
drop function if exists public.produto_unico_trg_guarda_apontamento();
drop function if exists public.produto_unico_converter_previsao(uuid, numeric, text);
drop function if exists public.produto_unico_reverter_previsao(uuid, text);
drop view if exists public.vw_producao_final_semana;
drop view if exists public.vw_producao_rota_semana;
drop table if exists public.produto_unico_conversoes;
notify pgrst, 'reload schema';
commit;

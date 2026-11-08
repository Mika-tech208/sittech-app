-- ROLLBACK de 20261120100000_previsao_encerramento_produto.sql. NÃO apaga os registros de encerramento: a tabela é RENOMEADA (previsao_encerramentos_pre_rollback) para preservar a meta original.
-- Os itens previstos continuam como estão (quantidade 0 dos encerrados). Para voltar a produzir um produto encerrado, restaure a quantidade original (coluna quantidade_original) ANTES do rollback.
begin;
drop trigger if exists trg_previsao_item_adicional_etapa_encerrado on public.previsao_item_adicional_etapa;
drop function if exists public.previsao_item_adicional_etapa_trg_encerrado();
drop trigger if exists trg_previsao_itens_encerrado on public.previsao_itens;
drop function if exists public.previsao_itens_trg_encerrado();
drop function if exists public.previsao_produto_encerrar(uuid, uuid, text);
drop function if exists public.previsao_produto_reabrir(uuid, uuid);
alter table if exists public.previsao_encerramentos rename to previsao_encerramentos_pre_rollback;
commit;

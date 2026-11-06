-- ROLLBACK do cutover do produto único. Executar como service_role/postgres.
--   psql ... -f 90-rollback-cutover.sql
-- RECUSA (sem alterar nada) enquanto alguma Previsão tiver o item do produto único (excluir o item é decisão da supervisora). NUNCA apaga apontamento, plano, fechamento ou contagem.
-- Sem uso do produto único: desfaz exatamente a ativação. Com uso: pares do produto único encerrados no último fechamento e pares legados reabertos no dia seguinte.
-- Depois: a supervisora relança os itens legados da semana (ou o backup: select backup->'itens' from produto_unico_conversoes where previsao_id=... and acao='converter').
select jsonb_pretty(public.produto_unico_desativar('ops 90-rollback-cutover'));

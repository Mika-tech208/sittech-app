-- A tabela é append-only (histórico das reaberturas): o rollback remove só a RPC. Para apagar a tabela, desabilite os triggers de imutabilidade explicitamente (decisão humana).
drop function if exists public.escala_fechamento_reabrir(uuid, date, text, text, integer);

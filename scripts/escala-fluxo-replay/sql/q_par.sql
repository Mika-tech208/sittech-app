select chave, valor::text valor, atualizado_em from escala_parametros where chave ilike '%replan%' or chave ilike '%producao_real%' or chave ilike '%wip%' or chave ilike '%semana%';

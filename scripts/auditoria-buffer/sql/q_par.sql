select chave, valor::text valor, extract(epoch from atualizado_em)*1000 atualizado_ms from escala_parametros where chave like 'producao_real%';

-- Reverte SÓ o registro de encerramento da 4x2 (não mexe em previsao_itens). Use apenas se o registro histórico precisar ser removido.
delete from public.previsao_encerramentos e using public.previsoes p where p.id = e.previsao_id and p.semana_inicio = '2026-11-02' and e.quantidade_original = 56400
  and e.produto_id = (select id from public.produtos where nome = 'Caixa Amarela 4x2');

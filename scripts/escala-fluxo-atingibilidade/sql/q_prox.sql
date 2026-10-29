select 'existe' k, p.id::text a, p.created_at::text b from previsoes p where p.semana_inicio = '__SEMANA_FIM__'
union all
select 'item', i.produto_id::text, i.quantidade::text from previsoes p join previsao_itens i on i.previsao_id = p.id where p.semana_inicio = '__SEMANA_FIM__' and i.tipo = 'previsto'
union all
select 'dia', d.dia::text, d.ativo::text from previsoes p join previsao_dias_produtivos d on d.previsao_id = p.id where p.semana_inicio = '__SEMANA_FIM__'
union all
select 'equipe', count(*)::text, '' from previsoes p join previsao_equipe_semana e on e.previsao_id = p.id where p.semana_inicio = '__SEMANA_FIM__';

select p.semana_inicio::text semana, i.produto_id::text produto_id, sum(i.quantidade) quantidade
from previsoes p join previsao_itens i on i.previsao_id = p.id
where i.tipo = 'previsto' and p.semana_inicio >= ('__SEMANA__'::date - 70) and p.semana_inicio <= '__SEMANA__'::date
group by 1, 2 order by 1, 2;

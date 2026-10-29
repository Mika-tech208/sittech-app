select pr.semana_inicio::text semana, i.tipo, i.produto_nome, i.valor_unitario::text vu, i.quantidade::text q, coalesce(i.quantidade_adicional,0)::text qa, i.produto_id::text pid, p.valor_unitario::text valor_atual
from previsoes pr join previsao_itens i on i.previsao_id=pr.id left join produtos p on p.id=i.produto_id
where pr.semana_inicio >= '2026-09-14' order by pr.semana_inicio, i.tipo, i.produto_nome;

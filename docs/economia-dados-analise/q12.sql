select 'itens' k, i.produto_nome n, i.valor_unitario::text v, count(*)::text c, min(pr.semana_inicio)::text d0, max(pr.semana_inicio)::text d1 from previsao_itens i join previsoes pr on pr.id=i.previsao_id group by 2,3
union all select 'apont', p.nome, ap.valor_unitario_produto_vigente::text, count(*)::text, min(ap.data)::text, max(ap.data)::text from apontamentos_producao ap join produtos p on p.id=ap.produto_id where ap.status='produzindo' group by 2,3
order by 1,2,5;

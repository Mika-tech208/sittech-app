select p.nome prod, o.nome op, count(*)::text n,
 round(avg(ap.custo_hora_operacao_vigente),4)::text custo_h_snap,
 round(min(ap.custo_hora_operacao_vigente),4)::text cmin, round(max(ap.custo_hora_operacao_vigente),4)::text cmax,
 count(*) filter (where ap.valor_unitario_produto_vigente is null)::text vu_nulo,
 min(ap.data)::text d0, max(ap.data)::text d1
from apontamentos_producao ap join produtos p on p.id=ap.produto_id left join operacoes o on o.id=ap.operacao_id
where ap.status='produzindo' group by 1,2 order by 1,2;

select p.nome prod, o.nome op, m.nome maq, count(*)::text n, sum(ap.quantidade_produzida)::text pecas, round(sum(ap.duracao_periodo_horas_vigente),2)::text horas,
 round(sum(ap.quantidade_produzida)/nullif(sum(ap.duracao_periodo_horas_vigente),0),1)::text pcs_h_real,
 round(sum(ap.meta_periodo_vigente)/nullif(sum(ap.duracao_periodo_horas_vigente),0),1)::text pcs_h_meta,
 round(sum(ap.quantidade_refugo)/nullif(sum(ap.quantidade_produzida),0)*100,2)::text refugo_pct,
 min(ap.data)::text d0, max(ap.data)::text d1
from apontamentos_producao ap join produtos p on p.id=ap.produto_id join maquinas m on m.id=ap.maquina_id left join operacoes o on o.id=ap.operacao_id
where ap.status='produzindo' and ap.data >= '2026-10-05'
 and p.id in ('238ca607-2111-4aff-9a19-a9ae6f20da7e','fbbcfe63-ad4d-4e3d-9376-892f6902a5cc','27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee','cace499f-2c0d-4cc5-b8e0-53f692ddbe92','fa08e7c6-1a44-4625-a9e4-9b9cebf1031e')
group by 1,2,3 order by 1,2,3;

select p.nome prod, re.ordem, o.nome op, re.meta_m1::text m1, re.meta_m2::text m2, re.meta_m3::text m3, re.meta_t1::text t1, re.meta_t2::text t2, re.meta_t3::text t3,
 (select count(*) from roteiro_etapa_maquinas x join maquinas m on m.id=x.maquina_id where x.etapa_id=re.id and m.ativo)::text maqs, re.updated_at::text upd
from roteiro_etapas re join produtos p on p.id=re.produto_id join operacoes o on o.id=re.operacao_id
where p.id in ('238ca607-2111-4aff-9a19-a9ae6f20da7e','fbbcfe63-ad4d-4e3d-9376-892f6902a5cc','27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee','cace499f-2c0d-4cc5-b8e0-53f692ddbe92','fa08e7c6-1a44-4625-a9e4-9b9cebf1031e')
order by p.nome, re.ordem;

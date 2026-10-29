select 'op' k, o.id::text a, o.nome b, (select count(*) from funcionarios f where f.operacao_id=o.id and f.ativo)::text c, (select count(*) from maquinas m where m.operacao_id=o.id and m.ativo)::text d, '' e from operacoes o
union all
select 'prod', p.id::text, p.nome, p.valor_unitario::text, p.ativo::text, coalesce(p.referencia,'')||' upd='||p.updated_at::text from produtos p
order by 1,3;

select 'fixed' k, c.nome cat, f.descricao d, f.valor::text v, f.ativo::text a, f.updated_at::text u from fixed_costs f left join categorias c on c.id=f.categoria_id
union all select 'cfg', 'dias_uteis', row_to_json(x)::text, '', '', '' from configuracoes_empresa x
union all select 'periodo', id, nome, inicio::text, fim::text, '' from periodos
union all select 'var', c.nome, v.descricao, v.valor::text, v.mes::text, v.updated_at::text from variable_entries v left join categorias c on c.id=v.categoria_id
order by 1,2,3;

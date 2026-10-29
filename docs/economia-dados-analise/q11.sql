select 'fat' k, f.mes::text a, f.num_funcionarios::text b, f.custo_funcionarios_total::text c, f.custo_fixo_total::text d, (select count(*)||' / '||coalesce(sum(valor),0) from receitas r where r.faturamento_id=f.id) e from faturamentos f
union all select 'param', chave, left(valor::text,60), '', '', '' from escala_parametros
order by 1,2;

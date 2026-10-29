with f as (select f.id, f.salario_base + coalesce((select sum(valor) from funcionario_custos c where c.funcionario_id=f.id),0) custo from funcionarios f where f.ativo),
h as (select sum(extract(epoch from (fim-inicio))/3600) hdia from periodos),
cfg as (select dias_uteis du from configuracoes_empresa limit 1)
select 'n_ativos' k, count(*)::text v from f
union all select 'tot_func_mensal', round(sum(custo),2)::text from f
union all select 'tot_fixo', (select sum(valor) from fixed_costs where ativo)::text
union all select 'horas_dia', round(hdia,4)::text from h
union all select 'horas_func_mes', round(hdia*du,3)::text from h, cfg
union all select 'custo_hora_empresa', round(((select sum(custo) from f)+(select sum(valor) from fixed_costs where ativo))/((select hdia*du from h,cfg)*(select count(*) from f)),4)::text
union all select 'rateio_fixo_h', round((select sum(valor) from fixed_costs where ativo)/((select hdia*du from h,cfg)*(select count(*) from f)),4)::text
union all select 'mao_obra_h', round((select sum(custo) from f)/((select hdia*du from h,cfg)*(select count(*) from f)),4)::text;

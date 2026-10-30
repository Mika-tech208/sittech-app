select 'inativa' tipo, id::text maquina_id from maquinas where ativo = false
union all
select 'indisponivel_previsao', mi.maquina_id::text from previsao_maquinas_indisponiveis mi join previsoes p on p.id = mi.previsao_id where p.semana_inicio = '__SEMANA__';

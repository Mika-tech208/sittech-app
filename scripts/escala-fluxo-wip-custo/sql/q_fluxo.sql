select id::text id, to_char(criado_em at time zone 'America/Sao_Paulo','MM-DD HH24:MI:SS') criado, extract(epoch from criado_em)*1000 criado_ms, gatilho, modo, resultado, aplicado, corte_data::text corte_data, corte_periodo_id, corte_c,
 demanda_real->'produtos' produtos, wip->'pares' pares, gargalos, churn, violacoes, diff, avaliacao_fluxo->'totais' totais_fluxo, avaliacao_fluxo->'depois' depois, avaliacao_fluxo->'planoEscolhido' plano_escolhido
from escala_fluxo_diagnosticos where semana_inicio='__SEMANA__' order by criado_em desc limit 4;

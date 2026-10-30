select maquina_id::text maquina_id, extract(epoch from desde)*1000 desde_ms, extract(epoch from liberada_em)*1000 liberada_ms
from escala_recurso_indisponivel where liberada_em is null or liberada_em >= '__SEMANA__T00:00:00-03:00' order by desde;

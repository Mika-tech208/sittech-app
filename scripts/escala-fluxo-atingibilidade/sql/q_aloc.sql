select a.data::text data, a.periodo_id, a.funcionario_id::text funcionario_id, a.maquina_id::text maquina_id, a.produto_id::text produto_id, a.etapa_id::text etapa_id, a.operacao_id::text operacao_id,
 a.pecas, a.pecas_adicional, a.tipo_adicional, a.motivo_sem_posto, a.origem, a.excecao_revezamento, a.motivo_excecao, to_char(a.atualizado_em at time zone 'America/Sao_Paulo','MM-DD HH24:MI:SS') atualizado
from escala_producao_alocacoes a where a.data >= '__SEMANA__' and a.data < '__SEMANA_FIM__' order by a.data, a.periodo_id, a.maquina_id;

select a.id::text id, a.data::text data, a.periodo_id, a.hora_lancamento::text hora_lancamento, extract(epoch from a.criado_em)*1000 criado_ms, extract(epoch from a.atualizado_em)*1000 atualizado_ms,
 extract(epoch from ((a.data + a.hora_lancamento) at time zone 'America/Sao_Paulo'))*1000 lancado_ms,
 a.funcionario_id::text funcionario_id, a.maquina_id::text maquina_id, a.produto_id::text produto_id, a.etapa_id::text etapa_id, a.operacao_id::text operacao_id,
 a.quantidade_produzida, a.quantidade_refugo, a.meta_periodo_vigente meta, a.status, a.motivo_sem_producao motivo
from apontamentos_producao a where a.data >= '2026-10-26' and a.data < '2026-11-02' order by a.data, a.periodo_id, a.criado_em;

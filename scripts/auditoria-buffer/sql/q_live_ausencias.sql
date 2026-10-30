select a.funcionario_id::text funcionario_id, a.data::text data, a.horario_inicio::text hi, a.horario_fim::text hf, a.em_aberto
from ausencias_funcionarios a where a.data >= '__SEMANA__' and a.data < '__SEMANA_FIM__' order by a.data, a.criado_em;

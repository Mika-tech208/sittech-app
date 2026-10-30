select e.funcionario_id::text id, f.ativo, f.nome
from previsao_equipe_semana e join previsoes p on p.id = e.previsao_id join funcionarios f on f.id = e.funcionario_id
where p.semana_inicio = '__SEMANA__' and e.produtivo order by f.nome;

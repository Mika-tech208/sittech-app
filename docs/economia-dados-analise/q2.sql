select o.nome op, f.nome, f.ativo::text a, f.salario_base::text sal, coalesce((select sum(valor) from funcionario_custos c where c.funcionario_id=f.id),0)::text extras,
 (select string_agg(descricao||'='||valor, '; ') from funcionario_custos c where c.funcionario_id=f.id) det, f.desligado_em::text des
from funcionarios f join operacoes o on o.id=f.operacao_id order by o.nome, f.nome;

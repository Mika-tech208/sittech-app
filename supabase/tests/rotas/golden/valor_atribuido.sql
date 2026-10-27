-- Valor atribuído a uma operação (paradas): produtos LINEARES devem dar o mesmo resultado antes e depois do M4
begin;
select 'valor_atribuido_lineares' k, count(*) linhas, md5(coalesce(string_agg(r::text, '|' order by r.produto_id, r.operacao_id, r.periodo_id), '')) v
from (select p.id produto_id, e.operacao_id, per.id periodo_id, public.calcular_valor_atribuido_operacao(p.id, e.operacao_id, per.id) val
        from produtos p join roteiro_etapas e on e.produto_id = p.id cross join periodos per
       where not exists (select 1 from produto_rota pr where pr.produto_id = p.id)) r;
rollback;

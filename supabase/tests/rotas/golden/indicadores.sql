-- INDICADORES de produção (obter_indicadores_producao) com apontamentos SINTÉTICOS (somente dentro desta transação, desfeita no final) sobre os produtos lineares existentes
begin;
do $$
declare v_usr uuid; v_maq uuid; v_func uuid; r record; i int := 0;
begin
  select id into v_usr from usuarios where papel='admin' and ativo order by id limit 1;
  select id into v_maq from maquinas where ativo order by id limit 1;
  select id into v_func from funcionarios order by id limit 1;
  for r in select e.id etapa, e.produto_id, e.operacao_id, e.ordem from roteiro_etapas e join produtos p on p.id=e.produto_id where p.id in ('27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee') order by e.produto_id, e.ordem loop
    i := i + 1;
    insert into apontamentos_producao (produto_id, etapa_id, operacao_id, valor_unitario_produto_vigente, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status)
    values (r.produto_id, r.etapa, r.operacao_id, 0.1, v_maq, v_func, 'm1', date '2026-10-26' + (i - 1), '09:00', 1000 + i * 111, i, '07:12', '08:48', 100, 10, v_usr, 'produzindo');
  end loop;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from usuarios where papel='admin' and ativo order by id limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select 'indicadores_sintetico' k, count(*) linhas, md5(coalesce(string_agg((to_jsonb(r) - 'apontamento_id')::text, '|' order by r.produto_id, r.etapa_id, r.data, r.periodo_id),'')) v,   /* sem o id (gerado a cada execução) */
       count(*) filter (where is_ultima_etapa) finais, count(*) filter (where is_ultima_etapa is null) nulos
from public.obter_indicadores_producao('2026-01-01', '2026-12-31') r;
rollback;

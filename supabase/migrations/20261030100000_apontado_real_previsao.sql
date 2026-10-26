-- Sittech — Previsão semanal: coluna "Apontado real" (DIAGNÓSTICO; não participa de Falta, %, financeiro nem atingibilidade).
--
-- Devolve, para a semana pedida, a produção BOA (quantidade_produzida - quantidade_refugo) dos apontamentos atuais de `apontamentos_producao`
-- (status 'produzindo'; 'sem_producao' nunca soma; o histórico de edição NÃO entra: apontamento_producao_historico é outra tabela e a edição é UPDATE no
-- lugar), AGRUPADA por (produto_id, etapa_id, operacao_id gravada no apontamento), junto com o roteiro ATUAL daquela etapa/produto. A regra "última etapa"
-- e a detecção de roteiro alterado ficam em TypeScript (src/features/previsao/apontadoReal.ts), testada; aqui é só agregação — o resultado é pequeno
-- (nunca passa do limite de 1000 linhas do PostgREST, ao contrário de devolver os apontamentos).
--
-- Mesma permissão do `obter_realizado_previsao_por_semana` (usuário com 'previsao' não tem SELECT direto em apontamentos_producao): SECURITY DEFINER
-- com checagem explícita. Somente leitura. Aditiva.
create or replace function public.obter_apontado_real_previsao_por_semana(p_semana_inicio date)
returns table(
  produto_id uuid, etapa_id uuid, operacao_id uuid, quantidade_boa numeric, n_apontamentos bigint,
  etapa_ordem integer, etapa_operacao_id uuid, ultima_ordem integer, n_na_ultima_ordem integer, ultima_operacao_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if not public.has_permissao('previsao') then
    raise exception 'Usuário não tem permissão para consultar o apontado real da previsão semanal';
  end if;

  return query
  with g as (
    select ap.produto_id as g_produto, ap.etapa_id as g_etapa, ap.operacao_id as g_op,
           coalesce(sum(ap.quantidade_produzida - coalesce(ap.quantidade_refugo, 0)), 0)::numeric as g_boas, count(*) as g_n
      from public.apontamentos_producao ap
     where ap.status = 'produzindo' and ap.data >= p_semana_inicio and ap.data <= p_semana_inicio + 6
     group by ap.produto_id, ap.etapa_id, ap.operacao_id
  ), r as (
    select e.produto_id as r_produto, max(e.ordem) as r_ultima from public.roteiro_etapas e group by e.produto_id
  )
  select g.g_produto, g.g_etapa, g.g_op, g.g_boas, g.g_n,
         e.ordem, e.operacao_id, r.r_ultima,
         (select count(*)::integer from public.roteiro_etapas x where x.produto_id = g.g_produto and x.ordem = r.r_ultima),
         (select (array_agg(x.operacao_id))[1] from public.roteiro_etapas x where x.produto_id = g.g_produto and x.ordem = r.r_ultima
            and (select count(*) from public.roteiro_etapas y where y.produto_id = g.g_produto and y.ordem = r.r_ultima) = 1)
    from g
    left join public.roteiro_etapas e on e.id = g.g_etapa
    left join r on r.r_produto = g.g_produto
   order by g.g_produto, e.ordem nulls last, g.g_etapa;
end;
$$;

revoke all on function public.obter_apontado_real_previsao_por_semana(date) from public, anon, authenticated, service_role;
grant execute on function public.obter_apontado_real_previsao_por_semana(date) to authenticated;
-- ROLLBACK: drop function public.obter_apontado_real_previsao_por_semana(date);

-- Sittech — TV da fábrica como PAINEL DE METAS DE PRODUÇÃO (14/11/2026).
--
-- A TV é PASSIVA e SEM DADOS FINANCEIROS. Esta RPC devolve, para a semana, só o que o painel precisa:
--   produtos : produto_id, nome, meta (soma de previsao_itens.quantidade; null = produto com produção mas sem meta na semana) e `encerrado`
--   apontado : a produção BOA agrupada por (produto, etapa, operação gravada) + o roteiro ATUAL da etapa — a MESMA agregação de
--              obter_apontado_real_previsao_por_semana; a regra "última etapa" continua em TypeScript (calcularApontadoReal), testada.
-- UM ITEM FÍSICO = UM CARD (decisão 14/11): produtos legados vinculados a um produto canônico em `produto_legado_mapa` (o MESMO vínculo da arquitetura do produto único) são
--   exibidos no card do canônico. A regra NÃO usa nome de produto: só o mapa. `produto_card_id` = canônico do mapa, ou o próprio produto quando não há vínculo. A produção de cada
--   produto continua sendo calculada com o roteiro DELE (última etapa do legado ≠ última etapa do canônico) e só depois é somada por card, uma vez (cada apontamento pertence a UM produto).
--   Nada é migrado ou alterado: apontamentos, produto_id, histórico, Previsão, WIP e cutover ficam como estão. Sem apontamento legado, a soma deixa de ter efeito sozinha.
-- NUNCA seleciona valor_unitario, preço, custo, margem ou faturamento: o payload não tem esses campos (não é só esconder na tela).
-- Permissão: a do quiosque (escala_producao_tv), da Escala, da Previsão ou admin. Somente leitura (stable); não escreve, não recalcula, não enfileira nada.
create or replace function public.tv_metas_producao(p_semana_inicio date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_semana date := coalesce(p_semana_inicio, date_trunc('week', (now() at time zone 'America/Sao_Paulo')::date)::date);
  v_prev uuid;
  v_produtos jsonb;
  v_apontado jsonb;
begin
  if not (public.is_admin() or public.has_permissao('escala_producao_tv') or public.has_permissao('escala_producao') or public.has_permissao('previsao')) then
    raise exception 'Usuário não tem permissão para a TV de metas';
  end if;

  select id into v_prev from public.previsoes where semana_inicio = v_semana;

  with mapa as (
    select m.produto_legado_id as pid, m.produto_canonico_id as cid from public.produto_legado_mapa m
  ), itens as (
    select coalesce(m.cid, i.produto_id) as card_id, i.produto_id as pid, i.produto_nome, i.quantidade
      from public.previsao_itens i left join mapa m on m.pid = i.produto_id
     where i.previsao_id = v_prev and i.tipo = 'previsto'
  ), enc as (
    select e.produto_id as pid, e.quantidade_original
      from public.previsao_encerramentos e
     where e.previsao_id = v_prev and e.reaberto_em is null
  ), por_produto as (
    -- meta de cada produto-membro: encerrado usa a quantidade original; produto sem item não tem meta própria
    select it.card_id, it.pid, max(it.produto_nome) as nome,
           case when max(en.pid::text) is not null then max(en.quantidade_original) else sum(it.quantidade)::numeric end as meta,
           (max(en.pid::text) is not null) as encerrado
      from itens it left join enc en on en.pid = it.pid
     group by it.card_id, it.pid
  ), apontados as (
    select distinct coalesce(m.cid, ap.produto_id) as card_id
      from public.apontamentos_producao ap left join mapa m on m.pid = ap.produto_id
     where ap.status = 'produzindo' and ap.data >= v_semana and ap.data <= v_semana + 6
  ), por_card as (
    select pp.card_id, sum(pp.meta) as meta, bool_and(pp.encerrado) as encerrado, max(pp.nome) filter (where pp.pid = pp.card_id) as nome_card, max(pp.nome) as nome_qualquer
      from por_produto pp group by pp.card_id
  ), todos as (
    select card_id from por_card union select card_id from apontados
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'produto_id', t.card_id,
           'nome', coalesce(pc.nome_card, p.nome, pc.nome_qualquer),
           'meta', pc.meta,
           'encerrado', coalesce(pc.encerrado, false)
         ) order by coalesce(pc.nome_card, p.nome, pc.nome_qualquer)), '[]'::jsonb)
    into v_produtos
    from todos t
    left join por_card pc on pc.card_id = t.card_id
    left join public.produtos p on p.id = t.card_id;

  with g as (
    select ap.produto_id as g_produto, ap.etapa_id as g_etapa, ap.operacao_id as g_op,
           coalesce(sum(ap.quantidade_produzida - coalesce(ap.quantidade_refugo, 0)), 0)::numeric as g_boas, count(*) as g_n
      from public.apontamentos_producao ap
     where ap.status = 'produzindo' and ap.data >= v_semana and ap.data <= v_semana + 6
     group by ap.produto_id, ap.etapa_id, ap.operacao_id
  ), r as (
    select e.produto_id as r_produto, max(e.ordem) as r_ultima from public.roteiro_etapas e group by e.produto_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'produto_id', g.g_produto, 'produto_card_id', coalesce(mp.produto_canonico_id, g.g_produto), 'etapa_id', g.g_etapa, 'operacao_id', g.g_op, 'quantidade_boa', g.g_boas, 'n_apontamentos', g.g_n,
           'etapa_ordem', e.ordem, 'etapa_operacao_id', e.operacao_id, 'ultima_ordem', r.r_ultima,
           'n_na_ultima_ordem', (select count(*)::integer from public.roteiro_etapas x where x.produto_id = g.g_produto and x.ordem = r.r_ultima),
           'ultima_operacao_id', (select (array_agg(x.operacao_id))[1] from public.roteiro_etapas x where x.produto_id = g.g_produto and x.ordem = r.r_ultima
                                    and (select count(*) from public.roteiro_etapas y where y.produto_id = g.g_produto and y.ordem = r.r_ultima) = 1)
         )), '[]'::jsonb)
    into v_apontado
    from g
    left join public.roteiro_etapas e on e.id = g.g_etapa
    left join r on r.r_produto = g.g_produto
    left join public.produto_legado_mapa mp on mp.produto_legado_id = g.g_produto;

  return jsonb_build_object('agora', now(), 'hoje', v_hoje, 'semana_inicio', v_semana, 'semana_fim', v_semana + 6,
                            'existe', v_prev is not null, 'produtos', v_produtos, 'apontado', v_apontado);
end;
$$;

revoke all on function public.tv_metas_producao(date) from public, anon;
grant execute on function public.tv_metas_producao(date) to authenticated;

-- M4 (DEV/Preview) — consumidores do modelo de rotas: apontado real, indicadores e WIP deixam de depender de max(ordem)/ordem+1 PARA PRODUTO DE ROTAS.
-- Produto LINEAR: as três funções devolvem exatamente o mesmo resultado de antes (o ramo antigo é o `else`). Nada aqui liga `rotas_config.suporte_ativo`.

create or replace function public.produto_usa_rotas(p_produto uuid) returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from public.produto_rota where produto_id = p_produto);
$$;
grant execute on function public.produto_usa_rotas(uuid) to authenticated, service_role;

-- A rota (CONV/AUTO) ou o FLUXO COMUM de uma etapa — determinado pela etapa; o operador nunca escolhe a rota. NULL = etapa de produto linear.
create or replace function public.etapa_grupo_rota(p_etapa uuid) returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (select r.codigo from public.rota_etapas re join public.produto_rota r on r.id = re.rota_id where re.etapa_id = p_etapa limit 1),
    (select 'COMUM' from public.produto_pool_comum pc where pc.etapa_id = p_etapa limit 1));
$$;
grant execute on function public.etapa_grupo_rota(uuid) to authenticated, service_role;

-- Arestas do PERCURSO do produto de rotas (origem → seguinte): dentro da rota, convergência (última exclusiva de cada rota → entrada do fluxo comum) e dentro do fluxo comum.
-- Substitui "ordem imediatamente posterior" para produto de rotas (Parafusar → Etiquetar e Rosquear + Parafusar → Etiquetar são arestas válidas; Parafusar → Rosquear + Parafusar não).
create or replace function public.produto_arestas_rotas(p_produto uuid)
returns table(origem_id uuid, destino_id uuid, grupo text) language sql stable set search_path = public, pg_temp as $$
  select t.etapa_id, t.prox, t.codigo from (
    select re.etapa_id, lead(re.etapa_id) over (partition by re.rota_id order by re.posicao) prox, r.codigo
    from public.rota_etapas re join public.produto_rota r on r.id = re.rota_id where r.produto_id = p_produto) t where t.prox is not null
  union all
  select ult.etapa_id, pc.etapa_id, 'CONVERGENCIA' from (
      select distinct on (re.rota_id) re.etapa_id from public.rota_etapas re join public.produto_rota r on r.id = re.rota_id
       where r.produto_id = p_produto order by re.rota_id, re.posicao desc) ult
    cross join lateral (select c.etapa_id from public.produto_pool_comum c where c.produto_id = p_produto order by c.posicao limit 1) pc
  union all
  select t.etapa_id, t.prox, 'COMUM' from (
    select c.etapa_id, lead(c.etapa_id) over (order by c.posicao) prox from public.produto_pool_comum c where c.produto_id = p_produto) t where t.prox is not null;
$$;
grant execute on function public.produto_arestas_rotas(uuid) to authenticated, service_role;

-- 1) Indicadores de produção — corpo vigente (20260903190000) com SÓ a coluna is_ultima_etapa alterada
create or replace function public.obter_indicadores_producao(
  p_data_inicial date,
  p_data_final date,
  p_produto_id uuid default null,
  p_maquina_id uuid default null,
  p_operacao_id uuid default null,
  p_funcionario_id uuid default null,
  p_periodo_id text default null
)
returns table (
  apontamento_id uuid,
  data date,
  periodo_id text,
  periodo_nome text,
  status text,
  motivo_sem_producao text,
  produto_id uuid,
  produto_nome text,
  maquina_id uuid,
  maquina_nome text,
  operacao_id uuid,
  operacao_nome text,
  funcionario_id uuid,
  funcionario_nome text,
  etapa_id uuid,
  etapa_ordem integer,
  is_ultima_etapa boolean,
  quantidade_produzida numeric,
  quantidade_refugo numeric,
  meta_periodo_vigente numeric,
  duracao_periodo_horas_vigente numeric,
  minutos_parados numeric,
  custo_hora_operacao_vigente numeric,
  custo_operacional_periodo_vigente numeric,
  custo_unitario_referencia_periodo_vigente numeric,
  produto_valor_unitario numeric,
  etapa_maquinas_elegiveis integer
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if not public.has_permissao('producao_real_historico') then
    raise exception 'Usuário não tem permissão para consultar indicadores de produção';
  end if;

  return query
  select
    ap.id,
    ap.data,
    ap.periodo_id,
    per.nome,
    ap.status,
    ap.motivo_sem_producao,
    ap.produto_id,
    p.nome,
    ap.maquina_id,
    m.nome,
    ap.operacao_id,
    o.nome,
    ap.funcionario_id,
    f.nome,
    ap.etapa_id,
    re.ordem,
    case when re.ordem is null then null
         when public.produto_usa_rotas(ap.produto_id) then (ap.etapa_id = public.produto_etapa_final(ap.produto_id))   -- produto de ROTAS: etapa final EXPLÍCITA (Embalar), nunca max(ordem)
         else (re.ordem = maxord.max_ordem)                                                                               -- produto linear: regra de sempre (idêntica)
    end,
    ap.quantidade_produzida,
    ap.quantidade_refugo,
    ap.meta_periodo_vigente,
    ap.duracao_periodo_horas_vigente,
    coalesce(paradas.minutos_parados, 0),
    ap.custo_hora_operacao_vigente,
    ap.custo_operacional_periodo_vigente,
    ap.custo_unitario_referencia_periodo_vigente,
    ap.valor_unitario_produto_vigente,
    coalesce(etapamaq.qtd, 0)::integer
  from public.apontamentos_producao ap
  join public.maquinas m on m.id = ap.maquina_id
  join public.periodos per on per.id = ap.periodo_id
  left join public.produtos p on p.id = ap.produto_id
  left join public.operacoes o on o.id = ap.operacao_id
  left join public.funcionarios f on f.id = ap.funcionario_id
  left join public.roteiro_etapas re on re.id = ap.etapa_id
  left join lateral (
    select max(re2.ordem) as max_ordem
    from public.roteiro_etapas re2
    where re2.produto_id = ap.produto_id
  ) maxord on ap.produto_id is not null
  left join lateral (
    select sum(pp.minutos) as minutos_parados
    from public.apontamento_paradas pp
    where pp.apontamento_id = ap.id
  ) paradas on true
  left join lateral (
    select count(*) as qtd
    from public.roteiro_etapa_maquinas rem
    where rem.etapa_id = ap.etapa_id
  ) etapamaq on ap.etapa_id is not null
  where ap.data >= p_data_inicial
    and ap.data <= p_data_final
    and (p_produto_id is null or ap.produto_id = p_produto_id)
    and (p_maquina_id is null or ap.maquina_id = p_maquina_id)
    and (p_operacao_id is null or ap.operacao_id = p_operacao_id)
    and (p_funcionario_id is null or ap.funcionario_id = p_funcionario_id)
    and (p_periodo_id is null or ap.periodo_id = p_periodo_id);
end;
$$;
revoke all on function public.obter_indicadores_producao(date, date, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.obter_indicadores_producao(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- 2) Apontado real da Previsão (última etapa)
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
    select e.produto_id as r_produto,
           case when public.produto_usa_rotas(e.produto_id)
                then (select x.ordem from public.roteiro_etapas x where x.id = public.produto_etapa_final(e.produto_id))   -- produto de ROTAS: ordem da etapa final EXPLÍCITA
                else max(e.ordem) end as r_ultima                                                                            -- produto linear: maior ordem (idêntico)
      from public.roteiro_etapas e group by e.produto_id
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

-- 3) wip_controle_criar: produto linear = ordem imediatamente posterior (como antes); produto de rotas = arestas do percurso
create or replace function public.wip_controle_criar(
  p_usuario_id uuid, p_produto_id uuid, p_etapa_origem_id uuid, p_etapa_seguinte_id uuid, p_data_inicio date, p_saldo_inicial numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o roteiro_etapas; v_s roteiro_etapas; v_prox uuid; v_id uuid;
begin
  select * into v_o from roteiro_etapas where id = p_etapa_origem_id and produto_id = p_produto_id;
  select * into v_s from roteiro_etapas where id = p_etapa_seguinte_id and produto_id = p_produto_id;
  if v_o.id is null or v_s.id is null then raise exception 'WIP_ETAPA_INVALIDA: as etapas precisam pertencer ao roteiro do produto'; end if;
  if public.produto_usa_rotas(p_produto_id) then
    -- produto de ROTAS: vale o PERCURSO (rota, convergência, fluxo comum), nunca ordem+1
    if not exists (select 1 from public.produto_arestas_rotas(p_produto_id) a where a.origem_id = p_etapa_origem_id and a.destino_id = p_etapa_seguinte_id) then
      raise exception 'WIP_ETAPAS_FORA_DO_PERCURSO: a etapa seguinte precisa vir logo depois da origem no percurso da rota/fluxo comum do produto';
    end if;
  else
    select id into v_prox from roteiro_etapas where produto_id = p_produto_id and (ordem, id) > (v_o.ordem, v_o.id) order by ordem, id limit 1;
    if v_prox is distinct from v_s.id then raise exception 'WIP_ETAPAS_NAO_CONSECUTIVAS: a etapa seguinte precisa ser a imediatamente posterior à origem no roteiro'; end if;
  end if;
  if p_data_inicio is null then raise exception 'WIP_DATA_INICIO: informe a data de início do controle'; end if;
  if coalesce(p_saldo_inicial, 0) < 0 then raise exception 'WIP_SALDO_INICIAL_NEGATIVO'; end if;
  insert into wip_controle (produto_id, etapa_origem_id, etapa_seguinte_id, data_inicio, saldo_inicial, criado_por)
  values (p_produto_id, p_etapa_origem_id, p_etapa_seguinte_id, p_data_inicio, coalesce(p_saldo_inicial, 0), p_usuario_id)
  returning id into v_id;
  return v_id;
end;
$$;


-- (as permissões da função foram definidas na migration original e continuam valendo: create or replace preserva os GRANTs)

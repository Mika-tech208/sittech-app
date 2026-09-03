-- Sittech — schema PostgreSQL, migration 26
-- Motor Econômico de Produção V1 — estende obter_indicadores_producao
-- (migration 25) só com os campos financeiros que já existem como
-- snapshot em apontamentos_producao + o preço do produto. Nenhuma tabela
-- nova, nenhuma coluna nova em tabela nenhuma — só a RPC de leitura passa
-- a devolver 5 colunas a mais. Nenhuma fórmula é recalculada aqui: os 3
-- campos de custo continuam sendo os mesmos GENERATED columns já
-- congelados desde a migration 9 (custo_hora_operacao_vigente,
-- custo_operacional_periodo_vigente, custo_unitario_referencia_periodo_vigente).
--
-- Toda a AGREGAÇÃO econômica (custo por peça, margem, custo industrial
-- aproximado, possível restrição operacional) fica em
-- src/features/producao-real/indicadores/economico.ts — TypeScript puro,
-- reaproveitando o mesmo motor de agrupamento de Indicadores V1. Esta RPC
-- só busca; nenhuma fórmula econômica mora em SQL.
--
-- etapa_maquinas_elegiveis: contagem de roteiro_etapa_maquinas daquela
-- etapa — sinal estrutural (etapa sem máquina alternativa) usado só como
-- contexto na detecção de "possível restrição operacional", nunca como
-- prova isolada.
--
-- Mesmo padrão de segurança da migration 25: SECURITY DEFINER, gate
-- reaproveitando 'producao_real_historico' (nenhuma permissão nova),
-- search_path fixo, grants só authenticated.

drop function if exists public.obter_indicadores_producao(date, date, uuid, uuid, uuid, uuid, text);

create function public.obter_indicadores_producao(
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
    case when re.ordem is null then null else (re.ordem = maxord.max_ordem) end,
    ap.quantidade_produzida,
    ap.quantidade_refugo,
    ap.meta_periodo_vigente,
    ap.duracao_periodo_horas_vigente,
    coalesce(paradas.minutos_parados, 0),
    ap.custo_hora_operacao_vigente,
    ap.custo_operacional_periodo_vigente,
    ap.custo_unitario_referencia_periodo_vigente,
    p.valor_unitario,
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

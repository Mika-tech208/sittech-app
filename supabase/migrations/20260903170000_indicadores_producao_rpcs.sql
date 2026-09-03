-- Sittech — schema PostgreSQL, migration 25
-- "Indicadores de Produção" V1 — leitura agregável dos apontamentos já
-- existentes. Puramente aditivo: nenhuma tabela, coluna, trigger, RLS ou
-- regra de Produção Real/Previsão Semanal existente é alterada aqui.
-- Nenhum dado é recalculado a partir dos cadastros atuais — tudo usa
-- somente os snapshots já gravados em apontamentos_producao (mesma
-- disciplina de obter_realizado_previsao_por_semana, migration 20).
--
-- Duas RPCs, mesmo padrão de segurança já estabelecido:
--   * SECURITY DEFINER (dona a role do migrator, bypassa RLS — mesmo
--     motivo de calcular_custo_hora_operacao_vigente/
--     obter_realizado_previsao_por_semana: apontamentos_producao NÃO tem
--     FORCE ROW LEVEL SECURITY, confirmado nas migrations 9 e 21).
--   * Gate de permissão reaproveitando 'producao_real_historico' — a
--     MESMA permissão que já dá SELECT direto na tabela crua pela policy
--     de migration 21 (apontamentos_producao_select) e que já gate a tela
--     "Apontamentos realizados". Nenhuma permissão nova foi criada —
--     Indicadores de Produção não é um atalho pra ver mais do que quem já
--     acessa o histórico de apontamentos consegue ver hoje.
--   * search_path fixo (public, pg_temp), sem SQL dinâmico, grants só pra
--     authenticated (revoke all primeiro, mesmo padrão de toda RPC deste
--     projeto).
--
-- toda a AGREGAÇÃO (soma/média ponderada/OEE/Pareto/agrupamentos) fica no
-- TypeScript (src/features/producao-real/indicadores/calculations.ts) —
-- estas RPCs só filtram, fazem os joins pesados e devolvem uma linha por
-- apontamento/parada já com o contexto resolvido (nomes) e o que só o
-- banco sabe calcular direito (is_ultima_etapa via roteiro_etapas.ordem,
-- minutos_parados por apontamento). Isso evita duplicar fórmula em SQL E
-- em TS, e mantém o "motor" de cálculo reutilizável por um futuro
-- Dashboard Principal sem reescrever a query.

-- ---------------------------------------------------------------------
-- 1) obter_indicadores_producao — uma linha por apontamento no período
--    filtrado, com o contexto resolvido e is_ultima_etapa calculado.
--
--    is_ultima_etapa: compara roteiro_etapas.ordem do apontamento contra
--    o MAX(ordem) daquele produto_id — nunca pelo nome da operação, nunca
--    por heurística. NULL (não true nem false) quando o apontamento é
--    'sem_producao' (etapa_id é NULL por design nesse status — não existe
--    "última etapa" de um apontamento sem produto).
-- ---------------------------------------------------------------------
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
  minutos_parados numeric
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
    coalesce(paradas.minutos_parados, 0)
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

-- ---------------------------------------------------------------------
-- 2) obter_paradas_producao — uma linha por apontamento_parada no
--    período filtrado, com motivo + contexto do apontamento dono, pro
--    Pareto de motivos e pro drill-down (motivo -> máquina/operação/
--    produto). origem distingue parada manual ('manual', ocorrencia_id
--    nulo) de parada automática vinculada a uma ocorrência encerrada
--    ('ocorrencia') — nunca soma as duas coisas separadamente: cada linha
--    de apontamento_paradas já é uma e só uma (constraint de unicidade da
--    migration 9), então somar esta tabela nunca conta uma parada 2x.
-- ---------------------------------------------------------------------
create or replace function public.obter_paradas_producao(
  p_data_inicial date,
  p_data_final date,
  p_produto_id uuid default null,
  p_maquina_id uuid default null,
  p_operacao_id uuid default null,
  p_funcionario_id uuid default null,
  p_periodo_id text default null
)
returns table (
  parada_id uuid,
  apontamento_id uuid,
  data date,
  periodo_id text,
  minutos numeric,
  motivo_id uuid,
  motivo_nome text,
  motivo_categoria text,
  origem text,
  produto_id uuid,
  produto_nome text,
  maquina_id uuid,
  maquina_nome text,
  operacao_id uuid,
  operacao_nome text,
  funcionario_id uuid,
  funcionario_nome text
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if not public.has_permissao('producao_real_historico') then
    raise exception 'Usuário não tem permissão para consultar paradas de produção';
  end if;

  return query
  select
    pp.id,
    pp.apontamento_id,
    ap.data,
    ap.periodo_id,
    pp.minutos,
    pp.motivo_id,
    mp.nome,
    mp.categoria,
    case when pp.ocorrencia_id is null then 'manual' else 'ocorrencia' end,
    ap.produto_id,
    p.nome,
    ap.maquina_id,
    m.nome,
    ap.operacao_id,
    o.nome,
    ap.funcionario_id,
    f.nome
  from public.apontamento_paradas pp
  join public.apontamentos_producao ap on ap.id = pp.apontamento_id
  join public.motivos_parada mp on mp.id = pp.motivo_id
  join public.maquinas m on m.id = ap.maquina_id
  left join public.produtos p on p.id = ap.produto_id
  left join public.operacoes o on o.id = ap.operacao_id
  left join public.funcionarios f on f.id = ap.funcionario_id
  where ap.data >= p_data_inicial
    and ap.data <= p_data_final
    and (p_produto_id is null or ap.produto_id = p_produto_id)
    and (p_maquina_id is null or ap.maquina_id = p_maquina_id)
    and (p_operacao_id is null or ap.operacao_id = p_operacao_id)
    and (p_funcionario_id is null or ap.funcionario_id = p_funcionario_id)
    and (p_periodo_id is null or ap.periodo_id = p_periodo_id);
end;
$$;

revoke all on function public.obter_paradas_producao(date, date, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.obter_paradas_producao(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

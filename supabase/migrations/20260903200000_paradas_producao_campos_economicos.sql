-- Sittech — schema PostgreSQL, migration 28
-- Paradas V1 — estende obter_paradas_producao (migration 25) com os
-- snapshots do apontamento pai necessários pro rateio exato de custo do
-- tempo ocioso e capacidade local perdida POR PARADA individual.
--
-- Nenhuma tabela nova, nenhuma coluna nova em tabela nenhuma — os 3
-- campos já existem como snapshot em apontamentos_producao desde as
-- migrations 9 (custo_hora_operacao_vigente) e 26 (nada novo aqui, só
-- devolvidos junto). A RPC só passa a devolver 3 colunas a mais.
--
-- Por que "rateio, não aproximação": dentro de UM apontamento,
-- custo_hora_operacao_vigente e meta_periodo_vigente/duracao são
-- CONSTANTES (o mesmo apontamento pode ter várias paradas de motivos
-- diferentes, mas todas compartilham o mesmo custo/hora e a mesma
-- meta/duração). Como as fórmulas de custo do tempo ocioso e capacidade
-- perdida já são lineares em minutos, aplicar a mesma fórmula à duração
-- de CADA parada (em vez de à soma agregada do apontamento) dá o
-- resultado exato — nenhuma suposição nova é introduzida.
--
-- Mesmo padrão de segurança/compatibilidade da migration 25/26: SECURITY
-- DEFINER, gate reaproveitando 'producao_real_historico' (nenhuma
-- permissão nova), search_path fixo, grants só authenticated, mesmos
-- parâmetros de filtro (nenhum novo — filtro por origem de parada
-- continua sendo feito no cliente sobre o campo `origem` já existente).
-- Consumidores existentes (Pareto de paradas em Indicadores V1) continuam
-- funcionando sem alteração: colunas antigas mantidas na mesma ordem,
-- 3 novas só no final.

drop function if exists public.obter_paradas_producao(date, date, uuid, uuid, uuid, uuid, text);

create function public.obter_paradas_producao(
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
  funcionario_nome text,
  custo_hora_operacao_vigente numeric,
  meta_periodo_vigente numeric,
  duracao_periodo_horas_vigente numeric
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
    f.nome,
    ap.custo_hora_operacao_vigente,
    ap.meta_periodo_vigente,
    ap.duracao_periodo_horas_vigente
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

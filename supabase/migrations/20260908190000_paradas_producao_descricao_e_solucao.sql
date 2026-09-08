-- Sittech — schema PostgreSQL, migration 32
-- Corrige achado reportado pelo admin: a tela Produção Real > Paradas não
-- mostra "qual foi o problema" nem "o que foi feito pra resolver", mesmo
-- quando essa informação já foi registrada pela supervisora.
--
-- Investigação (nenhuma coluna nova precisa ser criada — os dois campos
-- já existem e já são preenchidos, só não chegam até a tela):
--   * "Problema" — capturado em AbrirOcorrenciaModal ("O que aconteceu?"),
--     persistido em ocorrencias_maquina.descricao (migration 15) e já
--     COPIADO pra apontamento_paradas.descricao no momento em que a
--     ocorrência é encerrada e distribuída pros apontamentos que
--     intersectam (encerrar_ocorrencia_maquina, migration 16, e
--     vincular_ocorrencias_encerradas_ao_apontamento, migration 17) — a
--     coluna já está certa no banco, só nunca foi selecionada por
--     obter_paradas_producao (migration 25/28).
--   * "Ação realizada / Solução" — capturado em EncerrarOcorrenciaModal
--     ("O que foi feito para resolver?"), persistido em
--     ocorrencias_maquina.descricao_solucao (migration 15/16) — mas essa
--     coluna nunca foi copiada pra apontamento_paradas (as duas RPCs
--     acima só propagam .descricao, não .descricao_solucao), e
--     obter_paradas_producao nunca faz join com ocorrencias_maquina.
--     Corrigido aqui SEM duplicar dado (sem coluna nova, sem migração de
--     dado histórico, sem tocar em encerrar_ocorrencia_maquina nem em
--     vincular_ocorrencias_encerradas_ao_apontamento): a RPC passa a
--     fazer left join direto em ocorrencias_maquina via
--     apontamento_paradas.ocorrencia_id (coluna já existente desde a
--     migration 9) e ler descricao_solucao de lá — fonte única, funciona
--     retroativamente pra paradas já registradas, sem backfill.
--
-- Paradas manuais (sem ocorrencia_id): "problema" continua vindo de
-- apontamento_paradas.descricao (texto livre condicional já existente no
-- ParadasManuaisEditor, campo "Descreva o motivo"); "solução" não existe
-- nesse fluxo (não há conceito de resolver uma parada manual pontual) —
-- o left join simplesmente devolve null, coerente com "só mostrar quando
-- existir".
--
-- Nenhuma fórmula, engine, cálculo de tempo/custo/capacidade ou regra de
-- ocorrência foi tocada — só 2 colunas de texto a mais no final do
-- retorno (mesma disciplina da migration 28: "colunas antigas mantidas
-- na mesma ordem"), e um left join novo só de leitura. Mesmo gate de
-- permissão de antes (producao_real_historico, inalterado — não é
-- reaproveio de permissão nova, é a mesma já usada por esta RPC desde a
-- migration 25).

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
  duracao_periodo_horas_vigente numeric,
  descricao_problema text,
  descricao_solucao text
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
    ap.duracao_periodo_horas_vigente,
    pp.descricao,
    om.descricao_solucao
  from public.apontamento_paradas pp
  join public.apontamentos_producao ap on ap.id = pp.apontamento_id
  join public.motivos_parada mp on mp.id = pp.motivo_id
  join public.maquinas m on m.id = ap.maquina_id
  left join public.produtos p on p.id = ap.produto_id
  left join public.operacoes o on o.id = ap.operacao_id
  left join public.funcionarios f on f.id = ap.funcionario_id
  left join public.ocorrencias_maquina om on om.id = pp.ocorrencia_id
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

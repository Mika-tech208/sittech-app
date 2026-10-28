-- Sittech — Escala de Produção, HOTFIX 28/10: REVEZAMENTO POR BLOCO (manhã/tarde).
--
-- REGRA (restrição DURA): uma pessoa NÃO executa a MESMA operação (operacao_id) mais de uma vez dentro da MESMA MANHÃ (m1,m2,m3) nem da MESMA TARDE (t1,t2,t3).
-- A exposição ZERA entre manhã e tarde (M3 Montar → T1 Montar é permitido) e no dia seguinte. Substitui, SOB FLAG, a regra "mesma operação em períodos consecutivos".
--
-- Rollout atrás de flag (aditivo, idempotente, atômico; NÃO muda nenhum plano gravado):
--   1) `revezamento_escopo`        'consecutivo' (PADRÃO: comportamento atual) | 'bloco'   — mudar o valor pede RECÁLCULO (gatilho de parâmetros genérico, o mesmo de `revezamento_modo`)
--   2) `revezamento_equivalencias` {} (PADRÃO)  mapa opcional operacao_id -> [operacao_id,...] "executar X expõe também Y": só entra em vigor com o escopo 'bloco'
--   3) escala_revezamento_regras()   leitura (jsonb) para a tela
--   4) escala_repeticoes_bloco / escala_linha_repete_no_bloco   funções de apoio (contagem de repetições no bloco, com equivalências)
--   5) escala_trocar_alocacoes       com escopo 'bloco' bloqueia a troca que AUMENTA as repetições de alguma das duas pessoas no bloco trocado
--                                    (repetição antiga e alheia à troca não bloqueia — mesmo critério do TS); escopo 'consecutivo' = função idêntica à da migration 20261024100000.
-- Reverter: UPDATE escala_parametros SET valor = '"consecutivo"' WHERE chave = 'revezamento_escopo'  (o gatilho recalcula o futuro com a regra anterior).
-- Identidade: operacao_id (nunca por nome). Id de período m*/t* define o bloco (primeira letra).

-- =========================================================================
-- 1) Parâmetros (sem disparar recálculo na criação: o padrão não muda nada)
-- =========================================================================
alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
alter table public.escala_parametros disable trigger trg_escala_plano_versao;
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('revezamento_escopo', '"consecutivo"', 'operacional', 'Escopo do revezamento duro: consecutivo (a mesma operação não pode se repetir em períodos consecutivos; M3→T1 conta) ou bloco (a mesma operação no máximo 1 vez por manhã M1-M3 e por tarde T1-T3). Mudar recalcula o futuro'),
  ('revezamento_equivalencias', '{}'::jsonb, 'operacional', 'Equivalência opcional de operações no escopo bloco: {"operacao_id": ["operacao_id", ...]} = executar a chave expõe também as listadas. Vazio = a identidade é o operacao_id')
on conflict (chave) do nothing;
alter table public.escala_parametros enable trigger trg_escala_plano_versao;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

alter table public.escala_parametros drop constraint if exists escala_parametros_revezamento_escopo;
alter table public.escala_parametros add constraint escala_parametros_revezamento_escopo
  check (chave <> 'revezamento_escopo' or valor in ('"consecutivo"'::jsonb, '"bloco"'::jsonb));
alter table public.escala_parametros drop constraint if exists escala_parametros_revezamento_equivalencias;
alter table public.escala_parametros add constraint escala_parametros_revezamento_equivalencias
  check (chave <> 'revezamento_equivalencias' or jsonb_typeof(valor) = 'object');

-- =========================================================================
-- 2) Leitura das regras (tela) e funções de apoio
-- =========================================================================
create or replace function public.escala_revezamento_regras()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'escopo', coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'revezamento_escopo'), 'consecutivo'),
    'equivalencias', coalesce((select valor from public.escala_parametros where chave = 'revezamento_equivalencias'), '{}'::jsonb)
  );
$$;
revoke all on function public.escala_revezamento_regras() from public, anon;
grant execute on function public.escala_revezamento_regras() to authenticated, service_role;

-- operações expostas ao executar `p_op`: ela mesma + as listadas em p_eq[p_op]
create or replace function public.escala_op_expansao(p_op uuid, p_eq jsonb)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array(
    select distinct x from unnest(
      array[p_op::text] || coalesce(
        (select array_agg(e) from jsonb_array_elements_text(case when jsonb_typeof(p_eq -> (p_op::text)) = 'array' then p_eq -> (p_op::text) else '[]'::jsonb end) e),
        array[]::text[])
    ) x
  );
$$;

-- nº de linhas da pessoa, no bloco (primeira letra do período: 'm' ou 't') do dia, que repetem operação (ou equivalente) já executada ANTES no mesmo bloco
create or replace function public.escala_repeticoes_bloco(p_data date, p_funcionario uuid, p_bloco text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with eq as (select coalesce((select valor from public.escala_parametros where chave = 'revezamento_equivalencias'), '{}'::jsonb) v),
  l as (
    select a.periodo_id, public.escala_op_expansao(a.operacao_id, (select v from eq)) exp
      from public.escala_producao_alocacoes a
     where a.data = p_data and a.funcionario_id = p_funcionario and a.maquina_id is not null and a.operacao_id is not null and left(a.periodo_id, 1) = p_bloco
  )
  select count(*)::integer from l x where exists (select 1 from l y where y.periodo_id < x.periodo_id and y.exp && x.exp);
$$;

create or replace function public.escala_linha_repete_no_bloco(p_data date, p_funcionario uuid, p_periodo_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with eq as (select coalesce((select valor from public.escala_parametros where chave = 'revezamento_equivalencias'), '{}'::jsonb) v),
  l as (
    select a.periodo_id, public.escala_op_expansao(a.operacao_id, (select v from eq)) exp
      from public.escala_producao_alocacoes a
     where a.data = p_data and a.funcionario_id = p_funcionario and a.maquina_id is not null and a.operacao_id is not null and left(a.periodo_id, 1) = left(p_periodo_id, 1)
  )
  select coalesce(exists (select 1 from l x join l y on y.periodo_id < x.periodo_id and y.exp && x.exp where x.periodo_id = p_periodo_id), false);
$$;
revoke all on function public.escala_op_expansao(uuid, jsonb) from public, anon;
revoke all on function public.escala_repeticoes_bloco(date, uuid, text) from public, anon;
revoke all on function public.escala_linha_repete_no_bloco(date, uuid, text) from public, anon;
grant execute on function public.escala_repeticoes_bloco(date, uuid, text) to authenticated, service_role;
grant execute on function public.escala_linha_repete_no_bloco(date, uuid, text) to authenticated, service_role;

-- =========================================================================
-- 3) Troca manual: escala_trocar_alocacoes (escopo 'consecutivo' = idêntica à migration 20261024100000)
-- =========================================================================
create or replace function public.escala_trocar_alocacoes(
  p_data date,
  p_periodo_id text,
  p_funcionario_a uuid,
  p_funcionario_b uuid,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dia public.escala_producao_dias;
  v_idx integer;
  v_inicio text;
  v_a public.escala_producao_alocacoes;
  v_b public.escala_producao_alocacoes;
  v_usuario uuid;
  v_escopo text := coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'revezamento_escopo'), 'consecutivo');
  v_bloco text := left(p_periodo_id, 1);
  v_ant_a integer;
  v_ant_b integer;
begin
  if not public.escala_pode_operar() then
    raise exception 'Usuário não tem permissão para editar a Escala de Produção';
  end if;
  if p_motivo is null or char_length(btrim(p_motivo)) < 3 then
    raise exception 'ESCALA_MOTIVO_OBRIGATORIO: informe o motivo da troca manual';
  end if;
  if p_funcionario_a = p_funcionario_b then
    raise exception 'Escolha dois funcionários diferentes';
  end if;

  select * into v_dia from escala_producao_dias where data = p_data;
  if not found then
    raise exception 'Não existe escala gerada para %', p_data;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('escala:' || v_dia.previsao_id::text, 0));

  select ord::integer, e.v->>'inicio' into v_idx, v_inicio
  from jsonb_array_elements(v_dia.periodos_snapshot) with ordinality as e(v, ord)
  where e.v->>'id' = p_periodo_id;
  if v_idx is null then
    raise exception 'Período inválido: %', p_periodo_id;
  end if;

  if ((p_data::text || ' ' || substr(v_inicio, 1, 5))::timestamp at time zone 'America/Sao_Paulo') <= now() then
    raise exception 'ESCALA_PERIODO_NAO_EDITAVEL: o período % de % já iniciou — períodos em andamento e concluídos não podem ser editados', p_periodo_id, p_data;
  end if;

  select * into v_a from escala_producao_alocacoes where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_a for update;
  select * into v_b from escala_producao_alocacoes where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_b for update;
  if v_a.funcionario_id is null or v_b.funcionario_id is null then
    raise exception 'Os dois funcionários precisam estar escalados neste período';
  end if;

  -- ESCOPO BLOCO: repetições JÁ existentes no bloco (plano antigo) — a troca só é bloqueada se AUMENTAR as repetições de alguma das duas pessoas
  if v_escopo = 'bloco' then
    v_ant_a := public.escala_repeticoes_bloco(p_data, p_funcionario_a, v_bloco);
    v_ant_b := public.escala_repeticoes_bloco(p_data, p_funcionario_b, v_bloco);
  end if;

  -- estaciona A para não violar a unicidade (data, período, máquina) durante a troca
  update escala_producao_alocacoes
     set maquina_id = null, produto_id = null, etapa_id = null, operacao_id = null, pecas = 0, pecas_adicional = 0, tipo_adicional = null, motivo_sem_posto = '__troca__', excecao_revezamento = false, motivo_excecao = null
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_a;

  update escala_producao_alocacoes
     set maquina_id = v_a.maquina_id, produto_id = v_a.produto_id, etapa_id = v_a.etapa_id, operacao_id = v_a.operacao_id, pecas = v_a.pecas, pecas_adicional = v_a.pecas_adicional, tipo_adicional = v_a.tipo_adicional,
         motivo_sem_posto = case when v_a.maquina_id is null then coalesce(v_a.motivo_sem_posto, 'Alteração manual') else null end,
         origem = 'manual'
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_b;

  update escala_producao_alocacoes
     set maquina_id = v_b.maquina_id, produto_id = v_b.produto_id, etapa_id = v_b.etapa_id, operacao_id = v_b.operacao_id, pecas = v_b.pecas, pecas_adicional = v_b.pecas_adicional, tipo_adicional = v_b.tipo_adicional,
         motivo_sem_posto = case when v_b.maquina_id is null then coalesce(v_b.motivo_sem_posto, 'Alteração manual') else null end,
         origem = 'manual'
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_a;

  -- REVEZAMENTO DURO: a mesma pessoa NUNCA repete a operação — nem por troca manual. Sem exceção, sem motivo que libere, sem bypass administrativo.
  -- A exceção desfaz a troca inteira (a transação é revertida).
  if v_escopo = 'bloco' then
    -- ESCOPO BLOCO (hotfix 28/10): a mesma operação (ou equivalente) no máximo 1 vez por MANHÃ (m1-m3) e por TARDE (t1-t3). A exposição zera entre manhã e tarde e no dia seguinte.
    if public.escala_repeticoes_bloco(p_data, p_funcionario_a, v_bloco) > v_ant_a or public.escala_repeticoes_bloco(p_data, p_funcionario_b, v_bloco) > v_ant_b then
      raise exception 'ESCALA_ROTACAO_VIOLADA: Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação na mesma manhã ou na mesma tarde.';
    end if;
    -- recalcula a marca de exceção dos dois funcionários no bloco trocado (linha que repete operação já executada antes, no mesmo bloco)
    update escala_producao_alocacoes a
       set excecao_revezamento = public.escala_linha_repete_no_bloco(a.data, a.funcionario_id, a.periodo_id),
           motivo_excecao = case when public.escala_linha_repete_no_bloco(a.data, a.funcionario_id, a.periodo_id) then 'Alteração manual: mesma operação já executada neste bloco (manhã/tarde)' else null end
     where a.data = p_data and a.funcionario_id in (p_funcionario_a, p_funcionario_b) and left(a.periodo_id, 1) = v_bloco;
  else
  -- REVEZAMENTO DURO (Fase 4a): a mesma pessoa NUNCA executa a mesma operação em períodos consecutivos do mesmo dia — nem por troca manual.
  -- Sem exceção, sem motivo que libere, sem bypass administrativo. Confere só os pares que envolvem o período trocado, nos dois funcionários;
  -- a exceção desfaz a troca inteira (a transação é revertida).
  if exists (
    with linhas as (
      select a.funcionario_id, a.operacao_id, a.maquina_id,
             (select ord::integer from jsonb_array_elements(v_dia.periodos_snapshot) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id) as idx
      from escala_producao_alocacoes a
      where a.data = p_data and a.funcionario_id in (p_funcionario_a, p_funcionario_b)
    ), comparado as (
      select l.*, lag(l.operacao_id) over w as op_ant, lag(l.maquina_id) over w as maq_ant, lag(l.idx) over w as idx_ant
      from linhas l
      window w as (partition by l.funcionario_id order by l.idx)
    )
    select 1 from comparado c
     where c.idx in (v_idx, v_idx + 1)
       and c.maquina_id is not null and c.maq_ant is not null and c.idx_ant = c.idx - 1 and c.operacao_id = c.op_ant
  ) then
    raise exception 'ESCALA_ROTACAO_VIOLADA: Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação em períodos consecutivos.';
  end if;

  -- recalcula as exceções de revezamento dos dois funcionários (dia inteiro: só
  -- períodos futuros recebem a marcação nova; passado fica como está)
  with linhas as (
    select a.funcionario_id, a.periodo_id, a.operacao_id, a.maquina_id,
           (select ord::integer from jsonb_array_elements(v_dia.periodos_snapshot) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id) as idx
    from escala_producao_alocacoes a
    where a.data = p_data and a.funcionario_id in (p_funcionario_a, p_funcionario_b)
  ), comparado as (
    select l.*, lag(l.operacao_id) over w as op_ant, lag(l.maquina_id) over w as maq_ant, lag(l.idx) over w as idx_ant
    from linhas l
    window w as (partition by l.funcionario_id order by l.idx)
  )
  update escala_producao_alocacoes a
     set excecao_revezamento = (c.maquina_id is not null and c.maq_ant is not null and c.idx_ant = c.idx - 1 and c.operacao_id = c.op_ant),
         motivo_excecao = case when (c.maquina_id is not null and c.maq_ant is not null and c.idx_ant = c.idx - 1 and c.operacao_id = c.op_ant)
                               then 'Alteração manual: mesma operação do período anterior' else null end
    from comparado c
   where a.data = p_data and a.periodo_id = c.periodo_id and a.funcionario_id = c.funcionario_id and c.idx >= v_idx;
  end if;

  v_usuario := public.escala_usuario_atual();
  update escala_producao_dias set versao = versao + 1, atualizado_em = now(), atualizado_por = v_usuario where data = p_data;

  insert into escala_producao_eventos (tipo, previsao_id, payload, usuario_id, status, processado_em)
  values ('edicao_manual', v_dia.previsao_id,
          jsonb_build_object(
            'data', p_data, 'periodo_id', p_periodo_id, 'funcionario_a', p_funcionario_a, 'funcionario_b', p_funcionario_b,
            'motivo', btrim(p_motivo),
            'a_antes', jsonb_build_object('maquina_id', v_a.maquina_id, 'operacao_id', v_a.operacao_id),
            'b_antes', jsonb_build_object('maquina_id', v_b.maquina_id, 'operacao_id', v_b.operacao_id)),
          v_usuario, 'processado', now());

  return jsonb_build_object('versao', (select versao from escala_producao_dias where data = p_data));
end;
$$;

revoke all on function public.escala_trocar_alocacoes(date, text, uuid, uuid, text) from public, anon;
grant execute on function public.escala_trocar_alocacoes(date, text, uuid, uuid, text) to authenticated;

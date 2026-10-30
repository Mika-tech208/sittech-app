-- Sittech — Escala de Produção: PONTE M3 → T1 do revezamento por bloco (30/10/2026).
--
-- REGRA (restrição DURA, sob flag, só com `revezamento_escopo = 'bloco'`): ALÉM das regras de bloco (no máx. 1 execução da mesma operacao_id por manhã e por tarde), a mesma
-- pessoa NÃO executa em T1 (1º período da tarde) a operação (ou equivalente) que executou em M3 (último período da manhã) do MESMO dia. T2/T3 e o dia seguinte não olham para trás.
-- Exposição só de alocação congelada / troca manual registrada (escala_producao_alocacoes). Nunca do apontamento.
--
-- ADITIVA e INERTE: cria as chaves `revezamento_ponte_m3_t1` = false e `producao_real_fluxo_mesmo_periodo` = true (padrão atual) (gatilhos desligados durante o INSERT: não dispara recálculo) e estende duas RPCs.
-- Ordem: migration → código → UPDATE da flag para true (o gatilho de parâmetros recalcula o futuro).
-- Reverter: UPDATE escala_parametros SET valor='false' WHERE chave='revezamento_ponte_m3_t1' (recalcula o futuro com a regra de bloco).
-- Código antigo ignora a chave e a coluna `ponte_m3_t1` da RPC: degrada para a regra de bloco (seguro).

alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
alter table public.escala_parametros disable trigger trg_escala_plano_versao;
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('revezamento_ponte_m3_t1', 'false'::jsonb, 'operacional', 'Ponte M3→T1 (só com revezamento_escopo=bloco): a mesma pessoa não repete em T1 a operação que fez em M3 do mesmo dia. Mudar recalcula o futuro'),
  ('producao_real_fluxo_mesmo_periodo', 'true'::jsonb, 'operacional', 'Fluxo: true (padrão) = o downstream de um período pode usar a produção da etapa anterior do MESMO período; false = REGRA CONSERVADORA (só o estoque do início do período). Mudar recalcula o futuro')
on conflict (chave) do nothing;
alter table public.escala_parametros enable trigger trg_escala_plano_versao;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

alter table public.escala_parametros drop constraint if exists escala_parametros_revezamento_ponte;
alter table public.escala_parametros add constraint escala_parametros_revezamento_ponte
  check (chave <> 'revezamento_ponte_m3_t1' or jsonb_typeof(valor) = 'boolean');
alter table public.escala_parametros drop constraint if exists escala_parametros_fluxo_mesmo_periodo;
alter table public.escala_parametros add constraint escala_parametros_fluxo_mesmo_periodo
  check (chave <> 'producao_real_fluxo_mesmo_periodo' or jsonb_typeof(valor) = 'boolean');

create or replace function public.escala_ponte_m3_t1_ativa()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((select valor = 'true'::jsonb from public.escala_parametros where chave = 'revezamento_ponte_m3_t1'), false)
     and coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'revezamento_escopo'), 'consecutivo') = 'bloco';
$$;
revoke all on function public.escala_ponte_m3_t1_ativa() from public, anon;
grant execute on function public.escala_ponte_m3_t1_ativa() to authenticated, service_role;

-- leitura (tela): acrescenta ponte_m3_t1 (efetiva só com o escopo bloco)
create or replace function public.escala_revezamento_regras()
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'escopo', coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'revezamento_escopo'), 'consecutivo'),
    'equivalencias', coalesce((select valor from public.escala_parametros where chave = 'revezamento_equivalencias'), '{}'::jsonb),
    'ponte_m3_t1', public.escala_ponte_m3_t1_ativa()
  );
$$;
revoke all on function public.escala_revezamento_regras() from public, anon;
grant execute on function public.escala_revezamento_regras() to authenticated, service_role;

-- 1 se a pessoa repete (ou equivale a) em T1 a operação de M3 do dia; 0 caso contrário. M3 = último id 'm*' do snapshot do dia; T1 = primeiro id 't*' (blocos pela 1ª letra, como o resto).
create or replace function public.escala_repeticoes_ponte(p_data date, p_funcionario uuid)
returns integer language sql stable security definer set search_path = public, pg_temp
as $$
  with ids as (
    select max(e->>'id') filter (where left(e->>'id', 1) = 'm') as m_ult, min(e->>'id') filter (where left(e->>'id', 1) = 't') as t_prim
      from public.escala_producao_dias d, jsonb_array_elements(d.periodos_snapshot) e where d.data = p_data
  ), eq as (select coalesce((select valor from public.escala_parametros where chave = 'revezamento_equivalencias'), '{}'::jsonb) v)
  select count(*)::integer
    from ids, public.escala_producao_alocacoes t
    join public.escala_producao_alocacoes m on m.data = t.data and m.funcionario_id = t.funcionario_id
   where t.data = p_data and t.funcionario_id = p_funcionario and t.periodo_id = ids.t_prim and m.periodo_id = ids.m_ult
     and t.maquina_id is not null and t.operacao_id is not null and m.maquina_id is not null and m.operacao_id is not null
     and public.escala_op_expansao(t.operacao_id, (select v from eq)) && public.escala_op_expansao(m.operacao_id, (select v from eq));
$$;
revoke all on function public.escala_repeticoes_ponte(date, uuid) from public, anon;
grant execute on function public.escala_repeticoes_ponte(date, uuid) to authenticated, service_role;

-- troca manual: igual à da migration 20261105200000 + contagem da ponte (a troca só é bloqueada se AUMENTA as repetições de bloco + ponte de alguma das duas pessoas)
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
  v_ponte boolean := public.escala_ponte_m3_t1_ativa();
  v_dep_a integer;
  v_dep_b integer;
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
    v_ant_a := public.escala_repeticoes_bloco(p_data, p_funcionario_a, v_bloco) + case when v_ponte then public.escala_repeticoes_ponte(p_data, p_funcionario_a) else 0 end;
    v_ant_b := public.escala_repeticoes_bloco(p_data, p_funcionario_b, v_bloco) + case when v_ponte then public.escala_repeticoes_ponte(p_data, p_funcionario_b) else 0 end;
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
    v_dep_a := public.escala_repeticoes_bloco(p_data, p_funcionario_a, v_bloco) + case when v_ponte then public.escala_repeticoes_ponte(p_data, p_funcionario_a) else 0 end;
    v_dep_b := public.escala_repeticoes_bloco(p_data, p_funcionario_b, v_bloco) + case when v_ponte then public.escala_repeticoes_ponte(p_data, p_funcionario_b) else 0 end;
    if v_dep_a > v_ant_a or v_dep_b > v_ant_b then
      raise exception 'ESCALA_ROTACAO_VIOLADA: %', case when v_ponte
        then 'Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação na mesma manhã, na mesma tarde ou do último período da manhã para o primeiro da tarde.'
        else 'Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação na mesma manhã ou na mesma tarde.' end;
    end if;
    -- recalcula a marca de exceção dos dois funcionários no bloco trocado (linha que repete operação já executada antes, no mesmo bloco)
    update escala_producao_alocacoes a
       set excecao_revezamento = public.escala_linha_repete_no_bloco(a.data, a.funcionario_id, a.periodo_id),
           motivo_excecao = case when public.escala_linha_repete_no_bloco(a.data, a.funcionario_id, a.periodo_id) then 'Alteração manual: mesma operação já executada neste bloco (manhã/tarde)' else null end
     where a.data = p_data and a.funcionario_id in (p_funcionario_a, p_funcionario_b) and (left(a.periodo_id, 1) = v_bloco or (v_ponte and left(a.periodo_id, 1) = 't'));
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

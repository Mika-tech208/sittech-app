-- Escala de Produção — troca manual passa a EXIGIR motivo e registra no
-- histórico (escala_producao_eventos, tipo edicao_manual) o motivo e o posto
-- de cada pessoa ANTES da troca. A troca continua valendo naquele momento e
-- NÃO fica protegida contra recálculos futuros (a equidade compensa).
-- Troca de assinatura: a versão sem motivo deixa de existir.

drop function if exists public.escala_trocar_alocacoes(date, text, uuid, uuid);

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

  -- estaciona A para não violar a unicidade (data, período, máquina) durante a troca
  update escala_producao_alocacoes
     set maquina_id = null, produto_id = null, etapa_id = null, operacao_id = null, pecas = 0, motivo_sem_posto = '__troca__', excecao_revezamento = false, motivo_excecao = null
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_a;

  update escala_producao_alocacoes
     set maquina_id = v_a.maquina_id, produto_id = v_a.produto_id, etapa_id = v_a.etapa_id, operacao_id = v_a.operacao_id, pecas = v_a.pecas,
         motivo_sem_posto = case when v_a.maquina_id is null then coalesce(v_a.motivo_sem_posto, 'Alteração manual') else null end,
         origem = 'manual'
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_b;

  update escala_producao_alocacoes
     set maquina_id = v_b.maquina_id, produto_id = v_b.produto_id, etapa_id = v_b.etapa_id, operacao_id = v_b.operacao_id, pecas = v_b.pecas,
         motivo_sem_posto = case when v_b.maquina_id is null then coalesce(v_b.motivo_sem_posto, 'Alteração manual') else null end,
         origem = 'manual'
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_a;

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

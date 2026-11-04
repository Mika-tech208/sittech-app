-- Sittech — LIBERAÇÃO DA PROGRAMAÇÃO PARA O CHÃO (fonte única de verdade, no BANCO).
-- Regra HARD (fechamento físico ATIVO): a programação de um período só é entregue ao chão quando existir, explicitamente:
--   fechamento do período ANTERIOR  +  estado CONFIRMADO  +  PLANO GERADO POR ESSE FECHAMENTO (hash do plano do log = hash do diagnóstico aplicado).
-- NUNCA por horário, nunca porque "existe um plano futuro". Plano anterior ao fechamento = INTERNO/ESTIMADO, inválido para exibição.
-- A RPC da TV (escala_tv_snapshot) passa a NÃO ENTREGAR as alocações de períodos não liberados: protege inclusive telas com página antiga aberta (fail-closed).
-- TRANSIÇÃO: períodos anteriores a `escala_liberacao_desde` (padrão: M3 de 04/11/2026) seguem liberados. Fechamento físico em modo != ativo: tudo liberado (como antes).
-- VÍNCULO fechamento→plano (TRANSITÓRIO): hoje NÃO existe `fechamento_id → plano_versao_id` (nem o plano nem o diagnóstico guardam o id do fechamento). O vínculo seguro disponível é:
--   hash_plano_novo do log CONFIRMADO = hash_plano_fluxo de um diagnóstico gatilho 'fechamento' APLICADO  E  plano do dia regravado depois do fechamento (escala_producao_dias.atualizado_em >= fechado_em).
-- NÃO é a arquitetura final: tarefa aberta para gravar a relação explícita (fechamento_id no plano/diagnóstico) e substituir esta comparação por hash. Nunca usa "o último plano existente".
-- Só leitura: não altera apontamentos, inventário, corte-v1, portão HARD nem plano.
begin;

create or replace function public.escala_liberacao_slots(p_data date)
returns table (data date, pid text, nome text, inicio text)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.data, p ->> 'id', p ->> 'nome', p ->> 'inicio'
  from public.escala_producao_dias d, jsonb_array_elements(d.periodos_snapshot) p
  where d.data between p_data - 7 and p_data;
$$;

create or replace function public.escala_periodo_liberacao(p_data date, p_periodo text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_modo text := public.escala_fechamento_fisico_modo();
  v_desde jsonb := coalesce((select valor from public.escala_parametros where chave = 'escala_liberacao_desde'), '{"data":"2026-11-04","periodo":"m3"}'::jsonb);
  v_desde_data date := (v_desde ->> 'data')::date;
  v_slot record; v_ant record; v_dinicio text; v_e record; v_hash text; v_conf timestamptz; v_plano boolean;
  v_pred jsonb;
begin
  if v_modo <> 'ativo' then return jsonb_build_object('liberado', true, 'motivo', 'MODO_NAO_ATIVO'); end if;
  select * into v_slot from public.escala_liberacao_slots(p_data) s where s.data = p_data and s.pid = p_periodo;
  if not found then return jsonb_build_object('liberado', false, 'motivo', 'PERIODO_DESCONHECIDO'); end if;
  -- anterior à regra (transição): liberado
  if p_data < v_desde_data then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  if p_data = v_desde_data then
    select s.inicio into v_dinicio from public.escala_liberacao_slots(p_data) s where s.data = v_desde_data and s.pid = v_desde ->> 'periodo';
    if v_dinicio is not null and v_slot.inicio < v_dinicio then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  end if;
  -- período anterior (o último que começou antes, em qualquer dia da janela)
  select * into v_ant from public.escala_liberacao_slots(p_data) s where (s.data, s.inicio) < (p_data, v_slot.inicio) order by s.data desc, s.inicio desc limit 1;
  if not found then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  v_pred := jsonb_build_object('data', v_ant.data, 'periodo', v_ant.pid, 'rotulo', v_ant.nome);
  select * into v_e from public.escala_fechamento_estado e where e.data = v_ant.data and e.periodo_id = v_ant.pid and not e.sombra;
  if not found then return jsonb_build_object('liberado', false, 'motivo', 'AGUARDANDO_FECHAMENTO', 'predecessor', v_pred); end if;
  if v_e.estado = 'ERRO_RECALCULO' then return jsonb_build_object('liberado', false, 'motivo', 'ERRO_RECALCULO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  if v_e.estado <> 'CONFIRMADO' then return jsonb_build_object('liberado', false, 'motivo', 'RECALCULANDO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  -- CONFIRMADO: exige o PLANO GERADO POR ESTE fechamento persistido (hash do log = hash do diagnóstico aplicado)
  select l.detalhe ->> 'hash_plano_novo', l.em into v_hash, v_conf from public.escala_fechamento_log l where l.fechamento_id = v_e.fechamento_id and l.estado = 'CONFIRMADO' order by l.seq desc limit 1;
  v_plano := v_hash is not null
    and exists (select 1 from public.escala_fluxo_diagnosticos d where d.gatilho = 'fechamento' and d.aplicado = true and d.hash_plano_fluxo = v_hash)
    and exists (select 1 from public.escala_producao_dias dd where dd.data = p_data and dd.atualizado_em >= v_e.fechado_em);   -- o plano do dia foi regravado DEPOIS do fechamento
  if not v_plano then return jsonb_build_object('liberado', false, 'motivo', 'CONFIRMADO_SEM_PLANO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  return jsonb_build_object('liberado', true, 'motivo', 'CONFIRMADO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id, 'hash_plano', v_hash, 'confirmado_em', v_conf, 'excecao', v_e.excecao);
end;
$$;

create or replace function public.escala_liberacao_dia(p_data date)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(s.pid, public.escala_periodo_liberacao(p_data, s.pid)), '{}'::jsonb) from public.escala_liberacao_slots(p_data) s where s.data = p_data;
$$;

revoke all on function public.escala_liberacao_slots(date), public.escala_periodo_liberacao(date, text), public.escala_liberacao_dia(date) from public, anon;
grant execute on function public.escala_liberacao_slots(date), public.escala_periodo_liberacao(date, text), public.escala_liberacao_dia(date) to authenticated, service_role;

-- RPC da TV: só entrega alocações de períodos LIBERADOS (fail-closed) + o estado de liberação por período
create or replace function public.escala_tv_snapshot(p_data date default null::date)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_data date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
  v_dia public.escala_producao_dias;
  v_aloc jsonb;
  v_ind jsonb;
  v_lib jsonb;
begin
  if not (public.is_admin() or public.has_permissao('escala_producao') or public.has_permissao('escala_producao_tv')) then
    raise exception 'Usuário não tem permissão para a TV da Escala';
  end if;

  select * into v_dia from public.escala_producao_dias where data = v_data;
  if not found then
    return jsonb_build_object('agora', now(), 'data', v_data, 'existe', false);
  end if;

  v_lib := public.escala_liberacao_dia(v_data);

  select coalesce(jsonb_agg(jsonb_build_object(
           'periodo_id', a.periodo_id,
           'funcionario_id', a.funcionario_id,
           'funcionario', f.nome,
           'maquina', m.nome,
           'produto', p.nome,
           'operacao', o.nome,
           'motivo_sem_posto', a.motivo_sem_posto,
           'excecao', a.excecao_revezamento
         ) order by a.periodo_id, f.nome), '[]'::jsonb)
    into v_aloc
  from public.escala_producao_alocacoes a
  join public.funcionarios f on f.id = a.funcionario_id
  left join public.maquinas m on m.id = a.maquina_id
  left join public.produtos p on p.id = a.produto_id
  left join public.operacoes o on o.id = a.operacao_id
  where a.data = v_data
    and coalesce((v_lib -> a.periodo_id ->> 'liberado')::boolean, false);   -- período não liberado: NENHUMA linha sai do banco

  select coalesce(jsonb_agg(jsonb_build_object('maquina', m.nome, 'desde', i.desde, 'motivo', i.motivo) order by i.desde), '[]'::jsonb)
    into v_ind
  from public.escala_recurso_indisponivel i
  join public.maquinas m on m.id = i.maquina_id
  where i.liberada_em is null;

  return jsonb_build_object(
    'agora', now(), 'data', v_data, 'existe', true, 'versao', v_dia.versao, 'atualizado_em', v_dia.atualizado_em,
    'periodos', v_dia.periodos_snapshot, 'alocacoes', v_aloc, 'indisponiveis', v_ind, 'liberacao', v_lib
  );
end;
$function$;

commit;

-- Sittech — Escala de Produção: RPCs de persistência e de outbox (Fase 1).
-- Todas são chamadas SOMENTE pelo processador server-side (service_role).
-- Nenhuma é concedida a `authenticated`; as RPCs operadas pela tela
-- (editar/bloquear/liberar) vêm em migration própria.

-- =========================================================================
-- escala_aplicar_recalculo: substitui SÓ os períodos futuros de uma semana.
--
-- Concorrência: lock advisory por previsão (serializa recálculos da mesma
-- semana) + controle otimista por dia (versao_base). Se a versão mudou
-- desde que o servidor leu o estado, levanta ESCALA_VERSAO_CONFLITO e o
-- servidor recalcula com o estado novo.
--
-- Proteção do passado: nenhuma alocação em período < ponto de corte pode
-- ser enviada nem é apagada (períodos concluídos e o período em andamento
-- ficam congelados). O periodos_snapshot de um dia existente NUNCA é
-- sobrescrito — só dias novos o recebem.
-- =========================================================================
create or replace function public.escala_aplicar_recalculo(
  p_previsao_id uuid,
  p_dias jsonb,              -- [{data, versao_base (int|null p/ dia novo), periodos_snapshot}]
  p_a_partir_data date,      -- primeiro período MUTÁVEL: data...
  p_a_partir_periodo text,   -- ...e id do período
  p_alocacoes jsonb,         -- [{data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, origem, excecao_revezamento, motivo_excecao, motivo_sem_posto}]
  p_usuario_id uuid,
  p_evento_ids uuid[],
  p_resumo jsonb,
  p_remover_dias date[] default '{}'   -- dias que deixaram de ser produtivos na Previsão (só o futuro é removido)
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_dia jsonb;
  v_data date;
  v_base integer;
  v_atual integer;
  v_prev uuid;
  v_snapshot jsonb;
  v_corte integer;
  v_datas date[] := '{}';
  v_versoes jsonb;
begin
  if p_previsao_id is null then
    raise exception 'ESCALA_PREVISAO_OBRIGATORIA';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('escala:' || p_previsao_id::text, 0));

  -- 1) valida versões e cria dias novos
  for v_dia in select * from jsonb_array_elements(coalesce(p_dias, '[]'::jsonb)) loop
    v_data := (v_dia->>'data')::date;
    v_base := nullif(v_dia->>'versao_base', '')::integer;
    v_datas := v_datas || v_data;

    select versao, previsao_id into v_atual, v_prev
    from escala_producao_dias where data = v_data for update;

    if found then
      if v_prev <> p_previsao_id then
        raise exception 'ESCALA_DIA_DE_OUTRA_PREVISAO: %', v_data;
      end if;
      if v_base is distinct from v_atual then
        raise exception 'ESCALA_VERSAO_CONFLITO: dia % base % atual %', v_data, v_base, v_atual;
      end if;
    else
      if v_base is not null then
        raise exception 'ESCALA_VERSAO_CONFLITO: dia % inexistente (base %)', v_data, v_base;
      end if;
      insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao)
      values (v_data, p_previsao_id, v_dia->'periodos_snapshot', 0);
    end if;
  end loop;

  -- 2) ponto de corte (índice do período dentro do snapshot do dia de corte)
  select periodos_snapshot into v_snapshot from escala_producao_dias where data = p_a_partir_data;
  if v_snapshot is not null then
    select ord::integer into v_corte
    from jsonb_array_elements(v_snapshot) with ordinality as e(v, ord)
    where e.v->>'id' = p_a_partir_periodo;
    if v_corte is null then
      raise exception 'ESCALA_PERIODO_INVALIDO: %', p_a_partir_periodo;
    end if;
  end if;

  -- 3) nenhuma alocação nova pode cair em período congelado nem fora dos dias informados
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_alocacoes, '[]'::jsonb)) as x(data date, periodo_id text)
    where not (x.data = any(v_datas))
       or x.data < p_a_partir_data
       or (x.data = p_a_partir_data and coalesce((
            select ord::integer from jsonb_array_elements(v_snapshot) with ordinality as e(v, ord) where e.v->>'id' = x.periodo_id
          ), 0) < coalesce(v_corte, 0))
  ) then
    raise exception 'ESCALA_ALOCACAO_CONGELADA: tentativa de gravar período não futuro';
  end if;

  -- 4) apaga somente os períodos futuros dos dias informados
  foreach v_data in array v_datas loop
    if v_data < p_a_partir_data then
      continue;
    elsif v_data > p_a_partir_data then
      delete from escala_producao_alocacoes where data = v_data;
    else
      delete from escala_producao_alocacoes a
      where a.data = v_data
        and coalesce((select ord::integer from jsonb_array_elements(v_snapshot) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id), 0) >= v_corte;
    end if;
  end loop;

  -- 4b) dias que deixaram de ser produtivos: o futuro some, o passado (congelado) fica
  foreach v_data in array coalesce(p_remover_dias, '{}'::date[]) loop
    if v_data > p_a_partir_data then
      delete from escala_producao_dias where data = v_data and previsao_id = p_previsao_id;  -- cascata nas alocações
    elsif v_data = p_a_partir_data then
      select periodos_snapshot into v_snapshot from escala_producao_dias where data = v_data and previsao_id = p_previsao_id;
      if v_snapshot is not null then
        delete from escala_producao_alocacoes a
        where a.data = v_data
          and coalesce((select ord::integer from jsonb_array_elements(v_snapshot) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id), 0) >= coalesce(v_corte, 0);
        update escala_producao_dias set versao = versao + 1, atualizado_em = now(), atualizado_por = p_usuario_id where data = v_data;
      end if;
    end if;
  end loop;

  -- 5) grava as novas alocações (as unicidades do banco são a barreira final)
  insert into escala_producao_alocacoes (
    data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id,
    pecas, origem, excecao_revezamento, motivo_excecao, motivo_sem_posto
  )
  select x.data, x.periodo_id, x.funcionario_id, x.maquina_id, x.produto_id, x.etapa_id, x.operacao_id,
         coalesce(x.pecas, 0), coalesce(x.origem, 'auto'), coalesce(x.excecao_revezamento, false), x.motivo_excecao, x.motivo_sem_posto
  from jsonb_to_recordset(coalesce(p_alocacoes, '[]'::jsonb)) as x(
    data date, periodo_id text, funcionario_id uuid, maquina_id uuid, produto_id uuid, etapa_id uuid, operacao_id uuid,
    pecas numeric, origem text, excecao_revezamento boolean, motivo_excecao text, motivo_sem_posto text
  );

  -- 6) versões, histórico e baixa dos eventos
  update escala_producao_dias
     set versao = versao + 1, atualizado_em = now(), atualizado_por = p_usuario_id
   where data = any(v_datas);

  select coalesce(jsonb_object_agg(data::text, versao), '{}'::jsonb) into v_versoes
  from escala_producao_dias where data = any(v_datas);

  insert into escala_producao_eventos (tipo, previsao_id, payload, usuario_id, status, processado_em)
  values ('recalculo', p_previsao_id,
          jsonb_build_object('a_partir_data', p_a_partir_data, 'a_partir_periodo', p_a_partir_periodo,
                             'dias', to_jsonb(v_datas), 'eventos', to_jsonb(coalesce(p_evento_ids, '{}'::uuid[])), 'resumo', coalesce(p_resumo, '{}'::jsonb)),
          p_usuario_id, 'processado', now());

  if p_evento_ids is not null and array_length(p_evento_ids, 1) > 0 then
    update escala_producao_eventos
       set status = 'processado', processado_em = now(), erro = null
     where id = any(p_evento_ids) and status in ('pendente', 'processando');
  end if;

  return jsonb_build_object('versoes', v_versoes);
end;
$$;

-- =========================================================================
-- Outbox: registrar, reivindicar e concluir eventos
-- =========================================================================

-- Registra um pedido de recálculo. Deduplica: se já existe um evento
-- PENDENTE do mesmo tipo e semana, devolve o existente (o recálculo sempre
-- parte do estado completo atual, então duplicados seriam redundantes).
create or replace function public.escala_registrar_evento(
  p_tipo text,
  p_previsao_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_usuario_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_tipo not in ('ausencia', 'previsao', 'recurso_bloqueado', 'recurso_liberado', 'geracao_manual') then
    raise exception 'ESCALA_TIPO_EVENTO_INVALIDO: %', p_tipo;
  end if;

  select id into v_id
  from escala_producao_eventos
  where status = 'pendente' and tipo = p_tipo and previsao_id is not distinct from p_previsao_id
  limit 1;
  if found then
    return v_id;
  end if;

  insert into escala_producao_eventos (tipo, previsao_id, payload, usuario_id)
  values (p_tipo, p_previsao_id, coalesce(p_payload, '{}'::jsonb), p_usuario_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Reivindica eventos a processar: pendentes, com erro (até 3 tentativas) ou
-- "processando" há mais de 5 minutos (processador que caiu). `skip locked`
-- evita que dois processadores peguem o mesmo evento.
create or replace function public.escala_reivindicar_eventos(p_limite integer default 50)
returns setof public.escala_producao_eventos
language sql
security invoker
set search_path = public, pg_temp
as $$
  with candidatos as (
    select id
    from escala_producao_eventos
    where tipo in ('ausencia', 'previsao', 'recurso_bloqueado', 'recurso_liberado', 'geracao_manual')
      and (
        status = 'pendente'
        or (status = 'erro' and tentativas < 3)
        or (status = 'processando' and iniciado_em < now() - interval '5 minutes')
      )
    order by criado_em
    limit greatest(1, least(coalesce(p_limite, 50), 200))
    for update skip locked
  )
  update escala_producao_eventos e
     set status = 'processando', tentativas = e.tentativas + 1, iniciado_em = now()
    from candidatos c
   where e.id = c.id
  returning e.*;
$$;

create or replace function public.escala_concluir_eventos(p_ids uuid[], p_status text, p_erro text default null)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('processado', 'ignorado', 'erro') then
    raise exception 'ESCALA_STATUS_INVALIDO: %', p_status;
  end if;
  update escala_producao_eventos
     set status = p_status, processado_em = now(), erro = p_erro
   where id = any(coalesce(p_ids, '{}'::uuid[])) and status in ('pendente', 'processando', 'erro');
end;
$$;

-- Execução restrita ao servidor
revoke all on function public.escala_aplicar_recalculo(uuid, jsonb, date, text, jsonb, uuid, uuid[], jsonb, date[]) from public, anon, authenticated;
revoke all on function public.escala_registrar_evento(text, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.escala_reivindicar_eventos(integer) from public, anon, authenticated;
revoke all on function public.escala_concluir_eventos(uuid[], text, text) from public, anon, authenticated;
grant execute on function public.escala_aplicar_recalculo(uuid, jsonb, date, text, jsonb, uuid, uuid[], jsonb, date[]) to service_role;
grant execute on function public.escala_registrar_evento(text, uuid, jsonb, uuid) to service_role;
grant execute on function public.escala_reivindicar_eventos(integer) to service_role;
grant execute on function public.escala_concluir_eventos(uuid[], text, text) to service_role;

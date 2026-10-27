-- Sittech — FRENTE A: máquina desativada/reativada e mudança de roteiro (roteiro_etapa_maquinas) agora REAGEM na Escala.
--
-- Problema (auditoria 27/10/2026): maquinas.ativo e roteiro_etapa_maquinas eram lidos pelo motor, mas mudá-los NÃO gerava evento — uma máquina desativada
-- (ou removida do roteiro da etapa) continuava nos períodos futuros até algum outro evento acontecer. Sem alterar o motor:
--   1) trigger em maquinas (ativo / operacao_id): desativar => 'recurso_bloqueado'; reativar => 'recurso_liberado' (a máquina volta a ser CANDIDATA; o motor decide);
--   2) trigger em roteiro_etapa_maquinas (insert/delete): evento 'previsao' quando o par (etapa, máquina) é relevante numa semana com escala futura
--      (selecionado na Previsão OU alocado no futuro). Só semanas com escala futura; semanas encerradas nunca são recalculadas;
--   3) escala_divergencias_cadastro_maquinas(): RECONCILIAÇÃO — alocação FUTURA em máquina inativa, em máquina que o roteiro não autoriza para a etapa
--      (mesma regra do motor: lista da etapa, ou — sem lista — operação da máquina) ou fora da seleção da Previsão. Somente leitura; o servidor decide o evento.
-- Os triggers NUNCA bloqueiam a operação de cadastro (falha vira aviso; a reconciliação repara). Passado imutável (só períodos com início > agora).

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Evento para uma máquina (relevância: selecionada na Previsão da semana OU com alocação futura nela)
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.escala_evento_maquina(p_tipo text, p_maquina_id uuid, p_origem text, p_detalhe jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
  v_n integer := 0;
begin
  for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
    if exists (
         select 1 from public.previsao_itens i join public.previsao_item_maquinas im on im.item_id = i.id
          where i.previsao_id = v_prev and i.tipo = 'previsto' and im.maquina_id = p_maquina_id
       )
       or exists (
         select 1 from public.escala_producao_alocacoes a join public.escala_producao_dias d on d.data = a.data
          where d.previsao_id = v_prev and a.maquina_id = p_maquina_id and a.data >= (now() at time zone 'America/Sao_Paulo')::date
       ) then
      perform public.escala_registrar_evento(p_tipo, v_prev, jsonb_build_object('maquina_id', p_maquina_id, 'origem', p_origem) || coalesce(p_detalhe, '{}'::jsonb), null);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- maquinas.ativo / maquinas.operacao_id
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.escala_trg_maquina_cadastro()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.ativo is distinct from old.ativo then
      perform public.escala_evento_maquina(case when new.ativo then 'recurso_liberado' else 'recurso_bloqueado' end, new.id, 'maquina_ativo', jsonb_build_object('ativo', new.ativo));
    elsif new.operacao_id is distinct from old.operacao_id then
      -- a operação da máquina define a elegibilidade das etapas SEM lista de máquinas
      perform public.escala_evento_maquina('previsao', new.id, 'maquina_operacao', '{}'::jsonb);
    end if;
  exception when others then
    raise warning 'escala_trg_maquina_cadastro: reação da Escala adiada (%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_escala_maquina_cadastro on public.maquinas;
create trigger trg_escala_maquina_cadastro
  after update of ativo, operacao_id on public.maquinas
  for each row when (new.ativo is distinct from old.ativo or new.operacao_id is distinct from old.operacao_id)
  execute function public.escala_trg_maquina_cadastro();

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- roteiro_etapa_maquinas (insert / delete). atualizar_produto_com_roteiro reescreve a lista inteira da etapa: o mesmo par que sai e volta gera, no máximo,
-- UM evento pendente por semana (deduplicado) — o recálculo sem mudança é barato e a reconciliação garante o resultado.
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.escala_trg_roteiro_maquina()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_etapa uuid := case when tg_op = 'DELETE' then old.etapa_id else new.etapa_id end;
  v_maq uuid := case when tg_op = 'DELETE' then old.maquina_id else new.maquina_id end;
  v_prev uuid;
begin
  begin
    for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
      if exists (
           select 1 from public.previsao_itens i join public.previsao_item_maquinas im on im.item_id = i.id
            where i.previsao_id = v_prev and i.tipo = 'previsto' and im.etapa_id = v_etapa and im.maquina_id = v_maq
         )
         or exists (
           select 1 from public.escala_producao_alocacoes a join public.escala_producao_dias d on d.data = a.data
            where d.previsao_id = v_prev and a.etapa_id = v_etapa and a.maquina_id = v_maq and a.data >= (now() at time zone 'America/Sao_Paulo')::date
         ) then
        perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('origem', 'roteiro_etapa_maquinas', 'operacao', lower(tg_op), 'etapa_id', v_etapa, 'maquina_id', v_maq), null);
      end if;
    end loop;
  exception when others then
    raise warning 'escala_trg_roteiro_maquina: reação da Escala adiada (% / %): %', v_etapa, v_maq, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_escala_roteiro_maquina on public.roteiro_etapa_maquinas;
create trigger trg_escala_roteiro_maquina
  after insert or delete on public.roteiro_etapa_maquinas
  for each row execute function public.escala_trg_roteiro_maquina();

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- RECONCILIAÇÃO: o que as FONTES (maquinas, roteiro, Previsão) dizem x a Escala gravada, só nos períodos futuros (início > agora)
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.escala_divergencias_cadastro_maquinas(p_agora timestamptz default now())
returns table (previsao_id uuid, data date, periodo_id text, maquina_id uuid, etapa_id uuid, tipo text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with fut as (
    select d.previsao_id, a.data, a.periodo_id, a.maquina_id, a.etapa_id, a.produto_id
    from public.escala_producao_dias d
    join public.escala_producao_alocacoes a on a.data = d.data
    cross join lateral (
      select ((d.data + (p.x->>'inicio')::time) at time zone 'America/Sao_Paulo') as ini
      from jsonb_array_elements(d.periodos_snapshot) p(x) where p.x->>'id' = a.periodo_id limit 1
    ) s
    where a.maquina_id is not null and s.ini > p_agora
  )
  select distinct f.previsao_id, f.data, f.periodo_id, f.maquina_id, f.etapa_id, x.tipo
  from fut f
  join public.maquinas m on m.id = f.maquina_id
  left join public.roteiro_etapas re on re.id = f.etapa_id
  cross join lateral (
    select 'maquina_inativa'::text as tipo where not m.ativo
    union all
    -- mesma regra de elegibilidade do motor (montarEntrada): etapa COM lista de máquinas => precisa estar na lista; SEM lista => operação da máquina = operação da etapa
    -- (máquina sem operação cadastrada = "sem informação para provar": mantida)
    select 'roteiro_nao_autoriza' where re.id is not null and (
      case when exists (select 1 from public.roteiro_etapa_maquinas rm where rm.etapa_id = f.etapa_id)
           then not exists (select 1 from public.roteiro_etapa_maquinas rm where rm.etapa_id = f.etapa_id and rm.maquina_id = f.maquina_id)
           else m.operacao_id is not null and m.operacao_id <> re.operacao_id end)
    union all
    select 'fora_da_selecao_previsao' where not exists (
      select 1 from public.previsao_itens i join public.previsao_item_maquinas im on im.item_id = i.id
       where i.previsao_id = f.previsao_id and i.tipo = 'previsto' and i.produto_id = f.produto_id and im.etapa_id = f.etapa_id and im.maquina_id = f.maquina_id)
  ) x;
$$;

revoke all on function public.escala_evento_maquina(text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.escala_trg_maquina_cadastro() from public, anon, authenticated;
revoke all on function public.escala_trg_roteiro_maquina() from public, anon, authenticated;
revoke all on function public.escala_divergencias_cadastro_maquinas(timestamptz) from public, anon, authenticated;
grant execute on function public.escala_divergencias_cadastro_maquinas(timestamptz) to service_role;

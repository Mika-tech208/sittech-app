-- Sittech — HOTFIX: uma Parada de máquina (ocorrencias_maquina) passa a tornar a máquina INDISPONÍVEL para a Escala e a Capacidade.
--
-- Causa raiz (27/10/2026): a Parada de Produção Real não chegava à Escala. A Escala só conhecia maquinas.ativo,
-- previsao_maquinas_indisponiveis e escala_recurso_indisponivel (bloqueio MANUAL). Esta migration NÃO muda o motor:
-- ela faz a Parada virar uma linha de escala_recurso_indisponivel (ESPELHO, com origem) mantida por trigger.
--
-- Modelo: uma máquina está indisponível enquanto existir QUALQUER causa ativa (várias linhas por máquina):
--   origem_tipo='manual'             -> botão "Tornar indisponível" da Escala (no máx. 1 aberta por máquina; "Liberar" manual)
--   origem_tipo='ocorrencia_maquina' -> a Parada (origem_id = ocorrencias_maquina.id; a janela espelha aberta_em/encerrada_em;
--                                       encerrar a Parada encerra a causa, sem "Liberar" manual)
-- Eventos: abrir -> 'recurso_bloqueado'; encerrar/apagar -> 'recurso_liberado' (mesmo outbox e mesma deduplicação de sempre,
-- na MESMA transação da Parada: não se perde). Só para semanas com escala futura em que a máquina está selecionada na Previsão
-- ou tem alocação futura (máquina fora da operação da Escala não gera recálculo).
-- Idempotente: escala_reconciliar_indisponibilidades() repara/atualiza tudo a partir de ocorrencias_maquina (fonte da verdade).

-- =========================================================================
-- 1) Origem da causa + índices
-- =========================================================================
alter table public.escala_recurso_indisponivel
  add column if not exists origem_tipo text not null default 'manual',
  add column if not exists origem_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_escala_indisp_origem_tipo') then
    alter table public.escala_recurso_indisponivel
      add constraint ck_escala_indisp_origem_tipo check (origem_tipo in ('manual', 'ocorrencia_maquina'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_escala_indisp_origem_id') then
    alter table public.escala_recurso_indisponivel
      add constraint ck_escala_indisp_origem_id check ((origem_tipo = 'manual') = (origem_id is null));
  end if;
end $$;

-- antes: no máximo UMA indisponibilidade aberta por máquina (qualquer origem). Agora: uma MANUAL aberta por máquina
-- e uma linha por Parada. Várias causas simultâneas na mesma máquina são permitidas.
drop index if exists public.uq_escala_recurso_indisponivel_aberta;
create unique index if not exists uq_escala_indisp_manual_aberta
  on public.escala_recurso_indisponivel(maquina_id) where origem_tipo = 'manual' and liberada_em is null;
create unique index if not exists uq_escala_indisp_origem
  on public.escala_recurso_indisponivel(origem_tipo, origem_id) where origem_id is not null;

-- =========================================================================
-- 2) Evento de Escala para uma máquina (só onde ela é relevante)
-- =========================================================================
create or replace function public.escala_evento_recurso(p_tipo text, p_maquina_id uuid, p_indisponibilidade_id uuid, p_ocorrencia_id uuid)
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
      perform public.escala_registrar_evento(
        p_tipo, v_prev,
        jsonb_build_object('maquina_id', p_maquina_id, 'indisponibilidade_id', p_indisponibilidade_id, 'origem', 'ocorrencia_maquina', 'ocorrencia_id', p_ocorrencia_id),
        null
      );
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- =========================================================================
-- 3) Sincroniza UMA Parada com o espelho (idempotente). Retorna criada|atualizada|removida|nada.
-- =========================================================================
create or replace function public.escala_sincronizar_ocorrencia(p_ocorrencia_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.ocorrencias_maquina;
  m public.escala_recurso_indisponivel;
  v_motivo text;
  v_obs text;
begin
  select * into o from public.ocorrencias_maquina where id = p_ocorrencia_id;
  select * into m from public.escala_recurso_indisponivel where origem_tipo = 'ocorrencia_maquina' and origem_id = p_ocorrencia_id;

  if o.id is null then
    -- Parada apagada/cancelada (ex.: exclusão de funcionário): a causa some; se estava aberta, a máquina é liberada (desta causa)
    if m.id is not null then
      delete from public.escala_recurso_indisponivel where id = m.id;
      if m.liberada_em is null then
        perform public.escala_evento_recurso('recurso_liberado', m.maquina_id, m.id, p_ocorrencia_id);
      end if;
      return 'removida';
    end if;
    return 'nada';
  end if;

  v_motivo := case o.tipo when 'manutencao' then 'manutencao' else 'problema_operacional' end;
  v_obs := left('Parada registrada em Produção Real: ' || trim(o.descricao), 500);

  if m.id is null then
    insert into public.escala_recurso_indisponivel (maquina_id, motivo, observacao, desde, liberada_em, criado_por, liberado_por, origem_tipo, origem_id)
    values (o.maquina_id, v_motivo, v_obs, o.aberta_em, o.encerrada_em, o.criado_por, o.encerrado_por, 'ocorrencia_maquina', o.id)
    on conflict (origem_tipo, origem_id) where origem_id is not null do nothing
    returning * into m;
    if m.id is not null then
      if o.encerrada_em is null then
        perform public.escala_evento_recurso('recurso_bloqueado', o.maquina_id, m.id, o.id);
      end if;
      return 'criada';
    end if;
    -- outra transação (ex.: reconciliação) criou o espelho no mesmo instante: segue como atualização
    select * into m from public.escala_recurso_indisponivel where origem_tipo = 'ocorrencia_maquina' and origem_id = p_ocorrencia_id;
  end if;

  if m.maquina_id is distinct from o.maquina_id or m.desde is distinct from o.aberta_em or m.liberada_em is distinct from o.encerrada_em
     or m.motivo is distinct from v_motivo or m.observacao is distinct from v_obs or m.liberado_por is distinct from o.encerrado_por then
    update public.escala_recurso_indisponivel
       set maquina_id = o.maquina_id, desde = o.aberta_em, liberada_em = o.encerrada_em, motivo = v_motivo, observacao = v_obs, liberado_por = o.encerrado_por
     where id = m.id;
    if m.liberada_em is null and o.encerrada_em is not null then
      perform public.escala_evento_recurso('recurso_liberado', o.maquina_id, m.id, o.id);
    elsif m.liberada_em is not null and o.encerrada_em is null then
      perform public.escala_evento_recurso('recurso_bloqueado', o.maquina_id, m.id, o.id);
    elsif o.encerrada_em is null and m.maquina_id is distinct from o.maquina_id then
      perform public.escala_evento_recurso('recurso_liberado', m.maquina_id, m.id, o.id);
      perform public.escala_evento_recurso('recurso_bloqueado', o.maquina_id, m.id, o.id);
    end if;
    return 'atualizada';
  end if;
  return 'nada';
end;
$$;

create or replace function public.escala_trg_ocorrencia_maquina()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A Escala NUNCA pode impedir o registro/encerramento de uma Parada (operação crítica de chão de fábrica): qualquer falha aqui vira aviso
  -- e é reparada pela reconciliação (executada a cada chamada do worker /api/escala/drenar e /processar).
  begin
    perform public.escala_sincronizar_ocorrencia(case when tg_op = 'DELETE' then old.id else new.id end);
  exception when others then
    raise warning 'escala_trg_ocorrencia_maquina: sincronização adiada (%): %', case when tg_op = 'DELETE' then old.id else new.id end, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_escala_ocorrencia_maquina on public.ocorrencias_maquina;
create trigger trg_escala_ocorrencia_maquina
  after insert or update or delete on public.ocorrencias_maquina
  for each row execute function public.escala_trg_ocorrencia_maquina();

-- =========================================================================
-- 4) Reconciliação (backfill + revalidação periódica): repara o espelho a partir das Paradas. Idempotente: sem mudança = sem evento.
-- =========================================================================
create or replace function public.escala_reconciliar_indisponibilidades()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_res text;
  v_criadas integer := 0;
  v_atualizadas integer := 0;
  v_removidas integer := 0;
begin
  for r in
    select id from public.ocorrencias_maquina where encerrada_em is null or encerrada_em >= now() - interval '45 days'
    union
    select origem_id from public.escala_recurso_indisponivel where origem_tipo = 'ocorrencia_maquina'
  loop
    v_res := public.escala_sincronizar_ocorrencia(r.id);
    if v_res = 'criada' then v_criadas := v_criadas + 1;
    elsif v_res = 'atualizada' then v_atualizadas := v_atualizadas + 1;
    elsif v_res = 'removida' then v_removidas := v_removidas + 1;
    end if;
  end loop;
  return jsonb_build_object('criadas', v_criadas, 'atualizadas', v_atualizadas, 'removidas', v_removidas);
end;
$$;

-- =========================================================================
-- 5) Invariante de segurança: alocação FUTURA (início do período > agora) numa máquina com causa ativa que INTERSECTA o período.
--    Interseção de intervalos semiabertos [ini, fim): causa.desde < fim_periodo AND (causa.liberada_em IS NULL OR causa.liberada_em > ini_periodo).
-- =========================================================================
drop function if exists public.escala_violacoes_disponibilidade(timestamptz);
create or replace function public.escala_violacoes_disponibilidade(p_agora timestamptz default now())
returns table (previsao_id uuid, data date, periodo_id text, maquina_id uuid, funcionario_id uuid, desde timestamptz, origem_tipo text, indisponibilidade_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.previsao_id, a.data, a.periodo_id, a.maquina_id, a.funcionario_id, i.desde, i.origem_tipo, i.id
  from public.escala_producao_alocacoes a
  join public.escala_producao_dias d on d.data = a.data
  cross join lateral (
    select ((a.data + (p->>'inicio')::time) at time zone 'America/Sao_Paulo') as ini, ((a.data + (p->>'fim')::time) at time zone 'America/Sao_Paulo') as fim
    from jsonb_array_elements(d.periodos_snapshot) p where p->>'id' = a.periodo_id limit 1
  ) s
  join public.escala_recurso_indisponivel i on i.maquina_id = a.maquina_id
  where a.maquina_id is not null
    and s.ini > p_agora
    and i.desde < s.fim
    and (i.liberada_em is null or i.liberada_em > s.ini);
$$;

-- =========================================================================
-- 6) Estado efetivo para a Capacidade/Previsão (qualquer usuário ativo): máquinas com causa ABERTA agora.
--    O futuro é sempre binário (toda causa é aberta ou já terminou) — a mesma verdade que o motor usa.
-- =========================================================================
create or replace function public.escala_maquinas_indisponiveis_agora()
returns table (maquina_id uuid, origem_tipo text, motivo text, desde timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.maquina_id, i.origem_tipo, i.motivo, i.desde
  from public.escala_recurso_indisponivel i
  where i.liberada_em is null and public.is_usuario_ativo();
$$;

-- =========================================================================
-- 7) Bloqueio/liberação MANUAIS: convivem com a Parada (várias causas); liberar só vale para a causa manual
-- =========================================================================
create or replace function public.escala_bloquear_recurso(
  p_maquina_id uuid,
  p_motivo text,
  p_observacao text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_usuario uuid;
  v_prev uuid;
begin
  if not public.escala_pode_operar() then
    raise exception 'Usuário não tem permissão para operar a Escala de Produção';
  end if;
  if not exists (select 1 from maquinas where id = p_maquina_id and ativo = true) then
    raise exception 'Máquina não encontrada ou inativa';
  end if;
  if exists (select 1 from escala_recurso_indisponivel where maquina_id = p_maquina_id and origem_tipo = 'manual' and liberada_em is null) then
    raise exception 'Este recurso já está indisponível';
  end if;

  v_usuario := public.escala_usuario_atual();
  insert into escala_recurso_indisponivel (maquina_id, motivo, observacao, criado_por)
  values (p_maquina_id, p_motivo, nullif(trim(p_observacao), ''), v_usuario)
  returning id into v_id;

  for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
    perform public.escala_registrar_evento('recurso_bloqueado', v_prev, jsonb_build_object('maquina_id', p_maquina_id, 'indisponibilidade_id', v_id), v_usuario);
  end loop;
  return v_id;
end;
$$;

create or replace function public.escala_liberar_recurso(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid;
  v_maquina uuid;
  v_origem text;
  v_prev uuid;
begin
  if not public.escala_pode_operar() then
    raise exception 'Usuário não tem permissão para operar a Escala de Produção';
  end if;
  v_usuario := public.escala_usuario_atual();

  select origem_tipo into v_origem from escala_recurso_indisponivel where id = p_id and liberada_em is null;
  if v_origem is not null and v_origem <> 'manual' then
    raise exception 'ESCALA_LIBERACAO_PELA_PARADA: esta indisponibilidade vem de uma Parada de máquina — encerre a Parada em Produção Real';
  end if;

  update escala_recurso_indisponivel
     set liberada_em = now(), liberado_por = v_usuario
   where id = p_id and liberada_em is null and origem_tipo = 'manual'
  returning maquina_id into v_maquina;
  if v_maquina is null then
    raise exception 'Indisponibilidade não encontrada ou já liberada';
  end if;

  for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
    perform public.escala_registrar_evento('recurso_liberado', v_prev, jsonb_build_object('maquina_id', v_maquina, 'indisponibilidade_id', p_id), v_usuario);
  end loop;
end;
$$;

-- =========================================================================
-- Permissões
-- =========================================================================
revoke all on function public.escala_evento_recurso(text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.escala_sincronizar_ocorrencia(uuid) from public, anon, authenticated;
revoke all on function public.escala_trg_ocorrencia_maquina() from public, anon, authenticated;
revoke all on function public.escala_reconciliar_indisponibilidades() from public, anon, authenticated;
revoke all on function public.escala_violacoes_disponibilidade(timestamptz) from public, anon, authenticated;
revoke all on function public.escala_maquinas_indisponiveis_agora() from public, anon;
revoke all on function public.escala_bloquear_recurso(uuid, text, text) from public, anon;
revoke all on function public.escala_liberar_recurso(uuid) from public, anon;
grant execute on function public.escala_reconciliar_indisponibilidades() to service_role;
grant execute on function public.escala_violacoes_disponibilidade(timestamptz) to service_role;
grant execute on function public.escala_maquinas_indisponiveis_agora() to authenticated;
grant execute on function public.escala_bloquear_recurso(uuid, text, text) to authenticated;
grant execute on function public.escala_liberar_recurso(uuid) to authenticated;

-- =========================================================================
-- Backfill: Paradas JÁ abertas (e as encerradas recentes) viram causas agora; Parada aberta gera o evento de bloqueio.
-- =========================================================================
select public.escala_reconciliar_indisponibilidades();

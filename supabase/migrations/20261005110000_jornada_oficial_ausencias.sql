-- Sittech — schema PostgreSQL, migration 38
-- Faltas e Ausências — jornada OFICIAL própria, independente dos períodos
-- M1/M2/M3/T1/T2/T3 (migration 37 usava calcularHorasPorDia/periodos como
-- fonte, o que dava 8h43 — M3 termina 11:55 de propósito, pra dar folga de
-- bater cartão antes do almoço, não porque a jornada oficial é menor).
--
-- Decisão explícita do usuário: pra Ausências, a jornada oficial é sempre
-- 07:12–12:00 + 13:00–17:00 = 8h48, com almoço oficial 12:00–13:00. Os 5
-- minutos 11:55–12:00 não são ausência nem "jornada inexistente" — são só
-- uma particularidade operacional do cadastro de períodos, que CONTINUA
-- como está (não alterado aqui, nem em nenhuma outra migration).
--
-- `jornada_oficial_ausencias`: mesmo padrão singleton de
-- configuracoes_empresa (migration 2) — uma linha só, lida pela RPC e pelo
-- frontend (preview de duração antes de salvar). Snapshot continua
-- obrigatório: registrar_ausencia_funcionario grava esses 2 turnos (manhã/
-- tarde) em periodos_snapshot no formato já usado (mesmo shape de
-- {id,nome,inicio,fim} que antes vinha de `periodos`) — se a jornada
-- oficial mudar no futuro, ausências já lançadas continuam com os
-- horários de quando foram criadas, igual já valia pros períodos reais.
-- Nenhuma mudança em editar_ausencia_funcionario: ela nunca tocou
-- periodos_snapshot (ver migration 37).

create table public.jornada_oficial_ausencias (
  id uuid primary key default gen_random_uuid(),
  manha_inicio time not null,
  manha_fim time not null,
  tarde_inicio time not null,
  tarde_fim time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (manha_fim > manha_inicio),
  check (tarde_fim > tarde_inicio)
);

create trigger trg_jornada_oficial_ausencias_atualizado_em before update on public.jornada_oficial_ausencias
  for each row execute function public.set_atualizado_em();

insert into public.jornada_oficial_ausencias (manha_inicio, manha_fim, tarde_inicio, tarde_fim)
values ('07:12', '12:00', '13:00', '17:00');

alter table public.jornada_oficial_ausencias enable row level security;

-- Leitura: qualquer usuário ativo (mesma abertura de `periodos` — o
-- frontend precisa disso pro preview de duração antes de salvar, e quem
-- não tem permissão de ausências nem chega na tela que usa isso).
create policy jornada_oficial_ausencias_select on public.jornada_oficial_ausencias
  for select to authenticated
  using (public.is_usuario_ativo());

-- Escrita: só admin — mesmo padrão de configuracoes_empresa. Nenhuma tela
-- de edição existe ainda (fora de escopo da V1); a constraint já deixa o
-- caminho pronto pra uma futura.
create policy jornada_oficial_ausencias_admin_write on public.jornada_oficial_ausencias
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update on public.jornada_oficial_ausencias to authenticated;

-- =========================================================================
-- registrar_ausencia_funcionario: snapshot agora vem de
-- jornada_oficial_ausencias, não mais de `periodos`. Mesmo formato de
-- jsonb (array de {id,nome,inicio,fim}) — nenhuma mudança no frontend
-- além de trocar a fonte que ele consulta pro preview.
-- =========================================================================
create or replace function public.registrar_ausencia_funcionario(
  p_funcionario_id uuid,
  p_data date,
  p_tipo text,
  p_horario_inicio time,
  p_horario_fim time,
  p_duracao_minutos integer,
  p_observacao text,
  p_idempotency_key uuid
)
returns public.ausencias_funcionarios
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_ausencia public.ausencias_funcionarios;
  v_jornada public.jornada_oficial_ausencias;
  v_periodos_snapshot jsonb;
  v_constraint_name text;
begin
  select id into v_usuario_id from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  if not (public.is_admin() or public.has_permissao('ausencias_funcionarios')) then
    raise exception 'Usuário não tem permissão para registrar ausências';
  end if;

  if not exists (select 1 from public.funcionarios_elegibilidade where id = p_funcionario_id and ativo = true) then
    raise exception 'Funcionário não encontrado ou inativo';
  end if;

  select * into v_ausencia from public.ausencias_funcionarios where idempotency_key = p_idempotency_key;
  if found then
    return v_ausencia;
  end if;

  if public.existe_conflito_ausencia(p_funcionario_id, p_data, p_tipo, p_horario_inicio, p_horario_fim) then
    raise exception 'Já existe uma ausência registrada para este funcionário nesse dia/horário. Verifique os lançamentos existentes antes de salvar.';
  end if;

  select * into v_jornada from public.jornada_oficial_ausencias order by created_at limit 1;
  if v_jornada is null then
    raise exception 'Jornada oficial de ausências não configurada';
  end if;
  v_periodos_snapshot := jsonb_build_array(
    jsonb_build_object('id', 'manha', 'nome', 'Manhã', 'inicio', v_jornada.manha_inicio, 'fim', v_jornada.manha_fim),
    jsonb_build_object('id', 'tarde', 'nome', 'Tarde', 'inicio', v_jornada.tarde_inicio, 'fim', v_jornada.tarde_fim)
  );

  begin
    insert into public.ausencias_funcionarios (
      funcionario_id, data, tipo, horario_inicio, horario_fim,
      duracao_minutos, periodos_snapshot, observacao, idempotency_key, criado_por
    ) values (
      p_funcionario_id, p_data, p_tipo, p_horario_inicio, p_horario_fim,
      p_duracao_minutos, v_periodos_snapshot, p_observacao, p_idempotency_key, v_usuario_id
    )
    returning * into v_ausencia;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'ausencias_funcionarios_idempotency_key_key' then
      select * into v_ausencia from public.ausencias_funcionarios where idempotency_key = p_idempotency_key;
    else
      raise;
    end if;
  end;

  return v_ausencia;
end;
$$;

revoke all on function public.registrar_ausencia_funcionario(uuid, date, text, time, time, integer, text, uuid) from public, anon;
grant execute on function public.registrar_ausencia_funcionario(uuid, date, text, time, time, integer, text, uuid) to authenticated;

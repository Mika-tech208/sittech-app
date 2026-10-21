-- Sittech — Faltas e Ausências: ATRASO EM ABERTO.
--
-- A Clarice precisa registrar o atraso assim que percebe que o funcionário não chegou, SEM saber a hora de chegada. O atraso fica "em aberto"
-- (horario_fim = NULL, em_aberto = true) e é encerrado (a) quando o funcionário chega (agora ou horário informado) ou (b) automaticamente no
-- fim da jornada do dia — NUNCA é carregado para o dia seguinte (cada dia é independente).
--
-- Reaproveita a tabela atual, o histórico append-only (ausencia_funcionario_historico) e o evento canônico `ausencia` da Escala (trigger
-- existente em INSERT/UPDATE). Sem tabela nova, sem fila nova. Aditiva; linhas antigas não são alteradas.
--
-- Escala: atraso aberto = indisponibilidade conservadora do início até o fim da jornada; encerrado = exatamente [início, fim).
--
-- Reversão: ver bloco "ROLLBACK" no fim (comentado).

-- =========================================================================
-- 1) Colunas, constraints e índice
-- =========================================================================
alter table public.ausencias_funcionarios
  add column if not exists em_aberto boolean not null default false,
  add column if not exists encerrada_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists encerrada_em timestamptz,
  add column if not exists chegada_manual boolean,                       -- true = horário informado; false = "chegou agora"; null = não encerrado por chegada
  add column if not exists encerramento_automatico boolean not null default false;

alter table public.ausencias_funcionarios drop constraint if exists ausencia_em_aberto_forma;
alter table public.ausencias_funcionarios add constraint ausencia_em_aberto_forma check (
  not em_aberto or (tipo = 'atraso' and horario_inicio is not null and horario_fim is null and encerrada_em is null)
);
alter table public.ausencias_funcionarios drop constraint if exists ausencia_encerramento_forma;
alter table public.ausencias_funcionarios add constraint ausencia_encerramento_forma check (
  encerrada_em is null or (tipo = 'atraso' and horario_fim is not null and not em_aberto)
);
-- tipos com janela de horário nunca ficam sem fim (a Escala leria "sem horário" como DIA INTEIRO). NOT VALID: vale só para linhas novas.
alter table public.ausencias_funcionarios drop constraint if exists ausencia_janela_completa;
alter table public.ausencias_funcionarios add constraint ausencia_janela_completa check (
  em_aberto or tipo not in ('atraso', 'saida_antecipada', 'saida_durante_expediente', 'outro') or (horario_inicio is not null and horario_fim is not null)
) not valid;

create unique index if not exists uq_ausencia_atraso_aberto on public.ausencias_funcionarios (funcionario_id, data) where em_aberto;

-- histórico: ações do SISTEMA (fechamento automático) não têm usuário
alter table public.ausencia_funcionario_historico alter column alterado_por drop not null;
alter table public.ausencia_funcionario_historico add column if not exists origem text not null default 'usuario' check (origem in ('usuario', 'sistema'));
alter table public.ausencia_funcionario_historico drop constraint if exists ausencia_historico_usuario_ou_sistema;
alter table public.ausencia_funcionario_historico add constraint ausencia_historico_usuario_ou_sistema check (origem = 'sistema' or alterado_por is not null);
-- o servidor reconstrói o estado da ausência "como era no corte" (sombra) a partir do histórico
grant select on public.ausencia_funcionario_historico to service_role;

-- =========================================================================
-- 2) Funções auxiliares
-- =========================================================================
-- relógio das regras de atraso. Em produção = now(). Os testes SQL fixam o instante com `set local app.agora_teste = '...'` (só quem tem SQL direto consegue; a API não).
create or replace function public._agora()
returns timestamptz language sql stable set search_path = public, pg_temp as $$
  select coalesce(nullif(current_setting('app.agora_teste', true), '')::timestamptz, now());
$$;
revoke all on function public._agora() from public, anon;
grant execute on function public._agora() to authenticated, service_role;

-- fim da jornada oficial (singleton)
create or replace function public.jornada_fim_ausencias()
returns time language sql stable security invoker set search_path = public, pg_temp as $$
  select tarde_fim from public.jornada_oficial_ausencias order by created_at limit 1;
$$;
revoke all on function public.jornada_fim_ausencias() from public, anon;
grant execute on function public.jornada_fim_ausencias() to authenticated, service_role;

-- minutos PRODUTIVOS de [ini, fim) dentro dos turnos do snapshot (almoço nunca conta)
create or replace function public.minutos_produtivos_janela(p_snapshot jsonb, p_ini time, p_fim time)
returns integer language sql immutable set search_path = public, pg_temp as $$
  select coalesce(sum(greatest(0, extract(epoch from (least(p_fim, (p->>'fim')::time) - greatest(p_ini, (p->>'inicio')::time))) / 60)), 0)::integer
    from jsonb_array_elements(p_snapshot) p;
$$;
revoke all on function public.minutos_produtivos_janela(jsonb, time, time) from public, anon;
grant execute on function public.minutos_produtivos_janela(jsonb, time, time) to authenticated, service_role;

-- conflito: atraso EM ABERTO vale [início, fim da jornada); idem para o lançamento novo em aberto (p_horario_fim null)
create or replace function public.existe_conflito_ausencia(
  p_funcionario_id uuid, p_data date, p_tipo text, p_horario_inicio time, p_horario_fim time, p_ignorar_id uuid default null
)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.ausencias_funcionarios a
    where a.funcionario_id = p_funcionario_id and a.data = p_data and (p_ignorar_id is null or a.id <> p_ignorar_id)
      and (
        p_tipo in ('falta_dia_inteiro', 'atestado', 'falta_justificada', 'falta_nao_justificada')
        or a.tipo in ('falta_dia_inteiro', 'atestado', 'falta_justificada', 'falta_nao_justificada')
        or (a.horario_inicio < coalesce(p_horario_fim, public.jornada_fim_ausencias())
            and coalesce(a.horario_fim, public.jornada_fim_ausencias()) > p_horario_inicio)
      )
  );
$$;

-- =========================================================================
-- 3) Fechamento automático no fim da jornada (interno + público sem argumento)
--    fim efetivo = fim da jornada do snapshot (17:00) mesmo que o worker rode depois; encerrada_em = hora real do processamento.
-- =========================================================================
create or replace function public._fechar_atrasos_vencidos(p_agora timestamptz)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.ausencias_funcionarios;
  v_fim time;
  v_novo public.ausencias_funcionarios;
  v_n integer := 0;
  v_hoje date := (p_agora at time zone 'America/Sao_Paulo')::date;
  v_hora time := (p_agora at time zone 'America/Sao_Paulo')::time;
begin
  for r in select * from public.ausencias_funcionarios where em_aberto order by data, id for update skip locked loop
    select max((p->>'fim')::time) into v_fim from jsonb_array_elements(r.periodos_snapshot) p;
    if r.data < v_hoje or (r.data = v_hoje and v_hora >= v_fim) then
      update public.ausencias_funcionarios set
        horario_fim = v_fim, em_aberto = false, encerramento_automatico = true, chegada_manual = null,
        encerrada_por = null, encerrada_em = p_agora,
        duracao_minutos = public.minutos_produtivos_janela(r.periodos_snapshot, r.horario_inicio, v_fim)
      where id = r.id returning * into v_novo;
      insert into public.ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, alterado_em, motivo, origem)
      values (r.id, to_jsonb(r), to_jsonb(v_novo), null, p_agora, 'Fechamento automático no fim da jornada: nenhuma chegada foi registrada (fim efetivo = ' || to_char(v_fim, 'HH24:MI') || ')', 'sistema');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public._fechar_atrasos_vencidos(timestamptz) from public, anon, authenticated, service_role;

create or replace function public.fechar_atrasos_vencidos()
returns integer language sql security definer set search_path = public, pg_temp as $$
  select public._fechar_atrasos_vencidos(public._agora());
$$;
revoke all on function public.fechar_atrasos_vencidos() from public, anon;
grant execute on function public.fechar_atrasos_vencidos() to authenticated, service_role;

-- =========================================================================
-- 4) abrir_atraso_funcionario
-- =========================================================================
create or replace function public.abrir_atraso_funcionario(
  p_funcionario_id uuid, p_data date, p_horario_inicio time, p_observacao text, p_idempotency_key uuid
)
returns public.ausencias_funcionarios
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_ausencia public.ausencias_funcionarios;
  v_jornada public.jornada_oficial_ausencias;
  v_snapshot jsonb;
  v_hoje date := (public._agora() at time zone 'America/Sao_Paulo')::date;
  v_hora time := (public._agora() at time zone 'America/Sao_Paulo')::time;
  v_inicio time;
begin
  select id into v_usuario_id from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;
  if not (public.is_admin() or public.has_permissao('ausencias_funcionarios')) then raise exception 'Usuário não tem permissão para registrar ausências'; end if;
  if not exists (select 1 from public.funcionarios_elegibilidade where id = p_funcionario_id and ativo = true) then raise exception 'Funcionário não encontrado ou inativo'; end if;

  select * into v_ausencia from public.ausencias_funcionarios where idempotency_key = p_idempotency_key;
  if found then return v_ausencia; end if;

  perform public.fechar_atrasos_vencidos();
  select * into v_jornada from public.jornada_oficial_ausencias order by created_at limit 1;
  if v_jornada is null then raise exception 'Jornada oficial de ausências não configurada'; end if;
  v_inicio := coalesce(p_horario_inicio, v_jornada.manha_inicio);

  if p_data <> v_hoje then raise exception 'Atraso em aberto só pode ser registrado para hoje: cada dia é independente (para outro dia, informe o horário de chegada).'; end if;
  if not ((v_inicio >= v_jornada.manha_inicio and v_inicio < v_jornada.manha_fim) or (v_inicio >= v_jornada.tarde_inicio and v_inicio < v_jornada.tarde_fim)) then
    raise exception 'O horário inicial do atraso precisa estar dentro da jornada (almoço e fora do expediente não contam).';
  end if;
  if v_inicio > v_hora then raise exception 'O horário inicial do atraso ainda não chegou.'; end if;
  if v_hora >= v_jornada.tarde_fim then raise exception 'A jornada de hoje já terminou.'; end if;
  if exists (select 1 from public.ausencias_funcionarios where funcionario_id = p_funcionario_id and data = p_data and em_aberto) then
    raise exception 'Este funcionário já tem um atraso em aberto hoje.';
  end if;
  if public.existe_conflito_ausencia(p_funcionario_id, p_data, 'atraso', v_inicio, null) then
    raise exception 'Já existe uma ausência registrada para este funcionário nesse dia/horário. Verifique os lançamentos existentes antes de salvar.';
  end if;

  v_snapshot := jsonb_build_array(
    jsonb_build_object('id', 'manha', 'nome', 'Manhã', 'inicio', v_jornada.manha_inicio, 'fim', v_jornada.manha_fim),
    jsonb_build_object('id', 'tarde', 'nome', 'Tarde', 'inicio', v_jornada.tarde_inicio, 'fim', v_jornada.tarde_fim)
  );
  insert into public.ausencias_funcionarios (funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, observacao, idempotency_key, criado_por, em_aberto)
  values (p_funcionario_id, p_data, 'atraso', v_inicio, null, 0, v_snapshot, p_observacao, p_idempotency_key, v_usuario_id, true)
  returning * into v_ausencia;
  insert into public.ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, motivo)
  values (v_ausencia.id, '{}'::jsonb, to_jsonb(v_ausencia), v_usuario_id, 'Abertura do atraso em aberto');
  return v_ausencia;
end;
$$;
revoke all on function public.abrir_atraso_funcionario(uuid, date, time, text, uuid) from public, anon;
grant execute on function public.abrir_atraso_funcionario(uuid, date, time, text, uuid) to authenticated;

-- =========================================================================
-- 5) encerrar_atraso_funcionario — "chegou agora" (p_horario_chegada null) ou horário informado
-- =========================================================================
create or replace function public.encerrar_atraso_funcionario(p_ausencia_id uuid, p_horario_chegada time default null)
returns public.ausencias_funcionarios
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_antes public.ausencias_funcionarios;
  v_depois public.ausencias_funcionarios;
  v_hoje date := (public._agora() at time zone 'America/Sao_Paulo')::date;
  v_hora time := (public._agora() at time zone 'America/Sao_Paulo')::time;
  v_chegada time;
  v_fim_jornada time;
begin
  select id into v_usuario_id from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;
  if not (public.is_admin() or public.has_permissao('ausencias_funcionarios')) then raise exception 'Usuário não tem permissão para editar ausências'; end if;

  perform public.fechar_atrasos_vencidos();
  select * into v_antes from public.ausencias_funcionarios where id = p_ausencia_id for update;
  if not found then raise exception 'Ausência % não encontrada', p_ausencia_id; end if;
  if not v_antes.em_aberto then raise exception 'Este atraso já foi encerrado (veja o histórico).'; end if;
  select max((p->>'fim')::time) into v_fim_jornada from jsonb_array_elements(v_antes.periodos_snapshot) p;

  if p_horario_chegada is null then
    if v_antes.data <> v_hoje then raise exception 'Atraso de outro dia: informe o horário de chegada.'; end if;
    v_chegada := date_trunc('minute', v_hora::interval)::time; -- hora atual do servidor em America/Sao_Paulo, em minutos
  else
    v_chegada := p_horario_chegada;
  end if;
  if v_chegada <= v_antes.horario_inicio then raise exception 'A chegada precisa ser depois do início do atraso (%).', to_char(v_antes.horario_inicio, 'HH24:MI'); end if;
  if v_chegada > v_fim_jornada then raise exception 'A chegada não pode ser depois do fim da jornada (%).', to_char(v_fim_jornada, 'HH24:MI'); end if;
  if v_antes.data = v_hoje and v_chegada > v_hora then raise exception 'A chegada não pode estar no futuro.'; end if;
  if v_antes.data > v_hoje then raise exception 'Data futura.'; end if;
  if public.existe_conflito_ausencia(v_antes.funcionario_id, v_antes.data, 'atraso', v_antes.horario_inicio, v_chegada, p_ausencia_id) then
    raise exception 'Essa chegada faz o atraso conflitar com outra ausência já registrada para este funcionário nesse dia.';
  end if;

  update public.ausencias_funcionarios set
    horario_fim = v_chegada, em_aberto = false, encerramento_automatico = false,
    chegada_manual = (p_horario_chegada is not null), encerrada_por = v_usuario_id, encerrada_em = public._agora(),
    duracao_minutos = public.minutos_produtivos_janela(v_antes.periodos_snapshot, v_antes.horario_inicio, v_chegada)
  where id = p_ausencia_id returning * into v_depois;
  insert into public.ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, motivo)
  values (p_ausencia_id, to_jsonb(v_antes), to_jsonb(v_depois), v_usuario_id,
          case when p_horario_chegada is null then 'Encerramento por chegada ("Funcionário chegou")' else 'Encerramento por chegada com horário informado' end);
  return v_depois;
end;
$$;
revoke all on function public.encerrar_atraso_funcionario(uuid, time) from public, anon;
grant execute on function public.encerrar_atraso_funcionario(uuid, time) to authenticated;

-- =========================================================================
-- 6) corrigir_inicio_atraso_aberto — corrige o horário INICIAL sem apagar/recriar (motivo obrigatório, antes/depois no histórico)
-- =========================================================================
create or replace function public.corrigir_inicio_atraso_aberto(p_ausencia_id uuid, p_horario_inicio time, p_motivo text)
returns public.ausencias_funcionarios
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_antes public.ausencias_funcionarios;
  v_depois public.ausencias_funcionarios;
  v_jornada public.jornada_oficial_ausencias;
  v_hoje date := (public._agora() at time zone 'America/Sao_Paulo')::date;
  v_hora time := (public._agora() at time zone 'America/Sao_Paulo')::time;
begin
  select id into v_usuario_id from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;
  if not (public.is_admin() or public.has_permissao('ausencias_funcionarios')) then raise exception 'Usuário não tem permissão para editar ausências'; end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then raise exception 'Motivo da alteração é obrigatório'; end if;
  perform public.fechar_atrasos_vencidos();
  select * into v_antes from public.ausencias_funcionarios where id = p_ausencia_id for update;
  if not found then raise exception 'Ausência % não encontrada', p_ausencia_id; end if;
  if not v_antes.em_aberto then raise exception 'Só o atraso em aberto tem o horário inicial corrigido por aqui (atraso encerrado: edite a ocorrência).'; end if;
  select * into v_jornada from public.jornada_oficial_ausencias order by created_at limit 1;
  if not ((p_horario_inicio >= v_jornada.manha_inicio and p_horario_inicio < v_jornada.manha_fim) or (p_horario_inicio >= v_jornada.tarde_inicio and p_horario_inicio < v_jornada.tarde_fim)) then
    raise exception 'O horário inicial do atraso precisa estar dentro da jornada (almoço e fora do expediente não contam).';
  end if;
  if v_antes.data = v_hoje and p_horario_inicio > v_hora then raise exception 'O horário inicial não pode estar no futuro.'; end if;
  if public.existe_conflito_ausencia(v_antes.funcionario_id, v_antes.data, 'atraso', p_horario_inicio, null, p_ausencia_id) then
    raise exception 'Essa alteração conflita com outra ausência já registrada para este funcionário nesse dia/horário.';
  end if;
  update public.ausencias_funcionarios set horario_inicio = p_horario_inicio where id = p_ausencia_id returning * into v_depois;
  insert into public.ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, motivo)
  values (p_ausencia_id, to_jsonb(v_antes), to_jsonb(v_depois), v_usuario_id, p_motivo);
  return v_depois;
end;
$$;
revoke all on function public.corrigir_inicio_atraso_aberto(uuid, time, text) from public, anon;
grant execute on function public.corrigir_inicio_atraso_aberto(uuid, time, text) to authenticated;

-- =========================================================================
-- 7) editar_ausencia_funcionario: o atraso EM ABERTO não é editado por aqui (use encerrar / corrigir início) — mantém os invariantes
-- =========================================================================
create or replace function public.editar_ausencia_funcionario(
  p_ausencia_id uuid, p_tipo text, p_horario_inicio time, p_horario_fim time, p_duracao_minutos integer, p_observacao text, p_motivo text
)
returns public.ausencias_funcionarios
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_antes public.ausencias_funcionarios;
  v_depois public.ausencias_funcionarios;
begin
  select id into v_usuario_id from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;
  if not (public.is_admin() or public.has_permissao('ausencias_funcionarios')) then raise exception 'Usuário não tem permissão para editar ausências'; end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then raise exception 'Motivo da alteração é obrigatório'; end if;
  select * into v_antes from public.ausencias_funcionarios where id = p_ausencia_id;
  if not found then raise exception 'Ausência % não encontrada', p_ausencia_id; end if;
  if v_antes.em_aberto then raise exception 'Atraso em aberto: use "Funcionário chegou", "Informar horário de chegada" ou "Corrigir horário inicial".'; end if;
  if public.existe_conflito_ausencia(v_antes.funcionario_id, v_antes.data, p_tipo, p_horario_inicio, p_horario_fim, p_ausencia_id) then
    raise exception 'Essa alteração conflita com outra ausência já registrada para este funcionário nesse dia/horário.';
  end if;
  update public.ausencias_funcionarios set tipo = p_tipo, horario_inicio = p_horario_inicio, horario_fim = p_horario_fim, duracao_minutos = p_duracao_minutos, observacao = p_observacao
  where id = p_ausencia_id returning * into v_depois;
  insert into public.ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, motivo)
  values (p_ausencia_id, to_jsonb(v_antes), to_jsonb(v_depois), v_usuario_id, p_motivo);
  return v_depois;
end;
$$;

-- =========================================================================
-- 8) Unificação / exclusão de funcionário: bloqueadas enquanto houver atraso em aberto (mesma função, só acrescenta o bloqueio)
-- =========================================================================
create or replace function public._funcionario_exclusao(
  p_excluido uuid,
  p_mantido uuid,          -- null = exclusão simples (sem unificação)
  p_decisoes jsonb,        -- { "<custo_id>": "copiar" | "descartar" }
  p_executar boolean,
  p_assinatura text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agora timestamptz := now();
  v_modo text := case when p_mantido is null then 'exclusao' else 'unificacao' end;
  v_usuario uuid;
  v_ex record;
  v_mt record;
  r record;
  v_prev uuid;
  v_k uuid;
  v_n bigint;

  v_bloq jsonb := '[]'::jsonb;
  v_pend jsonb := '[]'::jsonb;
  v_aviso jsonb := '[]'::jsonb;

  -- apontamentos / ocorrências
  v_ap_n bigint; v_oc_n bigint; v_sobrep jsonb;
  -- ausências
  v_aus_mover uuid[] := '{}'; v_aus_cons uuid[] := '{}'; v_aus_conf jsonb := '[]'::jsonb; v_aus_total bigint;
  -- equipe da semana
  v_eq_mover jsonb := '[]'::jsonb; v_eq_conf jsonb := '[]'::jsonb; v_eq_total bigint;
  -- alocações da Escala
  v_al_mover jsonb := '[]'::jsonb; v_al_cons jsonb := '[]'::jsonb; v_al_fut jsonb := '[]'::jsonb; v_al_hist jsonb := '[]'::jsonb;
  v_prev_afetadas uuid[] := '{}';
  -- custos
  v_c_dup jsonb := '[]'::jsonb; v_c_copiar jsonb := '[]'::jsonb; v_c_desc jsonb := '[]'::jsonb; v_c_rem jsonb := '[]'::jsonb;
  v_c_usados uuid[] := '{}'; v_dec text;

  v_impacto jsonb;
  v_ocs uuid[] := '{}'; v_ap_ids uuid[] := '{}'; v_oc_bloq jsonb := '[]'::jsonb;
  v_remover jsonb := null; v_indic jsonb := null; v_hash text := null;
  v_par_n bigint := 0; v_par_min numeric := 0; v_aph_n bigint := 0; v_aush_n bigint := 0; v_not_n bigint := 0; v_cust_total numeric := 0;
  v_plano jsonb;
  v_ass text;

  -- execução
  v_ap_antes record; v_ap_depois record;
  v_snap jsonb;
  v_movidos jsonb := '{}'::jsonb;
  v_descartados jsonb := '{}'::jsonb;
  v_ids jsonb;
  v_log uuid;
begin
  if not public.is_admin() then
    raise exception 'FUNC_SOMENTE_ADMIN: somente administrador pode excluir ou unificar funcionários';
  end if;
  v_usuario := public.escala_usuario_atual();
  p_decisoes := coalesce(p_decisoes, '{}'::jsonb);

  select id, nome, ativo, created_at into v_ex from funcionarios where id = p_excluido;
  if not found then raise exception 'FUNC_NAO_ENCONTRADO: o funcionário a excluir não existe'; end if;
  -- v_mt é sempre atribuído (sem linha => campos nulos), assim nunca é lido "não atribuído" na exclusão simples
  select id, nome, ativo, created_at into v_mt from funcionarios where id = p_mantido;
  if p_mantido is not null then
    if p_mantido = p_excluido then raise exception 'FUNC_MESMO_REGISTRO: escolha OUTRO funcionário para receber o histórico'; end if;
    if v_mt.id is null then raise exception 'FUNC_DESTINO_NAO_ENCONTRADO: o funcionário que será mantido não existe'; end if;
  end if;

  -- decisões inválidas são recusadas (nada de valor desconhecido passando em silêncio)
  for r in select key, value from jsonb_each_text(p_decisoes) loop
    if r.value not in ('copiar', 'descartar') then
      raise exception 'FUNC_DECISAO_INVALIDA: decisão "%" inválida para o custo %', r.value, r.key;
    end if;
  end loop;

  if p_executar then
    -- trava os dois cadastros e as semanas de Escala afetadas (mesmo lock do recálculo da Escala)
    perform 1 from funcionarios where id in (p_excluido, coalesce(p_mantido, p_excluido)) order by id for update;
    for v_prev in
      select distinct pid from (
        select previsao_id as pid from previsao_equipe_semana where funcionario_id in (p_excluido, coalesce(p_mantido, p_excluido))
        union
        select d.previsao_id from escala_producao_alocacoes a join escala_producao_dias d on d.data = a.data
         where a.funcionario_id in (p_excluido, coalesce(p_mantido, p_excluido))
      ) t order by pid
    loop
      perform pg_advisory_xact_lock(hashtextextended('escala:' || v_prev::text, 0));
    end loop;
  end if;

  -- ---------------- apontamentos e ocorrências ----------------
  select count(*) into v_ap_n from apontamentos_producao where funcionario_id = p_excluido;
  select count(*) into v_oc_n from ocorrencias_maquina where funcionario_id = p_excluido;
  v_sobrep := '[]'::jsonb;
  if v_modo = 'exclusao' then
    -- Exclusão SEM unificação (decisão do administrador): apontamentos e ocorrências deste cadastro são
    -- removidos junto. Única trava de integridade: uma ocorrência de máquina deste funcionário que tenha
    -- paradas de apontamentos de OUTROS funcionários não pode ser apagada sem destruir dado alheio.
    select coalesce(array_agg(id), '{}') into v_ocs from ocorrencias_maquina where funcionario_id = p_excluido;
    select coalesce(array_agg(id), '{}') into v_ap_ids from apontamentos_producao where funcionario_id = p_excluido;
    select coalesce(jsonb_agg(jsonb_build_object('ocorrencia_id', o.ocid, 'paradas_de_outros', o.cnt)), '[]'::jsonb) into v_oc_bloq
      from (select pa.ocorrencia_id as ocid, count(*) as cnt from apontamento_paradas pa
             where pa.ocorrencia_id = any (v_ocs) and pa.apontamento_id <> all (v_ap_ids)
             group by pa.ocorrencia_id) o;
    if jsonb_array_length(v_oc_bloq) > 0 then
      v_bloq := v_bloq || jsonb_build_array(jsonb_build_object('codigo', 'OCORRENCIA_COM_PARADAS_DE_OUTROS',
        'mensagem', 'Uma ocorrência de máquina deste funcionário tem paradas lançadas por OUTROS funcionários. Excluir apagaria dado de terceiros: use "Unificar com outro funcionário".', 'detalhe', v_oc_bloq));
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object('data', e.data, 'periodo_id', e.periodo_id) order by e.data, e.periodo_id), '[]'::jsonb)
      into v_sobrep
      from apontamentos_producao e
      join apontamentos_producao k on k.data = e.data and k.periodo_id = e.periodo_id and k.funcionario_id = p_mantido
     where e.funcionario_id = p_excluido;
    if jsonb_array_length(v_sobrep) > 0 then
      v_bloq := v_bloq || jsonb_build_array(jsonb_build_object('codigo', 'APONTAMENTO_SOBREPOSTO',
        'mensagem', 'Os dois funcionários têm apontamento no MESMO período. Corrija os apontamentos antes de unificar.', 'detalhe', v_sobrep));
    end if;
  end if;

  -- atraso EM ABERTO (ainda sem chegada registrada) bloqueia unificação e exclusão: primeiro o registro operacional precisa ser encerrado
  if exists (select 1 from ausencias_funcionarios where em_aberto and funcionario_id in (p_excluido, coalesce(p_mantido, p_excluido))) then
    v_bloq := v_bloq || jsonb_build_array(jsonb_build_object('codigo', 'ATRASO_EM_ABERTO',
      'mensagem', 'Há atraso em aberto para este funcionário. Registre a chegada (ou aguarde o fechamento automático no fim da jornada) antes de unificar ou excluir.'));
  end if;

  -- ---------------- ausências ----------------
  select count(*) into v_aus_total from ausencias_funcionarios where funcionario_id = p_excluido;
  if v_modo = 'unificacao' then
    for r in select * from ausencias_funcionarios where funcionario_id = p_excluido order by data, id loop
      if exists (select 1 from ausencias_funcionarios k
                  where k.funcionario_id = p_mantido and k.data = r.data and k.tipo = r.tipo
                    and k.horario_inicio is not distinct from r.horario_inicio and k.horario_fim is not distinct from r.horario_fim) then
        v_aus_cons := v_aus_cons || r.id;
      elsif public.existe_conflito_ausencia(p_mantido, r.data, r.tipo, r.horario_inicio, r.horario_fim) then
        v_aus_conf := v_aus_conf || jsonb_build_array(jsonb_build_object('data', r.data, 'tipo', r.tipo));
      else
        v_aus_mover := v_aus_mover || r.id;
      end if;
    end loop;
    if jsonb_array_length(v_aus_conf) > 0 then
      v_bloq := v_bloq || jsonb_build_array(jsonb_build_object('codigo', 'AUSENCIA_CONFLITANTE',
        'mensagem', 'Há ausências do funcionário excluído que conflitam com ausências do mantido (mesmo dia, não idênticas). Resolva antes de unificar.', 'detalhe', v_aus_conf));
    end if;
  end if;

  -- ---------------- equipe produtiva da semana ----------------
  select count(*) into v_eq_total from previsao_equipe_semana where funcionario_id = p_excluido;
  if v_modo = 'unificacao' then
    for r in
      select p.id as previsao_id, p.semana_inicio, e.produtivo as pe, k.produtivo as pk, (k.funcionario_id is not null) as kept_tem
        from previsao_equipe_semana e
        join previsoes p on p.id = e.previsao_id
        left join previsao_equipe_semana k on k.previsao_id = e.previsao_id and k.funcionario_id = p_mantido
       where e.funcionario_id = p_excluido
       order by p.semana_inicio
    loop
      v_prev_afetadas := v_prev_afetadas || r.previsao_id;
      if r.kept_tem then
        v_eq_conf := v_eq_conf || jsonb_build_array(jsonb_build_object(
          'semana_inicio', r.semana_inicio, 'previsao_id', r.previsao_id,
          'produtivo_excluido', r.pe, 'produtivo_mantido', r.pk, 'produtivo_final', (r.pe or r.pk), 'difere', (r.pe <> r.pk)));
      else
        v_eq_mover := v_eq_mover || jsonb_build_array(jsonb_build_object('semana_inicio', r.semana_inicio, 'previsao_id', r.previsao_id));
      end if;
    end loop;
  else
    for r in select p.id as previsao_id from previsao_equipe_semana e join previsoes p on p.id = e.previsao_id where e.funcionario_id = p_excluido loop
      v_prev_afetadas := v_prev_afetadas || r.previsao_id;
    end loop;
  end if;

  -- ---------------- Escala (alocações) ----------------
  -- congelado = período que já começou (mesmo critério do recálculo da Escala): vira histórico e
  -- é transferido; futuro é saída derivada: é removido e a Escala recalcula.
  for r in
    select a.data, a.periodo_id,
           ((a.data + coalesce((select (pp->>'inicio')::time
                                  from public.escala_producao_dias d, jsonb_array_elements(d.periodos_snapshot) pp
                                 where d.data = a.data and pp->>'id' = a.periodo_id limit 1), time '00:00'))
              at time zone 'America/Sao_Paulo') as inicio_ts,
           (p_mantido is not null and exists (select 1 from escala_producao_alocacoes k
                                               where k.funcionario_id = p_mantido and k.data = a.data and k.periodo_id = a.periodo_id)) as kept_tem,
           (select d2.previsao_id from escala_producao_dias d2 where d2.data = a.data) as previsao_id
      from escala_producao_alocacoes a
     where a.funcionario_id = p_excluido
     order by a.data, a.periodo_id
  loop
    v_prev_afetadas := v_prev_afetadas || r.previsao_id;
    if r.inicio_ts <= v_agora then
      if v_modo = 'unificacao' then
        if r.kept_tem then v_al_cons := v_al_cons || jsonb_build_array(jsonb_build_object('data', r.data, 'periodo_id', r.periodo_id));
        else v_al_mover := v_al_mover || jsonb_build_array(jsonb_build_object('data', r.data, 'periodo_id', r.periodo_id)); end if;
      else
        v_al_hist := v_al_hist || jsonb_build_array(jsonb_build_object('data', r.data, 'periodo_id', r.periodo_id));
      end if;
    else
      v_al_fut := v_al_fut || jsonb_build_array(jsonb_build_object('data', r.data, 'periodo_id', r.periodo_id));
    end if;
  end loop;

  -- ---------------- custos extras ----------------
  for r in select id, descricao, valor from funcionario_custos where funcionario_id = p_excluido order by created_at, id loop
    if v_modo = 'exclusao' then
      v_c_rem := v_c_rem || jsonb_build_array(jsonb_build_object('id', r.id, 'descricao', r.descricao, 'valor', r.valor));
    else
      v_k := null;
      select k.id into v_k from funcionario_custos k
       where k.funcionario_id = p_mantido and lower(btrim(k.descricao)) = lower(btrim(r.descricao)) and k.valor = r.valor
         and k.id <> all (v_c_usados)
       order by k.id limit 1;
      if v_k is not null then
        v_c_usados := v_c_usados || v_k;
        v_c_dup := v_c_dup || jsonb_build_array(jsonb_build_object('id', r.id, 'descricao', r.descricao, 'valor', r.valor));
      else
        v_dec := p_decisoes ->> r.id::text;
        if v_dec = 'copiar' then
          v_c_copiar := v_c_copiar || jsonb_build_array(jsonb_build_object('id', r.id, 'descricao', r.descricao, 'valor', r.valor));
        elsif v_dec = 'descartar' then
          v_c_desc := v_c_desc || jsonb_build_array(jsonb_build_object('id', r.id, 'descricao', r.descricao, 'valor', r.valor));
        else
          v_pend := v_pend || jsonb_build_array(jsonb_build_object('codigo', 'CUSTO_SEM_DECISAO', 'custo_id', r.id,
            'descricao', r.descricao, 'valor', r.valor,
            'mensagem', 'Custo diferente dos custos do funcionário mantido: decida "copiar" ou "descartar".'));
        end if;
      end if;
    end if;
  end loop;

  if v_modo = 'unificacao' and v_mt.ativo is false and v_ex.ativo then
    v_aviso := v_aviso || jsonb_build_array(jsonb_build_object('codigo', 'MANTIDO_INATIVO', 'mensagem', 'O funcionário que será mantido está INATIVO.'));
  end if;

  -- ---------------- exclusão sem unificação: o que será removido, impacto nos indicadores e hash do conteúdo ----------------
  if v_modo = 'exclusao' then
    select count(*), coalesce(sum(minutos), 0) into v_par_n, v_par_min from apontamento_paradas where apontamento_id = any (v_ap_ids);
    select count(*) into v_aph_n from apontamento_producao_historico where apontamento_id = any (v_ap_ids);
    select count(*) into v_aush_n from ausencia_funcionario_historico h join ausencias_funcionarios a on a.id = h.ausencia_id where a.funcionario_id = p_excluido;
    select count(*) into v_not_n from push_notificacoes_ocorrencia where ocorrencia_id = any (v_ocs);
    select coalesce(sum(valor), 0) into v_cust_total from funcionario_custos where funcionario_id = p_excluido;
    v_remover := jsonb_build_object(
      'apontamentos', v_ap_n, 'apontamento_paradas', v_par_n, 'apontamento_historico', v_aph_n,
      'ocorrencias', v_oc_n, 'notificacoes_ocorrencia', v_not_n,
      'ausencias', v_aus_total, 'ausencias_historico', v_aush_n,
      'semanas_equipe', v_eq_total,
      'alocacoes_passadas', jsonb_array_length(v_al_hist), 'alocacoes_futuras', jsonb_array_length(v_al_fut),
      'custos', v_c_rem);
    v_indic := jsonb_build_object(
      'apontamentos', (select jsonb_build_object('n', count(*), 'de', min(data), 'ate', max(data), 'dias', count(distinct data),
          'quantidade_produzida', coalesce(sum(quantidade_produzida), 0), 'quantidade_refugo', coalesce(sum(quantidade_refugo), 0),
          'custo_operacional', coalesce(round(sum(custo_operacional_periodo_vigente), 2), 0),
          'valor_produzido', coalesce(round(sum(quantidade_produzida * coalesce(valor_unitario_produto_vigente, 0)), 2), 0),
          'horas', coalesce(round(sum(duracao_periodo_horas_vigente), 2), 0))
        from apontamentos_producao where funcionario_id = p_excluido),
      'paradas_minutos', v_par_min,
      'semanas_equipe', (select jsonb_build_object('n', count(*), 'produtivas', count(*) filter (where e.produtivo), 'de', min(p.semana_inicio), 'ate', max(p.semana_inicio))
        from previsao_equipe_semana e join previsoes p on p.id = e.previsao_id where e.funcionario_id = p_excluido),
      'ausencias', (select jsonb_build_object('n', count(*), 'de', min(data), 'ate', max(data)) from ausencias_funcionarios where funcionario_id = p_excluido),
      'custos_mensais_extras', v_cust_total);
    select md5(coalesce(string_agg(k, '|' order by k), '')) into v_hash from (
      select 'ap:' || id::text k from apontamentos_producao where funcionario_id = p_excluido
      union all select 'pa:' || id::text from apontamento_paradas where apontamento_id = any (v_ap_ids)
      union all select 'ah:' || id::text from apontamento_producao_historico where apontamento_id = any (v_ap_ids)
      union all select 'oc:' || id::text from ocorrencias_maquina where funcionario_id = p_excluido
      union all select 'au:' || id::text from ausencias_funcionarios where funcionario_id = p_excluido
      union all select 'eq:' || previsao_id::text || produtivo::text from previsao_equipe_semana where funcionario_id = p_excluido
      union all select 'al:' || data::text || periodo_id || coalesce(maquina_id::text, '-') from escala_producao_alocacoes where funcionario_id = p_excluido
      union all select 'cu:' || id::text || valor::text from funcionario_custos where funcionario_id = p_excluido) t;
  end if;

  -- ---------------- impacto na Escala ----------------
  select coalesce(jsonb_agg(jsonb_build_object('semana_inicio', p.semana_inicio) order by p.semana_inicio), '[]'::jsonb)
    into v_impacto
    from previsoes p
   where p.id = any (v_prev_afetadas)
     and exists (select 1 from escala_producao_dias d where d.previsao_id = p.id);

  v_plano := jsonb_build_object(
    'modo', v_modo,
    'excluido', jsonb_build_object(
      'id', v_ex.id, 'nome', v_ex.nome, 'ativo', v_ex.ativo, 'cadastro', v_ex.created_at,
      'ultima_atividade', greatest(
        (select max(data) from apontamentos_producao where funcionario_id = p_excluido),
        (select max(data) from escala_producao_alocacoes where funcionario_id = p_excluido),
        (select max(data) from ausencias_funcionarios where funcionario_id = p_excluido)),
      'vinculos', jsonb_build_object('apontamentos', v_ap_n, 'ocorrencias', v_oc_n, 'ausencias', v_aus_total,
        'semanas_equipe', v_eq_total,
        'alocacoes', jsonb_array_length(v_al_mover) + jsonb_array_length(v_al_cons) + jsonb_array_length(v_al_fut) + jsonb_array_length(v_al_hist),
        'custos', (select count(*) from funcionario_custos where funcionario_id = p_excluido))),
    'mantido', case when v_modo = 'unificacao' then jsonb_build_object(
      'id', v_mt.id, 'nome', v_mt.nome, 'ativo', v_mt.ativo, 'cadastro', v_mt.created_at,
      'ultima_atividade', greatest(
        (select max(data) from apontamentos_producao where funcionario_id = p_mantido),
        (select max(data) from escala_producao_alocacoes where funcionario_id = p_mantido),
        (select max(data) from ausencias_funcionarios where funcionario_id = p_mantido)),
      'vinculos', jsonb_build_object('apontamentos', (select count(*) from apontamentos_producao where funcionario_id = p_mantido),
        'semanas_equipe', (select count(*) from previsao_equipe_semana where funcionario_id = p_mantido),
        'ausencias', (select count(*) from ausencias_funcionarios where funcionario_id = p_mantido),
        'custos', (select count(*) from funcionario_custos where funcionario_id = p_mantido))) else null end,
    'transferir', jsonb_build_object(
      'apontamentos', case when v_modo = 'unificacao' then v_ap_n else 0 end,
      'ocorrencias', case when v_modo = 'unificacao' then v_oc_n else 0 end,
      'ausencias', cardinality(v_aus_mover),
      'semanas_equipe', jsonb_array_length(v_eq_mover),
      'alocacoes_passadas', jsonb_array_length(v_al_mover),
      'custos_copiados', jsonb_array_length(v_c_copiar)),
    'consolidar', jsonb_build_object(
      'ausencias_identicas', cardinality(v_aus_cons),
      'semanas_equipe', v_eq_conf,
      'alocacoes_passadas_mesmo_periodo', v_al_cons,
      'custos_duplicados', v_c_dup),
    'descartar', jsonb_build_object(
      'alocacoes_futuras', v_al_fut,
      'alocacoes_passadas', v_al_hist,
      'ausencias', case when v_modo = 'exclusao' then v_aus_total else 0 end,
      'semanas_equipe', case when v_modo = 'exclusao' then v_eq_total else 0 end,
      'custos', case when v_modo = 'exclusao' then v_c_rem else v_c_desc end),
    'impacto_escala', jsonb_build_object(
      'semanas_recalculadas', v_impacto,
      'alocacoes_futuras_removidas', jsonb_array_length(v_al_fut),
      'observacao', 'Períodos já iniciados não são alterados; a Escala recalcula só os períodos futuros das semanas listadas.'),
    'decisoes_custos', p_decisoes,
    'bloqueios', v_bloq, 'pendencias', v_pend, 'avisos', v_aviso)
    || case when v_modo = 'exclusao' then jsonb_build_object('remover', v_remover, 'impacto_indicadores', v_indic, 'conteudo_hash', v_hash) else '{}'::jsonb end;
  v_ass := md5(v_plano::text);
  v_plano := v_plano || jsonb_build_object('pode_executar', (jsonb_array_length(v_bloq) = 0 and jsonb_array_length(v_pend) = 0), 'assinatura', v_ass);

  if not p_executar then
    return v_plano;
  end if;

  -- =====================================================================
  -- EXECUÇÃO (tudo abaixo é uma única transação; qualquer RAISE desfaz tudo)
  -- =====================================================================
  if jsonb_array_length(v_bloq) > 0 then raise exception 'FUNC_BLOQUEADO: %', v_bloq::text; end if;
  if jsonb_array_length(v_pend) > 0 then raise exception 'FUNC_PENDENCIAS: %', v_pend::text; end if;
  if p_assinatura is distinct from v_ass then
    raise exception 'FUNC_ASSINATURA_DESATUALIZADA: os dados mudaram desde a simulação. Simule novamente.';
  end if;

  v_snap := jsonb_build_object(
    'funcionario', (select to_jsonb(f) from funcionarios f where f.id = p_excluido),
    'custos', coalesce((select jsonb_agg(to_jsonb(c)) from funcionario_custos c where c.funcionario_id = p_excluido), '[]'::jsonb));

  if v_modo = 'unificacao' then
    select count(*) as n, coalesce(sum(quantidade_produzida), 0) as prod, coalesce(sum(quantidade_refugo), 0) as ref
      into v_ap_antes from apontamentos_producao where funcionario_id in (p_excluido, p_mantido);

    -- custos a copiar
    insert into funcionario_custos (funcionario_id, descricao, valor)
    select p_mantido, x.descricao, x.valor from jsonb_to_recordset(v_c_copiar) as x(descricao text, valor numeric);
    v_movidos := v_movidos || jsonb_build_object('custos_copiados', v_c_copiar);

    -- equipe da semana: conflito => produtivo = OR; operação do mantido prevalece (se nula, a do excluído)
    update previsao_equipe_semana k
       set produtivo = (k.produtivo or e.produtivo), operacao_id = coalesce(k.operacao_id, e.operacao_id)
      from previsao_equipe_semana e
     where e.funcionario_id = p_excluido and k.funcionario_id = p_mantido and k.previsao_id = e.previsao_id;
    select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into v_ids from previsao_equipe_semana e
     where e.funcionario_id = p_excluido and exists (select 1 from previsao_equipe_semana k where k.previsao_id = e.previsao_id and k.funcionario_id = p_mantido);
    v_descartados := v_descartados || jsonb_build_object('equipe_semana_consolidada', v_ids);
    delete from previsao_equipe_semana e
     where e.funcionario_id = p_excluido and exists (select 1 from previsao_equipe_semana k where k.previsao_id = e.previsao_id and k.funcionario_id = p_mantido);
    update previsao_equipe_semana set funcionario_id = p_mantido where funcionario_id = p_excluido;
    v_movidos := v_movidos || jsonb_build_object('equipe_semana', v_eq_mover);

    -- Escala: passado consolidado/futuro derivado são removidos; passado sem conflito é transferido
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_ids from escala_producao_alocacoes a
     join (select * from jsonb_to_recordset(v_al_cons || v_al_fut) as z(data date, periodo_id text)) z on z.data = a.data and z.periodo_id = a.periodo_id
     where a.funcionario_id = p_excluido;
    v_descartados := v_descartados || jsonb_build_object('alocacoes_removidas', v_ids);
    delete from escala_producao_alocacoes a using jsonb_to_recordset(v_al_cons || v_al_fut) as z(data date, periodo_id text)
     where a.funcionario_id = p_excluido and a.data = z.data and a.periodo_id = z.periodo_id;
    update escala_producao_alocacoes a set funcionario_id = p_mantido
      from jsonb_to_recordset(v_al_mover) as z(data date, periodo_id text)
     where a.funcionario_id = p_excluido and a.data = z.data and a.periodo_id = z.periodo_id;
    v_movidos := v_movidos || jsonb_build_object('alocacoes_passadas', v_al_mover);

    -- ausências: duplicatas idênticas consolidadas; as demais transferidas (com histórico)
    select coalesce(jsonb_agg(jsonb_build_object('ausencia', to_jsonb(a),
             'historico', coalesce((select jsonb_agg(to_jsonb(h)) from ausencia_funcionario_historico h where h.ausencia_id = a.id), '[]'::jsonb))), '[]'::jsonb)
      into v_ids from ausencias_funcionarios a where a.id = any (v_aus_cons);
    v_descartados := v_descartados || jsonb_build_object('ausencias_consolidadas', v_ids);
    delete from ausencias_funcionarios where id = any (v_aus_cons);
    insert into ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, motivo)
    select a.id, to_jsonb(a), to_jsonb(a) || jsonb_build_object('funcionario_id', p_mantido), v_usuario,
           format('Unificação de funcionário: %s → %s', v_ex.nome, v_mt.nome)
      from ausencias_funcionarios a where a.id = any (v_aus_mover);
    update ausencias_funcionarios set funcionario_id = p_mantido where id = any (v_aus_mover);
    v_movidos := v_movidos || jsonb_build_object('ausencias', to_jsonb(v_aus_mover));

    -- apontamentos (com histórico) e ocorrências
    select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from apontamentos_producao where funcionario_id = p_excluido;
    v_movidos := v_movidos || jsonb_build_object('apontamentos', v_ids);
    insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo)
    select a.id, to_jsonb(a), to_jsonb(a) || jsonb_build_object('funcionario_id', p_mantido), v_usuario,
           format('Unificação de funcionário: %s → %s', v_ex.nome, v_mt.nome)
      from apontamentos_producao a where a.funcionario_id = p_excluido;
    update apontamentos_producao set funcionario_id = p_mantido where funcionario_id = p_excluido;
    select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from ocorrencias_maquina where funcionario_id = p_excluido;
    v_movidos := v_movidos || jsonb_build_object('ocorrencias', v_ids);
    update ocorrencias_maquina set funcionario_id = p_mantido where funcionario_id = p_excluido;
  else
    -- EXCLUSÃO SEM UNIFICAÇÃO: remove, em ordem, tudo que depende do cadastro (cada tabela é tratada de
    -- forma explícita e copiada integralmente para o log antes de ser apagada), depois o cadastro.
    v_descartados := v_descartados || jsonb_build_object(
      'apontamentos', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from apontamentos_producao a where a.id = any (v_ap_ids)),
      'apontamento_paradas', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from apontamento_paradas p where p.apontamento_id = any (v_ap_ids)),
      'apontamento_historico', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) from apontamento_producao_historico h where h.apontamento_id = any (v_ap_ids)),
      'ocorrencias', (select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from ocorrencias_maquina o where o.id = any (v_ocs)),
      'notificacoes_ocorrencia', (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from push_notificacoes_ocorrencia n where n.ocorrencia_id = any (v_ocs)),
      'alocacoes_removidas', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from escala_producao_alocacoes a where a.funcionario_id = p_excluido),
      'equipe_semana_removida', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from previsao_equipe_semana e where e.funcionario_id = p_excluido),
      'ausencias_removidas', (select coalesce(jsonb_agg(jsonb_build_object('ausencia', to_jsonb(a),
          'historico', coalesce((select jsonb_agg(to_jsonb(h)) from ausencia_funcionario_historico h where h.ausencia_id = a.id), '[]'::jsonb))), '[]'::jsonb)
        from ausencias_funcionarios a where a.funcionario_id = p_excluido));
    -- 1) apontamentos e o que depende deles
    delete from apontamento_producao_historico where apontamento_id = any (v_ap_ids);
    delete from apontamento_paradas where apontamento_id = any (v_ap_ids);
    delete from apontamentos_producao where id = any (v_ap_ids);
    -- 2) ocorrências de máquina do cadastro (as paradas de terceiros foram barradas na simulação)
    delete from push_notificacoes_ocorrencia where ocorrencia_id = any (v_ocs);
    delete from ocorrencias_maquina where id = any (v_ocs);
    -- 3) Escala (passado e futuro), equipe da semana e ausências (o histórico da ausência cai junto)
    delete from escala_producao_alocacoes where funcionario_id = p_excluido;
    delete from previsao_equipe_semana where funcionario_id = p_excluido;
    delete from ausencias_funcionarios where funcionario_id = p_excluido;
  end if;

  v_descartados := v_descartados || jsonb_build_object('custos', (v_snap -> 'custos'));
  delete from funcionario_custos where funcionario_id = p_excluido;

  -- a Escala recalcula os períodos futuros das semanas afetadas (determinístico e idempotente)
  for v_prev in
    select p.id from previsoes p
     where p.id = any (v_prev_afetadas) and exists (select 1 from escala_producao_dias d where d.previsao_id = p.id)
     order by p.id
  loop
    perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('origem', 'unificacao_funcionario'), v_usuario);
  end loop;

  -- conferência 1: totais de produção preservados (contagem, quantidade e refugo)
  if v_modo = 'unificacao' then
    select count(*) as n, coalesce(sum(quantidade_produzida), 0) as prod, coalesce(sum(quantidade_refugo), 0) as ref
      into v_ap_depois from apontamentos_producao where funcionario_id = p_mantido;
    if v_ap_depois.n <> v_ap_antes.n or v_ap_depois.prod <> v_ap_antes.prod or v_ap_depois.ref <> v_ap_antes.ref then
      raise exception 'FUNC_CONFERENCIA_APONTAMENTOS: totais de produção não conferem (antes % / % / %, depois % / % / %)',
        v_ap_antes.n, v_ap_antes.prod, v_ap_antes.ref, v_ap_depois.n, v_ap_depois.prod, v_ap_depois.ref;
    end if;
  end if;

  -- conferência 2: NENHUMA referência restante (qualquer tabela com FK para funcionarios, inclusive futuras)
  for r in
    select c.conrelid::regclass::text as tabela, a.attname as coluna
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.confrelid = 'public.funcionarios'::regclass and c.contype = 'f'
  loop
    execute format('select count(*) from %s where %I = $1', r.tabela, r.coluna) into v_n using p_excluido;
    if v_n > 0 then
      raise exception 'FUNC_REFERENCIAS_RESIDUAIS: % ainda tem % registro(s) apontando para o funcionário', r.tabela, v_n;
    end if;
  end loop;

  insert into funcionarios_exclusoes_log (executado_por, modo, funcionario_excluido_id, funcionario_mantido_id, snapshot, plano, movidos, descartados)
  values (v_usuario, case when v_modo = 'exclusao' then 'exclusao_sem_unificacao' else v_modo end, p_excluido, p_mantido, v_snap, v_plano, v_movidos, v_descartados)
  returning id into v_log;

  delete from funcionarios where id = p_excluido;

  return jsonb_build_object('ok', true, 'modo', v_modo, 'log_id', v_log, 'plano', v_plano);
end;
$$;

-- =========================================================================
-- ROLLBACK (manual, só se necessário; recria as funções anteriores a partir das migrations 20261005100000/20261005110000/20261021110000):
--   drop function public.abrir_atraso_funcionario(uuid, date, time, text, uuid); drop function public.encerrar_atraso_funcionario(uuid, time);
--   drop function public.corrigir_inicio_atraso_aberto(uuid, time, text); drop function public.fechar_atrasos_vencidos(); drop function public._fechar_atrasos_vencidos(timestamptz);
--   drop index public.uq_ausencia_atraso_aberto; (colunas/constraints novas podem ficar: são inertes)
-- =========================================================================

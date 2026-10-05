-- Sittech — schema PostgreSQL, migration 37
-- "Faltas e Ausências" V1 — ferramenta operacional da supervisão de
-- produção pra registrar falta/atraso/saída antecipada/saída durante
-- expediente/atestado/falta justificada/falta não justificada/outro de um
-- funcionário, com cálculo automático de horas perdidas. NÃO é folha-ponto
-- nem RH — não há feriado, escala, calendário de dias úteis nem integração
-- de pagamento aqui (decisão explícita).
--
-- Jornada (decisão explícita pra V1): padrão global, igual pra todo
-- funcionário operacional — soma dos períodos já cadastrados (hoje
-- 07:12–12:00 + 13:00–17:00 = 8h48), reaproveitando a MESMA lógica de
-- `calcularHorasPorDia`/soma-de-duração-por-período já usada em Custo por
-- Hora/Capacidade (src/lib/calculations/periodos.ts) — o intervalo entre
-- períodos (ex.: 12:00–13:00) já fica de fora da soma automaticamente, sem
-- precisar de um conceito separado de "almoço". Sem jornada individual por
-- funcionário nesta V1 (evolução futura, se houver meio período/turno
-- diferente).
--
-- Snapshot: `periodos_snapshot` (jsonb) é capturado UMA VEZ, na criação da
-- linha — nunca re-sincronizado depois, nem em edição. Isso garante que se
-- os horários de `periodos` mudarem no futuro, uma ausência de setembro
-- continua com os horários de setembro, não recalcula sozinha. A duração
-- em si (`duracao_minutos`) é calculada no FRONTEND (mesmo modelo de
-- confiança já usado pra quantidade_produzida em
-- registrar_apontamento_producao — a RPC não recalcula, só valida e
-- snapshota o contexto) e enviada já pronta; a RPC apenas valida que é
-- >= 0 e fecha o snapshot dos períodos vigentes no momento do lançamento.
--
-- Auditoria: `ausencia_funcionario_historico` é uma cópia estrutural de
-- `apontamento_producao_historico` (dados_anteriores/dados_novos jsonb,
-- alterado_por, alterado_em, motivo obrigatório) — mesmo mecanismo,
-- nenhuma arquitetura nova. Só populada em EDIÇÃO (nunca na criação —
-- não existe "antes" pra uma linha nova). Funcionário e data NÃO são
-- editáveis nesta V1 (mesma regra já aplicada a máquina/data/período em
-- apontamentos_producao) — ver riscos no relatório final.
--
-- Permissão: uma única chave nova, `ausencias_funcionarios`, cobrindo
-- criar+visualizar+editar junto (pedido explícito pra não multiplicar
-- permissões). Admin sempre passa via is_admin(), sem precisar de linha
-- em usuario_permissoes. Mesmo padrão de enforcement de
-- apontamentos_producao: RLS de INSERT/UPDATE só exige usuário ativo (a
-- permissão de verdade é checada DENTRO das RPCs, único caminho de
-- escrita usado pelo app); SELECT já é restrito à permissão na própria
-- RLS, sem precisar de RPC pra leitura.

-- =========================================================================
-- 1) Permissão nova no catálogo existente (CHECK de usuario_permissoes)
-- =========================================================================
alter table public.usuario_permissoes
  drop constraint usuario_permissoes_permissao_check;

alter table public.usuario_permissoes
  add constraint usuario_permissoes_permissao_check check (permissao in (
    'financeiro', 'produtos', 'maquinas', 'funcionarios', 'custo_hora',
    'previsao', 'capacidade',
    'producao_real_apontamento', 'producao_real_historico', 'producao_real_ocorrencias',
    'producao_real_apontamentos_realizados',
    'usuarios', 'auditoria',
    'ausencias_funcionarios'
  ));

-- =========================================================================
-- 2) ausencias_funcionarios
-- =========================================================================
create table public.ausencias_funcionarios (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete restrict,
  data date not null,
  tipo text not null check (tipo in (
    'falta_dia_inteiro', 'atraso', 'saida_antecipada', 'saida_durante_expediente',
    'atestado', 'falta_justificada', 'falta_nao_justificada', 'outro'
  )),

  -- Janela de horário usada no cálculo — significado varia por tipo:
  --   atraso: horario_inicio = início da jornada (snapshot), horario_fim = chegada real
  --   saida_antecipada: horario_inicio = saída real, horario_fim = fim da jornada (snapshot)
  --   saida_durante_expediente: horario_inicio = saída real, horario_fim = retorno real
  --   demais tipos (dia inteiro): ambos null — duração vem da jornada inteira do snapshot
  horario_inicio time,
  horario_fim time,

  duracao_minutos integer not null,
  periodos_snapshot jsonb not null,

  observacao text,
  idempotency_key uuid not null default gen_random_uuid(),

  criado_por uuid not null references public.usuarios(id) on delete restrict,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  check (duracao_minutos >= 0),
  check (horario_inicio is null or horario_fim is null or horario_fim > horario_inicio),
  unique (idempotency_key)
);

create index idx_ausencias_funcionarios_funcionario_data on public.ausencias_funcionarios(funcionario_id, data);
create index idx_ausencias_funcionarios_data on public.ausencias_funcionarios(data);
create index idx_ausencias_funcionarios_tipo on public.ausencias_funcionarios(tipo);
create index idx_ausencias_funcionarios_criado_por on public.ausencias_funcionarios(criado_por);

create trigger trg_ausencias_funcionarios_atualizado_em before update on public.ausencias_funcionarios
  for each row execute function public.set_atualizado_em();

-- =========================================================================
-- 3) ausencia_funcionario_historico — auditoria, mesmo padrão de
--    apontamento_producao_historico. Só populada em edição.
-- =========================================================================
create table public.ausencia_funcionario_historico (
  id uuid primary key default gen_random_uuid(),
  ausencia_id uuid not null references public.ausencias_funcionarios(id) on delete cascade,
  dados_anteriores jsonb not null,
  dados_novos jsonb not null,
  alterado_por uuid not null references public.usuarios(id) on delete restrict,
  alterado_em timestamptz not null default now(),
  motivo text not null check (length(trim(motivo)) > 0)
);
create index idx_ausencia_funcionario_historico_ausencia on public.ausencia_funcionario_historico(ausencia_id);

-- =========================================================================
-- 4) RLS
-- =========================================================================
alter table public.ausencias_funcionarios enable row level security;
alter table public.ausencia_funcionario_historico enable row level security;

create policy ausencias_funcionarios_select on public.ausencias_funcionarios
  for select to authenticated
  using (public.is_admin() or public.has_permissao('ausencias_funcionarios'));

create policy ausencias_funcionarios_insert on public.ausencias_funcionarios
  for insert to authenticated
  with check (public.is_usuario_ativo());

create policy ausencias_funcionarios_update on public.ausencias_funcionarios
  for update to authenticated
  using (public.is_usuario_ativo())
  with check (public.is_usuario_ativo());

grant select, insert, update on public.ausencias_funcionarios to authenticated;

create policy ausencia_funcionario_historico_select on public.ausencia_funcionario_historico
  for select to authenticated
  using (public.is_admin() or public.has_permissao('ausencias_funcionarios'));

create policy ausencia_funcionario_historico_insert on public.ausencia_funcionario_historico
  for insert to authenticated
  with check (public.is_usuario_ativo());

grant select, insert on public.ausencia_funcionario_historico to authenticated;

-- =========================================================================
-- 5) registrar_ausencia_funcionario — cria (ou devolve, se a mesma
--    idempotency_key já existir — mesmo padrão de
--    registrar_apontamento_producao).
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

  -- `funcionarios` tem RLS restrita à permissão 'funcionarios'/'custo_hora'
  -- (migration 16) — uma supervisora com só 'ausencias_funcionarios' não
  -- enxergaria a tabela. Mesmo contorno já usado pelo resto do app:
  -- `funcionarios_elegibilidade` (id/nome/ativo, sem dado sensível, sem
  -- exigir permissão de módulo).
  if not exists (select 1 from public.funcionarios_elegibilidade where id = p_funcionario_id and ativo = true) then
    raise exception 'Funcionário não encontrado ou inativo';
  end if;

  -- idempotência: mesma tentativa reenviada (retry) devolve a linha já criada
  select * into v_ausencia from public.ausencias_funcionarios where idempotency_key = p_idempotency_key;
  if found then
    return v_ausencia;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', inicio, 'fim', fim) order by inicio), '[]'::jsonb)
    into v_periodos_snapshot
  from public.periodos;

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

-- =========================================================================
-- 6) editar_ausencia_funcionario — corrige um lançamento errado (tipo,
--    horários, duração, observação). Funcionário/data NÃO mudam nesta V1.
--    Motivo obrigatório; grava antes/depois em
--    ausencia_funcionario_historico. periodos_snapshot NUNCA é tocado —
--    continua o mesmo capturado na criação.
-- =========================================================================
create or replace function public.editar_ausencia_funcionario(
  p_ausencia_id uuid,
  p_tipo text,
  p_horario_inicio time,
  p_horario_fim time,
  p_duracao_minutos integer,
  p_observacao text,
  p_motivo text
)
returns public.ausencias_funcionarios
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_antes public.ausencias_funcionarios;
  v_depois public.ausencias_funcionarios;
begin
  select id into v_usuario_id from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  if not (public.is_admin() or public.has_permissao('ausencias_funcionarios')) then
    raise exception 'Usuário não tem permissão para editar ausências';
  end if;

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Motivo da alteração é obrigatório';
  end if;

  select * into v_antes from public.ausencias_funcionarios where id = p_ausencia_id;
  if not found then
    raise exception 'Ausência % não encontrada', p_ausencia_id;
  end if;

  update public.ausencias_funcionarios set
    tipo = p_tipo,
    horario_inicio = p_horario_inicio,
    horario_fim = p_horario_fim,
    duracao_minutos = p_duracao_minutos,
    observacao = p_observacao
  where id = p_ausencia_id
  returning * into v_depois;

  insert into public.ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, motivo)
  values (p_ausencia_id, to_jsonb(v_antes), to_jsonb(v_depois), v_usuario_id, p_motivo);

  return v_depois;
end;
$$;

revoke all on function public.editar_ausencia_funcionario(uuid, text, time, time, integer, text, text) from public, anon;
grant execute on function public.editar_ausencia_funcionario(uuid, text, time, time, integer, text, text) to authenticated;

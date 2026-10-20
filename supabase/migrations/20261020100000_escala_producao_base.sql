-- Sittech — Escala de Produção, V1: schema base.
--
-- A Escala distribui os funcionários produtivos da semana entre os postos
-- (máquinas) selecionados na Previsão, período a período (M1..T3). Este
-- arquivo só cria as tabelas, restrições e RLS; as regras (motor) vivem em
-- TypeScript puro (src/features/escala) e as gravações passam por RPCs.
--
-- 1) escala_producao_dias: um registro por DATA da escala (cabeçalho). Guarda
--    os horários dos períodos como eram quando o dia foi gerado
--    (periodos_snapshot — períodos são editáveis em Custo por Hora) e uma
--    `versao` que serve de controle otimista de concorrência e de sinal de
--    "a escala mudou" para a TV.
-- 2) escala_producao_alocacoes: UMA LINHA POR FUNCIONÁRIO E PERÍODO
--    (funcionário disponível naquele período). maquina_id nulo só quando
--    não existe posto válido, e então motivo_sem_posto é obrigatório.
--    `pecas` é SNAPSHOT do crédito planejado do período (alterar metas
--    depois não recalcula alocações já gravadas). Identidade lógica da
--    demanda: (produto_id, etapa_id) — nunca previsao_itens.id, que é
--    recriado a cada save da Previsão.
-- 3) escala_recurso_indisponivel: indisponibilidade de máquina/posto "a
--    partir de agora, até liberar manualmente" (sem horário final).
-- 4) escala_producao_eventos: histórico do módulo E outbox de eventos
--    (ausência, Previsão, bloqueio/liberação, geração manual) a processar
--    no servidor.
--
-- Escrita: nenhuma policy/grant de escrita para `authenticated` — tudo por
-- RPC (security definer com checagem de permissão) ou service_role.

-- =========================================================================
-- 1) escala_producao_dias
-- =========================================================================
create table public.escala_producao_dias (
  data date primary key,
  previsao_id uuid not null references public.previsoes(id) on delete cascade,
  periodos_snapshot jsonb not null,
  versao integer not null default 0 check (versao >= 0),
  gerada_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuarios(id) on delete set null,
  check (jsonb_typeof(periodos_snapshot) = 'array' and jsonb_array_length(periodos_snapshot) > 0)
);
create index idx_escala_dias_previsao on public.escala_producao_dias(previsao_id);

-- =========================================================================
-- 2) escala_producao_alocacoes
-- =========================================================================
create table public.escala_producao_alocacoes (
  data date not null references public.escala_producao_dias(data) on delete cascade,
  periodo_id text not null references public.periodos(id) on delete restrict,
  funcionario_id uuid not null references public.funcionarios(id) on delete restrict,
  maquina_id uuid references public.maquinas(id) on delete restrict,
  produto_id uuid references public.produtos(id) on delete restrict,
  etapa_id uuid references public.roteiro_etapas(id) on delete restrict,
  operacao_id uuid references public.operacoes(id) on delete restrict,
  pecas numeric not null default 0 check (pecas >= 0),
  origem text not null default 'auto' check (origem in ('auto', 'manual')),
  excecao_revezamento boolean not null default false,
  motivo_excecao text,
  motivo_sem_posto text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (data, periodo_id, funcionario_id),
  -- ou tem posto completo, ou não tem posto e DIZ por quê
  check (
    (maquina_id is not null and produto_id is not null and etapa_id is not null and operacao_id is not null and motivo_sem_posto is null)
    or
    (maquina_id is null and produto_id is null and etapa_id is null and operacao_id is null and pecas = 0
       and motivo_sem_posto is not null and length(trim(motivo_sem_posto)) > 0)
  ),
  check (not excecao_revezamento or (motivo_excecao is not null and length(trim(motivo_excecao)) > 0))
);
-- 1 operador por máquina no mesmo período (nunca 2 simultâneos)
create unique index uq_escala_alocacao_maquina_periodo
  on public.escala_producao_alocacoes(data, periodo_id, maquina_id)
  where maquina_id is not null;
create index idx_escala_alocacao_maquina on public.escala_producao_alocacoes(maquina_id) where maquina_id is not null;
create index idx_escala_alocacao_funcionario on public.escala_producao_alocacoes(funcionario_id);
create trigger trg_escala_alocacoes_atualizado_em before update on public.escala_producao_alocacoes
  for each row execute function public.set_atualizado_em();

-- =========================================================================
-- 3) escala_recurso_indisponivel
-- =========================================================================
create table public.escala_recurso_indisponivel (
  id uuid primary key default gen_random_uuid(),
  maquina_id uuid not null references public.maquinas(id) on delete restrict,
  motivo text not null check (motivo in ('setup', 'manutencao', 'falta_material', 'problema_operacional', 'outros')),
  observacao text,
  desde timestamptz not null default now(),
  liberada_em timestamptz,
  criado_por uuid references public.usuarios(id) on delete set null,
  liberado_por uuid references public.usuarios(id) on delete set null,
  check (liberada_em is null or liberada_em >= desde)
);
-- no máximo uma indisponibilidade ABERTA por máquina
create unique index uq_escala_recurso_indisponivel_aberta
  on public.escala_recurso_indisponivel(maquina_id) where liberada_em is null;
create index idx_escala_recurso_indisponivel_maquina on public.escala_recurso_indisponivel(maquina_id);

-- =========================================================================
-- 4) escala_producao_eventos (histórico + outbox)
-- =========================================================================
create table public.escala_producao_eventos (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  tipo text not null check (tipo in (
    'ausencia', 'previsao', 'recurso_bloqueado', 'recurso_liberado', 'geracao_manual',  -- outbox: pedem recálculo
    'recalculo', 'edicao_manual'                                                          -- histórico: registro do que foi feito
  )),
  previsao_id uuid references public.previsoes(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  usuario_id uuid references public.usuarios(id) on delete set null,
  status text not null default 'pendente' check (status in ('pendente', 'processando', 'processado', 'ignorado', 'erro')),
  tentativas integer not null default 0,
  iniciado_em timestamptz,
  processado_em timestamptz,
  erro text
);
create index idx_escala_eventos_status on public.escala_producao_eventos(status, criado_em);
create index idx_escala_eventos_previsao on public.escala_producao_eventos(previsao_id);

-- =========================================================================
-- RLS: leitura por permissão; escrita só por RPC/service_role
-- =========================================================================
alter table public.escala_producao_dias enable row level security;
alter table public.escala_producao_alocacoes enable row level security;
alter table public.escala_recurso_indisponivel enable row level security;
alter table public.escala_producao_eventos enable row level security;

create policy escala_dias_select on public.escala_producao_dias
  for select to authenticated
  using (public.is_admin() or public.has_permissao('escala_producao') or public.has_permissao('escala_producao_tv'));

create policy escala_alocacoes_select on public.escala_producao_alocacoes
  for select to authenticated
  using (public.is_admin() or public.has_permissao('escala_producao'));

create policy escala_recurso_indisponivel_select on public.escala_recurso_indisponivel
  for select to authenticated
  using (public.is_admin() or public.has_permissao('escala_producao'));

create policy escala_eventos_select on public.escala_producao_eventos
  for select to authenticated
  using (public.is_admin() or public.has_permissao('escala_producao'));

grant select on public.escala_producao_dias to authenticated;
grant select on public.escala_producao_alocacoes to authenticated;
grant select on public.escala_recurso_indisponivel to authenticated;
grant select on public.escala_producao_eventos to authenticated;

-- service_role (processador server-side do Next/Vercel)
grant select, insert, update, delete on public.escala_producao_dias to service_role;
grant select, insert, update, delete on public.escala_producao_alocacoes to service_role;
grant select, insert, update, delete on public.escala_recurso_indisponivel to service_role;
grant select, insert, update, delete on public.escala_producao_eventos to service_role;

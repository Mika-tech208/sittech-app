-- Sittech — schema PostgreSQL, migration 2
-- Corrige uma lacuna identificada na análise de migração de dados: o blob
-- atual (`SittechState`) tem dois campos globais — `diasUteis` e
-- `diasUteisSemana` — sem nenhuma tabela de destino na migration inicial
-- (20260901192023_initial_schema.sql). Esta migration só adiciona a tabela
-- pra esses dois valores. Não é um sistema chave/valor genérico — são
-- colunas nomeadas, exatamente os dois campos que existem hoje.
--
-- Reaproveita a função `set_updated_at()` já criada na migration inicial —
-- não redefinida aqui, e a migration inicial não foi tocada.
--
-- `usuarios` NÃO é parte desta migration: por decisão explícita, os
-- usuários antigos (login/senhaHash/senhaSalt) não serão migrados — contas
-- serão recriadas via Supabase Auth futuramente. A tabela `usuarios` já
-- existe desde a migration inicial e não muda aqui.

create table configuracoes_empresa (
  id uuid primary key default gen_random_uuid(),
  dias_uteis numeric not null,
  dias_uteis_semana numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_configuracoes_empresa_updated_at before update on configuracoes_empresa
  for each row execute function set_updated_at();

-- 20261117100000_execucao_real_periodo
-- REGULARIZAÇÃO OPERACIONAL DO PERÍODO ATUAL: registra a EXECUÇÃO REAL de um período (postos que realmente trabalharam) QUANDO ela diverge do plano oficial, SEM tocar o plano.
--   PLANO ORIGINAL  = escala_producao_alocacoes (inalterada; é o histórico do que o sistema planejou → base para medir aderência à escala)
--   EXECUÇÃO REAL   = esta tabela (uma linha por máquina que realmente trabalhou no período, informada por quem tem autoridade — origem AJUSTE_OPERACIONAL)
-- Efeito (só no TS): o fechamento do período mostra/pede exatamente estes postos pré-preenchidos (planejado × real preservado pelo apontamento_planejado_real) e NÃO exige os postos do plano que
-- não aconteceram. NÃO altera liberação (escala_periodo_liberacao), escala_liberacao_desde, plano, TV nem WIP. Período sem linhas aqui = comportamento de hoje (idêntico).
-- ROLLBACK: supabase/rollbacks/20261117100000_execucao_real_periodo_ROLLBACK.sql
begin;
create table if not exists public.escala_execucao_real_periodo (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  periodo_id text not null references public.periodos(id),
  maquina_id uuid not null references public.maquinas(id),
  funcionario_id uuid not null references public.funcionarios(id),
  produto_id uuid not null references public.produtos(id),
  etapa_id uuid references public.roteiro_etapas(id),
  operacao_id uuid references public.operacoes(id),
  origem text not null default 'AJUSTE_OPERACIONAL' check (origem = 'AJUSTE_OPERACIONAL'),
  registrado_por text not null,
  registrado_em timestamptz not null default now(),
  observacao text,
  unique (data, periodo_id, maquina_id)
);
create index if not exists escala_execucao_real_periodo_idx on public.escala_execucao_real_periodo (data, periodo_id);
alter table public.escala_execucao_real_periodo enable row level security;     -- sem policy: só service_role (as rotas do servidor)
revoke all on public.escala_execucao_real_periodo from public, anon, authenticated;
grant select, insert, delete on public.escala_execucao_real_periodo to service_role;
comment on table public.escala_execucao_real_periodo is 'Execução REAL do período quando diverge do plano oficial (AJUSTE_OPERACIONAL). O plano original permanece em escala_producao_alocacoes.';
notify pgrst, 'reload schema';
commit;

-- Sittech — schema PostgreSQL, migration 3
-- Policies de RLS. Frontend ainda NÃO foi conectado ao Supabase — esta
-- migration só prepara o banco. Nenhum dado existente é alterado (só
-- CREATE FUNCTION / CREATE POLICY).
--
-- Revisão do comportamento atual (src/features/legacy/SittechApp.tsx,
-- src/hooks/useAuthSession.ts, src/components/shell/*) antes de escrever
-- isto:
--   * Nenhuma tela operacional (Custos, Funcionários, Produtos, Máquinas,
--     Previsão, Capacidade, Faturamento, Custo por Hora) distingue por
--     `papel` — todo usuário ativo autenticado tem CRUD completo. Só a aba
--     "Usuários" é bloqueada pra quem não é admin (Sidebar.tsx:104,
--     SittechApp.tsx:2224/2230 — "Essa área é só para administradores").
--   * Não existe exclusão de usuário no app (sem `deleteUsuario` em lugar
--     nenhum) — só criação, edição (nome/login/papel) e toggle de
--     ativo/inativo, tudo restrito a admin. Por isso não há policy de
--     DELETE em `usuarios` — sem policy = negado por padrão sob RLS.
--   * `registrarAuditoria` (useAuthSession.ts) é chamado por QUALQUER
--     usuário ativo, não só admin, pra registrar as próprias ações — por
--     isso `auditoria` tem INSERT liberado pra qualquer usuário ativo
--     (decisão confirmada), SELECT restrito a admin, e nenhuma policy de
--     UPDATE/DELETE (log é append-only).

-- =========================================================================
-- Funções auxiliares — SECURITY DEFINER pra não recursar em RLS ao
-- consultar a própria tabela `usuarios` (uma policy que chamasse uma
-- função SECURITY INVOKER cairia de novo nas policies de `usuarios`,
-- inclusive a que está sendo avaliada). Rodam como o dono da função
-- (owner da migration), que não está sujeito a RLS por padrão — não
-- marcamos `FORCE ROW LEVEL SECURITY` em nenhuma tabela, então isso já
-- basta, sem precisar de nenhum outro ajuste de privilégio.
-- `search_path` fixo pra evitar sequestro de função por schema hostil.
-- =========================================================================

create or replace function public.is_usuario_ativo()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.ativo = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.ativo = true and u.papel = 'admin'
  );
$$;

-- =========================================================================
-- Tabelas operacionais/financeiras/cadastros (18 tabelas) — usuário ativo
-- autenticado tem SELECT/INSERT/UPDATE/DELETE completo, preservando o
-- comportamento atual (nenhuma distinção por papel nessas telas). Uma
-- policy `for all` por tabela em vez de 4 policies repetidas.
-- Nenhuma policy é criada para `anon` — sem policy = acesso negado por
-- padrão sob RLS, então anon não enxerga nem escreve nada em lugar nenhum.
-- =========================================================================

create policy usuario_ativo_full_access on public.categorias
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.operacoes
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.configuracoes_empresa
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.fixed_costs
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.variable_entries
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.funcionarios
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.funcionario_custos
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.periodos
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.maquinas
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.produtos
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.roteiro_etapas
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.roteiro_etapa_maquinas
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.faturamentos
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.receitas
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.previsoes
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.previsao_maquinas_indisponiveis
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.previsao_itens
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.previsao_item_maquinas
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

-- =========================================================================
-- usuarios
--   * SELECT: o próprio perfil (se ativo) sempre; admin vê todos os
--     usuários, inclusive inativos (precisa, pra poder reativar alguém).
--   * INSERT: só admin.
--   * UPDATE: só admin — não existe hoje nenhuma forma de um usuário comum
--     editar a própria linha (a troca de senha nem é mais um campo desta
--     tabela, fica 100% em auth.users via Supabase Auth). Isso também
--     impede de raiz um usuário comum se autopromover a admin.
--   * Sem policy de DELETE — o app não tem exclusão de usuário hoje.
-- =========================================================================

create policy usuarios_select_self_or_admin on public.usuarios
  for select to authenticated
  using ((auth_user_id = auth.uid() and public.is_usuario_ativo()) or public.is_admin());

create policy usuarios_insert_admin_only on public.usuarios
  for insert to authenticated
  with check (public.is_admin());

create policy usuarios_update_admin_only on public.usuarios
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================================
-- auditoria
--   * SELECT: só admin.
--   * INSERT: qualquer usuário autenticado e ativo — preserva o
--     comportamento atual (registrarAuditoria em useAuthSession.ts é
--     chamado por qualquer usuário ativo, não só admin). A checagem é só
--     `is_usuario_ativo()` — NÃO confiamos em `usuario_afetado` (texto
--     livre/histórico) pra autorização, ele não entra na policy.
--   * Sem policy de UPDATE nem DELETE — log de auditoria é append-only.
-- =========================================================================

create policy auditoria_select_admin_only on public.auditoria
  for select to authenticated
  using (public.is_admin());

create policy auditoria_insert_usuario_ativo on public.auditoria
  for insert to authenticated
  with check (public.is_usuario_ativo());

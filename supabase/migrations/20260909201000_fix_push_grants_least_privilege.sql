-- Sittech — Notificações Push V1: correção de least privilege nos grants
-- de push_subscriptions/push_notificacoes_ocorrencia (migration
-- 20260909200000_push_subscriptions.sql).
--
-- Causa: toda tabela nova em `public` nasce, por padrão de plataforma do
-- Supabase (auto_expose_new_tables — ver supabase/config.toml, "reachable
-- through the Data API roles ... without explicit GRANTs, matching the
-- cloud default"), com REFERENCES/TRIGGER/TRUNCATE já concedidos a
-- anon/authenticated/service_role, sem nenhum GRANT explícito nosso. A
-- migration original nunca fez um `revoke all` prévio, então esse
-- baseline de plataforma ficou por baixo dos grants explícitos — validado
-- em DEV via catálogo (pg_policies/information_schema.role_table_grants):
-- anon acabou com REFERENCES/TRIGGER/TRUNCATE em push_subscriptions
-- (nunca teve SELECT/INSERT/UPDATE/DELETE — RLS nunca foi contornada,
-- só o grant estava mais largo que o pretendido), e authenticated/
-- service_role tinham esses 3 verbos a mais além dos 4 pretendidos.
--
-- Esta migration só ajusta os GRANTs (revoke all + grant mínimo
-- explícito) das 2 tabelas. Não toca em RLS, policies, dados, na função
-- reivindicar_notificacao_ocorrencia, trigger, endpoint, Vault ou PROD.

-- =========================================================================
-- 1) push_subscriptions
-- =========================================================================
revoke all on public.push_subscriptions from public, anon, authenticated, service_role;

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- =========================================================================
-- 2) push_notificacoes_ocorrencia — nunca acessada pelo browser (zero
--    privilégio pra anon/authenticated, igual já era a intenção original).
-- =========================================================================
revoke all on public.push_notificacoes_ocorrencia from public, anon, authenticated, service_role;

grant select, insert, update, delete on public.push_notificacoes_ocorrencia to service_role;

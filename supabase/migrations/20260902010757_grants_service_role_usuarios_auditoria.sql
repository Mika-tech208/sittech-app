-- Sittech — schema PostgreSQL, migration 6
-- GRANT de tabela pra `service_role` em usuarios/auditoria — faltava desde
-- a migration 4 (que só cobriu `authenticated`). Descoberto ao implementar
-- a etapa "Usuários + Auditoria": as rotas server-side
-- (src/app/api/admin/usuarios/**), que usam a service_role key pra criar
-- usuário e redefinir senha de outro usuário via Supabase Auth Admin API,
-- também precisam ler/gravar public.usuarios/public.auditoria via
-- PostgREST — e isso falha com 403 mesmo pra service_role sem o GRANT de
-- tabela (mesma causa raiz documentada na migration 4: RLS restringe
-- linhas, mas o privilégio de tabela é exigido antes, independente de RLS
-- — e service_role, apesar de ter bypassrls, não é isento de GRANT).
--
-- Não altera nenhuma policy nem tabela — só GRANT, espelhando exatamente
-- os mesmos privilégios já concedidos a `authenticated` nessas duas
-- tabelas (sem DELETE em nenhuma das duas, mesmo comportamento atual).

grant select, insert, update on public.usuarios to service_role;
grant select, insert on public.auditoria to service_role;

-- Sittech — schema PostgreSQL, migration 17
-- Corrige um bug real encontrado ao testar a criação de usuário com
-- permissões: o Route Handler de criação (/api/admin/usuarios) usa o
-- client service_role (precisa da Auth Admin API pra criar o auth.users),
-- e esse client recebeu "permission denied for table usuario_permissoes"
-- ao tentar inserir as permissões do novo usuário — a migration anterior
-- (20260902190000) só concedeu GRANT a `authenticated`, esquecendo
-- `service_role`, diferente do padrão já usado em `usuarios`/`auditoria`
-- (que concedem às duas roles, exatamente por serem tocadas por rotas
-- admin). RLS não muda em nada — só a concessão de privilégio de tabela
-- que faltava.

grant select, insert, update, delete on public.usuario_permissoes to service_role;

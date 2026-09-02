-- Sittech — schema PostgreSQL, migration 4
-- Corrige os privilégios de tabela (GRANT) que faltavam pra RLS (migration
-- 3) funcionar de verdade via PostgREST. RLS restringe LINHAS, mas exige
-- que o papel já tenha o privilégio de tabela correspondente (SELECT/
-- INSERT/UPDATE/DELETE) — sem isso, o Postgres nega no nível de GRANT
-- antes mesmo de avaliar as policies (é exatamente o que os testes com o
-- usuário admin real mostraram: 403 em toda SELECT).
--
-- Não altera nenhuma policy, nenhuma tabela, nenhum dado — só GRANT/REVOKE.
--
-- Checagem feita antes de escrever isto (via has_schema_privilege /
-- has_function_privilege, não alterado por esta migration):
--   * `authenticated` e `anon` já têm USAGE no schema public (grant padrão
--     do projeto Supabase) — não precisa conceder de novo.
--   * EXECUTE nas funções is_usuario_ativo()/is_admin() estava concedido a
--     PUBLIC (o que inclui anon) — restringido abaixo só pra authenticated,
--     por ser desnecessário pra anon (mesmo não vazando dado, já que as
--     funções só retornam boolean).
--
-- Privilégios espelham exatamente as policies da migration 3:
--   * 18 tabelas operacionais: full CRUD (policy `for all`) -> SELECT,
--     INSERT, UPDATE, DELETE.
--   * usuarios: policies de select/insert/update, sem delete -> SELECT,
--     INSERT, UPDATE (sem DELETE).
--   * auditoria: policies de select/insert, sem update/delete -> SELECT,
--     INSERT (sem UPDATE, sem DELETE).
-- Nada é concedido a `anon` nesta migration.

grant select, insert, update, delete on public.categorias to authenticated;
grant select, insert, update, delete on public.operacoes to authenticated;
grant select, insert, update, delete on public.configuracoes_empresa to authenticated;
grant select, insert, update, delete on public.fixed_costs to authenticated;
grant select, insert, update, delete on public.variable_entries to authenticated;
grant select, insert, update, delete on public.funcionarios to authenticated;
grant select, insert, update, delete on public.funcionario_custos to authenticated;
grant select, insert, update, delete on public.periodos to authenticated;
grant select, insert, update, delete on public.maquinas to authenticated;
grant select, insert, update, delete on public.produtos to authenticated;
grant select, insert, update, delete on public.roteiro_etapas to authenticated;
grant select, insert, update, delete on public.roteiro_etapa_maquinas to authenticated;
grant select, insert, update, delete on public.faturamentos to authenticated;
grant select, insert, update, delete on public.receitas to authenticated;
grant select, insert, update, delete on public.previsoes to authenticated;
grant select, insert, update, delete on public.previsao_maquinas_indisponiveis to authenticated;
grant select, insert, update, delete on public.previsao_itens to authenticated;
grant select, insert, update, delete on public.previsao_item_maquinas to authenticated;

grant select, insert, update on public.usuarios to authenticated;

grant select, insert on public.auditoria to authenticated;

-- EXECUTE das funções auxiliares — restringe de PUBLIC (que incluía anon)
-- pra só authenticated.
revoke execute on function public.is_usuario_ativo() from public;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_usuario_ativo() to authenticated;
grant execute on function public.is_admin() to authenticated;

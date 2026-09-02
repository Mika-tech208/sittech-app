-- TEMPORÁRIO — só pra diagnosticar por que um usuário comum ativo está
-- recebendo RLS violation ao inserir em auditoria mesmo com
-- is_usuario_ativo() = true. Será revertida por uma migration seguinte
-- assim que o diagnóstico terminar.
create or replace function public.debug_tmp_list_policies(p_table text)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'policyname', policyname, 'permissive', permissive, 'roles', roles,
    'cmd', cmd, 'qual', qual, 'with_check', with_check
  )), '[]'::jsonb)
  from pg_policies where tablename = p_table and schemaname = 'public';
$$;
grant execute on function public.debug_tmp_list_policies(text) to authenticated;

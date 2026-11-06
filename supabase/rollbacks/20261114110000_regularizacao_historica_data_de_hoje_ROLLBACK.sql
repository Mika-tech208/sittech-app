begin;
create or replace function public.regularizacao_exigir(p_data date) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  select id into v_user from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_user is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;
  if not (public.is_admin() or public.has_permissao('escala_fechamento_excecao')) then
    raise exception 'REGULARIZACAO_SEM_PERMISSAO: a regularização histórica é restrita a administradores/perfil superior';
  end if;
  if p_data is null or p_data >= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'REGULARIZACAO_DATA_INVALIDA: só é possível regularizar datas anteriores a hoje';
  end if;
  if not exists (select 1 from regularizacao_historica_datas where data = p_data) then
    raise exception 'REGULARIZACAO_DATA_NAO_LIBERADA: a data % não está liberada para regularização histórica', p_data;
  end if;
  return v_user;
end; $$;
revoke all on function public.regularizacao_exigir(date) from public, anon, authenticated;
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'regularizacao_historica_estado';
  v_def := replace(v_def, 'd.data <= (now() at time zone ''America/Sao_Paulo'')::date', 'd.data < (now() at time zone ''America/Sao_Paulo'')::date');
  execute v_def;
end $$;
delete from public.regularizacao_historica_datas where data >= (now() at time zone 'America/Sao_Paulo')::date;   -- desliga a liberação de hoje
commit;

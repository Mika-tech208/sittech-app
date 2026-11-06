-- 20261114110000_regularizacao_historica_data_de_hoje
-- A regularização histórica passa a aceitar HOJE, mas SOMENTE se a data estiver liberada explicitamente em regularizacao_historica_datas (liberação manual por SQL)
-- e SOMENTE para períodos que já começaram (nunca período futuro). Datas futuras continuam proibidas. Todo o resto (auditoria, supressão de recálculo, permissões) igual.
-- ROLLBACK: supabase/rollbacks/20261114110000_regularizacao_historica_data_de_hoje_ROLLBACK.sql
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
  if p_data is null or p_data > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'REGULARIZACAO_DATA_INVALIDA: não é possível regularizar datas futuras';
  end if;
  if not exists (select 1 from regularizacao_historica_datas where data = p_data) then
    raise exception 'REGULARIZACAO_DATA_NAO_LIBERADA: a data % não está liberada para regularização histórica', p_data;
  end if;
  return v_user;
end;
$$;
revoke all on function public.regularizacao_exigir(date) from public, anon, authenticated;

do $$
declare v_def text;
begin
  -- RPC de gravação: hoje só para período que já começou
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'regularizar_apontamento_historico';
  if v_def is null then raise exception 'regularizar_apontamento_historico não encontrada'; end if;
  if v_def not like '%PERIODO_NAO_INICIADO%' then
    v_def := replace(v_def, E'  if not found then raise exception ''PERIODO_INVALIDO: período % não existe'', p_periodo_id; end if;\n',
      E'  if not found then raise exception ''PERIODO_INVALIDO: período % não existe'', p_periodo_id; end if;\n  if p_data = (now() at time zone ''America/Sao_Paulo'')::date and v_ini > (now() at time zone ''America/Sao_Paulo'')::time then raise exception ''PERIODO_NAO_INICIADO: o período % de hoje ainda não começou'', p_periodo_id; end if;\n');
    if v_def not like '%PERIODO_NAO_INICIADO%' then raise exception 'ponto de inserção não reconhecido (revisar a migration)'; end if;
    execute v_def;
  end if;
  -- estado da tela: lista também a data de hoje quando liberada
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'regularizacao_historica_estado';
  if v_def like '%d.data < (now() at time zone ''America/Sao_Paulo'')::date%' then
    v_def := replace(v_def, 'd.data < (now() at time zone ''America/Sao_Paulo'')::date', 'd.data <= (now() at time zone ''America/Sao_Paulo'')::date');
    execute v_def;
  elsif v_def not like '%d.data <= (now() at time zone%' then raise exception 'filtro de datas do estado não reconhecido (revisar a migration)';
  end if;
end $$;

commit;

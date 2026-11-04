-- Restaura a regra anterior (apontamento só por quem abriu a janela). Mensagens da RPC registrar_apontamentos_fechamento permanecem no texto novo (inofensivo).
begin;
create or replace function public.escala_fechamento_apontamento_permitido(p_data date, p_periodo text, p_usuario uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ab record; v_fech record;
begin
  if public.escala_fechamento_fisico_modo() <> 'ativo' then return true; end if;
  select f.* into v_fech from public.escala_fechamentos_vigentes f where f.data = p_data and f.periodo_id = p_periodo
    and not exists (select 1 from public.escala_fechamento_log l where l.fechamento_id = f.id and (l.detalhe ->> 'sombra') = 'true');
  if found then
    select a.* into v_ab from public.escala_fechamento_aberturas a
      where a.data = p_data and a.periodo_id = p_periodo and a.aberto_em > v_fech.fechado_em and a.valido_ate > now()
      order by a.aberto_em desc limit 1;
    return found and v_ab.aberto_por is not distinct from p_usuario;
  end if;
  select a.* into v_ab from public.escala_fechamento_aberturas a
    where a.data = p_data and a.periodo_id = p_periodo and a.valido_ate > now() and not exists (select 1 from public.escala_fechamentos f where f.abertura_id = a.id)
    order by a.aberto_em desc limit 1;
  if not found then return true; end if;
  return v_ab.aberto_por is not distinct from p_usuario;
end;
$$;
revoke all on function public.escala_fechamento_apontamento_permitido(date, text, uuid) from public, anon, authenticated;
grant execute on function public.escala_fechamento_apontamento_permitido(date, text, uuid) to service_role;
commit;

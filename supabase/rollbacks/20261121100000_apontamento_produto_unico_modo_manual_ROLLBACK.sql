-- Restaura o guard anterior (sem a exceção do modo manual). Não apaga nada; lançamentos já feitos no produto único permanecem.
begin;
create or replace function public.produto_unico_trg_guarda_apontamento() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v_cut date; v_legado boolean; v_canonico boolean;
begin
  if new.produto_id is null or current_setting('sittech.produto_unico_bypass', true) = 'on' then return new; end if;
  select (valor #>> '{}')::date into v_cut from public.escala_parametros where chave = 'produto_unico_cutover' and jsonb_typeof(valor) = 'string';
  select exists (select 1 from public.produto_legado_mapa where produto_legado_id = new.produto_id), exists (select 1 from public.produto_canonico where produto_id = new.produto_id) into v_legado, v_canonico;
  if not v_legado and not v_canonico then return new; end if;
  if v_canonico and (v_cut is null or date_trunc('week', new.data)::date < v_cut) then
    raise exception 'APONTAMENTO_CANONICO_ANTES_DO_CUTOVER: data % é anterior ao cutover (%); lance no produto da época (Convencional/Automática)', new.data, v_cut using errcode = 'P0001';
  end if;
  if v_legado and v_cut is not null and date_trunc('week', new.data)::date >= v_cut then
    raise exception 'APONTAMENTO_LEGADO_APOS_CUTOVER: data % usa o produto único (cutover %); lance no Conector 3/4', new.data, v_cut using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;
commit;

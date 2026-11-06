-- Remove as RPCs e restaura os gatilhos sem o marcador. As tabelas (auditoria e datas liberadas) são MANTIDAS (histórico append-only).
begin;
drop function if exists public.regularizar_apontamento_historico(date, text, uuid, uuid, uuid, numeric, numeric, uuid, uuid, boolean);
drop function if exists public.regularizar_excluir_apontamento_historico(uuid);
drop function if exists public.regularizacao_historica_estado(date);
delete from public.regularizacao_historica_datas;   -- desliga a liberação (a tabela de auditoria permanece)
create or replace function public.escala_trg_apontamento_fechamento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.escala_fechamento_fisico_modo() <> 'ativo' then return new; end if;
  if not public.escala_fechamento_apontamento_permitido(new.data, new.periodo_id, new.criado_por) then
    raise exception 'FECHAMENTO_PERIODO_EM_FECHAMENTO: o período % de % já está confirmado; para corrigir é preciso reabrir o período', new.periodo_id, new.data;
  end if;
  return new;
end; $$;
create or replace function public.escala_trg_apontamento_fechamento_alteracao()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u uuid;
begin
  if public.escala_fechamento_fisico_modo() <> 'ativo' or auth.uid() is null then return coalesce(new, old); end if;
  select id into v_u from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if not public.escala_fechamento_apontamento_permitido(old.data, old.periodo_id, v_u) then
    raise exception 'FECHAMENTO_PERIODO_EM_FECHAMENTO: o período % de % já está confirmado; para corrigir é preciso reabrir o período', old.periodo_id, old.data;
  end if;
  return coalesce(new, old);
end; $$;
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'escala_trg_apontamento';
  v_def := replace(v_def, E'  if public.regularizacao_em_curso() then return null; end if;\n', '');
  execute v_def;
end $$;
commit;

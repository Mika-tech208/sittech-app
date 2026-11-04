-- 20261113100000_apontamento_sem_dono_da_janela
-- REGRA (04/11): quem pode lançar/corrigir apontamento NÃO depende de quem abriu o fechamento. Só a Elizabeth usa o tablet.
--   período ABERTO ou EM_FECHAMENTO  → qualquer usuário com permissão lança/corrige (a permissão continua sendo checada nas RPCs/RLS)
--   período CONFIRMADO               → edição direta BLOQUEADA (correção = reabrir período → corrigir → fechar de novo). Regra INALTERADA.
--   reabertura (abertura nova posterior ao fechamento, ainda válida) → qualquer usuário com permissão corrige (antes: só quem reabriu)
-- O LOCK continua somente no fechamento: escala_fechamento_abrir (FECHAMENTO_EM_ANDAMENTO), escala_fechamento_registrar (FECHAMENTO_OUTRO_RESPONSAVEL,
-- idempotência por chave), escala_fechamento_trava_* (recálculo por semana). Nada disso é tocado aqui.
-- NÃO mexe em: inventário, corte-v1, HARD gate, liberação, vínculo. Auditoria dos apontamentos (apontamentos_producao_alteracoes) inalterada.
-- ROLLBACK: supabase/rollbacks/20261113100000_apontamento_sem_dono_da_janela_ROLLBACK.sql
begin;

create or replace function public.escala_fechamento_apontamento_permitido(p_data date, p_periodo text, p_usuario uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_fech record;
begin
  if public.escala_fechamento_fisico_modo() <> 'ativo' then return true; end if;
  select f.* into v_fech from public.escala_fechamentos_vigentes f where f.data = p_data and f.periodo_id = p_periodo
    and not exists (select 1 from public.escala_fechamento_log l where l.fechamento_id = f.id and (l.detalhe ->> 'sombra') = 'true');
  if found then
    -- já fechado (CONFIRMADO / em recálculo): só com uma REABERTURA válida e posterior ao fechamento (de qualquer usuário autorizado)
    return exists (select 1 from public.escala_fechamento_aberturas a
                    where a.data = p_data and a.periodo_id = p_periodo and a.aberto_em > v_fech.fechado_em and a.valido_ate > now());
  end if;
  return true;                                   -- ABERTO ou EM_FECHAMENTO: sem dono da janela
end;
$$;
revoke all on function public.escala_fechamento_apontamento_permitido(date, text, uuid) from public, anon, authenticated;
grant execute on function public.escala_fechamento_apontamento_permitido(date, text, uuid) to service_role;

-- mensagens: a recusa agora só acontece em período confirmado
create or replace function public.escala_trg_apontamento_fechamento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.escala_fechamento_fisico_modo() <> 'ativo' then return new; end if;
  if not public.escala_fechamento_apontamento_permitido(new.data, new.periodo_id, new.criado_por) then
    raise exception 'FECHAMENTO_PERIODO_EM_FECHAMENTO: o período % de % já está confirmado; para corrigir é preciso reabrir o período', new.periodo_id, new.data;
  end if;
  return new;
end;
$$;
revoke all on function public.escala_trg_apontamento_fechamento() from public, anon, authenticated;

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
end;
$$;
revoke all on function public.escala_trg_apontamento_fechamento_alteracao() from public, anon, authenticated;

-- RPC do fluxo único: só o texto da recusa muda (a lógica é a mesma função acima)
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'registrar_apontamentos_fechamento';
  if v_def is null then raise exception 'registrar_apontamentos_fechamento não encontrada'; end if;
  if v_def like '%pode ser lançado pelo responsável pelo fechamento%' then
    v_def := replace(v_def, 'está em fechamento/fechado; o apontamento só pode ser lançado pelo responsável pelo fechamento', 'já está confirmado; para corrigir é preciso reabrir o período');
    if v_def like '%pode ser lançado pelo responsável pelo fechamento%' then raise exception 'texto não substituído (revisar a migration)'; end if;
    execute v_def;
  end if;
end $$;

commit;

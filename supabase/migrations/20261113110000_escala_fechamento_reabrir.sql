-- 20261113110000_escala_fechamento_reabrir
-- REABRIR PERÍODO (correção de lançamento em período CONFIRMADO). Quem pode: admin ou perfil com `escala_fechamento` (checado na rota; esta RPC é só service_role).
--   • exige motivo (auditoria); só período CONFIRMADO oficial; abre uma janela de correção de 60 min (renovável chamando de novo, idempotente)
--   • durante a janela QUALQUER usuário autorizado edita/exclui apontamentos do período (escala_fechamento_apontamento_permitido já lê aberturas posteriores ao fechamento)
--   • NÃO recalcula o plano e NÃO tira a liberação do período seguinte: o estoque FÍSICO contado no fechamento segue sendo a verdade; corrigir lançamento
--     altera histórico/relatórios, não o corte. (Reabrir para recontar estoque = nova revisão do fechamento: caminho `forcar` da rota de abrir, perfil superior.)
--   • cada edição segue auditada por apontamento_producao_historico (anterior/novo/usuário/hora/motivo); a reabertura fica em escala_fechamento_reaberturas (append-only)
-- ROLLBACK: supabase/rollbacks/20261113110000_escala_fechamento_reabrir_ROLLBACK.sql
begin;

create table if not exists public.escala_fechamento_reaberturas (
  id uuid primary key default gen_random_uuid(),
  abertura_id uuid not null references public.escala_fechamento_aberturas(id),
  fechamento_id uuid not null references public.escala_fechamentos(id),
  data date not null,
  periodo_id text not null,
  motivo text not null check (length(btrim(motivo)) >= 3),
  reaberto_por uuid references public.usuarios(id) on delete set null,
  reaberto_em timestamptz not null default now(),
  valido_ate timestamptz not null
);
create index if not exists escala_fechamento_reaberturas_idx on public.escala_fechamento_reaberturas (data, periodo_id, reaberto_em desc);
alter table public.escala_fechamento_reaberturas enable row level security;     -- sem policy: só service_role (a rota)
revoke all on public.escala_fechamento_reaberturas from public, anon, authenticated;
grant select, insert on public.escala_fechamento_reaberturas to service_role;
drop trigger if exists trg_escala_fechamento_reaberturas_imutavel on public.escala_fechamento_reaberturas;
create trigger trg_escala_fechamento_reaberturas_imutavel before update or delete on public.escala_fechamento_reaberturas for each row execute function public.escala_fechamento_trg_imutavel();
drop trigger if exists trg_escala_fechamento_reaberturas_imutavel_trunc on public.escala_fechamento_reaberturas;
create trigger trg_escala_fechamento_reaberturas_imutavel_trunc before truncate on public.escala_fechamento_reaberturas for each statement execute function public.escala_fechamento_trg_imutavel();

create or replace function public.escala_fechamento_reabrir(p_usuario uuid, p_data date, p_periodo text, p_motivo text, p_ttl_min integer default 60)
returns table (abertura_id uuid, valido_ate timestamptz, renovada boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_fech record; v_ab record; v_id uuid; v_ate timestamptz;
begin
  if public.escala_fechamento_fisico_modo() <> 'ativo' then raise exception 'REABERTURA_INDISPONIVEL: fechamento físico não está ativo'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 3 then raise exception 'REABERTURA_MOTIVO: informe o motivo da reabertura'; end if;
  perform pg_advisory_xact_lock(hashtextextended('abrir|' || p_data::text || '|' || p_periodo, 0));
  select f.* into v_fech from public.escala_fechamentos_vigentes f
   where f.data = p_data and f.periodo_id = p_periodo
     and not exists (select 1 from public.escala_fechamento_log l where l.fechamento_id = f.id and (l.detalhe ->> 'sombra') = 'true');
  if not found then raise exception 'REABERTURA_PERIODO_NAO_CONFIRMADO: o período % de % não está confirmado (nada a reabrir)', p_periodo, p_data; end if;
  if not exists (select 1 from public.escala_fechamento_estado e where e.fechamento_id = v_fech.id and e.estado = 'CONFIRMADO') then
    raise exception 'REABERTURA_PERIODO_NAO_CONFIRMADO: o fechamento de % de % ainda não está CONFIRMADO (recálculo em andamento ou com erro: use o reenvio)', p_periodo, p_data;
  end if;
  -- janela de correção ainda válida (posterior ao fechamento): renova (nova abertura) em vez de acumular janelas
  select a.* into v_ab from public.escala_fechamento_aberturas a
   where a.data = p_data and a.periodo_id = p_periodo and a.aberto_em > v_fech.fechado_em and a.valido_ate > now()
   order by a.aberto_em desc limit 1;
  v_ate := now() + make_interval(mins => greatest(1, least(p_ttl_min, 240)));
  insert into public.escala_fechamento_aberturas (semana_inicio, data, periodo_id, aberto_por, dispositivo, valido_ate)
  values (v_fech.semana_inicio, p_data, p_periodo, p_usuario, 'reabertura', v_ate) returning id into v_id;
  insert into public.escala_fechamento_reaberturas (abertura_id, fechamento_id, data, periodo_id, motivo, reaberto_por, valido_ate)
  values (v_id, v_fech.id, p_data, p_periodo, btrim(p_motivo), p_usuario, v_ate);
  return query select v_id, v_ate, v_ab.id is not null;
end;
$$;
revoke all on function public.escala_fechamento_reabrir(uuid, date, text, text, integer) from public, anon, authenticated;
grant execute on function public.escala_fechamento_reabrir(uuid, date, text, text, integer) to service_role;

commit;

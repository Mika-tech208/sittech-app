-- Sittech — PRODUTO ÚNICO / VIRADA DE SEMANA: o M1 da semana nova só é liberado se o plano foi calculado com o snapshot físico do T3 da sexta.
-- Depende de 20261116100000 (precedência do PLANEJAMENTO na liberação). Cria escala_plano_base_fisica (append-only; gravada pelo processamento da semana — TS) e SUBSTITUI a exceção
-- temporal VIRADA_SEMANA de escala_periodo_liberacao pela regra da BASE FÍSICA. Sem registro de base => M1 NÃO liberado (fail-closed; correção: regerar a semana ainda não iniciada).
-- Alavanca de emergência (documentada): mover escala_liberacao_desde para depois do M1 libera como TRANSICAO — decisão humana, nunca automática.
-- Reversão: supabase/rollbacks/20261116110000_rollback_escala_liberacao_base_fisica.sql
begin;

create table if not exists public.escala_plano_base_fisica (
  id bigint generated always as identity primary key,
  previsao_id uuid not null references public.previsoes(id) on delete cascade,
  calculado_em timestamptz not null default now(),
  fechamento_ids uuid[] not null,                -- fechamentos VIGENTES cujos inventários físicos entraram no cálculo do plano (snapshot físico usado)
  hash_plano text,
  origem text not null default 'recalculo' check (origem in ('geracao', 'recalculo', 'sem_alteracao'))
);
create index if not exists escala_plano_base_fisica_idx on public.escala_plano_base_fisica (previsao_id, calculado_em desc);
alter table public.escala_plano_base_fisica enable row level security;
drop policy if exists escala_plano_base_fisica_leitura on public.escala_plano_base_fisica;
create policy escala_plano_base_fisica_leitura on public.escala_plano_base_fisica for select to authenticated using (public.is_admin() or public.has_permissao('escala_producao') or public.has_permissao('escala_fechamento'));
revoke all on public.escala_plano_base_fisica from anon, authenticated;
grant select on public.escala_plano_base_fisica to authenticated;
grant select, insert on public.escala_plano_base_fisica to service_role;
revoke all on sequence public.escala_plano_base_fisica_id_seq from anon, authenticated;
grant usage, select on sequence public.escala_plano_base_fisica_id_seq to service_role;
create or replace function public.escala_plano_base_fisica_trg_imutavel() returns trigger language plpgsql as $$ begin raise exception 'escala_plano_base_fisica é append-only'; end $$;
drop trigger if exists trg_escala_plano_base_fisica_imutavel on public.escala_plano_base_fisica;
create trigger trg_escala_plano_base_fisica_imutavel before update or delete on public.escala_plano_base_fisica for each row when (pg_trigger_depth() = 0) execute function public.escala_plano_base_fisica_trg_imutavel();

create or replace function public.escala_periodo_liberacao(p_data date, p_periodo text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_modo text := public.escala_fechamento_fisico_modo();
  v_desde jsonb := coalesce((select valor from public.escala_parametros where chave = 'escala_liberacao_desde'), '{"data":"2026-11-04","periodo":"m3"}'::jsonb);
  v_desde_data date := (v_desde ->> 'data')::date;
  v_slot record; v_ant record; v_dinicio text; v_e record; v_conf timestamptz; v_pred jsonb; v_vinc record; v_atual integer;
begin
  -- PLANEJAMENTO (produto único, semana >= planejamento_desde e < cutover): o plano é FUTURO e NÃO LIBERADO. PRECEDÊNCIA ABSOLUTA sobre qualquer outra regra
  -- (modo do fechamento, transição/escala_liberacao_desde, vínculo explícito, VIRADA_SEMANA): nenhum período de dia em planejamento é entregue à TV, à Produção Real nem ao apontamento.
  if public.produto_unico_modo(p_data) = 'PLANEJAMENTO' then
    return jsonb_build_object('liberado', false, 'motivo', 'PLANO_FUTURO_AGUARDANDO_CUTOVER', 'modo_produto_unico', 'PLANEJAMENTO');
  end if;
  if v_modo <> 'ativo' then return jsonb_build_object('liberado', true, 'motivo', 'MODO_NAO_ATIVO'); end if;
  select * into v_slot from public.escala_liberacao_slots(p_data) s where s.data = p_data and s.pid = p_periodo;
  if not found then return jsonb_build_object('liberado', false, 'motivo', 'PERIODO_DESCONHECIDO'); end if;
  if p_data < v_desde_data then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  if p_data = v_desde_data then
    select s.inicio into v_dinicio from public.escala_liberacao_slots(p_data) s where s.data = v_desde_data and s.pid = v_desde ->> 'periodo';
    if v_dinicio is not null and v_slot.inicio < v_dinicio then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  end if;
  select * into v_ant from public.escala_liberacao_slots(p_data) s where (s.data, s.inicio) < (p_data, v_slot.inicio) order by s.data desc, s.inicio desc limit 1;
  if not found then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  v_pred := jsonb_build_object('data', v_ant.data, 'periodo', v_ant.pid, 'rotulo', v_ant.nome);
  select * into v_e from public.escala_fechamento_estado e where e.data = v_ant.data and e.periodo_id = v_ant.pid and not e.sombra;
  if not found then return jsonb_build_object('liberado', false, 'motivo', 'AGUARDANDO_FECHAMENTO', 'predecessor', v_pred); end if;
  if v_e.estado = 'ERRO_RECALCULO' then return jsonb_build_object('liberado', false, 'motivo', 'ERRO_RECALCULO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  if v_e.estado <> 'CONFIRMADO' then return jsonb_build_object('liberado', false, 'motivo', 'RECALCULANDO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  select l.em into v_conf from public.escala_fechamento_log l where l.fechamento_id = v_e.fechamento_id and l.estado = 'CONFIRMADO' order by l.seq desc limit 1;
  -- vínculo EXPLÍCITO fechamento → plano do dia do período
  select * into v_vinc from public.escala_fechamento_plano v where v.fechamento_id = v_e.fechamento_id and v.data = p_data;
  if not found then
    -- VIRADA DE SEMANA (T3 de sexta -> M1 da semana seguinte): o fechamento não gera o plano da semana nova (outra Previsão); esse plano nasce da geração/revalidação da semana.
    -- REGRA ROBUSTA (substitui a regra TEMPORAL "plano gravado depois do fechamento"): o M1 só é liberado se o plano da nova semana foi calculado COM O SNAPSHOT FÍSICO DESTE fechamento,
    -- isto é, existe registro em escala_plano_base_fisica (gravado pelo processamento da semana, inclusive em NO-OP) cujos fechamento_ids contêm ESTE fechamento (a revisão vigente) e que é posterior a ele.
    -- Um plano gerado ANTES do fechamento, ou apenas "tocado" depois (troca manual, edição), NÃO tem a base e NÃO libera: motivo CONFIRMADO_SEM_PLANO / detalhe PLANO_SEM_BASE_FISICA.
    -- Dentro da mesma semana esta exceção NÃO existe (vale o vínculo explícito). Marcado 'VIRADA_SEMANA_BASE_FISICA' para auditoria.
    declare v_prev_dia uuid; v_prev_ant uuid; v_base record;
    begin
      select d.previsao_id into v_prev_dia from public.escala_producao_dias d where d.data = p_data;
      select d.previsao_id into v_prev_ant from public.escala_producao_dias d where d.data = v_ant.data;
      if v_prev_dia is not null and v_prev_dia is distinct from v_prev_ant then
        select b.id, b.calculado_em, b.hash_plano into v_base from public.escala_plano_base_fisica b
         where b.previsao_id = v_prev_dia and b.fechamento_ids @> array[v_e.fechamento_id] and b.calculado_em >= v_e.fechado_em order by b.calculado_em desc limit 1;
        if found then
          return jsonb_build_object('liberado', true, 'motivo', 'CONFIRMADO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id, 'vinculo', 'VIRADA_SEMANA_BASE_FISICA', 'hash_plano', v_base.hash_plano,
                                    'base_calculada_em', v_base.calculado_em, 'confirmado_em', v_conf, 'excecao', v_e.excecao);
        end if;
        return jsonb_build_object('liberado', false, 'motivo', 'CONFIRMADO_SEM_PLANO', 'detalhe', 'PLANO_SEM_BASE_FISICA', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id);
      end if;
    end;
    return jsonb_build_object('liberado', false, 'motivo', 'CONFIRMADO_SEM_PLANO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id);
  end if;
  select d.versao into v_atual from public.escala_producao_dias d where d.data = p_data;
  if v_atual is null or v_atual < v_vinc.versao then return jsonb_build_object('liberado', false, 'motivo', 'PLANO_DIVERGENTE', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  return jsonb_build_object('liberado', true, 'motivo', 'CONFIRMADO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id, 'hash_plano', v_vinc.hash_plano,
                            'plano_versao', v_vinc.versao, 'vinculo', v_vinc.metodo, 'confirmado_em', v_conf, 'excecao', v_e.excecao);
end;
$$;

notify pgrst, 'reload schema';
commit;

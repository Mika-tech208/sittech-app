-- Sittech — Escala de Produção: registro AUTOMÁTICO de eventos (Fase 3).
--
-- Triggers só REGISTRAM um pedido de recálculo no outbox
-- (escala_producao_eventos) — sem pg_net, Vault ou pg_cron. Quem processa é
-- o servidor Next/Vercel (/api/escala/processar), chamado pelo navegador
-- depois da ação, com retry simples dos eventos pendentes/falhados.
--
-- Só registra quando a semana JÁ TEM escala gerada: ausência ou mudança na
-- Previsão de uma semana sem escala não gera nada. Eventos pendentes do
-- mesmo tipo e semana são deduplicados (o recálculo parte do estado
-- completo atual, então duplicatas seriam redundantes).

create or replace function public.escala_semana_tem_escala(p_previsao_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.escala_producao_dias where previsao_id = p_previsao_id);
$$;

-- ---- Ausências: criada / editada / removida ----
create or replace function public.escala_trg_ausencia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_datas date[] := '{}';
  v_data date;
  v_prev uuid;
  v_func uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then v_datas := v_datas || new.data; v_func := new.funcionario_id; end if;
  if tg_op in ('UPDATE', 'DELETE') then v_datas := v_datas || old.data; v_func := coalesce(v_func, old.funcionario_id); end if;

  foreach v_data in array (select array_agg(distinct d) from unnest(v_datas) d) loop
    select id into v_prev from previsoes where semana_inicio = date_trunc('week', v_data)::date;
    if v_prev is not null and public.escala_semana_tem_escala(v_prev) then
      perform public.escala_registrar_evento('ausencia', v_prev, jsonb_build_object('operacao', lower(tg_op), 'funcionario_id', v_func, 'data', v_data), null);
    end if;
  end loop;
  return null;
end;
$$;

create trigger trg_escala_evento_ausencia
  after insert or update or delete on public.ausencias_funcionarios
  for each row execute function public.escala_trg_ausencia();

-- ---- Previsão: itens/quantidades, máquinas selecionadas, equipe, dias, indisponíveis ----
create or replace function public.escala_trg_previsao_direto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid := coalesce(case when tg_op = 'DELETE' then old.previsao_id else new.previsao_id end, null);
begin
  if v_prev is not null and public.escala_semana_tem_escala(v_prev) then
    perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('tabela', tg_table_name, 'operacao', lower(tg_op)), null);
  end if;
  return null;
end;
$$;

create or replace function public.escala_trg_previsao_item_maquina()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item uuid := case when tg_op = 'DELETE' then old.item_id else new.item_id end;
  v_prev uuid;
begin
  -- em exclusão em cascata o item pai já sumiu; o trigger de previsao_itens já registrou o evento
  select previsao_id into v_prev from previsao_itens where id = v_item;
  if v_prev is not null and public.escala_semana_tem_escala(v_prev) then
    perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('tabela', tg_table_name, 'operacao', lower(tg_op)), null);
  end if;
  return null;
end;
$$;

create trigger trg_escala_evento_previsao_itens after insert or update or delete on public.previsao_itens
  for each row execute function public.escala_trg_previsao_direto();
create trigger trg_escala_evento_previsao_maquinas_indisp after insert or update or delete on public.previsao_maquinas_indisponiveis
  for each row execute function public.escala_trg_previsao_direto();
create trigger trg_escala_evento_previsao_dias after insert or update or delete on public.previsao_dias_produtivos
  for each row execute function public.escala_trg_previsao_direto();
create trigger trg_escala_evento_previsao_equipe after insert or update or delete on public.previsao_equipe_semana
  for each row execute function public.escala_trg_previsao_direto();
create trigger trg_escala_evento_previsao_item_maquinas after insert or update or delete on public.previsao_item_maquinas
  for each row execute function public.escala_trg_previsao_item_maquina();

revoke all on function public.escala_semana_tem_escala(uuid) from public, anon, authenticated;
revoke all on function public.escala_trg_ausencia() from public, anon, authenticated;
revoke all on function public.escala_trg_previsao_direto() from public, anon, authenticated;
revoke all on function public.escala_trg_previsao_item_maquina() from public, anon, authenticated;

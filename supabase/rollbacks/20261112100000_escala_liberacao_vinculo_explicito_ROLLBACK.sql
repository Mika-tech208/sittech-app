-- ROLLBACK da release estrutural (20261112100000): volta a liberação ao vínculo transitório (hash+horário), o CONFIRMADO ao comportamento anterior e remove os gates de UPDATE/DELETE.
-- NÃO apaga dados: o vínculo explícito é ARQUIVADO (escala_fechamento_plano_arquivo) antes de remover a tabela; os buffers (estimado/físico/diferença) permanecem.
-- O CHECK do motivo NÃO é recriado como obrigatório para linhas existentes (NOT VALID): só voltaria a valer para novas linhas — religar a regra antiga é decisão separada.
begin;
drop trigger if exists trg_apontamentos_producao_fechamento_alteracao on public.apontamentos_producao;
drop function if exists public.escala_trg_apontamento_fechamento_alteracao();
create or replace function public.escala_fechamento_resultado(p_fechamento uuid, p_estado text, p_detalhe jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_estado not in ('RECALCULANDO', 'CONFIRMADO', 'ERRO_RECALCULO') then raise exception 'FECHAMENTO_ESTADO_INVALIDO: %', p_estado; end if;
  insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) values (p_fechamento, p_estado, coalesce(p_detalhe, '{}'::jsonb));
  update public.escala_producao_eventos set status = 'processado', processado_em = now()
   where tipo = 'fechamento_fisico' and payload->>'fechamento_id' = p_fechamento::text and p_estado = 'CONFIRMADO' and status in ('pendente', 'processando', 'erro');
end;
$$;

create or replace function public.escala_periodo_liberacao(p_data date, p_periodo text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_modo text := public.escala_fechamento_fisico_modo();
  v_desde jsonb := coalesce((select valor from public.escala_parametros where chave = 'escala_liberacao_desde'), '{"data":"2026-11-04","periodo":"m3"}'::jsonb);
  v_desde_data date := (v_desde ->> 'data')::date;
  v_slot record; v_ant record; v_dinicio text; v_e record; v_hash text; v_conf timestamptz; v_plano boolean;
  v_pred jsonb;
begin
  if v_modo <> 'ativo' then return jsonb_build_object('liberado', true, 'motivo', 'MODO_NAO_ATIVO'); end if;
  select * into v_slot from public.escala_liberacao_slots(p_data) s where s.data = p_data and s.pid = p_periodo;
  if not found then return jsonb_build_object('liberado', false, 'motivo', 'PERIODO_DESCONHECIDO'); end if;
  -- anterior à regra (transição): liberado
  if p_data < v_desde_data then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  if p_data = v_desde_data then
    select s.inicio into v_dinicio from public.escala_liberacao_slots(p_data) s where s.data = v_desde_data and s.pid = v_desde ->> 'periodo';
    if v_dinicio is not null and v_slot.inicio < v_dinicio then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  end if;
  -- período anterior (o último que começou antes, em qualquer dia da janela)
  select * into v_ant from public.escala_liberacao_slots(p_data) s where (s.data, s.inicio) < (p_data, v_slot.inicio) order by s.data desc, s.inicio desc limit 1;
  if not found then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  v_pred := jsonb_build_object('data', v_ant.data, 'periodo', v_ant.pid, 'rotulo', v_ant.nome);
  select * into v_e from public.escala_fechamento_estado e where e.data = v_ant.data and e.periodo_id = v_ant.pid and not e.sombra;
  if not found then return jsonb_build_object('liberado', false, 'motivo', 'AGUARDANDO_FECHAMENTO', 'predecessor', v_pred); end if;
  if v_e.estado = 'ERRO_RECALCULO' then return jsonb_build_object('liberado', false, 'motivo', 'ERRO_RECALCULO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  if v_e.estado <> 'CONFIRMADO' then return jsonb_build_object('liberado', false, 'motivo', 'RECALCULANDO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  -- CONFIRMADO: exige o PLANO GERADO POR ESTE fechamento persistido (hash do log = hash do diagnóstico aplicado)
  select l.detalhe ->> 'hash_plano_novo', l.em into v_hash, v_conf from public.escala_fechamento_log l where l.fechamento_id = v_e.fechamento_id and l.estado = 'CONFIRMADO' order by l.seq desc limit 1;
  v_plano := v_hash is not null
    and exists (select 1 from public.escala_fluxo_diagnosticos d where d.gatilho = 'fechamento' and d.aplicado = true and d.hash_plano_fluxo = v_hash)
    and exists (select 1 from public.escala_producao_dias dd where dd.data = p_data and dd.atualizado_em >= v_e.fechado_em);   -- o plano do dia foi regravado DEPOIS do fechamento
  if not v_plano then return jsonb_build_object('liberado', false, 'motivo', 'CONFIRMADO_SEM_PLANO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  return jsonb_build_object('liberado', true, 'motivo', 'CONFIRMADO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id, 'hash_plano', v_hash, 'confirmado_em', v_conf, 'excecao', v_e.excecao);
end;
$$;

create table if not exists public.escala_fechamento_plano_arquivo as select * from public.escala_fechamento_plano;
drop table if exists public.escala_fechamento_plano;
alter table public.escala_fechamento_buffers drop column if exists diferenca_pct;
alter table public.escala_fechamento_buffers drop constraint if exists escala_fechamento_buffers_motivo;
alter table public.escala_fechamento_buffers add constraint escala_fechamento_buffers_motivo check (saldo_fisico is null or saldo_estimado is null
  or abs(saldo_fisico - saldo_estimado) <= greatest(500, 0.15 * saldo_fisico) or length(btrim(coalesce(motivo, ''))) >= 3) not valid;
-- (o patch de escala_trg_parametros para 'escala_liberacao_desde' é inofensivo e permanece)
commit;

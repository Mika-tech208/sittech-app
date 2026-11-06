-- ROLLBACK da migration 20261116100000_produto_unico_planejamento_liberacao. NÃO é migration; executar à mão.
-- Restaura escala_periodo_liberacao ao texto de 20261112100000 e remove os 3 gatilhos/função de bloqueio do planejamento.
begin;
set local lock_timeout = '10s';
drop trigger if exists trg_produto_unico_bloqueia_planejamento on public.apontamentos_producao;
drop trigger if exists trg_produto_unico_bloqueia_planejamento on public.escala_fechamentos;
drop trigger if exists trg_produto_unico_bloqueia_planejamento on public.escala_fechamento_aberturas;
drop function if exists public.produto_unico_trg_bloqueia_planejamento();
create or replace function public.escala_periodo_liberacao(p_data date, p_periodo text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_modo text := public.escala_fechamento_fisico_modo();
  v_desde jsonb := coalesce((select valor from public.escala_parametros where chave = 'escala_liberacao_desde'), '{"data":"2026-11-04","periodo":"m3"}'::jsonb);
  v_desde_data date := (v_desde ->> 'data')::date;
  v_slot record; v_ant record; v_dinicio text; v_e record; v_conf timestamptz; v_pred jsonb; v_vinc record; v_atual integer;
begin
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
    -- VIRADA DE SEMANA (T3 de sexta → M1 da semana seguinte): o fechamento não gera o plano da semana nova (outra Previsão); esse plano nasce na geração semanal.
    -- Única exceção ao vínculo explícito, restrita a este caso: o dia do período pertence a OUTRA Previsão E o plano dele foi gravado DEPOIS do fechamento confirmado
    -- (a geração semanal lê o inventário físico vigente). Marcado 'VIRADA_SEMANA' para auditoria. Dentro da mesma semana esta exceção NÃO existe.
    if (select d.previsao_id from public.escala_producao_dias d where d.data = p_data) is distinct from (select d.previsao_id from public.escala_producao_dias d where d.data = v_ant.data)
       and exists (select 1 from public.escala_producao_dias d where d.data = p_data and d.atualizado_em >= v_e.fechado_em) then
      return jsonb_build_object('liberado', true, 'motivo', 'CONFIRMADO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id, 'vinculo', 'VIRADA_SEMANA', 'confirmado_em', v_conf, 'excecao', v_e.excecao);
    end if;
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

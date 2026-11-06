-- 20261114120000_regularizacao_sem_producao
-- A regularização histórica passa a poder registrar "SEM PRODUÇÃO" (máquina programada que não produziu por realocação etc.): sem isso, postos programados sem máquina/operador
-- ficam PENDENTES e o fechamento do período não aceita. Mesmas regras da regularização (admin/perfil superior, data liberada, auditoria append-only, sem recálculo).
-- ROLLBACK: supabase/rollbacks/20261114120000_regularizacao_sem_producao_ROLLBACK.sql
begin;

create or replace function public.regularizar_sem_producao_historico(
  p_data date, p_periodo_id text, p_maquina_id uuid, p_motivo text, p_descricao text default null, p_apontamento_id uuid default null, p_substituir boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid; v_ini time; v_fim time; v_ativa boolean; v_atual apontamentos_producao; v_alvo uuid; v_novo apontamentos_producao; v_acao text; v_anterior jsonb;
  v_desc text := nullif(btrim(coalesce(p_descricao, '')), '');
  v_obs constant text := 'Ajuste devido à realocação física de máquinas e operadores';
begin
  v_user := public.regularizacao_exigir(p_data);
  perform pg_advisory_xact_lock(hashtextextended('regularizacao|' || p_data::text, 0));
  perform set_config('app.regularizacao_historica', 'on:' || txid_current()::text, true);
  select inicio, fim into v_ini, v_fim from periodos where id = p_periodo_id;
  if not found then raise exception 'PERIODO_INVALIDO: período % não existe', p_periodo_id; end if;
  if p_data = (now() at time zone 'America/Sao_Paulo')::date and v_ini > (now() at time zone 'America/Sao_Paulo')::time then raise exception 'PERIODO_NAO_INICIADO: o período % de hoje ainda não começou', p_periodo_id; end if;
  select ativo into v_ativa from maquinas where id = p_maquina_id;
  if not found then raise exception 'MAQUINA_INVALIDA: máquina não encontrada'; end if;
  if not v_ativa then raise exception 'MAQUINA_INVALIDA: máquina inativa'; end if;
  if p_motivo is null or p_motivo not in ('sem_programacao', 'falta_material', 'falta_operador', 'manutencao_programada', 'outro') then raise exception 'MOTIVO_INVALIDO: informe o motivo da máquina sem produção'; end if;
  if p_motivo = 'outro' and v_desc is null then raise exception 'MOTIVO_INVALIDO: o motivo "outro" exige descrição'; end if;

  select * into v_atual from apontamentos_producao where maquina_id = p_maquina_id and data = p_data and periodo_id = p_periodo_id;
  if p_apontamento_id is null then
    if found then
      if not p_substituir then raise exception 'REGULARIZACAO_JA_EXISTE: já existe apontamento desta máquina neste período — edite ou substitua o existente'; end if;
      v_alvo := v_atual.id;
    end if;
  else
    v_alvo := p_apontamento_id;
    if found and v_atual.id <> p_apontamento_id then raise exception 'REGULARIZACAO_JA_EXISTE: já existe outro apontamento desta máquina neste período'; end if;
  end if;

  if v_alvo is null then
    insert into apontamentos_producao (status, maquina_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente,
        motivo_sem_producao, descricao_sem_producao, observacao, idempotency_key, criado_por)
    values ('sem_producao', p_maquina_id, p_periodo_id, p_data, v_fim, 0, 0, v_ini, v_fim, p_motivo, case when p_motivo = 'outro' then v_desc else null end, v_obs, gen_random_uuid(), v_user)
    returning * into v_novo;
    v_acao := 'INCLUIDO'; v_anterior := null;
  else
    select * into v_atual from apontamentos_producao where id = v_alvo;
    if not found then raise exception 'APONTAMENTO_INEXISTENTE: apontamento % não encontrado', v_alvo; end if;
    if v_atual.data <> p_data then raise exception 'REGULARIZACAO_DATA_DIVERGENTE: o apontamento é de outra data'; end if;
    v_anterior := to_jsonb(v_atual);
    update apontamentos_producao set status = 'sem_producao', maquina_id = p_maquina_id, periodo_id = p_periodo_id, produto_id = null, etapa_id = null, operacao_id = null, funcionario_id = null,
        quantidade_produzida = 0, quantidade_refugo = 0, periodo_inicio_vigente = v_ini, periodo_fim_vigente = v_fim, meta_periodo_vigente = null, custo_hora_operacao_vigente = null,
        valor_unitario_produto_vigente = null, motivo_sem_producao = p_motivo, descricao_sem_producao = case when p_motivo = 'outro' then v_desc else null end, observacao = v_obs
     where id = v_alvo returning * into v_novo;
    v_acao := 'ALTERADO';
    insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo)
    values (v_alvo, v_anterior, to_jsonb(v_novo), v_user, 'REGULARIZACAO_HISTORICA: ' || v_obs);
  end if;

  insert into apontamento_regularizacao_historica (acao, data, periodo_id, apontamento_id, maquina_id, anterior, novo, usuario_id)
  values (v_acao, p_data, p_periodo_id, v_novo.id, p_maquina_id, v_anterior, to_jsonb(v_novo), v_user);
  perform set_config('app.regularizacao_historica', '', true);
  return jsonb_build_object('ok', true, 'acao', v_acao, 'apontamento_id', v_novo.id, 'data', p_data, 'periodo_id', p_periodo_id, 'maquina_id', p_maquina_id, 'status', 'sem_producao', 'motivo', p_motivo);
end;
$$;
revoke all on function public.regularizar_sem_producao_historico(date, text, uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.regularizar_sem_producao_historico(date, text, uuid, text, text, uuid, boolean) to authenticated;

commit;

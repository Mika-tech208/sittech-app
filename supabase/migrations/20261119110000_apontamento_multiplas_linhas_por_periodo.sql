-- VÁRIOS LANÇAMENTOS POR MÁQUINA/PERÍODO (06/11/2026). A realidade da fábrica inclui máquina com DOIS PRODUTOS no mesmo período e TROCA DE OPERADOR dentro do período.
-- A unicidade antiga (maquina_id, data, periodo_id) — "V1 permite só um fechamento por máquina/dia/período" — impedia registrar isso.
-- NOVO MODELO (aditivo, sem apagar nada): cada LINHA é única por (máquina, data, período, produto, operador) e continua existindo UM "sem produção" por máquina/período;
-- "sem produção" e produção NÃO coexistem na mesma máquina/período (antes garantido pela unicidade; agora por gatilho). Dados existentes já satisfazem tudo (eram únicos).
begin;

alter table public.apontamentos_producao drop constraint if exists apontamentos_producao_maquina_id_data_periodo_id_key;
create unique index if not exists uq_apontamentos_sem_producao on public.apontamentos_producao (maquina_id, data, periodo_id) where status = 'sem_producao';
create unique index if not exists uq_apontamentos_producao_linha on public.apontamentos_producao (maquina_id, data, periodo_id, produto_id, funcionario_id) where status = 'produzindo';

create or replace function public.apontamentos_trg_status_exclusivo() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  if new.status = 'sem_producao' then
    if exists (select 1 from public.apontamentos_producao a where a.maquina_id = new.maquina_id and a.data = new.data and a.periodo_id = new.periodo_id and a.status = 'produzindo' and a.id <> new.id) then
      raise exception 'APONTAMENTO_MAQUINA_COM_PRODUCAO: a máquina já tem produção lançada neste período; não é possível marcar "sem produção"';
    end if;
  else
    if exists (select 1 from public.apontamentos_producao a where a.maquina_id = new.maquina_id and a.data = new.data and a.periodo_id = new.periodo_id and a.status = 'sem_producao' and a.id <> new.id) then
      raise exception 'APONTAMENTO_MAQUINA_SEM_PRODUCAO: a máquina está marcada como "sem produção" neste período; converta ou exclua esse registro antes de lançar produção';
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_apontamentos_status_exclusivo on public.apontamentos_producao;
create trigger trg_apontamentos_status_exclusivo before insert or update of status, maquina_id, data, periodo_id on public.apontamentos_producao
  for each row execute function public.apontamentos_trg_status_exclusivo();

-- mensagens amigáveis dos RPCs de registro (o nome da restrição mudou)
CREATE OR REPLACE FUNCTION public.registrar_apontamento_producao_core(p_maquina_id uuid, p_produto_id uuid, p_funcionario_id uuid, p_quantidade_produzida numeric, p_quantidade_refugo numeric, p_idempotency_key uuid, p_observacao text, p_data date, p_hora_lancamento time without time zone, p_periodo_id text, p_periodo_inicio time without time zone, p_periodo_fim time without time zone, p_paradas jsonb DEFAULT '[]'::jsonb)
 RETURNS apontamentos_producao
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_usuario_id uuid;
  v_maquina_ativo boolean;
  v_produto_ativo boolean;
  v_valor_unitario_produto numeric;
  v_funcionario_ativo boolean;
  v_qtd_etapas int;
  v_etapa_id uuid;
  v_operacao_id uuid;
  v_meta_periodo numeric;
  v_custo_hora_operacao numeric;
  v_apontamento apontamentos_producao;
  v_constraint_name text;
  v_parada record;
  v_motivo_parada_ativo boolean;
begin
  select id into v_usuario_id from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  select ativo into v_maquina_ativo from maquinas where id = p_maquina_id;
  if not found then
    raise exception 'Máquina % não encontrada', p_maquina_id;
  end if;
  if not v_maquina_ativo then
    raise exception 'Máquina % está inativa', p_maquina_id;
  end if;

  select ativo, valor_unitario into v_produto_ativo, v_valor_unitario_produto from produtos where id = p_produto_id;
  if not found then
    raise exception 'Produto % não encontrado', p_produto_id;
  end if;
  if not v_produto_ativo then
    raise exception 'Produto % está inativo', p_produto_id;
  end if;

  select ativo into v_funcionario_ativo from public.funcionarios_elegibilidade where id = p_funcionario_id;
  if not found then
    raise exception 'Funcionário % não encontrado', p_funcionario_id;
  end if;
  if not v_funcionario_ativo then
    raise exception 'Funcionário % está inativo', p_funcionario_id;
  end if;

  if p_quantidade_produzida is null or p_quantidade_produzida < 0 then
    raise exception 'Quantidade produzida inválida';
  end if;
  if p_quantidade_refugo is null or p_quantidade_refugo < 0 then
    raise exception 'Quantidade de refugo inválida';
  end if;
  if p_quantidade_refugo > p_quantidade_produzida then
    raise exception 'Quantidade de refugo (%) não pode ser maior que a quantidade produzida (%)', p_quantidade_refugo, p_quantidade_produzida;
  end if;

  select count(*) into v_qtd_etapas
  from roteiro_etapas re
  join roteiro_etapa_maquinas rem on rem.etapa_id = re.id
  where re.produto_id = p_produto_id and rem.maquina_id = p_maquina_id;

  if v_qtd_etapas = 0 then
    raise exception 'Nenhuma etapa do roteiro do produto % é elegível para a máquina % — verifique o cadastro do produto', p_produto_id, p_maquina_id;
  elsif v_qtd_etapas > 1 then
    raise exception 'Mais de uma etapa do roteiro do produto % é elegível para a máquina % — ambíguo, não é possível resolver automaticamente', p_produto_id, p_maquina_id;
  end if;

  select re.id, re.operacao_id into v_etapa_id, v_operacao_id
  from roteiro_etapas re
  join roteiro_etapa_maquinas rem on rem.etapa_id = re.id
  where re.produto_id = p_produto_id and rem.maquina_id = p_maquina_id;

  select case p_periodo_id
    when 'm1' then meta_m1
    when 'm2' then meta_m2
    when 'm3' then meta_m3
    when 't1' then meta_t1
    when 't2' then meta_t2
    when 't3' then meta_t3
    else null
  end into v_meta_periodo
  from roteiro_etapas where id = v_etapa_id;

  if v_meta_periodo is null or v_meta_periodo <= 0 then
    raise exception 'Meta não cadastrada (ou igual a zero) para este produto/operação no período % — não é possível registrar o apontamento', p_periodo_id;
  end if;

  v_custo_hora_operacao := calcular_custo_hora_operacao_vigente(v_operacao_id);

  select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
  if found then
    perform vincular_ocorrencias_encerradas_ao_apontamento(v_apontamento.id);
    return v_apontamento;
  end if;

  begin
    insert into apontamentos_producao (
      status, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id,
      data, hora_lancamento, quantidade_produzida, quantidade_refugo,
      periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente,
      custo_hora_operacao_vigente, valor_unitario_produto_vigente, idempotency_key, observacao, criado_por
    ) values (
      'produzindo', p_produto_id, v_etapa_id, v_operacao_id, p_maquina_id, p_funcionario_id, p_periodo_id,
      p_data, p_hora_lancamento, p_quantidade_produzida, p_quantidade_refugo,
      p_periodo_inicio, p_periodo_fim, v_meta_periodo,
      v_custo_hora_operacao, v_valor_unitario_produto, p_idempotency_key, p_observacao, v_usuario_id
    )
    returning * into v_apontamento;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'apontamentos_producao_idempotency_key_key' then
        select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
      elsif v_constraint_name = 'uq_apontamentos_producao_linha' then
        raise exception 'Já existe um lançamento da máquina % neste período (% de %) com o mesmo produto e operador — edite o existente ou lance outro produto/operador', p_maquina_id, p_periodo_id, p_data;
      else
        raise;
      end if;
  end;

  for v_parada in select * from jsonb_to_recordset(p_paradas) as x(motivo_id uuid, minutos numeric, descricao text)
  loop
    select ativo into v_motivo_parada_ativo from motivos_parada where id = v_parada.motivo_id;
    if not found then
      raise exception 'Motivo de parada % não encontrado', v_parada.motivo_id;
    end if;
    if not v_motivo_parada_ativo then
      raise exception 'Motivo de parada % está inativo', v_parada.motivo_id;
    end if;

    insert into apontamento_paradas (apontamento_id, motivo_id, minutos, descricao, criado_por)
    values (v_apontamento.id, v_parada.motivo_id, v_parada.minutos, v_parada.descricao, v_usuario_id);
  end loop;

  perform vincular_ocorrencias_encerradas_ao_apontamento(v_apontamento.id);

  return v_apontamento;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_sem_producao_core(p_maquina_id uuid, p_motivo_sem_producao text, p_idempotency_key uuid, p_descricao_sem_producao text, p_data date, p_hora_lancamento time without time zone, p_periodo_id text, p_periodo_inicio time without time zone, p_periodo_fim time without time zone)
 RETURNS apontamentos_producao
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_usuario_id uuid;
  v_maquina_ativo boolean;
  v_apontamento apontamentos_producao;
  v_constraint_name text;
begin
  select id into v_usuario_id from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  select ativo into v_maquina_ativo from maquinas where id = p_maquina_id;
  if not found then
    raise exception 'Máquina % não encontrada', p_maquina_id;
  end if;
  if not v_maquina_ativo then
    raise exception 'Máquina % está inativa', p_maquina_id;
  end if;

  if p_motivo_sem_producao is null then
    raise exception 'Motivo é obrigatório para registrar máquina sem produção';
  end if;
  if p_motivo_sem_producao not in ('sem_programacao', 'falta_material', 'falta_operador', 'manutencao_programada', 'outro') then
    raise exception 'Motivo % inválido', p_motivo_sem_producao;
  end if;
  if p_motivo_sem_producao = 'outro' and (p_descricao_sem_producao is null or length(trim(p_descricao_sem_producao)) = 0) then
    raise exception 'Descrição é obrigatória quando o motivo é "outro"';
  end if;

  select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
  if found then
    perform vincular_ocorrencias_encerradas_ao_apontamento(v_apontamento.id);
    return v_apontamento;
  end if;

  begin
    insert into apontamentos_producao (
      status, maquina_id, periodo_id, data, hora_lancamento,
      quantidade_produzida, quantidade_refugo,
      periodo_inicio_vigente, periodo_fim_vigente,
      motivo_sem_producao, descricao_sem_producao,
      idempotency_key, criado_por
    ) values (
      'sem_producao', p_maquina_id, p_periodo_id, p_data, p_hora_lancamento,
      0, 0,
      p_periodo_inicio, p_periodo_fim,
      p_motivo_sem_producao, p_descricao_sem_producao,
      p_idempotency_key, v_usuario_id
    )
    returning * into v_apontamento;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'apontamentos_producao_idempotency_key_key' then
        select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
      elsif v_constraint_name = 'uq_apontamentos_sem_producao' then
        raise exception 'Já existe um apontamento "sem produção" para a máquina % no período % de %', p_maquina_id, p_periodo_id, p_data;
      else
        raise;
      end if;
  end;

  perform vincular_ocorrencias_encerradas_ao_apontamento(v_apontamento.id);

  return v_apontamento;
end;
$function$;

commit;

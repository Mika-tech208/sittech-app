-- Sittech — schema PostgreSQL, migration 14
-- Produção Real V1 — vínculo retroativo: quando um apontamento_producao é
-- criado (produzindo ou sem_producao) DEPOIS de uma ocorrencias_maquina já
-- ter sido encerrada, a parada correspondente não existia até agora (o
-- vínculo só acontecia no sentido "ocorrência encerrada → apontamentos já
-- existentes", dentro de encerrar_ocorrencia_maquina). Esta migration
-- cobre o sentido oposto: "apontamento novo → ocorrências já encerradas".
--
-- `vincular_ocorrencias_encerradas_ao_apontamento(apontamento_id)` — nova
-- function auxiliar, mesma fórmula de interseção já usada em
-- encerrar_ocorrencia_maquina (migration 12), só invertida (parte do
-- apontamento, procura ocorrências, em vez de partir da ocorrência e
-- procurar apontamentos). NÃO calcula minutos — quem calcula é o trigger
-- calcular_intersecao_parada_ocorrencia (migration 9), disparado pelo
-- INSERT. `not exists` + captura de unique_violation garantem idempotência
-- (mesmo padrão de encerrar_ocorrencia_maquina): rodar de novo pro mesmo
-- apontamento nunca duplica parada.
--
-- registrar_apontamento_producao e registrar_sem_producao passam a chamar
-- essa function logo antes de retornar — tanto no caminho de idempotência
-- (idempotency_key repetida) quanto depois de um INSERT novo. Nenhuma
-- fórmula de custo/meta/período é tocada; nenhuma ocorrência é criada ou
-- alterada aqui — só leitura de ocorrencias_maquina e INSERT em
-- apontamento_paradas.

-- =========================================================================
-- 1) vincular_ocorrencias_encerradas_ao_apontamento
-- =========================================================================
create or replace function public.vincular_ocorrencias_encerradas_ao_apontamento(p_apontamento_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_apontamento record;
  v_ocorrencia record;
begin
  select maquina_id, data, periodo_inicio_vigente, periodo_fim_vigente, criado_por
    into v_apontamento
  from apontamentos_producao
  where id = p_apontamento_id;

  if not found then
    raise exception 'Apontamento % não encontrado', p_apontamento_id;
  end if;

  -- ocorrências da mesma máquina, já encerradas, cuja janela
  -- [aberta_em, encerrada_em] intersecta a janela do período deste
  -- apontamento — ocorrência ainda aberta nunca entra aqui (encerrada_em
  -- is not null é condição da própria query); sem interseção real, o
  -- comparador de intervalos exclui.
  for v_ocorrencia in
    select om.id, om.motivo_id, om.descricao
    from ocorrencias_maquina om
    where om.maquina_id = v_apontamento.maquina_id
      and om.encerrada_em is not null
      and least(om.encerrada_em, (v_apontamento.data + v_apontamento.periodo_fim_vigente) at time zone 'America/Sao_Paulo')
        > greatest(om.aberta_em, (v_apontamento.data + v_apontamento.periodo_inicio_vigente) at time zone 'America/Sao_Paulo')
      and not exists (
        select 1 from apontamento_paradas pp
        where pp.ocorrencia_id = om.id and pp.apontamento_id = p_apontamento_id
      )
  loop
    begin
      insert into apontamento_paradas (apontamento_id, motivo_id, ocorrencia_id, descricao, criado_por)
      values (p_apontamento_id, v_ocorrencia.motivo_id, v_ocorrencia.id, v_ocorrencia.descricao, v_apontamento.criado_por);
    exception
      when unique_violation then
        null; -- já vinculada — idempotência, segue pras outras
    end;
  end loop;
end;
$$;

revoke all on function public.vincular_ocorrencias_encerradas_ao_apontamento(uuid) from public, anon, authenticated, service_role;
grant execute on function public.vincular_ocorrencias_encerradas_ao_apontamento(uuid) to authenticated;

-- =========================================================================
-- 2) registrar_apontamento_producao — mesma regra de negócio de antes, só
--    chamando vincular_ocorrencias_encerradas_ao_apontamento antes de
--    retornar (nos dois caminhos: idempotência e insert novo).
-- =========================================================================
create or replace function public.registrar_apontamento_producao(
  p_maquina_id uuid,
  p_produto_id uuid,
  p_funcionario_id uuid,
  p_quantidade_produzida numeric,
  p_quantidade_refugo numeric,
  p_idempotency_key uuid,
  p_observacao text default null
)
returns public.apontamentos_producao
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;

  v_maquina_ativo boolean;
  v_produto_ativo boolean;
  v_funcionario_ativo boolean;

  v_agora timestamptz := now();
  v_hora_local time;
  v_data_local date;

  v_periodo_id text;
  v_periodo_inicio time;
  v_periodo_fim time;

  v_qtd_etapas int;
  v_etapa_id uuid;
  v_operacao_id uuid;

  v_meta_periodo numeric;

  v_horas_por_dia numeric;
  v_dias_uteis numeric;
  v_horas_produtivas_funcionario numeric;
  v_num_funcionarios_ativos int;
  v_total_horas_produtivas_empresa numeric;
  v_total_fixo numeric;
  v_total_custo_funcionarios_ativos numeric;
  v_rateio_por_hora numeric;
  v_custo_hora_empresa numeric;
  v_qtd_ativos_operacao int;
  v_total_hora_grupo numeric;
  v_custo_hora_operacao numeric;

  v_apontamento apontamentos_producao;
  v_constraint_name text;
begin
  -- 1) criado_por a partir do usuário autenticado — nunca do cliente
  select id into v_usuario_id from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  -- 2) máquina/produto/funcionário precisam existir e estar ativos
  select ativo into v_maquina_ativo from maquinas where id = p_maquina_id;
  if not found then
    raise exception 'Máquina % não encontrada', p_maquina_id;
  end if;
  if not v_maquina_ativo then
    raise exception 'Máquina % está inativa', p_maquina_id;
  end if;

  select ativo into v_produto_ativo from produtos where id = p_produto_id;
  if not found then
    raise exception 'Produto % não encontrado', p_produto_id;
  end if;
  if not v_produto_ativo then
    raise exception 'Produto % está inativo', p_produto_id;
  end if;

  select ativo into v_funcionario_ativo from funcionarios where id = p_funcionario_id;
  if not found then
    raise exception 'Funcionário % não encontrado', p_funcionario_id;
  end if;
  if not v_funcionario_ativo then
    raise exception 'Funcionário % está inativo', p_funcionario_id;
  end if;

  -- 3) quantidades
  if p_quantidade_produzida is null or p_quantidade_produzida < 0 then
    raise exception 'Quantidade produzida inválida';
  end if;
  if p_quantidade_refugo is null or p_quantidade_refugo < 0 then
    raise exception 'Quantidade de refugo inválida';
  end if;
  if p_quantidade_refugo > p_quantidade_produzida then
    raise exception 'Quantidade de refugo (%) não pode ser maior que a quantidade produzida (%)', p_quantidade_refugo, p_quantidade_produzida;
  end if;

  -- 4) data/hora do lançamento (horário local — mesma assunção da migration 9)
  v_hora_local := (v_agora at time zone 'America/Sao_Paulo')::time;
  v_data_local := (v_agora at time zone 'America/Sao_Paulo')::date;

  -- 5) período
  select periodo_id, periodo_inicio, periodo_fim into v_periodo_id, v_periodo_inicio, v_periodo_fim
  from resolver_periodo_por_horario(v_hora_local);

  -- 6) etapa/operação — só via elegibilidade real (roteiro_etapa_maquinas),
  --    nunca adivinhada
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

  -- 7) meta oficial do período (roteiro_etapas.meta_<periodo_id>)
  select case v_periodo_id
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
    raise exception 'Meta não cadastrada (ou igual a zero) para este produto/operação no período % — não é possível registrar o apontamento', v_periodo_id;
  end if;

  -- 8) custo/hora oficial da operação — reprodução exata de
  --    calcularCustoHoraEOperacoes (custo-hora/calculations.ts).
  select coalesce(sum(greatest(extract(epoch from (fim - inicio)), 0) / 3600), 0)
    into v_horas_por_dia
  from periodos;

  select dias_uteis into v_dias_uteis from configuracoes_empresa limit 1;
  if v_dias_uteis is null then
    raise exception 'Configuração de dias úteis não encontrada — não é possível calcular o custo/hora';
  end if;

  v_horas_produtivas_funcionario := v_horas_por_dia * v_dias_uteis;

  select count(*) into v_num_funcionarios_ativos from funcionarios where ativo = true;
  v_total_horas_produtivas_empresa := v_horas_produtivas_funcionario * v_num_funcionarios_ativos;

  select coalesce(sum(valor), 0) into v_total_fixo from fixed_costs where ativo = true;

  select coalesce(sum(f.salario_base + coalesce(fc.total_custos, 0)), 0)
    into v_total_custo_funcionarios_ativos
  from funcionarios f
  left join (
    select funcionario_id, sum(valor) as total_custos
    from funcionario_custos group by funcionario_id
  ) fc on fc.funcionario_id = f.id
  where f.ativo = true;

  if v_total_horas_produtivas_empresa > 0 then
    v_rateio_por_hora := v_total_fixo / v_total_horas_produtivas_empresa;
    v_custo_hora_empresa := (v_total_custo_funcionarios_ativos + v_total_fixo) / v_total_horas_produtivas_empresa;
  else
    v_rateio_por_hora := 0;
    v_custo_hora_empresa := 0;
  end if;

  select count(*) into v_qtd_ativos_operacao
  from funcionarios where ativo = true and operacao_id = v_operacao_id;

  if v_qtd_ativos_operacao = 0 then
    v_custo_hora_operacao := v_custo_hora_empresa;
  else
    select coalesce(sum(
      (case when v_horas_produtivas_funcionario > 0
        then (f.salario_base + coalesce(fc.total_custos, 0)) / v_horas_produtivas_funcionario
        else 0
      end) + v_rateio_por_hora
    ), 0)
    into v_total_hora_grupo
    from funcionarios f
    left join (
      select funcionario_id, sum(valor) as total_custos
      from funcionario_custos group by funcionario_id
    ) fc on fc.funcionario_id = f.id
    where f.ativo = true and f.operacao_id = v_operacao_id;

    v_custo_hora_operacao := v_total_hora_grupo / v_qtd_ativos_operacao;
  end if;

  -- 9) idempotência — se já existe, ainda assim tenta o vínculo retroativo
  --    antes de devolver (pode existir ocorrência encerrada depois da
  --    primeira chamada e antes deste retry; not exists garante que não
  --    duplica nada do que já foi vinculado)
  select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
  if found then
    perform vincular_ocorrencias_encerradas_ao_apontamento(v_apontamento.id);
    return v_apontamento;
  end if;

  -- 10) grava — status='produzindo' explícito
  begin
    insert into apontamentos_producao (
      status, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id,
      data, hora_lancamento, quantidade_produzida, quantidade_refugo,
      periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente,
      custo_hora_operacao_vigente, idempotency_key, observacao, criado_por
    ) values (
      'produzindo', p_produto_id, v_etapa_id, v_operacao_id, p_maquina_id, p_funcionario_id, v_periodo_id,
      v_data_local, v_hora_local, p_quantidade_produzida, p_quantidade_refugo,
      v_periodo_inicio, v_periodo_fim, v_meta_periodo,
      v_custo_hora_operacao, p_idempotency_key, p_observacao, v_usuario_id
    )
    returning * into v_apontamento;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'apontamentos_producao_idempotency_key_key' then
        select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
      elsif v_constraint_name = 'apontamentos_producao_maquina_id_data_periodo_id_key' then
        raise exception 'Já existe um apontamento para a máquina % no período % de % — a V1 permite só um fechamento por máquina/dia/período', p_maquina_id, v_periodo_id, v_data_local;
      else
        raise;
      end if;
  end;

  -- 11) vínculo retroativo com ocorrências já encerradas que intersectam
  --     este período (NÃO calcula minutos — o trigger de interseção calcula)
  perform vincular_ocorrencias_encerradas_ao_apontamento(v_apontamento.id);

  return v_apontamento;
end;
$$;

revoke all on function public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text) to authenticated;

-- =========================================================================
-- 3) registrar_sem_producao — mesma adição.
-- =========================================================================
create or replace function public.registrar_sem_producao(
  p_maquina_id uuid,
  p_motivo_sem_producao text,
  p_idempotency_key uuid,
  p_descricao_sem_producao text default null
)
returns public.apontamentos_producao
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_maquina_ativo boolean;

  v_agora timestamptz := now();
  v_hora_local time;
  v_data_local date;

  v_periodo_id text;
  v_periodo_inicio time;
  v_periodo_fim time;

  v_apontamento apontamentos_producao;
  v_constraint_name text;
begin
  -- criado_por a partir do usuário autenticado — nunca do cliente
  select id into v_usuario_id from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  -- máquina precisa existir e estar ativa
  select ativo into v_maquina_ativo from maquinas where id = p_maquina_id;
  if not found then
    raise exception 'Máquina % não encontrada', p_maquina_id;
  end if;
  if not v_maquina_ativo then
    raise exception 'Máquina % está inativa', p_maquina_id;
  end if;

  -- motivo obrigatório e válido
  if p_motivo_sem_producao is null then
    raise exception 'Motivo é obrigatório para registrar máquina sem produção';
  end if;
  if p_motivo_sem_producao not in ('sem_programacao', 'falta_material', 'falta_operador', 'manutencao_programada', 'outro') then
    raise exception 'Motivo % inválido', p_motivo_sem_producao;
  end if;
  if p_motivo_sem_producao = 'outro' and (p_descricao_sem_producao is null or length(trim(p_descricao_sem_producao)) = 0) then
    raise exception 'Descrição é obrigatória quando o motivo é "outro"';
  end if;

  -- data/hora do lançamento
  v_hora_local := (v_agora at time zone 'America/Sao_Paulo')::time;
  v_data_local := (v_agora at time zone 'America/Sao_Paulo')::date;

  -- período — mesma resolução (e mesma janela de fechamento) da RPC de produção
  select periodo_id, periodo_inicio, periodo_fim into v_periodo_id, v_periodo_inicio, v_periodo_fim
  from resolver_periodo_por_horario(v_hora_local);

  -- idempotência — mesmo tratamento: tenta vínculo retroativo antes de devolver
  select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
  if found then
    perform vincular_ocorrencias_encerradas_ao_apontamento(v_apontamento.id);
    return v_apontamento;
  end if;

  -- grava — status='sem_producao', quantidades 0/0, sem produto/etapa/
  -- operação/funcionário/meta/custo (nunca inventados)
  begin
    insert into apontamentos_producao (
      status, maquina_id, periodo_id, data, hora_lancamento,
      quantidade_produzida, quantidade_refugo,
      periodo_inicio_vigente, periodo_fim_vigente,
      motivo_sem_producao, descricao_sem_producao,
      idempotency_key, criado_por
    ) values (
      'sem_producao', p_maquina_id, v_periodo_id, v_data_local, v_hora_local,
      0, 0,
      v_periodo_inicio, v_periodo_fim,
      p_motivo_sem_producao, p_descricao_sem_producao,
      p_idempotency_key, v_usuario_id
    )
    returning * into v_apontamento;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'apontamentos_producao_idempotency_key_key' then
        select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
      elsif v_constraint_name = 'apontamentos_producao_maquina_id_data_periodo_id_key' then
        raise exception 'Já existe um apontamento para a máquina % no período % de % — a V1 permite só um fechamento por máquina/dia/período', p_maquina_id, v_periodo_id, v_data_local;
      else
        raise;
      end if;
  end;

  -- vínculo retroativo com ocorrências já encerradas que intersectam este período
  perform vincular_ocorrencias_encerradas_ao_apontamento(v_apontamento.id);

  return v_apontamento;
end;
$$;

revoke all on function public.registrar_sem_producao(uuid, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_sem_producao(uuid, text, uuid, text) to authenticated;

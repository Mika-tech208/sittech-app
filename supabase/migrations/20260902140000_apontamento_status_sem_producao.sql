-- Sittech — schema PostgreSQL, migration 11
-- Produção Real V1 — fecha uma lacuna da V1: hoje não existe forma de
-- registrar "esta máquina não produziu neste período" — toda linha de
-- apontamentos_producao presume produção real de um produto. Isso é
-- inviável na prática (máquina parada por falta de programação/material/
-- operador, ou manutenção programada, também precisa "fechar" o período).
--
-- `apontamentos_producao` passa a ter dois estados via a nova coluna
-- `status`:
--   * 'produzindo' (default, comportamento atual inalterado) — exige
--     produto_id/etapa_id/operacao_id/funcionario_id/meta_periodo_vigente/
--     custo_hora_operacao_vigente, exatamente como antes.
--   * 'sem_producao' — esses mesmos 6 campos passam a ser NULL (nunca
--     inventados/adivinhados), quantidade_produzida/quantidade_refugo são
--     forçadas a 0 (não é um valor "inventado": é o valor correto e único
--     possível pra "não produziu nada"), e motivo_sem_producao passa a ser
--     obrigatório (com descrição obrigatória quando o motivo é 'outro').
--
-- máquina, data, período, snapshot de início/fim do período, criado_por e
-- idempotency_key continuam obrigatórios nos dois estados —
-- unique(maquina_id, data, periodo_id) da migration 9 é preservado sem
-- alteração: um período de uma máquina só fecha uma vez, seja com produção
-- ou sem.
--
-- Toda a validação condicional por status é feita via CHECK constraints
-- (todas as colunas envolvidas estão na mesma linha — não precisa de
-- trigger). Nenhum cálculo de custo é alterado; os generated columns
-- (migration 9) continuam exatamente como estavam — com
-- custo_hora_operacao_vigente/meta_periodo_vigente NULL em sem_producao,
-- eles resolvem sozinhos pra NULL (aritmética/CASE com NULL já se
-- comporta assim, sem precisar mudar a definição deles).

-- =========================================================================
-- 1) Novas colunas + relaxamento das NOT NULL que passam a ser condicionais
-- =========================================================================
alter table apontamentos_producao
  add column status text not null default 'produzindo'
    check (status in ('produzindo', 'sem_producao')),
  add column motivo_sem_producao text
    check (motivo_sem_producao in ('sem_programacao', 'falta_material', 'falta_operador', 'manutencao_programada', 'outro')),
  add column descricao_sem_producao text;

alter table apontamentos_producao alter column produto_id drop not null;
alter table apontamentos_producao alter column etapa_id drop not null;
alter table apontamentos_producao alter column operacao_id drop not null;
alter table apontamentos_producao alter column funcionario_id drop not null;
alter table apontamentos_producao alter column meta_periodo_vigente drop not null;
alter table apontamentos_producao alter column custo_hora_operacao_vigente drop not null;

-- produzindo exige os 6 campos; sem_producao proíbe os 6 (nunca inventados)
alter table apontamentos_producao add constraint apontamentos_producao_status_campos_check check (
  (status = 'produzindo'
    and produto_id is not null and etapa_id is not null and operacao_id is not null
    and funcionario_id is not null and meta_periodo_vigente is not null and custo_hora_operacao_vigente is not null)
  or
  (status = 'sem_producao'
    and produto_id is null and etapa_id is null and operacao_id is null
    and funcionario_id is null and meta_periodo_vigente is null and custo_hora_operacao_vigente is null)
);

-- sem_producao força quantidade 0/0 (valor correto, não "inventado")
alter table apontamentos_producao add constraint apontamentos_producao_sem_producao_quantidades_check check (
  status = 'produzindo' or (quantidade_produzida = 0 and quantidade_refugo = 0)
);

-- motivo obrigatório só (e sempre) em sem_producao
-- (nome diferente do check de valores válidos que a cláusula ADD COLUMN
-- acima já gerou automaticamente como apontamentos_producao_motivo_sem_producao_check)
alter table apontamentos_producao add constraint apontamentos_producao_status_motivo_check check (
  (status = 'sem_producao') = (motivo_sem_producao is not null)
);

-- motivo 'outro' exige descrição não vazia
alter table apontamentos_producao add constraint apontamentos_producao_motivo_outro_descricao_check check (
  motivo_sem_producao is distinct from 'outro'
  or (descricao_sem_producao is not null and length(trim(descricao_sem_producao)) > 0)
);

-- descrição de sem_producao não sobra em produzindo
alter table apontamentos_producao add constraint apontamentos_producao_descricao_sem_producao_status_check check (
  status = 'sem_producao' or descricao_sem_producao is null
);

-- =========================================================================
-- 2) Resolução de período por horário — extraída pra function própria
--    (antes duplicada inline dentro de registrar_apontamento_producao) pra
--    registrar_sem_producao usar a MESMA lógica sem divergir dela.
--    Mesmo comportamento de antes: janela de fechamento de ~10min após o
--    fim de um período tem prioridade sobre o período que já começou;
--    ambiguidade ou horário fora de qualquer período = erro claro.
-- =========================================================================
create or replace function public.resolver_periodo_por_horario(p_hora_local time)
returns table(periodo_id text, periodo_inicio time, periodo_fim time)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_qtd_grace int;
  v_qtd_normal int;
begin
  select count(*) into v_qtd_grace
  from periodos where p_hora_local >= fim and p_hora_local < fim + interval '10 minutes';

  if v_qtd_grace > 1 then
    raise exception 'Mais de um período em janela de fechamento simultânea ao horário % — não é possível resolver automaticamente', p_hora_local;
  elsif v_qtd_grace = 1 then
    return query
      select p.id, p.inicio, p.fim from periodos p
      where p_hora_local >= p.fim and p_hora_local < p.fim + interval '10 minutes';
    return;
  end if;

  select count(*) into v_qtd_normal
  from periodos where p_hora_local >= inicio and p_hora_local < fim;

  if v_qtd_normal > 1 then
    raise exception 'Mais de um período cadastrado cobre o horário % — não é possível resolver automaticamente', p_hora_local;
  elsif v_qtd_normal = 1 then
    return query
      select p.id, p.inicio, p.fim from periodos p
      where p_hora_local >= p.inicio and p_hora_local < p.fim;
    return;
  end if;

  raise exception 'Horário % não está dentro de nenhum período cadastrado', p_hora_local;
end;
$$;

revoke all on function public.resolver_periodo_por_horario(time) from public, anon, authenticated, service_role;
grant execute on function public.resolver_periodo_por_horario(time) to authenticated;

-- =========================================================================
-- 3) registrar_apontamento_producao — mesma regra de negócio de antes,
--    só passa a usar resolver_periodo_por_horario() em vez da lógica
--    inline, e grava status='produzindo' explicitamente.
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

  -- 9) idempotência
  select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
  if found then
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

  return v_apontamento;
end;
$$;

revoke all on function public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text) to authenticated;

-- =========================================================================
-- 4) registrar_sem_producao — RPC separada e simples, em vez de sobrecarregar
--    registrar_apontamento_producao com parâmetros opcionais condicionais.
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

  -- idempotência
  select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
  if found then
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

  return v_apontamento;
end;
$$;

revoke all on function public.registrar_sem_producao(uuid, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_sem_producao(uuid, text, uuid, text) to authenticated;

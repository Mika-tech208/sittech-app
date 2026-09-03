-- Sittech — schema PostgreSQL, migration 15
-- Produção Real V1 — três coisas, todas só backend (nenhuma tela ainda):
--
--   1) Lançamento retroativo: registrar_apontamento_producao_retroativo e
--      registrar_sem_producao_retroativo — mesma regra de negócio das duas
--      RPCs automáticas (registrar_apontamento_producao/registrar_sem_producao,
--      que continuam com a MESMA assinatura de antes, sem quebrar nada já
--      integrado no frontend), só que com data+periodo_id informados
--      explicitamente em vez de resolvidos por now(). O horário de
--      início/fim do período vem sempre de `periodos` (nunca inventado) —
--      "retroativo" só escolhe QUAL período/dia, nunca UM HORÁRIO.
--
--   2) Edição auditável: editar_apontamento_producao e
--      editar_apontamento_sem_producao, com histórico obrigatório em
--      apontamento_producao_historico (antes/depois/quem/quando).
--
--   3) Índices de apoio pra tela futura "Apontamentos realizados" (filtro
--      por funcionário e por status, que ainda não tinham índice).
--
-- Como evitar duplicar a regra (decisão tomada antes de escrever isto):
--   * A lógica de negócio das duas RPCs automáticas foi extraída pra
--     registrar_apontamento_producao_core / registrar_sem_producao_core
--     — recebem o período JÁ resolvido (id/inicio/fim) como parâmetro, não
--     recalculam nada de tempo. registrar_apontamento_producao (automática)
--     e registrar_apontamento_producao_retroativo (explícita) só resolvem
--     o período cada uma do seu jeito e chamam a mesma core. Idêntico pro
--     par sem_producao / sem_producao_core / sem_producao_retroativo.
--   * O cálculo de custo/hora oficial da operação (reprodução de
--     calcularCustoHoraEOperacoes) virou a function própria
--     calcular_custo_hora_operacao_vigente(operacao_id) — chamada pela
--     core de registrar_apontamento_producao E por editar_apontamento_producao
--     quando o produto muda. Não duplica o bloco de ~30 linhas pela
--     terceira vez. A FÓRMULA em si não muda em nenhum lugar — só onde
--     ela mora.
--
-- Decisão de negócio que tomei sem perguntar, documentada aqui pra
-- revisão (nenhuma outra ficou em aberto): "não permitir data futura" foi
-- lido como "não permitir data futura NEM o período de hoje que ainda não
-- terminou" — lançamento retroativo é sempre de um período que já
-- aconteceu. Se a intenção era só bloquear dia futuro (permitindo
-- pré-lançar o período de hoje antes dele acabar), é só remover o segundo
-- check de cada RPC _retroativo.

-- =========================================================================
-- 1) apontamento_producao_historico — append-only, mesma postura de
--    `auditoria` (migration 3): authenticated pode ler e inserir, nunca
--    atualizar nem apagar.
-- =========================================================================
create table public.apontamento_producao_historico (
  id uuid primary key default gen_random_uuid(),
  apontamento_id uuid not null references public.apontamentos_producao(id) on delete cascade,
  dados_anteriores jsonb not null,
  dados_novos jsonb not null,
  alterado_por uuid not null references public.usuarios(id) on delete restrict,
  alterado_em timestamptz not null default now()
);
create index idx_apontamento_producao_historico_apontamento on public.apontamento_producao_historico(apontamento_id);

alter table public.apontamento_producao_historico enable row level security;

create policy usuario_ativo_full_access on public.apontamento_producao_historico
  for select to authenticated using (public.is_usuario_ativo());
create policy usuario_ativo_insert on public.apontamento_producao_historico
  for insert to authenticated with check (public.is_usuario_ativo());

grant select, insert on public.apontamento_producao_historico to authenticated;

-- =========================================================================
-- 2) Índices de apoio pra "Apontamentos realizados" — filtro por
--    funcionário e por status ainda não tinham índice próprio (data,
--    produto_id+data, etapa_id+periodo_id+data e o unique
--    maquina_id+data+periodo_id já cobrem os outros filtros pedidos).
-- =========================================================================
create index idx_apontamentos_producao_funcionario on public.apontamentos_producao(funcionario_id, data);
create index idx_apontamentos_producao_status on public.apontamentos_producao(status, data);

-- =========================================================================
-- 3) calcular_custo_hora_operacao_vigente — extraído de dentro de
--    registrar_apontamento_producao (migration 10/14) pra reaproveitar
--    aqui sem duplicar. Reprodução EXATA de calcularCustoHoraEOperacoes
--    (custo-hora/calculations.ts) — mesma fórmula, só que agora reutilizável.
-- =========================================================================
create or replace function public.calcular_custo_hora_operacao_vigente(p_operacao_id uuid)
returns numeric
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
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
begin
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
  from funcionarios where ativo = true and operacao_id = p_operacao_id;

  if v_qtd_ativos_operacao = 0 then
    return v_custo_hora_empresa;
  end if;

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
  where f.ativo = true and f.operacao_id = p_operacao_id;

  return v_total_hora_grupo / v_qtd_ativos_operacao;
end;
$$;

revoke all on function public.calcular_custo_hora_operacao_vigente(uuid) from public, anon, authenticated, service_role;
grant execute on function public.calcular_custo_hora_operacao_vigente(uuid) to authenticated;

-- =========================================================================
-- 4) registrar_apontamento_producao_core — toda a regra de negócio,
--    recebendo o período JÁ resolvido (nunca calcula now() nem período).
-- =========================================================================
create or replace function public.registrar_apontamento_producao_core(
  p_maquina_id uuid,
  p_produto_id uuid,
  p_funcionario_id uuid,
  p_quantidade_produzida numeric,
  p_quantidade_refugo numeric,
  p_idempotency_key uuid,
  p_observacao text,
  p_data date,
  p_hora_lancamento time,
  p_periodo_id text,
  p_periodo_inicio time,
  p_periodo_fim time
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
  v_qtd_etapas int;
  v_etapa_id uuid;
  v_operacao_id uuid;
  v_meta_periodo numeric;
  v_custo_hora_operacao numeric;
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
      custo_hora_operacao_vigente, idempotency_key, observacao, criado_por
    ) values (
      'produzindo', p_produto_id, v_etapa_id, v_operacao_id, p_maquina_id, p_funcionario_id, p_periodo_id,
      p_data, p_hora_lancamento, p_quantidade_produzida, p_quantidade_refugo,
      p_periodo_inicio, p_periodo_fim, v_meta_periodo,
      v_custo_hora_operacao, p_idempotency_key, p_observacao, v_usuario_id
    )
    returning * into v_apontamento;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'apontamentos_producao_idempotency_key_key' then
        select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
      elsif v_constraint_name = 'apontamentos_producao_maquina_id_data_periodo_id_key' then
        raise exception 'Já existe um apontamento para a máquina % no período % de % — a V1 permite só um fechamento por máquina/dia/período', p_maquina_id, p_periodo_id, p_data;
      else
        raise;
      end if;
  end;

  perform vincular_ocorrencias_encerradas_ao_apontamento(v_apontamento.id);

  return v_apontamento;
end;
$$;

revoke all on function public.registrar_apontamento_producao_core(uuid, uuid, uuid, numeric, numeric, uuid, text, date, time, text, time, time) from public, anon, authenticated, service_role;
grant execute on function public.registrar_apontamento_producao_core(uuid, uuid, uuid, numeric, numeric, uuid, text, date, time, text, time, time) to authenticated;

-- =========================================================================
-- 5) registrar_apontamento_producao — MESMA assinatura de antes (migration
--    14), agora só resolve o período automático e delega pra core.
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
  v_agora timestamptz := now();
  v_hora_local time;
  v_data_local date;
  v_periodo_id text;
  v_periodo_inicio time;
  v_periodo_fim time;
begin
  v_hora_local := (v_agora at time zone 'America/Sao_Paulo')::time;
  v_data_local := (v_agora at time zone 'America/Sao_Paulo')::date;

  select periodo_id, periodo_inicio, periodo_fim into v_periodo_id, v_periodo_inicio, v_periodo_fim
  from resolver_periodo_por_horario(v_hora_local);

  return registrar_apontamento_producao_core(
    p_maquina_id, p_produto_id, p_funcionario_id, p_quantidade_produzida, p_quantidade_refugo,
    p_idempotency_key, p_observacao, v_data_local, v_hora_local, v_periodo_id, v_periodo_inicio, v_periodo_fim
  );
end;
$$;

revoke all on function public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text) to authenticated;

-- =========================================================================
-- 6) registrar_apontamento_producao_retroativo — data + periodo_id
--    explícitos; horário vem sempre de `periodos`, nunca informado. Bloqueia
--    data futura e período de hoje que ainda não terminou (ver decisão no
--    topo do arquivo).
-- =========================================================================
create or replace function public.registrar_apontamento_producao_retroativo(
  p_maquina_id uuid,
  p_produto_id uuid,
  p_funcionario_id uuid,
  p_quantidade_produzida numeric,
  p_quantidade_refugo numeric,
  p_idempotency_key uuid,
  p_data date,
  p_periodo_id text,
  p_observacao text default null
)
returns public.apontamentos_producao
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_hora_atual time := (now() at time zone 'America/Sao_Paulo')::time;
  v_periodo_inicio time;
  v_periodo_fim time;
begin
  if p_data is null then
    raise exception 'Data é obrigatória para lançamento retroativo';
  end if;
  if p_data > v_hoje then
    raise exception 'Não é possível lançar um apontamento para uma data futura (%)', p_data;
  end if;

  select inicio, fim into v_periodo_inicio, v_periodo_fim from periodos where id = p_periodo_id;
  if not found then
    raise exception 'Período % não encontrado', p_periodo_id;
  end if;

  if p_data = v_hoje and v_periodo_fim > v_hora_atual then
    raise exception 'O período % de hoje ainda não terminou — use o lançamento automático', p_periodo_id;
  end if;

  return registrar_apontamento_producao_core(
    p_maquina_id, p_produto_id, p_funcionario_id, p_quantidade_produzida, p_quantidade_refugo,
    p_idempotency_key, p_observacao, p_data, v_hora_atual, p_periodo_id, v_periodo_inicio, v_periodo_fim
  );
end;
$$;

revoke all on function public.registrar_apontamento_producao_retroativo(uuid, uuid, uuid, numeric, numeric, uuid, date, text, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_apontamento_producao_retroativo(uuid, uuid, uuid, numeric, numeric, uuid, date, text, text) to authenticated;

-- =========================================================================
-- 7) registrar_sem_producao_core
-- =========================================================================
create or replace function public.registrar_sem_producao_core(
  p_maquina_id uuid,
  p_motivo_sem_producao text,
  p_idempotency_key uuid,
  p_descricao_sem_producao text,
  p_data date,
  p_hora_lancamento time,
  p_periodo_id text,
  p_periodo_inicio time,
  p_periodo_fim time
)
returns public.apontamentos_producao
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
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
      elsif v_constraint_name = 'apontamentos_producao_maquina_id_data_periodo_id_key' then
        raise exception 'Já existe um apontamento para a máquina % no período % de % — a V1 permite só um fechamento por máquina/dia/período', p_maquina_id, p_periodo_id, p_data;
      else
        raise;
      end if;
  end;

  perform vincular_ocorrencias_encerradas_ao_apontamento(v_apontamento.id);

  return v_apontamento;
end;
$$;

revoke all on function public.registrar_sem_producao_core(uuid, text, uuid, text, date, time, text, time, time) from public, anon, authenticated, service_role;
grant execute on function public.registrar_sem_producao_core(uuid, text, uuid, text, date, time, text, time, time) to authenticated;

-- =========================================================================
-- 8) registrar_sem_producao — MESMA assinatura de antes.
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
  v_agora timestamptz := now();
  v_hora_local time;
  v_data_local date;
  v_periodo_id text;
  v_periodo_inicio time;
  v_periodo_fim time;
begin
  v_hora_local := (v_agora at time zone 'America/Sao_Paulo')::time;
  v_data_local := (v_agora at time zone 'America/Sao_Paulo')::date;

  select periodo_id, periodo_inicio, periodo_fim into v_periodo_id, v_periodo_inicio, v_periodo_fim
  from resolver_periodo_por_horario(v_hora_local);

  return registrar_sem_producao_core(
    p_maquina_id, p_motivo_sem_producao, p_idempotency_key, p_descricao_sem_producao,
    v_data_local, v_hora_local, v_periodo_id, v_periodo_inicio, v_periodo_fim
  );
end;
$$;

revoke all on function public.registrar_sem_producao(uuid, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_sem_producao(uuid, text, uuid, text) to authenticated;

-- =========================================================================
-- 9) registrar_sem_producao_retroativo
-- =========================================================================
create or replace function public.registrar_sem_producao_retroativo(
  p_maquina_id uuid,
  p_motivo_sem_producao text,
  p_idempotency_key uuid,
  p_data date,
  p_periodo_id text,
  p_descricao_sem_producao text default null
)
returns public.apontamentos_producao
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_hora_atual time := (now() at time zone 'America/Sao_Paulo')::time;
  v_periodo_inicio time;
  v_periodo_fim time;
begin
  if p_data is null then
    raise exception 'Data é obrigatória para lançamento retroativo';
  end if;
  if p_data > v_hoje then
    raise exception 'Não é possível lançar um apontamento para uma data futura (%)', p_data;
  end if;

  select inicio, fim into v_periodo_inicio, v_periodo_fim from periodos where id = p_periodo_id;
  if not found then
    raise exception 'Período % não encontrado', p_periodo_id;
  end if;

  if p_data = v_hoje and v_periodo_fim > v_hora_atual then
    raise exception 'O período % de hoje ainda não terminou — use o lançamento automático', p_periodo_id;
  end if;

  return registrar_sem_producao_core(
    p_maquina_id, p_motivo_sem_producao, p_idempotency_key, p_descricao_sem_producao,
    p_data, v_hora_atual, p_periodo_id, v_periodo_inicio, v_periodo_fim
  );
end;
$$;

revoke all on function public.registrar_sem_producao_retroativo(uuid, text, uuid, date, text, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_sem_producao_retroativo(uuid, text, uuid, date, text, text) to authenticated;

-- =========================================================================
-- 10) editar_apontamento_producao — máquina/data/período NUNCA mudam
--     nesta V1. Se produto mudar, reresolve etapa/operação (mesma máquina)
--     e recongela meta/custo; se não mudar, meta/custo ficam como
--     estavam (não recongela à toa por causa de um edit não relacionado,
--     ex.: só corrigir a quantidade). Não muda status. Histórico
--     obrigatório, atômico com o UPDATE (mesma function = mesma
--     transação).
-- =========================================================================
create or replace function public.editar_apontamento_producao(
  p_apontamento_id uuid,
  p_produto_id uuid,
  p_funcionario_id uuid,
  p_quantidade_produzida numeric,
  p_quantidade_refugo numeric,
  p_observacao text default null
)
returns public.apontamentos_producao
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_atual apontamentos_producao;
  v_produto_ativo boolean;
  v_funcionario_ativo boolean;
  v_qtd_etapas int;
  v_etapa_id uuid;
  v_operacao_id uuid;
  v_meta_periodo numeric;
  v_custo_hora_operacao numeric;
  v_dados_anteriores jsonb;
  v_dados_novos jsonb;
  v_atualizado apontamentos_producao;
begin
  select id into v_usuario_id from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  select * into v_atual from apontamentos_producao where id = p_apontamento_id;
  if not found then
    raise exception 'Apontamento % não encontrado', p_apontamento_id;
  end if;
  if v_atual.status <> 'produzindo' then
    raise exception 'Este apontamento não é do tipo "produzindo" — use editar_apontamento_sem_producao';
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

  if p_quantidade_produzida is null or p_quantidade_produzida < 0 then
    raise exception 'Quantidade produzida inválida';
  end if;
  if p_quantidade_refugo is null or p_quantidade_refugo < 0 then
    raise exception 'Quantidade de refugo inválida';
  end if;
  if p_quantidade_refugo > p_quantidade_produzida then
    raise exception 'Quantidade de refugo (%) não pode ser maior que a quantidade produzida (%)', p_quantidade_refugo, p_quantidade_produzida;
  end if;

  if p_produto_id <> v_atual.produto_id then
    select count(*) into v_qtd_etapas
    from roteiro_etapas re
    join roteiro_etapa_maquinas rem on rem.etapa_id = re.id
    where re.produto_id = p_produto_id and rem.maquina_id = v_atual.maquina_id;

    if v_qtd_etapas = 0 then
      raise exception 'Nenhuma etapa do roteiro do produto % é elegível para a máquina % — verifique o cadastro do produto', p_produto_id, v_atual.maquina_id;
    elsif v_qtd_etapas > 1 then
      raise exception 'Mais de uma etapa do roteiro do produto % é elegível para a máquina % — ambíguo, não é possível resolver automaticamente', p_produto_id, v_atual.maquina_id;
    end if;

    select re.id, re.operacao_id into v_etapa_id, v_operacao_id
    from roteiro_etapas re
    join roteiro_etapa_maquinas rem on rem.etapa_id = re.id
    where re.produto_id = p_produto_id and rem.maquina_id = v_atual.maquina_id;

    select case v_atual.periodo_id
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
      raise exception 'Meta não cadastrada (ou igual a zero) para este produto/operação no período % — não é possível editar o apontamento', v_atual.periodo_id;
    end if;

    v_custo_hora_operacao := calcular_custo_hora_operacao_vigente(v_operacao_id);
  else
    v_etapa_id := v_atual.etapa_id;
    v_operacao_id := v_atual.operacao_id;
    v_meta_periodo := v_atual.meta_periodo_vigente;
    v_custo_hora_operacao := v_atual.custo_hora_operacao_vigente;
  end if;

  v_dados_anteriores := jsonb_build_object(
    'produto_id', v_atual.produto_id,
    'etapa_id', v_atual.etapa_id,
    'operacao_id', v_atual.operacao_id,
    'funcionario_id', v_atual.funcionario_id,
    'quantidade_produzida', v_atual.quantidade_produzida,
    'quantidade_refugo', v_atual.quantidade_refugo,
    'observacao', v_atual.observacao,
    'meta_periodo_vigente', v_atual.meta_periodo_vigente,
    'custo_hora_operacao_vigente', v_atual.custo_hora_operacao_vigente
  );

  update apontamentos_producao set
    produto_id = p_produto_id,
    etapa_id = v_etapa_id,
    operacao_id = v_operacao_id,
    funcionario_id = p_funcionario_id,
    quantidade_produzida = p_quantidade_produzida,
    quantidade_refugo = p_quantidade_refugo,
    observacao = p_observacao,
    meta_periodo_vigente = v_meta_periodo,
    custo_hora_operacao_vigente = v_custo_hora_operacao
  where id = p_apontamento_id
  returning * into v_atualizado;

  v_dados_novos := jsonb_build_object(
    'produto_id', v_atualizado.produto_id,
    'etapa_id', v_atualizado.etapa_id,
    'operacao_id', v_atualizado.operacao_id,
    'funcionario_id', v_atualizado.funcionario_id,
    'quantidade_produzida', v_atualizado.quantidade_produzida,
    'quantidade_refugo', v_atualizado.quantidade_refugo,
    'observacao', v_atualizado.observacao,
    'meta_periodo_vigente', v_atualizado.meta_periodo_vigente,
    'custo_hora_operacao_vigente', v_atualizado.custo_hora_operacao_vigente
  );

  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por)
  values (p_apontamento_id, v_dados_anteriores, v_dados_novos, v_usuario_id);

  return v_atualizado;
end;
$$;

revoke all on function public.editar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.editar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, text) to authenticated;

-- =========================================================================
-- 11) editar_apontamento_sem_producao
-- =========================================================================
create or replace function public.editar_apontamento_sem_producao(
  p_apontamento_id uuid,
  p_motivo_sem_producao text,
  p_descricao_sem_producao text default null
)
returns public.apontamentos_producao
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_atual apontamentos_producao;
  v_atualizado apontamentos_producao;
  v_dados_anteriores jsonb;
  v_dados_novos jsonb;
begin
  select id into v_usuario_id from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  select * into v_atual from apontamentos_producao where id = p_apontamento_id;
  if not found then
    raise exception 'Apontamento % não encontrado', p_apontamento_id;
  end if;
  if v_atual.status <> 'sem_producao' then
    raise exception 'Este apontamento não é do tipo "sem_producao" — use editar_apontamento_producao';
  end if;

  if p_motivo_sem_producao is null then
    raise exception 'Motivo é obrigatório';
  end if;
  if p_motivo_sem_producao not in ('sem_programacao', 'falta_material', 'falta_operador', 'manutencao_programada', 'outro') then
    raise exception 'Motivo % inválido', p_motivo_sem_producao;
  end if;
  if p_motivo_sem_producao = 'outro' and (p_descricao_sem_producao is null or length(trim(p_descricao_sem_producao)) = 0) then
    raise exception 'Descrição é obrigatória quando o motivo é "outro"';
  end if;

  v_dados_anteriores := jsonb_build_object(
    'motivo_sem_producao', v_atual.motivo_sem_producao,
    'descricao_sem_producao', v_atual.descricao_sem_producao
  );

  update apontamentos_producao set
    motivo_sem_producao = p_motivo_sem_producao,
    descricao_sem_producao = p_descricao_sem_producao
  where id = p_apontamento_id
  returning * into v_atualizado;

  v_dados_novos := jsonb_build_object(
    'motivo_sem_producao', v_atualizado.motivo_sem_producao,
    'descricao_sem_producao', v_atualizado.descricao_sem_producao
  );

  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por)
  values (p_apontamento_id, v_dados_anteriores, v_dados_novos, v_usuario_id);

  return v_atualizado;
end;
$$;

revoke all on function public.editar_apontamento_sem_producao(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.editar_apontamento_sem_producao(uuid, text, text) to authenticated;

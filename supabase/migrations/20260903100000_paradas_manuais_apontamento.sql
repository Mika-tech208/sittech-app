-- Sittech — schema PostgreSQL, migration 17
-- Produção Real V1 — paradas manuais registradas junto com o apontamento
-- do período (Setup/Troca, Falta de material, Regulagem etc — motivos
-- operacionais que não passam pelo fluxo de ocorrência em tempo real).
-- NÃO mexe em nada do fluxo de ocorrência (abrir/encerrar_ocorrencia_maquina,
-- os triggers de interseção) nem em Sem Produção — ambos ficam
-- exatamente como estavam.
--
-- Reaproveitamento total de `apontamento_paradas` (migration 9): já tem
-- motivo_id, ocorrencia_id opcional, minutos, descrição, criado_por — e já
-- tem os 3 triggers que fazem TODA a validação que esta etapa precisa:
--   * calcular_intersecao_parada_ocorrencia — só age quando ocorrencia_id
--     não é nulo; parada manual (ocorrencia_id sempre NULL aqui) passa
--     direto, minutos aceito exatamente como informado.
--   * validar_descricao_parada — já exige descrição quando
--     motivos_parada.exige_descricao, para QUALQUER insert/update na
--     tabela, automática ou manual.
--   * validar_soma_paradas_periodo — já soma TODAS as paradas do
--     apontamento (por apontamento_id, sem filtrar ocorrencia_id) contra
--     duracao_periodo_horas_vigente — é exatamente "manual + automática
--     não pode passar da duração do período", pedido explícito, sem
--     precisar duplicar nada.
-- Nenhum dos 3 é alterado nesta migration.
--
-- Atomicidade: as paradas manuais são inseridas DENTRO da mesma function
-- que grava/edita o apontamento (registrar_apontamento_producao_core /
-- editar_apontamento_producao), sem bloco EXCEPTION ao redor do laço — se
-- qualquer parada falhar (motivo inválido, descrição faltando, soma
-- excedida), a exceção sobe e desfaz a function inteira na mesma
-- transação (comportamento padrão do Postgres, nada de BEGIN/COMMIT
-- manual). "Salva tudo ou não salva nada" sai de graça da forma como
-- PL/pgSQL já funciona — não é uma garantia nova sendo construída.
--
-- Parâmetro novo `p_paradas jsonb` (default '[]'::jsonb — apontamento sem
-- parada nenhuma continua idêntico a antes) — cada elemento
-- {"motivo_id": uuid, "minutos": numeric, "descricao": text|null}. jsonb
-- em vez de um tipo composto novo: menor estrutura possível, e é
-- exatamente o formato que um array de objetos JS já é ao chamar
-- supabase.rpc(). `jsonb_to_recordset` (função nativa do Postgres) faz o
-- parse — nenhuma tabela nem tipo novo criado.
--
-- Assinatura muda em 4 functions (novo parâmetro no fim, todos com
-- default — chamadas antigas continuam válidas) — precisa DROP + CREATE
-- em vez de só CREATE OR REPLACE, porque o Postgres identifica function
-- por nome+tipos dos argumentos: com um parâmetro a mais, seria um
-- overload novo em vez de substituir o existente (e o PostgREST não sabe
-- escolher entre dois overloads ambíguos). Mesmo padrão já usado nesta
-- migration pras 3 outras funções que ganham o parâmetro.

-- =========================================================================
-- 1) registrar_apontamento_producao_core — +p_paradas, insere as paradas
--    manuais logo após gravar o apontamento (antes do vínculo retroativo
--    de ocorrências já encerradas, que continua intocado).
-- =========================================================================
drop function if exists public.registrar_apontamento_producao_core(
  uuid, uuid, uuid, numeric, numeric, uuid, text, date, time, text, time, time
);

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
  p_periodo_fim time,
  p_paradas jsonb default '[]'::jsonb
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

  -- Paradas manuais informadas junto com o apontamento — sempre
  -- ocorrencia_id NULL (nunca representam uma ocorrência automática;
  -- essa continua vindo só de abrir/encerrar_ocorrencia_maquina). Motivo
  -- precisa existir e estar ativo (mesma checagem de
  -- abrir_ocorrencia_maquina); minutos>0 já é CHECK da tabela; descrição
  -- obrigatória por motivo e soma vs duração do período são os triggers
  -- já existentes — nenhum dos dois duplicado aqui. Sem bloco EXCEPTION
  -- ao redor: qualquer falha aqui desfaz a function inteira (mesma
  -- transação do INSERT acima).
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
$$;

revoke all on function public.registrar_apontamento_producao_core(
  uuid, uuid, uuid, numeric, numeric, uuid, text, date, time, text, time, time, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.registrar_apontamento_producao_core(
  uuid, uuid, uuid, numeric, numeric, uuid, text, date, time, text, time, time, jsonb
) to authenticated;

-- =========================================================================
-- 2) registrar_apontamento_producao — +p_paradas, só repassa pra core.
-- =========================================================================
drop function if exists public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text);

create or replace function public.registrar_apontamento_producao(
  p_maquina_id uuid,
  p_produto_id uuid,
  p_funcionario_id uuid,
  p_quantidade_produzida numeric,
  p_quantidade_refugo numeric,
  p_idempotency_key uuid,
  p_observacao text default null,
  p_paradas jsonb default '[]'::jsonb
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
    p_idempotency_key, p_observacao, v_data_local, v_hora_local, v_periodo_id, v_periodo_inicio, v_periodo_fim,
    p_paradas
  );
end;
$$;

revoke all on function public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text, jsonb) to authenticated;

-- =========================================================================
-- 3) registrar_apontamento_producao_retroativo — +p_paradas, mesma ideia.
-- =========================================================================
drop function if exists public.registrar_apontamento_producao_retroativo(uuid, uuid, uuid, numeric, numeric, uuid, date, text, text);

create or replace function public.registrar_apontamento_producao_retroativo(
  p_maquina_id uuid,
  p_produto_id uuid,
  p_funcionario_id uuid,
  p_quantidade_produzida numeric,
  p_quantidade_refugo numeric,
  p_idempotency_key uuid,
  p_data date,
  p_periodo_id text,
  p_observacao text default null,
  p_paradas jsonb default '[]'::jsonb
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
    p_idempotency_key, p_observacao, p_data, v_hora_atual, p_periodo_id, v_periodo_inicio, v_periodo_fim,
    p_paradas
  );
end;
$$;

revoke all on function public.registrar_apontamento_producao_retroativo(uuid, uuid, uuid, numeric, numeric, uuid, date, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.registrar_apontamento_producao_retroativo(uuid, uuid, uuid, numeric, numeric, uuid, date, text, text, jsonb) to authenticated;

-- =========================================================================
-- 4) editar_apontamento_producao — +p_paradas (lista COMPLETA das
--    paradas manuais desejadas, mesmo padrão "substitui por inteiro" já
--    usado em funcionario_custos/usuario_permissoes: apaga as manuais
--    atuais — filtro ocorrencia_id is null garante que a automática NUNCA
--    é tocada — e recria a partir de p_paradas). Histórico ganha
--    `paradas_manuais` (antes/depois) no mesmo jsonb que já existe —
--    nenhuma tabela de auditoria nova. security definer preservado (já
--    precisava, por causa da leitura de funcionarios).
-- =========================================================================
drop function if exists public.editar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, text);

create or replace function public.editar_apontamento_producao(
  p_apontamento_id uuid,
  p_produto_id uuid,
  p_funcionario_id uuid,
  p_quantidade_produzida numeric,
  p_quantidade_refugo numeric,
  p_observacao text default null,
  p_paradas jsonb default '[]'::jsonb
)
returns public.apontamentos_producao
language plpgsql
security definer
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
  v_paradas_antes jsonb;
  v_paradas_depois jsonb;
  v_parada record;
  v_motivo_parada_ativo boolean;
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

  select coalesce(jsonb_agg(jsonb_build_object('motivo_id', motivo_id, 'minutos', minutos, 'descricao', descricao) order by criado_em), '[]'::jsonb)
    into v_paradas_antes
  from apontamento_paradas where apontamento_id = p_apontamento_id and ocorrencia_id is null;

  v_dados_anteriores := jsonb_build_object(
    'produto_id', v_atual.produto_id,
    'etapa_id', v_atual.etapa_id,
    'operacao_id', v_atual.operacao_id,
    'funcionario_id', v_atual.funcionario_id,
    'quantidade_produzida', v_atual.quantidade_produzida,
    'quantidade_refugo', v_atual.quantidade_refugo,
    'observacao', v_atual.observacao,
    'meta_periodo_vigente', v_atual.meta_periodo_vigente,
    'custo_hora_operacao_vigente', v_atual.custo_hora_operacao_vigente,
    'paradas_manuais', v_paradas_antes
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

  -- Substitui por inteiro as paradas MANUAIS — o filtro ocorrencia_id is
  -- null garante que a(s) automática(s) de ocorrência nunca são tocadas
  -- aqui (nem apagadas, nem recriadas). Mesmo padrão "apaga e recria" já
  -- usado em funcionario_custos/usuario_permissoes.
  delete from apontamento_paradas where apontamento_id = p_apontamento_id and ocorrencia_id is null;

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
    values (p_apontamento_id, v_parada.motivo_id, v_parada.minutos, v_parada.descricao, v_usuario_id);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('motivo_id', motivo_id, 'minutos', minutos, 'descricao', descricao) order by criado_em), '[]'::jsonb)
    into v_paradas_depois
  from apontamento_paradas where apontamento_id = p_apontamento_id and ocorrencia_id is null;

  v_dados_novos := jsonb_build_object(
    'produto_id', v_atualizado.produto_id,
    'etapa_id', v_atualizado.etapa_id,
    'operacao_id', v_atualizado.operacao_id,
    'funcionario_id', v_atualizado.funcionario_id,
    'quantidade_produzida', v_atualizado.quantidade_produzida,
    'quantidade_refugo', v_atualizado.quantidade_refugo,
    'observacao', v_atualizado.observacao,
    'meta_periodo_vigente', v_atualizado.meta_periodo_vigente,
    'custo_hora_operacao_vigente', v_atualizado.custo_hora_operacao_vigente,
    'paradas_manuais', v_paradas_depois
  );

  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por)
  values (p_apontamento_id, v_dados_anteriores, v_dados_novos, v_usuario_id);

  return v_atualizado;
end;
$$;

revoke all on function public.editar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.editar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, text, jsonb) to authenticated;

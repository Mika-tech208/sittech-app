-- Sittech — schema PostgreSQL, migration 22
-- Corrige o bug pré-existente reportado na etapa anterior: um usuário só
-- com a permissão producao_real_apontamento tinha o fluxo de "registrar
-- produção" liberado no frontend, mas registrar_apontamento_producao
-- falhava com "Funcionário % não encontrado" mesmo passando um
-- funcionário real e ativo.
--
-- Causa exata: registrar_apontamento_producao_core (migration 19,
-- SECURITY INVOKER — confirmado ao vivo em pg_proc.prosecdef = false, é
-- a ÚNICA function atualmente ativa nessa condição que lê `funcionarios`
-- diretamente; abrir_ocorrencia_maquina, editar_apontamento_producao e
-- calcular_custo_hora_operacao_vigente já são SECURITY DEFINER e não são
-- afetadas) faz:
--     select ativo into v_funcionario_ativo from funcionarios where id = p_funcionario_id;
-- Essa leitura roda com o RLS do USUÁRIO CHAMADOR (contexto invoker). A
-- policy de `funcionarios` (migration 16) exige has_permissao('funcionarios')
-- ou has_permissao('custo_hora') — nenhuma das duas é
-- producao_real_apontamento. Resultado: `not found` -> "Funcionário não
-- encontrado", para qualquer funcionário, mesmo existente e ativo.
--
-- Correção (menor camada possível — só essa linha, dentro da mesma
-- function, nada mais): troca a leitura de `funcionarios` pela view
-- `funcionarios_elegibilidade` (já existente desde a migration 16,
-- criada exatamente pra esse tipo de necessidade — "Produção Real pra
-- montar o dropdown de funcionário sem exigir a permissão 'funcionarios'").
-- A view expõe só id/nome/ativo/operacao_id — nunca salario_base — e,
-- por ser uma view comum (dona = postgres, sem "security invoker"),
-- contorna a RLS de `funcionarios` internamente enquanto o próprio SELECT
-- na view continua exigindo apenas que o chamador seja um usuário ativo
-- (grant já existente pra `authenticated`). Não foi necessário criar
-- nenhuma function SECURITY DEFINER nova nem tocar em nenhuma policy —
-- a view já resolvia exatamente isso, reaproveitada tal como está.
--
-- Nada mais muda: mesma assinatura, mesmo corpo, mesma regra de negócio
-- (existe + ativo, nada além disso é validado sobre o funcionário aqui —
-- elegibilidade de operação/etapa continua resolvida via roteiro_etapas/
-- roteiro_etapa_maquinas, como já era).
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

  -- Corrigido: lê da view funcionarios_elegibilidade (id/nome/ativo/
  -- operacao_id, nunca salário) em vez da tabela funcionarios direto —
  -- ver comentário no topo do arquivo.
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

-- Assinatura/grants inalterados — registrar_apontamento_producao e
-- registrar_apontamento_producao_retroativo (migration 19) continuam
-- chamando esta function por nome, sem nenhuma alteração necessária nelas.

-- Sittech — schema PostgreSQL, migration 10
-- Produção Real V1 — camada de gravação de apontamentos_producao. Só a RPC
-- `registrar_apontamento_producao`; nenhuma tela, nenhum hook, nenhuma
-- parada/ocorrência criada aqui (isso já existe desde a migration 9, mas
-- esta RPC não grava nelas). Não altera Previsão, Produtos nem Custo por
-- Hora.
--
-- A RPC recebe só os dados factuais do lançamento (máquina, produto,
-- funcionário, quantidades, observação opcional, idempotency_key) e
-- resolve/valida tudo o resto sozinha — nada disso é confiado ao cliente:
--   * data/hora do lançamento: now(), convertido pra horário local
--     (America/Sao_Paulo) — mesma assunção já usada nos triggers da
--     migration 9 (período não cruza meia-noite).
--   * periodo_id: casa o horário local contra `periodos`. Regra de
--     fechamento (pedido explícito): se o horário cai nos ~10 minutos
--     seguintes ao FIM de um período, esse período (o que está
--     terminando) tem prioridade sobre o período que tecnicamente já
--     começou — é o comportamento esperado de alguém lançando a produção
--     de um período logo depois dele acabar, não já produzindo no
--     próximo. Se dois períodos disputarem a mesma janela (dado mal
--     cadastrado) ou o horário não cair em período nenhum, erro claro —
--     nunca adivinha.
--   * etapa_id/operacao_id: só via `roteiro_etapa_maquinas` (elegibilidade
--     real produto×máquina). Zero etapas elegíveis ou mais de uma —
--     erro claro, nunca adivinha.
--   * meta_periodo_vigente: `roteiro_etapas.meta_<periodo_id>` da etapa
--     resolvida. Ausente ou zero — erro claro (não registra apontamento
--     sem meta real).
--   * periodo_inicio_vigente/periodo_fim_vigente: snapshot do período
--     resolvido (o que "venceu" a resolução acima, seja o normal ou o de
--     fechamento).
--   * custo_hora_operacao_vigente: reproduz EXATAMENTE
--     `calcularCustoHoraEOperacoes` (src/features/custo-hora/
--     calculations.ts) em SQL — mesmas variáveis/fórmulas, incluindo o
--     fallback pra custoHoraEmpresa quando a operação não tem nenhum
--     funcionário ativo. A fórmula em si não é alterada, só reproduzida
--     no banco pra poder ser congelada no momento do lançamento; ver
--     comentários pontuais no corpo da function.
--   * criado_por: usuarios.id do auth.uid() atual — nunca vem do cliente.
--
-- Idempotência: reenviar a mesma idempotency_key devolve o apontamento já
-- criado, sem duplicar (checagem antes do INSERT + tratamento de
-- unique_violation como rede de segurança pra concorrência). Uma segunda
-- tentativa de registrar OUTRO apontamento pra mesma
-- (maquina_id, data, periodo_id) — decisão de V1 — vira erro claro, não
-- duplicidade silenciosa.
--
-- SECURITY INVOKER (mesmo padrão de atualizar_produto_com_roteiro e
-- upsert_previsao_semana) — roda com o papel/RLS de quem chama; todas as
-- tabelas lidas aqui (funcionarios, fixed_costs, funcionario_custos,
-- configuracoes_empresa, periodos, produtos, roteiro_etapas,
-- roteiro_etapa_maquinas, maquinas, usuarios) já dão SELECT pra
-- `authenticated` via a policy usuario_ativo_full_access (ou, no caso de
-- usuarios, usuarios_select_self_or_admin, que cobre a leitura do próprio
-- perfil). EXECUTE só pra authenticated, mesma matriz das outras 2 RPCs.

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
  v_qtd_grace int;
  v_qtd_normal int;

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

  -- 5) período — janela de fechamento (~10min após o fim) tem prioridade
  select count(*) into v_qtd_grace
  from periodos where v_hora_local >= fim and v_hora_local < fim + interval '10 minutes';

  if v_qtd_grace > 1 then
    raise exception 'Mais de um período em janela de fechamento simultânea ao horário % — não é possível resolver automaticamente', v_hora_local;
  elsif v_qtd_grace = 1 then
    select id, inicio, fim into v_periodo_id, v_periodo_inicio, v_periodo_fim
    from periodos where v_hora_local >= fim and v_hora_local < fim + interval '10 minutes';
  else
    select count(*) into v_qtd_normal
    from periodos where v_hora_local >= inicio and v_hora_local < fim;

    if v_qtd_normal > 1 then
      raise exception 'Mais de um período cadastrado cobre o horário % — não é possível resolver automaticamente', v_hora_local;
    elsif v_qtd_normal = 1 then
      select id, inicio, fim into v_periodo_id, v_periodo_inicio, v_periodo_fim
      from periodos where v_hora_local >= inicio and v_hora_local < fim;
    else
      raise exception 'Horário % não está dentro de nenhum período cadastrado', v_hora_local;
    end if;
  end if;

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
  --    horasPorDia = calcularHorasPorDia(periodosValidos): soma da duração
  --    (em horas) de todo período com duração > 0.
  select coalesce(sum(greatest(extract(epoch from (fim - inicio)), 0) / 3600), 0)
    into v_horas_por_dia
  from periodos;

  -- diasUteis = configuracoes_empresa.dias_uteis (mesma fonte de
  -- cadastrosBase.diasUteis usada na tela de Custo por Hora)
  select dias_uteis into v_dias_uteis from configuracoes_empresa limit 1;
  if v_dias_uteis is null then
    raise exception 'Configuração de dias úteis não encontrada — não é possível calcular o custo/hora';
  end if;

  -- horasProdutivasFuncionario = horasPorDia * diasUteis (constante pra
  -- empresa toda, não por funcionário)
  v_horas_produtivas_funcionario := v_horas_por_dia * v_dias_uteis;

  select count(*) into v_num_funcionarios_ativos from funcionarios where ativo = true;
  -- totalHorasProdutivasEmpresa = horasProdutivasFuncionario * numFuncionariosAtivos
  v_total_horas_produtivas_empresa := v_horas_produtivas_funcionario * v_num_funcionarios_ativos;

  -- totalFixo = soma dos fixed_costs ativos
  select coalesce(sum(valor), 0) into v_total_fixo from fixed_costs where ativo = true;

  -- totalCustoFuncionariosAtivos = soma de (salarioBase + custos extras) dos ativos
  select coalesce(sum(f.salario_base + coalesce(fc.total_custos, 0)), 0)
    into v_total_custo_funcionarios_ativos
  from funcionarios f
  left join (
    select funcionario_id, sum(valor) as total_custos
    from funcionario_custos group by funcionario_id
  ) fc on fc.funcionario_id = f.id
  where f.ativo = true;

  -- rateioPorHora / custoHoraEmpresa (0 se não houver hora produtiva
  -- nenhuma, mesma regra do denominador>0 do JS)
  if v_total_horas_produtivas_empresa > 0 then
    v_rateio_por_hora := v_total_fixo / v_total_horas_produtivas_empresa;
    v_custo_hora_empresa := (v_total_custo_funcionarios_ativos + v_total_fixo) / v_total_horas_produtivas_empresa;
  else
    v_rateio_por_hora := 0;
    v_custo_hora_empresa := 0;
  end if;

  -- custoHoraPorOperacao[operacao]: só existe se houver >=1 funcionário
  -- ativo naquela operação; senão cai no fallback custoHoraEmpresa (mesmo
  -- TODO documentado em calcularCustoHoraEOperacoes, preservado aqui)
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

  -- 9) idempotência: reenvio da mesma chave devolve o registro já criado,
  --    sem duplicar
  select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
  if found then
    return v_apontamento;
  end if;

  -- 10) grava — unique(maquina_id, data, periodo_id) da migration 9 é a
  --     rede de segurança final contra corrida/duplicidade
  begin
    insert into apontamentos_producao (
      produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id,
      data, hora_lancamento, quantidade_produzida, quantidade_refugo,
      periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente,
      custo_hora_operacao_vigente, idempotency_key, observacao, criado_por
    ) values (
      p_produto_id, v_etapa_id, v_operacao_id, p_maquina_id, p_funcionario_id, v_periodo_id,
      v_data_local, v_hora_local, p_quantidade_produzida, p_quantidade_refugo,
      v_periodo_inicio, v_periodo_fim, v_meta_periodo,
      v_custo_hora_operacao, p_idempotency_key, p_observacao, v_usuario_id
    )
    returning * into v_apontamento;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'apontamentos_producao_idempotency_key_key' then
        -- corrida: duas chamadas concorrentes com a mesma idempotency_key
        select * into v_apontamento from apontamentos_producao where idempotency_key = p_idempotency_key;
      elsif v_constraint_name = 'apontamentos_producao_maquina_id_data_periodo_id_key' then
        raise exception 'Já existe um apontamento para a máquina % no período % de % — a V1 permite só um apontamento por máquina/dia/período', p_maquina_id, v_periodo_id, v_data_local;
      else
        raise;
      end if;
  end;

  return v_apontamento;
end;
$$;

revoke all on function public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, uuid, text) to authenticated;

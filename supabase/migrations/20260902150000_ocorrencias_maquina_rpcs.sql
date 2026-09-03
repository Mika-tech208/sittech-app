-- Sittech — schema PostgreSQL, migration 12
-- Produção Real V1 — fluxo de Ocorrências de Máquina (abrir/encerrar).
-- Só as 2 RPCs — nenhum frontend, hook, ou tela. Não altera Previsão,
-- Produtos, Custo por Hora, nem nenhuma fórmula existente.
--
-- `abrir_ocorrencia_maquina` — mesmo espírito de registrar_apontamento_producao:
-- recebe só os dados factuais (máquina, produto, funcionário, motivo,
-- descrição) e resolve/valida o resto sozinha (etapa/operação via
-- roteiro_etapa_maquinas, período de abertura via
-- resolver_periodo_por_horario, aberta_em/criado_por). tipo da ocorrência
-- vem direto de motivos_parada.categoria do motivo escolhido — não é
-- perguntado ao cliente, então sempre bate com o que o trigger
-- validar_motivo_tipo_ocorrencia (migration 9) exige.
--
-- `encerrar_ocorrencia_maquina` — fecha a ocorrência e, na mesma
-- transação (a própria function já é atômica), distribui os minutos
-- reais pelos apontamentos_producao da mesma máquina cujas janelas de
-- período intersectam o intervalo [aberta_em, encerrada_em] da ocorrência
-- — um apontamento_paradas por apontamento atingido, SEM calcular minutos
-- aqui: quem calcula é o trigger calcular_intersecao_parada_ocorrencia
-- (migration 9), que já faz exatamente essa conta. Período atravessado
-- sem apontamento lançado simplesmente não gera parada nenhuma — não
-- inventa apontamento, não bloqueia o encerramento (a ocorrência já foi
-- encerrada antes do laço de distribuição rodar).

-- =========================================================================
-- 1) abrir_ocorrencia_maquina
-- =========================================================================
create or replace function public.abrir_ocorrencia_maquina(
  p_maquina_id uuid,
  p_produto_id uuid,
  p_funcionario_id uuid,
  p_motivo_id uuid,
  p_descricao text
)
returns public.ocorrencias_maquina
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;

  v_maquina_ativo boolean;
  v_produto_ativo boolean;
  v_funcionario_ativo boolean;

  v_motivo_ativo boolean;
  v_motivo_vinculavel boolean;
  v_categoria text;

  v_agora timestamptz := now();
  v_hora_local time;
  v_periodo_id_abertura text;

  v_qtd_etapas int;
  v_etapa_id uuid;
  v_operacao_id uuid;

  v_ocorrencia ocorrencias_maquina;
  v_constraint_name text;
begin
  -- criado_por a partir do usuário autenticado — nunca do cliente
  select id into v_usuario_id from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  -- máquina/produto/funcionário precisam existir e estar ativos
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

  -- motivo: precisa existir, estar ativo e ser vinculável a ocorrência de máquina
  select ativo, vinculavel_ocorrencia, categoria into v_motivo_ativo, v_motivo_vinculavel, v_categoria
  from motivos_parada where id = p_motivo_id;
  if not found then
    raise exception 'Motivo % não encontrado', p_motivo_id;
  end if;
  if not v_motivo_ativo then
    raise exception 'Motivo % está inativo', p_motivo_id;
  end if;
  if not v_motivo_vinculavel then
    raise exception 'Motivo % não é vinculável a uma ocorrência de máquina', p_motivo_id;
  end if;

  -- descrição
  if p_descricao is null or length(trim(p_descricao)) = 0 then
    raise exception 'Descrição é obrigatória para abrir uma ocorrência';
  end if;

  -- período de abertura (mesma resolução — com janela de fechamento — das outras RPCs)
  v_hora_local := (v_agora at time zone 'America/Sao_Paulo')::time;
  select periodo_id into v_periodo_id_abertura from resolver_periodo_por_horario(v_hora_local);

  -- etapa/operação — só via elegibilidade real (roteiro_etapa_maquinas), nunca adivinhada
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

  -- grava — tipo vem direto da categoria do motivo (sempre 'quebra' ou
  -- 'manutencao', já que só esses dois têm vinculavel_ocorrencia=true)
  begin
    insert into ocorrencias_maquina (
      maquina_id, tipo, motivo_id, produto_id, etapa_id, operacao_id, funcionario_id,
      periodo_id_abertura, descricao, aberta_em, criado_por
    ) values (
      p_maquina_id, v_categoria, p_motivo_id, p_produto_id, v_etapa_id, v_operacao_id, p_funcionario_id,
      v_periodo_id_abertura, p_descricao, v_agora, v_usuario_id
    )
    returning * into v_ocorrencia;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'idx_ocorrencias_maquina_aberta_unica' then
        raise exception 'Já existe uma ocorrência aberta para a máquina % — encerre-a antes de abrir outra', p_maquina_id;
      else
        raise;
      end if;
  end;

  return v_ocorrencia;
end;
$$;

revoke all on function public.abrir_ocorrencia_maquina(uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.abrir_ocorrencia_maquina(uuid, uuid, uuid, uuid, text) to authenticated;

-- =========================================================================
-- 2) encerrar_ocorrencia_maquina
-- =========================================================================
create or replace function public.encerrar_ocorrencia_maquina(
  p_ocorrencia_id uuid,
  p_descricao_solucao text
)
returns public.ocorrencias_maquina
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_usuario_id uuid;
  v_ocorrencia ocorrencias_maquina;
  v_apontamento record;
begin
  -- encerrado_por a partir do usuário autenticado — nunca do cliente
  select id into v_usuario_id from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  select * into v_ocorrencia from ocorrencias_maquina where id = p_ocorrencia_id;
  if not found then
    raise exception 'Ocorrência % não encontrada', p_ocorrencia_id;
  end if;

  if v_ocorrencia.encerrada_em is not null then
    raise exception 'Ocorrência % já foi encerrada em % — não é possível encerrar de novo', p_ocorrencia_id, v_ocorrencia.encerrada_em;
  end if;

  if p_descricao_solucao is null or length(trim(p_descricao_solucao)) = 0 then
    raise exception 'Descrição da solução é obrigatória para encerrar a ocorrência';
  end if;

  update ocorrencias_maquina
  set encerrada_em = now(), encerrado_por = v_usuario_id, descricao_solucao = p_descricao_solucao
  where id = p_ocorrencia_id
  returning * into v_ocorrencia;

  -- Distribui a ocorrência encerrada pelos apontamentos da mesma máquina
  -- cujas janelas de período (data + periodo_inicio_vigente/
  -- periodo_fim_vigente, horário local) intersectam [aberta_em,
  -- encerrada_em]. Mesma fórmula de interseção do trigger
  -- calcular_intersecao_parada_ocorrencia — só usada aqui pra FILTRAR
  -- quais apontamentos atingir; quem calcula os minutos de fato é o
  -- próprio trigger, disparado pelo INSERT abaixo (minutos nunca é
  -- passado). Período atravessado sem apontamento lançado não aparece
  -- nesta consulta — não gera parada, não bloqueia nada (a ocorrência já
  -- está encerrada nesse ponto). `not exists` evita reinserir um vínculo
  -- que porventura já exista (idempotência de unique(ocorrencia_id,
  -- apontamento_id); na prática nunca acontece, já que uma ocorrência só
  -- passa por este laço uma vez — o check acima bloqueia um segundo
  -- encerramento —, mas o handler de unique_violation abaixo é o
  -- backstop final).
  for v_apontamento in
    select ap.id
    from apontamentos_producao ap
    where ap.maquina_id = v_ocorrencia.maquina_id
      and least(v_ocorrencia.encerrada_em, (ap.data + ap.periodo_fim_vigente) at time zone 'America/Sao_Paulo')
        > greatest(v_ocorrencia.aberta_em, (ap.data + ap.periodo_inicio_vigente) at time zone 'America/Sao_Paulo')
      and not exists (
        select 1 from apontamento_paradas pp
        where pp.ocorrencia_id = v_ocorrencia.id and pp.apontamento_id = ap.id
      )
  loop
    begin
      insert into apontamento_paradas (apontamento_id, motivo_id, ocorrencia_id, descricao, criado_por)
      values (v_apontamento.id, v_ocorrencia.motivo_id, v_ocorrencia.id, v_ocorrencia.descricao, v_usuario_id);
    exception
      when unique_violation then
        null; -- já vinculada a esse apontamento — idempotência, segue pros outros
    end;
  end loop;

  return v_ocorrencia;
end;
$$;

revoke all on function public.encerrar_ocorrencia_maquina(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.encerrar_ocorrencia_maquina(uuid, text) to authenticated;

-- Sittech — schema PostgreSQL, migration 33
-- Produção Real — correção retroativa de um apontamento já finalizado.
--
-- CASO REAL que motivou isto: durante um período a balança da embalagem
-- quebrou, a supervisora não conseguiu saber a quantidade produzida e
-- fechou o período como "Sem produção" (com o motivo correto na hora).
-- Depois ela apurou a quantidade real e precisa voltar NESSE MESMO
-- período e corrigi-lo pra "Produção" — sem criar um segundo apontamento
-- (o unique(maquina_id, data, periodo_id) da migration 9 já impede isso;
-- a correção tem que ser um UPDATE na própria linha, nunca um INSERT).
--
-- Duas coisas, nenhuma delas cria arquitetura nova:
--
--   1) "Motivo da alteração" obrigatório em toda edição de apontamento já
--      finalizado — nova coluna `motivo` em apontamento_producao_historico
--      (a auditoria já existente, append-only, dados_anteriores/
--      dados_novos/alterado_por/alterado_em — ver migration 15). Só
--      adiciona a coluna que faltava pro "por quê", não cria uma segunda
--      tabela/arquitetura de auditoria. editar_apontamento_producao e
--      editar_apontamento_sem_producao precisam de DROP + CREATE (não só
--      CREATE OR REPLACE) porque a lista de parâmetros muda — mesma razão
--      documentada em reivindicar_notificacao_ocorrencia (Push V1):
--      Postgres trata uma lista de parâmetros diferente como uma
--      identidade de função diferente, e um simples CREATE OR REPLACE
--      deixaria as duas assinaturas (a antiga sem p_motivo e a nova)
--      coexistindo.
--
--   2) converter_apontamento_sem_producao_para_producao — a única RPC
--      nova. Mesma lógica de resolução de etapa/operação/meta/custo/
--      preço-vigente já usada por editar_apontamento_producao quando o
--      produto muda (copiada, não reinventada), só que aplicada via
--      UPDATE num apontamento que hoje é 'sem_producao' — nunca um
--      segundo INSERT. Zera motivo_sem_producao/descricao_sem_producao
--      (CHECK apontamentos_producao_status_motivo_check exige isso pra
--      status='produzindo') e preenche os 6 campos que o CHECK
--      apontamentos_producao_status_campos_check exige pra 'produzindo'.
--
-- Permissão: reaproveita has_permissao('producao_real_historico') — a
-- MESMA permissão que já gateia excluir_apontamento_producao (migration
-- 23), que é o precedente mais próximo de "correção sensível de um
-- registro histórico já finalizado" que já existe no sistema. Nenhuma
-- permissão nova foi criada. editar_apontamento_producao/
-- editar_apontamento_sem_producao NÃO ganham essa checagem — continuam
-- exatamente como estavam (só is_usuario_ativo() via RLS), pra não
-- quebrar sem necessidade o fluxo de edição de rotina (corrigir
-- quantidade/refugo) que a supervisora com só
-- producao_real_apontamentos_realizados já usa hoje. Reportado como
-- gap pré-existente (fora do escopo desta correção) no relatório final:
-- essas duas RPCs continuam sem checagem de permissão própria.
--
-- Indicadores/produtividade/eficiência/Intelligence/histórico por
-- produto-operação-funcionário-máquina — todos consultam
-- apontamentos_producao AO VIVO via obter_indicadores_producao/
-- obter_paradas_producao/obter_realizado_previsao_por_semana (nenhuma
-- tabela materializada, nenhum cache). Como a correção é um UPDATE na
-- própria linha (mesmo id, mesma unique key maquina_id+data+periodo_id),
-- tudo isso passa a refletir o valor corrigido automaticamente, sem
-- nenhuma propagação manual — só o valor ANTIGO fica preservado, e só
-- dentro de apontamento_producao_historico (auditoria), nunca mais
-- entrando em nenhum cálculo.

-- =========================================================================
-- 1) apontamento_producao_historico ganha a coluna `motivo` — nullable
--    (linhas de auditoria já existentes, gravadas antes desta migration,
--    não têm motivo e continuam válidas; exigir NOT NULL quebraria elas).
--    "Obrigatório" é imposto nas RPCs (raise exception), não no schema —
--    mesmo estilo já usado pro resto da validação desta tabela/domínio
--    (nenhum CHECK novo, só a checagem em plpgsql que já é o padrão
--    daqui).
-- =========================================================================
alter table public.apontamento_producao_historico
  add column motivo text;

comment on column public.apontamento_producao_historico.motivo is
  '"Motivo da alteração" digitado por quem editou um apontamento já finalizado — obrigatório nas RPCs que gravam aqui a partir desta migration (editar_apontamento_producao, editar_apontamento_sem_producao, converter_apontamento_sem_producao_para_producao). NULL em linhas de auditoria gravadas antes desta migration (não retroagido).';

-- =========================================================================
-- 2) editar_apontamento_producao — corpo idêntico ao da migration 27, só
--    com o novo parâmetro p_motivo (obrigatório, checado no corpo) e
--    gravando ele junto no INSERT de histórico.
-- =========================================================================
drop function if exists public.editar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, text, jsonb);

create function public.editar_apontamento_producao(
  p_apontamento_id uuid,
  p_produto_id uuid,
  p_funcionario_id uuid,
  p_quantidade_produzida numeric,
  p_quantidade_refugo numeric,
  p_motivo text,
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
  v_valor_unitario_produto_novo numeric;
  v_valor_unitario_produto numeric;
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

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Motivo da alteração é obrigatório';
  end if;

  select * into v_atual from apontamentos_producao where id = p_apontamento_id;
  if not found then
    raise exception 'Apontamento % não encontrado', p_apontamento_id;
  end if;
  if v_atual.status <> 'produzindo' then
    raise exception 'Este apontamento não é do tipo "produzindo" — use editar_apontamento_sem_producao';
  end if;

  select ativo, valor_unitario into v_produto_ativo, v_valor_unitario_produto_novo from produtos where id = p_produto_id;
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
    v_valor_unitario_produto := v_valor_unitario_produto_novo;
  else
    v_etapa_id := v_atual.etapa_id;
    v_operacao_id := v_atual.operacao_id;
    v_meta_periodo := v_atual.meta_periodo_vigente;
    v_custo_hora_operacao := v_atual.custo_hora_operacao_vigente;
    v_valor_unitario_produto := v_atual.valor_unitario_produto_vigente;
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
    'valor_unitario_produto_vigente', v_atual.valor_unitario_produto_vigente,
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
    custo_hora_operacao_vigente = v_custo_hora_operacao,
    valor_unitario_produto_vigente = v_valor_unitario_produto,
    atualizado_em = now()
  where id = p_apontamento_id
  returning * into v_atualizado;

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
    'valor_unitario_produto_vigente', v_atualizado.valor_unitario_produto_vigente,
    'paradas_manuais', v_paradas_depois
  );

  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo)
  values (p_apontamento_id, v_dados_anteriores, v_dados_novos, v_usuario_id, p_motivo);

  return v_atualizado;
end;
$$;

revoke all on function public.editar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.editar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, text, text, jsonb) to authenticated;

-- =========================================================================
-- 3) editar_apontamento_sem_producao — mesma ideia: só ganha p_motivo.
-- =========================================================================
drop function if exists public.editar_apontamento_sem_producao(uuid, text, text);

create function public.editar_apontamento_sem_producao(
  p_apontamento_id uuid,
  p_motivo_sem_producao text,
  p_motivo text,
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

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Motivo da alteração é obrigatório';
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
    descricao_sem_producao = p_descricao_sem_producao,
    atualizado_em = now()
  where id = p_apontamento_id
  returning * into v_atualizado;

  v_dados_novos := jsonb_build_object(
    'motivo_sem_producao', v_atualizado.motivo_sem_producao,
    'descricao_sem_producao', v_atualizado.descricao_sem_producao
  );

  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo)
  values (p_apontamento_id, v_dados_anteriores, v_dados_novos, v_usuario_id, p_motivo);

  return v_atualizado;
end;
$$;

revoke all on function public.editar_apontamento_sem_producao(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.editar_apontamento_sem_producao(uuid, text, text, text) to authenticated;

-- =========================================================================
-- 4) converter_apontamento_sem_producao_para_producao — a RPC nova. Mesma
--    resolução de etapa/operação/meta/custo/preço-vigente que
--    editar_apontamento_producao já usa quando o produto muda (copiada
--    daqui, não de outro lugar) — como v_atual.produto_id É SEMPRE null
--    num apontamento 'sem_producao' (CHECK da migration 11), a resolução
--    "produto mudou" acontece sempre, sem precisar de ramo condicional
--    "senão preserva o que já estava" (não tinha nada gravado antes).
--
--    SECURITY DEFINER + checagem explícita de permissão dentro do corpo,
--    mesmo padrão de excluir_apontamento_producao (migration 23):
--    is_admin() ou has_permissao('producao_real_historico'). Nenhuma
--    permissão nova criada.
-- =========================================================================
create function public.converter_apontamento_sem_producao_para_producao(
  p_apontamento_id uuid,
  p_produto_id uuid,
  p_funcionario_id uuid,
  p_quantidade_produzida numeric,
  p_quantidade_refugo numeric,
  p_motivo text,
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
  v_valor_unitario_produto numeric;
  v_funcionario_ativo boolean;
  v_qtd_etapas int;
  v_etapa_id uuid;
  v_operacao_id uuid;
  v_meta_periodo numeric;
  v_custo_hora_operacao numeric;
  v_dados_anteriores jsonb;
  v_dados_novos jsonb;
  v_atualizado apontamentos_producao;
  v_paradas_depois jsonb;
  v_parada record;
  v_motivo_parada_ativo boolean;
begin
  select id into v_usuario_id from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_usuario_id is null then
    raise exception 'Usuário autenticado não encontrado ou inativo';
  end if;

  if not (public.is_admin() or public.has_permissao('producao_real_historico')) then
    raise exception 'Usuário não tem permissão para converter apontamentos sem produção em produção realizada';
  end if;

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Motivo da alteração é obrigatório';
  end if;

  select * into v_atual from apontamentos_producao where id = p_apontamento_id;
  if not found then
    raise exception 'Apontamento % não encontrado', p_apontamento_id;
  end if;
  if v_atual.status <> 'sem_producao' then
    raise exception 'Este apontamento já é uma produção — use editar_apontamento_producao';
  end if;

  select ativo, valor_unitario into v_produto_ativo, v_valor_unitario_produto from produtos where id = p_produto_id;
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
    raise exception 'Meta não cadastrada (ou igual a zero) para este produto/operação no período % — não é possível converter o apontamento', v_atual.periodo_id;
  end if;

  v_custo_hora_operacao := calcular_custo_hora_operacao_vigente(v_operacao_id);

  v_dados_anteriores := jsonb_build_object(
    'status', v_atual.status,
    'motivo_sem_producao', v_atual.motivo_sem_producao,
    'descricao_sem_producao', v_atual.descricao_sem_producao,
    'quantidade_produzida', v_atual.quantidade_produzida,
    'quantidade_refugo', v_atual.quantidade_refugo,
    'observacao', v_atual.observacao
  );

  update apontamentos_producao set
    status = 'produzindo',
    produto_id = p_produto_id,
    etapa_id = v_etapa_id,
    operacao_id = v_operacao_id,
    funcionario_id = p_funcionario_id,
    quantidade_produzida = p_quantidade_produzida,
    quantidade_refugo = p_quantidade_refugo,
    observacao = p_observacao,
    meta_periodo_vigente = v_meta_periodo,
    custo_hora_operacao_vigente = v_custo_hora_operacao,
    valor_unitario_produto_vigente = v_valor_unitario_produto,
    motivo_sem_producao = null,
    descricao_sem_producao = null,
    atualizado_em = now()
  where id = p_apontamento_id
  returning * into v_atualizado;

  -- Um apontamento 'sem_producao' nunca tem paradas manuais (a UI não
  -- oferece o editor pra esse status) — delete defensivo, mesma cautela
  -- de editar_apontamento_producao, sem presumir que a lista está vazia.
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
    'status', v_atualizado.status,
    'produto_id', v_atualizado.produto_id,
    'etapa_id', v_atualizado.etapa_id,
    'operacao_id', v_atualizado.operacao_id,
    'funcionario_id', v_atualizado.funcionario_id,
    'quantidade_produzida', v_atualizado.quantidade_produzida,
    'quantidade_refugo', v_atualizado.quantidade_refugo,
    'observacao', v_atualizado.observacao,
    'meta_periodo_vigente', v_atualizado.meta_periodo_vigente,
    'custo_hora_operacao_vigente', v_atualizado.custo_hora_operacao_vigente,
    'valor_unitario_produto_vigente', v_atualizado.valor_unitario_produto_vigente,
    'paradas_manuais', v_paradas_depois
  );

  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo)
  values (p_apontamento_id, v_dados_anteriores, v_dados_novos, v_usuario_id, p_motivo);

  return v_atualizado;
end;
$$;

revoke all on function public.converter_apontamento_sem_producao_para_producao(uuid, uuid, uuid, numeric, numeric, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.converter_apontamento_sem_producao_para_producao(uuid, uuid, uuid, numeric, numeric, text, text, jsonb) to authenticated;

-- Sittech — schema PostgreSQL, migration 34
-- Ajusta QUAL permissão converter_apontamento_sem_producao_para_producao
-- exige — de producao_real_historico para producao_real_apontamentos_realizados.
--
-- Causa raiz encontrada: a supervisora operacional (ex.: Elizabeth) tem só
-- producao_real_apontamento + producao_real_apontamentos_realizados — é
-- exatamente o PRESET_SUPERVISAO_PRODUCAO já documentado em
-- src/lib/permissoes.ts ("supervisora operacional: chão de fábrica... de
-- propósito SEM producao_real_historico"). Ela já consegue editar
-- quantidade/refugo de um apontamento produzindo normalmente
-- (editar_apontamento_producao/editar_apontamento_sem_producao nunca
-- exigiram permissão própria, só is_usuario_ativo() via RLS) — só a
-- conversão Sem produção -> Produção (migration 33, RPC nova) ficou
-- acidentalmente mais restritiva que o resto do mesmo fluxo, exigindo
-- producao_real_historico (6 telas de análise completamente diferentes)
-- ou admin.
--
-- Correção: producao_real_apontamentos_realizados é a MESMA permissão que
-- já gateia a página inteira onde essa ação vive — tanto
-- ApontamentosRealizadosPage.tsx (temPermissao(..., "producao_real_apontamentos_realizados"))
-- quanto o card fechado do painel de chão de fábrica (mesma checagem,
-- adicionada junto do fluxo). Quem já consegue ABRIR o resumo e editar
-- quantidade passa a também conseguir concluir a conversão — nenhuma
-- permissão nova é criada, nenhuma permissão nova é concedida a ninguém
-- (Elizabeth já tinha essa permissão antes desta migration).
--
-- excluir_apontamento_producao NÃO muda — continua exigindo
-- producao_real_historico ou admin. Apagar um apontamento é mais sensível
-- que corrigir/converter um, e não foi pedido; mantém a mesma separação
-- que já existia (delete mais restrito que edição).
--
-- is_admin() continua bypassando tudo, como sempre — não alterado.
--
-- Corpo idêntico ao da migration 33, só a linha da checagem de permissão
-- muda (CREATE OR REPLACE simples — assinatura de parâmetros não muda,
-- não precisa de DROP).

create or replace function public.converter_apontamento_sem_producao_para_producao(
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

  if not (public.is_admin() or public.has_permissao('producao_real_apontamentos_realizados')) then
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

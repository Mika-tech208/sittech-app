-- Sittech — schema PostgreSQL, migration 27
-- Motor Econômico V1 — corrige integridade histórica: produto_valor_unitario
-- (usado pra margem de processamento em Indicadores/Economia) vinha de um
-- JOIN AO VIVO com produtos.valor_unitario, então uma análise de margem de
-- um apontamento antigo mudava sozinha se o preço do produto mudasse hoje.
-- Isso quebra a mesma disciplina de snapshot já seguida por
-- meta_periodo_vigente/custo_hora_operacao_vigente desde a migration 9.
--
-- Correção: nova coluna valor_unitario_produto_vigente (nomenclatura
-- espelhando meta_periodo_vigente/custo_hora_operacao_vigente — sufixo
-- "_vigente" = valor congelado no instante do apontamento, mesmo padrão
-- do resto da tabela).
--
-- Nullable de propósito (sem CHECK exigindo NOT NULL pra status=
-- 'produzindo'): apontamentos já existentes não têm — e NÃO recebem — esse
-- valor. Backfill usando o preço ATUAL como se fosse histórico inventaria
-- dado que não existe; a instrução foi explícita: preservar NULL/N/A pros
-- antigos, nunca inventar. Daqui pra frente, todo apontamento 'produzindo'
-- novo grava o valor — só o histórico pré-migration fica sem.
--
-- Semântica de edição (editar_apontamento_producao): idêntica à já usada
-- pra meta_periodo_vigente/custo_hora_operacao_vigente — se produto_id
-- muda na edição, o preço é re-congelado com o produtos.valor_unitario
-- ATUAL do produto novo (contexto final salvo = novo produto = novo
-- preço, mesma lógica de re-resolver etapa/meta/custo). Se produto_id
-- NÃO muda (edição só de quantidade/paradas/funcionário/observação), o
-- valor_unitario_produto_vigente já congelado é preservado — o cadastro
-- atual do produto ter mudado nesse meio tempo não altera o snapshot,
-- exatamente como já acontece com meta_periodo_vigente/
-- custo_hora_operacao_vigente. Nenhuma semântica nova foi inventada, só
-- estendida por igual às 3 colunas já congeladas.

alter table public.apontamentos_producao
  add column valor_unitario_produto_vigente numeric;

comment on column public.apontamentos_producao.valor_unitario_produto_vigente is
  'Snapshot de produtos.valor_unitario no instante do apontamento (ou da última edição que trocou o produto) — nunca um JOIN ao vivo. NULL em apontamentos anteriores a esta migration (não preenchido retroativamente) e em status=sem_producao (sem produto).';

-- ---------------------------------------------------------------------
-- registrar_apontamento_producao_core — grava o preço vigente do produto
-- no instante da criação, junto com o resto do snapshot já existente.
-- Corpo idêntico ao da migration 22, só a leitura de produtos (já
-- existente, pra pegar `ativo`) passa a trazer valor_unitario também, e
-- o INSERT ganha essa coluna a mais.
-- ---------------------------------------------------------------------
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
      elsif v_constraint_name = 'apontamentos_producao_maquina_id_data_periodo_id_key' then
        raise exception 'Já existe um apontamento para a máquina % no período % de % — a V1 permite só um fechamento por máquina/dia/período', p_maquina_id, p_periodo_id, p_data;
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
$$;

-- ---------------------------------------------------------------------
-- editar_apontamento_producao — mesma regra condicional já usada pra
-- meta_periodo_vigente/custo_hora_operacao_vigente: se produto_id muda,
-- re-congela (novo produto = novo preço); se não muda, preserva o
-- valor_unitario_produto_vigente que já estava gravado, mesmo que o
-- cadastro do produto tenha mudado nesse meio tempo. Corpo idêntico ao
-- da migration 20, só com essa terceira coluna acompanhando a mesma
-- lógica condicional que já existia pras outras duas, e entrando também
-- no histórico de auditoria (dados_anteriores/dados_novos).
-- ---------------------------------------------------------------------
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
    valor_unitario_produto_vigente = v_valor_unitario_produto
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

  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por)
  values (p_apontamento_id, v_dados_anteriores, v_dados_novos, v_usuario_id);

  return v_atualizado;
end;
$$;

-- ---------------------------------------------------------------------
-- obter_indicadores_producao (migration 26) — troca o JOIN ao vivo com
-- produtos.valor_unitario pelo snapshot valor_unitario_produto_vigente.
-- Mesmo nome/tipo/posição de coluna de saída (produto_valor_unitario) —
-- CREATE OR REPLACE simples, sem precisar de DROP (assinatura de retorno
-- não muda). economico.ts continua recebendo o valor pelo mesmo contrato
-- (ApontamentoIndicador.produtoValorUnitario), só a origem SQL muda.
-- ---------------------------------------------------------------------
create or replace function public.obter_indicadores_producao(
  p_data_inicial date,
  p_data_final date,
  p_produto_id uuid default null,
  p_maquina_id uuid default null,
  p_operacao_id uuid default null,
  p_funcionario_id uuid default null,
  p_periodo_id text default null
)
returns table (
  apontamento_id uuid,
  data date,
  periodo_id text,
  periodo_nome text,
  status text,
  motivo_sem_producao text,
  produto_id uuid,
  produto_nome text,
  maquina_id uuid,
  maquina_nome text,
  operacao_id uuid,
  operacao_nome text,
  funcionario_id uuid,
  funcionario_nome text,
  etapa_id uuid,
  etapa_ordem integer,
  is_ultima_etapa boolean,
  quantidade_produzida numeric,
  quantidade_refugo numeric,
  meta_periodo_vigente numeric,
  duracao_periodo_horas_vigente numeric,
  minutos_parados numeric,
  custo_hora_operacao_vigente numeric,
  custo_operacional_periodo_vigente numeric,
  custo_unitario_referencia_periodo_vigente numeric,
  produto_valor_unitario numeric,
  etapa_maquinas_elegiveis integer
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if not public.has_permissao('producao_real_historico') then
    raise exception 'Usuário não tem permissão para consultar indicadores de produção';
  end if;

  return query
  select
    ap.id,
    ap.data,
    ap.periodo_id,
    per.nome,
    ap.status,
    ap.motivo_sem_producao,
    ap.produto_id,
    p.nome,
    ap.maquina_id,
    m.nome,
    ap.operacao_id,
    o.nome,
    ap.funcionario_id,
    f.nome,
    ap.etapa_id,
    re.ordem,
    case when re.ordem is null then null else (re.ordem = maxord.max_ordem) end,
    ap.quantidade_produzida,
    ap.quantidade_refugo,
    ap.meta_periodo_vigente,
    ap.duracao_periodo_horas_vigente,
    coalesce(paradas.minutos_parados, 0),
    ap.custo_hora_operacao_vigente,
    ap.custo_operacional_periodo_vigente,
    ap.custo_unitario_referencia_periodo_vigente,
    ap.valor_unitario_produto_vigente,
    coalesce(etapamaq.qtd, 0)::integer
  from public.apontamentos_producao ap
  join public.maquinas m on m.id = ap.maquina_id
  join public.periodos per on per.id = ap.periodo_id
  left join public.produtos p on p.id = ap.produto_id
  left join public.operacoes o on o.id = ap.operacao_id
  left join public.funcionarios f on f.id = ap.funcionario_id
  left join public.roteiro_etapas re on re.id = ap.etapa_id
  left join lateral (
    select max(re2.ordem) as max_ordem
    from public.roteiro_etapas re2
    where re2.produto_id = ap.produto_id
  ) maxord on ap.produto_id is not null
  left join lateral (
    select sum(pp.minutos) as minutos_parados
    from public.apontamento_paradas pp
    where pp.apontamento_id = ap.id
  ) paradas on true
  left join lateral (
    select count(*) as qtd
    from public.roteiro_etapa_maquinas rem
    where rem.etapa_id = ap.etapa_id
  ) etapamaq on ap.etapa_id is not null
  where ap.data >= p_data_inicial
    and ap.data <= p_data_final
    and (p_produto_id is null or ap.produto_id = p_produto_id)
    and (p_maquina_id is null or ap.maquina_id = p_maquina_id)
    and (p_operacao_id is null or ap.operacao_id = p_operacao_id)
    and (p_funcionario_id is null or ap.funcionario_id = p_funcionario_id)
    and (p_periodo_id is null or ap.periodo_id = p_periodo_id);
end;
$$;

revoke all on function public.obter_indicadores_producao(date, date, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.obter_indicadores_producao(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

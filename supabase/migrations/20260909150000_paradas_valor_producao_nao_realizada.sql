-- Sittech — schema PostgreSQL, migration 36
-- "Valor de produção não realizada" — métrica gerencial de estimativa,
-- Paradas V1. Aprovada após estudo dedicado (dados reais de PROD, 3
-- produtos, comparação entre períodos, efeito de máquinas alternativas) —
-- NUNCA é faturamento/receita/prejuízo real, NUNCA é somada com Custo do
-- tempo ocioso, e fica sempre marcada ESTIMATIVA (mesmo quando o segmento
-- é real — é uma alocação modelada de valor, não um fato financeiro).
--
-- FÓRMULA (por etapa do roteiro, sempre no período ESPECÍFICO do
-- segmento/trecho — nunca uma média manhã/tarde):
--   produtividade_hora_etapa   = meta_periodo_etapa / duracao_periodo_horas
--   custo_padrao_etapa_peca    = custo_hora_operacao_etapa / produtividade_hora_etapa
--                               = custo_hora_operacao_etapa × duracao_periodo_horas / meta_periodo_etapa
--   peso_esforco_tempo_etapa   = custo_padrao_etapa_peca / Σ custo_padrao_etapa_peca (todas as etapas do roteiro, mesmo período)
--   valor_atribuido_operacao   = produto.valor_unitario × peso_esforco_tempo_etapa
--   valor_producao_nao_realizada = capacidade_local_perdida × valor_atribuido_operacao
--
-- Nota (documentada, não implementada aqui): com o cadastro real de hoje,
-- 13 das 14 operações não têm funcionário próprio alocado, então
-- custo_hora_operacao cai no fallback uniforme da empresa pra quase toda
-- operação — o peso resultante hoje equivale, na prática, a um rateio por
-- tempo padrão (1/meta). A fórmula em si já contempla custo_hora
-- diferenciado por etapa; quando o cadastro de funcionários por operação
-- for completado, o peso passa a refletir isso automaticamente, sem
-- qualquer mudança de código.
--
-- AMBIGUIDADE (regra aprovada, sem exceção): se qualquer etapa do
-- roteiro não tiver meta cadastrada pro período específico, se a
-- resolução de operação for ambígua (mais de uma etapa elegível
-- produto×máquina — mesma regra já usada pra meta estimada, migration
-- 34/35) ou inexistente, ou se o produto não tiver valor_unitario:
-- retorna NULL. Nunca uma escolha arbitrária.
--
-- SEMÂNTICA HISTÓRICA: esta métrica é sempre calculada com os parâmetros
-- ATUAIS/VIGENTES (custo_hora_operacao ao vivo, meta/roteiro cadastrados
-- agora) — não é um snapshot congelado no momento da parada. Se custo/
-- hora, metas ou o roteiro mudarem depois, o valor recalculado muda
-- junto — não deve ser tratado como um fato financeiro histórico
-- reproduzível, a menos que existam snapshots suficientes (que não
-- existem hoje e não são criados por esta migration, de propósito — não
-- inventar persistência que não foi pedida). Documentado aqui e no
-- código TypeScript; a UI marca ESTIMATIVA sempre, sem exceção.
--
-- Nunca importada por src/features/producao-real/desvios/ nem por
-- nenhuma tool do Intelligence — os testes que proíbem métricas de
-- faturamento nessas duas features continuam intocados.

-- ---------------------------------------------------------------------
-- 1) calcular_valor_atribuido_operacao — helper reutilizável, mesmo
--    padrão de calcular_custo_hora_operacao_vigente (migration 15): só
--    leitura, SECURITY DEFINER (mesma disciplina das RPCs de Paradas que
--    vão chamá-la), nunca escreve nada.
-- ---------------------------------------------------------------------
create or replace function public.calcular_valor_atribuido_operacao(
  p_produto_id uuid,
  p_operacao_id uuid,
  p_periodo_id text
)
returns numeric
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_duracao_horas numeric;
  v_qtd_etapas int;
  v_soma_custo_padrao numeric := 0;
  v_custo_padrao_operacao numeric;
  v_valor_unitario numeric;
  v_etapa record;
  v_custo_hora numeric;
  v_custo_padrao numeric;
  v_resolvivel boolean := true;
begin
  if p_produto_id is null or p_operacao_id is null or p_periodo_id is null then
    return null;
  end if;

  select extract(epoch from (fim - inicio)) / 3600 into v_duracao_horas
  from public.periodos where id = p_periodo_id;

  if v_duracao_horas is null or v_duracao_horas <= 0 then
    return null;
  end if;

  select count(*) into v_qtd_etapas from public.roteiro_etapas where produto_id = p_produto_id;
  if v_qtd_etapas = 0 then
    return null;
  end if;

  for v_etapa in
    select operacao_id,
      case p_periodo_id
        when 'm1' then meta_m1 when 'm2' then meta_m2 when 'm3' then meta_m3
        when 't1' then meta_t1 when 't2' then meta_t2 when 't3' then meta_t3
        else null
      end as meta
    from public.roteiro_etapas
    where produto_id = p_produto_id
  loop
    -- qualquer etapa do roteiro sem meta cadastrada pra este período
    -- específico torna o peso inteiro não confiável — melhor NULL que
    -- um cálculo parcial/distorcido.
    if v_etapa.meta is null or v_etapa.meta <= 0 then
      v_resolvivel := false;
      exit;
    end if;

    v_custo_hora := public.calcular_custo_hora_operacao_vigente(v_etapa.operacao_id);
    if v_custo_hora is null then
      v_resolvivel := false;
      exit;
    end if;

    v_custo_padrao := v_custo_hora * v_duracao_horas / v_etapa.meta;
    v_soma_custo_padrao := v_soma_custo_padrao + v_custo_padrao;

    if v_etapa.operacao_id = p_operacao_id then
      v_custo_padrao_operacao := v_custo_padrao;
    end if;
  end loop;

  -- p_operacao_id não bateu com nenhuma etapa do roteiro (ambíguo/não
  -- resolvido a montante) — nunca escolhe arbitrariamente, retorna NULL.
  if not v_resolvivel or v_custo_padrao_operacao is null or v_soma_custo_padrao <= 0 then
    return null;
  end if;

  select valor_unitario into v_valor_unitario from public.produtos where id = p_produto_id;
  if v_valor_unitario is null then
    return null;
  end if;

  return v_valor_unitario * (v_custo_padrao_operacao / v_soma_custo_padrao);
end;
$$;

revoke all on function public.calcular_valor_atribuido_operacao(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.calcular_valor_atribuido_operacao(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) obter_paradas_producao — +1 coluna no final (mesma disciplina de
--    sempre: colunas antigas na mesma ordem). Segmento real já tem
--    produto_id/operacao_id/periodo_id do próprio apontamento — usa
--    exatamente esses, sem ambiguidade nenhuma.
-- ---------------------------------------------------------------------
drop function if exists public.obter_paradas_producao(date, date, uuid, uuid, uuid, uuid, text);

create function public.obter_paradas_producao(
  p_data_inicial date,
  p_data_final date,
  p_produto_id uuid default null,
  p_maquina_id uuid default null,
  p_operacao_id uuid default null,
  p_funcionario_id uuid default null,
  p_periodo_id text default null
)
returns table (
  parada_id uuid,
  apontamento_id uuid,
  data date,
  periodo_id text,
  minutos numeric,
  motivo_id uuid,
  motivo_nome text,
  motivo_categoria text,
  origem text,
  produto_id uuid,
  produto_nome text,
  maquina_id uuid,
  maquina_nome text,
  operacao_id uuid,
  operacao_nome text,
  funcionario_id uuid,
  funcionario_nome text,
  custo_hora_operacao_vigente numeric,
  meta_periodo_vigente numeric,
  duracao_periodo_horas_vigente numeric,
  descricao_problema text,
  descricao_solucao text,
  ocorrencia_id uuid,
  ocorrencia_aberta_em timestamptz,
  ocorrencia_encerrada_em timestamptz,
  valor_atribuido_operacao numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if not public.has_permissao('producao_real_historico') then
    raise exception 'Usuário não tem permissão para consultar paradas de produção';
  end if;

  return query
  select
    pp.id,
    pp.apontamento_id,
    ap.data,
    ap.periodo_id,
    pp.minutos,
    pp.motivo_id,
    mp.nome,
    mp.categoria,
    case when pp.ocorrencia_id is null then 'manual' else 'ocorrencia' end,
    ap.produto_id,
    p.nome,
    ap.maquina_id,
    m.nome,
    ap.operacao_id,
    o.nome,
    ap.funcionario_id,
    f.nome,
    ap.custo_hora_operacao_vigente,
    ap.meta_periodo_vigente,
    ap.duracao_periodo_horas_vigente,
    pp.descricao,
    om.descricao_solucao,
    pp.ocorrencia_id,
    om.aberta_em,
    om.encerrada_em,
    case when ap.produto_id is not null and ap.operacao_id is not null
      then public.calcular_valor_atribuido_operacao(ap.produto_id, ap.operacao_id, ap.periodo_id)
      else null
    end
  from public.apontamento_paradas pp
  join public.apontamentos_producao ap on ap.id = pp.apontamento_id
  join public.motivos_parada mp on mp.id = pp.motivo_id
  join public.maquinas m on m.id = ap.maquina_id
  left join public.produtos p on p.id = ap.produto_id
  left join public.operacoes o on o.id = ap.operacao_id
  left join public.funcionarios f on f.id = ap.funcionario_id
  left join public.ocorrencias_maquina om on om.id = pp.ocorrencia_id
  where ap.data >= p_data_inicial
    and ap.data <= p_data_final
    and (p_produto_id is null or ap.produto_id = p_produto_id)
    and (p_maquina_id is null or ap.maquina_id = p_maquina_id)
    and (p_operacao_id is null or ap.operacao_id = p_operacao_id)
    and (p_funcionario_id is null or ap.funcionario_id = p_funcionario_id)
    and (p_periodo_id is null or ap.periodo_id = p_periodo_id);
end;
$$;

revoke all on function public.obter_paradas_producao(date, date, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.obter_paradas_producao(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) obter_trechos_ocorrencia_sem_apontamento — +1 coluna. Passa a
--    capturar também o operacao_id da etapa elegível (só quando a
--    elegibilidade produto×máquina é única — mesma checagem já existente
--    pra meta_periodo_estimada); ambíguo/inexistente => operacao
--    permanece NULL => calcular_valor_atribuido_operacao devolve NULL
--    (nunca escolhe arbitrariamente).
-- ---------------------------------------------------------------------
drop function if exists public.obter_trechos_ocorrencia_sem_apontamento(date, date, uuid, uuid, uuid, uuid, text);

create function public.obter_trechos_ocorrencia_sem_apontamento(
  p_data_inicial date,
  p_data_final date,
  p_produto_id uuid default null,
  p_maquina_id uuid default null,
  p_operacao_id uuid default null,
  p_funcionario_id uuid default null,
  p_periodo_id text default null
)
returns table (
  ocorrencia_id uuid,
  maquina_id uuid,
  maquina_nome text,
  motivo_id uuid,
  motivo_nome text,
  motivo_categoria text,
  ocorrencia_aberta_em timestamptz,
  ocorrencia_encerrada_em timestamptz,
  descricao_problema text,
  descricao_solucao text,
  periodo_id text,
  trecho_inicio timestamptz,
  trecho_fim timestamptz,
  minutos numeric,
  duracao_periodo_minutos numeric,
  produto_estimado_id uuid,
  produto_estimado_nome text,
  meta_periodo_estimada numeric,
  tem_estimativa boolean,
  valor_atribuido_operacao numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_om record;
  v_per record;
  v_data_local date;
  v_janela_inicio timestamptz;
  v_janela_fim timestamptz;
  v_intersecao_segundos numeric;
  v_coberto boolean;
  v_minutos numeric;
  v_produto_id uuid;
  v_produto_nome text;
  v_operacao_id_estimado uuid;
  v_qtd_etapas int;
  v_meta numeric;
  v_valor_atribuido numeric;
begin
  if not public.has_permissao('producao_real_historico') then
    raise exception 'Usuário não tem permissão para consultar paradas de produção';
  end if;

  if p_produto_id is not null or p_operacao_id is not null or p_funcionario_id is not null or p_periodo_id is not null then
    return;
  end if;

  for v_om in
    select om.id, om.maquina_id, m.nome as maquina_nome, om.motivo_id, mp.nome as motivo_nome, mp.categoria as motivo_categoria,
           om.aberta_em, om.encerrada_em, om.descricao, om.descricao_solucao
    from public.ocorrencias_maquina om
    join public.maquinas m on m.id = om.maquina_id
    join public.motivos_parada mp on mp.id = om.motivo_id
    where om.encerrada_em is not null
      and (om.aberta_em at time zone 'America/Sao_Paulo')::date >= p_data_inicial
      and (om.aberta_em at time zone 'America/Sao_Paulo')::date <= p_data_final
      and (p_maquina_id is null or om.maquina_id = p_maquina_id)
  loop
    v_data_local := (v_om.aberta_em at time zone 'America/Sao_Paulo')::date;

    for v_per in select per.id, per.inicio, per.fim from public.periodos per
    loop
      v_janela_inicio := (v_data_local + v_per.inicio) at time zone 'America/Sao_Paulo';
      v_janela_fim := (v_data_local + v_per.fim) at time zone 'America/Sao_Paulo';

      v_intersecao_segundos := extract(epoch from (
        least(v_om.encerrada_em, v_janela_fim) - greatest(v_om.aberta_em, v_janela_inicio)
      ));
      if v_intersecao_segundos <= 0 then
        continue;
      end if;

      select exists(
        select 1
        from public.apontamento_paradas pp
        join public.apontamentos_producao ap on ap.id = pp.apontamento_id
        where pp.ocorrencia_id = v_om.id and ap.periodo_id = v_per.id
      ) into v_coberto;

      if v_coberto then
        continue;
      end if;

      v_minutos := round(v_intersecao_segundos / 60);
      if v_minutos = 0 then
        v_minutos := 1;
      end if;

      -- produto estimado: apontamento 'produzindo' mais recente da mesma
      -- máquina, em ordem OPERACIONAL (data + horário real de início do
      -- período) — nunca criado_em.
      v_produto_id := null;
      v_produto_nome := null;
      v_operacao_id_estimado := null;
      v_meta := null;

      select ap.produto_id, pr.nome
        into v_produto_id, v_produto_nome
      from public.apontamentos_producao ap
      join public.periodos per2 on per2.id = ap.periodo_id
      join public.produtos pr on pr.id = ap.produto_id
      where ap.maquina_id = v_om.maquina_id
        and ap.status = 'produzindo'
        and (ap.data, per2.inicio) < (v_data_local, v_per.inicio)
      order by ap.data desc, per2.inicio desc
      limit 1;

      if v_produto_id is not null then
        select count(*) into v_qtd_etapas
        from public.roteiro_etapas re
        join public.roteiro_etapa_maquinas rem on rem.etapa_id = re.id
        where re.produto_id = v_produto_id and rem.maquina_id = v_om.maquina_id;

        -- elegibilidade ambígua (mais de 1 etapa) ou inexistente: NUNCA
        -- escolhe arbitrariamente — meta e operação ficam NULL, e por
        -- consequência valor_atribuido_operacao também fica NULL.
        if v_qtd_etapas = 1 then
          select
            case v_per.id
              when 'm1' then re.meta_m1 when 'm2' then re.meta_m2 when 'm3' then re.meta_m3
              when 't1' then re.meta_t1 when 't2' then re.meta_t2 when 't3' then re.meta_t3
            end,
            re.operacao_id
          into v_meta, v_operacao_id_estimado
          from public.roteiro_etapas re
          join public.roteiro_etapa_maquinas rem on rem.etapa_id = re.id
          where re.produto_id = v_produto_id and rem.maquina_id = v_om.maquina_id;
        end if;
      end if;

      v_valor_atribuido := case
        when v_produto_id is not null and v_operacao_id_estimado is not null
          then public.calcular_valor_atribuido_operacao(v_produto_id, v_operacao_id_estimado, v_per.id)
        else null
      end;

      ocorrencia_id := v_om.id;
      maquina_id := v_om.maquina_id;
      maquina_nome := v_om.maquina_nome;
      motivo_id := v_om.motivo_id;
      motivo_nome := v_om.motivo_nome;
      motivo_categoria := v_om.motivo_categoria;
      ocorrencia_aberta_em := v_om.aberta_em;
      ocorrencia_encerrada_em := v_om.encerrada_em;
      descricao_problema := v_om.descricao;
      descricao_solucao := v_om.descricao_solucao;
      periodo_id := v_per.id;
      trecho_inicio := greatest(v_om.aberta_em, v_janela_inicio);
      trecho_fim := least(v_om.encerrada_em, v_janela_fim);
      minutos := v_minutos;
      duracao_periodo_minutos := extract(epoch from (v_janela_fim - v_janela_inicio)) / 60;
      produto_estimado_id := v_produto_id;
      produto_estimado_nome := v_produto_nome;
      meta_periodo_estimada := (case when v_meta is not null and v_meta > 0 then v_meta else null end);
      tem_estimativa := (v_produto_id is not null);
      valor_atribuido_operacao := v_valor_atribuido;
      return next;
    end loop;
  end loop;
end;
$$;

revoke all on function public.obter_trechos_ocorrencia_sem_apontamento(date, date, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.obter_trechos_ocorrencia_sem_apontamento(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

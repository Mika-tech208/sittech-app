-- Sittech — schema PostgreSQL, migration 35
-- Corrige erro conceitual introduzido na migration 34: "Faturamento
-- potencial não realizado" multiplicava capacidade local perdida numa
-- OPERAÇÃO pelo valor_unitario do produto ACABADO. Isso está errado — o
-- produto passa por várias operações em sequência antes de ficar pronto;
-- perda de capacidade numa operação específica não equivale a perda de
-- faturamento do produto acabado (ignora etapas seguintes, gargalos,
-- capacidade recuperável e recursos compartilhados).
--
-- Investigação feita antes desta correção: a fórmula "correta" proposta
-- (produtividade_hora_operacao → custo_industrial_unitario_operacao →
-- impacto_custo_operacao) se simplifica algebricamente para
-- custo_hora_operacao_vigente × horas_paradas — que É EXATAMENTE
-- calcularCustoTempoOciosoParada, já implementado e já exibido como
-- "Custo do tempo ocioso". Não existe métrica nova a criar: a correção é
-- só remover a conta errada (faturamento via valor_unitario do produto
-- acabado), mantendo tudo o mais exatamente como estava.
--
-- Reverte, nesta migration:
--   * obter_paradas_producao: remove a coluna produto_valor_unitario
--     (só existia pra essa conta) — volta a ter as mesmas 24 colunas de
--     antes da migration 34 introduzir o valor unitário (ocorrencia_id/
--     aberta_em/encerrada_em CONTINUAM, essas servem pro agrupamento por
--     ocorrência, que continua correto e não é revertido).
--   * obter_trechos_ocorrencia_sem_apontamento: remove a coluna
--     valor_unitario_estimado e o join com produtos deixa de buscar
--     valor_unitario (continua buscando produto_id/nome — ainda precisa
--     do produto presumido pra resolver a META real via roteiro_etapas,
--     que alimenta capacidade local perdida estimada, mantida).
--
-- Capacidade local perdida (real e estimada) e Custo do tempo ocioso
-- (só segmentos com contexto real) continuam exatamente como estavam —
-- nenhuma fórmula alterada, só a métrica de faturamento removida.

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
  ocorrencia_encerrada_em timestamptz
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
    om.encerrada_em
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
  tem_estimativa boolean
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
  v_qtd_etapas int;
  v_meta numeric;
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
      -- período) — nunca criado_em. Só busca produto_id/nome (pra
      -- resolver a meta real via roteiro_etapas) — NÃO busca
      -- valor_unitario (migration 35: capacidade local perdida não é
      -- monetizada pelo valor do produto acabado).
      v_produto_id := null;
      v_produto_nome := null;
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

        if v_qtd_etapas = 1 then
          select case v_per.id
            when 'm1' then meta_m1 when 'm2' then meta_m2 when 'm3' then meta_m3
            when 't1' then meta_t1 when 't2' then meta_t2 when 't3' then meta_t3
            else null
          end into v_meta
          from public.roteiro_etapas re
          join public.roteiro_etapa_maquinas rem on rem.etapa_id = re.id
          where re.produto_id = v_produto_id and rem.maquina_id = v_om.maquina_id;
        end if;
      end if;

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
      return next;
    end loop;
  end loop;
end;
$$;

revoke all on function public.obter_trechos_ocorrencia_sem_apontamento(date, date, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.obter_trechos_ocorrencia_sem_apontamento(date, date, uuid, uuid, uuid, uuid, text) to authenticated;

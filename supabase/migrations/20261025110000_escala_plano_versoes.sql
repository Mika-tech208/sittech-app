-- Sittech — Escala de Produção, FASE 4d (correção de integridade temporal): VERSÕES DO PLANO OFICIAL.
--
-- Problema: a decisão sombra de um período é calculada DEPOIS do corte; se a Escala oficial (ou a Previsão) mudou nesse intervalo, ler "o plano
-- de agora" contamina a decisão histórica. Solução: toda mudança relevante do plano oficial ou da Previsão grava uma VERSÃO append-only
-- (carimbo de validade + linhas da Escala + dias + entradas da Previsão + hash). O worker reconstrói o passado com a versão vigente no corte
-- (a última com valido_desde <= corte) e NUNCA consulta "a Escala atual" para isso.
--
-- Inerte com replanejamento_modo = 'desligado' (os triggers só leem o parâmetro). Ao ligar sombra/ativo grava uma versão BASELINE das semanas
-- recentes. Não altera nenhuma tabela existente nem o comportamento da Escala oficial.

-- =========================================================================
-- 1) Tabela append-only
-- =========================================================================
create table if not exists public.escala_plano_versoes (
  id uuid primary key default gen_random_uuid(),
  previsao_id uuid not null,                       -- sem FK: o histórico sobrevive a qualquer limpeza
  semana_inicio date not null,
  valido_desde timestamptz not null,               -- instante a partir do qual esta versão era a vigente
  txid bigint not null,
  origem text not null check (origem in ('trigger', 'baseline')),
  hash_plano text not null,                        -- SHA-256 de (linhas, períodos dos dias, entradas da Previsão)
  dias jsonb not null,                             -- [{data, versao, periodos_snapshot}] da Escala vigente
  linhas jsonb not null,                           -- alocações compactas: [data, periodo, func, maquina, produto, etapa, operacao, pecas, pecasAdic, tipoAdic, motivoSemPosto, 'a'|'m']
  entrada jsonb not null,                          -- Previsão vigente: dias produtivos, equipe, itens/máquinas, máquinas indisponíveis
  criado_em timestamptz not null default now()
);
create index if not exists idx_escala_plano_versoes_em on public.escala_plano_versoes(previsao_id, valido_desde desc);

drop trigger if exists trg_escala_plano_versoes_imutavel on public.escala_plano_versoes;
create trigger trg_escala_plano_versoes_imutavel before update or delete on public.escala_plano_versoes for each row execute function public.escala_sombra_trg_imutavel();

alter table public.escala_plano_versoes enable row level security;
drop policy if exists escala_plano_versoes_select on public.escala_plano_versoes;
create policy escala_plano_versoes_select on public.escala_plano_versoes for select to authenticated using (public.is_admin() or public.has_permissao('escala_producao'));
revoke all on public.escala_plano_versoes from anon, authenticated;
grant select on public.escala_plano_versoes to authenticated;
grant select, insert on public.escala_plano_versoes to service_role;

-- =========================================================================
-- 2) Entradas da Previsão (mesmo formato que o carregador do servidor monta)
-- =========================================================================
create or replace function public.escala_plano_entrada(p_previsao uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'diasProdutivos', (select coalesce(jsonb_agg(dia::text order by dia), '[]'::jsonb) from public.previsao_dias_produtivos where previsao_id = p_previsao and ativo),
    'equipe', (select coalesce(jsonb_agg(funcionario_id order by funcionario_id), '[]'::jsonb) from public.previsao_equipe_semana where previsao_id = p_previsao and produtivo),
    'maquinasIndisponiveisPrevisao', (select coalesce(jsonb_agg(maquina_id order by maquina_id), '[]'::jsonb) from public.previsao_maquinas_indisponiveis where previsao_id = p_previsao),
    'itens', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'produtoId', i.produto_id,
        'quantidade', i.quantidade,
        'quantidadeAdicional', coalesce(i.quantidade_adicional, 0),
        'valorUnitario', i.valor_unitario,
        'maquinasPorEtapa', (select coalesce(jsonb_object_agg(t.etapa_id::text, t.maqs), '{}'::jsonb) from (select etapa_id, jsonb_agg(maquina_id order by maquina_id) maqs from public.previsao_item_maquinas where item_id = i.id group by etapa_id) t),
        'adicionalPorEtapa', (select jsonb_object_agg(etapa_id::text, quantidade) from public.previsao_item_adicional_etapa where item_id = i.id)
      )) order by i.produto_id, i.id), '[]'::jsonb)
      from public.previsao_itens i where i.previsao_id = p_previsao and i.tipo = 'previsto'
    )
  );
$$;

-- =========================================================================
-- 3) Registro de versão (idempotente por hash; uma por transação)
-- =========================================================================
create or replace function public.escala_plano_registrar(p_previsao uuid, p_origem text default 'trigger')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_semana date;
  v_linhas jsonb;
  v_dias jsonb;
  v_entrada jsonb;
  v_hash text;
  v_ultimo text;
  v_id uuid;
begin
  select semana_inicio into v_semana from public.previsoes where id = p_previsao;
  if v_semana is null or not public.escala_semana_tem_escala(p_previsao) then
    return null;
  end if;
  if p_origem = 'trigger' and exists (select 1 from public.escala_plano_versoes where previsao_id = p_previsao and txid = txid_current()) then
    return null; -- já registrada nesta transação (o gatilho adiado roda uma vez por linha, no commit)
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(
           a.data::text, a.periodo_id, a.funcionario_id, a.maquina_id, a.produto_id, a.etapa_id, a.operacao_id, a.pecas, coalesce(a.pecas_adicional, 0), a.tipo_adicional, a.motivo_sem_posto,
           case when a.origem = 'manual' then 'm' else 'a' end
         ) order by a.data, a.periodo_id, a.funcionario_id), '[]'::jsonb)
    into v_linhas
    from public.escala_producao_alocacoes a join public.escala_producao_dias d on d.data = a.data
   where d.previsao_id = p_previsao;
  select coalesce(jsonb_agg(jsonb_build_object('data', data::text, 'versao', versao, 'periodos_snapshot', periodos_snapshot) order by data), '[]'::jsonb)
    into v_dias from public.escala_producao_dias where previsao_id = p_previsao;
  v_entrada := public.escala_plano_entrada(p_previsao);
  v_hash := encode(sha256(convert_to(v_linhas::text || '|' || (select coalesce(jsonb_agg(periodos_snapshot order by data), '[]'::jsonb)::text from public.escala_producao_dias where previsao_id = p_previsao) || '|' || v_entrada::text, 'UTF8')), 'hex');
  select hash_plano into v_ultimo from public.escala_plano_versoes where previsao_id = p_previsao order by valido_desde desc, criado_em desc limit 1;
  if v_ultimo = v_hash then
    return null; -- nada mudou de fato
  end if;
  insert into public.escala_plano_versoes (previsao_id, semana_inicio, valido_desde, txid, origem, hash_plano, dias, linhas, entrada)
  values (p_previsao, v_semana, clock_timestamp(), txid_current(), p_origem, v_hash, v_dias, v_linhas, v_entrada)
  returning id into v_id;
  return v_id;
end;
$$;

-- =========================================================================
-- 4) Gatilhos ADIADOS (rodam no commit, com o estado final da transação). Inertes com o modo desligado.
-- =========================================================================
create or replace function public.escala_plano_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
begin
  begin
    if public.escala_replanejamento_modo() = 'desligado' then
      return null;
    end if;
    if tg_table_name = 'escala_producao_alocacoes' then
      select previsao_id into v_prev from public.escala_producao_dias where data = case when tg_op = 'DELETE' then old.data else new.data end;
    elsif tg_table_name = 'escala_producao_dias' then
      v_prev := case when tg_op = 'DELETE' then old.previsao_id else new.previsao_id end;
    elsif tg_table_name in ('previsao_item_maquinas', 'previsao_item_adicional_etapa') then
      select previsao_id into v_prev from public.previsao_itens where id = case when tg_op = 'DELETE' then old.item_id else new.item_id end;
    else
      v_prev := case when tg_op = 'DELETE' then old.previsao_id else new.previsao_id end;
    end if;
    if v_prev is not null then
      perform public.escala_plano_registrar(v_prev, 'trigger');
    end if;
  exception when others then
    -- a versão do plano NUNCA pode impedir a operação da Escala/Previsão
    raise warning 'escala_plano_trg: %', sqlerrm;
  end;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['escala_producao_alocacoes', 'escala_producao_dias', 'previsao_itens', 'previsao_item_maquinas', 'previsao_item_adicional_etapa', 'previsao_dias_produtivos', 'previsao_equipe_semana', 'previsao_maquinas_indisponiveis']
  loop
    execute format('drop trigger if exists trg_escala_plano_versao on public.%I', t);
    execute format('create constraint trigger trg_escala_plano_versao after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.escala_plano_trg()', t);
  end loop;
end $$;

-- =========================================================================
-- 5) Baseline ao LIGAR o modo (semanas recentes ficam com uma versão inicial)
-- =========================================================================
create or replace function public.escala_trg_parametros()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
begin
  if coalesce(new.chave, old.chave) = 'replanejamento_modo' then
    -- ao ligar a sombra, registra a versão BASELINE do plano vigente (sem isso não haveria como reconstruir o corte atual)
    if tg_op <> 'DELETE' and new.valor in ('"sombra"'::jsonb, '"ativo"'::jsonb) then
      for v_prev in select distinct previsao_id from public.escala_producao_dias where data >= current_date - 14 loop
        perform public.escala_plano_registrar(v_prev, 'baseline');
      end loop;
    end if;
    return null; -- o modo do replanejamento não influencia o motor oficial: não recalcula nada
  end if;
  -- parâmetro do motor mudou: recalcula as semanas com escala futura (só períodos futuros; passado congelado)
  for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
    perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('tabela', 'escala_parametros', 'chave', coalesce(new.chave, old.chave)), null);
  end loop;
  return null;
end;
$$;

-- =========================================================================
-- 6) Leitura temporal (somente service_role): versão vigente num instante
-- =========================================================================
create or replace function public.escala_plano_versao_em(p_previsao uuid, p_em timestamptz)
returns setof public.escala_plano_versoes
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.escala_plano_versoes
   where previsao_id = p_previsao and valido_desde <= p_em
   order by valido_desde desc, criado_em desc
   limit 1;
$$;

revoke all on function public.escala_plano_entrada(uuid) from public, anon, authenticated;
revoke all on function public.escala_plano_registrar(uuid, text) from public, anon, authenticated;
revoke all on function public.escala_plano_trg() from public, anon, authenticated;
revoke all on function public.escala_plano_versao_em(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.escala_plano_entrada(uuid) to service_role;
grant execute on function public.escala_plano_versao_em(uuid, timestamptz) to service_role;

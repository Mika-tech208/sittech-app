-- Sittech — Escala de Produção, ESCALA INTELIGENTE (fluxo): flag `producao_real_modo` + diagnósticos append-only.
--
-- Camada de INTEGRAÇÃO (banco). O núcleo de planejamento por fluxo vive no código (src/features/escala/fluxo); aqui só há:
--   1) parâmetros em escala_parametros, com PORTÃO NO BANCO (mesmo padrão de replanejamento_modo / replanejamento_semanas_ativas):
--        producao_real_modo                  'desligado' (padrão) | 'sombra' | 'ativo'
--        producao_real_semanas_ativas        semanas (segunda-feira ISO, nunca anterior a 2026-10-26) em que sombra/ativo VALEM
--        producao_real_limiar_estabilidade   peças finais (θ do churn); null = derivado pelo código
--        producao_real_pares_legado          adaptador do Conector legado (jsonb), semeado com o par de PROD
--      Efetivo da semana = modo, se a semana está listada; senão 'desligado'. Reverter = UPDATE do parâmetro (sem DDL).
--   2) gatilho de parâmetros: mudar a flag registra versão/baseline do plano e, quando o modo ATIVO participa (saindo ou entrando),
--      pede recálculo das semanas com escala futura (ativo→sombra devolve a Escala ao motor oficial). sombra<->desligado NÃO recalcula.
--   3) escala_fluxo_diagnosticos: APPEND-ONLY (trigger bloqueia UPDATE/DELETE/TRUNCATE), RLS de leitura = admin/usuários da Escala,
--      escrita SÓ pela RPC escala_fluxo_registrar (service_role), idempotente por (previsão, gatilho, hash entrada, hash plano fluxo, modo).
--   4) leitura de apontamentos: reaproveita escala_sombra_apontamentos(date) — já devolve TODAS as linhas da semana (produzindo e
--      sem_producao, com motivo, criado_em = lançamento e atualizado_em).
-- Aditiva, idempotente, atômica. Com producao_real_modo = 'desligado' (padrão) NADA muda no comportamento da Escala.

-- =========================================================================
-- 1) Validação das semanas (função imutável usada na constraint)
-- =========================================================================
create or replace function public.escala_producao_real_semanas_validas(v jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  e jsonb;
  s text;
begin
  if v is null or jsonb_typeof(v) <> 'array' then
    return false;
  end if;
  for e in select * from jsonb_array_elements(v) loop
    if jsonb_typeof(e) <> 'string' then
      return false;
    end if;
    s := e #>> '{}';
    if s !~ '^\d{4}-\d{2}-\d{2}$' or s < '2026-10-26' or extract(isodow from s::date) <> 1 then
      return false; -- não-data, semana anterior a 26/10/2026 ou dia que não é segunda-feira
    end if;
  end loop;
  return true;
exception when others then
  return false; -- data impossível (ex.: 2026-13-45)
end;
$$;

-- =========================================================================
-- 2) Constraints + semeadura (sem disparar recálculo: gatilhos desligados só durante a semeadura)
-- =========================================================================
alter table public.escala_parametros drop constraint if exists escala_parametros_producao_real_modo;
alter table public.escala_parametros add constraint escala_parametros_producao_real_modo
  check (chave <> 'producao_real_modo' or valor in ('"desligado"'::jsonb, '"sombra"'::jsonb, '"ativo"'::jsonb));
alter table public.escala_parametros drop constraint if exists escala_parametros_producao_real_semanas;
alter table public.escala_parametros add constraint escala_parametros_producao_real_semanas
  check (chave <> 'producao_real_semanas_ativas' or public.escala_producao_real_semanas_validas(valor));
alter table public.escala_parametros drop constraint if exists escala_parametros_producao_real_limiar;
alter table public.escala_parametros add constraint escala_parametros_producao_real_limiar
  check (chave <> 'producao_real_limiar_estabilidade' or valor = 'null'::jsonb or (jsonb_typeof(valor) = 'number' and (valor #>> '{}')::numeric >= 0));
alter table public.escala_parametros drop constraint if exists escala_parametros_producao_real_pares;
alter table public.escala_parametros add constraint escala_parametros_producao_real_pares
  check (chave <> 'producao_real_pares_legado' or jsonb_typeof(valor) = 'array');

alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
alter table public.escala_parametros disable trigger trg_escala_plano_versao;
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('producao_real_modo', '"desligado"', 'operacional', 'Escala Inteligente (fluxo): desligado (padrão, comportamento atual), sombra (calcula e grava diagnóstico, nunca altera a Escala) ou ativo (o recálculo oficial usa o planejamento por fluxo). Só vale nas semanas de producao_real_semanas_ativas'),
  ('producao_real_semanas_ativas', '[]'::jsonb, 'operacional', 'Semanas (segunda-feira ISO, a partir de 2026-10-26) em que producao_real_modo = sombra/ativo VALE. Fora delas o modo efetivo é desligado'),
  ('producao_real_limiar_estabilidade', 'null'::jsonb, 'tecnico', 'θ da estabilidade (churn): ganho mínimo, em peças finais, para trocar uma alocação do período seguinte. null = derivado pelo código'),
  ('producao_real_pares_legado', jsonb_build_array(jsonb_build_object(
      'nome', 'Conector 3/4"',
      'convencional', '27c229d7-f192-41eb-aad1-0c69ece53eba',
      'automatica', 'a027ac97-ffd1-4834-8ed0-d3a94aac4aee',
      'etapasComuns', jsonb_build_array(
        jsonb_build_object('rotulo', 'Etiquetar', 'convencional', '34371af3-2608-42cc-9ded-1f7815a635a8', 'automatica', '1863b452-77f3-4d5c-9c49-a6d28ae77131'),
        jsonb_build_object('rotulo', 'Embalar', 'convencional', 'b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4', 'automatica', 'fb96d08d-bd64-43d3-8694-40230c695c39')))),
    'tecnico', 'Adaptador do Conector legado: pares convencional × automática e suas etapas comuns (Etiquetar/Embalar) fundidas SÓ para o cálculo de fluxo. Produto fora do par fica em comportamento legado (explícito no diagnóstico)')
on conflict (chave) do nothing;
alter table public.escala_parametros enable trigger trg_escala_plano_versao;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

-- =========================================================================
-- 3) Leitura do modo (portão no banco)
-- =========================================================================
create or replace function public.escala_producao_real_modo()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'producao_real_modo'), 'desligado');
$$;

-- modo EFETIVO de uma semana: o configurado se a semana está autorizada; senão 'desligado'
create or replace function public.escala_producao_real_modo_semana(p_semana date)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.escala_producao_real_modo() in ('sombra', 'ativo')
     and coalesce((select valor from public.escala_parametros where chave = 'producao_real_semanas_ativas'), '[]'::jsonb) ? p_semana::text
    then public.escala_producao_real_modo()
    else 'desligado'
  end;
$$;
revoke all on function public.escala_producao_real_modo() from public, anon;
revoke all on function public.escala_producao_real_modo_semana(date) from public, anon;
grant execute on function public.escala_producao_real_modo() to authenticated, service_role;
grant execute on function public.escala_producao_real_modo_semana(date) to authenticated, service_role;

-- =========================================================================
-- 4) Gatilhos de parâmetros: a flag segue o padrão existente
-- =========================================================================
-- (a) recálculo/baseline: mesma função do replanejamento, com o ramo novo
create or replace function public.escala_trg_parametros()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
  v_chave text := coalesce(new.chave, old.chave);
  v_ativo boolean;
begin
  if v_chave in ('replanejamento_modo', 'replanejamento_semanas_ativas') then
    if v_chave = 'replanejamento_modo' and tg_op <> 'DELETE' and new.valor in ('"sombra"'::jsonb, '"ativo_restrito"'::jsonb, '"ativo"'::jsonb) then
      for v_prev in select distinct previsao_id from public.escala_producao_dias where data >= current_date - 14 loop
        perform public.escala_plano_registrar(v_prev, 'baseline');
      end loop;
    end if;
    return null;
  end if;
  if v_chave like 'producao\_real\_%' then
    if tg_op = 'UPDATE' and new.valor is not distinct from old.valor then
      return null; -- nada mudou de fato
    end if;
    -- ao ligar sombra/ativo, versão BASELINE do plano vigente (sem ela não há como reconstruir o corte atual)
    if v_chave = 'producao_real_modo' and tg_op <> 'DELETE' and new.valor in ('"sombra"'::jsonb, '"ativo"'::jsonb) then
      for v_prev in select distinct previsao_id from public.escala_producao_dias where data >= current_date - 14 loop
        perform public.escala_plano_registrar(v_prev, 'baseline');
      end loop;
    end if;
    -- recálculo do oficial SÓ quando o modo ATIVO participa (entrando ou saindo): ativo→sombra/desligado devolve a Escala ao motor oficial.
    -- desligado<->sombra não muda o plano. Demais chaves (semanas, limiar, pares) só importam com o modo ativo corrente.
    if v_chave = 'producao_real_modo' then
      v_ativo := (tg_op <> 'INSERT' and old.valor = '"ativo"'::jsonb) or (tg_op <> 'DELETE' and new.valor = '"ativo"'::jsonb);
    else
      v_ativo := public.escala_producao_real_modo() = 'ativo';
    end if;
    if v_ativo then
      for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
        perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('tabela', 'escala_parametros', 'chave', v_chave), null);
      end loop;
    end if;
    return null;
  end if;
  -- parâmetro do motor mudou: recalcula as semanas com escala futura (só períodos futuros; passado congelado)
  for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
    perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('tabela', 'escala_parametros', 'chave', v_chave), null);
  end loop;
  return null;
end;
$$;
revoke all on function public.escala_trg_parametros() from public, anon, authenticated;

-- (b) versão do plano: mudar a flag também nasce versão (a sombra/replay reconstrói o corte com a configuração DO CORTE)
create or replace function public.escala_plano_trg_parametros()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
begin
  begin
    if public.escala_replanejamento_modo() = 'desligado' and public.escala_producao_real_modo() = 'desligado'
       and coalesce(new.chave, old.chave) not like 'producao\_real\_%' then
      return null;
    end if;
    if coalesce(new.chave, old.chave) in ('wip_modo', 'wip_dias_limite', 'wip_dias_limite_semanas', 'producao_real_modo', 'producao_real_semanas_ativas', 'producao_real_limiar_estabilidade', 'producao_real_pares_legado') then
      for v_prev in select distinct previsao_id from public.escala_producao_dias where data >= current_date - 14 loop
        perform public.escala_plano_registrar(v_prev, 'trigger');
      end loop;
    end if;
  exception when others then
    raise warning 'escala_plano_trg_parametros: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.escala_plano_trg_parametros() from public, anon, authenticated;

-- (c) a versão do plano passa a registrar a configuração do fluxo vigente (chave nova dentro de `parametros`; leitores antigos a ignoram)
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
    ),
    'parametros', jsonb_build_object(
      'wipModo', coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'wip_modo'), 'desligado'),
      'wipDiasLimite', coalesce((select (valor #>> '{}')::numeric from public.escala_parametros where chave = 'wip_dias_limite'), 1),
      'wipDiasLimitePorSemana', (select (p.valor -> (pv.semana_inicio::text)) from public.escala_parametros p, public.previsoes pv where p.chave = 'wip_dias_limite_semanas' and pv.id = p_previsao),
      'producaoReal', jsonb_build_object(
        'modoEfetivo', (select public.escala_producao_real_modo_semana(pv.semana_inicio) from public.previsoes pv where pv.id = p_previsao),
        'limiar', coalesce((select valor from public.escala_parametros where chave = 'producao_real_limiar_estabilidade'), 'null'::jsonb),
        'paresLegado', coalesce((select valor from public.escala_parametros where chave = 'producao_real_pares_legado'), '[]'::jsonb)
      )
    )
  );
$$;
revoke all on function public.escala_plano_entrada(uuid) from public, anon, authenticated;
grant execute on function public.escala_plano_entrada(uuid) to service_role;

-- =========================================================================
-- 5) Diagnósticos APPEND-ONLY
-- =========================================================================
create table if not exists public.escala_fluxo_diagnosticos (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,          -- ordem estrita de registro
  previsao_id uuid not null,                        -- sem FK: o registro sobrevive a qualquer limpeza
  semana_inicio date not null,
  criado_em timestamptz not null default now(),
  gatilho text not null check (gatilho in ('fechamento', 'evento', 'manual', 'replay')),
  modo text not null check (modo in ('sombra', 'ativo')),
  resultado text not null default 'ok' check (resultado in ('ok', 'fallback', 'erro')),   -- fallback = o fluxo falhou e o oficial foi usado
  corte_data date,                                  -- período FECHADO que originou o cálculo (fechamento) ou o período corrente (evento)
  corte_periodo_id text,
  corte_c integer,                                  -- índice do slot de referência
  versao_motor text not null,
  hash_entrada text not null,
  hash_plano_oficial text not null default '',
  hash_plano_fluxo text not null default '',
  demanda_oficial jsonb not null default '{}'::jsonb,
  demanda_real jsonb not null default '{}'::jsonb,
  wip jsonb not null default '{}'::jsonb,
  gargalos jsonb not null default '{}'::jsonb,
  avaliacao_oficial jsonb not null default '{}'::jsonb,
  avaliacao_fluxo jsonb not null default '{}'::jsonb,
  diff jsonb not null default '{}'::jsonb,
  violacoes jsonb not null default '[]'::jsonb,
  churn jsonb not null default '{}'::jsonb,
  replanejamento jsonb not null default '{}'::jsonb,   -- ANTES / DECISÃO / MOTIVO / DEPOIS (spec §6)
  diagnosticos jsonb not null default '[]'::jsonb,
  erro text,
  aplicado boolean not null default false,
  constraint uq_escala_fluxo_diag unique (previsao_id, gatilho, hash_entrada, hash_plano_fluxo, modo),
  constraint escala_fluxo_diag_aplicado check (not aplicado or (modo = 'ativo' and resultado = 'ok'))
);
create index if not exists idx_escala_fluxo_diag_previsao on public.escala_fluxo_diagnosticos (previsao_id, criado_em desc);
create index if not exists idx_escala_fluxo_diag_criado on public.escala_fluxo_diagnosticos (criado_em desc);

create or replace function public.escala_fluxo_trg_imutavel()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ESCALA_FLUXO_IMUTAVEL: % é append-only (o diagnóstico registra o que foi calculado; não pode ser alterado nem apagado)', tg_table_name;
end;
$$;
drop trigger if exists trg_escala_fluxo_diag_imutavel on public.escala_fluxo_diagnosticos;
create trigger trg_escala_fluxo_diag_imutavel before update or delete on public.escala_fluxo_diagnosticos
  for each row execute function public.escala_fluxo_trg_imutavel();
drop trigger if exists trg_escala_fluxo_diag_imutavel_trunc on public.escala_fluxo_diagnosticos;
create trigger trg_escala_fluxo_diag_imutavel_trunc before truncate on public.escala_fluxo_diagnosticos
  for each statement execute function public.escala_fluxo_trg_imutavel();

alter table public.escala_fluxo_diagnosticos enable row level security;
drop policy if exists escala_fluxo_diagnosticos_select on public.escala_fluxo_diagnosticos;
create policy escala_fluxo_diagnosticos_select on public.escala_fluxo_diagnosticos for select to authenticated
  using (public.is_admin() or public.has_permissao('escala_producao'));
revoke all on public.escala_fluxo_diagnosticos from anon, authenticated, service_role;
grant select on public.escala_fluxo_diagnosticos to authenticated, service_role;
-- escrita: SOMENTE pela RPC (security definer) abaixo

-- =========================================================================
-- 6) RPC de registro (service_role) — idempotente, com portão no banco
-- =========================================================================
create or replace function public.escala_fluxo_registrar(p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.escala_fluxo_diagnosticos;
  v_efetivo text;
  v_id uuid;
begin
  r := jsonb_populate_record(null::public.escala_fluxo_diagnosticos, p_dados);
  if r.previsao_id is null or r.semana_inicio is null or r.gatilho is null or r.modo is null or r.hash_entrada is null or r.versao_motor is null then
    raise exception 'ESCALA_FLUXO_DADOS_INVALIDOS: previsao_id, semana_inicio, gatilho, modo, hash_entrada e versao_motor são obrigatórios';
  end if;
  -- PORTÃO: sem modo efetivo na semana nada é registrado (o replay é só leitura de histórico e fica isento do portão da semana)
  v_efetivo := public.escala_producao_real_modo_semana(r.semana_inicio);
  if r.gatilho <> 'replay' then
    if v_efetivo = 'desligado' then
      return jsonb_build_object('inserido', false, 'id', null, 'bloqueado', 'modo_desligado');
    end if;
    if r.modo = 'ativo' and v_efetivo <> 'ativo' then
      return jsonb_build_object('inserido', false, 'id', null, 'bloqueado', 'modo_ativo_nao_autorizado');
    end if;
  end if;
  if coalesce(r.aplicado, false) and v_efetivo <> 'ativo' then
    return jsonb_build_object('inserido', false, 'id', null, 'bloqueado', 'aplicado_exige_modo_ativo');
  end if;

  insert into public.escala_fluxo_diagnosticos (
    previsao_id, semana_inicio, gatilho, modo, resultado, corte_data, corte_periodo_id, corte_c, versao_motor, hash_entrada, hash_plano_oficial, hash_plano_fluxo,
    demanda_oficial, demanda_real, wip, gargalos, avaliacao_oficial, avaliacao_fluxo, diff, violacoes, churn, replanejamento, diagnosticos, erro, aplicado
  ) values (
    r.previsao_id, r.semana_inicio, r.gatilho, r.modo, coalesce(r.resultado, 'ok'), r.corte_data, r.corte_periodo_id, r.corte_c, r.versao_motor, r.hash_entrada, coalesce(r.hash_plano_oficial, ''), coalesce(r.hash_plano_fluxo, ''),
    coalesce(r.demanda_oficial, '{}'::jsonb), coalesce(r.demanda_real, '{}'::jsonb), coalesce(r.wip, '{}'::jsonb), coalesce(r.gargalos, '{}'::jsonb), coalesce(r.avaliacao_oficial, '{}'::jsonb),
    coalesce(r.avaliacao_fluxo, '{}'::jsonb), coalesce(r.diff, '{}'::jsonb), coalesce(r.violacoes, '[]'::jsonb), coalesce(r.churn, '{}'::jsonb), coalesce(r.replanejamento, '{}'::jsonb),
    coalesce(r.diagnosticos, '[]'::jsonb), r.erro, coalesce(r.aplicado, false)
  )
  on conflict (previsao_id, gatilho, hash_entrada, hash_plano_fluxo, modo) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('inserido', true, 'id', v_id);
  end if;
  select id into v_id from public.escala_fluxo_diagnosticos
   where previsao_id = r.previsao_id and gatilho = r.gatilho and hash_entrada = r.hash_entrada and hash_plano_fluxo = coalesce(r.hash_plano_fluxo, '') and modo = r.modo;
  return jsonb_build_object('inserido', false, 'id', v_id);
end;
$$;
revoke all on function public.escala_fluxo_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.escala_fluxo_registrar(jsonb) to service_role;

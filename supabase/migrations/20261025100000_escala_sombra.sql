-- Sittech — Escala de Produção, FASE 4d: infraestrutura do MODO SOMBRA (replanejamento).
--
-- NÃO altera a Escala oficial. Só:
--  1) parâmetro `replanejamento_modo` ('desligado' padrão | 'sombra' | 'ativo'); 'ativo' ainda NÃO existe e é tratado como 'sombra' pelo servidor;
--  2) evento LÓGICO por (semana + data + período) na outbox existente (tipo 'apontamento_periodo'): vários INSERT/UPDATE/DELETE de apontamento
--     do mesmo período viram UM evento; lançamento depois da decisão só incrementa `lancamentos_tardios` (o snapshot nunca é reescrito);
--  3) escala_sombra_decisoes (snapshot APPEND-ONLY: o que se sabia no corte) e escala_sombra_resultados (o que aconteceu depois);
--  4) RPCs só para service_role: reivindicar (única forma de consumir tentativa), gravar decisão (idempotente), ler apontamentos.
-- Aditiva e reversível. Com replanejamento_modo = 'desligado' o trigger não faz nada além de ler o parâmetro.

-- =========================================================================
-- 1) Parâmetro (e o recálculo do oficial NÃO é disparado por ele)
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
  -- o modo do replanejamento não influencia o motor oficial: não recalcula nada
  if coalesce(new.chave, old.chave) = 'replanejamento_modo' then
    return null;
  end if;
  -- parâmetro do motor mudou: recalcula as semanas com escala futura (só períodos futuros; passado congelado)
  for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
    perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('tabela', 'escala_parametros', 'chave', coalesce(new.chave, old.chave)), null);
  end loop;
  return null;
end;
$$;

insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('replanejamento_modo', '"desligado"', 'operacional', 'Replanejamento (Fase 4): desligado, sombra (grava decisões sem tocar a Escala oficial) ou ativo (reservado: hoje se comporta como sombra)')
on conflict (chave) do nothing;

alter table public.escala_parametros drop constraint if exists escala_parametros_replanejamento_modo;
alter table public.escala_parametros add constraint escala_parametros_replanejamento_modo
  check (chave <> 'replanejamento_modo' or valor in ('"desligado"'::jsonb, '"sombra"'::jsonb, '"ativo"'::jsonb));

create or replace function public.escala_replanejamento_modo()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'replanejamento_modo'), 'desligado');
$$;
revoke all on function public.escala_replanejamento_modo() from public, anon;
grant execute on function public.escala_replanejamento_modo() to authenticated, service_role;

-- =========================================================================
-- 2) Evento lógico por (semana, data, período) na outbox existente
-- =========================================================================
alter table public.escala_producao_eventos drop constraint if exists escala_producao_eventos_tipo_check;
alter table public.escala_producao_eventos add constraint escala_producao_eventos_tipo_check check (tipo in (
  'ausencia', 'previsao', 'recurso_bloqueado', 'recurso_liberado', 'geracao_manual',  -- outbox: pedem recálculo
  'geracao_semanal',                                                                    -- geração automática da semana
  'apontamento_periodo',                                                                -- Fase 4d: fechamento de período (modo sombra)
  'recalculo', 'edicao_manual'                                                          -- histórico: registro do que foi feito
));
alter table public.escala_producao_eventos add column if not exists chave text;
alter table public.escala_producao_eventos add column if not exists ultimo_lancamento_em timestamptz;
alter table public.escala_producao_eventos add column if not exists lancamentos integer not null default 0;
alter table public.escala_producao_eventos add column if not exists lancamentos_tardios integer not null default 0;
create unique index if not exists uq_escala_eventos_chave on public.escala_producao_eventos(chave) where chave is not null;

create or replace function public.escala_trg_apontamento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_data date;
  v_periodo text;
  v_prev uuid;
begin
  begin
    if tg_op = 'DELETE' then v_data := old.data; v_periodo := old.periodo_id;
    else v_data := new.data; v_periodo := new.periodo_id; end if;
    if public.escala_replanejamento_modo() = 'desligado' then
      return null;
    end if;
    select id into v_prev from public.previsoes where semana_inicio = date_trunc('week', v_data)::date;
    if v_prev is null or not public.escala_semana_tem_escala(v_prev) then
      return null;
    end if;
    if not exists (select 1 from public.escala_producao_dias where data = v_data and previsao_id = v_prev) then
      return null;
    end if;
    insert into public.escala_producao_eventos as e (tipo, previsao_id, payload, chave, ultimo_lancamento_em, lancamentos)
    values ('apontamento_periodo', v_prev, jsonb_build_object('data', v_data, 'periodo_id', v_periodo), v_prev::text || '|' || v_data::text || '|' || v_periodo, now(), 1)
    on conflict (chave) where chave is not null do update
      set lancamentos = e.lancamentos + case when e.status = 'processado' then 0 else 1 end,
          lancamentos_tardios = e.lancamentos_tardios + case when e.status = 'processado' then 1 else 0 end,
          ultimo_lancamento_em = now();
  exception when others then
    -- registrar o apontamento NUNCA pode falhar por causa do modo sombra
    raise warning 'escala_trg_apontamento: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.escala_trg_apontamento() from public, anon, authenticated;

drop trigger if exists trg_escala_evento_apontamento on public.apontamentos_producao;
create trigger trg_escala_evento_apontamento after insert or update or delete on public.apontamentos_producao
  for each row execute function public.escala_trg_apontamento();

-- =========================================================================
-- 3) Snapshot da decisão (append-only) e resultado posterior
-- =========================================================================
create table if not exists public.escala_sombra_decisoes (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid,                                  -- sem FK: a decisão sobrevive a qualquer limpeza da outbox
  previsao_id uuid not null,                       -- idem (cópia): o histórico não muda se a Previsão mudar
  semana_inicio date not null,
  data date not null,
  periodo_id text not null,
  slot integer not null,
  corte_em timestamptz not null,
  motivo_fechamento text not null check (motivo_fechamento in ('estavel', 'prazo')),
  dados_completos boolean not null,
  completude_percentual numeric not null,
  postos_esperados integer not null,
  postos_recebidos integer not null,
  postos_faltantes jsonb not null default '[]'::jsonb,
  ultimo_lancamento_em timestamptz,
  lancamentos_tardios_na_leitura integer not null default 0,
  latencia_ms bigint not null default 0,           -- quanto depois do corte a decisão foi calculada (o plano oficial é lido na hora do cálculo)
  horizonte jsonb not null,
  compromisso jsonb not null,
  entradas jsonb not null,
  planos jsonb not null,
  diagnostico jsonb not null,
  entrada jsonb not null,                          -- entrada canônica mínima para REPRODUZIR a decisão
  hash_entrada text not null,
  hash_plano_oficial text not null,
  hash_plano_sombra text not null,
  hash_decisao text not null,
  situacao text not null check (situacao in ('OK', 'A', 'B→C', 'B→D')),
  versao_motor text not null,
  replanejamento_modo text not null check (replanejamento_modo in ('sombra', 'ativo')),
  criado_em timestamptz not null default now(),
  constraint uq_escala_sombra_periodo unique (previsao_id, data, periodo_id)
);
create index if not exists idx_escala_sombra_semana on public.escala_sombra_decisoes(semana_inicio, slot);

create table if not exists public.escala_sombra_resultados (
  id uuid primary key default gen_random_uuid(),
  decisao_id uuid not null references public.escala_sombra_decisoes(id) on delete restrict,
  avaliado_em timestamptz not null default now(),
  realizado jsonb not null default '{}'::jsonb,
  falta_efetiva jsonb not null default '{}'::jsonb,
  observacoes text,
  criado_por uuid references public.usuarios(id) on delete set null
);
create index if not exists idx_escala_sombra_resultados_decisao on public.escala_sombra_resultados(decisao_id);

create or replace function public.escala_sombra_trg_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'ESCALA_SOMBRA_IMUTAVEL: % é append-only (snapshot = o que se sabia no corte; não pode ser alterado nem apagado)', tg_table_name;
end;
$$;
drop trigger if exists trg_escala_sombra_decisoes_imutavel on public.escala_sombra_decisoes;
create trigger trg_escala_sombra_decisoes_imutavel before update or delete on public.escala_sombra_decisoes for each row execute function public.escala_sombra_trg_imutavel();
drop trigger if exists trg_escala_sombra_resultados_imutavel on public.escala_sombra_resultados;
create trigger trg_escala_sombra_resultados_imutavel before update or delete on public.escala_sombra_resultados for each row execute function public.escala_sombra_trg_imutavel();

alter table public.escala_sombra_decisoes enable row level security;
alter table public.escala_sombra_resultados enable row level security;
drop policy if exists escala_sombra_decisoes_select on public.escala_sombra_decisoes;
create policy escala_sombra_decisoes_select on public.escala_sombra_decisoes for select to authenticated using (public.is_admin() or public.has_permissao('escala_producao'));
drop policy if exists escala_sombra_resultados_select on public.escala_sombra_resultados;
create policy escala_sombra_resultados_select on public.escala_sombra_resultados for select to authenticated using (public.is_admin() or public.has_permissao('escala_producao'));
revoke all on public.escala_sombra_decisoes from anon, authenticated;
revoke all on public.escala_sombra_resultados from anon, authenticated;
grant select on public.escala_sombra_decisoes to authenticated;
grant select on public.escala_sombra_resultados to authenticated;
grant select, insert on public.escala_sombra_decisoes to service_role;
grant select, insert on public.escala_sombra_resultados to service_role;

-- =========================================================================
-- 4) RPCs (somente service_role)
-- =========================================================================
-- Eventos de fechamento ainda não concluídos (não consome tentativa).
create or replace function public.escala_sombra_listar_eventos()
returns setof public.escala_producao_eventos
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.escala_producao_eventos
   where tipo = 'apontamento_periodo'
     and (status = 'pendente' or (status = 'erro' and tentativas < 3) or (status = 'processando' and iniciado_em < now() - interval '5 minutes'))
   order by criado_em;
$$;

-- Reivindica UM evento (atômico). É a única operação que consome uma tentativa: só é chamada quando o período já fechou.
create or replace function public.escala_sombra_reivindicar(p_evento_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update public.escala_producao_eventos
     set status = 'processando', tentativas = tentativas + 1, iniciado_em = now()
   where id = p_evento_id and tipo = 'apontamento_periodo'
     and (status = 'pendente' or (status = 'erro' and tentativas < 3) or (status = 'processando' and iniciado_em < now() - interval '5 minutes'));
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

-- Grava a decisão (idempotente por previsão+data+período): a 1ª vale, nunca reescreve.
create or replace function public.escala_sombra_gravar_decisao(p_evento_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  r public.escala_sombra_decisoes;
begin
  r := jsonb_populate_record(null::public.escala_sombra_decisoes, p_dados);
  insert into public.escala_sombra_decisoes (
    evento_id, previsao_id, semana_inicio, data, periodo_id, slot, corte_em, motivo_fechamento, dados_completos, completude_percentual, postos_esperados, postos_recebidos,
    postos_faltantes, ultimo_lancamento_em, lancamentos_tardios_na_leitura, latencia_ms, horizonte, compromisso, entradas, planos, diagnostico, entrada,
    hash_entrada, hash_plano_oficial, hash_plano_sombra, hash_decisao, situacao, versao_motor, replanejamento_modo
  ) values (
    p_evento_id, r.previsao_id, r.semana_inicio, r.data, r.periodo_id, r.slot, r.corte_em, r.motivo_fechamento, r.dados_completos, r.completude_percentual, r.postos_esperados, r.postos_recebidos,
    coalesce(r.postos_faltantes, '[]'::jsonb), r.ultimo_lancamento_em, coalesce(r.lancamentos_tardios_na_leitura, 0), coalesce(r.latencia_ms, 0), r.horizonte, r.compromisso, r.entradas, r.planos, r.diagnostico, r.entrada,
    r.hash_entrada, r.hash_plano_oficial, r.hash_plano_sombra, r.hash_decisao, r.situacao, r.versao_motor, r.replanejamento_modo
  )
  on conflict (previsao_id, data, periodo_id) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('inserida', true, 'id', v_id);
  end if;
  select id into v_id from public.escala_sombra_decisoes where previsao_id = r.previsao_id and data = r.data and periodo_id = r.periodo_id;
  return jsonb_build_object('inserida', false, 'id', v_id);
end;
$$;

-- Apontamentos da semana (service_role não lê a tabela direto): só as colunas que o modo sombra usa.
create or replace function public.escala_sombra_apontamentos(p_semana_inicio date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'data', a.data, 'periodo_id', a.periodo_id, 'funcionario_id', a.funcionario_id, 'maquina_id', a.maquina_id, 'produto_id', a.produto_id, 'etapa_id', a.etapa_id,
    'operacao_id', a.operacao_id, 'quantidade_produzida', a.quantidade_produzida, 'quantidade_refugo', a.quantidade_refugo, 'meta', a.meta_periodo_vigente,
    'status', a.status, 'motivo', a.motivo_sem_producao, 'criado_em', a.criado_em, 'atualizado_em', a.atualizado_em
  ) order by a.data, a.periodo_id, a.criado_em), '[]'::jsonb)
  from public.apontamentos_producao a
  where a.data >= p_semana_inicio and a.data < p_semana_inicio + 7;
$$;

revoke all on function public.escala_sombra_listar_eventos() from public, anon, authenticated;
revoke all on function public.escala_sombra_reivindicar(uuid) from public, anon, authenticated;
revoke all on function public.escala_sombra_gravar_decisao(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.escala_sombra_apontamentos(date) from public, anon, authenticated;
grant execute on function public.escala_sombra_listar_eventos() to service_role;
grant execute on function public.escala_sombra_reivindicar(uuid) to service_role;
grant execute on function public.escala_sombra_gravar_decisao(uuid, jsonb) to service_role;
grant execute on function public.escala_sombra_apontamentos(date) to service_role;

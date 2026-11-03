-- Sittech — Escala Inteligente: FECHAMENTO FÍSICO ATÔMICO NA TROCA DE PERÍODO.
--
-- Um único processo: apontamentos + refugo + sem_producao + paradas + inventário físico dos buffers intermediários → confirmação → recálculo (corte-v1) → publicação.
-- Durante a janela as máquinas estão paradas; o inventário é o estado físico congelado naquele instante e vira a VERDADE do próximo período.
--
-- Aditiva, idempotente, atômica. Com `escala_fechamento_fisico_modo` = 'desligado' (PADRÃO) NADA muda no comportamento da Escala nem do apontamento.
--   desligado → nada                       sombra → grava fechamento e MEDE o erro; o motor NÃO usa o físico; nada é bloqueado
--   ativo     → o motor usa o físico; o apontamento do período em fechamento só vale para quem abriu o fechamento
--
-- Tabelas (todas APPEND-ONLY, exceto a trava de execução e as aberturas expiradas por vigência):
--   escala_buffers_fisicos / escala_buffer_pares / escala_buffer_maquinas   catálogo (buffer físico → pares legados do motor; muda no cutover do Produto Único)
--   escala_fechamento_aberturas   quem abriu a janela de troca (EM_FECHAMENTO) e quando
--   escala_fechamentos            snapshot da fábrica no fechamento (produção, refugo, sem_producao, paradas) + horários + usuário + exceção
--   escala_fechamento_buffers     estimado × físico × diferença por buffer
--   escala_fechamento_log         transições RECALCULANDO → CONFIRMADO | ERRO_RECALCULO com durações e hashes do plano anterior/gerado
--   escala_fechamento_trava       trava por semana (1 recálculo de fechamento por vez), com validade
-- Escrita: só service_role (API do servidor) depois de checar a permissão `escala_fechamento`.

-- =========================================================================
-- 1) Permissão e tipo de evento (a rede de segurança do recálculo usa a outbox existente)
-- =========================================================================
alter table public.usuario_permissoes drop constraint if exists usuario_permissoes_permissao_check;
alter table public.usuario_permissoes add constraint usuario_permissoes_permissao_check check (permissao in (
  'financeiro', 'produtos', 'maquinas', 'funcionarios', 'custo_hora',
  'previsao', 'capacidade',
  'producao_real_apontamento', 'producao_real_historico', 'producao_real_ocorrencias',
  'producao_real_apontamentos_realizados',
  'usuarios', 'auditoria',
  'ausencias_funcionarios',
  'escala_producao', 'escala_producao_tv',
  'escala_wip_confirmar',
  'escala_relatorios',
  'escala_fechamento',            -- fechar período (inventário + recálculo)
  'escala_fechamento_excecao'     -- perfil superior: fechar SEM contagem (emergência, com motivo e auditoria)
));

alter table public.escala_producao_eventos drop constraint if exists escala_producao_eventos_tipo_check;
alter table public.escala_producao_eventos add constraint escala_producao_eventos_tipo_check check (tipo in (
  'ausencia', 'previsao', 'recurso_bloqueado', 'recurso_liberado', 'geracao_manual',
  'geracao_semanal',
  'apontamento_periodo',
  'fechamento_fisico',
  'recalculo', 'edicao_manual'
));

-- O worker da outbox também reivindica 'fechamento_fisico' (rede de segurança: refaz o recálculo de um fechamento que gravou o inventário e não publicou)
create or replace function public.escala_reivindicar_eventos(p_limite integer default 50)
returns setof public.escala_producao_eventos
language sql
security invoker
set search_path = public, pg_temp
as $$
  with candidatos as (
    select id
    from escala_producao_eventos
    where tipo in ('ausencia', 'previsao', 'recurso_bloqueado', 'recurso_liberado', 'geracao_manual', 'geracao_semanal', 'fechamento_fisico')
      and (
        status = 'pendente'
        or (status = 'erro' and tentativas < 3)
        or (status = 'processando' and iniciado_em < now() - interval '5 minutes')
      )
    order by criado_em
    limit greatest(1, least(coalesce(p_limite, 50), 200))
    for update skip locked
  )
  update escala_producao_eventos e
     set status = 'processando', tentativas = e.tentativas + 1, iniciado_em = now()
    from candidatos c
   where e.id = c.id
  returning e.*;
$$;

-- =========================================================================
-- 2) Flag
-- =========================================================================
alter table public.escala_parametros drop constraint if exists escala_parametros_fechamento_fisico_modo;
alter table public.escala_parametros add constraint escala_parametros_fechamento_fisico_modo
  check (chave <> 'escala_fechamento_fisico_modo' or valor in ('"desligado"'::jsonb, '"sombra"'::jsonb, '"ativo"'::jsonb));
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('escala_fechamento_fisico_modo', '"desligado"', 'operacional', 'Fechamento físico atômico na troca de período: desligado (padrão), sombra (grava e mede; o motor NÃO usa o físico) ou ativo (o motor usa o físico; apontamento do período em fechamento só pelo responsável)')
on conflict (chave) do nothing;

create or replace function public.escala_fechamento_fisico_modo()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'escala_fechamento_fisico_modo'), 'desligado');
$$;

-- =========================================================================
-- 3) Catálogo de buffers físicos
-- =========================================================================
create table if not exists public.escala_buffers_fisicos (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  rotulo text not null,
  descricao text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create table if not exists public.escala_buffer_pares (
  id uuid primary key default gen_random_uuid(),
  buffer_id uuid not null references public.escala_buffers_fisicos(id),
  produto_id uuid not null references public.produtos(id),
  etapa_origem_id uuid not null references public.roteiro_etapas(id),
  etapa_seguinte_id uuid not null references public.roteiro_etapas(id),
  papel text not null check (papel in ('contabil', 'zero')),
  vigente_de date not null default current_date,
  vigente_ate date,
  constraint escala_buffer_pares_unico unique (buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, vigente_de),
  constraint escala_buffer_pares_etapas check (etapa_origem_id <> etapa_seguinte_id),
  constraint escala_buffer_pares_vigencia check (vigente_ate is null or vigente_ate >= vigente_de)
);
create index if not exists escala_buffer_pares_buffer_idx on public.escala_buffer_pares (buffer_id);
create table if not exists public.escala_buffer_maquinas (
  buffer_id uuid not null references public.escala_buffers_fisicos(id),
  maquina_id uuid not null references public.maquinas(id),
  papel text not null check (papel in ('produz', 'consome')),
  primary key (buffer_id, maquina_id, papel)
);

-- =========================================================================
-- 4) Abertura da janela, fechamento (snapshot), buffers, log
-- =========================================================================
create table if not exists public.escala_fechamento_aberturas (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null,
  data date not null,
  periodo_id text not null,
  aberto_por uuid references public.usuarios(id) on delete set null,
  dispositivo text,
  aberto_em timestamptz not null default now(),
  valido_ate timestamptz not null                   -- vigência da janela (quem abriu fica responsável até aqui; outra abertura só depois ou com exceção)
);
create index if not exists escala_fechamento_aberturas_idx on public.escala_fechamento_aberturas (data, periodo_id, aberto_em desc);

create table if not exists public.escala_fechamentos (
  id uuid primary key default gen_random_uuid(),
  abertura_id uuid references public.escala_fechamento_aberturas(id),
  semana_inicio date not null,
  data date not null,
  periodo_id text not null,
  tipo text not null default 'periodo' check (tipo in ('periodo', 'abertura')),   -- 'abertura' = 1º fechamento sem período anterior (adoção/retomada)
  revisao integer not null check (revisao >= 1),
  iniciado_em timestamptz not null,                  -- início do fechamento (abertura da tela)
  fechado_em timestamptz not null default now(),     -- confirmação (relógio do servidor)
  contado_em timestamptz not null,                   -- instante físico informado (auditoria)
  instante_motor timestamptz not null,               -- instante que o motor usa: fim do período fechado (estado congelado, máquinas paradas)
  fechado_por uuid references public.usuarios(id) on delete set null,
  dispositivo text,
  postos_esperados integer not null check (postos_esperados >= 0),
  postos_coletados integer not null check (postos_coletados >= 0),
  buffers_obrigatorios integer not null check (buffers_obrigatorios >= 0),
  resumo_producao jsonb not null default '{}'::jsonb,   -- snapshot: postos[{maquinaId,produtoId,produzido,refugo,status,motivo}], paradas[...]
  hash_resumo text not null,
  hash_plano_anterior text,                           -- plano vigente (região recalculável) no momento da confirmação
  excecao boolean not null default false,             -- fechado SEM contagem (perfil superior)
  excecao_motivo text,
  observacao text,
  chave_idempotencia uuid not null unique,
  constraint escala_fechamentos_revisao_unica unique (data, periodo_id, revisao),
  constraint escala_fechamentos_completo check (postos_coletados = postos_esperados),
  constraint escala_fechamentos_ordem check (fechado_em >= iniciado_em - interval '1 minute'),
  constraint escala_fechamentos_excecao check (not excecao or length(btrim(coalesce(excecao_motivo, ''))) >= 5)
);
create index if not exists escala_fechamentos_semana_idx on public.escala_fechamentos (semana_inicio, data, periodo_id, revisao desc);

create table if not exists public.escala_fechamento_buffers (
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null references public.escala_fechamentos(id),
  buffer_id uuid not null references public.escala_buffers_fisicos(id),
  saldo_estimado numeric,
  estimado_lo numeric,
  estimado_hi numeric,
  saldo_fisico numeric,                              -- nulo SOMENTE em fechamento de exceção
  diferenca numeric generated always as (saldo_fisico - saldo_estimado) stored,
  motivo text,
  criado_em timestamptz not null default now(),
  constraint escala_fechamento_buffers_unico unique (fechamento_id, buffer_id),
  constraint escala_fechamento_buffers_nao_negativo check (saldo_fisico is null or saldo_fisico >= 0),
  constraint escala_fechamento_buffers_motivo check (saldo_fisico is null or saldo_estimado is null
    or abs(saldo_fisico - saldo_estimado) <= greatest(500, 0.15 * saldo_fisico) or length(btrim(coalesce(motivo, ''))) >= 3)
);
create index if not exists escala_fechamento_buffers_buffer_idx on public.escala_fechamento_buffers (buffer_id, criado_em desc);

create table if not exists public.escala_fechamento_log (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  fechamento_id uuid not null references public.escala_fechamentos(id),
  estado text not null check (estado in ('RECALCULANDO', 'CONFIRMADO', 'ERRO_RECALCULO')),
  em timestamptz not null default clock_timestamp(),
  detalhe jsonb not null default '{}'::jsonb         -- tentativa, tempos_ms{gravacao,entrada,corte,validacao,persistencia,total}, hash_plano_anterior, hash_plano_novo, erro, motivo_bloqueio
);
create index if not exists escala_fechamento_log_fech_idx on public.escala_fechamento_log (fechamento_id, seq desc);

-- trava por semana (um recálculo de fechamento por vez); validade evita trava eterna se o servidor cair
create table if not exists public.escala_fechamento_trava (
  semana_inicio date primary key,
  fechamento_id uuid not null,
  ate timestamptz not null
);

-- imutabilidade
create or replace function public.escala_fechamento_trg_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'FECHAMENTO_IMUTAVEL: % é append-only (corrija com uma nova revisão do fechamento)', tg_table_name;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['escala_fechamentos', 'escala_fechamento_buffers', 'escala_fechamento_log', 'escala_fechamento_aberturas'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_imutavel', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.escala_fechamento_trg_imutavel()', 'trg_' || t || '_imutavel', t);
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_imutavel_trunc', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.escala_fechamento_trg_imutavel()', 'trg_' || t || '_imutavel_trunc', t);
  end loop;
end $$;

create or replace function public.escala_buffer_trg_catalogo()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'FECHAMENTO_CATALOGO: % não pode ser apagado (desative ou encerre a vigência)', tg_table_name; end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['escala_buffers_fisicos', 'escala_buffer_pares'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_catalogo', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.escala_buffer_trg_catalogo()', 'trg_' || t || '_catalogo', t);
  end loop;
end $$;

-- =========================================================================
-- 5) Views
-- =========================================================================
create or replace view public.escala_fechamentos_vigentes as
  select f.* from public.escala_fechamentos f
  where not exists (select 1 from public.escala_fechamentos g where g.data = f.data and g.periodo_id = f.periodo_id and g.revisao > f.revisao);

-- estado atual do fechamento vigente (última transição do log)
create or replace view public.escala_fechamento_estado as
  select f.id as fechamento_id, f.data, f.periodo_id, f.revisao, f.fechado_em, f.fechado_por, f.excecao,
         coalesce((select l.estado from public.escala_fechamento_log l where l.fechamento_id = f.id order by l.seq desc limit 1), 'RECALCULANDO') as estado,
         (select l.em from public.escala_fechamento_log l where l.fechamento_id = f.id order by l.seq desc limit 1) as estado_em,
         (select l.detalhe from public.escala_fechamento_log l where l.fechamento_id = f.id order by l.seq desc limit 1) as detalhe
  from public.escala_fechamentos_vigentes f;

-- contagem VIGENTE por par legado do motor (a mais recente por instante do motor). Fechamento de exceção (sem contagem) não gera contagem.
create or replace view public.escala_contagens_fechamento_para_motor as
  select distinct on (bp.produto_id, bp.etapa_origem_id, bp.etapa_seguinte_id)
    bp.produto_id as "produtoId", bp.etapa_origem_id as "etapaOrigemId", bp.etapa_seguinte_id as "etapaSeguinteId",
    case when bp.papel = 'contabil' then fb.saldo_fisico else 0 end as saldo,
    f.instante_motor as "contadoEm", f.fechado_por as "informadoPor", f.id as fechamento_id, f.data, f.periodo_id, f.revisao, f.fechado_em
  from public.escala_fechamentos_vigentes f
  join public.escala_fechamento_buffers fb on fb.fechamento_id = f.id and fb.saldo_fisico is not null
  join public.escala_buffer_pares bp on bp.buffer_id = fb.buffer_id
       and f.data >= bp.vigente_de and (bp.vigente_ate is null or f.data <= bp.vigente_ate)
  order by bp.produto_id, bp.etapa_origem_id, bp.etapa_seguinte_id, f.instante_motor desc, f.fechado_em desc;

-- métricas de erro do WIP estimado
create or replace view public.escala_wip_erro as
  select f.data, f.periodo_id, f.revisao, f.contado_em, b.chave as buffer, b.rotulo, fb.saldo_estimado, fb.saldo_fisico,
         fb.diferenca, abs(fb.diferenca) as desvio_abs,
         case when fb.saldo_fisico > 0 then abs(fb.diferenca) / fb.saldo_fisico end as desvio_pct,
         fb.fechamento_id, fb.buffer_id
  from public.escala_fechamentos_vigentes f
  join public.escala_fechamento_buffers fb on fb.fechamento_id = f.id
  join public.escala_buffers_fisicos b on b.id = fb.buffer_id
  where fb.saldo_estimado is not null and fb.saldo_fisico is not null;
create or replace view public.escala_wip_erro_dia as
  select data, buffer, count(*) as n, avg(diferenca) as vies, avg(desvio_abs) as desvio_abs_medio, avg(desvio_pct) as desvio_pct_medio, max(desvio_abs) as desvio_abs_max
  from public.escala_wip_erro group by data, buffer;
create or replace view public.escala_wip_erro_maquina as
  select e.data, bm.maquina_id, bm.papel, count(*) as n, avg(e.diferenca) as vies, avg(e.desvio_abs) as desvio_abs_medio, avg(e.desvio_pct) as desvio_pct_medio
  from public.escala_wip_erro e join public.escala_buffer_maquinas bm on bm.buffer_id = e.buffer_id
  group by e.data, bm.maquina_id, bm.papel;
create or replace view public.escala_wip_erro_produto as
  select e.data, bp.produto_id, bp.etapa_origem_id, bp.etapa_seguinte_id, count(*) as n, avg(e.diferenca) as vies, avg(e.desvio_abs) as desvio_abs_medio, avg(e.desvio_pct) as desvio_pct_medio
  from public.escala_wip_erro e join public.escala_buffer_pares bp on bp.buffer_id = e.buffer_id and bp.papel = 'contabil'
  group by e.data, bp.produto_id, bp.etapa_origem_id, bp.etapa_seguinte_id;
-- duração do fechamento (confirmação → CONFIRMADO)
create or replace view public.escala_fechamento_duracao as
  select f.data, f.periodo_id, f.revisao, f.id as fechamento_id, l.estado, l.em - f.fechado_em as duracao,
         (l.detalhe #>> '{tempos_ms,total}')::numeric as total_ms, (l.detalhe #>> '{tempos_ms,corte}')::numeric as corte_ms,
         (l.detalhe #>> '{tempos_ms,gravacao}')::numeric as gravacao_ms, (l.detalhe #>> '{tempos_ms,entrada}')::numeric as entrada_ms,
         (l.detalhe #>> '{tempos_ms,validacao}')::numeric as validacao_ms, (l.detalhe #>> '{tempos_ms,persistencia}')::numeric as persistencia_ms
  from public.escala_fechamentos f join public.escala_fechamento_log l on l.fechamento_id = f.id and l.estado in ('CONFIRMADO', 'ERRO_RECALCULO');

-- =========================================================================
-- 6) RPCs (somente service_role)
-- =========================================================================
-- abrir a janela de troca (EM_FECHAMENTO): idempotente para o mesmo usuário; outra pessoa só depois da vigência (ou p_forcar, perfil superior)
create or replace function public.escala_fechamento_abrir(p_semana date, p_data date, p_periodo text, p_usuario uuid, p_dispositivo text, p_ttl_min integer, p_forcar boolean default false)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_atual record; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('abrir|' || p_data::text || '|' || p_periodo, 0));
  if exists (select 1 from public.escala_fechamentos_vigentes f where f.data = p_data and f.periodo_id = p_periodo
             and exists (select 1 from public.escala_fechamento_log l where l.fechamento_id = f.id and l.estado = 'CONFIRMADO')) and not p_forcar then
    raise exception 'FECHAMENTO_JA_CONFIRMADO: o período % de % já está fechado (correção exige abertura forçada)', p_periodo, p_data;
  end if;
  select * into v_atual from public.escala_fechamento_aberturas a
    where a.data = p_data and a.periodo_id = p_periodo
      and not exists (select 1 from public.escala_fechamentos f where f.abertura_id = a.id)
    order by a.aberto_em desc limit 1;
  if found and v_atual.valido_ate > now() and v_atual.aberto_por is distinct from p_usuario and not p_forcar then
    raise exception 'FECHAMENTO_EM_ANDAMENTO: outro usuário já abriu o fechamento deste período (até %)', v_atual.valido_ate;
  end if;
  if found and v_atual.valido_ate > now() and v_atual.aberto_por is not distinct from p_usuario then return v_atual.id; end if;
  insert into public.escala_fechamento_aberturas (semana_inicio, data, periodo_id, aberto_por, dispositivo, valido_ate)
  values (p_semana, p_data, p_periodo, p_usuario, p_dispositivo, now() + make_interval(mins => greatest(1, p_ttl_min))) returning id into v_id;
  return v_id;
end;
$$;

-- gravar o fechamento (snapshot + inventário) numa transação; já nasce RECALCULANDO e enfileira o evento de segurança
create or replace function public.escala_fechamento_registrar(
  p_abertura uuid, p_semana date, p_data date, p_periodo text, p_tipo text, p_iniciado_em timestamptz, p_contado_em timestamptz, p_instante_motor timestamptz,
  p_usuario uuid, p_dispositivo text, p_postos_esperados integer, p_postos_coletados integer, p_resumo jsonb, p_buffers jsonb, p_buffers_obrigatorios integer,
  p_hash_plano_anterior text, p_excecao boolean, p_excecao_motivo text, p_observacao text, p_chave uuid, p_forcar_revisao boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_rev integer; v_prev uuid; v_ab record;
begin
  select id into v_id from public.escala_fechamentos where chave_idempotencia = p_chave;
  if found then return v_id; end if;                                  -- duplo clique / retry do tablet

  perform pg_advisory_xact_lock(hashtextextended('fech|' || p_data::text || '|' || p_periodo, 0));
  select id into v_id from public.escala_fechamentos where chave_idempotencia = p_chave;
  if found then return v_id; end if;

  if not p_excecao then
    if jsonb_typeof(p_buffers) <> 'array' or jsonb_array_length(p_buffers) <> p_buffers_obrigatorios then
      raise exception 'FECHAMENTO_BUFFERS_INCOMPLETOS: esperados %, recebidos %', p_buffers_obrigatorios, case when jsonb_typeof(p_buffers) = 'array' then jsonb_array_length(p_buffers) else -1 end;
    end if;
    if exists (select 1 from jsonb_to_recordset(p_buffers) as x(buffer_id uuid, saldo_fisico numeric) where x.saldo_fisico is null or x.saldo_fisico < 0) then
      raise exception 'FECHAMENTO_SALDO_INVALIDO: saldo físico ausente ou negativo';
    end if;
  end if;

  -- um período só fecha uma vez (a menos que seja correção forçada). Fechamento em ERRO_RECALCULO NÃO reabre: o estoque já está salvo e o recálculo é refeito por retry
  if exists (select 1 from public.escala_fechamentos_vigentes f where f.data = p_data and f.periodo_id = p_periodo) and not p_forcar_revisao then
    raise exception 'FECHAMENTO_JA_EXISTE: o período % de % já foi fechado', p_periodo, p_data;
  end if;
  if p_abertura is not null then
    select * into v_ab from public.escala_fechamento_aberturas where id = p_abertura;
    if not found then raise exception 'FECHAMENTO_ABERTURA_INEXISTENTE'; end if;
    if v_ab.aberto_por is distinct from p_usuario and not p_forcar_revisao then raise exception 'FECHAMENTO_OUTRO_RESPONSAVEL: a janela foi aberta por outro usuário'; end if;
    if exists (select 1 from public.escala_fechamentos where abertura_id = p_abertura) then raise exception 'FECHAMENTO_ABERTURA_JA_USADA'; end if;
  end if;

  select coalesce(max(revisao), 0) + 1 into v_rev from public.escala_fechamentos where data = p_data and periodo_id = p_periodo;
  insert into public.escala_fechamentos (abertura_id, semana_inicio, data, periodo_id, tipo, revisao, iniciado_em, contado_em, instante_motor, fechado_por, dispositivo,
      postos_esperados, postos_coletados, buffers_obrigatorios, resumo_producao, hash_resumo, hash_plano_anterior, excecao, excecao_motivo, observacao, chave_idempotencia)
  values (p_abertura, p_semana, p_data, p_periodo, coalesce(p_tipo, 'periodo'), v_rev, p_iniciado_em, p_contado_em, p_instante_motor, p_usuario, p_dispositivo,
      p_postos_esperados, p_postos_coletados, p_buffers_obrigatorios, coalesce(p_resumo, '{}'::jsonb), encode(sha256(convert_to(coalesce(p_resumo, '{}'::jsonb)::text, 'UTF8')), 'hex'),
      p_hash_plano_anterior, coalesce(p_excecao, false), p_excecao_motivo, p_observacao, p_chave)
  returning id into v_id;

  insert into public.escala_fechamento_buffers (fechamento_id, buffer_id, saldo_estimado, estimado_lo, estimado_hi, saldo_fisico, motivo)
  select v_id, x.buffer_id, x.saldo_estimado, x.estimado_lo, x.estimado_hi, x.saldo_fisico, x.motivo
  from jsonb_to_recordset(coalesce(p_buffers, '[]'::jsonb)) as x(buffer_id uuid, saldo_estimado numeric, estimado_lo numeric, estimado_hi numeric, saldo_fisico numeric, motivo text);

  insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) values (v_id, 'RECALCULANDO', jsonb_build_object('tentativa', 1));

  select id into v_prev from public.previsoes where semana_inicio = p_semana;
  if v_prev is not null and public.escala_fechamento_fisico_modo() <> 'desligado' then
    insert into public.escala_producao_eventos (tipo, previsao_id, payload, usuario_id, chave, ultimo_lancamento_em, lancamentos)
    values ('fechamento_fisico', v_prev, jsonb_build_object('fechamento_id', v_id, 'data', p_data, 'periodo_id', p_periodo, 'revisao', v_rev), p_usuario, 'ff|' || v_id::text, now(), 1);
  end if;
  return v_id;
end;
$$;

-- transição de estado (append-only)
create or replace function public.escala_fechamento_resultado(p_fechamento uuid, p_estado text, p_detalhe jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_estado not in ('RECALCULANDO', 'CONFIRMADO', 'ERRO_RECALCULO') then raise exception 'FECHAMENTO_ESTADO_INVALIDO: %', p_estado; end if;
  insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) values (p_fechamento, p_estado, coalesce(p_detalhe, '{}'::jsonb));
  update public.escala_producao_eventos set status = 'processado', processado_em = now()
   where tipo = 'fechamento_fisico' and payload->>'fechamento_id' = p_fechamento::text and p_estado = 'CONFIRMADO' and status in ('pendente', 'processando', 'erro');
end;
$$;

-- trava de recálculo por semana (lease). true = adquirida
create or replace function public.escala_fechamento_trava_adquirir(p_semana date, p_fechamento uuid, p_ttl_s integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  insert into public.escala_fechamento_trava (semana_inicio, fechamento_id, ate) values (p_semana, p_fechamento, now() + make_interval(secs => p_ttl_s))
  on conflict (semana_inicio) do update set fechamento_id = excluded.fechamento_id, ate = excluded.ate
    where public.escala_fechamento_trava.ate < now() or public.escala_fechamento_trava.fechamento_id = excluded.fechamento_id;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
create or replace function public.escala_fechamento_trava_liberar(p_semana date, p_fechamento uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.escala_fechamento_trava where semana_inicio = p_semana and fechamento_id = p_fechamento;
$$;

-- o apontamento do período pode ser lançado por este usuário agora?
create or replace function public.escala_fechamento_apontamento_permitido(p_data date, p_periodo text, p_usuario uuid)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ab record; v_fech record;
begin
  if public.escala_fechamento_fisico_modo() <> 'ativo' then return true; end if;
  select f.* into v_fech from public.escala_fechamentos_vigentes f where f.data = p_data and f.periodo_id = p_periodo;
  if found then
    -- já fechado: só com uma abertura NOVA (correção) do próprio usuário
    select a.* into v_ab from public.escala_fechamento_aberturas a
      where a.data = p_data and a.periodo_id = p_periodo and a.aberto_em > v_fech.fechado_em and a.valido_ate > now()
      order by a.aberto_em desc limit 1;
    return found and v_ab.aberto_por is not distinct from p_usuario;
  end if;
  select a.* into v_ab from public.escala_fechamento_aberturas a
    where a.data = p_data and a.periodo_id = p_periodo and a.valido_ate > now() and not exists (select 1 from public.escala_fechamentos f where f.abertura_id = a.id)
    order by a.aberto_em desc limit 1;
  if not found then return true; end if;                                  -- ninguém abriu a janela: apontamento normal
  return v_ab.aberto_por is not distinct from p_usuario;                  -- janela aberta: só quem abriu
end;
$$;

create or replace function public.escala_trg_apontamento_fechamento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.escala_fechamento_fisico_modo() <> 'ativo' then return new; end if;
  if not public.escala_fechamento_apontamento_permitido(new.data, new.periodo_id, new.criado_por) then
    raise exception 'FECHAMENTO_PERIODO_EM_FECHAMENTO: o período % de % está em fechamento/fechado; o apontamento só pode ser lançado pelo responsável pelo fechamento', new.periodo_id, new.data;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_apontamentos_producao_fechamento on public.apontamentos_producao;
create trigger trg_apontamentos_producao_fechamento before insert on public.apontamentos_producao for each row execute function public.escala_trg_apontamento_fechamento();

do $$
declare f text;
begin
  foreach f in array array[
    'escala_fechamento_abrir(date, date, text, uuid, text, integer, boolean)',
    'escala_fechamento_registrar(uuid, date, date, text, text, timestamptz, timestamptz, timestamptz, uuid, text, integer, integer, jsonb, jsonb, integer, text, boolean, text, text, uuid, boolean)',
    'escala_fechamento_resultado(uuid, text, jsonb)',
    'escala_fechamento_trava_adquirir(date, uuid, integer)',
    'escala_fechamento_trava_liberar(date, uuid)',
    'escala_fechamento_apontamento_permitido(date, text, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.escala_trg_apontamento_fechamento() from public, anon, authenticated;

-- =========================================================================
-- 7) RLS / grants: leitura para quem opera; NENHUMA escrita pelo navegador
-- =========================================================================
do $$
declare t text;
begin
  foreach t in array array['escala_buffers_fisicos', 'escala_buffer_pares', 'escala_buffer_maquinas', 'escala_fechamento_aberturas', 'escala_fechamentos', 'escala_fechamento_buffers', 'escala_fechamento_log', 'escala_fechamento_trava'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin() or public.has_permissao(%L) or public.has_permissao(%L) or public.has_permissao(%L))',
      t || '_leitura', t, 'escala_producao', 'escala_fechamento', 'producao_real_apontamento');
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert on public.%I to service_role', t);
  end loop;
  execute 'grant update, delete on public.escala_fechamento_trava to service_role';
end $$;
grant select on public.escala_fechamentos_vigentes, public.escala_fechamento_estado, public.escala_contagens_fechamento_para_motor, public.escala_wip_erro,
  public.escala_wip_erro_dia, public.escala_wip_erro_maquina, public.escala_wip_erro_produto, public.escala_fechamento_duracao to authenticated, service_role;

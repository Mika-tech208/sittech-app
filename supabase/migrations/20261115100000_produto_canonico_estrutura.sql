-- Sittech — PRODUTO CANÔNICO + ROTAS + MAPA DE LEGADO (Conector 3/4 Convencional + Automática => UM produto final com rotas alternativas).
--
-- FASE F0 (ESTRUTURAL, INERTE). Só objetos NOVOS; nenhuma tabela/função/trigger existente é alterada nem recriada:
--   • 7 tabelas novas (todas vazias após a migration): produto_canonico, produto_rotas, produto_canonico_etapas, produto_canonico_arestas, produto_legado_mapa, etapa_legado_mapa, produto_canonico_ativacoes;
--   • funções novas (puras/stable) de resolução legado -> canônico e de validação do grafo; 2 views (security_invoker) de leitura UNIFICADA (apontamentos e alocações);
--   • UMA chave nova em escala_parametros: `produto_unico_cutover` = null (sem cutover). Inserida com os gatilhos de evento/versão DESLIGADOS (não dispara recálculo nem cria versão de plano).
-- Nada lê estas estruturas enquanto `produto_unico_cutover` for null e o código com a flag desligada for o de hoje => comportamento e hash de plano byte-idênticos.
--
-- O QUE ESTA MIGRATION NÃO FAZ (decisão explícita): não cria o produto canônico (isso é o backfill F1, supabase/ops/produto-unico/10-backfill-conector-unico.sql, depois do código com o guard no ar);
-- não altera produtos/roteiro_etapas/apontamentos/alocações/previsão; não converte histórico; não muda RPC de apontamento nem as funções escala_*.
-- (renumerada de 20261107100000 para 20261115100000: precisa ficar DEPOIS das migrations já aplicadas em PROD até 20261114120000; revisada em 06/11 contra o PROD atual)
-- Reversão: supabase/rollbacks/20261115100000_rollback_produto_canonico_{1_backfill,2_estrutura}.sql (recusam se algum dado do modelo canônico já foi USADO por apontamento/alocação/previsão).
--
-- Conceito: etapa pertence a UM produto (roteiro_etapas.produto_id). O produto canônico P* tem etapas PRÓPRIAS (novas); o produto legado continua com as dele.
--   produto_rotas               rotas de P* (CONVENCIONAL, AUTOMATICA)
--   produto_canonico_etapas     cada etapa de P*: ROTA (trecho exclusivo de uma rota), COMUM (pós-convergência) ou FINAL (a única que conta produto final)
--   produto_canonico_arestas    grafo explícito (a ORDEM do roteiro NÃO é o caminho): Rosquear->Parafusar->Etiquetar, M8->Etiquetar, Etiquetar->Embalar
--   produto_legado_mapa         produto antigo -> P* + rota   |   etapa_legado_mapa  etapa antiga -> etapa de P*
-- Cutover: escala_parametros.produto_unico_cutover = 'YYYY-MM-DD' (segunda-feira). Semana >= cutover é escrita/lida no espaço do produto canônico; anteriores seguem como registradas.

-- =========================================================================
-- 1) Tabelas
-- =========================================================================
create table if not exists public.produto_canonico (
  produto_id uuid primary key references public.produtos(id) on delete restrict,
  codigo text not null unique check (codigo ~ '^[A-Z0-9_]+$'),
  nome_exibicao text not null,
  observacao text,
  criado_em timestamptz not null default now()
);

create table if not exists public.produto_rotas (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produto_canonico(produto_id) on delete restrict,
  codigo text not null check (codigo ~ '^[A-Z0-9_]+$'),
  nome text not null,
  tipo text not null check (tipo in ('convencional', 'automatica', 'outra')),
  ordem integer not null check (ordem >= 1),
  ativa boolean not null default true,
  -- sobrescritas OPCIONAIS por rota (null/ausente = derivado do roteiro, máquinas e custo-hora): custo_peca, capacidade_semanal_max, pessoas_por_posto
  parametros jsonb not null default '{}'::jsonb check (jsonb_typeof(parametros) = 'object'),
  criado_em timestamptz not null default now(),
  unique (produto_id, codigo),
  unique (produto_id, ordem),
  unique (id, produto_id)
);

create table if not exists public.produto_canonico_etapas (
  etapa_id uuid primary key references public.roteiro_etapas(id) on delete restrict,
  produto_id uuid not null references public.produto_canonico(produto_id) on delete restrict,
  rota_id uuid,
  papel text not null check (papel in ('ROTA', 'COMUM', 'FINAL')),
  foreign key (rota_id, produto_id) references public.produto_rotas(id, produto_id) on delete restrict,
  check ((papel = 'ROTA') = (rota_id is not null))
);
create unique index if not exists produto_canonico_etapas_um_final on public.produto_canonico_etapas (produto_id) where papel = 'FINAL';
create index if not exists produto_canonico_etapas_produto on public.produto_canonico_etapas (produto_id);

create table if not exists public.produto_canonico_arestas (
  origem_etapa_id uuid not null references public.produto_canonico_etapas(etapa_id) on delete restrict,
  destino_etapa_id uuid not null references public.produto_canonico_etapas(etapa_id) on delete restrict,
  primary key (origem_etapa_id, destino_etapa_id),
  check (origem_etapa_id <> destino_etapa_id)
);

create table if not exists public.produto_legado_mapa (
  produto_legado_id uuid primary key references public.produtos(id) on delete restrict,
  produto_canonico_id uuid not null references public.produto_canonico(produto_id) on delete restrict,
  rota_id uuid not null references public.produto_rotas(id) on delete restrict,
  observacao text,
  criado_em timestamptz not null default now(),
  check (produto_legado_id <> produto_canonico_id)
);

create table if not exists public.etapa_legado_mapa (
  etapa_legado_id uuid primary key references public.roteiro_etapas(id) on delete restrict,
  etapa_canonica_id uuid not null references public.produto_canonico_etapas(etapa_id) on delete restrict,
  produto_legado_id uuid not null references public.produto_legado_mapa(produto_legado_id) on delete restrict,
  criado_em timestamptz not null default now()
);
create index if not exists etapa_legado_mapa_canonica on public.etapa_legado_mapa (etapa_canonica_id);

-- trilha de auditoria (append-only) das ativações/reversões do cutover
create table if not exists public.produto_canonico_ativacoes (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  acao text not null check (acao in ('backfill', 'ativar', 'desativar', 'reverter', 'rollback_backfill', 'unificar_previsao', 'separar_previsao', 'habilitar_planejamento', 'desabilitar_planejamento')),
  cutover date,
  feito_por text,
  detalhes jsonb not null default '{}'::jsonb
);

-- =========================================================================
-- 2) Integridade que FK não expressa (gatilhos NOVOS, só nas tabelas NOVAS)
-- =========================================================================
create or replace function public.produto_canonico_trg_etapa()
returns trigger
language plpgsql
as $$
declare v_prod uuid;
begin
  select produto_id into v_prod from public.roteiro_etapas where id = new.etapa_id;
  if v_prod is distinct from new.produto_id then
    raise exception 'etapa % não pertence ao produto canônico %', new.etapa_id, new.produto_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_produto_canonico_etapa on public.produto_canonico_etapas;
create trigger trg_produto_canonico_etapa before insert or update on public.produto_canonico_etapas for each row execute function public.produto_canonico_trg_etapa();

create or replace function public.produto_canonico_trg_aresta()
returns trigger
language plpgsql
as $$
declare v_o uuid; v_d uuid;
begin
  select produto_id into v_o from public.produto_canonico_etapas where etapa_id = new.origem_etapa_id;
  select produto_id into v_d from public.produto_canonico_etapas where etapa_id = new.destino_etapa_id;
  if v_o is distinct from v_d then
    raise exception 'aresta entre produtos canônicos diferentes (% -> %)', new.origem_etapa_id, new.destino_etapa_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_produto_canonico_aresta on public.produto_canonico_arestas;
create trigger trg_produto_canonico_aresta before insert or update on public.produto_canonico_arestas for each row execute function public.produto_canonico_trg_aresta();

-- legado -> canônico: a etapa legada pertence ao produto legado; a canônica ao canônico do mapa; a MESMA operação (nunca reinterpretar a operação do histórico)
create or replace function public.produto_canonico_trg_etapa_legado()
returns trigger
language plpgsql
as $$
declare v_pl uuid; v_op_l uuid; v_pc uuid; v_pcan uuid; v_op_c uuid;
begin
  select produto_id, operacao_id into v_pl, v_op_l from public.roteiro_etapas where id = new.etapa_legado_id;
  select produto_id, operacao_id into v_pc, v_op_c from public.roteiro_etapas where id = new.etapa_canonica_id;
  select produto_canonico_id into v_pcan from public.produto_legado_mapa where produto_legado_id = new.produto_legado_id;
  if v_pl is distinct from new.produto_legado_id then raise exception 'etapa legada % não pertence ao produto legado %', new.etapa_legado_id, new.produto_legado_id; end if;
  if v_pc is distinct from v_pcan then raise exception 'etapa canônica % não pertence ao produto canônico do mapa', new.etapa_canonica_id; end if;
  if v_op_l is distinct from v_op_c then raise exception 'operação diferente entre a etapa legada % e a canônica %', new.etapa_legado_id, new.etapa_canonica_id; end if;
  return new;
end;
$$;
drop trigger if exists trg_produto_canonico_etapa_legado on public.etapa_legado_mapa;
create trigger trg_produto_canonico_etapa_legado before insert or update on public.etapa_legado_mapa for each row execute function public.produto_canonico_trg_etapa_legado();

-- trilha append-only
create or replace function public.produto_canonico_trg_imutavel()
returns trigger
language plpgsql
as $$
begin
  raise exception 'produto_canonico_ativacoes é append-only';
end;
$$;
drop trigger if exists trg_produto_canonico_ativacoes_imutavel on public.produto_canonico_ativacoes;
create trigger trg_produto_canonico_ativacoes_imutavel before update or delete on public.produto_canonico_ativacoes for each row execute function public.produto_canonico_trg_imutavel();

-- =========================================================================
-- 3) Cutover (parâmetro) — null = sem cutover
-- =========================================================================
create or replace function public.produto_unico_cutover_valido(v jsonb)
returns boolean
language plpgsql
immutable
as $$
declare s text;
begin
  if v = 'null'::jsonb then return true; end if;
  if jsonb_typeof(v) <> 'string' then return false; end if;
  s := v #>> '{}';
  return s ~ '^\d{4}-\d{2}-\d{2}$' and s >= '2026-11-02' and extract(isodow from s::date) = 1;
exception when others then
  return false;
end;
$$;

alter table public.escala_parametros drop constraint if exists escala_parametros_produto_unico_cutover;
alter table public.escala_parametros add constraint escala_parametros_produto_unico_cutover
  check (chave <> 'produto_unico_cutover' or public.produto_unico_cutover_valido(valor));
-- PLANEJAMENTO antecipado (06/11): mesma validação (segunda-feira >= 2026-11-02 ou null)
alter table public.escala_parametros drop constraint if exists escala_parametros_produto_unico_planejamento;
alter table public.escala_parametros add constraint escala_parametros_produto_unico_planejamento
  check (chave <> 'produto_unico_planejamento_desde' or public.produto_unico_cutover_valido(valor));

alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
alter table public.escala_parametros disable trigger trg_escala_plano_versao;
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('produto_unico_cutover', 'null'::jsonb, 'operacional', 'Produto único com rotas (Conector 3/4): segunda-feira ISO (a partir de 2026-11-02) em que a Previsão/Escala/Apontamento passam a usar o produto canônico. Semanas >= cutover usam o canônico; anteriores seguem como registradas (Conv/Auto). null = sem cutover (padrão, comportamento atual). Alterar dispara recálculo (gatilho de parâmetros): só pelo procedimento de ativação.'),
  ('produto_unico_planejamento_desde', 'null'::jsonb, 'operacional', 'Produto único (Conector 3/4) — PLANEJAMENTO antecipado: segunda-feira ISO (>= 2026-11-02) a partir da qual a Previsão/Forecast, a geração do plano (motor novo) e os indicadores usam o produto único, SEM mudar nada operacional (apontamento, fechamento, buffers, liberação, TV, WIP oficial seguem o cutover). O plano dessas semanas é FUTURO e NÃO LIBERADO. null = sem planejamento antecipado. Só pelo procedimento produto_unico_habilitar_planejamento.')
on conflict (chave) do nothing;
alter table public.escala_parametros enable trigger trg_escala_plano_versao;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

create or replace function public.produto_unico_cutover()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(valor) = 'string' then (valor #>> '{}')::date else null end from public.escala_parametros where chave = 'produto_unico_cutover';
$$;

-- a semana (qualquer data dela) usa o espaço canônico?
create or replace function public.produto_unico_ativo(p_data date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(date_trunc('week', p_data)::date >= public.produto_unico_cutover(), false);
$$;

-- PLANEJAMENTO: a semana (qualquer data dela) usa o produto único na Previsão/Forecast e na geração do plano? (>= o MENOR entre planejamento_desde e cutover)
create or replace function public.produto_unico_planejamento_desde()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(valor) = 'string' then (valor #>> '{}')::date else null end from public.escala_parametros where chave = 'produto_unico_planejamento_desde';
$$;

create or replace function public.produto_unico_planejando(p_data date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(date_trunc('week', p_data)::date >= least(public.produto_unico_planejamento_desde(), public.produto_unico_cutover()), false);   -- least ignora null
$$;

-- modo da semana: LEGADO | PLANEJAMENTO (planejando e ainda não operacional) | OPERACIONAL (>= cutover). Espelha modoProdutoUnicoDaSemana (cutover.ts).
create or replace function public.produto_unico_modo(p_data date)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.produto_unico_ativo(p_data) then 'OPERACIONAL' when public.produto_unico_planejando(p_data) then 'PLANEJAMENTO' else 'LEGADO' end;
$$;

-- =========================================================================
-- 4) Resolução legado -> canônico (idempotente: canônico e não-participante passam como estão)
-- =========================================================================
create or replace function public.produto_canonico_de(p_produto uuid)
returns table (produto_canonico_id uuid, rota_id uuid, tipo_entrada text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select m.produto_canonico_id, m.rota_id, 'legado'::text from public.produto_legado_mapa m where m.produto_legado_id = p_produto
  union all
  select c.produto_id, null::uuid, 'canonico'::text from public.produto_canonico c where c.produto_id = p_produto
  union all
  select p_produto, null::uuid, 'fora'::text
   where not exists (select 1 from public.produto_legado_mapa m where m.produto_legado_id = p_produto)
     and not exists (select 1 from public.produto_canonico c where c.produto_id = p_produto);
$$;

create or replace function public.etapa_canonica_de(p_etapa uuid)
returns table (etapa_canonica_id uuid, produto_canonico_id uuid, rota_id uuid, papel text, tipo_entrada text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.etapa_canonica_id, ce.produto_id, coalesce(ce.rota_id, pm.rota_id), ce.papel, 'legado'::text
    from public.etapa_legado_mapa l
    join public.produto_canonico_etapas ce on ce.etapa_id = l.etapa_canonica_id
    join public.produto_legado_mapa pm on pm.produto_legado_id = l.produto_legado_id
   where l.etapa_legado_id = p_etapa
  union all
  select ce.etapa_id, ce.produto_id, ce.rota_id, ce.papel, 'canonico'::text from public.produto_canonico_etapas ce where ce.etapa_id = p_etapa
  union all
  select p_etapa, null::uuid, null::uuid, null::text, 'fora'::text
   where not exists (select 1 from public.etapa_legado_mapa l where l.etapa_legado_id = p_etapa)
     and not exists (select 1 from public.produto_canonico_etapas ce where ce.etapa_id = p_etapa);
$$;

-- rota que uma MÁQUINA serve num produto canônico (etapas anteriores ao ponto de convergência; null nas etapas comuns)
create or replace function public.rota_da_maquina(p_produto uuid, p_maquina uuid)
returns table (rota_id uuid, etapa_id uuid, papel text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select ce.rota_id, ce.etapa_id, ce.papel
    from public.produto_canonico_etapas ce join public.roteiro_etapa_maquinas rem on rem.etapa_id = ce.etapa_id
   where ce.produto_id = p_produto and rem.maquina_id = p_maquina;
$$;

-- Problemas do grafo/cadastro do produto canônico (vazio = íntegro). Mesmas exigências do motor e do RPC de apontamento (máquina => exatamente UMA etapa).
create or replace function public.produto_canonico_problemas(p_produto uuid)
returns setof text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare n int; r record;
begin
  select count(*) into n from public.produto_canonico_etapas where produto_id = p_produto and papel = 'FINAL';
  if n <> 1 then return next format('esperada 1 etapa FINAL, há %s', n); end if;
  -- FINAL não tem saída; as demais têm pelo menos uma
  for r in select e.etapa_id, e.papel from public.produto_canonico_etapas e where e.produto_id = p_produto loop
    select count(*) into n from public.produto_canonico_arestas a where a.origem_etapa_id = r.etapa_id;
    if r.papel = 'FINAL' and n > 0 then return next format('etapa FINAL %s tem saída', r.etapa_id); end if;
    if r.papel <> 'FINAL' and n = 0 then return next format('etapa %s sem saída (não chega ao produto final)', r.etapa_id); end if;
  end loop;
  -- todo nó alcança o FINAL (e o grafo é acíclico: profundidade limitada ao nº de nós)
  for r in
    with recursive alc(etapa_id, prof) as (
      select e.etapa_id, 0 from public.produto_canonico_etapas e where e.produto_id = p_produto and e.papel = 'FINAL'
      union
      select a.origem_etapa_id, alc.prof + 1 from public.produto_canonico_arestas a join alc on a.destino_etapa_id = alc.etapa_id
       where alc.prof <= (select count(*) from public.produto_canonico_etapas where produto_id = p_produto)
    )
    select e.etapa_id from public.produto_canonico_etapas e where e.produto_id = p_produto and e.etapa_id not in (select etapa_id from alc)
  loop
    return next format('etapa %s não alcança o produto final', r.etapa_id);
  end loop;
  if exists (
    with recursive cam(origem, atual, prof) as (
      select a.origem_etapa_id, a.destino_etapa_id, 1 from public.produto_canonico_arestas a join public.produto_canonico_etapas e on e.etapa_id = a.origem_etapa_id where e.produto_id = p_produto
      union all
      select cam.origem, a.destino_etapa_id, cam.prof + 1 from cam join public.produto_canonico_arestas a on a.origem_etapa_id = cam.atual
       where cam.prof <= (select count(*) from public.produto_canonico_etapas where produto_id = p_produto)
    )
    select 1 from cam where cam.atual = cam.origem
  ) then return next 'ciclo no grafo'; end if;
  -- máquina em mais de uma etapa do mesmo produto = apontamento ambíguo (registrar_apontamento_producao recusa)
  for r in
    select rem.maquina_id, count(*) c from public.produto_canonico_etapas e join public.roteiro_etapa_maquinas rem on rem.etapa_id = e.etapa_id
     where e.produto_id = p_produto group by rem.maquina_id having count(*) > 1
  loop
    return next format('máquina %s elegível em %s etapas do produto (apontamento ambíguo)', r.maquina_id, r.c);
  end loop;
  -- nenhuma etapa sem máquina elegível
  for r in select e.etapa_id from public.produto_canonico_etapas e where e.produto_id = p_produto and not exists (select 1 from public.roteiro_etapa_maquinas rem where rem.etapa_id = e.etapa_id) loop
    return next format('etapa %s sem máquina elegível', r.etapa_id);
  end loop;
  return;
end;
$$;

-- =========================================================================
-- 5) Visões UNIFICADAS de leitura (histórico continua legível como registrado; estas só AGREGAM no espaço canônico)
-- =========================================================================
-- Apontamentos: produto/etapa REGISTRADOS + canônicos. conta_como_final = só a etapa FINAL (Embalagem 17) — nunca somar M8/Rosquear/Parafusar/Etiquetar como produto final.
create or replace view public.vw_apontamentos_canonicos with (security_invoker = true) as
select a.id, a.data, a.periodo_id, a.maquina_id, a.funcionario_id, a.status,
       a.produto_id as produto_registrado_id, a.etapa_id as etapa_registrada_id,
       coalesce(ec.produto_canonico_id, a.produto_id) as produto_canonico_id,
       coalesce(ec.etapa_canonica_id, a.etapa_id) as etapa_canonica_id,
       ec.rota_id, ec.papel,
       (ec.tipo_entrada = 'legado') as era_legado,
       (a.quantidade_produzida - coalesce(a.quantidade_refugo, 0)) as quantidade_boa,
       a.quantidade_produzida, a.quantidade_refugo,
       (ec.papel = 'FINAL') as conta_como_final
  from public.apontamentos_producao a
  left join lateral public.etapa_canonica_de(a.etapa_id) ec on true;

-- Alocações: uma linha por (posto, canônico). Linha compartilhada com `distribuicao` (Conv+Auto na Etiquetadora 15/Embalagem 17) vira UMA linha canônica com a soma (= pecas da linha).
create or replace view public.vw_alocacoes_canonicas with (security_invoker = true) as
with itens as (
  select a.data, a.periodo_id, a.funcionario_id, a.maquina_id, a.operacao_id, a.produto_id, a.etapa_id, a.pecas, false as compartilhada
    from public.escala_producao_alocacoes a where a.distribuicao is null
  union all
  select a.data, a.periodo_id, a.funcionario_id, a.maquina_id, a.operacao_id, (x->>'produto_id')::uuid, (x->>'etapa_id')::uuid, (x->>'pecas')::numeric, true
    from public.escala_producao_alocacoes a, jsonb_array_elements(a.distribuicao) x where a.distribuicao is not null
)
select i.data, i.periodo_id, i.funcionario_id, i.maquina_id, i.operacao_id,
       coalesce(ec.produto_canonico_id, i.produto_id) as produto_canonico_id,
       coalesce(ec.etapa_canonica_id, i.etapa_id) as etapa_canonica_id,
       ec.papel,
       sum(i.pecas) as pecas,
       bool_or(i.compartilhada) as era_compartilhada,
       array_agg(distinct i.produto_id) as produtos_registrados
  from itens i
  left join lateral public.etapa_canonica_de(i.etapa_id) ec on true
 group by i.data, i.periodo_id, i.funcionario_id, i.maquina_id, i.operacao_id, coalesce(ec.produto_canonico_id, i.produto_id), coalesce(ec.etapa_canonica_id, i.etapa_id), ec.papel;

-- =========================================================================
-- 6) RLS / grants: leitura para quem opera Previsão/Escala; escrita só service_role (backfill/ativação por script)
-- =========================================================================
do $$
declare t text;
begin
  foreach t in array array['produto_canonico', 'produto_rotas', 'produto_canonico_etapas', 'produto_canonico_arestas', 'produto_legado_mapa', 'etapa_legado_mapa', 'produto_canonico_ativacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_leitura', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.produto_canonico_ativacoes_id_seq from anon, authenticated;
grant usage, select on sequence public.produto_canonico_ativacoes_id_seq to service_role;
revoke update, delete on public.produto_canonico_ativacoes from service_role;

grant select on public.vw_apontamentos_canonicos, public.vw_alocacoes_canonicas to authenticated, service_role;
revoke all on function public.produto_unico_cutover() from public, anon;
revoke all on function public.produto_unico_planejamento_desde() from public, anon;
revoke all on function public.produto_unico_planejando(date) from public, anon;
revoke all on function public.produto_unico_modo(date) from public, anon;
grant execute on function public.produto_unico_planejamento_desde() to authenticated, service_role;
grant execute on function public.produto_unico_planejando(date) to authenticated, service_role;
grant execute on function public.produto_unico_modo(date) to authenticated, service_role;
revoke all on function public.produto_unico_ativo(date) from public, anon;
grant execute on function public.produto_unico_cutover() to authenticated, service_role;
grant execute on function public.produto_unico_ativo(date) to authenticated, service_role;
grant execute on function public.produto_canonico_de(uuid), public.etapa_canonica_de(uuid), public.rota_da_maquina(uuid, uuid), public.produto_canonico_problemas(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

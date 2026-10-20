-- Sittech — Escala de Produção, FASE 3: controle mínimo de ESTOQUE INTERMEDIÁRIO (WIP).
--
-- Não é um ERP de estoque: só o necessário para saber, por produto e par de etapas consecutivas (origem → seguinte),
--   • quanto existe aguardando a etapa seguinte (ESTIMADO: calculado a partir da Produção Real — fica só no cálculo),
--   • quanto desse saldo foi CONFIRMADO por uma pessoa (único que altera o planejamento),
--   • os ajustes manuais (contagem física) e o histórico, que nunca é sobrescrito,
--   • a foto SEMANAL: "na abertura da semana havia X peças de WIP confirmado nesta etapa" (nunca recalculada depois).
--
-- Toda escrita é feita pelo servidor (service_role) depois de checar a permissão do usuário; o navegador só LÊ.
-- Permissão nova e específica: escala_wip_confirmar (administrador sempre pode).
-- Aditiva e reversível: com wip_modo = 'desligado' nada daqui altera a escala.

-- =========================================================================
-- 1) Permissão específica (mesmo padrão das migrations anteriores: recria o CHECK com a lista completa)
-- =========================================================================
alter table public.usuario_permissoes drop constraint usuario_permissoes_permissao_check;
alter table public.usuario_permissoes add constraint usuario_permissoes_permissao_check check (permissao in (
  'financeiro', 'produtos', 'maquinas', 'funcionarios', 'custo_hora',
  'previsao', 'capacidade',
  'producao_real_apontamento', 'producao_real_historico', 'producao_real_ocorrencias',
  'producao_real_apontamentos_realizados',
  'usuarios', 'auditoria',
  'ausencias_funcionarios',
  'escala_producao', 'escala_producao_tv',
  'escala_wip_confirmar'
));

-- =========================================================================
-- 2) Tabelas
-- =========================================================================
create table if not exists public.wip_controle (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id),
  etapa_origem_id uuid not null references public.roteiro_etapas(id),
  etapa_seguinte_id uuid not null references public.roteiro_etapas(id),
  data_inicio date not null,                      -- a Produção Real conta a partir daqui
  saldo_inicial numeric not null default 0 check (saldo_inicial >= 0),
  ativo boolean not null default true,
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint wip_controle_par_unico unique (etapa_origem_id, etapa_seguinte_id),
  constraint wip_controle_etapas_distintas check (etapa_origem_id <> etapa_seguinte_id)
);

-- Ajuste manual (contagem física, correção). Sempre com motivo; nunca sobrescreve: é uma nova linha.
create table if not exists public.wip_ajustes (
  id uuid primary key default gen_random_uuid(),
  controle_id uuid not null references public.wip_controle(id),
  data date not null,                             -- dia a que o ajuste se refere
  quantidade numeric not null check (quantidade <> 0),   -- + soma / − tira
  motivo text not null check (length(btrim(motivo)) >= 3),
  chave_idempotencia uuid unique,
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_em timestamptz not null default now()
);

-- Confirmação: a pessoa atesta que EXISTEM `quantidade_confirmada` peças aguardando a etapa seguinte ao fim de `data_referencia`.
-- É a única forma de o saldo entrar no planejamento. Divergência do estimado exige motivo.
create table if not exists public.wip_confirmacoes (
  id uuid primary key default gen_random_uuid(),
  controle_id uuid not null references public.wip_controle(id),
  data_referencia date not null,
  quantidade_confirmada numeric not null check (quantidade_confirmada >= 0),
  saldo_estimado numeric not null,                -- o que o sistema estimava no momento (pode ser negativo = inconsistência)
  motivo text,
  chave_idempotencia uuid unique,
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint wip_confirmacoes_motivo_se_divergente check (quantidade_confirmada = saldo_estimado or length(btrim(coalesce(motivo, ''))) >= 3)
);

-- Foto semanal (auditoria/histórico). Gravada UMA vez, na abertura da semana, e nunca alterada.
create table if not exists public.wip_saldo_semanal (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null,
  controle_id uuid not null references public.wip_controle(id),
  produto_id uuid not null,                       -- cópias: o histórico não muda se o cadastro mudar
  etapa_origem_id uuid not null,
  etapa_seguinte_id uuid not null,
  saldo_estimado numeric not null,
  saldo_confirmado_disponivel numeric not null check (saldo_confirmado_disponivel >= 0),   -- confirmado ainda não consumido na abertura
  saldo_alocado numeric not null check (saldo_alocado >= 0),                               -- o que ESTA semana usa (reduz a produção da etapa origem)
  origem text not null default 'abertura' check (origem in ('abertura', 'manual')),
  criado_em timestamptz not null default now(),
  constraint wip_saldo_semanal_unico unique (semana_inicio, controle_id)
);

create index if not exists wip_ajustes_controle_idx on public.wip_ajustes (controle_id, data);
create index if not exists wip_confirmacoes_controle_idx on public.wip_confirmacoes (controle_id, data_referencia desc, criado_em desc);
create index if not exists wip_saldo_semanal_semana_idx on public.wip_saldo_semanal (semana_inicio);

-- Histórico imutável: nada é editado nem apagado (correção = nova linha)
create or replace function public.wip_trg_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'WIP_HISTORICO_IMUTAVEL: % não pode ser alterado nem apagado (registre um novo ajuste/confirmação)', tg_table_name;
end;
$$;
drop trigger if exists trg_wip_ajustes_imutavel on public.wip_ajustes;
create trigger trg_wip_ajustes_imutavel before update or delete on public.wip_ajustes for each row execute function public.wip_trg_imutavel();
drop trigger if exists trg_wip_confirmacoes_imutavel on public.wip_confirmacoes;
create trigger trg_wip_confirmacoes_imutavel before update or delete on public.wip_confirmacoes for each row execute function public.wip_trg_imutavel();
drop trigger if exists trg_wip_saldo_semanal_imutavel on public.wip_saldo_semanal;
create trigger trg_wip_saldo_semanal_imutavel before update or delete on public.wip_saldo_semanal for each row execute function public.wip_trg_imutavel();

-- wip_controle: só `ativo` pode mudar (o resto é identidade do controle); nunca apagar
create or replace function public.wip_trg_controle()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'WIP_HISTORICO_IMUTAVEL: o controle não pode ser apagado (desative-o)';
  end if;
  if new.produto_id <> old.produto_id or new.etapa_origem_id <> old.etapa_origem_id or new.etapa_seguinte_id <> old.etapa_seguinte_id
     or new.data_inicio <> old.data_inicio or new.saldo_inicial <> old.saldo_inicial then
    raise exception 'WIP_HISTORICO_IMUTAVEL: só o campo "ativo" do controle pode mudar (corrija o saldo com um ajuste)';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_wip_controle_imutavel on public.wip_controle;
create trigger trg_wip_controle_imutavel before update or delete on public.wip_controle for each row execute function public.wip_trg_controle();

-- =========================================================================
-- 3) RLS: leitura para quem opera a Previsão/Escala; NENHUMA escrita pelo navegador
-- =========================================================================
alter table public.wip_controle enable row level security;
alter table public.wip_ajustes enable row level security;
alter table public.wip_confirmacoes enable row level security;
alter table public.wip_saldo_semanal enable row level security;

do $$
declare t text;
begin
  foreach t in array array['wip_controle', 'wip_ajustes', 'wip_confirmacoes', 'wip_saldo_semanal'] loop
    execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin() or public.has_permissao(%L) or public.has_permissao(%L) or public.has_permissao(%L))',
      t || '_leitura', t, 'previsao', 'escala_producao', 'escala_wip_confirmar');
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update on public.%I to service_role', t);
  end loop;
end $$;

-- =========================================================================
-- 4) Alterou o canônico (controle, ajuste, confirmação) => recalcula as semanas com escala futura (só se WIP ativo)
-- =========================================================================
create or replace function public.escala_trg_wip()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
begin
  if public.escala_wip_modo() = 'ativo' then
    for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
      perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('tabela', tg_table_name), null);
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function public.escala_trg_wip() from public, anon, authenticated;
drop trigger if exists trg_wip_controle_evento on public.wip_controle;
create trigger trg_wip_controle_evento after insert or update on public.wip_controle for each row execute function public.escala_trg_wip();
drop trigger if exists trg_wip_ajustes_evento on public.wip_ajustes;
create trigger trg_wip_ajustes_evento after insert on public.wip_ajustes for each row execute function public.escala_trg_wip();
drop trigger if exists trg_wip_confirmacoes_evento on public.wip_confirmacoes;
create trigger trg_wip_confirmacoes_evento after insert on public.wip_confirmacoes for each row execute function public.escala_trg_wip();

-- =========================================================================
-- 5) RPCs — só o servidor (service_role) executa, depois de checar a permissão do usuário
-- =========================================================================
create or replace function public.wip_hoje()
returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- Produção Real BOA por etapa e dia (produzida − refugo), agregada. O servidor (service_role) NÃO tem acesso direto a
-- apontamentos_producao (select restrito): esta função devolve só o agregado de que o controle de WIP precisa.
create or replace function public.wip_producao_boas(p_etapa_ids uuid[], p_desde date)
returns table (etapa_id uuid, data date, boas numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.etapa_id, a.data, coalesce(sum(a.quantidade_produzida - a.quantidade_refugo), 0)::numeric
  from public.apontamentos_producao a
  where a.etapa_id = any(p_etapa_ids) and a.data >= p_desde
  group by a.etapa_id, a.data
$$;

create or replace function public.wip_controle_criar(
  p_usuario_id uuid, p_produto_id uuid, p_etapa_origem_id uuid, p_etapa_seguinte_id uuid, p_data_inicio date, p_saldo_inicial numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o roteiro_etapas; v_s roteiro_etapas; v_prox uuid; v_id uuid;
begin
  select * into v_o from roteiro_etapas where id = p_etapa_origem_id and produto_id = p_produto_id;
  select * into v_s from roteiro_etapas where id = p_etapa_seguinte_id and produto_id = p_produto_id;
  if v_o.id is null or v_s.id is null then raise exception 'WIP_ETAPA_INVALIDA: as etapas precisam pertencer ao roteiro do produto'; end if;
  select id into v_prox from roteiro_etapas where produto_id = p_produto_id and (ordem, id) > (v_o.ordem, v_o.id) order by ordem, id limit 1;
  if v_prox is distinct from v_s.id then raise exception 'WIP_ETAPAS_NAO_CONSECUTIVAS: a etapa seguinte precisa ser a imediatamente posterior à origem no roteiro'; end if;
  if p_data_inicio is null then raise exception 'WIP_DATA_INICIO: informe a data de início do controle'; end if;
  if coalesce(p_saldo_inicial, 0) < 0 then raise exception 'WIP_SALDO_INICIAL_NEGATIVO'; end if;
  insert into wip_controle (produto_id, etapa_origem_id, etapa_seguinte_id, data_inicio, saldo_inicial, criado_por)
  values (p_produto_id, p_etapa_origem_id, p_etapa_seguinte_id, p_data_inicio, coalesce(p_saldo_inicial, 0), p_usuario_id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.wip_controle_ativar(p_usuario_id uuid, p_controle_id uuid, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update wip_controle set ativo = p_ativo where id = p_controle_id;
  if not found then raise exception 'WIP_CONTROLE_INEXISTENTE'; end if;
end;
$$;

create or replace function public.wip_ajustar(
  p_usuario_id uuid, p_controle_id uuid, p_data date, p_quantidade numeric, p_motivo text, p_chave uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c wip_controle; v_id uuid;
begin
  if p_chave is not null then
    select id into v_id from wip_ajustes where chave_idempotencia = p_chave;
    if v_id is not null then return v_id; end if;
  end if;
  select * into v_c from wip_controle where id = p_controle_id;
  if v_c.id is null then raise exception 'WIP_CONTROLE_INEXISTENTE'; end if;
  if not v_c.ativo then raise exception 'WIP_CONTROLE_INATIVO'; end if;
  if coalesce(p_quantidade, 0) = 0 then raise exception 'WIP_AJUSTE_ZERO: informe uma quantidade diferente de zero'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'WIP_MOTIVO_OBRIGATORIO: o motivo do ajuste é obrigatório'; end if;
  if p_data < v_c.data_inicio or p_data > public.wip_hoje() then raise exception 'WIP_DATA_INVALIDA: a data do ajuste precisa estar entre o início do controle e hoje'; end if;
  insert into wip_ajustes (controle_id, data, quantidade, motivo, chave_idempotencia, criado_por)
  values (p_controle_id, p_data, p_quantidade, btrim(p_motivo), p_chave, p_usuario_id) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.wip_confirmar(
  p_usuario_id uuid, p_controle_id uuid, p_data_referencia date, p_quantidade numeric, p_saldo_estimado numeric, p_motivo text, p_chave uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c wip_controle; v_id uuid;
begin
  if p_chave is not null then
    select id into v_id from wip_confirmacoes where chave_idempotencia = p_chave;
    if v_id is not null then return v_id; end if;
  end if;
  select * into v_c from wip_controle where id = p_controle_id;
  if v_c.id is null then raise exception 'WIP_CONTROLE_INEXISTENTE'; end if;
  if not v_c.ativo then raise exception 'WIP_CONTROLE_INATIVO'; end if;
  if coalesce(p_quantidade, -1) < 0 then raise exception 'WIP_QUANTIDADE_INVALIDA: a quantidade confirmada não pode ser negativa'; end if;
  if p_data_referencia < v_c.data_inicio or p_data_referencia > public.wip_hoje() then raise exception 'WIP_DATA_INVALIDA: a data da confirmação precisa estar entre o início do controle e hoje'; end if;
  if p_quantidade <> p_saldo_estimado and length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'WIP_MOTIVO_OBRIGATORIO: a quantidade difere do estimado (%) — informe o motivo', p_saldo_estimado;
  end if;
  insert into wip_confirmacoes (controle_id, data_referencia, quantidade_confirmada, saldo_estimado, motivo, chave_idempotencia, criado_por)
  values (p_controle_id, p_data_referencia, p_quantidade, p_saldo_estimado, nullif(btrim(coalesce(p_motivo, '')), ''), p_chave, p_usuario_id) returning id into v_id;
  return v_id;
end;
$$;

-- Foto semanal: idempotente e NUNCA atualiza (a 1ª gravada vale). p_itens = [{controle_id, saldo_estimado, saldo_confirmado_disponivel, saldo_alocado}]
create or replace function public.wip_gravar_snapshots(p_semana_inicio date, p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb; v_c wip_controle; v_n integer := 0; v_lin integer;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    select * into v_c from wip_controle where id = (v_item->>'controle_id')::uuid;
    if v_c.id is null then continue; end if;
    insert into wip_saldo_semanal (semana_inicio, controle_id, produto_id, etapa_origem_id, etapa_seguinte_id, saldo_estimado, saldo_confirmado_disponivel, saldo_alocado)
    values (p_semana_inicio, v_c.id, v_c.produto_id, v_c.etapa_origem_id, v_c.etapa_seguinte_id,
            (v_item->>'saldo_estimado')::numeric, greatest(0, (v_item->>'saldo_confirmado_disponivel')::numeric), greatest(0, (v_item->>'saldo_alocado')::numeric))
    on conflict (semana_inicio, controle_id) do nothing;
    get diagnostics v_lin = row_count;
    v_n := v_n + v_lin;
  end loop;
  return v_n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'wip_controle_criar(uuid, uuid, uuid, uuid, date, numeric)',
    'wip_controle_ativar(uuid, uuid, boolean)',
    'wip_ajustar(uuid, uuid, date, numeric, text, uuid)',
    'wip_confirmar(uuid, uuid, date, numeric, numeric, text, uuid)',
    'wip_gravar_snapshots(date, jsonb)',
    'wip_producao_boas(uuid[], date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

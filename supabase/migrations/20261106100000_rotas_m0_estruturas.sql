-- Sittech — PRODUTO ÚNICO COM MÚLTIPLAS ROTAS — M0: INFRAESTRUTURA ADITIVA (somente DEV nesta rodada).
-- Desenho: docs/produto-unico-multiplas-rotas-desenho.md (revisão 2 + decisões finais).
--
-- TERMINOLOGIA (fluxo da fábrica):
--   • "rota" = TRECHO EXCLUSIVO anterior à convergência. CONV = Rosquear → Parafusar; AUTO = Rosquear + Parafusar. As rotas são CAMINHOS ALTERNATIVOS: nenhuma peça passa de uma rota para a outra.
--   • "pool comum" = o fluxo COMUM depois da convergência: Etiquetar → Embalar (final). Etiquetar e Embalar existem UMA vez só (nunca "Etiquetar CONV/AUTO"); o produto depois de Embalar é o mesmo, qualquer que seja a origem.
--   • `roteiro_etapas.ordem` é só rótulo de cadastro/apresentação; NÃO é o caminho (0→1→2→3→4 seria fisicamente errado).
--
-- Regras desta migration:
--  • só CRIA objetos novos (tabelas, funções, gatilhos) + UMA coluna com default em `previsoes` (modelo_rotas = false). Nenhuma linha existente muda; nenhum produto/etapa existente é tocado.
--  • produto SEM rotas continua exatamente no modelo legado (a sequência/etapa final de produto linear segue sendo por `ordem`/max(ordem), como hoje).
--  • produto COM rotas (produto_rota) NÃO usa ordem+1 nem max(ordem): a sequência vem de produto_rota + rota_etapas + produto_pool_comum, e a etapa FINAL é a marcada explicitamente (final = true).
--  • nada aqui ativa o planejador, muda a Escala, a Previsão oficial ou a Produção Real.

-- =========================================================================
-- 1) Rotas de um produto final (CONV, AUTO, …)
-- =========================================================================
create table public.produto_rota (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete restrict,
  codigo text not null check (codigo ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  nome text not null,
  ativa boolean not null default true,
  preferencia smallint not null default 100,           -- desempate do planejador (menor = preferida). NÃO é regra rígida.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (produto_id, codigo)
);
create trigger trg_produto_rota_updated_at before update on public.produto_rota for each row execute function set_updated_at();

-- Etapas EXCLUSIVAS de cada rota, em ordem (antes do pool comum)
create table public.rota_etapas (
  rota_id uuid not null references public.produto_rota(id) on delete restrict,
  etapa_id uuid not null references public.roteiro_etapas(id) on delete restrict,
  posicao smallint not null check (posicao >= 0),
  primary key (rota_id, etapa_id),
  unique (rota_id, posicao)
);

-- POOL COMUM = convergência explícita: etapas comuns (depois do ponto de convergência), em ordem; exatamente UMA é a etapa FINAL (a que conta produto acabado)
create table public.produto_pool_comum (
  produto_id uuid not null references public.produtos(id) on delete restrict,
  etapa_id uuid not null references public.roteiro_etapas(id) on delete restrict,
  posicao smallint not null check (posicao >= 0),
  final boolean not null default false,
  primary key (produto_id, etapa_id),
  unique (produto_id, posicao)
);
create unique index uq_produto_pool_comum_final on public.produto_pool_comum (produto_id) where final;

-- Limite MÁXIMO por rota numa Previsão (V1). Chave lógica estável (a Previsão recria `previsao_itens` a cada save, então NÃO se prende ao id do item).
create table public.previsao_rota_limite (
  previsao_id uuid not null references public.previsoes(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  rota_id uuid not null references public.produto_rota(id) on delete restrict,
  modo text not null default 'maximo' check (modo = 'maximo'),     -- V1: só 'maximo'; 'minimo'/'fixo' entram depois por ALTER do CHECK (aditivo)
  quantidade numeric not null check (quantidade >= 0),
  primary key (previsao_id, produto_id, rota_id)
);

-- Divisão decidida pelo planejador (FUTURO — nesta rodada só a estrutura; append-only)
create table public.escala_rota_divisao (
  id uuid primary key default gen_random_uuid(),
  previsao_id uuid not null references public.previsoes(id) on delete restrict,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  rota_id uuid not null references public.produto_rota(id) on delete restrict,
  versao_plano_id uuid,                               -- escala_plano_versoes.id (sem FK, como o próprio histórico de versões)
  quantidade_alvo numeric not null check (quantidade_alvo >= 0),
  capacidade_rota numeric check (capacidade_rota >= 0),
  motivo jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create trigger trg_escala_rota_divisao_imutavel before update or delete on public.escala_rota_divisao for each row execute function public.escala_sombra_trg_imutavel();

-- Vínculo ANALÍTICO dos produtos legados com o produto final de rotas (relatórios/comparações; nunca altera dados)
create table public.produto_variante_legada (
  produto_legado_id uuid primary key references public.produtos(id) on delete restrict,
  produto_final_id uuid not null references public.produtos(id) on delete restrict,
  rota_id uuid not null references public.produto_rota(id) on delete restrict,
  desde date,                                          -- semana de corte (definida na ativação; NULL enquanto não ativado)
  check (produto_legado_id <> produto_final_id)
);

comment on table public.produto_rota is 'Forma de fabricar = TRECHO EXCLUSIVO anterior à convergência (CONV, AUTO). Caminhos alternativos; não contém Etiquetar/Embalar.';
comment on table public.rota_etapas is 'Somente as etapas EXCLUSIVAS de cada rota, em ordem. Etapas comuns NUNCA entram aqui (ficam uma vez em produto_pool_comum).';
comment on table public.produto_pool_comum is 'Fluxo COMUM depois da convergência (Etiquetar → Embalar), uma vez por produto final; `final` marca explicitamente a etapa que conta produto acabado.';
comment on table public.previsao_rota_limite is 'Limite MÁXIMO (V1) de entrega de uma rota (trecho exclusivo) ao pool comum numa Previsão. Nunca limita as etapas comuns.';
comment on table public.escala_rota_divisao is 'Quanto cada rota ENTREGA ao pool comum (trecho exclusivo). Etiquetar/Embalar têm UMA necessidade total (= demanda restante), nunca uma parte por rota.';
comment on column public.escala_rota_divisao.quantidade_alvo is 'Entrega planejada da rota ao pool comum; Σ das rotas ≤ demanda final. NÃO é demanda de Etiquetar/Embalar por rota.';

-- Chave por Previsão: semana no modelo de rotas (padrão false = comportamento legado para TODAS as semanas existentes)
alter table public.previsoes add column modelo_rotas boolean not null default false;

-- =========================================================================
-- 2) RLS (leitura para usuários ativos; escrita admin/permissão `produtos`, como `produtos`)
-- =========================================================================
do $$
declare t text;
begin
  foreach t in array array['produto_rota', 'rota_etapas', 'produto_pool_comum', 'previsao_rota_limite', 'produto_variante_legada'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_usuario_ativo())', t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin() or public.has_permissao(''produtos'')) with check (public.is_admin() or public.has_permissao(''produtos''))', t || '_escrita', t);
  end loop;
end $$;
-- privilégios de tabela (a RLS acima restringe as linhas; sem estes GRANTs nem o service_role do servidor enxerga as tabelas novas)
grant select, insert, update, delete on public.produto_rota, public.rota_etapas, public.produto_pool_comum, public.previsao_rota_limite, public.produto_variante_legada to authenticated;
grant select on public.produto_rota, public.rota_etapas, public.produto_pool_comum, public.previsao_rota_limite, public.produto_variante_legada to service_role;
alter table public.escala_rota_divisao enable row level security;
create policy escala_rota_divisao_select on public.escala_rota_divisao for select to authenticated using (public.is_admin() or public.has_permissao('escala_producao'));
revoke all on public.escala_rota_divisao from anon, authenticated;
grant select on public.escala_rota_divisao to authenticated;
grant select, insert on public.escala_rota_divisao to service_role;

-- =========================================================================
-- 3) Integridade do produto de rotas (validada no COMMIT: cadastros em várias linhas na mesma transação)
-- =========================================================================
create or replace function public.produto_rotas_validar(p_produto uuid)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_n_rotas int; v_n_comum int; v_n_final int; v_orfas int; v_ops_dup int; v_final_nao_ultima int; r record;
begin
  select count(*) into v_n_rotas from produto_rota where produto_id = p_produto;
  select count(*), count(*) filter (where final) into v_n_comum, v_n_final from produto_pool_comum where produto_id = p_produto;
  if v_n_rotas = 0 then
    if v_n_comum > 0 then raise exception 'ROTAS_POOL_SEM_ROTA: produto % tem pool comum mas nenhuma rota', p_produto; end if;
    return;   -- produto linear (legado): nada a validar
  end if;
  if v_n_rotas < 2 then raise exception 'ROTAS_MINIMO_DUAS: produto % precisa de pelo menos duas rotas para usar o modelo de rotas', p_produto; end if;
  if v_n_comum = 0 then raise exception 'ROTAS_SEM_POOL_COMUM: produto % não tem pool comum (convergência)', p_produto; end if;
  if v_n_final <> 1 then raise exception 'ROTAS_ETAPA_FINAL: produto % precisa de exatamente UMA etapa final no pool comum (tem %)', p_produto, v_n_final; end if;
  select count(*) into v_final_nao_ultima from produto_pool_comum f where f.produto_id = p_produto and f.final and f.posicao <> (select max(posicao) from produto_pool_comum where produto_id = p_produto);
  if v_final_nao_ultima > 0 then raise exception 'ROTAS_FINAL_NAO_E_A_ULTIMA: a etapa final precisa ser a última do pool comum (produto %)', p_produto; end if;
  for r in select ro.id, ro.codigo, (select count(*) from rota_etapas where rota_id = ro.id) n from produto_rota ro where ro.produto_id = p_produto loop
    if r.n = 0 then raise exception 'ROTAS_ROTA_SEM_ETAPAS: a rota % não tem etapas exclusivas', r.codigo; end if;
  end loop;
  -- toda etapa do produto está em EXATAMENTE um lugar (exclusiva de uma rota ou pool comum): sem órfãs, sem duplicadas
  select count(*) into v_orfas from roteiro_etapas e where e.produto_id = p_produto
    and (select count(*) from rota_etapas re join produto_rota ro on ro.id = re.rota_id where re.etapa_id = e.id and ro.produto_id = p_produto)
      + (select count(*) from produto_pool_comum pc where pc.etapa_id = e.id and pc.produto_id = p_produto) <> 1;
  if v_orfas > 0 then raise exception 'ROTAS_ETAPA_FORA_DO_MODELO: % etapa(s) do produto % não estão em exatamente um lugar (rota exclusiva ou pool comum)', v_orfas, p_produto; end if;
  -- etapa comum existe UMA vez: nenhuma operação do pool comum se repete, nem aparece como etapa exclusiva de rota ("Etiquetar CONV/AUTO" é proibido)
  select count(*) into v_ops_dup from (
    select e.operacao_id from produto_pool_comum pc join roteiro_etapas e on e.id = pc.etapa_id where pc.produto_id = p_produto group by e.operacao_id having count(*) > 1
    union all
    select ec.operacao_id from produto_pool_comum pc join roteiro_etapas ec on ec.id = pc.etapa_id
      where pc.produto_id = p_produto and exists (select 1 from rota_etapas re join produto_rota ro on ro.id = re.rota_id join roteiro_etapas ee on ee.id = re.etapa_id where ro.produto_id = p_produto and ee.operacao_id = ec.operacao_id)
  ) x;
  if v_ops_dup > 0 then raise exception 'ROTAS_ETAPA_COMUM_DUPLICADA: uma operação do pool comum aparece mais de uma vez (ou também como etapa exclusiva) no produto %', p_produto; end if;
end;
$$;

create or replace function public.produto_rotas_trg_validar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_prod uuid;
begin
  if tg_table_name = 'rota_etapas' then
    select ro.produto_id into v_prod from produto_rota ro where ro.id = coalesce(new.rota_id, old.rota_id);
  elsif tg_table_name = 'roteiro_etapas' then
    v_prod := coalesce(new.produto_id, old.produto_id);   -- no-op para produto linear (sem rotas); protege F contra etapa órfã/duplicada criada fora das tabelas de rotas
  else
    v_prod := coalesce(new.produto_id, old.produto_id);
  end if;
  if v_prod is not null then perform public.produto_rotas_validar(v_prod); end if;
  return null;
end;
$$;
create constraint trigger trg_produto_rota_validar after insert or update or delete on public.produto_rota deferrable initially deferred for each row execute function public.produto_rotas_trg_validar();
create constraint trigger trg_rota_etapas_validar after insert or update or delete on public.rota_etapas deferrable initially deferred for each row execute function public.produto_rotas_trg_validar();
create constraint trigger trg_pool_comum_validar after insert or update or delete on public.produto_pool_comum deferrable initially deferred for each row execute function public.produto_rotas_trg_validar();
create constraint trigger trg_roteiro_etapas_validar_rotas after insert or update or delete on public.roteiro_etapas deferrable initially deferred for each row execute function public.produto_rotas_trg_validar();

-- cada etapa pertence ao produto da rota / do pool (imediato)
create or replace function public.rota_etapas_trg_mesmo_produto()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_prod_rota uuid; v_prod_etapa uuid;
begin
  if tg_table_name = 'rota_etapas' then
    select produto_id into v_prod_rota from produto_rota where id = new.rota_id;
  else
    v_prod_rota := new.produto_id;
  end if;
  select produto_id into v_prod_etapa from roteiro_etapas where id = new.etapa_id;
  if v_prod_rota is distinct from v_prod_etapa then raise exception 'ROTAS_ETAPA_DE_OUTRO_PRODUTO: a etapa % não pertence ao produto da rota/pool', new.etapa_id; end if;
  return new;
end;
$$;
create trigger trg_rota_etapas_mesmo_produto before insert or update on public.rota_etapas for each row execute function public.rota_etapas_trg_mesmo_produto();
create trigger trg_pool_comum_mesmo_produto before insert or update on public.produto_pool_comum for each row execute function public.rota_etapas_trg_mesmo_produto();

-- vínculo legado: o produto final precisa ter rotas e a rota precisa ser dele
create or replace function public.produto_variante_legada_trg()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from produto_rota where id = new.rota_id and produto_id = new.produto_final_id) then raise exception 'ROTAS_VARIANTE_ROTA_INVALIDA: a rota precisa pertencer ao produto final'; end if;
  if exists (select 1 from produto_rota where produto_id = new.produto_legado_id) then raise exception 'ROTAS_VARIANTE_LEGADA_COM_ROTAS: o produto legado não pode ser, ele próprio, um produto de rotas'; end if;
  return new;
end;
$$;
create trigger trg_produto_variante_legada before insert or update on public.produto_variante_legada for each row execute function public.produto_variante_legada_trg();

-- =========================================================================
-- 4) PROTEÇÃO CONTRA MISTURA (semana de rotas × produtos legados) — vale só quando o produto/semana está no modelo novo
-- =========================================================================
create or replace function public.previsao_itens_trg_modelo_rotas()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_mod boolean;
begin
  select modelo_rotas into v_mod from previsoes where id = new.previsao_id;
  if coalesce(v_mod, false) then
    if exists (select 1 from produto_variante_legada where produto_legado_id = new.produto_id) then
      raise exception 'PREVISAO_MODELO_ROTAS_PRODUTO_LEGADO: esta semana usa o modelo de rotas; o produto legado % não pode entrar (use o produto final)', new.produto_nome;
    end if;
  else
    if exists (select 1 from produto_rota where produto_id = new.produto_id) then
      raise exception 'PREVISAO_PRODUTO_DE_ROTAS_EM_SEMANA_LEGADA: o produto % só pode ser usado em semana com modelo de rotas ativado', new.produto_nome;
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_previsao_itens_modelo_rotas before insert or update of produto_id, previsao_id on public.previsao_itens for each row execute function public.previsao_itens_trg_modelo_rotas();

create or replace function public.previsoes_trg_modelo_rotas()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.modelo_rotas and not public.rotas_suporte_ativo() then
    raise exception 'PREVISAO_MODELO_ROTAS_BLOQUEADO: o suporte ao modelo de rotas ainda não está ativado (rotas_config.suporte_ativo = false)';
  end if;
  if new.modelo_rotas and exists (select 1 from previsao_itens i join produto_variante_legada v on v.produto_legado_id = i.produto_id where i.previsao_id = new.id) then
    raise exception 'PREVISAO_MODELO_ROTAS_ITENS_LEGADOS: a semana já tem itens de produtos legados; não é possível ativar o modelo de rotas sem convertê-los';
  end if;
  if not new.modelo_rotas and exists (select 1 from previsao_itens i join produto_rota r on r.produto_id = i.produto_id where i.previsao_id = new.id) then
    raise exception 'PREVISAO_MODELO_ROTAS_ITENS_DE_ROTAS: a semana tem itens de produto de rotas; não é possível voltar ao modelo legado';
  end if;
  return new;
end;
$$;
create trigger trg_previsoes_modelo_rotas before update of modelo_rotas on public.previsoes for each row when (old.modelo_rotas is distinct from new.modelo_rotas) execute function public.previsoes_trg_modelo_rotas();
create trigger trg_previsoes_modelo_rotas_ins before insert on public.previsoes for each row when (new.modelo_rotas) execute function public.previsoes_trg_modelo_rotas();

-- =========================================================================
-- 4b) TRAVA DE SUPORTE: enquanto os consumidores do modelo de rotas (planejador, Escala, WIP, Produção Real) não existirem, o produto de rotas NÃO entra em nenhum fluxo operacional.
--     O código legado interpreta etapas por `ordem` (cadeia linear): um produto de rotas lá seria lido como Rosquear→Parafusar→Rosquear+Parafusar→Etiquetar→Embalar (falso) e
--     duplicaria a demanda em cada etapa. A trava é UMA chave (`rotas_config.suporte_ativo`, padrão false) virada só quando os consumidores estiverem prontos e aprovados.
-- =========================================================================
create table public.rotas_config (
  id boolean primary key default true check (id),
  suporte_ativo boolean not null default false,
  atualizado_em timestamptz not null default now()
);
insert into public.rotas_config (id) values (true);
alter table public.rotas_config enable row level security;
create policy rotas_config_select on public.rotas_config for select to authenticated using (public.is_usuario_ativo());
revoke all on public.rotas_config from anon, authenticated;
grant select on public.rotas_config to authenticated, service_role;
create or replace function public.rotas_suporte_ativo()
returns boolean language sql stable set search_path = public, pg_temp as $$ select coalesce((select suporte_ativo from public.rotas_config where id), false) $$;
revoke all on function public.rotas_suporte_ativo() from public, anon;
grant execute on function public.rotas_suporte_ativo() to authenticated, service_role;

create or replace function public.produto_de_rotas_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.rotas_suporte_ativo() and exists (select 1 from public.produto_rota where produto_id = new.produto_id) then
    raise exception 'PRODUTO_DE_ROTAS_FORA_DE_USO: o produto de rotas ainda não pode entrar em % (os consumidores do modelo de rotas não estão ativados)', tg_table_name;
  end if;
  return new;
end;
$$;
create trigger trg_produto_de_rotas_guard before insert on public.apontamentos_producao for each row execute function public.produto_de_rotas_guard();
create trigger trg_produto_de_rotas_guard before insert on public.wip_controle for each row execute function public.produto_de_rotas_guard();

-- =========================================================================
-- 5) Leitura: estrutura do produto (rotas / pool comum / etapa final) — ÚNICO ponto de verdade para o código novo
--    Produto linear: rota implícita (etapas por ordem) e etapa final = max(ordem) (regra LEGADA, explicitada). Produto de rotas: regra EXPLÍCITA (final marcada).
-- =========================================================================
create or replace function public.produto_estrutura_rotas(p_produto uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare v_tem_rotas boolean := exists (select 1 from produto_rota where produto_id = p_produto);
begin
  if not v_tem_rotas then
    return jsonb_build_object(
      'produtoId', p_produto, 'modelo', 'linear', 'regraEtapaFinal', 'max_ordem_legado', 'convergencia', null,
      'rotas', jsonb_build_array(jsonb_build_object('id', null, 'codigo', 'IMPLICITA', 'nome', 'Rota única (legado)', 'ativa', true, 'preferencia', 100,
        'etapas', coalesce((select jsonb_agg(e.id order by e.ordem) from roteiro_etapas e where e.produto_id = p_produto), '[]'::jsonb))),
      'poolComum', null,
      'etapaFinalId', (select e.id from roteiro_etapas e where e.produto_id = p_produto order by e.ordem desc limit 1));
  end if;
  return jsonb_build_object(
    'produtoId', p_produto, 'modelo', 'rotas', 'regraEtapaFinal', 'explicita',
    'rotas', coalesce((select jsonb_agg(jsonb_build_object('id', ro.id, 'codigo', ro.codigo, 'nome', ro.nome, 'ativa', ro.ativa, 'preferencia', ro.preferencia,
        'etapas', coalesce((select jsonb_agg(re.etapa_id order by re.posicao) from rota_etapas re where re.rota_id = ro.id), '[]'::jsonb)) order by ro.preferencia, ro.codigo)
      from produto_rota ro where ro.produto_id = p_produto), '[]'::jsonb),
    'poolComum', jsonb_build_object(
      'etapas', coalesce((select jsonb_agg(pc.etapa_id order by pc.posicao) from produto_pool_comum pc where pc.produto_id = p_produto), '[]'::jsonb),
      'entradaId', (select pc.etapa_id from produto_pool_comum pc where pc.produto_id = p_produto order by pc.posicao limit 1)),
    -- convergência EXPLÍCITA: de onde cada rota (trecho exclusivo) entrega e para qual etapa comum todas convergem
    'convergencia', jsonb_build_object(
      'destinoId', (select pc.etapa_id from produto_pool_comum pc where pc.produto_id = p_produto order by pc.posicao limit 1),
      'origens', coalesce((select jsonb_agg(jsonb_build_object('rotaCodigo', ro.codigo, 'etapaId', (select re.etapa_id from rota_etapas re where re.rota_id = ro.id order by re.posicao desc limit 1)) order by ro.preferencia, ro.codigo)
        from produto_rota ro where ro.produto_id = p_produto and ro.ativa), '[]'::jsonb)),
    'etapaFinalId', (select pc.etapa_id from produto_pool_comum pc where pc.produto_id = p_produto and pc.final));
end;
$$;

create or replace function public.produto_etapa_final(p_produto uuid)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select (public.produto_estrutura_rotas(p_produto) ->> 'etapaFinalId')::uuid;
$$;

revoke all on function public.produto_rotas_validar(uuid), public.produto_estrutura_rotas(uuid), public.produto_etapa_final(uuid) from public, anon;
grant execute on function public.produto_estrutura_rotas(uuid), public.produto_etapa_final(uuid) to authenticated, service_role;

-- ROLLBACK (somente DEV): drop dos gatilhos/funções acima e das tabelas novas; `alter table previsoes drop column modelo_rotas`.

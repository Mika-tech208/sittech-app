-- Sittech — schema PostgreSQL, migration 9
-- Produção Real V1 — só a camada de banco (schema + RLS + grants + seed de
-- motivos), aprovada em 3 rodadas de revisão de modelo antes desta
-- migration. Não cria nenhuma RPC, hook ou tela. Não implementa o serviço
-- de fechamento de ocorrência nem o cálculo de OEE/Performance — ambos
-- ficam pra uma etapa futura, propositalmente fora deste escopo.
--
-- Tabelas novas: motivos_parada, apontamentos_producao, ocorrencias_maquina,
-- apontamento_paradas. Nenhuma tabela existente (produtos, roteiro_etapas,
-- maquinas, funcionarios, operacoes, periodos, usuarios) é alterada.
--
-- Decisões de modelo já fechadas nas rodadas de revisão anteriores,
-- reproduzidas aqui sem mudança:
--   * Timestamps destas 4 tabelas em português (criado_em/atualizado_em) —
--     diferente do created_at/updated_at do resto do schema, por pedido
--     explícito. Como set_updated_at() (migration 1) grava a coluna
--     `updated_at` fixa, não dá pra reaproveitá-la aqui — função nova
--     `set_atualizado_em()`, mesmo formato/estilo, só troca o nome da coluna.
--   * V1 admite só UM apontamento por (maquina_id, data, periodo_id) — sem
--     suporte a dois produtos na mesma máquina no mesmo período. Corrigir
--     ou complementar produção do mesmo período é UPDATE na linha
--     existente, não um novo INSERT.
--   * Ocorrência de máquina é independente do apontamento (sem vínculo
--     obrigatório) e pode atravessar períodos — os minutos vinculados a
--     cada apontamento são só a INTERSEÇÃO entre o intervalo real da
--     ocorrência e a janela daquele período, nunca a duração total dela.
--     Uma ocorrência pode alimentar vários apontamentos (um por período que
--     atravessa); o que não pode é repetir o vínculo com o MESMO
--     apontamento — daí unique(ocorrencia_id, apontamento_id), não
--     unique(ocorrencia_id) sozinho.
--   * Vínculo de ocorrência a uma parada só é aceito com a ocorrência já
--     ENCERRADA (encerrada_em not null) — mantém os minutos calculados
--     como snapshot determinístico, nunca recalculado depois.
--   * Custo/meta "oficiais" (do módulo Custo por Hora e de
--     roteiro_etapas.meta_*) são só LIDOS e congelados como snapshot nos
--     apontamentos — esta migration não recalcula nem altera a fórmula
--     desses módulos.
--   * Assunção explícita: período (periodos.inicio/fim, e por extensão
--     apontamentos_producao.periodo_inicio_vigente/periodo_fim_vigente) é
--     sempre horário local (America/Sao_Paulo) dentro do mesmo dia — não
--     cruza meia-noite. É essa assunção que permite combinar `data` (date)
--     com os horários (time) do período pra virar timestamptz na hora de
--     calcular interseção com uma ocorrência.
--
-- RLS/GRANTs seguem EXATAMENTE o padrão das 18 tabelas operacionais
-- (migrations 3/4/8) — mesma policy `usuario_ativo_full_access` (for all
-- to authenticated using/with check is_usuario_ativo()), mesmo GRANT
-- select/insert/update/delete só pra `authenticated`, nada pra `anon`.
-- Nenhuma policy nova foi inventada. EXECUTE das 5 functions de trigger
-- novas não precisa de nenhum GRANT/REVOKE explícito aqui: são
-- exatamente como set_updated_at() (function de trigger, não chamada
-- direto por PostgREST) e a migration 8 já alterou os DEFAULT PRIVILEGES
-- do role `postgres` pra que toda function nova nasça sem EXECUTE pra
-- anon/authenticated/service_role — é assim que este arquivo evita
-- repetir o REVOKE manual que a migration 8 precisou fazer só pras
-- functions que já existiam antes dela.

-- =========================================================================
-- Função de trigger: atualizado_em (equivalente a set_updated_at(), só
-- muda o nome da coluna gravada)
-- =========================================================================
create or replace function public.set_atualizado_em()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

-- =========================================================================
-- 1) motivos_parada — cadastro simples, mesmo padrão de operacoes/maquinas
--    (ativo = soft-delete, sem exclusão física prevista).
-- =========================================================================
create table public.motivos_parada (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null check (categoria in ('quebra', 'manutencao', 'outros', 'operacional')),
  exige_descricao boolean not null default false,
  vinculavel_ocorrencia boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (nome)
);

create trigger trg_motivos_parada_atualizado_em before update on public.motivos_parada
  for each row execute function public.set_atualizado_em();

-- Seed inicial. Manutenção, Quebra e Outros exigem descrição (pedido
-- explícito). Só Manutenção/Quebra são vinculáveis a ocorrencias_maquina
-- (tipo da ocorrência é check in ('quebra','manutencao') — Outros nunca
-- vem de uma ocorrência de máquina).
insert into public.motivos_parada (nome, categoria, exige_descricao, vinculavel_ocorrencia) values
  ('Setup/Troca',          'operacional', false, false),
  ('Falta de material',    'operacional', false, false),
  ('Regulagem',            'operacional', false, false),
  ('Ferramenta',           'operacional', false, false),
  ('Qualidade',            'operacional', false, false),
  ('Falta de operador',    'operacional', false, false),
  ('Aguardando processo',  'operacional', false, false),
  ('Limpeza',              'operacional', false, false),
  ('Manutenção',           'manutencao',  true,  true),
  ('Quebra',               'quebra',      true,  true),
  ('Outros',               'outros',      true,  false);

-- =========================================================================
-- 2) apontamentos_producao — lançamento real, um por (máquina, dia,
--    período) na V1. Congela (snapshot) meta e custo vigentes no momento
--    do lançamento, sem depender de nenhum recálculo futuro do módulo
--    Custo por Hora nem de roteiro_etapas mudar de valor depois.
-- =========================================================================
create table public.apontamentos_producao (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete restrict,
  etapa_id uuid not null references public.roteiro_etapas(id) on delete restrict,
  operacao_id uuid not null references public.operacoes(id) on delete restrict,
  maquina_id uuid not null references public.maquinas(id) on delete restrict,
  funcionario_id uuid not null references public.funcionarios(id) on delete restrict,
  periodo_id text not null references public.periodos(id) on delete restrict,
  data date not null,
  hora_lancamento time not null,
  quantidade_produzida numeric not null,
  quantidade_refugo numeric not null default 0,

  -- snapshot do período vigente (Correção 2 da revisão de modelo)
  periodo_inicio_vigente time not null,
  periodo_fim_vigente time not null,
  duracao_periodo_horas_vigente numeric generated always as (
    extract(epoch from (periodo_fim_vigente - periodo_inicio_vigente)) / 3600
  ) stored,

  -- snapshot de meta (roteiro_etapas.meta_<periodo_id> no momento)
  meta_periodo_vigente numeric not null,

  -- snapshot financeiro contextual — deriva do módulo Custo por Hora,
  -- não o substitui nem recalcula (Correção 5 da revisão de modelo)
  custo_hora_operacao_vigente numeric not null,
  custo_operacional_periodo_vigente numeric generated always as (
    custo_hora_operacao_vigente * (extract(epoch from (periodo_fim_vigente - periodo_inicio_vigente)) / 3600)
  ) stored,
  custo_unitario_referencia_periodo_vigente numeric generated always as (
    case when meta_periodo_vigente > 0
      then (custo_hora_operacao_vigente * (extract(epoch from (periodo_fim_vigente - periodo_inicio_vigente)) / 3600)) / meta_periodo_vigente
      else null
    end
  ) stored,

  idempotency_key uuid not null default gen_random_uuid(),
  observacao text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por uuid not null references public.usuarios(id) on delete restrict,

  check (quantidade_produzida >= 0),
  check (quantidade_refugo >= 0),
  check (quantidade_refugo <= quantidade_produzida),
  check (meta_periodo_vigente >= 0),
  check (periodo_fim_vigente > periodo_inicio_vigente),
  unique (idempotency_key),
  -- Correção 1 da última revisão: um apontamento só por máquina/dia/período
  -- na V1 — decisão explícita, sem suporte a dois produtos concorrentes na
  -- mesma máquina no mesmo período. Também é o que garante, sozinho, que
  -- uma ocorrência nunca seja linkada duas vezes ao mesmo período por dois
  -- apontamentos-irmãos (não pode existir um segundo apontamento pra
  -- linkar).
  unique (maquina_id, data, periodo_id)
);

-- (maquina_id, data) já fica coberto como prefixo do unique acima —
-- não duplicamos um índice só nisso.
create index idx_apontamentos_producao_data on public.apontamentos_producao(data);
create index idx_apontamentos_producao_produto on public.apontamentos_producao(produto_id, data);
create index idx_apontamentos_producao_etapa on public.apontamentos_producao(etapa_id, periodo_id, data);
create index idx_apontamentos_producao_criado_por on public.apontamentos_producao(criado_por);

create trigger trg_apontamentos_producao_atualizado_em before update on public.apontamentos_producao
  for each row execute function public.set_atualizado_em();

-- =========================================================================
-- 3) ocorrencias_maquina — ciclo de vida independente do apontamento,
--    aberta na quebra/manutenção e encerrada quando a máquina volta.
--    Guarda só CONTEXTO (produto/etapa/operação/funcionário reais no
--    momento da abertura, motivo, período de abertura, descrição do que
--    aconteceu e do que foi feito) — nenhum snapshot financeiro aqui
--    (Correção 3 da última revisão): o impacto de cada trecho é calculado
--    via os snapshots do apontamento do período correspondente, não daqui.
-- =========================================================================
create table public.ocorrencias_maquina (
  id uuid primary key default gen_random_uuid(),
  maquina_id uuid not null references public.maquinas(id) on delete restrict,
  tipo text not null check (tipo in ('quebra', 'manutencao')),
  motivo_id uuid not null references public.motivos_parada(id) on delete restrict,

  -- contexto real informado na abertura
  produto_id uuid not null references public.produtos(id) on delete restrict,
  etapa_id uuid not null references public.roteiro_etapas(id) on delete restrict,
  operacao_id uuid not null references public.operacoes(id) on delete restrict,
  funcionario_id uuid not null references public.funcionarios(id) on delete restrict,
  periodo_id_abertura text not null references public.periodos(id) on delete restrict,

  descricao text not null,
  descricao_solucao text,

  aberta_em timestamptz not null default now(),
  encerrada_em timestamptz,

  criado_por uuid not null references public.usuarios(id) on delete restrict,
  encerrado_por uuid references public.usuarios(id) on delete restrict,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  check (length(trim(descricao)) > 0),
  check (encerrada_em is null or encerrada_em >= aberta_em),
  -- Correção 2 da última revisão: ao encerrar, encerrado_por e
  -- descricao_solucao (não vazia) passam a ser obrigatórios junto com
  -- encerrada_em. Enquanto aberta (encerrada_em null), os três continuam
  -- livres.
  check (
    encerrada_em is null
    or (encerrado_por is not null and descricao_solucao is not null and length(trim(descricao_solucao)) > 0)
  )
);

-- sem duas ocorrências abertas ao mesmo tempo pra mesma máquina
create unique index idx_ocorrencias_maquina_aberta_unica
  on public.ocorrencias_maquina(maquina_id) where encerrada_em is null;
create index idx_ocorrencias_maquina_maquina_data on public.ocorrencias_maquina(maquina_id, aberta_em);
create index idx_ocorrencias_maquina_encerrada_em on public.ocorrencias_maquina(encerrada_em);

create trigger trg_ocorrencias_maquina_atualizado_em before update on public.ocorrencias_maquina
  for each row execute function public.set_atualizado_em();

-- valida que a categoria do motivo escolhido bate com o tipo da ocorrência
-- (Quebra -> categoria 'quebra', Manutenção -> categoria 'manutencao')
create or replace function public.validar_motivo_tipo_ocorrencia()
returns trigger as $$
declare
  v_categoria text;
begin
  select categoria into v_categoria
  from public.motivos_parada
  where id = new.motivo_id;

  if v_categoria is distinct from new.tipo then
    raise exception 'Motivo % (categoria %) não corresponde ao tipo da ocorrência (%)',
      new.motivo_id, v_categoria, new.tipo;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_ocorrencias_maquina_motivo_tipo before insert or update on public.ocorrencias_maquina
  for each row execute function public.validar_motivo_tipo_ocorrencia();

-- =========================================================================
-- 4) apontamento_paradas — minutos de parada dentro de um apontamento,
--    com motivo; pode vir de uma ocorrencias_maquina (ocorrencia_id) ou
--    ser digitado manualmente.
-- =========================================================================
create table public.apontamento_paradas (
  id uuid primary key default gen_random_uuid(),
  apontamento_id uuid not null references public.apontamentos_producao(id) on delete cascade,
  motivo_id uuid not null references public.motivos_parada(id) on delete restrict,
  ocorrencia_id uuid references public.ocorrencias_maquina(id) on delete restrict,
  minutos numeric not null,
  descricao text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por uuid not null references public.usuarios(id) on delete restrict,

  check (minutos > 0)
);

-- Correção 1 da última revisão: a mesma ocorrência pode alimentar vários
-- apontamentos (um por período que atravessa) — o que não pode é repetir
-- o vínculo com o MESMO apontamento. unique(ocorrencia_id, apontamento_id),
-- não unique(ocorrencia_id) sozinho.
create unique index idx_apontamento_paradas_ocorrencia_apontamento
  on public.apontamento_paradas(ocorrencia_id, apontamento_id) where ocorrencia_id is not null;
create index idx_apontamento_paradas_apontamento on public.apontamento_paradas(apontamento_id);
create index idx_apontamento_paradas_motivo on public.apontamento_paradas(motivo_id);

create trigger trg_apontamento_paradas_atualizado_em before update on public.apontamento_paradas
  for each row execute function public.set_atualizado_em();

-- descrição obrigatória conforme o motivo (motivos_parada.exige_descricao)
create or replace function public.validar_descricao_parada()
returns trigger as $$
declare
  v_exige boolean;
begin
  select exige_descricao into v_exige
  from public.motivos_parada
  where id = new.motivo_id;

  if v_exige and (new.descricao is null or length(trim(new.descricao)) = 0) then
    raise exception 'Descrição é obrigatória para o motivo de parada %', new.motivo_id;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_apontamento_paradas_descricao before insert or update on public.apontamento_paradas
  for each row execute function public.validar_descricao_parada();

-- interseção entre o intervalo real da ocorrência e a janela do período
-- do apontamento (Correção 1 da última revisão) — só roda quando
-- ocorrencia_id é preenchido; minutos é CALCULADO aqui, nunca aceito como
-- digitado nesse caso. Exige a ocorrência já encerrada.
create or replace function public.calcular_intersecao_parada_ocorrencia()
returns trigger as $$
declare
  v_ocorrencia_aberta_em timestamptz;
  v_ocorrencia_encerrada_em timestamptz;
  v_apontamento_data date;
  v_periodo_inicio time;
  v_periodo_fim time;
  v_janela_inicio timestamptz;
  v_janela_fim timestamptz;
  v_minutos numeric;
begin
  if new.ocorrencia_id is null then
    return new;
  end if;

  select aberta_em, encerrada_em
    into v_ocorrencia_aberta_em, v_ocorrencia_encerrada_em
  from public.ocorrencias_maquina
  where id = new.ocorrencia_id;

  if v_ocorrencia_encerrada_em is null then
    raise exception 'Ocorrência % ainda está aberta — só pode ser vinculada a uma parada depois de encerrada', new.ocorrencia_id;
  end if;

  select data, periodo_inicio_vigente, periodo_fim_vigente
    into v_apontamento_data, v_periodo_inicio, v_periodo_fim
  from public.apontamentos_producao
  where id = new.apontamento_id;

  -- Assunção: período é horário local (America/Sao_Paulo), não cruza
  -- meia-noite — ver comentário no topo do arquivo.
  v_janela_inicio := (v_apontamento_data + v_periodo_inicio) at time zone 'America/Sao_Paulo';
  v_janela_fim := (v_apontamento_data + v_periodo_fim) at time zone 'America/Sao_Paulo';

  v_minutos := round(extract(epoch from (
    least(v_ocorrencia_encerrada_em, v_janela_fim) - greatest(v_ocorrencia_aberta_em, v_janela_inicio)
  )) / 60);

  if v_minutos <= 0 then
    raise exception 'Ocorrência % não intersecta o período do apontamento %', new.ocorrencia_id, new.apontamento_id;
  end if;

  new.minutos := v_minutos;
  return new;
end;
$$ language plpgsql;

create trigger trg_apontamento_paradas_intersecao before insert or update on public.apontamento_paradas
  for each row execute function public.calcular_intersecao_parada_ocorrencia();

-- soma das paradas do mesmo apontamento não pode passar da duração do
-- período — agregação entre linhas, por isso trigger AFTER em vez de check
create or replace function public.validar_soma_paradas_periodo()
returns trigger as $$
declare
  v_soma_minutos numeric;
  v_duracao_horas numeric;
begin
  select coalesce(sum(minutos), 0) into v_soma_minutos
  from public.apontamento_paradas
  where apontamento_id = new.apontamento_id;

  select duracao_periodo_horas_vigente into v_duracao_horas
  from public.apontamentos_producao
  where id = new.apontamento_id;

  if v_soma_minutos > v_duracao_horas * 60 then
    raise exception 'Soma das paradas (% min) ultrapassa a duração do período (% min) do apontamento %',
      v_soma_minutos, v_duracao_horas * 60, new.apontamento_id;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_apontamento_paradas_soma after insert or update on public.apontamento_paradas
  for each row execute function public.validar_soma_paradas_periodo();

-- =========================================================================
-- RLS + GRANTs — exatamente o padrão das 18 tabelas operacionais
-- (migrations 3/4/8): RLS explícito habilitado, uma policy `for all` só
-- pra authenticated usando is_usuario_ativo(), CRUD completo via GRANT,
-- nada pra anon. Nenhuma policy nova inventada.
-- =========================================================================
alter table public.motivos_parada enable row level security;
alter table public.apontamentos_producao enable row level security;
alter table public.ocorrencias_maquina enable row level security;
alter table public.apontamento_paradas enable row level security;

create policy usuario_ativo_full_access on public.motivos_parada
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.apontamentos_producao
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.ocorrencias_maquina
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

create policy usuario_ativo_full_access on public.apontamento_paradas
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

grant select, insert, update, delete on public.motivos_parada to authenticated;
grant select, insert, update, delete on public.apontamentos_producao to authenticated;
grant select, insert, update, delete on public.ocorrencias_maquina to authenticated;
grant select, insert, update, delete on public.apontamento_paradas to authenticated;

-- truncate/references/trigger residual pra anon/authenticated/service_role
-- (mesma baseline das outras 18 tabelas) já é aplicado automaticamente
-- pelos DEFAULT PRIVILEGES configurados na migration 8 — nada a fazer aqui.

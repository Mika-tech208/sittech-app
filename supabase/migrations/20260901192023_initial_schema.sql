-- Sittech — schema PostgreSQL v1
-- Gerado a partir do mapa de entidades derivado de src/types/domain.ts e da
-- camada de storage atual (blob único em localStorage). Este arquivo é só
-- SQL local — não foi executado, nenhum projeto Supabase foi criado ou
-- conectado. Nenhuma regra de negócio ou tela foi alterada.
--
-- Convenções gerais desta migration:
--   * UUID (gen_random_uuid()) como PK em toda entidade nova/própria.
--   * `numeric` para todo valor monetário/quantidade (nunca float).
--   * created_at/updated_at (via trigger) nas tabelas "editáveis" de topo;
--     tabelas de junção pura e a auditoria (append-only) não recebem os dois.
--   * ON DELETE é RESTRICT por padrão nas FKs pra catálogos compartilhados
--     (categoria, operação, máquina, produto) — CASCADE só nas tabelas que
--     são filhas de composição de um único pai (ex.: etapas de um produto,
--     custos de um funcionário, itens de uma previsão). Ver comentários
--     pontuais abaixo onde a escolha não é óbvia.
--   * Nenhum campo foi inventado além do que existe em types/domain.ts — as
--     poucas colunas novas (ex.: roteiro_etapas.ordem) estão comentadas
--     explicando por que precisam existir em SQL mesmo sem equivalente hoje.

create extension if not exists pgcrypto;

-- Função genérica de updated_at, reaproveitada em todas as tabelas que têm a coluna.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- =========================================================================
-- Catálogos compartilhados
-- Hoje são arrays de string soltos no blob (`categorias: string[]`,
-- `operacoes: string[]`), crescidos via "+ Criar nova categoria/operação"
-- em várias telas. Viram tabela própria com UUID (decisões 1–3).
-- =========================================================================

create table categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_categorias_updated_at before update on categorias
  for each row execute function set_updated_at();

create table operacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_operacoes_updated_at before update on operacoes
  for each row execute function set_updated_at();


-- =========================================================================
-- Usuários
-- Decisão 11/12: autenticação real fica pro Supabase Auth — esta tabela NÃO
-- guarda senha_hash/senha_salt (o hash SHA-256 client-side atual era
-- explicitamente temporário no código-fonte). auth_user_id é nullable
-- porque um usuário pode existir aqui antes de ter uma conta em auth.users
-- vinculada (ex.: migração inicial dos dados); `on delete set null` mantém
-- o perfil interno (nome, papel, histórico) caso a conta em auth.users seja
-- removida. Como essa FK aponta pro schema `auth`, esta migration só roda
-- de fato dentro de um projeto Supabase (o schema `auth` não existe num
-- Postgres genérico) — coerente com a decisão 11, mas registrado aqui pra
-- não passar despercebido.
-- `email` é único de forma case-insensitive via índice em lower(email) —
-- ver mais abaixo — em vez de UNIQUE direto na coluna.
-- =========================================================================

create table usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  nome text not null,
  email text not null,
  papel text not null check (papel in ('admin', 'usuario')),
  ativo boolean not null default true,
  ultimo_acesso timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Unicidade case-insensitive sem depender de extensão (citext) — um índice
-- único funcional em lower(email) resolve com Postgres puro.
create unique index idx_usuarios_email_lower on usuarios(lower(email));
create trigger trg_usuarios_updated_at before update on usuarios
  for each row execute function set_updated_at();


-- =========================================================================
-- Períodos de trabalho
-- Decisão 4: os seis períodos atuais (M1..T3); duração continua derivada
-- (inicio/fim → horas), nunca armazenada. `id` fica como chave natural
-- text ("m1".."t3"), igual ao código hoje — não existe FK apontando pra
-- periodos (roteiro_etapas guarda meta_m1..meta_t3 como colunas diretas,
-- decisão 5), então não há motivo pra trocar por UUID sintético aqui.
-- =========================================================================

create table periodos (
  id text primary key,
  nome text not null,
  inicio time not null,
  fim time not null,
  created_at timestamptz not null default now()
);


-- =========================================================================
-- Custos fixos e pontuais
-- =========================================================================

create table fixed_costs (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  categoria_id uuid not null references categorias(id) on delete restrict,
  valor numeric not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_fixed_costs_categoria on fixed_costs(categoria_id);
create trigger trg_fixed_costs_updated_at before update on fixed_costs
  for each row execute function set_updated_at();

-- Decisão 21: `mes` vira `date`, representando o primeiro dia do mês
-- (equivalente ao "AAAA-MM" atual).
create table variable_entries (
  id uuid primary key default gen_random_uuid(),
  mes date not null,
  descricao text not null,
  categoria_id uuid not null references categorias(id) on delete restrict,
  valor numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_variable_entries_mes on variable_entries(mes);
create index idx_variable_entries_categoria on variable_entries(categoria_id);
create trigger trg_variable_entries_updated_at before update on variable_entries
  for each row execute function set_updated_at();


-- =========================================================================
-- Funcionários
-- =========================================================================

create table funcionarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  operacao_id uuid not null references operacoes(id) on delete restrict,
  salario_base numeric not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_funcionarios_operacao on funcionarios(operacao_id);
create trigger trg_funcionarios_updated_at before update on funcionarios
  for each row execute function set_updated_at();

-- Filha de composição de um funcionário (FuncionarioCusto hoje vive só como
-- array embutido) — CASCADE é o comportamento certo aqui: um custo extra
-- não tem sentido nem existência fora do funcionário que o tem.
create table funcionario_custos (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references funcionarios(id) on delete cascade,
  descricao text not null,
  valor numeric not null,
  created_at timestamptz not null default now()
);
create index idx_funcionario_custos_funcionario on funcionario_custos(funcionario_id);


-- =========================================================================
-- Máquinas
-- Decisão 14: sem custo próprio de máquina — Custo por Hora hoje só
-- considera funcionários + custos fixos, e isso é preservado (nenhuma
-- coluna de custo aqui).
-- =========================================================================

create table maquinas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  operacao_id uuid not null references operacoes(id) on delete restrict,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_maquinas_operacao on maquinas(operacao_id);
create trigger trg_maquinas_updated_at before update on maquinas
  for each row execute function set_updated_at();


-- =========================================================================
-- Produtos e roteiro
-- =========================================================================

create table produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  referencia text,
  valor_unitario numeric not null default 0,
  ativo boolean not null default true,
  prioridade text not null default 'media' check (prioridade in ('alta', 'media', 'baixa')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_produtos_updated_at before update on produtos
  for each row execute function set_updated_at();

-- Filha de composição de um produto (RoteiroEtapa hoje vive só como array
-- embutido em produto.roteiro[]) — CASCADE é o comportamento certo: uma
-- etapa de roteiro não existe fora do produto que a define.
--
-- `ordem`: NÃO existe no domínio atual (a ordem hoje é só a posição no
-- array em memória — comportamento documentado como
-- "COMPORTAMENTO ATUAL — REVISAR PARA BANCO" no código de Produtos). Uma
-- coluna explícita é obrigatória em SQL pra preservar essa ordem de forma
-- confiável; UNIQUE(produto_id, ordem) evita duas etapas do mesmo produto
-- disputando a mesma posição.
--
-- Decisão 5: metas continuam como colunas fixas m1..t3, sem tabela própria.
create table roteiro_etapas (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete cascade,
  operacao_id uuid not null references operacoes(id) on delete restrict,
  ordem integer not null,
  meta_m1 numeric not null default 0,
  meta_m2 numeric not null default 0,
  meta_m3 numeric not null default 0,
  meta_t1 numeric not null default 0,
  meta_t2 numeric not null default 0,
  meta_t3 numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (produto_id, ordem)
);
create index idx_roteiro_etapas_produto on roteiro_etapas(produto_id);
create index idx_roteiro_etapas_operacao on roteiro_etapas(operacao_id);
create trigger trg_roteiro_etapas_updated_at before update on roteiro_etapas
  for each row execute function set_updated_at();

-- Elegibilidade: "quais máquinas PODEM executar esta etapa"
-- (RoteiroEtapa.maquinasIds hoje). Distinta da seleção semanal real
-- (previsao_item_maquinas, mais abaixo) — não colapsar as duas.
--
-- maquina_id é RESTRICT: hoje o app permite excluir uma máquina mesmo
-- referenciada em roteiro (deixando o id órfão em memória — comportamento
-- documentado como "COMPORTAMENTO ATUAL — REVISAR PARA BANCO" no domínio
-- de Máquinas). Em SQL, com FK de verdade, isso passa a BLOQUEAR a exclusão
-- em vez de deixar órfão. É uma melhoria de integridade, não presente no
-- app hoje — sinalizado no resumo final como decisão a confirmar.
--
-- Não criamos aqui nenhuma trigger de compatibilidade operação
-- máquina↔etapa (decisão 16) — a mesma divergência (uma máquina pode estar
-- elegível numa etapa cuja operação não bate mais com maquina.operacao
-- atual) continua possível, exatamente como hoje.
create table roteiro_etapa_maquinas (
  etapa_id uuid not null references roteiro_etapas(id) on delete cascade,
  maquina_id uuid not null references maquinas(id) on delete restrict,
  primary key (etapa_id, maquina_id)
);
create index idx_roteiro_etapa_maquinas_maquina on roteiro_etapa_maquinas(maquina_id);


-- =========================================================================
-- Faturamento
-- Decisão 22: num_funcionarios/custo_funcionarios_total/custo_fixo_total
-- eram tipados `string | number` no domínio atual (inconsistência já
-- documentada em types/domain.ts) — normalizados aqui para `numeric`.
-- =========================================================================

create table faturamentos (
  id uuid primary key default gen_random_uuid(),
  mes date not null unique,
  num_funcionarios numeric not null default 0,
  custo_funcionarios_total numeric not null default 0,
  custo_fixo_total numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_faturamentos_updated_at before update on faturamentos
  for each row execute function set_updated_at();

-- Filha de composição de um faturamento (Receita hoje vive só como array
-- embutido em faturamento.receitas[]) — CASCADE é o comportamento certo.
create table receitas (
  id uuid primary key default gen_random_uuid(),
  faturamento_id uuid not null references faturamentos(id) on delete cascade,
  data date not null,
  descricao text not null,
  valor numeric not null,
  created_at timestamptz not null default now()
);
create index idx_receitas_faturamento on receitas(faturamento_id);


-- =========================================================================
-- Previsão semanal
-- =========================================================================

create table previsoes (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_previsoes_updated_at before update on previsoes
  for each row execute function set_updated_at();

-- Máquinas marcadas como indisponíveis SÓ naquela semana
-- (Previsao.maquinasIndisponiveis hoje). Filha de composição da previsão
-- (CASCADE), mas referencia máquina por RESTRICT pelo mesmo motivo de
-- roteiro_etapa_maquinas acima.
create table previsao_maquinas_indisponiveis (
  previsao_id uuid not null references previsoes(id) on delete cascade,
  maquina_id uuid not null references maquinas(id) on delete restrict,
  primary key (previsao_id, maquina_id)
);
create index idx_previsao_maq_indisp_maquina on previsao_maquinas_indisponiveis(maquina_id);

-- Decisão 9: itens previstos e realizados (hoje dois arrays separados,
-- `previsoes[].itens` e `previsoes[].itensRealizados`) viram uma tabela só,
-- com `tipo` discriminando.
--
-- Decisão 10: produto_nome/valor_unitario são preservados como SNAPSHOT
-- (cópia do momento do lançamento) — exatamente como PrevisaoItem.produtoNome
-- já é hoje ("cópia no momento do lançamento, não referência viva",
-- comentário original em types/domain.ts). produto_id é RESTRICT: produto
-- com histórico de previsão não pode ser apagado fisicamente — a exclusão
-- lógica é via `produtos.ativo = false` (já existe), não DELETE.
create table previsao_itens (
  id uuid primary key default gen_random_uuid(),
  previsao_id uuid not null references previsoes(id) on delete cascade,
  tipo text not null check (tipo in ('previsto', 'realizado')),
  produto_id uuid not null references produtos(id) on delete restrict,
  produto_nome text not null,
  valor_unitario numeric not null,
  quantidade numeric not null,
  created_at timestamptz not null default now()
);
create index idx_previsao_itens_previsao on previsao_itens(previsao_id);
create index idx_previsao_itens_produto on previsao_itens(produto_id);

-- Seleção REAL de máquina por etapa, feita na programação semanal
-- (PrevisaoItem.maquinasPorEtapa hoje). Distinta da elegibilidade do
-- roteiro (roteiro_etapa_maquinas) — não colapsar as duas.
--
-- Decisão 23: itens realizados/legados sem seleção de máquina simplesmente
-- não têm nenhuma linha aqui — não precisa de coluna nullable nem valor
-- especial, é a semântica natural de uma tabela de junção vazia pra aquele
-- item_id.
create table previsao_item_maquinas (
  item_id uuid not null references previsao_itens(id) on delete cascade,
  etapa_id uuid not null references roteiro_etapas(id) on delete restrict,
  maquina_id uuid not null references maquinas(id) on delete restrict,
  primary key (item_id, etapa_id, maquina_id)
);
create index idx_previsao_item_maquinas_etapa on previsao_item_maquinas(etapa_id);
create index idx_previsao_item_maquinas_maquina on previsao_item_maquinas(maquina_id);


-- =========================================================================
-- Auditoria
-- Decisão 18: sem limite de 200 registros (isso era só um corte em memória
-- no hook de sessão — `slice(0, 200)` — não uma regra de negócio pra
-- persistir; a tabela guarda tudo).
--
-- `quem` e `usuario_afetado` continuam como texto (nome), não FK — no
-- código atual (useAuthSession.registrarAuditoria) esses campos já são
-- snapshots de nome/login no momento da ação, nunca uma referência viva a
-- Usuario. Preservado assim para não inventar uma relação que não existe
-- hoje. `quando` já cumpre o papel de created_at — não duplicado.
-- =========================================================================

create table auditoria (
  id uuid primary key default gen_random_uuid(),
  quando timestamptz not null default now(),
  quem text not null,
  acao text not null,
  usuario_afetado text
);
create index idx_auditoria_quando on auditoria(quando);


-- =========================================================================
-- Períodos padrão — NÃO inseridos nesta migration.
-- PERIODOS_PADRAO (src/lib/constants.ts) só é o valor usado quando nenhum
-- período foi salvo ainda; períodos são editáveis em runtime (Custo por
-- Hora), então a fonte de verdade real é o blob de cada instalação. Os
-- seis registros de `periodos` devem ser trazidos da migração de dados
-- (a partir do blob atual), não de um seed fixo aqui.
-- =========================================================================

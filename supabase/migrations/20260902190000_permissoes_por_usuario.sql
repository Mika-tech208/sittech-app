-- Sittech — schema PostgreSQL, migration 16
-- Sistema de permissões por usuário/módulo — antes de cadastrar a
-- supervisora de produção real, o admin precisa poder escolher exatamente
-- quais áreas do sistema cada usuário não-admin acessa. Deliberadamente
-- simples: uma tabela de permissões concedidas (não uma matriz de roles),
-- explícita (cada área é uma string fixa, checada no formulário e aqui via
-- CHECK), e admin sempre passa por tudo automaticamente — nunca precisa
-- de linhas próprias em usuario_permissoes.
--
-- Prioridade de reforço no BACKEND (não só esconder no frontend), pedida
-- explicitamente: Financeiro, Usuários, Auditoria, custos (fixed_costs,
-- funcionario_custos, funcionarios.salario_base). Produtos/Máquinas ficam
-- com uma evolução mais leve (só a ESCRITA é restrita por permissão — a
-- leitura de id/nome/ativo continua aberta a qualquer usuário ativo,
-- porque é dado não-sensível — sem preço, sem salário — e é consultado
-- transversalmente por Previsão/Capacidade/Custo por Hora/Produção Real).
-- Funcionários é diferente: `salario_base` é dado sensível de verdade, e
-- por isso tanto leitura quanto escrita ficam atrás da permissão — a
-- Produção Real, que precisa só de id/nome/ativo de funcionários pra
-- montar o dropdown, passa a consultar a view `funcionarios_elegibilidade`
-- (abaixo) em vez da tabela cheia.
--
-- Diferenciação pedida explicitamente (produção real x módulos de
-- cadastro): como registrar_apontamento_producao_core/
-- editar_apontamento_producao/abrir_ocorrencia_maquina/
-- calcular_custo_hora_operacao_vigente leem funcionarios/funcionario_custos/
-- fixed_costs internamente (pra validar funcionário ativo e congelar o
-- custo/hora do período — regra de negócio já existente, não alterada em
-- NADA aqui) como SECURITY INVOKER, apertar a RLS dessas 3 tabelas
-- quebraria essas RPCs pra qualquer usuário sem permissão de
-- financeiro/funcionários/custo_hora — inclusive a própria supervisora
-- fazendo um apontamento normal. A correção é só de PRIVILÉGIO DE EXECUÇÃO
-- (security invoker -> security definer nessas 4 functions, todas já com
-- search_path fixado — sem isso, security definer seria perigoso), nunca
-- de regra: nenhuma validação, cálculo ou fórmula muda uma linha sequer.

-- =========================================================================
-- 1) usuario_permissoes — concessões explícitas por usuário. Ausência de
--    linha = sem acesso (deny by default). Admin nunca precisa de linhas
--    aqui (is_admin() já basta em toda checagem).
-- =========================================================================
create table public.usuario_permissoes (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  permissao text not null check (permissao in (
    'financeiro', 'produtos', 'maquinas', 'funcionarios', 'custo_hora',
    'previsao', 'capacidade',
    'producao_real_apontamento', 'producao_real_historico', 'producao_real_ocorrencias',
    'usuarios', 'auditoria'
  )),
  criado_em timestamptz not null default now(),
  primary key (usuario_id, permissao)
);

alter table public.usuario_permissoes enable row level security;

-- select: o próprio usuário lê as próprias permissões (pra carregar a
-- sessão) OU admin lê de qualquer um (pra editar). Nunca o inverso.
create policy usuario_permissoes_select on public.usuario_permissoes
  for select to authenticated
  using (
    public.is_admin()
    or usuario_id = (select id from public.usuarios where auth_user_id = auth.uid())
  );

-- escrita: somente admin, mesmo pra alterar as PRÓPRIAS permissões — pedido
-- explícito ("usuário comum nunca pode alterar as próprias permissões").
create policy usuario_permissoes_admin_write on public.usuario_permissoes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.usuario_permissoes to authenticated;

-- =========================================================================
-- 2) has_permissao — único helper novo, mesmo espírito de is_admin()/
--    is_usuario_ativo() (migration 2). Admin sempre true, sem exceção.
-- =========================================================================
create or replace function public.has_permissao(p_permissao text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.is_admin() or exists (
    select 1
    from public.usuario_permissoes up
    join public.usuarios u on u.id = up.usuario_id
    where u.auth_user_id = auth.uid() and u.ativo = true and up.permissao = p_permissao
  );
$$;

revoke all on function public.has_permissao(text) from public, anon;
grant execute on function public.has_permissao(text) to authenticated;

-- =========================================================================
-- 3) funcionarios_elegibilidade — view de leitura mínima (id/nome/ativo/
--    operacao_id, nunca salario_base) usada pela Produção Real pra montar
--    o dropdown de funcionário sem exigir a permissão 'funcionarios'.
--    View comum (sem "security invoker"), dona = quem rodou a migration
--    (o mesmo dono das tabelas-base, que por padrão do Postgres já
--    contorna a RLS das próprias tabelas) — o filtro de "usuário ativo"
--    é feito explicitamente aqui dentro via auth.uid(), então a proteção
--    não depende dessa particularidade de dono/RLS pra excluir sessão
--    inválida.
-- =========================================================================
create view public.funcionarios_elegibilidade as
  select f.id, f.nome, f.ativo, f.operacao_id
  from public.funcionarios f
  where exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.ativo = true);

revoke all on public.funcionarios_elegibilidade from public, anon;
grant select on public.funcionarios_elegibilidade to authenticated;

-- =========================================================================
-- 4) produtos / maquinas — leitura (id/nome/ativo, sem dado sensível)
--    continua aberta a qualquer usuário ativo; ESCRITA passa a exigir
--    admin ou a permissão do módulo.
-- =========================================================================
drop policy usuario_ativo_full_access on public.produtos;
create policy produtos_select on public.produtos
  for select to authenticated using (public.is_usuario_ativo());
create policy produtos_admin_write on public.produtos
  for all to authenticated
  using (public.is_admin() or public.has_permissao('produtos'))
  with check (public.is_admin() or public.has_permissao('produtos'));

drop policy usuario_ativo_full_access on public.maquinas;
create policy maquinas_select on public.maquinas
  for select to authenticated using (public.is_usuario_ativo());
create policy maquinas_admin_write on public.maquinas
  for all to authenticated
  using (public.is_admin() or public.has_permissao('maquinas'))
  with check (public.is_admin() or public.has_permissao('maquinas'));

-- =========================================================================
-- 5) funcionarios / funcionario_custos — dado sensível (salario_base,
--    custos extras por pessoa); leitura E escrita passam a exigir admin
--    ou permissão ('funcionarios' cobre o cadastro; 'custo_hora' também
--    libera, porque o módulo Custo por Hora precisa ler salário pra
--    calcular — mesma sobreposição já existente na fórmula, não inventada
--    aqui).
-- =========================================================================
drop policy usuario_ativo_full_access on public.funcionarios;
create policy funcionarios_admin_ou_permissao on public.funcionarios
  for all to authenticated
  using (public.is_admin() or public.has_permissao('funcionarios') or public.has_permissao('custo_hora'))
  with check (public.is_admin() or public.has_permissao('funcionarios') or public.has_permissao('custo_hora'));

drop policy usuario_ativo_full_access on public.funcionario_custos;
create policy funcionario_custos_admin_ou_permissao on public.funcionario_custos
  for all to authenticated
  using (public.is_admin() or public.has_permissao('funcionarios') or public.has_permissao('custo_hora'))
  with check (public.is_admin() or public.has_permissao('funcionarios') or public.has_permissao('custo_hora'));

-- =========================================================================
-- 6) fixed_costs / variable_entries / receitas / faturamentos — dados
--    financeiros. fixed_costs também alimenta Custo por Hora (mesma
--    sobreposição de 5).
-- =========================================================================
drop policy usuario_ativo_full_access on public.fixed_costs;
create policy fixed_costs_admin_ou_permissao on public.fixed_costs
  for all to authenticated
  using (public.is_admin() or public.has_permissao('financeiro') or public.has_permissao('custo_hora'))
  with check (public.is_admin() or public.has_permissao('financeiro') or public.has_permissao('custo_hora'));

drop policy usuario_ativo_full_access on public.variable_entries;
create policy variable_entries_admin_ou_permissao on public.variable_entries
  for all to authenticated
  using (public.is_admin() or public.has_permissao('financeiro'))
  with check (public.is_admin() or public.has_permissao('financeiro'));

drop policy usuario_ativo_full_access on public.receitas;
create policy receitas_admin_ou_permissao on public.receitas
  for all to authenticated
  using (public.is_admin() or public.has_permissao('financeiro'))
  with check (public.is_admin() or public.has_permissao('financeiro'));

drop policy usuario_ativo_full_access on public.faturamentos;
create policy faturamentos_admin_ou_permissao on public.faturamentos
  for all to authenticated
  using (public.is_admin() or public.has_permissao('financeiro'))
  with check (public.is_admin() or public.has_permissao('financeiro'));

-- =========================================================================
-- 7) usuarios / auditoria — já eram admin-only pra leitura; passam a
--    aceitar também a permissão dedicada (hoje ninguém tem essas duas
--    concedidas — é só a evolução ficar pronta pro admin usar no futuro,
--    sem exigir mudança de RLS de novo). Escrita continua estritamente
--    admin-only, sem exceção — pedido explícito.
-- =========================================================================
drop policy usuarios_select_self_or_admin on public.usuarios;
create policy usuarios_select_self_or_admin on public.usuarios
  for select to authenticated
  using (
    (auth_user_id = auth.uid() and public.is_usuario_ativo())
    or public.is_admin()
    or public.has_permissao('usuarios')
  );

drop policy auditoria_select_admin_only on public.auditoria;
create policy auditoria_select_admin_only on public.auditoria
  for select to authenticated
  using (public.is_admin() or public.has_permissao('auditoria'));

-- =========================================================================
-- 8) SECURITY DEFINER nas 4 functions que leem funcionarios/
--    funcionario_custos/fixed_costs por dentro (todas já com search_path
--    fixado — nenhuma outra alteração nelas). Sem isso, a RLS apertada em
--    5/6 quebraria o apontamento/edição/ocorrência de qualquer usuário sem
--    permissão de financeiro/funcionários/custo_hora, inclusive a
--    supervisora fazendo o próprio trabalho.
-- =========================================================================
alter function public.calcular_custo_hora_operacao_vigente(uuid) security definer;
alter function public.registrar_apontamento_producao_core(
  uuid, uuid, uuid, numeric, numeric, uuid, text, date, time, text, time, time
) security definer;
alter function public.editar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, text) security definer;
alter function public.abrir_ocorrencia_maquina(uuid, uuid, uuid, uuid, text) security definer;

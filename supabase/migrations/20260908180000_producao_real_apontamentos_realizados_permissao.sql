-- Sittech — schema PostgreSQL, migration 31
-- Separa o acesso à tela "Apontamentos realizados" de
-- `producao_real_historico`, que hoje também libera Visão geral,
-- Produtividade, Funcionários, Desvios, Paradas e Validação da previsão —
-- amplo demais para um perfil de supervisora que só deve ver Apontamento +
-- Apontamentos realizados.
--
-- Nova permissão de módulo: `producao_real_apontamentos_realizados`.
-- `producao_real_historico` NÃO é reaproveitada nem removida — continua
-- valendo exatamente como antes para as 6 telas que já dependiam dela, e
-- continua sendo o gate hardcoded das RPCs/tools que já a checavam
-- (obter_indicadores_producao, obter_paradas_producao,
-- excluir_apontamento_producao, tools do Intelligence). Nenhuma dessas foi
-- tocada aqui.
--
-- Mapeamento feito antes de alterar: "Apontamentos realizados"
-- (useApontamentosRealizados.ts) faz select direto em
-- apontamentos_producao — não usa nenhuma RPC compartilhada com as outras
-- 6 telas. A única mudança de dado necessária é dar à permissão nova o
-- mesmo SELECT direto na tabela que as outras 3 permissões de Produção
-- Real já têm (policy `apontamentos_producao_select`, migration 21) — sem
-- remover nenhuma das 3 existentes desse OR, só adicionando a 4ª.
--
-- Fora do escopo desta migration, por decisão explícita (não pedido):
-- excluir_apontamento_producao continua exigindo `producao_real_historico`
-- ou admin (migration 23) — quem tiver só a permissão nova consegue ver a
-- lista mas não excluir uma linha (o botão existe na UI, a RPC nega em
-- runtime). Registrado no relatório da tarefa, não corrigido aqui.

-- ---------------------------------------------------------------------
-- 1) usuario_permissoes — CHECK constraint precisa aceitar a chave nova
--    antes de qualquer INSERT com ela ser possível (nome default do
--    Postgres pra CHECK de coluna sem nome explícito: <tabela>_<coluna>
--    _check — confirmado, nenhuma migration posterior renomeou).
-- ---------------------------------------------------------------------
alter table public.usuario_permissoes
  drop constraint usuario_permissoes_permissao_check;

alter table public.usuario_permissoes
  add constraint usuario_permissoes_permissao_check check (permissao in (
    'financeiro', 'produtos', 'maquinas', 'funcionarios', 'custo_hora',
    'previsao', 'capacidade',
    'producao_real_apontamento', 'producao_real_historico', 'producao_real_ocorrencias',
    'producao_real_apontamentos_realizados',
    'usuarios', 'auditoria'
  ));

-- ---------------------------------------------------------------------
-- 2) apontamentos_producao_select — adiciona a permissão nova ao OR
--    existente (aditivo; as 3 permissões antigas continuam exatamente
--    como estavam, migration 21).
-- ---------------------------------------------------------------------
drop policy if exists apontamentos_producao_select on public.apontamentos_producao;

create policy apontamentos_producao_select on public.apontamentos_producao
  for select to authenticated
  using (
    public.is_admin()
    or public.has_permissao('producao_real_apontamento')
    or public.has_permissao('producao_real_historico')
    or public.has_permissao('producao_real_ocorrencias')
    or public.has_permissao('producao_real_apontamentos_realizados')
  );

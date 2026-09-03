-- Sittech — schema PostgreSQL, migration 21
-- Corrige o achado de segurança reportado na etapa anterior (Previsão
-- Semanal V2): `apontamentos_producao` tinha uma única policy
-- (`usuario_ativo_full_access`, for all, migration 9) liberando SELECT
-- pra qualquer usuário ativo, sem checar nenhuma permissão de módulo.
-- Corrige SOMENTE isso — INSERT/UPDATE/DELETE continuam exatamente com a
-- mesma condição de antes (is_usuario_ativo()), nenhuma outra tabela é
-- tocada.
--
-- Mapeamento feito antes de alterar (consumidores reais de SELECT em
-- apontamentos_producao, achados via grep no código + nas functions já
-- aplicadas):
--   * useApontamentosRealizados.ts (tela "Apontamentos realizados",
--     permissão producao_real_historico) — select direto do cliente.
--   * useProducaoRealPainel.ts (painel de chão de fábrica, permissão
--     producao_real_apontamento) — select direto do cliente.
--   * registrar_apontamento_producao_core / registrar_sem_producao_core
--     (permissão producao_real_apontamento) — SECURITY INVOKER: fazem
--     select de idempotência e RETURNING * do INSERT (RETURNING também é
--     filtrado pela policy de SELECT em Postgres).
--   * vincular_ocorrencias_encerradas_ao_apontamento — SECURITY INVOKER,
--     chamada de dentro das duas functions acima (mesma permissão).
--   * encerrar_ocorrencia_maquina (permissão producao_real_ocorrencias) —
--     SECURITY INVOKER: seleciona os apontamentos da máquina que
--     intersectam a ocorrência, pra vincular parada.
--   * editar_apontamento_sem_producao (permissão producao_real_historico)
--     — SECURITY INVOKER: select do apontamento atual + RETURNING do
--     UPDATE. (editar_apontamento_producao já é SECURITY DEFINER desde a
--     migration 16 — não afetada.)
--   * calcular_intersecao_parada_ocorrencia / validar_soma_paradas_periodo
--     (triggers em apontamento_paradas, SECURITY INVOKER por padrão) —
--     disparam a partir de encerrar_ocorrencia_maquina e de
--     registrar_apontamento_producao_core/registrar_sem_producao_core —
--     herdam o contexto de RLS de quem chamou.
--   * obter_realizado_previsao_por_semana (migration 20, permissão
--     previsao) — SECURITY INVOKER hoje; com o SELECT restrito às 3
--     permissões de Produção Real, um usuário só-previsao passaria no
--     has_permissao('previsao') interno e ainda assim receberia zero
--     linhas (RLS filtrando por baixo) — silenciosamente errado, não um
--     erro. Corrigido abaixo trocando pra SECURITY DEFINER (ver decisão 2).
--
-- Conclusão do mapeamento: as 3 permissões de Produção Real
-- (producao_real_apontamento, producao_real_historico,
-- producao_real_ocorrencias) precisam TODAS de SELECT direto na tabela —
-- não é invenção de regra nova, é o que as functions/triggers já
-- existentes (não alteradas aqui) já fazem hoje em contexto INVOKER, em
-- fluxos que se cruzam (ex.: fechar uma ocorrência precisa achar
-- apontamentos; os dois triggers de apontamento_paradas disparam tanto no
-- fluxo de apontamento quanto no de ocorrência). Não há necessidade de
-- decisão de negócio aqui — as 3 recebem exatamente o mesmo SELECT.
--
-- Decisão 1 — policy de SELECT: substituída por
--   is_admin() OR has_permissao('producao_real_apontamento')
--     OR has_permissao('producao_real_historico')
--     OR has_permissao('producao_real_ocorrencias')
-- Nenhuma permissão nova foi inventada — reaproveita exatamente as 3 que
-- já existem (migration 17, CHECK de usuario_permissoes).
--
-- Decisão 2 — obter_realizado_previsao_por_semana vira SECURITY DEFINER
-- (dona é `postgres`, mesmo padrão já usado por
-- editar_apontamento_producao/abrir_ocorrencia_maquina/
-- calcular_custo_hora_operacao_vigente — apontamentos_producao NÃO tem
-- FORCE ROW LEVEL SECURITY, confirmado, então o dono da function
-- continua bypassando RLS normalmente). Isso é necessário porque a
-- permissão `previsao` NÃO está (de propósito) na lista de quem pode ler
-- a tabela crua — o único jeito de dar a essa permissão o agregado sem
-- lhe dar SELECT irrestrito é a própria RPC ler com privilégio elevado e
-- devolver só o agregado mínimo, com sua própria checagem de permissão
-- (já existia, mantida) como único portão. search_path continua fixo
-- (public, pg_temp), nenhum SQL dinâmico, retorno continua sendo só
-- (produto_id, produto_nome, quantidade_boa) — nenhum funcionário,
-- máquina, custo, observação ou parada. Grants inalterados (só
-- authenticated).

-- ---------------------------------------------------------------------
-- 1) apontamentos_producao — separa SELECT do resto
-- ---------------------------------------------------------------------
drop policy if exists usuario_ativo_full_access on public.apontamentos_producao;

create policy apontamentos_producao_insert on public.apontamentos_producao
  for insert to authenticated
  with check (public.is_usuario_ativo());

create policy apontamentos_producao_update on public.apontamentos_producao
  for update to authenticated
  using (public.is_usuario_ativo())
  with check (public.is_usuario_ativo());

create policy apontamentos_producao_delete on public.apontamentos_producao
  for delete to authenticated
  using (public.is_usuario_ativo());

create policy apontamentos_producao_select on public.apontamentos_producao
  for select to authenticated
  using (
    public.is_admin()
    or public.has_permissao('producao_real_apontamento')
    or public.has_permissao('producao_real_historico')
    or public.has_permissao('producao_real_ocorrencias')
  );

-- ---------------------------------------------------------------------
-- 2) obter_realizado_previsao_por_semana — vira SECURITY DEFINER, pra
--    continuar funcionando pra quem só tem `previsao` (que não ganha
--    SELECT direto na tabela pela policy acima). Corpo idêntico ao da
--    migration 20 — só a linha `security invoker` -> `security definer`.
-- ---------------------------------------------------------------------
create or replace function public.obter_realizado_previsao_por_semana(p_semana_inicio date)
returns table(produto_id uuid, produto_nome text, quantidade_boa numeric)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if not public.has_permissao('previsao') then
    raise exception 'Usuário não tem permissão para consultar o realizado da previsão semanal';
  end if;

  return query
  select ap.produto_id, p.nome,
         coalesce(sum(ap.quantidade_produzida - ap.quantidade_refugo), 0)::numeric as quantidade_boa
  from public.apontamentos_producao ap
  join public.produtos p on p.id = ap.produto_id
  where ap.data >= p_semana_inicio and ap.data <= p_semana_inicio + 6
  group by ap.produto_id, p.nome;
end;
$$;

revoke all on function public.obter_realizado_previsao_por_semana(date) from public, anon, authenticated, service_role;
grant execute on function public.obter_realizado_previsao_por_semana(date) to authenticated;

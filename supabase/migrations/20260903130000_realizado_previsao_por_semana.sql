-- Sittech — schema PostgreSQL, migration 20
-- Previsão Semanal V2 (reorganização visual) — liga "Realizado" ao que de
-- fato saiu em Produção Real, por produto_id + semana. Nenhuma fórmula de
-- capacidade/atingibilidade é tocada aqui — só uma nova RPC de leitura,
-- puramente aditiva.
--
-- `obter_realizado_previsao_por_semana(p_semana_inicio date)` — devolve,
-- por produto, a soma de produção BOA (quantidade_produzida -
-- quantidade_refugo) de todos os apontamentos_producao cuja `data` cai
-- dentro da semana [p_semana_inicio, p_semana_inicio + 6] — mesma
-- definição de semana (segunda a domingo) já usada por
-- src/lib/date.ts (mondayOf/weekLabel), sem reinterpretação.
--
-- Devolve TODOS os produtos com apontamento na semana, não só os que
-- estão na previsão — o frontend usa isso tanto pra achar o "realizado"
-- de cada item previsto (join por produto_id) quanto pra detectar
-- produção que aconteceu sem estar na previsão (diferença de conjuntos,
-- calculada no cliente; esta function não decide nem atribui nada).
--
-- Desenho de acesso (ver decisão de segurança, não RLS): hoje a RLS de
-- apontamentos_producao (`usuario_ativo_full_access`, migration 9) já
-- permite SELECT completo pra qualquer usuário ativo, independente de
-- permissão de módulo — isso não é alterado aqui (não enfraquece nem
-- fortalece RLS). Só que a tela de Previsão não deveria precisar (nem
-- expor ao cliente) que a Previsão-only tenha acesso irrestrito à tabela
-- de apontamentos: esta function é SECURITY INVOKER (continua respeitando
-- a RLS de baixo, nada é bypassado) e devolve só o agregado mínimo
-- (produto_id, produto_nome, quantidade_boa) — nunca funcionário,
-- observação, motivo ou qualquer coluna de custo — e exige
-- has_permissao('previsao') explicitamente (que já embute is_admin() OR
-- ...) antes de rodar a query, mais restritivo que a RLS pura de hoje.
create or replace function public.obter_realizado_previsao_por_semana(p_semana_inicio date)
returns table(produto_id uuid, produto_nome text, quantidade_boa numeric)
language plpgsql
security invoker
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

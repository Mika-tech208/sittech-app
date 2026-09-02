-- Sittech — schema PostgreSQL, migration 7
-- Corrige a persistência de uma semana de Previsão: usePrevisoes.upsertSemana
-- fazia garantir-previsão (select-ou-insert), depois DELETE+INSERT dos
-- itens previstos, depois DELETE+INSERT dos itens realizados, depois
-- DELETE+INSERT das máquinas indisponíveis — quatro a seis chamadas REST
-- sequenciais, sem transação entre elas. Uma falha de rede no meio deixava
-- a semana com dado parcialmente salvo (ex.: itens previstos apagados mas
-- não recriados). Mesma causa raiz já corrigida pra Produtos/Roteiro na
-- migration 5 (atualizar_produto_com_roteiro).
--
-- Solução: uma única function PL/pgSQL, chamada via RPC — a execução de
-- uma function já é atômica no Postgres, então qualquer erro no meio
-- desfaz tudo, incluindo o upsert da linha em `previsoes`. SECURITY
-- INVOKER (default, igual à migration 5): roda com o papel/RLS de quem
-- chama, sem elevar privilégio — os GRANTs de
-- previsoes/previsao_itens/previsao_item_maquinas/
-- previsao_maquinas_indisponiveis pro papel `authenticated` já existem
-- desde a migration 4 (tabelas operacionais, full CRUD), então isso não
-- precisa (nem deve) mudar Auth/RLS/GRANTs.
--
-- Preserva exatamente o comportamento atual do frontend:
--   * cada uma das três partes (itens previstos, itens realizados,
--     máquinas indisponíveis) só é tocada se o parâmetro correspondente
--     não for NULL — mesma semântica do `campos.itens !== undefined` /
--     `campos.itensRealizados !== undefined` /
--     `campos.maquinasIndisponiveis !== undefined` de hoje. NULL = não
--     mexe nessa parte; um array (mesmo vazio) = substitui tudo daquela
--     parte pelo que veio.
--   * dentro de uma parte tocada, continua sendo "apaga tudo daquele tipo
--     e recria do zero" (não é diff/upsert por id, ao contrário do
--     roteiro) — mesmo comportamento do sincronizarItens() atual, UUIDs
--     novos gerados pelo Postgres a cada save, exatamente como já era.
--   * produto_nome/valor_unitario são gravados exatamente como vieram no
--     payload (snapshot do momento do lançamento) — nunca relidos de
--     `produtos`.
--   * maquinasPorEtapa preservado como está: uma linha em
--     previsao_item_maquinas por (etapa_id, maquina_id) de cada item.
--   * DELETE FROM previsao_itens já cascateia (ON DELETE CASCADE) pra
--     previsao_item_maquinas — não precisa de DELETE explícito nessa
--     tabela.
--   * nenhuma fórmula de capacidade/viabilidade é tocada — esta migration
--     só muda ONDE a escrita acontece, não o formato lido pelo frontend
--     (usePrevisoes.ts continua montando Previsao/PrevisaoItem do mesmo
--     jeito, a partir do mesmo SELECT aninhado de sempre).

create or replace function public.upsert_previsao_semana(
  p_semana_inicio date,
  p_itens_previsto jsonb, -- null = não mexe; array (json) = substitui todos os itens 'previsto'. Cada item: {produto_id, produto_nome, valor_unitario, quantidade, maquinas_por_etapa: {etapaId: [maquinaId, ...]}}
  p_itens_realizado jsonb, -- mesmo formato de p_itens_previsto, pro tipo 'realizado'
  p_maquinas_indisponiveis jsonb -- null = não mexe; array de uuid (texto) = substitui
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_previsao_id uuid;
  v_item jsonb;
  v_novo_item_id uuid;
  v_rel record;
  v_maquina_id uuid;
begin
  insert into previsoes (semana_inicio)
  values (p_semana_inicio)
  on conflict (semana_inicio) do nothing;

  select id into v_previsao_id from previsoes where semana_inicio = p_semana_inicio;

  if p_itens_previsto is not null then
    delete from previsao_itens where previsao_id = v_previsao_id and tipo = 'previsto';
    for v_item in select * from jsonb_array_elements(p_itens_previsto)
    loop
      insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade)
      values (
        v_previsao_id, 'previsto', (v_item->>'produto_id')::uuid, v_item->>'produto_nome',
        (v_item->>'valor_unitario')::numeric, (v_item->>'quantidade')::numeric
      )
      returning id into v_novo_item_id;

      for v_rel in select key as etapa_id, value as maquina_ids from jsonb_each(coalesce(v_item->'maquinas_por_etapa', '{}'::jsonb))
      loop
        for v_maquina_id in select value::text::uuid from jsonb_array_elements_text(v_rel.maquina_ids)
        loop
          insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) values (v_novo_item_id, v_rel.etapa_id::uuid, v_maquina_id);
        end loop;
      end loop;
    end loop;
  end if;

  if p_itens_realizado is not null then
    delete from previsao_itens where previsao_id = v_previsao_id and tipo = 'realizado';
    for v_item in select * from jsonb_array_elements(p_itens_realizado)
    loop
      insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade)
      values (
        v_previsao_id, 'realizado', (v_item->>'produto_id')::uuid, v_item->>'produto_nome',
        (v_item->>'valor_unitario')::numeric, (v_item->>'quantidade')::numeric
      )
      returning id into v_novo_item_id;

      for v_rel in select key as etapa_id, value as maquina_ids from jsonb_each(coalesce(v_item->'maquinas_por_etapa', '{}'::jsonb))
      loop
        for v_maquina_id in select value::text::uuid from jsonb_array_elements_text(v_rel.maquina_ids)
        loop
          insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) values (v_novo_item_id, v_rel.etapa_id::uuid, v_maquina_id);
        end loop;
      end loop;
    end loop;
  end if;

  if p_maquinas_indisponiveis is not null then
    delete from previsao_maquinas_indisponiveis where previsao_id = v_previsao_id;
    if jsonb_array_length(p_maquinas_indisponiveis) > 0 then
      insert into previsao_maquinas_indisponiveis (previsao_id, maquina_id)
      select v_previsao_id, value::text::uuid from jsonb_array_elements_text(p_maquinas_indisponiveis);
    end if;
  end if;

  return v_previsao_id;
end;
$$;

-- Mesmo padrão das migrations 4/5: privilégio de EXECUTE só pra
-- authenticated. A função roda como o usuário chamando (security invoker),
-- então RLS + GRANTs de tabela já existentes continuam sendo o que decide
-- o que ela pode ou não fazer — isto só permite chamar a function em si.
grant execute on function public.upsert_previsao_semana(date, jsonb, jsonb, jsonb) to authenticated;

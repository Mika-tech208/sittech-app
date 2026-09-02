-- Sittech — schema PostgreSQL, migration 5
-- Corrige a persistência de edição de Produto/Roteiro: atualizarProduto()
-- fazia UPDATE em produtos e depois apagava/recriava TODO o roteiro
-- (DELETE em roteiro_etapas + INSERT). Etapas já referenciadas por
-- previsao_item_maquinas.etapa_id (RESTRICT) fazem esse DELETE falhar —
-- e como produtos e roteiro_etapas eram duas chamadas REST separadas, sem
-- transação entre elas, o produto podia ficar com os campos novos salvos
-- e o roteiro com erro, uma edição parcialmente salva.
--
-- Solução: uma única função PL/pgSQL, chamada via RPC, que faz tudo numa
-- transação implícita só (Postgres já trata a execução de uma function
-- como atômica) — se qualquer parte falhar (incluindo o RESTRICT), a
-- function inteira é desfeita, produto incluído. SECURITY INVOKER
-- (default) — roda com o mesmo papel/RLS de quem chama, sem elevar
-- privilégio; os GRANTs de produtos/roteiro_etapas/roteiro_etapa_maquinas
-- pro papel `authenticated` já existem desde a migration 4, então isso
-- não precisa (nem deve) mudar Auth/RLS/GRANTs.
--
-- Dentro do roteiro, agora é diff em vez de apagar tudo:
--   * etapas com id existente -> UPDATE pelo id (preserva a identidade);
--   * etapas sem id (novas) -> INSERT;
--   * etapas que existiam pro produto mas não vieram mais no payload ->
--     DELETE só essas (é aqui que o RESTRICT pode disparar, e só nessas
--     linhas — etapas mantidas nunca são tocadas por DELETE);
--   * roteiro_etapa_maquinas de cada etapa é ressincronizado (apaga e
--     recria as linhas de relação) — essa tabela não tem RESTRICT sobre
--     si mesma (o RESTRICT é em maquinas, protegendo a exclusão da
--     MÁQUINA, não da relação etapa<->máquina), então isso é sempre
--     seguro.
-- `ordem` é preservada em duas fases (temp negativo, depois valor real)
-- pra nunca colidir com o UNIQUE(produto_id, ordem) quando uma etapa do
-- meio é removida e as seguintes precisam deslizar pra baixo.

create or replace function public.atualizar_produto_com_roteiro(
  p_produto_id uuid,
  p_nome text,
  p_referencia text,
  p_valor_unitario numeric,
  p_prioridade text,
  p_roteiro jsonb -- [{ id: uuid|null, ordem: int, operacao_id: uuid, meta_m1..meta_t3: numeric, maquinas_ids: uuid[] }, ...]
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ids_mantidos uuid[];
  v_etapa jsonb;
  v_etapa_id uuid;
  v_maquina_id uuid;
begin
  update produtos
  set nome = p_nome,
      referencia = p_referencia,
      valor_unitario = p_valor_unitario,
      prioridade = p_prioridade
  where id = p_produto_id;

  if not found then
    raise exception 'Produto % não encontrado', p_produto_id;
  end if;

  select coalesce(array_agg((elem->>'id')::uuid), '{}')
    into v_ids_mantidos
    from jsonb_array_elements(p_roteiro) elem
    where elem->>'id' is not null;

  -- etapas removidas pelo usuário (existiam antes, não vieram no
  -- payload). Se alguma estiver referenciada por previsao_item_maquinas,
  -- o RESTRICT levanta exceção aqui e a function inteira é desfeita —
  -- inclusive o UPDATE de produtos acima.
  delete from roteiro_etapas
  where produto_id = p_produto_id
    and id <> all (v_ids_mantidos);

  -- fase 1: joga a ordem das etapas mantidas pra uma faixa negativa, pra
  -- nunca colidir com UNIQUE(produto_id, ordem) na fase 2 (ex.: remover a
  -- etapa do meio desloca as seguintes pra baixo).
  for v_etapa in select * from jsonb_array_elements(p_roteiro) where value->>'id' is not null
  loop
    update roteiro_etapas
    set ordem = -1 - (v_etapa->>'ordem')::int
    where id = (v_etapa->>'id')::uuid and produto_id = p_produto_id;
  end loop;

  -- fase 2: cada etapa do payload — UPDATE pelo id se já existia, INSERT
  -- se é nova — e ressincroniza suas máquinas elegíveis.
  for v_etapa in select * from jsonb_array_elements(p_roteiro)
  loop
    if v_etapa->>'id' is not null then
      v_etapa_id := (v_etapa->>'id')::uuid;
      update roteiro_etapas
      set operacao_id = (v_etapa->>'operacao_id')::uuid,
          ordem = (v_etapa->>'ordem')::int,
          meta_m1 = (v_etapa->>'meta_m1')::numeric,
          meta_m2 = (v_etapa->>'meta_m2')::numeric,
          meta_m3 = (v_etapa->>'meta_m3')::numeric,
          meta_t1 = (v_etapa->>'meta_t1')::numeric,
          meta_t2 = (v_etapa->>'meta_t2')::numeric,
          meta_t3 = (v_etapa->>'meta_t3')::numeric
      where id = v_etapa_id and produto_id = p_produto_id;
    else
      insert into roteiro_etapas (
        produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3
      ) values (
        p_produto_id, (v_etapa->>'operacao_id')::uuid, (v_etapa->>'ordem')::int,
        (v_etapa->>'meta_m1')::numeric, (v_etapa->>'meta_m2')::numeric, (v_etapa->>'meta_m3')::numeric,
        (v_etapa->>'meta_t1')::numeric, (v_etapa->>'meta_t2')::numeric, (v_etapa->>'meta_t3')::numeric
      )
      returning id into v_etapa_id;
    end if;

    delete from roteiro_etapa_maquinas where etapa_id = v_etapa_id;

    if jsonb_array_length(coalesce(v_etapa->'maquinas_ids', '[]'::jsonb)) > 0 then
      for v_maquina_id in select value::text::uuid from jsonb_array_elements_text(v_etapa->'maquinas_ids')
      loop
        insert into roteiro_etapa_maquinas (etapa_id, maquina_id) values (v_etapa_id, v_maquina_id);
      end loop;
    end if;
  end loop;
end;
$$;

-- Mesmo padrão da migration 4: privilégio de EXECUTE só pra
-- authenticated (função roda como o usuário chamando, então RLS +
-- GRANTs de tabela já existentes continuam sendo o que decide o que ela
-- pode ou não fazer — isto só permite chamar a function em si).
grant execute on function public.atualizar_produto_com_roteiro(uuid, text, text, numeric, text, jsonb) to authenticated;

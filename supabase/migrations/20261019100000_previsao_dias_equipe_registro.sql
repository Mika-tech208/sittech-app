-- Sittech — Previsão Semanal: dias produtivos, equipe produtiva da semana e
-- rastreabilidade (data/hora/usuário) dos itens realizados.
--
-- 1) previsao_dias_produtivos: quais dias DAQUELA semana são produtivos
--    (7 linhas por previsão, segunda..domingo, com `ativo`). Pertence à
--    previsão — NÃO altera configuracoes_empresa.dias_uteis_semana, que
--    continua sendo só o PADRÃO aplicado quando uma previsão nova é criada.
--    Semanas antigas ganham, abaixo, um snapshot do padrão vigente na
--    migration (segunda..N), então mudar o padrão global depois não
--    reescreve o histórico.
--
-- 2) previsao_equipe_semana: quem foi considerado produtivo naquela
--    semana (uma linha por funcionário do "elenco" da semana, com
--    `produtivo`). Guarda QUAIS funcionários, nunca só a quantidade.
--    Não toca funcionarios.ativo, salário nem Custo/hora. Mesmo padrão de
--    snapshot: previsões existentes recebem todos os funcionários ativos
--    como produtivos (equivale ao que o sistema já assumia).
--    `operacao_id` é SNAPSHOT da operação do funcionário naquela semana:
--    copiada de funcionarios.operacao_id quando a linha nasce e NUNCA mais
--    sincronizada — mudar o cadastro depois não altera semanas antigas. Pode
--    ser ajustada manualmente dentro da semana (sem tocar no cadastro).
--
-- 3) previsao_itens.registrado_em / registrado_por / registrado_por_nome:
--    created_at NÃO serve — upsert_previsao_semana apaga e recria todas as
--    linhas de um tipo a cada save, então created_at de um item antigo
--    mudaria toda vez que qualquer outro item fosse lançado. O carimbo é
--    decidido pelo servidor (nunca pelo cliente) e preservado por id entre
--    saves. Itens lançados antes desta migration ficam com NULL (a UI diz
--    que o registro é anterior ao controle, em vez de inventar uma data).
--
-- Permissões: mesmas políticas das demais tabelas de previsão
-- (usuario_ativo_full_access) — a tela já é protegida pela permissão
-- "previsao"; nenhuma permissão nova.

create table public.previsao_dias_produtivos (
  previsao_id uuid not null references public.previsoes(id) on delete cascade,
  dia date not null,
  ativo boolean not null,
  primary key (previsao_id, dia)
);

create table public.previsao_equipe_semana (
  previsao_id uuid not null references public.previsoes(id) on delete cascade,
  funcionario_id uuid not null references public.funcionarios(id) on delete restrict,
  produtivo boolean not null,
  operacao_id uuid references public.operacoes(id) on delete restrict,
  primary key (previsao_id, funcionario_id)
);
create index idx_previsao_equipe_semana_funcionario on public.previsao_equipe_semana(funcionario_id);
create index idx_previsao_equipe_semana_operacao on public.previsao_equipe_semana(operacao_id);

alter table public.previsao_itens
  add column registrado_em timestamptz,
  add column registrado_por uuid references public.usuarios(id) on delete set null,
  add column registrado_por_nome text;

alter table public.previsao_dias_produtivos enable row level security;
alter table public.previsao_equipe_semana enable row level security;

create policy usuario_ativo_full_access on public.previsao_dias_produtivos
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());
create policy usuario_ativo_full_access on public.previsao_equipe_semana
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());

grant select, insert, update, delete on public.previsao_dias_produtivos to authenticated;
grant select, insert, update, delete on public.previsao_equipe_semana to authenticated;

-- ---- backfill: semanas existentes preservam o que o sistema já assumia ----
insert into public.previsao_dias_produtivos (previsao_id, dia, ativo)
select p.id,
       p.semana_inicio + g.i,
       g.i < coalesce((select greatest(0, least(7, floor(dias_uteis_semana)))::int from public.configuracoes_empresa limit 1), 5)
from public.previsoes p
cross join generate_series(0, 6) as g(i);

insert into public.previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id)
select p.id, f.id, true, f.operacao_id
from public.previsoes p
cross join public.funcionarios f
where f.ativo;

-- =========================================================================
-- upsert_previsao_semana: dois parâmetros novos (opcionais) + carimbo dos
-- realizados. A assinatura antiga (4 args) é removida e recriada com os
-- novos no fim, com DEFAULT NULL — o frontend antigo, que chama só com 4
-- argumentos nomeados, continua funcionando. NULL = "não mexe".
-- =========================================================================
drop function if exists public.upsert_previsao_semana(date, jsonb, jsonb, jsonb);

create or replace function public.upsert_previsao_semana(
  p_semana_inicio date,
  p_itens_previsto jsonb,
  p_itens_realizado jsonb,
  p_maquinas_indisponiveis jsonb,
  p_dias_produtivos jsonb default null, -- array de datas ISO ATIVAS (as demais dias da semana ficam inativos); null = não mexe
  p_equipe_semana jsonb default null    -- array de {funcionario_id, produtivo, operacao_id?}; null = não mexe. operacao_id ausente = mantém o snapshot da semana (ou, se não havia, a operação do cadastro agora)
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
  v_antigos jsonb;
  v_antigo jsonb;
  v_usuario_id uuid;
  v_usuario_nome text;
  v_dia text;
  v_dias_padrao integer;
  v_ops_antigas jsonb;
begin
  select id, nome into v_usuario_id, v_usuario_nome
  from usuarios where auth_user_id = auth.uid() and ativo = true;

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
    -- carimbo anterior por id, lido ANTES do delete — o cliente nunca
    -- informa data/usuário, só o servidor decide (itens novos = agora).
    select coalesce(jsonb_object_agg(id::text, jsonb_build_object('em', registrado_em, 'por', registrado_por, 'nome', registrado_por_nome)), '{}'::jsonb)
    into v_antigos
    from previsao_itens where previsao_id = v_previsao_id and tipo = 'realizado';

    delete from previsao_itens where previsao_id = v_previsao_id and tipo = 'realizado';
    for v_item in select * from jsonb_array_elements(p_itens_realizado)
    loop
      v_antigo := v_antigos -> (v_item->>'id');
      insert into previsao_itens (
        previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade,
        registrado_em, registrado_por, registrado_por_nome
      )
      values (
        v_previsao_id, 'realizado', (v_item->>'produto_id')::uuid, v_item->>'produto_nome',
        (v_item->>'valor_unitario')::numeric, (v_item->>'quantidade')::numeric,
        case when v_antigo is not null then (v_antigo->>'em')::timestamptz else now() end,
        case when v_antigo is not null then (v_antigo->>'por')::uuid else v_usuario_id end,
        case when v_antigo is not null then v_antigo->>'nome' else v_usuario_nome end
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

  -- ---- dias produtivos da semana ----
  if p_dias_produtivos is not null then
    for v_dia in select value from jsonb_array_elements_text(p_dias_produtivos)
    loop
      if v_dia::date < p_semana_inicio or v_dia::date > p_semana_inicio + 6 then
        raise exception 'Dia % fora da semana que começa em %', v_dia, p_semana_inicio;
      end if;
    end loop;
    delete from previsao_dias_produtivos where previsao_id = v_previsao_id;
    insert into previsao_dias_produtivos (previsao_id, dia, ativo)
    select v_previsao_id, p_semana_inicio + g.i,
           exists (select 1 from jsonb_array_elements_text(p_dias_produtivos) d where d.value::date = p_semana_inicio + g.i)
    from generate_series(0, 6) as g(i);
  elsif not exists (select 1 from previsao_dias_produtivos where previsao_id = v_previsao_id) then
    -- previsão nova (ou sem snapshot): aplica o padrão da empresa UMA vez
    select coalesce(greatest(0, least(7, floor(dias_uteis_semana)))::int, 5) into v_dias_padrao
    from configuracoes_empresa limit 1;
    v_dias_padrao := coalesce(v_dias_padrao, 5);
    insert into previsao_dias_produtivos (previsao_id, dia, ativo)
    select v_previsao_id, p_semana_inicio + g.i, g.i < v_dias_padrao
    from generate_series(0, 6) as g(i);
  end if;

  -- ---- equipe produtiva da semana ----
  if p_equipe_semana is not null then
    -- snapshot de operação anterior, lido ANTES do delete: sem operacao_id no
    -- payload, a operação da semana é preservada (nunca relida do cadastro);
    -- só funcionário que ainda não estava na semana pega a do cadastro.
    select coalesce(jsonb_object_agg(funcionario_id::text, operacao_id::text), '{}'::jsonb)
    into v_ops_antigas from previsao_equipe_semana where previsao_id = v_previsao_id;

    delete from previsao_equipe_semana where previsao_id = v_previsao_id;
    insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id)
    select v_previsao_id,
           (e->>'funcionario_id')::uuid,
           coalesce((e->>'produtivo')::boolean, false),
           coalesce(
             nullif(e->>'operacao_id', '')::uuid,
             nullif(v_ops_antigas->>(e->>'funcionario_id'), '')::uuid,
             (select f.operacao_id from funcionarios_elegibilidade f where f.id = (e->>'funcionario_id')::uuid)
           )
    from jsonb_array_elements(p_equipe_semana) e;
  elsif not exists (select 1 from previsao_equipe_semana where previsao_id = v_previsao_id) then
    -- padrão: todos os funcionários ativos elegíveis; a view não expõe salário
    insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id)
    select v_previsao_id, id, true, operacao_id from funcionarios_elegibilidade where ativo = true;
  end if;

  return v_previsao_id;
end;
$$;

grant execute on function public.upsert_previsao_semana(date, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- Escala de Produção — FASE 1: ADICIONAL POR ETAPA + ESTOQUE INTERMEDIÁRIO (WIP) PLANEJADO.
--
-- Até aqui o adicional era um número por item (produto ACABADO: todas as etapas absorviam o mesmo valor). Agora
-- cada etapa do roteiro pode ter o seu adicional (A_k, nunca crescente ao longo do roteiro): o adicional de
-- produto acabado é o da ÚLTIMA etapa e a diferença entre etapas é estoque intermediário planejado.
-- O PREVISTO nunca é alterado por nada disto.
--
--  1) escala_parametros: parâmetros da Escala como ENTRADAS CANÔNICAS do motor (operacionais agora; os técnicos
--     avançados entram na Fase 4). Alterar um parâmetro gera recálculo das semanas com escala futura.
--     wip_modo = 'desligado' (padrão): TUDO se comporta exatamente como antes.
--  2) previsao_item_adicional_etapa: adicional por (item, etapa).
--  3) escala_producao_alocacoes.tipo_adicional: 'acabado' (última etapa) ou 'intermediario'.
--  4) upsert_previsao_semana: aceita `adicional_etapas` por item e PRESERVA os valores por etapa quando o cliente não os envia
--     (o upsert recria os itens a cada salvamento); valida: etapas do roteiro do produto e etapa seguinte nunca acima da anterior.
--  5) escala_aplicar_recalculo / escala_trocar_alocacoes: gravam/trocam tipo_adicional.
--  6) escala_wip_modo(): o modo atual, para a tela saber qual formulário mostrar.
-- Aditiva e reversível: com wip_modo = 'desligado' nada do novo é usado.

-- =========================================================================
-- 1) Parâmetros
-- =========================================================================
create table if not exists public.escala_parametros (
  chave text primary key,
  valor jsonb not null,
  grupo text not null check (grupo in ('operacional', 'tecnico')),
  descricao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuarios(id) on delete set null,
  constraint escala_parametros_wip_modo check (chave <> 'wip_modo' or valor in ('"desligado"'::jsonb, '"ativo"'::jsonb)),
  constraint escala_parametros_wip_dias check (chave <> 'wip_dias_limite' or (jsonb_typeof(valor) = 'number' and (valor #>> '{}')::numeric >= 0))
);
alter table public.escala_parametros enable row level security;
drop policy if exists escala_parametros_admin on public.escala_parametros;
create policy escala_parametros_admin on public.escala_parametros for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.escala_parametros from anon, authenticated;
grant select, insert, update on public.escala_parametros to authenticated;
grant select on public.escala_parametros to service_role;

insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('wip_modo', '"desligado"', 'operacional', 'Adicional por etapa + estoque intermediário planejado: desligado (padrão, comportamento anterior) ou ativo'),
  ('wip_dias_limite', '1', 'operacional', 'Limite padrão de estoque intermediário: dias produtivos de consumo da etapa seguinte (sem Previsão da próxima semana)')
on conflict (chave) do nothing;

create or replace function public.escala_trg_parametros()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
begin
  -- parâmetro do motor mudou: recalcula as semanas com escala futura (só períodos futuros; passado congelado)
  for v_prev in select * from public.escala_previsoes_com_escala_futura() loop
    perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('tabela', 'escala_parametros', 'chave', coalesce(new.chave, old.chave)), null);
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_escala_parametros_evento on public.escala_parametros;
create trigger trg_escala_parametros_evento after insert or update or delete on public.escala_parametros
  for each row execute function public.escala_trg_parametros();
revoke all on function public.escala_trg_parametros() from public, anon, authenticated;

create or replace function public.escala_wip_modo()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'wip_modo'), 'desligado');
$$;
revoke all on function public.escala_wip_modo() from public, anon;
grant execute on function public.escala_wip_modo() to authenticated;

-- =========================================================================
-- 2) Adicional por (item, etapa)
-- =========================================================================
create table if not exists public.previsao_item_adicional_etapa (
  item_id uuid not null references public.previsao_itens(id) on delete cascade,
  etapa_id uuid not null references public.roteiro_etapas(id) on delete cascade,
  quantidade numeric not null check (quantidade >= 0),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuarios(id) on delete set null,
  primary key (item_id, etapa_id)
);
alter table public.previsao_item_adicional_etapa enable row level security;
drop policy if exists usuario_ativo_full_access on public.previsao_item_adicional_etapa;
create policy usuario_ativo_full_access on public.previsao_item_adicional_etapa
  for all to authenticated using (public.is_usuario_ativo()) with check (public.is_usuario_ativo());
revoke all on public.previsao_item_adicional_etapa from anon;
grant select, insert, update, delete on public.previsao_item_adicional_etapa to authenticated;
grant select on public.previsao_item_adicional_etapa to service_role;

drop trigger if exists trg_escala_evento_previsao_item_adicional_etapa on public.previsao_item_adicional_etapa;
create trigger trg_escala_evento_previsao_item_adicional_etapa after insert or update or delete on public.previsao_item_adicional_etapa
  for each row execute function public.escala_trg_previsao_item_maquina();

-- =========================================================================
-- 3) tipo_adicional nas alocações
-- =========================================================================
alter table public.escala_producao_alocacoes add column if not exists tipo_adicional text;
alter table public.escala_producao_alocacoes drop constraint if exists escala_alocacoes_tipo_adicional;
alter table public.escala_producao_alocacoes add constraint escala_alocacoes_tipo_adicional
  check (tipo_adicional is null or (tipo_adicional in ('acabado', 'intermediario') and pecas_adicional > 0));

-- =========================================================================
-- 4) upsert_previsao_semana (preserva/valida o adicional por etapa)
-- =========================================================================
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
  v_adic_antigos jsonb;
  v_adic_antigo jsonb;
  v_qtd_adic numeric;
  v_adic_em timestamptz;
  v_adic_por uuid;
  v_etp_antigos jsonb;
  v_etp jsonb;
  v_etp_rel record;
  v_produto_item uuid;
begin
  select id, nome into v_usuario_id, v_usuario_nome
  from usuarios where auth_user_id = auth.uid() and ativo = true;

  insert into previsoes (semana_inicio)
  values (p_semana_inicio)
  on conflict (semana_inicio) do nothing;

  select id into v_previsao_id from previsoes where semana_inicio = p_semana_inicio;

  if p_itens_previsto is not null then
    -- carga ADICIONAL anterior por id, lida ANTES do delete: salvar o previsto por um cliente que
    -- não manda `quantidade_adicional` preserva o adicional (nunca zera em silêncio); o carimbo
    -- (quem/quando) só muda quando o valor do adicional muda.
    select coalesce(jsonb_object_agg(id::text, jsonb_build_object('qtd', quantidade_adicional, 'em', adicional_atualizado_em, 'por', adicional_atualizado_por)), '{}'::jsonb)
    into v_adic_antigos
    from previsao_itens where previsao_id = v_previsao_id and tipo = 'previsto';

    -- adicional POR ETAPA anterior por id do item, lido ANTES do delete (o delete em cascata o apagaria)
    select coalesce(jsonb_object_agg(t.item_id::text, t.etapas), '{}'::jsonb)
    into v_etp_antigos
    from (select a.item_id, jsonb_object_agg(a.etapa_id::text, a.quantidade) as etapas
            from previsao_item_adicional_etapa a join previsao_itens i on i.id = a.item_id
           where i.previsao_id = v_previsao_id and i.tipo = 'previsto'
           group by a.item_id) t;

    delete from previsao_itens where previsao_id = v_previsao_id and tipo = 'previsto';
    for v_item in select * from jsonb_array_elements(p_itens_previsto)
    loop
      v_adic_antigo := v_adic_antigos -> (v_item->>'id');
      v_qtd_adic := coalesce(nullif(v_item->>'quantidade_adicional', '')::numeric, (v_adic_antigo->>'qtd')::numeric, 0);
      if v_qtd_adic < 0 then
        raise exception 'ESCALA_ADICIONAL_INVALIDO: a quantidade adicional não pode ser negativa';
      end if;
      if v_adic_antigo is not null and v_qtd_adic = coalesce((v_adic_antigo->>'qtd')::numeric, 0) then
        v_adic_em := (v_adic_antigo->>'em')::timestamptz;
        v_adic_por := (v_adic_antigo->>'por')::uuid;
      elsif v_qtd_adic > 0 or v_adic_antigo is not null then
        v_adic_em := now();
        v_adic_por := v_usuario_id;
      else
        v_adic_em := null;
        v_adic_por := null;
      end if;

      insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade, quantidade_adicional, adicional_atualizado_em, adicional_atualizado_por)
      values (
        v_previsao_id, 'previsto', (v_item->>'produto_id')::uuid, v_item->>'produto_nome',
        (v_item->>'valor_unitario')::numeric, (v_item->>'quantidade')::numeric,
        v_qtd_adic, v_adic_em, v_adic_por
      )
      returning id into v_novo_item_id;

      for v_rel in select key as etapa_id, value as maquina_ids from jsonb_each(coalesce(v_item->'maquinas_por_etapa', '{}'::jsonb))
      loop
        for v_maquina_id in select value::text::uuid from jsonb_array_elements_text(v_rel.maquina_ids)
        loop
          insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) values (v_novo_item_id, v_rel.etapa_id::uuid, v_maquina_id);
        end loop;
      end loop;

      -- adicional POR ETAPA: o cliente define (`adicional_etapas`) ou o servidor PRESERVA o que já existia. Um cliente antigo
      -- que muda só `quantidade_adicional` invalida os valores por etapa (o valor "de produto acabado" mudou): ficam sem efeito.
      v_etp := v_item -> 'adicional_etapas';
      if v_etp is null and not (v_item ? 'quantidade_adicional' and v_qtd_adic is distinct from coalesce((v_adic_antigo->>'qtd')::numeric, 0)) then
        v_etp := v_etp_antigos -> (v_item->>'id');
      end if;
      if v_etp is not null and jsonb_typeof(v_etp) = 'object' and v_etp <> '{}'::jsonb then
        for v_etp_rel in select key as etapa_id, value as qtd from jsonb_each_text(v_etp)
        loop
          if v_etp_rel.qtd::numeric < 0 then
            raise exception 'ESCALA_ADICIONAL_ETAPA_INVALIDO: a quantidade adicional de uma etapa não pode ser negativa';
          end if;
          insert into previsao_item_adicional_etapa (item_id, etapa_id, quantidade, atualizado_por)
          values (v_novo_item_id, v_etp_rel.etapa_id::uuid, v_etp_rel.qtd::numeric, v_usuario_id);
        end loop;
        v_produto_item := (v_item->>'produto_id')::uuid;
        if exists (select 1 from previsao_item_adicional_etapa a join roteiro_etapas e on e.id = a.etapa_id
                    where a.item_id = v_novo_item_id and e.produto_id <> v_produto_item) then
          raise exception 'ESCALA_ADICIONAL_ETAPA_INVALIDO: etapa que não pertence ao roteiro do produto';
        end if;
        if exists (select 1 from (select a.quantidade, lag(a.quantidade) over (order by e.ordem, e.id) as ant
                                    from previsao_item_adicional_etapa a join roteiro_etapas e on e.id = a.etapa_id
                                   where a.item_id = v_novo_item_id) t
                    where t.ant is not null and t.quantidade > t.ant + 0.000001) then
          raise exception 'ESCALA_ADICIONAL_ETAPA_INVALIDO: a etapa seguinte não pode ter adicional maior que a anterior (nada se processa sem ter sido produzido)';
        end if;
        -- o adicional de PRODUTO ACABADO (legado) acompanha a última etapa do roteiro
        select a.quantidade into v_qtd_adic from previsao_item_adicional_etapa a join roteiro_etapas e on e.id = a.etapa_id
         where a.item_id = v_novo_item_id order by e.ordem desc, e.id desc limit 1;
        if v_qtd_adic is distinct from coalesce((v_adic_antigo->>'qtd')::numeric, 0) then
          update previsao_itens set quantidade_adicional = v_qtd_adic, adicional_atualizado_em = now(), adicional_atualizado_por = v_usuario_id where id = v_novo_item_id;
        else
          update previsao_itens set quantidade_adicional = v_qtd_adic where id = v_novo_item_id;
        end if;
      end if;
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



-- =========================================================================
-- 5) escala_aplicar_recalculo e escala_trocar_alocacoes (tipo_adicional)
-- =========================================================================
create or replace function public.escala_aplicar_recalculo(
  p_previsao_id uuid,
  p_dias jsonb,              -- [{data, versao_base (int|null p/ dia novo), periodos_snapshot}]
  p_a_partir_data date,      -- primeiro período MUTÁVEL: data...
  p_a_partir_periodo text,   -- ...e id do período
  p_alocacoes jsonb,         -- [{data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, origem, excecao_revezamento, motivo_excecao, motivo_sem_posto}]
  p_usuario_id uuid,
  p_evento_ids uuid[],
  p_resumo jsonb,
  p_remover_dias date[] default '{}'   -- dias que deixaram de ser produtivos na Previsão (só o futuro é removido)
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_dia jsonb;
  v_data date;
  v_base integer;
  v_atual integer;
  v_prev uuid;
  v_snapshot jsonb;
  v_corte integer;
  v_datas date[] := '{}';
  v_versoes jsonb;
begin
  if p_previsao_id is null then
    raise exception 'ESCALA_PREVISAO_OBRIGATORIA';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('escala:' || p_previsao_id::text, 0));

  -- 1) valida versões e cria dias novos
  for v_dia in select * from jsonb_array_elements(coalesce(p_dias, '[]'::jsonb)) loop
    v_data := (v_dia->>'data')::date;
    v_base := nullif(v_dia->>'versao_base', '')::integer;
    v_datas := v_datas || v_data;

    select versao, previsao_id into v_atual, v_prev
    from escala_producao_dias where data = v_data for update;

    if found then
      if v_prev <> p_previsao_id then
        raise exception 'ESCALA_DIA_DE_OUTRA_PREVISAO: %', v_data;
      end if;
      if v_base is distinct from v_atual then
        raise exception 'ESCALA_VERSAO_CONFLITO: dia % base % atual %', v_data, v_base, v_atual;
      end if;
    else
      if v_base is not null then
        raise exception 'ESCALA_VERSAO_CONFLITO: dia % inexistente (base %)', v_data, v_base;
      end if;
      insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao)
      values (v_data, p_previsao_id, v_dia->'periodos_snapshot', 0);
    end if;
  end loop;

  -- 2) ponto de corte (índice do período dentro do snapshot do dia de corte)
  select periodos_snapshot into v_snapshot from escala_producao_dias where data = p_a_partir_data;
  if v_snapshot is not null then
    select ord::integer into v_corte
    from jsonb_array_elements(v_snapshot) with ordinality as e(v, ord)
    where e.v->>'id' = p_a_partir_periodo;
    if v_corte is null then
      raise exception 'ESCALA_PERIODO_INVALIDO: %', p_a_partir_periodo;
    end if;
  end if;

  -- 3) nenhuma alocação nova pode cair em período congelado nem fora dos dias informados
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_alocacoes, '[]'::jsonb)) as x(data date, periodo_id text)
    where not (x.data = any(v_datas))
       or x.data < p_a_partir_data
       or (x.data = p_a_partir_data and coalesce((
            select ord::integer from jsonb_array_elements(v_snapshot) with ordinality as e(v, ord) where e.v->>'id' = x.periodo_id
          ), 0) < coalesce(v_corte, 0))
  ) then
    raise exception 'ESCALA_ALOCACAO_CONGELADA: tentativa de gravar período não futuro';
  end if;

  -- 4) apaga somente os períodos futuros dos dias informados
  foreach v_data in array v_datas loop
    if v_data < p_a_partir_data then
      continue;
    elsif v_data > p_a_partir_data then
      delete from escala_producao_alocacoes where data = v_data;
    else
      delete from escala_producao_alocacoes a
      where a.data = v_data
        and coalesce((select ord::integer from jsonb_array_elements(v_snapshot) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id), 0) >= v_corte;
    end if;
  end loop;

  -- 4b) dias que deixaram de ser produtivos: o futuro some, o passado (congelado) fica
  foreach v_data in array coalesce(p_remover_dias, '{}'::date[]) loop
    if v_data > p_a_partir_data then
      delete from escala_producao_dias where data = v_data and previsao_id = p_previsao_id;  -- cascata nas alocações
    elsif v_data = p_a_partir_data then
      select periodos_snapshot into v_snapshot from escala_producao_dias where data = v_data and previsao_id = p_previsao_id;
      if v_snapshot is not null then
        delete from escala_producao_alocacoes a
        where a.data = v_data
          and coalesce((select ord::integer from jsonb_array_elements(v_snapshot) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id), 0) >= coalesce(v_corte, 0);
        update escala_producao_dias set versao = versao + 1, atualizado_em = now(), atualizado_por = p_usuario_id where data = v_data;
      end if;
    end if;
  end loop;

  -- 5) grava as novas alocações (as unicidades do banco são a barreira final)
  insert into escala_producao_alocacoes (
    data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id,
    pecas, pecas_adicional, tipo_adicional, origem, excecao_revezamento, motivo_excecao, motivo_sem_posto
  )
  select x.data, x.periodo_id, x.funcionario_id, x.maquina_id, x.produto_id, x.etapa_id, x.operacao_id,
         coalesce(x.pecas, 0), coalesce(x.pecas_adicional, 0), case when coalesce(x.pecas_adicional, 0) > 0 then x.tipo_adicional else null end, coalesce(x.origem, 'auto'), coalesce(x.excecao_revezamento, false), x.motivo_excecao, x.motivo_sem_posto
  from jsonb_to_recordset(coalesce(p_alocacoes, '[]'::jsonb)) as x(
    data date, periodo_id text, funcionario_id uuid, maquina_id uuid, produto_id uuid, etapa_id uuid, operacao_id uuid,
    pecas numeric, pecas_adicional numeric, tipo_adicional text, origem text, excecao_revezamento boolean, motivo_excecao text, motivo_sem_posto text
  );

  -- 6) versões, histórico e baixa dos eventos
  update escala_producao_dias
     set versao = versao + 1, atualizado_em = now(), atualizado_por = p_usuario_id
   where data = any(v_datas);

  select coalesce(jsonb_object_agg(data::text, versao), '{}'::jsonb) into v_versoes
  from escala_producao_dias where data = any(v_datas);

  insert into escala_producao_eventos (tipo, previsao_id, payload, usuario_id, status, processado_em)
  values ('recalculo', p_previsao_id,
          jsonb_build_object('a_partir_data', p_a_partir_data, 'a_partir_periodo', p_a_partir_periodo,
                             'dias', to_jsonb(v_datas), 'eventos', to_jsonb(coalesce(p_evento_ids, '{}'::uuid[])), 'resumo', coalesce(p_resumo, '{}'::jsonb)),
          p_usuario_id, 'processado', now());

  if p_evento_ids is not null and array_length(p_evento_ids, 1) > 0 then
    update escala_producao_eventos
       set status = 'processado', processado_em = now(), erro = null
     where id = any(p_evento_ids) and status in ('pendente', 'processando');
  end if;

  return jsonb_build_object('versoes', v_versoes);
end;
$$;


create or replace function public.escala_trocar_alocacoes(
  p_data date,
  p_periodo_id text,
  p_funcionario_a uuid,
  p_funcionario_b uuid,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dia public.escala_producao_dias;
  v_idx integer;
  v_inicio text;
  v_a public.escala_producao_alocacoes;
  v_b public.escala_producao_alocacoes;
  v_usuario uuid;
begin
  if not public.escala_pode_operar() then
    raise exception 'Usuário não tem permissão para editar a Escala de Produção';
  end if;
  if p_motivo is null or char_length(btrim(p_motivo)) < 3 then
    raise exception 'ESCALA_MOTIVO_OBRIGATORIO: informe o motivo da troca manual';
  end if;
  if p_funcionario_a = p_funcionario_b then
    raise exception 'Escolha dois funcionários diferentes';
  end if;

  select * into v_dia from escala_producao_dias where data = p_data;
  if not found then
    raise exception 'Não existe escala gerada para %', p_data;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('escala:' || v_dia.previsao_id::text, 0));

  select ord::integer, e.v->>'inicio' into v_idx, v_inicio
  from jsonb_array_elements(v_dia.periodos_snapshot) with ordinality as e(v, ord)
  where e.v->>'id' = p_periodo_id;
  if v_idx is null then
    raise exception 'Período inválido: %', p_periodo_id;
  end if;

  if ((p_data::text || ' ' || substr(v_inicio, 1, 5))::timestamp at time zone 'America/Sao_Paulo') <= now() then
    raise exception 'ESCALA_PERIODO_NAO_EDITAVEL: o período % de % já iniciou — períodos em andamento e concluídos não podem ser editados', p_periodo_id, p_data;
  end if;

  select * into v_a from escala_producao_alocacoes where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_a for update;
  select * into v_b from escala_producao_alocacoes where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_b for update;
  if v_a.funcionario_id is null or v_b.funcionario_id is null then
    raise exception 'Os dois funcionários precisam estar escalados neste período';
  end if;

  -- estaciona A para não violar a unicidade (data, período, máquina) durante a troca
  update escala_producao_alocacoes
     set maquina_id = null, produto_id = null, etapa_id = null, operacao_id = null, pecas = 0, pecas_adicional = 0, tipo_adicional = null, motivo_sem_posto = '__troca__', excecao_revezamento = false, motivo_excecao = null
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_a;

  update escala_producao_alocacoes
     set maquina_id = v_a.maquina_id, produto_id = v_a.produto_id, etapa_id = v_a.etapa_id, operacao_id = v_a.operacao_id, pecas = v_a.pecas, pecas_adicional = v_a.pecas_adicional, tipo_adicional = v_a.tipo_adicional,
         motivo_sem_posto = case when v_a.maquina_id is null then coalesce(v_a.motivo_sem_posto, 'Alteração manual') else null end,
         origem = 'manual'
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_b;

  update escala_producao_alocacoes
     set maquina_id = v_b.maquina_id, produto_id = v_b.produto_id, etapa_id = v_b.etapa_id, operacao_id = v_b.operacao_id, pecas = v_b.pecas, pecas_adicional = v_b.pecas_adicional, tipo_adicional = v_b.tipo_adicional,
         motivo_sem_posto = case when v_b.maquina_id is null then coalesce(v_b.motivo_sem_posto, 'Alteração manual') else null end,
         origem = 'manual'
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_a;

  -- recalcula as exceções de revezamento dos dois funcionários (dia inteiro: só
  -- períodos futuros recebem a marcação nova; passado fica como está)
  with linhas as (
    select a.funcionario_id, a.periodo_id, a.operacao_id, a.maquina_id,
           (select ord::integer from jsonb_array_elements(v_dia.periodos_snapshot) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id) as idx
    from escala_producao_alocacoes a
    where a.data = p_data and a.funcionario_id in (p_funcionario_a, p_funcionario_b)
  ), comparado as (
    select l.*, lag(l.operacao_id) over w as op_ant, lag(l.maquina_id) over w as maq_ant, lag(l.idx) over w as idx_ant
    from linhas l
    window w as (partition by l.funcionario_id order by l.idx)
  )
  update escala_producao_alocacoes a
     set excecao_revezamento = (c.maquina_id is not null and c.maq_ant is not null and c.idx_ant = c.idx - 1 and c.operacao_id = c.op_ant),
         motivo_excecao = case when (c.maquina_id is not null and c.maq_ant is not null and c.idx_ant = c.idx - 1 and c.operacao_id = c.op_ant)
                               then 'Alteração manual: mesma operação do período anterior' else null end
    from comparado c
   where a.data = p_data and a.periodo_id = c.periodo_id and a.funcionario_id = c.funcionario_id and c.idx >= v_idx;

  v_usuario := public.escala_usuario_atual();
  update escala_producao_dias set versao = versao + 1, atualizado_em = now(), atualizado_por = v_usuario where data = p_data;

  insert into escala_producao_eventos (tipo, previsao_id, payload, usuario_id, status, processado_em)
  values ('edicao_manual', v_dia.previsao_id,
          jsonb_build_object(
            'data', p_data, 'periodo_id', p_periodo_id, 'funcionario_a', p_funcionario_a, 'funcionario_b', p_funcionario_b,
            'motivo', btrim(p_motivo),
            'a_antes', jsonb_build_object('maquina_id', v_a.maquina_id, 'operacao_id', v_a.operacao_id),
            'b_antes', jsonb_build_object('maquina_id', v_b.maquina_id, 'operacao_id', v_b.operacao_id)),
          v_usuario, 'processado', now());

  return jsonb_build_object('versao', (select versao from escala_producao_dias where data = p_data));
end;
$$;

grant execute on function public.upsert_previsao_semana(date, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.escala_aplicar_recalculo(uuid, jsonb, date, text, jsonb, uuid, uuid[], jsonb, date[]) to service_role;
revoke all on function public.escala_trocar_alocacoes(date, text, uuid, uuid, text) from public, anon;
grant execute on function public.escala_trocar_alocacoes(date, text, uuid, uuid, text) to authenticated;

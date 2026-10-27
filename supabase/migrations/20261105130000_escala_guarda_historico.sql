-- Sittech — BLOQUEADOR 1: GUARDA CONTRA APAGAR A ESCALA HISTÓRICA.
--
-- Problema (auditoria 27/10/2026): desmarcar um dia produtivo de uma semana já ocorrida (sem nenhum período futuro) fazia o processador mandar "cortar no 1º período do dia
-- removido" — um período que JÁ TINHA COMEÇADO — e escala_aplicar_recalculo apagava as alocações históricas desse dia e as dos dias removidos seguintes.
-- (Reproduzido no DEV em transação com rollback: 180 alocações apagadas.)
--
-- Correção no BANCO (a do processador está em src/lib/escala/processar.ts#pontoDeCorte): o ponto de corte precisa ser um período que ainda NÃO começou
-- (início > now(), America/Sao_Paulo); caso contrário a RPC recusa (ESCALA_CORTE_NO_PASSADO) e nada é gravado. Além disso, o dia removido cujo 1º período é o corte deixa
-- de existir por inteiro (antes ficava uma linha de dia vazia). Todo o resto da função é idêntico à definição anterior (20261022100000).
-- Reversão: reaplicar a definição de 20261022100000 (create or replace).

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
  v_inicio_corte timestamptz;
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

  -- 2b) GUARDA DO HISTÓRICO (imutável): o ponto de corte TEM que ser um período que AINDA NÃO COMEÇOU. Os passos 3, 4 e 4b só atuam em períodos >= corte, então um corte futuro
  --     garante que nenhum período iniciado seja apagado ou reescrito — mesmo que o chamador envie dados errados (ex.: sem slot futuro, "cortar no 1º período do dia removido").
  if v_snapshot is null then
    raise exception 'ESCALA_CORTE_INVALIDO: não existe escala para % (corte %)', p_a_partir_data, p_a_partir_periodo;
  end if;
  select ((p_a_partir_data + (e.v->>'inicio')::time) at time zone 'America/Sao_Paulo') into v_inicio_corte
  from jsonb_array_elements(v_snapshot) with ordinality as e(v, ord)
  where e.v->>'id' = p_a_partir_periodo;
  if v_inicio_corte <= now() then
    raise exception 'ESCALA_CORTE_NO_PASSADO: o período % de % já começou — períodos iniciados são imutáveis (corte recusado)', p_a_partir_periodo, p_a_partir_data;
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
    elsif v_data = p_a_partir_data and coalesce(v_corte, 0) <= 1 then
      -- o corte é o 1º período do dia: nenhum período dele começou (guarda 2b) — o dia inteiro deixou de existir
      delete from escala_producao_dias where data = v_data and previsao_id = p_previsao_id;
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

grant execute on function public.escala_aplicar_recalculo(uuid, jsonb, date, text, jsonb, uuid, uuid[], jsonb, date[]) to service_role;

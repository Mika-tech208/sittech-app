-- MODO MANUAL DE OPERAÇÃO (06/11/2026): a escala automática deixa de comandar o chão; o apontamento volta a ser manual.
-- ADITIVA e REVERSÍVEL: nenhuma tabela, plano, fechamento, histórico ou apontamento é tocado. O motor (corte-v1) permanece intacto e disponível para simulação.
--
-- CONCEITO: "operação manual" = as três flags que dão comando operacional à escala automática estão DESLIGADAS ao mesmo tempo:
--   producao_real_modo       (motor Escala Inteligente / corte-v1)           = 'desligado'
--   replanejamento_modo      (replanejamento oficial por eventos)            = 'desligado'
--   escala_fechamento_fisico_modo (fechamento físico + liberação de período) = 'desligado'
-- Não existe flag nova: a função abaixo só LÊ as três existentes. Meia desativação (qualquer uma ligada) => NÃO é manual => comportamento anterior preservado.
--
-- Cinco pontos centrais mudam (todos desviam só quando escala_operacao_manual()):
--  1) escala_registrar_evento: ponto único que enfileira eventos de recálculo (ausência, previsão, cadastro, WIP, parâmetros...). No modo manual não enfileira.
--  2) escala_agendador_chamar: ponto único dos 30 jobs do pg_cron (pre/pos período). No modo manual não faz a chamada HTTP.
--  3) produto_unico_trg_bloqueia_planejamento: o PLANEJAMENTO do produto único (semana 09/11) NÃO bloqueia o APONTAMENTO manual. O bloqueio do FECHAMENTO físico permanece.
--  4) escala_periodo_liberacao: no modo manual NENHUM período é liberado pela escala (motivo MODO_MANUAL) => TV neutra, e o PLANEJAMENTO não bloqueia o apontamento.
--  5) escala_aplicar_recalculo: última linha de defesa — a RPC que grava plano recusa (ESCALA_AUTOMATICA_DESATIVADA) no modo manual, SEM exceção (nem semana em PLANEJAMENTO).

create or replace function public.escala_operacao_manual()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.escala_producao_real_modo() = 'desligado'
     and public.escala_replanejamento_modo() = 'desligado'
     and public.escala_fechamento_fisico_modo() = 'desligado';
$$;
comment on function public.escala_operacao_manual() is 'true quando producao_real_modo, replanejamento_modo e escala_fechamento_fisico_modo estão TODOS desligados: a escala automática não comanda o chão e o apontamento é manual.';
revoke all on function public.escala_operacao_manual() from public;
grant execute on function public.escala_operacao_manual() to authenticated, service_role;

-- 1) enfileiramento central de eventos
create or replace function public.escala_registrar_evento(p_tipo text, p_previsao_id uuid, p_payload jsonb default '{}'::jsonb, p_usuario_id uuid default null::uuid)
returns uuid language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_id uuid;
begin
  if p_tipo not in ('ausencia', 'previsao', 'recurso_bloqueado', 'recurso_liberado', 'geracao_manual', 'geracao_semanal') then
    raise exception 'ESCALA_TIPO_EVENTO_INVALIDO: %', p_tipo;
  end if;
  -- MODO MANUAL: nada recalcula nem publica escala a partir de ausência, previsão, cadastro, WIP ou parâmetros
  if public.escala_operacao_manual() then
    return null;
  end if;

  -- deduplica pendente do mesmo tipo/previsão (geração semanal: também pela semana)
  select id into v_id
  from escala_producao_eventos
  where status = 'pendente' and tipo = p_tipo and previsao_id is not distinct from p_previsao_id
    and (p_tipo <> 'geracao_semanal' or payload->>'semanaInicio' = p_payload->>'semanaInicio')
  limit 1;
  if found then
    return v_id;
  end if;

  insert into escala_producao_eventos (tipo, previsao_id, payload, usuario_id)
  values (p_tipo, p_previsao_id, coalesce(p_payload, '{}'::jsonb), p_usuario_id)
  returning id into v_id;
  return v_id;
end;
$function$;

-- 2) agendador (pg_cron): sem chamada HTTP no modo manual
create or replace function public.escala_agendador_chamar(p_origem text default 'pg_cron'::text)
returns bigint language plpgsql security definer set search_path to 'public', 'vault', 'extensions', 'pg_temp' as $function$
declare
  v_url text;
  v_token text;
  v_id bigint;
begin
  if public.escala_operacao_manual() then
    return null;      -- MODO MANUAL: o agendador não aciona o motor
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'escala_agendador_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'escala_agendador_token';
  if v_url is null or v_token is null then
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
    body := jsonb_build_object('origem', p_origem),
    timeout_milliseconds := 55000
  ) into v_id;
  return v_id;
end;
$function$;

-- 3) PLANEJAMENTO do produto único não bloqueia o apontamento manual (o do FECHAMENTO continua bloqueado)
create or replace function public.produto_unico_trg_bloqueia_planejamento()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if tg_table_name = 'apontamentos_producao' then
    if public.escala_operacao_manual() then return new; end if;   -- MODO MANUAL: o plano futuro não interfere no chão
    if public.produto_unico_modo(new.data) = 'PLANEJAMENTO' then
      raise exception 'APONTAMENTO_SEMANA_EM_PLANEJAMENTO: a semana de % está em PLANEJAMENTO do produto único (plano futuro, não liberado); apontamento só depois do cutover', new.data using errcode = 'P0001';
    end if;
  else
    if public.produto_unico_modo(new.data) = 'PLANEJAMENTO' then
      raise exception 'FECHAMENTO_SEMANA_EM_PLANEJAMENTO: a semana de % está em PLANEJAMENTO do produto único (plano futuro, não liberado); fechamento físico só depois do cutover', new.data using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;

-- 4) liberação de período: PLANEJAMENTO só tem precedência quando a escala automática comanda o chão
create or replace function public.escala_periodo_liberacao(p_data date, p_periodo text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_modo text := public.escala_fechamento_fisico_modo();
  v_desde jsonb := coalesce((select valor from public.escala_parametros where chave = 'escala_liberacao_desde'), '{"data":"2026-11-04","periodo":"m3"}'::jsonb);
  v_desde_data date := (v_desde ->> 'data')::date;
  v_slot record; v_ant record; v_dinicio text; v_e record; v_conf timestamptz; v_pred jsonb; v_vinc record; v_atual integer;
begin
  -- MODO MANUAL: NENHUM período é "liberado pela escala" (a TV e a grade de gestão não exibem programação como ordem de trabalho).
  -- O apontamento NÃO usa esta função no modo manual (fluxo legado): independe de plano, fechamento e planejamento futuro.
  if public.escala_operacao_manual() then
    return jsonb_build_object('liberado', false, 'motivo', 'MODO_MANUAL');
  end if;
  -- PLANEJAMENTO (produto único, semana >= planejamento_desde e < cutover): o plano é FUTURO e NÃO LIBERADO. PRECEDÊNCIA ABSOLUTA sobre qualquer outra regra
  -- (modo do fechamento, transição/escala_liberacao_desde, vínculo explícito, VIRADA_SEMANA): nenhum período de dia em planejamento é entregue à TV, à Produção Real nem ao apontamento.
  if public.produto_unico_modo(p_data) = 'PLANEJAMENTO' then
    return jsonb_build_object('liberado', false, 'motivo', 'PLANO_FUTURO_AGUARDANDO_CUTOVER', 'modo_produto_unico', 'PLANEJAMENTO');
  end if;
  if v_modo <> 'ativo' then return jsonb_build_object('liberado', true, 'motivo', 'MODO_NAO_ATIVO'); end if;
  select * into v_slot from public.escala_liberacao_slots(p_data) s where s.data = p_data and s.pid = p_periodo;
  if not found then return jsonb_build_object('liberado', false, 'motivo', 'PERIODO_DESCONHECIDO'); end if;
  if p_data < v_desde_data then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  if p_data = v_desde_data then
    select s.inicio into v_dinicio from public.escala_liberacao_slots(p_data) s where s.data = v_desde_data and s.pid = v_desde ->> 'periodo';
    if v_dinicio is not null and v_slot.inicio < v_dinicio then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  end if;
  select * into v_ant from public.escala_liberacao_slots(p_data) s where (s.data, s.inicio) < (p_data, v_slot.inicio) order by s.data desc, s.inicio desc limit 1;
  if not found then return jsonb_build_object('liberado', true, 'motivo', 'TRANSICAO'); end if;
  v_pred := jsonb_build_object('data', v_ant.data, 'periodo', v_ant.pid, 'rotulo', v_ant.nome);
  select * into v_e from public.escala_fechamento_estado e where e.data = v_ant.data and e.periodo_id = v_ant.pid and not e.sombra;
  if not found then return jsonb_build_object('liberado', false, 'motivo', 'AGUARDANDO_FECHAMENTO', 'predecessor', v_pred); end if;
  if v_e.estado = 'ERRO_RECALCULO' then return jsonb_build_object('liberado', false, 'motivo', 'ERRO_RECALCULO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  if v_e.estado <> 'CONFIRMADO' then return jsonb_build_object('liberado', false, 'motivo', 'RECALCULANDO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  select l.em into v_conf from public.escala_fechamento_log l where l.fechamento_id = v_e.fechamento_id and l.estado = 'CONFIRMADO' order by l.seq desc limit 1;
  -- vínculo EXPLÍCITO fechamento → plano do dia do período
  select * into v_vinc from public.escala_fechamento_plano v where v.fechamento_id = v_e.fechamento_id and v.data = p_data;
  if not found then
    -- VIRADA DE SEMANA (T3 de sexta → M1 da semana seguinte): o fechamento não gera o plano da semana nova (outra Previsão); esse plano nasce na geração semanal.
    -- Única exceção ao vínculo explícito, restrita a este caso: o dia do período pertence a OUTRA Previsão E o plano dele foi gravado DEPOIS do fechamento confirmado
    -- (a geração semanal lê o inventário físico vigente). Marcado 'VIRADA_SEMANA' para auditoria. Dentro da mesma semana esta exceção NÃO existe.
    if (select d.previsao_id from public.escala_producao_dias d where d.data = p_data) is distinct from (select d.previsao_id from public.escala_producao_dias d where d.data = v_ant.data)
       and exists (select 1 from public.escala_producao_dias d where d.data = p_data and d.atualizado_em >= v_e.fechado_em) then
      return jsonb_build_object('liberado', true, 'motivo', 'CONFIRMADO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id, 'vinculo', 'VIRADA_SEMANA', 'confirmado_em', v_conf, 'excecao', v_e.excecao);
    end if;
    return jsonb_build_object('liberado', false, 'motivo', 'CONFIRMADO_SEM_PLANO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id);
  end if;
  select d.versao into v_atual from public.escala_producao_dias d where d.data = p_data;
  if v_atual is null or v_atual < v_vinc.versao then return jsonb_build_object('liberado', false, 'motivo', 'PLANO_DIVERGENTE', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id); end if;
  return jsonb_build_object('liberado', true, 'motivo', 'CONFIRMADO', 'predecessor', v_pred, 'fechamento_id', v_e.fechamento_id, 'hash_plano', v_vinc.hash_plano,
                            'plano_versao', v_vinc.versao, 'vinculo', v_vinc.metodo, 'confirmado_em', v_conf, 'excecao', v_e.excecao);
end;
$function$;

-- 5) última linha de defesa: gravação de plano
CREATE OR REPLACE FUNCTION public.escala_aplicar_recalculo(p_previsao_id uuid, p_dias jsonb, p_a_partir_data date, p_a_partir_periodo text, p_alocacoes jsonb, p_usuario_id uuid, p_evento_ids uuid[], p_resumo jsonb, p_remover_dias date[] DEFAULT '{}'::date[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- MODO MANUAL: nenhuma escala automática é gravada, em semana nenhuma (última linha de defesa; o funil TS já ignora antes).
  if public.escala_operacao_manual() then
    raise exception 'ESCALA_AUTOMATICA_DESATIVADA: modo manual — a escala automática não grava programação';
  end if;
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
  if v_inicio_corte <= now() and not public.escala_fechamento_corte_liberado(p_a_partir_data, p_a_partir_periodo) then
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

  -- 5) grava as novas alocações (as unicidades do banco são a barreira final). `distribuicao` (linha compartilhada entre produtos) só entra com posto; ausente = NULL
  insert into escala_producao_alocacoes (
    data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id,
    pecas, pecas_adicional, tipo_adicional, origem, excecao_revezamento, motivo_excecao, motivo_sem_posto, distribuicao
  )
  select x.data, x.periodo_id, x.funcionario_id, x.maquina_id, x.produto_id, x.etapa_id, x.operacao_id,
         coalesce(x.pecas, 0), coalesce(x.pecas_adicional, 0), case when coalesce(x.pecas_adicional, 0) > 0 then x.tipo_adicional else null end, coalesce(x.origem, 'auto'), coalesce(x.excecao_revezamento, false), x.motivo_excecao, x.motivo_sem_posto,
         case when x.maquina_id is not null and jsonb_typeof(x.distribuicao) = 'array' and jsonb_array_length(x.distribuicao) > 0 then x.distribuicao else null end
  from jsonb_to_recordset(coalesce(p_alocacoes, '[]'::jsonb)) as x(
    data date, periodo_id text, funcionario_id uuid, maquina_id uuid, produto_id uuid, etapa_id uuid, operacao_id uuid,
    pecas numeric, pecas_adicional numeric, tipo_adicional text, origem text, excecao_revezamento boolean, motivo_excecao text, motivo_sem_posto text, distribuicao jsonb
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
$function$;

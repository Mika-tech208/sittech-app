-- Sittech — LINHAS COMPARTILHADAS (item 7, 02/11/2026): ALOCACAO_FISICA × DISTRIBUICAO_DA_QUANTIDADE_POR_PRODUTO.
--
-- Problema: Etiquetadora 15 / Embalagem 17 recebem Conector 3/4 Convencional E Automática no mesmo período. A linha da alocação (PK data, período, funcionário; índice único data, período, máquina)
-- carrega UM produto_id e UMA `pecas`: a quantidade da Automática aparecia como Convencional (WIP, realizado por produto, cobertura, demanda restante e diagnóstico de cadeia ficavam errados).
--
-- Solução (menor risco): coluna jsonb OPCIONAL `distribuicao` na MESMA linha — [{produto_id, etapa_id, pecas}]. A máquina e a pessoa continuam únicas (nenhuma PK/índice muda); `produto_id/etapa_id/pecas`
-- da linha seguem preenchidos (produto de MAIOR quantidade e soma), então TUDO que só lê a linha continua funcionando exatamente como antes. Quem atribui quantidade a produto lê `distribuicao`.
-- Linha de um só produto: distribuicao = NULL (comportamento idêntico ao anterior; nada é escrito).
--
-- INERTE: nada grava `distribuicao` até o planejador de corte ser ativado numa semana (producao_real_planejador_semanas, padrão []). Aditiva e retrocompatível:
--   • coluna nullable; CHECK `not valid` (só linhas novas/alteradas; as existentes têm NULL);
--   • escala_aplicar_recalculo / escala_trocar_alocacoes: definições VIGENTES + a coluna (a troca de pessoas leva a distribuição junto com o posto);
--   • escala_plano_registrar: o hash do plano cobre a distribuição SÓ quando existe (13º elemento do array; leitores posicionais 0..11 intactos) ⇒ o hash de qualquer plano sem linha compartilhada é byte-idêntico;
--   • escala_alocacoes_por_produto(previsão): visão POR PRODUTO (linha compartilhada expandida) para consultas/relatórios;
--   • chaves producao_real_planejador_semanas ([]) e producao_real_planejador_config ({}) — inseridas com os gatilhos desligados (não disparam recálculo).
-- Ordem de uso: migration → código (flags OFF = comportamento idêntico) → configuração da semana.
-- Reversão: supabase/rollbacks/20261106100000_rollback_distribuicao.sql (NÃO é migration: executar à mão; restaura as 3 definições e remove coluna/chaves se nenhuma linha usa distribuição).
-- Cache de esquema do PostgREST: o `notify pgrst, 'reload schema'` ao fim desta migration recarrega o cache no commit (a coluna nova passa a aparecer na API).

-- =========================================================================
-- 1) Coluna + validação (mesmas regras de src/features/escala/distribuicao.ts#validarDistribuicao)
-- =========================================================================
alter table public.escala_producao_alocacoes add column if not exists distribuicao jsonb;

create or replace function public.escala_distribuicao_valida(p_pecas numeric, p_maquina uuid, p_produto uuid, p_etapa uuid, p_dist jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  e jsonb;
  v_soma numeric := 0;
  v_max numeric := -1;
  v_dom_ok boolean := false;
  v_chaves text[] := '{}';
  v_k text;
  v_q numeric;
begin
  if p_dist is null then
    return true;
  end if;
  if p_maquina is null or jsonb_typeof(p_dist) <> 'array' or jsonb_array_length(p_dist) = 0 then
    return false; -- sem posto não há distribuição; array vazio não é distribuição
  end if;
  for e in select * from jsonb_array_elements(p_dist) loop
    if jsonb_typeof(e) <> 'object' or (e->>'produto_id') is null or (e->>'etapa_id') is null or (e->>'pecas') is null then
      return false;
    end if;
    v_q := (e->>'pecas')::numeric;
    if v_q <= 0 then
      return false;
    end if;
    v_k := (e->>'produto_id') || '|' || (e->>'etapa_id');
    if v_k = any(v_chaves) then
      return false; -- produto|etapa repetido
    end if;
    v_chaves := v_chaves || v_k;
    v_soma := v_soma + v_q;
    if v_q > v_max then v_max := v_q; end if;
  end loop;
  if abs(v_soma - coalesce(p_pecas, 0)) > 0.001 then
    return false; -- a soma tem que ser a `pecas` da linha
  end if;
  for e in select * from jsonb_array_elements(p_dist) loop
    if (e->>'produto_id') = p_produto::text and (e->>'etapa_id') = p_etapa::text and (e->>'pecas')::numeric >= v_max - 0.000001 then
      v_dom_ok := true; -- o produto da linha é (um d)o de maior quantidade
    end if;
  end loop;
  return v_dom_ok;
exception when others then
  return false;
end;
$$;

alter table public.escala_producao_alocacoes drop constraint if exists escala_alocacao_distribuicao_ck;
alter table public.escala_producao_alocacoes add constraint escala_alocacao_distribuicao_ck
  check (distribuicao is null or public.escala_distribuicao_valida(pecas, maquina_id, produto_id, etapa_id, distribuicao)) not valid;

-- =========================================================================
-- 2) Visão POR PRODUTO (linha compartilhada expandida). Consumidores SQL que atribuem quantidade a produto devem usar esta função, não produto_id/pecas da linha crua.
-- =========================================================================
create or replace function public.escala_alocacoes_por_produto(p_previsao uuid)
returns table (data date, periodo_id text, funcionario_id uuid, maquina_id uuid, produto_id uuid, etapa_id uuid, operacao_id uuid, pecas numeric, compartilhada boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select a.data, a.periodo_id, a.funcionario_id, a.maquina_id, a.produto_id, a.etapa_id, a.operacao_id, a.pecas, false
    from public.escala_producao_alocacoes a join public.escala_producao_dias d on d.data = a.data
   where d.previsao_id = p_previsao and a.distribuicao is null
  union all
  select a.data, a.periodo_id, a.funcionario_id, a.maquina_id, (x->>'produto_id')::uuid, (x->>'etapa_id')::uuid, a.operacao_id, (x->>'pecas')::numeric, true
    from public.escala_producao_alocacoes a join public.escala_producao_dias d on d.data = a.data,
         jsonb_array_elements(a.distribuicao) x
   where d.previsao_id = p_previsao and a.distribuicao is not null;
$$;
revoke all on function public.escala_alocacoes_por_produto(uuid) from public, anon;
grant execute on function public.escala_alocacoes_por_produto(uuid) to authenticated, service_role;

-- =========================================================================
-- 3) Chaves do planejador de corte (inertes: nenhuma semana ativada). Sem disparar recálculo na semeadura.
-- =========================================================================
alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
alter table public.escala_parametros disable trigger trg_escala_plano_versao;
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('producao_real_planejador_semanas', '[]'::jsonb, 'operacional', 'Planejador de corte: semanas (segunda-feira ISO) cujo recálculo é feito pelo planejador de corte (cadeia/lote/WIP/pessoas/revezamento) em vez do motor legado. Exige producao_real_modo = ativo e a semana em producao_real_semanas_ativas. [] = nenhuma (padrão)'),
  ('producao_real_planejador_config', '{}'::jsonb, 'tecnico', 'Planejador de corte: configuração (objetivo, margemPorPeca por produto — snapshot congelado, coberturaMinima, busca). {} = padrões do código')
on conflict (chave) do nothing;
alter table public.escala_parametros enable trigger trg_escala_plano_versao;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

alter table public.escala_parametros drop constraint if exists escala_parametros_planejador_semanas;
alter table public.escala_parametros add constraint escala_parametros_planejador_semanas
  check (chave <> 'producao_real_planejador_semanas' or public.escala_producao_real_semanas_validas(valor));
alter table public.escala_parametros drop constraint if exists escala_parametros_planejador_config;
alter table public.escala_parametros add constraint escala_parametros_planejador_config
  check (chave <> 'producao_real_planejador_config' or jsonb_typeof(valor) = 'object');

-- =========================================================================
-- 4) Funções VIGENTES + distribuicao
-- =========================================================================

-- 4a) escala_aplicar_recalculo (vigente: 20261105130000) + distribuicao
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
$$;

grant execute on function public.escala_aplicar_recalculo(uuid, jsonb, date, text, jsonb, uuid, uuid[], jsonb, date[]) to service_role;

-- 4b) escala_trocar_alocacoes (vigente: 20261105210000) + distribuicao acompanha o posto
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
  v_escopo text := coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'revezamento_escopo'), 'consecutivo');
  v_bloco text := left(p_periodo_id, 1);
  v_ant_a integer;
  v_ant_b integer;
  v_ponte boolean := public.escala_ponte_m3_t1_ativa();
  v_dep_a integer;
  v_dep_b integer;
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

  -- ESCOPO BLOCO: repetições JÁ existentes no bloco (plano antigo) — a troca só é bloqueada se AUMENTAR as repetições de alguma das duas pessoas
  if v_escopo = 'bloco' then
    v_ant_a := public.escala_repeticoes_bloco(p_data, p_funcionario_a, v_bloco) + case when v_ponte then public.escala_repeticoes_ponte(p_data, p_funcionario_a) else 0 end;
    v_ant_b := public.escala_repeticoes_bloco(p_data, p_funcionario_b, v_bloco) + case when v_ponte then public.escala_repeticoes_ponte(p_data, p_funcionario_b) else 0 end;
  end if;

  -- estaciona A para não violar a unicidade (data, período, máquina) durante a troca
  update escala_producao_alocacoes
     set maquina_id = null, produto_id = null, etapa_id = null, operacao_id = null, pecas = 0, pecas_adicional = 0, tipo_adicional = null, distribuicao = null, motivo_sem_posto = '__troca__', excecao_revezamento = false, motivo_excecao = null
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_a;

  update escala_producao_alocacoes
     set maquina_id = v_a.maquina_id, produto_id = v_a.produto_id, etapa_id = v_a.etapa_id, operacao_id = v_a.operacao_id, pecas = v_a.pecas, pecas_adicional = v_a.pecas_adicional, tipo_adicional = v_a.tipo_adicional, distribuicao = v_a.distribuicao,
         motivo_sem_posto = case when v_a.maquina_id is null then coalesce(v_a.motivo_sem_posto, 'Alteração manual') else null end,
         origem = 'manual'
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_b;

  update escala_producao_alocacoes
     set maquina_id = v_b.maquina_id, produto_id = v_b.produto_id, etapa_id = v_b.etapa_id, operacao_id = v_b.operacao_id, pecas = v_b.pecas, pecas_adicional = v_b.pecas_adicional, tipo_adicional = v_b.tipo_adicional, distribuicao = v_b.distribuicao,
         motivo_sem_posto = case when v_b.maquina_id is null then coalesce(v_b.motivo_sem_posto, 'Alteração manual') else null end,
         origem = 'manual'
   where data = p_data and periodo_id = p_periodo_id and funcionario_id = p_funcionario_a;

  -- REVEZAMENTO DURO: a mesma pessoa NUNCA repete a operação — nem por troca manual. Sem exceção, sem motivo que libere, sem bypass administrativo.
  -- A exceção desfaz a troca inteira (a transação é revertida).
  if v_escopo = 'bloco' then
    -- ESCOPO BLOCO (hotfix 28/10): a mesma operação (ou equivalente) no máximo 1 vez por MANHÃ (m1-m3) e por TARDE (t1-t3). A exposição zera entre manhã e tarde e no dia seguinte.
    v_dep_a := public.escala_repeticoes_bloco(p_data, p_funcionario_a, v_bloco) + case when v_ponte then public.escala_repeticoes_ponte(p_data, p_funcionario_a) else 0 end;
    v_dep_b := public.escala_repeticoes_bloco(p_data, p_funcionario_b, v_bloco) + case when v_ponte then public.escala_repeticoes_ponte(p_data, p_funcionario_b) else 0 end;
    if v_dep_a > v_ant_a or v_dep_b > v_ant_b then
      raise exception 'ESCALA_ROTACAO_VIOLADA: %', case when v_ponte
        then 'Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação na mesma manhã, na mesma tarde ou do último período da manhã para o primeiro da tarde.'
        else 'Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação na mesma manhã ou na mesma tarde.' end;
    end if;
    -- recalcula a marca de exceção dos dois funcionários no bloco trocado (linha que repete operação já executada antes, no mesmo bloco)
    update escala_producao_alocacoes a
       set excecao_revezamento = public.escala_linha_repete_no_bloco(a.data, a.funcionario_id, a.periodo_id),
           motivo_excecao = case when public.escala_linha_repete_no_bloco(a.data, a.funcionario_id, a.periodo_id) then 'Alteração manual: mesma operação já executada neste bloco (manhã/tarde)' else null end
     where a.data = p_data and a.funcionario_id in (p_funcionario_a, p_funcionario_b) and (left(a.periodo_id, 1) = v_bloco or (v_ponte and left(a.periodo_id, 1) = 't'));
  else
  -- REVEZAMENTO DURO (Fase 4a): a mesma pessoa NUNCA executa a mesma operação em períodos consecutivos do mesmo dia — nem por troca manual.
  -- Sem exceção, sem motivo que libere, sem bypass administrativo. Confere só os pares que envolvem o período trocado, nos dois funcionários;
  -- a exceção desfaz a troca inteira (a transação é revertida).
  if exists (
    with linhas as (
      select a.funcionario_id, a.operacao_id, a.maquina_id,
             (select ord::integer from jsonb_array_elements(v_dia.periodos_snapshot) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id) as idx
      from escala_producao_alocacoes a
      where a.data = p_data and a.funcionario_id in (p_funcionario_a, p_funcionario_b)
    ), comparado as (
      select l.*, lag(l.operacao_id) over w as op_ant, lag(l.maquina_id) over w as maq_ant, lag(l.idx) over w as idx_ant
      from linhas l
      window w as (partition by l.funcionario_id order by l.idx)
    )
    select 1 from comparado c
     where c.idx in (v_idx, v_idx + 1)
       and c.maquina_id is not null and c.maq_ant is not null and c.idx_ant = c.idx - 1 and c.operacao_id = c.op_ant
  ) then
    raise exception 'ESCALA_ROTACAO_VIOLADA: Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação em períodos consecutivos.';
  end if;

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
  end if;

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

revoke all on function public.escala_trocar_alocacoes(date, text, uuid, uuid, text) from public, anon;
grant execute on function public.escala_trocar_alocacoes(date, text, uuid, uuid, text) to authenticated;

-- 4c) escala_plano_registrar (vigente: 20261025110000) + distribuicao no hash (só quando existe)
create or replace function public.escala_plano_registrar(p_previsao uuid, p_origem text default 'trigger')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_semana date;
  v_linhas jsonb;
  v_dias jsonb;
  v_entrada jsonb;
  v_hash text;
  v_ultimo text;
  v_id uuid;
begin
  select semana_inicio into v_semana from public.previsoes where id = p_previsao;
  if v_semana is null or not public.escala_semana_tem_escala(p_previsao) then
    return null;
  end if;
  if p_origem = 'trigger' and exists (select 1 from public.escala_plano_versoes where previsao_id = p_previsao and txid = txid_current()) then
    return null; -- já registrada nesta transação (o gatilho adiado roda uma vez por linha, no commit)
  end if;
  select coalesce(jsonb_agg(
           jsonb_build_array(
             a.data::text, a.periodo_id, a.funcionario_id, a.maquina_id, a.produto_id, a.etapa_id, a.operacao_id, a.pecas, coalesce(a.pecas_adicional, 0), a.tipo_adicional, a.motivo_sem_posto,
             case when a.origem = 'manual' then 'm' else 'a' end
           ) || case when a.distribuicao is null then '[]'::jsonb else jsonb_build_array(a.distribuicao) end  -- 13º elemento SÓ em linha compartilhada: leitores posicionais (0..11) não mudam
           order by a.data, a.periodo_id, a.funcionario_id), '[]'::jsonb)
    into v_linhas
    from public.escala_producao_alocacoes a join public.escala_producao_dias d on d.data = a.data
   where d.previsao_id = p_previsao;
  select coalesce(jsonb_agg(jsonb_build_object('data', data::text, 'versao', versao, 'periodos_snapshot', periodos_snapshot) order by data), '[]'::jsonb)
    into v_dias from public.escala_producao_dias where previsao_id = p_previsao;
  v_entrada := public.escala_plano_entrada(p_previsao);
  v_hash := encode(sha256(convert_to(v_linhas::text || '|' || (select coalesce(jsonb_agg(periodos_snapshot order by data), '[]'::jsonb)::text from public.escala_producao_dias where previsao_id = p_previsao) || '|' || v_entrada::text, 'UTF8')), 'hex');
  select hash_plano into v_ultimo from public.escala_plano_versoes where previsao_id = p_previsao order by valido_desde desc, criado_em desc limit 1;
  if v_ultimo = v_hash then
    return null; -- nada mudou de fato
  end if;
  insert into public.escala_plano_versoes (previsao_id, semana_inicio, valido_desde, txid, origem, hash_plano, dias, linhas, entrada)
  values (p_previsao, v_semana, clock_timestamp(), txid_current(), p_origem, v_hash, v_dias, v_linhas, v_entrada)
  returning id into v_id;
  return v_id;
end;
$$;

-- 5) recarrega o cache de esquema do PostgREST (entregue no COMMIT): a coluna `distribuicao` passa a ser visível na API REST
notify pgrst, 'reload schema';

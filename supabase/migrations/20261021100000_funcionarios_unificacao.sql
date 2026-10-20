-- Exclusão / unificação CONTROLADA de funcionários (somente administrador).
--
-- Antes: o navegador fazia DELETE direto em `funcionarios` e o banco recusava por FK (RESTRICT em
-- apontamentos, ausências, equipe da semana, Escala e ocorrências), sem explicar o motivo.
-- Agora: o DELETE direto deixa de existir para usuários autenticados; tudo passa por funções de
-- backend que (1) simulam sem gravar, (2) executam numa única transação com rollback automático e
-- (3) só removem o cadastro depois de provar que não sobrou nenhuma referência (nunca CASCADE em
-- histórico operacional).
--
-- Regras (decididas pelo dono do produto):
--  - só ADMINISTRADOR executa (a permissão "funcionarios" NÃO basta);
--  - funcionário com apontamentos_producao (ou ocorrências de máquina) NUNCA é excluído sem
--    unificação: é obrigatório escolher outro funcionário para receber o histórico;
--  - equipe da semana em conflito: produtivo final = TRUE se qualquer um dos dois era produtivo;
--  - custos extras: equivalentes (mesma descrição sem caixa/espaços e mesmo valor) são descartados
--    como duplicata; diferentes exigem decisão explícita ("copiar" ou "descartar");
--  - sem função automática de desfazer: o registro `funcionarios_exclusoes_log` guarda o snapshot
--    e os ids alterados (junto com o backup completo).

-- =========================================================================
-- 1) Registro de exclusões/unificações
-- =========================================================================
create table if not exists public.funcionarios_exclusoes_log (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  executado_por uuid references public.usuarios(id) on delete set null,
  modo text not null check (modo in ('exclusao', 'unificacao')),
  funcionario_excluido_id uuid not null,   -- sem FK: o cadastro deixa de existir
  funcionario_mantido_id uuid,             -- sem FK de propósito (registro histórico)
  snapshot jsonb not null,                 -- cadastro + custos extras do excluído
  plano jsonb not null,                    -- o que a simulação mostrou e o usuário confirmou
  movidos jsonb not null default '{}'::jsonb,      -- ids transferidos, por tabela
  descartados jsonb not null default '{}'::jsonb   -- linhas removidas/consolidadas (conteúdo completo)
);
alter table public.funcionarios_exclusoes_log enable row level security;
drop policy if exists funcionarios_exclusoes_log_select on public.funcionarios_exclusoes_log;
create policy funcionarios_exclusoes_log_select on public.funcionarios_exclusoes_log
  for select to authenticated using (public.is_admin());
revoke all on public.funcionarios_exclusoes_log from anon, authenticated;
grant select on public.funcionarios_exclusoes_log to authenticated;

-- =========================================================================
-- 2) DELETE direto em `funcionarios` deixa de existir para o navegador
--    (a policy única FOR ALL vira SELECT/INSERT/UPDATE; sem policy de DELETE o RLS nega).
-- =========================================================================
drop policy if exists funcionarios_admin_ou_permissao on public.funcionarios;
drop policy if exists funcionarios_select_admin_ou_permissao on public.funcionarios;
create policy funcionarios_select_admin_ou_permissao on public.funcionarios
  for select using (public.is_admin() or public.has_permissao('funcionarios') or public.has_permissao('custo_hora'));
drop policy if exists funcionarios_insert_admin_ou_permissao on public.funcionarios;
create policy funcionarios_insert_admin_ou_permissao on public.funcionarios
  for insert with check (public.is_admin() or public.has_permissao('funcionarios') or public.has_permissao('custo_hora'));
drop policy if exists funcionarios_update_admin_ou_permissao on public.funcionarios;
create policy funcionarios_update_admin_ou_permissao on public.funcionarios
  for update using (public.is_admin() or public.has_permissao('funcionarios') or public.has_permissao('custo_hora'))
  with check (public.is_admin() or public.has_permissao('funcionarios') or public.has_permissao('custo_hora'));

-- =========================================================================
-- 3) Núcleo: simula (p_executar = false, NÃO grava nada) ou executa (true, uma transação)
-- =========================================================================
create or replace function public._funcionario_exclusao(
  p_excluido uuid,
  p_mantido uuid,          -- null = exclusão simples (sem unificação)
  p_decisoes jsonb,        -- { "<custo_id>": "copiar" | "descartar" }
  p_executar boolean,
  p_assinatura text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agora timestamptz := now();
  v_modo text := case when p_mantido is null then 'exclusao' else 'unificacao' end;
  v_usuario uuid;
  v_ex record;
  v_mt record;
  r record;
  v_prev uuid;
  v_k uuid;
  v_n bigint;

  v_bloq jsonb := '[]'::jsonb;
  v_pend jsonb := '[]'::jsonb;
  v_aviso jsonb := '[]'::jsonb;

  -- apontamentos / ocorrências
  v_ap_n bigint; v_oc_n bigint; v_sobrep jsonb;
  -- ausências
  v_aus_mover uuid[] := '{}'; v_aus_cons uuid[] := '{}'; v_aus_conf jsonb := '[]'::jsonb; v_aus_total bigint;
  -- equipe da semana
  v_eq_mover jsonb := '[]'::jsonb; v_eq_conf jsonb := '[]'::jsonb; v_eq_total bigint;
  -- alocações da Escala
  v_al_mover jsonb := '[]'::jsonb; v_al_cons jsonb := '[]'::jsonb; v_al_fut jsonb := '[]'::jsonb; v_al_hist jsonb := '[]'::jsonb;
  v_prev_afetadas uuid[] := '{}';
  -- custos
  v_c_dup jsonb := '[]'::jsonb; v_c_copiar jsonb := '[]'::jsonb; v_c_desc jsonb := '[]'::jsonb; v_c_rem jsonb := '[]'::jsonb;
  v_c_usados uuid[] := '{}'; v_dec text;

  v_impacto jsonb;
  v_plano jsonb;
  v_ass text;

  -- execução
  v_ap_antes record; v_ap_depois record;
  v_snap jsonb;
  v_movidos jsonb := '{}'::jsonb;
  v_descartados jsonb := '{}'::jsonb;
  v_ids jsonb;
  v_log uuid;
begin
  if not public.is_admin() then
    raise exception 'FUNC_SOMENTE_ADMIN: somente administrador pode excluir ou unificar funcionários';
  end if;
  v_usuario := public.escala_usuario_atual();
  p_decisoes := coalesce(p_decisoes, '{}'::jsonb);

  select id, nome, ativo, created_at into v_ex from funcionarios where id = p_excluido;
  if not found then raise exception 'FUNC_NAO_ENCONTRADO: o funcionário a excluir não existe'; end if;
  -- v_mt é sempre atribuído (sem linha => campos nulos), assim nunca é lido "não atribuído" na exclusão simples
  select id, nome, ativo, created_at into v_mt from funcionarios where id = p_mantido;
  if p_mantido is not null then
    if p_mantido = p_excluido then raise exception 'FUNC_MESMO_REGISTRO: escolha OUTRO funcionário para receber o histórico'; end if;
    if v_mt.id is null then raise exception 'FUNC_DESTINO_NAO_ENCONTRADO: o funcionário que será mantido não existe'; end if;
  end if;

  -- decisões inválidas são recusadas (nada de valor desconhecido passando em silêncio)
  for r in select key, value from jsonb_each_text(p_decisoes) loop
    if r.value not in ('copiar', 'descartar') then
      raise exception 'FUNC_DECISAO_INVALIDA: decisão "%" inválida para o custo %', r.value, r.key;
    end if;
  end loop;

  if p_executar then
    -- trava os dois cadastros e as semanas de Escala afetadas (mesmo lock do recálculo da Escala)
    perform 1 from funcionarios where id in (p_excluido, coalesce(p_mantido, p_excluido)) order by id for update;
    for v_prev in
      select distinct pid from (
        select previsao_id as pid from previsao_equipe_semana where funcionario_id in (p_excluido, coalesce(p_mantido, p_excluido))
        union
        select d.previsao_id from escala_producao_alocacoes a join escala_producao_dias d on d.data = a.data
         where a.funcionario_id in (p_excluido, coalesce(p_mantido, p_excluido))
      ) t order by pid
    loop
      perform pg_advisory_xact_lock(hashtextextended('escala:' || v_prev::text, 0));
    end loop;
  end if;

  -- ---------------- apontamentos e ocorrências ----------------
  select count(*) into v_ap_n from apontamentos_producao where funcionario_id = p_excluido;
  select count(*) into v_oc_n from ocorrencias_maquina where funcionario_id = p_excluido;
  v_sobrep := '[]'::jsonb;
  if v_modo = 'exclusao' then
    if v_ap_n > 0 then
      v_bloq := v_bloq || jsonb_build_array(jsonb_build_object('codigo', 'EXCLUSAO_COM_APONTAMENTOS',
        'mensagem', format('Este funcionário tem %s apontamento(s) de produção. Não é permitido excluir sem unificar: escolha outro funcionário para receber o histórico.', v_ap_n)));
    end if;
    if v_oc_n > 0 then
      v_bloq := v_bloq || jsonb_build_array(jsonb_build_object('codigo', 'EXCLUSAO_COM_OCORRENCIAS',
        'mensagem', format('Este funcionário tem %s ocorrência(s) de máquina. Escolha outro funcionário para receber o histórico.', v_oc_n)));
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object('data', e.data, 'periodo_id', e.periodo_id) order by e.data, e.periodo_id), '[]'::jsonb)
      into v_sobrep
      from apontamentos_producao e
      join apontamentos_producao k on k.data = e.data and k.periodo_id = e.periodo_id and k.funcionario_id = p_mantido
     where e.funcionario_id = p_excluido;
    if jsonb_array_length(v_sobrep) > 0 then
      v_bloq := v_bloq || jsonb_build_array(jsonb_build_object('codigo', 'APONTAMENTO_SOBREPOSTO',
        'mensagem', 'Os dois funcionários têm apontamento no MESMO período. Corrija os apontamentos antes de unificar.', 'detalhe', v_sobrep));
    end if;
  end if;

  -- ---------------- ausências ----------------
  select count(*) into v_aus_total from ausencias_funcionarios where funcionario_id = p_excluido;
  if v_modo = 'unificacao' then
    for r in select * from ausencias_funcionarios where funcionario_id = p_excluido order by data, id loop
      if exists (select 1 from ausencias_funcionarios k
                  where k.funcionario_id = p_mantido and k.data = r.data and k.tipo = r.tipo
                    and k.horario_inicio is not distinct from r.horario_inicio and k.horario_fim is not distinct from r.horario_fim) then
        v_aus_cons := v_aus_cons || r.id;
      elsif public.existe_conflito_ausencia(p_mantido, r.data, r.tipo, r.horario_inicio, r.horario_fim) then
        v_aus_conf := v_aus_conf || jsonb_build_array(jsonb_build_object('data', r.data, 'tipo', r.tipo));
      else
        v_aus_mover := v_aus_mover || r.id;
      end if;
    end loop;
    if jsonb_array_length(v_aus_conf) > 0 then
      v_bloq := v_bloq || jsonb_build_array(jsonb_build_object('codigo', 'AUSENCIA_CONFLITANTE',
        'mensagem', 'Há ausências do funcionário excluído que conflitam com ausências do mantido (mesmo dia, não idênticas). Resolva antes de unificar.', 'detalhe', v_aus_conf));
    end if;
  end if;

  -- ---------------- equipe produtiva da semana ----------------
  select count(*) into v_eq_total from previsao_equipe_semana where funcionario_id = p_excluido;
  if v_modo = 'unificacao' then
    for r in
      select p.id as previsao_id, p.semana_inicio, e.produtivo as pe, k.produtivo as pk, (k.funcionario_id is not null) as kept_tem
        from previsao_equipe_semana e
        join previsoes p on p.id = e.previsao_id
        left join previsao_equipe_semana k on k.previsao_id = e.previsao_id and k.funcionario_id = p_mantido
       where e.funcionario_id = p_excluido
       order by p.semana_inicio
    loop
      v_prev_afetadas := v_prev_afetadas || r.previsao_id;
      if r.kept_tem then
        v_eq_conf := v_eq_conf || jsonb_build_array(jsonb_build_object(
          'semana_inicio', r.semana_inicio, 'previsao_id', r.previsao_id,
          'produtivo_excluido', r.pe, 'produtivo_mantido', r.pk, 'produtivo_final', (r.pe or r.pk), 'difere', (r.pe <> r.pk)));
      else
        v_eq_mover := v_eq_mover || jsonb_build_array(jsonb_build_object('semana_inicio', r.semana_inicio, 'previsao_id', r.previsao_id));
      end if;
    end loop;
  else
    for r in select p.id as previsao_id from previsao_equipe_semana e join previsoes p on p.id = e.previsao_id where e.funcionario_id = p_excluido loop
      v_prev_afetadas := v_prev_afetadas || r.previsao_id;
    end loop;
  end if;

  -- ---------------- Escala (alocações) ----------------
  -- congelado = período que já começou (mesmo critério do recálculo da Escala): vira histórico e
  -- é transferido; futuro é saída derivada: é removido e a Escala recalcula.
  for r in
    select a.data, a.periodo_id,
           ((a.data + coalesce((select (pp->>'inicio')::time
                                  from public.escala_producao_dias d, jsonb_array_elements(d.periodos_snapshot) pp
                                 where d.data = a.data and pp->>'id' = a.periodo_id limit 1), time '00:00'))
              at time zone 'America/Sao_Paulo') as inicio_ts,
           (p_mantido is not null and exists (select 1 from escala_producao_alocacoes k
                                               where k.funcionario_id = p_mantido and k.data = a.data and k.periodo_id = a.periodo_id)) as kept_tem,
           (select d2.previsao_id from escala_producao_dias d2 where d2.data = a.data) as previsao_id
      from escala_producao_alocacoes a
     where a.funcionario_id = p_excluido
     order by a.data, a.periodo_id
  loop
    v_prev_afetadas := v_prev_afetadas || r.previsao_id;
    if r.inicio_ts <= v_agora then
      if v_modo = 'unificacao' then
        if r.kept_tem then v_al_cons := v_al_cons || jsonb_build_array(jsonb_build_object('data', r.data, 'periodo_id', r.periodo_id));
        else v_al_mover := v_al_mover || jsonb_build_array(jsonb_build_object('data', r.data, 'periodo_id', r.periodo_id)); end if;
      else
        v_al_hist := v_al_hist || jsonb_build_array(jsonb_build_object('data', r.data, 'periodo_id', r.periodo_id));
      end if;
    else
      v_al_fut := v_al_fut || jsonb_build_array(jsonb_build_object('data', r.data, 'periodo_id', r.periodo_id));
    end if;
  end loop;

  -- ---------------- custos extras ----------------
  for r in select id, descricao, valor from funcionario_custos where funcionario_id = p_excluido order by created_at, id loop
    if v_modo = 'exclusao' then
      v_c_rem := v_c_rem || jsonb_build_array(jsonb_build_object('id', r.id, 'descricao', r.descricao, 'valor', r.valor));
    else
      v_k := null;
      select k.id into v_k from funcionario_custos k
       where k.funcionario_id = p_mantido and lower(btrim(k.descricao)) = lower(btrim(r.descricao)) and k.valor = r.valor
         and k.id <> all (v_c_usados)
       order by k.id limit 1;
      if v_k is not null then
        v_c_usados := v_c_usados || v_k;
        v_c_dup := v_c_dup || jsonb_build_array(jsonb_build_object('id', r.id, 'descricao', r.descricao, 'valor', r.valor));
      else
        v_dec := p_decisoes ->> r.id::text;
        if v_dec = 'copiar' then
          v_c_copiar := v_c_copiar || jsonb_build_array(jsonb_build_object('id', r.id, 'descricao', r.descricao, 'valor', r.valor));
        elsif v_dec = 'descartar' then
          v_c_desc := v_c_desc || jsonb_build_array(jsonb_build_object('id', r.id, 'descricao', r.descricao, 'valor', r.valor));
        else
          v_pend := v_pend || jsonb_build_array(jsonb_build_object('codigo', 'CUSTO_SEM_DECISAO', 'custo_id', r.id,
            'descricao', r.descricao, 'valor', r.valor,
            'mensagem', 'Custo diferente dos custos do funcionário mantido: decida "copiar" ou "descartar".'));
        end if;
      end if;
    end if;
  end loop;

  if v_modo = 'unificacao' and v_mt.ativo is false and v_ex.ativo then
    v_aviso := v_aviso || jsonb_build_array(jsonb_build_object('codigo', 'MANTIDO_INATIVO', 'mensagem', 'O funcionário que será mantido está INATIVO.'));
  end if;

  -- ---------------- impacto na Escala ----------------
  select coalesce(jsonb_agg(jsonb_build_object('semana_inicio', p.semana_inicio) order by p.semana_inicio), '[]'::jsonb)
    into v_impacto
    from previsoes p
   where p.id = any (v_prev_afetadas)
     and exists (select 1 from escala_producao_dias d where d.previsao_id = p.id);

  v_plano := jsonb_build_object(
    'modo', v_modo,
    'excluido', jsonb_build_object(
      'id', v_ex.id, 'nome', v_ex.nome, 'ativo', v_ex.ativo, 'cadastro', v_ex.created_at,
      'ultima_atividade', greatest(
        (select max(data) from apontamentos_producao where funcionario_id = p_excluido),
        (select max(data) from escala_producao_alocacoes where funcionario_id = p_excluido),
        (select max(data) from ausencias_funcionarios where funcionario_id = p_excluido)),
      'vinculos', jsonb_build_object('apontamentos', v_ap_n, 'ocorrencias', v_oc_n, 'ausencias', v_aus_total,
        'semanas_equipe', v_eq_total,
        'alocacoes', jsonb_array_length(v_al_mover) + jsonb_array_length(v_al_cons) + jsonb_array_length(v_al_fut) + jsonb_array_length(v_al_hist),
        'custos', (select count(*) from funcionario_custos where funcionario_id = p_excluido))),
    'mantido', case when v_modo = 'unificacao' then jsonb_build_object(
      'id', v_mt.id, 'nome', v_mt.nome, 'ativo', v_mt.ativo, 'cadastro', v_mt.created_at,
      'ultima_atividade', greatest(
        (select max(data) from apontamentos_producao where funcionario_id = p_mantido),
        (select max(data) from escala_producao_alocacoes where funcionario_id = p_mantido),
        (select max(data) from ausencias_funcionarios where funcionario_id = p_mantido)),
      'vinculos', jsonb_build_object('apontamentos', (select count(*) from apontamentos_producao where funcionario_id = p_mantido),
        'semanas_equipe', (select count(*) from previsao_equipe_semana where funcionario_id = p_mantido),
        'ausencias', (select count(*) from ausencias_funcionarios where funcionario_id = p_mantido),
        'custos', (select count(*) from funcionario_custos where funcionario_id = p_mantido))) else null end,
    'transferir', jsonb_build_object(
      'apontamentos', case when v_modo = 'unificacao' then v_ap_n else 0 end,
      'ocorrencias', case when v_modo = 'unificacao' then v_oc_n else 0 end,
      'ausencias', cardinality(v_aus_mover),
      'semanas_equipe', jsonb_array_length(v_eq_mover),
      'alocacoes_passadas', jsonb_array_length(v_al_mover),
      'custos_copiados', jsonb_array_length(v_c_copiar)),
    'consolidar', jsonb_build_object(
      'ausencias_identicas', cardinality(v_aus_cons),
      'semanas_equipe', v_eq_conf,
      'alocacoes_passadas_mesmo_periodo', v_al_cons,
      'custos_duplicados', v_c_dup),
    'descartar', jsonb_build_object(
      'alocacoes_futuras', v_al_fut,
      'alocacoes_passadas', v_al_hist,
      'ausencias', case when v_modo = 'exclusao' then v_aus_total else 0 end,
      'semanas_equipe', case when v_modo = 'exclusao' then v_eq_total else 0 end,
      'custos', case when v_modo = 'exclusao' then v_c_rem else v_c_desc end),
    'impacto_escala', jsonb_build_object(
      'semanas_recalculadas', v_impacto,
      'alocacoes_futuras_removidas', jsonb_array_length(v_al_fut),
      'observacao', 'Períodos já iniciados não são alterados; a Escala recalcula só os períodos futuros das semanas listadas.'),
    'decisoes_custos', p_decisoes,
    'bloqueios', v_bloq, 'pendencias', v_pend, 'avisos', v_aviso);
  v_ass := md5(v_plano::text);
  v_plano := v_plano || jsonb_build_object('pode_executar', (jsonb_array_length(v_bloq) = 0 and jsonb_array_length(v_pend) = 0), 'assinatura', v_ass);

  if not p_executar then
    return v_plano;
  end if;

  -- =====================================================================
  -- EXECUÇÃO (tudo abaixo é uma única transação; qualquer RAISE desfaz tudo)
  -- =====================================================================
  if jsonb_array_length(v_bloq) > 0 then raise exception 'FUNC_BLOQUEADO: %', v_bloq::text; end if;
  if jsonb_array_length(v_pend) > 0 then raise exception 'FUNC_PENDENCIAS: %', v_pend::text; end if;
  if p_assinatura is distinct from v_ass then
    raise exception 'FUNC_ASSINATURA_DESATUALIZADA: os dados mudaram desde a simulação. Simule novamente.';
  end if;

  v_snap := jsonb_build_object(
    'funcionario', (select to_jsonb(f) from funcionarios f where f.id = p_excluido),
    'custos', coalesce((select jsonb_agg(to_jsonb(c)) from funcionario_custos c where c.funcionario_id = p_excluido), '[]'::jsonb));

  if v_modo = 'unificacao' then
    select count(*) as n, coalesce(sum(quantidade_produzida), 0) as prod, coalesce(sum(quantidade_refugo), 0) as ref
      into v_ap_antes from apontamentos_producao where funcionario_id in (p_excluido, p_mantido);

    -- custos a copiar
    insert into funcionario_custos (funcionario_id, descricao, valor)
    select p_mantido, x.descricao, x.valor from jsonb_to_recordset(v_c_copiar) as x(descricao text, valor numeric);
    v_movidos := v_movidos || jsonb_build_object('custos_copiados', v_c_copiar);

    -- equipe da semana: conflito => produtivo = OR; operação do mantido prevalece (se nula, a do excluído)
    update previsao_equipe_semana k
       set produtivo = (k.produtivo or e.produtivo), operacao_id = coalesce(k.operacao_id, e.operacao_id)
      from previsao_equipe_semana e
     where e.funcionario_id = p_excluido and k.funcionario_id = p_mantido and k.previsao_id = e.previsao_id;
    select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into v_ids from previsao_equipe_semana e
     where e.funcionario_id = p_excluido and exists (select 1 from previsao_equipe_semana k where k.previsao_id = e.previsao_id and k.funcionario_id = p_mantido);
    v_descartados := v_descartados || jsonb_build_object('equipe_semana_consolidada', v_ids);
    delete from previsao_equipe_semana e
     where e.funcionario_id = p_excluido and exists (select 1 from previsao_equipe_semana k where k.previsao_id = e.previsao_id and k.funcionario_id = p_mantido);
    update previsao_equipe_semana set funcionario_id = p_mantido where funcionario_id = p_excluido;
    v_movidos := v_movidos || jsonb_build_object('equipe_semana', v_eq_mover);

    -- Escala: passado consolidado/futuro derivado são removidos; passado sem conflito é transferido
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_ids from escala_producao_alocacoes a
     join (select * from jsonb_to_recordset(v_al_cons || v_al_fut) as z(data date, periodo_id text)) z on z.data = a.data and z.periodo_id = a.periodo_id
     where a.funcionario_id = p_excluido;
    v_descartados := v_descartados || jsonb_build_object('alocacoes_removidas', v_ids);
    delete from escala_producao_alocacoes a using jsonb_to_recordset(v_al_cons || v_al_fut) as z(data date, periodo_id text)
     where a.funcionario_id = p_excluido and a.data = z.data and a.periodo_id = z.periodo_id;
    update escala_producao_alocacoes a set funcionario_id = p_mantido
      from jsonb_to_recordset(v_al_mover) as z(data date, periodo_id text)
     where a.funcionario_id = p_excluido and a.data = z.data and a.periodo_id = z.periodo_id;
    v_movidos := v_movidos || jsonb_build_object('alocacoes_passadas', v_al_mover);

    -- ausências: duplicatas idênticas consolidadas; as demais transferidas (com histórico)
    select coalesce(jsonb_agg(jsonb_build_object('ausencia', to_jsonb(a),
             'historico', coalesce((select jsonb_agg(to_jsonb(h)) from ausencia_funcionario_historico h where h.ausencia_id = a.id), '[]'::jsonb))), '[]'::jsonb)
      into v_ids from ausencias_funcionarios a where a.id = any (v_aus_cons);
    v_descartados := v_descartados || jsonb_build_object('ausencias_consolidadas', v_ids);
    delete from ausencias_funcionarios where id = any (v_aus_cons);
    insert into ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, motivo)
    select a.id, to_jsonb(a), to_jsonb(a) || jsonb_build_object('funcionario_id', p_mantido), v_usuario,
           format('Unificação de funcionário: %s → %s', v_ex.nome, v_mt.nome)
      from ausencias_funcionarios a where a.id = any (v_aus_mover);
    update ausencias_funcionarios set funcionario_id = p_mantido where id = any (v_aus_mover);
    v_movidos := v_movidos || jsonb_build_object('ausencias', to_jsonb(v_aus_mover));

    -- apontamentos (com histórico) e ocorrências
    select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from apontamentos_producao where funcionario_id = p_excluido;
    v_movidos := v_movidos || jsonb_build_object('apontamentos', v_ids);
    insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo)
    select a.id, to_jsonb(a), to_jsonb(a) || jsonb_build_object('funcionario_id', p_mantido), v_usuario,
           format('Unificação de funcionário: %s → %s', v_ex.nome, v_mt.nome)
      from apontamentos_producao a where a.funcionario_id = p_excluido;
    update apontamentos_producao set funcionario_id = p_mantido where funcionario_id = p_excluido;
    select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from ocorrencias_maquina where funcionario_id = p_excluido;
    v_movidos := v_movidos || jsonb_build_object('ocorrencias', v_ids);
    update ocorrencias_maquina set funcionario_id = p_mantido where funcionario_id = p_excluido;
  else
    -- exclusão simples (sem apontamentos/ocorrências, garantido pelos bloqueios acima)
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_ids from escala_producao_alocacoes a where a.funcionario_id = p_excluido;
    v_descartados := v_descartados || jsonb_build_object('alocacoes_removidas', v_ids);
    delete from escala_producao_alocacoes where funcionario_id = p_excluido;
    select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into v_ids from previsao_equipe_semana e where e.funcionario_id = p_excluido;
    v_descartados := v_descartados || jsonb_build_object('equipe_semana_removida', v_ids);
    delete from previsao_equipe_semana where funcionario_id = p_excluido;
    select coalesce(jsonb_agg(jsonb_build_object('ausencia', to_jsonb(a),
             'historico', coalesce((select jsonb_agg(to_jsonb(h)) from ausencia_funcionario_historico h where h.ausencia_id = a.id), '[]'::jsonb))), '[]'::jsonb)
      into v_ids from ausencias_funcionarios a where a.funcionario_id = p_excluido;
    v_descartados := v_descartados || jsonb_build_object('ausencias_removidas', v_ids);
    delete from ausencias_funcionarios where funcionario_id = p_excluido;
  end if;

  v_descartados := v_descartados || jsonb_build_object('custos', (v_snap -> 'custos'));
  delete from funcionario_custos where funcionario_id = p_excluido;

  -- a Escala recalcula os períodos futuros das semanas afetadas (determinístico e idempotente)
  for v_prev in
    select p.id from previsoes p
     where p.id = any (v_prev_afetadas) and exists (select 1 from escala_producao_dias d where d.previsao_id = p.id)
     order by p.id
  loop
    perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('origem', 'unificacao_funcionario'), v_usuario);
  end loop;

  -- conferência 1: totais de produção preservados (contagem, quantidade e refugo)
  if v_modo = 'unificacao' then
    select count(*) as n, coalesce(sum(quantidade_produzida), 0) as prod, coalesce(sum(quantidade_refugo), 0) as ref
      into v_ap_depois from apontamentos_producao where funcionario_id = p_mantido;
    if v_ap_depois.n <> v_ap_antes.n or v_ap_depois.prod <> v_ap_antes.prod or v_ap_depois.ref <> v_ap_antes.ref then
      raise exception 'FUNC_CONFERENCIA_APONTAMENTOS: totais de produção não conferem (antes % / % / %, depois % / % / %)',
        v_ap_antes.n, v_ap_antes.prod, v_ap_antes.ref, v_ap_depois.n, v_ap_depois.prod, v_ap_depois.ref;
    end if;
  end if;

  -- conferência 2: NENHUMA referência restante (qualquer tabela com FK para funcionarios, inclusive futuras)
  for r in
    select c.conrelid::regclass::text as tabela, a.attname as coluna
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.confrelid = 'public.funcionarios'::regclass and c.contype = 'f'
  loop
    execute format('select count(*) from %s where %I = $1', r.tabela, r.coluna) into v_n using p_excluido;
    if v_n > 0 then
      raise exception 'FUNC_REFERENCIAS_RESIDUAIS: % ainda tem % registro(s) apontando para o funcionário', r.tabela, v_n;
    end if;
  end loop;

  insert into funcionarios_exclusoes_log (executado_por, modo, funcionario_excluido_id, funcionario_mantido_id, snapshot, plano, movidos, descartados)
  values (v_usuario, v_modo, p_excluido, p_mantido, v_snap, v_plano, v_movidos, v_descartados)
  returning id into v_log;

  delete from funcionarios where id = p_excluido;

  return jsonb_build_object('ok', true, 'modo', v_modo, 'log_id', v_log, 'plano', v_plano);
end;
$$;

-- =========================================================================
-- 4) API (somente administrador, verificado dentro do núcleo)
-- =========================================================================
create or replace function public.funcionario_resumo(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f record;
begin
  if not public.is_admin() then
    raise exception 'FUNC_SOMENTE_ADMIN: somente administrador pode excluir ou unificar funcionários';
  end if;
  select id, nome, ativo, created_at into v_f from funcionarios where id = p_id;
  if not found then raise exception 'FUNC_NAO_ENCONTRADO: o funcionário não existe'; end if;
  return jsonb_build_object(
    'funcionario', jsonb_build_object('id', v_f.id, 'nome', v_f.nome, 'ativo', v_f.ativo, 'cadastro', v_f.created_at,
      'ultima_atividade', greatest(
        (select max(data) from apontamentos_producao where funcionario_id = p_id),
        (select max(data) from escala_producao_alocacoes where funcionario_id = p_id),
        (select max(data) from ausencias_funcionarios where funcionario_id = p_id))),
    'vinculos', jsonb_build_object(
      'apontamentos', (select count(*) from apontamentos_producao where funcionario_id = p_id),
      'ocorrencias', (select count(*) from ocorrencias_maquina where funcionario_id = p_id),
      'ausencias', (select count(*) from ausencias_funcionarios where funcionario_id = p_id),
      'semanas_equipe', (select count(*) from previsao_equipe_semana where funcionario_id = p_id),
      'alocacoes', (select count(*) from escala_producao_alocacoes where funcionario_id = p_id),
      'custos', (select count(*) from funcionario_custos where funcionario_id = p_id)),
    'candidatos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'nome', f.nome, 'ativo', f.ativo, 'cadastro', f.created_at,
        'mesmo_nome', lower(btrim(f.nome)) = lower(btrim(v_f.nome)),
        'apontamentos', (select count(*) from apontamentos_producao a where a.funcionario_id = f.id),
        'ultima_atividade', greatest((select max(data) from apontamentos_producao a where a.funcionario_id = f.id),
                                     (select max(data) from escala_producao_alocacoes a where a.funcionario_id = f.id)))
        order by (lower(btrim(f.nome)) = lower(btrim(v_f.nome))) desc, f.nome, f.created_at)
      from funcionarios f where f.id <> p_id), '[]'::jsonb));
end;
$$;

create or replace function public.funcionario_exclusao_simular(p_excluido uuid, p_mantido uuid default null, p_decisoes_custos jsonb default '{}'::jsonb)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$ select public._funcionario_exclusao(p_excluido, p_mantido, p_decisoes_custos, false, null) $$;

create or replace function public.funcionario_exclusao_executar(p_excluido uuid, p_mantido uuid, p_decisoes_custos jsonb, p_assinatura text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$ select public._funcionario_exclusao(p_excluido, p_mantido, p_decisoes_custos, true, p_assinatura) $$;

revoke all on function public._funcionario_exclusao(uuid, uuid, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.funcionario_resumo(uuid) from public, anon;
revoke all on function public.funcionario_exclusao_simular(uuid, uuid, jsonb) from public, anon;
revoke all on function public.funcionario_exclusao_executar(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.funcionario_resumo(uuid) to authenticated;
grant execute on function public.funcionario_exclusao_simular(uuid, uuid, jsonb) to authenticated;
grant execute on function public.funcionario_exclusao_executar(uuid, uuid, jsonb, text) to authenticated;

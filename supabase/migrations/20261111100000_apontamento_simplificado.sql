-- Sittech — APONTAMENTO SIMPLIFICADO no fechamento do período (Frente 2). Migration INDEPENDENTE da 20261110100000 (não a altera), numerada depois.
-- Aditiva, idempotente, atômica. Com `apontamento_simplificado_modo` = 'desligado' (PADRÃO) NADA muda: a RPC nova recusa e nenhuma tela chama.
--
-- O QUE FAZ
--   1) PLANEJADO × REAL auditável: tabela `apontamento_planejado_real` (append-only). Para cada apontamento lançado pelo fluxo guarda o SNAPSHOT do posto programado
--      (lido do plano oficial `escala_producao_alocacoes` DENTRO do banco, nunca do cliente) e o snapshot do que realmente aconteceu, as divergências
--      (MAQUINA/OPERADOR/PRODUTO/OPERACAO), a origem (PROGRAMADO | POSTO_NAO_PLANEJADO) e o motivo fino do "NÃO PRODUZIU". O planejado nunca é sobrescrito pelo real.
--   2) RPC `registrar_apontamentos_fechamento(data, periodo, linhas)`: grava TODAS as linhas do período numa ÚNICA transação, reaproveitando as functions core já existentes
--      (`registrar_apontamento_producao_core` / `registrar_sem_producao_core`: elegibilidade, meta, custo e snapshot de preço NÃO são reimplementados).
--      Reenvio = SUBSTITUI só as linhas que o próprio fluxo criou (nunca toca apontamento lançado no painel; recusa se a linha foi editada/ganhou parada manual fora do fluxo).
--   3) Flag `apontamento_simplificado_modo` (escala_parametros) — o gatilho de parâmetros NÃO pode enfileirar recálculo por causa dela (mesma saída antecipada da flag do fechamento).
--
-- DEPENDE de: 20261110100000_escala_fechamento_fisico.sql (usa escala_fechamento_apontamento_permitido). ROLLBACK: supabase/rollbacks/20261111100000_apontamento_simplificado_ROLLBACK.sql
begin;

do $$ begin
  if to_regprocedure('public.escala_fechamento_apontamento_permitido(date, text, uuid)') is null then
    raise exception 'depende de 20261110100000_escala_fechamento_fisico (escala_fechamento_apontamento_permitido ausente)';
  end if;
end $$;

-- =========================================================================
-- 1) O gatilho de parâmetros enfileira RECÁLCULO para chave desconhecida. A flag nova não muda plano: saída antecipada própria (independente da guarda do fechamento).
-- =========================================================================
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'escala_trg_parametros';
  if v_def is null then raise exception 'escala_trg_parametros não encontrada'; end if;
  if v_def not like '%apontamento_simplificado_modo%' then
    v_def := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  if coalesce(new.chave, old.chave) = ''apontamento_simplificado_modo'' then\n    return null; -- a flag do apontamento simplificado nunca dispara recálculo\n  end if;\n');
    if v_def not like '%apontamento_simplificado_modo%' then raise exception 'escala_trg_parametros: ponto de inserção não reconhecido (revisar a migration)'; end if;
    execute v_def;
  end if;
end $$;

-- =========================================================================
-- 2) Flag (padrão desligado)
-- =========================================================================
alter table public.escala_parametros drop constraint if exists escala_parametros_apontamento_simplificado_modo;
alter table public.escala_parametros add constraint escala_parametros_apontamento_simplificado_modo
  check (chave <> 'apontamento_simplificado_modo' or valor in ('"desligado"'::jsonb, '"ativo"'::jsonb));
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('apontamento_simplificado_modo', '"desligado"', 'operacional', 'Apontamento simplificado dentro do fechamento do período: desligado (padrão) ou ativo (postos programados pré-preenchidos, NÃO PRODUZIU, extras; planejado × real auditável)')
on conflict (chave) do nothing;

create or replace function public.apontamento_simplificado_modo()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case when (select valor from public.escala_parametros where chave = 'apontamento_simplificado_modo') = '"ativo"'::jsonb then 'ativo' else 'desligado' end;
$$;

-- =========================================================================
-- 3) apontamento_planejado_real — append-only
-- =========================================================================
create table if not exists public.apontamento_planejado_real (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  periodo_id text not null references public.periodos(id) on delete restrict,
  origem text not null check (origem in ('PROGRAMADO', 'POSTO_NAO_PLANEJADO')),
  maquina_planejada_id uuid references public.maquinas(id) on delete restrict,
  planejado jsonb,                                         -- SNAPSHOT do plano oficial (escala_producao_alocacoes) no instante do lançamento
  apontamento_id uuid not null references public.apontamentos_producao(id) on delete cascade,
  maquina_real_id uuid not null references public.maquinas(id) on delete restrict,
  real jsonb not null,                                     -- o que o apontamento registrou (máquina, operador, produto, operação, quantidades/status)
  divergencias text[] not null default '{}',               -- subconjunto de MAQUINA, OPERADOR, PRODUTO, OPERACAO (só PROGRAMADO)
  nao_produziu boolean not null default false,
  motivo_nao_produziu text check (motivo_nao_produziu in ('SEM_MATERIAL', 'PARADA', 'AUSENCIA', 'SETUP_REGULAGEM', 'FALTA_COMPONENTE', 'OUTRO')),
  linha_chave uuid not null,
  criado_por uuid not null references public.usuarios(id) on delete restrict,
  criado_em timestamptz not null default now(),
  constraint apr_origem_planejado check ((origem = 'PROGRAMADO') = (maquina_planejada_id is not null and planejado is not null)),
  constraint apr_motivo_coerente check (nao_produziu = (motivo_nao_produziu is not null)),
  constraint apr_divergencias_validas check (divergencias <@ array['MAQUINA', 'OPERADOR', 'PRODUTO', 'OPERACAO']::text[]),
  constraint apr_apontamento_unico unique (apontamento_id)
);
create unique index if not exists uq_apr_posto_planejado on public.apontamento_planejado_real (data, periodo_id, maquina_planejada_id) where maquina_planejada_id is not null;
create index if not exists idx_apr_periodo on public.apontamento_planejado_real (data, periodo_id);

create or replace function public.apr_trg_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'apontamento_planejado_real é append-only (planejado e real nunca são sobrescritos)';
end;
$$;
drop trigger if exists trg_apr_imutavel on public.apontamento_planejado_real;
create trigger trg_apr_imutavel before update on public.apontamento_planejado_real for each row execute function public.apr_trg_imutavel();

alter table public.apontamento_planejado_real enable row level security;
drop policy if exists apr_leitura on public.apontamento_planejado_real;
create policy apr_leitura on public.apontamento_planejado_real for select to authenticated using (public.is_usuario_ativo());
revoke all on public.apontamento_planejado_real from anon, authenticated, service_role;
grant select on public.apontamento_planejado_real to authenticated, service_role;

-- =========================================================================
-- 4) RPC: grava todas as linhas do período numa transação
--    p_linhas = [{ chave, maquina_planejada_id|null, maquina_id, produto_id|null, funcionario_id|null, produzido, refugo, nao_produziu, motivo, descricao }]
-- =========================================================================
create or replace function public.registrar_apontamentos_fechamento(p_data date, p_periodo_id text, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_hora time := (now() at time zone 'America/Sao_Paulo')::time;
  v_ini time; v_fim time;
  v_l jsonb;
  v_ap apontamentos_producao;
  v_plan record;
  v_planejado jsonb;
  v_real jsonb;
  v_div text[];
  v_origem text;
  v_chave uuid; v_maq uuid; v_maq_plan uuid;
  v_nao boolean; v_motivo text; v_motivo_sp text; v_desc text; v_extra text;
  v_out jsonb := '[]'::jsonb;
  v_subst int := 0;
  v_hist record;
begin
  select id into v_user from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_user is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;
  if not (public.is_admin() or public.has_permissao('escala_fechamento') or public.has_permissao('producao_real_apontamento')) then
    raise exception 'Usuário sem permissão para lançar apontamentos do fechamento';
  end if;
  if public.apontamento_simplificado_modo() <> 'ativo' then raise exception 'APONTAMENTO_SIMPLIFICADO_DESLIGADO: o apontamento simplificado não está ativo'; end if;
  if p_data is null or p_periodo_id is null then raise exception 'data e período são obrigatórios'; end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then raise exception 'linhas deve ser uma lista'; end if;
  if p_data > v_hoje then raise exception 'Não é possível lançar apontamento de data futura (%)', p_data; end if;
  select inicio, fim into v_ini, v_fim from periodos where id = p_periodo_id;
  if not found then raise exception 'Período % não encontrado', p_periodo_id; end if;
  if p_data = v_hoje and v_ini > v_hora then raise exception 'O período % de hoje ainda não começou', p_periodo_id; end if;

  perform pg_advisory_xact_lock(hashtextextended('apontamento_simplificado|' || p_data::text || '|' || p_periodo_id, 0));
  if not public.escala_fechamento_apontamento_permitido(p_data, p_periodo_id, v_user) then
    raise exception 'FECHAMENTO_PERIODO_EM_FECHAMENTO: o período % de % está em fechamento/fechado; o apontamento só pode ser lançado pelo responsável pelo fechamento', p_periodo_id, p_data;
  end if;
  if (select count(distinct x ->> 'maquina_id') from jsonb_array_elements(p_linhas) x) <> jsonb_array_length(p_linhas) then
    raise exception 'MAQUINA_DUPLICADA: há duas linhas para a mesma máquina real';
  end if;
  if (select count(distinct x ->> 'maquina_planejada_id') from jsonb_array_elements(p_linhas) x where coalesce(x ->> 'maquina_planejada_id', '') <> '')
     <> (select count(*) from jsonb_array_elements(p_linhas) x where coalesce(x ->> 'maquina_planejada_id', '') <> '') then
    raise exception 'POSTO_PROGRAMADO_DUPLICADO: o mesmo posto programado aparece em duas linhas';
  end if;

  -- REENVIO: substitui SÓ o que o próprio fluxo criou neste período (o histórico guarda o apontamento e o vínculo planejado×real anteriores)
  for v_hist in
    select a.*, l.id as vinculo_id from apontamentos_producao a join apontamento_planejado_real l on l.apontamento_id = a.id where l.data = p_data and l.periodo_id = p_periodo_id
  loop
    if exists (select 1 from apontamento_paradas where apontamento_id = v_hist.id and ocorrencia_id is null)
       or exists (select 1 from apontamento_producao_historico where apontamento_id = v_hist.id) then
      raise exception 'APONTAMENTO_EDITADO_FORA_DO_FLUXO: o apontamento da máquina % foi editado fora do fechamento (parada manual ou correção); corrija-o em Apontamentos realizados', v_hist.maquina_id;
    end if;
    insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo)
    values (v_hist.id,
            jsonb_build_object('apontamento_id', v_hist.id, 'maquina_id', v_hist.maquina_id, 'produto_id', v_hist.produto_id, 'funcionario_id', v_hist.funcionario_id, 'data', v_hist.data, 'periodo_id', v_hist.periodo_id,
                               'status', v_hist.status, 'quantidade_produzida', v_hist.quantidade_produzida, 'quantidade_refugo', v_hist.quantidade_refugo, 'motivo_sem_producao', v_hist.motivo_sem_producao,
                               'descricao_sem_producao', v_hist.descricao_sem_producao, 'vinculo_planejado_real', (select to_jsonb(l) from apontamento_planejado_real l where l.id = v_hist.vinculo_id)),
            jsonb_build_object('excluido', true, 'substituido_por', 'registrar_apontamentos_fechamento'), v_user, 'Substituído no fechamento do período (apontamento simplificado)');
    delete from apontamentos_producao where id = v_hist.id;   -- o vínculo cai em cascata
    v_subst := v_subst + 1;
  end loop;

  for v_l in select * from jsonb_array_elements(p_linhas) loop
    begin
      v_chave := (v_l ->> 'chave')::uuid;
      v_maq := (v_l ->> 'maquina_id')::uuid;
      v_maq_plan := nullif(v_l ->> 'maquina_planejada_id', '')::uuid;
      v_nao := coalesce((v_l ->> 'nao_produziu')::boolean, false);
      v_motivo := nullif(v_l ->> 'motivo', '');
      v_extra := null;
      if v_maq is null then raise exception 'máquina é obrigatória'; end if;

      if v_maq_plan is not null then
        select a.*, m.nome as maquina_nome, f.nome as funcionario_nome, p.nome as produto_nome, o.nome as operacao_nome into v_plan
          from escala_producao_alocacoes a
          left join maquinas m on m.id = a.maquina_id left join funcionarios f on f.id = a.funcionario_id left join produtos p on p.id = a.produto_id left join operacoes o on o.id = a.operacao_id
         where a.data = p_data and a.periodo_id = p_periodo_id and a.maquina_id = v_maq_plan;
        if not found then raise exception 'POSTO_PROGRAMADO_INEXISTENTE: a máquina % não estava programada neste período', v_maq_plan; end if;
        v_origem := 'PROGRAMADO';
        v_planejado := jsonb_build_object('fonte', 'escala_producao_alocacoes', 'capturado_em', now(),
          'maquina_id', v_plan.maquina_id, 'maquina_nome', v_plan.maquina_nome, 'funcionario_id', v_plan.funcionario_id, 'funcionario_nome', v_plan.funcionario_nome,
          'produto_id', v_plan.produto_id, 'produto_nome', v_plan.produto_nome, 'etapa_id', v_plan.etapa_id, 'operacao_id', v_plan.operacao_id, 'operacao_nome', v_plan.operacao_nome,
          'pecas', v_plan.pecas, 'pecas_adicional', v_plan.pecas_adicional, 'origem_alocacao', v_plan.origem);
      else
        v_origem := 'POSTO_NAO_PLANEJADO'; v_planejado := null;
      end if;

      if v_nao then
        v_motivo_sp := case v_motivo when 'SEM_MATERIAL' then 'falta_material' when 'FALTA_COMPONENTE' then 'falta_material' when 'AUSENCIA' then 'falta_operador' when 'PARADA' then 'outro' when 'SETUP_REGULAGEM' then 'outro' when 'OUTRO' then 'outro' else null end;
        if v_motivo_sp is null then raise exception 'NAO_PRODUZIU exige um motivo válido (recebido: %)', coalesce(v_motivo, 'vazio'); end if;
        v_extra := nullif(trim(coalesce(v_l ->> 'descricao', '')), '');
        if v_motivo = 'OUTRO' and v_extra is null then raise exception 'O motivo "outro" exige descrição'; end if;
        v_desc := case v_motivo when 'PARADA' then 'Parada de máquina' when 'SETUP_REGULAGEM' then 'Setup/regulagem' when 'FALTA_COMPONENTE' then 'Falta de componente' else null end;
        v_desc := case when v_desc is not null and v_extra is not null then v_desc || ': ' || v_extra when v_desc is not null then v_desc else v_extra end;
        v_ap := registrar_sem_producao_core(v_maq, v_motivo_sp, v_chave, v_desc, p_data, v_hora, p_periodo_id, v_ini, v_fim);
      else
        v_motivo := null;
        v_ap := registrar_apontamento_producao_core(v_maq, nullif(v_l ->> 'produto_id', '')::uuid, nullif(v_l ->> 'funcionario_id', '')::uuid,
          (v_l ->> 'produzido')::numeric, coalesce((v_l ->> 'refugo')::numeric, 0), v_chave, nullif(trim(coalesce(v_l ->> 'observacao', '')), ''), p_data, v_hora, p_periodo_id, v_ini, v_fim);
      end if;

      v_div := '{}';
      if v_origem = 'PROGRAMADO' then
        if v_ap.maquina_id is distinct from v_plan.maquina_id then v_div := v_div || 'MAQUINA'::text; end if;
        if not v_nao then
          if v_ap.funcionario_id is distinct from v_plan.funcionario_id then v_div := v_div || 'OPERADOR'::text; end if;
          if v_ap.produto_id is distinct from v_plan.produto_id then v_div := v_div || 'PRODUTO'::text; end if;
          if v_ap.operacao_id is distinct from v_plan.operacao_id then v_div := v_div || 'OPERACAO'::text; end if;
        end if;
      end if;
      v_real := jsonb_build_object('status', v_ap.status, 'maquina_id', v_ap.maquina_id, 'maquina_nome', (select nome from maquinas where id = v_ap.maquina_id),
        'funcionario_id', v_ap.funcionario_id, 'funcionario_nome', (select nome from funcionarios where id = v_ap.funcionario_id),
        'produto_id', v_ap.produto_id, 'produto_nome', (select nome from produtos where id = v_ap.produto_id), 'etapa_id', v_ap.etapa_id,
        'operacao_id', v_ap.operacao_id, 'operacao_nome', (select nome from operacoes where id = v_ap.operacao_id),
        'produzido', v_ap.quantidade_produzida, 'refugo', v_ap.quantidade_refugo, 'motivo_sem_producao', v_ap.motivo_sem_producao, 'descricao_sem_producao', v_ap.descricao_sem_producao, 'descricao_informada', v_extra);
      insert into apontamento_planejado_real (data, periodo_id, origem, maquina_planejada_id, planejado, apontamento_id, maquina_real_id, real, divergencias, nao_produziu, motivo_nao_produziu, linha_chave, criado_por)
      values (p_data, p_periodo_id, v_origem, v_maq_plan, v_planejado, v_ap.id, v_ap.maquina_id, v_real, v_div, v_nao, v_motivo, v_chave, v_user);
      v_out := v_out || jsonb_build_object('chave', v_chave, 'apontamento_id', v_ap.id, 'origem', v_origem, 'divergencias', to_jsonb(v_div), 'nao_produziu', v_nao);
    exception when others then
      raise exception 'LINHA[%]: %', coalesce(v_l ->> 'chave', '?'), sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'substituidas', v_subst, 'linhas', v_out);
end;
$$;

revoke all on function public.registrar_apontamentos_fechamento(date, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.registrar_apontamentos_fechamento(date, text, jsonb) to authenticated;
revoke all on function public.apontamento_simplificado_modo() from public, anon, authenticated, service_role;
grant execute on function public.apontamento_simplificado_modo() to authenticated, service_role;
revoke all on function public.apr_trg_imutavel() from public, anon, authenticated, service_role;

commit;

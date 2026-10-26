-- Sittech — "Excluir funcionário" = DESATIVAR (histórico preservado integralmente).
--
-- Um único conceito: ATIVO / INATIVO (o antigo "pausado" e o "desligado" são a mesma coisa). Funcionário inativo não participa das operações
-- futuras; todo o histórico (apontamentos, ausências, Escala passada, custos, ocorrências, auditorias) permanece, e o nome continua resolvendo.
--
--  • linha do tempo APPEND-ONLY `funcionario_situacao_historico` (bitemporal): `efetivo_em` = instante em que a pessoa deixou de estar ativa (ou voltou),
--    `registrado_em` = quando o sistema recebeu o registro. É a fonte para reconstruir "estava ativo neste corte?" (sombra sem hindsight);
--  • RPCs `desativar_funcionario` / `reativar_funcionario` (SOMENTE admin); o UPDATE direto de `ativo` passa a ser recusado (inclusive o antigo ⏸/▶);
--  • desativar: recusa com ATRASO_EM_ABERTO; nas semanas FUTURAS marca previsao_equipe_semana.produtivo = false (nunca DELETE) → evento normal da
--    Escala; a semana atual e o passado não são reescritos;
--  • reativar NÃO recoloca a pessoa em equipes futuras já programadas;
--  • exclusão física só para cadastro SEM nenhum vínculo (`funcionario_remover_vazio`); o caminho destrutivo "excluir sem unificar" deixa de ser
--    executável pela aplicação (resta a função interna `_funcionario_exclusao`, só para administração de emergência fora da interface);
--  • editar apontamento antigo de funcionário inativo volta a ser possível (só recusa se trocar para outro funcionário inativo);
--  • abrir atraso para funcionário inativo é recusado.
-- Aditiva. NÃO altera linhas existentes nem `funcionarios_exclusoes_log`.

-- =========================================================================
-- 1) funcionarios: estado atual do desligamento (a linha nunca é apagada)
-- =========================================================================
alter table public.funcionarios
  add column if not exists desligado_em timestamptz,
  add column if not exists desligado_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists desligamento_registrado_em timestamptz,
  add column if not exists motivo_desligamento text;

alter table public.funcionarios drop constraint if exists funcionarios_desligamento_forma;
alter table public.funcionarios add constraint funcionarios_desligamento_forma check (
  not ativo or (desligado_em is null and desligado_por is null and desligamento_registrado_em is null and motivo_desligamento is null));

comment on column public.funcionarios.desligado_em is 'Instante EFETIVO em que a pessoa deixou de estar ativa (pode ser anterior ao registro). NULL enquanto ativa. A fonte temporal completa é funcionario_situacao_historico.';
comment on column public.funcionarios.desligamento_registrado_em is 'Quando o sistema recebeu o registro do desligamento.';

-- =========================================================================
-- 2) Linha do tempo append-only (bitemporal)
-- =========================================================================
create table if not exists public.funcionario_situacao_historico (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null,            -- sem FK de propósito: a auditoria sobrevive mesmo a uma unificação/remoção do cadastro
  acao text not null check (acao in ('desativado', 'reativado')),
  efetivo_em timestamptz not null,         -- quando a mudança passou a valer
  registrado_em timestamptz not null,      -- quando o sistema recebeu o registro
  registrado_por uuid not null references public.usuarios(id) on delete restrict,
  motivo text,
  ativo_antes boolean not null,
  ativo_depois boolean not null,
  constraint funcionario_situacao_coerente check (
    (acao = 'desativado' and ativo_antes and not ativo_depois) or (acao = 'reativado' and not ativo_antes and ativo_depois))
);
create index if not exists idx_func_situacao_func_efetivo on public.funcionario_situacao_historico (funcionario_id, efetivo_em, registrado_em);

alter table public.funcionario_situacao_historico enable row level security;
drop policy if exists funcionario_situacao_historico_select on public.funcionario_situacao_historico;
create policy funcionario_situacao_historico_select on public.funcionario_situacao_historico for select to authenticated using (public.is_admin());
revoke all on public.funcionario_situacao_historico from anon, authenticated;
grant select on public.funcionario_situacao_historico to authenticated, service_role;

create or replace function public.funcionario_situacao_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'FUNC_SITUACAO_APPEND_ONLY: a linha do tempo de situação do funcionário é append-only';
end;
$$;
drop trigger if exists trg_funcionario_situacao_append_only on public.funcionario_situacao_historico;
create trigger trg_funcionario_situacao_append_only before update or delete on public.funcionario_situacao_historico
  for each row execute function public.funcionario_situacao_append_only();

-- Estava ativo em `p_efetivo`, conhecendo apenas o que foi REGISTRADO até `p_conhecido_ate` (NULL = tudo)? Bitemporal:
--  1) o último evento conhecido com efetivo_em <= p_efetivo decide;
--  2) antes de qualquer evento conhecido vale o estado anterior ao PRIMEIRO evento (ativo_antes);
--  3) sem nenhum evento (cadastros anteriores a esta linha do tempo) vale o `ativo` atual.
create or replace function public.funcionario_ativo_em(p_id uuid, p_efetivo timestamptz, p_conhecido_ate timestamptz default null)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v boolean;
begin
  select h.ativo_depois into v from public.funcionario_situacao_historico h
   where h.funcionario_id = p_id and h.efetivo_em <= p_efetivo and (p_conhecido_ate is null or h.registrado_em <= p_conhecido_ate)
   order by h.efetivo_em desc, h.registrado_em desc limit 1;
  if found then return v; end if;
  select h.ativo_antes into v from public.funcionario_situacao_historico h where h.funcionario_id = p_id order by h.efetivo_em, h.registrado_em limit 1;
  if found then return v; end if;
  select f.ativo into v from public.funcionarios f where f.id = p_id;
  return coalesce(v, false);
end;
$$;
revoke all on function public.funcionario_ativo_em(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.funcionario_ativo_em(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- =========================================================================
-- 3) Guarda: `ativo` e os campos de desligamento só mudam pelas RPCs (nada de UPDATE direto do navegador)
-- =========================================================================
create or replace function public.funcionarios_guarda_situacao()
returns trigger language plpgsql as $$
begin
  if (new.ativo is distinct from old.ativo or new.desligado_em is distinct from old.desligado_em or new.desligado_por is distinct from old.desligado_por
      or new.desligamento_registrado_em is distinct from old.desligamento_registrado_em or new.motivo_desligamento is distinct from old.motivo_desligamento)
     and coalesce(current_setting('app.funcionario_situacao_rpc', true), '') <> '1' then
    raise exception 'FUNC_USE_RPC: ativar/desativar funcionário só é permitido pelas ações desativar_funcionario / reativar_funcionario (somente administrador)';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_funcionarios_guarda_situacao on public.funcionarios;
create trigger trg_funcionarios_guarda_situacao before update on public.funcionarios
  for each row execute function public.funcionarios_guarda_situacao();

-- =========================================================================
-- 4) desativar_funcionario
-- =========================================================================
create or replace function public.desativar_funcionario(p_id uuid, p_desligado_em timestamptz default null, p_motivo text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_f public.funcionarios;
  v_usuario uuid;
  v_agora timestamptz := public._agora();
  v_efetivo timestamptz;
  v_ult timestamptz;
  v_segunda date;
  v_prevs uuid[];
  v_prev uuid;
  v_equipes_futuras integer;
begin
  if not public.is_admin() then raise exception 'FUNC_SOMENTE_ADMIN: somente administrador pode desativar funcionários'; end if;
  v_usuario := public.escala_usuario_atual();
  if v_usuario is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;

  select * into v_f from public.funcionarios where id = p_id for update;
  if not found then raise exception 'FUNC_NAO_ENCONTRADO: o funcionário não existe'; end if;
  if not v_f.ativo then
    return jsonb_build_object('ok', true, 'ja_inativo', true, 'funcionario_id', p_id);
  end if;

  perform public.fechar_atrasos_vencidos();
  if exists (select 1 from public.ausencias_funcionarios where funcionario_id = p_id and em_aberto) then
    raise exception 'ATRASO_EM_ABERTO: o funcionário tem atraso em aberto — registre a chegada (ou deixe o fechamento automático) antes de desativar';
  end if;

  v_efetivo := coalesce(p_desligado_em, v_agora);
  if v_efetivo > v_agora + interval '5 minutes' then raise exception 'FUNC_DESLIGAMENTO_FUTURO: a data/hora efetiva do desligamento não pode estar no futuro'; end if;
  if v_efetivo < v_f.created_at then raise exception 'FUNC_DESLIGAMENTO_ANTES_DO_CADASTRO: o desligamento não pode ser anterior ao cadastro do funcionário'; end if;
  select max(efetivo_em) into v_ult from public.funcionario_situacao_historico where funcionario_id = p_id;
  if v_ult is not null and v_efetivo < v_ult then raise exception 'FUNC_DESLIGAMENTO_ANTES_DA_ULTIMA_MUDANCA: o desligamento não pode ser anterior à última mudança de situação (%)', v_ult; end if;

  perform set_config('app.funcionario_situacao_rpc', '1', true);
  update public.funcionarios set ativo = false, desligado_em = v_efetivo, desligado_por = v_usuario, desligamento_registrado_em = v_agora,
         motivo_desligamento = nullif(btrim(coalesce(p_motivo, '')), '')
   where id = p_id;
  perform set_config('app.funcionario_situacao_rpc', '', true);

  insert into public.funcionario_situacao_historico (funcionario_id, acao, efetivo_em, registrado_em, registrado_por, motivo, ativo_antes, ativo_depois)
  values (p_id, 'desativado', v_efetivo, v_agora, v_usuario, nullif(btrim(coalesce(p_motivo, '')), ''), true, false);

  -- Semanas: a atual e o passado NÃO são reescritos; nas FUTURAS a pessoa deixa de ser produtiva (UPDATE, nunca DELETE: a linha e o contexto da semana ficam).
  v_segunda := date_trunc('week', (v_agora at time zone 'America/Sao_Paulo'))::date;
  select coalesce(array_agg(distinct e.previsao_id), '{}') into v_prevs
    from public.previsao_equipe_semana e join public.previsoes p on p.id = e.previsao_id
   where e.funcionario_id = p_id and e.produtivo and p.semana_inicio >= v_segunda;
  with up as (
    update public.previsao_equipe_semana e set produtivo = false
      from public.previsoes p
     where p.id = e.previsao_id and e.funcionario_id = p_id and e.produtivo and p.semana_inicio > v_segunda
    returning 1)
  select count(*) into v_equipes_futuras from up;

  -- reavaliação normal da Escala (a outbox deduplica pendentes por semana; o recálculo respeita passado, período atual, comprometido e c+2)
  foreach v_prev in array v_prevs loop
    if public.escala_semana_tem_escala(v_prev) then
      perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('origem', 'funcionario_desativado', 'funcionario_id', p_id), v_usuario);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'funcionario_id', p_id, 'desligado_em', v_efetivo, 'registrado_em', v_agora,
                            'equipes_futuras_ajustadas', v_equipes_futuras, 'semanas_reavaliadas', coalesce(array_length(v_prevs, 1), 0));
end;
$$;
revoke all on function public.desativar_funcionario(uuid, timestamptz, text) from public, anon;
grant execute on function public.desativar_funcionario(uuid, timestamptz, text) to authenticated;

-- =========================================================================
-- 5) reativar_funcionario (não recoloca em equipes futuras)
-- =========================================================================
create or replace function public.reativar_funcionario(p_id uuid, p_reativado_em timestamptz default null, p_motivo text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_f public.funcionarios;
  v_usuario uuid;
  v_agora timestamptz := public._agora();
  v_efetivo timestamptz;
  v_ult timestamptz;
begin
  if not public.is_admin() then raise exception 'FUNC_SOMENTE_ADMIN: somente administrador pode reativar funcionários'; end if;
  v_usuario := public.escala_usuario_atual();
  if v_usuario is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;

  select * into v_f from public.funcionarios where id = p_id for update;
  if not found then raise exception 'FUNC_NAO_ENCONTRADO: o funcionário não existe'; end if;
  if v_f.ativo then
    return jsonb_build_object('ok', true, 'ja_ativo', true, 'funcionario_id', p_id);
  end if;

  v_efetivo := coalesce(p_reativado_em, v_agora);
  if v_efetivo > v_agora + interval '5 minutes' then raise exception 'FUNC_REATIVACAO_FUTURA: a data/hora efetiva da reativação não pode estar no futuro'; end if;
  if v_efetivo < v_f.created_at then raise exception 'FUNC_REATIVACAO_ANTES_DO_CADASTRO: a reativação não pode ser anterior ao cadastro'; end if;
  select max(efetivo_em) into v_ult from public.funcionario_situacao_historico where funcionario_id = p_id;
  if v_ult is not null and v_efetivo < v_ult then raise exception 'FUNC_REATIVACAO_ANTES_DO_DESLIGAMENTO: a reativação não pode ser anterior ao desligamento (%)', v_ult; end if;

  perform set_config('app.funcionario_situacao_rpc', '1', true);
  update public.funcionarios set ativo = true, desligado_em = null, desligado_por = null, desligamento_registrado_em = null, motivo_desligamento = null where id = p_id;
  perform set_config('app.funcionario_situacao_rpc', '', true);

  insert into public.funcionario_situacao_historico (funcionario_id, acao, efetivo_em, registrado_em, registrado_por, motivo, ativo_antes, ativo_depois)
  values (p_id, 'reativado', v_efetivo, v_agora, v_usuario, nullif(btrim(coalesce(p_motivo, '')), ''), false, true);

  return jsonb_build_object('ok', true, 'funcionario_id', p_id, 'reativado_em', v_efetivo, 'registrado_em', v_agora);
end;
$$;
revoke all on function public.reativar_funcionario(uuid, timestamptz, text) from public, anon;
grant execute on function public.reativar_funcionario(uuid, timestamptz, text) to authenticated;

-- =========================================================================
-- 6) Consulta da linha do tempo (admin)
-- =========================================================================
create or replace function public.funcionario_situacao_listar(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'FUNC_SOMENTE_ADMIN: somente administrador'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'acao', h.acao, 'efetivo_em', h.efetivo_em, 'registrado_em', h.registrado_em,
                                         'registrado_por', u.nome, 'motivo', h.motivo, 'ativo_antes', h.ativo_antes, 'ativo_depois', h.ativo_depois)
                     order by h.efetivo_em desc, h.registrado_em desc)
      from public.funcionario_situacao_historico h left join public.usuarios u on u.id = h.registrado_por where h.funcionario_id = p_id), '[]'::jsonb);
end;
$$;
revoke all on function public.funcionario_situacao_listar(uuid) from public, anon;
grant execute on function public.funcionario_situacao_listar(uuid) to authenticated;

-- =========================================================================
-- 7) Exclusão física SÓ de cadastro sem NENHUM vínculo
-- =========================================================================
create or replace function public.funcionario_remover_vazio(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_f public.funcionarios;
  v_usuario uuid;
  r record;
  v_n bigint;
  v_vinculos jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then raise exception 'FUNC_SOMENTE_ADMIN: somente administrador pode remover cadastros'; end if;
  v_usuario := public.escala_usuario_atual();
  select * into v_f from public.funcionarios where id = p_id for update;
  if not found then raise exception 'FUNC_NAO_ENCONTRADO: o funcionário não existe'; end if;

  -- qualquer tabela com FK para funcionarios (apontamentos, ausências, Escala, equipe/Previsão, custos, ocorrências, inclusive futuras)
  for r in
    select c.conrelid::regclass::text as tabela, a.attname as coluna
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.confrelid = 'public.funcionarios'::regclass and c.contype = 'f'
  loop
    execute format('select count(*) from %s where %I = $1', r.tabela, r.coluna) into v_n using p_id;
    if v_n > 0 then v_vinculos := v_vinculos || jsonb_build_object(r.tabela, v_n); end if;
  end loop;
  select count(*) into v_n from public.funcionario_situacao_historico where funcionario_id = p_id;
  if v_n > 0 then v_vinculos := v_vinculos || jsonb_build_object('funcionario_situacao_historico', v_n); end if;
  select count(*) into v_n from public.funcionarios_exclusoes_log where funcionario_mantido_id = p_id;
  if v_n > 0 then v_vinculos := v_vinculos || jsonb_build_object('funcionarios_exclusoes_log', v_n); end if;

  if v_vinculos <> '{}'::jsonb then
    raise exception 'FUNC_TEM_VINCULOS: o cadastro tem vínculos (%) e não pode ser removido — desative ou unifique o funcionário', v_vinculos::text;
  end if;

  insert into public.funcionarios_exclusoes_log (executado_por, modo, funcionario_excluido_id, funcionario_mantido_id, snapshot, plano, movidos, descartados)
  values (v_usuario, 'exclusao', p_id, null, to_jsonb(v_f), jsonb_build_object('origem', 'cadastro_vazio'), '{}'::jsonb, '{}'::jsonb);
  delete from public.funcionarios where id = p_id;
  return jsonb_build_object('ok', true, 'funcionario_id', p_id);
end;
$$;
revoke all on function public.funcionario_remover_vazio(uuid) from public, anon;
grant execute on function public.funcionario_remover_vazio(uuid) to authenticated;

-- =========================================================================
-- 8) O caminho destrutivo "excluir sem unificar" sai da aplicação. Unificação inalterada.
--    A função interna _funcionario_exclusao (sem permissão para authenticated) permanece só para administração de emergência fora da interface.
-- =========================================================================
create or replace function public.funcionario_exclusao_simular(p_excluido uuid, p_mantido uuid default null, p_decisoes_custos jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_mantido is null then
    raise exception 'FUNC_EXCLUSAO_DESCONTINUADA: excluir funcionário agora é DESATIVAR (o histórico é preservado). Use desativar_funcionario, unifique, ou remova um cadastro sem vínculos (funcionario_remover_vazio)';
  end if;
  return public._funcionario_exclusao(p_excluido, p_mantido, p_decisoes_custos, false, null);
end;
$$;
create or replace function public.funcionario_exclusao_executar(p_excluido uuid, p_mantido uuid, p_decisoes_custos jsonb, p_assinatura text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_mantido is null then
    raise exception 'FUNC_EXCLUSAO_DESCONTINUADA: excluir funcionário agora é DESATIVAR (o histórico é preservado). Use desativar_funcionario, unifique, ou remova um cadastro sem vínculos (funcionario_remover_vazio)';
  end if;
  return public._funcionario_exclusao(p_excluido, p_mantido, p_decisoes_custos, true, p_assinatura);
end;
$$;
revoke all on function public.funcionario_exclusao_simular(uuid, uuid, jsonb) from public, anon;
revoke all on function public.funcionario_exclusao_executar(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.funcionario_exclusao_simular(uuid, uuid, jsonb) to authenticated;
grant execute on function public.funcionario_exclusao_executar(uuid, uuid, jsonb, text) to authenticated;

-- resumo (admin): agora também diz se o cadastro está VAZIO (sem nenhum vínculo) e traz o estado do desligamento
create or replace function public.funcionario_resumo(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_f record;
  v_vinc jsonb;
  v_hist bigint;
begin
  if not public.is_admin() then
    raise exception 'FUNC_SOMENTE_ADMIN: somente administrador pode desativar, excluir ou unificar funcionários';
  end if;
  select id, nome, ativo, created_at, desligado_em, motivo_desligamento into v_f from funcionarios where id = p_id;
  if not found then raise exception 'FUNC_NAO_ENCONTRADO: o funcionário não existe'; end if;
  v_vinc := jsonb_build_object(
      'apontamentos', (select count(*) from apontamentos_producao where funcionario_id = p_id),
      'ocorrencias', (select count(*) from ocorrencias_maquina where funcionario_id = p_id),
      'ausencias', (select count(*) from ausencias_funcionarios where funcionario_id = p_id),
      'semanas_equipe', (select count(*) from previsao_equipe_semana where funcionario_id = p_id),
      'alocacoes', (select count(*) from escala_producao_alocacoes where funcionario_id = p_id),
      'custos', (select count(*) from funcionario_custos where funcionario_id = p_id));
  select count(*) into v_hist from funcionario_situacao_historico where funcionario_id = p_id;
  return jsonb_build_object(
    'funcionario', jsonb_build_object('id', v_f.id, 'nome', v_f.nome, 'ativo', v_f.ativo, 'cadastro', v_f.created_at,
      'desligado_em', v_f.desligado_em, 'motivo_desligamento', v_f.motivo_desligamento,
      'ultima_atividade', greatest(
        (select max(data) from apontamentos_producao where funcionario_id = p_id),
        (select max(data) from escala_producao_alocacoes where funcionario_id = p_id),
        (select max(data) from ausencias_funcionarios where funcionario_id = p_id))),
    'vinculos', v_vinc,
    'atraso_em_aberto', exists (select 1 from ausencias_funcionarios where funcionario_id = p_id and em_aberto),
    'vazio', (select coalesce(sum(value::bigint), 0) = 0 from jsonb_each_text(v_vinc)) and v_hist = 0
             and not exists (select 1 from funcionarios_exclusoes_log where funcionario_mantido_id = p_id),
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

-- =========================================================================
-- 9) Leitura de elegibilidade: nomes continuam resolvendo para inativos; agora também expõe o desligamento efetivo
-- =========================================================================
create or replace view public.funcionarios_elegibilidade as
 select id, nome, ativo, operacao_id, desligado_em
   from public.funcionarios f
  where exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.ativo = true);

-- =========================================================================
-- 10) Ajustes nas RPCs existentes (patch da definição atual; falha se o trecho esperado não existir exatamente uma vez)
-- =========================================================================
do $$
declare
  d text; d2 text;
  alvo text;
begin
  -- editar / converter apontamento: o funcionário ser inativo HOJE não impede corrigir um apontamento antigo DELE; trocar para outro inativo continua proibido
  foreach alvo in array array[
    'public.editar_apontamento_producao(uuid, uuid, uuid, numeric, numeric, text, text, jsonb)',
    'public.converter_apontamento_sem_producao_para_producao(uuid, uuid, uuid, numeric, numeric, text, text, jsonb)'] loop
    d := pg_get_functiondef(alvo::regprocedure);
    d2 := replace(d, 'if not v_funcionario_ativo then', 'if not v_funcionario_ativo and p_funcionario_id is distinct from v_atual.funcionario_id then');
    if d2 = d or (length(d) - length(replace(d, 'if not v_funcionario_ativo then', ''))) <> length('if not v_funcionario_ativo then') then
      raise exception 'patch inesperado em %', alvo;
    end if;
    execute d2;
  end loop;

  -- abrir atraso: funcionário inativo não pode ter atraso novo
  d := pg_get_functiondef('public.abrir_atraso_funcionario(uuid, date, time without time zone, text, uuid)'::regprocedure);
  d2 := replace(d, '  select * into v_jornada from public.jornada_oficial_ausencias order by created_at limit 1;',
    E'  if not exists (select 1 from public.funcionarios_elegibilidade where id = p_funcionario_id and ativo = true) then raise exception ''Funcionário não encontrado ou inativo''; end if;\n  select * into v_jornada from public.jornada_oficial_ausencias order by created_at limit 1;');
  if d2 = d or (length(d) - length(replace(d, '  select * into v_jornada from public.jornada_oficial_ausencias order by created_at limit 1;', ''))) <> length('  select * into v_jornada from public.jornada_oficial_ausencias order by created_at limit 1;') then
    raise exception 'patch inesperado em abrir_atraso_funcionario';
  end if;
  execute d2;
end $$;

-- ROLLBACK (manual, sem perda de dados): reaplicar as definições anteriores de editar/converter apontamento, abrir_atraso, funcionario_resumo e dos wrappers de exclusão
-- (migrations 20260917100000, 20261028100000, 20261021100000);
--   drop trigger trg_funcionarios_guarda_situacao on public.funcionarios; drop function public.desativar_funcionario(uuid, timestamptz, text), public.reativar_funcionario(uuid, timestamptz, text),
--   public.funcionario_remover_vazio(uuid), public.funcionario_situacao_listar(uuid), public.funcionario_ativo_em(uuid, timestamptz, timestamptz);
--   (a tabela funcionario_situacao_historico e as colunas novas podem ficar: são inertes).

-- 20261114100000_regularizacao_historica
-- REGULARIZAÇÃO HISTÓRICA ADMINISTRATIVA de apontamentos: lançar/corrigir o que REALMENTE aconteceu num dia passado liberado explicitamente
-- (tabela regularizacao_historica_datas), sem depender da escala planejada e mesmo com período CONFIRMADO. Isolada do fluxo normal:
--   • quem: admin ou perfil superior (`escala_fechamento_excecao`) — checado dentro das RPCs (SECURITY DEFINER)
--   • só datas presentes em regularizacao_historica_datas E anteriores a hoje (fuso America/Sao_Paulo); hoje/futuro nunca
--   • validações objetivas: data/período/funcionário ativo/máquina ativa/produto ativo/combinação máquina+produto no roteiro/quantidades ≥ 0 e refugo ≤ produzido/meta do período cadastrada
--   • NÃO recalcula nada: durante a RPC os gatilhos do fechamento físico e de eventos da escala (escala_trg_apontamento → fila de recálculo) são suprimidos por um marcador
--     transacional (app.regularizacao_historica = 'on:<txid>'); não toca plano, liberação, inventário físico nem fechamento de hoje
--   • auditoria append-only (apontamento_regularizacao_historica): usuário, instante, data/período, registro anterior, registro novo, origem=REGULARIZACAO_HISTORICA e a
--     observação automática; edições também entram em apontamento_producao_historico e em registro_versoes (gatilho genérico)
-- ROLLBACK: supabase/rollbacks/20261114100000_regularizacao_historica_ROLLBACK.sql
begin;

create table if not exists public.regularizacao_historica_datas (
  data date primary key,
  liberado_por text not null default 'admin',
  liberado_em timestamptz not null default now(),
  observacao text
);
alter table public.regularizacao_historica_datas enable row level security;
revoke all on public.regularizacao_historica_datas from public, anon, authenticated;
grant select on public.regularizacao_historica_datas to authenticated;
drop policy if exists regularizacao_datas_select on public.regularizacao_historica_datas;
create policy regularizacao_datas_select on public.regularizacao_historica_datas for select to authenticated using (public.is_admin() or public.has_permissao('escala_fechamento_excecao'));

create table if not exists public.apontamento_regularizacao_historica (
  id uuid primary key default gen_random_uuid(),
  acao text not null check (acao in ('INCLUIDO', 'ALTERADO', 'EXCLUIDO')),
  data date not null,
  periodo_id text not null,
  apontamento_id uuid,                                   -- sem FK: o registro pode ter sido excluído
  maquina_id uuid,
  anterior jsonb,
  novo jsonb,
  usuario_id uuid not null references public.usuarios(id) on delete restrict,
  em timestamptz not null default clock_timestamp(),
  origem text not null default 'REGULARIZACAO_HISTORICA' check (origem = 'REGULARIZACAO_HISTORICA'),
  observacao text not null default 'Ajuste devido à realocação física de máquinas e operadores'
);
create index if not exists apontamento_regularizacao_historica_idx on public.apontamento_regularizacao_historica (data, periodo_id, em desc);
alter table public.apontamento_regularizacao_historica enable row level security;
revoke all on public.apontamento_regularizacao_historica from public, anon, authenticated;
grant select on public.apontamento_regularizacao_historica to authenticated;
drop policy if exists regularizacao_audit_select on public.apontamento_regularizacao_historica;
create policy regularizacao_audit_select on public.apontamento_regularizacao_historica for select to authenticated using (public.is_admin() or public.has_permissao('escala_fechamento_excecao'));
create or replace function public.regularizacao_trg_imutavel() returns trigger language plpgsql as $$
begin raise exception 'REGULARIZACAO_IMUTAVEL: o histórico de regularização é append-only'; end; $$;
drop trigger if exists trg_regularizacao_imutavel on public.apontamento_regularizacao_historica;
create trigger trg_regularizacao_imutavel before update or delete on public.apontamento_regularizacao_historica for each row execute function public.regularizacao_trg_imutavel();
drop trigger if exists trg_regularizacao_imutavel_trunc on public.apontamento_regularizacao_historica;
create trigger trg_regularizacao_imutavel_trunc before truncate on public.apontamento_regularizacao_historica for each statement execute function public.regularizacao_trg_imutavel();

-- marcador transacional (só as RPCs abaixo o definem, para a PRÓPRIA transação)
create or replace function public.regularizacao_em_curso() returns boolean language sql stable as $$
  select coalesce(current_setting('app.regularizacao_historica', true), '') = 'on:' || txid_current()::text;
$$;

-- gatilhos do fechamento físico: pulam durante a regularização (a regra normal fica intacta para todo o resto)
create or replace function public.escala_trg_apontamento_fechamento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.regularizacao_em_curso() then return new; end if;
  if public.escala_fechamento_fisico_modo() <> 'ativo' then return new; end if;
  if not public.escala_fechamento_apontamento_permitido(new.data, new.periodo_id, new.criado_por) then
    raise exception 'FECHAMENTO_PERIODO_EM_FECHAMENTO: o período % de % já está confirmado; para corrigir é preciso reabrir o período', new.periodo_id, new.data;
  end if;
  return new;
end;
$$;
revoke all on function public.escala_trg_apontamento_fechamento() from public, anon, authenticated;

create or replace function public.escala_trg_apontamento_fechamento_alteracao()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u uuid;
begin
  if public.regularizacao_em_curso() then return coalesce(new, old); end if;
  if public.escala_fechamento_fisico_modo() <> 'ativo' or auth.uid() is null then return coalesce(new, old); end if;
  select id into v_u from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if not public.escala_fechamento_apontamento_permitido(old.data, old.periodo_id, v_u) then
    raise exception 'FECHAMENTO_PERIODO_EM_FECHAMENTO: o período % de % já está confirmado; para corrigir é preciso reabrir o período', old.periodo_id, old.data;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.escala_trg_apontamento_fechamento_alteracao() from public, anon, authenticated;

-- gatilho de eventos da escala (fila de recálculo): pula durante a regularização
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'escala_trg_apontamento';
  if v_def is null then raise exception 'escala_trg_apontamento não encontrada'; end if;
  if v_def not like '%regularizacao_em_curso%' then
    v_def := regexp_replace(v_def, E'\nbegin\n  begin\n', E'\nbegin\n  if public.regularizacao_em_curso() then return null; end if;\n  begin\n');
    if v_def not like '%regularizacao_em_curso%' then raise exception 'escala_trg_apontamento: ponto de inserção não reconhecido (revisar a migration)'; end if;
    execute v_def;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- permissão + data liberada (comum às RPCs)
create or replace function public.regularizacao_exigir(p_data date) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  select id into v_user from usuarios where auth_user_id = auth.uid() and ativo = true;
  if v_user is null then raise exception 'Usuário autenticado não encontrado ou inativo'; end if;
  if not (public.is_admin() or public.has_permissao('escala_fechamento_excecao')) then
    raise exception 'REGULARIZACAO_SEM_PERMISSAO: a regularização histórica é restrita a administradores/perfil superior';
  end if;
  if p_data is null or p_data >= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'REGULARIZACAO_DATA_INVALIDA: só é possível regularizar datas anteriores a hoje';
  end if;
  if not exists (select 1 from regularizacao_historica_datas where data = p_data) then
    raise exception 'REGULARIZACAO_DATA_NAO_LIBERADA: a data % não está liberada para regularização histórica', p_data;
  end if;
  return v_user;
end;
$$;

-- estado da tela: datas liberadas, catálogo (máquinas ativas, funcionários ativos, produtos ativos, combinações máquina+produto+operação) e os apontamentos existentes do dia
create or replace function public.regularizacao_historica_estado(p_data date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_res jsonb; v_data date;
begin
  if not (public.is_admin() or public.has_permissao('escala_fechamento_excecao')) then
    raise exception 'REGULARIZACAO_SEM_PERMISSAO: a regularização histórica é restrita a administradores/perfil superior';
  end if;
  v_data := p_data;
  v_res := jsonb_build_object('datas', coalesce((select jsonb_agg(d.data order by d.data desc) from regularizacao_historica_datas d where d.data < (now() at time zone 'America/Sao_Paulo')::date), '[]'::jsonb));
  v_res := v_res || jsonb_build_object(
    'periodos', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'inicio', p.inicio, 'fim', p.fim) order by p.inicio), '[]'::jsonb) from periodos p),
    'maquinas', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome) order by m.nome), '[]'::jsonb) from maquinas m where m.ativo),
    'funcionarios', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome) order by f.nome), '[]'::jsonb) from funcionarios_elegibilidade f where f.ativo),
    'produtos', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome) order by p.nome), '[]'::jsonb) from produtos p where p.ativo),
    'combinacoes', (select coalesce(jsonb_agg(jsonb_build_object('maquina_id', rem.maquina_id, 'produto_id', re.produto_id, 'etapa_id', re.id, 'operacao', o.nome,
        'metas', jsonb_build_object('m1', re.meta_m1, 'm2', re.meta_m2, 'm3', re.meta_m3, 't1', re.meta_t1, 't2', re.meta_t2, 't3', re.meta_t3))), '[]'::jsonb)
      from roteiro_etapas re join roteiro_etapa_maquinas rem on rem.etapa_id = re.id left join operacoes o on o.id = re.operacao_id));
  if v_data is not null and exists (select 1 from regularizacao_historica_datas d where d.data = v_data) then
    v_res := v_res || jsonb_build_object(
      'estado_periodos', (select coalesce(jsonb_agg(jsonb_build_object('periodo_id', e.periodo_id, 'estado', e.estado) order by e.periodo_id), '[]'::jsonb) from escala_fechamento_estado e where e.data = v_data and not e.sombra),
      'apontamentos', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id, 'periodo_id', a.periodo_id, 'maquina_id', a.maquina_id, 'maquina', m.nome, 'funcionario_id', a.funcionario_id, 'funcionario', f.nome,
          'produto_id', a.produto_id, 'produto', pr.nome, 'etapa_id', a.etapa_id, 'operacao', o.nome, 'status', a.status, 'motivo_sem_producao', a.motivo_sem_producao,
          'produzido', a.quantidade_produzida, 'refugo', a.quantidade_refugo, 'regularizado', exists (select 1 from apontamento_regularizacao_historica h where h.apontamento_id = a.id),
          'planejado', (select jsonb_build_object('funcionario', pf.nome, 'produto', pp.nome) from escala_producao_alocacoes al left join funcionarios pf on pf.id = al.funcionario_id left join produtos pp on pp.id = al.produto_id
                         where al.data = a.data and al.periodo_id = a.periodo_id and al.maquina_id = a.maquina_id limit 1))
          order by a.periodo_id, m.nome), '[]'::jsonb)
        from apontamentos_producao a join maquinas m on m.id = a.maquina_id left join funcionarios_elegibilidade f on f.id = a.funcionario_id left join produtos pr on pr.id = a.produto_id
          left join operacoes o on o.id = a.operacao_id where a.data = v_data));
  end if;
  return v_res;
end;
$$;

create or replace function public.regularizar_apontamento_historico(
  p_data date, p_periodo_id text, p_maquina_id uuid, p_funcionario_id uuid, p_produto_id uuid, p_produzido numeric,
  p_refugo numeric default 0, p_etapa_id uuid default null, p_apontamento_id uuid default null, p_substituir boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid; v_ini time; v_fim time; v_maq_ativa boolean; v_prod_ativo boolean; v_valor numeric; v_func_ativo boolean;
  v_qtd int; v_etapa uuid; v_operacao uuid; v_meta numeric; v_custo numeric;
  v_atual apontamentos_producao; v_alvo uuid; v_novo apontamentos_producao; v_acao text; v_anterior jsonb;
  v_obs constant text := 'Ajuste devido à realocação física de máquinas e operadores';
begin
  v_user := public.regularizacao_exigir(p_data);
  perform pg_advisory_xact_lock(hashtextextended('regularizacao|' || p_data::text, 0));
  perform set_config('app.regularizacao_historica', 'on:' || txid_current()::text, true);

  select inicio, fim into v_ini, v_fim from periodos where id = p_periodo_id;
  if not found then raise exception 'PERIODO_INVALIDO: período % não existe', p_periodo_id; end if;
  select ativo into v_maq_ativa from maquinas where id = p_maquina_id;
  if not found then raise exception 'MAQUINA_INVALIDA: máquina não encontrada'; end if;
  if not v_maq_ativa then raise exception 'MAQUINA_INVALIDA: máquina inativa'; end if;
  select ativo, valor_unitario into v_prod_ativo, v_valor from produtos where id = p_produto_id;
  if not found then raise exception 'PRODUTO_INVALIDO: produto não encontrado'; end if;
  if not v_prod_ativo then raise exception 'PRODUTO_INVALIDO: produto inativo'; end if;
  select ativo into v_func_ativo from funcionarios_elegibilidade where id = p_funcionario_id;
  if not found then raise exception 'FUNCIONARIO_INVALIDO: funcionário não encontrado'; end if;
  if not v_func_ativo then raise exception 'FUNCIONARIO_INVALIDO: funcionário inativo'; end if;
  if p_produzido is null or p_produzido < 0 then raise exception 'QUANTIDADE_INVALIDA: quantidade produzida inválida'; end if;
  if p_refugo is null or p_refugo < 0 then raise exception 'QUANTIDADE_INVALIDA: refugo inválido'; end if;
  if p_refugo > p_produzido then raise exception 'QUANTIDADE_INVALIDA: o refugo (%) não pode ser maior que o produzido (%)', p_refugo, p_produzido; end if;

  -- operação: combinação máquina + produto no roteiro; se houver mais de uma etapa possível, a tela manda p_etapa_id
  select count(*) into v_qtd from roteiro_etapas re join roteiro_etapa_maquinas rem on rem.etapa_id = re.id
   where re.produto_id = p_produto_id and rem.maquina_id = p_maquina_id and (p_etapa_id is null or re.id = p_etapa_id);
  if v_qtd = 0 then raise exception 'COMBINACAO_INVALIDA: o produto não tem operação cadastrada para esta máquina (ou a operação escolhida não pertence à combinação)'; end if;
  if v_qtd > 1 then raise exception 'OPERACAO_AMBIGUA: mais de uma operação é possível para este produto nesta máquina — escolha a operação'; end if;
  select re.id, re.operacao_id into v_etapa, v_operacao from roteiro_etapas re join roteiro_etapa_maquinas rem on rem.etapa_id = re.id
   where re.produto_id = p_produto_id and rem.maquina_id = p_maquina_id and (p_etapa_id is null or re.id = p_etapa_id);
  select case p_periodo_id when 'm1' then meta_m1 when 'm2' then meta_m2 when 'm3' then meta_m3 when 't1' then meta_t1 when 't2' then meta_t2 when 't3' then meta_t3 end into v_meta from roteiro_etapas where id = v_etapa;
  if v_meta is null or v_meta <= 0 then raise exception 'META_NAO_CADASTRADA: este produto/operação não tem meta cadastrada para o período % — cadastre a meta para poder lançar', p_periodo_id; end if;
  v_custo := calcular_custo_hora_operacao_vigente(v_operacao);

  select * into v_atual from apontamentos_producao where maquina_id = p_maquina_id and data = p_data and periodo_id = p_periodo_id;
  if p_apontamento_id is null then
    if found then
      if not p_substituir then raise exception 'REGULARIZACAO_JA_EXISTE: já existe apontamento desta máquina neste período — edite ou substitua o existente'; end if;
      v_alvo := v_atual.id;
    end if;
  else
    v_alvo := p_apontamento_id;
    if found and v_atual.id <> p_apontamento_id then raise exception 'REGULARIZACAO_JA_EXISTE: já existe outro apontamento desta máquina neste período'; end if;
  end if;

  if v_alvo is null then
    insert into apontamentos_producao (status, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
        periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, valor_unitario_produto_vigente, idempotency_key, observacao, criado_por)
    values ('produzindo', p_produto_id, v_etapa, v_operacao, p_maquina_id, p_funcionario_id, p_periodo_id, p_data, v_fim, p_produzido, p_refugo,
        v_ini, v_fim, v_meta, v_custo, v_valor, gen_random_uuid(), v_obs, v_user)
    returning * into v_novo;
    v_acao := 'INCLUIDO'; v_anterior := null;
  else
    select * into v_atual from apontamentos_producao where id = v_alvo;
    if not found then raise exception 'APONTAMENTO_INEXISTENTE: apontamento % não encontrado', v_alvo; end if;
    if v_atual.data <> p_data then raise exception 'REGULARIZACAO_DATA_DIVERGENTE: o apontamento é de outra data'; end if;
    v_anterior := to_jsonb(v_atual);
    update apontamentos_producao set status = 'produzindo', produto_id = p_produto_id, etapa_id = v_etapa, operacao_id = v_operacao, maquina_id = p_maquina_id, funcionario_id = p_funcionario_id,
        periodo_id = p_periodo_id, quantidade_produzida = p_produzido, quantidade_refugo = p_refugo, periodo_inicio_vigente = v_ini, periodo_fim_vigente = v_fim, meta_periodo_vigente = v_meta,
        custo_hora_operacao_vigente = v_custo, valor_unitario_produto_vigente = case when v_atual.produto_id is not distinct from p_produto_id and v_atual.valor_unitario_produto_vigente is not null then v_atual.valor_unitario_produto_vigente else v_valor end,
        motivo_sem_producao = null, descricao_sem_producao = null, observacao = v_obs
     where id = v_alvo returning * into v_novo;
    v_acao := 'ALTERADO';
    insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo)
    values (v_alvo, v_anterior, to_jsonb(v_novo), v_user, 'REGULARIZACAO_HISTORICA: ' || v_obs);
  end if;

  insert into apontamento_regularizacao_historica (acao, data, periodo_id, apontamento_id, maquina_id, anterior, novo, usuario_id)
  values (v_acao, p_data, p_periodo_id, v_novo.id, p_maquina_id, v_anterior, to_jsonb(v_novo), v_user);

  perform set_config('app.regularizacao_historica', '', true);   -- o marcador vale só durante a RPC
  return jsonb_build_object('ok', true, 'acao', v_acao, 'apontamento_id', v_novo.id, 'data', p_data, 'periodo_id', p_periodo_id, 'maquina_id', p_maquina_id,
                            'operacao_id', v_operacao, 'etapa_id', v_etapa, 'produzido', p_produzido, 'refugo', p_refugo);
end;
$$;

create or replace function public.regularizar_excluir_apontamento_historico(p_apontamento_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_a apontamentos_producao; v_snap jsonb;
begin
  select * into v_a from apontamentos_producao where id = p_apontamento_id;
  if not found then raise exception 'APONTAMENTO_INEXISTENTE: apontamento não encontrado (talvez já excluído)'; end if;
  v_user := public.regularizacao_exigir(v_a.data);
  perform pg_advisory_xact_lock(hashtextextended('regularizacao|' || v_a.data::text, 0));
  perform set_config('app.regularizacao_historica', 'on:' || txid_current()::text, true);
  v_snap := to_jsonb(v_a) || jsonb_build_object('paradas', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from apontamento_paradas p where p.apontamento_id = v_a.id),
                                              'vinculo_planejado_real', (select to_jsonb(l) from apontamento_planejado_real l where l.apontamento_id = v_a.id limit 1));
  insert into apontamento_regularizacao_historica (acao, data, periodo_id, apontamento_id, maquina_id, anterior, novo, usuario_id)
  values ('EXCLUIDO', v_a.data, v_a.periodo_id, v_a.id, v_a.maquina_id, v_snap, null, v_user);
  delete from apontamentos_producao where id = v_a.id;
  perform set_config('app.regularizacao_historica', '', true);
  return jsonb_build_object('ok', true, 'acao', 'EXCLUIDO', 'apontamento_id', p_apontamento_id);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'regularizacao_historica_estado(date)',
    'regularizar_apontamento_historico(date, text, uuid, uuid, uuid, numeric, numeric, uuid, uuid, boolean)',
    'regularizar_excluir_apontamento_historico(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.regularizacao_exigir(date) from public, anon, authenticated;
revoke all on function public.regularizacao_em_curso() from public, anon, authenticated;
grant execute on function public.regularizacao_em_curso() to authenticated;   -- chamada pelos gatilhos no papel do usuário

commit;

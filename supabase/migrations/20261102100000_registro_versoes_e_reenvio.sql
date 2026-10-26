-- Sittech — Relatório semanal: INTEGRIDADE TEMPORAL do fechamento (estado "como de 18:00" mesmo com exclusões/edições entre 18:00 e a execução do worker) + REENVIO de e-mail já entregue.
--
-- Achado da investigação (apontamentos):
--  • A exclusão é DELETE físico em `excluir_apontamento_producao` (e, só na administração de emergência, nas funções internas de exclusão de funcionário).
--  • O RPC grava ANTES do DELETE uma linha em `apontamento_producao_historico` (FK ON DELETE SET NULL: a linha sobrevive com apontamento_id = NULL), mas o snapshot é PARCIAL
--    (sem etapa_id, operacao_id, hora, criado_em…) e as linhas de EDIÇÃO anteriores do mesmo apontamento perdem o vínculo (SET NULL) — logo não dá para reconstruir o registro eliminado.
--  • UPDATEs que não passam por esse histórico (ex.: fechamento automático de atraso em aberto, unificação de funcionário) não deixam rastro.
-- Solução: UM log temporal genérico, append-only, alimentado por TRIGGER (cobre qualquer caminho de escrita, sem alterar RPCs nem a semântica da Produção Real):
-- `registro_versoes` guarda, para cada INSERT/UPDATE/DELETE de apontamentos_producao, ausencias_funcionarios, previsao_equipe_semana e previsao_dias_produtivos, a linha completa (nova e/ou anterior),
-- o instante (clock_timestamp) e o autor. `escala_relatorio_fontes(semana, como_de)` reconstrói o estado naquele instante a partir dele.
-- Garantia temporal vale DAQUI PARA FRENTE (nenhum backfill: não há dado suficiente para exclusões antigas).

-- =========================================================================
-- 1) Log temporal genérico (append-only)
-- =========================================================================
create table public.registro_versoes (
  id uuid primary key default gen_random_uuid(),
  tabela text not null check (tabela in ('apontamentos_producao', 'ausencias_funcionarios', 'previsao_equipe_semana', 'previsao_dias_produtivos')),
  registro_chave text not null,                       -- id (texto) ou "previsao_id|funcionario_id" / "previsao_id|dia"
  op text not null check (op in ('I', 'U', 'D')),
  registrado_em timestamptz not null default clock_timestamp(),
  ator uuid,                                          -- usuarios.id (sem FK: o log sobrevive a qualquer limpeza); NULL = sistema/serviço
  linha jsonb,                                        -- estado DEPOIS (I/U)
  linha_anterior jsonb,                               -- estado ANTES (U/D)
  constraint registro_versoes_forma check (
    (op = 'I' and linha is not null and linha_anterior is null) or (op = 'U' and linha is not null and linha_anterior is not null) or (op = 'D' and linha is null and linha_anterior is not null))
);
create index idx_registro_versoes_chave on public.registro_versoes (tabela, registro_chave, registrado_em);

create or replace function public.registro_versoes_trg_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'REGISTRO_VERSOES_IMUTAVEL: o log temporal é append-only';
end;
$$;
create trigger trg_registro_versoes_imutavel before update or delete on public.registro_versoes for each row execute function public.registro_versoes_trg_imutavel();

alter table public.registro_versoes enable row level security;
create policy registro_versoes_select on public.registro_versoes for select to authenticated using (public.is_admin());
revoke all on public.registro_versoes from anon, authenticated;
grant select on public.registro_versoes to authenticated, service_role;

create or replace function public.registro_versoes_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb; v_new jsonb; v_base jsonb; v_chave text; v_ator uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  -- UPDATE que só mexe em atualizado_em (ou nada) não é uma versão
  if tg_op = 'UPDATE' and (v_old - 'atualizado_em') = (v_new - 'atualizado_em') then return null; end if;
  v_base := coalesce(v_new, v_old);
  v_chave := case tg_table_name
    when 'previsao_equipe_semana' then (v_base ->> 'previsao_id') || '|' || (v_base ->> 'funcionario_id')
    when 'previsao_dias_produtivos' then (v_base ->> 'previsao_id') || '|' || (v_base ->> 'dia')
    else v_base ->> 'id' end;
  select id into v_ator from public.usuarios where auth_user_id = auth.uid();
  insert into public.registro_versoes (tabela, registro_chave, op, ator, linha, linha_anterior)
  values (tg_table_name, v_chave, left(tg_op, 1), v_ator, v_new, v_old);
  return null;
end;
$$;
revoke all on function public.registro_versoes_trg() from public, anon, authenticated;

create trigger trg_registro_versoes after insert or update or delete on public.apontamentos_producao for each row execute function public.registro_versoes_trg();
create trigger trg_registro_versoes after insert or update or delete on public.ausencias_funcionarios for each row execute function public.registro_versoes_trg();
create trigger trg_registro_versoes after insert or update or delete on public.previsao_equipe_semana for each row execute function public.registro_versoes_trg();
create trigger trg_registro_versoes after insert or update or delete on public.previsao_dias_produtivos for each row execute function public.registro_versoes_trg();

-- =========================================================================
-- 2) Estado de um registro num instante
--    {"v": true,  "l": <linha|null>}  → há versões: "l" é o estado no instante (null = não existia / já excluído)
--    {"v": false}                      → nenhuma versão registrada: o chamador usa o estado atual (ou o histórico legado)
--    Regra: última versão ≤ instante (D → não existe); senão a primeira versão > instante (I → ainda não existia; U/D → linha_anterior).
-- =========================================================================
create or replace function public.registro_estado_em(p_tabela text, p_chave text, p_como_de timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.registro_versoes;
begin
  select * into v from public.registro_versoes r where r.tabela = p_tabela and r.registro_chave = p_chave and r.registrado_em <= p_como_de order by r.registrado_em desc, r.id desc limit 1;
  if found then return jsonb_build_object('v', true, 'l', case when v.op = 'D' then null else v.linha end); end if;
  select * into v from public.registro_versoes r where r.tabela = p_tabela and r.registro_chave = p_chave and r.registrado_em > p_como_de order by r.registrado_em asc, r.id asc limit 1;
  if found then return jsonb_build_object('v', true, 'l', case when v.op = 'I' then null else v.linha_anterior end); end if;
  return jsonb_build_object('v', false);
end;
$$;
revoke all on function public.registro_estado_em(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.registro_estado_em(text, text, timestamptz) to service_role;

-- apontamento no instante: log temporal; sem versões = registro anterior ao log → criado_em + histórico de edição legado (melhor esforço)
create or replace function public.escala_apontamento_em(p_id uuid, p_como_de timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  st jsonb; r public.apontamentos_producao; e jsonb;
begin
  st := public.registro_estado_em('apontamentos_producao', p_id::text, p_como_de);
  if (st ->> 'v')::boolean then return st -> 'l'; end if;
  select * into r from public.apontamentos_producao where id = p_id;
  if not found or r.criado_em > p_como_de then return null; end if;
  select jsonb_object_agg(k.key, k.value order by h.alterado_em desc, h.id desc) into e
    from public.apontamento_producao_historico h, jsonb_each(h.dados_anteriores) k
   where h.apontamento_id = p_id and h.alterado_em > p_como_de and (h.dados_novos ->> 'excluido') is null;
  return to_jsonb(r) || coalesce(e, '{}'::jsonb);
end;
$$;
create or replace function public.escala_ausencia_em(p_id uuid, p_como_de timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  st jsonb; r public.ausencias_funcionarios; e jsonb;
begin
  st := public.registro_estado_em('ausencias_funcionarios', p_id::text, p_como_de);
  if (st ->> 'v')::boolean then return st -> 'l'; end if;
  select * into r from public.ausencias_funcionarios where id = p_id;
  if not found or r.criado_em > p_como_de then return null; end if;
  select jsonb_object_agg(k.key, k.value order by h.alterado_em desc, h.id desc) into e
    from public.ausencia_funcionario_historico h, jsonb_each(h.dados_anteriores) k
   where h.ausencia_id = p_id and h.alterado_em > p_como_de;
  return to_jsonb(r) || coalesce(e, '{}'::jsonb);
end;
$$;
-- linha de equipe/dia produtivo no instante (sem versões = nunca mudou desde o log = vale a atual)
create or replace function public.escala_registro_ou_atual_em(p_tabela text, p_chave text, p_como_de timestamptz, p_atual jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  st jsonb := public.registro_estado_em(p_tabela, p_chave, p_como_de);
begin
  return case when (st ->> 'v')::boolean then st -> 'l' else p_atual end;
end;
$$;
revoke all on function public.escala_apontamento_em(uuid, timestamptz), public.escala_ausencia_em(uuid, timestamptz), public.escala_registro_ou_atual_em(text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.escala_apontamento_em(uuid, timestamptz), public.escala_ausencia_em(uuid, timestamptz), public.escala_registro_ou_atual_em(text, text, timestamptz, jsonb) to service_role;

-- =========================================================================
-- 3) Insumos "como de" um instante — agora com apontamentos/ausências/equipe/dias produtivos pelo log temporal
-- =========================================================================
create or replace function public.escala_relatorio_fontes(p_semana date, p_como_de timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
  v_fim date := p_semana + 6;
  v_ref timestamptz := coalesce(p_como_de, now());
  v_ver public.escala_plano_versoes;
  v_asof boolean := p_como_de is not null;
begin
  select id into v_prev from public.previsoes where semana_inicio = p_semana;
  if v_prev is null then raise exception 'ESCALA_RELATORIO_SEM_PREVISAO: não existe Previsão para a semana %', p_semana; end if;
  select * into v_ver from public.escala_plano_versoes v where v.previsao_id = v_prev and v.valido_desde <= v_ref order by v.valido_desde desc limit 1;

  return jsonb_build_object(
    'agoraBanco', now(),
    'comoDe', p_como_de,
    'semanaInicio', p_semana,
    'previsaoId', v_prev,
    -- plano oficial/períodos: versão do plano vigente no instante; sem versão (modo do replanejamento desligado) vale o atual — e o relatório declara isso
    'reconstrucao', jsonb_build_object('oficial', case when not v_asof then 'atual' when v_ver.id is not null then 'versao' else 'atual' end),
    'diasProdutivos', case
      when v_asof then (
        select coalesce(jsonb_agg(d.dia order by d.dia), '[]'::jsonb) from (
          select c.dia from (
            select x.dia::text dia from public.previsao_dias_produtivos x where x.previsao_id = v_prev
            union select split_part(r.registro_chave, '|', 2) from public.registro_versoes r where r.tabela = 'previsao_dias_produtivos' and r.registro_chave like v_prev::text || '|%'
          ) c
          where coalesce((public.escala_registro_ou_atual_em('previsao_dias_produtivos', v_prev::text || '|' || c.dia, p_como_de,
                  (select to_jsonb(x) from public.previsao_dias_produtivos x where x.previsao_id = v_prev and x.dia::text = c.dia)) ->> 'ativo')::boolean, false)
        ) d)
      else (select coalesce(jsonb_agg(d.dia::text order by d.dia), '[]'::jsonb) from public.previsao_dias_produtivos d where d.previsao_id = v_prev and d.ativo) end,
    'periodosPorDia', case
      when v_asof and v_ver.id is not null then
        (select coalesce(jsonb_object_agg(d ->> 'data', d -> 'periodos_snapshot'), '{}'::jsonb) from jsonb_array_elements(v_ver.dias) d where (d ->> 'data')::date between p_semana and v_fim)
      else
        (select coalesce(jsonb_object_agg(d.data::text, d.periodos_snapshot), '{}'::jsonb) from public.escala_producao_dias d where d.data between p_semana and v_fim)
    end,
    'periodosPadrao', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'inicio', to_char(p.inicio, 'HH24:MI'), 'fim', to_char(p.fim, 'HH24:MI')) order by p.inicio), '[]'::jsonb) from public.periodos p),
    'equipe', case
      when v_asof then (
        select coalesce(jsonb_agg(f.func order by f.func), '[]'::jsonb) from (
          select c.func from (
            select x.funcionario_id::text func from public.previsao_equipe_semana x where x.previsao_id = v_prev
            union select split_part(r.registro_chave, '|', 2) from public.registro_versoes r where r.tabela = 'previsao_equipe_semana' and r.registro_chave like v_prev::text || '|%'
          ) c
          where coalesce((public.escala_registro_ou_atual_em('previsao_equipe_semana', v_prev::text || '|' || c.func, p_como_de,
                  (select to_jsonb(x) from public.previsao_equipe_semana x where x.previsao_id = v_prev and x.funcionario_id::text = c.func)) ->> 'produtivo')::boolean, false)
        ) f)
      else (select coalesce(jsonb_agg(e.funcionario_id order by e.funcionario_id), '[]'::jsonb) from public.previsao_equipe_semana e where e.previsao_id = v_prev and e.produtivo) end,
    'oficial', case
      when v_asof and v_ver.id is not null then
        (select coalesce(jsonb_agg(jsonb_build_object('data', l ->> 0, 'periodoId', l ->> 1, 'funcionarioId', l ->> 2, 'maquinaId', l ->> 3, 'produtoId', l ->> 4, 'operacaoId', l ->> 6,
            'pecas', coalesce((l ->> 7)::numeric, 0), 'origem', case when l ->> 11 = 'm' then 'manual' else 'auto' end, 'motivoSemPosto', l ->> 10, 'excecaoRevezamento', false)
            order by l ->> 0, l ->> 1, l ->> 2), '[]'::jsonb)
           from jsonb_array_elements(v_ver.linhas) l where (l ->> 0)::date between p_semana and v_fim)
      else
        (select coalesce(jsonb_agg(jsonb_build_object(
          'data', a.data, 'periodoId', a.periodo_id, 'funcionarioId', a.funcionario_id, 'maquinaId', a.maquina_id, 'produtoId', a.produto_id,
          'operacaoId', a.operacao_id, 'pecas', a.pecas, 'origem', a.origem, 'motivoSemPosto', a.motivo_sem_posto, 'excecaoRevezamento', a.excecao_revezamento)
          order by a.data, a.periodo_id, a.funcionario_id), '[]'::jsonb)
          from public.escala_producao_alocacoes a where a.data between p_semana and v_fim)
    end,
    'apontamentos', case
      when v_asof then (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', x.l ->> 'id', 'data', x.l ->> 'data', 'periodoId', x.l ->> 'periodo_id', 'maquinaId', x.l ->> 'maquina_id', 'funcionarioId', x.l ->> 'funcionario_id',
            'produtoId', x.l ->> 'produto_id', 'operacaoId', x.l ->> 'operacao_id', 'produzido', (x.l ->> 'quantidade_produzida')::numeric, 'refugo', (x.l ->> 'quantidade_refugo')::numeric,
            'status', x.l ->> 'status', 'motivo', x.l ->> 'motivo_sem_producao')
            order by x.l ->> 'data', x.l ->> 'periodo_id', x.l ->> 'maquina_id', x.l ->> 'id'), '[]'::jsonb)
        from (
          select public.escala_apontamento_em(c.id, p_como_de) l from (
            select ap.id from public.apontamentos_producao ap where ap.data between p_semana and v_fim
            union select r.registro_chave::uuid from public.registro_versoes r
              where r.tabela = 'apontamentos_producao' and ((r.linha ->> 'data')::date between p_semana and v_fim or (r.linha_anterior ->> 'data')::date between p_semana and v_fim)
          ) c
        ) x where x.l is not null and (x.l ->> 'data')::date between p_semana and v_fim)
      else (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', ap.id, 'data', ap.data, 'periodoId', ap.periodo_id, 'maquinaId', ap.maquina_id, 'funcionarioId', ap.funcionario_id, 'produtoId', ap.produto_id, 'operacaoId', ap.operacao_id,
            'produzido', ap.quantidade_produzida, 'refugo', ap.quantidade_refugo, 'status', ap.status, 'motivo', ap.motivo_sem_producao)
            order by ap.data, ap.periodo_id, ap.maquina_id, ap.id), '[]'::jsonb)
        from public.apontamentos_producao ap where ap.data between p_semana and v_fim) end,
    'ausencias', case
      when v_asof then (
        select coalesce(jsonb_agg(jsonb_build_object(
            'funcionarioId', x.l ->> 'funcionario_id', 'data', x.l ->> 'data', 'tipo', x.l ->> 'tipo', 'inicio', x.l ->> 'horario_inicio', 'fim', x.l ->> 'horario_fim', 'emAberto', (x.l ->> 'em_aberto')::boolean)
            order by x.l ->> 'data', x.l ->> 'funcionario_id', x.l ->> 'id'), '[]'::jsonb)
        from (
          select public.escala_ausencia_em(c.id, p_como_de) l from (
            select au.id from public.ausencias_funcionarios au where au.data between p_semana and v_fim
            union select r.registro_chave::uuid from public.registro_versoes r
              where r.tabela = 'ausencias_funcionarios' and ((r.linha ->> 'data')::date between p_semana and v_fim or (r.linha_anterior ->> 'data')::date between p_semana and v_fim)
          ) c
        ) x where x.l is not null and (x.l ->> 'data')::date between p_semana and v_fim)
      else (
        select coalesce(jsonb_agg(jsonb_build_object(
            'funcionarioId', au.funcionario_id, 'data', au.data, 'tipo', au.tipo, 'inicio', au.horario_inicio::text, 'fim', au.horario_fim::text, 'emAberto', au.em_aberto)
            order by au.data, au.funcionario_id, au.id), '[]'::jsonb)
        from public.ausencias_funcionarios au where au.data between p_semana and v_fim) end,
    'ajustesManuais', (select coalesce(jsonb_agg(jsonb_build_object('em', ev.criado_em, 'payload', ev.payload) order by ev.criado_em, ev.id), '[]'::jsonb)
        from public.escala_producao_eventos ev where ev.previsao_id = v_prev and ev.tipo = 'edicao_manual' and ev.criado_em <= v_ref),
    'planoVersao', case when v_ver.id is null then null else jsonb_build_object('id', v_ver.id, 'hashPlano', v_ver.hash_plano, 'validoDesde', v_ver.valido_desde) end,
    'situacaoFuncionarios', (select coalesce(jsonb_agg(jsonb_build_object('funcionarioId', h.funcionario_id, 'acao', h.acao, 'efetivoEm', h.efetivo_em, 'registradoEm', h.registrado_em,
        'ativoAntes', h.ativo_antes, 'ativoDepois', h.ativo_depois) order by h.efetivo_em, h.registrado_em), '[]'::jsonb)
        from public.funcionario_situacao_historico h where h.registrado_em <= v_ref),
    'funcionarios', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome, 'ativo', f.ativo) order by f.nome, f.id), '[]'::jsonb) from public.funcionarios f),
    'maquinas', (select coalesce(jsonb_object_agg(m.id::text, m.nome), '{}'::jsonb) from public.maquinas m),
    'produtos', (select coalesce(jsonb_object_agg(p.id::text, p.nome), '{}'::jsonb) from public.produtos p),
    'operacoes', (select coalesce(jsonb_object_agg(o.id::text, o.nome), '{}'::jsonb) from public.operacoes o)
  );
end;
$$;
revoke all on function public.escala_relatorio_fontes(date, timestamptz) from public, anon, authenticated;
grant execute on function public.escala_relatorio_fontes(date, timestamptz) to service_role;

-- =========================================================================
-- 4) E-mail: histórico de TODOS os envios (reenvio de e-mail já entregue)
--    escala_relatorio_fechamentos.email_enviado_em = PRIMEIRO envio bem-sucedido (nunca sobrescrito); email_envios = quantos envios bem-sucedidos; email_ultimo_envio_em = o mais recente.
-- =========================================================================
alter table public.escala_relatorio_fechamentos add column email_envios integer not null default 0;
alter table public.escala_relatorio_fechamentos add column email_ultimo_envio_em timestamptz;
update public.escala_relatorio_fechamentos set email_envios = 1, email_ultimo_envio_em = email_enviado_em where email_status = 'enviado';

create table public.escala_relatorio_envios (
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null references public.escala_relatorio_fechamentos(id) on delete restrict,
  relatorio_id uuid references public.escala_relatorios(id) on delete restrict,
  destinatario text not null,
  origem text not null check (origem in ('automatico', 'manual')),
  usuario_id uuid,                                    -- quem clicou REENVIAR (NULL = worker)
  ok boolean not null,
  erro text,
  provedor_id text,
  tentativa_em timestamptz not null default now()
);
create index idx_escala_relatorio_envios_fechamento on public.escala_relatorio_envios (fechamento_id, tentativa_em);
create or replace function public.escala_relatorio_envios_trg_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'ESCALA_RELATORIO_ENVIOS_IMUTAVEL: o histórico de envios é append-only';
end;
$$;
create trigger trg_escala_relatorio_envios_imutavel before update or delete on public.escala_relatorio_envios for each row execute function public.escala_relatorio_envios_trg_imutavel();
alter table public.escala_relatorio_envios enable row level security;
create policy escala_relatorio_envios_select on public.escala_relatorio_envios for select to authenticated using (public.has_permissao('escala_relatorios'));
revoke all on public.escala_relatorio_envios from anon, authenticated;
grant select on public.escala_relatorio_envios to authenticated;
grant select, insert on public.escala_relatorio_envios to service_role;
insert into public.escala_relatorio_envios (fechamento_id, relatorio_id, destinatario, origem, ok, provedor_id, tentativa_em)
  select id, relatorio_id, email_destinatario, 'automatico', true, email_provedor_id, email_enviado_em from public.escala_relatorio_fechamentos where email_status = 'enviado';

-- resultado de UMA tentativa de envio (automática ou manual). O PDF nunca é regerado.
drop function if exists public.escala_relatorio_fechamento_email(uuid, boolean, text, text);
create or replace function public.escala_relatorio_fechamento_email(p_id uuid, p_ok boolean, p_erro text default null, p_provedor_id text default null, p_origem text default 'automatico', p_usuario uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f public.escala_relatorio_fechamentos;
begin
  select * into f from public.escala_relatorio_fechamentos where id = p_id for update;
  if not found then raise exception 'fechamento % não existe', p_id; end if;
  insert into public.escala_relatorio_envios (fechamento_id, relatorio_id, destinatario, origem, usuario_id, ok, erro, provedor_id)
  values (f.id, f.relatorio_id, f.email_destinatario, p_origem, p_usuario, p_ok, case when p_ok then null else left(coalesce(p_erro, 'erro'), 500) end, case when p_ok then p_provedor_id else null end);
  update public.escala_relatorio_fechamentos set
    email_tentativas = email_tentativas + 1,
    email_ultima_tentativa_em = now(),
    email_status = case when p_ok or email_status = 'enviado' then 'enviado' else 'falhou' end,   -- falha de um REENVIO não "desenvia" o e-mail já entregue
    email_enviado_em = case when p_ok then coalesce(email_enviado_em, now()) else email_enviado_em end,   -- o primeiro envio nunca é sobrescrito
    email_envios = email_envios + case when p_ok then 1 else 0 end,
    email_ultimo_envio_em = case when p_ok then now() else email_ultimo_envio_em end,
    email_provedor_id = case when p_ok then p_provedor_id else email_provedor_id end,
    email_ultimo_erro = case when p_ok then null else left(coalesce(p_erro, 'erro'), 500) end,
    lease_ate = null, atualizado_em = now()
  where id = p_id;
end;
$$;
revoke all on function public.escala_relatorio_fechamento_email(uuid, boolean, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.escala_relatorio_fechamento_email(uuid, boolean, text, text, text, uuid) to service_role;

-- reivindicar: `p_forcar` permite o REENVIO manual de um relatório já entregue (o worker nunca força)
drop function if exists public.escala_relatorio_fechamento_reivindicar(date, timestamptz, text, integer);
create or replace function public.escala_relatorio_fechamento_reivindicar(p_semana date, p_logico timestamptz, p_destinatario text, p_lease_segundos integer default 240, p_forcar boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare r public.escala_relatorio_fechamentos;
begin
  insert into public.escala_relatorio_fechamentos (semana_inicio, tipo, fechamento_logico_em, email_destinatario)
  values (p_semana, 'executada', p_logico, p_destinatario)
  on conflict (semana_inicio, tipo) do nothing;
  select * into r from public.escala_relatorio_fechamentos where semana_inicio = p_semana and tipo = 'executada' for update;
  if r.geracao_status = 'gerado' and r.email_status = 'enviado' and not p_forcar then return null; end if;   -- tudo feito
  if r.lease_ate is not null and r.lease_ate > now() then return null; end if;                                -- outro worker
  update public.escala_relatorio_fechamentos set lease_ate = now() + make_interval(secs => p_lease_segundos), atualizado_em = now() where id = r.id returning * into r;
  return to_jsonb(r);
end;
$$;
revoke all on function public.escala_relatorio_fechamento_reivindicar(date, timestamptz, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.escala_relatorio_fechamento_reivindicar(date, timestamptz, text, integer, boolean) to service_role;

-- lista interna: e-mail com primeiro envio, último envio e total de envios
create or replace function public.escala_relatorio_listar(p_semana date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permissao('escala_relatorios') then raise exception 'Usuário não tem permissão para consultar relatórios da Escala'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'codigo', r.codigo, 'tipo', r.tipo, 'versao', r.versao, 'status', r.status, 'geradoEm', r.gerado_em,
      'consolidadoAte', r.consolidado_ate, 'geradoPor', u.nome, 'hash', r.hash_sha256, 'pdfBytes', r.pdf_bytes, 'fonteDigest', r.fonte_digest, 'periodosConsiderados', r.periodos_considerados,
      'fechamentoAutomatico', r.fechamento_automatico,
      'email', case when f.id is null then null else jsonb_build_object('status', f.email_status, 'destinatario', f.email_destinatario, 'enviadoEm', f.email_enviado_em,
          'ultimoEnvioEm', f.email_ultimo_envio_em, 'envios', f.email_envios, 'tentativas', f.email_tentativas, 'ultimoErro', f.email_ultimo_erro) end)
      order by r.tipo, r.versao desc)
    from public.escala_relatorios r
    left join public.usuarios u on u.id = r.gerado_por
    left join public.escala_relatorio_fechamentos f on f.relatorio_id = r.id
    where r.semana_inicio = p_semana), '[]'::jsonb);
end;
$$;

-- ROLLBACK: drop dos gatilhos trg_registro_versoes e das funções registro_*/escala_*_em; registro_versoes e escala_relatorio_envios (append-only) podem ficar inertes;
-- restaurar escala_relatorio_fontes/fechamento_email/reivindicar/listar da migration 20261101100000.

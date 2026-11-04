-- Sittech — RELEASE ESTRUTURAL ÚNICA do Fechamento Físico / Liberação de escala.
--   (1) VÍNCULO EXPLÍCITO fechamento → plano (imutável, gravado na MESMA transação do CONFIRMADO). O hash fica só como auditoria.
--   (2) LIBERAÇÃO pelo vínculo: função única `escala_periodo_liberacao` (TV, Produção Real e Escala interna leem a mesma regra). Sem vínculo = NÃO liberado (fail-closed).
--   (3) O estoque físico é a verdade: remove o CHECK que exigia motivo por divergência (o motivo passa a ser OPCIONAL, nunca falso); guarda a diferença percentual.
-- Não altera apontamentos, inventário coletado, corte-v1, portão HARD, catálogo nem plano. Rollback: supabase/rollbacks/20261112100000_escala_liberacao_vinculo_explicito_ROLLBACK.sql
begin;

-- =========================================================================
-- 1) Vínculo explícito fechamento → plano (append-only)
-- =========================================================================
create table if not exists public.escala_fechamento_plano (
  fechamento_id uuid not null references public.escala_fechamentos(id),
  data date not null,                                  -- dia do plano coberto (todos os dias da semana a partir do período fechado)
  previsao_id uuid not null,
  versao integer not null,                             -- escala_producao_dias.versao DESTE plano (a liberação exige que a versão atual seja >= esta)
  hash_plano text,                                     -- auditoria: hash do plano gerado (hash_plano_novo do log)
  metodo text not null check (metodo in ('APLICADO', 'INALTERADO', 'BACKFILL_HASH_HORARIO')),
                                                       -- APLICADO: o recálculo deste fechamento gravou esta versão; INALTERADO: dia não mudou (plano igual ao vigente);
                                                       -- BACKFILL_HASH_HORARIO: fechamentos anteriores a esta migration (vínculo provado por hash+horário, marcado como tal)
  portao_hard text not null default 'APROVADO' check (portao_hard in ('APROVADO', 'BACKFILL')),
  criado_em timestamptz not null default now(),
  primary key (fechamento_id, data)
);
create index if not exists escala_fechamento_plano_data_idx on public.escala_fechamento_plano (data, fechamento_id);

drop trigger if exists trg_escala_fechamento_plano_imutavel on public.escala_fechamento_plano;
create trigger trg_escala_fechamento_plano_imutavel before update or delete on public.escala_fechamento_plano for each row execute function public.escala_fechamento_trg_imutavel();
drop trigger if exists trg_escala_fechamento_plano_imutavel_trunc on public.escala_fechamento_plano;
create trigger trg_escala_fechamento_plano_imutavel_trunc before truncate on public.escala_fechamento_plano for each statement execute function public.escala_fechamento_trg_imutavel();
alter table public.escala_fechamento_plano enable row level security;
drop policy if exists escala_fechamento_plano_leitura on public.escala_fechamento_plano;
create policy escala_fechamento_plano_leitura on public.escala_fechamento_plano for select to authenticated
  using (public.is_admin() or public.has_permissao('escala_producao') or public.has_permissao('escala_fechamento') or public.has_permissao('producao_real_apontamento'));
revoke all on public.escala_fechamento_plano from anon, authenticated;
grant select on public.escala_fechamento_plano to authenticated;
grant select, insert on public.escala_fechamento_plano to service_role;
revoke update, delete, truncate on public.escala_fechamento_plano from service_role;

-- =========================================================================
-- 2) Transição de estado: CONFIRMADO grava o vínculo NA MESMA TRANSAÇÃO (idempotente)
--    detalhe.plano_versoes = {"AAAA-MM-DD": versao} devolvido pela aplicação do recálculo (escala_aplicar_recalculo). Dia sem versão informada
--    (plano não mudou) é vinculado à versão ATUAL com método INALTERADO. Sem plano (hash nulo) NÃO grava vínculo → o período seguinte não é liberado.
-- =========================================================================
create or replace function public.escala_fechamento_resultado(p_fechamento uuid, p_estado text, p_detalhe jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_f public.escala_fechamentos;
  v_hash text := nullif(p_detalhe ->> 'hash_plano_novo', '');
  v_ver jsonb := coalesce(p_detalhe -> 'plano_versoes', '{}'::jsonb);
  v_prev uuid;
begin
  if p_estado not in ('RECALCULANDO', 'CONFIRMADO', 'ERRO_RECALCULO') then raise exception 'FECHAMENTO_ESTADO_INVALIDO: %', p_estado; end if;
  insert into public.escala_fechamento_log (fechamento_id, estado, detalhe) values (p_fechamento, p_estado, coalesce(p_detalhe, '{}'::jsonb));
  if p_estado = 'CONFIRMADO' then
    update public.escala_producao_eventos set status = 'processado', processado_em = now()
     where tipo = 'fechamento_fisico' and payload->>'fechamento_id' = p_fechamento::text and status in ('pendente', 'processando', 'erro');
    -- vínculo explícito (não vale para modo sombra: o plano oficial não foi gerado por ele)
    if v_hash is not null and coalesce(p_detalhe ->> 'sombra', 'false') <> 'true' then
      select * into v_f from public.escala_fechamentos where id = p_fechamento;
      select previsao_id into v_prev from public.escala_producao_dias where data = v_f.data limit 1;
      if v_prev is not null then
        insert into public.escala_fechamento_plano (fechamento_id, data, previsao_id, versao, hash_plano, metodo)
        select p_fechamento, d.data, d.previsao_id,
               coalesce((v_ver ->> d.data::text)::integer, d.versao),
               v_hash,
               case when v_ver ? d.data::text then 'APLICADO' else 'INALTERADO' end
          from public.escala_producao_dias d
         where d.previsao_id = v_prev and d.data >= v_f.data
        on conflict (fechamento_id, data) do nothing;
      end if;
    end if;
  end if;
end;
$$;

-- BACKFILL: fechamentos já CONFIRMADOS antes desta migration (ex.: M2→M3 e M3→T1 de 04/11) — vínculo provado pela mesma evidência transitória
-- (hash do log = diagnóstico 'fechamento' aplicado E dia regravado depois do fechamento). Marcado BACKFILL_HASH_HORARIO; nada é inventado: sem prova, sem vínculo.
insert into public.escala_fechamento_plano (fechamento_id, data, previsao_id, versao, hash_plano, metodo, portao_hard)
select e.fechamento_id, d.data, d.previsao_id, d.versao, e.detalhe ->> 'hash_plano_novo', 'BACKFILL_HASH_HORARIO', 'BACKFILL'
  from public.escala_fechamento_estado e
  join public.escala_fechamentos f on f.id = e.fechamento_id
  join public.escala_producao_dias d on d.previsao_id = (select previsao_id from public.escala_producao_dias x where x.data = f.data limit 1) and d.data >= f.data
 where e.estado = 'CONFIRMADO' and not e.sombra and nullif(e.detalhe ->> 'hash_plano_novo', '') is not null
   and exists (select 1 from public.escala_fluxo_diagnosticos g where g.gatilho = 'fechamento' and g.aplicado = true and g.hash_plano_fluxo = e.detalhe ->> 'hash_plano_novo')
   and exists (select 1 from public.escala_producao_dias dd where dd.data = f.data and dd.atualizado_em >= f.fechado_em)
on conflict (fechamento_id, data) do nothing;

-- =========================================================================
-- 3) FUNÇÃO ÚNICA DE LIBERAÇÃO (pelo vínculo explícito)
--    liberado  <=>  fechamento do período ANTERIOR existe (oficial) E estado CONFIRMADO E vínculo fechamento→plano gravado para o dia
--                   E a versão ATUAL do dia >= versão vinculada (o plano não regrediu) E o portão HARD foi aprovado (CONFIRMADO só existe se o portão aprovou).
--    Qualquer dúvida => NÃO liberado. Plano existir no banco NUNCA libera.
-- =========================================================================
create or replace function public.escala_periodo_liberacao(p_data date, p_periodo text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_modo text := public.escala_fechamento_fisico_modo();
  v_desde jsonb := coalesce((select valor from public.escala_parametros where chave = 'escala_liberacao_desde'), '{"data":"2026-11-04","periodo":"m3"}'::jsonb);
  v_desde_data date := (v_desde ->> 'data')::date;
  v_slot record; v_ant record; v_dinicio text; v_e record; v_conf timestamptz; v_pred jsonb; v_vinc record; v_atual integer;
begin
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
$$;

-- =========================================================================
-- 4) O FÍSICO É A VERDADE: sem motivo obrigatório por divergência. Diferença absoluta (já existe, gerada) + percentual (nova, gerada) ficam armazenadas.
--    Usuário e instante: escala_fechamentos.fechado_por / fechado_em / contado_em; por linha: criado_em.
-- =========================================================================
alter table public.escala_fechamento_buffers drop constraint if exists escala_fechamento_buffers_motivo;
alter table public.escala_fechamento_buffers add column if not exists diferenca_pct numeric
  generated always as (case when saldo_fisico is not null and saldo_estimado is not null and saldo_estimado > 0 then round((saldo_fisico - saldo_estimado) / saldo_estimado * 100, 2) end) stored;
comment on column public.escala_fechamento_buffers.motivo is 'OPCIONAL. Nunca exigido por divergência: o estoque físico informado é a verdade. Linhas anteriores a 04/11 podem trazer texto automático antigo.';

-- =========================================================================
-- 5) Sem caminhos concorrentes (auditoria 04/11)
--    5a) Editar/converter/excluir apontamento de período em fechamento/FECHADO era permitido (o gatilho só barrava INSERT): inventário e plano ficariam defasados.
--        Com o fechamento ATIVO, UPDATE/DELETE seguem a MESMA regra do INSERT (só o responsável pela janela; período fechado só com reabertura). Sem usuário autenticado
--        (service_role/jobs/SQL administrativo) nada muda.
--    5b) Mudar `escala_liberacao_desde` não pode enfileirar recálculo (gatilho de parâmetros).
-- =========================================================================
create or replace function public.escala_trg_apontamento_fechamento_alteracao()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u uuid;
begin
  if public.escala_fechamento_fisico_modo() <> 'ativo' or auth.uid() is null then return coalesce(new, old); end if;
  select id into v_u from public.usuarios where auth_user_id = auth.uid() and ativo = true;
  if not public.escala_fechamento_apontamento_permitido(old.data, old.periodo_id, v_u) then
    raise exception 'FECHAMENTO_PERIODO_EM_FECHAMENTO: o período % de % está em fechamento/fechado; o apontamento só pode ser alterado pelo responsável pelo fechamento (período fechado: reabra o fechamento)', old.periodo_id, old.data;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_apontamentos_producao_fechamento_alteracao on public.apontamentos_producao;
create trigger trg_apontamentos_producao_fechamento_alteracao before update or delete on public.apontamentos_producao for each row execute function public.escala_trg_apontamento_fechamento_alteracao();

do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'escala_trg_parametros';
  if v_def is null then raise exception 'escala_trg_parametros não encontrada'; end if;
  if v_def not like '%escala_liberacao_desde%' then
    v_def := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  if coalesce(new.chave, old.chave) = ''escala_liberacao_desde'' then\n    return null; -- a data de transição da liberação nunca dispara recálculo\n  end if;\n');
    if v_def not like '%escala_liberacao_desde%' then raise exception 'escala_trg_parametros: ponto de inserção não reconhecido (revisar a migration)'; end if;
    execute v_def;
  end if;
end $$;

commit;

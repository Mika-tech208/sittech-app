-- Sittech — ANTECIPAÇÃO PARA A SEMANA SEGUINTE e FORMAÇÃO DELIBERADA DE ESTOQUE: rastreio append-only + RPC atômica. ADITIVA e INERTE enquanto
-- `escala_antecipacao_modo` não for 'ativo' (chave ausente = desligado): nenhuma linha é gravada, a RPC antiga continua sendo a usada pelo recálculo.
-- Ver docs/antecipacao-semana-seguinte.md. Reversão: supabase/rollbacks/20261118100000_rollback_antecipacao_semana_seguinte.sql
--
--  (1) escala_antecipacoes: LEDGER de toda produção feita ALÉM da demanda da semana (origem ANTECIPACAO_SEMANA_SEGUINTE | FORMACAO_ESTOQUE) e, só nos postos mistos, a parte da DEMANDA_SEMANA
--      (para saber o "A × B" do posto). Append-only: sem DELETE/TRUNCATE e UPDATE só para marcar a linha como SUBSTITUÍDA (substituida_em / substituida_por_hash). Sem FKs de propósito (auditoria
--      sobrevive a cadastros); RLS ligada e SEM políticas (só service_role, que ignora RLS).
--  (2) REGRA DE SUBSTITUIÇÃO: regerar o plano marca como substituídas as linhas VIGENTES cujo período é >= ao ponto de corte (futuras, não iniciadas) e insere as novas; linhas de períodos
--      já iniciados/fechados NUNCA são tocadas (o corte é validado pela própria RPC do plano, que recusa corte no passado).
--  (3) escala_aplicar_recalculo_antecipacao = escala_aplicar_recalculo + registro, na MESMA transação (plano e registro andam juntos ou nenhum dos dois).
--      Se o total antecipado para uma semana de destino mudou, registra um evento 'previsao' para a semana de destino (recalcula se ela já tem escala: o desconto é aplicado).
--  (4) as três chaves de escala_parametros da regra NUNCA disparam recálculo (como escala_liberacao_desde): a regra vale a partir do próximo recálculo natural.
begin;

create table if not exists public.escala_antecipacoes (
  id uuid primary key default gen_random_uuid(),
  origem text not null check (origem in ('DEMANDA_SEMANA', 'ANTECIPACAO_SEMANA_SEGUINTE', 'FORMACAO_ESTOQUE')),
  semana_origem date not null,
  semana_destino date,
  previsao_origem_id uuid not null,
  data date not null,
  periodo_id text not null,
  produto_id uuid not null,
  etapa_id uuid not null,
  etapa_idx integer not null,
  etapa_final boolean not null,
  operacao_id uuid,
  maquina_id uuid not null,
  funcionario_id uuid,
  quantidade numeric(14,3) not null check (quantidade >= 0),
  plano_hash text not null,
  plano_versao_dia integer,
  regra text not null default 'corte-v1',
  autorizado_em timestamptz not null default now(),
  autorizado_por uuid,
  substituida_em timestamptz,
  substituida_por_hash text,
  check (origem <> 'ANTECIPACAO_SEMANA_SEGUINTE' or semana_destino is not null)
);
comment on table public.escala_antecipacoes is 'Ledger append-only da produção além da demanda da semana (antecipação para a semana seguinte / formação de estoque). Só service_role.';
create index if not exists escala_antecipacoes_destino_idx on public.escala_antecipacoes (semana_destino) where substituida_em is null;
create index if not exists escala_antecipacoes_origem_idx on public.escala_antecipacoes (semana_origem) where substituida_em is null;
create index if not exists escala_antecipacoes_posto_idx on public.escala_antecipacoes (data, periodo_id, maquina_id);

alter table public.escala_antecipacoes enable row level security;
revoke all on public.escala_antecipacoes from public, anon, authenticated;
grant select, insert, update on public.escala_antecipacoes to service_role;

create or replace function public.escala_antecipacoes_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'ANTECIPACAO_APPEND_ONLY: escala_antecipacoes não admite % (marque a linha como substituída)', tg_op using errcode = 'P0001';
  end if;
  -- UPDATE: só a transição única "vigente → substituída"; nenhuma outra coluna pode mudar
  if old.substituida_em is not null
     or new.substituida_em is null
     or (to_jsonb(new) - 'substituida_em' - 'substituida_por_hash') is distinct from (to_jsonb(old) - 'substituida_em' - 'substituida_por_hash') then
    raise exception 'ANTECIPACAO_APPEND_ONLY: só é permitido marcar uma linha vigente como substituída' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.escala_antecipacoes_append_only() from public, anon, authenticated;
drop trigger if exists trg_escala_antecipacoes_append_only on public.escala_antecipacoes;
create trigger trg_escala_antecipacoes_append_only before update or delete on public.escala_antecipacoes for each row execute function public.escala_antecipacoes_append_only();
drop trigger if exists trg_escala_antecipacoes_no_truncate on public.escala_antecipacoes;
create trigger trg_escala_antecipacoes_no_truncate before truncate on public.escala_antecipacoes for each statement execute function public.escala_antecipacoes_append_only();

create or replace function public.escala_antecipacao_registrar(
  p_previsao_id uuid, p_semana_origem date, p_a_partir_data date, p_a_partir_periodo text, p_linhas jsonb, p_plano_hash text, p_usuario_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snap jsonb; v_corte integer; v_antes jsonb; v_depois jsonb; v_chave text; v_dest date; v_prev uuid;
  v_sub integer := 0; v_ins integer := 0; v_eventos integer := 0;
begin
  if p_previsao_id is null or p_semana_origem is null or p_plano_hash is null then raise exception 'ANTECIPACAO_PARAMETROS_OBRIGATORIOS'; end if;
  select periodos_snapshot into v_snap from public.escala_producao_dias where data = p_a_partir_data;
  if v_snap is null then raise exception 'ANTECIPACAO_CORTE_INVALIDO: não existe escala para % (corte %)', p_a_partir_data, p_a_partir_periodo; end if;
  select ord::integer into v_corte from jsonb_array_elements(v_snap) with ordinality as e(v, ord) where e.v->>'id' = p_a_partir_periodo;
  if v_corte is null then raise exception 'ANTECIPACAO_PERIODO_INVALIDO: %', p_a_partir_periodo; end if;

  -- nenhuma linha nova pode cair em período congelado (iniciado) — o histórico é imutável
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_linhas, '[]'::jsonb)) as x(data date, periodo_id text)
    where x.data < p_a_partir_data
       or (x.data = p_a_partir_data and coalesce((select ord::integer from jsonb_array_elements(v_snap) with ordinality as e(v, ord) where e.v->>'id' = x.periodo_id), 0) < v_corte)
  ) then
    raise exception 'ANTECIPACAO_PERIODO_CONGELADO: tentativa de registrar produção extra em período já iniciado';
  end if;

  select coalesce(jsonb_object_agg(k, q), '{}'::jsonb) into v_antes from (
    select semana_destino::text || '|' || produto_id::text as k, sum(quantidade) as q from public.escala_antecipacoes
     where previsao_origem_id = p_previsao_id and origem = 'ANTECIPACAO_SEMANA_SEGUINTE' and etapa_final and substituida_em is null group by 1) t;

  -- substitui só o FUTURO (>= corte) deste plano; períodos iniciados/fechados ficam como estão
  update public.escala_antecipacoes a set substituida_em = now(), substituida_por_hash = p_plano_hash
   where a.previsao_origem_id = p_previsao_id and a.substituida_em is null
     and (a.data > p_a_partir_data
          or (a.data = p_a_partir_data and coalesce((select ord::integer from jsonb_array_elements(v_snap) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id), 0) >= v_corte));
  get diagnostics v_sub = row_count;

  insert into public.escala_antecipacoes (origem, semana_origem, semana_destino, previsao_origem_id, data, periodo_id, produto_id, etapa_id, etapa_idx, etapa_final, operacao_id, maquina_id, funcionario_id, quantidade, plano_hash, plano_versao_dia, autorizado_por)
  select x.origem, p_semana_origem, x.semana_destino, p_previsao_id, x.data, x.periodo_id, x.produto_id, x.etapa_id, x.etapa_idx, x.etapa_final, x.operacao_id, x.maquina_id, x.funcionario_id, x.quantidade, p_plano_hash,
         (select d.versao from public.escala_producao_dias d where d.data = x.data), p_usuario_id
    from jsonb_to_recordset(coalesce(p_linhas, '[]'::jsonb)) as x(origem text, semana_destino date, data date, periodo_id text, produto_id uuid, etapa_id uuid, etapa_idx integer, etapa_final boolean, operacao_id uuid, maquina_id uuid, funcionario_id uuid, quantidade numeric)
   where x.quantidade > 0;
  get diagnostics v_ins = row_count;

  select coalesce(jsonb_object_agg(k, q), '{}'::jsonb) into v_depois from (
    select semana_destino::text || '|' || produto_id::text as k, sum(quantidade) as q from public.escala_antecipacoes
     where previsao_origem_id = p_previsao_id and origem = 'ANTECIPACAO_SEMANA_SEGUINTE' and etapa_final and substituida_em is null group by 1) t;

  -- o total antecipado para uma semana de destino mudou ⇒ o plano dela (se já existe) precisa descontá-lo: evento de recálculo da Previsão de destino
  for v_chave in select k from (select jsonb_object_keys(v_antes) k union select jsonb_object_keys(v_depois)) u loop
    if (v_antes -> v_chave) is distinct from (v_depois -> v_chave) then
      v_dest := split_part(v_chave, '|', 1)::date;
      select id into v_prev from public.previsoes where semana_inicio = v_dest;
      if v_prev is not null then
        perform public.escala_registrar_evento('previsao', v_prev, jsonb_build_object('tabela', 'escala_antecipacoes', 'semana_origem', p_semana_origem, 'semana_destino', v_dest), p_usuario_id);
        v_eventos := v_eventos + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('substituidas', v_sub, 'inseridas', v_ins, 'eventos_destino', v_eventos);
end;
$$;
revoke all on function public.escala_antecipacao_registrar(uuid, date, date, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.escala_antecipacao_registrar(uuid, date, date, text, jsonb, text, uuid) to service_role;

create or replace function public.escala_aplicar_recalculo_antecipacao(
  p_previsao_id uuid, p_dias jsonb, p_a_partir_data date, p_a_partir_periodo text, p_alocacoes jsonb, p_usuario_id uuid, p_evento_ids uuid[], p_resumo jsonb, p_remover_dias date[],
  p_antecipacoes jsonb, p_plano_hash text, p_semana_origem date
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare v jsonb; r jsonb;
begin
  v := public.escala_aplicar_recalculo(p_previsao_id, p_dias, p_a_partir_data, p_a_partir_periodo, p_alocacoes, p_usuario_id, p_evento_ids, p_resumo, p_remover_dias);
  r := public.escala_antecipacao_registrar(p_previsao_id, p_semana_origem, p_a_partir_data, p_a_partir_periodo, p_antecipacoes, p_plano_hash, p_usuario_id);
  return v || jsonb_build_object('antecipacao', r);
end;
$$;
revoke all on function public.escala_aplicar_recalculo_antecipacao(uuid, jsonb, date, text, jsonb, uuid, uuid[], jsonb, date[], jsonb, text, date) from public, anon, authenticated;
grant execute on function public.escala_aplicar_recalculo_antecipacao(uuid, jsonb, date, text, jsonb, uuid, uuid[], jsonb, date[], jsonb, text, date) to service_role;

-- (4) as chaves da regra nunca disparam recálculo (mesmo padrão de escala_liberacao_desde / apontamento_simplificado_modo)
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'escala_trg_parametros';
  if v_def is null then raise exception 'escala_trg_parametros não encontrada'; end if;
  if v_def not like '%escala_antecipacao_modo%' then
    v_def := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  if coalesce(new.chave, old.chave) in (''escala_antecipacao_modo'', ''escala_formacao_estoque_produtos'', ''escala_formacao_estoque_desconta_destino'') then\n    return null; -- antecipação/formação de estoque: nunca dispara recálculo (vale no próximo recálculo natural)\n  end if;\n');
    if v_def not like '%escala_antecipacao_modo%' then raise exception 'escala_trg_parametros: ponto de inserção não reconhecido (revisar a migration)'; end if;
    execute v_def;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;

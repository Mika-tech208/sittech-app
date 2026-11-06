-- Reversão de 20261118110000_antecipacao_meta_minima_estoque.sql (a tabela e a RPC de 20261118100000 continuam). ATENÇÃO: apaga os valores das duas colunas novas.
begin;
drop view if exists public.escala_meta_estoque_v;
-- volta o registrar à versão de 20261118100000 (sem as colunas novas); o rollback completo da regra é supabase/rollbacks/20261118100000_rollback_antecipacao_semana_seguinte.sql
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
alter table public.escala_antecipacoes drop column if exists quantidade_alem_da_meta;
alter table public.escala_antecipacoes drop column if exists meta_minima_producao;
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'escala_trg_parametros';
  if v_def like '%escala_antecipacao_semana_seguinte%' then
    v_def := regexp_replace(v_def, E'\n  if coalesce\\(new.chave, old.chave\\) = ''escala_antecipacao_semana_seguinte''[^\n]*\n[^\n]*\n  end if;', '');
    if v_def like '%escala_antecipacao_semana_seguinte%' then raise exception 'rollback: trecho do trigger não reconhecido'; end if;
    execute v_def;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;

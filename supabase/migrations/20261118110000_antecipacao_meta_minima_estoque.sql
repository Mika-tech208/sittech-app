-- Sittech — META MÍNIMA DE PRODUÇÃO × FORMAÇÃO DE ESTOQUE (complemento ADITIVO de 20261118100000; não altera o que já foi aplicado, só acrescenta).
-- A quantidade da Previsão é a META MÍNIMA da semana (não um teto). Tudo que um produto AUTORIZADO produz além dela é FORMACAO_ESTOQUE e fica registrado com a meta e a quantidade além da meta.
--   (1) escala_antecipacoes ganha meta_minima_producao e quantidade_alem_da_meta (nulláveis/default 0 ⇒ linhas antigas continuam válidas; o trigger append-only não muda).
--   (2) escala_antecipacao_registrar passa a gravar as duas colunas (mesma assinatura; p_linhas sem as chaves ⇒ NULL / 0).
--   (3) escala_antecipacao_semana_seguinte (opt-in da ANTECIPAÇÃO com desconto) também nunca dispara recálculo.
--   (4) VIEW escala_meta_estoque_v: META MÍNIMA × PRODUÇÃO PLANEJADA × PRODUÇÃO REAL × FORMAÇÃO DE ESTOQUE, por semana e produto (somente leitura; security_invoker).
-- Reversão: supabase/rollbacks/20261118110000_rollback_antecipacao_meta_minima_estoque.sql
begin;

alter table public.escala_antecipacoes add column if not exists meta_minima_producao numeric;
alter table public.escala_antecipacoes add column if not exists quantidade_alem_da_meta numeric not null default 0;
comment on column public.escala_antecipacoes.meta_minima_producao is 'Meta mínima de produção do produto na semana de origem (quantidade da Previsão) no momento do plano.';
comment on column public.escala_antecipacoes.quantidade_alem_da_meta is 'Quantidade desta linha que está ALÉM da meta mínima (FORMACAO_ESTOQUE: toda a linha; demais origens: 0).';

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

  update public.escala_antecipacoes a set substituida_em = now(), substituida_por_hash = p_plano_hash
   where a.previsao_origem_id = p_previsao_id and a.substituida_em is null
     and (a.data > p_a_partir_data
          or (a.data = p_a_partir_data and coalesce((select ord::integer from jsonb_array_elements(v_snap) with ordinality as e(v, ord) where e.v->>'id' = a.periodo_id), 0) >= v_corte));
  get diagnostics v_sub = row_count;

  insert into public.escala_antecipacoes (origem, semana_origem, semana_destino, previsao_origem_id, data, periodo_id, produto_id, etapa_id, etapa_idx, etapa_final, operacao_id, maquina_id, funcionario_id, quantidade, plano_hash, plano_versao_dia, autorizado_por, meta_minima_producao, quantidade_alem_da_meta)
  select x.origem, p_semana_origem, x.semana_destino, p_previsao_id, x.data, x.periodo_id, x.produto_id, x.etapa_id, x.etapa_idx, x.etapa_final, x.operacao_id, x.maquina_id, x.funcionario_id, x.quantidade, p_plano_hash,
         (select d.versao from public.escala_producao_dias d where d.data = x.data), p_usuario_id, x.meta_minima_producao, coalesce(x.quantidade_alem_da_meta, 0)
    from jsonb_to_recordset(coalesce(p_linhas, '[]'::jsonb)) as x(origem text, semana_destino date, data date, periodo_id text, produto_id uuid, etapa_id uuid, etapa_idx integer, etapa_final boolean, operacao_id uuid, maquina_id uuid, funcionario_id uuid, quantidade numeric, meta_minima_producao numeric, quantidade_alem_da_meta numeric)
   where x.quantidade > 0;
  get diagnostics v_ins = row_count;

  select coalesce(jsonb_object_agg(k, q), '{}'::jsonb) into v_depois from (
    select semana_destino::text || '|' || produto_id::text as k, sum(quantidade) as q from public.escala_antecipacoes
     where previsao_origem_id = p_previsao_id and origem = 'ANTECIPACAO_SEMANA_SEGUINTE' and etapa_final and substituida_em is null group by 1) t;

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

-- (3) nova chave nunca dispara recálculo
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'escala_trg_parametros';
  if v_def is null then raise exception 'escala_trg_parametros não encontrada'; end if;
  if v_def not like '%escala_antecipacao_semana_seguinte%' then
    v_def := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  if coalesce(new.chave, old.chave) = ''escala_antecipacao_semana_seguinte'' then\n    return null; -- opt-in da antecipação da meta da semana seguinte: nunca dispara recálculo\n  end if;\n');
    if v_def not like '%escala_antecipacao_semana_seguinte%' then raise exception 'escala_trg_parametros: ponto de inserção não reconhecido (revisar a migration)'; end if;
    execute v_def;
  end if;
end $$;

-- (4) META MÍNIMA × PLANEJADA × REAL × FORMAÇÃO, por semana e produto. Etapa FINAL = a de maior `ordem` do roteiro do produto; linhas compartilhadas usam `distribuicao`.
--  planejada = Σ peças das alocações do plano vigente na etapa final · real = Σ apontamentos 'produzindo' da etapa final na semana
--  formacao_registrada = Σ ledger FORMACAO_ESTOQUE vigente (etapa final) · alem_da_meta_* = max(0, produzido − meta) · NÃO é erro nem excesso.
create or replace view public.escala_meta_estoque_v with (security_invoker = true) as
with fin as (
  select distinct on (produto_id) produto_id, id as etapa_final_id from public.roteiro_etapas order by produto_id, ordem desc
), meta as (
  select p.semana_inicio, p.id as previsao_id, pi.produto_id, sum(pi.quantidade) as meta_minima_producao
    from public.previsoes p join public.previsao_itens pi on pi.previsao_id = p.id where pi.tipo = 'previsto' group by 1, 2, 3
), planejada as (
  select d.previsao_id, x.produto_id, sum(x.pecas) as producao_planejada
    from public.escala_producao_alocacoes a
    join public.escala_producao_dias d on d.data = a.data
    cross join lateral jsonb_to_recordset(coalesce(a.distribuicao, jsonb_build_array(jsonb_build_object('produto_id', a.produto_id, 'etapa_id', a.etapa_id, 'pecas', a.pecas)))) as x(produto_id uuid, etapa_id uuid, pecas numeric)
    join fin f on f.produto_id = x.produto_id and f.etapa_final_id = x.etapa_id
   where a.maquina_id is not null group by 1, 2
), real as (
  select m.previsao_id, ap.produto_id, sum(ap.quantidade_produzida) as producao_real
    from meta m join public.apontamentos_producao ap on ap.produto_id = m.produto_id and ap.data between m.semana_inicio and m.semana_inicio + 6 and ap.status = 'produzindo'
    join fin f on f.produto_id = ap.produto_id and f.etapa_final_id = ap.etapa_id group by 1, 2
), form as (
  select previsao_origem_id as previsao_id, produto_id, sum(quantidade) as formacao_registrada
    from public.escala_antecipacoes where origem = 'FORMACAO_ESTOQUE' and etapa_final and substituida_em is null group by 1, 2
)
select m.semana_inicio, m.produto_id, m.meta_minima_producao,
       coalesce(pl.producao_planejada, 0) as producao_planejada, coalesce(r.producao_real, 0) as producao_real,
       coalesce(f.formacao_registrada, 0) as formacao_estoque_registrada,
       greatest(0, coalesce(pl.producao_planejada, 0) - m.meta_minima_producao) as alem_da_meta_planejado,
       greatest(0, coalesce(r.producao_real, 0) - m.meta_minima_producao) as alem_da_meta_real
  from meta m left join planejada pl on pl.previsao_id = m.previsao_id and pl.produto_id = m.produto_id
  left join real r on r.previsao_id = m.previsao_id and r.produto_id = m.produto_id
  left join form f on f.previsao_id = m.previsao_id and f.produto_id = m.produto_id;
revoke all on public.escala_meta_estoque_v from public, anon, authenticated;
grant select on public.escala_meta_estoque_v to service_role;

notify pgrst, 'reload schema';
commit;

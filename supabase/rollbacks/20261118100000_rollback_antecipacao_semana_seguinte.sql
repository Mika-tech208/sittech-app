-- Reversão de 20261118100000_antecipacao_semana_seguinte.sql. ATENÇÃO: apaga o ledger escala_antecipacoes (auditoria da produção extra). Antes de rodar, exporte-o se ainda for preciso.
-- Antes do rollback, desligue a regra: delete from escala_parametros where chave in ('escala_antecipacao_modo','escala_formacao_estoque_produtos','escala_formacao_estoque_desconta_destino');
begin;
drop function if exists public.escala_aplicar_recalculo_antecipacao(uuid, jsonb, date, text, jsonb, uuid, uuid[], jsonb, date[], jsonb, text, date);
drop function if exists public.escala_antecipacao_registrar(uuid, date, date, text, jsonb, text, uuid);
alter table if exists public.escala_antecipacoes disable trigger trg_escala_antecipacoes_append_only;
alter table if exists public.escala_antecipacoes disable trigger trg_escala_antecipacoes_no_truncate;
drop table if exists public.escala_antecipacoes;
drop function if exists public.escala_antecipacoes_append_only();
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'escala_trg_parametros';
  if v_def like '%escala_antecipacao_modo%' then
    v_def := regexp_replace(v_def, E'\n  if coalesce\\(new.chave, old.chave\\) in \\(''escala_antecipacao_modo''[^\n]*\n[^\n]*\n  end if;', '');
    if v_def like '%escala_antecipacao_modo%' then raise exception 'rollback: trecho do trigger não reconhecido'; end if;
    execute v_def;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;

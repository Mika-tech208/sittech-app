-- Reversão de 20261118110000_antecipacao_meta_minima_estoque.sql (a tabela e a RPC de 20261118100000 continuam). ATENÇÃO: apaga os valores das duas colunas novas.
begin;
drop view if exists public.escala_meta_estoque_v;
-- volta o registrar à versão de 20261118100000 (sem as colunas novas): reaplicar o corpo daquela migration para a função
-- (o rollback completo da regra é supabase/rollbacks/20261118100000_rollback_antecipacao_semana_seguinte.sql)
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

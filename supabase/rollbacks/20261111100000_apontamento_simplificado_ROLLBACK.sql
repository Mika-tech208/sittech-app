-- ROLLBACK do apontamento simplificado. Não toca em NENHUM apontamento (apontamentos_producao fica como está; só o vínculo planejado×real é arquivado e removido).
-- Antes de rodar: apontamento_simplificado_modo = '"desligado"' (a tela volta ao fluxo anterior sozinha) — este script já faz isso.
update public.escala_parametros set valor = '"desligado"' where chave = 'apontamento_simplificado_modo';  -- fora da transação (evita pending trigger events no ALTER)
begin;
create table if not exists public.apontamento_planejado_real_arquivo as select * from public.apontamento_planejado_real;
drop function if exists public.registrar_apontamentos_fechamento(date, text, jsonb);
drop table if exists public.apontamento_planejado_real;
drop function if exists public.apr_trg_imutavel();
drop function if exists public.apontamento_simplificado_modo();
alter table public.escala_parametros drop constraint if exists escala_parametros_apontamento_simplificado_modo;
delete from public.escala_parametros where chave = 'apontamento_simplificado_modo';
-- devolve o gatilho de parâmetros (remove só a saída antecipada desta flag)
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'escala_trg_parametros';
  if v_def like '%a flag do apontamento simplificado nunca dispara recálculo%' then
    execute replace(v_def, E'  if coalesce(new.chave, old.chave) = ''apontamento_simplificado_modo'' then\n    return null; -- a flag do apontamento simplificado nunca dispara recálculo\n  end if;\n', '');
  end if;
end $$;
commit;

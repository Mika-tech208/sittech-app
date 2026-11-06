-- Remove a tabela SOMENTE se estiver vazia (não apaga execução real registrada).
do $$ begin if exists (select 1 from public.escala_execucao_real_periodo) then raise exception 'ROLLBACK_RECUSADO: há execução real registrada (apague as linhas conscientemente antes)'; end if; end $$;
drop table if exists public.escala_execucao_real_periodo;
notify pgrst, 'reload schema';

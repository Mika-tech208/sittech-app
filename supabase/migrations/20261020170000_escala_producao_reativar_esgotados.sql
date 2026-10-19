-- Escala de Produção — "Tentar novamente" para eventos da outbox que
-- esgotaram as 3 tentativas. Só o servidor (service_role) chama: a rota
-- /api/escala/reprocessar confere a permissão `escala_producao` antes.
-- Não calcula nada: apenas devolve os eventos esgotados para a fila; quem
-- recalcula continua sendo o processador existente (com locks e versões).

create or replace function public.escala_reativar_eventos_esgotados()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update public.escala_producao_eventos
     set status = 'pendente', tentativas = 0, iniciado_em = null
   where status = 'erro' and tentativas >= 3;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.escala_reativar_eventos_esgotados() from public, anon, authenticated;
grant execute on function public.escala_reativar_eventos_esgotados() to service_role;

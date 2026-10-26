-- Sittech — Relatório semanal: registro dos TESTES de envio de e-mail (botão administrativo "TESTAR ENVIO DE RELATÓRIO").
-- Separado dos envios documentais (`escala_relatorio_envios`) e dos relatórios (`escala_relatorios`): um teste NUNCA cria versão oficial nem fechamento.
-- Append-only; sem credenciais; só o hash do PDF de exemplo, o destinatário (e-mail do próprio admin logado) e o resultado do provedor.
create table public.escala_relatorio_testes_email (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid,                                    -- admin que clicou (sem FK: o log sobrevive a qualquer limpeza)
  destinatario text not null,
  provedor text not null,
  ok boolean not null,
  erro text,
  provedor_id text,
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_bytes integer not null,
  tentativa_em timestamptz not null default now()
);
create or replace function public.escala_relatorio_testes_email_trg_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'ESCALA_RELATORIO_TESTES_IMUTAVEL: o registro de testes de e-mail é append-only';
end;
$$;
create trigger trg_escala_relatorio_testes_email_imutavel before update or delete on public.escala_relatorio_testes_email for each row execute function public.escala_relatorio_testes_email_trg_imutavel();
alter table public.escala_relatorio_testes_email enable row level security;
create policy escala_relatorio_testes_email_select on public.escala_relatorio_testes_email for select to authenticated using (public.is_admin());
revoke all on public.escala_relatorio_testes_email from anon, authenticated;
grant select on public.escala_relatorio_testes_email to authenticated;
grant select, insert on public.escala_relatorio_testes_email to service_role;

create or replace function public.escala_relatorio_teste_email_registrar(p_usuario uuid, p_destinatario text, p_provedor text, p_ok boolean, p_erro text, p_provedor_id text, p_pdf_sha256 text, p_pdf_bytes integer)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_em timestamptz;
begin
  insert into public.escala_relatorio_testes_email (usuario_id, destinatario, provedor, ok, erro, provedor_id, pdf_sha256, pdf_bytes)
  values (p_usuario, p_destinatario, p_provedor, p_ok, case when p_ok then null else left(coalesce(p_erro, 'erro'), 500) end, case when p_ok then p_provedor_id else null end, p_pdf_sha256, p_pdf_bytes)
  returning tentativa_em into v_em;
  return v_em;
end;
$$;
revoke all on function public.escala_relatorio_teste_email_registrar(uuid, text, text, boolean, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.escala_relatorio_teste_email_registrar(uuid, text, text, boolean, text, text, text, integer) to service_role;

-- ROLLBACK: drop da função e da tabela (somente registros de teste).

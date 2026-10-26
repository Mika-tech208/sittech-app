-- Sittech — Relatório semanal: SIMPLIFICAÇÃO — o fechamento automático só GERA e ARQUIVA o PDF (sem envio por e-mail).
-- Remove tudo que existia só para o e-mail: histórico de envios, testes de envio, colunas email_* do fechamento, destinatário da configuração e as funções correspondentes.
-- Nada disso tem dados em PROD (0 fechamentos, 0 envios, 0 testes); o relatório e o log temporal (`registro_versoes`) NÃO são tocados.

drop function if exists public.escala_relatorio_teste_email_registrar(uuid, text, text, boolean, text, text, text, integer);
drop table if exists public.escala_relatorio_testes_email;
drop function if exists public.escala_relatorio_testes_email_trg_imutavel();

drop function if exists public.escala_relatorio_fechamento_email(uuid, boolean, text, text, text, uuid);
drop table if exists public.escala_relatorio_envios;
drop function if exists public.escala_relatorio_envios_trg_imutavel();

alter table public.escala_relatorio_fechamentos drop constraint if exists escala_relatorio_fechamento_email;
alter table public.escala_relatorio_fechamentos
  drop column if exists email_destinatario, drop column if exists email_status, drop column if exists email_tentativas, drop column if exists email_ultimo_erro,
  drop column if exists email_ultima_tentativa_em, drop column if exists email_enviado_em, drop column if exists email_provedor_id, drop column if exists email_envios, drop column if exists email_ultimo_envio_em;

alter table public.escala_relatorio_config drop column if exists destinatario;
drop function if exists public.escala_relatorio_config_definir(boolean, date, text);
create or replace function public.escala_relatorio_config_definir(p_ativo boolean, p_desde date)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare r public.escala_relatorio_config;
begin
  if not public.is_admin() then raise exception 'FUNC_SOMENTE_ADMIN: somente administrador altera o fechamento automático'; end if;
  if p_desde is not null and extract(isodow from p_desde) <> 1 then raise exception 'desde_semana precisa ser uma segunda-feira'; end if;
  update public.escala_relatorio_config
     set automatico_ativo = p_ativo, desde_semana = p_desde, atualizado_em = now(), atualizado_por = public.escala_usuario_atual()
   where id returning * into r;
  return to_jsonb(r);
end;
$$;
revoke all on function public.escala_relatorio_config_definir(boolean, date) from public, anon;
grant execute on function public.escala_relatorio_config_definir(boolean, date) to authenticated;

-- reivindicar: cria o fechamento da semana se não existir; devolve NULL se já foi gerado ou se outro worker está com a trava curta
drop function if exists public.escala_relatorio_fechamento_reivindicar(date, timestamptz, text, integer, boolean);
create or replace function public.escala_relatorio_fechamento_reivindicar(p_semana date, p_logico timestamptz, p_lease_segundos integer default 240)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare r public.escala_relatorio_fechamentos;
begin
  insert into public.escala_relatorio_fechamentos (semana_inicio, tipo, fechamento_logico_em)
  values (p_semana, 'executada', p_logico)
  on conflict (semana_inicio, tipo) do nothing;
  select * into r from public.escala_relatorio_fechamentos where semana_inicio = p_semana and tipo = 'executada' for update;
  if r.geracao_status = 'gerado' then return null; end if;                                                  -- já gerado: nada a fazer
  if r.lease_ate is not null and r.lease_ate > now() then return null; end if;                                -- outro worker
  update public.escala_relatorio_fechamentos set lease_ate = now() + make_interval(secs => p_lease_segundos), atualizado_em = now() where id = r.id returning * into r;
  return to_jsonb(r);
end;
$$;
revoke all on function public.escala_relatorio_fechamento_reivindicar(date, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.escala_relatorio_fechamento_reivindicar(date, timestamptz, integer) to service_role;

-- lista interna: sem e-mail
create or replace function public.escala_relatorio_listar(p_semana date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permissao('escala_relatorios') then raise exception 'Usuário não tem permissão para consultar relatórios da Escala'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'codigo', r.codigo, 'tipo', r.tipo, 'versao', r.versao, 'status', r.status, 'geradoEm', r.gerado_em,
      'consolidadoAte', r.consolidado_ate, 'geradoPor', u.nome, 'hash', r.hash_sha256, 'pdfBytes', r.pdf_bytes, 'fonteDigest', r.fonte_digest, 'periodosConsiderados', r.periodos_considerados,
      'fechamentoAutomatico', r.fechamento_automatico)
      order by r.tipo, r.versao desc)
    from public.escala_relatorios r
    left join public.usuarios u on u.id = r.gerado_por
    where r.semana_inicio = p_semana), '[]'::jsonb);
end;
$$;

-- ROLLBACK: recriar as tabelas/colunas de e-mail das migrations 20261101100000, 20261102100000 e 20261103100000 (sem dados a preservar).

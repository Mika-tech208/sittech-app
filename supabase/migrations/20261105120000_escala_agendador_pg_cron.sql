-- Sittech — Agendador SERVER-SIDE da revalidação da Escala (pg_cron + pg_net), independente do GitHub/Vercel Hobby.
--
-- Cinco minutos (e novamente três) antes de cada período, o PRÓPRIO banco chama /api/escala/drenar (idempotente: reconcilia Paradas, confere a
-- invariante, drena a fila; sem mudança = nada). O segredo do agendador é GERADO DENTRO do banco (Vault), nunca sai dele, não passa por SQL de
-- migration, Vercel, GitHub nem logs: o endpoint o valida pela RPC `escala_agendador_token_valido` (service_role). Sem configuração no Vault
-- (URL + token) a função não faz nada — migration segura em qualquer ambiente; a ativação é um passo operacional separado (supabase/ops/).
--
-- Horários (America/Sao_Paulo = UTC−3, sem horário de verão; pg_cron roda em UTC), seg–sáb: 07:07 08:43 10:19 12:55 14:15 15:35 e retentativas
-- +3 min. Os horários reais dos períodos vêm da tabela `periodos`; estes minutos só aproximam — a rota decide sozinha se está na janela.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Valida o token apresentado ao endpoint. Só o service_role (servidor Next) executa.
create or replace function public.escala_agendador_token_valido(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select p_token is not null and length(p_token) >= 32
     and exists (select 1 from vault.decrypted_secrets where name = 'escala_agendador_token' and decrypted_secret = p_token);
$$;

-- Dispara a chamada HTTP (assíncrona, pg_net). Retorna o id da requisição ou NULL se o agendador ainda não foi configurado.
create or replace function public.escala_agendador_chamar(p_origem text default 'pg_cron')
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_url text;
  v_token text;
  v_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'escala_agendador_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'escala_agendador_token';
  if v_url is null or v_token is null then
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
    body := jsonb_build_object('origem', p_origem),
    timeout_milliseconds := 55000
  ) into v_id;
  return v_id;
end;
$$;

revoke all on function public.escala_agendador_token_valido(text) from public, anon, authenticated;
revoke all on function public.escala_agendador_chamar(text) from public, anon, authenticated;
grant execute on function public.escala_agendador_token_valido(text) to service_role;

-- Agendamentos (idempotentes: o nome identifica o job).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('0707', '7 10'), ('0710', '10 10'),
      ('0843', '43 11'), ('0846', '46 11'),
      ('1019', '19 13'), ('1022', '22 13'),
      ('1255', '55 15'), ('1258', '58 15'),
      ('1415', '15 17'), ('1418', '18 17'),
      ('1535', '35 18'), ('1538', '38 18')
    ) as t(hhmm, minuto_hora)
  loop
    perform cron.schedule('escala-pre-periodo-' || r.hhmm, r.minuto_hora || ' * * 1-6', 'select public.escala_agendador_chamar(''pg_cron'')');
  end loop;
end $$;

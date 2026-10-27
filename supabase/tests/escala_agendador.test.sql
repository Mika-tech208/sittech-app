-- Teste de banco do agendador (DEV; transação com ROLLBACK). Não toca em segredos reais: cria segredos temporários e desfaz.
begin;
create temp table t_res (n serial, res text);
do $$
declare v_tok text; v_ok boolean; v_n integer; v_id bigint; v_antes integer;
begin
  select count(*) into v_n from cron.job where jobname like 'escala-pre-periodo-%';
  if v_n <> 12 then raise exception 'A1 falhou: jobs=%', v_n; end if;
  if (select string_agg(schedule, '|' order by jobname) from cron.job where jobname in ('escala-pre-periodo-0707','escala-pre-periodo-1255')) <> '7 10 * * 1-6|55 15 * * 1-6' then raise exception 'A2 falhou: horários UTC'; end if;
  insert into t_res(res) values ('ok A1/A2 12 jobs (06 horários + retentativa +3 min); 07:07 SP = 10:07 UTC e 12:55 SP = 15:55 UTC, seg–sáb');

  delete from vault.secrets where name in ('escala_agendador_token', 'escala_agendador_url');
  if public.escala_agendador_chamar('teste') is not null then raise exception 'A3 falhou: chamou sem configuração'; end if;
  if public.escala_agendador_token_valido('x') then raise exception 'A3b falhou'; end if;
  insert into t_res(res) values ('ok A3 sem URL/token no Vault a função não faz nada (fail safe) e nenhum token é válido');

  v_tok := encode(extensions.gen_random_bytes(32), 'hex');
  perform vault.create_secret(v_tok, 'escala_agendador_token');
  perform vault.create_secret('http://127.0.0.1:9/inexistente', 'escala_agendador_url');
  if not public.escala_agendador_token_valido(v_tok) then raise exception 'A4 falhou: token correto recusado'; end if;
  if public.escala_agendador_token_valido(v_tok || 'x') or public.escala_agendador_token_valido(substr(v_tok, 1, 40)) or public.escala_agendador_token_valido(null) then raise exception 'A4b falhou: token errado aceito'; end if;
  insert into t_res(res) values ('ok A4 só o token exato é aceito (errado/curto/nulo recusados)');

  select count(*) into v_antes from net.http_request_queue;
  v_id := public.escala_agendador_chamar('teste');
  if v_id is null then raise exception 'A5 falhou: não enfileirou a chamada'; end if;
  insert into t_res(res) values ('ok A5 configurado, a função enfileira a requisição HTTP (pg_net) e devolve o id');
end $$;
select res from t_res order by n;
rollback;

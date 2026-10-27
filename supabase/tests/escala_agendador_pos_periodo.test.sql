-- Teste de banco do agendador PÓS-período (DEV; transação com ROLLBACK). Pressupõe as migrations 20261105120000, 20261105140000 e 20261105170000 aplicadas.
begin;
create temp table t_res (n serial, res text);
do $$
declare v_n integer; v_ids_antes text; v_ids_depois text; v_antigos_antes text; v_antigos_depois text; r record; v_exp text; v_obtido text;
begin
  -- B1: 18 jobs, todos ativos, seg–sáb (1-6), comando = chamada do agendador
  select count(*) into v_n from cron.job where jobname like 'escala-pos-periodo-%';
  if v_n <> 18 then raise exception 'B1 falhou: jobs=%', v_n; end if;
  if exists (select 1 from cron.job where jobname like 'escala-pos-periodo-%' and (not active or schedule not like '% * * 1-6' or command <> 'select public.escala_agendador_chamar(''pg_cron'')')) then
    raise exception 'B1b falhou: job inativo, fora de seg–sáb ou comando diferente';
  end if;
  insert into t_res(res) values ('ok B1 18 jobs escala-pos-periodo-*, ativos, seg–sáb, chamando escala_agendador_chamar');

  -- B2: horários = fim do período (tabela periodos, SP) + 11/14/18 min, convertidos para UTC (+3 h) — derivado da tabela, não de uma lista copiada
  select string_agg(x.cron, '|' order by x.cron) into v_exp from (
    select extract(minute from (p.fim + (n || ' min')::interval + interval '3 hour'))::int || ' ' || extract(hour from (p.fim + (n || ' min')::interval + interval '3 hour'))::int as cron
    from public.periodos p cross join (values (11), (14), (18)) m(n)
  ) x;
  select string_agg(replace(schedule, ' * * 1-6', ''), '|' order by replace(schedule, ' * * 1-6', '')) into v_obtido from cron.job where jobname like 'escala-pos-periodo-%';
  if v_exp is distinct from v_obtido then raise exception 'B2 falhou: esperado % obtido %', v_exp, v_obtido; end if;
  -- nome = horário de SP (HHMM) = UTC − 3 h
  for r in select jobname, schedule from cron.job where jobname like 'escala-pos-periodo-%' loop
    if (lpad(((split_part(r.schedule, ' ', 2))::int - 3)::text, 2, '0') || lpad(split_part(r.schedule, ' ', 1), 2, '0')) <> right(r.jobname, 4) then
      raise exception 'B2b falhou: nome % não bate com o cron %', r.jobname, r.schedule;
    end if;
  end loop;
  insert into t_res(res) values ('ok B2 cada período tem jobs em fim+11, fim+14 e fim+18 min (UTC = SP + 3 h) e o sufixo HHMM é o horário de SP');

  -- B3: dentro da janela de fechamento (fim+10 .. fim+20) e nenhum coincide com os jobs de pré-período
  if exists (
    select 1 from cron.job j
    where j.jobname like 'escala-pos-periodo-%'
      and not exists (
        select 1 from public.periodos p
        where (split_part(j.schedule, ' ', 2)::int * 60 + split_part(j.schedule, ' ', 1)::int) - (extract(hour from p.fim)::int * 60 + extract(minute from p.fim)::int + 180) between 10 and 20)
  ) then raise exception 'B3 falhou: job fora da janela fim+10..fim+20'; end if;
  if exists (select 1 from cron.job a join cron.job b on a.schedule = b.schedule and a.jobname <> b.jobname where a.jobname like 'escala-pos-periodo-%') then
    raise exception 'B3b falhou: horário coincide com outro job do agendador';
  end if;
  insert into t_res(res) values ('ok B3 nenhum job novo coincide em horário com outro job (pré-período, fechar-atrasos ou pós-período)');

  -- B4: os 15 jobs anteriores seguem como estavam (12 pré-período + 3 fechar-atrasos)
  select string_agg(jobname || '=' || schedule || '/' || active || '/' || command, ';' order by jobname) into v_antigos_antes
    from cron.job where jobname like 'escala-pre-periodo-%' or jobname like 'escala-fechar-atrasos-%';
  select count(*) into v_n from cron.job where jobname like 'escala-pre-periodo-%' or jobname like 'escala-fechar-atrasos-%';
  if v_n <> 15 then raise exception 'B4 falhou: jobs antigos=%', v_n; end if;
  if (select string_agg(schedule, '|' order by jobname) from cron.job where jobname in ('escala-pre-periodo-0707','escala-pre-periodo-1255','escala-fechar-atrasos-1700')) <> '0 20 * * 1-6|7 10 * * 1-6|55 15 * * 1-6' then raise exception 'B4b falhou'; end if;

  -- B5: IDEMPOTÊNCIA — reaplicar o agendamento (mesmo corpo da migration) mantém exatamente 18 jobs, os mesmos horários, e não toca nos antigos
  select string_agg(jobname || '=' || schedule, ';' order by jobname) into v_ids_antes from cron.job where jobname like 'escala-pos-periodo-%';
  for r in select * from (values
      ('0859', '59 11'), ('0902', '2 12'), ('0906', '6 12'), ('1035', '35 13'), ('1038', '38 13'), ('1042', '42 13'),
      ('1206', '6 15'), ('1209', '9 15'), ('1213', '13 15'), ('1431', '31 17'), ('1434', '34 17'), ('1438', '38 17'),
      ('1551', '51 18'), ('1554', '54 18'), ('1558', '58 18'), ('1711', '11 20'), ('1714', '14 20'), ('1718', '18 20')) as t(hhmm, minuto_hora)
  loop
    if exists (select 1 from cron.job where jobname = 'escala-pos-periodo-' || r.hhmm) then perform cron.unschedule('escala-pos-periodo-' || r.hhmm); end if;
    perform cron.schedule('escala-pos-periodo-' || r.hhmm, r.minuto_hora || ' * * 1-6', 'select public.escala_agendador_chamar(''pg_cron'')');
  end loop;
  select string_agg(jobname || '=' || schedule, ';' order by jobname) into v_ids_depois from cron.job where jobname like 'escala-pos-periodo-%';
  select string_agg(jobname || '=' || schedule || '/' || active || '/' || command, ';' order by jobname) into v_antigos_depois
    from cron.job where jobname like 'escala-pre-periodo-%' or jobname like 'escala-fechar-atrasos-%';
  if v_ids_antes is distinct from v_ids_depois or (select count(*) from cron.job where jobname like 'escala-pos-periodo-%') <> 18 then raise exception 'B5 falhou: reaplicar mudou os jobs pós-período'; end if;
  if v_antigos_antes is distinct from v_antigos_depois then raise exception 'B5b falhou: reaplicar alterou job antigo'; end if;
  insert into t_res(res) values ('ok B4/B5 15 jobs anteriores intactos; reaplicar o agendamento mantém 18 jobs idênticos (idempotente) e não altera os antigos');

  -- B6: reversão documentada remove só os 18 novos
  perform cron.unschedule(jobname) from cron.job where jobname like 'escala-pos-periodo-%';
  if exists (select 1 from cron.job where jobname like 'escala-pos-periodo-%') then raise exception 'B6 falhou: reversão não removeu'; end if;
  select count(*) into v_n from cron.job where jobname like 'escala-pre-periodo-%' or jobname like 'escala-fechar-atrasos-%';
  if v_n <> 15 then raise exception 'B6b falhou: reversão atingiu jobs antigos'; end if;
  insert into t_res(res) values ('ok B6 a reversão (cron.unschedule por prefixo) remove só os 18 novos');
end $$;
select res from t_res order by n;
rollback;

-- T4: registro dos testes de envio — append-only, só service_role grava, não cria relatório/versão/fechamento. Tudo desfeito no final.
do $$
declare v_antes int; v_rel int; v_fech int; v_em timestamptz; v_ok boolean; v_n int; v_usr uuid;
begin
  select id into v_usr from usuarios where papel = 'admin' and ativo order by id limit 1;
  select count(*) into v_rel from escala_relatorios; select count(*) into v_fech from escala_relatorio_fechamentos;
  select count(*) into v_antes from escala_relatorio_testes_email;
  v_em := public.escala_relatorio_teste_email_registrar(v_usr, 'admin@sittech.com.br', 'resend', true, null, 're_abc', repeat('a', 64), 15000);
  perform public.escala_relatorio_teste_email_registrar(v_usr, 'admin@sittech.com.br', 'resend', false, 'domínio não verificado', 'ignorado', repeat('b', 64), 15000);
  if v_em is null then raise exception 'FALHOU (1) carimbo'; end if;
  select count(*) into v_n from escala_relatorio_testes_email; if v_n <> v_antes + 2 then raise exception 'FALHOU (1) linhas'; end if;
  if (select provedor_id from escala_relatorio_testes_email where pdf_sha256 = repeat('b', 64)) is not null then raise exception 'FALHOU (2) falha não guarda id'; end if;
  begin perform public.escala_relatorio_teste_email_registrar(v_usr, 'x@y.co', 'resend', true, null, 'i', 'curto', 1); v_ok := false; exception when others then v_ok := position('check' in lower(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (3) hash inválido deveria ser recusado'; end if;
  begin update escala_relatorio_testes_email set ok = true; v_ok := false; exception when others then v_ok := position('ESCALA_RELATORIO_TESTES_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) append-only (update)'; end if;
  begin delete from escala_relatorio_testes_email; v_ok := false; exception when others then v_ok := position('ESCALA_RELATORIO_TESTES_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) append-only (delete)'; end if;
  if (select count(*) from escala_relatorios) <> v_rel or (select count(*) from escala_relatorio_fechamentos) <> v_fech then raise exception 'FALHOU (5) o teste não pode criar relatório nem fechamento'; end if;
  if has_function_privilege('anon', 'public.escala_relatorio_teste_email_registrar(uuid,text,text,boolean,text,text,text,integer)', 'execute') or has_function_privilege('authenticated', 'public.escala_relatorio_teste_email_registrar(uuid,text,text,boolean,text,text,text,integer)', 'execute') then raise exception 'FALHOU (6) só service_role'; end if;
  raise exception 'TESTE_OK T4 teste de envio: append-only, hash validado, sem relatório/versão/fechamento, só service_role';
end $$;

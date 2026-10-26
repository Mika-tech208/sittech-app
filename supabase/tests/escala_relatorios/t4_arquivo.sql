-- T4: arquivo histórico (aba Relatórios) — uma linha por família com a versão MAIS RECENTE, contagem de versões, ordenação (mais recente primeiro; executado antes de planejado),
-- filtros (ano/tipo/status/busca), resumo lido do snapshot, final automático aparece sem registro adicional, permissão própria, somente leitura. Tudo desfeito no final.
-- auxiliar temporária (somente nesta sessão): registra um relatório pelo RPC real (hash/PDF conferidos pelo banco)
create or replace function pg_temp.reg(p_semana date, p_tipo text, p_status text, p_auto boolean, p_conteudo text, p_usr uuid) returns uuid language plpgsql as $f$
declare v_prox jsonb := public.escala_relatorio_proximo(p_semana, p_tipo); v_pdf bytea := '\x255044462d312e340a'::bytea; v_canon text := p_conteudo; v_id uuid := gen_random_uuid();
begin
  if p_auto then perform public.escala_relatorio_fechamento_reivindicar(p_semana, now() - interval '1 hour'); end if;
  return public.escala_relatorio_registrar(v_id, p_semana, p_tipo, (v_prox->>'versao')::int, v_prox->>'codigo', p_status, now() - interval '1 hour', now() - interval '1 hour', now(), case when p_auto then null else p_usr end, 1,
    v_canon, encode(sha256(convert_to(v_canon, 'utf8')), 'hex'), repeat('c', 64), '[]'::jsonb, v_pdf, encode(sha256(v_pdf), 'hex'), p_auto);
end $f$;

do $$
declare
  v_adm uuid; v_usr uuid; v_comum uuid; v_j jsonb; v_n int; v_pdf bytea := '\x255044462d312e340a'::bytea; v_pdf_sha text; v_prox jsonb; v_id uuid; v_ok boolean;
  S1 date := '2031-03-03'; S2 date := '2031-03-10';
  v_antes int;
begin
  select auth_user_id, id into v_adm, v_usr from usuarios where papel = 'admin' and ativo order by id limit 1;
  select auth_user_id into v_comum from usuarios where papel <> 'admin' and ativo and id not in (select usuario_id from usuario_permissoes where permissao = 'escala_relatorios') order by id limit 1;
  v_pdf_sha := encode(sha256(v_pdf), 'hex');
  select count(*) into v_antes from escala_relatorios;
  insert into previsoes (id, semana_inicio) values (gen_random_uuid(), S1), (gen_random_uuid(), S2);

  -- S1: executada v1 (parcial manual) e v2 (final AUTOMÁTICO); planejada v1 (final manual). S2: executada v1 parcial manual.
  perform pg_temp.reg(S1, 'executada', 'parcial', false, '{"resumo":{"cobertura":{"percentualTexto":"91,7%"},"revezamento":{"estado":"SIM_COM_RESSALVAS"}}}', v_usr);
  perform pg_temp.reg(S1, 'executada', 'final', true, '{"resumo":{"cobertura":{"percentualTexto":"98,7%"},"revezamento":{"estado":"NAO"}}}', v_usr);
  perform pg_temp.reg(S1, 'planejada', 'final', false, '{"resumo":{"cobertura":null,"revezamento":{"estado":"SIM"}}}', v_usr);
  perform pg_temp.reg(S2, 'executada', 'parcial', false, '{"resumo":{"cobertura":{"percentualTexto":"100,0%"},"revezamento":{"estado":"SIM"}}}', v_usr);

  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.escala_relatorio_arquivo(2031);
  reset role;
  if (v_j->>'total')::int <> 3 then raise exception 'FALHOU (1) 3 famílias esperadas (S2 exec, S1 exec, S1 plan): %', v_j->>'total'; end if;
  -- ordenação: semana mais recente primeiro; dentro da semana executado antes de planejado
  if (select string_agg((x->>'semanaInicio') || ':' || (x->>'tipo'), ',') from jsonb_array_elements(v_j->'itens') x) <> '2031-03-10:executada,2031-03-03:executada,2031-03-03:planejada' then
    raise exception 'FALHOU (2) ordenação: %', (select string_agg((x->>'semanaInicio') || ':' || (x->>'tipo'), ',') from jsonb_array_elements(v_j->'itens') x);
  end if;
  -- só a versão mais recente da família, com a contagem
  if (v_j->'itens'->1->>'versao')::int <> 2 or (v_j->'itens'->1->>'nVersoes')::int <> 2 or v_j->'itens'->1->>'status' <> 'final' or (v_j->'itens'->1->>'fechamentoAutomatico')::boolean is not true then raise exception 'FALHOU (3) família S1 executada: %', v_j->'itens'->1; end if;
  -- resumo lido do snapshot
  if v_j->'itens'->1->>'cobertura' <> '98,7%' or v_j->'itens'->1->>'conformidade' <> 'NAO' or v_j->'itens'->2->>'conformidade' <> 'SIM' or v_j->'itens'->2->>'cobertura' is not null then raise exception 'FALHOU (4) resumo: %', v_j->'itens'; end if;
  if v_j->'anos' <> '[2031]'::jsonb and not (v_j->'anos' @> '[2031]'::jsonb) then raise exception 'FALHOU (4) anos'; end if;
  -- (5) filtros
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (public.escala_relatorio_arquivo(2031, 'planejada')->>'total')::int <> 1 then raise exception 'FALHOU (5) tipo'; end if;
  if (public.escala_relatorio_arquivo(2031, null, 'final')->>'total')::int <> 2 then raise exception 'FALHOU (5) status final (a família S1 exec usa a v2 FINAL)'; end if;
  if (public.escala_relatorio_arquivo(2031, null, 'parcial')->>'total')::int <> 1 then raise exception 'FALHOU (5) status parcial (o parcial v1 não aparece: só a mais recente conta)'; end if;
  if (public.escala_relatorio_arquivo(2030)->>'total')::int <> 0 then raise exception 'FALHOU (5) ano'; end if;
  if (public.escala_relatorio_arquivo(2031, null, null, '10/03/2031')->>'total')::int <> 1 then raise exception 'FALHOU (5) busca por semana (dd/mm/aaaa)'; end if;
  if (public.escala_relatorio_arquivo(2031, null, null, (select codigo from escala_relatorios where semana_inicio = S2 and tipo = 'executada' limit 1))->>'total')::int <> 1 then raise exception 'FALHOU (5) busca por código'; end if;
  if jsonb_array_length(public.escala_relatorio_arquivo(2031, null, null, null, 1, 1)->'itens') <> 1 or (public.escala_relatorio_arquivo(2031, null, null, null, 1, 1)->'itens'->0->>'semanaInicio') <> '2031-03-03' then raise exception 'FALHOU (5) paginação'; end if;
  begin perform public.escala_relatorio_arquivo(2031, 'x'); v_ok := false; exception when others then v_ok := position('tipo inválido' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (5) tipo inválido'; end if;
  reset role;

  -- (6) permissão própria: usuário comum sem a permissão é recusado
  if v_comum is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_comum, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin perform public.escala_relatorio_arquivo(2031); v_ok := false; exception when others then v_ok := position('permissão' in sqlerrm) > 0; end;
    reset role;
    if not v_ok then raise exception 'FALHOU (6) sem permissão deveria ser recusado'; end if;
  end if;
  begin perform public.escala_relatorio_arquivo(2031); v_ok := false; exception when others then v_ok := true; end;   -- anon/sem sessão
  if (select count(*) from escala_relatorios) <> v_antes + 4 then raise exception 'FALHOU (7) a consulta não pode gravar nada'; end if;

  raise exception 'TESTE_OK T4 arquivo: uma linha por família (mais recente), ordenação, filtros, resumo do snapshot, final automático listado sem registro extra, permissão própria, somente leitura';
end $$;

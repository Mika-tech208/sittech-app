-- T2: fechamento automático do relatório semanal — config nasce desligada; "estado conhecido no instante" (as-of) ignora criações e desfaz edições posteriores ao fechamento lógico;
-- idempotência (unique semana+tipo, um relatório automático por semana, lease); geração e e-mail separados; e-mail enviado não é regravado. Tudo desfeito no final.
do $$
declare
  v_adm uuid; v_usr uuid; v_maq uuid; v_func uuid; v_prev uuid;
  SEM date := '2031-03-03';
  CORTE timestamptz := '2031-03-07 21:00:00+00';       -- sexta 18:00 São Paulo
  v_ap_ok uuid := gen_random_uuid(); v_ap_tarde uuid := gen_random_uuid(); v_ap_edit uuid := gen_random_uuid();
  v_au_ok uuid := gen_random_uuid(); v_au_tarde uuid := gen_random_uuid(); v_au_edit uuid := gen_random_uuid();
  PA uuid := gen_random_uuid(); EA uuid := gen_random_uuid(); v_op uuid;
  v_msg text; v_j jsonb; v_r jsonb; v_ok boolean; v_n int; v_fid uuid;
  v_canon text := '{"codigo":"ESC-EXEC-2031-10-0001","v":1}'; v_hash text; v_pdf bytea := '\x255044462d312e340a'::bytea; v_pdf_sha text; v_rel uuid := gen_random_uuid();
begin
  select auth_user_id, id into v_adm, v_usr from usuarios where papel = 'admin' and ativo order by id limit 1;
  select id into v_maq from maquinas where ativo order by id limit 1;
  select id into v_func from funcionarios order by id limit 1;
  if v_adm is null or v_maq is null or v_func is null then raise exception 'FALHOU setup'; end if;
  v_hash := encode(sha256(convert_to(v_canon, 'utf8')), 'hex'); v_pdf_sha := encode(sha256(v_pdf), 'hex');
  insert into previsoes (id, semana_inicio) values (gen_random_uuid(), SEM) returning id into v_prev;
  select id into v_op from operacoes order by id limit 1;
  insert into produtos (id, nome, valor_unitario, ativo, prioridade) values (PA, 'TESTE-REL AUTO', 1, true, 'media');
  insert into roteiro_etapas (id, produto_id, operacao_id, ordem) values (EA, PA, v_op, 0);

  -- (1) config nasce DESLIGADA; ligar exige a semana inicial
  select to_jsonb(c) into v_j from escala_relatorio_config c;
  if (v_j->>'automatico_ativo')::boolean or v_j->>'destinatario' <> 'tamara@sittech.com.br' then raise exception 'FALHOU (1) config padrão: %', v_j; end if;
  begin update escala_relatorio_config set automatico_ativo = true; v_ok := false; exception when others then v_ok := position('escala_relatorio_config_desde' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (1) ligar sem semana inicial deveria ser recusado'; end if;

  -- (2) as-of: apontamentos
  insert into apontamentos_producao (id, produto_id, etapa_id, operacao_id, valor_unitario_produto_vigente, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente,
      criado_por, status, criado_em, atualizado_em) values
    (v_ap_ok,    PA, EA, v_op, 1, v_maq, v_func, 'm1', SEM, '09:00', 10, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', CORTE - interval '1 day', CORTE - interval '1 day'),
    (v_ap_tarde, PA, EA, v_op, 1, v_maq, v_func, 'm2', SEM, '10:00', 99, 0, '08:48', '10:24', 100, 10, v_usr, 'produzindo', CORTE + interval '7 minutes', CORTE + interval '7 minutes'),   -- criado às 18:07
    (v_ap_edit,  PA, EA, v_op, 1, v_maq, v_func, 'm3', SEM, '11:00', 77, 0, '10:24', '11:55', 100, 10, v_usr, 'produzindo', CORTE - interval '1 day', CORTE + interval '9 minutes');       -- editado às 18:09 (era 20)
  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, alterado_em, motivo) values
    (v_ap_edit, jsonb_build_object('quantidade_produzida', 20), jsonb_build_object('quantidade_produzida', 50), v_usr, CORTE + interval '3 minutes', 'edição 1'),
    (v_ap_edit, jsonb_build_object('quantidade_produzida', 50), jsonb_build_object('quantidade_produzida', 77), v_usr, CORTE + interval '9 minutes', 'edição 2');
  -- uma edição ANTES do corte não é desfeita
  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, alterado_em, motivo) values
    (v_ap_ok, jsonb_build_object('quantidade_produzida', 5), jsonb_build_object('quantidade_produzida', 10), v_usr, CORTE - interval '2 hours', 'antes do corte');

  v_j := public.escala_relatorio_fontes(SEM, CORTE);
  select count(*) into v_n from jsonb_array_elements(v_j->'apontamentos');
  if v_n <> 2 then raise exception 'FALHOU (2) o apontamento criado às 18:07 não pode entrar: % itens', v_n; end if;
  if (select (x->>'produzido')::numeric from jsonb_array_elements(v_j->'apontamentos') x where (x->>'id')::uuid = v_ap_edit) <> 20 then raise exception 'FALHOU (2) a edição posterior ao corte deveria ser desfeita (20)'; end if;
  if (select (x->>'produzido')::numeric from jsonb_array_elements(v_j->'apontamentos') x where (x->>'id')::uuid = v_ap_ok) <> 10 then raise exception 'FALHOU (2) a edição anterior ao corte deve permanecer (10)'; end if;
  -- sem "como de" = estado atual
  v_j := public.escala_relatorio_fontes(SEM);
  select count(*) into v_n from jsonb_array_elements(v_j->'apontamentos');
  if v_n <> 3 or (select (x->>'produzido')::numeric from jsonb_array_elements(v_j->'apontamentos') x where (x->>'id')::uuid = v_ap_edit) <> 77 then raise exception 'FALHOU (2) estado atual'; end if;

  -- (3) as-of: ausências
  insert into ausencias_funcionarios (id, funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, criado_por, criado_em, atualizado_em) values
    (v_au_ok,    v_func, SEM,     'falta_dia_inteiro', null, null, 480, '[]', v_usr, CORTE - interval '1 day', CORTE - interval '1 day'),
    (v_au_tarde, v_func, SEM + 1, 'falta_dia_inteiro', null, null, 480, '[]', v_usr, CORTE + interval '7 minutes', CORTE + interval '7 minutes'),
    (v_au_edit,  v_func, SEM + 2, 'atraso', '07:00', '08:00', 60, '[]', v_usr, CORTE - interval '1 day', CORTE + interval '5 minutes');
  insert into ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, alterado_em, motivo) values
    (v_au_edit, jsonb_build_object('tipo', 'atraso', 'horario_inicio', '07:00:00', 'horario_fim', '07:30:00'), jsonb_build_object('tipo', 'atraso', 'horario_inicio', '07:00:00', 'horario_fim', '08:00:00'),
     v_usr, CORTE + interval '5 minutes', 'alongou o atraso');
  v_j := public.escala_relatorio_fontes(SEM, CORTE);
  select count(*) into v_n from jsonb_array_elements(v_j->'ausencias');
  if v_n <> 2 then raise exception 'FALHOU (3) a ausência criada às 18:07 não pode entrar: % itens', v_n; end if;
  if (select x->>'fim' from jsonb_array_elements(v_j->'ausencias') x where (x->>'data')::date = SEM + 2) <> '07:30:00' then raise exception 'FALHOU (3) a edição posterior da ausência deveria ser desfeita'; end if;

  -- (4) plano oficial vem da versão vigente no instante (a versão posterior ao corte é ignorada)
  insert into escala_plano_versoes (previsao_id, semana_inicio, valido_desde, txid, origem, hash_plano, dias, linhas, entrada) values
    (v_prev, SEM, CORTE - interval '2 days', 1, 'baseline', 'h1', jsonb_build_array(jsonb_build_object('data', (SEM)::text, 'versao', 1, 'periodos_snapshot', '[{"id":"m1"}]'::jsonb)),
      jsonb_build_array(jsonb_build_array((SEM)::text, 'm1', v_func::text, v_maq::text, null, null, null, 10, 0, null, null, 'a')), '{}'),
    (v_prev, SEM, CORTE + interval '10 minutes', 2, 'trigger', 'h2', '[]',
      jsonb_build_array(jsonb_build_array((SEM)::text, 'm1', v_func::text, v_maq::text, null, null, null, 10, 0, null, null, 'a'), jsonb_build_array((SEM)::text, 'm2', v_func::text, v_maq::text, null, null, null, 10, 0, null, null, 'a')), '{}');
  v_j := public.escala_relatorio_fontes(SEM, CORTE);
  if jsonb_array_length(v_j->'oficial') <> 1 or v_j->'planoVersao'->>'hashPlano' <> 'h1' then raise exception 'FALHOU (4) plano deveria ser a versão h1: %', v_j->'planoVersao'; end if;
  if v_j->'periodosPorDia'->(SEM::text)->0->>'id' <> 'm1' then raise exception 'FALHOU (4) períodos do dia vêm da versão'; end if;

  -- (5) fechamento: reivindicar é idempotente e respeita o lease
  v_r := public.escala_relatorio_fechamento_reivindicar(SEM, CORTE, 'teste@example.com');
  if v_r is null then raise exception 'FALHOU (5) primeira reivindicação'; end if;
  v_fid := (v_r->>'id')::uuid;
  if public.escala_relatorio_fechamento_reivindicar(SEM, CORTE, 'teste@example.com') is not null then raise exception 'FALHOU (5) segundo worker não pode reivindicar enquanto há lease'; end if;
  select count(*) into v_n from escala_relatorio_fechamentos where semana_inicio = SEM; if v_n <> 1 then raise exception 'FALHOU (5) uma linha por semana'; end if;
  -- falha de geração: libera, conta tentativa, não gera relatório
  perform public.escala_relatorio_fechamento_erro_geracao(v_fid, 'pdf quebrou');
  select * into v_r from (select to_jsonb(f) j from escala_relatorio_fechamentos f where id = v_fid) q;
  if v_r->>'geracao_status' <> 'erro' or (v_r->>'geracao_tentativas')::int <> 1 or v_r->>'lease_ate' is not null then raise exception 'FALHOU (5) erro de geração: %', v_r; end if;
  if public.escala_relatorio_fechamento_reivindicar(SEM, CORTE, 'teste@example.com') is null then raise exception 'FALHOU (5) retry após erro deve poder reivindicar'; end if;

  -- (6) registrar o relatório automático (final, elegível = corte) vincula o fechamento; segundo automático da semana é recusado
  perform public.escala_relatorio_registrar(v_rel, SEM, 'executada', 1, 'ESC-EXEC-2031-10-0001', 'final', now() - interval '1 minute', now() - interval '1 minute', now(), null, 1, v_canon, v_hash, repeat('a', 64), '[]'::jsonb, v_pdf, v_pdf_sha, true);
  select to_jsonb(f) into v_r from escala_relatorio_fechamentos f where id = v_fid;
  if v_r->>'geracao_status' <> 'gerado' or (v_r->>'relatorio_id')::uuid <> v_rel then raise exception 'FALHOU (6) vínculo: %', v_r; end if;
  begin
    perform public.escala_relatorio_registrar(gen_random_uuid(), SEM, 'executada', 2, 'ESC-EXEC-2031-10-0001', 'final', now() - interval '1 minute', now() - interval '1 minute', now(), null, 1,
      '{"codigo":"ESC-EXEC-2031-10-0001","v":2}', encode(sha256(convert_to('{"codigo":"ESC-EXEC-2031-10-0001","v":2}', 'utf8')), 'hex'), repeat('a', 64), '[]'::jsonb, v_pdf, v_pdf_sha, true);
    v_ok := false;
  exception when others then v_msg := sqlerrm; v_ok := position('ESCALA_RELATORIO_FECHAMENTO' in sqlerrm) > 0 or position('uq_escala_relatorio_fechamento_auto' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) segundo automático da mesma semana: %', v_msg; end if;
  -- parcial nunca é automático
  begin
    insert into escala_relatorios (id, codigo, semana_inicio, tipo, versao, status, consolidado_ate, elegivel_final_em, gerado_em, gerado_por, schema_versao, conteudo_canonico, conteudo, hash_sha256, fonte_digest, periodos_considerados, pdf_sha256, pdf_bytes, fechamento_automatico)
    values (gen_random_uuid(), 'X', SEM + 7, 'executada', 1, 'parcial', now(), now(), now(), null, 1, '{}', '{}', 'x', 'x', '[]', 'x', 1, true);
    v_ok := false;
  exception when others then v_ok := position('escala_relatorio_auto_final_exec' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) parcial automático deveria ser recusado'; end if;

  -- (7) e-mail: falha → falhou (PDF intacto); retry → enviado; depois de enviado nada regrava
  perform public.escala_relatorio_fechamento_email(v_fid, false, 'smtp 451', null);
  select to_jsonb(f) into v_r from escala_relatorio_fechamentos f where id = v_fid;
  if v_r->>'email_status' <> 'falhou' or (v_r->>'email_tentativas')::int <> 1 or v_r->>'email_ultimo_erro' <> 'smtp 451' or v_r->>'email_enviado_em' is not null or v_r->>'geracao_status' <> 'gerado' then raise exception 'FALHOU (7) falha de e-mail: %', v_r; end if;
  perform public.escala_relatorio_fechamento_email(v_fid, true, null, 'msg-123');
  perform public.escala_relatorio_fechamento_email(v_fid, false, 'não deveria regravar', null);
  select to_jsonb(f) into v_r from escala_relatorio_fechamentos f where id = v_fid;
  if v_r->>'email_status' <> 'enviado' or (v_r->>'email_tentativas')::int <> 2 or v_r->>'email_provedor_id' <> 'msg-123' or v_r->>'email_ultimo_erro' is not null then raise exception 'FALHOU (7) enviado: %', v_r; end if;
  if public.escala_relatorio_fechamento_reivindicar(SEM, CORTE, 'teste@example.com') is not null then raise exception 'FALHOU (7) tudo feito: nada a reivindicar'; end if;

  -- (8) a lista interna expõe o e-mail
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_j := public.escala_relatorio_listar(SEM);
  reset role;
  if v_j->0->>'fechamentoAutomatico' <> 'true' or v_j->0->'email'->>'status' <> 'enviado' then raise exception 'FALHOU (8) listar: %', v_j; end if;

  raise exception 'TESTE_OK T2 fechamento automático: config desligada, as-of (cria/edição posteriores ignoradas), plano por versão, idempotência/lease, geração × e-mail separados, parcial nunca automático';
end $$;

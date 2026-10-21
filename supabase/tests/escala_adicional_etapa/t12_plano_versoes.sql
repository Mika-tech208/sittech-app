-- T12: VERSÕES DO PLANO OFICIAL (Fase 4d, integridade temporal) — inerte com o modo desligado; com sombra registra a versão no commit (uma por transação),
-- dedupe por hash, baseline, leitura "vigente no instante", append-only, grants. Tudo desfeito no final. Rodar só em DEV/local.
-- (O teste roda numa transação só: SET CONSTRAINTS IMMEDIATE dispara os gatilhos adiados; baseline contorna a regra "uma por transação".)
do $$
declare
  v_auth uuid; v_prev uuid; v_snap jsonb;
  F1 uuid; F2 uuid; M1 uuid; M2 uuid; P1 uuid; E1 uuid; O1 uuid; ITEM uuid;
  D1 date := '2031-03-04';
  v_n integer; v_id uuid; v_id2 uuid; v_t1 timestamptz; v_t2 timestamptz; v_ok boolean; v_h1 text; v_h2 text; v_ent jsonb;
begin
  select auth_user_id into v_auth from usuarios where papel = 'admin' and ativo order by id limit 1;
  select (array_agg(id order by id))[1], (array_agg(id order by id))[2] into F1, F2 from (select id from funcionarios where ativo order by id limit 2) t;
  select (array_agg(id order by id))[1], (array_agg(id order by id))[2] into M1, M2 from (select id from maquinas where ativo order by id limit 2) t;
  select produto_id, id, operacao_id into P1, E1, O1 from roteiro_etapas order by id limit 1;
  if F2 is null or M2 is null or E1 is null then raise exception 'FALHOU setup do DEV'; end if;

  insert into previsoes (semana_inicio) values ('2031-03-03') returning id into v_prev;
  select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', inicio, 'fim', fim) order by id) into v_snap from periodos;
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (D1, v_prev, v_snap, 0);
  set constraints all immediate;
  set constraints all deferred;

  -- (1) modo desligado: nenhuma versão (inerte)
  update escala_parametros set valor = '"desligado"' where chave = 'replanejamento_modo';
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values (D1, 'm1', F1, M1, P1, E1, O1, 100, null);
  set constraints all immediate; set constraints all deferred;
  select count(*) into v_n from escala_plano_versoes where previsao_id = v_prev;
  if v_n <> 0 then raise exception 'FALHOU (1) desligado não pode registrar versão: %', v_n; end if;

  -- (2) ao LIGAR a sombra nasce a versão BASELINE do plano vigente (1 linha até aqui)
  update escala_parametros set valor = '"sombra"' where chave = 'replanejamento_modo';
  select count(*), max(id::text)::uuid into v_n, v_id from escala_plano_versoes where previsao_id = v_prev;
  if v_n <> 1 or (select origem from escala_plano_versoes where id = v_id) <> 'baseline' or jsonb_array_length((select linhas from escala_plano_versoes where id = v_id)) <> 1 then raise exception 'FALHOU (2) baseline ao ligar: % versões', v_n; end if;
  -- para provar o caminho do GATILHO (que só registra 1 versão por transação), a baseline do teste sai de cena (somente aqui, desfeito no final)
  alter table escala_plano_versoes disable trigger trg_escala_plano_versoes_imutavel;
  delete from escala_plano_versoes where previsao_id = v_prev;
  alter table escala_plano_versoes enable trigger trg_escala_plano_versoes_imutavel;
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values
    (D1, 'm1', F2, null, null, null, null, 0, 'sem carga'), (D1, 'm2', F1, M2, P1, E1, O1, 50, null), (D1, 'm2', F2, null, null, null, null, 0, 'sem carga');
  set constraints all immediate; set constraints all deferred;
  select count(*), max(id::text)::uuid into v_n, v_id from escala_plano_versoes where previsao_id = v_prev;
  if v_n <> 1 then raise exception 'FALHOU (2) esperado 1 versão pelo gatilho, veio %', v_n; end if;
  if (select origem from escala_plano_versoes where id = v_id) <> 'trigger' or jsonb_array_length((select linhas from escala_plano_versoes where id = v_id)) <> 4 then
    raise exception 'FALHOU (2) versão do gatilho incorreta: % %', (select origem from escala_plano_versoes where id = v_id), (select jsonb_array_length(linhas) from escala_plano_versoes where id = v_id);
  end if;
  if (select (dias->0->>'data') from escala_plano_versoes where id = v_id) <> '2031-03-04' then raise exception 'FALHOU (2) dias da versão'; end if;
  -- outra mudança na MESMA transação: a regra "uma por transação" mantém 1
  update escala_producao_alocacoes set pecas = 77 where data = D1 and periodo_id = 'm2' and funcionario_id = F1;
  set constraints all immediate; set constraints all deferred;
  select count(*) into v_n from escala_plano_versoes where previsao_id = v_prev;
  if v_n <> 1 then raise exception 'FALHOU (2b) mesma transação = 1 versão, veio %', v_n; end if;

  -- (3) baseline contorna a regra "uma por transação", mas dedupe por hash: estado novo = versão nova; estado igual = nada
  v_id2 := escala_plano_registrar(v_prev, 'baseline');
  if v_id2 is null then raise exception 'FALHOU (3) o estado mudou (pecas 77): deveria nascer uma versão baseline'; end if;
  if escala_plano_registrar(v_prev, 'baseline') is not null then raise exception 'FALHOU (3) estado igual não pode gerar versão'; end if;
  select count(*) into v_n from escala_plano_versoes where previsao_id = v_prev;
  if v_n <> 2 then raise exception 'FALHOU (3) esperado 2 versões, veio %', v_n; end if;
  if (select (e->>7)::numeric from escala_plano_versoes, jsonb_array_elements(linhas) e where id = v_id and e->>1 = 'm2' and e->>2 = F1::text) <> 50 or (select (e->>7)::numeric from escala_plano_versoes, jsonb_array_elements(linhas) e where id = v_id2 and e->>1 = 'm2' and e->>2 = F1::text) <> 77 then
    raise exception 'FALHOU (3) cada versão deve guardar o plano DAQUELE instante (50 e 77)';
  end if;

  -- (4) leitura "vigente no instante": nunca devolve o plano de agora para um instante passado
  select valido_desde into v_t1 from escala_plano_versoes where id = v_id;
  select valido_desde into v_t2 from escala_plano_versoes where id = v_id2;
  if v_t2 <= v_t1 then raise exception 'FALHOU (4) validade deve crescer'; end if;
  set local role service_role;
  if (select id from escala_plano_versao_em(v_prev, v_t1 + (v_t2 - v_t1) / 2)) is distinct from v_id then raise exception 'FALHOU (4) entre as versões vale a primeira'; end if;
  if (select id from escala_plano_versao_em(v_prev, v_t2)) is distinct from v_id2 then raise exception 'FALHOU (4) no instante da 2ª vale a 2ª'; end if;
  if (select id from escala_plano_versao_em(v_prev, v_t2 + interval '1 day')) is distinct from v_id2 then raise exception 'FALHOU (4) depois da última vale a última'; end if;
  select count(*) into v_n from escala_plano_versao_em(v_prev, v_t1 - interval '1 second');
  reset role;
  if v_n <> 0 then raise exception 'FALHOU (4) antes da 1ª versão não existe plano (nunca cair no plano atual)'; end if;

  -- (5) as entradas da Previsão acompanham a versão
  insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev, 'previsto', P1, 'teste', 2, 900) returning id into ITEM;
  insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) values (ITEM, E1, M1);
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo) values (v_prev, F1, true), (v_prev, F2, false);
  insert into previsao_dias_produtivos (previsao_id, dia, ativo) values (v_prev, D1, true);
  insert into previsao_maquinas_indisponiveis (previsao_id, maquina_id) values (v_prev, M2);
  v_ent := escala_plano_entrada(v_prev);
  if v_ent->'diasProdutivos' <> '["2031-03-04"]'::jsonb or v_ent->'equipe' <> to_jsonb(array[F1]) or v_ent->'maquinasIndisponiveisPrevisao' <> to_jsonb(array[M2]) then raise exception 'FALHOU (5) entrada: %', v_ent; end if;
  if (v_ent->'itens'->0->>'quantidade')::numeric <> 900 or (v_ent->'itens'->0->'maquinasPorEtapa'->E1::text) <> to_jsonb(array[M1]) or (v_ent->'itens'->0) ? 'adicionalPorEtapa' then raise exception 'FALHOU (5) itens: %', v_ent->'itens'; end if;
  v_id := escala_plano_registrar(v_prev, 'baseline');
  if v_id is null or (select entrada->'itens'->0->>'quantidade' from escala_plano_versoes where id = v_id) <> '900' then raise exception 'FALHOU (5) a versão deve carregar a Previsão vigente'; end if;

  -- (6) gatilhos adiados presentes nas 8 tabelas
  select count(*) into v_n from pg_trigger where tgname = 'trg_escala_plano_versao' and tgdeferrable and tginitdeferred;
  if v_n <> 9 then raise exception 'FALHOU (6) esperado 9 gatilhos adiados (8 tabelas + parâmetros), veio %', v_n; end if;

  -- (7) append-only e grants
  begin update escala_plano_versoes set origem = 'baseline'; v_ok := false; exception when others then v_ok := position('ESCALA_SOMBRA_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7) versão deve ser append-only'; end if;
  begin delete from escala_plano_versoes; v_ok := false; exception when others then v_ok := position('ESCALA_SOMBRA_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7) versão não pode ser apagada'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from escala_plano_versoes where previsao_id = v_prev;
  if v_n < 3 then raise exception 'FALHOU (7) admin deveria ler as versões'; end if;
  begin perform escala_plano_versao_em(v_prev, now()); v_ok := false; exception when others then v_ok := position('permission denied' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7) authenticated não executa a leitura temporal'; end if;
  begin insert into escala_plano_versoes (previsao_id, semana_inicio, valido_desde, txid, origem, hash_plano, dias, linhas, entrada) values (v_prev, D1, now(), 1, 'baseline', 'x', '[]', '[]', '{}'); v_ok := false; exception when others then v_ok := position('permission denied' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7) authenticated não escreve versões'; end if;
  reset role;

  raise exception 'TESTE_OK T12: inerte desligado; uma versão por transação no commit; dedupe por hash; baseline; leitura temporal sem cair no plano atual; Previsão acompanha a versão; 9 gatilhos adiados; append-only e grants';
end $$;

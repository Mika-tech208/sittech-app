-- T14: REPLANEJAMENTO RESTRITO (modo ativo_restrito) — portão no banco (modo + semana), aplicação atômica com concorrência otimista, idempotência,
-- auditoria append-only (versões/hash antes e depois, linhas antes), reversão segura, revisões da decisão, reavaliação por evento, grants.
-- Tudo desfeito no final. Rodar só em DEV/local (ou dentro de BEGIN…ROLLBACK junto com a migration).
do $$
declare
  v_prev uuid; v_snap jsonb;
  F1 uuid; F2 uuid; M1 uuid; M2 uuid; P1 uuid; E1 uuid; O1 uuid;
  D1 date := '2031-03-04';
  v_ok boolean; v_n integer; v_r jsonb; v_aud uuid; v_h_antes text; v_h_ini text; v_msg text; v_ev0 integer; v_dec uuid := gen_random_uuid(); v_dec2 uuid := gen_random_uuid(); v_dec3 uuid := gen_random_uuid();
  v_corte jsonb; v_dias jsonb; v_aloc jsonb;
begin
  select (array_agg(id order by id))[1], (array_agg(id order by id))[2] into F1, F2 from (select id from funcionarios where ativo order by id limit 2) t;
  select (array_agg(id order by id))[1], (array_agg(id order by id))[2] into M1, M2 from (select id from maquinas where ativo order by id limit 2) t;
  select produto_id, id, operacao_id into P1, E1, O1 from roteiro_etapas order by id limit 1;
  if F2 is null or M2 is null or E1 is null then raise exception 'FALHOU setup do DEV'; end if;

  -- (1) modos e semanas autorizadas: constraints
  update escala_parametros set valor = '"ativo_restrito"' where chave = 'replanejamento_modo';
  begin update escala_parametros set valor = '"loucura"' where chave = 'replanejamento_modo'; v_ok := false; exception when others then v_ok := position('escala_parametros_replanejamento_modo' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (1) modo inválido deveria ser recusado'; end if;
  begin update escala_parametros set valor = '{"a":1}'::jsonb where chave = 'replanejamento_semanas_ativas'; v_ok := false; exception when others then v_ok := position('escala_parametros_replanejamento_semanas' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (1) semanas deve ser array'; end if;
  if (select valor from escala_parametros where chave = 'replanejamento_semanas_ativas') <> '[]'::jsonb then raise exception 'FALHOU (1) semanas nasce vazio (nenhuma semana autorizada)'; end if;

  -- (2) mudar modo/semanas NÃO recalcula o oficial (nenhum evento novo na outbox)
  select count(*) into v_ev0 from escala_producao_eventos;
  update escala_parametros set valor = '["2031-03-03"]'::jsonb where chave = 'replanejamento_semanas_ativas';
  update escala_parametros set valor = '[]'::jsonb where chave = 'replanejamento_semanas_ativas';
  select count(*) into v_n from escala_producao_eventos;
  if v_n <> v_ev0 then raise exception 'FALHOU (2) mudar semanas/modo não pode gerar recálculo oficial: % → %', v_ev0, v_n; end if;

  -- cenário: 1 dia, 3 períodos (m1 executado, m2 comprometido, m3 alterável), 2 pessoas
  insert into previsoes (semana_inicio) values ('2031-03-03') returning id into v_prev;
  select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', inicio, 'fim', fim) order by id) into v_snap from periodos;
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (D1, v_prev, v_snap, 0);
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values
    (D1, 'm1', F1, M1, P1, E1, O1, 100, null), (D1, 'm1', F2, null, null, null, null, 0, 'sem carga'),
    (D1, 'm2', F1, null, null, null, null, 0, 'sem carga'), (D1, 'm2', F2, M1, P1, E1, O1, 100, null),
    (D1, 'm3', F1, M2, P1, E1, O1, 50, null), (D1, 'm3', F2, null, null, null, null, 0, 'sem carga');
  v_h_ini := escala_hash_regiao(v_prev, D1, 'm3');
  v_corte := jsonb_build_object('semana_inicio', '2031-03-03', 'data', D1, 'periodo_id', 'm1', 'slot', 0, 'revisao', 1, 'motivo', 'fechamento');
  v_dias := jsonb_build_array(jsonb_build_object('data', D1, 'versao_base', 0, 'periodos_snapshot', v_snap));
  v_aloc := jsonb_build_array(
    jsonb_build_object('data', D1, 'periodo_id', 'm3', 'funcionario_id', F1, 'maquina_id', null, 'produto_id', null, 'etapa_id', null, 'operacao_id', null, 'pecas', 0, 'pecas_adicional', 0, 'tipo_adicional', null, 'origem', 'auto', 'excecao_revezamento', false, 'motivo_excecao', null, 'motivo_sem_posto', 'sem carga'),
    jsonb_build_object('data', D1, 'periodo_id', 'm3', 'funcionario_id', F2, 'maquina_id', M2, 'produto_id', P1, 'etapa_id', E1, 'operacao_id', O1, 'pecas', 80, 'pecas_adicional', 0, 'tipo_adicional', null, 'origem', 'auto', 'excecao_revezamento', false, 'motivo_excecao', null, 'motivo_sem_posto', null));
  set local role service_role;

  -- (3) PORTÃO: modo sombra e semana não autorizada recusam, sem gravar nada
  perform 1;
  reset role; update escala_parametros set valor = '"sombra"' where chave = 'replanejamento_modo'; update escala_parametros set valor = '["2031-03-03"]'::jsonb where chave = 'replanejamento_semanas_ativas'; set local role service_role;
  begin perform escala_replanejamento_aplicar(v_prev, v_dec, v_corte, v_dias, D1, 'm3', v_aloc, 'h', '{}'::jsonb, '{}'::jsonb); v_ok := false; exception when others then v_ok := position('ESCALA_REPLAN_NAO_AUTORIZADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3a) modo sombra não pode escrever'; end if;
  reset role; update escala_parametros set valor = '"ativo_restrito"' where chave = 'replanejamento_modo'; update escala_parametros set valor = '["2031-03-10"]'::jsonb where chave = 'replanejamento_semanas_ativas'; set local role service_role;
  begin perform escala_replanejamento_aplicar(v_prev, v_dec, v_corte, v_dias, D1, 'm3', v_aloc, 'h', '{}'::jsonb, '{}'::jsonb); v_ok := false; exception when others then v_ok := position('ESCALA_REPLAN_NAO_AUTORIZADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3b) semana não autorizada não pode escrever'; end if;
  if escala_hash_regiao(v_prev, D1, 'm3') <> v_h_ini then raise exception 'FALHOU (3) recusa não pode gravar nada'; end if;
  reset role; update escala_parametros set valor = '["2031-03-03"]'::jsonb where chave = 'replanejamento_semanas_ativas'; set local role service_role;

  -- (4) aplicação autorizada: SÓ m3 muda; m1/m2 intactos; versão do dia sobe; auditoria completa
  v_r := escala_replanejamento_aplicar(v_prev, v_dec, v_corte, v_dias, D1, 'm3', v_aloc, 'hp', '{"total":2}'::jsonb, '{"alocacoes":2}'::jsonb);
  if (select pecas from escala_producao_alocacoes where data = D1 and periodo_id = 'm3' and funcionario_id = F2) <> 80 then raise exception 'FALHOU (4) m3 deveria ter sido regravado'; end if;
  if (select pecas from escala_producao_alocacoes where data = D1 and periodo_id = 'm1' and funcionario_id = F1) <> 100 or (select pecas from escala_producao_alocacoes where data = D1 and periodo_id = 'm2' and funcionario_id = F2) <> 100 then raise exception 'FALHOU (4) m1/m2 não podem mudar'; end if;
  if (select versao from escala_producao_dias where data = D1) <> 1 then raise exception 'FALHOU (4) versão do dia deveria subir'; end if;
  if (v_r->>'hash_antes') <> v_h_ini or (v_r->>'hash_depois') = v_h_ini or (v_r->>'hash_depois') <> escala_hash_regiao(v_prev, D1, 'm3') then raise exception 'FALHOU (4) hashes: %', v_r; end if;
  select id into v_aud from escala_replanejamentos where decisao_id = v_dec and tipo = 'aplicacao' and resultado = 'aplicado';
  if v_aud is null or jsonb_array_length((select linhas_antes from escala_replanejamentos where id = v_aud)) <> 2 or jsonb_array_length((select linhas_depois from escala_replanejamentos where id = v_aud)) <> 2 then raise exception 'FALHOU (4) auditoria sem linhas antes/depois'; end if;
  if (select (versoes_antes->>D1::text)::int from escala_replanejamentos where id = v_aud) <> 0 or (select (versoes_depois->>D1::text)::int from escala_replanejamentos where id = v_aud) <> 1 then raise exception 'FALHOU (4) versões antes/depois'; end if;

  -- (5) IDEMPOTÊNCIA: a mesma decisão não aplica duas vezes
  begin perform escala_replanejamento_aplicar(v_prev, v_dec, v_corte, jsonb_build_array(jsonb_build_object('data', D1, 'versao_base', 1, 'periodos_snapshot', v_snap)), D1, 'm3', v_aloc, 'hp', '{}'::jsonb, '{}'::jsonb); v_ok := false; exception when others then v_ok := position('ESCALA_REPLAN_JA_APLICADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (5) segunda aplicação da mesma decisão deveria ser recusada'; end if;

  -- (6) CONCORRÊNCIA: versão base velha (a Escala mudou entre a decisão e a gravação) => nada é gravado
  v_h_antes := escala_hash_regiao(v_prev, D1, 'm3');
  select count(*) into v_n from escala_replanejamentos;
  begin perform escala_replanejamento_aplicar(v_prev, v_dec2, v_corte, v_dias, D1, 'm3', v_aloc, 'hp2', '{}'::jsonb, '{}'::jsonb); v_ok := false; exception when others then v_ok := position('ESCALA_VERSAO_CONFLITO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) versão base velha deveria dar conflito'; end if;
  if escala_hash_regiao(v_prev, D1, 'm3') <> v_h_antes or (select versao from escala_producao_dias where data = D1) <> 1 or (select count(*) from escala_replanejamentos) <> v_n then raise exception 'FALHOU (6) conflito não pode gravar nada'; end if;

  -- (7) REVERSÃO: devolve exatamente as linhas do corte; segunda reversão recusada; reversão recusada se alguém mexeu depois
  v_r := escala_replanejamento_reverter(v_aud, 'teste');
  if escala_hash_regiao(v_prev, D1, 'm3') <> v_h_ini or (v_r->>'hash_restaurado') <> v_h_ini then raise exception 'FALHOU (7) reversão deveria restaurar o hash inicial'; end if;
  if not exists (select 1 from escala_replanejamentos where tipo = 'reversao' and resultado = 'revertido' and (resumo->>'aplicacao_id') = v_aud::text) then raise exception 'FALHOU (7) reversão deveria ficar registrada'; end if;
  begin perform escala_replanejamento_reverter(v_aud, 'de novo'); v_ok := false; exception when others then v_ok := position('já revertida' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7) segunda reversão deveria ser recusada'; end if;
  v_dias := jsonb_build_array(jsonb_build_object('data', D1, 'versao_base', (select versao from escala_producao_dias where data = D1), 'periodos_snapshot', v_snap));
  perform escala_replanejamento_aplicar(v_prev, v_dec3, v_corte, v_dias, D1, 'm3', v_aloc, 'hp3', '{}'::jsonb, '{}'::jsonb);
  select id into v_aud from escala_replanejamentos where decisao_id = v_dec3 and tipo = 'aplicacao' and resultado = 'aplicado';
  update escala_producao_alocacoes set pecas = 123 where data = D1 and periodo_id = 'm3' and funcionario_id = F2; -- alguém trocou/editou depois
  begin perform escala_replanejamento_reverter(v_aud, 'tarde'); v_ok := false; exception when others then v_ok := position('ESCALA_REPLAN_REVERSAO_CONFLITO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (7) reversão sobre Escala alterada depois deveria ser recusada'; end if;
  if (select pecas from escala_producao_alocacoes where data = D1 and periodo_id = 'm3' and funcionario_id = F2) <> 123 then raise exception 'FALHOU (7) a decisão humana posterior não pode ser desfeita'; end if;

  -- (8) registro das avaliações sem escrita (hash lido no banco) e reavaliação por EVENTO
  perform escala_replanejamento_registrar(jsonb_build_object('previsao_id', v_prev, 'semana_inicio', '2031-03-03', 'data', D1, 'periodo_id', 'm1', 'slot', 0, 'revisao', 2, 'tipo', 'aplicacao', 'resultado', 'sem_mudanca', 'motivo', 'sem ganho', 'a_partir_data', D1, 'a_partir_periodo', 'm3', 'hash_proposta', 'x'));
  if (select hash_antes from escala_replanejamentos where resultado = 'sem_mudanca' and previsao_id = v_prev) <> escala_hash_regiao(v_prev, D1, 'm3') then raise exception 'FALHOU (8) hash_antes deveria ser lido no banco'; end if;
  begin perform escala_replanejamento_registrar(jsonb_build_object('previsao_id', v_prev, 'semana_inicio', '2031-03-03', 'data', D1, 'periodo_id', 'm1', 'slot', 0, 'tipo', 'aplicacao', 'resultado', 'aplicado', 'motivo', 'x')); v_ok := false; exception when others then v_ok := position('ESCALA_REPLAN_REGISTRO_INVALIDO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (8) "aplicado" só pelas RPCs de aplicação'; end if;
  if exists (select 1 from escala_replanejamento_pendentes(array['2031-03-03'::date])) then raise exception 'FALHOU (8) nada mudou desde a última avaliação: nada pendente'; end if;
  update escala_producao_alocacoes set pecas = 7 where data = D1 and periodo_id = 'm3' and funcionario_id = F2; -- o oficial recalculou (ausência, Previsão...)
  select count(*) into v_n from escala_replanejamento_pendentes(array['2031-03-03'::date]);
  if v_n <> 1 then raise exception 'FALHOU (8) Escala mudou depois da avaliação: deveria haver 1 reavaliação pendente, veio %', v_n; end if;
  reset role; update escala_parametros set valor = '"sombra"' where chave = 'replanejamento_modo'; set local role service_role;
  if exists (select 1 from escala_replanejamento_pendentes(array['2031-03-03'::date])) then raise exception 'FALHOU (8) fora do modo ativo_restrito não há reavaliação'; end if;
  reset role; update escala_parametros set valor = '"ativo_restrito"' where chave = 'replanejamento_modo'; set local role service_role;

  -- (9) revisões da decisão: 0 = decisão do corte (sombra), 1+ = decisões de aplicação com o estado do momento; mesma revisão duas vezes = idempotente
  declare d jsonb := jsonb_build_object('previsao_id', v_prev, 'semana_inicio', '2031-03-03', 'data', D1, 'periodo_id', 'm1', 'slot', 0, 'corte_em', now(), 'motivo_fechamento', 'estavel', 'dados_completos', true, 'completude_percentual', 100,
      'postos_esperados', 1, 'postos_recebidos', 1, 'horizonte', '{}'::jsonb, 'compromisso', '{}'::jsonb, 'entradas', '{}'::jsonb, 'planos', '{}'::jsonb, 'diagnostico', '{}'::jsonb, 'entrada', '{}'::jsonb,
      'hash_entrada', 'a', 'hash_plano_oficial', 'b', 'hash_plano_sombra', 'c', 'hash_decisao', 'd', 'situacao', 'OK', 'versao_motor', '4d.1', 'replanejamento_modo', 'sombra', 'revisao', 0, 'motivo', 'fechamento'); r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
  begin
    r1 := escala_sombra_gravar_decisao(null, d);
    r2 := escala_sombra_gravar_decisao(null, d);
    r3 := escala_sombra_gravar_decisao(null, d || jsonb_build_object('revisao', 1, 'motivo', 'reavaliacao', 'replanejamento_modo', 'ativo_restrito'));
    r4 := escala_sombra_gravar_decisao(null, d || jsonb_build_object('revisao', 1, 'motivo', 'reavaliacao', 'replanejamento_modo', 'ativo_restrito'));
    if (r1->>'inserida')::boolean is not true or (r2->>'inserida')::boolean is not false or (r3->>'inserida')::boolean is not true or (r4->>'inserida')::boolean is not false then raise exception 'FALHOU (9) revisões/idempotência: % % % %', r1, r2, r3, r4; end if;
    if (select count(*) from escala_sombra_decisoes where previsao_id = v_prev) <> 2 then raise exception 'FALHOU (9) 2 revisões da mesma decisão'; end if;
  end;

  -- (10) append-only e grants (o navegador não escreve nem executa as RPCs)
  reset role;
  begin update escala_replanejamentos set motivo = 'x' where previsao_id = v_prev; v_ok := false; exception when others then v_ok := position('imut' in lower(sqlerrm)) > 0 or position('append' in lower(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (10) auditoria deveria ser imutável'; end if;
  reset role; set local role authenticated;
  begin perform escala_replanejamento_aplicar(v_prev, gen_random_uuid(), v_corte, v_dias, D1, 'm3', v_aloc, 'h', '{}'::jsonb, '{}'::jsonb); v_ok := false; exception when others then v_ok := position('permission denied' in lower(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (10) navegador não executa a RPC de aplicação'; end if;
  begin perform escala_replanejamento_reverter(v_aud, 'x'); v_ok := false; exception when others then v_ok := position('permission denied' in lower(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (10) navegador não executa a RPC de reversão'; end if;
  begin insert into escala_replanejamentos (previsao_id, semana_inicio, data, periodo_id, slot, tipo, resultado) values (v_prev, D1, D1, 'm1', 0, 'aplicacao', 'sem_mudanca'); v_ok := false; exception when others then v_ok := position('permission denied' in lower(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (10) navegador não escreve na auditoria'; end if;
  reset role;

  raise exception 'TESTE_OK T14: portão no banco, aplicação atômica só do alterável, concorrência, idempotência, auditoria, reversão segura, revisões e reavaliação por evento';
end $$;

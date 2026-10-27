-- Teste de banco: registro de avaliações NÃO aplicadas do replanejamento restrito é IDEMPOTENTE (migration 20261105180000).
-- Local/DEV; tudo desfeito (ROLLBACK). Pressupõe as migrations do replanejamento restrito (20261027100000) e a 20261105180000.
begin;
do $$
declare
  v_prev uuid; v_snap jsonb;
  F1 uuid; F2 uuid; M1 uuid; P1 uuid; E1 uuid; O1 uuid;
  D1 date := '2031-03-04';
  v_dados jsonb; v_id1 uuid; v_id2 uuid; v_id3 uuid; v_n integer; v_ok boolean;
begin
  select (array_agg(id order by id))[1], (array_agg(id order by id))[2] into F1, F2 from (select id from funcionarios where ativo order by id limit 2) t;
  select id into M1 from maquinas where ativo order by id limit 1;
  select produto_id, id, operacao_id into P1, E1, O1 from roteiro_etapas order by id limit 1;
  if F2 is null or M1 is null or E1 is null then raise exception 'FALHOU setup'; end if;
  insert into previsoes (semana_inicio) values ('2031-03-03') returning id into v_prev;
  select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', inicio, 'fim', fim) order by id) into v_snap from periodos;
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (D1, v_prev, v_snap, 0);
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, motivo_sem_posto) values
    (D1, 'm2', F1, M1, P1, E1, O1, 100, null), (D1, 'm2', F2, null, null, null, null, 0, 'sem carga');
  set local role service_role;

  v_dados := jsonb_build_object('decisao_id', gen_random_uuid(), 'previsao_id', v_prev, 'semana_inicio', '2031-03-03', 'data', D1, 'periodo_id', 'm1', 'slot', 0, 'revisao', 5, 'tipo', 'aplicacao',
    'resultado', 'recusado', 'motivo', 'região já iniciada (m2): decisão defasada', 'gatilho', 'reavaliacao', 'a_partir_data', D1, 'a_partir_periodo', 'm2', 'hash_proposta', 'hp1');

  -- (1) o primeiro registro entra, com o hash da região lido no banco
  v_id1 := escala_replanejamento_registrar(v_dados);
  if (select hash_antes from escala_replanejamentos where id = v_id1) is distinct from escala_hash_regiao(v_prev, D1, 'm2') then raise exception 'FALHOU (1) hash_antes lido no banco'; end if;

  -- (2) invocações repetidas/concorrentes do MESMO estado (outra decisão e outra revisão, mesmo resto) NÃO geram outra linha: devolvem o mesmo id
  v_id2 := escala_replanejamento_registrar(v_dados || jsonb_build_object('decisao_id', gen_random_uuid(), 'revisao', 6));
  v_id3 := escala_replanejamento_registrar(v_dados || jsonb_build_object('decisao_id', gen_random_uuid(), 'revisao', 7));
  select count(*) into v_n from escala_replanejamentos where previsao_id = v_prev;
  if v_n <> 1 or v_id2 <> v_id1 or v_id3 <> v_id1 then raise exception 'FALHOU (2) idempotência: % linhas', v_n; end if;

  -- (3) proposta diferente => outro fato => nova linha
  v_id2 := escala_replanejamento_registrar(v_dados || jsonb_build_object('hash_proposta', 'hp2'));
  if v_id2 = v_id1 then raise exception 'FALHOU (3) proposta diferente deve registrar'; end if;
  -- (3b) motivo diferente (ex.: tentativas 1/3, 2/3 de um conflito) => cada uma registrada
  v_id2 := escala_replanejamento_registrar(v_dados || jsonb_build_object('resultado', 'conflito', 'motivo', 'tentativa 1/3'));
  v_id3 := escala_replanejamento_registrar(v_dados || jsonb_build_object('resultado', 'conflito', 'motivo', 'tentativa 2/3'));
  if v_id3 = v_id2 then raise exception 'FALHOU (3b) motivos diferentes devem registrar'; end if;
  -- (3c) resultado/região diferentes
  v_id2 := escala_replanejamento_registrar(v_dados || jsonb_build_object('resultado', 'sem_mudanca', 'motivo', 'x'));
  v_id3 := escala_replanejamento_registrar(v_dados || jsonb_build_object('resultado', 'sem_mudanca', 'motivo', 'x', 'a_partir_periodo', 'm3'));
  if v_id3 = v_id2 then raise exception 'FALHOU (3c) região diferente deve registrar'; end if;

  -- (4) a Escala mudou => hash_antes novo => nova linha; e A → B → A: voltar ao estado anterior depois de outro registro é fato novo
  select count(*) into v_n from escala_replanejamentos where previsao_id = v_prev;
  reset role;
  update escala_producao_alocacoes set pecas = 90 where data = D1 and periodo_id = 'm2' and funcionario_id = F1;
  set local role service_role;
  v_id2 := escala_replanejamento_registrar(v_dados);
  if v_id2 = v_id1 or (select count(*) from escala_replanejamentos where previsao_id = v_prev) <> v_n + 1 then raise exception 'FALHOU (4) Escala mudou: deve registrar'; end if;
  v_id3 := escala_replanejamento_registrar(v_dados);
  if v_id3 <> v_id2 then raise exception 'FALHOU (4b) mesma Escala nova: idempotente'; end if;
  reset role;
  update escala_producao_alocacoes set pecas = 100 where data = D1 and periodo_id = 'm2' and funcionario_id = F1;
  set local role service_role;
  v_id3 := escala_replanejamento_registrar(v_dados);
  if v_id3 = v_id1 or v_id3 = v_id2 then raise exception 'FALHOU (4c) A→B→A é registro novo'; end if;

  -- (5) 'aplicado'/'revertido' continuam proibidos aqui
  begin perform escala_replanejamento_registrar(v_dados || jsonb_build_object('resultado', 'aplicado')); v_ok := false; exception when others then v_ok := position('ESCALA_REPLAN_REGISTRO_INVALIDO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (5) aplicado deve ser recusado'; end if;

  -- (6) grants: só service_role executa
  reset role; set local role authenticated;
  begin perform escala_replanejamento_registrar(v_dados); v_ok := false; exception when others then v_ok := sqlstate = '42501'; end;
  reset role;
  if not v_ok then raise exception 'FALHOU (6) authenticated não pode executar'; end if;
  raise notice 'TESTE_OK escala_replanejamento_registrar idempotente (6 grupos)';
end $$;
rollback;

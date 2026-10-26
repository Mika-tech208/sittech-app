-- T1: obter_apontado_real_previsao_por_semana — agrega a produção BOA dos apontamentos ATUAIS da semana por (produto, etapa, operação gravada), junto com o roteiro
-- atual; histórico de edição e sem_producao nunca entram; fora da semana não conta; sem permissão é recusado. Tudo desfeito no final.
do $$
declare
  v_adm uuid; v_usr uuid; v_op uuid[]; v_maq uuid; v_func uuid;
  PA uuid := gen_random_uuid(); PU uuid := gen_random_uuid();
  EA1 uuid := gen_random_uuid(); EA2 uuid := gen_random_uuid(); EA3 uuid := gen_random_uuid(); EU uuid := gen_random_uuid();
  v_ap uuid; v_n int; v_boas numeric; v_amb numeric; r record;
  SEM date := '2031-03-03'; -- segunda-feira
  procedure_ok boolean;
begin
  select auth_user_id, id into v_adm, v_usr from usuarios where papel = 'admin' and ativo order by id limit 1;
  v_op := array(select id from operacoes order by id limit 3);
  select id into v_maq from maquinas where ativo order by id limit 1;
  select id into v_func from funcionarios order by id limit 1;
  if v_adm is null or coalesce(array_length(v_op, 1), 0) < 3 or v_maq is null or v_func is null then raise exception 'FALHOU setup'; end if;

  insert into produtos (id, nome, valor_unitario, ativo, prioridade) values (PA, 'TESTE-APONT A (3 etapas)', 1, true, 'media'), (PU, 'TESTE-APONT U (1 etapa)', 1, true, 'media');
  insert into roteiro_etapas (id, produto_id, operacao_id, ordem) values (EA1, PA, v_op[1], 0), (EA2, PA, v_op[2], 1), (EA3, PA, v_op[3], 2), (EU, PU, v_op[1], 0);

  -- A: 100 boas na 1ª etapa, 90 na 2ª, 80 na última
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
    periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente) values
    (PA, EA1, v_op[1], v_maq, v_func, 'm1', SEM,     '09:00', 100, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 1),
    (PA, EA2, v_op[2], v_maq, v_func, 'm2', SEM + 1, '10:00', 90,  0, '08:48', '10:24', 100, 10, v_usr, 'produzindo', 1),
    (PA, EA3, v_op[3], v_maq, v_func, 'm3', SEM + 2, '11:00', 80,  0, '10:24', '11:55', 100, 10, v_usr, 'produzindo', 1),
    -- etapa única: 100 produzidas, 5 refugo => 95
    (PU, EU,  v_op[1], v_maq, v_func, 't1', SEM,     '14:00', 100, 5, '13:00', '14:20', 100, 10, v_usr, 'produzindo', 1),
    -- fora da semana (dia anterior e semana seguinte): não conta
    (PA, EA3, v_op[3], v_maq, v_func, 'm1', SEM - 1, '09:00', 999, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 1),
    (PA, EA3, v_op[3], v_maq, v_func, 'm1', SEM + 7, '09:00', 888, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 1);
  -- dois apontamentos da última etapa do produto U (40 + 60)
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
    periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente) values
    (PU, EU, v_op[1], v_maq, v_func, 'm2', SEM + 3, '10:00', 40, 0, '08:48', '10:24', 100, 10, v_usr, 'produzindo', 1),
    (PU, EU, v_op[1], v_maq, v_func, 'm3', SEM + 3, '11:00', 60, 0, '10:24', '11:55', 100, 10, v_usr, 'produzindo', 1);
  -- sem_producao não soma (por constraint não tem produto/etapa/funcionário: não pode ser atribuído a produto algum) — o status é filtrado de qualquer forma
  insert into apontamentos_producao (maquina_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, criado_por, status, motivo_sem_producao)
    values (v_maq, 'm1', SEM + 4, '09:00', 0, 0, '07:12', '08:48', v_usr, 'sem_producao', 'sem_programacao');
  -- histórico de edição de um apontamento da última etapa: NÃO entra na conta (tabela à parte; a edição é UPDATE no lugar)
  select id into v_ap from apontamentos_producao where produto_id = PA and etapa_id = EA3 and data = SEM + 2;
  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo)
    values (v_ap, jsonb_build_object('quantidade_produzida', 50), jsonb_build_object('quantidade_produzida', 80), v_usr, 'correção');

  -- sem permissão: recusado
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.obter_apontado_real_previsao_por_semana(SEM); procedure_ok := false; exception when others then procedure_ok := position('permissão' in sqlerrm) > 0; end;
  if not procedure_ok then raise exception 'FALHOU sem permissão deveria ser recusado'; end if;
  reset role;

  -- admin: agregação
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- produto A: 3 linhas (uma por etapa) com o roteiro atual; última etapa = ordem 2, única
  select count(*) into v_n from public.obter_apontado_real_previsao_por_semana(SEM) where produto_id = PA;
  if v_n <> 3 then raise exception 'FALHOU A deveria ter 3 grupos (uma etapa cada), veio %', v_n; end if;
  select sum(quantidade_boa) into v_boas from public.obter_apontado_real_previsao_por_semana(SEM) where produto_id = PA and etapa_ordem = ultima_ordem and n_na_ultima_ordem = 1 and operacao_id = etapa_operacao_id;
  if v_boas <> 80 then raise exception 'FALHOU A: apontado real da última etapa deveria ser 80 (e não 270), veio %', v_boas; end if;
  select sum(quantidade_boa) into v_boas from public.obter_apontado_real_previsao_por_semana(SEM) where produto_id = PA;
  if v_boas <> 270 then raise exception 'FALHOU soma de todas as etapas (referência errada) = 270, veio %', v_boas; end if;
  -- produto U: 100 - 5 = 95 + 40 + 60 = 195 boas; o sem_producao não conta (n_apontamentos = 3)
  select quantidade_boa, n_apontamentos into r from public.obter_apontado_real_previsao_por_semana(SEM) where produto_id = PU;
  if r.quantidade_boa <> 195 or r.n_apontamentos <> 3 then raise exception 'FALHOU U: esperado 195 boas em 3 apontamentos (sem_producao fora), veio % em %', r.quantidade_boa, r.n_apontamentos; end if;
  -- fora da semana não aparece: semana seguinte só tem o de 888
  select sum(quantidade_boa) into v_boas from public.obter_apontado_real_previsao_por_semana(SEM + 7) where produto_id = PA;
  if v_boas <> 888 then raise exception 'FALHOU semana seguinte deveria ter só 888, veio %', v_boas; end if;
  reset role;

  -- roteiro ALTERADO depois do lançamento (mesmos ids, operações trocadas): o apontamento deixa de ser coerente => o TypeScript reporta como ambíguo
  update roteiro_etapas set operacao_id = v_op[1] where id = EA3;      -- a etapa final passa a ser da operação 1
  update roteiro_etapas set operacao_id = v_op[3] where id = EA1;      -- e a 1ª etapa da operação 3
  set local role authenticated;
  select count(*) into v_n from public.obter_apontado_real_previsao_por_semana(SEM) where produto_id = PA and etapa_id = EA3 and operacao_id <> etapa_operacao_id;
  if v_n <> 1 then raise exception 'FALHOU a incoerência (operação gravada x roteiro atual) deveria aparecer para a etapa final'; end if;
  select count(*) into v_n from public.obter_apontado_real_previsao_por_semana(SEM) where produto_id = PA and etapa_id = EA1 and operacao_id <> etapa_operacao_id;
  if v_n <> 1 then raise exception 'FALHOU a incoerência da 1ª etapa'; end if;
  reset role;

  raise exception 'TESTE_OK T1 apontado real: última etapa (80, não 270), etapa única com refugo (95), 40+60, fora da semana, sem_producao, histórico de edição, permissão e roteiro alterado detectável';
end $$;

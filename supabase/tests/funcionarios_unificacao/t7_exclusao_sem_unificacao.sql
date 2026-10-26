-- T7: EXCLUIR SEM UNIFICAR com histórico (somente admin): sem histórico, apontamentos, escala, ausência, tudo combinado,
-- trava de ocorrência com paradas de terceiros, assinatura (inclusive conteúdo alterado), rollback forçado, não-admin,
-- zero referências residuais, log completo e dados de terceiros intactos.
-- A exclusão destrutiva saiu da aplicação (funcionario_exclusao_* recusam "sem unificar"): resta a função interna _funcionario_exclusao para
-- administração de EMERGÊNCIA, fora da interface. Estes testes a exercitam por wrappers temporários (security definer; a checagem de admin é do núcleo).
create or replace function pg_temp.sim(a uuid, b uuid default null, c jsonb default '{}'::jsonb) returns jsonb language sql security definer as $$ select public._funcionario_exclusao(a, b, c, false, null) $$;
create or replace function pg_temp.exe(a uuid, b uuid, c jsonb, d text) returns jsonb language sql security definer as $$ select public._funcionario_exclusao(a, b, c, true, d) $$;
do $$
declare
  v_auth uuid := 'a27f42df-54fe-4718-93a7-0085f5ed5a09';
  v_usr uuid := 'dea8545a-dbdc-4ed7-9dc9-f44215389d91';
  v_sub uuid := 'af5c6ecd-e80d-4376-8330-efc0a389dc13';
  v_op uuid; v_etapa uuid; v_prod uuid; v_opet uuid; v_maq uuid[]; v_snap jsonb; v_mot uuid; v_motq uuid;
  S uuid := gen_random_uuid(); AP uuid := gen_random_uuid(); ES uuid := gen_random_uuid(); AU uuid := gen_random_uuid();
  TD uuid := gen_random_uuid(); K uuid := gen_random_uuid(); OC uuid := gen_random_uuid(); RB uuid := gen_random_uuid();
  PA uuid := gen_random_uuid(); P3 uuid := gen_random_uuid();
  oc_td uuid := gen_random_uuid(); oc_oc uuid := gen_random_uuid();
  ap_k uuid := gen_random_uuid(); ap_x uuid; ap_hist uuid;
  v_sim jsonb; v_res jsonb; v_err text; v_ok boolean; v_n bigint; v_log record;
  s1 text; s2 text;
begin
  select id into v_op from operacoes order by id limit 1;
  select id, produto_id, operacao_id into v_etapa, v_prod, v_opet from roteiro_etapas order by id limit 1;
  v_maq := array(select id from maquinas where ativo order by id limit 12);
  select periodos_snapshot into v_snap from escala_producao_dias limit 1;
  select id into v_mot from motivos_parada where not vinculavel_ocorrencia order by id limit 1;
  select id into v_motq from motivos_parada where categoria = 'quebra' and vinculavel_ocorrencia limit 1;

  -- função auxiliar: total de linhas (em QUALQUER tabela com FK para funcionarios) apontando para o id
  execute $f$create function pg_temp.refs(p uuid) returns bigint language plpgsql as $b$
    declare r record; n bigint; t bigint := 0;
    begin
      for r in select c.conrelid::regclass::text tab, a.attname col from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
               where c.confrelid='public.funcionarios'::regclass and c.contype='f' loop
        execute format('select count(*) from %s where %I = $1', r.tab, r.col) into n using p; t := t + n;
      end loop; return t; end $b$ $f$;

  insert into funcionarios (id, nome, operacao_id, salario_base, ativo) select x, 'TESTE-EXC ' || n, v_op, 2000, true
    from (values (S,'S'),(AP,'AP'),(ES,'ES'),(AU,'AU'),(TD,'TD'),(K,'K'),(OC,'OC'),(RB,'RB')) v(x, n);
  insert into previsoes (id, semana_inicio) values (PA, '2026-03-02'), (P3, '2026-01-05');
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot) values ('2026-01-05', P3, v_snap), ('2030-01-07', P3, v_snap);

  -- AP: 3 apontamentos (+3 paradas, +1 histórico)
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente)
  select v_prod, v_etapa, v_opet, v_maq[g], AP, 'm1', date '2026-02-01' + g, '09:00', 100 * g, g, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2 from generate_series(1, 3) g;
  insert into apontamento_paradas (apontamento_id, motivo_id, minutos, criado_por) select id, v_mot, 15, v_usr from apontamentos_producao where funcionario_id = AP;
  select id into ap_hist from apontamentos_producao where funcionario_id = AP order by data limit 1;
  insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo) values (ap_hist, '{}', '{}', v_usr, 'teste');
  -- ES: Escala (passado + futuro) e equipe
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas) values
    ('2026-01-05', 'm1', ES, v_maq[1], v_prod, v_etapa, v_opet, 10), ('2030-01-07', 't1', ES, v_maq[1], v_prod, v_etapa, v_opet, 10);
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id) values (PA, ES, true, v_op), (PA, K, true, v_op);
  -- AU: ausência + histórico
  insert into ausencias_funcionarios (id, funcionario_id, data, tipo, duracao_minutos, periodos_snapshot, idempotency_key, criado_por) values (gen_random_uuid(), AU, '2026-02-02', 'falta_dia_inteiro', 528, '[]', gen_random_uuid(), v_usr);
  insert into ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, motivo) select id, '{}', '{}', v_usr, 'teste' from ausencias_funcionarios where funcionario_id = AU;
  -- TD: tudo combinado (apontamentos+paradas+histórico, ocorrência própria com notificação, ausência+histórico, equipe, alocações, custos)
  insert into funcionario_custos (funcionario_id, descricao, valor) values (TD, 'VT', 100), (TD, 'Plano', 50);
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id) values (PA, TD, true, v_op);
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas) values
    ('2026-01-05', 'm2', TD, v_maq[2], v_prod, v_etapa, v_opet, 10), ('2030-01-07', 't2', TD, v_maq[2], v_prod, v_etapa, v_opet, 10);
  insert into ausencias_funcionarios (funcionario_id, data, tipo, duracao_minutos, periodos_snapshot, idempotency_key, criado_por) values (TD, '2026-03-05', 'atestado', 528, '[]', gen_random_uuid(), v_usr);
  insert into ausencia_funcionario_historico (ausencia_id, dados_anteriores, dados_novos, alterado_por, motivo) select id, '{}', '{}', v_usr, 'teste' from ausencias_funcionarios where funcionario_id = TD;
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente)
  select v_prod, v_etapa, v_opet, v_maq[3 + g], TD, 'm2', date '2026-03-01' + g, '10:00', 50 * g, 0, '08:48', '10:24', 100, 10, v_usr, 'produzindo', 2 from generate_series(1, 2) g;
  insert into ocorrencias_maquina (id, maquina_id, tipo, motivo_id, produto_id, etapa_id, operacao_id, funcionario_id, periodo_id_abertura, descricao, aberta_em, encerrada_em, descricao_solucao, criado_por, encerrado_por)
  values (oc_td, v_maq[6], 'quebra', v_motq, v_prod, v_etapa, v_opet, TD, 'm1', 'quebrou', '2026-03-02 12:00+00', '2026-03-02 13:00+00', 'ok', v_usr, v_usr);
  insert into push_notificacoes_ocorrencia (ocorrencia_id, subscription_id, status, evento) select oc_td, id, 'enviado', 'aberta' from push_subscriptions limit 1;
  insert into apontamento_paradas (apontamento_id, motivo_id, ocorrencia_id, minutos, criado_por, descricao) select id, v_motq, oc_td, 20, v_usr, 'quebra' from apontamentos_producao where funcionario_id = TD and data = '2026-03-02';
  insert into apontamento_paradas (apontamento_id, motivo_id, minutos, criado_por) select id, v_mot, 5, v_usr from apontamentos_producao where funcionario_id = TD and data = '2026-03-03';
  -- K: terceiro com apontamento (dados que NÃO podem mudar) e OC: dono de uma ocorrência com parada lançada por K
  insert into apontamentos_producao (id, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente)
  values (ap_k, v_prod, v_etapa, v_opet, v_maq[7], K, 'm1', '2026-02-10', '09:00', 70, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2);
  insert into ocorrencias_maquina (id, maquina_id, tipo, motivo_id, produto_id, etapa_id, operacao_id, funcionario_id, periodo_id_abertura, descricao, aberta_em, encerrada_em, descricao_solucao, criado_por, encerrado_por)
  values (oc_oc, v_maq[8], 'quebra', v_motq, v_prod, v_etapa, v_opet, OC, 'm1', 'quebrou', '2026-02-10 10:30+00', '2026-02-10 11:00+00', 'ok', v_usr, v_usr);
  insert into apontamento_paradas (apontamento_id, motivo_id, ocorrencia_id, minutos, criado_por, descricao) values (ap_k, v_motq, oc_oc, 10, v_usr, 'quebra');

  s1 := (select md5(string_agg(x, '|' order by x)) from (select 'ap:' || id::text || funcionario_id::text || quantidade_produzida::text x from apontamentos_producao where funcionario_id = K
        union all select 'pa:' || id::text from apontamento_paradas where apontamento_id = ap_k union all select 'eq:' || previsao_id::text from previsao_equipe_semana where funcionario_id = K
        union all select 'f:' || id::text from funcionarios where id = K) t);

  -- (h) NÃO-ADMIN recusado (simular e executar)
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform pg_temp.sim(AP, null, '{}'); v_ok := false; exception when others then v_ok := position('FUNC_SOMENTE_ADMIN' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (h) simular não-admin'; end if;
  begin perform pg_temp.exe(AP, null, '{}', 'x'); v_ok := false; exception when others then v_ok := position('FUNC_SOMENTE_ADMIN' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (h) executar não-admin'; end if;
  reset role;
  if pg_temp.refs(AP) = 0 then raise exception 'FALHOU preparo AP sem vínculos'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- (a) SEM histórico
  v_sim := pg_temp.sim(S, null, '{}');
  if not (v_sim->>'pode_executar')::boolean or (v_sim#>>'{remover,apontamentos}')::int <> 0 then raise exception 'FALHOU (a) %', v_sim; end if;
  v_res := pg_temp.exe(S, null, '{}', v_sim->>'assinatura');
  reset role;
  if exists (select 1 from funcionarios where id = S) then raise exception 'FALHOU (a) S deveria ter sido excluído'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- (b) COM APONTAMENTOS: nada de bloqueio; resumo do impacto; assinatura inválida; conteúdo alterado entre simular e executar
  v_sim := pg_temp.sim(AP, null, '{}');
  if not (v_sim->>'pode_executar')::boolean then raise exception 'FALHOU (b) não deveria bloquear: %', v_sim->'bloqueios'; end if;
  if (v_sim#>>'{remover,apontamentos}')::int <> 3 or (v_sim#>>'{remover,apontamento_paradas}')::int <> 3 or (v_sim#>>'{remover,apontamento_historico}')::int <> 1 then raise exception 'FALHOU (b) remover: %', v_sim->'remover'; end if;
  if (v_sim#>>'{impacto_indicadores,apontamentos,quantidade_produzida}')::numeric <> 600 or (v_sim#>>'{impacto_indicadores,apontamentos,quantidade_refugo}')::numeric <> 6 or (v_sim#>>'{impacto_indicadores,apontamentos,n}')::int <> 3
     or (v_sim#>>'{impacto_indicadores,apontamentos,valor_produzido}')::numeric <> 1200 or (v_sim#>>'{impacto_indicadores,paradas_minutos}')::numeric <> 45 then raise exception 'FALHOU (b) indicadores: %', v_sim->'impacto_indicadores'; end if;
  begin perform pg_temp.exe(AP, null, '{}', 'assinatura-invalida'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('FUNC_ASSINATURA_DESATUALIZADA' in v_err) > 0; end;
  if not v_ok then raise exception 'FALHOU (b) assinatura inválida: %', v_err; end if;
  reset role;
  insert into funcionario_custos (funcionario_id, descricao, valor) values (AP, 'surgiu depois da simulação', 1);   -- os dados mudam entre simular e executar
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform pg_temp.exe(AP, null, '{}', v_sim->>'assinatura'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('FUNC_ASSINATURA_DESATUALIZADA' in v_err) > 0; end;
  if not v_ok then raise exception 'FALHOU (b) dados mudaram e a execução deveria ser recusada: %', v_err; end if;
  v_sim := pg_temp.sim(AP, null, '{}');            -- nova simulação
  v_res := pg_temp.exe(AP, null, '{}', v_sim->>'assinatura');
  reset role;
  if exists (select 1 from funcionarios where id = AP) or pg_temp.refs(AP) <> 0 then raise exception 'FALHOU (b) sobrou algo de AP'; end if;
  if exists (select 1 from apontamento_paradas where apontamento_id = ap_hist) or exists (select 1 from apontamento_producao_historico where apontamento_id = ap_hist) then raise exception 'FALHOU (b) dependentes órfãos'; end if;
  select * into v_log from funcionarios_exclusoes_log where funcionario_excluido_id = AP;
  if not found or v_log.modo <> 'exclusao_sem_unificacao' or v_log.funcionario_mantido_id is not null or v_log.executado_por is distinct from v_usr
     or jsonb_array_length(v_log.descartados->'apontamentos') <> 3 or jsonb_array_length(v_log.descartados->'apontamento_paradas') <> 3 or jsonb_array_length(v_log.descartados->'apontamento_historico') <> 1
     or (v_log.snapshot->'funcionario'->>'nome') <> 'TESTE-EXC AP' or (v_log.plano#>>'{remover,apontamentos}')::int <> 3 then raise exception 'FALHOU (b) log: %', v_log; end if;

  -- (c) COM ESCALA + equipe
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_sim := pg_temp.sim(ES, null, '{}');
  if (v_sim#>>'{remover,alocacoes_passadas}')::int <> 1 or (v_sim#>>'{remover,alocacoes_futuras}')::int <> 1 or (v_sim#>>'{remover,semanas_equipe}')::int <> 1 then raise exception 'FALHOU (c) %', v_sim->'remover'; end if;
  v_res := pg_temp.exe(ES, null, '{}', v_sim->>'assinatura');
  reset role;
  if exists (select 1 from funcionarios where id = ES) or pg_temp.refs(ES) <> 0 then raise exception 'FALHOU (c) sobrou algo de ES'; end if;
  if not exists (select 1 from escala_producao_eventos where tipo = 'previsao' and payload->>'origem' = 'unificacao_funcionario' and previsao_id = P3) then raise exception 'FALHOU (c) recálculo da Escala não solicitado'; end if;

  -- (d) COM AUSÊNCIA (+ histórico da ausência)
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_sim := pg_temp.sim(AU, null, '{}');
  if (v_sim#>>'{remover,ausencias}')::int <> 1 or (v_sim#>>'{remover,ausencias_historico}')::int <> 1 then raise exception 'FALHOU (d) %', v_sim->'remover'; end if;
  v_res := pg_temp.exe(AU, null, '{}', v_sim->>'assinatura');
  reset role;
  if exists (select 1 from funcionarios where id = AU) or pg_temp.refs(AU) <> 0 then raise exception 'FALHOU (d) sobrou algo de AU'; end if;
  select * into v_log from funcionarios_exclusoes_log where funcionario_excluido_id = AU;
  if jsonb_array_length(v_log.descartados->'ausencias_removidas') <> 1 or jsonb_array_length(v_log.descartados#>'{ausencias_removidas,0,historico}') <> 1 then raise exception 'FALHOU (d) log da ausência: %', v_log.descartados; end if;

  -- (f) trava: ocorrência de OC com parada lançada por OUTRO funcionário (K) => bloqueia, nada muda
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_sim := pg_temp.sim(OC, null, '{}');
  if (v_sim->>'pode_executar')::boolean or v_sim#>>'{bloqueios,0,codigo}' <> 'OCORRENCIA_COM_PARADAS_DE_OUTROS' then raise exception 'FALHOU (f) %', v_sim->'bloqueios'; end if;
  begin perform pg_temp.exe(OC, null, '{}', v_sim->>'assinatura'); v_ok := false;
  exception when others then v_ok := position('FUNC_BLOQUEADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (f) execução deveria ser bloqueada'; end if;

  -- (e) TUDO COMBINADO
  v_sim := pg_temp.sim(TD, null, '{}');
  if not (v_sim->>'pode_executar')::boolean then raise exception 'FALHOU (e) %', v_sim->'bloqueios'; end if;
  if (v_sim#>>'{remover,apontamentos}')::int <> 2 or (v_sim#>>'{remover,apontamento_paradas}')::int <> 2 or (v_sim#>>'{remover,ocorrencias}')::int <> 1 or (v_sim#>>'{remover,notificacoes_ocorrencia}')::int <> 1
     or (v_sim#>>'{remover,ausencias}')::int <> 1 or (v_sim#>>'{remover,ausencias_historico}')::int <> 1 or (v_sim#>>'{remover,semanas_equipe}')::int <> 1
     or (v_sim#>>'{remover,alocacoes_passadas}')::int <> 1 or (v_sim#>>'{remover,alocacoes_futuras}')::int <> 1 or jsonb_array_length(v_sim#>'{remover,custos}') <> 2 then raise exception 'FALHOU (e) remover: %', v_sim->'remover'; end if;
  v_res := pg_temp.exe(TD, null, '{}', v_sim->>'assinatura');
  reset role;
  if exists (select 1 from funcionarios where id = TD) or pg_temp.refs(TD) <> 0 or exists (select 1 from ocorrencias_maquina where id = oc_td) or exists (select 1 from push_notificacoes_ocorrencia where ocorrencia_id = oc_td) then raise exception 'FALHOU (e) sobrou algo de TD'; end if;
  select * into v_log from funcionarios_exclusoes_log where funcionario_excluido_id = TD;
  if jsonb_array_length(v_log.descartados->'ocorrencias') <> 1 or jsonb_array_length(v_log.descartados->'notificacoes_ocorrencia') <> 1 or jsonb_array_length(v_log.descartados->'apontamentos') <> 2 or jsonb_array_length(v_log.snapshot->'custos') <> 2 then raise exception 'FALHOU (e) log: %', v_log.descartados; end if;

  -- (j) dados de TERCEIROS (K e OC) intactos
  s2 := (select md5(string_agg(x, '|' order by x)) from (select 'ap:' || id::text || funcionario_id::text || quantidade_produzida::text x from apontamentos_producao where funcionario_id = K
        union all select 'pa:' || id::text from apontamento_paradas where apontamento_id = ap_k union all select 'eq:' || previsao_id::text from previsao_equipe_semana where funcionario_id = K
        union all select 'f:' || id::text from funcionarios where id = K) t);
  if s1 <> s2 or not exists (select 1 from ocorrencias_maquina where id = oc_oc) then raise exception 'FALHOU (j) dados de terceiros foram alterados'; end if;

  -- (g) ROLLBACK FORÇADO: tudo combinado de novo (RB), falha no último passo => nada muda
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente)
  values (v_prod, v_etapa, v_opet, v_maq[9], RB, 'm1', '2026-04-02', '09:00', 10, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2);
  insert into apontamento_paradas (apontamento_id, motivo_id, minutos, criado_por) select id, v_mot, 5, v_usr from apontamentos_producao where funcionario_id = RB;
  insert into ausencias_funcionarios (funcionario_id, data, tipo, duracao_minutos, periodos_snapshot, idempotency_key, criado_por) values (RB, '2026-04-03', 'atestado', 528, '[]', gen_random_uuid(), v_usr);
  insert into funcionario_custos (funcionario_id, descricao, valor) values (RB, 'VT', 1);
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id) values (PA, RB, true, v_op);
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas) values ('2030-01-07', 't3', RB, v_maq[10], v_prod, v_etapa, v_opet, 1);
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_sim := pg_temp.sim(RB, null, '{}');
  reset role;
  s1 := (select md5(string_agg(x, '|' order by x)) from (select 'f:' || id::text x from funcionarios where id = RB union all select 'ap:' || id::text from apontamentos_producao where funcionario_id = RB
        union all select 'pa:' || p.id::text from apontamento_paradas p join apontamentos_producao a on a.id = p.apontamento_id where a.funcionario_id = RB union all select 'au:' || id::text from ausencias_funcionarios where funcionario_id = RB
        union all select 'cu:' || id::text from funcionario_custos where funcionario_id = RB union all select 'eq:' || previsao_id::text from previsao_equipe_semana where funcionario_id = RB
        union all select 'al:' || data::text || periodo_id from escala_producao_alocacoes where funcionario_id = RB union all select 'lg:' || id::text from funcionarios_exclusoes_log where funcionario_excluido_id = RB) t);
  execute 'create function pg_temp.zz_falha() returns trigger language plpgsql as $f$ begin raise exception ''FALHA_FORCADA''; end $f$';
  execute 'create trigger zz_falha before delete on public.funcionarios for each row execute function pg_temp.zz_falha()';
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform pg_temp.exe(RB, null, '{}', v_sim->>'assinatura'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('FALHA_FORCADA' in v_err) > 0; end;
  reset role;
  if not v_ok then raise exception 'FALHOU (g) deveria ter falhado: %', v_err; end if;
  s2 := (select md5(string_agg(x, '|' order by x)) from (select 'f:' || id::text x from funcionarios where id = RB union all select 'ap:' || id::text from apontamentos_producao where funcionario_id = RB
        union all select 'pa:' || p.id::text from apontamento_paradas p join apontamentos_producao a on a.id = p.apontamento_id where a.funcionario_id = RB union all select 'au:' || id::text from ausencias_funcionarios where funcionario_id = RB
        union all select 'cu:' || id::text from funcionario_custos where funcionario_id = RB union all select 'eq:' || previsao_id::text from previsao_equipe_semana where funcionario_id = RB
        union all select 'al:' || data::text || periodo_id from escala_producao_alocacoes where funcionario_id = RB union all select 'lg:' || id::text from funcionarios_exclusoes_log where funcionario_excluido_id = RB) t);
  if s1 <> s2 then raise exception 'FALHOU (g) rollback incompleto'; end if;
  execute 'drop trigger zz_falha on public.funcionarios';

  -- (i) referência RESIDUAL (nova tabela com FK) => aborta e desfaz tudo
  execute 'create table public.zz_ref_teste (f uuid references public.funcionarios(id))';
  execute format('insert into public.zz_ref_teste values (%L)', RB);
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform pg_temp.exe(RB, null, '{}', v_sim->>'assinatura'); v_ok := false;
  exception when others then v_err := sqlerrm; v_ok := position('FUNC_REFERENCIAS_RESIDUAIS' in v_err) > 0 and position('zz_ref_teste' in v_err) > 0; end;
  reset role;
  if not v_ok then raise exception 'FALHOU (i) referência residual: %', v_err; end if;
  s2 := (select md5(string_agg(x, '|' order by x)) from (select 'f:' || id::text x from funcionarios where id = RB union all select 'ap:' || id::text from apontamentos_producao where funcionario_id = RB
        union all select 'pa:' || p.id::text from apontamento_paradas p join apontamentos_producao a on a.id = p.apontamento_id where a.funcionario_id = RB union all select 'au:' || id::text from ausencias_funcionarios where funcionario_id = RB
        union all select 'cu:' || id::text from funcionario_custos where funcionario_id = RB union all select 'eq:' || previsao_id::text from previsao_equipe_semana where funcionario_id = RB
        union all select 'al:' || data::text || periodo_id from escala_producao_alocacoes where funcionario_id = RB union all select 'lg:' || id::text from funcionarios_exclusoes_log where funcionario_excluido_id = RB) t);
  if s1 <> s2 then raise exception 'FALHOU (i) rollback incompleto'; end if;
  execute 'drop table public.zz_ref_teste';
  -- sem a falha, a mesma operação conclui
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := pg_temp.exe(RB, null, '{}', v_sim->>'assinatura');
  reset role;
  if exists (select 1 from funcionarios where id = RB) or pg_temp.refs(RB) <> 0 then raise exception 'FALHOU (g) conclusão de RB'; end if;

  -- DELETE direto continua impossível
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from funcionarios where id = K;
  reset role;
  if not exists (select 1 from funcionarios where id = K) then raise exception 'FALHOU DELETE direto'; end if;

  raise exception 'TESTE_OK T7: exclusão sem unificar — sem histórico, apontamentos, escala, ausência, tudo combinado; trava de ocorrência com paradas de terceiros; assinatura inválida e conteúdo alterado recusados; rollback forçado e referência residual; não-admin; zero referências residuais; log; terceiros intactos; DELETE direto bloqueado';
end $$;

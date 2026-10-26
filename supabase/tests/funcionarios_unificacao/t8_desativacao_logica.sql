-- T8: excluir funcionário = DESATIVAR, histórico preservado (linha do tempo bitemporal, somente admin, equipes futuras produtivo=false sem DELETE,
-- ATRASO_EM_ABERTO, edição de apontamento antigo de inativo, remoção física só de cadastro vazio, unificação inalterada). Tudo desfeito no final.
-- Rodar só em DEV/local (ou dentro de BEGIN…ROLLBACK junto com a migration). O relógio é fixado com `app.agora_teste` (public._agora()).
do $$
declare
  v_auth uuid; v_usr uuid;
  v_op uuid; v_etapa uuid; v_prod uuid; v_opet uuid; v_maq uuid[]; v_snap jsonb;
  X uuid := gen_random_uuid(); Y uuid := gen_random_uuid(); W uuid := gen_random_uuid(); E uuid := gen_random_uuid(); H uuid := gen_random_uuid();
  Q uuid := gen_random_uuid(); D1 uuid := gen_random_uuid(); D2 uuid := gen_random_uuid();
  P0 uuid := gen_random_uuid(); P1 uuid := gen_random_uuid(); P2 uuid := gen_random_uuid(); P3 uuid := gen_random_uuid();
  v_ap uuid; v_ap_d1 uuid;
  v_hash_antes text; v_hash_depois text; v_aloc_passada_antes text; v_aloc_passada_depois text;
  v_res jsonb; v_sim jsonb; v_err text; v_ok boolean; v_n bigint; v_n0 bigint; v_log0 text; r record; v_ev0 integer;
  v_efetivo timestamptz := '2031-03-04 17:00:00-03';

  -- hash de TODO o histórico vinculado a X (o que a antiga exclusão apagava)
  hx text;
begin
  select auth_user_id, id into v_auth, v_usr from usuarios where papel = 'admin' and ativo order by id limit 1;
  select id into v_op from operacoes order by id limit 1;
  select id, produto_id, operacao_id into v_etapa, v_prod, v_opet from roteiro_etapas order by id limit 1;
  v_maq := array(select id from maquinas where ativo order by id limit 4);
  select periodos_snapshot into v_snap from escala_producao_dias limit 1;
  if v_auth is null or v_etapa is null or coalesce(array_length(v_maq, 1), 0) < 2 or v_snap is null then raise exception 'FALHOU setup do DEV (admin/roteiro/máquinas/snapshot)'; end if;
  select md5(coalesce(string_agg(to_jsonb(l)::text, ',' order by l.id), '')) into v_log0 from funcionarios_exclusoes_log l;

  insert into funcionarios (id, nome, operacao_id, salario_base, ativo, created_at) values
    (X, 'TESTE-DESAT João', v_op, 2000, true, '2031-01-01'), (Y, 'TESTE-DESAT Yara', v_op, 2000, true, '2031-01-01'), (W, 'TESTE-DESAT Wagner', v_op, 2000, true, '2031-01-01'),
    (E, 'TESTE-DESAT Vazio', v_op, 0, true, '2031-01-01'), (H, 'TESTE-DESAT ComHistorico', v_op, 0, true, '2031-01-01'), (Q, 'TESTE-DESAT SoTimeline', v_op, 0, true, '2031-01-01'),
    (D1, 'TESTE-DESAT Duplicado', v_op, 2000, true, '2031-01-02'), (D2, 'TESTE-DESAT Duplicado', v_op, 2000, true, '2031-01-01');
  insert into funcionario_custos (funcionario_id, descricao, valor) values (X, 'Vale Transporte', 100), (X, 'Plano', 50);
  -- semanas: passada (24/02), ATUAL (03/03, hoje = 05/03 quarta), futuras (10/03 e 17/03)
  insert into previsoes (id, semana_inicio) values (P0, '2031-02-24'), (P1, '2031-03-03'), (P2, '2031-03-10'), (P3, '2031-03-17');
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo, operacao_id) values
    (P0, X, true, v_op), (P1, X, true, v_op), (P2, X, true, v_op), (P3, X, true, v_op), (P2, Y, true, v_op);
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values ('2031-02-25', P0, v_snap, 0), ('2031-03-04', P1, v_snap, 0), ('2031-03-11', P2, v_snap, 0);
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
    periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente) values
    (v_prod, v_etapa, v_opet, v_maq[1], X, 'm1', '2031-02-25', '09:00', 12500, 5, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2);
  select id into v_ap from apontamentos_producao where funcionario_id = X;
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
    periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status, valor_unitario_produto_vigente) values
    (v_prod, v_etapa, v_opet, v_maq[2], H, 'm1', '2031-02-25', '09:00', 10, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2),
    (v_prod, v_etapa, v_opet, v_maq[1], D1, 'm1', '2031-02-26', '09:00', 77, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo', 2);
  select id into v_ap_d1 from apontamentos_producao where funcionario_id = D1;
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas) values
    ('2031-02-25', 'm1', X, v_maq[1], v_prod, v_etapa, v_opet, 10),     -- passado
    ('2031-03-04', 'm1', X, v_maq[1], v_prod, v_etapa, v_opet, 10),     -- semana atual, já executado
    ('2031-03-11', 't1', X, v_maq[1], v_prod, v_etapa, v_opet, 10);     -- futuro (será replanejado pela Escala; a desativação NÃO apaga linha)
  insert into ausencias_funcionarios (funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, idempotency_key, criado_por) values
    (X, '2031-02-25', 'atraso', '07:12', '08:03', 51, v_snap, gen_random_uuid(), v_usr),
    (X, '2031-02-26', 'falta_dia_inteiro', null, null, 528, v_snap, gen_random_uuid(), v_usr);

  -- histórico de X que NUNCA pode mudar com a desativação (equipe só das semanas passada/atual; as futuras são o único alvo permitido)
  select md5(concat_ws('|',
    (select coalesce(string_agg(to_jsonb(a)::text, ',' order by a.id), '') from apontamentos_producao a where a.funcionario_id = X),
    (select coalesce(string_agg(to_jsonb(a)::text, ',' order by a.data, a.periodo_id), '') from escala_producao_alocacoes a where a.funcionario_id = X),
    (select coalesce(string_agg(to_jsonb(a)::text, ',' order by a.id), '') from ausencias_funcionarios a where a.funcionario_id = X),
    (select coalesce(string_agg(to_jsonb(a)::text, ',' order by a.id), '') from funcionario_custos a where a.funcionario_id = X),
    (select coalesce(string_agg(to_jsonb(a)::text, ',' order by a.previsao_id), '') from previsao_equipe_semana a where a.funcionario_id = X and a.previsao_id in (P0, P1)))) into v_hash_antes;
  select md5(coalesce(string_agg(to_jsonb(a)::text, ',' order by a.data, a.periodo_id), '')) into v_aloc_passada_antes from escala_producao_alocacoes a where a.funcionario_id = X and a.data <= '2031-03-04';

  -- (1) NÃO-ADMIN é recusado em tudo; admin comum idem não há: só papel admin passa
  perform set_config('app.agora_teste', '2031-03-05 10:00:00-03', true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.desativar_funcionario(X); v_ok := false; exception when others then v_ok := position('FUNC_SOMENTE_ADMIN' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (1) desativar por não-admin'; end if;
  begin perform public.reativar_funcionario(X); v_ok := false; exception when others then v_ok := position('FUNC_SOMENTE_ADMIN' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (1b) reativar por não-admin'; end if;
  begin perform public.funcionario_remover_vazio(E); v_ok := false; exception when others then v_ok := position('FUNC_SOMENTE_ADMIN' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (1c) remover por não-admin'; end if;
  begin perform public.funcionario_situacao_listar(X); v_ok := false; exception when others then v_ok := position('FUNC_SOMENTE_ADMIN' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (1d) listar por não-admin'; end if;

  -- (2) UPDATE direto de ativo (o antigo ⏸/▶) é recusado, mesmo para admin
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  begin update funcionarios set ativo = false where id = X; v_ok := false; exception when others then v_ok := position('FUNC_USE_RPC' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2) UPDATE direto de ativo deveria ser recusado'; end if;
  if not (select ativo from funcionarios where id = X) then raise exception 'FALHOU (2) ativo mudou'; end if;
  update funcionarios set nome = 'TESTE-DESAT João' where id = X; -- outros campos continuam editáveis

  -- (3) ATRASO EM ABERTO bloqueia a desativação; depois de resolvido, passa
  perform set_config('app.agora_teste', '2031-03-05 08:00:00-03', true);
  perform public.abrir_atraso_funcionario(Y, '2031-03-05', null, null, gen_random_uuid());
  begin perform public.desativar_funcionario(Y); v_ok := false; exception when others then v_ok := position('ATRASO_EM_ABERTO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3) atraso aberto deveria bloquear a desativação'; end if;
  if not (select ativo from funcionarios where id = Y) then raise exception 'FALHOU (3) Y não deveria ter sido desativado'; end if;
  v_res := public.funcionario_resumo(Y);
  if (v_res->>'atraso_em_aberto')::boolean is not true or (v_res->>'vazio')::boolean then raise exception 'FALHOU (3) resumo: %', v_res; end if;
  perform public.encerrar_atraso_funcionario((select id from ausencias_funcionarios where funcionario_id = Y and em_aberto), null);
  perform set_config('app.agora_teste', '2031-03-05 10:00:00-03', true);

  -- (4) DESATIVAR X com desligamento EFETIVO retroativo (saiu quarta 17:00, registrado quinta... aqui: efetivo 04/03 17:00, registrado 05/03 10:00)
  reset role;
  update escala_producao_eventos set status = 'processado' where status = 'pendente';
  set local role authenticated;
  v_res := public.desativar_funcionario(X, v_efetivo, 'saiu da empresa');
  if (v_res->>'ok')::boolean is not true or (v_res->>'equipes_futuras_ajustadas')::int <> 2 then raise exception 'FALHOU (4) retorno: %', v_res; end if;
  select * into r from funcionarios where id = X;
  if r.ativo or r.desligado_em <> v_efetivo or r.desligamento_registrado_em <> '2031-03-05 10:00:00-03' or r.desligado_por <> v_usr or r.motivo_desligamento <> 'saiu da empresa' then raise exception 'FALHOU (4) estado: %', to_jsonb(r); end if;
  if not exists (select 1 from funcionario_situacao_historico where funcionario_id = X and acao = 'desativado' and efetivo_em = v_efetivo and registrado_em = '2031-03-05 10:00:00-03'
                 and registrado_por = v_usr and ativo_antes and not ativo_depois and motivo = 'saiu da empresa') then raise exception 'FALHOU (4) linha do tempo'; end if;
  -- semanas: passada e ATUAL intactas; FUTURAS produtivo=false, linha preservada (sem DELETE)
  if (select count(*) from previsao_equipe_semana where funcionario_id = X) <> 4 then raise exception 'FALHOU (4) nenhuma linha de equipe pode ser apagada'; end if;
  if not (select produtivo from previsao_equipe_semana where funcionario_id = X and previsao_id = P0) or not (select produtivo from previsao_equipe_semana where funcionario_id = X and previsao_id = P1) then
    raise exception 'FALHOU (4) passado/semana atual não podem ser reescritos'; end if;
  if (select produtivo from previsao_equipe_semana where funcionario_id = X and previsao_id = P2) or (select produtivo from previsao_equipe_semana where funcionario_id = X and previsao_id = P3) then
    raise exception 'FALHOU (4) semanas futuras deveriam ter produtivo=false'; end if;
  if not (select produtivo from previsao_equipe_semana where funcionario_id = Y and previsao_id = P2) then raise exception 'FALHOU (4) outros funcionários não mudam'; end if;
  -- reavaliação normal da Escala: evento `previsao` para as semanas com Escala (atual P1 e futura P2)
  reset role;
  if (select count(*) from escala_producao_eventos where tipo = 'previsao' and previsao_id = P2 and status = 'pendente') < 1 then raise exception 'FALHOU (4) evento previsao da semana futura'; end if;
  if (select count(*) from escala_producao_eventos where tipo = 'previsao' and previsao_id = P1 and status = 'pendente') < 1 then raise exception 'FALHOU (4) evento previsao da semana atual'; end if;
  -- passado/histórico: hash IDÊNTICO (apontamentos, alocações inclusive a futura, ausências, custos, equipe passada/atual)
  select md5(concat_ws('|',
    (select coalesce(string_agg(to_jsonb(a)::text, ',' order by a.id), '') from apontamentos_producao a where a.funcionario_id = X),
    (select coalesce(string_agg(to_jsonb(a)::text, ',' order by a.data, a.periodo_id), '') from escala_producao_alocacoes a where a.funcionario_id = X),
    (select coalesce(string_agg(to_jsonb(a)::text, ',' order by a.id), '') from ausencias_funcionarios a where a.funcionario_id = X),
    (select coalesce(string_agg(to_jsonb(a)::text, ',' order by a.id), '') from funcionario_custos a where a.funcionario_id = X),
    (select coalesce(string_agg(to_jsonb(a)::text, ',' order by a.previsao_id), '') from previsao_equipe_semana a where a.funcionario_id = X and a.previsao_id in (P0, P1)))) into v_hash_depois;
  if v_hash_depois <> v_hash_antes then raise exception 'FALHOU (4) o histórico de X mudou com a desativação'; end if;
  select md5(coalesce(string_agg(to_jsonb(a)::text, ',' order by a.data, a.periodo_id), '')) into v_aloc_passada_depois from escala_producao_alocacoes a where a.funcionario_id = X and a.data <= '2031-03-04';
  if v_aloc_passada_depois <> v_aloc_passada_antes then raise exception 'FALHOU (4) alocações passadas mudaram'; end if;
  if not exists (select 1 from apontamentos_producao where id = v_ap and funcionario_id = X and quantidade_produzida = 12500) then raise exception 'FALHOU (4) apontamento (12.500 peças) preservado'; end if;

  -- (5) idempotência
  set local role authenticated;
  v_res := public.desativar_funcionario(X, null, 'de novo');
  if (v_res->>'ja_inativo')::boolean is not true then raise exception 'FALHOU (5) segunda desativação: %', v_res; end if;
  reset role;
  if (select count(*) from funcionario_situacao_historico where funcionario_id = X) <> 1 then raise exception 'FALHOU (5) não pode duplicar a linha do tempo'; end if;

  -- (6) validações de data
  set local role authenticated;
  begin perform public.desativar_funcionario(W, '2031-03-06 10:00:00-03'); v_ok := false; exception when others then v_ok := position('FUNC_DESLIGAMENTO_FUTURO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) desligamento no futuro'; end if;
  begin perform public.desativar_funcionario(W, '2030-12-31 10:00:00-03'); v_ok := false; exception when others then v_ok := position('FUNC_DESLIGAMENTO_ANTES_DO_CADASTRO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) desligamento antes do cadastro'; end if;
  begin perform public.reativar_funcionario(X, '2031-03-04 12:00:00-03'); v_ok := false; exception when others then v_ok := position('FUNC_REATIVACAO_ANTES_DO_DESLIGAMENTO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) reativação anterior ao desligamento'; end if;

  -- (7) linha do tempo BITEMPORAL: sombra sem hindsight
  reset role;
  if not public.funcionario_ativo_em(X, v_efetivo - interval '1 minute') then raise exception 'FALHOU (7) antes do desligamento estava ativo'; end if;
  if public.funcionario_ativo_em(X, v_efetivo) then raise exception 'FALHOU (7) no instante efetivo já está inativo'; end if;
  if public.funcionario_ativo_em(X, v_efetivo + interval '1 hour') then raise exception 'FALHOU (7) depois do desligamento está inativo'; end if;
  -- corte às 08:00 do dia 05 (o registro só entrou às 10:00): o sistema AINDA NÃO SABIA => ativo (sem hindsight), mesmo o efetivo sendo 04/03 17:00
  if not public.funcionario_ativo_em(X, '2031-03-05 08:00:00-03', '2031-03-05 08:00:00-03') then raise exception 'FALHOU (7) corte anterior ao registro não pode ver o desligamento'; end if;
  if public.funcionario_ativo_em(X, '2031-03-05 08:00:00-03', '2031-03-05 10:00:00-03') then raise exception 'FALHOU (7) corte posterior ao registro vê o desligamento'; end if;

  -- (8) o NOME continua resolvendo; histórico visível; nenhuma "ID desconhecido"
  set local role authenticated;
  if not exists (select 1 from funcionarios_elegibilidade where id = X and nome = 'TESTE-DESAT João' and not ativo and desligado_em = v_efetivo) then raise exception 'FALHOU (8) nome/desligamento na elegibilidade'; end if;
  v_res := public.funcionario_situacao_listar(X);
  if jsonb_array_length(v_res) <> 1 or v_res->0->>'acao' <> 'desativado' then raise exception 'FALHOU (8) listar: %', v_res; end if;

  -- (9) operações FUTURAS recusadas para inativo; edição de apontamento ANTIGO dele continua possível; trocar para outro inativo não
  begin perform public.registrar_ausencia_funcionario(X, '2031-03-06', 'falta_dia_inteiro', null, null, 528, null, gen_random_uuid()); v_ok := false; exception when others then v_ok := position('inativo' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (9) nova ausência para inativo'; end if;
  begin perform public.abrir_atraso_funcionario(X, '2031-03-05', null, null, gen_random_uuid()); v_ok := false; exception when others then v_ok := position('inativo' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (9) novo atraso para inativo'; end if;
  begin perform public.registrar_apontamento_producao(v_maq[1], v_prod, X, 10, 0, gen_random_uuid(), null); v_ok := false; exception when others then v_ok := position('inativo' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (9) novo apontamento para inativo'; end if;
  perform public.editar_apontamento_producao(v_ap, v_prod, X, 12600, 5, 'correção histórica de apontamento antigo do João');
  if not exists (select 1 from apontamentos_producao where id = v_ap and funcionario_id = X and quantidade_produzida = 12600) then raise exception 'FALHOU (9) editar apontamento antigo de inativo'; end if;
  reset role; v_n := 0;
  -- W inativo: trocar o apontamento de X para W (inativo) continua proibido
  set local role authenticated;
  perform public.desativar_funcionario(W, '2031-03-05 09:00:00-03', null);
  begin perform public.editar_apontamento_producao(v_ap, v_prod, W, 12600, 5, 'troca inválida'); v_ok := false; exception when others then v_ok := position('inativo' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (9) trocar para outro inativo'; end if;
  -- ausência histórica de inativo continua editável (nenhum bloqueio por estar inativo hoje)
  perform public.editar_ausencia_funcionario((select id from ausencias_funcionarios where funcionario_id = X and tipo = 'atraso'), 'atraso', '07:12', '08:10', 58, null, 'correção histórica');
  if (select duracao_minutos from ausencias_funcionarios where funcionario_id = X and tipo = 'atraso') <> 58 then raise exception 'FALHOU (9) editar ausência antiga de inativo'; end if;
  -- restaura para manter o hash comparável adiante
  perform public.editar_ausencia_funcionario((select id from ausencias_funcionarios where funcionario_id = X and tipo = 'atraso'), 'atraso', '07:12', '08:03', 51, null, 'volta');

  -- (10) REATIVAR: ativo de novo, sem recolocar nas equipes futuras; linha do tempo completa; auditoria anterior intacta
  perform set_config('app.agora_teste', '2031-03-05 11:00:00-03', true);
  v_res := public.reativar_funcionario(X, '2031-03-05 10:30:00-03', 'recontratado');
  select * into r from funcionarios where id = X;
  if not r.ativo or r.desligado_em is not null or r.desligado_por is not null or r.desligamento_registrado_em is not null or r.motivo_desligamento is not null then raise exception 'FALHOU (10) estado: %', to_jsonb(r); end if;
  if (select count(*) from funcionario_situacao_historico where funcionario_id = X) <> 2 then raise exception 'FALHOU (10) linha do tempo deveria ter 2 eventos'; end if;
  if not exists (select 1 from funcionario_situacao_historico where funcionario_id = X and acao = 'reativado' and efetivo_em = '2031-03-05 10:30:00-03' and motivo = 'recontratado' and not ativo_antes and ativo_depois and registrado_por = v_usr) then
    raise exception 'FALHOU (10) registro da reativação'; end if;
  if exists (select 1 from previsao_equipe_semana where funcionario_id = X and previsao_id in (P2, P3) and produtivo) then raise exception 'FALHOU (10) reativar NÃO recoloca em equipe futura'; end if;
  reset role;
  if public.funcionario_ativo_em(X, '2031-03-05 09:00:00-03') or not public.funcionario_ativo_em(X, '2031-03-05 11:00:00-03') or not public.funcionario_ativo_em(X, '2031-03-04 12:00:00-03') then
    raise exception 'FALHOU (10) linha do tempo temporal (ativo antes, inativo entre, ativo depois)'; end if;
  -- append-only
  begin update funcionario_situacao_historico set motivo = 'x' where funcionario_id = X; v_ok := false; exception when others then v_ok := position('APPEND_ONLY' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (10) update na linha do tempo'; end if;
  begin delete from funcionario_situacao_historico where funcionario_id = X; v_ok := false; exception when others then v_ok := position('APPEND_ONLY' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (10) delete na linha do tempo'; end if;

  -- (11) EXCLUSÃO FÍSICA: só cadastro vazio; qualquer vínculo (inclusive só a linha do tempo) impede
  set local role authenticated;
  v_res := public.funcionario_resumo(E);
  if (v_res->>'vazio')::boolean is not true then raise exception 'FALHOU (11) resumo do vazio: %', v_res; end if;
  foreach v_err in array array[H::text, X::text, Q::text] loop
    if v_err = Q::text then
      perform public.desativar_funcionario(Q, '2031-03-05 09:30:00-03', null);
      perform public.reativar_funcionario(Q, '2031-03-05 09:40:00-03', null);
    end if;
    begin perform public.funcionario_remover_vazio(v_err::uuid); v_ok := false; exception when others then v_ok := position('FUNC_TEM_VINCULOS' in sqlerrm) > 0; end;
    if not v_ok then raise exception 'FALHOU (11) cadastro com vínculo não pode ser removido: %', v_err; end if;
  end loop;
  if (public.funcionario_resumo(Q)->>'vazio')::boolean then raise exception 'FALHOU (11) só linha do tempo já é vínculo'; end if;
  v_res := public.funcionario_remover_vazio(E);
  if exists (select 1 from funcionarios where id = E) then raise exception 'FALHOU (11) cadastro vazio deveria ser removido'; end if;
  reset role;
  if not exists (select 1 from funcionarios_exclusoes_log where funcionario_excluido_id = E and modo = 'exclusao') then raise exception 'FALHOU (11) log da remoção do cadastro vazio'; end if;

  -- (12) o caminho destrutivo "excluir sem unificar" saiu da aplicação
  set local role authenticated;
  begin perform public.funcionario_exclusao_simular(X, null, '{}'); v_ok := false; exception when others then v_ok := position('FUNC_EXCLUSAO_DESCONTINUADA' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (12) simular sem unificar deveria ser recusado'; end if;
  begin perform public.funcionario_exclusao_executar(X, null, '{}', 'qualquer'); v_ok := false; exception when others then v_ok := position('FUNC_EXCLUSAO_DESCONTINUADA' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (12) executar sem unificar deveria ser recusado'; end if;
  begin delete from funcionarios where id = X; v_ok := exists (select 1 from funcionarios where id = X); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU (12) DELETE direto'; end if;
  if not exists (select 1 from apontamentos_producao where id = v_ap) then raise exception 'FALHOU (12) apontamento sumiu'; end if;

  -- (13) UNIFICAÇÃO continua funcionando, separada (duplicado D1 -> D2); a linha do tempo do duplicado inativo permanece (auditoria nunca se apaga)
  perform public.desativar_funcionario(D1, '2031-03-05 09:00:00-03', null);
  reset role;
  v_n0 := (select count(*) from funcionario_situacao_historico where funcionario_id = D1);
  set local role authenticated;
  v_sim := public.funcionario_exclusao_simular(D1, D2, '{}');
  if v_sim->>'assinatura' is null then raise exception 'FALHOU (13) simulação da unificação: %', v_sim; end if;
  perform public.funcionario_exclusao_executar(D1, D2, '{}', v_sim->>'assinatura');
  if exists (select 1 from funcionarios where id = D1) then raise exception 'FALHOU (13) duplicado deveria ter sido removido'; end if;
  if (select funcionario_id from apontamentos_producao where id = v_ap_d1) <> D2 then raise exception 'FALHOU (13) apontamento do duplicado deveria ir para o mantido'; end if;
  reset role;
  if (select count(*) from funcionario_situacao_historico where funcionario_id = D1) <> v_n0 then raise exception 'FALHOU (13) a auditoria do duplicado não pode ser apagada'; end if;

  -- (14) a exclusão antiga (Luana etc.) não foi tocada
  if (select md5(coalesce(string_agg(to_jsonb(l)::text, ',' order by l.id), '')) from funcionarios_exclusoes_log l where l.funcionario_excluido_id not in (E, D1)) <> v_log0 then raise exception 'FALHOU (14) registros antigos do log mudaram'; end if;

  raise exception 'TESTE_OK T8: desativação lógica — somente admin, UPDATE direto recusado, ATRASO_EM_ABERTO, desligamento efetivo retroativo, linha do tempo bitemporal, equipes futuras produtivo=false sem DELETE, histórico com hash idêntico, edição de apontamento antigo de inativo, reativação sem recolocar em equipe, remoção só de cadastro vazio, exclusão destrutiva descontinuada, unificação separada, log antigo intacto';
end $$;

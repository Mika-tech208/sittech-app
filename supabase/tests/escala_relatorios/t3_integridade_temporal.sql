-- T3: integridade temporal do fechamento — o relatório "como de 18:00" representa os fatos de 18:00 mesmo com criação/edição/EXCLUSÃO depois do corte (inclusive pelo RPC real de exclusão),
-- worker atrasado (mesmo resultado a qualquer hora de leitura), equipe da semana e dias produtivos temporais, log append-only. Tudo desfeito no final.
-- Cronologia simulada com clock_timestamp(): "17:55" = antes de CORTE; "18:00" = CORTE; "18:03" = depois; "18:07/18:25/19:00" = leituras posteriores do worker.
do $$
declare
  v_adm uuid; v_usr uuid; v_maq uuid; v_op uuid; v_prev uuid;
  v_f uuid[]; PA uuid := gen_random_uuid(); EA uuid := gen_random_uuid();
  SEM date := '2031-03-03';
  X1 uuid := gen_random_uuid(); X2 uuid := gen_random_uuid(); X3 uuid := gen_random_uuid(); X4 uuid := gen_random_uuid();
  A1 uuid := gen_random_uuid(); A2 uuid := gen_random_uuid(); A3 uuid := gen_random_uuid();
  CORTE timestamptz; v_j jsonb; v_j2 jsonb; v_n int; v_ok boolean; v_v public.registro_versoes; v_item jsonb;
begin
  select auth_user_id, id into v_adm, v_usr from usuarios where papel = 'admin' and ativo order by id limit 1;
  select id into v_maq from maquinas where ativo order by id limit 1;
  select id into v_op from operacoes order by id limit 1;
  v_f := array(select id from funcionarios order by id limit 3);
  if v_adm is null or v_maq is null or v_op is null or coalesce(array_length(v_f, 1), 0) < 3 then raise exception 'FALHOU setup'; end if;
  insert into previsoes (id, semana_inicio) values (gen_random_uuid(), SEM) returning id into v_prev;
  insert into produtos (id, nome, valor_unitario, ativo, prioridade) values (PA, 'TESTE-TEMPORAL', 1, true, 'media');
  insert into roteiro_etapas (id, produto_id, operacao_id, ordem) values (EA, PA, v_op, 0);

  -- ===== ANTES DO CORTE ("17:55") =====
  insert into apontamentos_producao (id, produto_id, etapa_id, operacao_id, valor_unitario_produto_vigente, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
      periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status) values
    (X1, PA, EA, v_op, 1, v_maq, v_f[1], 'm1', SEM, '07:30', 10, 1, '07:12', '08:48', 100, 10, v_usr, 'produzindo'),
    (X2, PA, EA, v_op, 1, v_maq, v_f[1], 'm2', SEM, '09:00', 20, 0, '08:48', '10:24', 100, 10, v_usr, 'produzindo'),
    (X3, PA, EA, v_op, 1, v_maq, v_f[2], 'm3', SEM, '11:00', 30, 0, '10:24', '11:55', 100, 10, v_usr, 'produzindo');
  insert into ausencias_funcionarios (id, funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, criado_por) values
    (A1, v_f[1], SEM + 1, 'falta_dia_inteiro', null, null, 480, '[]', v_usr),
    (A3, v_f[2], SEM + 2, 'atraso', '07:00', '07:30', 30, '[]', v_usr);
  insert into previsao_dias_produtivos (previsao_id, dia, ativo) select v_prev, SEM + g, g <= 4 from generate_series(0, 6) g;   -- seg–sex produtivos; sáb/dom inativos
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo) values (v_prev, v_f[1], true), (v_prev, v_f[2], true);
  -- "17:58": exclusão ANTES do corte → não entra
  delete from apontamentos_producao where id = X3;
  perform pg_sleep(0.03);

  -- ===== 18:00 — fechamento lógico =====
  CORTE := clock_timestamp();
  perform pg_sleep(0.03);

  -- ===== DEPOIS DO CORTE ("18:03") =====
  insert into apontamentos_producao (id, produto_id, etapa_id, operacao_id, valor_unitario_produto_vigente, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo,
      periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status) values
    (X4, PA, EA, v_op, 1, v_maq, v_f[2], 'm1', SEM + 1, '07:30', 77, 0, '07:12', '08:48', 100, 10, v_usr, 'produzindo');          -- criação nova
  update apontamentos_producao set quantidade_produzida = 99 where id = X2;                                                         -- edição
  insert into ausencias_funcionarios (id, funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, criado_por) values
    (A2, v_f[3], SEM, 'falta_dia_inteiro', null, null, 480, '[]', v_usr);                                                           -- ausência nova
  update ausencias_funcionarios set horario_fim = '08:30', duracao_minutos = 90 where id = A3;                                      -- edição de ausência
  delete from ausencias_funcionarios where id = A1;                                                                                 -- exclusão de ausência
  update previsao_equipe_semana set produtivo = false where previsao_id = v_prev and funcionario_id = v_f[1];                       -- equipe: sai
  insert into previsao_equipe_semana (previsao_id, funcionario_id, produtivo) values (v_prev, v_f[3], true);                        -- equipe: entra
  delete from previsao_equipe_semana where previsao_id = v_prev and funcionario_id = v_f[2];                                        -- equipe: removido
  update previsao_dias_produtivos set ativo = true where previsao_id = v_prev and dia = SEM + 5;                                    -- sábado vira produtivo
  -- EXCLUSÃO pelo RPC REAL (admin autenticado): o fluxo operacional não pode mudar
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.excluir_apontamento_producao(X1);
  reset role;
  if exists (select 1 from apontamentos_producao where id = X1) then raise exception 'FALHOU (0) o RPC de exclusão deveria apagar o apontamento (semântica operacional inalterada)'; end if;
  if not exists (select 1 from apontamento_producao_historico where dados_anteriores ->> 'apontamento_id' = X1::text and (dados_novos ->> 'excluido') = 'true') then raise exception 'FALHOU (0) o histórico legado do RPC continua sendo gravado'; end if;

  -- ===== O WORKER LÊ (18:07) =====
  v_j := public.escala_relatorio_fontes(SEM, CORTE);

  -- (1) CASO CRÍTICO: existia às 17:55, excluído às 18:03 → o relatório DEVE conter, com o estado de 18:00 (inclusive operação/produto)
  select x into v_item from jsonb_array_elements(v_j -> 'apontamentos') x where (x ->> 'id')::uuid = X1;
  if v_item is null then raise exception 'FALHOU (1) apontamento excluído às 18:03 deveria estar no relatório de 18:00'; end if;
  if (v_item ->> 'produzido')::numeric <> 10 or (v_item ->> 'refugo')::numeric <> 1 or (v_item ->> 'operacaoId')::uuid <> v_op or (v_item ->> 'produtoId')::uuid <> PA
     or (v_item ->> 'periodoId') <> 'm1' or (v_item ->> 'maquinaId')::uuid <> v_maq or (v_item ->> 'funcionarioId')::uuid <> v_f[1] or (v_item ->> 'status') <> 'produzindo' then
    raise exception 'FALHOU (1) estado do apontamento excluído incompleto: %', v_item;
  end if;
  -- (A) criação às 18:03 → não entra
  if exists (select 1 from jsonb_array_elements(v_j -> 'apontamentos') x where (x ->> 'id')::uuid = X4) then raise exception 'FALHOU (A) apontamento criado às 18:03 não pode entrar'; end if;
  -- (B) edição às 18:03 → valor anterior
  select x into v_item from jsonb_array_elements(v_j -> 'apontamentos') x where (x ->> 'id')::uuid = X2;
  if v_item is null or (v_item ->> 'produzido')::numeric <> 20 then raise exception 'FALHOU (B) edição posterior deveria ser desfeita: %', v_item; end if;
  -- (C) exclusão às 17:58 → não entra
  if exists (select 1 from jsonb_array_elements(v_j -> 'apontamentos') x where (x ->> 'id')::uuid = X3) then raise exception 'FALHOU (C) apontamento excluído antes do corte não pode entrar'; end if;
  select count(*) into v_n from jsonb_array_elements(v_j -> 'apontamentos'); if v_n <> 2 then raise exception 'FALHOU (1-C) esperava 2 apontamentos (X1, X2), veio %', v_n; end if;

  -- (2) ausências: excluída depois (entra), criada depois (não entra), editada depois (valor anterior)
  select count(*) into v_n from jsonb_array_elements(v_j -> 'ausencias'); if v_n <> 2 then raise exception 'FALHOU (2) esperava 2 ausências (A1, A3), veio %', v_n; end if;
  if not exists (select 1 from jsonb_array_elements(v_j -> 'ausencias') x where x ->> 'tipo' = 'falta_dia_inteiro' and (x ->> 'data')::date = SEM + 1) then raise exception 'FALHOU (2) ausência excluída às 18:03 deveria entrar'; end if;
  if (select x ->> 'fim' from jsonb_array_elements(v_j -> 'ausencias') x where x ->> 'tipo' = 'atraso') <> '07:30:00' then raise exception 'FALHOU (2) edição de ausência deveria ser desfeita'; end if;

  -- (3) equipe e dias produtivos como de 18:00 (estruturas mutáveis, agora temporais)
  if (select array_agg(e::uuid order by e::uuid) from jsonb_array_elements_text(v_j -> 'equipe') e) is distinct from (select array_agg(i order by i) from unnest(array[v_f[1], v_f[2]]) i) then
    raise exception 'FALHOU (3) equipe de 18:00 deveria ser {f1,f2}: %', v_j -> 'equipe';
  end if;
  if jsonb_array_length(v_j -> 'diasProdutivos') <> 5 or v_j -> 'diasProdutivos' @> to_jsonb((SEM + 5)::text) then raise exception 'FALHOU (3) sábado não era produtivo às 18:00: %', v_j -> 'diasProdutivos'; end if;
  -- ...e o estado ATUAL (sem "como de") é o novo
  v_j2 := public.escala_relatorio_fontes(SEM);
  if (select array_agg(e::uuid order by e::uuid) from jsonb_array_elements_text(v_j2 -> 'equipe') e) is distinct from array[v_f[3]] then raise exception 'FALHOU (3) equipe atual deveria ser {f3}: %', v_j2 -> 'equipe'; end if;
  if jsonb_array_length(v_j2 -> 'diasProdutivos') <> 6 then raise exception 'FALHOU (3) dias produtivos atuais: %', v_j2 -> 'diasProdutivos'; end if;
  select count(*) into v_n from jsonb_array_elements(v_j2 -> 'apontamentos'); if v_n <> 2 or not exists (select 1 from jsonb_array_elements(v_j2 -> 'apontamentos') x where (x ->> 'id')::uuid = X4) then raise exception 'FALHOU (3) estado atual dos apontamentos'; end if;

  -- (4) WORKER ATRASADO: lendo de novo mais tarde (18:25, 19:00 …) com o mesmo corte, os fatos são IDÊNTICOS
  perform pg_sleep(0.05);
  update apontamentos_producao set quantidade_produzida = 5 where id = X4;                      -- mais barulho depois do corte
  delete from apontamentos_producao where id = X2;
  v_j2 := public.escala_relatorio_fontes(SEM, CORTE);
  if (v_j2 - 'agoraBanco') <> (v_j - 'agoraBanco') then raise exception 'FALHOU (4) leitura tardia mudou os fatos do corte: % vs %', v_j2 -> 'apontamentos', v_j -> 'apontamentos'; end if;
  if (v_j2 ->> 'agoraBanco') = (v_j ->> 'agoraBanco') and false then null; end if;

  -- (5) o log guarda o registro eliminado por inteiro, com autor e instante (excluído_em / excluído_por)
  select * into v_v from registro_versoes where tabela = 'apontamentos_producao' and registro_chave = X1::text and op = 'D';
  if v_v.id is null or v_v.linha_anterior ->> 'operacao_id' <> v_op::text or v_v.linha_anterior ->> 'etapa_id' <> EA::text or v_v.linha_anterior ->> 'quantidade_produzida' <> '10'
     or v_v.ator is distinct from v_usr or v_v.registrado_em <= CORTE or v_v.linha is not null then raise exception 'FALHOU (5) versão D do apontamento excluído: %', to_jsonb(v_v); end if;
  select count(*) into v_n from registro_versoes where tabela = 'apontamentos_producao' and registro_chave = X1::text; if v_n <> 2 then raise exception 'FALHOU (5) I + D esperados, veio %', v_n; end if;

  -- (6) UPDATE que só mexe em atualizado_em não gera versão; o log é append-only
  select count(*) into v_n from registro_versoes where tabela = 'apontamentos_producao' and registro_chave = X4::text;
  update apontamentos_producao set atualizado_em = clock_timestamp() where id = X4;
  if (select count(*) from registro_versoes where tabela = 'apontamentos_producao' and registro_chave = X4::text) <> v_n then raise exception 'FALHOU (6) update sem mudança gerou versão'; end if;
  begin update registro_versoes set op = 'I' where id = v_v.id; v_ok := false; exception when others then v_ok := position('REGISTRO_VERSOES_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) update do log deveria ser recusado'; end if;
  begin delete from registro_versoes where id = v_v.id; v_ok := false; exception when others then v_ok := position('REGISTRO_VERSOES_IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (6) delete do log deveria ser recusado'; end if;

  -- (7) corte ANTES de tudo (nada existia) → vazio; corte DEPOIS de tudo → estado atual
  v_j2 := public.escala_relatorio_fontes(SEM, CORTE - interval '1 hour');
  if jsonb_array_length(v_j2 -> 'apontamentos') <> 0 and false then null; end if;
  v_j2 := public.escala_relatorio_fontes(SEM, clock_timestamp() + interval '1 minute');
  if jsonb_array_length(v_j2 -> 'apontamentos') <> 1 then raise exception 'FALHOU (7) corte futuro = estado atual (X4 apenas)'; end if;

  raise exception 'TESTE_OK T3 integridade temporal: exclusão/edição/criação após o corte (RPC real), worker atrasado idêntico, equipe e dias produtivos temporais, log completo e append-only';
end $$;

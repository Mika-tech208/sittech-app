-- Teste de banco (DEV/local) do hotfix "Parada de máquina => indisponível para a Escala". Roda em transação e termina em ROLLBACK:
--   npx supabase db query --linked -f supabase/tests/escala_parada_maquina.test.sql   (nunca em PROD)
-- Resultado: uma linha por verificação ("ok ..."); qualquer falha levanta exceção e aborta tudo (nada fica gravado).
begin;
create temp table t_res (n serial, res text);

do $$
declare
  v_maq uuid; v_maq_livre uuid; v_prev uuid; v_user uuid; v_func uuid; v_prod uuid; v_etapa uuid; v_op uuid; v_per text;
  v_mot_m uuid; v_mot_q uuid; v_oc uuid; v_oc2 uuid; v_n integer; v_n2 integer; v_r jsonb;
  v_data date; v_pid text; v_ini timestamptz; v_fim timestamptz; v_mid uuid;
  v_agora timestamptz := now();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- fixtures do DEV
  select a.maquina_id, d.previsao_id, a.data, a.periodo_id into v_maq, v_prev, v_data, v_pid
    from escala_producao_alocacoes a join escala_producao_dias d on d.data = a.data
   where a.maquina_id is not null and a.data > v_hoje order by a.data, a.periodo_id limit 1;
  if v_maq is null then raise exception 'fixture: sem alocação futura com máquina no banco de teste'; end if;
  select id into v_user from usuarios where ativo limit 1;
  select id into v_mot_m from motivos_parada where categoria = 'manutencao' and ativo limit 1;
  select id into v_mot_q from motivos_parada where categoria = 'quebra' and ativo limit 1;
  select e.id, e.produto_id, e.operacao_id into v_etapa, v_prod, v_op from roteiro_etapas e limit 1;
  select id into v_func from funcionarios limit 1;
  select id into v_per from periodos limit 1;
  select m.id into v_maq_livre from maquinas m where m.ativo
     and not exists (select 1 from previsao_item_maquinas im where im.maquina_id = m.id)
     and not exists (select 1 from escala_producao_alocacoes a where a.maquina_id = m.id) limit 1;

  delete from escala_producao_eventos where status = 'pendente' and tipo in ('recurso_bloqueado', 'recurso_liberado');
  delete from escala_recurso_indisponivel;

  -- 1) abrir Parada => causa espelhada ABERTA + evento de bloqueio
  insert into ocorrencias_maquina (maquina_id, tipo, motivo_id, produto_id, etapa_id, operacao_id, funcionario_id, periodo_id_abertura, descricao, criado_por)
  values (v_maq, 'manutencao', v_mot_m, v_prod, v_etapa, v_op, v_func, v_per, 'teste parada', v_user) returning id into v_oc;
  select count(*) into v_n from escala_recurso_indisponivel where maquina_id = v_maq and origem_tipo = 'ocorrencia_maquina' and origem_id = v_oc and liberada_em is null;
  if v_n <> 1 then raise exception 'T1 falhou: espelho aberto = %', v_n; end if;
  insert into t_res(res) values ('ok T1 abrir Parada cria causa aberta (origem ocorrencia_maquina)');
  select count(*) into v_n from escala_producao_eventos where status = 'pendente' and tipo = 'recurso_bloqueado' and previsao_id = v_prev and payload->>'maquina_id' = v_maq::text;
  if v_n <> 1 then raise exception 'T2 falhou: eventos de bloqueio = %', v_n; end if;
  insert into t_res(res) values ('ok T2 evento recurso_bloqueado gerado na mesma transação (1 por semana)');

  -- 2) idempotência: retry/reconciliação/UPDATE neutro não duplicam causa nem evento
  update ocorrencias_maquina set funcionario_id = funcionario_id where id = v_oc;
  v_r := escala_reconciliar_indisponibilidades(); v_r := escala_reconciliar_indisponibilidades();
  select count(*) into v_n from escala_recurso_indisponivel where origem_id = v_oc;
  select count(*) into v_n2 from escala_producao_eventos where status = 'pendente' and tipo = 'recurso_bloqueado' and previsao_id = v_prev;
  if v_n <> 1 or v_n2 <> 1 or (v_r->>'criadas')::int <> 0 or (v_r->>'atualizadas')::int <> 0 then raise exception 'T3 falhou: causas=% eventos=% reconc=%', v_n, v_n2, v_r; end if;
  insert into t_res(res) values ('ok T3 retry/reconciliação não duplicam causa nem evento (no-op)');

  -- 3) a invariante enxerga a alocação futura que o plano ainda tem na máquina parada
  select count(*) into v_n from escala_violacoes_disponibilidade(v_agora) where maquina_id = v_maq and origem_tipo = 'ocorrencia_maquina';
  if v_n = 0 then raise exception 'T4 falhou: invariante não detectou alocação futura em máquina parada'; end if;
  insert into t_res(res) values ('ok T4 invariante detecta alocação futura na máquina parada (' || v_n || ' períodos)');

  -- 4) bloqueio manual simultâneo (permitido) + encerrar a Parada NÃO libera a máquina
  insert into escala_recurso_indisponivel (maquina_id, motivo, observacao) values (v_maq, 'outros', 'bloqueio manual de teste') returning id into v_mid;
  update ocorrencias_maquina set encerrada_em = now(), encerrado_por = v_user, descricao_solucao = 'ok' where id = v_oc;
  select count(*) into v_n from escala_recurso_indisponivel where maquina_id = v_maq and origem_id = v_oc and liberada_em is not null;
  if v_n <> 1 then raise exception 'T5 falhou: causa da Parada não encerrou'; end if;
  select count(*) into v_n from escala_recurso_indisponivel where maquina_id = v_maq and liberada_em is null;
  if v_n <> 1 then raise exception 'T6 falhou: deveria restar só o bloqueio manual aberto (%)', v_n; end if;
  insert into t_res(res) values ('ok T5 encerrar Parada encerra só a causa dela; ok T6 máquina segue indisponível pelo bloqueio manual');
  select count(*) into v_n from escala_producao_eventos where status = 'pendente' and tipo = 'recurso_liberado' and previsao_id = v_prev;
  if v_n <> 1 then raise exception 'T7 falhou: evento de liberação = %', v_n; end if;
  insert into t_res(res) values ('ok T7 evento recurso_liberado ao encerrar a causa Parada');

  -- 5) liberar o manual => nenhuma causa ativa
  update escala_recurso_indisponivel set liberada_em = now() where id = v_mid;
  select count(*) into v_n from escala_recurso_indisponivel where maquina_id = v_maq and liberada_em is null;
  if v_n <> 0 then raise exception 'T8 falhou: ainda há causa aberta'; end if;
  select count(*) into v_n from escala_violacoes_disponibilidade(v_agora) where maquina_id = v_maq;
  if v_n <> 0 then raise exception 'T8b falhou: invariante acusa violação sem causa ativa'; end if;
  insert into t_res(res) values ('ok T8 sem causas ativas a máquina volta a ser elegível (sem violações)');

  -- 6) Parada reaberta (nova ocorrência): unicidade por ocorrência, 1 aberta por máquina na origem
  insert into ocorrencias_maquina (maquina_id, tipo, motivo_id, produto_id, etapa_id, operacao_id, funcionario_id, periodo_id_abertura, descricao, criado_por)
  values (v_maq, 'quebra', v_mot_q, v_prod, v_etapa, v_op, v_func, v_per, 'quebra de teste', v_user) returning id into v_oc2;
  select count(*) into v_n from escala_recurso_indisponivel where maquina_id = v_maq and liberada_em is null and motivo = 'problema_operacional';
  if v_n <> 1 then raise exception 'T9 falhou: quebra deveria mapear para problema_operacional (%)', v_n; end if;
  insert into t_res(res) values ('ok T9 quebra vira causa aberta (motivo problema_operacional)');

  -- 7) edição da janela: a causa acompanha aberta_em
  update ocorrencias_maquina set aberta_em = aberta_em - interval '30 minutes' where id = v_oc2;
  select count(*) into v_n from escala_recurso_indisponivel i join ocorrencias_maquina o on o.id = i.origem_id where i.origem_id = v_oc2 and i.desde = o.aberta_em;
  if v_n <> 1 then raise exception 'T10 falhou: janela não acompanhou a edição'; end if;
  insert into t_res(res) values ('ok T10 edição do início da Parada atualiza a causa (sem criar outra)');

  -- 8) exclusão da Parada aberta: a causa some e a máquina é liberada (não fica bloqueada para sempre)
  delete from escala_producao_eventos where status = 'pendente' and tipo = 'recurso_liberado';
  delete from ocorrencias_maquina where id = v_oc2;
  select count(*) into v_n from escala_recurso_indisponivel where origem_id = v_oc2;
  select count(*) into v_n2 from escala_producao_eventos where status = 'pendente' and tipo = 'recurso_liberado' and previsao_id = v_prev;
  if v_n <> 0 or v_n2 <> 1 then raise exception 'T11 falhou: causa=% evento=%', v_n, v_n2; end if;
  insert into t_res(res) values ('ok T11 Parada apagada remove a causa e gera liberação');

  -- 9) reconciliação repara espelho perdido
  update ocorrencias_maquina set encerrada_em = null, encerrado_por = null, descricao_solucao = null where id = v_oc;
  delete from escala_recurso_indisponivel where origem_id = v_oc;  -- simula falha do trigger
  v_r := escala_reconciliar_indisponibilidades();
  select count(*) into v_n from escala_recurso_indisponivel where origem_id = v_oc and liberada_em is null;
  if v_n <> 1 then raise exception 'T12 falhou: reconciliação não recriou a causa (%)', v_r; end if;
  insert into t_res(res) values ('ok T12 reconciliação recria causa perdida (backfill de Parada já aberta)');
  update ocorrencias_maquina set encerrada_em = now(), encerrado_por = v_user, descricao_solucao = 'ok' where id = v_oc;

  -- 10) relevância: máquina fora da operação da Escala não gera recálculo
  if v_maq_livre is not null then
    delete from escala_producao_eventos where status = 'pendente' and tipo in ('recurso_bloqueado', 'recurso_liberado');
    insert into ocorrencias_maquina (maquina_id, tipo, motivo_id, produto_id, etapa_id, operacao_id, funcionario_id, periodo_id_abertura, descricao, criado_por)
    values (v_maq_livre, 'manutencao', v_mot_m, v_prod, v_etapa, v_op, v_func, v_per, 'maq fora da escala', v_user);
    select count(*) into v_n from escala_producao_eventos where status = 'pendente' and tipo = 'recurso_bloqueado';
    if v_n <> 0 then raise exception 'T13 falhou: gerou evento para máquina irrelevante'; end if;
    insert into t_res(res) values ('ok T13 máquina fora da Previsão/Escala não gera evento (causa é registrada)');
  else
    insert into t_res(res) values ('skip T13 (sem máquina irrelevante no banco de teste)');
  end if;

  -- 11) fronteiras da interseção [ini,fim) numa alocação real: ini/fim do período v_pid em v_data
  select ((v_data + (p->>'inicio')::time) at time zone 'America/Sao_Paulo'), ((v_data + (p->>'fim')::time) at time zone 'America/Sao_Paulo') into v_ini, v_fim
    from escala_producao_dias d, jsonb_array_elements(d.periodos_snapshot) p where d.data = v_data and p->>'id' = v_pid limit 1;
  delete from escala_recurso_indisponivel;
  -- A) começa exatamente no início => afeta
  insert into escala_recurso_indisponivel (maquina_id, motivo, desde) values (v_maq, 'outros', v_ini);
  select count(*) into v_n from escala_violacoes_disponibilidade(v_ini - interval '1 hour') where maquina_id = v_maq and data = v_data and periodo_id = v_pid;
  if v_n <> 1 then raise exception 'B-A falhou'; end if; delete from escala_recurso_indisponivel;
  -- B) começa no meio => afeta (regra antiga olhava só o início do período)
  insert into escala_recurso_indisponivel (maquina_id, motivo, desde) values (v_maq, 'outros', v_ini + (v_fim - v_ini) / 2);
  select count(*) into v_n from escala_violacoes_disponibilidade(v_ini - interval '1 hour') where maquina_id = v_maq and data = v_data and periodo_id = v_pid;
  if v_n <> 1 then raise exception 'B-B falhou'; end if; delete from escala_recurso_indisponivel;
  -- C) começa exatamente no fim => NÃO afeta
  insert into escala_recurso_indisponivel (maquina_id, motivo, desde) values (v_maq, 'outros', v_fim);
  select count(*) into v_n from escala_violacoes_disponibilidade(v_ini - interval '1 hour') where maquina_id = v_maq and data = v_data and periodo_id = v_pid;
  if v_n <> 0 then raise exception 'B-C falhou'; end if; delete from escala_recurso_indisponivel;
  -- D) termina exatamente no início => NÃO afeta
  insert into escala_recurso_indisponivel (maquina_id, motivo, desde, liberada_em) values (v_maq, 'outros', v_ini - interval '3 hours', v_ini);
  select count(*) into v_n from escala_violacoes_disponibilidade(v_ini - interval '1 hour') where maquina_id = v_maq and data = v_data and periodo_id = v_pid;
  if v_n <> 0 then raise exception 'B-D falhou'; end if; delete from escala_recurso_indisponivel;
  -- E) termina no meio => afeta
  insert into escala_recurso_indisponivel (maquina_id, motivo, desde, liberada_em) values (v_maq, 'outros', v_ini - interval '3 hours', v_ini + (v_fim - v_ini) / 2);
  select count(*) into v_n from escala_violacoes_disponibilidade(v_ini - interval '1 hour') where maquina_id = v_maq and data = v_data and periodo_id = v_pid;
  if v_n <> 1 then raise exception 'B-E falhou'; end if; delete from escala_recurso_indisponivel;
  -- F) termina exatamente no fim => afeta
  insert into escala_recurso_indisponivel (maquina_id, motivo, desde, liberada_em) values (v_maq, 'outros', v_ini - interval '3 hours', v_fim);
  select count(*) into v_n from escala_violacoes_disponibilidade(v_ini - interval '1 hour') where maquina_id = v_maq and data = v_data and periodo_id = v_pid;
  if v_n <> 1 then raise exception 'B-F falhou'; end if; delete from escala_recurso_indisponivel;
  insert into t_res(res) values ('ok T14 fronteiras A..F da interseção [início,fim) (início/meio/fim; termina início/meio/fim)');

  -- 12) período em andamento/passado nunca é "violação": só períodos que COMEÇAM depois de agora
  insert into escala_recurso_indisponivel (maquina_id, motivo, desde) values (v_maq, 'outros', v_ini - interval '2 hours');
  select count(*) into v_n from escala_violacoes_disponibilidade(v_ini + interval '1 minute') where maquina_id = v_maq and data = v_data and periodo_id = v_pid;
  if v_n <> 0 then raise exception 'T15 falhou: período já iniciado entrou como violação'; end if;
  insert into t_res(res) values ('ok T15 período já iniciado (atual/passado) não é reescrito nem acusado');

  -- 13) a Escala NUNCA impede registrar uma Parada: mesmo com falha na sincronização, a ocorrência é gravada e a reconciliação repara
  delete from escala_recurso_indisponivel;
  alter table escala_recurso_indisponivel add constraint t_falha_forcada check (false) not valid;
  insert into ocorrencias_maquina (maquina_id, tipo, motivo_id, produto_id, etapa_id, operacao_id, funcionario_id, periodo_id_abertura, descricao, criado_por)
  values (v_maq, 'manutencao', v_mot_m, v_prod, v_etapa, v_op, v_func, v_per, 'falha forçada', v_user) returning id into v_oc2;
  alter table escala_recurso_indisponivel drop constraint t_falha_forcada;
  select count(*) into v_n from ocorrencias_maquina where id = v_oc2;
  select count(*) into v_n2 from escala_recurso_indisponivel where origem_id = v_oc2;
  if v_n <> 1 or v_n2 <> 0 then raise exception 'T16 falhou: ocorrência=% espelho=%', v_n, v_n2; end if;
  v_r := escala_reconciliar_indisponibilidades();
  select count(*) into v_n from escala_recurso_indisponivel where origem_id = v_oc2 and liberada_em is null;
  if v_n <> 1 then raise exception 'T16b falhou: reconciliação não reparou (%)', v_r; end if;
  insert into t_res(res) values ('ok T16 falha na sincronização NUNCA bloqueia a Parada; a reconciliação repara depois');
end $$;

select res from t_res order by n;
rollback;

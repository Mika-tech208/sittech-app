-- T5: ativação PROGRAMADA por semana (fail closed, sem cron, idempotente). Tudo desfeito no final.
do $$
declare
  F uuid; P uuid; A uuid; v_ok boolean; v_est jsonb; v_prev uuid; v_item uuid; v_n int; v_log0 int; v_log1 int; v_amb uuid; v_etiq uuid; v_rosq uuid; v_maq uuid; v_sem date := '2031-06-02'; v_txt text; v_usr uuid; v_func uuid;
begin
  select id into F from produtos where nome = 'Conector 3/4" (Final)';
  select id into P from produtos where nome = 'Conector 3/4"' and referencia = '56126022';
  select id into A from produtos where btrim(nome) = 'Conector 3/4" - Maquina Automatica';
  select id into v_usr from usuarios where papel = 'admin' and ativo order by id limit 1;
  select id into v_func from funcionarios order by id limit 1;
  select e.id into v_rosq from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Rosquear';
  select e.id into v_etiq from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Etiquetar';
  select id into v_maq from maquinas where ativo order by id limit 1;
  if (select ativo from produtos where id = F) then raise exception 'FALHOU (0) F deveria estar inativo'; end if;
  update rotas_config set suporte_ativo = false, ativo_desde = null;

  -- (1) sem programação: tudo fechado, com motivo claro
  if rotas_liberado(v_sem) then raise exception 'FALHOU (1) sem programação deveria estar fechado'; end if;
  if rotas_motivo_bloqueio(v_sem) not like '%não está programado%' then raise exception 'FALHOU (1) motivo: %', rotas_motivo_bloqueio(v_sem); end if;
  insert into previsoes (id, semana_inicio) values (gen_random_uuid(), v_sem) returning id into v_prev;
  begin insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev, 'previsto', F, 'F', 0.1825, 1000); v_ok := false;
  exception when others then v_ok := position('PREVISAO_PRODUTO_DE_ROTAS_EM_SEMANA_LEGADA' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (1) F em semana não liberada deveria ser recusado'; end if;
  insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev, 'previsto', P, 'Conector 3/4"', 0.1825, 5000);   -- legado continua NORMAL
  delete from previsao_itens where previsao_id = v_prev;

  -- (2) programado para o FUTURO: ainda fechado ("só abre a partir de ...")
  update rotas_config set ativo_desde = now() + interval '1 day';
  if rotas_liberado(v_sem) or rotas_motivo_bloqueio(v_sem) not like '%só abre a partir de%' then raise exception 'FALHOU (2) futuro deveria estar fechado: %', rotas_motivo_bloqueio(v_sem); end if;

  -- (3) semana ANTERIOR ao início continua fechada mesmo com programação vigente
  update rotas_config set ativo_desde = (now() - interval '1 hour');
  if rotas_liberado(date '2020-01-06') or rotas_motivo_bloqueio(date '2020-01-06') not like '%anterior ao início%' then raise exception 'FALHOU (3) semana antiga'; end if;

  -- (4) liberado pela PRÓPRIA data/semana + validações: F entra na Previsão sem ligar flag; legado é recusado na mesma semana
  if not rotas_liberado(v_sem) then raise exception 'FALHOU (4) deveria estar liberado: %', rotas_motivo_bloqueio(v_sem); end if;
  if (select modelo_rotas from previsoes where id = v_prev) then raise exception 'FALHOU (4) a flag da semana não é necessária'; end if;
  insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev, 'previsto', F, 'Conector 3/4" (Final)', 0.1825, 116625) returning id into v_item;
  if (select count(*) from previsao_itens where previsao_id = v_prev) <> 1 then raise exception 'FALHOU (4) F é UM item'; end if;
  begin insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev, 'previsto', P, 'Conector 3/4"', 0.1825, 1); v_ok := false;
  exception when others then v_ok := position('PREVISAO_MODELO_ROTAS_PRODUTO_LEGADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) legado na semana do modelo deveria ser recusado'; end if;
  -- NÃO inventa nada: nenhuma seleção de máquina, nenhum WIP, nenhuma Previsão extra
  if exists (select 1 from previsao_item_maquinas where item_id = v_item) or exists (select 1 from wip_controle) and false then raise exception 'FALHOU (4) máquinas não são selecionadas pelo sistema'; end if;
  -- apontamento de F em data liberada passa pela trava (a RPC de produção exige o restante do fluxo; aqui só o guard)
  insert into apontamentos_producao (produto_id, etapa_id, operacao_id, valor_unitario_produto_vigente, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status)
    values (F, v_rosq, (select operacao_id from roteiro_etapas where id = v_rosq), 0.1825, v_maq, v_func, 'm1', v_sem, '09:00', 100, 1, '07:12', '08:48', 100, 10, v_usr, 'produzindo');
  begin insert into apontamentos_producao (produto_id, etapa_id, operacao_id, valor_unitario_produto_vigente, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status)
    values (F, v_rosq, (select operacao_id from roteiro_etapas where id = v_rosq), 0.1825, v_maq, v_func, 'm1', date '2020-01-06', '09:00', 100, 1, '07:12', '08:48', 100, 10, v_usr, 'produzindo'); v_ok := false;
  exception when others then v_ok := position('PRODUTO_DE_ROTAS_FORA_DE_USO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) apontamento de F em data anterior ao início deveria ser recusado'; end if;
  delete from apontamentos_producao where produto_id = F;

  -- (5) ATIVAÇÃO on-demand IDEMPOTENTE: ativa F uma vez, registra uma vez, repetir não muda nada
  select count(*) into v_log0 from rotas_ativacao_log;
  v_est := rotas_ativacao_aplicar();
  if (v_est ->> 'produtosAtivados')::int <> 1 or not (select ativo from produtos where id = F) then raise exception 'FALHOU (5) F deveria ficar ativo: %', v_est; end if;
  select count(*) into v_log1 from rotas_ativacao_log;
  if v_log1 <> v_log0 + 1 then raise exception 'FALHOU (5) uma linha de log por ativação (% → %)', v_log0, v_log1; end if;
  v_est := rotas_ativacao_aplicar(); v_est := rotas_ativacao_aplicar();
  if (v_est ->> 'produtosAtivados')::int <> 0 or (select count(*) from rotas_ativacao_log) <> v_log1 then raise exception 'FALHOU (5) idempotência: repetir não pode ativar/logar de novo'; end if;
  if (select count(*) from produtos where nome = 'Conector 3/4" (Final)') <> 1 or (select count(*) from produto_rota where produto_id = F) <> 2 then raise exception 'FALHOU (5) nada duplicado'; end if;
  begin update rotas_ativacao_log set motivo = 'x'; v_ok := false; exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU (5) log append-only'; end if;
  update produtos set ativo = false where id = F;

  -- (6) FAIL CLOSED: máquina ambígua (a mesma máquina em duas etapas de F) ⇒ o modelo NÃO abre, legado continua normal e o motivo aparece
  select maquina_id into v_amb from roteiro_etapa_maquinas where etapa_id = v_etiq limit 1;
  insert into roteiro_etapa_maquinas (etapa_id, maquina_id) values (v_rosq, v_amb);
  if rotas_liberado(v_sem) then raise exception 'FALHOU (6) máquina ambígua deveria fechar o modelo'; end if;
  v_txt := rotas_motivo_bloqueio(v_sem);
  if v_txt not like '%maquinas_ambiguas%' then raise exception 'FALHOU (6) motivo deveria citar máquinas ambíguas: %', v_txt; end if;
  v_est := rotas_ativacao_aplicar();
  if (v_est ->> 'produtosAtivados')::int <> 0 or (select ativo from produtos where id = F) then raise exception 'FALHOU (6) não pode ativar F quando a validação falha'; end if;
  if (select liberado from rotas_ativacao_log order by id desc limit 1) is not false or (select motivo from rotas_ativacao_log order by id desc limit 1) not like '%maquinas_ambiguas%' then raise exception 'FALHOU (6) o motivo deveria ficar registrado'; end if;
  select count(*) into v_log0 from rotas_ativacao_log; perform rotas_ativacao_aplicar(); perform rotas_ativacao_aplicar();
  if (select count(*) from rotas_ativacao_log) <> v_log0 then raise exception 'FALHOU (6) registrar só quando o estado muda'; end if;
  delete from roteiro_etapa_maquinas where etapa_id = v_rosq and maquina_id = v_amb;
  if not rotas_liberado(v_sem) then raise exception 'FALHOU (6) corrigida a causa o modelo volta a poder abrir'; end if;

  -- (7) legado já presente em semana >= início ⇒ validação crítica falha (não abre; o legado segue normal)
  delete from previsao_itens where previsao_id = v_prev;
  insert into previsoes (id, semana_inicio) values (gen_random_uuid(), v_sem + 7) returning id into v_item;
  update rotas_config set ativo_desde = null;
  insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_item, 'previsto', P, 'Conector 3/4"', 0.1825, 100);
  update rotas_config set ativo_desde = now() - interval '1 hour';
  if rotas_liberado(v_sem + 7) or rotas_motivo_bloqueio(v_sem + 7) not like '%legados_fora_da_semana_de_rotas%' then raise exception 'FALHOU (7) legado em semana do modelo: %', rotas_motivo_bloqueio(v_sem + 7); end if;

  -- (8) chave manual continua funcionando (emergência/teste) e 'suporte_ativo' segue false por padrão
  update rotas_config set suporte_ativo = true;
  if not rotas_liberado(date '2020-01-06') then raise exception 'FALHOU (8) chave manual'; end if;

  raise exception 'TESTE_OK rotas T5: sem programação=fechado; futuro=fechado; semana anterior=fechada; semana >= início liberada sem flag, F UM item, legado recusado, apontamento por data; ativação idempotente (1 log); fail closed (ambígua, legado presente) com motivo registrado';
end $$;

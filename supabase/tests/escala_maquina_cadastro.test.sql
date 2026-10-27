-- Teste de banco (DEV/local) da FRENTE A: máquina desativada/reativada e roteiro reagem na Escala + reconciliação. Transação com ROLLBACK; semana sintética de 2035.
-- Nunca em PROD:  npx supabase db query --linked -f supabase/tests/escala_maquina_cadastro.test.sql
begin;
create temp table t_res (n serial, res text);
do $$
declare
  v_snap jsonb := (select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'inicio', to_char(inicio, 'HH24:MI'), 'fim', to_char(fim, 'HH24:MI')) order by id) from periodos);
  v_func uuid := (select id from funcionarios where ativo limit 1);
  v_etapa uuid; v_prod uuid; v_op uuid; v_m uuid; v_m2 uuid; v_m3 uuid;
  v_prev uuid; v_prev2 uuid; v_item uuid; v_item2 uuid; v_n int; v_n2 int; v_txt text;
  dia constant date := '2035-01-02';
begin
  -- etapa com ≥ 2 máquinas na lista (para o roteiro ter lista não vazia depois de remover uma)
  select re.id, re.produto_id, re.operacao_id into v_etapa, v_prod, v_op from roteiro_etapas re
   where (select count(*) from roteiro_etapa_maquinas rm join maquinas mm on mm.id = rm.maquina_id where rm.etapa_id = re.id and mm.ativo) >= 2 limit 1;
  select rm.maquina_id into v_m from roteiro_etapa_maquinas rm join maquinas mm on mm.id = rm.maquina_id where rm.etapa_id = v_etapa and mm.ativo order by rm.maquina_id limit 1;
  select rm.maquina_id into v_m2 from roteiro_etapa_maquinas rm join maquinas mm on mm.id = rm.maquina_id where rm.etapa_id = v_etapa and mm.ativo and rm.maquina_id <> v_m limit 1;
  select id into v_m3 from maquinas where ativo and id not in (v_m, v_m2) and not exists (select 1 from roteiro_etapa_maquinas rm where rm.etapa_id = v_etapa and rm.maquina_id = maquinas.id)
     and not exists (select 1 from previsao_item_maquinas im where im.maquina_id = maquinas.id) and not exists (select 1 from escala_producao_alocacoes a where a.maquina_id = maquinas.id and a.data >= current_date) limit 1;
  if v_etapa is null or v_m2 is null then raise exception 'fixture: sem etapa com 2 máquinas'; end if;

  insert into previsoes (semana_inicio) values ('2035-01-01') returning id into v_prev;
  insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev, 'previsto', v_prod, 'teste', 1, 100) returning id into v_item;
  insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) values (v_item, v_etapa, v_m);
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values (dia, v_prev, v_snap, 1);
  insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas)
    select dia, p.id, v_func, v_m, v_prod, v_etapa, v_op, 10 from periodos p where p.id in ('m1', 'm2');
  delete from escala_producao_eventos where status = 'pendente' and previsao_id = v_prev;

  -- base coerente
  select count(*) into v_n from escala_divergencias_cadastro_maquinas(now()) where previsao_id = v_prev;
  if v_n <> 0 then raise exception 'base com % divergências', v_n; end if;
  insert into t_res(res) values ('ok BASE coerente: 0 divergências (selecionada, na lista do roteiro, ativa)');

  -- DESATIVAR máquina alocada: evento recurso_bloqueado (1), repetir não duplica, reconciliação acusa, passado não considerado
  update maquinas set ativo = false where id = v_m;
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev and tipo = 'recurso_bloqueado' and status = 'pendente' and payload->>'origem' = 'maquina_ativo';
  update maquinas set ativo = true where id = v_m; update maquinas set ativo = false where id = v_m;  -- retry: ida e volta
  select count(*) into v_n2 from escala_producao_eventos where previsao_id = v_prev and tipo = 'recurso_bloqueado' and status = 'pendente';
  if v_n <> 1 or v_n2 <> 1 then raise exception 'desativar falhou: eventos=% após retry=%', v_n, v_n2; end if;
  select count(*) into v_n from escala_divergencias_cadastro_maquinas(now()) where previsao_id = v_prev and tipo = 'maquina_inativa' and maquina_id = v_m;
  if v_n <> 2 then raise exception 'invariante inativa falhou: %', v_n; end if;
  select count(*) into v_n from escala_divergencias_cadastro_maquinas('2035-01-02 10:00-03') where previsao_id = v_prev and tipo = 'maquina_inativa';
  if v_n <> 0 then raise exception 'passado entrou na invariante: %', v_n; end if;
  insert into t_res(res) values ('ok DESATIVAR máquina alocada: 1 evento recurso_bloqueado (retry/ida-e-volta não duplica); invariante acusa 2 períodos futuros; às 10:00 o passado (M1,M2) já não entra');

  -- REATIVAR: evento recurso_liberado; volta a ser candidata (nenhuma divergência)
  delete from escala_producao_eventos where previsao_id = v_prev;
  update maquinas set ativo = true where id = v_m;
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev and tipo = 'recurso_liberado' and status = 'pendente';
  select count(*) into v_n2 from escala_divergencias_cadastro_maquinas(now()) where previsao_id = v_prev;
  if v_n <> 1 or v_n2 <> 0 then raise exception 'reativar falhou: ev=% div=%', v_n, v_n2; end if;
  insert into t_res(res) values ('ok REATIVAR: evento recurso_liberado (1) e 0 divergências — a máquina volta a ser candidata, o motor decide');

  -- MÁQUINA IRRELEVANTE (não selecionada, sem alocação futura): nenhum evento
  if v_m3 is not null then
    delete from escala_producao_eventos where previsao_id = v_prev;
    update maquinas set ativo = false where id = v_m3; update maquinas set ativo = true where id = v_m3;
    select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev;
    if v_n <> 0 then raise exception 'irrelevante gerou % eventos', v_n; end if;
    insert into t_res(res) values ('ok Previsão SEM aquela máquina selecionada: desativar/reativar não gera evento');
  end if;

  -- REMOVER máquina do roteiro da etapa (lista continua não vazia): evento previsao + invariante roteiro_nao_autoriza
  delete from escala_producao_eventos where previsao_id = v_prev;
  delete from roteiro_etapa_maquinas where etapa_id = v_etapa and maquina_id = v_m;
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev and tipo = 'previsao' and payload->>'origem' = 'roteiro_etapa_maquinas';
  select count(*) into v_n2 from escala_divergencias_cadastro_maquinas(now()) where previsao_id = v_prev and tipo = 'roteiro_nao_autoriza' and maquina_id = v_m;
  if v_n <> 1 or v_n2 <> 2 then raise exception 'remover do roteiro falhou: ev=% div=%', v_n, v_n2; end if;
  insert into t_res(res) values ('ok REMOVER do roteiro: 1 evento (deduplicado) e a invariante acusa 2 períodos futuros alocados na máquina não autorizada');

  -- ADICIONAR de volta (par selecionado volta a ser válido): evento previsao; sem divergência
  delete from escala_producao_eventos where previsao_id = v_prev;
  insert into roteiro_etapa_maquinas (etapa_id, maquina_id) values (v_etapa, v_m);
  select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev and tipo = 'previsao';
  select count(*) into v_n2 from escala_divergencias_cadastro_maquinas(now()) where previsao_id = v_prev;
  if v_n <> 1 or v_n2 <> 0 then raise exception 'adicionar ao roteiro falhou: ev=% div=%', v_n, v_n2; end if;
  insert into t_res(res) values ('ok ADICIONAR ao roteiro um par selecionado: 1 evento; 0 divergências (volta a ser candidata)');

  -- ADICIONAR máquina irrelevante ao roteiro (ninguém a selecionou): nenhum evento
  if v_m3 is not null then
    delete from escala_producao_eventos where previsao_id = v_prev;
    insert into roteiro_etapa_maquinas (etapa_id, maquina_id) values (v_etapa, v_m3);
    select count(*) into v_n from escala_producao_eventos where previsao_id = v_prev;
    if v_n <> 0 then raise exception 'roteiro irrelevante gerou evento'; end if;
    insert into t_res(res) values ('ok ADICIONAR ao roteiro máquina que ninguém selecionou: nenhum evento (só vira candidata quando a Previsão a selecionar)');
  end if;

  -- FORA DA SELEÇÃO da Previsão
  delete from previsao_item_maquinas where item_id = v_item;
  select count(*) into v_n from escala_divergencias_cadastro_maquinas(now()) where previsao_id = v_prev and tipo = 'fora_da_selecao_previsao';
  if v_n <> 2 then raise exception 'fora da seleção falhou: %', v_n; end if;
  insert into t_res(res) values ('ok FORA DA SELEÇÃO da Previsão: 2 períodos futuros alocados sem seleção são acusados');
  insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) values (v_item, v_etapa, v_m);

  -- MÁQUINA COMPARTILHADA: a mesma máquina selecionada em duas semanas com escala futura => um evento por semana (dedupe por semana), nunca mais
  insert into previsoes (semana_inicio) values ('2035-01-08') returning id into v_prev2;
  insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev2, 'previsto', v_prod, 'teste2', 1, 100) returning id into v_item2;
  insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) values (v_item2, v_etapa, v_m);
  insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao) values ('2035-01-09', v_prev2, v_snap, 1);
  delete from escala_producao_eventos where previsao_id in (v_prev, v_prev2);
  update maquinas set ativo = false where id = v_m; update maquinas set ativo = true where id = v_m; update maquinas set ativo = false where id = v_m;
  -- a deduplicação é por TIPO e semana (bloqueio e liberação são tipos distintos): no máximo 1 pendente de cada tipo por semana, nunca um por clique
  select max(c) into v_n from (select count(*) c from escala_producao_eventos where previsao_id in (v_prev, v_prev2) and status = 'pendente' group by previsao_id, tipo) x;
  select count(*) into v_n2 from escala_producao_eventos where previsao_id in (v_prev, v_prev2) and status = 'pendente';
  if v_n <> 1 or v_n2 <> 4 then raise exception 'compartilhada falhou: max por tipo=% total=%', v_n, v_n2; end if;
  insert into t_res(res) values ('ok MÁQUINA COMPARTILHADA entre semanas: no máximo 1 evento pendente por tipo e semana (4 no total), mesmo com ida-e-volta repetida');
end $$;
select res from t_res order by n;
rollback;

-- T3 (rotas M3): a seleção de máquinas da Previsão para F reaproveita previsao_item_maquinas (item, etapa, máquina) — a ROTA sai do etapa_id —, a E16 compatível mas NÃO marcada não aparece,
-- e escala_rota_divisao registra as rodadas append-only com idempotência. Tudo desfeito no final (a trava é ligada SÓ dentro desta transação de teste).
do $$
declare
  F uuid; v_prev uuid; v_item uuid; v_ok boolean; v_n int; v_auto uuid; v_conv uuid; v_e16 uuid; v_e15 uuid;
  v_rosq uuid; v_para uuid; v_rp uuid; v_etiq uuid; v_emb uuid; v_txt text;
begin
  select id into F from produtos where nome = 'Conector 3/4" (Final)';
  select id into v_auto from produto_rota where produto_id = F and codigo = 'AUTO';
  select id into v_conv from produto_rota where produto_id = F and codigo = 'CONV';
  select e.id into v_rosq from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Rosquear';
  select e.id into v_para from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Parafusar';
  select e.id into v_rp from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Rosquear + Parafusar';
  select e.id into v_etiq from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Etiquetar';
  select e.id into v_emb from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Embalar';
  select m.id into v_e15 from maquinas m where btrim(m.nome) = 'Etiquetadora 15' limit 1;
  select m.id into v_e16 from maquinas m where btrim(m.nome) = 'Etiquetadora 16' limit 1;
  if F is null or v_e15 is null or v_e16 is null then raise exception 'FALHOU (0) pré-requisitos F=% E15=% E16=%', F, v_e15, v_e16; end if;
  if not exists (select 1 from roteiro_etapa_maquinas where etapa_id = v_etiq and maquina_id = v_e16) then raise exception 'FALHOU (0) a E16 deveria ser COMPATÍVEL com Etiquetar de F no cadastro'; end if;

  update rotas_config set suporte_ativo = true;   -- só nesta transação de teste (desfeita no final)
  insert into previsoes (id, semana_inicio, modelo_rotas) values (gen_random_uuid(), '2031-04-07', true) returning id into v_prev;
  insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev, 'previsto', F, 'Conector 3/4" (Final)', 0.1825, 116625) returning id into v_item;
  -- UM item só para F (não existem itens CONV/AUTO); a pessoa marca máquinas por etapa: só a E15 em Etiquetar
  insert into previsao_item_maquinas (item_id, etapa_id, maquina_id)
    select v_item, v_rosq, m.id from maquinas m where btrim(m.nome) in ('Rosqueadeira 3', 'Rosqueadeira 6')
    union all select v_item, v_para, m.id from maquinas m where btrim(m.nome) in ('Parafusadeira 9', 'Parafusadeira 10')
    union all select v_item, v_rp, m.id from maquinas m where btrim(m.nome) = 'Maquina Automatica 8'
    union all select v_item, v_etiq, v_e15
    union all select v_item, v_emb, m.id from maquinas m where btrim(m.nome) = 'Embalagem 17';
  if (select count(*) from previsao_itens where previsao_id = v_prev) <> 1 then raise exception 'FALHOU (1) F deve ser um único item da Previsão'; end if;

  -- (2) a rota/fluxo de cada máquina selecionada sai do etapa_id (sem coluna nova)
  select string_agg(grupo || ':' || n, ',' order by grupo) into v_txt from (
    select coalesce(pr.codigo, 'COMUM') grupo, count(*) n
    from previsao_item_maquinas pim
    left join rota_etapas re on re.etapa_id = pim.etapa_id left join produto_rota pr on pr.id = re.rota_id
    where pim.item_id = v_item group by 1) t;
  if v_txt <> 'AUTO:1,COMUM:2,CONV:4' then raise exception 'FALHOU (2) grupos de seleção: %', v_txt; end if;
  if not exists (select 1 from previsao_item_maquinas pim join produto_pool_comum pc on pc.etapa_id = pim.etapa_id where pim.item_id = v_item) then raise exception 'FALHOU (2) comum'; end if;

  -- (3) CONTROLE HUMANO: a E16 é compatível no cadastro mas NÃO foi marcada ⇒ nenhuma linha dela; o banco nunca a adiciona
  if exists (select 1 from previsao_item_maquinas where item_id = v_item and maquina_id = v_e16) then raise exception 'FALHOU (3) E16 não pode aparecer sem ser marcada'; end if;
  insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) values (v_item, v_etiq, v_e16);                       -- a pessoa marca a E16
  if (select count(*) from previsao_item_maquinas where item_id = v_item and etapa_id = v_etiq) <> 2 then raise exception 'FALHOU (3) marcar E16'; end if;
  delete from previsao_item_maquinas where item_id = v_item and maquina_id = v_e16;                                        -- e desmarca: some imediatamente
  if exists (select 1 from previsao_item_maquinas where item_id = v_item and maquina_id = v_e16) then raise exception 'FALHOU (3) desmarcar E16'; end if;

  -- (4) divisão registrada por rodada, append-only
  insert into escala_rota_divisao (previsao_id, produto_id, rota_id, quantidade_alvo, capacidade_nominal, capacidade_rota, rodada, rodada_final, algoritmo_versao, hash_entrada, hash_escala, gargalo, motivo)
    values (v_prev, F, v_auto, 35625, 35625, 21375, 1, false, 'rotas-planejador-1.0', 'h1', 'e1', '{"tipo":"entrada"}', '{"parada":"atendeu_alvo"}'),
           (v_prev, F, v_conv, 61875, 81000, 81000, 1, false, 'rotas-planejador-1.0', 'h1', 'e1', '{"tipo":"entrada"}', '{}'),
           (v_prev, F, v_auto, 21375, 35625, 21375, 2, true,  'rotas-planejador-1.0', 'h2', 'e2', null, '{}'),
           (v_prev, F, v_conv, 76125, 81000, 81000, 2, true,  'rotas-planejador-1.0', 'h2', 'e2', null, '{}');
  if (select semana_inicio from escala_rota_divisao where hash_entrada = 'h1' and rota_id = v_auto) <> '2031-04-07' then raise exception 'FALHOU (4) semana deve vir da Previsão'; end if;
  if (select sum(quantidade_alvo) from escala_rota_divisao where previsao_id = v_prev and rodada_final) <> 97500 then raise exception 'FALHOU (4) Σ alvo da rodada final = produto final planejado'; end if;
  begin update escala_rota_divisao set quantidade_alvo = 1 where previsao_id = v_prev; v_ok := false; exception when others then v_ok := position('IMUTAVEL' in upper(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) UPDATE deveria ser recusado'; end if;
  begin delete from escala_rota_divisao where previsao_id = v_prev; v_ok := false; exception when others then v_ok := position('IMUTAVEL' in upper(sqlerrm)) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) DELETE deveria ser recusado'; end if;
  -- idempotência do retry: mesma rodada/entradas não duplica
  insert into escala_rota_divisao (previsao_id, produto_id, rota_id, quantidade_alvo, rodada, hash_entrada, hash_escala) values (v_prev, F, v_auto, 21375, 2, 'h2', 'e2') on conflict do nothing;
  select count(*) into v_n from escala_rota_divisao where previsao_id = v_prev;
  if v_n <> 4 then raise exception 'FALHOU (4) retry duplicou linhas: %', v_n; end if;
  begin insert into escala_rota_divisao (previsao_id, produto_id, rota_id, quantidade_alvo, rodada, hash_entrada, hash_escala) values (v_prev, F, v_auto, 1, 2, 'h2', 'e2'); v_ok := false;
  exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU (4) índice único de idempotência'; end if;

  -- (5) service_role (o orquestrador do servidor) consegue ler a seleção e gravar a divisão
  set local role service_role;
  select count(*) into v_n from previsao_item_maquinas where item_id = v_item;
  insert into escala_rota_divisao (previsao_id, produto_id, rota_id, quantidade_alvo, rodada, hash_entrada, hash_escala) values (v_prev, F, v_auto, 5, 3, 'h3', 'e3');
  reset role;

  raise exception 'TESTE_OK rotas T3: F = 1 item; seleção por etapa em previsao_item_maquinas (AUTO 1, CONV 4, COMUM 2), E16 compatível não marcada = ausente; divisão por rodada append-only, idempotente, semana derivada, service_role grava';
end $$;

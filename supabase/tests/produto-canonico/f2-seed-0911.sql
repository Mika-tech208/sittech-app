-- Semana 09/11 (stand-in do cutover): Previsão com os mesmos itens da 02/11 (+ Caixa Amarela) e escala legada (copiada da 02/11 + 7 dias).
\set ON_ERROR_STOP on
set session_replication_role = replica;
insert into previsoes (id, semana_inicio) values ('0911aaaa-0000-4000-8000-000000000001', '2026-11-09');
insert into previsao_itens (id, previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade)
select ('0911bbbb-0000-4000-8000-00000000000' || row_number() over ())::uuid, '0911aaaa-0000-4000-8000-000000000001', tipo, produto_id, produto_nome, valor_unitario, quantidade
from previsao_itens where previsao_id = '6be15af5-9659-4c12-ba33-9c1fae6d4065';
insert into previsao_itens (id, previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade)
values ('0911bbbb-0000-4000-8000-0000000000cc', '0911aaaa-0000-4000-8000-000000000001', 'previsto', '238ca607-2111-4aff-9a19-a9ae6f20da7e', 'Caixa Amarela 4x2', 0.217, 56400);
-- máquinas: mesmas da 02/11 por produto (mapeando item antigo -> novo pela ordem de produto)
insert into previsao_item_maquinas (item_id, etapa_id, maquina_id)
select n.id, im.etapa_id, im.maquina_id
from previsao_item_maquinas im join previsao_itens o on o.id = im.item_id and o.previsao_id = '6be15af5-9659-4c12-ba33-9c1fae6d4065'
join previsao_itens n on n.previsao_id = '0911aaaa-0000-4000-8000-000000000001' and n.produto_id = o.produto_id;
insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) values ('0911bbbb-0000-4000-8000-0000000000cc', 'c765eb93-4597-405f-803a-91c7fab9ad8e', '95953ca3-b1ae-45c6-8413-e900939f00a8');
insert into escala_producao_dias (data, previsao_id, periodos_snapshot, versao)
select data + 7, '0911aaaa-0000-4000-8000-000000000001', periodos_snapshot, 1 from escala_producao_dias where previsao_id = '6be15af5-9659-4c12-ba33-9c1fae6d4065';
insert into escala_producao_alocacoes (data, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, origem, excecao_revezamento, motivo_sem_posto, distribuicao)
select data + 7, periodo_id, funcionario_id, maquina_id, produto_id, etapa_id, operacao_id, pecas, origem, excecao_revezamento, motivo_sem_posto, distribuicao
from escala_producao_alocacoes where data >= '2026-11-03';
set session_replication_role = default;

#!/bin/bash
# Ensaio da F2: conversão transacional da Previsão (legado -> canônico), guardas, reversão e rollback da migration. Banco: m_base (recriado).
cd "$(dirname "$0")" || exit 1
WT=/Users/mikaellonghi/Documents/sittech-app/.claude/worktrees/agent-a5dba3849ffb8938a
M0=$WT/supabase/migrations/20261107100000_produto_canonico_estrutura.sql
M1=$WT/supabase/migrations/20261107110000_produto_canonico_conversao.sql
BF=$WT/supabase/ops/produto-canonico/10-backfill-conector.sql
RB_F2=$WT/supabase/rollbacks/20261107110000_rollback_produto_canonico_conversao.sql
PREV=0911aaaa-0000-4000-8000-000000000001
ok() { [ "$1" = 0 ] && echo "PASS · $2" || echo "FAIL · $2"; }
q() { ./pg.sh m_base -At "$@"; }
./rebuild.sh > /dev/null 2>&1
./pg.sh m_base -q -f f2-seed-0911.sql > /dev/null || { echo "FAIL · seed 09/11"; exit 1; }
./pg.sh m_base -q -f fingerprint.sql > fp-f2-0-base.txt 2>&1
./pg.sh m_base -q -1 -f $M0 > /dev/null 2>&1; ./pg.sh m_base -q -f $BF > /dev/null 2>&1
./pg.sh m_base -q -f fingerprint.sql > fp-f2-1-f0f1.txt 2>&1
./pg.sh m_base -q -1 -f $M1 > f2-mig.out 2>&1; ok $? "migration F2 aplicada ($(grep -c ERROR f2-mig.out) erros)"
./pg.sh m_base -q -1 -f $M1 > /dev/null 2>&1; ok $? "migration F2 reaplicada (idempotente)"
./pg.sh m_base -q -f fingerprint.sql > fp-f2-2-f2.txt 2>&1
echo "-- diff F0+F1 -> +F2 (esperado: só TRIGGERS +2, OBJETOS novos):"; diff fp-f2-1-f0f1.txt fp-f2-2-f2.txt | cut -c1-170

echo "== F2 inerte com cutover null: legado continua gravando normalmente"
q -c "insert into previsao_itens (id, previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values ('0911bbbb-0000-4000-8000-0000000000ee', '$PREV', 'realizado', '238ca607-2111-4aff-9a19-a9ae6f20da7e', 'x', 0.2, 1)" > /dev/null; ok $? "insert de item comum com cutover null"
q -c "delete from previsao_itens where id='0911bbbb-0000-4000-8000-0000000000ee'" > /dev/null
q -c "insert into previsao_itens (id, previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values ('0911bbbb-0000-4000-8000-0000000000ef', '$PREV', 'realizado', '27c229d7-f192-41eb-aad1-0c69ece53eba', 'x', 0.2, 1)" > /dev/null; ok $? "insert de item LEGADO com cutover null (guarda inerte)"
q -c "delete from previsao_itens where id='0911bbbb-0000-4000-8000-0000000000ef'" > /dev/null
q -c "delete from escala_producao_eventos" > /dev/null
q -At -c "select 'estado antes da conversão: itens='||count(*)||' qtd='||sum(quantidade) from previsao_itens where previsao_id='$PREV'"
q -c "select md5(string_agg(t::text,'~' order by t.id::text)) from previsao_itens t where previsao_id='$PREV'" > h-itens-antes.txt
q -c "select md5(string_agg(t::text,'~' order by t::text)) from previsao_item_maquinas t where item_id in (select id from previsao_itens where previsao_id='$PREV')" > h-maq-antes.txt

echo "== CONVERSÃO"
q -c "select public.produto_unico_converter_previsao('$PREV', null, 'ensaio')" > f2-conv.out 2>&1; ok $? "conversão executou: $(cut -c1-230 f2-conv.out)"
q -c "select 'itens depois: '||string_agg(p.nome||'='||i.quantidade||' @'||i.valor_unitario, ' | ' order by p.nome) from previsao_itens i join produtos p on p.id=i.produto_id where i.previsao_id='$PREV' and i.tipo='previsto'"
q -c "select 'canonico 93300? '||(select quantidade from previsao_itens where previsao_id='$PREV' and produto_id=(select produto_id from produto_canonico))" | grep -q "93300" ; ok $? "demanda única = 93.300 (64.800 + 28.500)"
q -c "select 'Caixa intacta: '||count(*) from previsao_itens where previsao_id='$PREV' and produto_id='238ca607-2111-4aff-9a19-a9ae6f20da7e' and quantidade=56400" | grep -q ": 1"; ok $? "item de outro produto (Caixa Amarela) intacto"
q -At -c "select 'maquinas canonicas por etapa: '||string_agg(o.nome||'='||c, ', ' order by o.nome) from (select e.operacao_id, count(*) c from previsao_item_maquinas im join roteiro_etapas e on e.id=im.etapa_id where im.item_id=(select id from previsao_itens where previsao_id='$PREV' and produto_id=(select produto_id from produto_canonico)) group by 1) z join operacoes o on o.id=z.operacao_id"
q -At -c "select 'M8 selecionada na etapa M8 canonica: '||count(*) from previsao_item_maquinas im join produto_canonico_etapas ce on ce.etapa_id=im.etapa_id where ce.rota_id=(select id from produto_rotas where codigo='AUTOMATICA') and im.maquina_id='a118f430-f854-4e89-9e3c-ce6fcbbc52cf'"
q -At -c "select 'cutover: '||valor::text from escala_parametros where chave='produto_unico_cutover'" | tee f2-cut.out
grep -q '"2026-11-09"' f2-cut.out; ok $? "produto_unico_cutover = 2026-11-09"
q -At -c "select 'eventos de recálculo: total='||count(*)||' pendentes='||count(*) filter (where status='pendente')||' distintos(previsao,chave)='||count(distinct (previsao_id, chave)) from escala_producao_eventos"
q -c "select public.produto_unico_converter_previsao('$PREV')" 2>&1 | grep -q ja_convertida.*true; ok $? "2ª conversão é idempotente (ja_convertida)"

echo "== GUARDAS (semana >= cutover usa o canônico; anterior, os legados)"
q -c "insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values ('$PREV','previsto','27c229d7-f192-41eb-aad1-0c69ece53eba','x',0.18,1)" 2>&1 | grep -q PRODUTO_LEGADO_APOS_CUTOVER; ok $? "cliente antigo não regrava item LEGADO em semana canônica"
q -c "insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values ('6be15af5-9659-4c12-ba33-9c1fae6d4065','previsto',(select produto_id from produto_canonico),'x',0.18,1)" 2>&1 | grep -q PRODUTO_CANONICO_ANTES_DO_CUTOVER; ok $? "canônico não entra em semana anterior ao cutover (02/11)"
q -c "insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values ('6be15af5-9659-4c12-ba33-9c1fae6d4065','realizado','27c229d7-f192-41eb-aad1-0c69ece53eba','x',0.18,1)" > /dev/null 2>&1; ok $? "legado continua aceito na semana 02/11 (anterior ao cutover)"
q -c "delete from previsao_itens where produto_nome='x'" > /dev/null
AP="insert into apontamentos_producao (id, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, status, valor_unitario_produto_vigente, idempotency_key, criado_por) select gen_random_uuid(), PROD, ETAPA, a.operacao_id, a.maquina_id, a.funcionario_id, a.periodo_id, 'DATA'::date, a.hora_lancamento, 1, 0, a.periodo_inicio_vigente, a.periodo_fim_vigente, 1, 1, 'produzindo', 1, gen_random_uuid(), a.criado_por from apontamentos_producao a where a.etapa_id='34371af3-2608-42cc-9ded-1f7815a635a8' limit 1"
CAN=$(q -c "select produto_id from produto_canonico"); ETC=$(q -c "select etapa_canonica_id from etapa_legado_mapa where etapa_legado_id='34371af3-2608-42cc-9ded-1f7815a635a8'")
q -c "$(echo "$AP" | sed "s/PROD/'27c229d7-f192-41eb-aad1-0c69ece53eba'/; s/ETAPA/'34371af3-2608-42cc-9ded-1f7815a635a8'/; s/DATA/2026-11-10/")" 2>&1 | grep -q APONTAMENTO_LEGADO_APOS_CUTOVER; ok $? "apontamento LEGADO em data >= cutover é recusado"
q -c "$(echo "$AP" | sed "s/PROD/'$CAN'/; s/ETAPA/'$ETC'/; s/DATA/2026-10-24/")" 2>&1 | grep -q APONTAMENTO_CANONICO_ANTES_DO_CUTOVER; ok $? "apontamento CANÔNICO em data < cutover é recusado"
q -c "$(echo "$AP" | sed "s/PROD/'27c229d7-f192-41eb-aad1-0c69ece53eba'/; s/ETAPA/'34371af3-2608-42cc-9ded-1f7815a635a8'/; s/DATA/2026-10-24/")" > /dev/null 2>&1; ok $? "apontamento LEGADO retroativo (data < cutover) continua aceito"
q -c "delete from apontamentos_producao where data='2026-10-24'" > /dev/null
q -At -c "select 'visão final por semana: '||string_agg(semana_inicio||'='||quantidade_boa, ', ' order by semana_inicio) from vw_producao_final_semana" -c "select 'visão por rota: '||string_agg(semana_inicio||' '||r.codigo||'='||v.quantidade_boa, ', ' order by semana_inicio, r.codigo) from vw_producao_rota_semana v join produto_rotas r on r.id=v.rota_id"

echo "== REVERSÃO recusada se o motor já gravou linhas canônicas"
./pg.sh postgres -q -c "drop database if exists m_tmp" -c "create database m_tmp template m_base" > /dev/null 2>&1
./pg.sh m_tmp -q -c "update escala_producao_alocacoes set produto_id='$CAN' where data = '2026-11-10' and maquina_id='4b48df30-62cb-4763-8749-1b2abae1b451' and periodo_id='m1'" > /dev/null 2>&1
./pg.sh m_tmp -At -c "select public.produto_unico_reverter_previsao('$PREV')" 2>&1 | grep -q F2_REVERSAO_ABORTADA; ok $? "reversão recusa com alocação no canônico (restaurar o plano antes)"
./pg.sh postgres -q -c "drop database if exists m_tmp" > /dev/null 2>&1

echo "== REVERSÃO (plano ainda legado) => estado anterior idêntico"
q -c "select public.produto_unico_reverter_previsao('$PREV', 'ensaio')" > f2-rev.out 2>&1; ok $? "reversão executou: $(cut -c1-160 f2-rev.out)"
q -c "select md5(string_agg(t::text,'~' order by t.id::text)) from previsao_itens t where previsao_id='$PREV'" > h-itens-depois.txt
q -c "select md5(string_agg(t::text,'~' order by t::text)) from previsao_item_maquinas t where item_id in (select id from previsao_itens where previsao_id='$PREV')" > h-maq-depois.txt
diff -q h-itens-antes.txt h-itens-depois.txt > /dev/null; ok $? "itens da Previsão idênticos (hash) antes da conversão e depois da reversão"
diff -q h-maq-antes.txt h-maq-depois.txt > /dev/null; ok $? "máquinas selecionadas idênticas (hash) antes e depois"
q -At -c "select 'cutover após reversão: '||valor::text from escala_parametros where chave='produto_unico_cutover'"
q -At -c "select 'trilha: '||string_agg(acao, ',' order by id) from produto_unico_conversoes"

echo "== rollback da migration F2 (com e sem conversão ativa)"
q -c "select public.produto_unico_converter_previsao('$PREV', null, 'ensaio')" > /dev/null 2>&1
./pg.sh m_base -q -f $RB_F2 2>&1 | grep -q ROLLBACK_F2_ABORTADO; ok $? "rollback F2 recusa com Previsão convertida"
q -c "select public.produto_unico_reverter_previsao('$PREV', 'ensaio')" > /dev/null 2>&1
./pg.sh m_base -q -f $RB_F2 > /dev/null 2>&1; ok $? "rollback F2 executou após reverter"
./pg.sh m_base -q -c "alter table escala_parametros disable trigger trg_escala_parametros_evento" -c "alter table escala_parametros disable trigger trg_escala_plano_versao" -c "update escala_parametros set valor='null'::jsonb where chave='produto_unico_cutover'" -c "alter table escala_parametros enable trigger trg_escala_plano_versao" -c "alter table escala_parametros enable trigger trg_escala_parametros_evento" > /dev/null 2>&1
q -c "delete from escala_producao_eventos" > /dev/null
./pg.sh m_base -q -f fingerprint.sql > fp-f2-3-pos-rollback.txt 2>&1
diff <(grep -v "produto_canonico_ativ" fp-f2-1-f0f1.txt) <(grep -v "produto_canonico_ativ" fp-f2-3-pos-rollback.txt) > diff-f2-rb.txt; ok $? "após rollback F2: fingerprint = F0+F1 (legado byte-idêntico, triggers/funções originais)"
cat diff-f2-rb.txt | cut -c1-160

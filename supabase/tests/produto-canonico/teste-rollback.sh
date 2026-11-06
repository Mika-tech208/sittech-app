#!/bin/bash
# Teste I: rollback volta EXATAMENTE ao estado anterior (fingerprint), recusa quando o canônico foi USADO, e é idempotente.
cd "$(dirname "$0")" || exit 1
WT=/Users/mikaellonghi/Documents/sittech-app/.claude/worktrees/agent-a5dba3849ffb8938a
RB1=$WT/supabase/rollbacks/20261107100000_rollback_produto_canonico_1_backfill.sql
RB2=$WT/supabase/rollbacks/20261107100000_rollback_produto_canonico_2_estrutura.sql
BF=$WT/supabase/ops/produto-canonico/10-backfill-conector.sql
MIG=$WT/supabase/migrations/20261107100000_produto_canonico_estrutura.sql
ok() { [ "$1" = 0 ] && echo "PASS · $2" || echo "FAIL · $2"; }
# estado atual: F0+F1 aplicados (fp-2-f1.txt)
./pg.sh m_base -q -f fingerprint.sql > fp-r0.txt 2>&1; diff -q fp-2-f1.txt fp-r0.txt >/dev/null; ok $? "estado inicial = F0+F1 (fp-2-f1)"

# 1) canônico USADO (item de Previsão aponta para ele) => rollback 1 ABORTA e nada é apagado (cenário num CLONE)
./pg.sh postgres -q -c "drop database if exists m_tmp" -c "create database m_tmp template m_base" > /dev/null 2>&1
./pg.sh m_tmp -q -c "insert into previsao_itens (id, previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) select '10000000-0000-0000-0000-0000000000ff','6be15af5-9659-4c12-ba33-9c1fae6d4065','previsto', produto_id, 'x', 0.18, 1 from produto_canonico" > /dev/null
./pg.sh m_tmp -q -f $RB1 > rb1-usado.out 2>&1; grep -q "ROLLBACK_BACKFILL_ABORTADO" rb1-usado.out; ok $? "rollback 1 recusa quando o canônico foi usado ($(grep -o 'ABORTADO.*' rb1-usado.out | head -1 | cut -c1-110))"
./pg.sh m_tmp -At -c "select 'canonico ainda existe no clone apos recusa: '||count(*) from produto_canonico"
./pg.sh postgres -q -c "drop database if exists m_tmp" > /dev/null 2>&1

# 1b) alocação com distribuição citando o canônico também bloqueia (cenário num CLONE do banco, para não contaminar m_base)
./pg.sh postgres -q -c "drop database if exists m_tmp" -c "create database m_tmp template m_base" > /dev/null 2>&1
./pg.sh m_tmp -q -c "update escala_producao_alocacoes set distribuicao = distribuicao || jsonb_build_array(jsonb_build_object('produto_id',(select produto_id::text from produto_canonico),'etapa_id','00000000-0000-0000-0000-000000000000','pecas',0.0001)) where (data,periodo_id,funcionario_id) = (select data,periodo_id,funcionario_id from escala_producao_alocacoes where distribuicao is not null limit 1)" > /dev/null 2>&1
./pg.sh m_tmp -q -f $RB1 > rb1-usado2.out 2>&1; grep -q "alocacoes=" rb1-usado2.out; ok $? "rollback 1 recusa quando uma distribuicao cita o canônico (clone)"
./pg.sh postgres -q -c "drop database if exists m_tmp" > /dev/null 2>&1

# 2) rollback 1 (sem uso) => volta ao fingerprint de F0 exatamente
./pg.sh m_base -q -f $RB1 > rb1.out 2>&1; ok $? "rollback 1 executou"
./pg.sh m_base -q -f fingerprint.sql > fp-r1.txt 2>&1
diff <(grep -v '^T produto_canonico_ativ' fp-1-f0.txt) <(grep -v '^T produto_canonico_ativ' fp-r1.txt) > diff-r1.txt; ok $? "após rollback 1: fingerprint = F0 (legado byte-idêntico; só a trilha tem 2 linhas a mais)"
cat diff-r1.txt
./pg.sh m_base -q -f $RB1 2>&1 | grep -q "nada a fazer"; ok $? "rollback 1 idempotente (sem canônico: nada a fazer)"

# 3) refaz o backfill (recria com ids novos) e desfaz TUDO (rollback 1 + 2) => fingerprint = baseline original
./pg.sh m_base -q -f $BF > /dev/null 2>&1; ok $? "backfill reaplicado após rollback"
./pg.sh m_base -q -f $RB1 > /dev/null 2>&1; ok $? "rollback 1 (2ª vez)"
# cutover ativo bloqueia o rollback 2
./pg.sh m_base -q -c "update escala_parametros set valor='\"2026-11-09\"' where chave='produto_unico_cutover'" > /dev/null 2>&1
./pg.sh m_base -q -f $RB2 > rb2-bloq.out 2>&1; grep -q "ROLLBACK_ESTRUTURA_ABORTADO" rb2-bloq.out; ok $? "rollback 2 recusa com cutover ativo"
# achado: mudar o cutover DISPARA evento de recálculo (é o gatilho da ativação) — asserção e limpeza do evento criado pelo teste
./pg.sh m_base -At -c "select count(*) from escala_producao_eventos where payload->>'chave'='produto_unico_cutover' and status='pendente'" | grep -q '^1$'; ok $? "UPDATE de produto_unico_cutover registra 1 evento de recálculo pendente (gatilho de ativação)"
./pg.sh m_base -q -c "delete from escala_producao_eventos where payload->>'chave'='produto_unico_cutover'" > /dev/null
./pg.sh m_base -q -c "alter table escala_parametros disable trigger trg_escala_parametros_evento" -c "alter table escala_parametros disable trigger trg_escala_plano_versao" -c "update escala_parametros set valor='null'::jsonb where chave='produto_unico_cutover'" -c "alter table escala_parametros enable trigger trg_escala_plano_versao" -c "alter table escala_parametros enable trigger trg_escala_parametros_evento" > /dev/null 2>&1
./pg.sh m_base -q -f $RB2 > rb2.out 2>&1; ok $? "rollback 2 executou"
./pg.sh m_base -q -f fingerprint.sql > fp-r2.txt 2>&1
diff fp-0-base.txt fp-r2.txt > diff-r2.txt; ok $? "após rollback 1+2: fingerprint IDÊNTICO ao baseline original (funções, triggers, colunas, constraints, dados)"
cat diff-r2.txt
# 4) reaplica a migration e o backfill (idempotência ponta a ponta) e deixa o banco em F0+F1
./pg.sh m_base -q -1 -f $MIG > /dev/null 2>&1; ok $? "migration reaplicada"
./pg.sh m_base -q -f $BF > /dev/null 2>&1; ok $? "backfill reaplicado"

#!/bin/bash
# Prova do hash OFICIAL do plano (escala_plano_registrar, o mesmo de escala_plano_versoes.hash_plano) com a migration inerte + backfill: o hash não muda.
cd "$(dirname "$0")" || exit 1
WT=/Users/mikaellonghi/Documents/sittech-app/.claude/worktrees/agent-a5dba3849ffb8938a
PREV=6be15af5-9659-4c12-ba33-9c1fae6d4065
./rebuild.sh > /dev/null 2>&1
echo "== baseline (sem a migration)"
./pg.sh m_base -At -c "select 'versao registrada: '||coalesce(escala_plano_registrar('$PREV','baseline')::text,'(nula)')" -c "select 'hash_plano baseline: '||hash_plano||' linhas='||jsonb_array_length(linhas) from escala_plano_versoes where previsao_id='$PREV' order by criado_em desc limit 1"
H0=$(./pg.sh m_base -At -c "select hash_plano from escala_plano_versoes where previsao_id='$PREV' order by criado_em desc limit 1")
./pg.sh m_base -q -1 -f $WT/supabase/migrations/20261107100000_produto_canonico_estrutura.sql > /dev/null 2>&1
./pg.sh m_base -q -f $WT/supabase/ops/produto-canonico/10-backfill-conector.sql > /dev/null 2>&1
echo "== depois de F0 + F1"
./pg.sh m_base -At -c "select 'nova versao? (nula = hash igual ao ultimo): '||coalesce(escala_plano_registrar('$PREV','baseline')::text,'(nula)')" -c "select 'versoes: '||count(*)||' hashes distintos: '||count(distinct hash_plano) from escala_plano_versoes where previsao_id='$PREV'"
H1=$(./pg.sh m_base -At -c "select hash_plano from escala_plano_versoes where previsao_id='$PREV' order by criado_em desc limit 1")
[ "$H0" = "$H1" ] && echo "PASS · hash oficial do plano da semana 02/11 inalterado ($H1)" || echo "FAIL · hash mudou: $H0 -> $H1"

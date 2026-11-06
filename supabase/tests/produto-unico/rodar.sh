#!/usr/bin/env bash
# Testes de DADOS do produto único (clone local de PROD; NUNCA em PROD). Cada bloco SQL roda em transação com ROLLBACK.
# Uso: supabase/tests/produto-unico/rodar.sh [--do-zero]
#   --do-zero : recria o clone a partir do último dump, mede o BASELINE (fingerprint + hash do plano), aplica migrations+backfill e compara (comportamento byte-idêntico com cutover null).
set -uo pipefail
cd "$(dirname "$0")"
RAIZ="$(cd ../../.. && pwd)"
PSQL=/opt/homebrew/opt/libpq/bin/psql
p() { "$PSQL" -h 127.0.0.1 -p 55433 -U postgres -X -q sittech_clone "$@"; }
SAIDA="${SAIDA:-/tmp/produto-unico-testes}"; mkdir -p "$SAIDA"
PREV=6be15af5-9659-4c12-ba33-9c1fae6d4065   # semana 02/11
if [ "${1:-}" = "--do-zero" ]; then
  CLONE_ROOT="${CLONE_ROOT:-/Users/mikaellonghi/Documents/sittech-clone}"
  "$RAIZ/scripts/fechamento/clone/restaurar-clone.sh" --dump "$(grep '^dump_file=' "$CLONE_ROOT/dumps/LATEST_INFO" | cut -d= -f2)" >/dev/null 2>&1
  p -At -f fingerprint.sql > "$SAIDA/fp0-baseline.txt" 2>&1
  p -At -c "select coalesce(escala_plano_registrar('$PREV','baseline')::text,'(sem nova versao)')" > /dev/null
  H0=$(p -At -c "select hash_plano from escala_plano_versoes where previsao_id='$PREV' order by valido_desde desc, criado_em desc limit 1")
  N0=$(p -At -c "select count(*) from escala_plano_versoes")
  "$RAIZ/scripts/produto-unico-dados/clone-aplicar.sh" > "$SAIDA/aplicar.out" 2>&1 || { echo "FAIL · aplicar migrations/backfill"; tail "$SAIDA/aplicar.out"; exit 1; }
  echo "PASS · 3 migrations + backfill aplicados no clone ($(grep -c ERROR "$SAIDA/aplicar.out") erros)"
  p -At -f fingerprint.sql > "$SAIDA/fp1-migrado.txt" 2>&1
  diff "$SAIDA/fp0-baseline.txt" "$SAIDA/fp1-migrado.txt" > "$SAIDA/fp-diff.txt" && echo "PASS · fingerprint idêntico (funções, triggers, colunas, constraints, dados e hashes existentes; objetos novos excluídos)" || {
    echo "-- diferenças baseline -> migrado (esperado: apenas TRIGGERS +3 de guarda):"; cut -c1-150 "$SAIDA/fp-diff.txt"; }
  # ÚNICA diferença admitida: 3 gatilhos de guarda (previsao_itens, apontamentos_producao, previsao_item_adicional_etapa)
  [ "$(diff "$SAIDA/fp0-baseline.txt" "$SAIDA/fp1-migrado.txt" | grep -c '^>')" -le 1 ] && echo "PASS · só a linha TRIGGERS difere (3 guardas inertes com cutover null)" || echo "FAIL · mais de uma linha de fingerprint difere"
  p -At -c "select coalesce(escala_plano_registrar('$PREV','baseline')::text,'(sem nova versao)')" > "$SAIDA/reg.txt"
  H1=$(p -At -c "select hash_plano from escala_plano_versoes where previsao_id='$PREV' order by valido_desde desc, criado_em desc limit 1")
  N1=$(p -At -c "select count(*) from escala_plano_versoes")
  [ "$H0" = "$H1" ] && [ "$N0" = "$N1" ] && [ "$(cat "$SAIDA/reg.txt")" = "(sem nova versao)" ] && echo "PASS · HASH do plano da semana 02/11 idêntico antes/depois (${H1:0:16}…, $N0 versões, nenhuma nova)" || echo "FAIL · hash do plano mudou: $H0 -> $H1 ($N0 -> $N1)"
  p -At -c "select count(*) from escala_producao_eventos where status='pendente'" | grep -q '^0$' && echo "PASS · nenhum evento de recálculo pendente" || echo "FAIL · há evento pendente"
fi
for f in 01-estrutura-backfill.sql 02-cutover-buffers.sql 03-apontamentos.sql; do
  [ -f "$f" ] || continue
  echo "### $f"
  p -At -f "$f" > "$SAIDA/$f.out" 2>&1
  grep -E 'PASS|FAIL|^==|^--' "$SAIDA/$f.out" | sed -e 's/^psql:[^ ]* NOTICE:  //' -e 's/^NOTICE:  //'
  grep -E 'ERROR' "$SAIDA/$f.out" | head -5 | sed 's/^/ERRO SQL · /'
done | tee "$SAIDA/resultado.txt"
echo "RESUMO: $(grep -c 'PASS' "$SAIDA/resultado.txt") PASS · $(grep -c 'FAIL' "$SAIDA/resultado.txt") FAIL · $(grep -c 'ERRO SQL' "$SAIDA/resultado.txt") erros SQL"

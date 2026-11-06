#!/usr/bin/env bash
# Aplica no CLONE local (nunca em PROD) as 3 migrations do produto único + o backfill. Uso: scripts/produto-unico-dados/clone-aplicar.sh [--restaurar]
#   --restaurar : antes, recria o clone a partir do ÚLTIMO dump de PROD já baixado (não toca PROD; para dump novo rode scripts/fechamento/clone/restaurar-clone.sh sem argumentos)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
CLONE_ROOT="${CLONE_ROOT:-/Users/mikaellonghi/Documents/sittech-clone}"
PSQL=/opt/homebrew/opt/libpq/bin/psql
if [ "${1:-}" = "--restaurar" ]; then
  DUMP="$(grep '^dump_file=' "$CLONE_ROOT/dumps/LATEST_INFO" | cut -d= -f2)"
  "$RAIZ/scripts/fechamento/clone/restaurar-clone.sh" --dump "$DUMP" >/dev/null
fi
p() { "$PSQL" -h 127.0.0.1 -p 55433 -U postgres -X -q -v ON_ERROR_STOP=1 sittech_clone "$@"; }
for f in 20261115100000_produto_canonico_estrutura 20261115110000_produto_canonico_conversao 20261115120000_produto_unico_ativacao 20261116100000_produto_unico_planejamento_liberacao ${MIGRATIONS_EXTRA:-}; do
  p -1 -f "$RAIZ/supabase/migrations/$f.sql" >/dev/null
  echo "migration $f aplicada"
done
p -f "$RAIZ/supabase/ops/produto-unico/10-backfill-conector-unico.sql" 2>&1 | grep -v '^$' || true

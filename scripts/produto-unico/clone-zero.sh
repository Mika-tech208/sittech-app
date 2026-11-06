#!/usr/bin/env bash
# Recria o CLONE (nunca PROD) a partir do último dump já baixado e aplica as migrations/backfill do produto único (inclui as da virada). Uso: scripts/produto-unico/clone-zero.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
scripts/produto-unico-dados/clone-aplicar.sh --restaurar 2>&1 | grep -E "aplicada|backfill:|ERROR" || true

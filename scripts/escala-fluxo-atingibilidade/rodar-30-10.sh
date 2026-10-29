#!/bin/bash
# Análise econômica 30/10 (offline/sombra). Só SELECT em PROD. Uso:
#   rodar-30-10.sh [--agora HH:MM] [--contagem "Produto:Origem>Seguinte=saldo@HH:MM"]... [--cache] [--sem-remocao]
# Foto (1) PROJETADA: sem --agora.   Foto (2) REAL: com --agora (ex.: --agora 14:35, 17:15).
# Contagens de 12:05 (já podem estar gravadas em PROD; repetidas aqui são idempotentes — vale a mais recente por par):
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$RAIZ" || exit 1
export ATING_CACHE="${ATING_CACHE:-/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/ating30/cache}"
mkdir -p "$ATING_CACHE"
CONT=()
if [[ " $* " != *" --contagem "* ]]; then
  CONT=(
    --contagem "Conector 3/4:Rosquear>Parafusar=4800@12:05"
    --contagem "Conector 3/4:Parafusar>Etiquetar=6000@12:05"
    --contagem "Conector 3/4:Etiquetar>Embalar=9600@12:05"
    --contagem "Caixa Amarela:Etiquetar>Montar=2000@12:05"
    --contagem "Conector 1.1/4:Rosquear>Embalar=660@12:05"
  )
fi
exec npx tsx --tsconfig scripts/escala-fluxo-atingibilidade/tsconfig.30-10.json scripts/escala-fluxo-atingibilidade/analise-30-10.ts "${CONT[@]}" "$@"

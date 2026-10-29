#!/bin/bash
# v3 do pipeline (v2 + valor do posto ocupado A/B/C com resto replanejado + saturação completa). Mesmos argumentos.
cd /Users/mikaellonghi/Documents/sittech-app/.worktrees/atingibilidade || exit 1
exec npx tsx --tsconfig /private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/runner/tsconfig.atingibilidade.json scripts/escala-fluxo-atingibilidade/proposta-tarde.v3.ts "$@"

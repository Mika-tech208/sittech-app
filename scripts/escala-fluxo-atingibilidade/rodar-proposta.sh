#!/bin/bash
# Wrapper de um comando: roda o pipeline da proposta de T1–T3 (somente SELECT em PROD; nada é gravado). Repasse os argumentos do proposta-tarde.ts.
cd /Users/mikaellonghi/Documents/sittech-app/.worktrees/atingibilidade || exit 1
exec npx tsx --tsconfig /private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/runner/tsconfig.atingibilidade.json scripts/escala-fluxo-atingibilidade/proposta-tarde.ts "$@"

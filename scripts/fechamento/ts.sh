#!/bin/bash
# Roda um script TypeScript offline com o alias @/* (sem Supabase). Uso: scripts/fechamento/ts.sh scripts/fechamento/replay-fechamentos.ts
cd "$(cd "$(dirname "$0")/../.." && pwd)" || exit 1
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:0 NEXT_PUBLIC_SUPABASE_ANON_KEY=offline
exec npx tsx --tsconfig scripts/fechamento/tsconfig.json "$@"

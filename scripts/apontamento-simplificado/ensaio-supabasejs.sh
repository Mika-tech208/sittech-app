#!/bin/bash
# ENSAIO da camada supabase-js/RPC (JWT de usuário via PostgREST) contra um CLONE LOCAL DESCARTÁVEL — nunca toca Supabase DEV/PROD nem o clone compartilhado.
# Copia o clone (sittech_clone) para o banco sittech_apont_e2e, aplica a migration, sobe um PostgREST e um proxy próprios (portas 3311/3310) com o mesmo jwt-secret do clone
# (lido do arquivo, nunca impresso) e roda scripts/apontamento-simplificado/ensaio-supabasejs.ts. Pré-requisito: clone no ar (scripts/fechamento/clone/start-clone.sh).
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; CLONE=~/Documents/sittech-clone; PS=/opt/homebrew/opt/libpq/bin/psql; PGB=/opt/homebrew/opt/postgresql@16/bin; H=(-h 127.0.0.1 -p 55433 -U postgres)
D=$(mktemp -d "${TMPDIR:-/tmp}/apx-e2e.XXXXXX"); chmod 700 "$D"
trap 'kill $PGRST_PID $PROXY_PID 2>/dev/null || true; "$PS" "${H[@]}" -d postgres -q -c "drop database if exists sittech_apont_e2e" >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
PGRST_PID=; PROXY_PID=
"$PS" "${H[@]}" -d postgres -q -c "drop database if exists sittech_apont_e2e" -c "create database sittech_apont_e2e"
"$PGB/pg_dump" "${H[@]}" -d sittech_clone --no-owner | "$PS" "${H[@]}" -d sittech_apont_e2e -q >/dev/null 2>&1
"$PS" "${H[@]}" -d sittech_apont_e2e -q -v ON_ERROR_STOP=1 -f "$RAIZ/supabase/migrations/20261111100000_apontamento_simplificado.sql" 2>&1 | grep -v NOTICE || true
sed -e 's#/sittech_clone"#/sittech_apont_e2e"#' -e 's#^server-port.*#server-port = 3311#' "$CLONE/postgrest.conf" > "$D/postgrest.conf"; chmod 600 "$D/postgrest.conf"
postgrest "$D/postgrest.conf" >"$D/postgrest.log" 2>&1 & PGRST_PID=$!
node "$RAIZ/scripts/fechamento/clone/proxy.js" 3310 3311 >"$D/proxy.log" 2>&1 & PROXY_PID=$!
for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3310/rest/v1/ 2>/dev/null | grep -q '^[234]' && break; sleep 0.5; done
set -a; . "$CLONE/env.clone"; set +a
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3310
export E2E_JWT_SECRET="$(sed -n 's/^jwt-secret *= *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$CLONE/postgrest.conf")"
cd "$RAIZ" && scripts/fechamento/ts.sh scripts/apontamento-simplificado/ensaio-supabasejs.ts

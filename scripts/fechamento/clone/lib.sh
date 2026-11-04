#!/usr/bin/env bash
# Variáveis comuns do clone local de PROD (sourced por start/stop/restaurar). Sem segredos aqui.
export LC_ALL=en_US.UTF-8
CLONE_ROOT="${CLONE_ROOT:-/Users/mikaellonghi/Documents/sittech-clone}"
PGB=/opt/homebrew/opt/postgresql@16/bin
PSQL=/opt/homebrew/opt/libpq/bin/psql
PGDUMP=/opt/homebrew/opt/libpq/bin/pg_dump
PGDATA="$CLONE_ROOT/pgdata"
PG_PORT=55433          # Postgres do clone (somente TCP em 127.0.0.1)
REST_PORT=3300         # URL pública do clone (proxy que remove /rest/v1) -> NEXT_PUBLIC_SUPABASE_URL
PGRST_PORT=3301        # PostgREST interno
DB_NAME=sittech_clone
PGRST_CONF="$CLONE_ROOT/postgrest.conf"
RUN_DIR="$CLONE_ROOT/run"
CLONE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Todo acesso local usa este psql (nunca PROD).
lpsql() { "$PSQL" -h 127.0.0.1 -p "$PG_PORT" -U postgres -X -q "$@"; }
pg_rodando() { "$PGB/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; }
pid_vivo() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

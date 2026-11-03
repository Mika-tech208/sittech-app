#!/usr/bin/env bash
# Sobe Postgres local (127.0.0.1:55433) + PostgREST (3301) + proxy /rest/v1 (3300). Idempotente. Exige clone restaurado.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
[ -f "$PGDATA/PG_VERSION" ] && [ -f "$PGRST_CONF" ] || { echo "Clone inexistente. Rode restaurar-clone.sh primeiro." >&2; exit 1; }
mkdir -p "$RUN_DIR"
if ! pg_rodando; then
  "$PGB/pg_ctl" -D "$PGDATA" -l "$CLONE_ROOT/postgres.log" -w \
    -o "-p $PG_PORT -c unix_socket_directories= -c listen_addresses=127.0.0.1" start >/dev/null
fi
echo "postgres: 127.0.0.1:$PG_PORT/$DB_NAME"
if ! pid_vivo "$RUN_DIR/postgrest.pid"; then
  nohup postgrest "$PGRST_CONF" >"$CLONE_ROOT/postgrest.log" 2>&1 &
  echo $! >"$RUN_DIR/postgrest.pid"
fi
if ! pid_vivo "$RUN_DIR/proxy.pid"; then
  nohup node "$CLONE_DIR/proxy.js" "$REST_PORT" "$PGRST_PORT" >"$CLONE_ROOT/proxy.log" 2>&1 &
  echo $! >"$RUN_DIR/proxy.pid"
fi
for i in $(seq 1 40); do
  if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$REST_PORT/rest/v1/" 2>/dev/null | grep -q '^[234]'; then
    echo "rest: http://127.0.0.1:$REST_PORT (supabase-js: use NEXT_PUBLIC_SUPABASE_URL de $CLONE_ROOT/env.clone)"; exit 0
  fi
  sleep 0.5
done
echo "ERRO: PostgREST não respondeu; veja $CLONE_ROOT/postgrest.log" >&2; exit 1

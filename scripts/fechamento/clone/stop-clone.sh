#!/usr/bin/env bash
# Derruba proxy, PostgREST e Postgres do clone. Idempotente.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
for n in proxy postgrest; do
  if pid_vivo "$RUN_DIR/$n.pid"; then kill "$(cat "$RUN_DIR/$n.pid")" 2>/dev/null; echo "$n parado"; fi
  rm -f "$RUN_DIR/$n.pid"
done
if [ -f "$PGDATA/PG_VERSION" ] && pg_rodando; then "$PGB/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null && echo "postgres parado"; fi
exit 0

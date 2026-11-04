#!/bin/bash
# Sobe um Postgres 16 LOCAL DESCARTÁVEL (TCP, porta 55432), aplica stubs + migration (2×, idempotência) + testes + rollback. Nada toca Supabase.
set -euo pipefail
export LC_ALL=en_US.UTF-8
PGB=${PGB:-/opt/homebrew/opt/postgresql@16/bin}; PSQL=${PSQL:-/opt/homebrew/opt/libpq/bin/psql}
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; D=$(mktemp -d "${TMPDIR:-/tmp}/pgff.XXXXXX")
trap '$PGB/pg_ctl -D $D/data -m fast stop >/dev/null 2>&1 || true; rm -rf $D' EXIT
$PGB/initdb -D $D/data -U postgres -A trust --locale=en_US.UTF-8 >/dev/null
$PGB/pg_ctl -D $D/data -o "-p 55432 -c unix_socket_directories= -c listen_addresses=127.0.0.1" -l $D/log -w start >/dev/null
P="$PSQL -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "create database t" >/dev/null
$P -d t -f "$RAIZ/supabase/tests/escala_fechamento_fisico.stubs.sql" >/dev/null
$P -d t -f "$RAIZ/supabase/migrations/20261110100000_escala_fechamento_fisico.sql" >/dev/null 2>"$D/err.txt" || { grep -v NOTICE "$D/err.txt"; echo "FALHA: migration (1ª aplicação)"; exit 1; }; echo "migration: ok"
$P -d t -f "$RAIZ/supabase/migrations/20261110100000_escala_fechamento_fisico.sql" >/dev/null 2>"$D/err.txt" || { grep -v NOTICE "$D/err.txt"; echo "FALHA: migration (2ª aplicação, idempotência)"; exit 1; }; echo "migration (2ª vez, idempotente): ok"
$P -d t -f "$RAIZ/supabase/tests/escala_fechamento_fisico.test.sql" 2>&1 | grep -E "BENCH|resultado|TESTES|ERROR" | tail -8
$P -d postgres -c "create database t2" >/dev/null
$P -d t2 -f "$RAIZ/supabase/tests/escala_fechamento_fisico.stubs.sql" >/dev/null 2>&1 || true
( cd "$RAIZ" && $P -d t2 -f supabase/migrations/20261110100000_escala_fechamento_fisico.sql >/dev/null 2> >(grep -v NOTICE >&2); cd "$RAIZ" && $P -d t2 -f supabase/tests/escala_fechamento_fisico.seed.test.sql 2>&1 | grep -E "SEED-OK|ERROR" )
$P -d t -f "$RAIZ/supabase/rollbacks/20261110100000_escala_fechamento_fisico_ROLLBACK.sql" >/dev/null 2>"$D/err.txt" || { grep -v NOTICE "$D/err.txt"; echo "FALHA: rollback"; exit 1; }; echo "rollback: ok"
$P -d t -At -c "select 'objetos restantes: '||count(*) from information_schema.tables where table_schema='public' and table_name ~ '^(escala_fechamento|escala_buffer)' and table_name !~ 'arquivo$'"
$P -d t -At -c "select 'arquivados: '||(select count(*) from escala_fechamentos_arquivo)||' fechamentos / '||(select count(*) from escala_fechamento_log_arquivo)||' transições'"

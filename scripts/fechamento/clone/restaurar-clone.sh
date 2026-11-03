#!/usr/bin/env bash
# Recria o clone do ZERO a partir de um pg_dump NOVO de PROD (somente leitura em PROD).
#   ./restaurar-clone.sh            -> dump novo + recria clone
#   ./restaurar-clone.sh --dump F   -> reaproveita o dump F (não toca PROD)
# Senha de PROD: SITTECH_PROD_DB_PASSWORD de /Users/mikaellonghi/Documents/sittech-app/.env.prod-ops.local (nunca impressa).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ENV_PROD=/Users/mikaellonghi/Documents/sittech-app/.env.prod-ops.local
mkdir -p "$CLONE_ROOT/dumps" "$RUN_DIR"; chmod 700 "$CLONE_ROOT"
DUMP=""
[ "${1:-}" = "--dump" ] && DUMP="${2:?arquivo}"

if [ -z "$DUMP" ]; then
  TS="$(date -u +%Y%m%d-%H%M%S)"; DUMP="$CLONE_ROOT/dumps/prod-$TS.sql"
  echo "pg_dump de PROD (schema public, somente leitura)..."
  ( set -a; . "$ENV_PROD"; set +a
    : "${SITTECH_PROD_DB_PASSWORD:?}"
    umask 077
    PGPASSWORD="$SITTECH_PROD_DB_PASSWORD" "$PGDUMP" --host=aws-0-sa-east-1.pooler.supabase.com --port=5432 \
      --username=postgres.qcmottqryawyrghdepel --dbname=postgres --schema=public --no-owner --format=plain \
      --file="$DUMP.tmp" )
  [ -s "$DUMP.tmp" ] || { rm -f "$DUMP.tmp"; echo "ERRO: dump vazio" >&2; exit 1; }
  mv "$DUMP.tmp" "$DUMP"; chmod 600 "$DUMP"
  echo "dump_utc=$TS" >"$CLONE_ROOT/dumps/LATEST_INFO"; echo "dump_file=$DUMP" >>"$CLONE_ROOT/dumps/LATEST_INFO"
  ls -1t "$CLONE_ROOT"/dumps/prod-*.sql | tail -n +4 | xargs -I{} rm -f {}   # mantém 3
fi
[ -s "$DUMP" ] || { echo "dump não encontrado: $DUMP" >&2; exit 1; }

"$(dirname "${BASH_SOURCE[0]}")/stop-clone.sh" >/dev/null
case "$PGDATA" in "$CLONE_ROOT"/pgdata) rm -rf "$PGDATA" ;; *) echo "PGDATA inesperado" >&2; exit 1 ;; esac
"$PGB/initdb" -D "$PGDATA" -U postgres -A trust --locale=en_US.UTF-8 -E UTF8 >/dev/null
"$PGB/pg_ctl" -D "$PGDATA" -l "$CLONE_ROOT/postgres.log" -w \
  -o "-p $PG_PORT -c unix_socket_directories= -c listen_addresses=127.0.0.1" start >/dev/null
lpsql -d postgres -c "CREATE DATABASE $DB_NAME TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8'"
lpsql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$CLONE_DIR/bootstrap.sql" 2>&1 | grep -v NOTICE || true

echo "restaurando dump (PG17 -> PG16: removendo SET transaction_timeout)..."
sed -e '/^SET transaction_timeout/d' "$DUMP" | lpsql -d "$DB_NAME" -v ON_ERROR_STOP=0 -f - >"$CLONE_ROOT/restore.log" 2>&1 || true
NERR=$(grep -c -E "ERROR|FATAL" "$CLONE_ROOT/restore.log" || true)
echo "erros no restore: $NERR (esperado: 1, a FK usuarios_auth_user_id_fkey, tratada abaixo; ver $CLONE_ROOT/restore.log)"

# FK usuarios.auth_user_id -> auth.users falha no restore (auth.users do clone é vazio): cria placeholders e recria a FK idêntica
lpsql -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO auth.users (id, email) SELECT DISTINCT auth_user_id, 'clone-' || auth_user_id || '@clone.invalid' FROM public.usuarios WHERE auth_user_id IS NOT NULL ON CONFLICT DO NOTHING;
ALTER TABLE ONLY public.usuarios DROP CONSTRAINT IF EXISTS usuarios_auth_user_id_fkey;
ALTER TABLE ONLY public.usuarios ADD CONSTRAINT usuarios_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
SQL

# pós-restore: acesso do authenticator e dono do public igual ao Supabase
lpsql -d "$DB_NAME" -c "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, authenticator;"
lpsql -d "$DB_NAME" -c "ANALYZE" >/dev/null

node "$CLONE_DIR/gen-config.js" "$CLONE_ROOT" "$PG_PORT" "$PGRST_PORT" "$REST_PORT"
"$PGB/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null
"$(dirname "${BASH_SOURCE[0]}")/start-clone.sh"
echo "clone pronto."

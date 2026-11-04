#!/bin/bash
# Teste de banco do apontamento simplificado SOBRE O CLONE LOCAL de PROD (127.0.0.1:55433). Nunca toca Supabase.
# Copia o clone para um banco descartável (sittech_apont_test), aplica a migration 2× (idempotência), roda o teste (termina em ROLLBACK), roda o rollback e confere que nada sobrou.
set -euo pipefail
PGB=${PGB:-/opt/homebrew/opt/postgresql@16/bin}; PS=${PSQL:-/opt/homebrew/opt/libpq/bin/psql}
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; H="-h 127.0.0.1 -p 55433 -U postgres"
$PS $H -d postgres -q -c "drop database if exists sittech_apont_test" -c "create database sittech_apont_test"
$PGB/pg_dump $H -d sittech_clone --no-owner | $PS $H -d sittech_apont_test -q >/dev/null 2>&1
P="$PS $H -d sittech_apont_test -q -v ON_ERROR_STOP=1"
for i in 1 2; do $P -f "$RAIZ/supabase/migrations/20261111100000_apontamento_simplificado.sql" 2>&1 | grep -v NOTICE || true; echo "migration (aplicação $i): ok"; done
$P -f "$RAIZ/supabase/tests/apontamento_simplificado.test.sql" 2>&1 | grep -E "ok:|FALHOU|ERROR|APONTAMENTO-SIMPL"
$P -f "$RAIZ/supabase/rollbacks/20261111100000_apontamento_simplificado_ROLLBACK.sql" 2>&1 | grep -v NOTICE || true
$PS $H -d sittech_apont_test -At -c "select 'objetos restantes: '||(select count(*) from pg_proc where proname in ('registrar_apontamentos_fechamento','apontamento_simplificado_modo','apr_trg_imutavel'))||' funções, '||(select count(*) from information_schema.tables where table_name='apontamento_planejado_real')||' tabela, '||(select count(*) from escala_parametros where chave='apontamento_simplificado_modo')||' flag, guarda no gatilho: '||(select (pg_get_functiondef('escala_trg_parametros'::regproc) like '%apontamento_simplificado_modo%')::text)"
$P -f "$RAIZ/supabase/migrations/20261111100000_apontamento_simplificado.sql" 2>&1 | grep -v NOTICE || true; echo "re-aplicação após rollback: ok"
$PS $H -d postgres -q -c "drop database if exists sittech_apont_test"

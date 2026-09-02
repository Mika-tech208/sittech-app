#!/usr/bin/env bash
# Backup manual/periódico do sittech-prod via pg_dump nativo.
#
# Por quê: o projeto está no plano Free do Supabase, que não inclui backup
# automático nenhum (nem diário, nem PITR) — confirmado em Project Settings
# > Billing antes de escrever este script. A restauração pela UI do app foi
# removida de propósito (etapa de storage legado) e o "Gerar backup" que
# restou lá é só exportação de dados pra consulta, não disaster recovery.
# Este script é o mecanismo real de recuperação.
#
# Escopo: só o schema `public` (as 20 tabelas de negócio, RLS, policies,
# functions, GRANTs — tudo que as migrations em supabase/migrations/
# definem) + os dados nelas. NUNCA inclui os schemas `auth`/`storage`
# gerenciados pelo Supabase — não copia auth.users nem hashes de senha
# (mesma regra já seguida na migração de dados DEV -> PROD).
#
# Uso:
#   SITTECH_PROD_DB_PASSWORD="<senha do banco>" ./scripts/backup-prod.sh
#
# Variáveis de ambiente:
#   SITTECH_PROD_DB_PASSWORD   obrigatória — senha do banco PROD. Nunca
#                               fica hardcoded aqui, nunca é impressa/logada
#                               por este script (só fica em memória, na var
#                               PGPASSWORD, que o próprio pg_dump lê).
#   SITTECH_BACKUP_RETENTION   opcional — quantos backups mais recentes
#                               manter (default: 14). Os mais antigos além
#                               desse número são apagados a cada execução.
#
# Ver scripts/BACKUP_RESTORE.md para o procedimento completo de restauração.

set -euo pipefail

PROD_HOST="aws-0-sa-east-1.pooler.supabase.com"
PROD_PORT="5432"
PROD_USER="postgres.qcmottqryawyrghdepel"
PROD_DB="postgres"
RETENTION="${SITTECH_BACKUP_RETENTION:-14}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups/prod"

if [ -z "${SITTECH_PROD_DB_PASSWORD:-}" ]; then
  echo "ERRO: defina SITTECH_PROD_DB_PASSWORD no ambiente antes de rodar este script." >&2
  echo "  Ex.: SITTECH_PROD_DB_PASSWORD=\"...\" ./scripts/backup-prod.sh" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERRO: pg_dump não encontrado no PATH. Instale as ferramentas de linha de comando do Postgres" >&2
  echo "  (ex.: 'brew install libpq' e adicione \$(brew --prefix)/opt/libpq/bin ao PATH)." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
OUTFILE="$BACKUP_DIR/sittech-prod-${TIMESTAMP}.sql"

echo "Gerando backup de sittech-prod (schema public: schema + dados)..."
PGPASSWORD="$SITTECH_PROD_DB_PASSWORD" pg_dump \
  --host="$PROD_HOST" \
  --port="$PROD_PORT" \
  --username="$PROD_USER" \
  --dbname="$PROD_DB" \
  --schema=public \
  --no-owner \
  --format=plain \
  --file="$OUTFILE"

if [ ! -s "$OUTFILE" ]; then
  echo "ERRO: o arquivo de backup foi gerado vazio — algo deu errado. Removendo." >&2
  rm -f "$OUTFILE"
  exit 1
fi

SIZE="$(du -h "$OUTFILE" | cut -f1 | tr -d ' ')"
echo "Backup criado: $OUTFILE ($SIZE)"

echo "Aplicando retenção (mantendo os $RETENTION mais recentes)..."
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/sittech-prod-*.sql 2>/dev/null | tail -n "+$((RETENTION + 1))" | while IFS= read -r old; do
  echo "  removendo backup antigo: $(basename "$old")"
  rm -f "$old"
done

echo "Concluído."

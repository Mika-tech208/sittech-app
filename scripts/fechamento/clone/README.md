# Clone local de PROD (Sittech)

Postgres 16.15 (127.0.0.1:55433, db `sittech_clone`) + PostgREST 16.5 (127.0.0.1:3301) + proxy Node (127.0.0.1:3300, remove `/rest/v1` para o supabase-js). Dados em `/Users/mikaellonghi/Documents/sittech-clone/` (fora do repo; chaves só em `env.clone`, chmod 600).

- `restaurar-clone.sh` : pg_dump NOVO de PROD (somente leitura, schema public) e recria o clone do zero. `--dump ARQ` reaproveita um dump (não toca PROD). Mantém os 3 dumps mais recentes. Segredos de JWT são gerados só na 1a vez.
- `start-clone.sh` / `stop-clone.sh` : sobem/derrubam tudo (idempotentes).
- `smoke-test.cjs` : `node smoke-test.cjs` valida supabase-js (service_role) contra o clone.
- Uso no app: `set -a; source /Users/mikaellonghi/Documents/sittech-clone/env.clone; set +a`.

## Ajustes feitos no restore (dump PG17/pg_dump 18 -> PG16)
1. `SET transaction_timeout` (só PG17+) removido via sed ao restaurar.
2. Bootstrap (`bootstrap.sql`): roles anon/authenticated/service_role(BYPASSRLS)/authenticator/supabase_admin; schema `extensions` com pgcrypto e uuid-ossp; schema `auth` com `auth.users` mínima e `auth.uid()/jwt()/role()` lendo `request.jwt.claims`; `DROP SCHEMA public` do template (o dump faz CREATE SCHEMA).
3. FK `usuarios.auth_user_id -> auth.users` falha na carga (auth.users vazio): o script cria linhas placeholder (`clone-<uuid>@clone.invalid`) e recria a FK idêntica. Único ERROR esperado no `restore.log`.
4. Sem stubs de `vault`/`net`/`cron`: o restore não precisou. `escala_agendador_chamar` (usa vault + net.http_post) falharia em runtime no clone, o que é desejável (nada sai do clone).
5. Auth do Postgres local é `trust`, só em 127.0.0.1. Não há GoTrue: `/auth/v1` não existe; só REST (`/rest/v1`). O `anon` não tem acesso às tabelas (igual PROD).

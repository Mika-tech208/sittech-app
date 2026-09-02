# Backup e restauração do sittech-prod

O projeto `sittech-prod` está no plano **Free** do Supabase, que não inclui
nenhum backup automático (nem diário, nem PITR — confirmado em Project
Settings > Billing). O botão "Gerar backup" dentro do app é só uma
exportação pra consulta, não serve como disaster recovery (não inclui
`usuarios`/`auditoria`, e não tem restauração de volta). Este documento é o
procedimento real.

## 1. Como gerar um backup manual

```bash
SITTECH_PROD_DB_PASSWORD="<senha do banco, do dashboard do Supabase>" \
  ./scripts/backup-prod.sh
```

Requer `pg_dump` instalado (`brew install libpq`, ver comentário no topo do
script). A senha nunca é impressa nem gravada em nenhum arquivo — só passa
em memória pro `pg_dump` via a variável `PGPASSWORD`.

Roda em segundos (o volume de dados atual é pequeno). Ao final, imprime o
caminho e o tamanho do arquivo gerado.

## 2. Onde o backup fica

`backups/prod/sittech-prod-<AAAAMMDD-HHMMSS>.sql` (horário UTC), um arquivo
novo por execução — nunca sobrescreve o anterior. A pasta `backups/` está
no `.gitignore`: nunca é commitada (contém dados reais de negócio).

O script mantém só os **14 mais recentes** por padrão a cada execução
(ajustável via `SITTECH_BACKUP_RETENTION`), apagando os mais antigos.

**Importante — isso ainda mora só nesta máquina.** Pra virar disaster
recovery de verdade (sobreviver a perda/roubo/pane deste notebook), copie
periodicamente a pasta `backups/prod/` pra outro lugar: iCloud/Google
Drive, um HD externo, ou (melhor, quando fizer sentido configurar) um
bucket S3/Storage separado. Isso não foi automatizado nesta etapa — ver
seção 6.

## 3. Como restaurar em um banco vazio/de teste

**Nunca restaure direto no sittech-prod ou sittech-dev "pra testar".** Use
sempre um projeto Supabase novo (vazio) ou um Postgres local/temporário.

```bash
psql "postgresql://postgres.<ref-do-projeto-vazio>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres" \
  -f backups/prod/sittech-prod-<timestamp>.sql
```

O dump já recria sozinho tudo que estava no schema `public` no momento do
backup — tabelas, RLS, policies, functions, GRANTs e os dados — não
precisa rodar as migrations antes nesse projeto vazio. (Se preferir manter
a disciplina de aplicar as migrations versionadas primeiro por rastreabilidade,
dá pra fazer isso e restaurar só os dados depois, mas exige gerar um dump
`--data-only` à parte — não é o modo padrão deste script.)

## 4. Como verificar integridade

Sem precisar restaurar em lugar nenhum:

```bash
# arquivo não está vazio e tem tamanho plausível
ls -lh backups/prod/sittech-prod-<timestamp>.sql

# contém as tabelas esperadas (deve listar as 20)
grep -c "^CREATE TABLE" backups/prod/sittech-prod-<timestamp>.sql

# contém dados (não só schema vazio)
grep -c "^COPY public\." backups/prod/sittech-prod-<timestamp>.sql

# não contém nada de auth.users/senha (validação de escopo)
grep -i "auth\.users\|senha" backups/prod/sittech-prod-<timestamp>.sql
# (deve retornar vazio ou nada relevante)
```

Depois de um restore real de teste (seção 3), comparar contagem de linhas
por tabela contra o PROD original é a validação mais forte.

## 5. Em caso de perda do PROD

1. Confirme com o Supabase (suporte/dashboard) se o projeto realmente foi
   perdido ou só está com algum problema temporário — não recrie à toa.
2. Se precisar recriar do zero: crie um novo projeto Supabase (mesma
   região, South America - São Paulo, pra manter a latência) — mesmo
   processo já documentado da criação do sittech-prod original.
3. Restaure o backup mais recente nele (seção 3) — isso já traz schema +
   RLS + dados junto.
4. Se o backup mais recente for de mais de um dia atrás, avalie o quanto
   de dado real foi perdido no intervalo (o app não tem replicação
   contínua nesse plano — é a limitação real do Free tier).
5. Gere novas chaves de API (`anon`/`service_role`) do projeto novo e
   atualize as env vars da Vercel (Production) e o `.env.local` de
   desenvolvimento — nunca reaproveitar chaves de um projeto antigo.
6. Se o `auth.users` também precisar ser reconstruído (usuários reais),
   siga o mesmo processo já usado pra criar o admin do PROD (Admin API do
   Supabase Auth) — este backup não cobre isso de propósito.

## 6. O que falta para automatizar

Este script hoje só roda manualmente. Pra virar um backup diário de
verdade sem depender de alguém lembrar de rodar, falta:

- Um agendador (cron local — só funciona se o Mac estiver ligado no
  horário —, ou um serviço externo tipo GitHub Actions com schedule,
  ou uma cloud function). Nenhum desses foi configurado ainda porque
  exigiria uma conta/serviço externo (ex.: um repositório com Actions
  habilitado e a senha do banco como secret) que não estava configurado
  até agora — decisão de propósito pra não criar infraestrutura nova
  sem confirmação.
- Um destino de armazenamento fora desta máquina (S3, Google Drive via
  rclone, etc.) — ver nota na seção 2.

Recomendação pra próxima etapa, quando fizer sentido: GitHub Actions com
um `schedule` diário, rodando este mesmo script, com
`SITTECH_PROD_DB_PASSWORD` como GitHub Secret, subindo o `.sql` gerado
pra um artifact do Actions ou pra um bucket S3.

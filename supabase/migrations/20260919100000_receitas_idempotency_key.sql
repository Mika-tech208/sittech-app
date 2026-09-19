-- Sittech — schema PostgreSQL, migration 35
-- Faturamento Mensal — proteção de backend contra lançamento duplicado de
-- receita. Causa raiz encontrada (revisão de integridade de gravação,
-- 2026-09-19): salvarReceita() fazia um INSERT puro em `receitas`, sem
-- nenhuma constraint de unicidade e sem nenhuma trava de "salvando" no
-- formulário (SittechApp.tsx) — clique duplo, Enter repetido em mais de um
-- campo, ou os dois juntos, cada um disparava um INSERT independente. A
-- trava de UI (Camada 1) já corrige o disparo duplo a partir de uma única
-- interação do usuário; esta migration é a Camada 2 (backend), protegendo
-- também contra retry de rede (POST reenviado pelo navegador/proxy depois
-- de uma conexão instável, já com a primeira gravação tendo sido bem-
-- sucedida no servidor).
--
-- Por que não um UNIQUE simples (ex.: faturamento_id+data+valor): dois
-- lançamentos legítimos PODEM ter exatamente o mesmo valor no mesmo dia
-- (duas notas fiscais de valores iguais) — uma constraint assim bloquearia
-- uma gravação real, não só duplicidade acidental. Sem chave de negócio
-- natural confiável, a proteção é por idempotency_key: um identificador
-- gerado no FRONTEND uma única vez por TENTATIVA de lançamento (ao abrir o
-- formulário — não a cada clique), reenviado igual em qualquer reclique/
-- retry daquela mesma tentativa. Mesmo padrão já usado e comprovado em
-- Produção Real (apontamentos_producao.idempotency_key, migration 9).
--
-- Nullable de propósito: linhas já existentes não têm identidade de
-- tentativa nenhuma pra preencher sem inventar — ficam com
-- idempotency_key NULL (não colide com o UNIQUE, Postgres trata múltiplos
-- NULL como não-iguais). Daqui pra frente, todo INSERT novo do formulário
-- já manda o valor.

alter table public.receitas
  add column idempotency_key uuid;

alter table public.receitas
  add constraint receitas_idempotency_key_key unique (idempotency_key);

comment on column public.receitas.idempotency_key is
  'Identificador gerado no frontend uma vez por tentativa de lançamento (não a cada clique) — reenviado igual em reclique/retry da mesma tentativa, usado via upsert(onConflict) pra nunca duplicar a receita. NULL em linhas anteriores a esta migration (não retroagido).';

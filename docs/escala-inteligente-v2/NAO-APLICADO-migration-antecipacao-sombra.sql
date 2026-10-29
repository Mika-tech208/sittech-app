-- PROPOSTA — NÃO APLICAR (fora de supabase/migrations de propósito). Registro APPEND-ONLY do modo sombra da antecipação.
-- Desenho: reaproveita o padrão de escala_fluxo_diagnosticos (append-only por trigger). No modo sombra o motor ativo continua decidindo; a nova lógica calcula EM PARALELO
-- o plano alternativo e grava aqui, SEM alterar a Escala: resultado atual, resultado futuro (separados), WIP final/de abertura, churn, pessoas sem posto e diferenças.
create table if not exists public.escala_antecipacao_sombra (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  previsao_id uuid not null,
  semana_inicio date not null,
  criado_em timestamptz not null default now(),
  gatilho text not null check (gatilho in ('fechamento', 'evento', 'manual', 'replay')),
  corte_data date, corte_periodo_id text,
  hash_entrada text not null,
  hash_plano_base text not null,            -- plano que o motor ativo gravou
  hash_plano_sombra text not null,          -- plano alternativo calculado em paralelo
  demanda_futura jsonb not null default '{}'::jsonb,   -- por produto: fonte, quantidade, confiança (hierarquia Previsão › pedido › histórico › configuração)
  teto jsonb not null default '{}'::jsonb,             -- por par: demanda, WIP base, capacidade destino, gargalo, teto, limitado_por
  valor_atual jsonb not null default '{}'::jsonb,      -- R$ da semana atual (base × sombra), limiar de materialidade
  valor_futuro jsonb not null default '{}'::jsonb,     -- R$ esperado da próxima semana (NUNCA somado ao atual)
  robusto jsonb not null default '{}'::jsonb,          -- cenário B (M8 pessimista, demanda baixa=0, WIP não confirmado=0) e C (sem M8)
  wip_final jsonb not null default '{}'::jsonb,
  wip_abertura jsonb not null default '[]'::jsonb,     -- produto, rota, etapa, quantidade, confiança, origem, última confirmação, idade, sinal
  pessoas_sem_posto jsonb not null default '[]'::jsonb,-- exceções auditáveis (motivo)
  opcoes_por_linha_livre jsonb not null default '[]'::jsonb,
  churn jsonb not null default '{}'::jsonb,
  violacoes jsonb not null default '[]'::jsonb,
  confianca jsonb not null default '{}'::jsonb,        -- BAIXA_CONFIANCA_PRODUTIVIDADE (posto), demanda, WIP
  versao_motor text not null,
  constraint uq_escala_antecipacao_sombra unique (previsao_id, gatilho, hash_entrada, hash_plano_sombra)
);
create index if not exists idx_escala_antecipacao_sombra_prev on public.escala_antecipacao_sombra (previsao_id, criado_em desc);
-- append-only: reutilizar public.escala_fluxo_trg_imutavel() (update/delete/truncate bloqueados) e RLS de leitura = admin/usuários da Escala; escrita só pelo worker (service_role).
-- Testes previstos: (1) UPDATE/DELETE falham; (2) duas inserções com mesmo hash são idempotentes; (3) modo off não escreve; (4) sombra não altera escala_producao_alocacoes (hash antes = depois).

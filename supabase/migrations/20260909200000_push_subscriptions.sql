-- Sittech — Notificações Push V1: tabelas de subscription e de idempotência
-- de envio. NÃO inclui o trigger que dispara o push (fica em migration
-- separada, condicionada à confirmação de que a extensão pg_net está
-- disponível no projeto — ver relatório da etapa de arquitetura). Esta
-- migration só prepara a estrutura de dados; nenhuma tabela/RPC existente
-- é alterada (abrir_ocorrencia_maquina permanece intocada).

-- =========================================================================
-- 1) push_subscriptions — uma linha por dispositivo/navegador inscrito.
--    Um usuário pode ter várias (multi-dispositivo). `endpoint` é a chave
--    natural de um PushSubscription (única por navegador+site) — UNIQUE
--    global (não por usuário) é o que impede o mesmo endpoint ficar
--    associado a dois usuários diferentes ao mesmo tempo: um re-subscribe
--    do MESMO dono vira upsert (permitido pela policy de update, abaixo,
--    porque `usuario_id` da linha existente já é o dele); um endpoint que
--    hoje pertence a outro usuário simplesmente não passa pela policy de
--    update (bloqueado por RLS) — sem RPC extra pra isso, é o único CHECK
--    de unicidade + as duas policies abaixo que já resolvem o requisito.
-- =========================================================================
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  criado_em timestamptz not null default now(),
  ultimo_uso_em timestamptz
);

create index idx_push_subscriptions_usuario on public.push_subscriptions(usuario_id);

alter table public.push_subscriptions enable row level security;

-- Usuário só enxerga/gerencia as PRÓPRIAS subscriptions. Sem policy pra
-- anon (negado por padrão). Sem policy separada de admin/full-table: quem
-- processa envios usa o service_role (bypassa RLS), nunca o browser.
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using (usuario_id = (select id from public.usuarios where auth_user_id = auth.uid()));

create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated
  with check (usuario_id = (select id from public.usuarios where auth_user_id = auth.uid()));

-- Update só serve pra permitir o upsert-por-endpoint (renovar p256dh/auth/
-- ultimo_uso_em) quando o endpoint já é do próprio usuário. Como a policy
-- usa `usuario_id = self` tanto pra USING quanto WITH CHECK, um upsert
-- tentando "roubar" um endpoint de outro usuário não encontra a linha sob
-- RLS e falha — não reatribui silenciosamente.
create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using (usuario_id = (select id from public.usuarios where auth_user_id = auth.uid()))
  with check (usuario_id = (select id from public.usuarios where auth_user_id = auth.uid()));

create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (usuario_id = (select id from public.usuarios where auth_user_id = auth.uid()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- service_role já ignora RLS por padrão no Supabase — este grant explícito
-- não muda o que ele já consegue fazer, só deixa o privilégio declarado em
-- vez de implícito, pra quem processa envios (endpoint server-side).
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- =========================================================================
-- 2) push_notificacoes_ocorrencia — registro de idempotência/estado por
--    par (ocorrência, subscription). Nunca acessada pelo browser (sem
--    grant pra authenticated/anon) — só o endpoint server-side, com
--    service_role, lê/escreve aqui.
--
--    Estados: 'processando' (reivindicado, envio em curso — estado inicial,
--    NUNCA 'enviado' antes da confirmação real do provider), 'enviado'
--    (sucesso confirmado — terminal), 'falha_transitoria' (erro de rede/5xx/
--    timeout — pode ser reprocessado), 'subscription_invalida' (provider
--    respondeu 404/410 — terminal, a subscription já foi removida de
--    push_subscriptions junto).
-- =========================================================================
create table public.push_notificacoes_ocorrencia (
  ocorrencia_id uuid not null references public.ocorrencias_maquina(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null check (status in ('processando', 'enviado', 'falha_transitoria', 'subscription_invalida')),
  tentativas integer not null default 1,
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (ocorrencia_id, subscription_id)
);

alter table public.push_notificacoes_ocorrencia enable row level security;
-- Nenhuma policy criada de propósito: RLS habilitada + zero policies =
-- acesso negado por padrão pra `authenticated`/`anon`. Só service_role
-- (que ignora RLS) processa esta tabela.

revoke all on public.push_notificacoes_ocorrencia from public, anon, authenticated;

-- Idem: explícito pro service_role, que é quem de fato lê/escreve aqui.
grant select, insert, update, delete on public.push_notificacoes_ocorrencia to service_role;

-- =========================================================================
-- 3) reivindicar_notificacao_ocorrencia — reivindicação atômica de um par
--    (ocorrência, subscription) antes de tentar o envio. Só o endpoint
--    server-side chama isto (via service_role, que já ignora RLS — não é
--    security definer por necessidade de privilégio, só concentra a lógica
--    de "posso enviar agora?" num lugar único e atômico, evitando duas
--    execuções concorrentes do endpoint mandarem duas notificações pro
--    mesmo par).
--
--    Retorna true (reivindicado, pode enviar) quando: não existe linha
--    ainda: OU existe com status 'falha_transitoria' (retry legítimo); OU
--    existe 'processando' há mais tempo que p_processando_stale_antes
--    (execução anterior morreu no meio, nunca atualizou o status).
--    Retorna null (não reivindicado, não envia de novo) quando já existe
--    'enviado' ou 'processando' recente — é isso que impede duplicidade.
-- =========================================================================
create or replace function public.reivindicar_notificacao_ocorrencia(
  p_ocorrencia_id uuid,
  p_subscription_id uuid,
  p_processando_stale_antes timestamptz
)
returns boolean
language sql
as $$
  insert into public.push_notificacoes_ocorrencia (ocorrencia_id, subscription_id, status, tentativas)
  values (p_ocorrencia_id, p_subscription_id, 'processando', 1)
  on conflict (ocorrencia_id, subscription_id) do update
    set status = 'processando',
        tentativas = public.push_notificacoes_ocorrencia.tentativas + 1,
        atualizado_em = now()
    where public.push_notificacoes_ocorrencia.status = 'falha_transitoria'
       or (public.push_notificacoes_ocorrencia.status = 'processando'
           and public.push_notificacoes_ocorrencia.atualizado_em < p_processando_stale_antes)
  returning true;
$$;

revoke all on function public.reivindicar_notificacao_ocorrencia(uuid, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.reivindicar_notificacao_ocorrencia(uuid, uuid, timestamptz) to service_role;

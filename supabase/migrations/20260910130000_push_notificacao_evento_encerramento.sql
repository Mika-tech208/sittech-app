-- Sittech — Notificações Push V1: suporte ao evento "ocorrência encerrada"
-- (além de "ocorrência aberta", já existente). Mesma tabela, mesma função
-- de reivindicação, mesmo endpoint — só passam a diferenciar POR EVENTO,
-- não só por (ocorrência, subscription). Sem isso, a notificação de
-- encerramento seria bloqueada pela reivindicação já feita na abertura
-- (mesmo par ocorrência+subscription, dois eventos diferentes).
--
-- Não toca em abrir_ocorrencia_maquina/encerrar_ocorrencia_maquina, RLS,
-- policies, nem push_subscriptions. Nenhum trigger/pg_net/Vault envolvido.

-- =========================================================================
-- 1) push_notificacoes_ocorrencia — chave passa a incluir o evento.
-- =========================================================================
alter table public.push_notificacoes_ocorrencia
  add column evento text not null default 'aberta' check (evento in ('aberta', 'encerrada'));

alter table public.push_notificacoes_ocorrencia
  drop constraint push_notificacoes_ocorrencia_pkey;

alter table public.push_notificacoes_ocorrencia
  add primary key (ocorrencia_id, subscription_id, evento);

-- Só serviu pra preencher as linhas já existentes (todas eram do evento
-- "aberta", único que existia até agora) — daqui pra frente o endpoint
-- sempre informa o evento explicitamente.
alter table public.push_notificacoes_ocorrencia alter column evento drop default;

-- =========================================================================
-- 2) reivindicar_notificacao_ocorrencia — assinatura muda (ganha
--    p_evento), então é uma função NOVA pro Postgres (parâmetros
--    diferentes = identidade diferente) — precisa dropar a versão antiga
--    explicitamente, senão as duas ficariam coexistindo (overload morto).
-- =========================================================================
drop function if exists public.reivindicar_notificacao_ocorrencia(uuid, uuid, timestamptz);

create or replace function public.reivindicar_notificacao_ocorrencia(
  p_ocorrencia_id uuid,
  p_subscription_id uuid,
  p_evento text,
  p_processando_stale_antes timestamptz
)
returns boolean
language sql
as $$
  insert into public.push_notificacoes_ocorrencia (ocorrencia_id, subscription_id, evento, status, tentativas)
  values (p_ocorrencia_id, p_subscription_id, p_evento, 'processando', 1)
  on conflict (ocorrencia_id, subscription_id, evento) do update
    set status = 'processando',
        tentativas = public.push_notificacoes_ocorrencia.tentativas + 1,
        atualizado_em = now()
    where public.push_notificacoes_ocorrencia.status = 'falha_transitoria'
       or (public.push_notificacoes_ocorrencia.status = 'processando'
           and public.push_notificacoes_ocorrencia.atualizado_em < p_processando_stale_antes)
  returning true;
$$;

revoke all on function public.reivindicar_notificacao_ocorrencia(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.reivindicar_notificacao_ocorrencia(uuid, uuid, text, timestamptz) to service_role;

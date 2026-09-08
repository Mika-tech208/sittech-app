-- Sittech Intelligence V1 — auditoria mínima (§24 da instrução).
--
-- Por que uma tabela NOVA em vez de reaproveitar `public.auditoria`
-- (migration inicial, linha 377): inspecionada antes desta decisão.
-- `auditoria` tem só 3 colunas de texto solto (quem, acao,
-- usuario_afetado) — desenhada para o caso de uso de administração de
-- usuários (useAuthSession.registrarAuditoria: "criou usuário X",
-- "alterou permissão de Y"). Intelligence precisa de campos
-- estruturados (tools chamadas + parâmetros resolvidos, tokens de
-- entrada/saída, modelo, sucesso/erro por tool) que não cabem em
-- `acao: text` sem quebrar a semântica já estabelecida daquela tabela
-- (um texto curto e legível, não um JSON de auditoria técnica) nem
-- exigir várias colunas novas ali que só fariam sentido pra Intelligence.
-- Reaproveitar teria poluído uma tabela pequena e já usada há dias.
-- Criar uma tabela dedicada, pequena, no mesmo padrão de RLS/GRANT já
-- usado por `auditoria` (append-only: só SELECT admin + INSERT usuário
-- ativo, sem UPDATE/DELETE) é a opção mais simples e mais segura.
--
-- Nunca registrado aqui: API key, service_role, tokens de sessão, payload
-- bruto das tools (só os parâmetros já resolvidos — que são, por
-- desenho, os mesmos IDs/janelas das evidências, não dado extra), texto
-- completo do system prompt.

create table public.intelligence_audit_log (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  usuario_id uuid not null references public.usuarios(id) on delete restrict,
  pergunta text not null,
  tools_chamadas jsonb not null default '[]'::jsonb, -- [{tool, params, sucesso}], nunca o payload bruto de resposta da tool.
  modelo text not null,
  tokens_entrada integer,
  tokens_saida integer,
  custo_estimado_centavos integer, -- null quando o preço do modelo não está configurado (nunca inventa um valor).
  resposta_final text,
  erro text
);

create index idx_intelligence_audit_log_usuario on public.intelligence_audit_log(usuario_id);
create index idx_intelligence_audit_log_criado_em on public.intelligence_audit_log(criado_em);

alter table public.intelligence_audit_log enable row level security;

-- Mesmo padrão de `auditoria`: só admin lê, só usuário ativo insere,
-- ninguém edita/apaga (append-only).
create policy intelligence_audit_log_select_admin_only on public.intelligence_audit_log
  for select to authenticated
  using (public.is_admin());

create policy intelligence_audit_log_insert_usuario_ativo on public.intelligence_audit_log
  for insert to authenticated
  with check (public.is_usuario_ativo() and usuario_id = (select id from public.usuarios where auth_user_id = auth.uid()));

grant select, insert on public.intelligence_audit_log to authenticated;

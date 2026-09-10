-- Sittech — Notificações Push V1: grants de leitura para o endpoint de envio
-- (src/app/api/push/notify-ocorrencia/route.ts) montar o título/corpo da
-- notificação. O endpoint usa o cliente service_role (criarClienteAdmin())
-- pra buscar `ocorrencias_maquina.descricao/aberta_em` + o nome da máquina
-- e do motivo, via:
--
--   .from("ocorrencias_maquina")
--   .select("id, descricao, aberta_em, maquinas(nome), motivos_parada(nome)")
--
-- Descoberto ao testar manualmente: neste projeto, service_role NÃO tem
-- grant implícito nenhum (confirmado também em migrations anteriores, ex.
-- push_subscriptions/push_notificacoes_ocorrencia já precisaram de grant
-- explícito) — cada tabela grants o que precisa, nada a mais. Sem isso, a
-- própria leitura que o endpoint faz falha com 42501 (permission denied).
--
-- Só SELECT, só nessas 3 tabelas, só pra service_role — nenhum outro
-- privilégio, nenhuma outra role, nenhuma alteração de RLS/policy
-- existente (essas 3 tabelas continuam com suas policies de
-- `authenticated` de sempre, intocadas).

grant select on public.ocorrencias_maquina to service_role;
grant select on public.maquinas to service_role;
grant select on public.motivos_parada to service_role;

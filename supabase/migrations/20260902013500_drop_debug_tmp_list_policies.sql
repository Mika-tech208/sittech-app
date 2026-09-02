-- Reverte a migration de diagnóstico anterior (20260902013000) — função
-- temporária só usada pra investigar um falso alarme de RLS durante os
-- testes da etapa "Usuários + Auditoria" (ver commit message/relatório).
drop function if exists public.debug_tmp_list_policies(text);

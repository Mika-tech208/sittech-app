-- Sittech — Escala de Produção: leitura mínima para o processador server-side.
--
-- Este projeto NÃO concede privilégios amplos ao service_role (menor
-- privilégio, ver migrations de grants/push). O processador da Escala
-- (src/lib/escala/supabaseIO.ts, rodando no servidor) precisa LER o estado
-- da Previsão e dos cadastros para recalcular — só SELECT, nada de escrita
-- nestas tabelas (as escritas da Escala vão só nas tabelas escala_* e por RPC).

grant select on public.previsoes to service_role;
grant select on public.previsao_dias_produtivos to service_role;
grant select on public.previsao_equipe_semana to service_role;
grant select on public.previsao_itens to service_role;
grant select on public.previsao_item_maquinas to service_role;
grant select on public.previsao_maquinas_indisponiveis to service_role;
grant select on public.funcionarios to service_role;
grant select on public.roteiro_etapas to service_role;
grant select on public.maquinas to service_role;
grant select on public.periodos to service_role;
grant select on public.operacoes to service_role;
grant select on public.ausencias_funcionarios to service_role;

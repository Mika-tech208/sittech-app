-- ATIVA o produto único a partir de uma segunda-feira. Executar como service_role/postgres, UMA vez, ANTES de qualquer trabalho da semana do cutover.
--   psql ... -v cutover=2026-11-09 -f 20-ativar-cutover.sql
-- Recusa (sem alterar nada) se já houver apontamento legado / fechamento na semana, cadastro com problema, ou outro cutover ligado. Idempotente para o mesmo cutover.
-- NÃO soma itens da Previsão (isso é o botão "Unificar em Conector 3/4" ou a criação do item único pela supervisora) e NÃO dispara recálculo.
-- par da M8 no catálogo de buffers: padrão false (3 pares, o que a guarda do fechamento exige). Para 4 pares: -v par_m8=true
\if :{?par_m8}\else \set par_m8 false \endif
select jsonb_pretty(public.produto_unico_ativar(:'cutover'::date, 'ops 20-ativar-cutover', :par_m8));

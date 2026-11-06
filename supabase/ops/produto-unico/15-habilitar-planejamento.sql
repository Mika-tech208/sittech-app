-- HABILITA O PLANEJAMENTO do produto único a partir de uma segunda-feira (FASE 1 da virada). Executar como service_role/postgres, UMA vez.
--   psql ... -v desde=2026-11-09 -f 15-habilitar-planejamento.sql
-- Efeito: o produto único fica selecionável no Forecast/Previsão e o motor novo gera o plano das semanas >= desde. O plano dessas semanas é FUTURO e NÃO LIBERADO
--   (escala_periodo_liberacao = PLANO_FUTURO_AGUARDANDO_CUTOVER): nada operacional muda (apontamento, fechamento, buffers, pares, WIP oficial, TV). A semana `desde` entra em
--   producao_real_semanas_ativas e producao_real_planejador_semanas (idempotente) SEM recálculo e SEM nova versão de plano. Recusa (sem alterar nada) se já houver apontamento legado / fechamento em/depois de `desde`.
-- Reversão: select public.produto_unico_desabilitar_planejamento();  (recusa se a Previsão ainda tiver o item único; use "Separar" antes)
select jsonb_pretty(public.produto_unico_habilitar_planejamento(:'desde'::date, 'ops 15-habilitar-planejamento'));

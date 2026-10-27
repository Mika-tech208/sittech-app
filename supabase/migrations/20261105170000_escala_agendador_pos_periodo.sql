-- Sittech — Agendador SERVER-SIDE PÓS-FECHAMENTO da Escala (pg_cron + pg_net).
--
-- Problema: os 12 jobs `escala-pre-periodo-*` rodam 5 e 2 min ANTES do início de cada período; nenhum roda DEPOIS do fim. A regra de fechamento
-- (src/features/escala/fechamento.ts) fecha o período entre fim+10 e fim+20 min, mas o processamento do fechamento (modo sombra / replanejamento
-- restrito) só acontecia quando algum evento de usuário chegava (mediana 27 min depois; 88/71/194 min nos piores casos de 26–27/10).
--
-- Solução: três chamadas por período, em fim+11, fim+14 e fim+18 min (dentro da janela de fechamento, em instantes diferentes para sobreviver a
-- uma chamada perdida). Cada uma chama a MESMA função do agendador já existente, `public.escala_agendador_chamar('pg_cron')`
-- (URL + token do Vault; sem configuração no Vault = não faz nada), e a rota /api/escala/drenar é IDEMPOTENTE: fecha atrasos vencidos, revalida
-- disponibilidade, drena a outbox e processa o fechamento (sombra). Sem pendência = nada acontece.
--
-- Períodos reais (tabela `periodos`; America/Sao_Paulo = UTC−3, sem horário de verão; pg_cron roda em UTC), seg–sáb:
--   período   fim (SP)   +11 (SP→UTC)    +14 (SP→UTC)    +18 (SP→UTC)
--   M1        08:48      08:59 → 11:59   09:02 → 12:02   09:06 → 12:06
--   M2        10:24      10:35 → 13:35   10:38 → 13:38   10:42 → 13:42
--   M3        11:55      12:06 → 15:06   12:09 → 15:09   12:13 → 15:13
--   T1        14:20      14:31 → 17:31   14:34 → 17:34   14:38 → 17:38
--   T2        15:40      15:51 → 18:51   15:54 → 18:54   15:58 → 18:58
--   T3        17:00      17:11 → 20:11   17:14 → 20:14   17:18 → 20:18
-- O sufixo HHMM do nome é o horário de São Paulo (mesma convenção dos jobs `escala-pre-periodo-HHMM`).
--
-- Idempotente: o nome identifica o job; se já existir é removido (cron.unschedule) antes de agendar de novo. NENHUM job anterior é alterado.
--
-- REVERSÃO (remove só os 18 jobs novos; os 15 anteriores permanecem):
--   select cron.unschedule(jobname) from cron.job where jobname like 'escala-pos-periodo-%';

create extension if not exists pg_cron;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- (HHMM em SP, "minuto hora" em UTC)
      ('0859', '59 11'), ('0902', '2 12'),  ('0906', '6 12'),   -- M1
      ('1035', '35 13'), ('1038', '38 13'), ('1042', '42 13'),  -- M2
      ('1206', '6 15'),  ('1209', '9 15'),  ('1213', '13 15'),  -- M3
      ('1431', '31 17'), ('1434', '34 17'), ('1438', '38 17'),  -- T1
      ('1551', '51 18'), ('1554', '54 18'), ('1558', '58 18'),  -- T2
      ('1711', '11 20'), ('1714', '14 20'), ('1718', '18 20')   -- T3
    ) as t(hhmm, minuto_hora)
  loop
    if exists (select 1 from cron.job where jobname = 'escala-pos-periodo-' || r.hhmm) then
      perform cron.unschedule('escala-pos-periodo-' || r.hhmm);
    end if;
    perform cron.schedule('escala-pos-periodo-' || r.hhmm, r.minuto_hora || ' * * 1-6', 'select public.escala_agendador_chamar(''pg_cron'')');
  end loop;
end $$;

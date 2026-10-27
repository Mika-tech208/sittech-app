-- Sittech — BLOQUEADOR 2: RECONCILIAÇÃO DE FUNCIONÁRIOS (proteção equivalente à das máquinas).
--
-- Fontes da verdade (NENHUMA tabela nova, nenhum espelho): ausencias_funcionarios (falta, atraso em aberto, ausência parcial, saída antecipada),
-- funcionarios.ativo e previsao_equipe_semana.produtivo — exatamente o que o motor lê. escala_divergencias_funcionarios() compara essas fontes com a Escala
-- GRAVADA, só nos períodos FUTUROS (início > agora; os que já começaram são imutáveis), com a MESMA semântica do motor:
--   * janela da ausência: dia inteiro (horário NULL); [início, fim) do horário; atraso EM ABERTO = [início, fim da jornada do dia);
--   * ausência afeta o período se houver SOBREPOSIÇÃO de [início, fim) (ex.: M2 08:48–10:24 x ausência 09:10–09:30 => afetado);
--   * equipe do motor = previsao_equipe_semana.produtivo E funcionarios.ativo.
-- Tipos de divergência:
--   alocado_ausente | alocado_inativo | alocado_fora_equipe  -> há linha para quem NÃO pode trabalhar naquele período futuro
--   disponivel_sem_linha                                     -> quem pode trabalhar (retorno de ausência/atraso, volta à equipe) está sem linha: o plano está desatualizado
-- Somente leitura e idempotente. Quem decide registrar/reutilizar o evento de replanejamento é o servidor (revalidarDisponibilidade.ts).

create or replace function public.escala_divergencias_funcionarios(p_agora timestamptz default now())
returns table (previsao_id uuid, data date, periodo_id text, funcionario_id uuid, tipo text, causa_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with per as (
    select d.previsao_id, d.data, p.x->>'id' as periodo_id, (p.x->>'inicio')::time as ini, (p.x->>'fim')::time as fim,
           (select max((q->>'fim')::time) from jsonb_array_elements(d.periodos_snapshot) q) as fim_jornada
    from public.escala_producao_dias d
    cross join lateral jsonb_array_elements(d.periodos_snapshot) p(x)
    where ((d.data + (p.x->>'inicio')::time) at time zone 'America/Sao_Paulo') > p_agora
  ),
  equipe as (
    select e.previsao_id, e.funcionario_id
    from public.previsao_equipe_semana e join public.funcionarios f on f.id = e.funcionario_id
    where e.produtivo and f.ativo
  ),
  janela as (
    select a.id, a.funcionario_id, a.data,
           case when a.horario_inicio is not null and (a.em_aberto or a.horario_fim is not null) then a.horario_inicio end as j_ini,
           case when a.em_aberto and a.horario_inicio is not null then null else a.horario_fim end as j_fim,
           (a.em_aberto and a.horario_inicio is not null) as aberto
    from public.ausencias_funcionarios a
  ),
  indisp as (
    select per.previsao_id, per.data, per.periodo_id, j.funcionario_id, j.id as causa_id
    from per join janela j on j.data = per.data
    where j.j_ini is null or (j.j_ini < per.fim and (case when j.aberto then per.fim_jornada else j.j_fim end) > per.ini)
  ),
  linhas as (
    select per.previsao_id, per.data, per.periodo_id, al.funcionario_id
    from per join public.escala_producao_alocacoes al on al.data = per.data and al.periodo_id = per.periodo_id
  )
  select distinct x.previsao_id, x.data, x.periodo_id, x.funcionario_id, x.tipo, x.causa_id
  from (
    select l.previsao_id, l.data, l.periodo_id, l.funcionario_id, 'alocado_ausente'::text as tipo, i.causa_id
    from linhas l join indisp i on i.data = l.data and i.periodo_id = l.periodo_id and i.funcionario_id = l.funcionario_id
    union all
    select l.previsao_id, l.data, l.periodo_id, l.funcionario_id, 'alocado_inativo', l.funcionario_id
    from linhas l join public.funcionarios f on f.id = l.funcionario_id where not f.ativo
    union all
    select l.previsao_id, l.data, l.periodo_id, l.funcionario_id, 'alocado_fora_equipe', null::uuid
    from linhas l join public.funcionarios f on f.id = l.funcionario_id
    where f.ativo and not exists (select 1 from equipe e where e.previsao_id = l.previsao_id and e.funcionario_id = l.funcionario_id)
    union all
    select per.previsao_id, per.data, per.periodo_id, e.funcionario_id, 'disponivel_sem_linha', null::uuid
    from per join equipe e on e.previsao_id = per.previsao_id
    where not exists (select 1 from indisp i where i.data = per.data and i.periodo_id = per.periodo_id and i.funcionario_id = e.funcionario_id)
      and not exists (select 1 from public.escala_producao_alocacoes al where al.data = per.data and al.periodo_id = per.periodo_id and al.funcionario_id = e.funcionario_id)
  ) x;
$$;

revoke all on function public.escala_divergencias_funcionarios(timestamptz) from public, anon, authenticated;
grant execute on function public.escala_divergencias_funcionarios(timestamptz) to service_role;

-- Fechamento automático do atraso em aberto no fim do expediente: direto no banco (pg_cron), sem depender do GitHub nem de nenhuma chamada HTTP.
-- 17:00 e 17:05 (retentativa) America/Sao_Paulo = 20:00/20:05 UTC, seg–sáb; 06:05 SP recolhe qualquer resto de dia anterior. Idempotente
-- (fechar_atrasos_vencidos só fecha o que já passou do fim da jornada). O evento 'ausencia' gerado pelo UPDATE é drenado pelo worker (o plano não muda: o motor
-- já trata o atraso em aberto como indisponível até o fim da jornada).
select cron.schedule('escala-fechar-atrasos-1700', '0 20 * * 1-6', 'select public.fechar_atrasos_vencidos()');
select cron.schedule('escala-fechar-atrasos-1705', '5 20 * * 1-6', 'select public.fechar_atrasos_vencidos()');
select cron.schedule('escala-fechar-atrasos-0605', '5 9 * * 1-6', 'select public.fechar_atrasos_vencidos()');

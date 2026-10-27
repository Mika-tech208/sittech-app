-- Sittech — FRENTE B: causas de indisponibilidade de máquina COM JANELA que tocam uma semana, para a Capacidade/Previsão calcularem as horas REAIS por máquina
-- (a mesma tabela que a Escala usa: escala_recurso_indisponivel — Parada espelhada + bloqueio manual). Qualquer usuário ativo lê (só ids, janelas e origem).
create or replace function public.escala_causas_indisponibilidade_semana(p_inicio date, p_fim date)
returns table (maquina_id uuid, origem_tipo text, desde timestamptz, liberada_em timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.maquina_id, i.origem_tipo, i.desde, i.liberada_em
  from public.escala_recurso_indisponivel i
  where public.is_usuario_ativo()
    and i.desde < (((p_fim + 1)::timestamp) at time zone 'America/Sao_Paulo')
    and (i.liberada_em is null or i.liberada_em > ((p_inicio::timestamp) at time zone 'America/Sao_Paulo'));
$$;
revoke all on function public.escala_causas_indisponibilidade_semana(date, date) from public, anon;
grant execute on function public.escala_causas_indisponibilidade_semana(date, date) to authenticated;

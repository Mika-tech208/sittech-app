-- Escala de Produção — geração automática semanal (segunda 06:30 America/Sao_Paulo).
-- Novo tipo de evento: 'geracao_semanal'. Registra o resultado operacional da
-- geração automática; quando não há Previsão da semana vira um evento em
-- ERRO (detectável: a tela já mostra o alerta de evento esgotado e o worker
-- da outbox tenta de novo). Sem tabela nova.

alter table public.escala_producao_eventos drop constraint if exists escala_producao_eventos_tipo_check;
alter table public.escala_producao_eventos add constraint escala_producao_eventos_tipo_check check (tipo in (
  'ausencia', 'previsao', 'recurso_bloqueado', 'recurso_liberado', 'geracao_manual',  -- outbox: pedem recálculo
  'geracao_semanal',                                                                    -- geração automática da semana
  'recalculo', 'edicao_manual'                                                          -- histórico: registro do que foi feito
));

create or replace function public.escala_registrar_evento(
  p_tipo text,
  p_previsao_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_usuario_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_tipo not in ('ausencia', 'previsao', 'recurso_bloqueado', 'recurso_liberado', 'geracao_manual', 'geracao_semanal') then
    raise exception 'ESCALA_TIPO_EVENTO_INVALIDO: %', p_tipo;
  end if;

  -- deduplica pendente do mesmo tipo/previsão (geração semanal: também pela semana)
  select id into v_id
  from escala_producao_eventos
  where status = 'pendente' and tipo = p_tipo and previsao_id is not distinct from p_previsao_id
    and (p_tipo <> 'geracao_semanal' or payload->>'semanaInicio' = p_payload->>'semanaInicio')
  limit 1;
  if found then
    return v_id;
  end if;

  insert into escala_producao_eventos (tipo, previsao_id, payload, usuario_id)
  values (p_tipo, p_previsao_id, coalesce(p_payload, '{}'::jsonb), p_usuario_id)
  returning id into v_id;
  return v_id;
end;
$$;

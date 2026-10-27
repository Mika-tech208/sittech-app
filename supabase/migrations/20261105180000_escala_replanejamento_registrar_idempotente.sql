-- Sittech — Escala de Produção: o registro de avaliações NÃO aplicadas do replanejamento restrito passa a ser IDEMPOTENTE e SERIALIZADO.
--
-- Incidente de 27/10 (PROD): escala_replanejamentos seq 12–15 = 4 recusas IDÊNTICAS (mesmo hash_antes, mesma versão, mesma proposta, mesmo motivo)
-- gravadas em 7 s por invocações concorrentes da reavaliação por evento: cada uma leu `escala_replanejamento_pendentes` ANTES de a primeira
-- registrar o resultado e, portanto, todas avaliaram e registraram o mesmo estado.
--
-- Correção no banco (a do TS — não reavaliar quando a região-alvo já iniciou — está em src/lib/escala/sombraServico.ts):
--   * `escala_replanejamento_registrar` toma o MESMO advisory lock por previsão que aplicação/reversão (`escala:<previsao>`), serializando as invocações;
--   * se o ÚLTIMO registro da (previsão, semana) já é idêntico ao que está sendo registrado — mesmo tipo/resultado/motivo/gatilho, mesmo período de origem,
--     mesma região-alvo (a_partir), mesmo hash_antes (lido agora, no banco), mesma proposta (hash_proposta) e mesmas versões dos dias — NÃO insere outra
--     linha e devolve o id da existente. Só o ÚLTIMO registro conta: o mesmo estado revisitado depois de outro registro (A → B → A) é um fato novo.
-- Não altera nenhuma regra de decisão nem parâmetro. Tabela, colunas e assinatura intactas (create or replace).
--
-- REVERSÃO: reaplicar o corpo original da função (migration 20261027100000_replanejamento_restrito.sql, seção 5, `escala_replanejamento_registrar`).

create or replace function public.escala_replanejamento_registrar(p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.escala_replanejamentos;
  u public.escala_replanejamentos;
  v_id uuid;
  v_hash text;
  v_versoes jsonb;
begin
  r := jsonb_populate_record(null::public.escala_replanejamentos, p_dados);
  if r.resultado in ('aplicado', 'revertido') then
    raise exception 'ESCALA_REPLAN_REGISTRO_INVALIDO: aplicado/revertido só pelas RPCs de aplicação/reversão';
  end if;
  -- serializa com as outras invocações (e com a aplicação/reversão) da mesma previsão
  perform pg_advisory_xact_lock(hashtextextended('escala:' || r.previsao_id::text, 0));
  -- o hash da região é lido NO BANCO, na hora do registro: é o "estado conhecido" que a reavaliação por evento compara depois
  v_hash := case when r.a_partir_data is not null and r.a_partir_periodo is not null then public.escala_hash_regiao(r.previsao_id, r.a_partir_data, r.a_partir_periodo) else null end;
  select coalesce(jsonb_object_agg(d.data::text, d.versao), '{}'::jsonb) into v_versoes from public.escala_producao_dias d where d.previsao_id = r.previsao_id;

  select * into u from public.escala_replanejamentos where previsao_id = r.previsao_id and semana_inicio = r.semana_inicio order by seq desc limit 1;
  if found
     and u.tipo = r.tipo and u.resultado = r.resultado
     and u.data = r.data and u.periodo_id = r.periodo_id
     and u.a_partir_data is not distinct from r.a_partir_data and u.a_partir_periodo is not distinct from r.a_partir_periodo
     and u.hash_antes is not distinct from v_hash and u.hash_proposta is not distinct from r.hash_proposta
     and u.motivo is not distinct from r.motivo and u.gatilho is not distinct from r.gatilho
     and u.versoes_antes is not distinct from v_versoes then
    return u.id;
  end if;

  insert into public.escala_replanejamentos (decisao_id, previsao_id, semana_inicio, data, periodo_id, slot, revisao, tipo, resultado, motivo, gatilho, a_partir_data, a_partir_periodo, versoes_antes, hash_antes, hash_proposta, mudancas, resumo, erro)
  values (r.decisao_id, r.previsao_id, r.semana_inicio, r.data, r.periodo_id, r.slot, coalesce(r.revisao, 0), r.tipo, r.resultado, r.motivo, r.gatilho, r.a_partir_data, r.a_partir_periodo,
          v_versoes, v_hash, r.hash_proposta, r.mudancas, r.resumo, r.erro)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.escala_replanejamento_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.escala_replanejamento_registrar(jsonb) to service_role;

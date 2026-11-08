-- MODO MANUAL — passo 2 (flags). Pré-requisito: migration 20261119100000_modo_operacao_manual.sql já aplicada.
-- Uma transação só. ORDEM IMPORTA: producao_real_modo sai de 'ativo' por ÚLTIMO, porque o gatilho escala_trg_parametros registra eventos de recálculo ao sair do modo ativo;
-- com as outras duas flags já desligadas, escala_registrar_evento() devolve sem enfileirar (escala_operacao_manual() = true). Se mesmo assim houver evento novo, a transação aborta.
begin;
create temp table _antes_modo_manual as select (select count(*) from public.escala_producao_eventos) as eventos, (select count(*) from public.escala_producao_eventos where status = 'pendente') as pendentes;

update public.escala_parametros set valor = '"desligado"'::jsonb, atualizado_em = now() where chave = 'replanejamento_modo';
update public.escala_parametros set valor = '"desligado"'::jsonb, atualizado_em = now() where chave = 'escala_fechamento_fisico_modo';
update public.escala_parametros set valor = '"desligado"'::jsonb, atualizado_em = now() where chave = 'apontamento_simplificado_modo';
update public.escala_parametros set valor = '"desligado"'::jsonb, atualizado_em = now() where chave = 'producao_real_modo';

do $$
declare v_antes bigint := (select eventos from _antes_modo_manual); v_depois bigint;
begin
  if not (select coalesce(bool_and(coalesce(valor #>> '{}', 'desligado') = 'desligado'), true) from public.escala_parametros where chave in ('producao_real_modo','replanejamento_modo','escala_fechamento_fisico_modo')) then
    raise exception 'MODO_MANUAL_NAO_ATIVO: as três flags não ficaram desligadas; abortando';
  end if;
  select count(*) into v_depois from public.escala_producao_eventos;
  if v_depois <> v_antes then
    raise exception 'MODO_MANUAL_GEROU_EVENTOS: % eventos novos na fila durante o desligamento; abortando (nada é gravado)', v_depois - v_antes;
  end if;
  if (select count(*) from public.escala_producao_eventos where status = 'pendente') <> (select pendentes from _antes_modo_manual) then
    raise exception 'MODO_MANUAL_ALTEROU_FILA: pendentes mudaram; abortando';
  end if;
end $$;
commit;
select (select string_agg(chave || '=' || (valor #>> '{}'), ', ' order by chave) from public.escala_parametros where chave in ('producao_real_modo','replanejamento_modo','escala_fechamento_fisico_modo','apontamento_simplificado_modo')) as flags, (select coalesce(bool_and(coalesce(valor #>> '{}', 'desligado') = 'desligado'), true) from public.escala_parametros where chave in ('producao_real_modo','replanejamento_modo','escala_fechamento_fisico_modo')) as operacao_manual, (select count(*) from public.escala_producao_eventos where status = 'pendente') as eventos_pendentes;

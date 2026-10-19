-- Sittech — Faltas e Ausências: lançamento em lote (vários dias numa ação).
--
-- Continua UM REGISTRO POR DIA em ausencias_funcionarios (produtividade,
-- disponibilidade, filtros, auditoria e cruzamento futuro com Produção
-- Real dependem disso). Esta RPC só chama registrar_ausencia_funcionario
-- (migration 37/38, inalterada) uma vez por dia, então herda dela
-- permissão, elegibilidade do funcionário, regra de sobreposição
-- [início, fim), snapshot da jornada oficial e criado_por.
--
-- Idempotência: a chave de cada dia é DERIVADA da chave do lote
-- (md5(lote || ':' || data)::uuid). Clique duplo / retry com a mesma chave
-- de lote cai na chave de dia já existente e devolve 'ja_registrado' em
-- vez de duplicar (e sem cair na regra de sobreposição contra si mesmo).
--
-- Conflito: cada dia roda num sub-bloco (savepoint). Se UM dia conflita com
-- uma ausência existente, só ele é revertido e reportado como 'conflito';
-- os demais dias válidos são gravados. Qualquer OUTRO erro (permissão,
-- funcionário inativo, etc.) aborta o lote inteiro.
--
-- Retorna jsonb: [{data, status: 'criado'|'ja_registrado'|'conflito', id?, mensagem?}]

create or replace function public.registrar_ausencias_funcionario_lote(
  p_funcionario_id uuid,
  p_datas date[],
  p_tipo text,
  p_horario_inicio time,
  p_horario_fim time,
  p_duracao_minutos integer,
  p_observacao text,
  p_lote_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ordenadas date[];
  v_data date;
  v_key uuid;
  v_existente public.ausencias_funcionarios;
  v_linha public.ausencias_funcionarios;
  v_resultados jsonb := '[]'::jsonb;
begin
  if p_lote_key is null then
    raise exception 'Chave do lote não informada';
  end if;
  if p_datas is null or coalesce(array_length(p_datas, 1), 0) = 0 then
    raise exception 'Selecione ao menos um dia';
  end if;
  if array_length(p_datas, 1) > 31 then
    raise exception 'No máximo 31 dias por lançamento em lote';
  end if;
  if (select count(distinct d) from unnest(p_datas) d) <> array_length(p_datas, 1) then
    raise exception 'Há datas repetidas no lote';
  end if;

  select array_agg(d order by d) into v_ordenadas from unnest(p_datas) d;

  foreach v_data in array v_ordenadas
  loop
    v_key := md5(p_lote_key::text || ':' || v_data::text)::uuid;

    select * into v_existente from public.ausencias_funcionarios where idempotency_key = v_key;
    if found then
      v_resultados := v_resultados || jsonb_build_object('data', v_data, 'status', 'ja_registrado', 'id', v_existente.id);
      continue;
    end if;

    begin
      v_linha := public.registrar_ausencia_funcionario(
        p_funcionario_id, v_data, p_tipo, p_horario_inicio, p_horario_fim,
        p_duracao_minutos, p_observacao, v_key
      );
      v_resultados := v_resultados || jsonb_build_object('data', v_data, 'status', 'criado', 'id', v_linha.id);
    exception when others then
      if sqlerrm like 'Já existe uma ausência registrada%' then
        v_resultados := v_resultados || jsonb_build_object('data', v_data, 'status', 'conflito', 'mensagem', sqlerrm);
      else
        raise;
      end if;
    end;
  end loop;

  return v_resultados;
end;
$$;

revoke all on function public.registrar_ausencias_funcionario_lote(uuid, date[], text, time, time, integer, text, uuid) from public, anon;
grant execute on function public.registrar_ausencias_funcionario_lote(uuid, date[], text, time, time, integer, text, uuid) to authenticated;

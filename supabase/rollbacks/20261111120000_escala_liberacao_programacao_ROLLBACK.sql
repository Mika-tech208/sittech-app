-- Reverte a liberação no banco: devolve a RPC da TV ao corpo ORIGINAL EXATO (backup x1_BACKUP_escala_tv_snapshot_ORIGINAL.sql) e remove as funções novas.
begin;
CREATE OR REPLACE FUNCTION public.escala_tv_snapshot(p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_data date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
  v_dia public.escala_producao_dias;
  v_aloc jsonb;
  v_ind jsonb;
begin
  if not (public.is_admin() or public.has_permissao('escala_producao') or public.has_permissao('escala_producao_tv')) then
    raise exception 'Usuário não tem permissão para a TV da Escala';
  end if;

  select * into v_dia from public.escala_producao_dias where data = v_data;
  if not found then
    return jsonb_build_object('agora', now(), 'data', v_data, 'existe', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'periodo_id', a.periodo_id,
           'funcionario_id', a.funcionario_id,
           'funcionario', f.nome,
           'maquina', m.nome,
           'produto', p.nome,
           'operacao', o.nome,
           'motivo_sem_posto', a.motivo_sem_posto,
           'excecao', a.excecao_revezamento
         ) order by a.periodo_id, f.nome), '[]'::jsonb)
    into v_aloc
  from public.escala_producao_alocacoes a
  join public.funcionarios f on f.id = a.funcionario_id
  left join public.maquinas m on m.id = a.maquina_id
  left join public.produtos p on p.id = a.produto_id
  left join public.operacoes o on o.id = a.operacao_id
  where a.data = v_data;

  select coalesce(jsonb_agg(jsonb_build_object('maquina', m.nome, 'desde', i.desde, 'motivo', i.motivo) order by i.desde), '[]'::jsonb)
    into v_ind
  from public.escala_recurso_indisponivel i
  join public.maquinas m on m.id = i.maquina_id
  where i.liberada_em is null;

  return jsonb_build_object(
    'agora', now(), 'data', v_data, 'existe', true, 'versao', v_dia.versao, 'atualizado_em', v_dia.atualizado_em,
    'periodos', v_dia.periodos_snapshot, 'alocacoes', v_aloc, 'indisponiveis', v_ind
  );
end;
$function$;
drop function if exists public.escala_liberacao_dia(date);
drop function if exists public.escala_periodo_liberacao(date, text);
drop function if exists public.escala_liberacao_slots(date);
commit;

-- Sittech — Escala de Produção: modo TV (Fase 4).
--
-- A TV é SOMENTE LEITURA: nunca escreve, nunca calcula, nunca dispara regra.
-- Lê um snapshot compacto da escala do dia (todos os períodos restantes, p/
-- trocar AGORA/PRÓXIMO localmente sem rede) por esta RPC — o usuário de
-- quiosque (permissão escala_producao_tv) NÃO precisa de acesso a nenhuma
-- tabela; a função (security definer) devolve só nomes e o necessário.

create or replace function public.escala_tv_snapshot(p_data date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.escala_tv_snapshot(date) from public, anon;
grant execute on function public.escala_tv_snapshot(date) to authenticated;

-- Realtime: a TV escuta a tabela de cabeçalho (a `versao` muda a cada
-- recálculo/edição); a policy de select dela já inclui escala_producao_tv.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.escala_producao_dias;
    exception when duplicate_object then
      null;
    end;
  end if;
end;
$$;

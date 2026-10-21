-- Sittech — Escala de Produção, WIP controlado por SEMANA + versão temporal dos parâmetros de WIP.
--  1) `wip_dias_limite_semanas`: limite de WIP em dias específico de UMA semana (ex.: {"2026-10-26": 2}). O padrão global
--     `wip_dias_limite` NÃO muda; semana sem entrada usa o global.
--  2) A versão do plano (escala_plano_versoes) passa a registrar também os parâmetros de WIP vigentes (modo, limite global e o da
--     semana) e uma nova versão nasce quando eles mudam — a sombra reconstrói o WIP do corte com a configuração DO CORTE.
-- Aditiva. A semeadura do parâmetro não dispara recálculo (nada muda de comportamento).

alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('wip_dias_limite_semanas', '{}'::jsonb, 'operacional', 'Limite de estoque intermediário em dias produtivos, POR SEMANA (chave = segunda-feira ISO). Semana sem entrada usa wip_dias_limite')
on conflict (chave) do nothing;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

alter table public.escala_parametros drop constraint if exists escala_parametros_wip_dias_semanas;
alter table public.escala_parametros add constraint escala_parametros_wip_dias_semanas
  check (chave <> 'wip_dias_limite_semanas' or jsonb_typeof(valor) = 'object');

create or replace function public.escala_plano_entrada(p_previsao uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'diasProdutivos', (select coalesce(jsonb_agg(dia::text order by dia), '[]'::jsonb) from public.previsao_dias_produtivos where previsao_id = p_previsao and ativo),
    'equipe', (select coalesce(jsonb_agg(funcionario_id order by funcionario_id), '[]'::jsonb) from public.previsao_equipe_semana where previsao_id = p_previsao and produtivo),
    'maquinasIndisponiveisPrevisao', (select coalesce(jsonb_agg(maquina_id order by maquina_id), '[]'::jsonb) from public.previsao_maquinas_indisponiveis where previsao_id = p_previsao),
    'itens', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'produtoId', i.produto_id,
        'quantidade', i.quantidade,
        'quantidadeAdicional', coalesce(i.quantidade_adicional, 0),
        'valorUnitario', i.valor_unitario,
        'maquinasPorEtapa', (select coalesce(jsonb_object_agg(t.etapa_id::text, t.maqs), '{}'::jsonb) from (select etapa_id, jsonb_agg(maquina_id order by maquina_id) maqs from public.previsao_item_maquinas where item_id = i.id group by etapa_id) t),
        'adicionalPorEtapa', (select jsonb_object_agg(etapa_id::text, quantidade) from public.previsao_item_adicional_etapa where item_id = i.id)
      )) order by i.produto_id, i.id), '[]'::jsonb)
      from public.previsao_itens i where i.previsao_id = p_previsao and i.tipo = 'previsto'
    ),
    'parametros', jsonb_build_object(
      'wipModo', coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'wip_modo'), 'desligado'),
      'wipDiasLimite', coalesce((select (valor #>> '{}')::numeric from public.escala_parametros where chave = 'wip_dias_limite'), 1),
      'wipDiasLimitePorSemana', (select (p.valor -> (pv.semana_inicio::text)) from public.escala_parametros p, public.previsoes pv where p.chave = 'wip_dias_limite_semanas' and pv.id = p_previsao)
    )
  );
$$;

-- Mudou um parâmetro de WIP => nova versão do plano das semanas recentes (só com o modo sombra/ativo ligado)
create or replace function public.escala_plano_trg_parametros()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev uuid;
begin
  begin
    if public.escala_replanejamento_modo() = 'desligado' then
      return null;
    end if;
    if coalesce(new.chave, old.chave) in ('wip_modo', 'wip_dias_limite', 'wip_dias_limite_semanas') then
      for v_prev in select distinct previsao_id from public.escala_producao_dias where data >= current_date - 14 loop
        perform public.escala_plano_registrar(v_prev, 'trigger');
      end loop;
    end if;
  exception when others then
    raise warning 'escala_plano_trg_parametros: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.escala_plano_trg_parametros() from public, anon, authenticated;

drop trigger if exists trg_escala_plano_versao on public.escala_parametros;
create constraint trigger trg_escala_plano_versao after insert or update or delete on public.escala_parametros
  deferrable initially deferred for each row execute function public.escala_plano_trg_parametros();

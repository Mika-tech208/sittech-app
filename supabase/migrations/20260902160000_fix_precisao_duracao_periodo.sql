-- Sittech — schema PostgreSQL, migration 13
-- Corrige um bug real encontrado ao testar as RPCs de Ocorrência de
-- Máquina: uma parada cujos minutos batem EXATAMENTE com a duração total
-- de um período era rejeitada pelo trigger validar_soma_paradas_periodo
-- (migration 9) com "soma (80 min) ultrapassa a duração (79.999999999999998
-- min)".
--
-- Causa raiz (confirmada por teste direto no banco antes de escrever esta
-- migration, não suposição): `duracao_periodo_horas_vigente` é HORAS —
-- pra um período de 80 minutos isso é 4/3 hora, uma fração que NÃO tem
-- representação decimal finita exata (nem em float8, nem em numeric — é
-- uma limitação matemática de qualquer sistema posicional de base finita,
-- não uma falha do Postgres). Testado: trocar `extract(epoch from
-- ...)/3600` (float8) por `extract(epoch from ...)::numeric/3600`
-- (numeric) dá o MESMO resultado imprciso (79.9999999999999980 nos dois
-- casos) — então "usar numeric" na coluna sozinho NÃO resolve nada, e por
-- isso `duracao_periodo_horas_vigente` NÃO é alterada nesta migration
-- (nem precisa: nenhuma outra generated column ou function depende dela
-- — custo_operacional_periodo_vigente e custo_unitario_referencia_
-- periodo_vigente têm fórmula própria, independente, que nunca a
-- referencia).
--
-- O que É exato: `extract(epoch from (periodo_fim_vigente -
-- periodo_inicio_vigente))::numeric / 60` — minutos, não horas. Como os
-- horários de período em `periodos` (e por extensão os snapshots
-- periodo_inicio_vigente/periodo_fim_vigente) são sempre minuto cheio, o
-- epoch em segundos é sempre múltiplo exato de 60 — essa divisão nunca
-- produz dízima. Testado contra os 6 períodos reais de DEV: os 6 batem
-- exatos em minutos (96, 96, 91, 80, 80, 80), sem nenhum resíduo.
--
-- Correção: o trigger passa a comparar a soma das paradas contra essa
-- duração em minutos calculada direto dos horários — nunca mais
-- reconstruída multiplicando duracao_periodo_horas_vigente por 60 (é
-- exatamente esse passo de ida-e-volta hora↔minuto que introduzia o
-- erro). Mesma regra de negócio de antes (soma de paradas não pode
-- passar da duração do período) — só o jeito de calcular muda.

create or replace function public.validar_soma_paradas_periodo()
returns trigger as $$
declare
  v_soma_minutos numeric;
  v_duracao_periodo_minutos numeric;
begin
  select coalesce(sum(minutos), 0) into v_soma_minutos
  from apontamento_paradas
  where apontamento_id = new.apontamento_id;

  select extract(epoch from (periodo_fim_vigente - periodo_inicio_vigente))::numeric / 60
    into v_duracao_periodo_minutos
  from apontamentos_producao
  where id = new.apontamento_id;

  if v_soma_minutos > v_duracao_periodo_minutos then
    raise exception 'Soma das paradas (% min) ultrapassa a duração do período (% min) do apontamento %',
      v_soma_minutos, v_duracao_periodo_minutos, new.apontamento_id;
  end if;

  return new;
end;
$$ language plpgsql;

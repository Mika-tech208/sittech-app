-- Sittech — schema PostgreSQL, migration 18
-- Corrige bug real em calcular_intersecao_parada_ocorrencia (migration 9):
-- a function arredondava a interseção pra minutos ANTES de checar se ela
-- existia (v_minutos <= 0) — uma ocorrência com interseção real de menos
-- de ~30s arredonda pra 0 e a function concluía (incorretamente) "não
-- intersecta", mesmo a query de vínculo retroativo
-- (vincular_ocorrencias_encerradas_ao_apontamento, migration 16, que
-- compara os timestamps brutos sem arredondar) tendo identificado uma
-- interseção real. Reproduzido ao vivo em DEV: ocorrência aberta e
-- encerrada em 19s, com apontamento no mesmo período — a RPC de
-- registrar/editar apontamento falhava com "Ocorrência ... não intersecta
-- o período", incorreto.
--
-- Correção mínima: determina a EXISTÊNCIA da interseção usando os
-- segundos brutos (extract(epoch...), sem round()) — só depois de
-- confirmada a interseção real, arredonda pra minutos pro valor final
-- gravado em `minutos`. Mesma fórmula de cálculo de antes (nada na regra
-- de negócio muda, só a ORDEM: existência primeiro, arredondamento
-- depois). Nenhuma decisão nova sobre "mínimo de 1 minuto" ou qualquer
-- outro piso — se o arredondamento final ainda resultar em 0, o INSERT
-- simplesmente esbarra no `check (minutos > 0)` já existente na tabela
-- apontamento_paradas (migration 9), exatamente como qualquer outro
-- minutos=0 sempre esbarrou. Isso é uma decisão de negócio explicitamente
-- fora deste escopo (reportada separadamente).
create or replace function public.calcular_intersecao_parada_ocorrencia()
returns trigger as $$
declare
  v_ocorrencia_aberta_em timestamptz;
  v_ocorrencia_encerrada_em timestamptz;
  v_apontamento_data date;
  v_periodo_inicio time;
  v_periodo_fim time;
  v_janela_inicio timestamptz;
  v_janela_fim timestamptz;
  v_intersecao_segundos numeric;
  v_minutos numeric;
begin
  if new.ocorrencia_id is null then
    return new;
  end if;

  select aberta_em, encerrada_em
    into v_ocorrencia_aberta_em, v_ocorrencia_encerrada_em
  from public.ocorrencias_maquina
  where id = new.ocorrencia_id;

  if v_ocorrencia_encerrada_em is null then
    raise exception 'Ocorrência % ainda está aberta — só pode ser vinculada a uma parada depois de encerrada', new.ocorrencia_id;
  end if;

  select data, periodo_inicio_vigente, periodo_fim_vigente
    into v_apontamento_data, v_periodo_inicio, v_periodo_fim
  from public.apontamentos_producao
  where id = new.apontamento_id;

  -- Assunção: período é horário local (America/Sao_Paulo), não cruza
  -- meia-noite — ver comentário no topo do arquivo (migration 9).
  v_janela_inicio := (v_apontamento_data + v_periodo_inicio) at time zone 'America/Sao_Paulo';
  v_janela_fim := (v_apontamento_data + v_periodo_fim) at time zone 'America/Sao_Paulo';

  -- Existência da interseção decidida pelos segundos BRUTOS, nunca
  -- arredondados — é o que corrige o bug (antes comparava v_minutos, já
  -- arredondado, contra <= 0).
  v_intersecao_segundos := extract(epoch from (
    least(v_ocorrencia_encerrada_em, v_janela_fim) - greatest(v_ocorrencia_aberta_em, v_janela_inicio)
  ));

  if v_intersecao_segundos <= 0 then
    raise exception 'Ocorrência % não intersecta o período do apontamento %', new.ocorrencia_id, new.apontamento_id;
  end if;

  -- Só agora arredonda pra minutos, pro valor final gravado — mesma conta
  -- de antes (round(), sem mudança de regra).
  v_minutos := round(v_intersecao_segundos / 60);

  new.minutos := v_minutos;
  return new;
end;
$$ language plpgsql;

-- Trigger já existente (trg_apontamento_paradas_intersecao, migration 9)
-- continua apontando pra esta mesma function por nome — nenhuma alteração
-- necessária nele.

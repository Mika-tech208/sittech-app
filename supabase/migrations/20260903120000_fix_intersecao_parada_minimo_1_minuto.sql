-- Sittech — schema PostgreSQL, migration 19
-- Segue diretamente a migration 18 (calcular_intersecao_parada_ocorrencia):
-- lá corrigimos a ORDEM (existência decidida pelos segundos brutos, antes
-- de arredondar) — mas deixamos explicitamente em aberto o que fazer
-- quando uma interseção real positiva arredonda para 0 minutos, já que
-- isso é decisão de negócio, não técnica. Validado ao vivo em DEV: nesse
-- caso o INSERT em apontamento_paradas esbarra no check(minutos > 0)
-- (migration 9) e, como nenhuma das RPCs chamadoras
-- (encerrar_ocorrencia_maquina, registrar_apontamento_producao*, vínculo
-- retroativo) captura esse erro, a falha derruba a transação inteira: a
-- ocorrência não fecha, ou o apontamento inteiro deixa de ser registrado
-- — mesmo sendo um lançamento válido, não relacionado à ocorrência curta.
--
-- Regra de negócio aprovada: interseção real positiva sempre gera pelo
-- menos 1 minuto de parada — nunca 0. Interseção real <= 0 continua sem
-- vínculo (raise exception, comportamento inalterado). Interseção que já
-- arredondava para >= 1 minuto continua exatamente com o mesmo valor de
-- antes — nenhuma mudança na regra de arredondamento geral, nenhum minuto
-- decimal introduzido.
--
-- Correção na causa raiz, na própria function de cálculo (não nas RPCs
-- chamadoras — nenhum tratamento de check_violation foi adicionado em
-- lugar nenhum): só grava round(); se o resultado for exatamente 0 (só
-- possível aqui porque a existência real, > 0, já foi confirmada acima),
-- substitui por 1 antes de gravar. Ocorrência atravessando períodos:
-- como cada apontamento_paradas é uma linha própria, com o trigger rodando
-- uma vez por linha, essa regra se aplica a cada segmento/período
-- independentemente — uma sobra de poucos segundos na borda de um período
-- vira 1 minuto SÓ NAQUELE período, sem afetar o outro.
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
  -- arredondados (migration 18).
  v_intersecao_segundos := extract(epoch from (
    least(v_ocorrencia_encerrada_em, v_janela_fim) - greatest(v_ocorrencia_aberta_em, v_janela_inicio)
  ));

  if v_intersecao_segundos <= 0 then
    raise exception 'Ocorrência % não intersecta o período do apontamento %', new.ocorrencia_id, new.apontamento_id;
  end if;

  -- Arredondamento normal — regra inalterada.
  v_minutos := round(v_intersecao_segundos / 60);

  -- Interseção real (v_intersecao_segundos > 0, já garantido acima)
  -- arredondou para 0 — regra de negócio aprovada: grava o mínimo de 1
  -- minuto. Só pode acontecer aqui pra interseções reais abaixo de ~30s;
  -- qualquer arredondamento que já desse >= 1 minuto passa direto, sem
  -- mudança nenhuma.
  if v_minutos = 0 then
    v_minutos := 1;
  end if;

  new.minutos := v_minutos;
  return new;
end;
$$ language plpgsql;

-- Trigger já existente (trg_apontamento_paradas_intersecao, migration 9)
-- continua apontando pra esta mesma function por nome — nenhuma alteração
-- necessária nele.

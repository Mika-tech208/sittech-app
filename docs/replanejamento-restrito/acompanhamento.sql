-- ACOMPANHAMENTO DO REPLANEJAMENTO RESTRITO (somente leitura). Troque a semana (segunda-feira ISO) se necessário.
-- 1) Resultado de cada avaliação, em ordem: aplicado / sem_mudanca / recusado / conflito / invalida / erro (+ reversões)
select seq, criado_em at time zone 'America/Sao_Paulo' as quando, data, periodo_id, revisao, tipo, resultado, motivo,
       a_partir_data, a_partir_periodo, left(hash_antes, 8) as hash_antes, left(hash_depois, 8) as hash_depois,
       resumo->>'previstoAntes' as prev_antes, resumo->>'previstoDepois' as prev_depois, resumo->>'adicionalAntes' as wip_antes, resumo->>'adicionalDepois' as wip_depois,
       resumo->>'ociososAntes' as ocioso_antes, resumo->>'ociososDepois' as ocioso_depois, mudancas->>'total' as linhas_alteradas
  from escala_replanejamentos
 where semana_inicio = '2026-10-26'
 order by seq;

-- 2) Totais por resultado
select resultado, count(*) from escala_replanejamentos where semana_inicio = '2026-10-26' group by 1 order by 2 desc;

-- 3) Decisões por período: revisão 0 = decisão do corte (sombra); 1+ = decisão com o estado do momento da gravação (ativo_restrito)
select data, periodo_id, revisao, motivo, replanejamento_modo, situacao, dados_completos,
       diagnostico->'restrito'->'proposta'->>'veredito' as veredito, diagnostico->'restrito'->'proposta'->>'motivoVeredito' as motivo_veredito,
       diagnostico->'restrito'->'dinamica'->'gargalo'->>'situacao' as gargalo, diagnostico->'restrito'->'dinamica'->'gargalo'->'principal'->>'pressaoAjustada' as pressao_ajustada,
       diagnostico->'restrito'->'ociosidade'->>'total' as ociosos_futuros, diagnostico->'restrito'->'ociosidade'->'porCausa' as causas
  from escala_sombra_decisoes
 where semana_inicio = '2026-10-26'
 order by slot, revisao;

-- 4) Ociosidade futura com CAUSA exata, na decisão mais recente
select o->>'data' as data, o->>'periodoId' as periodo, o->>'funcionarioId' as funcionario, o->>'causa' as causa, o->>'detalhe' as detalhe
  from (select diagnostico from escala_sombra_decisoes where semana_inicio = '2026-10-26' order by slot desc, revisao desc limit 1) d,
       jsonb_array_elements(d.diagnostico->'restrito'->'ociosidade'->'linhas') o;

-- 5) A Escala oficial hoje (hash da região a partir do 1º período alterável da última aplicação) × o que a última avaliação deixou
select r.seq, r.resultado, left(coalesce(r.hash_depois, r.hash_antes), 8) as hash_conhecido,
       left(escala_hash_regiao(r.previsao_id, r.a_partir_data, r.a_partir_periodo), 8) as hash_agora
  from escala_replanejamentos r
 where r.semana_inicio = '2026-10-26' and r.a_partir_data is not null
 order by r.seq desc limit 1;

-- 6) Parâmetros vigentes
select chave, valor from escala_parametros where chave in ('replanejamento_modo', 'replanejamento_semanas_ativas', 'revezamento_modo', 'wip_modo', 'wip_dias_limite', 'wip_dias_limite_semanas') order by chave;

-- 7) CHURN por aplicação: linhas alteradas = produtivas + trocas equivalentes; quantas a estabilidade poupou
select seq, criado_em at time zone 'America/Sao_Paulo' as quando, data, periodo_id, gatilho,
       (mudancas->>'total')::int as linhas_alteradas, (mudancas->'churn'->>'produtivas')::int as produtivas, (mudancas->'churn'->>'trocasEquivalentes')::int as trocas_equivalentes,
       (mudancas->'churn'->>'poupadasPelaEstabilidade')::int as poupadas_estabilidade
  from escala_replanejamentos
 where semana_inicio = '2026-10-26' and resultado = 'aplicado' and tipo = 'aplicacao'
 order by seq;

-- 8) WIP por aplicação: antes/depois, aumento/redução, pessoa-horas ACRESCIDAS (todas em pessoas que ficariam ociosas) e classificação
select seq, data, periodo_id,
       (mudancas->'wip'->>'antes')::numeric as wip_antes, (mudancas->'wip'->>'depois')::numeric as wip_depois, (mudancas->'wip'->>'delta')::numeric as delta,
       (mudancas->'wip'->>'postosAcrescidos')::int as postos_acrescidos, (mudancas->'wip'->>'horasAcrescidas')::numeric as pessoa_horas_acrescidas,
       (mudancas->'wip'->>'ociososEvitados')::int as ociosos_evitados, mudancas->'wip'->>'classificacao' as classificacao, mudancas->'wip'->'aumentos' as motivo_de_cada_aumento
  from escala_replanejamentos
 where semana_inicio = '2026-10-26' and resultado = 'aplicado' and tipo = 'aplicacao'
 order by seq;

-- 9) REVERTIDAS no corte seguinte: linhas que a aplicação seguinte devolve ao valor de ANTES da aplicação anterior
with ap as (select seq, lag(seq) over (order by seq) as seq_ant, linhas_antes, linhas_depois from escala_replanejamentos where semana_inicio = '2026-10-26' and resultado = 'aplicado' and tipo = 'aplicacao'),
 prev as (select a.seq, p.linhas_antes as p_antes, p.linhas_depois as p_depois, a.linhas_antes as a_antes, a.linhas_depois as a_depois from ap a join ap p on p.seq = a.seq_ant)
select seq, (select count(*) from jsonb_array_elements(a_depois) d
              join jsonb_array_elements(p_antes) pa on pa->>0 = d->>0 and pa->>1 = d->>1 and pa->>2 = d->>2
              join jsonb_array_elements(p_depois) pd on pd->>0 = d->>0 and pd->>1 = d->>1 and pd->>2 = d->>2
             where (pa->>3, pa->>4, pa->>5, pa->>7, pa->>8) is not distinct from (d->>3, d->>4, d->>5, d->>7, d->>8)
               and (pd->>3, pd->>4, pd->>5, pd->>7, pd->>8) is distinct from (d->>3, d->>4, d->>5, d->>7, d->>8)) as linhas_revertidas
  from prev order by seq;

-- 10) DÍVIDA TÉCNICA CONHECIDA — recálculo oficial ESTÁTICO (ausência/Previsão/indisponibilidade) × correção dinâmica:
--     quantas vezes ocorreu, tempo até a correção, linhas que o estático alterou e linhas que o dinâmico mudou de novo
with est as (
  select e.id, e.previsao_id, e.processado_em, (e.payload->'resumo'->>'alocacoes')::int as linhas_estatico
    from escala_producao_eventos e
   where e.tipo = 'recalculo' and coalesce(e.payload->'resumo'->>'origem', '') not in ('replanejamento_restrito', 'reversao_replanejamento')
     and e.processado_em >= '2026-10-26'
), rea as (
  select r.seq, r.criado_em, r.resultado, r.previsao_id, (r.mudancas->>'total')::int as linhas_mudadas_de_novo
    from escala_replanejamentos r where r.semana_inicio = '2026-10-26' and r.gatilho = 'reavaliacao'
)
select (select count(*) from est) as recalculos_estaticos_na_semana, (select coalesce(sum(linhas_estatico), 0) from est) as linhas_regravadas_pelo_estatico,
       (select count(*) from rea) as reavaliacoes, (select count(*) from rea where resultado = 'aplicado') as reavaliacoes_que_reaplicaram, (select coalesce(sum(linhas_mudadas_de_novo), 0) from rea) as linhas_que_o_dinamico_mudou_de_novo;

with est as (
  select e.id, e.previsao_id, e.processado_em, (e.payload->'resumo'->>'alocacoes')::int as linhas_estatico
    from escala_producao_eventos e
   where e.tipo = 'recalculo' and coalesce(e.payload->'resumo'->>'origem', '') not in ('replanejamento_restrito', 'reversao_replanejamento')
     and e.processado_em >= '2026-10-26'
), rea as (
  select r.seq, r.criado_em, r.resultado, r.previsao_id, (r.mudancas->>'total')::int as linhas_mudadas_de_novo
    from escala_replanejamentos r where r.semana_inicio = '2026-10-26' and r.gatilho = 'reavaliacao'
)
select rea.seq, rea.criado_em, rea.resultado, rea.linhas_mudadas_de_novo,
       (select max(est.processado_em) from est where est.previsao_id = rea.previsao_id and est.processado_em < rea.criado_em) as ultimo_recalculo_estatico,
       rea.criado_em - (select max(est.processado_em) from est where est.previsao_id = rea.previsao_id and est.processado_em < rea.criado_em) as tempo_ate_correcao
  from rea order by rea.seq;

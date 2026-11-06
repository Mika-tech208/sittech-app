-- PRÉ-VOO do cutover do produto único (SOMENTE LEITURA; seguro em PROD). Uso: psql ... -f 00-preflight.sql
\pset tuples_only off
\echo == 1) produto único, cutover e backfill
select produto_id, codigo, (select ativo from produtos where id=produto_id) as ativo, public.produto_unico_cutover() as cutover from public.produto_canonico;
select public.produto_unico_estado() as estado;
\echo == 2) Previsão da semana do cutover: itens (legados ou único)
select p.semana_inicio, pr.nome, i.tipo, i.quantidade from public.previsoes p join public.previsao_itens i on i.previsao_id=p.id join public.produtos pr on pr.id=i.produto_id
 where p.semana_inicio = date '2026-11-09' and (pr.nome like 'Conector 3/4%') order by pr.nome;
\echo == 3) Conflitos que impediriam ativar (devem ser 0)
select (select count(*) from public.apontamentos_producao where produto_id in (select produto_legado_id from public.produto_legado_mapa) and data >= date '2026-11-09') as apontamentos_legado_na_semana_do_cutover,
       (select count(*) from public.escala_fechamentos where data >= date '2026-11-09') as fechamentos_na_semana_do_cutover;
\echo == 4) Últimas contagens FÍSICAS dos 3 buffers (para conferir A/B/C com a contagem do dia)
select distinct on (b.chave) b.chave, fb.saldo_fisico, f.data, f.periodo_id, f.revisao
  from public.escala_fechamento_buffers fb join public.escala_fechamentos_vigentes f on f.id=fb.fechamento_id join public.escala_buffers_fisicos b on b.id=fb.buffer_id
 where b.chave like 'conector34:%' and fb.saldo_fisico is not null order by b.chave, f.instante_motor desc;
\echo == 5) Catálogo de pares dos 3 buffers hoje
select b.chave, pr.nome, oo.nome as origem, os.nome as seguinte, bp.papel, bp.vigente_de, bp.vigente_ate
  from public.escala_buffer_pares bp join public.escala_buffers_fisicos b on b.id=bp.buffer_id join public.produtos pr on pr.id=bp.produto_id
  join public.roteiro_etapas eo on eo.id=bp.etapa_origem_id join public.operacoes oo on oo.id=eo.operacao_id join public.roteiro_etapas es on es.id=bp.etapa_seguinte_id join public.operacoes os on os.id=es.operacao_id
 where b.chave like 'conector34:%' order by b.ordem, pr.nome;

\i _ok.sql
\echo == 05 PLANEJAMENTO ANTECIPADO (09/11) — plano futuro NÃO LIBERADO, nada operacional muda (clone; cada bloco em transação com rollback)
create or replace function pg_temp.snap2() returns text language sql stable as $$
  select md5((select string_agg(chave||valor::text, '~' order by chave) from escala_parametros) || '|' || (select string_agg(t.id::text||t.ativo::text||t.nome, '~' order by t.id::text) from produtos t) || '|' ||
             (select coalesce(string_agg(t::text,'~' order by t.id::text),'') from escala_buffer_pares t) || '|' || (select count(*) from escala_plano_versoes)::text || '|' || (select count(*) from escala_producao_eventos)::text) $$;
begin;
select pg_temp.snap2() as s0 \gset
select count(*) as ev0 from escala_producao_eventos \gset
select id as prev from previsoes where semana_inicio='2026-11-09' \gset
-- Forecast de hoje: os DOIS itens legados do Conector na Previsão 09/11 (antes de habilitar)
insert into previsao_itens (id, previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values ('e2e00000-0000-4000-8000-0000000000a1',:'prev','previsto','27c229d7-f192-41eb-aad1-0c69ece53eba','Conector 3/4"',0.1825,64800), ('e2e00000-0000-4000-8000-0000000000a2',:'prev','previsto','a027ac97-ffd1-4834-8ed0-d3a94aac4aee','Conector 3/4" - Maquina Automatica',0.182,28500);
insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) select 'e2e00000-0000-4000-8000-0000000000a1', e.id, rem.maquina_id from roteiro_etapas e join roteiro_etapa_maquinas rem on rem.etapa_id=e.id where e.produto_id='27c229d7-f192-41eb-aad1-0c69ece53eba';
insert into previsao_item_maquinas (item_id, etapa_id, maquina_id) select 'e2e00000-0000-4000-8000-0000000000a2', e.id, rem.maquina_id from roteiro_etapas e join roteiro_etapa_maquinas rem on rem.etapa_id=e.id where e.produto_id='a027ac97-ffd1-4834-8ed0-d3a94aac4aee';
select public.escala_plano_registrar('6be15af5-9659-4c12-ba33-9c1fae6d4065','baseline') as _ \gset
select jsonb_agg(public.escala_periodo_liberacao(d::date, p) order by d, p)::text as lib0 from generate_series('2026-11-02'::date,'2026-11-08'::date,'1 day') d, unnest(array['m1','m2','m3','t1','t2','t3']) p \gset
select pg_temp.ok(public.produto_unico_modo('2026-11-09') = 'LEGADO', 'P0 sem planejamento/cutover: modo LEGADO em toda semana');
select pg_temp.falha($$select public.produto_unico_habilitar_planejamento('2026-11-10','t')$$, 'PLANEJAMENTO_INVALIDO', 'P1 habilitar numa terça é recusado');
select public.produto_unico_habilitar_planejamento('2026-11-09','teste') as hab \gset
select pg_temp.ok((:'hab'::jsonb -> 'listas_adicionadas') @> '["producao_real_semanas_ativas","producao_real_planejador_semanas"]'::jsonb, 'P2 habilitar inclui 09/11 nas DUAS listas', :'hab');
select pg_temp.ok((select valor @> '"2026-11-09"' from escala_parametros where chave='producao_real_semanas_ativas') and (select valor @> '"2026-11-09"' from escala_parametros where chave='producao_real_planejador_semanas'), 'P2b as duas listas contêm 2026-11-09');
select pg_temp.ok((select count(*) from escala_producao_eventos) = :ev0 and (select count(*) from escala_producao_eventos where status='pendente') = 0, 'P3 nenhum evento de recálculo (nem versão de plano)');
select pg_temp.ok(escala_plano_registrar('6be15af5-9659-4c12-ba33-9c1fae6d4065','baseline') is null, 'P3b hash do plano da semana 02/11 idêntico');
select pg_temp.ok(public.produto_unico_modo('2026-11-06')='LEGADO' and public.produto_unico_modo('2026-11-09')='PLANEJAMENTO' and public.produto_unico_modo('2026-11-15')='PLANEJAMENTO' and not public.produto_unico_ativo('2026-11-09') and public.produto_unico_planejando('2026-11-09'), 'P4 06/11 LEGADO; 09/11–15/11 PLANEJAMENTO; não operacional');
select pg_temp.ok((select jsonb_agg(public.escala_periodo_liberacao(d::date, p) order by d, p)::text from generate_series('2026-11-02'::date,'2026-11-08'::date,'1 day') d, unnest(array['m1','m2','m3','t1','t2','t3']) p) = :'lib0', 'P5 liberação de 02–08/11 IDÊNTICA antes/depois de habilitar');
select pg_temp.ok((select count(*) from generate_series('2026-11-09'::date,'2026-11-13'::date,'1 day') d, unnest(array['m1','m2','m3','t1','t2','t3']) p where (public.escala_periodo_liberacao(d::date, p)->>'liberado')::boolean = false and public.escala_periodo_liberacao(d::date, p)->>'motivo' = 'PLANO_FUTURO_AGUARDANDO_CUTOVER') = 30, 'P6 (7) 30 períodos de 09–13/11: NÃO LIBERADO / PLANO_FUTURO_AGUARDANDO_CUTOVER');
-- guardas operacionais
select pg_temp.falha($$insert into apontamentos_producao (status, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, valor_unitario_produto_vigente, idempotency_key)
  select 'produzindo', e.produto_id, e.id, e.operacao_id, rem.maquina_id, (select id from funcionarios where ativo limit 1), 'm1', '2026-11-09', '08:00', 10, 0, '07:12', '08:48', 0, 0, 0.1, gen_random_uuid() from roteiro_etapas e join roteiro_etapa_maquinas rem on rem.etapa_id=e.id where e.produto_id in (select id from produtos where nome='Pino') limit 1$$, 'APONTAMENTO_SEMANA_EM_PLANEJAMENTO', 'P9 (3) apontamento em 09/11 recusado para QUALQUER produto');
select pg_temp.falha($$insert into escala_fechamento_aberturas (semana_inicio, data, periodo_id, aberto_por, valido_ate) values ('2026-11-09','2026-11-09','m1',(select id from usuarios limit 1), now()+interval '5 min')$$, 'FECHAMENTO_SEMANA_EM_PLANEJAMENTO', 'P10 (4) abertura de fechamento em 09/11 recusada');
-- 06/11 (LEGADO) continua aceitando as guardas de hoje (nenhum bloqueio fora do planejamento)
select pg_temp.ok(public.produto_unico_modo('2026-11-06') = 'LEGADO', 'P11 a guarda NÃO se aplica a 06/11');
-- unificar (soma, remove os 2 legados com backup) e REVERSÃO recusada com item único na Previsão
select public.produto_unico_converter_previsao(:'prev'::uuid, null, 'teste') as conv \gset
select pg_temp.ok((:'conv'::jsonb ->> 'quantidade')::numeric = 93300 and not exists (select 1 from previsao_itens where previsao_id=:'prev' and tipo='previsto' and produto_id in ('27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee')), 'P11b unificar: UM item de 93.300 e os 2 legados REMOVIDOS da Previsão (backup guardado)');
select pg_temp.falha($$select public.produto_unico_desabilitar_planejamento('t')$$, 'DESABILITAR_ABORTADO', 'P12 REVERSÃO recusada enquanto a Previsão tem o item único (nada alterado)');
select pg_temp.ok(public.produto_unico_modo('2026-11-09')='PLANEJAMENTO' and (select valor @> '"2026-11-09"' from escala_parametros where chave='producao_real_semanas_ativas'), 'P12b após a recusa o planejamento segue habilitado');
select public.produto_unico_reverter_previsao(:'prev'::uuid, 'teste') as sep \gset
select pg_temp.ok((select sum(quantidade) from previsao_itens where previsao_id=:'prev' and produto_id in ('27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee')) = 93300, 'P12c separar restaura os 2 itens legados do backup (64.800 + 28.500)');
-- desabilitar
select public.produto_unico_desabilitar_planejamento('teste') as des \gset
select pg_temp.ok((:'des'::jsonb ->> 'planejamento_anterior') = '2026-11-09' and public.produto_unico_modo('2026-11-09')='LEGADO', 'P13 desabilitar: volta a LEGADO');
select pg_temp.ok(not exists (select 1 from escala_parametros where chave in ('producao_real_semanas_ativas','producao_real_planejador_semanas') and valor @> '"2026-11-09"'), 'P14 desabilitar retira 09/11 das duas listas (só o que o habilitar acrescentou)');
select pg_temp.ok((select jsonb_agg(public.escala_periodo_liberacao(d::date, p) order by d, p)::text from generate_series('2026-11-02'::date,'2026-11-08'::date,'1 day') d, unnest(array['m1','m2','m3','t1','t2','t3']) p) = :'lib0', 'P15 após desabilitar a liberação volta ao que era');
select pg_temp.ok(pg_temp.snap2() = :'s0', 'P15b após habilitar -> unificar -> separar -> desabilitar o banco está IDÊNTICO ao de antes (parâmetros, produtos, pares de buffer, versões de plano, eventos)');
-- (8) precedência absoluta (re-habilita; os UPDATEs vão por último para não deixar eventos de gatilho pendentes antes dos ALTER TABLE internos)
select public.produto_unico_habilitar_planejamento('2026-11-09','teste2') as hab2 \gset
-- (8) precedência absoluta: nem escala_liberacao_desde, nem modo do fechamento mudam isso
update escala_parametros set valor='{"data":"2026-11-02","periodo":"m1"}' where chave='escala_liberacao_desde';
select pg_temp.ok(public.escala_periodo_liberacao('2026-11-09','m1')->>'motivo' = 'PLANO_FUTURO_AGUARDANDO_CUTOVER', 'P7 (8) escala_liberacao_desde movido para antes: 09/11 segue NÃO LIBERADO');
update escala_parametros set valor='"desligado"' where chave='escala_fechamento_fisico_modo';
select pg_temp.ok(public.escala_periodo_liberacao('2026-11-09','m1')->>'motivo' = 'PLANO_FUTURO_AGUARDANDO_CUTOVER', 'P8 (8) fechamento físico desligado: 09/11 segue NÃO LIBERADO (nada de MODO_NAO_ATIVO)');
rollback;

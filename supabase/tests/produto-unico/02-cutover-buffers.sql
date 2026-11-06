\i _ok.sql
\echo == 02 CUTOVER ON/OFF + BUFFERS + ROLLBACK (clone; cada bloco em transação com rollback)
-- helpers: buffers obrigatórios do fechamento numa data para o conjunto de produtos ativos na semana (mesma regra de buffersObrigatorios + carregarCatalogo)
create or replace function pg_temp.obrig(p_data date, p_prods uuid[]) returns int language sql stable as $$
  select count(distinct b.id)::int from escala_buffers_fisicos b join escala_buffer_pares bp on bp.buffer_id=b.id
   where b.ativo and bp.vigente_de <= p_data and (bp.vigente_ate is null or bp.vigente_ate >= p_data) and bp.produto_id = any(p_prods) $$;
create or replace function pg_temp.snap() returns text language sql stable as $$
  select md5(
    (select coalesce(string_agg(t::text,'~' order by t.id::text),'') from escala_buffer_pares t) || '|' ||
    (select coalesce(string_agg(t::text,'~' order by t::text),'') from escala_buffer_maquinas t) || '|' ||
    (select valor::text from escala_parametros where chave='produto_unico_cutover') || '|' ||
    (select ativo::text from produtos p join produto_canonico c on c.produto_id=p.id) || '|' ||
    (select coalesce(string_agg(t::text,'~' order by t.id::text),'') from produtos t where t.id in ('27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee'))) $$;

begin;
select pg_temp.snap() as h0 \gset
select count(*) as ev0 from escala_producao_eventos \gset
select pg_temp.ok(pg_temp.obrig('2026-11-09', array[(select produto_id from produto_canonico)]) = 0 and pg_temp.obrig('2026-11-06', array['27c229d7-f192-41eb-aad1-0c69ece53eba'::uuid,'a027ac97-ffd1-4834-8ed0-d3a94aac4aee'::uuid]) = 3,
  'C0 ANTES do cutover: legados pedem 3 buffers Conector; produto único não pede nenhum');
select pg_temp.ok(not public.produto_unico_ativo('2026-11-10'), 'C1 produto_unico_ativo(2026-11-10) = false com cutover null');
select pg_temp.falha($$select public.produto_unico_ativar('2026-11-10','t')$$, 'ATIVAR_CUTOVER_INVALIDO', 'C2 ativar numa terça é recusado');
select pg_temp.falha($$select public.produto_unico_ativar('2026-10-26','t')$$, 'ATIVAR_CUTOVER_INVALIDO', 'C3 ativar antes de 2026-11-02 é recusado');
select pg_temp.falha($$select public.produto_unico_ativar('2026-11-02','t')$$, 'ATIVAR_ABORTADO', 'C4 ativar numa semana que já tem apontamento legado é recusado');
select public.produto_unico_ativar('2026-11-09','teste') as ativ \gset
select pg_temp.ok((select valor from escala_parametros where chave='produto_unico_cutover') = '"2026-11-09"'::jsonb, 'C5 UMA flag: produto_unico_cutover = 2026-11-09');
select pg_temp.ok((select ativo from produtos p join produto_canonico c on c.produto_id=p.id), 'C6 produto único ATIVO após ativar');
select pg_temp.ok((select count(*) from escala_producao_eventos) = :ev0, 'C7 ativar NÃO dispara evento de recálculo');
select pg_temp.ok((select count(*) from escala_producao_eventos where status='pendente')=0, 'C7b nenhum evento pendente');
select pg_temp.ok(escala_plano_registrar('6be15af5-9659-4c12-ba33-9c1fae6d4065','baseline') is null, 'C7c HASH do plano da semana 02/11 idêntico com o cutover LIGADO (semana anterior não muda: nenhuma versão nova)');
select pg_temp.ok(public.produto_unico_ativo('2026-11-09') and public.produto_unico_ativo('2026-11-15') and not public.produto_unico_ativo('2026-11-08'), 'C8 produto_unico_ativo: 09/11..15/11 true, 08/11 false');
select pg_temp.ok((select count(*) from escala_buffer_pares where produto_id=(select produto_id from produto_canonico) and vigente_de='2026-11-09' and vigente_ate is null and papel='contabil')=4
   and not exists (select 1 from escala_buffer_pares where produto_id=(select produto_id from produto_canonico) and papel='zero'), 'D1 4 pares do produto único, todos contabil, vigente_de = cutover, nenhum par zero');
select pg_temp.ok((select count(*) from escala_buffer_pares where produto_id in ('27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee')) = 5 and not exists (select 1 from escala_buffer_pares where produto_id in ('27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee') and (vigente_ate is distinct from '2026-11-08')),
  'D2 5 pares legados encerrados na véspera (vigente_ate = 2026-11-08), nada apagado');
select pg_temp.ok(pg_temp.obrig('2026-11-09', array[(select produto_id from produto_canonico)]) = 3, 'D3 FECHAMENTO do produto único (09/11) pede EXATAMENTE 3 buffers Conector',
   (select string_agg(chave, ', ' order by ordem) from (select distinct b.chave, b.ordem from escala_buffers_fisicos b join escala_buffer_pares bp on bp.buffer_id=b.id where bp.produto_id=(select produto_id from produto_canonico)) z));
select pg_temp.ok(pg_temp.obrig('2026-11-09', array['27c229d7-f192-41eb-aad1-0c69ece53eba'::uuid,'a027ac97-ffd1-4834-8ed0-d3a94aac4aee'::uuid]) = 0 and pg_temp.obrig('2026-11-06', array['27c229d7-f192-41eb-aad1-0c69ece53eba'::uuid,'a027ac97-ffd1-4834-8ed0-d3a94aac4aee'::uuid]) = 3,
   'D4 legados: 0 buffers em 09/11 (escondidos), 3 em 06/11 (semana anterior segue como hoje)');
select pg_temp.ok((select count(*) from escala_buffer_pares bp join escala_buffers_fisicos b on b.id=bp.buffer_id where b.chave='conector34:parafusadas' and bp.produto_id=(select produto_id from produto_canonico))=2
  and (select count(*) from escala_buffer_pares bp join escala_buffers_fisicos b on b.id=bp.buffer_id where b.chave in ('conector34:rosqueadas','conector34:etiquetadas') and bp.produto_id=(select produto_id from produto_canonico))=2, 'D5 buffer parafusadas tem 2 pares (Parafusar>Etiquetar e M8>Etiquetar); rosqueadas e etiquetadas 1 cada');
select pg_temp.ok((select count(*) from escala_buffer_maquinas bm join escala_buffers_fisicos b on b.id=bm.buffer_id join maquinas m on m.id=bm.maquina_id where b.chave='conector34:parafusadas' and bm.papel='produz' and (m.id = 'a118f430-f854-4e89-9e3c-ce6fcbbc52cf' or m.nome in ('Parafusadeira 9','Parafusadeira 10','Parafusadeira 11','Parafusadeira 12')))=5
   and (select count(*) from escala_buffer_maquinas bm join escala_buffers_fisicos b on b.id=bm.buffer_id where b.chave like 'conector34:%')=17, 'D6 escala_buffer_maquinas coerente (parafusadas: M8+Parafusadeiras 9-12 produzem; total conector34 = 17 linhas, as mesmas de hoje)');
-- guardas: legados escondidos / canônico só a partir do cutover
select pg_temp.falha($$insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) select id,'previsto','27c229d7-f192-41eb-aad1-0c69ece53eba','x',0.18,1 from previsoes where semana_inicio='2026-11-09'$$, 'PRODUTO_LEGADO_APOS_CUTOVER', 'G1 item LEGADO "previsto" na semana 09/11 é recusado após o cutover');
select pg_temp.falha($$insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) select id,'previsto',(select produto_id from produto_canonico),'x',0.18,1 from previsoes where semana_inicio='2026-11-02'$$, 'PRODUTO_CANONICO_ANTES_DO_CUTOVER', 'G2 item do produto único na semana 02/11 é recusado');
select pg_temp.ok((select count(*) from (select 1 from previsao_itens i join previsoes p on p.id=i.previsao_id where p.semana_inicio='2026-11-02' and i.produto_id in ('27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee')) z) = 2, 'G3 semana 02/11 continua com os 2 itens legados (histórico intacto)');
-- item do produto único aceito na semana 09/11 (soma explícita feita por quem usa a Previsão)
insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) select id,'previsto',(select produto_id from produto_canonico),'Conector 3/4',0.1825,93300 from previsoes where semana_inicio='2026-11-09';
select pg_temp.ok((select quantidade from previsao_itens where produto_id=(select produto_id from produto_canonico))=93300, 'G4 item único 93.300 aceito na semana 09/11');
-- rollback RECUSADO com item na Previsão
select pg_temp.falha($$select public.produto_unico_desativar('t')$$, 'DESATIVAR_ABORTADO', 'RB1 desativar recusa enquanto a Previsão tem o item do produto único (nada alterado)');
select pg_temp.ok((select valor from escala_parametros where chave='produto_unico_cutover') = '"2026-11-09"'::jsonb, 'RB1b após a recusa o cutover continua ligado (nada foi apagado)');
delete from previsao_itens where produto_id=(select produto_id from produto_canonico);
select public.produto_unico_ativar('2026-11-09','teste2') as ativ2 \gset
select pg_temp.ok((:'ativ2'::jsonb ->> 'ja_ativo')::boolean, 'C9 ativar de novo com o mesmo cutover é idempotente');
select pg_temp.falha($$select public.produto_unico_ativar('2026-11-16','t')$$, 'ATIVAR_JA_ATIVO_COM_OUTRO_CUTOVER', 'C10 ativar com outro cutover exige desativar antes');
select public.produto_unico_desativar('teste') as des \gset
select pg_temp.ok(pg_temp.snap() = :'h0', 'RB2 ROLLBACK sem uso: catálogo de buffers, parâmetro, produto e legados IDÊNTICOS ao de antes (hash)');
select pg_temp.ok((select count(*) from escala_producao_eventos) = :ev0, 'RB3 rollback não gerou evento de recálculo');
select pg_temp.ok((:'des'::jsonb ->> 'modo') = 'limpo', 'RB4 modo do rollback = limpo');
select pg_temp.ok(not public.produto_unico_ativo('2026-11-10') and pg_temp.obrig('2026-11-10', array['27c229d7-f192-41eb-aad1-0c69ece53eba'::uuid]) = 3, 'RB5 após rollback: legados voltam a pedir 3 buffers e a programação usa os legados');
-- ciclo completo ativar -> desativar -> ativar -> desativar (refaz sem erro)
select public.produto_unico_ativar('2026-11-09','c1') as a1 \gset
select public.produto_unico_desativar('c1') as d1 \gset
select public.produto_unico_ativar('2026-11-09','c2') as a2 \gset
select pg_temp.ok((:'a2'::jsonb ->> 'pares_novos')::int = 4 and pg_temp.obrig('2026-11-09', array[(select produto_id from produto_canonico)]) = 3, 'RB6 ativar -> desativar -> ativar refaz o estado (4 pares, 3 buffers)');
select public.produto_unico_desativar('c2') as d2 \gset
select pg_temp.ok(pg_temp.snap() = :'h0', 'RB7 ... e desativar de novo volta ao hash original');
rollback;

\echo -- ROLLBACK COM DADOS NOVOS (fechamento + apontamento do produto único): nada é apagado
begin;
select pg_temp.snap() as h0 \gset
select public.produto_unico_ativar('2026-11-09','teste') as ativ \gset
-- fechamento físico simulado sob o produto único (09/11 m1): 3 buffers, buffer parafusadas = 5000
with f as (
  insert into escala_fechamentos (semana_inicio, data, periodo_id, tipo, revisao, iniciado_em, contado_em, instante_motor, postos_esperados, postos_coletados, buffers_obrigatorios, resumo_producao, hash_resumo, chave_idempotencia, excecao)
  values ('2026-11-09','2026-11-09','m1','abertura',1, now(), now(), '2026-11-09T09:00:00-03:00', 0,0,3,'{}','h', gen_random_uuid(), false) returning id)
insert into escala_fechamento_buffers (fechamento_id, buffer_id, saldo_estimado, saldo_fisico, motivo)
  select f.id, b.id, 0, case b.chave when 'conector34:rosqueadas' then 3000 when 'conector34:parafusadas' then 5000 else 2000 end, 'teste' from f, escala_buffers_fisicos b where b.chave like 'conector34:%';
select pg_temp.ok((select sum(saldo) from escala_contagens_fechamento_para_motor where data='2026-11-09' and "produtoId"=(select produto_id from produto_canonico) and "etapaSeguinteId" in (select etapa_id from produto_canonico_etapas ce join roteiro_etapas e on e.id=ce.etapa_id join operacoes o on o.id=e.operacao_id where o.nome='Etiquetar')) = 5000,
  'V1 view de contagens do motor: buffer "parafusadas" (2 pares contabil) entrega 5.000 UMA vez (não 10.000)',
  (select string_agg(o.nome||'='||saldo, ', ') from escala_contagens_fechamento_para_motor v join roteiro_etapas e on e.id=v."etapaOrigemId" join operacoes o on o.id=e.operacao_id where v.data='2026-11-09'));
select pg_temp.ok((select saldo from escala_contagens_fechamento_para_motor v join roteiro_etapas e on e.id=v."etapaOrigemId" join operacoes o on o.id=e.operacao_id where v.data='2026-11-09' and o.nome='Rosquear + Parafusar')=0 and
   (select saldo from escala_contagens_fechamento_para_motor v join roteiro_etapas e on e.id=v."etapaOrigemId" join operacoes o on o.id=e.operacao_id where v.data='2026-11-09' and o.nome='Parafusar')=5000, 'V2 o par Parafusar>Etiquetar leva o saldo; o par M8>Etiquetar leva 0 (regra da view; TS deve espelhar)');
select pg_temp.ok((select saldo from escala_contagens_fechamento_para_motor v join roteiro_etapas e on e.id=v."etapaOrigemId" join operacoes o on o.id=e.operacao_id where v.data='2026-11-09' and o.nome='Rosquear')=3000 and
   (select saldo from escala_contagens_fechamento_para_motor v join roteiro_etapas e on e.id=v."etapaOrigemId" join operacoes o on o.id=e.operacao_id where v.data='2026-11-09' and o.nome='Etiquetar')=2000, 'V3 rosqueadas=3.000 e etiquetadas=2.000 (A, B, C físicos)');
select count(*) as nf0 from escala_fechamentos where data >= '2026-11-09' \gset
select public.produto_unico_desativar('com-dados') as des \gset
select pg_temp.ok((:'des'::jsonb ->> 'modo') = 'preservando_dados' and (:'des'::jsonb ->> 'legados_reabrem_em') = '2026-11-10', 'RB8 com fechamento sob o produto único: modo preservando_dados, legados reabrem em 10/11');
select pg_temp.ok((select count(*) from escala_fechamentos where data >= '2026-11-09') = :nf0 and (select count(*) from escala_fechamento_buffers) >= 3, 'RB9 fechamentos e contagens novas PRESERVADOS');
select pg_temp.ok((select count(*) from escala_buffer_pares where produto_id=(select produto_id from produto_canonico) and vigente_ate='2026-11-09') = 4, 'RB10 pares do produto único NÃO apagados: encerrados em 09/11 (último fechamento)');
select pg_temp.ok(pg_temp.obrig('2026-11-10', array['27c229d7-f192-41eb-aad1-0c69ece53eba'::uuid]) = 3 and pg_temp.obrig('2026-11-10', array[(select produto_id from produto_canonico)]) = 0
   and pg_temp.obrig('2026-11-09', array[(select produto_id from produto_canonico)]) = 3, 'RB11 buffers: 09/11 ainda pelo produto único (3); a partir de 10/11 pelos legados (3)');
select pg_temp.ok((select valor from escala_parametros where chave='produto_unico_cutover') = 'null'::jsonb and not public.produto_unico_ativo('2026-11-10'), 'RB12 cutover = null e legados de volta à programação');
-- contagens do passado continuam legíveis
select pg_temp.ok((select count(*) from escala_contagens_fechamento_para_motor where data='2026-11-09') = 4, 'RB13 contagem do fechamento de 09/11 segue entregue ao motor (4 pares)');
rollback;

\echo -- VIEW de contagens IDÊNTICA com o catálogo atual (sem produto único): compara com a definição original
begin;
create temp view v_orig as
  select distinct on (bp.produto_id, bp.etapa_origem_id, bp.etapa_seguinte_id)
    bp.produto_id as "produtoId", bp.etapa_origem_id as "etapaOrigemId", bp.etapa_seguinte_id as "etapaSeguinteId",
    case when bp.papel = 'contabil' then fb.saldo_fisico else 0 end as saldo,
    f.instante_motor as "contadoEm", f.fechado_por as "informadoPor", f.id as fechamento_id, f.data, f.periodo_id, f.revisao, f.fechado_em
  from public.escala_fechamentos_vigentes f
  join public.escala_fechamento_buffers fb on fb.fechamento_id = f.id and fb.saldo_fisico is not null
  join public.escala_buffer_pares bp on bp.buffer_id = fb.buffer_id and f.data >= bp.vigente_de and (bp.vigente_ate is null or f.data <= bp.vigente_ate)
  order by bp.produto_id, bp.etapa_origem_id, bp.etapa_seguinte_id, f.instante_motor desc, f.fechado_em desc;
select pg_temp.ok((select count(*) from v_orig) = (select count(*) from escala_contagens_fechamento_para_motor)
  and not exists ((select * from v_orig except select * from escala_contagens_fechamento_para_motor) union all (select * from escala_contagens_fechamento_para_motor except select * from v_orig)),
  'V0 view escala_contagens_fechamento_para_motor devolve as MESMAS linhas que a original (' || (select count(*) from v_orig) || ' linhas, dados reais de PROD)');
rollback;

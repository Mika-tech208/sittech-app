\i _ok.sql
\echo == 01 ESTRUTURA + BACKFILL (clone; tudo em transação com rollback)
begin;
select pg_temp.ok((select count(*) from information_schema.tables where table_schema='public' and table_name in ('produto_canonico','produto_rotas','produto_canonico_etapas','produto_canonico_arestas','produto_legado_mapa','etapa_legado_mapa','produto_canonico_ativacoes','produto_unico_conversoes')) = 8, 'S1 8 tabelas novas existem');
select pg_temp.ok((select valor = 'null'::jsonb from escala_parametros where chave='produto_unico_cutover'), 'S2 produto_unico_cutover = null (sem cutover)');
select pg_temp.ok((select count(*) from produto_canonico where codigo='CONECTOR_3_4_UNICO') = 1, 'S3 produto CONECTOR_3_4_UNICO criado (1)');
select pg_temp.ok((select not ativo from produtos p join produto_canonico c on c.produto_id=p.id), 'S4 produto único nasce INATIVO (invisível a apontamento/previsão até o cutover)');
select pg_temp.ok((select produto_id from produto_canonico) not in ('27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee'), 'S5 id NOVO (não reutiliza ids legados)');
select pg_temp.ok((select string_agg(o.nome||':'||e.ordem, ',' order by e.ordem) from roteiro_etapas e join operacoes o on o.id=e.operacao_id where e.produto_id=(select produto_id from produto_canonico)) = 'Rosquear + Parafusar:0,Rosquear:1,Parafusar:2,Etiquetar:3,Embalar:4', 'S6 etapas: M8 "Rosquear + Parafusar" 0, Rosquear 1, Parafusar 2, Etiquetar 3, Embalar 4 (Etiquetar/Embalar UMA vez)',
  (select string_agg(o.nome||':'||e.ordem, ',' order by e.ordem) from roteiro_etapas e join operacoes o on o.id=e.operacao_id where e.produto_id=(select produto_id from produto_canonico)));
-- elegibilidade e metas iguais às dos legados, por operação
with u as (select o.nome op, e.id, e.meta_m1,e.meta_m2,e.meta_m3,e.meta_t1,e.meta_t2,e.meta_t3 from roteiro_etapas e join operacoes o on o.id=e.operacao_id where e.produto_id=(select produto_id from produto_canonico)),
     l as (select o.nome op, e.id, e.meta_m1,e.meta_m2,e.meta_m3,e.meta_t1,e.meta_t2,e.meta_t3 from roteiro_etapas e join operacoes o on o.id=e.operacao_id
            where (e.produto_id='27c229d7-f192-41eb-aad1-0c69ece53eba' and o.nome in ('Rosquear','Parafusar','Etiquetar','Embalar')) or (e.produto_id='a027ac97-ffd1-4834-8ed0-d3a94aac4aee' and o.nome='Rosquear + Parafusar'))
select pg_temp.ok((select count(*) from u join l on l.op=u.op where (u.meta_m1,u.meta_m2,u.meta_m3,u.meta_t1,u.meta_t2,u.meta_t3) is not distinct from (l.meta_m1,l.meta_m2,l.meta_m3,l.meta_t1,l.meta_t2,l.meta_t3)
    and not exists ((select maquina_id from roteiro_etapa_maquinas where etapa_id=u.id except select maquina_id from roteiro_etapa_maquinas where etapa_id=l.id) union all (select maquina_id from roteiro_etapa_maquinas where etapa_id=l.id except select maquina_id from roteiro_etapa_maquinas where etapa_id=u.id))) = 5,
  'S7 metas copiadas e máquinas elegíveis por etapa IGUAIS às dos legados (5/5 etapas)');
select pg_temp.ok((select count(*) from produto_rotas) = 2 and (select count(*) from produto_canonico_arestas)=4, 'S8 2 rotas (CONVENCIONAL, AUTOMATICA) e 4 arestas do grafo');
select pg_temp.ok((select string_agg(oo.nome||'>'||od.nome, ', ' order by oo.nome, od.nome) from produto_canonico_arestas a join roteiro_etapas eo on eo.id=a.origem_etapa_id join operacoes oo on oo.id=eo.operacao_id join roteiro_etapas ed on ed.id=a.destino_etapa_id join operacoes od on od.id=ed.operacao_id)
  = 'Etiquetar>Embalar, Parafusar>Etiquetar, Rosquear>Parafusar, Rosquear + Parafusar>Etiquetar', 'S9 grafo: Rosquear>Parafusar>Etiquetar, M8>Etiquetar, Etiquetar>Embalar');
select pg_temp.ok((select count(*) from produto_legado_mapa)=2 and (select count(*) from etapa_legado_mapa)=7, 'S10 mapa legado->canônico: 2 produtos, 7 etapas');
select pg_temp.ok(not exists (select 1 from produto_canonico_problemas((select produto_id from produto_canonico))), 'S11 produto_canonico_problemas vazio (máquina em 1 etapa só, grafo íntegro)');
select pg_temp.ok((select count(*) from produtos where id in ('27c229d7-f192-41eb-aad1-0c69ece53eba','a027ac97-ffd1-4834-8ed0-d3a94aac4aee') and ativo)=2, 'S12 legados intactos e ainda ativos (só histórico/retroativo)');
select pg_temp.ok((select count(*) from escala_producao_eventos where status='pendente')=0, 'S13 backfill/migrations não geraram evento de recálculo');
-- idempotência do backfill
create temp table _antes as select (select produto_id from produto_canonico) pid, (select count(*) from roteiro_etapas) e, (select count(*) from produtos) p, (select count(*) from produto_canonico_ativacoes) a;
\i ../../ops/produto-unico/10-backfill-conector-unico.sql
select pg_temp.ok((select pid from _antes)=(select produto_id from produto_canonico) and (select e from _antes)=(select count(*) from roteiro_etapas) and (select p from _antes)=(select count(*) from produtos) and (select a from _antes)=(select count(*) from produto_canonico_ativacoes), 'B1 backfill reexecutado é idempotente (mesmo id, nenhuma linha nova)');
-- resolução máquina+produto -> etapa (usada por registrar_apontamento_producao_core / regularização)
select pg_temp.ok((select count(*) from produto_canonico_etapas ce join roteiro_etapa_maquinas rem on rem.etapa_id=ce.etapa_id group by rem.maquina_id having count(*)>1 limit 1) is null, 'R0 nenhuma máquina elegível em 2 etapas do produto único');
select pg_temp.ok((select o.nome from rota_da_maquina((select produto_id from produto_canonico),(select id from maquinas where id='a118f430-f854-4e89-9e3c-ce6fcbbc52cf')) r join roteiro_etapas e on e.id=r.etapa_id join operacoes o on o.id=e.operacao_id)='Rosquear + Parafusar', 'R1 M8 -> etapa "Rosquear + Parafusar"');
select pg_temp.ok((select o.nome from rota_da_maquina((select produto_id from produto_canonico),(select id from maquinas where nome='Parafusadeira 9')) r join roteiro_etapas e on e.id=r.etapa_id join operacoes o on o.id=e.operacao_id)='Parafusar', 'R2 Parafusadeira 9 -> etapa "Parafusar"');
select pg_temp.ok((select o.nome from rota_da_maquina((select produto_id from produto_canonico),(select id from maquinas where nome='Etiquetadora 15')) r join roteiro_etapas e on e.id=r.etapa_id join operacoes o on o.id=e.operacao_id)='Etiquetar'
  and (select o.nome from rota_da_maquina((select produto_id from produto_canonico),(select id from maquinas where nome='Embalagem 17')) r join roteiro_etapas e on e.id=r.etapa_id join operacoes o on o.id=e.operacao_id)='Embalar', 'R3 Etiquetadora 15 -> Etiquetar; Embalagem 17 -> Embalar');
-- negativos
select pg_temp.falha($$update escala_parametros set valor='"2026-11-10"' where chave='produto_unico_cutover'$$, 'escala_parametros_produto_unico_cutover', 'N1 cutover que não é segunda-feira é recusado');
select pg_temp.falha($$delete from produto_canonico_ativacoes$$, 'append-only', 'N2 trilha de ativações é append-only');
select pg_temp.falha($$delete from produtos where id=(select produto_id from produto_canonico)$$, 'violates foreign key', 'N3 produto único referenciado não pode ser excluído (RESTRICT)');
rollback;

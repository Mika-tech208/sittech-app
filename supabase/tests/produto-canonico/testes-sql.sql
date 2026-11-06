\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP off
-- T1 (H): a visão canônica de alocações preserva peças, pessoas e máquinas da semana 02/11
select 'H1 pecas legado='||(select sum(pecas) from escala_producao_alocacoes where data>='2026-11-02' and maquina_id is not null)||' canonico='||(select sum(pecas) from vw_alocacoes_canonicas where data>='2026-11-02' and maquina_id is not null) ||
  case when (select sum(pecas) from escala_producao_alocacoes where data>='2026-11-02' and maquina_id is not null)=(select sum(pecas) from vw_alocacoes_canonicas where data>='2026-11-02' and maquina_id is not null) then ' PASS' else ' FAIL' end;
select 'H2 pessoas-periodos legado='||(select count(distinct (data,periodo_id,funcionario_id)) from escala_producao_alocacoes where data>='2026-11-02' and maquina_id is not null)||' canonico='||(select count(distinct (data,periodo_id,funcionario_id)) from vw_alocacoes_canonicas where data>='2026-11-02' and maquina_id is not null) ||
  case when (select count(distinct (data,periodo_id,funcionario_id)) from escala_producao_alocacoes where data>='2026-11-02' and maquina_id is not null)=(select count(distinct (data,periodo_id,funcionario_id)) from vw_alocacoes_canonicas where data>='2026-11-02' and maquina_id is not null) then ' PASS' else ' FAIL' end;
select 'H3 maquinas-periodos legado='||(select count(distinct (data,periodo_id,maquina_id)) from escala_producao_alocacoes where data>='2026-11-02' and maquina_id is not null)||' canonico='||(select count(distinct (data,periodo_id,maquina_id)) from vw_alocacoes_canonicas where data>='2026-11-02' and maquina_id is not null) ||
  case when (select count(distinct (data,periodo_id,maquina_id)) from escala_producao_alocacoes where data>='2026-11-02' and maquina_id is not null)=(select count(distinct (data,periodo_id,maquina_id)) from vw_alocacoes_canonicas where data>='2026-11-02' and maquina_id is not null) then ' PASS' else ' FAIL' end;
select 'H4 linhas sem posto preservadas: legado='||(select count(*) from escala_producao_alocacoes where maquina_id is null)||' canonico='||(select count(*) from vw_alocacoes_canonicas where maquina_id is null)
  ||case when (select count(*) from escala_producao_alocacoes where maquina_id is null)=(select count(*) from vw_alocacoes_canonicas where maquina_id is null) then ' PASS' else ' FAIL' end;
-- Etiquetadora 15: UMA linha canônica por (posto, período) com a soma Conv+Auto (3000 = 1800 + 1200), sem produto Automática separado
select 'H5 Etiquetadora 15 canonica: linhas='||count(*)||' pecas/linha='||min(pecas)||'..'||max(pecas)||' distintos produtos canonicos='||count(distinct produto_canonico_id)||
  case when count(*)=24 and min(pecas)=3000 and max(pecas)=3000 and count(distinct produto_canonico_id)=1 then ' PASS' else ' FAIL' end
  from vw_alocacoes_canonicas where maquina_id='49472af4-f5af-4427-992b-17a3f00a6c38';
-- T2 (G): histórico de apontamentos intacto e legível; produção final = SÓ Embalagem (sem dupla contagem do M8)
select 'G1 apontamentos: linhas na visão='||count(*)||' linhas na tabela='||(select count(*) from apontamentos_producao)||case when count(*)=(select count(*) from apontamentos_producao) then ' PASS' else ' FAIL' end from vw_apontamentos_canonicos;
select 'G2 final=Embalagem: conta_como_final soma='||sum(quantidade_boa) filter (where conta_como_final)||' (esperado Embalagem 17 = '||(select sum(quantidade_produzida) from apontamentos_producao where etapa_id='b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4')||') M8 como WIP='||sum(quantidade_boa) filter (where papel='ROTA' and rota_id is not null and produto_registrado_id='a027ac97-ffd1-4834-8ed0-d3a94aac4aee')
  ||case when sum(quantidade_boa) filter (where conta_como_final)=(select sum(quantidade_produzida) from apontamentos_producao where etapa_id='b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4') then ' PASS' else ' FAIL' end from vw_apontamentos_canonicos;
select 'G3 Conv e Auto continuam legiveis como registrados: '||string_agg(p.nome||'='||c, ' | ' order by p.nome)||case when count(*)=2 then ' PASS' else ' FAIL' end
  from (select produto_registrado_id, count(*) c from vw_apontamentos_canonicos group by 1) x join produtos p on p.id=x.produto_registrado_id;
select 'G4 legado identico apos backfill: ver fingerprint (apontamentos/alocacoes/dias/previsao inalterados)';
-- T3 resolvedores
select 'R1 produto_canonico_de(Auto)='||(select produto_canonico_id::text||' rota='||rota_id::text||' '||tipo_entrada from produto_canonico_de('a027ac97-ffd1-4834-8ed0-d3a94aac4aee'))
  ||case when (select rota_id from produto_canonico_de('a027ac97-ffd1-4834-8ed0-d3a94aac4aee')) = (select id from produto_rotas where codigo='AUTOMATICA') then ' PASS' else ' FAIL' end;
select 'R2 produto_canonico_de(canonico) idempotente: '||(select tipo_entrada from produto_canonico_de((select produto_id from produto_canonico)))||' / fora: '||(select tipo_entrada from produto_canonico_de('238ca607-2111-4aff-9a19-a9ae6f20da7e'));
select 'R3 rota_da_maquina(Parafusadeira 9)='||(select pr.codigo||'/'||r.papel from rota_da_maquina((select produto_id from produto_canonico),'ddb9fd47-614d-467a-980f-88b4b89c708c') r join produto_rotas pr on pr.id=r.rota_id)
  ||' | M8='||(select pr.codigo from rota_da_maquina((select produto_id from produto_canonico),'a118f430-f854-4e89-9e3c-ce6fcbbc52cf') r join produto_rotas pr on pr.id=r.rota_id)
  ||' | Etiquetadora 15 rota='||(select coalesce(rota_id::text,'(comum)')||'/'||papel from rota_da_maquina((select produto_id from produto_canonico),'49472af4-f5af-4427-992b-17a3f00a6c38'));
select 'R4 cutover: ativo(2026-11-03)='||produto_unico_ativo('2026-11-03')||' (esperado false, cutover null)';
-- T4 validações negativas (cada uma deve FALHAR)
select 'N1 etapa de outro produto no canonico:';
insert into produto_canonico_etapas (etapa_id, produto_id, papel, rota_id) values ('ca90456c-9077-40f4-a058-bd0f467e87ec', (select produto_id from produto_canonico), 'COMUM', null);
select 'N2 segundo FINAL:';
insert into produto_canonico_etapas (etapa_id, produto_id, papel) select id, produto_id, 'FINAL' from roteiro_etapas where produto_id=(select produto_id from produto_canonico) and ordem=3;
select 'N3 cutover nao-segunda:';
update escala_parametros set valor='"2026-11-03"' where chave='produto_unico_cutover';
select 'N4 cutover antes de 2026-11-02:';
update escala_parametros set valor='"2026-10-26"' where chave='produto_unico_cutover';
select 'N5 ativacoes append-only:';
delete from produto_canonico_ativacoes;
select 'N6 mapa legado com operacao diferente:';
insert into etapa_legado_mapa (etapa_legado_id, etapa_canonica_id, produto_legado_id) values ('ca90456c-9077-40f4-a058-bd0f467e87ec', (select etapa_canonica_id from etapa_legado_mapa where etapa_legado_id='34371af3-2608-42cc-9ded-1f7815a635a8'), '27c229d7-f192-41eb-aad1-0c69ece53eba');
select 'N7 aresta criando ciclo detectado por produto_canonico_problemas:';
begin;
insert into produto_canonico_arestas select (select etapa_id from produto_canonico_etapas where papel='COMUM'), (select a.origem_etapa_id from produto_canonico_arestas a where a.destino_etapa_id=(select etapa_id from produto_canonico_etapas where papel='COMUM') limit 1);
select 'N7 problemas='||string_agg(p, '; ') from produto_canonico_problemas((select produto_id from produto_canonico)) p;
rollback;
select 'N8 deletar produto canonico referenciado pelo mapa (RESTRICT):';
delete from produtos where id=(select produto_id from produto_canonico);
select 'N9 deletar produto legado mapeado (RESTRICT; ja era bloqueado por apontamentos):';
delete from produtos where id='a027ac97-ffd1-4834-8ed0-d3a94aac4aee';
-- T5 backfill nao dispara evento de Escala
select 'E1 eventos de Escala gerados por F0+F1: '||count(*)||case when count(*)=0 then ' PASS' else ' FAIL' end from escala_producao_eventos;

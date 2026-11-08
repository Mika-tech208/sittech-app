-- TESTE (clone): produto encerrado na semana. Transação única desfeita no final. Saída: 'TESTE|OK|...' / 'TESTE|FALHA|...'.
begin;
create temp table _r(ord int, ok boolean, nome text);
grant all on _r to public;
create or replace function pg_temp.t(p_nome text, p_ok boolean) returns void language plpgsql as $$ begin insert into _r values ((select coalesce(max(ord),0)+1 from _r), coalesce(p_ok,false), p_nome); raise notice 'TESTE|%|%', case when coalesce(p_ok,false) then 'OK' else 'FALHA' end, p_nome; end $$;
create or replace function pg_temp.erro_de(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create temp table _c as select
  (select id from public.previsoes where semana_inicio = '2026-11-02') as prev,
  (select id from public.produtos where nome = 'Pino') as pino,
  (select id from public.produtos where nome = 'Plug Macho ') as plug,
  (select id from public.produtos where nome = 'Caixa Amarela 4x2') as c4x2,
  (select auth_user_id from public.usuarios where papel = 'admin' and ativo order by nome limit 1) as admin_auth,
  (select auth_user_id from public.usuarios where nome = 'Clarice') as clarice_auth,
  (select count(*) from public.apontamentos_producao) as apontamentos;
grant all on _c to public;
select pg_temp.t('pré: Pino ativo na semana 02/11 com demanda', (select quantidade from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto') = 43200);

-- dados recuperados da 4x2
select pg_temp.t('4x2: meta ORIGINAL 56.400 recuperada e item com demanda 0 (o motor continua lendo 0)',
  (select quantidade_original from public.previsao_encerramentos where previsao_id = (select prev from _c) and produto_id = (select c4x2 from _c) and reaberto_em is null) = 56400
  and (select quantidade from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select c4x2 from _c) and tipo = 'previsto') = 0);

-- admin encerra o Pino
select set_config('request.jwt.claims', json_build_object('sub', (select admin_auth::text from _c), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select admin_auth::text from _c), true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.previsao_produto_encerrar((select prev from _c), (select pino from _c), 'teste');
  perform pg_temp.t('ENCERRAR guarda a meta original (43.200) e zera demanda e adicional do item', (r ->> 'quantidade_original')::numeric = 43200
    and (select quantidade from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto') = 0
    and (select coalesce(quantidade_adicional, 0) from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto') = 0);
  update public.previsao_itens set quantidade = 5000, quantidade_adicional = 1000 where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto';
  perform pg_temp.t('GATILHO: tentar reativar a quantidade/adicional (UPDATE) continua em 0/0', (select quantidade from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto') = 0
    and (select quantidade_adicional from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto') = 0);
end $$;
-- "salvar" da Previsão reenviando o Pino com 5.000 + adicional 1.000
do $$ declare v_payload jsonb; v_id uuid; begin
  select jsonb_agg(jsonb_build_object('id', i.id, 'produto_id', i.produto_id, 'produto_nome', i.produto_nome, 'valor_unitario', i.valor_unitario,
         'quantidade', case when i.produto_id = (select pino from _c) then 5000 else i.quantidade end,
         'quantidade_adicional', case when i.produto_id = (select pino from _c) then 1000 else coalesce(i.quantidade_adicional, 0) end, 'maquinas_por_etapa', '{}'::jsonb))
    into v_payload from public.previsao_itens i where i.previsao_id = (select prev from _c) and i.tipo = 'previsto';
  v_id := public.upsert_previsao_semana('2026-11-02', v_payload, null, null);
  perform pg_temp.t('SALVAR a Previsão reenviando o produto com demanda NÃO reativa: continua 0/0 e a meta original fica intacta',
    (select quantidade from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto') = 0
    and (select coalesce(quantidade_adicional, 0) from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto') = 0
    and (select quantidade_original from public.previsao_encerramentos where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and reaberto_em is null) = 43200);
  perform pg_temp.t('SALVAR não altera os demais itens (4x4 segue com 10.000)', (select quantidade from public.previsao_itens where previsao_id = (select prev from _c) and produto_nome = 'Caixa Amarela 4x4' and tipo = 'previsto') = 10000);
exception when others then perform pg_temp.t('SALVAR a Previsão: ' || sqlerrm, false); end $$;
do $$ declare e text; begin
  insert into public.previsao_item_adicional_etapa (item_id, etapa_id, quantidade, atualizado_por)
  select i.id, re.id, 500, null from public.previsao_itens i join public.roteiro_etapas re on re.produto_id = i.produto_id where i.previsao_id = (select prev from _c) and i.produto_id = (select pino from _c) and i.tipo = 'previsto' limit 1;
  perform pg_temp.t('adicional POR ETAPA de produto encerrado nunca é gravado', (select count(*) from public.previsao_item_adicional_etapa a join public.previsao_itens i on i.id = a.item_id where i.previsao_id = (select prev from _c) and i.produto_id = (select pino from _c)) = 0);
exception when others then perform pg_temp.t('adicional por etapa: ' || sqlerrm, false); end $$;
select pg_temp.t('encerrar duas vezes é recusado (PREVISAO_PRODUTO_JA_ENCERRADO)', coalesce(pg_temp.erro_de(format($q$select public.previsao_produto_encerrar(%L, %L, 'x')$q$, (select prev from _c), (select pino from _c))), '') like 'PREVISAO_PRODUTO_JA_ENCERRADO%');
select pg_temp.t('produto sem item na semana é recusado (PREVISAO_PRODUTO_SEM_ITEM)', coalesce(pg_temp.erro_de(format($q$select public.previsao_produto_encerrar(%L, (select id from public.produtos where nome = 'Embalar Macho '), 'x')$q$, (select prev from _c))), '') like 'PREVISAO_PRODUTO_SEM_ITEM%');
select pg_temp.t('escrita direta na tabela de encerramentos é negada ao usuário comum (só pelas RPCs)', coalesce(pg_temp.erro_de(format($q$insert into public.previsao_encerramentos (previsao_id, produto_id, quantidade_original) values (%L, %L, 1)$q$, (select prev from _c), (select plug from _c))), '') like '%permission denied%');
select pg_temp.t('leitura dos encerramentos funciona para usuário autenticado', (select count(*) from public.previsao_encerramentos) >= 2);
reset role;

-- sem permissão 'previsao'
select set_config('request.jwt.claims', json_build_object('sub', (select clarice_auth::text from _c), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select clarice_auth::text from _c), true);
set local role authenticated;
select pg_temp.t('usuário SEM a permissão Previsão não encerra produto', coalesce(pg_temp.erro_de(format($q$select public.previsao_produto_encerrar(%L, %L, 'x')$q$, (select prev from _c), (select plug from _c))), '') like 'PREVISAO_ENCERRAR_SEM_PERMISSAO%');
select pg_temp.t('usuário não-admin não reabre', coalesce(pg_temp.erro_de(format($q$select public.previsao_produto_reabrir(%L, %L)$q$, (select prev from _c), (select pino from _c))), '') like 'PREVISAO_REABRIR_SOMENTE_ADMIN%');
reset role;

-- admin reabre: restaura a meta e o gatilho deixa de forçar 0
select set_config('request.jwt.claims', json_build_object('sub', (select admin_auth::text from _c), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select admin_auth::text from _c), true);
set local role authenticated;
do $$ begin
  perform public.previsao_produto_reabrir((select prev from _c), (select pino from _c));
  perform pg_temp.t('REABRIR (admin) devolve a meta original ao item e carimba a reabertura', (select quantidade from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto') = 43200
    and (select reaberto_em is not null from public.previsao_encerramentos where previsao_id = (select prev from _c) and produto_id = (select pino from _c) order by encerrado_em desc limit 1));
  update public.previsao_itens set quantidade = 1000 where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto';
  perform pg_temp.t('depois de reaberto o gatilho NÃO força mais 0 (produto volta ao planejamento normal)', (select quantidade from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select pino from _c) and tipo = 'previsto') = 1000);
end $$;
reset role;

-- a produção real nunca é tocada
select pg_temp.t('produção real intacta (nenhum apontamento criado/alterado/apagado)', (select count(*) from public.apontamentos_producao) = (select apontamentos from _c));
select pg_temp.t('4x2 continua encerrada (demanda 0) depois de todos os testes', (select quantidade from public.previsao_itens where previsao_id = (select prev from _c) and produto_id = (select c4x2 from _c) and tipo = 'previsto') = 0);

do $$ begin raise notice 'TESTE|RESUMO|% testes, % falhas', (select count(*) from _r), (select count(*) from _r where not ok); end $$;
rollback;

-- 05/11 T1, T2, T3 (dados reais de PROD no clone). Tudo em transação com rollback.
begin;
create or replace function pg_temp.chk(ok boolean, msg text) returns void language plpgsql as $f$ begin if not coalesce(ok,false) then raise exception 'FALHOU: %', msg; end if; raise notice 'PASS: %', msg; end $f$;
create temp table ctx as select (select auth_user_id from usuarios where papel='admin' and ativo and auth_user_id is not null order by nome limit 1) adm_auth;
grant select on ctx to public;
select set_config('request.jwt.claims', json_build_object('sub',(select adm_auth from ctx),'role','authenticated')::text, true);
create temp table antes as select
  (select count(*) from escala_producao_eventos) ev, (select count(*) from escala_producao_eventos where status='pendente') ev_pend,
  (select md5(string_agg(a::text, '|' order by a::text)) from escala_producao_alocacoes a where a.data >= '2026-11-06') aloc_hoje,
  (select count(*) from escala_fechamentos) fech, (select count(*) from escala_fechamento_plano) plano, (select count(*) from escala_buffers_fisicos) inv,
  (select count(*) from escala_fechamento_log) logf, (select md5(string_agg(a::text, '|' order by a::text)) from escala_producao_dias a where a.data >= '2026-11-06') dias_hoje;
set local role authenticated;
do $$
declare per text; r jsonb; m uuid; plan record; f_outro uuid; f_plan uuid; prod_outro record; prod_plan uuid; rid uuid; n int; msg text; inv_prod uuid;
begin
  foreach per in array array['t1','t2','t3'] loop
    -- B: máquina NÃO planejada neste período (existe alocação em outras máquinas), com algum produto de meta > 0
    select mq.id into m from maquinas mq where mq.ativo and not exists (select 1 from escala_producao_alocacoes a where a.data='2026-11-05' and a.periodo_id=per and a.maquina_id=mq.id)
       and not exists (select 1 from apontamentos_producao x where x.data='2026-11-05' and x.periodo_id=per and x.maquina_id=mq.id)
       and exists (select 1 from roteiro_etapa_maquinas rem join roteiro_etapas re on re.id=rem.etapa_id where rem.maquina_id=mq.id and (case per when 't1' then re.meta_t1 when 't2' then re.meta_t2 else re.meta_t3 end) > 0) order by mq.nome limit 1;
    perform pg_temp.chk(m is not null, per || ': existe máquina não programada neste período');
    -- planejada de OUTRO posto: operador e produto planejados lá
    select a.funcionario_id, a.produto_id into f_plan, prod_plan from escala_producao_alocacoes a where a.data='2026-11-05' and a.periodo_id=per and a.funcionario_id is not null and a.produto_id is not null limit 1;
    -- C/D: operador diferente do planejado, produto diferente do planejado (qualquer válido para a máquina)
    select f.id into f_outro from funcionarios_elegibilidade f where f.ativo and f.id <> f_plan order by f.nome limit 1;
    select re.produto_id as pid, re.id as eid into prod_outro from roteiro_etapa_maquinas rem join roteiro_etapas re on re.id=rem.etapa_id join produtos p on p.id=re.produto_id and p.ativo
      where rem.maquina_id=m and re.produto_id <> coalesce(prod_plan, gen_random_uuid()) and (case per when 't1' then re.meta_t1 when 't2' then re.meta_t2 else re.meta_t3 end) > 0 limit 1;
    if prod_outro.pid is null then select re.produto_id, re.id into prod_outro from roteiro_etapa_maquinas rem join roteiro_etapas re on re.id=rem.etapa_id where rem.maquina_id=m and (case per when 't1' then re.meta_t1 when 't2' then re.meta_t2 else re.meta_t3 end) > 0 limit 1; end if;
    r := regularizar_apontamento_historico('2026-11-05', per, m, f_outro, prod_outro.pid, 500, 5, prod_outro.eid);
    perform pg_temp.chk(r->>'acao'='INCLUIDO', per || ' B/C/D: máquina não programada + operador diferente + produto diferente ⇒ INCLUIDO');
    rid := (r->>'apontamento_id')::uuid;
    -- A: editar o existente (por id) e substituir (por chave) sem duplicar
    r := regularizar_apontamento_historico('2026-11-05', per, m, f_outro, prod_outro.pid, 600, 6, prod_outro.eid, rid);
    perform pg_temp.chk(r->>'acao'='ALTERADO', per || ' A: editar existente ⇒ ALTERADO');
    r := regularizar_apontamento_historico('2026-11-05', per, m, f_outro, prod_outro.pid, 700, 7, prod_outro.eid, null, true);
    select count(*) into n from apontamentos_producao where data='2026-11-05' and periodo_id=per and maquina_id=m;
    perform pg_temp.chk(n = 1, per || ' A: substituir não duplica (1 linha)');
    begin perform regularizar_apontamento_historico('2026-11-05', per, m, f_outro, prod_outro.pid, 1, 0, prod_outro.eid); msg := 'sem erro'; exception when others then msg := sqlerrm; end;
    perform pg_temp.chk(msg like 'REGULARIZACAO_JA_EXISTE%', per || ' sem duplicata acidental (recusa lançar de novo)');
    -- F: combinação inválida
    select p.id into inv_prod from produtos p where p.ativo and not exists (select 1 from roteiro_etapas re join roteiro_etapa_maquinas rem on rem.etapa_id=re.id where re.produto_id=p.id and rem.maquina_id=m) limit 1;
    begin perform regularizar_apontamento_historico('2026-11-05', per, m, f_outro, inv_prod, 1, 0); msg := 'sem erro'; exception when others then msg := sqlerrm; end;
    perform pg_temp.chk(msg like 'COMBINACAO_INVALIDA%' or msg like 'META%', per || ' F: combinação técnica inválida ⇒ bloqueia (' || left(msg, 20) || ')');
    -- apontamento em máquina PLANEJADA no período (fluxo comum), operador planejado trocado
    select a.maquina_id into plan from escala_producao_alocacoes a where a.data='2026-11-05' and a.periodo_id=per and a.maquina_id is not null and a.produto_id is not null limit 1;
    r := regularizar_apontamento_historico('2026-11-05', per, plan.maquina_id, f_outro, (select produto_id from escala_producao_alocacoes where data='2026-11-05' and periodo_id=per and maquina_id=plan.maquina_id limit 1), 1000, 0);
    perform pg_temp.chk(r->>'acao'='INCLUIDO', per || ': posto programado também aceito');
  end loop;
end $$;
reset role;
select pg_temp.chk((select count(*) from apontamento_regularizacao_historica where origem='REGULARIZACAO_HISTORICA' and observacao='Ajuste devido à realocação física de máquinas e operadores' and usuario_id is not null and em is not null and periodo_id in ('t1','t2','t3'))=12, '12 linhas de auditoria (3 períodos × incluir, editar, substituir, posto programado) com usuário, hora, origem e observação');
-- G: nada de hoje/inventário/fechamento mexido
select pg_temp.chk((select count(*) from escala_producao_eventos)=(select ev from antes) and (select count(*) from escala_producao_eventos where status='pendente')=(select ev_pend from antes), 'G: nenhum evento de recálculo criado/pendente');
select pg_temp.chk((select md5(string_agg(a::text, '|' order by a::text)) from escala_producao_alocacoes a where a.data >= '2026-11-06') is not distinct from (select aloc_hoje from antes), 'G: escala de 06/11 e futuros (alocações) idêntica');
select pg_temp.chk((select md5(string_agg(a::text, '|' order by a::text)) from escala_producao_dias a where a.data >= '2026-11-06') is not distinct from (select dias_hoje from antes), 'G: dias liberados de 06/11 idênticos');
select pg_temp.chk((select count(*) from escala_buffers_fisicos)=(select inv from antes), 'G: inventário físico idêntico');
select pg_temp.chk((select count(*) from escala_fechamentos)=(select fech from antes) and (select count(*) from escala_fechamento_plano)=(select plano from antes) and (select count(*) from escala_fechamento_log)=(select logf from antes), 'G: fechamentos/vínculos/log idênticos (nenhum fechamento antigo foi aberto)');
rollback;

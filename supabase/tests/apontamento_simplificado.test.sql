-- Teste de banco do APONTAMENTO SIMPLIFICADO (migration 20261111100000). Roda num CLONE LOCAL do schema de PROD (nunca em Supabase) e termina em ROLLBACK.
-- Pré-requisitos: schema real + 20261110100000 + 20261111100000 aplicadas. Dia/período de teste: o primeiro dia passado com alocações (m1).
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.chk(p_ok boolean, p_msg text) returns void language plpgsql as $$ begin if not coalesce(p_ok, false) then raise exception 'FALHOU: %', p_msg; end if; raise notice 'ok: %', p_msg; end $$;

-- cenário: limpa o dia/período, escolhe 3 postos programados + 1 posto livre com produto elegível
create temp table cen as
with d as (select max(data) as data from escala_producao_alocacoes where maquina_id is not null and data < (now() at time zone 'America/Sao_Paulo')::date and periodo_id = 'm1'),
p as (select a.*, row_number() over (order by a.maquina_id) rn from escala_producao_alocacoes a, d where a.data = d.data and a.periodo_id = 'm1' and a.maquina_id is not null)
select d.data, (select maquina_id from p where rn=1) ma, (select maquina_id from p where rn=2) mb, (select maquina_id from p where rn=3) mc,
  (select produto_id from p where rn=1) pa, (select produto_id from p where rn=2) pb, (select funcionario_id from p where rn=1) fa,
  (select produto_id from p where rn=3) pc, (select funcionario_id from p where rn=3) fc,
  (select funcionario_id from p where rn=2) fb
from d;
create temp table cen2 as
select c.*, (select f.id from funcionarios f where f.ativo and f.id not in (c.fa, c.fc, c.fb) order by f.id limit 1) f_outro,
  (select m.id from maquinas m where m.ativo and not exists (select 1 from escala_producao_alocacoes a where a.data = c.data and a.periodo_id = 'm1' and a.maquina_id = m.id)
     and exists (select 1 from roteiro_etapa_maquinas rem join roteiro_etapas re on re.id = rem.etapa_id where rem.maquina_id = m.id and re.meta_m1 > 0 group by rem.maquina_id having count(*) >= 1) order by m.id limit 1) m_extra
from cen c;
create temp table cen3 as
select c.*, (select re.produto_id from roteiro_etapa_maquinas rem join roteiro_etapas re on re.id = rem.etapa_id join produtos p on p.id = re.produto_id
              where rem.maquina_id = c.m_extra and re.meta_m1 > 0 and p.ativo and (select count(*) from roteiro_etapas r2 join roteiro_etapa_maquinas r3 on r3.etapa_id = r2.id where r2.produto_id = re.produto_id and r3.maquina_id = c.m_extra) = 1 order by re.produto_id limit 1) p_extra
from cen2 c;
select pg_temp.chk(ma is not null and mb is not null and mc is not null and f_outro is not null and m_extra is not null and p_extra is not null, 'cenário montado: ' || data) from cen3;

delete from apontamentos_producao where data = (select data from cen3) and periodo_id = 'm1';
update usuarios set ativo = true where id = (select id from usuarios where papel = 'admin' and ativo limit 1);
create temp table u as select id, auth_user_id from usuarios where papel = 'admin' and ativo order by id limit 1;
grant select on cen3, u to public;

-- 1) flag desligada: a RPC recusa
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from u), 'role', 'authenticated')::text, true);
do $$ declare v text; begin
  begin perform registrar_apontamentos_fechamento((select data from cen3), 'm1', '[]'::jsonb); v := 'sem erro';
  exception when others then v := sqlerrm; end;
  perform pg_temp.chk(v like 'APONTAMENTO_SIMPLIFICADO_DESLIGADO%', 'flag desligada recusa (' || v || ')');
end $$;
reset role;

-- 2) liga a flag: o gatilho de parâmetros NÃO enfileira recálculo
create temp table ev0 as select count(*) n from escala_producao_eventos;
update escala_parametros set valor = '"ativo"' where chave = 'apontamento_simplificado_modo';
select pg_temp.chk((select count(*) from escala_producao_eventos) = (select n from ev0), 'ligar a flag não enfileira recálculo');
create temp table ev1 as select count(*) n from escala_producao_eventos;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from u), 'role', 'authenticated')::text, true);

-- 3) lote: A igual ao plano, B NÃO PRODUZIU (PARADA), C com operador trocado, E extra
create temp table r1 as select registrar_apontamentos_fechamento((select data from cen3), 'm1', jsonb_build_array(
  jsonb_build_object('chave', gen_random_uuid(), 'maquina_planejada_id', (select ma from cen3), 'maquina_id', (select ma from cen3), 'produto_id', (select pa from cen3), 'funcionario_id', (select fa from cen3), 'produzido', 1000, 'refugo', 12, 'nao_produziu', false),
  jsonb_build_object('chave', gen_random_uuid(), 'maquina_planejada_id', (select mb from cen3), 'maquina_id', (select mb from cen3), 'nao_produziu', true, 'motivo', 'PARADA', 'descricao', 'correia soltou'),
  jsonb_build_object('chave', gen_random_uuid(), 'maquina_planejada_id', (select mc from cen3), 'maquina_id', (select mc from cen3), 'produto_id', (select pc from cen3), 'funcionario_id', (select f_outro from cen3), 'produzido', 500, 'refugo', 0, 'nao_produziu', false),
  jsonb_build_object('chave', gen_random_uuid(), 'maquina_planejada_id', null, 'maquina_id', (select m_extra from cen3), 'produto_id', (select p_extra from cen3), 'funcionario_id', (select fa from cen3), 'produzido', 300, 'refugo', 3, 'nao_produziu', false)
)) as j;
reset role;
select pg_temp.chk((select count(*) from apontamento_planejado_real where data = (select data from cen3) and periodo_id = 'm1') = 4, '4 vínculos planejado×real gravados');
select pg_temp.chk((select count(*) from apontamentos_producao where data = (select data from cen3) and periodo_id = 'm1') = 4, '4 apontamentos gravados');
select pg_temp.chk((select divergencias = '{}' and origem = 'PROGRAMADO' and not nao_produziu from apontamento_planejado_real where maquina_planejada_id = (select ma from cen3) and data = (select data from cen3)), 'A: sem divergência');
select pg_temp.chk((select nao_produziu and motivo_nao_produziu = 'PARADA' and real ->> 'status' = 'sem_producao' from apontamento_planejado_real where maquina_planejada_id = (select mb from cen3) and data = (select data from cen3)), 'B: NÃO PRODUZIU/PARADA persistido');
select pg_temp.chk((select a.status = 'sem_producao' and a.motivo_sem_producao = 'outro' and a.descricao_sem_producao = 'Parada de máquina: correia soltou' from apontamentos_producao a where a.maquina_id = (select mb from cen3) and a.data = (select data from cen3) and a.periodo_id = 'm1'), 'B: mapeado para sem_producao existente (outro + descrição)');
select pg_temp.chk((select divergencias = array['OPERADOR'] from apontamento_planejado_real where maquina_planejada_id = (select mc from cen3) and data = (select data from cen3)), 'C: divergência OPERADOR');
select pg_temp.chk((select planejado ->> 'funcionario_id' = (select fc::text from cen3) and real ->> 'funcionario_id' = (select f_outro::text from cen3) from apontamento_planejado_real where maquina_planejada_id = (select mc from cen3) and data = (select data from cen3)), 'C: planejado e real preservados lado a lado');
select pg_temp.chk((select origem = 'POSTO_NAO_PLANEJADO' and planejado is null and maquina_planejada_id is null from apontamento_planejado_real where maquina_real_id = (select m_extra from cen3) and data = (select data from cen3)), 'E: POSTO_NAO_PLANEJADO persistido');
select pg_temp.chk((select count(*) from apontamentos_producao where data = (select data from cen3) and periodo_id = 'm1' and criado_por = (select id from u)) = 4, 'criado_por = usuário autenticado');

-- 4) planejado é append-only
do $$ declare v text; begin
  begin update apontamento_planejado_real set planejado = '{}'::jsonb; v := 'sem erro'; exception when others then v := sqlerrm; end;
  perform pg_temp.chk(v like '%append-only%', 'UPDATE do vínculo é recusado (' || v || ')');
end $$;

-- 5) reenvio SUBSTITUI (A corrigido; B vira produção; sem C e sem extra): histórico preserva o anterior
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from u), 'role', 'authenticated')::text, true);
create temp table r2 as select registrar_apontamentos_fechamento((select data from cen3), 'm1', jsonb_build_array(
  jsonb_build_object('chave', gen_random_uuid(), 'maquina_planejada_id', (select ma from cen3), 'maquina_id', (select ma from cen3), 'produto_id', (select pa from cen3), 'funcionario_id', (select fa from cen3), 'produzido', 1100, 'refugo', 12, 'nao_produziu', false),
  jsonb_build_object('chave', gen_random_uuid(), 'maquina_planejada_id', (select mb from cen3), 'maquina_id', (select mb from cen3), 'produto_id', (select pb from cen3), 'funcionario_id', (select fb from cen3), 'produzido', 50, 'refugo', 0, 'nao_produziu', false)
)) as j;
reset role;
select pg_temp.chk((select (j ->> 'substituidas')::int from r2) = 4, 'reenvio substituiu as 4 linhas do fluxo');
select pg_temp.chk((select count(*) from apontamentos_producao where data = (select data from cen3) and periodo_id = 'm1') = 2, 'ficaram 2 apontamentos (C e extra removidos)');
select pg_temp.chk((select quantidade_produzida = 1100 from apontamentos_producao where maquina_id = (select ma from cen3) and data = (select data from cen3) and periodo_id = 'm1'), 'A atualizado para 1100');
select pg_temp.chk((select count(*) from apontamento_producao_historico where dados_novos ->> 'substituido_por' = 'registrar_apontamentos_fechamento' and dados_anteriores ? 'vinculo_planejado_real') = 4, 'histórico guarda apontamento + vínculo anteriores (4)');

-- 6) rejeições: máquina duplicada, posto inexistente, 'outro' sem descrição, produto inelegível, apontamento do painel preservado
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from u), 'role', 'authenticated')::text, true);
do $$ declare v text; d date := (select data from cen3); begin
  begin perform registrar_apontamentos_fechamento(d, 'm1', jsonb_build_array(
    jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', (select ma from cen3), 'nao_produziu', true, 'motivo', 'SEM_MATERIAL'),
    jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', (select ma from cen3), 'nao_produziu', true, 'motivo', 'SEM_MATERIAL'))); v := 'sem erro';
  exception when others then v := sqlerrm; end;
  perform pg_temp.chk(v like 'MAQUINA_DUPLICADA%', 'máquina duplicada recusada');
  begin perform registrar_apontamentos_fechamento(d, 'm1', jsonb_build_array(jsonb_build_object('chave', gen_random_uuid(), 'maquina_planejada_id', (select m_extra from cen3), 'maquina_id', (select m_extra from cen3), 'nao_produziu', true, 'motivo', 'SEM_MATERIAL'))); v := 'sem erro';
  exception when others then v := sqlerrm; end;
  perform pg_temp.chk(v like '%POSTO_PROGRAMADO_INEXISTENTE%', 'posto não programado informado como programado é recusado');
  begin perform registrar_apontamentos_fechamento(d, 'm1', jsonb_build_array(jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', (select m_extra from cen3), 'nao_produziu', true, 'motivo', 'OUTRO'))); v := 'sem erro';
  exception when others then v := sqlerrm; end;
  perform pg_temp.chk(v like '%exige descrição%', 'OUTRO sem descrição recusado');
  begin perform registrar_apontamentos_fechamento(d, 'm1', jsonb_build_array(jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', (select m_extra from cen3), 'nao_produziu', true, 'motivo', 'INVENTADO'))); v := 'sem erro';
  exception when others then v := sqlerrm; end;
  perform pg_temp.chk(v like '%motivo válido%', 'motivo desconhecido recusado');
  begin perform registrar_apontamentos_fechamento(d, 'm1', jsonb_build_array(jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', (select m_extra from cen3), 'produto_id', gen_random_uuid(), 'funcionario_id', (select fa from cen3), 'produzido', 1, 'refugo', 0, 'nao_produziu', false))); v := 'sem erro';
  exception when others then v := sqlerrm; end;
  perform pg_temp.chk(v like 'LINHA[%' , 'produto inexistente recusado com a chave da linha (' || left(v, 60) || ')');
  perform pg_temp.chk((select count(*) from apontamentos_producao where data = d and periodo_id = 'm1') = 2, 'rejeições não gravaram nada (atomicidade)');
end $$;
reset role;

-- 7) apontamento do PAINEL (sem vínculo) nunca é substituído nem tocado; linha editada fora do fluxo bloqueia o reenvio
insert into apontamento_producao_historico (apontamento_id, dados_anteriores, dados_novos, alterado_por, motivo)
  select a.id, '{}'::jsonb, '{}'::jsonb, (select id from u), 'edição fora do fluxo (teste)' from apontamentos_producao a where a.maquina_id = (select ma from cen3) and a.data = (select data from cen3) and a.periodo_id = 'm1';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from u), 'role', 'authenticated')::text, true);
do $$ declare v text; begin
  begin perform registrar_apontamentos_fechamento((select data from cen3), 'm1', '[]'::jsonb); v := 'sem erro';
  exception when others then v := sqlerrm; end;
  perform pg_temp.chk(v like 'APONTAMENTO_EDITADO_FORA_DO_FLUXO%', 'reenvio recusado se a linha foi editada fora do fluxo');
end $$;
reset role;
delete from apontamento_planejado_real where apontamento_id in (select id from apontamentos_producao where maquina_id = (select ma from cen3) and data = (select data from cen3) and periodo_id = 'm1');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from u), 'role', 'authenticated')::text, true);
do $$ declare v jsonb; begin
  v := registrar_apontamentos_fechamento((select data from cen3), 'm1', '[]'::jsonb);
  perform pg_temp.chk((v ->> 'substituidas')::int = 1, 'só o vínculo restante (B) foi substituído; o apontamento sem vínculo (painel) ficou intacto');
  perform pg_temp.chk((select count(*) from apontamentos_producao where data = (select data from cen3) and periodo_id = 'm1') = 1, 'apontamento do painel preservado');
end $$;
reset role;

-- 8) permissão: usuário sem permissão é recusado
create temp table u2 as select id, auth_user_id from usuarios where papel <> 'admin' and ativo order by id limit 1;
delete from usuario_permissoes where usuario_id = (select id from u2) and permissao in ('escala_fechamento','producao_real_apontamento');
grant select on u2 to public;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from u2), 'role', 'authenticated')::text, true);
do $$ declare v text; begin
  begin perform registrar_apontamentos_fechamento((select data from cen3), 'm1', '[]'::jsonb); v := 'sem erro';
  exception when others then v := sqlerrm; end;
  perform pg_temp.chk(v like '%sem permissão%', 'usuário sem permissão recusado');
end $$;
reset role;

delete from apontamentos_producao where data = (select data from cen3) and periodo_id = 'm2';
-- 9) JANELA do fechamento físico (modo ATIVO): com a janela aberta por OUTRO usuário a RPC é recusada pelo gatilho; aberta pelo próprio usuário, grava
update escala_parametros set valor = '"ativo"' where chave = 'escala_fechamento_fisico_modo';
create temp table u3 as select id from usuarios where ativo and id <> (select id from u) order by id limit 1;
select escala_fechamento_abrir((select date_trunc('week', data)::date from cen3), (select data from cen3), 'm1', (select id from u3), 'teste', 30, false);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from u), 'role', 'authenticated')::text, true);
do $$ declare v text; begin
  begin perform registrar_apontamentos_fechamento((select data from cen3), 'm1', jsonb_build_array(jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', (select m_extra from cen3), 'nao_produziu', true, 'motivo', 'SEM_MATERIAL'))); v := 'sem erro';
  exception when others then v := sqlerrm; end;
  perform pg_temp.chk(v like '%FECHAMENTO_PERIODO_EM_FECHAMENTO%', 'janela aberta por OUTRO usuário recusa o apontamento (' || left(v, 40) || ')');
end $$;
reset role;
select escala_fechamento_abrir((select date_trunc('week', data)::date from cen3), (select data from cen3), 'm2', (select id from u), 'teste', 30, false);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from u), 'role', 'authenticated')::text, true);
do $$ declare v jsonb; begin
  v := registrar_apontamentos_fechamento((select data from cen3), 'm2', jsonb_build_array(jsonb_build_object('chave', gen_random_uuid(), 'maquina_id', (select m_extra from cen3), 'nao_produziu', true, 'motivo', 'SEM_MATERIAL')));
  perform pg_temp.chk((v ->> 'ok')::boolean, 'janela aberta pelo PRÓPRIO usuário permite o apontamento');
end $$;
reset role;
select 'APONTAMENTO-SIMPLIFICADO-OK' as resultado;
rollback;

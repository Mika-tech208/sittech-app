-- SMOKE do modo manual (PROD ou clone). NÃO PERSISTE NADA: roda numa transação única que termina em RAISE EXCEPTION 'SMOKE_RESULT|...' (o resultado volta na mensagem do erro;
-- tudo que o teste gravou é desfeito pelo rollback implícito). Serve ANTES (flags ligadas: comportamento antigo) e DEPOIS (modo manual) de desligar as flags: ele lê o modo e
-- afirma o comportamento correspondente. Usa o sábado 07/11/2026 (sem produção) para as linhas de teste. Perfil da Clarice via claims (sem regra por nome no código).
begin;
create temp table _r(ord int, ok boolean, nome text);
create temp table _s(chave text primary key, valor text);
grant all on _r, _s to public;
create or replace function pg_temp.t(p_nome text, p_ok boolean) returns void language plpgsql as $$ begin insert into _r (ord, ok, nome) values ((select coalesce(max(ord), 0) + 1 from _r), coalesce(p_ok,false), p_nome); end $$;
create or replace function pg_temp.erro_de(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- ---------- estado inicial ----------
insert into _s select 'manual',
  (coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'producao_real_modo'), 'desligado') = 'desligado'
   and coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'replanejamento_modo'), 'desligado') = 'desligado'
   and coalesce((select valor #>> '{}' from public.escala_parametros where chave = 'escala_fechamento_fisico_modo'), 'desligado') = 'desligado')::text;
insert into _s select 'eventos_antes', (select count(*) from public.escala_producao_eventos)::text;
insert into _s select 'plano_antes', md5(coalesce((select string_agg(a::text, '|' order by a::text) from public.escala_producao_alocacoes a), '') || coalesce((select string_agg(d::text, '|' order by d::text) from public.escala_producao_dias d), ''));
insert into _s select 'clarice_auth', (select auth_user_id::text from public.usuarios where nome = 'Clarice' and ativo);
insert into _s select 'clarice_id', (select id::text from public.usuarios where nome = 'Clarice' and ativo);
insert into _s select 'admin_auth', (select auth_user_id::text from public.usuarios where papel = 'admin' and ativo order by nome limit 1);
insert into _s select 'func1', (select id::text from public.funcionarios where ativo order by nome limit 1);
insert into _s select 'func2', (select id::text from public.funcionarios where ativo order by nome offset 1 limit 1);
-- máquina livre no sábado 07/11 com dois produtos elegíveis (1 etapa cada) com meta em m2
create temp table _p as
select m.id as maquina, re.produto_id as p1,
  (select re2.produto_id from public.roteiro_etapas re2 join public.roteiro_etapa_maquinas x2 on x2.etapa_id = re2.id join public.produtos pr2 on pr2.id = re2.produto_id
    where x2.maquina_id = m.id and re2.produto_id <> re.produto_id and pr2.ativo and re2.meta_m2 > 0
      and (select count(*) from public.roteiro_etapas r3 join public.roteiro_etapa_maquinas y on y.etapa_id = r3.id where r3.produto_id = re2.produto_id and y.maquina_id = m.id) = 1 limit 1) as p2
from public.maquinas m join public.roteiro_etapa_maquinas rem on rem.maquina_id = m.id join public.roteiro_etapas re on re.id = rem.etapa_id join public.produtos p on p.id = re.produto_id
where m.ativo and p.ativo and re.meta_m2 > 0 and re.meta_m3 > 0
  and (select count(*) from public.roteiro_etapas r2 join public.roteiro_etapa_maquinas x on x.etapa_id = r2.id where r2.produto_id = re.produto_id and x.maquina_id = m.id) = 1
  and not exists (select 1 from public.apontamentos_producao a where a.maquina_id = m.id and ((a.data = '2026-11-07') or (a.data = '2026-11-06' and a.periodo_id = 'm3')))
order by m.nome limit 1;
grant all on _p to public;
insert into _s select 'maquina_b', (select m2.id::text from public.maquinas m2 where m2.ativo and m2.id <> (select maquina from _p) and exists (select 1 from public.roteiro_etapa_maquinas rr join public.roteiro_etapas e on e.id = rr.etapa_id where rr.maquina_id = m2.id and e.meta_m2 > 0)
  and not exists (select 1 from public.apontamentos_producao a where a.maquina_id = m2.id and a.data = '2026-11-07') order by m2.nome limit 1);
select pg_temp.t('dados de teste disponíveis (Clarice, operadores, máquina livre com 2 produtos)',
  (select count(*) = 1 from _p) and (select p2 is not null from _p) and (select valor is not null from _s where chave = 'clarice_auth') and (select valor is not null from _s where chave = 'func2') and (select valor is not null from _s where chave = 'maquina_b'));

-- ---------- permissões da Clarice (perfil, sem regra por nome) ----------
select pg_temp.t('Clarice tem producao_real_apontamento e producao_real_apontamentos_realizados',
  (select count(*) = 2 from public.usuario_permissoes p where p.usuario_id = (select valor::uuid from _s where chave = 'clarice_id') and p.permissao in ('producao_real_apontamento', 'producao_real_apontamentos_realizados')));
select pg_temp.t('Clarice NÃO tem permissões de exclusão/fechamento (nada de permissão extra)',
  (select count(*) = 0 from public.usuario_permissoes p where p.usuario_id = (select valor::uuid from _s where chave = 'clarice_id') and p.permissao in ('producao_real_historico', 'escala_fechamento', 'escala_fechamento_excecao')));

-- ---------- apontamento manual como Clarice ----------
select set_config('request.jwt.claims', json_build_object('sub', (select valor from _s where chave = 'clarice_auth'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select valor from _s where chave = 'clarice_auth'), true);
set local role authenticated;
do $$ declare v_m uuid; v_p1 uuid; v_p2 uuid; v_f1 uuid; v_f2 uuid; v_mb uuid; a1 public.apontamentos_producao; a2 public.apontamentos_producao; a3 public.apontamentos_producao; sp public.apontamentos_producao; e text; n int; soma numeric; v_pb uuid;
begin
  select maquina, p1, p2 into v_m, v_p1, v_p2 from _p; select valor::uuid into v_f1 from _s where chave = 'func1'; select valor::uuid into v_f2 from _s where chave = 'func2'; select valor::uuid into v_mb from _s where chave = 'maquina_b';
  a1 := public.registrar_apontamento_producao_retroativo(v_m, v_p1, v_f1, 1000, 10, gen_random_uuid(), '2026-11-07', 'm2', 'smoke linha 1', '[]'::jsonb);
  perform pg_temp.t('máquina, operador, produto, período e data selecionáveis; operação derivada do roteiro; produzido/refugo salvam', a1.id is not null and a1.operacao_id is not null and a1.quantidade_produzida = 1000 and a1.quantidade_refugo = 10);
  perform public.editar_apontamento_producao(a1.id, v_p1, v_f1, 1200, 20, 'smoke: correção', null, '[]'::jsonb);
  perform pg_temp.t('edição funciona (sem dono do fechamento)', (select quantidade_produzida from public.apontamentos_producao where id = a1.id) = 1200);
  a2 := public.registrar_apontamento_producao_retroativo(v_m, v_p2, v_f1, 400, 5, gen_random_uuid(), '2026-11-07', 'm2', 'smoke linha 2 (segundo produto)', '[]'::jsonb);
  a3 := public.registrar_apontamento_producao_retroativo(v_m, v_p1, v_f2, 300, 0, gen_random_uuid(), '2026-11-07', 'm2', 'smoke linha 3 (outro operador)', '[]'::jsonb);
  select count(*), sum(quantidade_produzida) into n, soma from public.apontamentos_producao where maquina_id = v_m and data = '2026-11-07' and periodo_id = 'm2';
  perform pg_temp.t('mesma máquina/período aceita 2 produtos e troca de operador (3 lançamentos, soma 1.900)', n = 3 and soma = 1900);
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 50, 0, gen_random_uuid(), '2026-11-07', 'm2', 'dup', '[]'::jsonb)$q$, v_m, v_p1, v_f1));
  perform pg_temp.t('mesma máquina+produto+operador é recusado (duplicata)', e like '%Já existe um lançamento%');
  e := pg_temp.erro_de(format($q$select public.registrar_sem_producao_retroativo(%L, 'sem_programacao', gen_random_uuid(), '2026-11-07', 'm2')$q$, v_m));
  perform pg_temp.t('"sem produção" não coexiste com produção', e like 'APONTAMENTO_MAQUINA_COM_PRODUCAO%');
  sp := public.registrar_sem_producao_retroativo(v_mb, 'sem_programacao', gen_random_uuid(), '2026-11-07', 'm2');
  select re.produto_id into v_pb from public.roteiro_etapas re join public.roteiro_etapa_maquinas x on x.etapa_id = re.id where x.maquina_id = v_mb and re.meta_m2 > 0 and (select count(*) from public.roteiro_etapas r3 join public.roteiro_etapa_maquinas y on y.etapa_id = r3.id where r3.produto_id = re.produto_id and y.maquina_id = v_mb) = 1 limit 1;
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 10, 0, gen_random_uuid(), '2026-11-07', 'm2', 'x', '[]'::jsonb)$q$, v_mb, v_pb, v_f1));
  perform pg_temp.t('produção sobre "sem produção" é recusada; converter funciona', e like 'APONTAMENTO_MAQUINA_SEM_PRODUCAO%');
  perform public.converter_apontamento_sem_producao_para_producao(sp.id, v_pb, v_f1, 100, 0, 'smoke: converter');
  perform pg_temp.t('converter "sem produção" em produção funciona', (select status from public.apontamentos_producao where id = sp.id) = 'produzindo');
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, -1, 0, gen_random_uuid(), '2026-11-04', 'm1', 'x', '[]'::jsonb)$q$, v_m, v_p1, v_f1));
  perform pg_temp.t('validação: produzido negativo recusado', e like '%Quantidade produzida inválida%');
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 10, 20, gen_random_uuid(), '2026-11-04', 'm1', 'x', '[]'::jsonb)$q$, v_m, v_p1, v_f1));
  perform pg_temp.t('validação: refugo maior que produzido recusado', e like '%refugo%maior%');
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, (select p.id from public.produtos p where p.ativo and not exists (select 1 from public.roteiro_etapas re join public.roteiro_etapa_maquinas rem on rem.etapa_id = re.id where re.produto_id = p.id and rem.maquina_id = %L) limit 1), %L, 10, 0, gen_random_uuid(), '2026-11-04', 'm1', 'x', '[]'::jsonb)$q$, v_m, v_m, v_f1));
  perform pg_temp.t('validação: combinação máquina×produto impossível recusada', e like '%Nenhuma etapa do roteiro%');
  -- período JÁ CONFIRMADO pelo fechamento físico (06/11 m3): manual => permitido; antes das flags => bloqueado
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 500, 0, gen_random_uuid(), '2026-11-06', 'm3', 'smoke m3', '[]'::jsonb)$q$, v_m, v_p1, v_f1));
  if (select valor from _s where chave = 'manual') = 'true' then
    perform pg_temp.t('MANUAL: lança em período já confirmado (06/11 m3) sem reabrir e sem fechar o anterior (fechamento não pede estoque/posto/owner)', e is null);
  else
    perform pg_temp.t('ANTES das flags: período confirmado (06/11 m3) continua bloqueado como antes', e like 'FECHAMENTO_PERIODO_EM_FECHAMENTO%');
  end if;
end $$;
reset role;

-- ---------- semana 09/11 em PLANEJAMENTO ----------
do $$ declare e text; begin
  begin
    insert into public.apontamentos_producao (status, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, idempotency_key, criado_por, meta_periodo_vigente, custo_hora_operacao_vigente, valor_unitario_produto_vigente, periodo_inicio_vigente, periodo_fim_vigente)
    select 'produzindo', re.produto_id, re.id, re.operacao_id, p.maquina, (select valor::uuid from _s where chave = 'func1'), 'm1', '2026-11-09', '12:00', 10, 0, gen_random_uuid(), (select valor::uuid from _s where chave = 'clarice_id'), 100, 1, 1, '07:12', '08:48'
    from _p p join public.roteiro_etapas re on re.produto_id = p.p1 where exists (select 1 from public.roteiro_etapa_maquinas x where x.etapa_id = re.id and x.maquina_id = p.maquina) limit 1;
    e := null;
  exception when others then e := sqlerrm; end;
  if (select valor from _s where chave = 'manual') = 'true' then perform pg_temp.t('MANUAL: semana 09/11 (PLANEJAMENTO) NÃO bloqueia apontamento', e is null);
  else perform pg_temp.t('ANTES das flags: 09/11 continua bloqueada (PLANEJAMENTO)', e like 'APONTAMENTO_SEMANA_EM_PLANEJAMENTO%'); end if;
end $$;

-- ---------- TV (admin) ----------
select set_config('request.jwt.claims', json_build_object('sub', (select valor from _s where chave = 'admin_auth'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', (select valor from _s where chave = 'admin_auth'), true);
set local role authenticated;
do $$ declare snap jsonb; n int; mot text; begin
  select public.escala_tv_snapshot('2026-11-06') into snap;
  n := coalesce(jsonb_array_length(snap -> 'alocacoes'), 0); mot := snap -> 'liberacao' -> 't3' ->> 'motivo';
  if (select valor from _s where chave = 'manual') = 'true' then perform pg_temp.t('MANUAL: TV não entrega nenhuma alocação e sinaliza MODO_MANUAL (alocações=' || n || ', motivo=' || coalesce(mot, '-') || ')', n = 0 and mot = 'MODO_MANUAL');
  else perform pg_temp.t('ANTES das flags: TV segue como antes (motivo=' || coalesce(mot, '-') || ')', coalesce(mot, '') <> 'MODO_MANUAL'); end if;
exception when others then perform pg_temp.t('TV snapshot: ' || sqlerrm, false); end $$;
reset role;

-- ---------- nada mudou no plano nem na fila durante os testes ----------
select pg_temp.t('plano (alocações + dias) idêntico durante o smoke', md5(coalesce((select string_agg(a::text, '|' order by a::text) from public.escala_producao_alocacoes a), '') || coalesce((select string_agg(d::text, '|' order by d::text) from public.escala_producao_dias d), '')) = (select valor from _s where chave = 'plano_antes'));
do $$ declare antes bigint := (select valor::bigint from _s where chave = 'eventos_antes'); depois bigint := (select count(*) from public.escala_producao_eventos); m boolean := (select valor::boolean from _s where chave = 'manual'); begin
  if m then perform pg_temp.t('MANUAL: nenhum evento de recálculo criado pelos apontamentos (eventos ' || antes || ' -> ' || depois || ')', depois = antes);
  else perform pg_temp.t('ANTES das flags: eventos (informativo) ' || antes || ' -> ' || depois, true); end if;
end $$;

-- resultado: aborta a transação de propósito (rollback de tudo) e devolve um resumo COMPACTO na mensagem (o CLI trunca mensagens longas):
-- manual=<t|f> | total | falhas | bits (1=OK, na ordem dos testes) | nomes dos que falharam
do $$ declare m text := (select valor from _s where chave = 'manual'); begin
  raise exception 'SMOKE_RESULT|manual=%|ev_ini=%|ev_fim=%|total=%|falhas=%|bits=%|falhou=%', m, (select valor from _s where chave = 'eventos_antes'), (select count(*) from public.escala_producao_eventos), (select count(*) from _r), (select count(*) from _r where not ok),
    (select string_agg(case when ok then '1' else '0' end, '' order by ord) from _r), coalesce((select string_agg(nome, '; ' order by ord) from _r where not ok), 'nenhum');
end $$;

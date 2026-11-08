-- TESTE DO MODO MANUAL (clone). Roda numa transação e DESFAZ tudo no final. Saída: linhas 'TESTE|OK|...' ou 'TESTE|FALHA|...'.
-- Uso: psql -v ON_ERROR_STOP=1 -f supabase/tests/modo_operacao_manual.test.sql   (somente no clone; nunca em PROD)
begin;
create temp table _r(ok boolean, nome text);
create or replace function pg_temp.t(p_nome text, p_ok boolean) returns void language plpgsql as $$
begin insert into _r values (coalesce(p_ok,false), p_nome); raise notice 'TESTE|%|%', case when coalesce(p_ok,false) then 'OK' else 'FALHA' end, p_nome; end $$;
create or replace function pg_temp.erro_de(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

create or replace function pg_temp.ins_0911() returns text language plpgsql as $$
begin
  insert into public.apontamentos_producao (status, produto_id, etapa_id, operacao_id, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, idempotency_key, criado_por, meta_periodo_vigente, custo_hora_operacao_vigente, valor_unitario_produto_vigente, periodo_inicio_vigente, periodo_fim_vigente)
  select 'produzindo', re.produto_id, re.id, re.operacao_id, p.maquina, d.func, 'm1', '2026-11-09', '12:00', 10, 0, gen_random_uuid(), d.clarice_id, 100, 1, 1, '07:12', '08:48'
  from _p p cross join _d d join public.roteiro_etapas re on re.produto_id = p.produto
  where exists (select 1 from public.roteiro_etapa_maquinas x where x.etapa_id = re.id and x.maquina_id = p.maquina) limit 1;
  return null;
exception when others then return sqlerrm; end $$;

-- ---------- dados de apoio ----------
create temp table _d as
select
  (select auth_user_id from public.usuarios where nome = 'Clarice' and ativo) as clarice_auth,
  (select id from public.usuarios where nome = 'Clarice' and ativo) as clarice_id,
  (select id from public.funcionarios where ativo order by nome limit 1) as func;
-- par (máquina, produto) válido com meta em m1 e SEM apontamento em 2026-11-05/m1 e 2026-11-06/m3 para a máquina
create temp table _p as
select m.id as maquina, re.produto_id as produto
from public.maquinas m join public.roteiro_etapa_maquinas rem on rem.maquina_id = m.id join public.roteiro_etapas re on re.id = rem.etapa_id join public.produtos p on p.id = re.produto_id
where m.ativo and p.ativo and re.meta_m1 > 0 and re.meta_m3 > 0
  and (select count(*) from public.roteiro_etapas r2 join public.roteiro_etapa_maquinas x on x.etapa_id = r2.id where r2.produto_id = re.produto_id and x.maquina_id = m.id) = 1
  and re.meta_m2 > 0
  and not exists (select 1 from public.apontamentos_producao a where a.maquina_id = m.id and ((a.data = '2026-11-05' and a.periodo_id = 'm1') or (a.data = '2026-11-06' and a.periodo_id = 'm3') or (a.data = '2026-11-07' and a.periodo_id = 'm2')))
  and exists (select 1 from public.roteiro_etapas re2 join public.roteiro_etapa_maquinas x2 on x2.etapa_id = re2.id join public.produtos pr2 on pr2.id = re2.produto_id
              where x2.maquina_id = m.id and re2.produto_id <> re.produto_id and pr2.ativo and re2.meta_m2 > 0
                and (select count(*) from public.roteiro_etapas r3 join public.roteiro_etapa_maquinas y on y.etapa_id = r3.id where r3.produto_id = re2.produto_id and y.maquina_id = m.id) = 1)
order by m.nome limit 1;
grant all on _r, _d, _p to public;
create temp table _q as
select p.maquina, (select re2.produto_id from public.roteiro_etapas re2 join public.roteiro_etapa_maquinas x on x.etapa_id = re2.id join public.produtos pr on pr.id = re2.produto_id
                   where x.maquina_id = p.maquina and re2.produto_id <> p.produto and pr.ativo and re2.meta_m2 > 0
                     and (select count(*) from public.roteiro_etapas r3 join public.roteiro_etapa_maquinas y on y.etapa_id = r3.id where r3.produto_id = re2.produto_id and y.maquina_id = p.maquina) = 1 limit 1) as produto2,
       (select id from public.funcionarios where ativo order by nome offset 1 limit 1) as func2,
       (select id from public.maquinas m2 where m2.ativo and m2.id <> p.maquina and exists (select 1 from public.roteiro_etapa_maquinas rr join public.roteiro_etapas e on e.id = rr.etapa_id where rr.maquina_id = m2.id and e.meta_m2 > 0)
          and not exists (select 1 from public.apontamentos_producao a where a.maquina_id = m2.id and a.data = '2026-11-07' and a.periodo_id = 'm2') order by m2.nome limit 1) as maquina_b
from _p p;
grant all on _q to public;
create temp table _antes as select (select count(*) from public.escala_producao_eventos) as eventos, (select count(*) from public.escala_producao_eventos where status = 'pendente') as pendentes;
grant all on _antes to public;
select pg_temp.t('pré: há par máquina/produto e funcionário para o teste', (select count(*) = 1 from _p) and (select func is not null and clarice_auth is not null from _d));

-- ---------- FASE 0: flags LIGADAS = comportamento anterior preservado ----------
select pg_temp.t('F0 flags ligadas => escala_operacao_manual() = false', not public.escala_operacao_manual());
select pg_temp.t('F0 liberação de 2026-11-09 continua PLANO_FUTURO_AGUARDANDO_CUTOVER (precedência do PLANEJAMENTO preservada)', (public.escala_periodo_liberacao('2026-11-09', 'm1') ->> 'motivo') = 'PLANO_FUTURO_AGUARDANDO_CUTOVER');
select pg_temp.t('F0 INSERT em semana de PLANEJAMENTO continua bloqueado (APONTAMENTO_SEMANA_EM_PLANEJAMENTO)', coalesce(pg_temp.ins_0911(), '') like 'APONTAMENTO_SEMANA_EM_PLANEJAMENTO%');
select set_config('request.jwt.claims', json_build_object('sub', (select clarice_auth from _d), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.t('F0 apontamento em período CONFIRMADO (2026-11-06 m3) continua bloqueado (FECHAMENTO_PERIODO_EM_FECHAMENTO)',
  coalesce(pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 500, 0, gen_random_uuid(), '2026-11-06', 'm3', 'x', '[]'::jsonb)$q$, (select maquina from _p), (select produto from _p), (select func from _d))), '') like 'FECHAMENTO_PERIODO_EM_FECHAMENTO%');
reset role;

-- ---------- ATIVA O MODO MANUAL (mesma ordem do script de PROD) ----------
update public.escala_parametros set valor = '"desligado"'::jsonb, atualizado_em = now() where chave = 'replanejamento_modo';
update public.escala_parametros set valor = '"desligado"'::jsonb, atualizado_em = now() where chave = 'escala_fechamento_fisico_modo';
update public.escala_parametros set valor = '"desligado"'::jsonb, atualizado_em = now() where chave = 'apontamento_simplificado_modo';
update public.escala_parametros set valor = '"desligado"'::jsonb, atualizado_em = now() where chave = 'producao_real_modo';
select pg_temp.t('F1 as três flags desligadas => escala_operacao_manual() = true', public.escala_operacao_manual());
select pg_temp.t('F1 desligar as flags NÃO enfileirou nenhum evento de recálculo (rajada do gatilho neutralizada)', (select count(*) from public.escala_producao_eventos) = (select eventos from _antes));
select pg_temp.t('F1 fila de pendentes inalterada', (select count(*) from public.escala_producao_eventos where status = 'pendente') = (select pendentes from _antes));

-- gatilhos / workers
do $$ declare v_prev uuid; n0 bigint; n1 bigint; r uuid; begin
  select id into v_prev from public.previsoes where semana_inicio = '2026-11-02';
  select count(*) into n0 from public.escala_producao_eventos;
  r := public.escala_registrar_evento('previsao', v_prev, '{}'::jsonb, null);
  r := public.escala_registrar_evento('ausencia', v_prev, '{}'::jsonb, null);
  r := public.escala_registrar_evento('geracao_manual', v_prev, '{}'::jsonb, null);
  select count(*) into n1 from public.escala_producao_eventos;
  perform pg_temp.t('F1 escala_registrar_evento (funil de ausência/previsão/cadastro/WIP/parâmetros) não enfileira no modo manual', n0 = n1 and r is null);
  perform pg_temp.t('F1 escala_agendador_chamar (30 jobs do pg_cron) devolve null sem chamada HTTP', public.escala_agendador_chamar('teste') is null);
end $$;
-- gatilhos reais: ausência, cadastro de máquina, roteiro
do $$ declare n0 bigint; n1 bigint; v_f uuid; v_m uuid; begin
  select count(*) into n0 from public.escala_producao_eventos;
  select func into v_f from _d;
  insert into public.ausencias_funcionarios (funcionario_id, data, tipo, horario_inicio, horario_fim, duracao_minutos, periodos_snapshot, criado_por) values (v_f, '2026-11-06', 'saida_antecipada', '15:00', '17:00', 120, '[]'::jsonb, (select clarice_id from _d));
  select maquina into v_m from _p;
  update public.maquinas set ativo = ativo where id = v_m;     -- sem mudança de valor: não dispara; força mudança real abaixo
  update public.maquinas set ativo = false where id = v_m; update public.maquinas set ativo = true where id = v_m;
  select count(*) into n1 from public.escala_producao_eventos;
  perform pg_temp.t('F1 gatilhos reais (ausência + cadastro de máquina) não enfileiram evento', n0 = n1);
exception when others then perform pg_temp.t('F1 gatilhos reais: ' || sqlerrm, false); end $$;

-- liberação / TV
select pg_temp.t('F1 liberação 2026-11-09 m1 = MODO_MANUAL, liberado=false (TV neutra; PLANEJAMENTO não é motivo)', (public.escala_periodo_liberacao('2026-11-09', 'm1') ->> 'motivo') = 'MODO_MANUAL' and (public.escala_periodo_liberacao('2026-11-09', 'm1') ->> 'liberado') = 'false');
select pg_temp.t('F1 liberação de hoje (2026-11-06 t3) = liberado=false/MODO_MANUAL', (public.escala_periodo_liberacao('2026-11-06', 't3') ->> 'liberado') = 'false' and (public.escala_periodo_liberacao('2026-11-06', 't3') ->> 'motivo') = 'MODO_MANUAL');
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from public.usuarios where papel = 'admin' and ativo order by nome limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare snap jsonb; n int; begin
  select public.escala_tv_snapshot('2026-11-06') into snap;
  n := coalesce(jsonb_array_length(snap -> 'alocacoes'), 0);
  perform pg_temp.t('F1 TV não entrega NENHUMA alocação como ordem de trabalho (alocações no snapshot = ' || n || ')', n = 0 and (snap -> 'liberacao' -> 't3' ->> 'motivo') = 'MODO_MANUAL');
exception when others then perform pg_temp.t('F1 TV snapshot: ' || sqlerrm, false); end $$;
reset role;

-- gravação de plano (última linha de defesa)
select pg_temp.t('F1 escala_aplicar_recalculo recusa semana corrente (ESCALA_AUTOMATICA_DESATIVADA)', coalesce(pg_temp.erro_de($q$select public.escala_aplicar_recalculo((select id from public.previsoes where semana_inicio = '2026-11-02'), '[]'::jsonb, '2026-11-06', 't1', '[]'::jsonb, null, '{}'::uuid[], '{}'::jsonb)$q$), '') like 'ESCALA_AUTOMATICA_DESATIVADA%');
select pg_temp.t('F1 escala_aplicar_recalculo recusa TAMBÉM a semana em PLANEJAMENTO (09/11): nenhuma geração grava plano no modo manual', coalesce(pg_temp.erro_de($q$select public.escala_aplicar_recalculo((select id from public.previsoes where semana_inicio = '2026-11-09'), '[]'::jsonb, '2026-11-09', 'm1', '[]'::jsonb, null, '{}'::uuid[], '{}'::jsonb)$q$), '') like 'ESCALA_AUTOMATICA_DESATIVADA%');

-- ---------- APONTAMENTO MANUAL como Clarice (perfil, sem regra por nome) ----------
select set_config('request.jwt.claims', json_build_object('sub', (select clarice_auth from _d), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare v_ap public.apontamentos_producao; v_m uuid; v_p uuid; v_f uuid; e text; begin
  select maquina, produto into v_m, v_p from _p; select func into v_f from _d;
  -- A/B/C/D/E: lança produção manual de um período PASSADO sem posto programado, escolhendo data+período+máquina+operador+produto
  v_ap := public.registrar_apontamento_producao_retroativo(v_m, v_p, v_f, 1000, 20, gen_random_uuid(), '2026-11-05', 'm1', 'teste manual', '[]'::jsonb);
  perform pg_temp.t('A/B/C/D/E Clarice lança produção manual (data, período, máquina, operador, produto) sem posto programado/escala/plano', v_ap.id is not null and v_ap.operacao_id is not null and v_ap.quantidade_produzida = 1000 and v_ap.quantidade_refugo = 20);
  -- F: corrige o apontamento
  perform public.editar_apontamento_producao(v_ap.id, v_p, v_f, 1200, 30, 'correção de teste', null, '[]'::jsonb);
  perform pg_temp.t('F Clarice corrige o apontamento (período aberto/sem owner)', (select quantidade_produzida from public.apontamentos_producao where id = v_ap.id) = 1200);
  -- G/H: período CONFIRMADO (2026-11-06 m3) sem fechar nada anterior, sem WIP/buffers
  v_ap := public.registrar_apontamento_producao_retroativo(v_m, v_p, v_f, 500, 0, gen_random_uuid(), '2026-11-06', 'm3', 'teste m3', '[]'::jsonb);
  perform pg_temp.t('G/H lança em período já CONFIRMADO, sem reabrir, sem fechar o anterior, sem WIP/buffers', v_ap.id is not null);
exception when others then perform pg_temp.t('A–H apontamento manual: ' || sqlerrm, false); end $$;
-- validações que continuam
do $$ declare v_m uuid; v_p uuid; v_f uuid; e text; v_outro uuid; begin
  select maquina, produto into v_m, v_p from _p; select func into v_f from _d;
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, -1, 0, gen_random_uuid(), '2026-11-04', 'm2', 'x', '[]'::jsonb)$q$, v_m, v_p, v_f));
  perform pg_temp.t('V produzido < 0 recusado', e like '%Quantidade produzida inválida%');
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 10, 20, gen_random_uuid(), '2026-11-04', 'm2', 'x', '[]'::jsonb)$q$, v_m, v_p, v_f));
  perform pg_temp.t('V refugo > produzido recusado', e like '%refugo%maior%');
  select p.id into v_outro from public.produtos p where p.ativo and not exists (select 1 from public.roteiro_etapas re join public.roteiro_etapa_maquinas rem on rem.etapa_id = re.id where re.produto_id = p.id and rem.maquina_id = v_m) limit 1;
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 10, 0, gen_random_uuid(), '2026-11-04', 'm2', 'x', '[]'::jsonb)$q$, v_m, v_outro, v_f));
  perform pg_temp.t('V combinação máquina×produto tecnicamente impossível recusada', e like '%Nenhuma etapa do roteiro%');
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 10, 0, gen_random_uuid(), '2026-12-31', 'm2', 'x', '[]'::jsonb)$q$, v_m, v_p, v_f));
  perform pg_temp.t('V data futura recusada', e like '%data futura%');
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 10, 0, gen_random_uuid(), '2026-11-04', 'zz', 'x', '[]'::jsonb)$q$, v_m, v_p, v_f));
  perform pg_temp.t('V período inexistente recusado', e like '%Período%não encontrado%');
end $$;
-- ---------- VÁRIOS LANÇAMENTOS POR MÁQUINA/PERÍODO (dois produtos; troca de operador) ----------
do $$ declare v_m uuid; v_p1 uuid; v_p2 uuid; v_f1 uuid; v_f2 uuid; v_mb uuid; a1 public.apontamentos_producao; a2 public.apontamentos_producao; a3 public.apontamentos_producao; e text; n int; soma numeric; sp public.apontamentos_producao;
begin
  select p.maquina, p.produto, q.produto2, d.func, q.func2, q.maquina_b into v_m, v_p1, v_p2, v_f1, v_f2, v_mb from _p p, _q q, _d d;
  perform pg_temp.t('D pré: há segundo produto, segundo operador e outra máquina para o teste', v_p2 is not null and v_f2 is not null and v_mb is not null);
  a1 := public.registrar_apontamento_producao_retroativo(v_m, v_p1, v_f1, 1000, 10, gen_random_uuid(), '2026-11-07', 'm2', 'linha 1', '[]'::jsonb);
  a2 := public.registrar_apontamento_producao_retroativo(v_m, v_p2, v_f1, 400, 5, gen_random_uuid(), '2026-11-07', 'm2', 'linha 2: segundo produto', '[]'::jsonb);
  perform pg_temp.t('D mesma máquina e período com DOIS PRODUTOS: as duas linhas gravam', a1.id is not null and a2.id is not null and a1.id <> a2.id);
  a3 := public.registrar_apontamento_producao_retroativo(v_m, v_p1, v_f2, 300, 0, gen_random_uuid(), '2026-11-07', 'm2', 'linha 3: outro operador', '[]'::jsonb);
  perform pg_temp.t('D mesma máquina, período e produto com OUTRO OPERADOR: grava (troca de operador no período)', a3.id is not null);
  select count(*), sum(quantidade_produzida) into n, soma from public.apontamentos_producao where maquina_id = v_m and data = '2026-11-07' and periodo_id = 'm2';
  perform pg_temp.t('D a máquina tem 3 lançamentos no período e a produção soma 1700 (nada sobrescrito)', n = 3 and soma = 1700);
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 50, 0, gen_random_uuid(), '2026-11-07', 'm2', 'duplicada', '[]'::jsonb)$q$, v_m, v_p1, v_f1));
  perform pg_temp.t('D lançamento duplicado (mesma máquina, produto e operador) é recusado com mensagem clara', e like '%Já existe um lançamento%');
  e := pg_temp.erro_de(format($q$select public.registrar_sem_producao_retroativo(%L, 'sem_programacao', gen_random_uuid(), '2026-11-07', 'm2')$q$, v_m));
  perform pg_temp.t('D "sem produção" NÃO pode coexistir com produção na mesma máquina/período', e like 'APONTAMENTO_MAQUINA_COM_PRODUCAO%');
  e := pg_temp.erro_de(format($q$select public.editar_apontamento_producao(%L, %L, %L, 400, 5, 'colisão', null, '[]'::jsonb)$q$, a2.id, v_p1, v_f1));
  perform pg_temp.t('D editar uma linha para colidir com outra (mesmo produto e operador) é recusado', e is not null and e like '%uq_apontamentos_producao_linha%');
  -- sem produção: um por máquina/período; produção depois dele é recusada; converter funciona
  sp := public.registrar_sem_producao_retroativo(v_mb, 'sem_programacao', gen_random_uuid(), '2026-11-07', 'm2');
  perform pg_temp.t('D "sem produção" grava numa máquina sem lançamentos', sp.id is not null and sp.status = 'sem_producao');
  e := pg_temp.erro_de(format($q$select public.registrar_sem_producao_retroativo(%L, 'sem_programacao', gen_random_uuid(), '2026-11-07', 'm2')$q$, v_mb));
  perform pg_temp.t('D segundo "sem produção" na mesma máquina/período é recusado', e like '%sem produção%');
  e := pg_temp.erro_de(format($q$select public.registrar_apontamento_producao_retroativo(%L, %L, %L, 10, 0, gen_random_uuid(), '2026-11-07', 'm2', 'x', '[]'::jsonb)$q$, v_mb, (select re.produto_id from public.roteiro_etapas re join public.roteiro_etapa_maquinas x on x.etapa_id = re.id where x.maquina_id = v_mb and re.meta_m2 > 0 limit 1), v_f1));
  perform pg_temp.t('D produção numa máquina marcada "sem produção" é recusada (converta ou exclua antes)', e like 'APONTAMENTO_MAQUINA_SEM_PRODUCAO%');
  perform public.converter_apontamento_sem_producao_para_producao(sp.id, (select re.produto_id from public.roteiro_etapas re join public.roteiro_etapa_maquinas x on x.etapa_id = re.id where x.maquina_id = v_mb and re.meta_m2 > 0 and (select count(*) from public.roteiro_etapas r3 join public.roteiro_etapa_maquinas y on y.etapa_id = r3.id where r3.produto_id = re.produto_id and y.maquina_id = v_mb) = 1 limit 1), v_f1, 100, 0, 'converter em produção');
  perform pg_temp.t('D converter "sem produção" em produção funciona (atualiza a mesma linha)', (select status from public.apontamentos_producao where id = sp.id) = 'produzindo');
exception when others then perform pg_temp.t('D desdobramento: ' || sqlerrm, false); end $$;
reset role;

-- ---------- TRIGGER do PLANEJAMENTO: INSERT direto numa data de 09/11 agora é permitido (produto legado) ----------
do $$ declare e text; begin
  e := pg_temp.ins_0911();
  perform pg_temp.t('L semana 09/11 em PLANEJAMENTO NÃO bloqueia o apontamento no modo manual (erro=' || coalesce(e, 'nenhum') || ')', e is null);
end $$;
select pg_temp.t('L planejamento 09/11 preservado (produto_unico_planejamento_desde intacto)', (select valor #>> '{}' from public.escala_parametros where chave = 'produto_unico_planejamento_desde') = '2026-11-09');
select pg_temp.t('L produto_unico_cutover continua nulo', (select valor from public.escala_parametros where chave = 'produto_unico_cutover') = 'null'::jsonb or not exists (select 1 from public.escala_parametros where chave = 'produto_unico_cutover'));

-- ---------- resumo ----------
do $$ declare f int; t int; begin select count(*) filter (where not ok), count(*) into f, t from _r;
  raise notice 'TESTE|RESUMO|% testes, % falhas', t, f; end $$;
rollback;

-- T4 (rotas M4): apontado real, indicadores, percurso de WIP, apontamento e adicional para PRODUTO DE ROTAS; a etapa final é a EXPLÍCITA (Embalar), não max(ordem) — com "Etapa Técnica" ordem 99.
-- A trava de suporte é ligada SÓ dentro desta transação de teste; tudo é desfeito no final.
do $$
declare
  F uuid; P uuid; v_usr uuid; v_maq uuid; v_func uuid; v_tec uuid := '00000000-0000-4000-8000-0000000000c1'; v_conv uuid; v_op uuid;
  v_rosq uuid; v_para uuid; v_rp uuid; v_etiq uuid; v_emb uuid; i int := 0; r record; v_n int; v_txt text; v_ok boolean; v_ctrl uuid; v_prev uuid; v_item uuid; v_pe uuid;
  v_boas numeric; v_ultima int; v_nultima int; v_eord int;
begin
  select id into F from produtos where nome = 'Conector 3/4" (Final)';
  select id into P from produtos where nome = 'Conector 3/4"' and referencia = '56126022';
  select id into v_usr from usuarios where papel = 'admin' and ativo order by id limit 1;
  select id into v_maq from maquinas where ativo order by id limit 1;
  select id into v_func from funcionarios order by id limit 1;
  select e.id into v_rosq from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Rosquear';
  select e.id into v_para from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Parafusar';
  select e.id into v_rp from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Rosquear + Parafusar';
  select e.id into v_etiq from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Etiquetar';
  select e.id into v_emb from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Embalar';
  select id into v_conv from produto_rota where produto_id = F and codigo = 'CONV';
  select id into v_op from operacoes where nome = 'Montar Presilha';
  update rotas_config set suporte_ativo = true;   -- só nesta transação de teste

  -- etapa técnica ordem 99 (exclusiva da CONV): é a de MAIOR ordem; a final explícita continua Embalar (ordem 4)
  insert into roteiro_etapas (id, produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3) values (v_tec, F, v_op, 99, 1, 1, 1, 1, 1, 1);
  insert into rota_etapas (rota_id, etapa_id, posicao) values (v_conv, v_tec, 3);

  -- (1) helpers de percurso e grupo
  select string_agg(grupo || ':' || n, ',' order by grupo) into v_txt from (select grupo, count(*) n from produto_arestas_rotas(F) group by grupo) t;
  if v_txt <> 'AUTO:0,COMUM:1,CONV:2,CONVERGENCIA:2' and v_txt <> 'COMUM:1,CONV:2,CONVERGENCIA:2' then raise exception 'FALHOU (1) arestas: %', v_txt; end if;
  if exists (select 1 from produto_arestas_rotas(F) where origem_id = v_para and destino_id = v_rp) then raise exception 'FALHOU (1) Parafusar → Rosquear+Parafusar não é aresta'; end if;
  if not exists (select 1 from produto_arestas_rotas(F) where origem_id = v_rp and destino_id = v_etiq) or not exists (select 1 from produto_arestas_rotas(F) where origem_id = v_tec and destino_id = v_etiq) then raise exception 'FALHOU (1) convergência (última exclusiva de cada rota → Etiquetar)'; end if;
  if etapa_grupo_rota(v_rosq) <> 'CONV' or etapa_grupo_rota(v_rp) <> 'AUTO' or etapa_grupo_rota(v_etiq) <> 'COMUM' or etapa_grupo_rota(v_emb) <> 'COMUM' then raise exception 'FALHOU (1) grupo da etapa'; end if;
  if etapa_grupo_rota((select id from roteiro_etapas where produto_id = P limit 1)) is not null then raise exception 'FALHOU (1) etapa de produto linear não tem grupo'; end if;
  if exists (select 1 from produto_rotas_maquinas_ambiguas(F) where n_etapas > 1 and maquina_id in (select maquina_id from roteiro_etapa_maquinas where etapa_id <> v_tec)) then raise exception 'FALHOU (1) máquina em mais de uma etapa de F'; end if;

  -- (2) apontamentos de F em TODAS as etapas (inclui a técnica); boas = produzido − refugo
  for r in select e.id etapa, e.operacao_id op, e.ordem from roteiro_etapas e where e.produto_id = F order by e.ordem loop
    i := i + 1;
    insert into apontamentos_producao (produto_id, etapa_id, operacao_id, valor_unitario_produto_vigente, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status)
    values (F, r.etapa, r.op, 0.1825, v_maq, v_func, 'm1', date '2031-05-05' + i, '09:00', 1000 * i, 10 * i, '07:12', '08:48', 100, 10, v_usr, 'produzindo');
  end loop;
  -- apontamento com etapa de OUTRO produto é recusado para produto de rotas
  begin
    insert into apontamentos_producao (produto_id, etapa_id, operacao_id, valor_unitario_produto_vigente, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status)
    values (F, (select id from roteiro_etapas where produto_id = P limit 1), (select operacao_id from roteiro_etapas where produto_id = P limit 1), 0.1825, v_maq, v_func, 'm2', date '2031-05-05', '09:00', 1, 0, '08:48', '10:24', 100, 10, v_usr, 'produzindo'); v_ok := false;
  exception when others then v_ok := position('APONTAMENTO_ETAPA_FORA_DO_PRODUTO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (2) etapa de outro produto deveria ser recusada'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from usuarios where id = v_usr), 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- apontado real: a "última" é a final explícita (ordem de Embalar), com UMA etapa nessa ordem
  select ultima_ordem, n_na_ultima_ordem, etapa_ordem into v_ultima, v_nultima, v_eord from obter_apontado_real_previsao_por_semana('2031-05-05') where produto_id = F and etapa_id = v_emb;
  if v_ultima is distinct from (select ordem from roteiro_etapas where id = v_emb) or v_nultima <> 1 or v_eord <> v_ultima then raise exception 'FALHOU (2) apontado real: ultima_ordem=% n=% etapa=%', v_ultima, v_nultima, v_eord; end if;
  select ultima_ordem, etapa_ordem into v_ultima, v_eord from obter_apontado_real_previsao_por_semana('2031-05-05') where produto_id = F and etapa_id = v_tec;
  if v_eord = v_ultima then raise exception 'FALHOU (2) a etapa técnica (ordem 99) não pode ser a última'; end if;
  select quantidade_boa into v_boas from obter_apontado_real_previsao_por_semana('2031-05-05') where produto_id = F and etapa_id = v_emb;
  if v_boas <> (select 1000 * o - 10 * o from (select count(*) filter (where ordem <= (select ordem from roteiro_etapas where id = v_emb)) o from roteiro_etapas where produto_id = F) t) then raise exception 'FALHOU (2) boas = produzido − refugo: %', v_boas; end if;
  -- indicadores: só o apontamento de Embalar é "última etapa"
  select count(*) filter (where is_ultima_etapa), count(*) filter (where is_ultima_etapa is false) into v_n, i from obter_indicadores_producao('2031-05-01', '2031-05-31', F);
  if v_n <> 1 or i <> (select count(*) - 1 from roteiro_etapas where produto_id = F) then raise exception 'FALHOU (2) is_ultima_etapa: finais=% outras=%', v_n, i; end if;
  if not (select is_ultima_etapa from obter_indicadores_producao('2031-05-01', '2031-05-31', F) where etapa_id = v_emb) then raise exception 'FALHOU (2) Embalar deveria ser a última'; end if;
  reset role;

  -- (3) WIP: percurso, nunca ordem+1
  v_ctrl := wip_controle_criar(v_usr, F, v_rosq, v_para, date '2031-05-01', 0);                      -- dentro da CONV
  perform wip_controle_criar(v_usr, F, v_para, v_tec, date '2031-05-01', 0);                          -- CONV continua na etapa técnica
  perform wip_controle_criar(v_usr, F, v_tec, v_etiq, date '2031-05-01', 0);                           -- convergência da CONV
  perform wip_controle_criar(v_usr, F, v_rp, v_etiq, date '2031-05-01', 0);                            -- convergência da AUTO (mesma etapa seguinte, outra origem)
  perform wip_controle_criar(v_usr, F, v_etiq, v_emb, date '2031-05-01', 0);                           -- fluxo comum
  begin perform wip_controle_criar(v_usr, F, v_para, v_rp, date '2031-05-01', 0); v_ok := false; exception when others then v_ok := position('WIP_ETAPAS_FORA_DO_PERCURSO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3) Parafusar → Rosquear+Parafusar deveria ser recusado'; end if;
  begin perform wip_controle_criar(v_usr, F, v_rosq, v_etiq, date '2031-05-01', 0); v_ok := false; exception when others then v_ok := position('WIP_ETAPAS_FORA_DO_PERCURSO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (3) pular etapas deveria ser recusado'; end if;
  if public.produto_usa_rotas(P) then raise exception 'FALHOU (3) P é linear'; end if;   -- produto linear segue a regra de ordem imediatamente posterior (coberto pelo golden/testes do WIP)

  -- (4) adicional de produto de rotas é recusado (a regra por ordem é falsa para ele)
  insert into previsoes (id, semana_inicio, modelo_rotas) values (gen_random_uuid(), '2031-05-05', true) returning id into v_prev;
  insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev, 'previsto', F, 'F', 0.1825, 1000) returning id into v_item;
  begin update previsao_itens set quantidade_adicional = 10 where id = v_item; v_ok := false; exception when others then v_ok := position('ROTAS_ADICIONAL_NAO_SUPORTADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) adicional em F deveria ser recusado'; end if;
  begin insert into previsao_item_adicional_etapa (item_id, etapa_id, quantidade) values (v_item, v_rp, 5); v_ok := false; exception when others then v_ok := position('ROTAS_ADICIONAL_NAO_SUPORTADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (4) adicional por etapa em F deveria ser recusado'; end if;

  -- (5) trava continua fechada fora desta transação
  raise exception 'TESTE_OK rotas T4: apontado real/indicadores por etapa final explícita (Embalar, técnica 99 não conta); percurso de WIP com convergência; apontamento só com etapa do produto; adicional de rotas recusado; linear intacto';
end $$;

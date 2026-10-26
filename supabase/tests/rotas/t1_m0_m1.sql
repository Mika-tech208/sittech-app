-- T1 (rotas M0/M1): estruturas aditivas + produto final F + proteções. Tudo desfeito no final. Prova: nenhum cadastro legado alterado; F com ids novos; CONV/AUTO convergem no mesmo pool;
-- Etiquetar/Embalar uma vez; AUTO = 35.625 a partir das metas; Etiquetadora 15 = 97.500; etapa final explícita; mistura de semana de rotas × produtos legados bloqueada.
do $$
declare
  F uuid; P uuid; A uuid; v_j jsonb; v_n int; v_ok boolean; v_prev uuid; v_prev2 uuid; v_msg text;
  leg_etapas uuid[]; f_etapas uuid[]; v_rp uuid; v_emb uuid; v_etiq uuid; v_conv uuid; v_auto uuid; v_capacidade numeric; v_maq text[];
  v_luva uuid;
begin
  select id into F from produtos where nome = 'Conector 3/4" (Final)';
  select id into P from produtos where nome = 'Conector 3/4"' and referencia = '56126022';
  select id into A from produtos where btrim(nome) = 'Conector 3/4" - Maquina Automatica';
  if F is null or P is null or A is null then raise exception 'FALHOU (0) cadastros: F=% P=% A=%', F, P, A; end if;

  -- (1) produto F: nome, referência, preço único; legados intactos (preços e nomes)
  if (select valor_unitario from produtos where id = F) <> 0.1825 or (select referencia from produtos where id = F) <> '56126022' then raise exception 'FALHOU (1) F preço/referência'; end if;
  if (select valor_unitario from produtos where id = P) <> 0.1825 or (select valor_unitario from produtos where id = A) <> 0.182 then raise exception 'FALHOU (1) os preços LEGADOS não podem mudar (P 0,1825 / A 0,182)'; end if;
  if (select nome from produtos where id = P) <> 'Conector 3/4"' or (select count(*) from produtos where nome like 'Conector 3/4%') <> 3 then raise exception 'FALHOU (1) nomes legados / produtos novos além de F'; end if;

  -- (2) ids totalmente novos
  select array_agg(id) into leg_etapas from roteiro_etapas where produto_id in (P, A);
  select array_agg(id order by ordem) into f_etapas from roteiro_etapas where produto_id = F;
  if array_length(f_etapas, 1) <> 5 then raise exception 'FALHOU (2) F deveria ter 5 etapas: %', array_length(f_etapas, 1); end if;
  if F = any (array[P, A]) or f_etapas && leg_etapas then raise exception 'FALHOU (2) ids de F colidem com legados'; end if;
  if (select count(distinct id) from roteiro_etapas where produto_id = F) <> 5 then raise exception 'FALHOU (2) ids repetidos'; end if;

  -- (3) roteiros LEGADOS intactos (mesmas etapas, mesma ordem, nenhuma etapa nova)
  if (select count(*) from roteiro_etapas where produto_id = P) <> 4 or (select count(*) from roteiro_etapas where produto_id = A) <> 3 then raise exception 'FALHOU (3) quantidade de etapas legadas mudou'; end if;
  if (select string_agg(o.nome || ':' || e.ordem, ',' order by e.ordem) from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = P) <> 'Rosquear:0,Parafusar:1,Etiquetar:2,Embalar:3' then raise exception 'FALHOU (3) roteiro de P mudou'; end if;
  if (select string_agg(o.nome || ':' || e.ordem, ',' order by e.ordem) from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = A) <> 'Rosquear + Parafusar:0,Etiquetar:1,Embalar:2' then raise exception 'FALHOU (3) roteiro de A mudou'; end if;

  -- (4) etapas de F: ordem 0..4 (rótulo), Etiquetar e Embalar UMA vez, metas/máquinas copiadas por VALOR dos legados
  if (select string_agg(o.nome || ':' || e.ordem, ',' order by e.ordem) from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F) <> 'Rosquear:0,Parafusar:1,Rosquear + Parafusar:2,Etiquetar:3,Embalar:4' then raise exception 'FALHOU (4) etapas de F'; end if;
  if (select count(*) from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Etiquetar') <> 1 or (select count(*) from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Embalar') <> 1 then raise exception 'FALHOU (4) Etiquetar/Embalar devem existir uma única vez em F'; end if;
  select e.id into v_etiq from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Etiquetar';
  select e.id into v_emb from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Embalar';
  select e.id into v_rp from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Rosquear + Parafusar';
  if exists (
    select 1 from roteiro_etapas ef join roteiro_etapas el on el.operacao_id = ef.operacao_id and el.produto_id in (P, A) and (
        (ef.operacao_id = (select id from operacoes where nome = 'Rosquear + Parafusar') and el.produto_id = A) or (ef.operacao_id <> (select id from operacoes where nome = 'Rosquear + Parafusar') and el.produto_id = P))
    where ef.produto_id = F and (ef.meta_m1, ef.meta_m2, ef.meta_m3, ef.meta_t1, ef.meta_t2, ef.meta_t3) is distinct from (el.meta_m1, el.meta_m2, el.meta_m3, el.meta_t1, el.meta_t2, el.meta_t3)) then raise exception 'FALHOU (4) metas de F não são cópia dos legados'; end if;
  if exists (
    select 1 from roteiro_etapas ef join roteiro_etapas el on el.operacao_id = ef.operacao_id and el.produto_id in (P, A) and (
        (ef.operacao_id = (select id from operacoes where nome = 'Rosquear + Parafusar') and el.produto_id = A) or (ef.operacao_id <> (select id from operacoes where nome = 'Rosquear + Parafusar') and el.produto_id = P))
    where ef.produto_id = F and (select coalesce(array_agg(maquina_id order by maquina_id), '{}') from roteiro_etapa_maquinas where etapa_id = ef.id) is distinct from (select coalesce(array_agg(maquina_id order by maquina_id), '{}') from roteiro_etapa_maquinas where etapa_id = el.id)) then raise exception 'FALHOU (4) máquinas de F não são cópia dos legados'; end if;

  -- (5) rotas e convergência
  select id into v_conv from produto_rota where produto_id = F and codigo = 'CONV'; select id into v_auto from produto_rota where produto_id = F and codigo = 'AUTO';
  if v_conv is null or v_auto is null or (select count(*) from produto_rota where produto_id = F) <> 2 then raise exception 'FALHOU (5) rotas CONV/AUTO'; end if;
  v_j := public.produto_estrutura_rotas(F);
  if v_j ->> 'modelo' <> 'rotas' or v_j ->> 'regraEtapaFinal' <> 'explicita' then raise exception 'FALHOU (5) modelo/regra: %', v_j; end if;
  if (v_j -> 'poolComum' ->> 'entradaId')::uuid <> v_etiq or (v_j ->> 'etapaFinalId')::uuid <> v_emb then raise exception 'FALHOU (5) pool comum/etapa final: %', v_j; end if;
  if jsonb_array_length(v_j -> 'poolComum' -> 'etapas') <> 2 or (v_j -> 'poolComum' -> 'etapas' ->> 0)::uuid <> v_etiq or (v_j -> 'poolComum' -> 'etapas' ->> 1)::uuid <> v_emb then raise exception 'FALHOU (5) sequência do pool comum'; end if;
  -- as DUAS rotas convergem no MESMO pool: nenhuma delas contém Etiquetar/Embalar; a última etapa exclusiva de cada uma é anterior à entrada do pool
  if (select count(*) from rota_etapas where etapa_id in (v_etiq, v_emb)) <> 0 then raise exception 'FALHOU (5) etapa comum não pode ser exclusiva de rota'; end if;
  if (select string_agg(o.nome, '>' order by re.posicao) from rota_etapas re join roteiro_etapas e on e.id = re.etapa_id join operacoes o on o.id = e.operacao_id where re.rota_id = v_conv) <> 'Rosquear>Parafusar'
     or (select string_agg(o.nome, '>' order by re.posicao) from rota_etapas re join roteiro_etapas e on e.id = re.etapa_id join operacoes o on o.id = e.operacao_id where re.rota_id = v_auto) <> 'Rosquear + Parafusar' then raise exception 'FALHOU (5) etapas das rotas'; end if;
  if (select count(*) from produto_pool_comum where produto_id = F) <> 1 + 1 then raise exception 'FALHOU (5) um único pool comum (Etiquetar+Embalar)'; end if;
  if (select count(*) from produto_variante_legada where produto_final_id = F) <> 2 or (select rota_id from produto_variante_legada where produto_legado_id = P) <> v_conv or (select rota_id from produto_variante_legada where produto_legado_id = A) <> v_auto then raise exception 'FALHOU (5) vínculo analítico dos legados'; end if;

  -- (5b) convergência EXPLÍCITA e rotas = SÓ trecho exclusivo: origens = última etapa exclusiva de cada rota → destino = Etiquetar (entrada do fluxo comum)
  if (v_j -> 'convergencia' ->> 'destinoId')::uuid <> v_etiq then raise exception 'FALHOU (5b) destino da convergência: %', v_j -> 'convergencia'; end if;
  if jsonb_array_length(v_j -> 'convergencia' -> 'origens') <> 2
     or (select (o ->> 'etapaId')::uuid from jsonb_array_elements(v_j -> 'convergencia' -> 'origens') o where o ->> 'rotaCodigo' = 'AUTO') <> v_rp
     or (select (o ->> 'etapaId')::uuid from jsonb_array_elements(v_j -> 'convergencia' -> 'origens') o where o ->> 'rotaCodigo' = 'CONV') <> (select e.id from roteiro_etapas e join operacoes o2 on o2.id = e.operacao_id where e.produto_id = F and o2.nome = 'Parafusar') then
    raise exception 'FALHOU (5b) origens da convergência (AUTO: Rosquear+Parafusar; CONV: Parafusar): %', v_j -> 'convergencia';
  end if;
  if (select count(*) from rota_etapas where rota_id in (v_conv, v_auto)) <> 3 then raise exception 'FALHOU (5b) rota_etapas deve ter SÓ as 3 etapas exclusivas'; end if;
  -- nenhuma peça CONV passa por R+P e nenhuma AUTO por Rosquear/Parafusar: as listas exclusivas são disjuntas e o pool comum é único
  if (select count(*) from rota_etapas a join rota_etapas b on a.etapa_id = b.etapa_id and a.rota_id <> b.rota_id) <> 0 then raise exception 'FALHOU (5b) etapa exclusiva em duas rotas'; end if;
  if (select ativo from produtos where id = F) then raise exception 'FALHOU (5b) F deve nascer INATIVO (não ativado)'; end if;

  -- (6) etapa final EXPLÍCITA em F; produto linear segue a regra legada (max ordem) e é 'linear'
  if public.produto_etapa_final(F) <> v_emb then raise exception 'FALHOU (6) etapa final de F'; end if;
  if (public.produto_estrutura_rotas(P) ->> 'modelo') <> 'linear' or public.produto_etapa_final(P) <> (select id from roteiro_etapas where produto_id = P order by ordem desc limit 1) then raise exception 'FALHOU (6) produto linear mudou de regra'; end if;
  if (public.produto_estrutura_rotas(A) ->> 'modelo') <> 'linear' then raise exception 'FALHOU (6) legado A virou rotas'; end if;

  -- (7) G: capacidade da AUTO emerge das metas (7.125/dia × 5 dias = 35.625); máquina única = Máquina Automática 8
  select (meta_m1 + meta_m2 + meta_m3 + meta_t1 + meta_t2 + meta_t3) * 5 into v_capacidade from roteiro_etapas where id = v_rp;
  if v_capacidade <> 35625 then raise exception 'FALHOU (7) capacidade AUTO = % (esperado 35625 nas condições atuais)', v_capacidade; end if;
  select array_agg(m.nome order by m.nome) into v_maq from roteiro_etapa_maquinas rm join maquinas m on m.id = rm.maquina_id where rm.etapa_id = v_rp;
  if v_maq <> array['Maquina Automatica 8 '] and v_maq <> array['Maquina Automatica 8'] then raise exception 'FALHOU (7) máquina da AUTO: %', v_maq; end if;

  -- (8) H: Etiquetadora 15 = 97.500/semana; o pool comum a oferece como elegível (E16 também elegível, mas NÃO reservada)
  select (meta_m1 + meta_m2 + meta_m3 + meta_t1 + meta_t2 + meta_t3) * 5 into v_capacidade from roteiro_etapas where id = v_etiq;
  if v_capacidade <> 97500 then raise exception 'FALHOU (8) Etiquetar por máquina = % (esperado 97500)', v_capacidade; end if;
  if (select count(*) from roteiro_etapa_maquinas rm join maquinas m on m.id = rm.maquina_id where rm.etapa_id = v_etiq and m.nome in ('Etiquetadora 15', 'Etiquetadora 16')) <> 2 then raise exception 'FALHOU (8) máquinas de Etiquetar'; end if;

  -- (9) integridade (validada no COMMIT; aqui antecipada com SET CONSTRAINTS): cada violação precisa ser recusada e desfeita
  v_msg := null;
  begin  -- "Etiquetar CONV": etapa Etiquetar exclusiva da rota CONV
    insert into roteiro_etapas (id, produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3) values ('00000000-0000-4000-8000-0000000000a1', F, (select operacao_id from roteiro_etapas where id = v_etiq), 9, 1, 1, 1, 1, 1, 1);
    insert into rota_etapas (rota_id, etapa_id, posicao) values (v_conv, '00000000-0000-4000-8000-0000000000a1', 2);
    set constraints all immediate; v_ok := false;
  exception when others then v_ok := position('ROTAS_ETAPA_COMUM_DUPLICADA' in sqlerrm) > 0; v_msg := sqlerrm; end;
  if not v_ok then raise exception 'FALHOU (9a) "Etiquetar CONV" deveria ser recusado: %', v_msg; end if;
  v_msg := null;
  begin  -- etapa órfã (fora de rota e de pool)
    insert into roteiro_etapas (id, produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3) values ('00000000-0000-4000-8000-0000000000a2', F, (select id from operacoes where nome = 'Montar Presilha'), 9, 1, 1, 1, 1, 1, 1);
    set constraints all immediate; v_ok := false;
  exception when others then v_ok := position('ROTAS_ETAPA_FORA_DO_MODELO' in sqlerrm) > 0; v_msg := sqlerrm; end;
  if not v_ok then raise exception 'FALHOU (9b) etapa órfã deveria ser recusada: %', v_msg; end if;
  v_msg := null;
  begin  -- etapa final que não é a última do pool
    update produto_pool_comum set final = false where produto_id = F and etapa_id = v_emb;
    update produto_pool_comum set final = true where produto_id = F and etapa_id = v_etiq;
    set constraints all immediate; v_ok := false;
  exception when others then v_ok := position('ROTAS_FINAL_NAO_E_A_ULTIMA' in sqlerrm) > 0; v_msg := sqlerrm; end;
  if not v_ok then raise exception 'FALHOU (9c) final fora da última posição: %', v_msg; end if;
  v_msg := null;
  begin  -- etapa de outro produto numa rota
    insert into rota_etapas (rota_id, etapa_id, posicao) values (v_conv, (select id from roteiro_etapas where produto_id = P limit 1), 5);
    v_ok := false;
  exception when others then v_ok := position('ROTAS_ETAPA_DE_OUTRO_PRODUTO' in sqlerrm) > 0; v_msg := sqlerrm; end;
  if not v_ok then raise exception 'FALHOU (9d) etapa legada numa rota de F: %', v_msg; end if;

  -- (10) PROTEÇÃO CONTRA MISTURA (Previsão): semana legada × produto de rotas e semana de rotas × produtos legados
  select id into v_luva from produtos where nome = 'Luva 3/4"' limit 1;
  -- (10-) TRAVA DE SUPORTE: com rotas_config.suporte_ativo = false o produto de rotas NÃO entra em nenhum fluxo (Previsão em modo rotas, apontamento, WIP)
  if public.rotas_suporte_ativo() then raise exception 'FALHOU (10-) suporte deveria nascer desativado'; end if;
  begin insert into previsoes (id, semana_inicio, modelo_rotas) values (gen_random_uuid(), '2031-03-24', true); v_ok := false;
  exception when others then v_ok := position('PREVISAO_MODELO_ROTAS_BLOQUEADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (10-a) semana de rotas deveria ser bloqueada sem suporte'; end if;
  begin
    insert into apontamentos_producao (produto_id, etapa_id, operacao_id, valor_unitario_produto_vigente, maquina_id, funcionario_id, periodo_id, data, hora_lancamento, quantidade_produzida, quantidade_refugo, periodo_inicio_vigente, periodo_fim_vigente, meta_periodo_vigente, custo_hora_operacao_vigente, criado_por, status)
    values (F, v_emb, (select operacao_id from roteiro_etapas where id = v_emb), 0.1, (select id from maquinas where ativo limit 1), (select id from funcionarios limit 1), 'm1', '2031-03-03', '09:00', 10, 0, '07:12', '08:48', 100, 10, (select id from usuarios where papel = 'admin' and ativo limit 1), 'produzindo');
    v_ok := false;
  exception when others then v_ok := position('PRODUTO_DE_ROTAS_FORA_DE_USO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (10-b) apontamento do produto de rotas deveria ser bloqueado sem suporte'; end if;
  begin insert into wip_controle (produto_id, etapa_origem_id, etapa_seguinte_id, data_inicio, saldo_inicial) values (F, (select e.id from roteiro_etapas e join operacoes o2 on o2.id = e.operacao_id where e.produto_id = F and o2.nome = 'Parafusar'), v_rp, '2031-03-03', 0); v_ok := false;
  exception when others then v_ok := position('PRODUTO_DE_ROTAS_FORA_DE_USO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (10-c) WIP do produto de rotas (ex.: Parafusar → Rosquear+Parafusar, falso) deveria ser bloqueado'; end if;
  update rotas_config set suporte_ativo = true;   -- só dentro desta transação de teste (desfeita no final)
  insert into previsoes (id, semana_inicio) values (gen_random_uuid(), '2031-03-03') returning id into v_prev;
  insert into previsoes (id, semana_inicio, modelo_rotas) values (gen_random_uuid(), '2031-03-10', true) returning id into v_prev2;
  if (select modelo_rotas from previsoes where id = v_prev) then raise exception 'FALHOU (10) default deveria ser false'; end if;
  begin insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev, 'previsto', F, 'F', 0.1825, 1); v_ok := false;
  exception when others then v_ok := position('PREVISAO_PRODUTO_DE_ROTAS_EM_SEMANA_LEGADA' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (10a) F em semana legada deveria ser recusado'; end if;
  insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev, 'previsto', P, 'Conector 3/4"', 0.1825, 81000), (v_prev, 'previsto', A, 'Conector 3/4" - Maq. Aut.', 0.182, 35625);   -- semana LEGADA aceita os legados, como hoje
  begin update previsoes set modelo_rotas = true where id = v_prev; v_ok := false;
  exception when others then v_ok := position('PREVISAO_MODELO_ROTAS_ITENS_LEGADOS' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (10b) ativar rotas com itens legados deveria ser recusado'; end if;
  begin insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev2, 'previsto', P, 'Conector 3/4"', 0.1825, 1); v_ok := false;
  exception when others then v_ok := position('PREVISAO_MODELO_ROTAS_PRODUTO_LEGADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (10c) legado P em semana de rotas deveria ser recusado'; end if;
  begin insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev2, 'previsto', A, 'Conector 3/4" - Maq. Aut.', 0.182, 1); v_ok := false;
  exception when others then v_ok := position('PREVISAO_MODELO_ROTAS_PRODUTO_LEGADO' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (10d) legado A em semana de rotas deveria ser recusado'; end if;
  insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev2, 'previsto', F, 'Conector 3/4" (Final)', 0.1825, 116625);   -- F entra na semana de rotas
  if v_luva is not null then insert into previsao_itens (previsao_id, tipo, produto_id, produto_nome, valor_unitario, quantidade) values (v_prev2, 'previsto', v_luva, 'Luva 3/4"', 0.2318, 1000); end if;   -- produto LINEAR comum continua aceito
  begin update previsoes set modelo_rotas = false where id = v_prev2; v_ok := false;
  exception when others then v_ok := position('PREVISAO_MODELO_ROTAS_ITENS_DE_ROTAS' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (10e) voltar ao legado com itens de rotas deveria ser recusado'; end if;

  -- (11) limites por rota: V1 só MÁXIMO; divisão append-only; semanas existentes continuam legadas
  insert into previsao_rota_limite (previsao_id, produto_id, rota_id, modo, quantidade) values (v_prev2, F, v_auto, 'maximo', 35625);
  begin insert into previsao_rota_limite (previsao_id, produto_id, rota_id, modo, quantidade) values (v_prev2, F, v_conv, 'minimo', 1); v_ok := false; exception when others then v_ok := position('previsao_rota_limite_modo_check' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (11a) modo mínimo não é suportado na V1'; end if;
  insert into escala_rota_divisao (previsao_id, produto_id, rota_id, quantidade_alvo) values (v_prev2, F, v_auto, 35625);
  begin update escala_rota_divisao set quantidade_alvo = 1; v_ok := false; exception when others then v_ok := position('IMUTAVEL' in sqlerrm) > 0; end;
  if not v_ok then raise exception 'FALHOU (11b) escala_rota_divisao deveria ser append-only'; end if;
  if (select count(*) from previsoes where modelo_rotas and semana_inicio < '2031-01-01') <> 0 then raise exception 'FALHOU (11c) nenhuma semana existente pode estar em modo rotas'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('produtos', 'roteiro_etapas', 'roteiro_etapa_maquinas', 'previsao_itens', 'previsao_item_maquinas', 'apontamentos_producao', 'wip_controle', 'escala_producao_alocacoes') and (column_name like '%rota%' or column_name like 'modelo%')) then raise exception 'FALHOU (11d) tabelas antigas ganharam colunas de rotas'; end if;

  -- (12) o servidor (service_role) enxerga as estruturas (sem isso o golden master/planejador não conseguem ler)
  set local role service_role;
  select count(*) into v_n from produto_rota; select count(*) into v_n from rota_etapas; select count(*) into v_n from produto_pool_comum; perform public.produto_estrutura_rotas(F);
  reset role;

  raise exception 'TESTE_OK rotas T1: F com ids novos (5 etapas), CONV/AUTO convergem no pool comum (Etiquetar+Embalar uma vez), etapa final explícita, AUTO=35.625 pelas metas, E15=97.500, legados intactos, integridade e mistura bloqueadas';
end $$;

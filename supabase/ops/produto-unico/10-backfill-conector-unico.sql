-- Sittech — F1: BACKFILL NÃO DESTRUTIVO do produto canônico "Conector 3/4" (Final) + rotas + mapa de legado. NÃO É MIGRATION (dados): executar à mão, DEPOIS de
-- (1) as migrations 20261115100000/110000/120000 aplicadas e (2) o código com o GUARD (produto único escondido das telas sem cutover) no ar.
--
-- O que faz (uma transação; idempotente — se o canônico CONECTOR_3_4 já existe, só revalida):
--   • cria o produto canônico INATIVO (ativo=false), com etapas NOVAS copiadas dos legados (metas e máquinas elegíveis idênticas; operação idêntica):
--       ordem 0 M8 "Rosquear + Parafusar" (Automática) · 1 Rosquear · 2 Parafusar (Convencional) · 3 Etiquetar (COMUM) · 4 Embalar (FINAL, maior ordem => "última etapa" dos RPCs = Embalar)
--   • rotas ROTA 1 — Convencional / ROTA 2 — Automática; grafo explícito (Rosquear->Parafusar->Etiquetar, M8->Etiquetar, Etiquetar->Embalar); mapa produto/etapa legado -> canônico
--   • trilha em produto_canonico_ativacoes (acao 'backfill')
-- O que NÃO faz: não toca nos produtos/etapas/apontamentos/alocações/previsão LEGADOS; não ativa nada (produto_unico_cutover continua null); não cria item de Previsão.
-- ABORTA (sem gravar nada) se: legados ausentes; Etiquetar/Embalar dos dois legados divergirem em operação, máquinas ou metas (as etapas comuns têm que ser equivalentes — mesma regra de
-- fusão do motor); algum legado já mapeado para outro canônico; o grafo/cadastro canônico tiver problema.
-- Preço: valor_unitario do produto único = o do Convencional (0,1825). O da Automática é 0,182 (diferença de R$ 0,0005/peça) — DECISÃO DO USUÁRIO (preço único); ajustar aqui antes de rodar se for outro.
-- Rollback: supabase/rollbacks/20261115100000_rollback_produto_canonico_1_backfill.sql.

do $backfill$
declare
  v_conv constant uuid := '27c229d7-f192-41eb-aad1-0c69ece53eba';
  v_auto constant uuid := 'a027ac97-ffd1-4834-8ed0-d3a94aac4aee';
  v_preco numeric;
  v_ref text;
  v_prio text;
  v_prod uuid;
  v_rota1 uuid;
  v_rota2 uuid;
  v_n int;
  r record;
  -- etapas legadas (resolvidas por produto + nome da operação)
  e_conv_ros uuid; e_conv_par uuid; e_conv_eti uuid; e_conv_emb uuid; e_auto_m8 uuid; e_auto_eti uuid; e_auto_emb uuid;
  c_m8 uuid; c_ros uuid; c_par uuid; c_eti uuid; c_emb uuid;
  v_problemas text;
begin
  if exists (select 1 from public.produto_canonico where codigo = 'CONECTOR_3_4_UNICO') then
    select produto_id into v_prod from public.produto_canonico where codigo = 'CONECTOR_3_4_UNICO';
    select string_agg(p, '; ') into v_problemas from public.produto_canonico_problemas(v_prod) p;
    if v_problemas is not null then raise exception 'canônico já existe mas com problemas: %', v_problemas; end if;
    raise notice 'backfill: CONECTOR_3_4 já existe (%), nada a fazer (revalidado: íntegro)', v_prod;
    return;
  end if;

  if (select count(*) from public.produtos where id in (v_conv, v_auto)) <> 2 then raise exception 'produtos legados Conector 3/4 (Convencional/Automática) não encontrados'; end if;
  if exists (select 1 from public.produto_legado_mapa where produto_legado_id in (v_conv, v_auto)) then raise exception 'legado já mapeado para outro canônico'; end if;

  select valor_unitario, referencia, prioridade into v_preco, v_ref, v_prio from public.produtos where id = v_conv;

  -- resolve as etapas legadas (exatamente UMA por papel; senão aborta)
  select e.id into strict e_conv_ros from public.roteiro_etapas e join public.operacoes o on o.id = e.operacao_id where e.produto_id = v_conv and o.nome = 'Rosquear';
  select e.id into strict e_conv_par from public.roteiro_etapas e join public.operacoes o on o.id = e.operacao_id where e.produto_id = v_conv and o.nome = 'Parafusar';
  select e.id into strict e_conv_eti from public.roteiro_etapas e join public.operacoes o on o.id = e.operacao_id where e.produto_id = v_conv and o.nome = 'Etiquetar';
  select e.id into strict e_conv_emb from public.roteiro_etapas e join public.operacoes o on o.id = e.operacao_id where e.produto_id = v_conv and o.nome = 'Embalar';
  select e.id into strict e_auto_m8 from public.roteiro_etapas e join public.operacoes o on o.id = e.operacao_id where e.produto_id = v_auto and o.nome = 'Rosquear + Parafusar';
  select e.id into strict e_auto_eti from public.roteiro_etapas e join public.operacoes o on o.id = e.operacao_id where e.produto_id = v_auto and o.nome = 'Etiquetar';
  select e.id into strict e_auto_emb from public.roteiro_etapas e join public.operacoes o on o.id = e.operacao_id where e.produto_id = v_auto and o.nome = 'Embalar';
  if (select count(*) from public.roteiro_etapas where produto_id = v_conv) <> 4 or (select count(*) from public.roteiro_etapas where produto_id = v_auto) <> 3 then
    raise exception 'roteiro dos legados mudou (esperado 4 + 3 etapas)';
  end if;

  -- etapas COMUNS equivalentes: mesma operação, mesmo conjunto de máquinas, mesmas metas
  for r in select * from (values ('Etiquetar', e_conv_eti, e_auto_eti), ('Embalar', e_conv_emb, e_auto_emb)) t(rotulo, ec, ea) loop
    if (select operacao_id from public.roteiro_etapas where id = r.ec) is distinct from (select operacao_id from public.roteiro_etapas where id = r.ea) then
      raise exception 'etapa comum %: operações diferentes', r.rotulo; end if;
    if exists ((select maquina_id from public.roteiro_etapa_maquinas where etapa_id = r.ec except select maquina_id from public.roteiro_etapa_maquinas where etapa_id = r.ea)
               union all (select maquina_id from public.roteiro_etapa_maquinas where etapa_id = r.ea except select maquina_id from public.roteiro_etapa_maquinas where etapa_id = r.ec)) then
      raise exception 'etapa comum %: conjuntos de máquinas diferentes', r.rotulo; end if;
    if (select (meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3) from public.roteiro_etapas where id = r.ec)
       is distinct from (select (meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3) from public.roteiro_etapas where id = r.ea) then
      raise exception 'etapa comum %: metas diferentes', r.rotulo; end if;
  end loop;

  -- produto canônico (INATIVO)
  insert into public.produtos (nome, referencia, valor_unitario, ativo, prioridade)
    values ('Conector 3/4" (Produto Único)', v_ref, v_preco, false, v_prio) returning id into v_prod;
  insert into public.produto_canonico (produto_id, codigo, nome_exibicao, observacao)
    values (v_prod, 'CONECTOR_3_4_UNICO', 'Conector 3/4"', 'Produto único Conector 3/4 com 2 rotas (Convencional/Automática); ativado só por produto_unico_ativar');
  insert into public.produto_rotas (produto_id, codigo, nome, tipo, ordem) values (v_prod, 'CONVENCIONAL', 'ROTA 1 — Convencional', 'convencional', 1) returning id into v_rota1;
  insert into public.produto_rotas (produto_id, codigo, nome, tipo, ordem) values (v_prod, 'AUTOMATICA', 'ROTA 2 — Automática', 'automatica', 2) returning id into v_rota2;

  -- etapas novas (metas copiadas do legado correspondente; ordem: ver cabeçalho)
  insert into public.roteiro_etapas (produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3)
    select v_prod, operacao_id, 0, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3 from public.roteiro_etapas where id = e_auto_m8 returning id into c_m8;
  insert into public.roteiro_etapas (produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3)
    select v_prod, operacao_id, 1, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3 from public.roteiro_etapas where id = e_conv_ros returning id into c_ros;
  insert into public.roteiro_etapas (produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3)
    select v_prod, operacao_id, 2, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3 from public.roteiro_etapas where id = e_conv_par returning id into c_par;
  insert into public.roteiro_etapas (produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3)
    select v_prod, operacao_id, 3, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3 from public.roteiro_etapas where id = e_conv_eti returning id into c_eti;
  insert into public.roteiro_etapas (produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3)
    select v_prod, operacao_id, 4, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3 from public.roteiro_etapas where id = e_conv_emb returning id into c_emb;
  insert into public.roteiro_etapa_maquinas (etapa_id, maquina_id)
    select c.novo, m.maquina_id from (values (c_m8, e_auto_m8), (c_ros, e_conv_ros), (c_par, e_conv_par), (c_eti, e_conv_eti), (c_emb, e_conv_emb)) c(novo, velho)
    join public.roteiro_etapa_maquinas m on m.etapa_id = c.velho;

  insert into public.produto_canonico_etapas (etapa_id, produto_id, rota_id, papel) values
    (c_m8, v_prod, v_rota2, 'ROTA'), (c_ros, v_prod, v_rota1, 'ROTA'), (c_par, v_prod, v_rota1, 'ROTA'), (c_eti, v_prod, null, 'COMUM'), (c_emb, v_prod, null, 'FINAL');
  insert into public.produto_canonico_arestas (origem_etapa_id, destino_etapa_id) values (c_ros, c_par), (c_par, c_eti), (c_m8, c_eti), (c_eti, c_emb);

  insert into public.produto_legado_mapa (produto_legado_id, produto_canonico_id, rota_id, observacao) values
    (v_conv, v_prod, v_rota1, 'Conector 3/4" Convencional -> ROTA 1'), (v_auto, v_prod, v_rota2, 'Conector 3/4" Máquina Automática -> ROTA 2');
  insert into public.etapa_legado_mapa (etapa_legado_id, etapa_canonica_id, produto_legado_id) values
    (e_conv_ros, c_ros, v_conv), (e_conv_par, c_par, v_conv), (e_conv_eti, c_eti, v_conv), (e_conv_emb, c_emb, v_conv),
    (e_auto_m8, c_m8, v_auto), (e_auto_eti, c_eti, v_auto), (e_auto_emb, c_emb, v_auto);

  select string_agg(p, '; ') into v_problemas from public.produto_canonico_problemas(v_prod) p;
  if v_problemas is not null then raise exception 'cadastro canônico com problemas: %', v_problemas; end if;

  insert into public.produto_canonico_ativacoes (acao, feito_por, detalhes)
    values ('backfill', 'script 10-backfill-conector.sql', jsonb_build_object('produto_canonico_id', v_prod, 'rota1', v_rota1, 'rota2', v_rota2, 'etapas', jsonb_build_object('m8', c_m8, 'rosquear', c_ros, 'parafusar', c_par, 'etiquetar', c_eti, 'embalar', c_emb)));
  raise notice 'backfill: produto canônico % criado (inativo)', v_prod;
end
$backfill$;

-- T2 (rotas M2): a etapa final do produto de rotas é a EXPLÍCITA (Embalar, ordem 4), nunca max(ordem): com uma "Etapa Técnica" de ordem 99 no roteiro o produto continua fechando em Embalar;
-- e produtos lineares seguem com a regra legada (maior ordem). Tudo desfeito no final.
do $$
declare
  F uuid; P uuid; v_emb uuid; v_conv uuid; v_tec uuid := '00000000-0000-4000-8000-0000000000b1'; v_maxordem uuid; v_j jsonb; v_op uuid;
begin
  select id into F from produtos where nome = 'Conector 3/4" (Final)';
  select id into P from produtos where nome = 'Conector 3/4"' and referencia = '56126022';
  select e.id into v_emb from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Embalar';
  select id into v_conv from produto_rota where produto_id = F and codigo = 'CONV';
  select id into v_op from operacoes where nome = 'Montar Presilha';
  if F is null or v_emb is null or v_conv is null or v_op is null then raise exception 'FALHOU (0) pré-requisitos'; end if;

  -- etapa técnica ordem 99, exclusiva da CONV (depois de Parafusar): é a de MAIOR ordem do roteiro
  insert into roteiro_etapas (id, produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3) values (v_tec, F, v_op, 99, 1, 1, 1, 1, 1, 1);
  insert into rota_etapas (rota_id, etapa_id, posicao) values (v_conv, v_tec, 3);
  select id into v_maxordem from roteiro_etapas where produto_id = F order by ordem desc limit 1;
  if v_maxordem <> v_tec then raise exception 'FALHOU (1) pré-condição: a etapa técnica deveria ser a de maior ordem'; end if;
  if (select ordem from roteiro_etapas where id = v_emb) <> 4 then raise exception 'FALHOU (1) Embalar deveria ter ordem 4'; end if;

  -- (2) a etapa final continua sendo Embalar: helper e estrutura
  if public.produto_etapa_final(F) <> v_emb then raise exception 'FALHOU (2) produto_etapa_final(F) deveria ser Embalar, não a etapa de maior ordem'; end if;
  v_j := public.produto_estrutura_rotas(F);
  if (v_j ->> 'regraEtapaFinal') <> 'explicita' or (v_j ->> 'etapaFinalId')::uuid <> v_emb then raise exception 'FALHOU (2) estrutura de F: %', v_j ->> 'regraEtapaFinal'; end if;
  -- a etapa técnica não está no pool comum nem é final; aparece só como exclusiva da CONV
  if exists (select 1 from produto_pool_comum where etapa_id = v_tec) then raise exception 'FALHOU (3) a etapa técnica não pode estar no pool comum'; end if;
  perform public.produto_rotas_validar(F);   -- estrutura continua válida (toda etapa em exatamente um lugar; final = última do pool)

  -- (4) reordenar não muda a final: Embalar com ordem menor que Etiquetar continua sendo a final
  update roteiro_etapas set ordem = 50 where id = (select e.id from roteiro_etapas e join operacoes o on o.id = e.operacao_id where e.produto_id = F and o.nome = 'Etiquetar');
  update roteiro_etapas set ordem = 20 where id = v_emb;
  if public.produto_etapa_final(F) <> v_emb then raise exception 'FALHOU (4) final mudou com a reordenação'; end if;

  -- (5) produto LINEAR: regra legada (maior ordem) intacta
  if (public.produto_estrutura_rotas(P) ->> 'regraEtapaFinal') <> 'max_ordem_legado' or public.produto_etapa_final(P) <> (select id from roteiro_etapas where produto_id = P order by ordem desc limit 1) then raise exception 'FALHOU (5) produto linear mudou de regra'; end if;

  -- (6) lock: nada operacional foi aberto
  if (select suporte_ativo from rotas_config) is not false or (select ativo from produtos where id = F) is not false then raise exception 'FALHOU (6) lock/ativo de F'; end if;

  raise exception 'TESTE_OK rotas T2: etapa final explícita (Embalar) com Etapa Técnica ordem 99 e com reordenação; linear mantém max(ordem); lock fechado';
end $$;

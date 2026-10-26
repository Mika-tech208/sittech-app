-- Sittech — PRODUTO ÚNICO COM MÚLTIPLAS ROTAS — M1: CADASTRO do produto final "Conector 3/4" (Final)" (somente DEV nesta rodada; só INSERTs).
--
-- • Produto NOVO (id novo) com etapas NOVAS (ids novos): nenhuma linha dos cadastros legados é alterada e nenhum etapa_id legado é referenciado pelo produto novo.
-- • Metas e máquinas são COPIADAS POR VALOR dos cadastros legados NO MOMENTO da aplicação (nada de número fixo no código); se os dois cadastros legados divergirem nas etapas comuns, PARA.
-- • Preço único R$ 0,1825 (decisão do desenvolvimento; confirmar no contrato antes de qualquer ativação em PROD). Os preços legados NÃO são alterados.
-- • Rotas: CONV (Rosquear → Parafusar) e AUTO (Rosquear + Parafusar) convergem no POOL COMUM (Etiquetar → Embalar, final). `ordem` 0..4 é só rótulo de cadastro: a sequência vem das tabelas de rotas.
-- • Idempotente: se o produto já existir, não faz nada. Sem os cadastros legados (ambiente novo), não faz nada.
-- • NÃO usa o produto na Previsão, não ativa semana, não toca Escala/WIP/Produção Real.
do $$
declare
  c_nome constant text := 'Conector 3/4" (Final)';
  c_ref constant text := '56126022';
  c_valor constant numeric := 0.1825;
  v_p uuid; v_a uuid; v_f uuid;
  v_conv uuid; v_auto uuid;
  e_p_rosq roteiro_etapas; e_p_para roteiro_etapas; e_p_etiq roteiro_etapas; e_p_emb roteiro_etapas;
  e_a_rp roteiro_etapas; e_a_etiq roteiro_etapas; e_a_emb roteiro_etapas;
  n_rosq uuid := gen_random_uuid(); n_para uuid := gen_random_uuid(); n_rp uuid := gen_random_uuid(); n_etiq uuid := gen_random_uuid(); n_emb uuid := gen_random_uuid();
  v_prio text;
begin
  if exists (select 1 from produtos where nome = c_nome) then raise notice 'M1: produto "%" já existe — nada a fazer', c_nome; return; end if;
  select id, prioridade into v_p, v_prio from produtos where nome = 'Conector 3/4"' and referencia = c_ref;
  select id into v_a from produtos where btrim(nome) = 'Conector 3/4" - Maquina Automatica';
  if v_p is null or v_a is null then raise notice 'M1: cadastros legados do Conector 3/4" não encontrados — nada a fazer neste ambiente'; return; end if;

  select * into e_p_rosq from roteiro_etapas where produto_id = v_p and operacao_id = (select id from operacoes where nome = 'Rosquear');
  select * into e_p_para from roteiro_etapas where produto_id = v_p and operacao_id = (select id from operacoes where nome = 'Parafusar');
  select * into e_p_etiq from roteiro_etapas where produto_id = v_p and operacao_id = (select id from operacoes where nome = 'Etiquetar');
  select * into e_p_emb  from roteiro_etapas where produto_id = v_p and operacao_id = (select id from operacoes where nome = 'Embalar');
  select * into e_a_rp   from roteiro_etapas where produto_id = v_a and operacao_id = (select id from operacoes where nome = 'Rosquear + Parafusar');
  select * into e_a_etiq from roteiro_etapas where produto_id = v_a and operacao_id = (select id from operacoes where nome = 'Etiquetar');
  select * into e_a_emb  from roteiro_etapas where produto_id = v_a and operacao_id = (select id from operacoes where nome = 'Embalar');
  if e_p_rosq.id is null or e_p_para.id is null or e_p_etiq.id is null or e_p_emb.id is null or e_a_rp.id is null or e_a_etiq.id is null or e_a_emb.id is null then
    raise exception 'M1_PARADA: os roteiros legados não têm as etapas esperadas (Rosquear, Parafusar, Etiquetar, Embalar / Rosquear + Parafusar, Etiquetar, Embalar)';
  end if;
  -- etapas COMUNS: o cadastro legado da automática precisa ser idêntico ao convencional (metas e máquinas); senão PARAR (não escolher em silêncio)
  if (e_p_etiq.meta_m1, e_p_etiq.meta_m2, e_p_etiq.meta_m3, e_p_etiq.meta_t1, e_p_etiq.meta_t2, e_p_etiq.meta_t3) is distinct from (e_a_etiq.meta_m1, e_a_etiq.meta_m2, e_a_etiq.meta_m3, e_a_etiq.meta_t1, e_a_etiq.meta_t2, e_a_etiq.meta_t3)
     or (e_p_emb.meta_m1, e_p_emb.meta_m2, e_p_emb.meta_m3, e_p_emb.meta_t1, e_p_emb.meta_t2, e_p_emb.meta_t3) is distinct from (e_a_emb.meta_m1, e_a_emb.meta_m2, e_a_emb.meta_m3, e_a_emb.meta_t1, e_a_emb.meta_t2, e_a_emb.meta_t3)
     or (select array_agg(maquina_id order by maquina_id) from roteiro_etapa_maquinas where etapa_id = e_p_etiq.id) is distinct from (select array_agg(maquina_id order by maquina_id) from roteiro_etapa_maquinas where etapa_id = e_a_etiq.id)
     or (select array_agg(maquina_id order by maquina_id) from roteiro_etapa_maquinas where etapa_id = e_p_emb.id) is distinct from (select array_agg(maquina_id order by maquina_id) from roteiro_etapa_maquinas where etapa_id = e_a_emb.id) then
    raise exception 'M1_PARADA: Etiquetar/Embalar divergem entre os cadastros legados (metas ou máquinas) — decidir antes de unificar as etapas comuns';
  end if;

  insert into produtos (nome, referencia, valor_unitario, ativo, prioridade) values (c_nome, c_ref, c_valor, true, v_prio) returning id into v_f;

  insert into roteiro_etapas (id, produto_id, operacao_id, ordem, meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3) values
    (n_rosq, v_f, e_p_rosq.operacao_id, 0, e_p_rosq.meta_m1, e_p_rosq.meta_m2, e_p_rosq.meta_m3, e_p_rosq.meta_t1, e_p_rosq.meta_t2, e_p_rosq.meta_t3),
    (n_para, v_f, e_p_para.operacao_id, 1, e_p_para.meta_m1, e_p_para.meta_m2, e_p_para.meta_m3, e_p_para.meta_t1, e_p_para.meta_t2, e_p_para.meta_t3),
    (n_rp,   v_f, e_a_rp.operacao_id,   2, e_a_rp.meta_m1,   e_a_rp.meta_m2,   e_a_rp.meta_m3,   e_a_rp.meta_t1,   e_a_rp.meta_t2,   e_a_rp.meta_t3),
    (n_etiq, v_f, e_p_etiq.operacao_id, 3, e_p_etiq.meta_m1, e_p_etiq.meta_m2, e_p_etiq.meta_m3, e_p_etiq.meta_t1, e_p_etiq.meta_t2, e_p_etiq.meta_t3),
    (n_emb,  v_f, e_p_emb.operacao_id,  4, e_p_emb.meta_m1,  e_p_emb.meta_m2,  e_p_emb.meta_m3,  e_p_emb.meta_t1,  e_p_emb.meta_t2,  e_p_emb.meta_t3);
  insert into roteiro_etapa_maquinas (etapa_id, maquina_id)
    select n_rosq, maquina_id from roteiro_etapa_maquinas where etapa_id = e_p_rosq.id
    union all select n_para, maquina_id from roteiro_etapa_maquinas where etapa_id = e_p_para.id
    union all select n_rp, maquina_id from roteiro_etapa_maquinas where etapa_id = e_a_rp.id
    union all select n_etiq, maquina_id from roteiro_etapa_maquinas where etapa_id = e_p_etiq.id
    union all select n_emb, maquina_id from roteiro_etapa_maquinas where etapa_id = e_p_emb.id;

  insert into produto_rota (produto_id, codigo, nome, preferencia) values (v_f, 'AUTO', 'Automática', 1) returning id into v_auto;
  insert into produto_rota (produto_id, codigo, nome, preferencia) values (v_f, 'CONV', 'Convencional', 2) returning id into v_conv;
  insert into rota_etapas (rota_id, etapa_id, posicao) values (v_conv, n_rosq, 0), (v_conv, n_para, 1), (v_auto, n_rp, 0);
  insert into produto_pool_comum (produto_id, etapa_id, posicao, final) values (v_f, n_etiq, 0, false), (v_f, n_emb, 1, true);
  insert into produto_variante_legada (produto_legado_id, produto_final_id, rota_id) values (v_p, v_f, v_conv), (v_a, v_f, v_auto);
  raise notice 'M1: produto % criado (%)', c_nome, v_f;
end $$;

-- ROLLBACK (somente DEV, enquanto F não tiver uso): delete das linhas de produto_variante_legada, produto_pool_comum, rota_etapas, produto_rota, roteiro_etapa_maquinas/roteiro_etapas do produto novo e do próprio produto.

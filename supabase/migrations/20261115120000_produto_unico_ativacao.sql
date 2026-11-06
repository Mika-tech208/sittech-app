-- Sittech — PRODUTO ÚNICO "Conector 3/4" (CONECTOR_3_4_UNICO): ATIVAÇÃO / DESATIVAÇÃO do cutover numa função única + buffers físicos + diagnóstico.
-- Depende de 20261115100000 (estrutura) e 20261115110000 (conversão/guardas). INERTE até alguém CHAMAR produto_unico_ativar (service_role; sem gatilho, sem agendador).
--
-- UMA única chave controla tudo: escala_parametros.produto_unico_cutover ('YYYY-MM-DD', segunda-feira). null = comportamento atual byte-idêntico.
--   produto_unico_ativar(cutover)  : (1) liga o produto único (ativo=true); (2) cria os pares de buffer do produto único com vigente_de = cutover e ENCERRA os pares dos legados na véspera (vigente_ate = cutover-1);
--                                    (3) completa escala_buffer_maquinas; (4) grava o parâmetro SEM disparar recálculo; (5) trilha em produto_canonico_ativacoes. Uma transação.
--   produto_unico_desativar()      : REFUSA se algo novo ainda depende do produto único na Previsão; NUNCA apaga apontamento/plano/fechamento. Sem uso do produto único: desfaz exatamente a ativação.
--                                    Com fechamento já feito sob o produto único: encerra os pares novos no último fechamento e reabre os legados no dia seguinte (novas linhas); nada é apagado.
--   produto_unico_estado(semana)   : leitura (cutover, produto, buffers obrigatórios da semana, pares vigentes) para scripts, testes e conferência.
-- Os 3 buffers físicos (escala_buffers_fisicos 'conector34:*') são OS MESMOS de hoje; Parafusar convencional e M8 alimentam o MESMO buffer 'parafusadas'. Catálogo do produto único, sem par 'zero':
--   p_par_m8 = false (PADRÃO): 3 pares, 1 por buffer (a saída da M8 entra no buffer comum sem par próprio) — é o que a guarda verificarCatalogoUnico do fechamento (trilha A) exige;
--   p_par_m8 = true : 4 pares (buffer 'parafusadas' com 2 'contabil': Parafusar→Etiquetar e M8→Etiquetar). escala_buffer_maquinas inclui a M8 como 'produz' nos dois casos.
-- escala_contagens_fechamento_para_motor (view) passa a entregar o saldo físico a UM só par 'contabil' por buffer (o de maior ordem de roteiro = Parafusar→Etiquetar); os demais 'contabil' recebem 0.
--   Com o catálogo atual (no máximo 1 par 'contabil' por buffer) a saída da view é idêntica à de antes.
-- Reversão: supabase/rollbacks/20261115120000_rollback_produto_unico_ativacao.sql

-- =========================================================================
-- 1) View das contagens do motor: um único par 'contabil' leva o saldo do buffer (sem duplicar o estoque comum)
-- =========================================================================
create or replace view public.escala_contagens_fechamento_para_motor as
  select distinct on (bp.produto_id, bp.etapa_origem_id, bp.etapa_seguinte_id)
    bp.produto_id as "produtoId", bp.etapa_origem_id as "etapaOrigemId", bp.etapa_seguinte_id as "etapaSeguinteId",
    case when bp.papel = 'contabil' and bp.carrega then fb.saldo_fisico else 0 end as saldo,
    f.instante_motor as "contadoEm", f.fechado_por as "informadoPor", f.id as fechamento_id, f.data, f.periodo_id, f.revisao, f.fechado_em
  from public.escala_fechamentos_vigentes f
  join public.escala_fechamento_buffers fb on fb.fechamento_id = f.id and fb.saldo_fisico is not null
  join (
    select p.*, (p.papel = 'contabil' and row_number() over (
              partition by p.buffer_id, p.vigente_de, (p.papel = 'contabil')
              order by coalesce((select e.ordem from public.roteiro_etapas e where e.id = p.etapa_origem_id), 0) desc, p.etapa_origem_id) = 1) as carrega
      from public.escala_buffer_pares p
  ) bp on bp.buffer_id = fb.buffer_id
       and f.data >= bp.vigente_de and (bp.vigente_ate is null or f.data <= bp.vigente_ate)
  order by bp.produto_id, bp.etapa_origem_id, bp.etapa_seguinte_id, f.instante_motor desc, f.fechado_em desc;

-- =========================================================================
-- 2) Diagnóstico (somente leitura)
-- =========================================================================
create or replace function public.produto_unico_estado(p_semana date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod uuid; v_cut date; v_data date;
  v_obrig jsonb; v_pares jsonb; v_prob jsonb;
begin
  select produto_id into v_prod from public.produto_canonico where codigo = 'CONECTOR_3_4_UNICO';
  v_cut := public.produto_unico_cutover();
  v_data := coalesce(p_semana, v_cut, current_date);
  if v_prod is not null then
    select coalesce(jsonb_agg(p), '[]'::jsonb) into v_prob from public.produto_canonico_problemas(v_prod) p;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('chave', x.chave, 'pares', x.pares) order by x.ordem), '[]'::jsonb) into v_obrig
    from (select b.chave, b.ordem, jsonb_agg(jsonb_build_object('produto', pr.nome, 'origem', oo.nome, 'seguinte', os.nome, 'papel', bp.papel) order by bp.papel, oo.nome) as pares
            from public.escala_buffers_fisicos b
            join public.escala_buffer_pares bp on bp.buffer_id = b.id and bp.vigente_de <= v_data and (bp.vigente_ate is null or bp.vigente_ate >= v_data)
            join public.produtos pr on pr.id = bp.produto_id
            join public.roteiro_etapas eo on eo.id = bp.etapa_origem_id join public.operacoes oo on oo.id = eo.operacao_id
            join public.roteiro_etapas es on es.id = bp.etapa_seguinte_id join public.operacoes os on os.id = es.operacao_id
           where b.ativo and b.chave like 'conector34:%' group by b.chave, b.ordem) x;
  return jsonb_build_object('cutover', v_cut, 'planejamento_desde', public.produto_unico_planejamento_desde(), 'modo_semana', public.produto_unico_modo(v_data),
                            'semanas_ativas', (select valor from public.escala_parametros where chave = 'producao_real_semanas_ativas'),
                            'planejador_semanas', (select valor from public.escala_parametros where chave = 'producao_real_planejador_semanas'),
                            'produto_id', v_prod, 'produto_ativo', (select ativo from public.produtos where id = v_prod),
                            'problemas_cadastro', coalesce(v_prob, '[]'::jsonb), 'data_referencia', v_data, 'buffers_conector34', v_obrig,
                            'buffers_conector34_n', jsonb_array_length(v_obrig));
end;
$$;

-- =========================================================================
-- 2b) PLANEJAMENTO (separado do cutover operacional): habilitar / desabilitar
--     produto_unico_incluir_semana_nas_listas(semana): inclui a semana em producao_real_semanas_ativas E producao_real_planejador_semanas (idempotente). NÃO desliga gatilhos
--       sozinha: quem chama (habilitar/ativar) já está dentro do bloco com trg_escala_parametros_evento/trg_escala_plano_versao desligados => NENHUM recálculo e NENHUMA versão de plano.
--     produto_unico_habilitar_planejamento(desde): produto único selecionável no Forecast + plano futuro NÃO LIBERADO; nada operacional muda (buffers, pares, WIP, apontamento, fechamento, TV).
-- =========================================================================
create or replace function public.produto_unico_incluir_semana_nas_listas(p_semana date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_add jsonb := '[]'::jsonb; v_chave text; v_val jsonb; v_s text := to_char(p_semana, 'YYYY-MM-DD');
begin
  foreach v_chave in array array['producao_real_semanas_ativas', 'producao_real_planejador_semanas'] loop
    select valor into v_val from public.escala_parametros where chave = v_chave;
    if not found then continue; end if;   -- lista inexistente: nada a incluir (o planejador/Produção Real não está configurado)
    if jsonb_typeof(v_val) <> 'array' then raise exception 'PLANEJAMENTO_LISTA_INVALIDA: % não é uma lista', v_chave; end if;
    if not (v_val @> to_jsonb(v_s)) then
      update public.escala_parametros set valor = v_val || to_jsonb(v_s), atualizado_em = now() where chave = v_chave;
      v_add := v_add || to_jsonb(v_chave);
    end if;
  end loop;
  return v_add;
end;
$$;

create or replace function public.produto_unico_habilitar_planejamento(p_desde date, p_feito_por text default 'script')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod uuid; v_atual date; v_prob text; v_n int; v_legado_ids uuid[]; v_ativo_antes boolean; v_listas jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('produto_unico_ativacao', 0));
  if p_desde is null or extract(isodow from p_desde) <> 1 or p_desde < date '2026-11-02' then
    raise exception 'PLANEJAMENTO_INVALIDO: informe uma segunda-feira >= 2026-11-02 (recebido: %)', p_desde;
  end if;
  select produto_id into v_prod from public.produto_canonico where codigo = 'CONECTOR_3_4_UNICO';
  if v_prod is null then raise exception 'PLANEJAMENTO_SEM_BACKFILL: rode supabase/ops/produto-unico/10-backfill-conector-unico.sql antes'; end if;
  select string_agg(p, '; ') into v_prob from public.produto_canonico_problemas(v_prod) p;
  if v_prob is not null then raise exception 'PLANEJAMENTO_CADASTRO_COM_PROBLEMAS: %', v_prob; end if;
  v_atual := public.produto_unico_planejamento_desde();
  if v_atual = p_desde then return jsonb_build_object('ja_habilitado', true, 'planejamento_desde', v_atual); end if;
  if v_atual is not null then raise exception 'PLANEJAMENTO_JA_HABILITADO_COM_OUTRA_DATA: atual %; desabilite antes', v_atual; end if;
  select array_agg(produto_legado_id) into v_legado_ids from public.produto_legado_mapa where produto_canonico_id = v_prod;
  select count(*) into v_n from public.apontamentos_producao where produto_id = any(v_legado_ids) and data >= p_desde;
  if v_n > 0 then raise exception 'PLANEJAMENTO_ABORTADO: já há % apontamento(s) dos produtos legados em/depois de % (a semana de planejamento não pode ter operação)', v_n, p_desde; end if;
  select count(*) into v_n from public.escala_fechamentos where data >= p_desde;
  if v_n > 0 then raise exception 'PLANEJAMENTO_ABORTADO: já há % fechamento(s) físico(s) em/depois de %', v_n, p_desde; end if;

  -- o produto fica ATIVO para a Previsão/Forecast; apontamento continua recusado antes do cutover (guarda APONTAMENTO_CANONICO_ANTES_DO_CUTOVER) e o fechamento/liberação ignoram semanas em planejamento
  select ativo into v_ativo_antes from public.produtos where id = v_prod;
  update public.produtos set ativo = true where id = v_prod and not ativo;

  -- nenhum recálculo, nenhuma versão de plano (o hash do plano vigente não pode mudar)
  alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
  alter table public.escala_parametros disable trigger trg_escala_plano_versao;
  update public.escala_parametros set valor = to_jsonb(to_char(p_desde, 'YYYY-MM-DD')), atualizado_em = now() where chave = 'produto_unico_planejamento_desde';
  v_listas := public.produto_unico_incluir_semana_nas_listas(p_desde);
  alter table public.escala_parametros enable trigger trg_escala_plano_versao;
  alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

  insert into public.produto_canonico_ativacoes (acao, cutover, feito_por, detalhes)
    values ('habilitar_planejamento', p_desde, p_feito_por, jsonb_build_object('produto_canonico_id', v_prod, 'produto_ativo_antes', v_ativo_antes, 'listas_adicionadas', v_listas));
  return jsonb_build_object('ja_habilitado', false, 'planejamento_desde', p_desde, 'listas_adicionadas', v_listas, 'produto_ativo_antes', v_ativo_antes);
end;
$$;

create or replace function public.produto_unico_desabilitar_planejamento(p_feito_por text default 'script')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod uuid; v_des date; v_sem text; v_ativ record; v_det jsonb; v_lista text; v_n_aloc bigint; v_apont bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('produto_unico_ativacao', 0));
  v_des := public.produto_unico_planejamento_desde();
  if v_des is null then return jsonb_build_object('ja_desabilitado', true); end if;
  if public.produto_unico_cutover() is not null then raise exception 'DESABILITAR_ABORTADO: o cutover (%) está ligado; rode antes produto_unico_desativar()', public.produto_unico_cutover(); end if;
  select produto_id into v_prod from public.produto_canonico where codigo = 'CONECTOR_3_4_UNICO';
  select string_agg(to_char(p.semana_inicio, 'YYYY-MM-DD'), ', ') into v_sem
    from public.previsoes p where exists (select 1 from public.previsao_itens i where i.previsao_id = p.id and i.produto_id = v_prod);
  if v_sem is not null then
    raise exception 'DESABILITAR_ABORTADO: a Previsão da(s) semana(s) % ainda tem o item do produto único. Use "Separar" (restaura os itens legados do backup) ou exclua o item e repita. Nada foi alterado.', v_sem;
  end if;
  select * into v_ativ from public.produto_canonico_ativacoes where acao = 'habilitar_planejamento' and cutover = v_des order by id desc limit 1;
  v_det := coalesce(v_ativ.detalhes, '{}'::jsonb);
  select count(*) into v_apont from public.apontamentos_producao where produto_id = v_prod;
  select count(*) into v_n_aloc from public.escala_producao_alocacoes a join public.produto_canonico_etapas ce on ce.etapa_id = a.etapa_id;

  alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
  alter table public.escala_parametros disable trigger trg_escala_plano_versao;
  update public.escala_parametros set valor = 'null'::jsonb, atualizado_em = now() where chave = 'produto_unico_planejamento_desde';
  -- só retira das listas o que o habilitar acrescentou (a semana pode ter sido incluída por outro motivo antes)
  for v_lista in select jsonb_array_elements_text(coalesce(v_det -> 'listas_adicionadas', '[]'::jsonb)) loop
    update public.escala_parametros set valor = coalesce((select jsonb_agg(e) from jsonb_array_elements(valor) e where e <> to_jsonb(to_char(v_des, 'YYYY-MM-DD'))), '[]'::jsonb), atualizado_em = now() where chave = v_lista;
  end loop;
  alter table public.escala_parametros enable trigger trg_escala_plano_versao;
  alter table public.escala_parametros enable trigger trg_escala_parametros_evento;
  if v_apont = 0 then update public.produtos set ativo = coalesce((v_det ->> 'produto_ativo_antes')::boolean, false) where id = v_prod; end if;

  insert into public.produto_canonico_ativacoes (acao, cutover, feito_por, detalhes)
    values ('desabilitar_planejamento', v_des, p_feito_por, jsonb_build_object('apontamentos_produto_unico', v_apont, 'alocacoes_canonicas_restantes', v_n_aloc));
  return jsonb_build_object('ja_desabilitado', false, 'planejamento_anterior', v_des, 'apontamentos_produto_unico', v_apont, 'alocacoes_canonicas_restantes', v_n_aloc);
end;
$$;

-- =========================================================================
-- 3) ATIVAR
-- =========================================================================
create or replace function public.produto_unico_ativar(p_cutover date, p_feito_por text default 'script', p_par_m8 boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod uuid; v_atual date; v_prob text; v_n int;
  v_ativo_antes boolean;
  v_legado_ids uuid[];
  v_pares_novos jsonb := '[]'::jsonb;
  v_arestas int := 0;
  v_bufs_aresta jsonb := '[]'::jsonb;
  v_pares_encerrados jsonb;
  v_maq_novas jsonb;
  v_listas jsonb;
  r record;
begin
  perform pg_advisory_xact_lock(hashtextextended('produto_unico_ativacao', 0));
  if p_cutover is null or extract(isodow from p_cutover) <> 1 or p_cutover < date '2026-11-02' then
    raise exception 'ATIVAR_CUTOVER_INVALIDO: informe uma segunda-feira >= 2026-11-02 (recebido: %)', p_cutover;
  end if;
  select produto_id into v_prod from public.produto_canonico where codigo = 'CONECTOR_3_4_UNICO';
  if v_prod is null then raise exception 'ATIVAR_SEM_BACKFILL: rode supabase/ops/produto-unico/10-backfill-conector-unico.sql antes'; end if;
  select string_agg(p, '; ') into v_prob from public.produto_canonico_problemas(v_prod) p;
  if v_prob is not null then raise exception 'ATIVAR_CADASTRO_COM_PROBLEMAS: %', v_prob; end if;

  v_atual := public.produto_unico_cutover();
  if v_atual = p_cutover then return jsonb_build_object('ja_ativo', true, 'cutover', v_atual); end if;
  if v_atual is not null then raise exception 'ATIVAR_JA_ATIVO_COM_OUTRO_CUTOVER: cutover atual %; desative antes (produto_unico_desativar)', v_atual; end if;

  select array_agg(produto_legado_id) into v_legado_ids from public.produto_legado_mapa where produto_canonico_id = v_prod;
  select count(*) into v_n from public.apontamentos_producao where produto_id = any(v_legado_ids) and data >= p_cutover;
  if v_n > 0 then raise exception 'ATIVAR_ABORTADO: já há % apontamento(s) dos produtos legados em/depois de % (o cutover tem que ser antes de qualquer trabalho da semana)', v_n, p_cutover; end if;
  select count(*) into v_n from public.escala_fechamentos where data >= p_cutover;
  if v_n > 0 then raise exception 'ATIVAR_ABORTADO: já há % fechamento(s) físico(s) em/depois de % (usaram os pares legados)', v_n, p_cutover; end if;
  -- PLANEJAMENTO precisa estar habilitado ANTES (produto_unico_habilitar_planejamento): o item único da Previsão e o plano futuro só existem em semanas de planejamento
  if public.produto_unico_planejamento_desde() is null or public.produto_unico_planejamento_desde() > p_cutover then
    raise exception 'ATIVAR_SEM_PLANEJAMENTO: habilite o planejamento (produto_unico_habilitar_planejamento) para a semana % antes do cutover (planejamento_desde atual: %)', p_cutover, public.produto_unico_planejamento_desde();
  end if;

  -- pares do produto único a partir do GRAFO canônico (operação origem -> operação destino -> buffer físico)
  for r in
    select a.origem_etapa_id, a.destino_etapa_id, oo.nome as op_o, od.nome as op_d,
           case when oo.nome = 'Rosquear'              and od.nome = 'Parafusar' then 'conector34:rosqueadas'
                when oo.nome = 'Parafusar'             and od.nome = 'Etiquetar' then 'conector34:parafusadas'
                when oo.nome = 'Rosquear + Parafusar'  and od.nome = 'Etiquetar' then 'conector34:parafusadas'
                when oo.nome = 'Etiquetar'             and od.nome = 'Embalar'   then 'conector34:etiquetadas' end as chave
      from public.produto_canonico_arestas a
      join public.produto_canonico_etapas ce on ce.etapa_id = a.origem_etapa_id and ce.produto_id = v_prod
      join public.roteiro_etapas eo on eo.id = a.origem_etapa_id join public.operacoes oo on oo.id = eo.operacao_id
      join public.roteiro_etapas ed on ed.id = a.destino_etapa_id join public.operacoes od on od.id = ed.operacao_id
  loop
    if r.chave is null then raise exception 'ATIVAR_ARESTA_SEM_BUFFER: % -> % não tem buffer físico definido', r.op_o, r.op_d; end if;
    if not exists (select 1 from public.escala_buffers_fisicos where chave = r.chave and ativo) then raise exception 'ATIVAR_BUFFER_INEXISTENTE: % (catálogo de buffers físicos)', r.chave; end if;
    v_arestas := v_arestas + 1;
    v_bufs_aresta := v_bufs_aresta || jsonb_build_object('buffer', r.chave, 'origem_etapa', r.origem_etapa_id, 'seguinte_etapa', r.destino_etapa_id);
    -- DEFAULT (p_par_m8 = false): a saída da M8 entra no buffer comum SEM par próprio -> 3 pares no total (1 por buffer), como exige a guarda verificarCatalogoUnico do fechamento (trilha A).
    -- p_par_m8 = true: 4 pares (buffer 'parafusadas' com 2 'contabil': Parafusar→Etiquetar e M8→Etiquetar); a view de contagens entrega o saldo a UM só deles.
    if r.op_o = 'Rosquear + Parafusar' and not p_par_m8 then continue; end if;
    insert into public.escala_buffer_pares (buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, papel, vigente_de)
      select b.id, v_prod, r.origem_etapa_id, r.destino_etapa_id, 'contabil', p_cutover from public.escala_buffers_fisicos b where b.chave = r.chave
      on conflict (buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, vigente_de) do nothing;
    v_pares_novos := v_pares_novos || jsonb_build_object('buffer', r.chave, 'origem', r.op_o, 'seguinte', r.op_d);
  end loop;
  if v_arestas <> 4 then raise exception 'ATIVAR_ARESTAS_INESPERADAS: esperadas 4 arestas (Rosquear→Parafusar, Parafusar→Etiquetar, M8→Etiquetar, Etiquetar→Embalar), achadas %', v_arestas; end if;
  if jsonb_array_length(v_pares_novos) <> (3 + (p_par_m8)::int) then raise exception 'ATIVAR_PARES_INESPERADOS: gerados %', jsonb_array_length(v_pares_novos); end if;

  -- legados: encerrados na véspera (guarda o vigente_ate anterior para a reversão exata)
  select coalesce(jsonb_agg(jsonb_build_object('id', bp.id, 'vigente_ate_antes', bp.vigente_ate)), '[]'::jsonb) into v_pares_encerrados
    from public.escala_buffer_pares bp where bp.produto_id = any(v_legado_ids) and (bp.vigente_ate is null or bp.vigente_ate >= p_cutover);
  update public.escala_buffer_pares set vigente_ate = p_cutover - 1
   where produto_id = any(v_legado_ids) and (vigente_ate is null or vigente_ate >= p_cutover);

  -- máquinas que produzem/consomem cada buffer (erro por máquina): completa com as do produto único (mesmas dos legados; ON CONFLICT não duplica)
  with arestas as (
    select (e ->> 'buffer') as chave, (e ->> 'origem_etapa')::uuid as o, (e ->> 'seguinte_etapa')::uuid as d from jsonb_array_elements(v_bufs_aresta) e),
  novas as (
    insert into public.escala_buffer_maquinas (buffer_id, maquina_id, papel)
      select b.id, m.maquina_id, 'produz' from arestas a join public.escala_buffers_fisicos b on b.chave = a.chave join public.roteiro_etapa_maquinas m on m.etapa_id = a.o
      union
      select b.id, m.maquina_id, 'consome' from arestas a join public.escala_buffers_fisicos b on b.chave = a.chave join public.roteiro_etapa_maquinas m on m.etapa_id = a.d
      on conflict do nothing returning buffer_id, maquina_id, papel)
  select coalesce(jsonb_agg(to_jsonb(novas)), '[]'::jsonb) into v_maq_novas from novas;

  select ativo into v_ativo_antes from public.produtos where id = v_prod;
  update public.produtos set ativo = true where id = v_prod and not ativo;

  -- o parâmetro NÃO pode disparar recálculo (os gatilhos de evento/versão ficam desligados só dentro desta transação)
  alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
  alter table public.escala_parametros disable trigger trg_escala_plano_versao;
  update public.escala_parametros set valor = to_jsonb(to_char(p_cutover, 'YYYY-MM-DD')), atualizado_em = now() where chave = 'produto_unico_cutover';
  -- a semana do cutover tem que estar nas duas listas da Produção Real/planejador (normalmente já pelo habilitar_planejamento; aqui só garante, idempotente e sem recálculo)
  v_listas := public.produto_unico_incluir_semana_nas_listas(p_cutover);
  alter table public.escala_parametros enable trigger trg_escala_plano_versao;
  alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

  insert into public.produto_canonico_ativacoes (acao, cutover, feito_por, detalhes)
    values ('ativar', p_cutover, p_feito_por, jsonb_build_object('listas_adicionadas', v_listas, 'produto_canonico_id', v_prod, 'produto_ativo_antes', v_ativo_antes, 'pares_novos', v_pares_novos,
                                                                 'pares_legado_encerrados', v_pares_encerrados, 'maquinas_buffer_novas', v_maq_novas, 'par_m8', p_par_m8));
  return jsonb_build_object('ja_ativo', false, 'cutover', p_cutover, 'produto_canonico_id', v_prod, 'pares_novos', jsonb_array_length(v_pares_novos),
                            'pares_legado_encerrados', jsonb_array_length(v_pares_encerrados), 'estado', public.produto_unico_estado(p_cutover));
end;
$$;

-- =========================================================================
-- 4) DESATIVAR (rollback do cutover). Nunca apaga fato novo.
-- =========================================================================
create or replace function public.produto_unico_desativar(p_feito_por text default 'script')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod uuid; v_cut date; v_n int; v_sem text;
  v_ult_fech date; v_apont int;
  v_ativ record; v_det jsonb; v_modo text;
  v_d date;
  x record;
begin
  perform pg_advisory_xact_lock(hashtextextended('produto_unico_ativacao', 0));
  v_cut := public.produto_unico_cutover();
  if v_cut is null then return jsonb_build_object('ja_inativo', true); end if;
  select produto_id into v_prod from public.produto_canonico where codigo = 'CONECTOR_3_4_UNICO';

  -- RECUSA: a Previsão ainda carrega o item do produto único (apagá-lo é decisão do usuário; este rollback não apaga dado novo)
  select string_agg(to_char(p.semana_inicio, 'YYYY-MM-DD'), ', ') into v_sem
    from public.previsoes p where exists (select 1 from public.previsao_itens i where i.previsao_id = p.id and i.produto_id = v_prod);
  if v_sem is not null then
    raise exception 'DESATIVAR_ABORTADO: a Previsão da(s) semana(s) % ainda tem o item do produto único. Exclua o item (ou use "Separar" se nada foi planejado) e repita. Nada foi alterado.', v_sem;
  end if;

  select max(data) into v_ult_fech from public.escala_fechamentos where data >= v_cut;
  select count(*) into v_apont from public.apontamentos_producao where produto_id = v_prod;

  select * into v_ativ from public.produto_canonico_ativacoes where acao = 'ativar' and cutover = v_cut order by id desc limit 1;
  v_det := coalesce(v_ativ.detalhes, '{}'::jsonb);

  alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
  alter table public.escala_parametros disable trigger trg_escala_plano_versao;
  update public.escala_parametros set valor = 'null'::jsonb, atualizado_em = now() where chave = 'produto_unico_cutover';
  alter table public.escala_parametros enable trigger trg_escala_plano_versao;
  alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

  if v_ult_fech is null and v_apont = 0 then
    -- SEM uso: desfaz exatamente a ativação (nenhum fato novo depende dos pares nem do produto)
    v_modo := 'limpo';
    update public.escala_buffer_pares bp set vigente_ate = (e ->> 'vigente_ate_antes')::date
      from jsonb_array_elements(coalesce(v_det -> 'pares_legado_encerrados', '[]'::jsonb)) e where bp.id = (e ->> 'id')::uuid;
    alter table public.escala_buffer_pares disable trigger trg_escala_buffer_pares_catalogo;
    delete from public.escala_buffer_pares where produto_id = v_prod;
    alter table public.escala_buffer_pares enable trigger trg_escala_buffer_pares_catalogo;
    delete from public.escala_buffer_maquinas bm using jsonb_array_elements(coalesce(v_det -> 'maquinas_buffer_novas', '[]'::jsonb)) e
      where bm.buffer_id = (e ->> 'buffer_id')::uuid and bm.maquina_id = (e ->> 'maquina_id')::uuid and bm.papel = e ->> 'papel';
    update public.produtos set ativo = coalesce((v_det ->> 'produto_ativo_antes')::boolean, false) where id = v_prod;
  else
    -- COM uso: nada é apagado. Pares novos valem até o último fechamento; os legados reabrem no dia seguinte (novas linhas, mesmos buffers)
    v_modo := 'preservando_dados';
    v_d := coalesce(v_ult_fech, v_cut) + 1;
    update public.escala_buffer_pares set vigente_ate = greatest(vigente_de, coalesce(v_ult_fech, vigente_de))
     where produto_id = v_prod and (vigente_ate is null or vigente_ate >= v_d);
    for x in
      select bp.* from public.escala_buffer_pares bp join jsonb_array_elements(coalesce(v_det -> 'pares_legado_encerrados', '[]'::jsonb)) e on (e ->> 'id')::uuid = bp.id
    loop
      insert into public.escala_buffer_pares (buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, papel, vigente_de, vigente_ate)
        values (x.buffer_id, x.produto_id, x.etapa_origem_id, x.etapa_seguinte_id, x.papel, greatest(v_d, x.vigente_de + 1), null)
        on conflict (buffer_id, produto_id, etapa_origem_id, etapa_seguinte_id, vigente_de) do nothing;
    end loop;
    -- produto único permanece ATIVO (apontamentos existentes seguem editáveis/regularizáveis por API); os pickers escondem sem cutover e a guarda recusa novos lançamentos
  end if;

  insert into public.produto_canonico_ativacoes (acao, cutover, feito_por, detalhes)
    values ('desativar', v_cut, p_feito_por, jsonb_build_object('modo', v_modo, 'ultimo_fechamento', v_ult_fech, 'apontamentos_produto_unico', v_apont, 'reabre_legados_em', case when v_modo = 'preservando_dados' then v_d end));
  return jsonb_build_object('ja_inativo', false, 'cutover_anterior', v_cut, 'modo', v_modo, 'ultimo_fechamento', v_ult_fech, 'apontamentos_produto_unico', v_apont,
                            'legados_reabrem_em', case when v_modo = 'preservando_dados' then v_d else null end);
end;
$$;

revoke all on function public.produto_unico_ativar(date, text, boolean) from public, anon, authenticated;
revoke all on function public.produto_unico_desativar(text) from public, anon, authenticated;
revoke all on function public.produto_unico_incluir_semana_nas_listas(date) from public, anon, authenticated;
revoke all on function public.produto_unico_habilitar_planejamento(date, text) from public, anon, authenticated;
revoke all on function public.produto_unico_desabilitar_planejamento(text) from public, anon, authenticated;
grant execute on function public.produto_unico_habilitar_planejamento(date, text) to service_role;
grant execute on function public.produto_unico_desabilitar_planejamento(text) to service_role;
revoke all on function public.produto_unico_estado(date) from public, anon;
grant execute on function public.produto_unico_ativar(date, text, boolean) to service_role;
grant execute on function public.produto_unico_desativar(text) to service_role;
grant execute on function public.produto_unico_estado(date) to authenticated, service_role;
notify pgrst, 'reload schema';

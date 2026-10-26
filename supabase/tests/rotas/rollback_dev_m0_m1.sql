-- PROCEDIMENTO DE RECRIAÇÃO (SOMENTE DEV, enquanto M0/M1 NÃO foram para PROD): desfaz M1 e M0 numa transação, depois se reaplicam os arquivos de migration corrigidos.
-- Segurança: aborta se o produto F já tiver qualquer uso (Previsão, apontamento, WIP, relatório) ou se algum produto legado tiver sido tocado.
begin;
do $$
declare F uuid;
begin
  select id into F from public.produtos where nome = 'Conector 3/4" (Final)';
  if F is not null then
    if exists (select 1 from public.previsao_itens where produto_id = F) or exists (select 1 from public.apontamentos_producao where produto_id = F) or exists (select 1 from public.wip_controle where produto_id = F)
       or exists (select 1 from public.escala_producao_alocacoes where produto_id = F) then
      raise exception 'RECRIACAO_ABORTADA: o produto F já tem uso — não recriar';
    end if;
  end if;
end $$;
-- gatilhos em tabelas ANTIGAS (criados pelo M0)
drop trigger if exists trg_previsao_itens_modelo_rotas on public.previsao_itens;
drop trigger if exists trg_previsoes_modelo_rotas on public.previsoes;
drop trigger if exists trg_previsoes_modelo_rotas_ins on public.previsoes;
drop trigger if exists trg_roteiro_etapas_validar_rotas on public.roteiro_etapas;
drop trigger if exists trg_produto_de_rotas_guard on public.apontamentos_producao;
drop trigger if exists trg_produto_de_rotas_guard on public.wip_controle;
drop trigger if exists trg_produto_rota_validar on public.produto_rota;
drop trigger if exists trg_rota_etapas_validar on public.rota_etapas;
drop trigger if exists trg_pool_comum_validar on public.produto_pool_comum;
-- dados do M1
do $$
declare F uuid;
begin
  select id into F from public.produtos where nome = 'Conector 3/4" (Final)';
  if F is not null then
    delete from public.produto_variante_legada where produto_final_id = F;
    delete from public.produto_pool_comum where produto_id = F;
    delete from public.rota_etapas where rota_id in (select id from public.produto_rota where produto_id = F);
    delete from public.produto_rota where produto_id = F;
    delete from public.roteiro_etapa_maquinas where etapa_id in (select id from public.roteiro_etapas where produto_id = F);
    delete from public.roteiro_etapas where produto_id = F;
    delete from public.produtos where id = F;
  end if;
end $$;
-- estruturas do M0
drop table if exists public.escala_rota_divisao, public.previsao_rota_limite, public.produto_variante_legada, public.produto_pool_comum, public.rota_etapas, public.produto_rota, public.rotas_config cascade;
drop function if exists public.produto_etapa_final(uuid), public.produto_estrutura_rotas(uuid), public.produto_rotas_validar(uuid), public.produto_rotas_trg_validar(), public.rota_etapas_trg_mesmo_produto(),
  public.produto_variante_legada_trg(), public.previsao_itens_trg_modelo_rotas(), public.previsoes_trg_modelo_rotas(), public.produto_de_rotas_guard(), public.rotas_suporte_ativo();
alter table public.previsoes drop column if exists modelo_rotas;
commit;

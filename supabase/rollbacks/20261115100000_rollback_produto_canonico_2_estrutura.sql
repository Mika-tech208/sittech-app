-- ROLLBACK F0 (estrutura) — remove tudo que a migration 20261107100000_produto_canonico_estrutura criou. NÃO é migration; executar à mão (orquestrador), DEPOIS do rollback 1 (backfill).
-- Recusa se: houver produto canônico (rode antes 20261107100000_rollback_produto_canonico_1_backfill.sql) ou produto_unico_cutover estiver ativo.
-- Não toca em nenhuma tabela/função existente (a migration não alterou nenhuma): ao fim, o banco é o de antes — salvo o histórico append-only produto_canonico_ativacoes, que é DESCARTADO junto
-- (guarde `select * from produto_canonico_ativacoes` se quiser a trilha).
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
do $rb$
begin
  if exists (select 1 from public.produto_canonico) then
    raise exception 'ROLLBACK_ESTRUTURA_ABORTADO: ainda há produto canônico — execute antes o rollback 1 (backfill)';
  end if;
  if public.produto_unico_cutover() is not null or public.produto_unico_planejamento_desde() is not null then
    raise exception 'ROLLBACK_ESTRUTURA_ABORTADO: cutover/planejamento do produto único ativo — reverta (produto_unico_desativar / produto_unico_desabilitar_planejamento) antes';
  end if;
end
$rb$;

drop view if exists public.vw_alocacoes_canonicas;
drop view if exists public.vw_apontamentos_canonicos;
drop function if exists public.produto_canonico_problemas(uuid);
drop function if exists public.rota_da_maquina(uuid, uuid);
drop function if exists public.etapa_canonica_de(uuid);
drop function if exists public.produto_canonico_de(uuid);

alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
alter table public.escala_parametros disable trigger trg_escala_plano_versao;
delete from public.escala_parametros where chave in ('produto_unico_cutover', 'produto_unico_planejamento_desde');
alter table public.escala_parametros enable trigger trg_escala_plano_versao;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;
alter table public.escala_parametros drop constraint if exists escala_parametros_produto_unico_cutover;
alter table public.escala_parametros drop constraint if exists escala_parametros_produto_unico_planejamento;
drop function if exists public.produto_unico_modo(date);
drop function if exists public.produto_unico_planejando(date);
drop function if exists public.produto_unico_planejamento_desde();
drop function if exists public.produto_unico_ativo(date);
drop function if exists public.produto_unico_cutover();
drop function if exists public.produto_unico_cutover_valido(jsonb);

drop table if exists public.produto_canonico_ativacoes;
drop table if exists public.etapa_legado_mapa;
drop table if exists public.produto_legado_mapa;
drop table if exists public.produto_canonico_arestas;
drop table if exists public.produto_canonico_etapas;
drop table if exists public.produto_rotas;
drop table if exists public.produto_canonico;
drop function if exists public.produto_canonico_trg_etapa_legado();
drop function if exists public.produto_canonico_trg_aresta();
drop function if exists public.produto_canonico_trg_etapa();
drop function if exists public.produto_canonico_trg_imutavel();
notify pgrst, 'reload schema';
commit;

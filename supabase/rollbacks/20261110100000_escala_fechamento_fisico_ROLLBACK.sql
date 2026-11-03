-- ROLLBACK do fechamento físico. Ordem:
--  0) escala_parametros: escala_fechamento_fisico_modo = '"desligado"' (o motor volta a ler só as contagens legadas; o trigger de apontamento fica inerte)
--  1) EXPORTAR as contagens vigentes para o legado (sem isto o motor "esquece" o físico depois do rollback). Rodar ANTES do bloco abaixo:
--       update public.escala_parametros set valor = valor || (
--         select coalesce(jsonb_agg(jsonb_build_object('produtoId',"produtoId",'etapaOrigemId',"etapaOrigemId",'etapaSeguinteId',"etapaSeguinteId",'saldo',saldo,
--                'contadoEm',to_char("contadoEm" at time zone 'America/Sao_Paulo','YYYY-MM-DD"T"HH24:MI:SS')||'-03:00','informadoPor','fechamento-fisico','observacao','exportado do fechamento '||fechamento_id)), '[]'::jsonb)
--         from public.escala_contagens_fechamento_para_motor) where chave='producao_real_contagens_fisicas';
--  2) recálculo oficial (o plano passa a ser função do legado) e SÓ ENTÃO este script. O plano publicado NÃO é tocado: para voltar o plano, restaurar as linhas de
--     escala_plano_versoes da versão anterior (procedimento de sempre; ver docs/escala-fechamento-fisico-implantacao.md).
begin;
drop trigger if exists trg_apontamentos_producao_fechamento on public.apontamentos_producao;
drop function if exists public.escala_trg_apontamento_fechamento();
create table if not exists public.escala_fechamentos_arquivo as select * from public.escala_fechamentos;
create table if not exists public.escala_fechamento_buffers_arquivo as select * from public.escala_fechamento_buffers;
create table if not exists public.escala_fechamento_log_arquivo as select * from public.escala_fechamento_log;
create table if not exists public.escala_fechamento_aberturas_arquivo as select * from public.escala_fechamento_aberturas;
drop view if exists public.escala_fechamento_duracao, public.escala_wip_erro_produto, public.escala_wip_erro_maquina, public.escala_wip_erro_dia, public.escala_wip_erro,
  public.escala_contagens_fechamento_para_motor, public.escala_fechamento_estado, public.escala_fechamentos_vigentes;
drop function if exists public.escala_fechamento_abrir(date, date, text, uuid, text, integer, boolean);
drop function if exists public.escala_fechamento_registrar(uuid, date, date, text, text, timestamptz, timestamptz, timestamptz, uuid, text, integer, integer, jsonb, jsonb, integer, text, boolean, text, text, uuid, boolean);
drop function if exists public.escala_fechamento_resultado(uuid, text, jsonb);
drop function if exists public.escala_fechamento_trava_adquirir(date, uuid, integer);
drop function if exists public.escala_fechamento_trava_liberar(date, uuid);
drop function if exists public.escala_fechamento_apontamento_permitido(date, text, uuid);
drop function if exists public.escala_fechamento_fisico_modo();
drop table if exists public.escala_fechamento_trava, public.escala_fechamento_log, public.escala_fechamento_buffers, public.escala_fechamentos, public.escala_fechamento_aberturas,
  public.escala_buffer_maquinas, public.escala_buffer_pares, public.escala_buffers_fisicos;
drop function if exists public.escala_fechamento_trg_imutavel();
drop function if exists public.escala_buffer_trg_catalogo();
alter table public.escala_parametros drop constraint if exists escala_parametros_fechamento_fisico_modo;
delete from public.escala_parametros where chave = 'escala_fechamento_fisico_modo';
-- eventos pendentes viram 'ignorado'; o tipo PERMANECE no CHECK (histórico de eventos não é reescrito)
update public.escala_producao_eventos set status = 'ignorado' where tipo = 'fechamento_fisico' and status in ('pendente', 'processando', 'erro');
delete from public.usuario_permissoes where permissao in ('escala_fechamento', 'escala_fechamento_excecao');
alter table public.usuario_permissoes drop constraint if exists usuario_permissoes_permissao_check;
alter table public.usuario_permissoes add constraint usuario_permissoes_permissao_check check (permissao in (
  'financeiro', 'produtos', 'maquinas', 'funcionarios', 'custo_hora', 'previsao', 'capacidade',
  'producao_real_apontamento', 'producao_real_historico', 'producao_real_ocorrencias', 'producao_real_apontamentos_realizados',
  'usuarios', 'auditoria', 'ausencias_funcionarios', 'escala_producao', 'escala_producao_tv', 'escala_wip_confirmar', 'escala_relatorios'));
commit;

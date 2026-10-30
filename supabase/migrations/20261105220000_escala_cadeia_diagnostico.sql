-- Sittech — Escala Inteligente: CADEIA, DIAGNÓSTICO (30/10/2026).
--
-- Cria APENAS a chave `producao_real_cadeia_diagnostico` ("desligado" | "ativo"; padrão "desligado"). Ligada, o fluxo só ACRESCENTA diagnósticos (CADEIA_INVALIDA, CADEIA_COBERTURA,
-- CONSUMO_REAL_MAIOR_QUE_DISPONIVEL, ESTADO_FISICO_INCONSISTENTE) à coluna jsonb `diagnosticos` do registro que o fluxo JÁ grava (escala_fluxo_diagnosticos). O plano, os hashes, o NO-OP e os alertas
-- NÃO mudam. Nenhuma outra tabela, função ou trigger é tocada.
--
-- ADITIVA e IDEMPOTENTE: insere a chave com os gatilhos desligados durante o INSERT (não dispara recálculo) e `on conflict do nothing`; o CHECK vale só para esta chave.
-- Código antigo ignora a chave (seguro). Ordem: migration → código → (flag OFF = comportamento idêntico) → UPDATE da flag.
-- Ligar:     update public.escala_parametros set valor = '"ativo"'::jsonb where chave = 'producao_real_cadeia_diagnostico';
-- Desligar:  update public.escala_parametros set valor = '"desligado"'::jsonb where chave = 'producao_real_cadeia_diagnostico';

alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
alter table public.escala_parametros disable trigger trg_escala_plano_versao;
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('producao_real_cadeia_diagnostico', '"desligado"'::jsonb, 'operacional', 'Cadeia, diagnóstico: "ativo" acrescenta diagnósticos de cadeia (ruptura prevista, cobertura em períodos, último período seguro, consumo real > disponível) ao registro do fluxo; NÃO altera o plano, os hashes nem os alertas. Mudar recalcula o futuro (plano idêntico)')
on conflict (chave) do nothing;
alter table public.escala_parametros enable trigger trg_escala_plano_versao;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

alter table public.escala_parametros drop constraint if exists escala_parametros_cadeia_diagnostico;
alter table public.escala_parametros add constraint escala_parametros_cadeia_diagnostico
  check (chave <> 'producao_real_cadeia_diagnostico' or valor in ('"desligado"'::jsonb, '"ativo"'::jsonb));

-- Sittech — Escala Inteligente: PLANEJAMENTO DE CADEIA, CAMADA 1 = DIAGNÓSTICO (30/10/2026).
--
-- Chave `producao_real_cadeia_diagnostico` ("desligado" | "ativo"; padrão "desligado"). Ligada, o fluxo só ACRESCENTA diagnósticos (CADEIA_INVALIDA, CADEIA_COBERTURA, CONSUMO_REAL_MAIOR_QUE_DISPONIVEL,
-- ESTADO_FISICO_INCONSISTENTE) ao registro do recálculo: o plano NUNCA muda. As camadas 2 (Allowed/estoque de saída) e 3 (reparo) têm chaves/migrations próprias e independentes.
--
-- ADITIVA e IDEMPOTENTE: insere a chave com gatilhos desligados durante o INSERT (não dispara recálculo) e `on conflict do nothing`; o CHECK vale para TODAS as chaves `producao_real_cadeia_*`.
-- Código antigo ignora a chave (seguro). Ligar:    update public.escala_parametros set valor = '"ativo"'::jsonb where chave = 'producao_real_cadeia_diagnostico';
-- Desligar:  update public.escala_parametros set valor = '"desligado"'::jsonb where chave = 'producao_real_cadeia_diagnostico';

alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
alter table public.escala_parametros disable trigger trg_escala_plano_versao;
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('producao_real_cadeia_diagnostico', '"desligado"'::jsonb, 'operacional', 'Cadeia, camada 1: "ativo" acrescenta diagnósticos de cadeia (ruptura prevista, cobertura em períodos, último período seguro, consumo real > disponível) ao recálculo do fluxo; NÃO altera o plano. Mudar recalcula o futuro')
on conflict (chave) do nothing;
alter table public.escala_parametros enable trigger trg_escala_plano_versao;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

alter table public.escala_parametros drop constraint if exists escala_parametros_cadeia_modos;
alter table public.escala_parametros add constraint escala_parametros_cadeia_modos
  check (chave not like 'producao_real\_cadeia\_%' or valor in ('"desligado"'::jsonb, '"ativo"'::jsonb));

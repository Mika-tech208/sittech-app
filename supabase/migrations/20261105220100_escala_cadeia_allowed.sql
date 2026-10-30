-- Sittech — Escala Inteligente: PLANEJAMENTO DE CADEIA, CAMADA 2 = ALLOWED / ESTOQUE DE SAÍDA (30/10/2026).
--
-- Chave `producao_real_cadeia_allowed` ("desligado" | "ativo"; padrão "desligado"). Ligada, o fluxo (a) estende a janela de consumo do downstream ao 1º período do PRÓXIMO dia produtivo no cálculo do
-- Allowed (limitada pela demanda futura conhecida e pela capacidade do downstream) e (b) põe a penalidade de cadeia (déficit de material, incl. o estoque de saída limitado) na frente da tupla J.
-- Independente das camadas 1 (diagnóstico) e 3 (reparo). Recomendado rodar em SOMBRA (producao_real_modo = 'sombra') antes de qualquer uso ativo.
-- ADITIVA e IDEMPOTENTE (gatilhos desligados durante o INSERT; on conflict do nothing). O CHECK de 20261105220000 já cobre a chave.
-- Ligar:  update public.escala_parametros set valor = '"ativo"'::jsonb where chave = 'producao_real_cadeia_allowed';   Desligar: ... valor = '"desligado"'::jsonb ...

alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
alter table public.escala_parametros disable trigger trg_escala_plano_versao;
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('producao_real_cadeia_allowed', '"desligado"'::jsonb, 'operacional', 'Cadeia, camada 2: "ativo" estende o Allowed do fluxo ao próximo dia produtivo (limitado pela demanda futura conhecida e pela capacidade) e penaliza déficit de material na escolha do plano. Mudar recalcula o futuro')
on conflict (chave) do nothing;
alter table public.escala_parametros enable trigger trg_escala_plano_versao;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

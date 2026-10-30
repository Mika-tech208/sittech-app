-- Sittech — Escala Inteligente: PLANEJAMENTO DE CADEIA, CAMADA 3 = REPARO (30/10/2026).
--
-- Chave `producao_real_cadeia_reparo` ("desligado" | "ativo"; padrão "desligado"). Ligada, o fluxo gera candidatos REPARADOS (upstream religado no último período seguro, retropropagado com lead time
-- de 1 período, via hook `reposicaoMinima` do motor) e realoca pessoas de posto sem material; entram na MESMA disputa pela tupla J e só valem com 0 violação dura e falta final do produto final
-- não pior. Independente das camadas 1 e 2. NÃO ligar sem evidência (ver relatório D6). ADITIVA e IDEMPOTENTE; o CHECK de 20261105220000 já cobre a chave.
-- Ligar:  update public.escala_parametros set valor = '"ativo"'::jsonb where chave = 'producao_real_cadeia_reparo';   Desligar: ... valor = '"desligado"'::jsonb ...

alter table public.escala_parametros disable trigger trg_escala_parametros_evento;
alter table public.escala_parametros disable trigger trg_escala_plano_versao;
insert into public.escala_parametros (chave, valor, grupo, descricao) values
  ('producao_real_cadeia_reparo', '"desligado"'::jsonb, 'operacional', 'Cadeia, camada 3: "ativo" gera candidatos reparados (upstream religado no último período seguro) e realoca pessoas de posto sem material. Mudar recalcula o futuro')
on conflict (chave) do nothing;
alter table public.escala_parametros enable trigger trg_escala_plano_versao;
alter table public.escala_parametros enable trigger trg_escala_parametros_evento;

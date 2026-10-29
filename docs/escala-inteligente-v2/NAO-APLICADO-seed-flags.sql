-- PROPOSTA — NÃO APLICAR. Seed das flags da antecipação (estado inicial: off). Rollback = UPDATE para 'off'.
-- Formato igual ao de escala_parametros (chave/valor jsonb em texto). Nenhuma flag é ligada por este arquivo.
insert into public.escala_parametros (chave, valor)
values
  ('producao_real_antecipacao_modo', '"off"'),                                   -- off | sombra   (ativo NÃO existe nesta fase)
  ('producao_real_antecipacao_teto', '{"janelaSemanas":6,"maxPeriodosAntecipados":6,"fatorDemanda":1.0,"produtosRecorrentes":{},"idadeMaxHorasWip":48}')
on conflict (chave) do nothing;
-- rollback:  update public.escala_parametros set valor = '"off"' where chave = 'producao_real_antecipacao_modo';

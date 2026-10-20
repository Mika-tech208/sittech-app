# Teste SQL — adicional por etapa (Fase 1 do WIP planejado)

`t8_adicional_etapa.sql` é um bloco `DO` que se desfaz sozinho (termina em `RAISE EXCEPTION 'TESTE_OK T8 …'`).
Roda só em DEV/local, com `npx supabase db query --linked -f supabase/tests/escala_adicional_etapa/t8_adicional_etapa.sql`.
Resultado esperado: `ERROR: P0001: TESTE_OK T8: …` (a mensagem de sucesso é a própria exceção que desfaz tudo).
Cobre: RPC `upsert_previsao_semana` com `adicional_etapas`, preservação por item ao recriar, validações, cliente antigo, cascata,
`escala_parametros` (RLS admin, valores, evento de recálculo) e a constraint de `tipo_adicional`.

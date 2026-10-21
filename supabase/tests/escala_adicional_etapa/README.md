# Teste SQL — adicional por etapa (Fase 1 do WIP planejado)

`t8_adicional_etapa.sql` é um bloco `DO` que se desfaz sozinho (termina em `RAISE EXCEPTION 'TESTE_OK T8 …'`).
Roda só em DEV/local, com `npx supabase db query --linked -f supabase/tests/escala_adicional_etapa/t8_adicional_etapa.sql`.
Resultado esperado: `ERROR: P0001: TESTE_OK T8: …` (a mensagem de sucesso é a própria exceção que desfaz tudo).
Cobre: RPC `upsert_previsao_semana` com `adicional_etapas`, preservação por item ao recriar, validações, cliente antigo, cascata,
`escala_parametros` (RLS admin, valores, evento de recálculo) e a constraint de `tipo_adicional`.

`t9_wip_controle.sql` (Fase 3): controle de estoque intermediário — criação/validações, ajuste, confirmação (motivo na divergência, idempotência),
histórico imutável, foto semanal idempotente (a 1ª vale), grants (o navegador não escreve nem executa as RPCs) e eventos (só com WIP ativo).

`t11_sombra.sql` (Fase 4d): modo sombra — evento lógico único por (semana, data, período) a partir do trigger de `apontamentos_producao`, aguardar não consome tentativa,
reivindicação atômica, snapshot idempotente e append-only (`escala_sombra_decisoes`), lançamento tardio só contado, resultado posterior separado, grants (navegador só lê),
parâmetro `replanejamento_modo` (sem recalcular o oficial) e Escala oficial intacta.

`t14_replanejamento_restrito.sql` (replanejamento restrito, modo `ativo_restrito`): portão no banco (modo + semana autorizada), aplicação atômica que regrava só o alterável,
concorrência otimista (versão base velha ⇒ nada é gravado), idempotência por decisão, auditoria append-only com versões/hash antes e depois e linhas antes, reversão que só desfaz se ninguém mexeu depois,
revisões da decisão (0 = corte/sombra, 1+ = aplicação), reavaliação por evento e grants. Para rodar SEM aplicar a migration: `begin; <migration 20261027100000>; <este arquivo>; rollback;`.

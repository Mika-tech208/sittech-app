# Produto único Conector 3/4 — E2E de DADOS no clone (06/11/2026)

Escopo: banco, RPCs e catálogo de buffers. **Não** exercita o motor/recálculo (trilha A). Tudo no clone local de PROD (dump de 06/11 13:11 UTC); PROD nunca foi escrito.

## Como reproduzir
```
supabase/tests/produto-unico/rodar.sh --do-zero          # restaura o clone, mede baseline, aplica 3 migrations + backfill, 90 checagens SQL, rollback estrutural e reaplicação
set -a; source ~/Documents/sittech-clone/env.clone; set +a
scripts/fechamento/ts.sh scripts/produto-unico-dados/e2e-dados.ts   # E2E encadeado (ativar -> Previsão -> unificar -> apontar -> fechamento -> rollback)
```

## O que o E2E prova (todos PASS na última rodada)
| # | Passo | Resultado |
|---|---|---|
| E0 | clone migrado, `produto_unico_cutover = null` | ok |
| E1 | Previsão 09/11 com itens legados 64.800 + 28.500 | ok |
| E2 | `produto_unico_ativar('2026-11-09')` | cutover ligado, 3 pares novos, 5 pares legados encerrados em 08/11, 3 buffers Conector, **nenhum evento de recálculo** |
| E3 | salvar a Previsão com itens legados após o cutover | recusado (`PRODUTO_LEGADO_APOS_CUTOVER`), nada perdido |
| E4 | `produto_unico_unificar_previsao` (botão) | UM item de 93.300; 11 máquinas mapeadas (M8 na etapa "Rosquear + Parafusar"); backup guardado |
| E4d | `produto_unico_separar_previsao` | restaura 64.800 + 28.500 do backup; unifica de novo |
| E5 | `upsert_previsao_semana` (RPC do app) com o item único + 3 outros itens | salva; item único com 93.300 |
| E6 | 5 apontamentos do produto único em 09/11 (M8, Parafusadeira 9, Rosqueadeira 3, Etiquetadora 15, Embalagem 17) | M8 -> "Rosquear + Parafusar"; legado em 09/11 recusado; produção final = só Embalagem |
| E7 | fechamento do produto único (função `buffersObrigatorios` do app sobre o catálogo do clone) | **exatamente 3** buffers Conector; legados 0 em 09/11; 06/11 segue com 3 |
| E7d/e | `contagensDoInventario` com A=3.000, B=5.000, C=2.000 | buffer 2 = 5.000 (sem duplicar); catálogo satisfaz `verificarCatalogoUnico` |
| E8 | rollback | recusa com item na Previsão; após excluir o item: `preservando_dados` (5 apontamentos preservados), cutover = null, legados voltam |

Apontamentos pelo RPC do fluxo único (`registrar_apontamentos_fechamento`), regularização histórica e REABRIR PERÍODO foram provados em `supabase/tests/produto-unico/03-apontamentos.sql` com cutover retroativo **dentro de uma transação com ROLLBACK** (o RPC recusa data futura, e 09/11 ainda é futuro no relógio real).

## Ponto exato em que o recálculo (motor) ainda não é coberto por esta trilha
* O recálculo do plano da semana 09/11 com o item único depende de `src/lib/escala/supabaseIO.ts` (`carregarEstado`: cutover da semana + modelo canônico), `integracaoCorte.ts` e `supabaseFechamento.ts` — trilha A, ainda não mesclada nesta branch. Nesta branch o motor trataria o produto único como um roteiro **em série de 5 etapas** (errado). Por isso o E2E NÃO dispara recálculo (a semana 09/11 do clone não tem escala gerada, então nenhum evento é enfileirado ao salvar a Previsão).
* O que a trilha A precisa encontrar no banco (e este E2E confirma que está lá): produto `CONECTOR_3_4_UNICO` ativo, `produto_canonico_*`/mapas preenchidos, `escala_parametros.produto_unico_cutover='2026-11-09'`, catálogo com 3 pares `contabil` (1 por buffer, sem `zero`, sem par da M8), contagens iniciais A/B/C.

## Achados / decisões
1. **Conflito de especificação dos pares de buffer** — o briefing da trilha B pedia 2 pares `contabil` no buffer "Parafusados" (Parafusar→Etiquetar e M8→Etiquetar); a guarda `verificarCatalogoUnico` da trilha A exige 3 pares no total e **nenhum par da M8**. `produto_unico_ativar` tem `p_par_m8` (padrão `false` = 3 pares, compatível com a guarda de A). Com `true` há 4 pares e a view `escala_contagens_fechamento_para_motor` entrega o saldo a um só (testado), mas o `contagensDoInventario` em TS duplicaria (10.000) e a guarda de A recusaria. Decidir antes de segunda.
2. `escala_contagens_fechamento_para_motor` foi recriada (mesmas colunas): com o catálogo atual devolve as MESMAS linhas (testado contra a definição original, 7 linhas reais).
3. Hash do plano da semana 02/11: idêntico antes/depois das migrations e também com o cutover LIGADO (nenhuma versão nova).
4. Preço do produto único = 0,1825 (do convencional); o da automática é 0,182 (R$ 0,0005/peça). Decisão do usuário.
5. Carga adicional **por etapa** não é suportada no produto único (guarda no banco); `quantidade_adicional` do item é somada pelo adaptador de A.

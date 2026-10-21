# Correção da Previsão × roteiro (21/10/2026)

## Causa
O editor de produto (`atualizar_produto_com_roteiro`) atualiza `roteiro_etapas` **no lugar, pelo id**. Em 21/10 14:20 (SP) as duas etapas da Caixa Amarela 4x2 trocaram de operação mantendo o id:
`c765eb93` Montar Presilha → Etiquetar; `f75cc037` Etiquetar → Montar Presilha. A Previsão guarda só `(item, etapa_id, máquina)` e o motor lia isso sem conferir o roteiro, então as máquinas ficaram na etapa errada.
Conector 1.1/4": a Embalagem 17 saiu do roteiro do Embalar (só 17B, 11:54) e continuou na Previsão. Nenhuma outra etapa do banco tem esse descompasso (conferido em 3.390 apontamentos e 803 alocações).

## Dados corrigidos (PROD, semanas 19/10 e 26/10 apenas; semanas anteriores são histórico e não foram tocadas)
- Removidas 11 seleções comprovadamente inválidas (`previsao_item_maquinas`) e o adicional de 7.200 preso a `c765eb93` (26/10). Nada foi adicionado por inferência. Backup: `backups/prod/sittech-prod-20261021-145514.sql`.
- Recálculo normal pelo motor (só o futuro): passado intacto (hash do passado idêntico nas duas semanas).

## Defesa no motor (`montarEntradaEscala`)
Máquina que o roteiro atual não torna elegível para a etapa (lista de `roteiro_etapa_maquinas`, ou, sem lista, mesma operação) **não vira posto**; sai o aviso `selecao_maquina_invalida` (produto, etapa, operação, máquina, semana) no resumo do recálculo e na tela de alertas. A Previsão não é corrigida em silêncio; etapa sem nenhuma máquina válida fica sem posto (fail-safe). Snapshots da sombra feitos sobre Previsão assim carregam `entradaComRoteiroInconsistente = true` e não servem de evidência de qualidade do motor.

## Proposta (não implementada)
1. `atualizar_produto_com_roteiro`: se o `id` existente chega com `operacao_id` diferente, **criar etapa nova** e arquivar a antiga (`arquivada_em`, nunca apagar — apontamentos/alocações/Previsões antigas a referenciam). Mudar só meta/ordem/máquinas mantém a etapa. Leitores a ajustar para ignorar arquivadas: `useProdutos`, `supabaseIO`, `wipIO`, `dataFetchers`, `indicadores`, `useProdutosElegiveisPorMaquina`.
2. Previsão com contexto: gravar em `previsao_item_maquinas` a `operacao_id` e a `ordem` da etapa no momento (ou um `roteiro_hash` por item). A versão do plano (`escala_plano_versoes.entrada`) passa a registrar esse hash: “esta Previsão foi feita contra a versão X do roteiro”.
3. Ao salvar roteiro de produto presente em Previsão futura: listar semanas e pares máquina/etapa incompatíveis, com “Revisar programação afetada”.

# Conector 3/4 — produto único com duas rotas: auditoria e desenho (06/11/2026)

**Status:** AUDITORIA + DESENHO. Nada foi alterado em PROD, no motor, no Forecast, nos roteiros ou nos apontamentos. Fonte dos dados: cópia do PROD de 06/11 ~09:50 (clone local, somente leitura); linhas de 06/11 do clone incluem lançamentos de TESTE e foram excluídas dos números de histórico (corte em 05/11).

## 1. Produtos legados
| | id | valor unit. |
|---|---|---|
| Conector 3/4" (convencional) | `27c229d7-f192-41eb-aad1-0c69ece53eba` | 0,1825 |
| Conector 3/4" - Maquina Automatica | `a027ac97-ffd1-4834-8ed0-d3a94aac4aee` | 0,182 |

## 2. Forecast atual de cada um (`previsao_itens`)
| semana | Convencional | Automática |
|---|---|---|
| 02/11 (atual) | 64.800 | 28.500 |
| 26/10 | 81.000 (+22.800 adicional) | 35.625 |
| 19/10 | 54.000 + 48.300 + 38.700 (3 linhas) | 35.625 |
| 12/10 | 43.200 | 28.500 |
| 21/09 | 24.650 | 35.625 |

Hoje a demanda é lançada **duas vezes** (um item por produto). A divisão entre rotas nasce do Forecast, não do motor.

## 3. Roteiros atuais
**Convencional:** Rosquear (ord 0; Rosqueadeira 3/5/6; meta 2000 manhã / 1600 tarde) → Parafusar (1; Parafusadeira 9/10/11/12; 1500/1200) → Etiquetar (2; Etiquetadora 15/16; 3500/3000) → Embalar (3; Embalagem 17; 5000/4500).
**Automática:** *Rosquear + Parafusar* (0; Máquina Automática 8; 1275/1100) → Etiquetar (1; Etiquetadora 15/16; 3500/3000) → Embalar (2; Embalagem 17; 5000/4500).
Etapas de Etiquetar e Embalar são **duplicadas** nos dois produtos (ids diferentes, mesmas máquinas e mesmas metas).
A operação "Rosquear + Parafusar" **já existe** como operação própria (38 apontamentos) — é a operação canônica que o item 21 pede.

## 4. Buffers físicos (já são 3 compartilhados)
| buffer | pares `contabil` | pares `zero` | produz | consome |
|---|---|---|---|---|
| `conector34:rosqueadas` | Conv Rosquear→Parafusar | — | Rosqueadeiras 3/5/6 | Parafusadeiras 9–12 |
| `conector34:parafusadas` | Conv Parafusar→Etiquetar | Auto (Rosquear+Parafusar)→Etiquetar | Parafusadeiras 9–12 **e M8** | Etiquetadoras 15/16 |
| `conector34:etiquetadas` | Conv Etiquetar→Embalar | Auto Etiquetar→Embalar | Etiquetadoras 15/16 | Embalagem 17 |

Ou seja: **o ponto de convergência físico já existe e o fechamento já pede só 3 números** para o Conector 3/4. Os pares `zero` do produto Automático são um *remendo*: a contagem física única é atribuída ao produto convencional e o Automático fica com pilha zero (evita contar a M8 duas vezes). O histórico de contagens (`escala_fechamento_buffers`, ids de buffer estáveis) **não precisa migrar**.

## 5. Como o corte-v1 modela cada um hoje (código lido)
- `src/features/escala/fluxo/grafo.ts`: cada produto é uma cadeia. **Fusão legada** (`producao_real_pares_legado`, id `conector-3-4`): os pools de **Etiquetar** e **Embalar** dos dois produtos viram UM nó lógico (`membros[]`); as linhas do plano saem no produto convencional. As cadeias a montante (Conv: Rosquear→Parafusar; Auto: M8) **convergem** nesse nó (convergência/fan-in é suportada; cada nó tem no máximo uma aresta de saída).
- **O peso de cada ramo é fixo:** `peso = Q_ramo / ΣQ`, onde Q vem da **quantidade do Forecast de cada produto** (`proporcaoConvencional`). A demanda comum é `Q_conv + Q_auto − boas`. Portanto o motor **não decide** quanto vai por cada rota — o Forecast decide.
- Já existe um mecanismo de **produto único por ligação** (`ligacoes`: última etapa de um produto alimenta a primeira de outro; F#CONV/F#AUTO/F#COMUM). Não há nenhuma ligação configurada em PROD e ele não modela rotas *alternativas* (só encadeia).
- Máquina 8 desmarcada: teste `m8Desmarcada.test.ts` cobre a rota automática ficar indisponível sem virar etapa inicial com material infinito (bug anterior já corrigido).
- Revezamento: modo `duro`, escopo `bloco`, `revezamento_equivalencias = {}` — operações contam por id; "Rosquear + Parafusar" é uma operação própria e não gera violação dupla.

**Gap real para o que você pediu:** (a) demanda única; (b) divisão entre rotas decidida pelo motor (capacidade, pessoas, máquinas selecionadas, revezamento, lote); (c) rota como atributo de etapa dentro de UM produto. Nada disso existe: hoje é "dois produtos + fusão com peso fixo".

## 6. Desenho proposto (produto único)
**Produto:** `CONECTOR_3_4_UNICO` (novo id; os dois legados ficam, inativos para planejamento futuro, com alias `LEGACY_CONVENCIONAL` / `LEGACY_AUTOMATICO`).
**Rotas** (nova dimensão, sem apagar nada): `produto_rotas(id, produto_id, codigo, ordem_visual)` e `roteiro_etapas.rota_id` (NULL = etapa comum às rotas).
- Rota `CONVENCIONAL`: Rosquear → Parafusar.
- Rota `AUTOMATICA`: Rosquear + Parafusar (M8, 1 máquina, 1 pessoa, operação canônica `ROSQUEAR_PARAFUSAR_AUTOMATICO` = a operação "Rosquear + Parafusar" já existente).
- Comuns (rota NULL): Etiquetar, Embalar (uma única definição, sem duplicar etapas).
**Buffers (exatamente 3):** Rosqueados→Parafusar (só convencional alimenta); Parafusados→Etiquetar (recebe Parafusar convencional **e** M8, ambos pares `contabil` do MESMO buffer; sem pares `zero`); Etiquetados→Embalar.
**Motor:** nó de decisão no ponto de convergência. Variável `s_r` por rota, 0 ≤ Σ s_r = 1, limitada por capacidade/pessoas/máquinas selecionadas/revezamento; conservação `Σ boas_r = alimentação do buffer comum`; demanda contada **uma vez** no nó final (Embalar). Rota sem máquina selecionada ⇒ `s_r = 0` e a etapa seguinte nunca vira etapa inicial.
**Lote Tn→Tn+1:** regra já existente aplica-se por buffer; a M8 alimenta o buffer comum com a mesma regra.
**Apontamentos:** continuam por operação (`operacao_id`), e a rota fica derivada de `etapa_id` ⇒ Intelligence sabe quanto veio de cada rota; o estoque é compartilhado.

## 7. Cutover (sem migração retrospectiva)
Parâmetro novo `conector34_cutover = {"data":"AAAA-MM-DD","periodo":"m1"}` (modelo legado antes, produto único depois). Recomendo um **início de semana** (segunda, M1), nunca no meio de uma semana planejada. No instante do cutover, três contagens físicas (A rosqueados, B parafusados, C etiquetados) inicializam o produto único — usa o mecanismo de contagem física que já existe (`producao_real_contagens_fisicas` / fechamento); **nenhum saldo legado é somado por estimativa**.

## 8. Impacto por área
- **Forecast:** um item "Conector 3/4"; os recursos (máquinas por rota, M8, Etiquetadora, Embalagem) saem de `previsao_item_maquinas` já por item; precisa de agrupamento por rota na tela. O motor só usa o que estiver selecionado.
- **Apontamentos:** nenhuma regra nova; lista de produtos passa a ter o único; histórico intacto. RPCs de roteiro (`roteiro_etapa_maquinas`) continuam resolvendo (máquina+produto → etapa); atenção à elegibilidade quando a mesma máquina servir a mais de uma etapa (hoje não ocorre).
- **Fechamento físico:** mesmos 3 buffers (ids estáveis); pares do produto único substituem os pares dos legados na vigência (`vigente_de` = cutover).
- **Plano/relatórios/Intelligence:** camada de alias (view) `produto_canonico_conector34` mapeando os 3 ids para `CONECTOR_3_4` nos agregados históricos.

## 9. Testes HARD previstos
Cenários 1–10 do pedido, mais: não duplica demanda, não duplica WIP, M8 = 1 operador, downstream sem material inexistente, buffer comum nunca negativo, soma das rotas, lote Tn→Tn+1, máquina fora do Forecast nunca usada, nenhuma rota fantasma com M8 desligada.

## 10. Replay
Dados reais recentes existem: 369 apontamentos do convencional (823.143 pç) e 110 da automática (106.443 pç) até 05/11; contagens físicas por fechamento desde 04/11 (3 buffers) e 25 contagens manuais. Replay = reprocessar semanas 12/10–02/11 no modelo atual (fusão) e no produto único e comparar quantidade final, WIP físico, soma da M8, uso do buffer comum e revezamento. **Não executado.**

## 11. Rollback
Produtos legados e seus roteiros ficam intactos; o produto único e as rotas são aditivos; `conector34_cutover` desligado volta ao modelo legado; dados novos (apontamentos do produto único) permanecem e são lidos pelo alias. Migration com `ROLLBACK.sql` que remove só as novas tabelas/colunas **vazias** (não destrói dados novos: se houver lançamentos, aborta).

## 12. Checklist GO/NO-GO (todos pendentes)
1. Migration no clone + rollback testado · 2. Motor com rotas alternativas (decisão de divisão pelo otimizador) + 10 cenários + HARD gates · 3. Forecast agrupado por rota · 4. Alias histórico e relatórios antigos abrindo · 5. Replay 12/10–02/11 sem duplicar quantidade e com WIP físico igual · 6. E2E do fechamento com os 3 buffers · 7. Contagem física do cutover agendada (A/B/C) · 8. Janela de cutover (início de semana) · 9. Plano de rollback ensaiado.

## 13. Decisões que dependem de você
1. Produto único **novo** (recomendado, item 30) ou reaproveitar o id do convencional? 2. Data/semana do cutover. 3. Critério do motor para dividir entre rotas (objetivo EQUILIBRIO atual? prioridade de uma rota?). 4. Se Intelligence deve agregar o histórico dos legados sob "Conector 3/4" por padrão.

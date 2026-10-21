# Fase 4 — Adendo ao plano técnico (para aprovação, nada implementado)

Escopo: Produção Real + replanejamento em **modo sombra**, revezamento duro, período comprometido, oportunidade de escala e base de eficiência.
Fora de escopo: Fase 5, ativação do WIP em PROD, qualquer mudança em PROD. Este documento **não altera código do produto**; as simulações foram feitas em protótipo offline (fora do repositório) sobre os dados reais do backup de PROD de 20/10.

## 0. O que os dados reais já mostram (base para decidir)

Produção Real de PROD (3.308 apontamentos, 15/09 a 20/10):

| Semana | Pessoas apontadas por período (mediana) | Postos produzindo / período | Postos **sem operador** / período | Postos **sem material** / período |
|---|---|---|---|---|
| 05/10 | 13 | 13,2 | 3,3 | 2,8 |
| 12/10 | 13 | 13,1 | 4,3 | 3,0 |
| 19/10 (até 20/10) | 14 | 14,1 | 5,4 | 1,1 |

- Cada período tem em média 4–5 postos registrados como `falta_operador` e 1–3 como `falta_material`. Esse é o maior bloco de capacidade perdida que a Produção Real já separa; `performance` abaixo da meta é pequena (≈ 8–11% abaixo da meta nos postos que produziram, compensada por ≈ 5–6% acima dela).
- As linhas `sem_producao` **não trazem produto nem etapa** (só máquina e motivo). Não dá para valorar a perda por etapa só com o apontamento; a Fase 4 precisa cruzar com o plano oficial do período (ver item 7).
- Revezamento no que foi executado à mão: 3–9% dos pares consecutivos de períodos trabalhados repetem a mesma operação (semana de 12/10: 8 de 233 pares = 3,4%; 19/10: 7 de 127 = 5,5%). O motor atual não repete nas três semanas reais (0 repetições).
- Lançamento dos apontamentos: mediana +2 min após o fim do período, p90 +7 min; em 93% dos períodos 90% das linhas chegam até +10 min; só em 77% dos períodos 100% das linhas chegam até +10 min (o resto são lançamentos tardios, p99 = +120 min). Maior pausa entre lançamentos do mesmo período: p50 1 min, p90 2 min.

## 1. Como implementar o revezamento duro

**Hoje** (`gerarEscala.ts`): os postos de cada período são escolhidos primeiro (K = min(pessoas, postos válidos), por gargalo/folga/valor); depois o Húngaro atribui pessoas a postos com custo de repetição `CUSTO_ROTACAO = 1e9` — repetir é *muito caro*, mas possível; quando acontece vira `excecaoRevezamento` + justificativa. Ou seja, é restrição **mole**, e a cobertura (quais postos entram) é decidida antes de saber se existe atribuição sem repetição.

**Proposta** (duas mudanças, mesmo motor, ordem de prioridade preservada):
1. **Seleção de postos com viabilidade.** Percorrendo os candidatos na ordem de prioridade de hoje (gargalo → folga → valor → continuidade…), um posto só é aceito se o conjunto já aceito + o novo ainda admite **atribuição completa das pessoas sem repetir a operação do período anterior** (emparelhamento bipartido; a estrutura é um matroide de transversais, então o guloso por prioridade é ótimo: nenhum posto de maior prioridade é sacrificado por um de menor). Vale para a camada do previsto **e** para a camada de adicional/WIP.
2. **Atribuição só entre pares válidos.** Par que repete operação passa a ser proibido (custo 1e13 no Húngaro, que nunca é escolhido se há solução; na prática, filtro). Dentro das soluções válidas, equidade/exposição/continuidade continuam como custos.
3. **Sem solução válida ⇒ não viola.** A pessoa que não tem posto válido fica **sem posto** com motivo novo: *"Revezamento obrigatório: sem posto livre que não repita a operação do período anterior"*, e é gerado o alerta `rotacao_sem_solucao` (período, quantidade de postos descobertos, operações envolvidas) com alternativas: (a) habilitar mais pessoas na operação; (b) selecionar máquina de outra operação para o produto; (c) reduzir/redistribuir os postos dessa operação; (d) aceitar o posto vazio. Exemplo de mensagem: *"Não existe escala válida para preencher todos os postos no T3 sem repetir operação consecutiva (2 postos de Etiquetar; 2 pessoas vinham de Etiquetar)."*
4. Definição de repetição (igual à de hoje, que a regra já usa): mesma `operacao_id`, mesma pessoa, períodos **consecutivos no mesmo dia** (M1→M2→M3→T1→T2→T3; M3→T1 conta), qualquer máquina/produto/posto; o primeiro período do dia zera; período sem posto ou ausência quebra a sequência.
5. **Troca manual**: a RPC de troca hoje aceita qualquer troca. Para o revezamento ser restrição dura, a troca que criaria repetição deve ser **recusada** ou exigir confirmação explícita com motivo, registrada como "exceção ergonômica manual". *Decisão necessária (ver item 11).*
6. Protótipo validado: o motor com a regra "mole" reproduz byte a byte o motor atual (3 semanas reais e 3 cenários); com a regra dura o plano das **3 semanas reais é idêntico** (0 repetições antes e depois, 12/10: 279 pares, 19/10: 283, 26/10: 361; cobertura e peças iguais). Nos cenários de estresse o custo aparece: 3 postos da mesma operação para 2 pessoas — atual repete 10 vezes (100% de cobertura, 1.200 peças), duro não repete e cai para 51,1% de cobertura (600 peças) com 6 pessoas-período sem posto por revezamento; 1 pessoa/1 operação: atual repete 5 vezes, duro alterna e produz metade.

## 2. Impacto sobre a regra atual de equidade

- Equidade (em minutos por operação/máquina), exposição à operação no dia, mudança de posto e ociosidade continuam **exatamente como estão**, como custos entre soluções válidas. Fórmulas não mudam.
- Hoje o revezamento já domina a equidade (custo 1e9 contra ~1e3–1e6), exceto nas exceções registradas. Mudança real: **desaparecem as exceções** (nunca repete) e a seleção de postos passa a considerar viabilidade; em vez de "repetir e registrar", o sistema **deixa posto vazio e alerta**.
- Efeito esperado nas semanas reais: nenhum (0 exceções hoje). O efeito só aparece em semanas com poucas pessoas por operação.
- Ordem de prioridade do motor (itens 1–8 da diretriz): 1–3 = camada do previsto (gargalo/folga já recalculados com a quantidade **real restante**); 4 = preenchimento de ociosos; 5–6 = camadas de acabado e WIP (já subordinadas ao previsto); 7 = Fase 5; 8 = equidade como custo entre soluções válidas. "Recuperação expulsa camadas inferiores" **não exige algoritmo novo**: com a quantidade real restante no previsto, a camada do previsto consome a capacidade antes do adicional/WIP; no replanejamento de T3 em diante o adicional/WIP some automaticamente quando a capacidade é necessária.

## 3. Como representar período comprometido (desenho mínimo)

Princípio: o estado "comprometido" é **derivado do relógio**, não de um botão.

- `ultimoIniciado(t)` = último período cujo início ≤ t. Congelados: tudo até `ultimoIniciado + 1` (período atual + o próximo).
- Nenhuma tabela nova no motor oficial. O que precisa existir é **prova auditável do que foi publicado**:
  - O snapshot da decisão sombra (item 7) já guarda o `periodo_comprometido` e o hash das linhas oficiais desse período no instante da decisão.
  - Opcional, recomendado na etapa seguinte: `escala_publicacoes(data, periodo_id, publicado_em, hash_linhas)`, gravada pelo próprio worker quando um período começa (um insert idempotente por período). Serve para responder "o que o chão de fábrica viu" sem depender do recálculo.
- **Horizonte oficial**: hoje o motor oficial congela só o que já começou (`primeiroSlotFuturo`), então um recálculo (ausência, previsão) pode mexer no próximo período. Introduzir um parâmetro operacional `escala_horizonte_modo` = `atual` | `comprometido`. Sombra usa sempre `comprometido`. Trocar o oficial para `comprometido` é uma decisão separada (muda o comportamento visível hoje), que proponho **só depois** de a sombra rodar algumas semanas.

## 4. Algoritmo exato do horizonte (dois períodos à frente)

Índices de período contínuos dentro da semana (dias produtivos concatenados, M1…T3). Seja **c** o índice do último período **fechado** (item 5).

```
primeiro_alteravel = max(c + 2, ultimoIniciado(agora) + 2)
congelado          = períodos ≤ c  : EXECUTADO (Produção Real, quem apontou e onde)
                     período  c+1  : COMPROMETIDO (linhas oficiais publicadas)
alteravel          = períodos ≥ primeiro_alteravel
```
Exemplos (iguais aos pedidos): M1 apontado ⇒ M2 congelado, recalcula de M3; M2 ⇒ M3 congelado, de T1; M3 ⇒ T1 congelado, de T2; T1 ⇒ T2 congelado, de T3; T2 ⇒ T3 congelado, o efeito começa no **primeiro período do dia seguinte**; T3 ⇒ M1 do dia seguinte congelado, recalcula de M2. O `max(...)` cobre o caso de o fechamento ser detectado atrasado: nunca se altera período já iniciado nem o seguinte a ele.

No motor: `aPartirDe = primeiro_alteravel`; `congeladas` = linhas executadas (≤ c) + linhas oficiais de c+1 (com `pecas = 0`, o saldo comprometido já está descontado do restante); o estado de rotação/equidade/continuidade vem dessas linhas, então o revezamento duro vale **na fronteira** do comprometido.

Quantidade a produzir por pool no replanejamento: `restante = max(0, previsto − boas reais (≤ c) − produção esperada de c+1 × ritmo conhecido)`; metas futuras × `f` (item 6 da diretriz). O ritmo usa só períodos fechados: `n < 3 ⇒ f = 1`; `n ≥ 3 ⇒ f = 1 + n/(n+6) × (obs − 1)` com `obs = Σ boas / Σ meta` limitado a [0,30; 1,30]. (Interpretação do "peso n/(n+6)" como peso do desempenho observado frente a 1; *confirmar no item 11*.)

## 5. Como detectar fechamento de período (sem intervenção manual)

Evidência (item 0): 93% dos períodos têm 90% das linhas até +10 min; pausa típica entre lançamentos 1–2 min.

Um período P está **fechado/estável** quando:
1. `agora ≥ fim(P) + 10 min`, **e**
2. cobertura de apontamento ≥ 90% dos postos esperados (postos do plano oficial de P: pessoas com posto + postos vazios), **e**
3. quietude: nenhum apontamento novo de P há ≥ 3 min;
**ou** prazo duro `agora ≥ fim(P) + 20 min` (usa o que houver).
Linhas que chegam depois (p99 = +120 min) **não reescrevem decisões passadas**: ficam registradas como "dado tardio" e entram no próximo corte; o snapshot guarda quais linhas existiam. Gatilhos: (a) o disparo que a tela de apontamento já faz após salvar (`dispararProcessamento…`) e (b) o worker de drenagem de 5 min como rede de segurança (a Vercel Hobby não oferece cron frequente; o GitHub Actions é só reserva). Parâmetros (10/90/3/20) ficam em `escala_parametros` (operacionais).

## 6. Como agrupar eventos

- Trigger em `apontamentos_producao` (insert/update) registra **um evento por (previsão, data, período)**: índice único parcial sobre eventos pendentes `tipo='apontamento_periodo'` com chave `semana|data|periodo`; novas linhas fazem `ON CONFLICT DO UPDATE` apenas de `ultimo_lancamento_em` (24 postos ⇒ 1 evento).
- O worker só processa o evento quando as regras de fechamento do item 5 passam; antes disso o evento fica pendente **sem consumir tentativa**. Processa períodos em ordem cronológica e, se houver vários pendentes da mesma semana (ex.: sistema ficou fora), executa **um** corte por período fechado, do mais antigo ao mais novo (cada corte usa só a informação até o seu instante).
- Em sombra, o custo de uma decisão é 1 geração do plano sombra + 1 do oficial (~1 s nos dados reais). Nenhum recálculo por linha.

## 7. Estrutura do snapshot da decisão sombra

Tabela append-only `escala_sombra_decisoes` (um registro por semana × período fechado):

| Campo | Conteúdo |
|---|---|
| identificação | `previsao_id`, `semana_inicio`, `tomada_em` (timestamp do corte), versão do motor/parâmetros (hash) |
| janelas | `periodo_fechado`, `periodo_comprometido`, `primeiro_alteravel`, `fechamento` (regra usada: estável/prazo, linhas vistas) |
| restante e realizado | por pool: previsto, boas acumuladas, refugo, restante, restante após o comprometido |
| desempenho conhecido | por etapa: `n`, `obs`, `f` aplicado |
| capacidade | equipe disponível (ids, ausências conhecidas no corte), máquinas disponíveis/indisponíveis conhecidas, WIP confirmado alocado, adicional programado restante |
| planos | `plano_oficial_futuro` e `plano_sombra_futuro`: linhas completas dos **próximos 6 períodos alteráveis**; além disso só agregados por pool/dia + hash do plano completo (reprodutível a partir das entradas) |
| risco | falta prevista oficial × sombra por produto, status de execução (item 8 da diretriz), gargalo, alertas (`rotacao_sem_solucao`, risco…) |
| oportunidade | capacidade esperada oficial × sombra no gargalo para o 1º período alterável e para o horizonte |

Tabela posterior `escala_sombra_resultados` (acompanhamento): quando os períodos da decisão fecham, grava-se o realizado por pool, quem apontou onde, postos sem operador/material, e a **capacidade esperada da escala executada** calculada com as entradas guardadas na decisão. Nada do que chega depois altera o registro da decisão. Tamanho estimado: ~30 decisões/semana × < 60 KB.

## 8. Como medir oportunidade de escala sem informação futura

Pergunta: *com os mesmos funcionários, máquinas, ausências, indisponibilidades e restrições ergonômicas, existia uma distribuição válida que teria produzido mais no gargalo?*

1. **No momento da decisão** (corte c): para o 1º período alterável Q = c+2, calcula-se a **capacidade esperada** do plano oficial e do plano sombra (meta × ritmo conhecido, limitada ao restante), com a informação do corte.
2. **Depois que Q fecha**, avalia-se a **distribuição efetivamente executada** em Q com o mesmo critério (capacidade esperada, não o resultado): mesmos funcionários que apontaram em Q, mesmas máquinas disponíveis, revezamento duro, estado de rotação real de c+1, mesmo restante e mesmo ritmo do corte. A presença em Q é **restrição** (para a distribuição ser factível), nunca o resultado de produção.
3. `oportunidade_gargalo = esperado(melhor) − esperado(executada)` nos pools que o plano oficial deixaria faltar; também em R$. Marcada só se > max(500 peças, 1%); **nunca** sugere solução ergonomicamente inválida (usa o motor com revezamento duro) e retorna 0 quando a escala executada já era ótima. Relatório por período/semana, sem nomes.
4. Anti-viés: o ritmo vem só de períodos fechados antes do corte; o resultado real (boas) de Q **não entra** no julgamento, só serve depois para calibrar o modelo (esperado × realizado).

## 9. Impacto na reprodutibilidade

Mesmas entradas canônicas + mesmo passado congelado + mesmo próximo período comprometido ⇒ mesmo plano sombra. Entradas novas, todas **gravadas no snapshot**: Produção Real de períodos fechados (agregados por pool/período, não a tabela viva), parâmetros de desempenho (`perf_min 0,30`, `perf_max 1,30`, `K0 6`, `n_min 3`), WIP confirmado alocado, período comprometido, instante do corte. O motor continua puro (sem relógio); o corte é parâmetro. Dado tardio ou corrigido em `apontamentos_producao` depois do corte não muda o snapshot (ele guarda os agregados que usou). Nenhuma saída sombra volta como entrada; o motor oficial nunca lê as tabelas sombra. Teste: recalcular a decisão a partir do snapshot dá o mesmo hash de plano.

## 10. Simulação offline com dados reais (informação disponível até cada corte)

Metodologia do protótipo: para cada período fechado c (fim + 10 min), o **oficial** é o motor atual recalculando de c+2 sem Produção Real (como hoje, mas com o mesmo horizonte); a **sombra** usa a quantidade **real** restante, ritmo `f` conhecido, revezamento duro, congelando o executado (≤ c) e o comprometido (c+1). Ausências só entram se registradas até o corte. Atenção: o "oficial" é o plano do motor (a escala real das semanas foi montada à mão); ele é a referência de comparação, e o realizado vem dos apontamentos.

**Semana 12/10 (24 períodos, 22 cortes).** Planejamento (T0): **Impossível** (3 produtos impossíveis; semana não cabe). Execução: todos os 22 cortes "não recuperável".

| Corte | Comprometido | 1º alterável | Restante (acabado) | Realizado | Falta oficial → sombra | Δ capacidade | Gargalo (falta oficial → sombra) | Oportunidade no gargalo (esperada: executada → melhor) |
|---|---|---|---|---|---|---|---|---|
| 13/10 M1 | 13/10 M2 | 13/10 M3 | 253.294 | 2.006 | 37.694 → 37.694 | +5.700 | Conector 3/4" › Etiquetar 13.700 → 11.200 | 8.000 → 18.275 (+10.275) |
| 13/10 T1 | 13/10 T2 | 13/10 T3 | 225.420 | 29.880 | 53.716 → 43.975 | +33.573 | Conector Máq. Autom. › Embalar 19.500 → 500 | 8.806 → 18.088 (+9.282) |
| 13/10 T2 | 13/10 T3 | 14/10 M1 | 221.270 | 34.030 | 62.179 → 47.352 | +33.762 | Conector Máq. Autom. › Embalar 24.000 → 500 | 7.821 → 21.247 (+13.427) |
| 14/10 M3 | 14/10 T1 | 14/10 T2 | 206.365 | 48.935 | 84.352 → 71.204 | +25.267 | Conector Máq. Autom. › Embalar 28.500 → 5.000 | 7.306 → 20.512 (+13.205) |
| 15/10 T1 | 15/10 T2 | 15/10 T3 | 157.822 | 97.478 | 102.990 → 100.316 | +13.417 | Conector 3/4" › Etiquetar 33.700 → 23.700 | 8.152 → 20.370 (+12.217) |
| 16/10 T1 | 16/10 T2 | 16/10 T3 | 115.271 | 145.329 | 108.209 → 103.216 | +7.232 | Conector 3/4" › Parafusar 43.200 → 40.800 | 7.332 → 20.394 (+13.062) |

**Semana 19/10 (30 períodos; produção real até 20/10 T3, 12 cortes).** Planejamento (T0): **Atingível no limite** (5 produtos, folga 0%). Execução: **recuperável** em 19/10 M1 e M2; **primeiro corte não recuperável: 19/10 M3**; 10 dos 12 cortes não recuperáveis. É exatamente a distinção pedida: programação originalmente possível que ficou em risco/irrecuperável na execução.

| Corte | Comprometido | 1º alterável | Restante | Realizado | Falta oficial → sombra | Δ capacidade | Gargalo | Oportunidade no gargalo |
|---|---|---|---|---|---|---|---|---|
| 19/10 M1 | 19/10 M2 | 19/10 M3 | 287.729 | 13.396 | 7.014 → 1.234 | +10.314 | Conector Máq. Autom. › Embalar 5.000 → 0 | 8.507 → 17.007 (+8.500) |
| 19/10 T2 | 19/10 T3 | 20/10 M1 | 261.764 | 39.361 | 29.058 → 7.955 | +44.015 | Conector Máq. Autom. › Embalar 24.000 → 0 | 10.847 → 21.907 (+11.060) |
| 19/10 T3 | 20/10 M1 | 20/10 M2 | 250.281 | 50.844 | 33.940 → 9.275 | +51.000 | Conector Máq. Autom. › Embalar 28.500 → 0 | 13.186 → 18.329 (+5.144) |
| 20/10 M3 | 20/10 T1 | 20/10 T2 | 227.269 | 73.856 | 45.407 → 16.282 | +66.210 | Conector Máq. Autom. › Embalar 35.625 → 0 | 8.109 → 9.749 (+1.639) |
| 20/10 T1 | 20/10 T2 | 20/10 T3 | 218.141 | 82.984 | 45.770 → 16.947 | +68.533 | Conector Máq. Autom. › Embalar 35.625 → 0 | 7.563 → 12.214 (+4.651) |

Resumo das duas semanas:
- **Revezamento duro**: 0 repetições evitadas e 0 peças perdidas (o plano oficial do motor não repete); nas escalas **executadas** apareceram 10 repetições em 22 decisões (12/10) e 5 em 10 (19/10).
- **Feedback da Produção Real** é o que gera quase toda a diferença de capacidade entre oficial e sombra: o oficial não sabe que o restante real é maior do que o planejado e para de alocar pessoas a etapas que ainda têm trabalho; a sombra redistribui.
- **Oportunidade de escala** (capacidade esperada no gargalo, mesmo conjunto de pessoas): 22 de 22 decisões (12/10) e 10 de 10 (19/10) mostraram um melhor plano com ganho > 1%; soma 253.803 e 59.094 peças-esperadas no gargalo, equivalentes a R$ 24.900 e R$ 4.060 em valor de peças. **Leitura prudente**: é uma estimativa por modelo (meta × ritmo), sem validação com a supervisão; parte da diferença vem de postos sem operador/sem material que o modelo não vê (a escala executada tem 4–5 postos `falta_operador` por período). Antes de virar KPI é preciso validar com 2–3 supervisões.
- **Cobertura no horizonte** (pessoas com posto nos períodos alteráveis): 12/10 — oficial 94% no início e caindo para 56–69% nos últimos cortes (o plano acha que a carga acabou e deixa gente ociosa), sombra 90–100%; 19/10 — oficial 77–83%, sombra 80–84% (carga já esgotada).
- Carga adicional/WIP em 19/10 (sugestão da Fase 1 como programada): nenhuma retirada observada, porque o previsto já ocupa a capacidade desde o primeiro corte.
- Saída completa por corte: ver arquivos de saída do protótipo (`saida_2026-10-12.txt`, `saida_2026-10-19.txt`) no diretório de trabalho; não fazem parte do produto.

Limitações: o apontamento sem produto/etapa em `sem_producao`; a escala oficial de 12/10 e 19/10 não existia no banco (usei o plano do motor); a equipe é a da Previsão da semana; ausências só as registradas até o corte; sem WIP real e sem paradas valoradas.

## 11. Decisões que preciso de você

1. **Troca manual × revezamento duro**: bloquear a troca que cria repetição, ou permitir com confirmação + motivo registrado como "exceção ergonômica manual"? (Recomendo: permitir só com motivo e registro; nunca automática.)
2. **Fechamento de período**: 10 min / 90% dos postos / 3 min de quietude / prazo 20 min — confirma?
3. **Horizonte oficial**: manter o oficial como hoje (recalcula do próximo período) durante a sombra e só trocar para `comprometido` depois? (Recomendo sim.)
4. **Performance**: confirmar `f = 1 + n/(n+6) × (obs − 1)`, `obs` limitado a [0,30; 1,30], por **etapa**.
5. **Sem produto/etapa em `sem_producao`**: derivar do plano oficial do período (recomendado, sem mexer na tela de apontamento) ou pedir esse campo no apontamento numa fase futura?
6. **Retenção** dos snapshots (proposta: 12 meses, depois só agregados).

## 12. Sequência proposta (cada passo só em DEV/Preview, com aprovação)

- **4a** Revezamento duro no motor (flag `revezamento_modo`, padrão `duro`) + alerta/motivo + testes.
- **4b** Horizonte `comprometido` no motor (parâmetro) usado só pela sombra.
- **4c** Leitura de Produção Real (agregados por período/pool, ritmo `f`) e atingibilidade de **execução** (planejamento × execução).
- **4d** Migration + trigger agrupado + detecção de fechamento + worker sombra + `escala_sombra_decisoes`/`resultados`.
- **4e** Oportunidade de escala (decisão e avaliação posterior) + tela somente leitura para administrador.
- Testes obrigatórios da diretriz: revezamento (mesma operação em outra máquina/produto bloqueia; M3→T1; dia seguinte permite; sem solução válida não viola), horizonte (M1→M3, M3→T2, T1→T3; passado/atual/próximo idênticos), recuperação (atraso atual expulsa WIP futuro; atraso futuro expulsa adicional; nunca altera comprometido), sombra (não altera oficial; snapshot; mesma entrada = mesmo plano; informação posterior não altera avaliação histórica), escala (detecta melhora de gargalo; ótima = nenhuma oportunidade; nunca solução inválida).

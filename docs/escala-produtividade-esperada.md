# Produtividade esperada por posto e análise meta × real (Escala)

Módulo: `src/features/escala/produtividade.ts` (puro, **não ligado ao motor**). Testes: `src/features/escala/__tests__/produtividade.test.ts` (24).
Reprodução: `scripts/escala-produtividade/backtest.ts` (modos `grade`, `estab`, `queda`) e `tabela.ts` — ambos leem um export SELECT de `apontamentos_producao`.
Dados: PROD, somente SELECT, 08/09 a 28/10/2026 (até ~15h): 2 789 linhas `produzindo` (22 máquinas) e 1 252 `sem_producao`.

## 1. O que os dados dizem (meta × real)

**Granularidade.** Há exatamente UMA linha por (data, período, máquina): produto/etapa/operação/meta daquela máquina naquele período, mais um `funcionario_id` de quem lançou. O apontamento é **por posto**; o funcionário que lança não prova quem operou (nem se houve revezamento no período) — **nenhuma conclusão por pessoa é suportada**, e o estimador nem recebe `funcionarioId`.

**Nível geral.** razão real/meta (quantidade_produzida ÷ meta_periodo_vigente): mediana 100%, média 96,8%, p10 69%, p90 115%. Ponderado por semana: 95, 95, 92, 94, 98, 98, 95, 98% (semanas de 07/09 a 26/10). 21% das linhas têm produzido **exatamente igual à meta** (arredondamento/ancoragem no apontamento) — isso comprime a variabilidade observada e puxa o nível para 100%; tratar o histórico como "teto suave", não como medição fina.
**Refugo:** `quantidade_refugo` é 0 em 100% das linhas — não há sinal de refugo no histórico (boas = produzida). O estimador usa `boas` e passa a refletir refugo quando passar a ser lançado.

**Quem varia: posto ou ruído?** Dentro de cada pool (produto×operação) com ≥2 máquinas de ≥20 observações, a variância *entre máquinas* é 0,1–5% da variância total (ICC 0,001–0,054; maior: Pino, 3%). Quase tudo é ruído período-a-período (autocorrelação lag-1 = 0,09) com um componente de **dia** (ICC posto-dia = 0,27: dias bons/ruins do posto inteiro). Exceções estáveis e acima do ruído: **Rosqueadeira 7** (≈119–120%, Conector 2" e 1.1/4"), **Montagem 20 / Parafusadeira Pino 2** no Pino (≈109–116%, subindo nas semanas 19/10 e 26/10), **Máquina Automática 8** (≈81–88%), **Parafusadeira 11** (87%), **Embalagem 17B** (84%), Rosqueadeira 6 (86%). Nesses a variação é do posto (granularidade suportada); nos demais é ambígua (dia/ruído).

**Efeitos de calendário.** Dia da semana: nenhum (96–97% seg–sex). **Período do dia: o último (t3, 15h40–17h) rende ~12% menos** (mediana 85% vs 100%; ponderado 83% vs 93–101% dos outros). 88% das linhas t3 são lançadas ≥3 min antes do fim (mediana 6 min), mas as 54 linhas t3 lançadas no fim têm a mesma mediana (85%) e, nos outros períodos, as 38 linhas "parciais" não são sistematicamente menores — **a queda é estrutural do fim do dia, não artefato do lançamento antecipado**. Índice (janela de 35 dias, encolhido): m1 1,03; m2 1,02; m3 1,00; t1 1,04; t2 0,99; **t3 0,91**.

**`sem_producao`.** 900 `falta_operador`, 312 `falta_material`, 33 `outro`, 6 `sem_programacao`, 1 manutenção. Não carregam produto/etapa (só a máquina). O período seguinte a um `sem_producao` na mesma máquina rende o mesmo (96,5% vs 96,8%): **não é evidência de lentidão** do posto; fica como contagem de diagnóstico (disponibilidade), fora do fator.

**Achado de qualidade de dados (importante para o motor).** Em 21/10 o roteiro da Caixa Amarela foi reordenado: os `etapa_id` mantiveram a ordem mas **trocaram de operação** (c765eb: Montar Presilha → Etiquetar; f75cc0: Etiquetar → Montar Presilha). 693 apontamentos (25% do histórico, todos Caixa Amarela) têm `operacao_id` ≠ operação atual do `etapa_id`. A operação gravada no apontamento é a executada (e a meta_periodo_vigente é a dela). O `f` atual (por `produto|etapa_id`) mistura Etiquetar com Montar Presilha até 21/10. O estimador casa por **operação** quando `opcoes.operacaoId` é informado (o motor tem `PoolEscala.operacaoId`).

### Tabela por posto (n ≥ 20; razão = produzido ÷ meta; "pond." = Σproduzido/Σmeta; semanas e dia ponderados; fator = estimador **agora** (28/10 ~15h), neutro ao período; t3 = fator para o último período do dia)

| Posto | Produto · operação | n | mediana | p10–p90 | pond. | sem 19/10 | sem 26/10 | 28/10 | fator esperado (IC80) | t3 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| Montagem 19 | Caixa Amarela 4x2 · Montar Presilha | 190 | 100% | 78%–108% | 96% | 94% | 98% | 100% | 99% (96%–102%) | 90% |
| Montagem 18 | Caixa Amarela 4x2 · Montar Presilha | 187 | 100% | 83%–111% | 97% | 101% | 99% | 93% | 99% (97%–102%) | 90% |
| Montagem 20 | Pino · Parafusar (Pino) | 170 | 88% | 64%–121% | 90% | 108% | 122% | 127% | 116% (113%–118%) | 106% |
| Etiquetadora 16 | Caixa Amarela 4x2 · Etiquetar | 168 | 100% | 76%–118% | 98% | 97% | 97% | 97% | 97% (94%–101%) | 89% |
| Parafusadeira 12 | Luva 3/4" · Parafusar | 154 | 100% | 75%–106% | 93% | – | – | – | 94% (92%–97%) | 85% |
| Montagem 18B | Caixa Amarela 4x2 · Montar Presilha | 152 | 100% | 83%–108% | 97% | 99% | 97% | 101% | 100% (98%–103%) | 91% |
| Montagem 19B | Caixa Amarela 4x2 · Montar Presilha | 132 | 100% | 83%–108% | 96% | 92% | 96% | 102% | 99% (96%–101%) | 89% |
| Rosqueadeira 3 | Luva 3/4" · Rosquear | 129 | 100% | 82%–115% | 99% | 111% | – | – | 97% (94%–99%) | 88% |
| Parafusadeira 11 | Luva 3/4" · Parafusar | 129 | 89% | 66%–101% | 87% | – | – | – | 88% (85%–91%) | 82% |
| Etiquetadora 15 | Luva 3/4" · Etiquetar | 110 | 103% | 73%–129% | 102% | 104% | – | – | 101% (98%–104%) | 92% |
| Parafusadeira 10 | Luva 3/4" · Parafusar | 104 | 94% | 69%–103% | 91% | – | – | – | 86% (83%–89%) | 79% |
| Parafusadeira Pino 2 | Plug Macho · Parafusar | 97 | 85% | 62%–117% | 97% | – | – | – | 89% (85%–93%) | 81% |
| Parafusadeira 9 | Luva 3/4" · Parafusar | 96 | 97% | 63%–106% | 90% | – | – | – | 88% (85%–91%) | 82% |
| Rosqueadeira 4 | Luva 3/4" · Rosquear | 93 | 94% | 67%–109% | 91% | – | – | – | 90% (87%–94%) | 83% |
| Maquina Automatica 8 | Conector 3/4" - Maquina Automatica · Rosquear + Parafusar | 87 | 82% | 63%–97% | 81% | 82% | 88% | 99% | 88% (85%–90%) | 80% |
| Embalagem 17 | Luva 3/4" · Embalar | 83 | 100% | 72%–127% | 99% | – | – | – | 103% (100%–106%) | 94% |
| Montagem 14 (Plug) | Plug Macho · Parafusar | 72 | 98% | 70%–117% | 94% | 94% | 93% | 91% | 92% (88%–96%) | 84% |
| Rosqueadeira 5 | Luva 3/4" · Rosquear | 60 | 96% | 65%–114% | 91% | 38% | – | – | 81% (77%–86%) | 74% |
| Rosqueadeira 7 | Conector 2" · Rosquear | 54 | 122% | 87%–159% | 119% | – | – | – | 120% (114%–126%) | 110% |
| Etiquetadora 15 | Conector 3/4" · Etiquetar | 51 | 107% | 69%–121% | 103% | 100% | 105% | 107% | 102% (98%–105%) | 92% |
| Parafusadeira Dupla | Luva 3/4" · Parafusar | 48 | 100% | 63%–122% | 96% | – | – | – | 84% (79%–89%) | 78% |
| Parafusadeira Pino 2 | Pino · Parafusar (Pino) | 40 | 103% | 80%–131% | 115% | 105% | 119% | 102% | 109% (104%–114%) | 100% |
| Embalagem 17 | Conector 3/4" · Embalar | 39 | 104% | 44%–135% | 96% | 90% | 89% | 104% | 90% (82%–98%) | 81% |
| Parafusadeira 12 | Conector 3/4" · Parafusar | 38 | 100% | 57%–108% | 93% | 98% | 92% | 87% | 98% (95%–100%) | 89% |
| Parafusadeira 10 | Conector 3/4" · Parafusar | 36 | 100% | 70%–108% | 91% | 93% | 95% | 104% | 96% (93%–98%) | 87% |
| Rosqueadeira 3 | Conector 3/4" · Rosquear | 31 | 88% | 71%–113% | 90% | 91% | 86% | – | 89% (86%–92%) | 81% |
| Rosqueadeira 6 | Conector 3/4" · Rosquear | 30 | 90% | 63%–100% | 86% | 84% | 89% | 88% | 87% (84%–90%) | 79% |
| Embalagem 17B | Conector 1.1/4" · Embalar | 29 | 79% | 69%–107% | 84% | 77% | 89% | 93% | 90% (85%–94%) | 82% |
| Parafusadeira 9 | Conector 2" · Parafusar | 28 | 100% | 82%–134% | 104% | – | – | – | 100% (98%–103%) | 93% |
| Parafusadeira 10 | Luva 3" · Parafusar | 24 | 89% | 66%–100% | 85% | 69% | – | – | 88% (84%–91%) | 80% |
| Rosqueadeira 7 | Conector 1.1/4" · Rosquear | 21 | 125% | 83%–140% | 118% | 115% | 122% | 124% | 113% (109%–118%) | 103% |
| Parafusadeira 10 | Conector 2" · Parafusar | 20 | 107% | 95%–133% | 109% | – | – | – | 108% (104%–112%) | 98% |
| Rosqueadeira 4 | Luva 3" · Rosquear | 20 | 88% | 78%–100% | 88% | – | – | – | 92% (89%–94%) | 83% |

Nota sobre números citados no pedido: pelos apontamentos, Etiquetadora 16 está em 97% hoje (m1 83%, m2 104%, t1 105%) e na semana; Etiquetadora 15 (Conector 3/4") 107% hoje; Máquina 8 99% hoje (88% na semana); Montagem 20 127% hoje. O valor "84%" da Etiquetadora 16 só aparece como o 1º período de hoje (83%). Os números mudam bastante dentro do dia por causa do ruído período-a-período — e é por isso que nenhum período isolado deve mexer na expectativa.

## 2. Metodologia do estimador

`produtividadeEsperada(historico, produtoId, etapaId, maquinaId, agora, opcoes) → { pecasPorPeriodo, fator, fonte, amostra, intervalo, diagnostico }`

1. **Visão no corte**: só linhas com `lancadoEmMs ≤ agora`.
2. **Quem conta**: `produzindo` com meta > 0, do posto (produto + operação/etapa + máquina). `sem_producao` (falta_operador / falta_material / outro) **não** entra no fator; vira contagem em `diagnostico.semProducao` (por máquina, na janela).
3. **Razão** `boas / meta_periodo_vigente` (a meta *vigente no lançamento*, então mudanças de meta no roteiro — ex.: Pino 1600→2000, Conector 3/4" 3000→3500 — não distorcem), limitada a 2,0.
4. **Peso exponencial por posição** (meia-vida em **observações do posto**, não em dias: robusto a fim de semana/parada). Observações > 45 dias saem (posto parado volta ao nominal).
5. **Outlier**: winsorização em mediana ± 2,5·(1,4826·MAD) ponderadas (escala mínima 0,05).
6. **Nível** = média ponderada das razões winsorizadas; **tamanho efetivo** neff (Kish).
7. **Encolhimento**: `fator = (neff·nível + k·prior)/(neff + k)`, `prior` = nível encolhido do **pool** (produto×operação, todas as máquinas) quando o posto tem menos observações que o pool, senão 1 (nominal).
8. **Período do dia**: razões divididas pelo índice do seu período; fator multiplicado pelo índice do `periodoId` alvo.
9. **Cap** [0,30; 1,30] (idêntico ao `f` de `desempenho.ts`).
10. **Fonte**: `nominal` (n < 3: fator = 1; ou prior de pool se houver, marcado `parcial`), `parcial` (3 ≤ n < 12), `observada` (n ≥ 12). Intervalo ≈ 80% = fator ± 1,28·EP, EP = escala robusta/√neff × peso do dado.
11. **Parcial** (lançado > 10 min antes do fim do período): sinalizado em `diagnostico.parciaisIncluidas`; por padrão **entra** (backtest não achou viés; ver §1), com `parcial:"excluir"|"projetar"` disponíveis.

### Parâmetros e justificativa empírica (backtest §3)

| parâmetro | valor | por quê |
|---|---|---|
| meia-vida | 12 observações (≈ 2–3 dias de um posto ativo) | média simples (∞) é a pior (MAE semanal 0,065 vs 0,053 no teste); 6 reage mais (0,049) mas 1 período ruim derruba 0,033 vs 0,019; 12 é o meio; 20+ demora >12 períodos para refletir queda consistente |
| k (shrinkage) | 6 | plano (3–15 empatam em ±0,002 de MAE); 6 mantém a regra n/(n+6) já em uso no `f`, só que sobre neff |
| winsorização c | 2,5 | c=∞ piora levemente o MAE (+0,001–0,002) e a estabilidade (queda 0,031 vs 0,019 num período ruim); c entre 2 e 3 é equivalente. 2,5 ≈ 2,5σ robustos |
| amostra mínima | 3 | idêntico ao `f` atual (PERF_AMOSTRAS_MINIMAS) |
| amostra cheia | 12 | = meia-vida (peso efetivo ≥ ~1/2 da amostra) |
| idade máxima | 45 dias | 21/45/90 equivalentes (±0,001); 45 cobre ~2 ciclos de roteiro/meta |
| prior | pool | ICC entre máquinas ≤ 5,4% ⇒ o pool explica quase tudo; "nominal" empata no MAE (±0,002) mas dá viés +0,010–0,020 |
| ajuste de período | ligado | remove o viés do t3 (+0,12 → +0,02) sem custo nos demais; MAE geral 0,139→0,132 (treino), neutro no teste |
| parcial | incluir | excluir/incluir/projetar empatam (±0,001) |

A paisagem é **plana** (MAE do período 0,125–0,13 para qualquer configuração razoável) porque o ruído período-a-período domina (σ≈0,18); o que muda o resultado é só (i) não usar média infinita nem última observação, (ii) encolher, (iii) tratar o t3. Não foi inventada constante sem apoio: onde os dados não distinguem (k, c, idade, parcial) manteve-se o valor já usado no sistema ou o ponto médio.

## 3. Backtest (previsão do período seguinte, só com dado anterior)

Treino = alvos até 07/10 (1 662), teste = a partir de 08/10 (1 086). MAE da razão do próximo período; "sem(30)" = erro na média dos 30 períodos seguintes do posto (≈ 1 semana).

| método | MAE treino | MAE teste | MAE semanal teste | viés teste |
|---|---:|---:|---:|---:|
| (a) nominal puro (1,0) | 0,151 | 0,132 | 0,054 | +0,043 |
| (b) **f atual de PROD** (pool×etapa_id, só semana corrente, n/(n+6)) | 0,142 | 0,130 | 0,045 | +0,022 |
| (b2) f acumulado (todo o histórico) | 0,143 | 0,139 | 0,056 | −0,014 |
| (d) média móvel simples do posto | 0,143 | 0,146 | 0,073 | −0,021 |
| (e) última observação | 0,188 | 0,179 | 0,124 | −0,004 |
| **(c) estimador** | **0,139** | **0,130** | 0,053 | +0,002 |

Honestidade: no agregado o ganho sobre o `f` atual é pequeno (MAE 0,142→0,139 treino, igual no teste; no nível semanal o `f` atual da semana corrente foi melhor no teste, 0,045 vs 0,053). O estimador ganha onde o `f` atual não consegue estruturalmente (treino+teste, MAE do período | viés):

| fatia | nominal | f atual | estimador |
|---|---|---|---|
| último período do dia (t3), n=438 | 0,185 \| +0,153 | 0,160 \| +0,122 | **0,134 \| +0,021** |
| demais períodos, n=2 310 | 0,136 \| +0,030 | 0,134 \| +0,002 | 0,130 \| +0,003 |
| seg/ter (o `f` zera na segunda), n=1 054 | 0,137 \| +0,043 | 0,131 \| +0,026 | **0,126 \| −0,002** |
| pools com ≥2 máquinas, n=1 992 | 0,128 \| +0,061 | 0,125 \| +0,023 | **0,119 \| +0,005** |
| pools com 1 máquina, n=756 | 0,184 \| +0,020 | 0,171 \| +0,016 | **0,160 \| +0,008** |

(o `f` atual usa só a semana corrente: com n<3 vale 1 — na segunda de manhã é nominal puro; e superestima o último período do dia em ~12 pontos.)

### Estabilidade: um período ruim não derruba a expectativa
Injetando UM período a 50% da meta (completo, o mais recente) em 388 instantes reais (postos com ≥10 observações): queda média do fator —

| método | 1 período a 0,50 | 3 períodos a 0,70 |
|---|---:|---:|
| última observação | 0,454 (máx 1,11) | 0,254 |
| EWMA α=0,3 sem proteção | 0,138 (máx 0,78) | 0,170 |
| `f` atual (semana corrente) | 0,018 (máx 0,110) | 0,033 |
| **estimador (padrão)** | **0,019 (máx 0,073)** | 0,042 |
| estimador, meia-vida 20 / 6 | 0,013 / 0,033 | 0,029 / 0,071 |
| estimador sem winsorização/shrink | 0,028 (máx 0,076) | 0,044 |

Teste unitário: com 20 períodos a 1,0, um período a 0,4 derruba < 0,05 (fica > 0,95).

### Queda consistente é refletida gradualmente
Série sintética: 24 períodos a 1,0, depois 0,80 constante. Fator após 1 / 3 / 6 / 12 / 24 períodos: **0,993 / 0,980 / 0,964 / 0,880 / 0,854**; ≤0,95 após 10 períodos e ≤0,85 após 27 (≈ 4–5 dias de um posto que trabalha os 6 períodos). A winsorização retarda a 1ª semana (o degrau 0,80 é cortado até a mediana virar) e depois converge; o `f` acumulado leva >40 períodos para chegar a 0,85 (0,943 e 0,911 após 12 e 24).

## 4. Limites e riscos

* **Pessoa não é suportada**: o apontamento é por máquina/posto; `funcionario_id` é quem lançou. Não usar o fator para avaliar pessoas.
* O histórico é curto (7 semanas) e 21% das linhas = meta exata: a incerteza real é maior que o IC reportado.
* Granularidade por posto só vale onde o posto tem amostra e difere do pool (Rosqueadeira 7, Máquina 8, Pino, Parafusadeira 11/Dupla). Nos demais o pool é equivalente.
* Mudanças de roteiro/meta: a razão usa a meta *vigente* do apontamento; troca de **operação por etapa_id** (Caixa Amarela, 21/10) exige casar por `operacaoId`.
* `sem_producao` não tem produto/etapa: a disponibilidade (falta_operador/material) deve ir pelo motor (Parada/ausência), não pelo fator.
* Sem refugo no histórico; quando existir, usar `boas` (já é o que o módulo usa) — o econômico (R$/h) deve usar boas.
* Sazonalidade só por período do dia; sem efeito por dia da semana (não há evidência).
* Índice de período é plantwide (todos os postos); se algum posto tiver padrão próprio no fim do dia (ex.: Pino, t3 ≈ 100%), o ajuste o subestima — ver coluna t3 da tabela.

## 5. Dados de saída para tomada de decisão econômica
`R$/h de recurso = valor_unitário × peças/período esperadas ÷ horas do período`, com `pecasPorPeriodo = fator × meta nominal` (já devolvido quando `metaNominal` é informada). O `intervalo` permite análises de risco.

## 6. Interface para o motor (proposta; o núcleo do fluxo NÃO foi alterado)

Hoje: `fatoresDeDesempenho(entrada, apontamentos, agoraMs)` → `Record<"produto|etapa", number>` por POOL, embutido em `pool.metas[período]` por `embutirFatores`. O motor vê uma meta única por (pool, período) e usa `max` dos pools do nó para capacidade por posto; `capacidadeDaLinha` (avaliar.ts:51), `somarCapacidadeDeLinhas` (simulador.ts:141), avaliar.ts:162 e otimizar.ts:39 / estado.ts:343 multiplicam `pool.metas[período] × ctx.fator[pool]`.

**Fase 1 — sem tocar o núcleo (recomendada primeiro)**: `fatoresParaMotor(historico, pools, periodos, agora)` devolve
* `porPool` — mesma forma que `fatoresDeDesempenho` (drop-in: só pools com fator ≠ 1);
* `porPoolPeriodo[pool][periodoId]` + `embutirFatoresPorPeriodo(pools, porPoolPeriodo)` — embute o fator **por período do dia** em `pool.metas[periodoId]` (a estrutura de metas já é por período). Entrega o ganho do t3 e do estimador estável sem mudar nenhuma função do fluxo;
* `opcoes.fatoresEmbutidos` do Conector legado continua valendo (informar `porPool`).
Impacto: troca de 1 chamada na integração (`planejarComFluxo` recebe entrada com metas embutidas, como hoje); `ObsProdutividade` = `ApontamentoReal` + `fimPeriodoMs?`.

**Fase 2 — fator por máquina (posto) dentro do pool**: `residualPosto["produto|etapa|maquina"]` = fator do posto ÷ fator do pool (≈1; 1 se sem histórico). Contrato novo e opcional em `EntradaEscala`/`CtxFluxo`: `fatorPosto?: Record<string, number>`, com o resíduo multiplicado **por linha** (onde há `maquinaId`): `mu = pool.metas[período] × fator[pool] × (fatorPosto[`k|maq`] ?? 1)`. Pontos de contato (4): `capacidadeDaLinha`, `somarCapacidadeDeLinhas`, avaliar.ts:162, e a escolha de máquina no `gerarEscala`/`matching` (hoje ranqueia máquinas pela meta nominal: com o resíduo passa a preferir o posto que entrega mais — ganho econômico direto). Planejamento por nó (`mu` de otimizar/estado): usar a média ponderada (= `porPool`) — o erro é de 2ª ordem e a avaliação exata por linha corrige. Ausente ⇒ saída byte-idêntica (mesmo padrão dos hooks aditivos do motor). Como o resíduo entre máquinas é pequeno na maioria dos pools (ICC ≤ 5%), a fase 2 só muda decisões onde o posto realmente difere (Rosqueadeira 7, Máquina 8, Pino).

## 7. Como reproduzir
```
npx tsx --tsconfig <tsconfig> scripts/escala-produtividade/backtest.ts <ap.json> grade|estab|queda
npx tsx --tsconfig <tsconfig> scripts/escala-produtividade/tabela.ts <ap.json>
```
`ap.json` = SELECT de `apontamentos_producao` com joins de nomes (campos d, per, hl, pini, pfim, status, mot, pid, eid, oid, mid, qp, qr, meta, mnome, pnome, onome).

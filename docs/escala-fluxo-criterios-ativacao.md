# Critérios de ativação da Escala Inteligente (fluxo) — replay com dados REAIS de PROD (26–27/10/2026)

> Revisor independente e cético. Gerado por `scripts/escala-fluxo-replay/` (harness) a partir de SELECTs em PROD (nada gravado). Núcleo avaliado: `feat/escala-fluxo-core` commit `534bb02`. Configuração dos replays = a do integrador (`feat/escala-fluxo-io › opcoesFluxo`: metas nominais, sem fator de desempenho; `paresLegado` do Conector); `aPartirDe = c+2`. Os números abaixo são reproduzíveis (seção 8) e determinísticos.

## 0. Recomendação

**MANTER EM SOMBRA — NÃO ATIVAR a Escala de amanhã cedo no motor novo.** Critérios com falha: E, H, J. Regra da spec §7: qualquer falha ⇒ permanecer em sombra.

| Critério | Veredito | Números |
|---|---|---|
| **A** Hard constraints (máquina indisponível/inativa/fora da Previsão, ausência, equipe, seleção, roteiro) | **PASSOU** | 36 replays (36 decisões gravadas): verificador independente = 0 violações; `verificarRestricoesDuras` do núcleo = 0; avisos (Parada real da M8 posterior ao corte, logo não conhecível) = 42, todos em fechamentos até 27/10 M1. |
| **B** Passado alterado (planoVigente × saída em períodos ≤ c+1 / iniciados) | **PASSOU** | 0 linhas do passado alteradas em 36 replays (aPartirDe = c+2: c+1 está comprometido/iniciado há 10 min no fechamento). |
| **C** Dupla alocação (pessoa em 2 postos, posto com 2 pessoas, máquina duplicada) | **PASSOU** | 0 violações em 36 replays; Etiquetadora 15 / Embalagem 17 em dois pools no mesmo período: 0. |
| **D** Revezamento (mesma operação em períodos consecutivos do mesmo dia) | **PASSOU** | 0 repetições; exceções novas (`excecaoRevezamento`) sinalizadas: 0. |
| **E** Falta final total: fluxo nunca pior que o oficial (mesmo simulador) | **FALHOU** | Leitura "oficial = motor oficial regenerado": PASSA; leitura operacional "oficial = plano em vigor": FALHA (piora EXPLICADA pela causa raiz abaixo, mas não justificada por restrição dura nem estabilidade). vs motor oficial regenerado: piora em 0/32; vs plano VIGENTE gravado: piora em 3/32; no replay encadeado, pior que o plano herdado do fechamento anterior em 5/12. |
| **F** Caixa Amarela coerente (E16 × Montagem) | **PASSOU (qualitativo)** | Nos 6 fechamentos de 27/10 o plano de fluxo não reduz a E16 (postos ≥ vigente) e acrescenta postos de Montagem quando há WIP estimado a consumir; os contrafactuais manuais do Mikael (+2.071 / −4.016 / −2.657) NÃO foram reproduzidos. |
| **G** Conector legado (pools comuns fundidos sem duplicidade) | **PASSOU (com defeito de campo)** | 2 pools comuns fundidos em 36/36 replays; duplicidade E15/E17: 0; Máquina 8 dentro do teto derivado: sim; campo `demandaComum` incorreto (ver achados). |
| **H** Churn aceitável (linhas e trocas de posto por recálculo) | **FALHOU** | mediana 260 / p90 395 linhas alteradas por recálculo (de ~255–375 futuras); trocas de posto mediana 260 / p90 388; 1º período mutável mediana 6 / p90 14. |
| **I** WIP previsto ≤ teto derivado (nenhum par explode) | **PASSOU** | 0 violações em 216 conferências (pipeline máx. por etapa × ConsumoDownstream + Teto); excesso de WIP no fim da semana: vigente 133.711 × fluxo 48.505 peças (soma nos 10 fechamentos com fluxo). |
| **J** Plano explicável (ANTES/DECISÃO/MOTIVO/DEPOIS em 100% dos replanejamentos) | **FALHOU** | ANTES e DEPOIS completos em 100% dos replays; o resumo agregado de decisões cobre 100% das mudanças contra o plano BASE em 29/29 replays de fluxo (a lista detalhada, truncada em 120 decisões por replay, cobre 48% das mudanças pessoa×período; 0/29 replays totalmente cobertos), mas só 7.153/7.346 (97%) das mudanças contra o plano VIGENTE; 3 replays com plano base mantido mudam o plano vigente (até 416 linhas) com ZERO decisões; 989/3.480 decisões listadas sem ganho/WIP positivo (de 7.206 no total). |

## 1. Método e dados

- **Dados**: 36 decisões gravadas em `escala_sombra_decisoes` da semana 26/10 (entrada canônica completa: pools, funcionários, ausências, indisponibilidades, plano oficial, histórico de equidade, WIP) + 262 linhas de `apontamentos_producao` (todas as da semana, produzindo e sem_producao) + `ocorrencias_maquina`/`escala_recurso_indisponivel`/`ausencias_funcionarios`. Fechamentos reais = 12 (revisão 0: 26/10 M1…T3 e 27/10 M1…T3); as demais 20 decisões (revisões do modo restrito) entram como recálculos extras; 4 revisões gravadas com `c` defasado (corte ≥ fim do período seguinte + 10 min) foram marcadas **obsoletas** e não entram nas contagens de E/J.
- **Sem olhar o futuro**: cada replay usa `agoraMs` = corte gravado e entrega ao núcleo TODOS os apontamentos da semana (inclusive os futuros); só vale o que o núcleo filtra por `lancadoEmMs ≤ agoraMs` (lançamento = `criado_em`, igual ao modo sombra; `hora_lancamento` é idêntica a `criado_em` em 262/262 linhas). Sensibilidade (seção 6) confirma: lançamento atrasado não muda o plano até o relógio avançar.
- **Entrada do motor reconstruída fielmente**: `aPartirDe = c+2` (c+1 está comprometido/iniciado há 10 min no fechamento — mesma regra do horizonte e de `primeiroSlotFuturo`), congeladas = plano vigente ≤ c+1, revezamento duro (PROD: `revezamento_modo = duro`). Validação: nos fechamentos em que o plano vigente era recente, o `gerarEscala` regenerado reproduz o futuro gravado EXATAMENTE (0 linhas de diferença em 20 dos 36 replays); onde difere, o vigente é "velho" (gerado com informação anterior). Golden-master: os **36/36** hashes das decisões gravadas continuam idênticos com o motor modificado pelo núcleo.
- **Régua única**: `avaliarPlano` do núcleo avalia plano vigente, motor oficial regenerado e plano de fluxo. Verificações cruzadas independentes: (i) verificador de restrições escrito do zero (A–D, 10/10 mutações detectadas); (ii) simulador independente (sinal); (iii) régua legada `faltaProjetada`; (iv) auditoria de `estadoDaProducao` contra os apontamentos brutos (228 itens conferidos: boas fechadas, WIP bruto/piso 0/flag negativo, soma do Embalar fundido — 0 divergências fora da projeção do período comprometido); (v) determinismo: cada replay roda 2×, hash do `ResultadoFluxo` inteiro idêntico em 36/36; encadeado 2× idêntico: sim.
- **Backtest do simulador** (WIP previsto pelo plano vigente em i × WIP estimado observado em j > i): 97/330 previsões dentro da faixa observada (29%). Pares: Caixa Amarela 4x2 · Etiquetar→ 3/55 (erro médio 742); Conector 3/4 Conv. · Etiquetar→ 55/55 (erro médio 0); Conector 3/4 Conv. · Parafusar→ 0/55 (erro médio 2.369); Conector 3/4 Conv. · Rosquear→ 15/55 (erro médio 905); Conector 3/4 Autom. · Rosquear + Parafusar→ 3/55 (erro médio 792); Conector 1.1/4" · Rosquear→ 21/55 (erro médio 644). Evidência FRACA de calibração (a execução real diverge do plano: Conector convencional 80% do planejado, M8 60%, Pino 110%), sem falha formal.
- **Desempenho**: `planejarComFluxo` por replay: mediana 359 ms / p90 535 ms (medido com ~8 processos em paralelo ⇒ limite superior; diagnóstico JSON: mediana 287 KB / máx 310 KB).

## 2. Tabela por fechamento (replay no instante do corte; aPartirDe = c+2)

Falta/final = soma dos produtos, cenário pessimista (lo), peças, medidos pelo MESMO `avaliarPlano` (plano vigente gravado × motor oficial regenerado × plano de fluxo). Todos os fechamentos 26–27/10 (revisão 0).

| Fechamento | plano | falta vigente | falta base (motor oficial agora) | falta FLUXO | Δ vs vigente | Δ vs base | final prev. vigente → fluxo | WIP final vig → fluxo | WIP máx. por par vig → fluxo | excesso WIP vig → fluxo | churn linhas (vs vigente) | postos novos vs base | decisões / pessoas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 26/10 M1 | base | 31.087 | 35.187 | 35.187 | 4.100 | 0 | 307.238 → 303.138 | 36.185 → 42.885 | 11.278 → 12.500 | 23.100 → 29.200 | 416 | 0 | 0 / 0 |
| 26/10 M2 | base | 31.544 | 35.644 | 35.644 | 4.100 | 0 | 306.781 → 302.681 | 36.105 → 41.130 | 11.278 → 12.500 | 22.680 → 27.105 | 396 | 0 | 0 / 0 |
| 26/10 M3 | fluxo | 26.127 | 26.127 | 22.317 | -3.810 | -3.810 | 309.648 → 313.458 | 25.259 → 17.424 | 10.589 → 8.000 | 12.564 → 5.400 | 327 | 49 | 326 / 326 |
| 26/10 T1 | fluxo | 26.902 | 26.902 | 24.431 | -2.471 | -2.471 | 308.873 → 311.344 | 25.046 → 22.464 | 9.500 → 14.400 | 11.511 → 13.275 | 261 | 46 | 261 / 261 |
| 26/10 T2 | fluxo | 29.506 | 29.506 | 20.927 | -8.579 | -8.579 | 306.269 → 314.848 | 23.796 → 12.606 | 9.500 → 8.100 | 10.481 → 3.500 | 284 | 38 | 283 / 283 |
| 26/10 T3 | fluxo | 43.285 | 35.735 | 21.924 | -21.361 | -13.811 | 292.490 → 313.851 | 27.226 → 15.120 | 12.171 → 11.000 | 15.921 → 7.000 | 345 | 38 | 276 / 276 |
| 27/10 M1 | fluxo | 32.218 | 32.218 | 23.025 | -9.193 | -9.193 | 303.557 → 312.750 | 19.645 → 11.673 | 9.000 → 9.600 | 8.340 → 5.600 | 241 | 42 | 241 / 241 |
| 27/10 M2 | fluxo | 45.557 | 27.747 | 18.625 | -26.932 | -9.122 | 290.218 → 317.150 | 29.585 → 9.564 | 11.212 → 7.500 | 17.280 → 3.580 | 302 | 44 | 246 / 246 |
| 27/10 M3 | fluxo | 40.747 | 29.180 | 18.447 | -22.300 | -10.733 | 295.028 → 317.328 | 27.803 → 13.483 | 10.322 → 8.000 | 15.498 → 2.850 | 295 | 39 | 235 / 235 |
| 27/10 T1 | fluxo | 40.108 | 26.618 | 15.315 | -24.793 | -11.303 | 295.667 → 320.460 | 30.796 → 7.467 | 12.623 → 8.400 | 16.021 → 390 | 276 | 37 | 222 / 222 |
| 27/10 T2 | fluxo | 41.358 | 26.948 | 19.487 | -21.871 | -7.461 | 294.417 → 316.288 | 30.836 → 13.507 | 13.078 → 10.200 | 15.200 → 2.990 | 262 | 38 | 211 / 211 |
| 27/10 T3 | fluxo | 28.839 | 28.839 | 21.972 | -6.867 | -6.867 | 306.936 → 313.803 | 22.303 → 14.553 | 10.000 → 8.000 | 10.895 → 3.920 | 183 | 33 | 183 / 183 |

### 2.1 Demanda final restante por produto: oficial planejado (Q − Σ créditos congelados do plano vigente) × real (Q − boas confirmadas)

| Fechamento | Caixa Amarela 4x2 | Conector 3/4 Conv. | Conector 3/4 Autom. | Pino | Plug Macho | Conector 1.1/4" |
|---|---|---|---|---|---|---|
| 26/10 M1 | 64.900 × **67.900** | 81.000 × **76.833** | 25.625 × **33.792** | 100.000 × **105.798** | 30.600 × **31.600** | 9.460 × **9.900** |
| 26/10 M2 | 62.100 × **65.100** | 81.000 × **73.568** | 20.625 × **32.357** | 96.000 × **103.867** | 29.400 × **30.300** | 9.090 × **9.640** |
| 26/10 M3 | 59.700 × **61.980** | 81.000 × **69.818** | 16.125 × **30.707** | 92.800 × **98.032** | 28.400 × **29.150** | 6.310 × **6.890** |
| 26/10 T1 | 58.500 × **59.380** | 81.000 × **68.429** | 11.625 × **30.096** | 89.600 × **93.797** | 27.400 × **28.050** | 6.080 × **6.730** |
| 26/10 T2 | 56.100 × **58.360** | 81.000 × **68.429** | 7.125 × **30.096** | 86.400 × **89.842** | 26.400 × **26.950** | 5.850 × **6.510** |
| 26/10 T3 | 53.982 × **56.270** | 81.000 × **68.429** | 2.125 × **30.096** | 81.803 × **86.221** | 25.156 × **26.050** | 5.586 × **6.350** |
| 27/10 M1 | 51.200 × **53.990** | 81.000 × **65.547** | 0 × **28.828** | 78.400 × **81.621** | 24.000 × **25.250** | 5.290 × **6.130** |
| 27/10 M2 | 49.799 × **51.540** | 81.000 × **61.379** | 0 × **26.996** | 73.810 × **76.621** | 22.804 × **24.250** | 5.034 × **5.870** |
| 27/10 M3 | 48.599 × **50.120** | 81.000 × **56.379** | 0 × **24.796** | 70.138 × **71.621** | 21.808 × **23.100** | 4.824 × **5.630** |
| 27/10 T1 | 46.198 × **48.920** | 81.000 × **54.642** | 0 × **24.033** | 70.138 × **67.621** | 20.811 × **22.200** | 4.614 × **5.330** |
| 27/10 T2 | 44.997 × **46.840** | 81.000 × **52.524** | 0 × **23.101** | 66.466 × **67.621** | 19.814 × **21.500** | 4.404 × **5.130** |
| 27/10 T3 | 42.197 × **46.190** | 76.000 × **52.107** | 0 × **22.918** | 62.466 × **63.587** | 18.614 × **20.700** | 4.124 × **4.970** |

Formato: `planejado × real`. Real = demanda final restante R_f = Q_f − boas confirmadas da etapa final (só o CONFIRMADO reduz a meta; conferido contra os apontamentos brutos). **Conector**: as colunas convencional/automática NÃO são comparáveis isoladamente — a fábrica aponta o Embalar (e o Etiquetar) 100% no convencional, então o real do convencional está subestimado e o da automática superestimado; o núcleo funde os pools comuns (seção G).

### 2.2 WIP por par (origem, confiança, lo–hi); NEG = estimativa negativa mesmo no melhor caso (piso 0)

| Fechamento | Caixa Amarela 4x2 · Etiquetar→ | Conector 3/4 Conv. · Etiquetar→ | Conector 3/4 Conv. · Parafusar→ | Conector 3/4 Conv. · Rosquear→ | Conector 3/4 Autom. · Rosquear + Parafusar→ | Conector 1.1/4" · Rosquear→ |
|---|---|---|---|---|---|---|
| 26/10 M1 | est/media 250–250 | est/baixa 0–0 NEG | est/media 266–266 | est/baixa 0–0 NEG | est/baixa 0–0 NEG | est/media 410–410 |
| 26/10 M2 | est/media 50–50 | est/baixa 0–0 NEG | est/media 373–373 | est/baixa 0–0 NEG | est/baixa 0–0 NEG | est/media 850–850 |
| 26/10 M3 | est/baixa 0–0 NEG | est/baixa 0–0 NEG | est/media 2.573–2.573 | est/baixa 0–0 NEG | est/media 746–746 | est/media 1.150–1.150 |
| 26/10 T1 | est/baixa 0–0 NEG | est/baixa 0–0 NEG | est/media 1.446–1.446 | est/baixa 0–0 NEG | est/media 425–425 | est/media 990–990 |
| 26/10 T2 | est/media 721–721 | est/baixa 0–0 NEG | est/media 1.591–1.591 | est/baixa 0–0 NEG | est/media 330–330 | est/media 770–770 |
| 26/10 T3 | est/media 81–81 | est/baixa 0–0 NEG | est/media 2.092–2.092 | est/baixa 0–0 NEG | est/media 194–194 | est/media 610–610 |
| 27/10 M1 | est/baixa 0–0 NEG | est/baixa 0–0 NEG | est/media 2.258–2.258 | est/baixa 0–0 NEG | est/baixa 0–0 NEG | est/media 390–390 |
| 27/10 M2 | est/media 509–509 | est/baixa 0–0 NEG | est/media 2.454–2.454 | est/baixa 0–0 NEG | est/baixa 0–0 NEG | est/media 130–130 |
| 27/10 M3 | est/media 1.639–1.639 | est/baixa 0–0 NEG | est/media 1.947–1.947 | est/baixa 0–0 NEG | est/baixa 0–0 NEG | est/baixa 0–0 NEG |
| 27/10 T1 | est/media 2.778–2.778 | est/baixa 0–0 NEG | est/media 5.697–5.697 | est/baixa 0–0 NEG | est/baixa 0–50 | est/baixa 0–0 NEG |
| 27/10 T2 | est/media 1.698–1.698 | est/baixa 0–0 NEG | est/media 6.502–6.502 | est/baixa 0–0 NEG | est/baixa 0–385 | est/baixa 0–0 NEG |
| 27/10 T3 | est/media 2.963–2.963 | est/baixa 0–0 NEG | est/media 7.483–7.483 | est/baixa 0–0 NEG | est/baixa 0–820 | est/baixa 0–0 NEG |

### 2.3 Gargalo de fluxo por produto (potencial − demanda restante; negativo = gargalo real)

| Fechamento | Caixa Amarela 4x2 | Conector 3/4 Conv. | Conector 3/4 Autom. | Pino | Plug Macho | Conector 1.1/4" |
|---|---|---|---|---|---|---|
| 26/10 M1 | Montar Presilha 150 | Etiquetar -16.625 | — | Parafusar (Pino) -1.798 | Parafusar 200 | Embalar -2.530 |
| 26/10 M2 | Montar Presilha -50 | Etiquetar -15.425 | — | Parafusar (Pino) -3.867 | Parafusar 300 | Embalar -2.550 |
| 26/10 M3 | Etiquetar -1.180 | Etiquetar -13.525 | — | Parafusar (Pino) -3.632 | Parafusar -750 | Embalar -590 |
| 26/10 T1 | Montar Presilha -1.180 | Etiquetar -14.525 | — | Parafusar (Pino) -2.997 | Parafusar -850 | Embalar -660 |
| 26/10 T2 | Montar Presilha -1.360 | Etiquetar -17.525 | — | Parafusar (Pino) -2.242 | Parafusar -750 | Embalar -670 |
| 26/10 T3 | Etiquetar -2.289 | Etiquetar -20.525 | — | Parafusar (Pino) -3.821 | Parafusar -850 | Embalar -740 |
| 27/10 M1 | Etiquetar -2.590 | Etiquetar -19.875 | — | Parafusar (Pino) -2.421 | Parafusar -2.050 | Embalar -850 |
| 27/10 M2 | Etiquetar -4.031 | Etiquetar -17.375 | — | Parafusar (Pino) -1.821 | Parafusar -2.250 | Embalar -1.020 |
| 27/10 M3 | Etiquetar -3.981 | Etiquetar -13.675 | — | Parafusar (Pino) -3.221 | Parafusar -2.300 | Embalar -1.140 |
| 27/10 T1 | Etiquetar -3.842 | Etiquetar -14.175 | — | Parafusar (Pino) -2.821 | Parafusar -2.400 | Embalar -1.070 |
| 27/10 T2 | Etiquetar -5.342 | Etiquetar -14.125 | — | Parafusar (Pino) -1.621 | Parafusar -2.900 | Embalar -1.330 |
| 27/10 T3 | Etiquetar -5.627 | Etiquetar -16.525 | — | Parafusar (Pino) -787 | Parafusar -3.100 | Embalar -1.170 |

### 2.4 Churn por fechamento

O período c+1 está comprometido/em curso no fechamento (0 alterações por construção); o 1º período mutável é c+2.

| Fechamento | plano | linhas alteradas vs vigente (núcleo) | trocas de posto | postos alterados (núcleo) | 1º período mutável | retidas por θ | θ | churn do motor oficial sozinho (base × vigente) | fluxo × base: linhas / postos novos | linhas vs vigente por período mutável (c+2 / c+3 / c+4 / c+5 / c+6…) |
|---|---|---|---|---|---|---|---|---|---|---|
| 26/10 M1 | base | 413 | 407 | 30 | 15 | 0 | 1.570 | 416 linhas / 14 postos | 0 / 0 | 15 / 15 / 12 / 15 / 359 |
| 26/10 M2 | base | 395 | 388 | 19 | 14 | 0 | 1.517 | 396 linhas / 8 postos | 0 / 0 | 14 / 15 / 15 / 13 / 339 |
| 26/10 M3 | fluxo | 326 | 322 | 102 | 6 | 1 | 1.435 | 0 linhas / 0 postos | 327 / 49 | 6 / 11 / 9 / 12 / 289 |
| 26/10 T1 | fluxo | 261 | 261 | 92 | 1 | 0 | 1.389 | 0 linhas / 0 postos | 261 / 46 | 1 / 4 / 3 / 2 / 251 |
| 26/10 T2 | fluxo | 283 | 283 | 76 | 8 | 0 | 1.352 | 0 linhas / 0 postos | 284 / 38 | 8 / 11 / 9 / 6 / 250 |
| 26/10 T3 | fluxo | 287 | 286 | 93 | 6 | 2 | 1.312 | 342 linhas / 39 postos | 276 / 38 | 15 / 15 / 15 / 15 / 285 |
| 27/10 M1 | fluxo | 241 | 241 | 84 | 0 | 1 | 1.249 | 0 linhas / 0 postos | 241 / 42 | 0 / 7 / 6 / 6 / 222 |
| 27/10 M2 | fluxo | 258 | 258 | 94 | 6 | 2 | 1.182 | 289 linhas / 35 postos | 247 / 44 | 13 / 14 / 12 / 13 / 250 |
| 27/10 M3 | fluxo | 255 | 255 | 84 | 6 | 2 | 1.116 | 281 linhas / 36 postos | 236 / 39 | 14 / 14 / 15 / 15 / 237 |
| 27/10 T1 | fluxo | 243 | 243 | 76 | 4 | 2 | 1.082 | 274 linhas / 41 postos | 222 / 37 | 13 / 15 / 15 / 12 / 221 |
| 27/10 T2 | fluxo | 232 | 232 | 82 | 9 | 1 | 1.042 | 257 linhas / 39 postos | 211 / 38 | 15 / 14 / 14 / 13 / 206 |
| 27/10 T3 | fluxo | 183 | 183 | 66 | 0 | 1 | 993 | 0 linhas / 0 postos | 183 / 33 | 0 / 6 / 6 / 6 / 165 |

## 3. Critérios A–J

### A — Hard constraints (máquina indisponível/inativa/fora da Previsão, ausência, equipe, seleção, roteiro): **PASSOU**

36 replays (36 decisões gravadas): verificador independente = 0 violações; `verificarRestricoesDuras` do núcleo = 0; avisos (Parada real da M8 posterior ao corte, logo não conhecível) = 42, todos em fechamentos até 27/10 M1.

Verificador independente escrito do zero a partir de slots/ausências/causas de indisponibilidade/pools (replica as invariantes de `disponibilidade.ts`/`revalidarDisponibilidade.ts`/`rotacao.ts`), validado por teste de mutação (`autoteste-independente.ts`: 10 mutações injetadas, 10 detectadas, 1 caso-limite sem falso positivo; plano do motor oficial = 0 violações). Causas de indisponibilidade = as gravadas em cada snapshot (as que o motor conhecia no corte), mais a Parada real da Máquina 8 (ocorrencias_maquina 27/10 09:34–11:54) conferida à parte como aviso. Violações por tipo: {"A:parada_real_nao_conhecida_pelo_motor*":42}. Observação: chamado com o PLANO COMPLETO (inclui o passado congelado) o verificador do núcleo acusa 229 itens — todos em linhas JÁ congeladas do plano vigente gravado (funcionário depois desativado/ausente registrada depois, Parada da M8 desconhecida na época): informativo, não é do plano de fluxo.

### B — Passado alterado (planoVigente × saída em períodos ≤ c+1 / iniciados): **PASSOU**

0 linhas do passado alteradas em 36 replays (aPartirDe = c+2: c+1 está comprometido/iniciado há 10 min no fechamento).

Medido por `verificarIndependente` (linha da saída em slot < aPartirDe que difere do vigente; congeladas da entrada ≠ vigente). Por construção a saída só contém slots ≥ aPartirDe; o teste de mutação prova que o verificador detecta uma linha de passado alterada. Se o integrador usar aPartirDe = c+1 (leitura literal da spec §4) o plano PODE alterar o período c+1, que no fechamento já começou há 10 min — ver seção 3.1.

### C — Dupla alocação (pessoa em 2 postos, posto com 2 pessoas, máquina duplicada): **PASSOU**

0 violações em 36 replays; Etiquetadora 15 / Embalagem 17 em dois pools no mesmo período: 0.

Pessoa com >1 linha no mesmo período, máquina com >1 pessoa, máquina em >1 pool do mesmo período (inclui os pools do Conector que compartilham E15/E17).

### D — Revezamento (mesma operação em períodos consecutivos do mesmo dia): **PASSOU**

0 repetições; exceções novas (`excecaoRevezamento`) sinalizadas: 0.

Inclui o par que atravessa a fronteira (último congelado → primeiro mutável). PROD usa revezamento_modo = duro (parâmetro conferido), logo o motor não tem exceção: qualquer linha com excecaoRevezamento seria nova.

### E — Falta final total: fluxo nunca pior que o oficial (mesmo simulador): **FALHOU**

Leitura "oficial = motor oficial regenerado": PASSA; leitura operacional "oficial = plano em vigor": FALHA (piora EXPLICADA pela causa raiz abaixo, mas não justificada por restrição dura nem estabilidade). vs motor oficial regenerado: piora em 0/32; vs plano VIGENTE gravado: piora em 3/32; no replay encadeado, pior que o plano herdado do fechamento anterior em 5/12.

A garantia do núcleo é "nunca pior que o plano base" (`gerarEscala` regenerado, que é um candidato). Isso NÃO equivale a "nunca pior que o plano em vigor":

Piora vs vigente gravado (replay por fechamento):
- 26/10 M1: vigente 31.087 · base 35.187 · fluxo 35.187 (+4.100 vs vigente; +0 vs base)
- 26/10 M1 (rev 1): vigente 31.087 · base 35.187 · fluxo 35.187 (+4.100 vs vigente; +0 vs base)
- 26/10 M2: vigente 31.544 · base 35.644 · fluxo 35.644 (+4.100 vs vigente; +0 vs base)

Piora no replay encadeado (plano de fluxo herdado × novo plano de fluxo, mesmo corte, mesmo simulador):
- 10-26 m1: herdado 31.087 → novo 35.187 (+4.100; 13.2%)
- 10-27 m1: herdado 20.505 → novo 22.097 (+1.592; 7.8%)
- 10-27 m3: herdado 16.693 → novo 19.494 (+2.801; 16.8%)
- 10-27 t1: herdado 17.483 → novo 17.930 (+447; 2.6%)
- 10-27 t3: herdado 20.237 → novo 20.899 (+662; 3.3%)

Explicação: o plano base regenerado pode ser pior que o vigente (o motor oficial é sensível à ordem/equidade; 26/10 M1: base 35.187 × vigente 31.087 (+13.2%); 26/10 M2: base 35.644 × vigente 31.544 (+13.0%)) e o candidato de fluxo só é comparado ao base; o plano em vigor nunca é candidato. Verificação cruzada da régua: o simulador independente (`simIndependente.ts`, escrito só da spec, sem fusão do Conector) concorda no SINAL da melhora em 29/29 replays em que o fluxo foi escolhido; a régua LEGADA (`faltaProjetada`, exige cumprir o previsto de TODAS as etapas) discorda em 17/29 — por construção (o fluxo deixa de produzir intermediário sem utilidade), mas significa que o previsto das etapas intermediárias fica mais incompleto na tela atual.

### F — Caixa Amarela coerente (E16 × Montagem): **PASSOU (qualitativo)**

Nos 6 fechamentos de 27/10 o plano de fluxo não reduz a E16 (postos ≥ vigente) e acrescenta postos de Montagem quando há WIP estimado a consumir; os contrafactuais manuais do Mikael (+2.071 / −4.016 / −2.657) NÃO foram reproduzidos.

Postos de E16 / Montagem (soma nos períodos mutáveis) e peças planejadas:

| Fechamento 27/10 | WIP E16→Montagem | postos E/M vigente | postos E/M fluxo | peças E/M vigente | peças E/M fluxo |
|---|---|---|---|---|---|
| 27/10 M1 | est/baixa 0–0 NEG | 21 / 77 | 21 / 77 | 48.900 / 49.600 | 49.200 / 49.500 |
| 27/10 M2 | est/media 509–509 | 19 / 75 | 21 / 78 | 44.239 / 48.124 | 48.531 / 50.140 |
| 27/10 M3 | est/media 1.639–1.639 | 18 / 73 | 20 / 76 | 42.052 / 46.923 | 46.281 / 48.900 |
| 27/10 T1 | est/media 2.778–2.778 | 17 / 69 | 19 / 72 | 39.865 / 44.522 | 43.942 / 46.520 |
| 27/10 T2 | est/media 1.698–1.698 | 16 / 67 | 18 / 70 | 37.677 / 43.321 | 42.300 / 45.500 |
| 27/10 T3 | est/media 2.963–2.963 | 15 / 62 | 17 / 66 | 35.100 / 40.200 | 39.800 / 42.600 |

Contrafactuais pelo MESMO simulador (final entregue de Caixa Amarela, peças; variantes aplicadas a TODOS os slots mutáveis):

| Fechamento | WIP E16→Mont. | vigente | base | reforço Montagem mantendo E16 | sem E16 | FLUXO |
|---|---|---|---|---|---|---|
| 10-26 m1 | media 250–250 | 69.850 | 69.250 | 64.250 | 12.550 | 69.250 |
| 10-27 m1 | baixa 0–0 | 67.410 | 67.410 | 60.610 | 19.610 | 68.210 |
| 10-27 m2 | media 509–509 | 66.469 | 66.469 | 62.069 | 21.969 | 70.500 |
| 10-27 m3 | media 1.639–1.639 | 66.519 | 66.519 | 63.319 | 24.219 | 70.419 |
| 10-27 t1 | media 2.778–2.778 | 66.658 | 66.658 | 63.458 | 26.558 | 70.500 |
| 10-27 t2 | media 1.698–1.698 | 65.458 | 64.358 | 61.058 | 27.558 | 69.658 |
| 10-27 t3 | media 2.963–2.963 | 64.073 | 64.073 | 60.773 | 29.773 | 69.573 |

Leitura cética: (1) o simulador valoriza a E16 como gargalo (folga negativa em todos os fechamentos) — "reforçar Montagem" por prioridade puxa pessoas da E16 e PIORA o final da Caixa Amarela (contra o +2.071 observado manualmente em 27/10 com outro desenho de contrafactual — não consegui reproduzir esse número; as variantes aqui são mais agressivas); (2) desligar a E16 derruba o final em ~40 mil peças, ordem de grandeza diferente dos −4.016/−2.657 citados (aqueles eram de 3 slots); (3) o plano de fluxo é igual ou melhor que TODAS as variantes em 6/7 cortes (nos demais o plano base foi mantido e fica abaixo do vigente), mas só pelo simulador — não há contrafactual real. Os estoques E16→Montagem são ESTIMADOS (sem saldo confirmado em PROD): 0 / 509 / 1.639 / 2.778 / 1.698 / 2.963 peças.

### G — Conector legado (pools comuns fundidos sem duplicidade): **PASSOU (com defeito de campo)**

2 pools comuns fundidos em 36/36 replays; duplicidade E15/E17: 0; Máquina 8 dentro do teto derivado: sim; campo `demandaComum` incorreto (ver achados).

Nos 10 fechamentos em que o fluxo foi escolhido, as linhas de Etiquetar/Embalar saem 100% no produto convencional (linhas de Etiquetar/Embalar da AUTOMÁTICA: 0, contra 113 no plano vigente) — coerente com o que a fábrica realmente aponta (Embalar: real 35.600 no convencional × plano 0; automática: plano 49.125 × real 0).

Etiquetadora 15 (atende Etiquetar convencional e automática — demanda restante das duas etapas × capacidade futura da máquina, meta nominal):

| Fechamento | demanda restante REAL (Q − boas) | capacidade futura E15 | déficit real | demanda legada (Q − créditos planejados) | períodos com E15 ocupada: vigente → fluxo (de N) |
|---|---|---|---|---|---|
| 26/10 M1 | 112.832 | 94.000 | 18.832 | 109.625 | 28 → 28 (de 28) |
| 26/10 M2 | 108.667 | 90.500 | 18.167 | 106.125 | 27 → 27 (de 27) |
| 26/10 M3 | 108.667 | 87.000 | 21.667 | 103.125 | 26 → 26 (de 26) |
| 26/10 T1 | 105.317 | 84.000 | 21.317 | 100.125 | 25 → 25 (de 25) |
| 26/10 T2 | 102.286 | 81.000 | 21.286 | 97.125 | 24 → 24 (de 24) |
| 26/10 T3 | 99.551 | 78.000 | 21.551 | 93.481 | 23 → 23 (de 23) |
| 27/10 M1 | 95.543 | 74.500 | 21.043 | 90.125 | 22 → 22 (de 22) |
| 27/10 M2 | 92.442 | 71.000 | 21.442 | 86.483 | 21 → 21 (de 21) |
| 27/10 M3 | 87.680 | 67.500 | 20.180 | 83.361 | 20 → 20 (de 20) |
| 27/10 T1 | 87.680 | 64.500 | 23.180 | 80.240 | 19 → 19 (de 19) |
| 27/10 T2 | 84.880 | 61.500 | 23.380 | 77.118 | 18 → 18 (de 18) |
| 27/10 T3 | 83.038 | 58.500 | 24.538 | 73.618 | 17 → 17 (de 17) |

No fechamento de 27/10 T2 a demanda restante real do Etiquetar é 84.880 contra 61.500 de capacidade da E15 (déficit 23.380) — reproduz o "84.880 × 61.500" citado. A E15 é o gargalo de fluxo do Conector convencional (Etiquetar com folga negativa) em 12/12 fechamentos e fica ocupada em TODOS os períodos mutáveis tanto no vigente quanto no fluxo (o fluxo não esconde nem agrava o déficit). O legado (créditos planejados) subestima a demanda em 7.762 peças nesse corte. `demandaComum` devolvido pelo núcleo é sempre 116.625 (= Q_conv + Q_auto fixo): NÃO desconta as boas (contrato: R_f,total = Q_conv + Q_auto − boas) — o defeito é só no campo de diagnóstico (a demanda do motor, `remFluxo`, sai correta), mas se for persistido induz a erro.

### H — Churn aceitável (linhas e trocas de posto por recálculo): **FALHOU**

mediana 260 / p90 395 linhas alteradas por recálculo (de ~255–375 futuras); trocas de posto mediana 260 / p90 388; 1º período mutável mediana 6 / p90 14.

| Métrica (12 fechamentos) | mediana | p90 | máx |
|---|---|---|---|
| linhas alteradas vs vigente (núcleo) | 260 | 395 | 413 |
| trocas de posto vs vigente | 260 | 388 | 407 |
| alteradas no 1º período mutável | 6 | 14 | 15 |
| linhas fluxo × base regenerado (churn ATRIBUÍVEL ao fluxo) | 239 | 284 | 327 |
| postos (slot×máquina×pool) novos vs base | 38 | 46 | 49 |
| linhas base regenerado × vigente (churn do motor oficial sozinho) | 266 | 396 | 416 |

O motor oficial não tem estabilidade ("mesmas entradas, mesma escala"): quase toda linha futura muda de pessoa a cada recálculo, e o plano de fluxo herda isso e acrescenta postos novos (mediana 38 por recálculo). Hoje, em PROD, o modo restrito aplica `estabilizarPessoas` (mantém a pessoa no mesmo posto); o caminho de fluxo NÃO. **Teste da mitigação** (reutilizar `estabilizarPessoas` sobre o plano de fluxo; mesmos postos, mesma falta, 0 violações): linhas alteradas 10-26 m1: 416→70; 10-26 m2: 396→63; 10-26 m3: 327→69; 10-26 t1: 261→60; 10-26 t2: 284→52; 10-26 t3: 345→345; 10-27 m1: 241→49; 10-27 m2: 302→244; 10-27 m3: 295→229; 10-27 t1: 276→219; 10-27 t2: 262→208; 10-27 t3: 183→44. Reduz ≥ 50% em 7/12 fechamentos; nos demais as mudanças são de postos de verdade (produtivas ≈ linhas). **Varredura de θ** (seção 4): efeito pequeno e em degraus — θ=0: falta Σ12 272.872, 1º período mutável mediana 8 linhas, total mediana 265; θ padrão (≈1,0–1,6 mil peças): falta Σ12 277.301 (+4.429, 1.6%), 1º período mediana 6, total mediana 260. A retenção por θ custa falta e quase não reduz o churn; o churn está nas PESSOAS.

### I — WIP previsto ≤ teto derivado (nenhum par explode): **PASSOU**

0 violações em 216 conferências (pipeline máx. por etapa × ConsumoDownstream + Teto); excesso de WIP no fim da semana: vigente 133.711 × fluxo 48.505 peças (soma nos 10 fechamentos com fluxo).

Máximo de WIP (hi) previsto por par ao longo da semana, entre todos os replays:

| par (origem →) | máx. WIP previsto |
|---|---|
| Conector 3/4 Conv. · Rosquear→ | 14.400 |
| Conector 3/4 Conv. · Etiquetar→ | 14.000 |
| Conector 3/4 Conv. · Parafusar→ | 11.278 |
| Conector 3/4 Autom. · Rosquear + Parafusar→ | 5.022 |
| Conector 1.1/4" · Rosquear→ | 3.980 |
| Caixa Amarela 4x2 · Etiquetar→ | 3.600 |

Nos 2 primeiros fechamentos (plano base mantido) o excesso do base (29.200) é MAIOR que o do vigente (23.100).

### J — Plano explicável (ANTES/DECISÃO/MOTIVO/DEPOIS em 100% dos replanejamentos): **FALHOU**

ANTES e DEPOIS completos em 100% dos replays; o resumo agregado de decisões cobre 100% das mudanças contra o plano BASE em 29/29 replays de fluxo (a lista detalhada, truncada em 120 decisões por replay, cobre 48% das mudanças pessoa×período; 0/29 replays totalmente cobertos), mas só 7.153/7.346 (97%) das mudanças contra o plano VIGENTE; 3 replays com plano base mantido mudam o plano vigente (até 416 linhas) com ZERO decisões; 989/3.480 decisões listadas sem ganho/WIP positivo (de 7.206 no total).

As decisões descrevem o fluxo contra o plano BASE (`de` = base), não contra o plano em vigor que o supervisor vê. Onde o base difere do vigente (reshuffle do motor oficial) a mudança fica sem explicação; onde o base foi mantido (26/10 M1/M2) a diagnóstico é só "PLANO_BASE_MANTIDO" enquanto o plano em vigor muda 416 linhas. Além disso há 7.206 decisões (uma por grupo posto×slot; detalhe limitado a 120 por replay + resumo por pool) com `ganhoProdutoFinal` não aditivo (soma 1.113.771 peças contra melhora real de ~376.325 no conjunto): explicável por máquina, não legível por humano.

Amostra de decisões (27/10 T3): 
- m3: troca de posto; ganho estimado -2000 peça(s) final(is)
- m3: troca de posto; ganho estimado 787 peça(s) final(is)
- m3: troca de posto; ganho estimado 530 peça(s) final(is); evita ~2000 de WIP excedente

#### 3.1 Variante aPartirDe = c+1 (spec §4 lida literalmente)

Se o integrador chamar o núcleo com aPartirDe = c+1, o plano de fluxo altera o período c+1 — que no fechamento já está em curso há 10 min: linhas alteradas no 1º período mutável por fechamento = 15, 15, 2, 2, 1, 15, 4, 13, 13, 14, 13, 0 (mediana 13). Isso viola B ("período em andamento congelado"). Recomendação: aPartirDe = c+2 (como no replay principal).
## 4. θ — varredura (churn × falta)

| θ | falta Σ12 fechamentos (lo) | linhas med / p90 | trocas med / p90 | 1º período med / p90 | plano base / fluxo |
|---|---|---|---|---|---|
| 0 | 272.872 | 265 / 395 | 265 / 388 | 8 / 14 | 2 / 10 |
| 0.01 | 276.880 | 260 / 395 | 260 / 388 | 6 / 14 | 2 / 10 |
| 100 | 276.880 | 260 / 395 | 260 / 388 | 6 / 14 | 2 / 10 |
| 1000 | 277.301 | 260 / 395 | 260 / 388 | 6 / 14 | 2 / 10 |
| 5000 | 277.301 | 260 / 395 | 260 / 388 | 6 / 14 | 2 / 10 |
| padrao | 277.301 | 260 / 395 | 260 / 388 | 6 / 14 | 2 / 10 |

Leitura: θ opera em degraus pequenos (a retenção do posto vigente no 1º período mutável compete com o valor marginal). θ=0: falta Σ12 272.872, 1º período mutável mediana 8 linhas, total mediana 265; θ padrão (≈1,0–1,6 mil peças): falta Σ12 277.301 (+4.429, 1.6%), 1º período mediana 6, total mediana 260. A retenção por θ custa falta e quase não reduz o churn; o churn está nas PESSOAS. **Não existe θ que reduza o churn sem piorar a falta**: toda retenção custa peças finais. Combinação testada com a re-atribuição de pessoas (`estabilizarPessoas`, mesma falta, 0 violações): θ=0 + estabilização → falta Σ12 272.872, linhas alteradas no 1º período mutável Σ 71, total Σ 1.656; θ padrão + estabilização → falta Σ12 277.301, 1º período Σ 68, total Σ 1.652. **θ proposto: θ = 0 (sem retenção) + estabilização de pessoas** — a estabilização, e não θ, é o que reduz o churn.

## 5. Replay completo da semana (fluxo ativo desde o 1º recálculo)

Cada fechamento parte do passado gravado até c e do plano de FLUXO produzido no fechamento anterior de c+1 em diante. Compara a falta (lo) do plano gravado, do plano herdado e do novo plano de fluxo, e o churn entre planos consecutivos.

| Fechamento | plano | oficial gravado | herdado (fluxo anterior) | novo fluxo | novo − herdado | churn linhas fluxo (vs anterior) | churn linhas oficial (vs anterior) |
|---|---|---|---|---|---|---|---|
| 10-26 m1 | base | 31.087 | 31.087 | 35.187 | +4.100 | — | — |
| 10-26 m2 | base | 31.544 | 35.644 | 35.644 | +0 | 0 | 0 |
| 10-26 m3 | fluxo | 26.127 | 28.717 | 23.317 | -5.400 | 350 | 353 |
| 10-26 t1 | fluxo | 26.902 | 22.982 | 22.452 | -530 | 309 | 255 |
| 10-26 t2 | fluxo | 29.506 | 25.556 | 20.360 | -5.196 | 306 | 0 |
| 10-26 t3 | fluxo | 43.285 | 23.233 | 20.755 | -2.478 | 289 | 338 |
| 10-27 m1 | fluxo | 32.218 | 20.505 | 22.097 | +1.592 | 273 | 324 |
| 10-27 m2 | fluxo | 45.557 | 19.866 | 18.386 | -1.480 | 269 | 241 |
| 10-27 m3 | fluxo | 40.747 | 16.693 | 19.494 | +2.801 | 242 | 0 |
| 10-27 t1 | fluxo | 40.108 | 17.483 | 17.930 | +447 | 223 | 0 |
| 10-27 t2 | fluxo | 41.358 | 19.526 | 18.380 | -1.146 | 229 | 0 |
| 10-27 t3 | fluxo | 28.839 | 20.237 | 20.899 | +662 | 197 | 242 |

Soma da falta ao longo dos 12 fechamentos: oficial gravado 417.278 · fluxo encadeado 274.901.

## 6. Sensibilidade e robustez

44/44 casos OK (sem exceção, sem WIP negativo exposto, entrada/dados NÃO mutados, JSON serializável, determinismo, 0 violações duras). Cada cenário de dados foi aplicado a 3 fechamentos (27/10 T1, 26/10 T1, 27/10 M3).

| Caso | OK | diagnósticos relevantes / faltas |
|---|---|---|
| 10-27 t1 · controle (dados reais) | OK | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta fluxo 15.315/15.315 base 26.618/26.618 |
| 10-27 t1 · sem apontamento no período c | OK | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×8 · falta fluxo 25.768/13.878 base 38.908/23.891 |
| 10-27 t1 · sem apontamento nos 2 últimos períodos fechados | OK | PRODUCAO_NAO_CONFIRMADA×20 · falta fluxo 48.111/12.749 base 54.356/22.958 |
| 10-27 t1 · sem NENHUM apontamento | OK | PRODUCAO_NAO_CONFIRMADA×22 · falta fluxo 143.475/9.478 base 143.475/9.478 |
| 10-27 t1 · apontamento do período c atrasado (chega 90 min depois) | OK | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×8 · falta fluxo 25.768/13.878 base 38.908/23.891 |
| 10-27 t1 · apontamento atrasado COM relógio avançado (agora = corte + 120 min) | OK | PRODUCAO_NAO_CONFIRMADA×2 AJUSTE_TARDIO×20 WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta fluxo 19.007/19.007 base 27.868/27.868 |
| 10-27 t1 · lançamento tardio do período c−1 (chega depois do fechamento) | OK | PRODUCAO_NAO_CONFIRMADA×2 AJUSTE_TARDIO×18 WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta fluxo 15.315/15.315 base 26.618/26.618 |
| 10-27 t1 · refugo > produzido na etapa final (boas negativas brutas) | OK | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×8 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta fluxo 24.187/24.187 base 36.657/36.657 |
| 10-27 t1 · saldo negativo: etapa seguinte aponta 5× mais que a anterior | OK | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×8 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta fluxo 910/910 base 7.101/7.101 |
| 10-27 t1 · apontamento em máquina fora do plano | OK | PRODUCAO_NAO_CONFIRMADA×4 WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta fluxo 15.315/14.915 base 26.618/25.621 |
| 10-27 t1 · todos sem_producao falta_material no período c | OK | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×8 SEM_PRODUCAO_FALTA_MATERIAL×32 · falta fluxo 24.187/24.187 base 36.657/36.657 |
| 10-27 t1 · motivo sem_programacao (valor real fora da spec) | OK | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×6 · falta fluxo 15.315/15.315 base 26.618/26.618 |
| 10-26 t1 · controle (dados reais) | OK | WIP_NEGATIVO_ESTIMADO×6 · falta fluxo 24.431/24.431 base 26.902/26.902 |
| 10-26 t1 · sem apontamento no período c | OK | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×4 · falta fluxo 30.983/17.137 base 37.178/24.907 |
| 10-26 t1 · sem apontamento nos 2 últimos períodos fechados | OK | PRODUCAO_NAO_CONFIRMADA×22 · falta fluxo 47.852/12.534 base 54.042/23.324 |
| 10-26 t1 · sem NENHUM apontamento | OK | PRODUCAO_NAO_CONFIRMADA×22 · falta fluxo 77.785/10.265 base 77.785/10.265 |
| 10-26 t1 · apontamento do período c atrasado (chega 90 min depois) | OK | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×4 · falta fluxo 30.983/17.137 base 37.178/24.907 |
| 10-26 t1 · apontamento atrasado COM relógio avançado (agora = corte + 120 min) | OK | AJUSTE_TARDIO×20 WIP_NEGATIVO_ESTIMADO×4 · falta fluxo 18.147/18.147 base 29.506/29.506 |
| 10-26 t1 · lançamento tardio do período c−1 (chega depois do fechamento) | OK | AJUSTE_TARDIO×22 WIP_NEGATIVO_ESTIMADO×6 · falta fluxo 24.431/24.431 base 26.902/26.902 |
| 10-26 t1 · refugo > produzido na etapa final (boas negativas brutas) | OK | WIP_NEGATIVO_ESTIMADO×6 · falta fluxo 25.853/25.853 base 36.837/36.837 |
| 10-26 t1 · saldo negativo: etapa seguinte aponta 5× mais que a anterior | OK | WIP_NEGATIVO_ESTIMADO×6 · falta fluxo 5.597/5.597 base 5.597/5.597 |
| 10-26 t1 · apontamento em máquina fora do plano | OK | PRODUCAO_NAO_CONFIRMADA×4 WIP_NEGATIVO_ESTIMADO×6 · falta fluxo 24.431/23.434 base 26.902/24.702 |
| 10-26 t1 · todos sem_producao falta_material no período c | OK | WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_FALTA_MATERIAL×30 · falta fluxo 25.853/25.853 base 36.837/36.837 |
| 10-26 t1 · motivo sem_programacao (valor real fora da spec) | OK | WIP_NEGATIVO_ESTIMADO×6 · falta fluxo 24.431/24.431 base 26.902/26.902 |
| 10-27 m3 · controle (dados reais) | OK | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×8 · falta fluxo 18.447/18.447 base 29.180/29.180 |
| 10-27 m3 · sem apontamento no período c | OK | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×4 · falta fluxo 30.376/17.133 base 47.776/29.709 |
| 10-27 m3 · sem apontamento nos 2 últimos períodos fechados | OK | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×2 · falta fluxo 57.221/18.990 base 62.486/27.075 |
| 10-27 m3 · sem NENHUM apontamento | OK | PRODUCAO_NAO_CONFIRMADA×22 · falta fluxo 136.895/9.488 base 136.895/9.488 |
| 10-27 m3 · apontamento do período c atrasado (chega 90 min depois) | OK | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×4 · falta fluxo 30.376/17.133 base 47.776/29.709 |
| 10-27 m3 · apontamento atrasado COM relógio avançado (agora = corte + 120 min) | OK | PRODUCAO_NAO_CONFIRMADA×2 AJUSTE_TARDIO×18 WIP_NEGATIVO_ESTIMADO×8 · falta fluxo 18.447/18.447 base 29.180/29.180 |
| 10-27 m3 · lançamento tardio do período c−1 (chega depois do fechamento) | OK | PRODUCAO_NAO_CONFIRMADA×2 AJUSTE_TARDIO×18 WIP_NEGATIVO_ESTIMADO×8 · falta fluxo 18.447/18.447 base 29.180/29.180 |
| 10-27 m3 · refugo > produzido na etapa final (boas negativas brutas) | OK | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×4 · falta fluxo 30.677/30.677 base 44.683/44.637 |
| 10-27 m3 · saldo negativo: etapa seguinte aponta 5× mais que a anterior | OK | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×10 · falta fluxo 880/880 base 7.971/7.971 |
| 10-27 m3 · apontamento em máquina fora do plano | OK | PRODUCAO_NAO_CONFIRMADA×4 WIP_NEGATIVO_ESTIMADO×8 · falta fluxo 18.447/18.147 base 29.180/27.984 |
| 10-27 m3 · todos sem_producao falta_material no período c | OK | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×4 SEM_PRODUCAO_FALTA_MATERIAL×28 · falta fluxo 30.677/30.677 base 44.683/44.637 |
| 10-27 m3 · motivo sem_programacao (valor real fora da spec) | OK | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×8 · falta fluxo 18.447/18.447 base 29.180/29.180 |
| desligado · golden-master: 36/36 decisões reproduzem hash gravado (motor modificado pelo núcleo) | OK |  36/36 |
| desligado · gerarEscala com hooks undefined explícitos == sem os campos (todos os cenários) | OK |  |
| desligado · hooks vazios ({}) não alteram o plano (remPorPool/ordemPostos/bonus vazios) | OK |  |
| entrada degenerada: aPartirDe = fim da semana (nada mutável) | OK |  |
| entrada degenerada: sem pools | OK |  |
| entrada degenerada: sem funcionários | OK |  |
| entrada degenerada: quantidade prevista 0 em todos os pools | OK |  |
| estadoDaProducao isolado em todos os cortes (sem lançar) | OK |  |

Observações: (1) sem NENHUM apontamento a falta pessimista é enorme (lo) e a otimista pequena (hi) — a faixa é honesta e o plano base é mantido; (2) o piso 0 aparece com `WIP_NEGATIVO_ESTIMADO` e nenhum par exposto é negativo; (3) o motivo real `sem_programacao` (6 linhas em PROD) não existe na spec: o núcleo o aceita sem quebrar, mas sem diagnóstico próprio; (4) `desligado`: o núcleo não lê a flag — "desligado" = o chamador não usa o fluxo; provado que `gerarEscala` sem hooks (ou com hooks vazios) é byte-idêntico e que as 36 decisões gravadas reproduzem o hash.

### 6.1 Fator de desempenho f (metas × f)

O integrador (`feat/escala-fluxo-io › opcoesFluxo`) chama o núcleo SÓ com `paresLegado` e θ: metas NOMINAIS, f = 1 — este é o cenário principal deste relatório. O modo sombra usa f (Conector convencional 0,8, M8 0,6, Pino 1,1 no realizado). Reexecução dos 12 fechamentos com f aplicado (`FREPLAY_FATOR=1`):

| Fechamento | Δ fluxo−vigente (f=1) | Δ fluxo−vigente (com f) | plano (f=1 / com f) | violações A–D (com f) |
|---|---|---|---|---|
| 26/10 M1 | 4.100 | 3.403 | base / base | 0 |
| 26/10 M2 | 4.100 | 3.402 | base / base | 0 |
| 26/10 M3 | -3.810 | 0 | fluxo / base | 0 |
| 26/10 T1 | -2.471 | 0 | fluxo / base | 0 |
| 26/10 T2 | -8.579 | -8.771 | fluxo / fluxo | 0 |
| 26/10 T3 | -21.361 | -9.371 | fluxo / fluxo | 0 |
| 27/10 M1 | -9.193 | -11.151 | fluxo / fluxo | 0 |
| 27/10 M2 | -26.932 | -14.908 | fluxo / fluxo | 0 |
| 27/10 M3 | -22.300 | -14.617 | fluxo / fluxo | 0 |
| 27/10 T1 | -24.793 | -13.598 | fluxo / fluxo | 0 |
| 27/10 T2 | -21.871 | -16.930 | fluxo / fluxo | 0 |
| 27/10 T3 | -6.867 | -7.713 | fluxo / fluxo | 0 |

Com f=1 o simulador superestima a capacidade de etapas que rendem abaixo da meta (Conector, M8), logo os ganhos previstos pelo fluxo são otimistas na mesma proporção; a conclusão qualitativa (melhora vs vigente, mesmas falhas E/H/J) não depende de f.

## 7. Achados que contradizem a spec / bugs do núcleo

1. **"Nunca pior" só vale contra o base regenerado, não contra o plano em vigor** (`planejar.ts`: candidatos elegíveis = `faltaFinalLo ≤ avBaseLeve`; o plano vigente não é candidato). Repro: replay encadeado — 10-26 m1 (+4.100, 13.2%); 10-27 m1 (+1.592, 7.8%); 10-27 m3 (+2.801, 16.8%); 10-27 t1 (+447, 2.6%); 10-27 t3 (+662, 3.3%) — e fechamentos 26/10 M1 (base regenerado 13.2% pior que o vigente gravado); 26/10 M2 (base regenerado 13.0% pior que o vigente gravado). Correção sugerida: incluir o futuro do plano vigente (se não violar restrição dura) como candidato "plano vigente mantido".
2. **θ: efeito pequeno e em degraus, sem θ que reduza churn de graça** (`planejar.ts: bonusDoPlanoVigente`): ver seção 4. Não é bug; é uma calibração sem resposta útil — a spec §4 pressupõe que existe um θ que reduz o churn sem piorar a falta, e nos dados reais não existe.
3. **Churn de pessoas sem estabilização**: o caminho de fluxo não reaproveita `estabilizarPessoas` (que o modo restrito usa); 183–413 linhas alteradas por recálculo; em 7/12 fechamentos ≥ 50% delas são só troca de pessoa no mesmo conjunto de postos (seção H).
4. **`PoolFundido.demandaComum` incorreto** (`grafo.ts` ~137: `soma = conv.quantidade + auto.quantidade`): contrato diz Q_conv + Q_auto − boas; sai sempre 116.625. Só diagnóstico (a demanda do motor está certa).
5. *(corrigido no núcleo entre 1c7aa12 e 757e870; verificado aqui)* `EstadoProduto.demandaFinalRestante` deduzia a produção PLANEJADA do período comprometido (~2.700 peças por produto no 1º fechamento) contra o contrato Q_f − B_f,lo; agora há `restanteEmAPartirDe` separado e a auditoria independente confere `demandaFinalRestante = Q_f − B_f,lo` em 100% dos fechamentos. Resta uma ressalva de modelo: a projeção do período comprometido trata o planejado como certo (lo = hi).
6. **Diagnóstico não explica mudanças contra o plano vigente** (J): as `DecisaoFluxo` são contra o base; com base mantido há plano mudando até 416 linhas sem nenhuma decisão.
7. **`verificarRestricoesDuras` é sensível ao passado congelado**: chamado com o plano completo acusa violações em linhas JÁ gravadas (funcionário desativado depois, M8 parada), então não pode ser usado como interlock sobre o plano inteiro; usado só sobre as linhas novas (como em `planejar.ts`) está correto.
8. **O integrador não passa `fatorPorPool`** (`feat/escala-fluxo-io › opcoesFluxo` só devolve `paresLegado` e θ): o simulador e o motor operam com metas nominais (f = 1), embora o realizado mostre Etiquetar convencional a ~0,8 e a Máquina 8 a ~0,6 do planejado. Efeito medido na seção 6.1 (ganhos previstos menores, mesmas falhas). Decisão de produto: embutir f nas metas (como o sombra) ou aceitar o viés otimista.
9. Estrutural (contexto, não bug do núcleo): em PROD as linhas do Embalar são apontadas 100% no produto convencional (real 35.600 × plano 0; automática plano 49.125 × real 0); o plano de fluxo passa a atribuir tudo ao convencional — coerente com a spec §5, mas muda o que a tela mostra para a automática.

## 8. Reprodução

```
# 1) extração (somente SELECT em PROD): scripts/escala-fluxo-replay/sql/*.sql  →  <FREPLAY_DIR>/*.sql.out (JSON {rows})
# 2) replays (FREPLAY_DIR padrão = scratchpad/freplay):
npx tsx --tsconfig <tsconfig com alias @/*> scripts/escala-fluxo-replay/replay.ts fechamentos|encadeado|theta|sensibilidade|contrafactual|auditoria|estabilizacao [--offset=2]
npx tsx ... scripts/escala-fluxo-replay/autoteste-independente.ts      # mutação do verificador independente
npx tsx ... scripts/escala-fluxo-replay/relatorio.ts docs/escala-fluxo-criterios-ativacao.md
```

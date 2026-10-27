# Critérios de ativação da Escala Inteligente (fluxo) — RE-AVALIAÇÃO após as correções, replay com dados REAIS de PROD (26–27/10/2026)

> Revisor independente e cético, mesma régua da revisão anterior (commit `25605f4`: E, H e J FALHARAM). Gerado por `scripts/escala-fluxo-replay/` a partir de SELECTs em PROD (nada gravado). Código avaliado: `feat/escala-fluxo-int` @ `936e6c8` (núcleo v2: plano vigente como candidato, re-atribuição de pessoas, explicação aditiva contra o vigente, f embutido na integração). Configuração dos replays = a da integração (`insumosFluxo`: metas × f do realizado visível no corte + `fatoresEmbutidos` + `paresLegado` do Conector; θ = 0 + estabilização por padrão); `aPartirDe = c+2`. Os números são reproduzíveis (seção 9) e determinísticos.

## 0. Recomendação

**Todos os critérios A–J PASSARAM** nesta re-avaliação (a spec §7 não impede a ativação; tempo por recálculo < 1 s, bem dentro do orçamento). **Recomendação: ATIVAR, condicionada aos pré-requisitos operacionais abaixo — que o replay NÃO consegue verificar — e com o rollback pronto.** Sem eles: MANTER EM SOMBRA.

Pré-requisitos (bloqueadores objetivos se não cumpridos antes do 1º recálculo de amanhã):
1. Deploy da branch `feat/escala-fluxo-int` + migration `20261105190000_escala_producao_real_fluxo.sql` + parâmetros (`docs/escala-fluxo-integracao.md` §4). Nada disso foi aplicado em PROD por esta revisão; exige sua autorização.
2. Smoke da integração com o núcleo v2 em DEV/Preview (checklist `docs/escala-fluxo-integracao.md` §7): os testes de integração passam com o núcleo REAL, mas o fluxo nunca rodou em PROD (nem em sombra).
3. Escopo mínimo: `producao_real_semanas_ativas = ["2026-10-26"]`; conferir o 1º diagnóstico (`resultado = 'ok'`, `violacoes = []`, `aplicado`) e manter o rollback `ativo → sombra` à mão.

Riscos residuais que você aceita ao ativar (detalhe nas seções 3 e 7): (a) a régua LEGADA da tela atual de previsto discorda do simulador em 22/29 fechamentos — o supervisor verá mais falta nas etapas intermediárias; (b) o simulador tem calibração fraca no backtest (92/330): ganhos são relativos ao modelo; (c) o plano pode aumentar o excesso de WIP no fim da semana em 2 dos 12 fechamentos (26/10 M2, 26/10 M3); (d) cada recálculo ainda muda ~50 linhas (todas de POSTO, não de pessoa à toa); (e) o f é suavizado e vale 1 no início da semana.

| Critério | Veredito | Números |
|---|---|---|
| **A** Hard constraints (máquina indisponível/inativa/fora da Previsão, ausência, equipe, seleção, roteiro) | **PASSOU** | 36 replays (36 decisões gravadas): verificador independente = 0 violações; `verificarRestricoesDuras` do núcleo (linhas novas) = 0; sobre o plano COMPLETO no modo `somenteLinhasNovas` = 0; avisos (Parada real da M8 posterior ao corte, logo não conhecível) = 42. |
| **B** Passado alterado (planoVigente × saída em períodos ≤ c+1 / iniciados) | **PASSOU** | 0 linhas do passado alteradas em 36 replays (aPartirDe = c+2: c+1 está comprometido/iniciado há 10 min no fechamento). |
| **C** Dupla alocação (pessoa em 2 postos, posto com 2 pessoas, máquina duplicada) | **PASSOU** | 0 violações em 36 replays; Etiquetadora 15 / Embalagem 17 em dois pools no mesmo período: 0. |
| **D** Revezamento (mesma operação em períodos consecutivos do mesmo dia) | **PASSOU** | 0 repetições; exceções novas (`excecaoRevezamento`) sinalizadas: 0. |
| **E** Falta final total: fluxo nunca pior que o oficial (mesmo simulador) | **PASSOU** | Em 36 replays o plano devolvido nunca tem falta final (pessimista) pior que o vigente VÁLIDO: 0 piora(s); pior que o plano base do núcleo: 0; pior que o motor oficial regenerado (nominal): 0; no replay encadeado, pior que o plano herdado válido: 0/12. Plano escolhido: {"base":3,"fluxo":33}. Vigentes inválidos (restrição dura hoje): 0. |
| **F** Caixa Amarela coerente (E16 × Montagem) | **PASSOU (qualitativo)** | Nos 6 fechamentos de 27/10 o plano devolvido não reduz os postos da E16 nem da Montagem em relação ao vigente; os contrafactuais manuais do Mikael (+2.071 / −4.016 / −2.657) NÃO foram reproduzidos (desenho diferente, ver detalhe). |
| **G** Conector legado (pools comuns fundidos sem duplicidade) | **PASSOU** | 2 pools comuns fundidos em 36/36 replays; duplicidade E15/E17: 0; Máquina 8 dentro do teto derivado: sim; `demandaComum` = Q_conv + Q_auto − boas (conferido nos apontamentos brutos): 36/36 corretos (**correção 5**). |
| **H** Churn aceitável (linhas e trocas de posto por recálculo) | **PASSOU** | mediana 50 / p90 56 linhas alteradas por recálculo (meta: mediana ≤ 100; revisão anterior: 260 / 395); trocas de posto mediana 49 / p90 55; 1º período mutável mediana 2 / p90 3. No replay encadeado (fluxo sobre fluxo): mediana 35 / p90 46. |
| **I** WIP previsto ≤ teto derivado (nenhum par explode) | **PASSOU** | 0 violações em 216 conferências (pipeline máx. por etapa × ConsumoDownstream + Teto); excesso de WIP no fim da semana: vigente 82.019 × plano 27.922 peças (soma nos 10 fechamentos com fluxo). Atenção: o plano tem MAIS excesso de WIP que o vigente em 2 fechamento(s): 26/10 M2 (22.700 → 22.950), 26/10 M3 (7.877 → 10.525). |
| **J** Plano explicável (ANTES/DECISÃO/MOTIVO/DEPOIS em 100% dos replanejamentos) | **PASSOU** | ANTES (vigente) e DEPOIS completos em 100% dos replays; 1.552/1.552 (100%) das mudanças pessoa×período contra o plano VIGENTE cobertas pelo agregado explícito por período (lista detalhada: 1.552/1.552, 32/32 replays totalmente cobertos); reconciliação aditiva (Σ ganhos + resíduo = final previsto do plano − vigente) exata em 36/36 replays, resíduo máx. 0.09% da diferença (9 peças); decisões com ganho negativo: 568/1.757 (soma -381.273 peças), neutras: 179. |

## 1. Método e dados

- **Dados**: 36 decisões gravadas em `escala_sombra_decisoes` da semana 26/10 (entrada canônica completa) + 262 linhas de `apontamentos_producao` + `ocorrencias_maquina`/`escala_recurso_indisponivel`/`ausencias_funcionarios`. Fechamentos reais = 12 (revisão 0: 26/10 M1…T3 e 27/10 M1…T3); as demais 20 decisões (revisões do modo restrito) entram como recálculos extras; 4 revisões gravadas com `c` defasado foram marcadas **obsoletas** e não entram nas contagens de J/I (entram em A–E por rigor: qualquer piora em QUALQUER replay é falha).
- **Sem olhar o futuro**: cada replay usa `agoraMs` = corte gravado e entrega ao núcleo TODOS os apontamentos da semana; só vale o que o núcleo filtra por `lancadoEmMs ≤ agoraMs`. O f de desempenho também só vê o visível no corte (a sensibilidade confirma: lançamento atrasado não muda o plano até o relógio avançar).
- **Entrada do motor reconstruída fielmente**: `aPartirDe = c+2`, congeladas = plano vigente ≤ c+1, revezamento duro. **f**: a mesma função da integração (`fatoresDeDesempenho`/`embutirFatores`) — realizado visível no corte, pools fundidos do Conector com f conjunto. O plano vigente gravado é avaliado SEMPRE pela capacidade das metas (nunca pelas peças gravadas), então f embutido em peças antigas não é multiplicado duas vezes (testado). Golden-master do motor oficial (`gerarEscala` byte-idêntico com hooks vazios): OK nos cenários reais; o plano da sombra de 36/36 decisões gravadas continua reproduzido (`hash_plano_sombra`); o `hash_decisao` de 14/36 mudou por causa da correção do f do Pacote G (já documentada em `c87d0f2`), não por esta mudança.
- **Régua única**: `avaliarPlano` do núcleo avalia plano vigente, motor oficial regenerado e plano devolvido. Verificações cruzadas independentes: (i) verificador de restrições escrito do zero (A–D) + teste de mutação, agora também aplicado ao futuro do plano VIGENTE (para conferir o veredito `vigente.valido` do núcleo); (ii) simulador independente (sinal); (iii) régua legada `faltaProjetada` (com `projetarProducaoReescalada`, que não multiplica f duas vezes); (iv) auditoria de `estadoDaProducao` contra os apontamentos brutos (228 itens conferidos; 0 divergências fora da projeção do período comprometido); (v) determinismo: cada replay roda 2×, hash do `ResultadoFluxo` inteiro idêntico em 36/36; encadeado 2× idêntico: sim.
- **Backtest do simulador** (WIP previsto pelo plano vigente em i × WIP estimado observado em j > i): 92/330 previsões dentro da faixa observada (28%). Pares: Caixa Amarela 4x2 · Etiquetar→ 3/55 (erro médio 660); Conector 3/4 Conv. · Etiquetar→ 55/55 (erro médio 0); Conector 3/4 Conv. · Parafusar→ 0/55 (erro médio 2.748); Conector 3/4 Conv. · Rosquear→ 9/55 (erro médio 896); Conector 3/4 Autom. · Rosquear + Parafusar→ 6/55 (erro médio 555); Conector 1.1/4" · Rosquear→ 19/55 (erro médio 645). Evidência FRACA de calibração, sem falha formal.

## 2. Tabela por fechamento (replay no instante do corte; aPartirDe = c+2)

Falta/final = soma dos produtos, cenário pessimista (lo), peças, medidos pelo MESMO `avaliarPlano` (f embutido nas metas, como na integração) sobre: plano vigente gravado · plano base do núcleo (`gerarEscala` sobre a entrada com f) · motor oficial regenerado (metas nominais, o que a Escala faria hoje) · plano devolvido pelo fluxo. Todos os fechamentos 26–27/10 (revisão 0).

| Fechamento | plano escolhido | falta vigente | falta base (núcleo) | falta oficial regenerado | falta FLUXO | Δ vs vigente | Δ vs oficial regen. | final prev. vigente → fluxo | WIP final vig → fluxo | excesso WIP vig → fluxo | linhas alteradas vs vigente | decisões / pessoas | resíduo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 26/10 M1 | base | 32.602 | 29.090 | 36.005 | 29.090 | -3.512 | -6.915 | 305.723 → 309.235 | 37.699 → 34.582 | 23.100 → 21.320 | 23 | 24 / 24 | 0 |
| 26/10 M2 | base | 32.569 | 29.809 | 35.971 | 29.809 | -2.760 | -6.162 | 305.756 → 308.516 | 37.129 → 36.520 | 22.700 → 22.950 | 29 | 31 / 31 | -0 |
| 26/10 M3 | fluxo | 19.506 | 25.585 | 19.506 | 17.561 | -1.945 | -1.945 | 316.269 → 318.214 | 20.508 → 19.479 | 7.877 → 10.525 | 51 | 54 / 54 | -0 |
| 26/10 T1 | fluxo | 21.065 | 22.198 | 21.065 | 11.382 | -9.683 | -9.683 | 314.710 → 324.393 | 19.784 → 11.381 | 8.237 → 5.611 | 56 | 57 / 57 | -9 |
| 26/10 T2 | fluxo | 25.326 | 23.934 | 25.326 | 15.179 | -10.147 | -10.147 | 310.449 → 320.596 | 18.315 → 8.507 | 8.073 → 902 | 52 | 52 / 52 | -0 |
| 26/10 T3 | fluxo | 31.090 | 34.799 | 31.336 | 19.702 | -11.388 | -11.634 | 304.685 → 316.073 | 21.927 → 11.173 | 9.932 → 5.389 | 64 | 64 / 64 | 0 |
| 27/10 M1 | fluxo | 34.039 | 36.692 | 34.039 | 18.785 | -15.254 | -15.254 | 301.736 → 316.990 | 15.112 → 1.125 | 6.813 → 0 | 50 | 50 / 50 | 0 |
| 27/10 M2 | fluxo | 35.283 | 34.116 | 24.815 | 16.950 | -18.333 | -7.865 | 300.492 → 318.825 | 22.617 → 3.234 | 10.893 → 55 | 50 | 50 / 50 | 0 |
| 27/10 M3 | fluxo | 28.836 | 25.985 | 25.807 | 17.349 | -11.487 | -8.458 | 306.939 → 318.426 | 18.868 → 7.910 | 7.072 → 580 | 39 | 39 / 39 | -0 |
| 27/10 T1 | fluxo | 29.265 | 27.669 | 20.728 | 13.485 | -15.780 | -7.243 | 306.510 → 322.290 | 22.560 → 6.732 | 8.419 → 0 | 49 | 49 / 49 | 0 |
| 27/10 T2 | fluxo | 32.929 | 30.999 | 24.660 | 15.829 | -17.100 | -8.831 | 302.846 → 319.946 | 24.234 → 7.369 | 9.171 → 2.092 | 43 | 43 / 43 | -0 |
| 27/10 T3 | fluxo | 29.480 | 32.542 | 29.480 | 19.716 | -9.764 | -9.764 | 306.295 → 316.059 | 15.172 → 7.815 | 5.532 → 2.768 | 43 | 43 / 43 | 0 |

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

Formato: `planejado × real`. Real = demanda final restante R_f = Q_f − boas confirmadas da etapa final (só o CONFIRMADO reduz a meta). **Conector**: as colunas convencional/automática NÃO são comparáveis isoladamente — a fábrica aponta o Embalar (e o Etiquetar) 100% no convencional; o núcleo funde os pools comuns (seção G).

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

### 2.3 Gargalo de fluxo por produto (do plano VIGENTE; potencial − demanda restante; negativo = gargalo real)

| Fechamento | Caixa Amarela 4x2 | Conector 3/4 Conv. | Conector 3/4 Autom. | Pino | Plug Macho | Conector 1.1/4" |
|---|---|---|---|---|---|---|
| 26/10 M1 | Montar Presilha -1.843 | Etiquetar -16.625 | — | Parafusar (Pino) -1.798 | Parafusar 200 | Embalar -2.530 |
| 26/10 M2 | Montar Presilha -1.423 | Etiquetar -15.425 | — | Parafusar (Pino) -3.867 | Parafusar 300 | Embalar -2.550 |
| 26/10 M3 | Montar Presilha 57 | Etiquetar -13.525 | — | Parafusar (Pino) 5.657 | Parafusar -93 | Embalar -790 |
| 26/10 T1 | Montar Presilha 74 | Etiquetar -10.863 | — | Parafusar (Pino) 9.176 | Parafusar -22 | Embalar -1.000 |
| 26/10 T2 | Montar Presilha -861 | — | Rosquear + Parafusar -15.329 | Parafusar (Pino) 10.822 | Parafusar 207 | Embalar -997 |
| 26/10 T3 | Etiquetar -4.102 | Etiquetar -18.145 | — | Parafusar (Pino) -1.239 | Parafusar -1.208 | Embalar -690 |
| 27/10 M1 | Etiquetar -2.892 | — | Rosquear + Parafusar -22.603 | Parafusar (Pino) 9.261 | Parafusar -2.130 | Embalar -1.306 |
| 27/10 M2 | Etiquetar -3.512 | Etiquetar -15.409 | — | Parafusar (Pino) -4.361 | Parafusar -3.583 | Rosquear -1.077 |
| 27/10 M3 | Etiquetar -3.463 | Etiquetar -10.116 | — | Parafusar (Pino) -3.494 | Parafusar -3.649 | Embalar -1.027 |
| 27/10 T1 | Etiquetar -3.222 | Etiquetar -10.774 | — | Parafusar (Pino) -2.855 | Parafusar -3.820 | Embalar -834 |
| 27/10 T2 | Etiquetar -5.683 | Embalar -12.626 | — | Parafusar (Pino) -2.855 | Parafusar -4.361 | Embalar -865 |
| 27/10 T3 | Etiquetar -6.451 | — | Rosquear + Parafusar -17.043 | Parafusar (Pino) 10.502 | Parafusar -3.900 | Embalar -1.485 |

### 2.4 Churn por fechamento

O período c+1 está comprometido/em curso no fechamento (0 alterações por construção); o 1º período mutável é c+2.

| Fechamento | plano | linhas vs vigente (núcleo) | antes da re-atribuição de pessoas | trocas de posto | postos alterados | 1º período mutável | θ | oficial regenerado × vigente (linhas / postos) | por período mutável, só mudança de posto (c+2 / c+3 / c+4 / c+5 / c+6…) |
|---|---|---|---|---|---|---|---|---|---|
| 26/10 M1 | base | 23 | 411 → 23 | 23 | 34 | 0 | 0 | 413 / 14 | 0 / 0 / 2 / 0 / 21 |
| 26/10 M2 | base | 29 | 385 → 29 | 29 | 38 | 0 | 0 | 395 / 8 | 0 / 2 / 0 / 0 / 27 |
| 26/10 M3 | fluxo | 51 | 269 → 51 | 49 | 82 | 2 | 0 | 0 / 0 | 2 / 3 / 1 / 2 / 43 |
| 26/10 T1 | fluxo | 56 | 253 → 56 | 55 | 93 | 1 | 0 | 0 / 0 | 1 / 1 / 1 / 1 / 52 |
| 26/10 T2 | fluxo | 52 | 274 → 52 | 52 | 80 | 1 | 0 | 0 / 0 | 1 / 3 / 1 / 2 / 45 |
| 26/10 T3 | fluxo | 64 | 264 → 64 | 64 | 98 | 3 | 0 | 174 / 39 | 3 / 2 / 3 / 1 / 55 |
| 27/10 M1 | fluxo | 50 | 255 → 50 | 50 | 86 | 0 | 0 | 0 / 0 | 0 / 2 / 5 / 3 / 40 |
| 27/10 M2 | fluxo | 50 | 267 → 50 | 50 | 88 | 3 | 0 | 208 / 35 | 3 / 3 / 1 / 2 / 41 |
| 27/10 M3 | fluxo | 39 | 233 → 39 | 39 | 72 | 3 | 0 | 220 / 36 | 3 / 2 / 2 / 1 / 31 |
| 27/10 T1 | fluxo | 49 | 250 → 49 | 49 | 86 | 3 | 0 | 226 / 41 | 3 / 2 / 2 / 3 / 39 |
| 27/10 T2 | fluxo | 43 | 237 → 43 | 43 | 78 | 3 | 0 | 217 / 39 | 3 / 2 / 3 / 2 / 33 |
| 27/10 T3 | fluxo | 43 | 199 → 43 | 43 | 72 | 2 | 0 | 0 / 0 | 2 / 2 / 2 / 2 / 35 |

## 3. Critérios A–J (re-avaliados)

### A — Hard constraints (máquina indisponível/inativa/fora da Previsão, ausência, equipe, seleção, roteiro): **PASSOU**

36 replays (36 decisões gravadas): verificador independente = 0 violações; `verificarRestricoesDuras` do núcleo (linhas novas) = 0; sobre o plano COMPLETO no modo `somenteLinhasNovas` = 0; avisos (Parada real da M8 posterior ao corte, logo não conhecível) = 42.

Verificador independente escrito do zero (replica as invariantes de `disponibilidade.ts`/`revalidarDisponibilidade.ts`/`rotacao.ts`), validado por teste de mutação (`autoteste-independente.ts`: AUTOTESTE OK — todas as mutações injetadas foram detectadas, plano do motor oficial = 0 violações). Causas de indisponibilidade = as gravadas em cada snapshot, mais a Parada real da Máquina 8 (ocorrencias_maquina 27/10 09:34–11:54) conferida à parte como aviso. Violações por tipo: {"A:parada_real_nao_conhecida_pelo_motor*":42}. **Correção 6**: `verificarRestricoesDuras(entrada, linhas, { somenteLinhasNovas: true })` não acusa linhas já congeladas — na revisão anterior, chamado com o plano completo acusava 229 itens ainda hoje presentes no modo antigo (informativo: funcionário desativado/ausente depois, Parada da M8 desconhecida na época, todos em linhas JÁ gravadas); no modo novo o plano completo dá 0. O relatório usa o modo novo.

### B — Passado alterado (planoVigente × saída em períodos ≤ c+1 / iniciados): **PASSOU**

0 linhas do passado alteradas em 36 replays (aPartirDe = c+2: c+1 está comprometido/iniciado há 10 min no fechamento).

Medido por `verificarIndependente` (linha da saída em slot < aPartirDe que difere do vigente; congeladas da entrada ≠ vigente). O plano `vigente` mantido devolve só linhas em slots ≥ aPartirDe. Se o integrador usar aPartirDe = c+1 (leitura literal da spec §4) o plano PODE alterar o período c+1 — ver seção 3.1.

### C — Dupla alocação (pessoa em 2 postos, posto com 2 pessoas, máquina duplicada): **PASSOU**

0 violações em 36 replays; Etiquetadora 15 / Embalagem 17 em dois pools no mesmo período: 0.

Pessoa com >1 linha no mesmo período, máquina com >1 pessoa, máquina em >1 pool do mesmo período (inclui os pools do Conector que compartilham E15/E17). A re-atribuição de pessoas (`estabilizarPessoas`) não cria linhas nem muda postos; conferida DEPOIS dela pelo verificador independente.

### D — Revezamento (mesma operação em períodos consecutivos do mesmo dia): **PASSOU**

0 repetições; exceções novas (`excecaoRevezamento`) sinalizadas: 0.

Inclui o par que atravessa a fronteira (último congelado → primeiro mutável). PROD usa revezamento_modo = duro. A re-atribuição de pessoas respeita o revezamento (par proibido = mesma operação do período anterior da mesma pessoa) — sem solução ⇒ devolve o plano sem ajuste.

### E — Falta final total: fluxo nunca pior que o oficial (mesmo simulador): **PASSOU**

Em 36 replays o plano devolvido nunca tem falta final (pessimista) pior que o vigente VÁLIDO: 0 piora(s); pior que o plano base do núcleo: 0; pior que o motor oficial regenerado (nominal): 0; no replay encadeado, pior que o plano herdado válido: 0/12. Plano escolhido: {"base":3,"fluxo":33}. Vigentes inválidos (restrição dura hoje): 0.

**Correção 1**: `planejar.ts` inclui o futuro do plano vigente como candidato (`PLANO_VIGENTE_MANTIDO`), válido só se não violar restrição dura HOJE (`verificarRestricoesDuras`) e estiver completo (mesmas pessoas/slots que o motor geraria). Elegível = 0 violação E falta ≤ min(base, vigente válido); empate ⇒ vigente (zero churn) > base > fluxo.

Nenhuma piora vs vigente válido (lo).

Também no cenário otimista (hi) nenhuma piora vs vigente válido.

Replay encadeado (fluxo aplicado sobre o fluxo anterior): nenhuma piora vs o plano herdado válido.

Nenhum vigente foi descartado como inválido nos dados reais (a descontinuidade 'vigente inválido' está coberta por testes unitários: Parada, desativado, incompleto).

Verificação cruzada da validade do vigente: o veredito do núcleo (`vigente.valido`) e o verificador independente (A/C/D sobre as linhas vigentes) discordam em 0/36 replays. Régua cruzada: o simulador independente concorda no SINAL da melhora em 29/29 replays em que o fluxo foi escolhido; a régua LEGADA (`faltaProjetada`, exige cumprir o previsto de TODAS as etapas, é a da tela atual) discorda em 22/29 replays (soma da falta legada nos 12 fechamentos: vigente 423.796 → plano 553.196; por construção — o fluxo deixa de produzir intermediário sem utilidade para o produto final — mas **a tela atual de previsto vai mostrar mais falta nas etapas intermediárias**: risco de leitura para o supervisor, não violação de critério).

### F — Caixa Amarela coerente (E16 × Montagem): **PASSOU (qualitativo)**

Nos 6 fechamentos de 27/10 o plano devolvido não reduz os postos da E16 nem da Montagem em relação ao vigente; os contrafactuais manuais do Mikael (+2.071 / −4.016 / −2.657) NÃO foram reproduzidos (desenho diferente, ver detalhe).

Postos de E16 / Montagem (soma nos períodos mutáveis) e peças planejadas EFETIVAS (× f):

| Fechamento 27/10 | WIP E16→Montagem | postos E/M vigente | postos E/M plano | peças E/M vigente | peças E/M plano |
|---|---|---|---|---|---|
| 27/10 M1 | est/baixa 0–0 NEG | 21 / 77 | 22 / 80 | 48.613 / 49.624 | 51.098 / 51.505 |
| 27/10 M2 | est/media 509–509 | 19 / 75 | 21 / 79 | 44.991 / 47.398 | 48.503 / 50.157 |
| 27/10 M3 | est/media 1.639–1.639 | 18 / 73 | 19 / 74 | 42.792 / 46.293 | 45.018 / 47.181 |
| 27/10 T1 | est/media 2.778–2.778 | 17 / 69 | 18 / 72 | 40.688 / 43.950 | 42.920 / 45.826 |
| 27/10 T2 | est/media 1.698–1.698 | 16 / 67 | 18 / 71 | 37.294 / 42.319 | 41.624 / 45.055 |
| 27/10 T3 | est/media 2.963–2.963 | 15 / 62 | 17 / 67 | 34.331 / 39.377 | 38.928 / 42.414 |

Contrafactuais pelo MESMO simulador (final entregue de Caixa Amarela, peças; variantes geradas sobre a entrada com f, aplicadas a TODOS os slots mutáveis):

| Fechamento | WIP E16→Mont. | vigente | base | reforço Montagem mantendo E16 | sem E16 | FLUXO |
|---|---|---|---|---|---|---|
| 10-26 m1 | media 250–250 | 68.336 | 69.673 | 65.999 | 12.550 | 69.673 |
| 10-27 m1 | baixa 0–0 | 67.166 | 65.421 | 58.562 | 19.596 | 70.094 |
| 10-27 m2 | media 509–509 | 66.988 | 65.643 | 61.482 | 21.997 | 70.497 |
| 10-27 m3 | media 1.639–1.639 | 67.037 | 64.508 | 62.571 | 24.245 | 68.365 |
| 10-27 t1 | media 2.778–2.778 | 67.278 | 64.741 | 62.509 | 26.590 | 69.510 |
| 10-27 t2 | media 1.698–1.698 | 64.817 | 63.530 | 61.656 | 27.523 | 69.147 |
| 10-27 t3 | media 2.963–2.963 | 63.272 | 61.897 | 61.509 | 29.718 | 68.646 |

Leitura cética: (1) o simulador valoriza a E16 como gargalo — "reforçar Montagem" por prioridade puxa pessoas da E16 e PIORA o final da Caixa Amarela; (2) desligar a E16 derruba o final em dezenas de milhares de peças; (3) o plano devolvido é igual ou melhor que TODAS as variantes em 7/7 cortes, mas só pelo simulador — não há contrafactual real. Os estoques E16→Montagem são ESTIMADOS (sem saldo confirmado em PROD): 0 / 509 / 1.639 / 2.778 / 1.698 / 2.963 peças.

### G — Conector legado (pools comuns fundidos sem duplicidade): **PASSOU**

2 pools comuns fundidos em 36/36 replays; duplicidade E15/E17: 0; Máquina 8 dentro do teto derivado: sim; `demandaComum` = Q_conv + Q_auto − boas (conferido nos apontamentos brutos): 36/36 corretos (**correção 5**).

Nos 10 fechamentos em que o fluxo foi escolhido, as linhas de Etiquetar/Embalar saem 100% no produto convencional (linhas da AUTOMÁTICA: 0, contra 113 no plano vigente) — coerente com o que a fábrica realmente aponta. `demandaComum` no último fechamento: núcleo 83038 / 75025 × esperado 83038 / 75025 (Etiquetar / Embalar). O f dos pools fundidos é conjunto (realizado do convencional vale para o nó fundido).

Etiquetadora 15 (atende Etiquetar convencional e automática — demanda restante das duas etapas × capacidade futura da máquina, meta nominal):

| Fechamento | demanda restante REAL (Q − boas) | capacidade futura E15 | déficit real | demanda legada (Q − créditos planejados) | períodos com E15 ocupada: vigente → plano (de N) |
|---|---|---|---|---|---|
| 26/10 M1 | 112.832 | 94.000 | 18.832 | 109.625 | 28 → 28 (de 28) |
| 26/10 M2 | 108.667 | 90.500 | 18.167 | 106.125 | 27 → 27 (de 27) |
| 26/10 M3 | 108.667 | 87.000 | 21.667 | 103.125 | 26 → 26 (de 26) |
| 26/10 T1 | 105.317 | 87.662 | 17.655 | 100.125 | 25 → 25 (de 25) |
| 26/10 T2 | 102.286 | 84.337 | 17.949 | 97.125 | 24 → 24 (de 24) |
| 26/10 T3 | 99.551 | 80.380 | 19.171 | 93.481 | 23 → 23 (de 23) |
| 27/10 M1 | 95.543 | 77.522 | 18.021 | 90.125 | 22 → 22 (de 22) |
| 27/10 M2 | 92.442 | 72.966 | 19.476 | 86.483 | 21 → 21 (de 21) |
| 27/10 M3 | 87.680 | 71.059 | 16.621 | 83.361 | 20 → 20 (de 20) |
| 27/10 T1 | 87.680 | 67.901 | 19.779 | 80.240 | 19 → 19 (de 19) |
| 27/10 T2 | 84.880 | 64.308 | 20.572 | 77.118 | 18 → 18 (de 18) |
| 27/10 T3 | 83.038 | 59.723 | 23.315 | 73.618 | 17 → 17 (de 17) |

No fechamento de 27/10 T2 a demanda restante real do Etiquetar é 84.880 contra 64.308 de capacidade da E15 (déficit 20.572). A E15 fica ocupada em TODOS os períodos mutáveis tanto no vigente quanto no plano.

### H — Churn aceitável (linhas e trocas de posto por recálculo): **PASSOU**

mediana 50 / p90 56 linhas alteradas por recálculo (meta: mediana ≤ 100; revisão anterior: 260 / 395); trocas de posto mediana 49 / p90 55; 1º período mutável mediana 2 / p90 3. No replay encadeado (fluxo sobre fluxo): mediana 35 / p90 46.

| Métrica (12 fechamentos) | mediana | p90 | máx |
|---|---|---|---|
| linhas alteradas vs vigente (núcleo, v2: θ=0 + re-atribuição de pessoas) | 50 | 56 | 64 |
| idem, medido pelo contador independente (posto = máquina|produto|etapa) | 50 | 56 | 64 |
| linhas com o MESMO posto mas peças diferentes (f embutido nas peças do plano novo; não é troca de pessoa/posto) | 227 | 318 | 321 |
| idem ANTES da re-atribuição de pessoas (mesmos postos) | 260 | 385 | 411 |
| trocas de posto vs vigente | 49 | 55 | 64 |
| alteradas no 1º período mutável (c+2) | 2 | 3 | 3 |
| todas as 36 decisões (inclui revisões do modo restrito) | 50 | 57 | 75 |
| linhas do motor oficial regenerado × vigente (churn do oficial sozinho) | 191 | 395 | 413 |
| revisão anterior (commit 25605f4): linhas vs vigente | 260 | 395 | 413 |

**Correção 2**: `estabilizarPessoas` (o mesmo mecanismo do modo restrito) é aplicado a CADA candidato (base, P0, iterações) antes de compará-los/devolvê-los; falta e restrições duras são reavaliadas DEPOIS (descartada se a falta piorar ou surgir violação; descartes nos dados reais: 0). θ passa a ser 0 por padrão (`thetaPadrao` = 0; a retenção por θ só custava peça final — seção 4). O que sobra é mudança de POSTO de verdade (dos 549 linhas alteradas nos 12 fechamentos, produtivas: 549, trocas equivalentes de pessoa: 0).

A re-atribuição ajustou todos os fechamentos em que o plano muda. Linhas alteradas antes → depois por fechamento: 10-26 m1: 411→23; 10-26 m2: 385→29; 10-26 m3: 269→51; 10-26 t1: 253→56; 10-26 t2: 274→52; 10-26 t3: 264→64; 10-27 m1: 255→50; 10-27 m2: 267→50; 10-27 m3: 233→39; 10-27 t1: 250→49; 10-27 t2: 237→43; 10-27 t3: 199→43. O 1º período mutável (c+2) muda em mediana 2 linhas (máx 3) — a maior parte do churn restante está nos períodos distantes, onde o plano de fato reorganiza os postos.

### I — WIP previsto ≤ teto derivado (nenhum par explode): **PASSOU**

0 violações em 216 conferências (pipeline máx. por etapa × ConsumoDownstream + Teto); excesso de WIP no fim da semana: vigente 82.019 × plano 27.922 peças (soma nos 10 fechamentos com fluxo). Atenção: o plano tem MAIS excesso de WIP que o vigente em 2 fechamento(s): 26/10 M2 (22.700 → 22.950), 26/10 M3 (7.877 → 10.525).

Máximo de WIP (hi) previsto por par ao longo da semana, entre todos os replays:

| par (origem →) | máx. WIP previsto |
|---|---|
| Conector 3/4 Conv. · Etiquetar→ | 16.649 |
| Conector 3/4 Conv. · Rosquear→ | 14.132 |
| Conector 3/4 Conv. · Parafusar→ | 10.263 |
| Conector 3/4 Autom. · Rosquear + Parafusar→ | 4.605 |
| Caixa Amarela 4x2 · Etiquetar→ | 4.516 |
| Conector 1.1/4" · Rosquear→ | 3.580 |

### J — Plano explicável (ANTES/DECISÃO/MOTIVO/DEPOIS em 100% dos replanejamentos): **PASSOU**

ANTES (vigente) e DEPOIS completos em 100% dos replays; 1.552/1.552 (100%) das mudanças pessoa×período contra o plano VIGENTE cobertas pelo agregado explícito por período (lista detalhada: 1.552/1.552, 32/32 replays totalmente cobertos); reconciliação aditiva (Σ ganhos + resíduo = final previsto do plano − vigente) exata em 36/36 replays, resíduo máx. 0.09% da diferença (9 peças); decisões com ganho negativo: 568/1.757 (soma -381.273 peças), neutras: 179.

**Correção 3**: `explicar.ts` descreve a mudança CONTRA o plano vigente (`DiagnosticoFluxo.referencia = "vigente"`; sem vigente futuro, contra o base). Cada decisão é um grupo (período, posto de → para) de pessoas; as decisões são aplicadas UMA A UMA sobre a capacidade do vigente e o simulador é re-executado a cada passo; `ganhoProdutoFinal` é a média dos ganhos marginais em 8 caminhos (ordens) de aplicação — aditivo por construção (cada caminho soma exatamente final(plano) − final(vigente)); `wipConsumido`/`wipEvitado`/`wipFinalVariacao` saem da mesma re-simulação. O `residuo` (teto de demanda `rem` e quantidades em postos mantidos) é explícito. A lista detalhada admite até 500 decisões (`maxDecisoes`); acima disso `decisoesTotal` + `resumoDecisoes` (por pool de→para E por período, `porSlot`) cobrem 100% das linhas — conferido por contagem em 32 replays com mudança. Texto de motivo ausente: 0; decisões cujo `de` não bate com o posto no vigente: 0; replays com mudança contra o vigente e ZERO decisões: 0.

Limitação (cética): o ganho por decisão é a MÉDIA de 8 ordens de aplicação (cronológica, inversa e 6 pseudo-aleatórias de semente fixa — Shapley por amostragem), aditivo mas ainda dependente das ordens amostradas; o BRUTO é maior que o LÍQUIDO porque movimentos complementares se compensam (por fechamento, soma dos ganhos positivos / negativos / líquido: 26/10 M1 8.674 / -5.162 / 3.512; 26/10 M2 7.191 / -4.432 / 2.759; 26/10 M3 15.689 / -13.744 / 1.945; 26/10 T1 22.160 / -12.477 / 9.684; 26/10 T2 23.135 / -12.988 / 10.147; 26/10 T3 27.834 / -16.446 / 11.388; 27/10 M1 24.703 / -9.448 / 15.254; 27/10 M2 27.979 / -9.646 / 18.333; 27/10 M3 15.984 / -4.497 / 11.487; 27/10 T1 33.644 / -17.865 / 15.780; 27/10 T2 31.670 / -14.570 / 17.099; 27/10 T3 21.116 / -11.353 / 9.764). Decisões isoladas com ganho negativo (568 de 1.757) existem porque são compensadas por complementares — o texto da decisão diz isso e a reconciliação fecha a conta. O nível legível por humano é o agregado por pool (tabela abaixo). As estimativas são relativas ao modelo (simulador), não previsão absoluta.

Agregado por pool de→para no último fechamento (27/10 T3), top 8 por |ganho|:

| de | para | pessoas-período | períodos | ganho (peças finais) |
|---|---|---|---|---|
| Conector 3/4 Autom. · Etiquetar | Conector 1.1/4" · Embalar | 2 | 2 | -3.733 |
| Conector 1.1/4" · Rosquear | Conector 3/4 Conv. · Etiquetar | 1 | 1 | +2.956 |
| Conector 3/4 Conv. · Etiquetar | Plug Macho · Parafusar | 2 | 2 | -2.559 |
| Conector 3/4 Conv. · Parafusar | Conector 3/4 Conv. · Etiquetar | 1 | 1 | +2.447 |
| Conector 3/4 Conv. · Rosquear | Caixa Amarela 4x2 · Etiquetar | 1 | 1 | +2.310 |
| Caixa Amarela 4x2 · Montar Presilha | Conector 3/4 Conv. · Etiquetar | 2 | 2 | +2.167 |
| Pino · Parafusar (Pino) | Conector 3/4 Conv. · Etiquetar | 1 | 1 | +2.032 |
| Pino · Parafusar (Pino) | Caixa Amarela 4x2 · Etiquetar | 1 | 1 | +1.965 |

Amostra de decisões (27/10 T3): 
- m2: troca de posto; ganho de 655 peça(s) final(is) (média de 8 ordens de aplicação); WIP final +1131
- m2: troca de posto; ganho de 234 peça(s) final(is) (média de 8 ordens de aplicação); evita ~194 de WIP excedente; WIP final +93
- m3: troca de posto; ganho de 0 peça(s) final(is) (média de 8 ordens de aplicação)

#### 3.1 Variante aPartirDe = c+1 (spec §4 lida literalmente)

Se o integrador chamar o núcleo com aPartirDe = c+1, o plano altera o período c+1 — que no fechamento já está em curso há 10 min: linhas alteradas no 1º período mutável por fechamento = 0, 0, 0, 2, 1, 2, 4, 4, 2, 3, 2, 1 (mediana 2). Isso viola B ("período em andamento congelado"). Recomendação mantida: aPartirDe = c+2 (como na integração).
## 4. θ × re-atribuição de pessoas (churn × falta)

| θ / estabilização | falta Σ12 fechamentos (lo) | linhas med / p90 | trocas med / p90 | 1º período med / p90 | plano base / fluxo / vigente |
|---|---|---|---|---|---|
| 0, sem estabilização (v1 sem derivado) | 224.838 | 260 / 385 | 260 / 381 | 7 / 14 | 2 / 10 / 0 |
| 0 + estabilização (PADRÃO v2) | 224.838 | 50 / 56 | 49 / 55 | 2 / 3 | 2 / 10 / 0 |
| 100 + estabilização | 229.012 | 49 / 54 | 48 / 54 | 1 / 2 | 2 / 10 / 0 |
| 1000 + estabilização | 229.706 | 49 / 54 | 48 / 54 | 1 / 1 | 2 / 10 / 0 |
| 5000 + estabilização | 229.706 | 49 / 54 | 48 / 54 | 1 / 1 | 2 / 10 / 0 |
| 1000, sem estabilização | 229.706 | 255 / 385 | 255 / 381 | 6 / 14 | 2 / 10 / 0 |

Leitura: o padrão v2 (θ = 0 + estabilização) reduz a mediana de linhas alteradas de 260 para 50 sem custo de falta (Σ12 224.838 → 224.838). θ > 0 não acrescenta nada útil: a retenção do posto vigente só no 1º período mutável custa peça final e não mexe no resto do plano. **θ adotado: 0 + estabilização de pessoas.**

## 5. Replay completo da semana (fluxo aplicado sobre o fluxo anterior)

Cada fechamento parte do passado gravado até c e do plano de FLUXO produzido no fechamento anterior de c+1 em diante (o plano herdado é o vigente do núcleo — pode ser mantido). Compara a falta (lo) do plano gravado, do plano herdado e do novo plano, e o churn entre planos consecutivos.

| Fechamento | plano escolhido | herdado válido? | oficial gravado | herdado (fluxo anterior) | novo plano | novo − herdado | churn linhas fluxo (vs anterior) | churn linhas oficial (vs anterior) |
|---|---|---|---|---|---|---|---|---|
| 10-26 m1 | base | sim | 32.602 | 32.602 | 29.090 | -3.512 | — | — |
| 10-26 m2 | vigente | sim | 32.569 | 29.394 | 29.394 | +0 | 0 | 0 |
| 10-26 m3 | fluxo | NÃO | 19.506 | 19.821 | 18.211 | -1.610 | 54 | 353 |
| 10-26 t1 | fluxo | NÃO | 21.065 | 20.831 | 18.557 | -2.274 | 43 | 255 |
| 10-26 t2 | fluxo | sim | 25.326 | 23.148 | 14.703 | -8.445 | 42 | 0 |
| 10-26 t3 | vigente | sim | 31.090 | 19.798 | 19.798 | +0 | 0 | 44 |
| 10-27 m1 | fluxo | NÃO | 34.039 | 21.476 | 21.272 | -204 | 46 | 277 |
| 10-27 m2 | fluxo | sim | 35.283 | 20.771 | 18.319 | -2.452 | 40 | 48 |
| 10-27 m3 | fluxo | sim | 28.836 | 15.836 | 15.607 | -229 | 30 | 0 |
| 10-27 t1 | vigente | sim | 29.265 | 16.827 | 16.827 | +0 | 0 | 0 |
| 10-27 t2 | fluxo | sim | 32.929 | 19.124 | 17.619 | -1.505 | 35 | 0 |
| 10-27 t3 | vigente | sim | 29.480 | 20.859 | 20.859 | +0 | 0 | 206 |

Soma da falta ao longo dos 12 fechamentos: oficial gravado 351.990 · fluxo encadeado 240.256. Churn do fluxo entre recálculos consecutivos: mediana 35 / p90 46 (oficial: mediana 44).

## 6. Sensibilidade e robustez

47/47 casos OK (sem exceção, sem WIP negativo exposto, entrada/dados NÃO mutados, JSON serializável, determinismo, 0 violações duras, plano NUNCA pior que o vigente válido, reconciliação aditiva exata). Cada cenário de dados foi aplicado a 3 fechamentos (27/10 T1, 26/10 T1, 27/10 M3).

| Caso | OK | plano / vigente válido | diagnósticos relevantes / faltas |
|---|---|---|---|
| 10-27 t1 · controle (dados reais) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta plano 13.485/13.485 · vigente 29.265/29.265 · oficial regen. 20.728/20.728 |
| 10-27 t1 · sem apontamento no período c | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×8 · falta plano 23.294/13.792 · vigente 40.135/26.494 · oficial regen. 33.490/19.373 |
| 10-27 t1 · sem apontamento nos 2 últimos períodos fechados | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×20 · falta plano 38.016/11.569 · vigente 57.857/28.560 · oficial regen. 45.854/19.047 |
| 10-27 t1 · sem NENHUM apontamento | OK | base / sim | PRODUCAO_NAO_CONFIRMADA×22 · falta plano 143.475/9.478 · vigente 155.915/20.528 · oficial regen. 143.475/9.478 |
| 10-27 t1 · apontamento do período c atrasado (chega 90 min depois) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×8 · falta plano 23.294/13.792 · vigente 40.135/26.494 · oficial regen. 33.490/19.373 |
| 10-27 t1 · apontamento atrasado COM relógio avançado (agora = corte + 120 min) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 AJUSTE_TARDIO×20 WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta plano 14.193/14.193 · vigente 30.312/30.312 · oficial regen. 22.106/22.106 |
| 10-27 t1 · lançamento tardio do período c−1 (chega depois do fechamento) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 AJUSTE_TARDIO×18 WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta plano 13.485/13.485 · vigente 29.265/29.265 · oficial regen. 20.728/20.728 |
| 10-27 t1 · refugo > produzido na etapa final (boas negativas brutas) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×8 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta plano 42.990/42.990 · vigente 63.451/63.451 · oficial regen. 56.744/56.744 |
| 10-27 t1 · saldo negativo: etapa seguinte aponta 5× mais que a anterior | OK | base / sim | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×8 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta plano 1.721/1.721 · vigente 9.150/9.150 · oficial regen. 4.846/4.846 |
| 10-27 t1 · apontamento em máquina fora do plano | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×4 WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_FALTA_MATERIAL×2 · falta plano 13.485/12.599 · vigente 29.265/28.268 · oficial regen. 20.728/19.731 |
| 10-27 t1 · todos sem_producao falta_material no período c | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×8 SEM_PRODUCAO_FALTA_MATERIAL×32 · falta plano 20.019/20.019 · vigente 38.935/38.935 · oficial regen. 30.342/30.342 |
| 10-27 t1 · motivo sem_programacao (valor real fora da spec) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_SEM_PROGRAMACAO×4 · falta plano 13.485/13.485 · vigente 29.265/29.265 · oficial regen. 20.728/20.728 |
| 10-26 t1 · controle (dados reais) | OK | fluxo / sim | WIP_NEGATIVO_ESTIMADO×6 · falta plano 11.382/11.382 · vigente 21.065/21.065 · oficial regen. 21.065/21.065 |
| 10-26 t1 · sem apontamento no período c | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×4 · falta plano 18.066/12.585 · vigente 27.361/18.670 · oficial regen. 27.361/18.670 |
| 10-26 t1 · sem apontamento nos 2 últimos períodos fechados | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×22 · falta plano 47.744/14.292 · vigente 54.630/24.512 · oficial regen. 54.630/24.512 |
| 10-26 t1 · sem NENHUM apontamento | OK | vigente / sim | PRODUCAO_NAO_CONFIRMADA×22 · falta plano 77.785/10.265 · vigente 77.785/10.265 · oficial regen. 77.785/10.265 |
| 10-26 t1 · apontamento do período c atrasado (chega 90 min depois) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×4 · falta plano 18.066/12.585 · vigente 27.361/18.670 · oficial regen. 27.361/18.670 |
| 10-26 t1 · apontamento atrasado COM relógio avançado (agora = corte + 120 min) | OK | fluxo / sim | AJUSTE_TARDIO×20 WIP_NEGATIVO_ESTIMADO×4 · falta plano 17.928/17.928 · vigente 24.255/24.255 · oficial regen. 24.255/24.255 |
| 10-26 t1 · lançamento tardio do período c−1 (chega depois do fechamento) | OK | fluxo / sim | AJUSTE_TARDIO×22 WIP_NEGATIVO_ESTIMADO×6 · falta plano 11.382/11.382 · vigente 21.065/21.065 · oficial regen. 21.065/21.065 |
| 10-26 t1 · refugo > produzido na etapa final (boas negativas brutas) | OK | fluxo / sim | WIP_NEGATIVO_ESTIMADO×6 · falta plano 87.337/87.337 · vigente 96.531/96.531 · oficial regen. 96.531/96.531 |
| 10-26 t1 · saldo negativo: etapa seguinte aponta 5× mais que a anterior | OK | base / sim | WIP_NEGATIVO_ESTIMADO×6 · falta plano 519/519 · vigente 1.875/1.875 · oficial regen. 1.875/1.875 |
| 10-26 t1 · apontamento em máquina fora do plano | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×4 WIP_NEGATIVO_ESTIMADO×6 · falta plano 11.382/11.382 · vigente 21.065/21.065 · oficial regen. 21.065/21.065 |
| 10-26 t1 · todos sem_producao falta_material no período c | OK | fluxo / sim | WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_FALTA_MATERIAL×30 · falta plano 17.473/17.473 · vigente 26.800/26.800 · oficial regen. 26.800/26.800 |
| 10-26 t1 · motivo sem_programacao (valor real fora da spec) | OK | fluxo / sim | WIP_NEGATIVO_ESTIMADO×6 SEM_PRODUCAO_SEM_PROGRAMACAO×2 · falta plano 11.382/11.382 · vigente 21.065/21.065 · oficial regen. 21.065/21.065 |
| 10-27 m3 · controle (dados reais) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×8 · falta plano 17.349/17.349 · vigente 28.836/28.836 · oficial regen. 25.807/25.807 |
| 10-27 m3 · sem apontamento no período c | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×4 · falta plano 29.433/18.777 · vigente 47.860/32.881 · oficial regen. 39.544/24.880 |
| 10-27 m3 · sem apontamento nos 2 últimos períodos fechados | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×2 · falta plano 47.281/16.164 · vigente 63.814/30.718 · oficial regen. 52.730/21.449 |
| 10-27 m3 · sem NENHUM apontamento | OK | base / sim | PRODUCAO_NAO_CONFIRMADA×22 · falta plano 136.895/9.488 · vigente 146.515/21.208 · oficial regen. 136.895/9.488 |
| 10-27 m3 · apontamento do período c atrasado (chega 90 min depois) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×20 WIP_NEGATIVO_ESTIMADO×4 · falta plano 29.433/18.777 · vigente 47.860/32.881 · oficial regen. 39.544/24.880 |
| 10-27 m3 · apontamento atrasado COM relógio avançado (agora = corte + 120 min) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 AJUSTE_TARDIO×18 WIP_NEGATIVO_ESTIMADO×8 · falta plano 17.236/17.236 · vigente 31.211/31.211 · oficial regen. 25.949/25.949 |
| 10-27 m3 · lançamento tardio do período c−1 (chega depois do fechamento) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 AJUSTE_TARDIO×18 WIP_NEGATIVO_ESTIMADO×8 · falta plano 17.349/17.349 · vigente 28.836/28.836 · oficial regen. 25.807/25.807 |
| 10-27 m3 · refugo > produzido na etapa final (boas negativas brutas) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×4 · falta plano 57.829/57.409 · vigente 82.858/82.858 · oficial regen. 70.987/70.905 |
| 10-27 m3 · saldo negativo: etapa seguinte aponta 5× mais que a anterior | OK | base / sim | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×10 · falta plano 1.730/1.730 · vigente 9.984/9.984 · oficial regen. 5.390/5.390 |
| 10-27 m3 · apontamento em máquina fora do plano | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×4 WIP_NEGATIVO_ESTIMADO×8 · falta plano 17.349/16.647 · vigente 28.836/27.640 · oficial regen. 25.807/24.611 |
| 10-27 m3 · todos sem_producao falta_material no período c | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×4 SEM_PRODUCAO_FALTA_MATERIAL×28 · falta plano 24.204/24.204 · vigente 47.221/47.221 · oficial regen. 36.451/36.032 |
| 10-27 m3 · motivo sem_programacao (valor real fora da spec) | OK | fluxo / sim | PRODUCAO_NAO_CONFIRMADA×2 WIP_NEGATIVO_ESTIMADO×8 SEM_PRODUCAO_SEM_PROGRAMACAO×2 · falta plano 17.349/17.349 · vigente 28.836/28.836 · oficial regen. 25.807/25.807 |
| MUTAÇÃO do vigente · máquina usada pelo vigente entra em Parada (restrição dura de hoje) | OK | fluxo / não |  · falta plano 24.540/24.490 · vigente 29.265/29.265 · oficial regen. undefined |
| MUTAÇÃO do vigente · funcionário do vigente desativado (fora da equipe produtiva) | OK | fluxo / não |  · falta plano 18.397/18.347 · vigente 29.265/29.265 · oficial regen. undefined |
| MUTAÇÃO do vigente · vigente incompleto (último período sem linhas) | OK | fluxo / não |  · falta plano 13.485/13.485 · vigente 35.466/35.466 · oficial regen. undefined |
| desligado · golden-master da sombra: o PLANO de 36/36 decisões gravadas é reproduzido (hash_plano_sombra); hash_decisao muda onde a correção do f (Pacote G) alterou a falta | OK | — / — |  36/36 (hash_decisao 22/36: muda pela correção do f do Pacote G) |
| desligado · gerarEscala com hooks undefined explícitos == sem os campos (todos os cenários) | OK | — / — |  |
| desligado · hooks vazios ({}) não alteram o plano (remPorPool/ordemPostos/bonus vazios) | OK | — / — |  |
| entrada degenerada: aPartirDe = fim da semana (nada mutável) | OK | — / — |  |
| entrada degenerada: sem pools | OK | — / — |  |
| entrada degenerada: sem funcionários | OK | — / — |  |
| entrada degenerada: quantidade prevista 0 em todos os pools | OK | — / — |  |
| estadoDaProducao isolado em todos os cortes (sem lançar) | OK | — / — |  |

Observações: (1) sem NENHUM apontamento a falta pessimista é enorme (lo) e a otimista pequena (hi) — a faixa é honesta e o plano vigente/base é mantido; (2) o piso 0 aparece com `WIP_NEGATIVO_ESTIMADO` e nenhum par exposto é negativo; (3) o motivo real `sem_programacao` (6 linhas em PROD) agora tem diagnóstico próprio (`SEM_PRODUCAO_SEM_PROGRAMACAO`, zero confirmado, sem inferir material) — **correção 6**; (4) `desligado`: o núcleo não lê a flag — provado que `gerarEscala` sem hooks (ou com hooks vazios) é byte-idêntico.

### 6.1 Efeito do fator de desempenho f (correção 4)

A configuração principal deste relatório já usa f (metas × f embutidas + `fatoresEmbutidos`, como `insumosFluxo`). A tabela compara com a execução SEM f (`FREPLAY_FATOR=0`, metas nominais — a configuração da revisão anterior) sobre o MESMO núcleo v2:

| Fechamento | Δ plano−vigente (sem f) | Δ plano−vigente (com f, principal) | plano (sem f / com f) | falta vigente (sem f → com f) |
|---|---|---|---|---|
| 26/10 M1 | +0 | -3.512 | vigente / base | 31.087 → 32.602 |
| 26/10 M2 | +0 | -2.760 | vigente / base | 31.544 → 32.569 |
| 26/10 M3 | -3.070 | -1.945 | fluxo / fluxo | 26.127 → 19.506 |
| 26/10 T1 | -2.471 | -9.683 | fluxo / fluxo | 26.902 → 21.065 |
| 26/10 T2 | -8.579 | -10.147 | fluxo / fluxo | 29.506 → 25.326 |
| 26/10 T3 | -21.741 | -11.388 | fluxo / fluxo | 43.285 → 31.090 |
| 27/10 M1 | -9.713 | -15.254 | fluxo / fluxo | 32.218 → 34.039 |
| 27/10 M2 | -26.942 | -18.333 | fluxo / fluxo | 45.557 → 35.283 |
| 27/10 M3 | -22.881 | -11.487 | fluxo / fluxo | 40.747 → 28.836 |
| 27/10 T1 | -24.751 | -15.780 | fluxo / fluxo | 40.108 → 29.265 |
| 27/10 T2 | -22.351 | -17.100 | fluxo / fluxo | 41.358 → 32.929 |
| 27/10 T3 | -10.107 | -9.764 | fluxo / fluxo | 28.839 → 29.480 |

Com f o simulador deixa de superestimar a capacidade das etapas que rendem abaixo da meta (Conector ~0,8; M8 ~0,6), de modo que a falta do plano vigente sobe (a realidade é pior que a meta nominal) e os ganhos previstos ficam mais realistas. O f é multiplicado UMA vez: plano vigente gravado com f embutido nas peças é avaliado pela capacidade das metas (teste `fatores.test.ts`).

## 7. Achados — status das correções e riscos residuais

1. **E — corrigido** (`planejar.ts`): o futuro do plano vigente é candidato (`PLANO_VIGENTE_MANTIDO`), válido apenas sem violação dura hoje e completo. Resultado: piora vs vigente válido em 0 de 36 replays (revisão anterior: 3/32 e 5/12 no encadeado). Plano escolhido: {"base":3,"fluxo":33}.
2. **H — corrigido** (mediana 50 / p90 56 linhas, antes 260 / 395): `estabilizarPessoas` aplicado a cada candidato com reavaliação de falta e restrições duras depois; θ = 0 por padrão. Risco residual: o churn que sobra é de POSTOS (reorganização real), e o 1º período mutável ainda muda até 3 linhas.
3. **J — corrigido** (explicação contra o vigente, ganhos aditivos, resumo por período): ver J. Risco residual: ganho sequencial depende da ordem; resíduo máx. 0.09%.
4. **f — corrigido** na integração (`insumosFluxo`): ver 6.1. Risco residual: o f usa a janela de apontamentos visível (n ≥ 3, suavizado n/(n+6)); no início da semana f = 1 e o simulador volta a ser otimista; o f dos pools fundidos é conjunto (convencional+automática), o que supõe que o realizado do convencional vale para o nó fundido. Com f, o plano base do núcleo (`gerarEscala` sobre a entrada com f) pode diferir do que o oficial geraria sem f — por isso o oficial nominal regenerado é reportado à parte (pior que ele em 0/36).
5. **`PoolFundido.demandaComum` — corrigido** (36/36 corretos contra os apontamentos brutos). 6. **`verificarRestricoesDuras` modo `somenteLinhasNovas` — implementado e usado aqui**; **`sem_programacao` — diagnóstico próprio**.
7. **Plano vigente mantido e alertas**: ao escolher o vigente o núcleo devolve exatamente as linhas vigentes (zero churn); `resultado.alertas`/`resumoSlots` vêm do candidato gerado com linhas idênticas (se existe — caso do fluxo reaplicado sobre si mesmo; testado: o 2º recálculo ATIVO com os mesmos dados é NO-OP), senão do `gerarEscala` sobre a entrada; nesse último caso a assinatura de alertas pode diferir da gravada e só a versão do dia sobe (linhas idênticas). Risco operacional baixo.
8. **Hi (otimista)**: sem piora vs vigente válido também no cenário otimista. 9. **Estrutural**: as linhas do Embalar/Etiquetar saem 100% no produto convencional (coerente com a fábrica, muda o que a tela mostra para a automática). 10. **Evidência do simulador é fraca** (backtest 92/330): todos os ganhos são relativos ao modelo; não há contrafactual real.

## 8. Tempo de execução (correção 9)

Medido EM SÉRIE (um processo, sem paralelismo), 108 execuções (36 decisões gravadas × 3): `planejarComFluxo` (candidatos + estabilização + avaliação + explicação) p50 631 ms / p95 877 ms / máx 903 ms; incluindo verificação independente e serialização do diagnóstico (o que o caminho ativo faz por recálculo) p50 633 ms / p95 879 ms / máx 905 ms. Execuções acima de 10 s: 0. Orçamento do `drenar` (maxDuration 60 s): folga ≥ 6×. Carga real do replay: 15 pessoas, ~13 pools, até 30 períodos. Fora desta medida: leitura do estado/gravação no Supabase. Tamanho do diagnóstico JSON (por replay): mediana 251 KB / máx 263 KB.

## 9. Reprodução

```
# 1) extração (somente SELECT em PROD): scripts/escala-fluxo-replay/sql/*.sql  →  <FREPLAY_DIR>/*.sql.out (JSON {rows})
# 2) replays (FREPLAY_DIR padrão = scratchpad/freplay):
npx tsx --tsconfig <tsconfig com alias @/*> scripts/escala-fluxo-replay/replay.ts fechamentos|encadeado|theta|sensibilidade|contrafactual|auditoria|estabilizacao|tempo|tudo [--offset=2]
FREPLAY_FATOR=0 npx tsx ... replay.ts fechamentos          # sem f (comparação 6.1)
npx tsx ... scripts/escala-fluxo-replay/autoteste-independente.ts      # mutação do verificador independente
npx tsx ... scripts/escala-fluxo-replay/relatorio.ts docs/escala-fluxo-criterios-ativacao.md
```

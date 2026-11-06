# Replay do Conector 3/4: modelo atual (2 produtos + fusão) × produto único

Gerado por `scripts/produto-unico/replay.ts` (só leitura do CLONE local de PROD em 06/11/2026; `aplicar` é em memória; nada foi gravado). Corte-v1 com a configuração real de `producao_real_planejador_config` (objetivo EQUILIBRIO, busca 400.000 × 2), margens congeladas como em PROD.

- **ATUAL** = dois produtos legados (Conv + Máquina Automática) com `distribuicao`/fusão do trecho comum, exatamente o caminho de PROD.
- **ÚNICO** = gêmeo canônico dos MESMOS dados: 1 item (Σ das duas rotas), 5 etapas do `produto_canonico` do clone, plano vigente em ids canônicos; apontamentos e contagens ficam em ids legados e são canonizados na leitura (caminho de produção). Margens: as dos produtos legados mapeadas para as rotas (delta de margem da M8 sobre a convencional).
- Instantes: `gera` = segunda 06:00 (semana inteira, sem plano); `meio` = quarta 12:50 com apontamentos, contagens, ausências e plano gravados daquela semana (só semanas com Escala gravada: 19/10 em diante).
- Todas as linhas abaixo são sobre o Conector; os demais produtos da Previsão competem pelas mesmas pessoas nos dois modelos.

## Resultados

| Semana | Instante | Modelo | Plano do planejador | Demanda | Final (Embalar) | M8 | Parafusar | M8 / (M8+Paraf.) | WIP inicial b1/b2/b3 | b2 máx / fim | Cadeia inválida / sem material / viol. duras / duplic. | Revezamento (indep.) | Op. M8 máx |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-12 | gera | ATUAL | usado | 71.700 | 33.500 | 16.100 | 22.000 | 42.3% | 0/0/0 | 3500/3500 | 0/0/0/0 | 0 | 1 |
| 2026-10-12 | gera | PRODUTO ÚNICO | usado | 71.700 | 32.000 | 23.750 | 14.300 | 62.4% | 0/0/0 | 3500/3500 | 0/0/0/0 | 0 | 1 |
| 2026-10-19 | gera | ATUAL | usado | 89.625 | 71.325 | 34.525 | 40.300 | 46.1% | 0/0/0 | 10425/1200 | 0/0/0/0 | 0 | 1 |
| 2026-10-19 | gera | PRODUTO ÚNICO | usado | 89.625 | 74.350 | 35.625 | 41.500 | 46.2% | 0/0/0 | 6575/1100 | 0/0/0/0 | 0 | 1 |
| 2026-10-19 | meio | ATUAL | MANTIDO (falhou) | 89.625 | 29.425 | 17.550 | 32.400 | 35.1% | - | 0/0 | 0/0/0/0 | 9 | 1 |
| 2026-10-19 | meio | PRODUTO ÚNICO | MANTIDO (falhou) | 89.625 | 29.425 | 17.550 | 32.400 | 35.1% | - | 0/0 | 0/0/0/0 | 9 | 1 |
| 2026-10-26 | gera | ATUAL | usado | 116.625 | 74.400 | 29.600 | 44.800 | 39.8% | 0/0/0 | 8325/0 | 0/0/0/0 | 0 | 1 |
| 2026-10-26 | gera | PRODUTO ÚNICO | usado | 116.625 | 74.875 | 31.975 | 44.000 | 42.1% | 0/0/0 | 11625/1100 | 0/0/0/0 | 0 | 1 |
| 2026-10-26 | meio | ATUAL | MANTIDO (falhou) | 116.625 | 59.104 | 7.538 | 16.396 | 31.5% | - | 0/0 | 0/0/0/0 | 2 | 1 |
| 2026-10-26 | meio | PRODUTO ÚNICO | usado | 116.625 | 38.628 | 16.161 | 13.570 | 54.4% | 0/2414/8700 | 4788/2215 | 0/0/0/0 | 0 | 1 |
| 2026-11-02 | gera | ATUAL | usado | 93.300 | 64.925 | 27.225 | 40.000 | 40.5% | 0/0/0 | 7700/1100 | 0/0/0/0 | 0 | 1 |
| 2026-11-02 | gera | PRODUTO ÚNICO | usado | 93.300 | 64.700 | 28.500 | 39.600 | 41.9% | 0/0/0 | 5975/1100 | 0/0/0/0 | 0 | 1 |
| 2026-11-02 | meio | ATUAL | usado | 93.300 | 57.798 | 15.702 | 26.530 | 37.2% | 3224/7216/10756 | 7216/1241 | 0/0/0/0 | 0 | 1 |
| 2026-11-02 | meio | PRODUTO ÚNICO | usado | 93.300 | 58.186 | 16.752 | 25.562 | 39.6% | 3224/7216/10756 | 7216/1050 | 0/0/0/0 | 0 | 1 |

## Como o motor dividiu entre as rotas (produto único, `gera`) — participação da M8 no upstream por dia

- Semana 2026-10-12: total 62.4% M8 (23.750 peças) × 37.6% convencional; por dia: 10-13: 72.5%, 10-14: 60.7%, 10-15: 55.6%, 10-16: 60%
- Semana 2026-10-19: total 46.2% M8 (35.625 peças) × 53.8% convencional; por dia: 10-19: 43.6%, 10-20: 40.7%, 10-21: 50.8%, 10-22: 43.4%, 10-23: 55.6%
- Semana 2026-10-26: total 42.1% M8 (31.975 peças) × 57.9% convencional; por dia: 10-26: 40.4%, 10-27: 30.3%, 10-28: 40.7%, 10-29: 50.8%, 10-30: 51.4%
- Semana 2026-11-02: total 41.9% M8 (28.500 peças) × 58.1% convencional; por dia: 11-03: 43.4%, 11-04: 42.6%, 11-05: 34.5%, 11-06: 49.7%

A proporção NÃO é fixada pelo Forecast e muda de semana para semana e de dia para dia (de ~30% a ~72% da M8 conforme pessoas, ausências e metas); a M8 sozinha tem teto de 1 máquina/1 operador (≈ 28.500 peças em 4 dias de 6 períodos; 35.625 em 5 dias), então 100% M8 só aparece quando a demanda restante cabe nela.

## Leitura

- **Quantidade final / duplicação**: o produto único nunca ultrapassa a demanda (93.300 em 02/11; Σ Conv+Auto das demais semanas) e a Embalagem conta uma vez. Em `gera`, final do ÚNICO vs ATUAL: 12/10 -4,5%, 19/10 +4,2%, 26/10 +0,6%, 02/11 -0,3% — diferenças dentro da variação da própria busca (o ATUAL varia de 57,9k a 65k em 02/11 só mudando semente/orçamento).
- **WIP físico**: em 02/11 `meio` os WIPs iniciais dos 3 buffers são IDÊNTICOS nos dois modelos (3.224 / 7.216 / 10.756): a contagem do buffer comum não é duplicada nem perdida pela agregação M8+Parafusar.
- **Soma da M8 / uso do buffer comum**: a M8 entrega 23,8k–35,6k por semana em `gera` (teto físico), o buffer comum (b2) nunca fica negativo; o pico do buffer comum no ÚNICO é igual ou menor que no ATUAL em 3 das 4 semanas.
- **Revezamento, pessoa/máquina duplicada, cadeia, material, máquina fora da Previsão**: 0 em todas as execuções em que o planejador aprovou o plano (ATUAL e ÚNICO). A M8 nunca tem mais de 1 operador.

## Inconsistências encontradas (honestas)

1. **Valorização do objetivo (bug meu, corrigido)**: a 1ª versão do adaptador substituía TODO o snapshot de margens por apenas as do Conector; os outros produtos caíam no `valorUnitario` e ganhavam pessoas (Conector 94 vs 111 pessoa-períodos em 02/11). Corrigido em `integracaoCorte.ts` (margens dos outros produtos preservadas; margem da convencional/automática vem da rota, do produto canônico ou do produto legado mapeado) e coberto pelo replay: agora 111 × 111 pessoa-períodos e objetivo 13.336 × 13.406.
2. **Replay `meio` de 19/10 e 26/10 não é conclusivo**: nessas semanas o estado de hoje (equipe/ausências/máquinas) já não é o da época e o planejador recusa o plano (`sem plano executável com as pessoas disponíveis (revezamento)`) → plano vigente MANTIDO, com violações herdadas (`funcionario_fora_da_equipe`, `maquina_fora_da_selecao`). É igual nos dois modelos em 19/10; em 26/10 só o ÚNICO conseguiu planejar (acaso da busca, não vantagem comprovada). Não atribuível ao produto único.
3. **12/10 `gera`**: o ÚNICO escolheu 62% M8 (23,7k) contra 42% do ATUAL (16,1k), com final 4,5% menor (32,0k × 33,5k). Com objetivo EQUILIBRIO e margem da M8 maior que a da convencional (delta +0,0198) o mix é sensível; não é erro de cadeia, mas é uma diferença real de mix a acompanhar na primeira semana.
4. **Cadeia (informativo)**: o ATUAL registra `cadeiaCapacidadeExcedida=4` em 02/11 `gera` (check informativo da Camada 1); o ÚNICO registra 0.
5. **EQUILIBRIO não maximiza peças finais**: o número "Final" depende do valor do estoque de saída e das margens; com `MAX_PECAS_FINAIS` os dois modelos ficam equivalentes (02/11: 65.750 ATUAL × 66.275 ÚNICO).

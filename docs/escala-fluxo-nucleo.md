# Escala Inteligente (fluxo) — núcleo puro

Implementa `docs/escala-fluxo-inteligente-spec.md` §1–§5 e §10 (versão do contrato `VERSAO_FLUXO = 2`). Código em `src/features/escala/fluxo/`, testes em `src/features/escala/fluxo/__tests__/`.
Regras de ouro do núcleo: **sem IO** (nada de Supabase/fetch), **sem relógio nem aleatório** (tudo por parâmetro), **sem regra por produto**, restrições duras do motor
**invioláveis** e conferidas por um verificador independente. A flag (`producao_real_modo`), a persistência e o gatilho NÃO estão aqui (Pacote IO).

## 1. API (`index.ts`)

```ts
estadoDaProducao(entrada, dados, opcoes?)            -> EstadoFluxo
avaliarPlano(entrada, dados, alocacoes, opcoes?)     -> AvaliacaoPlano     // a régua única (oficial e inteligente)
planejarComFluxo(entrada, dados, opcoes?)            -> { entradaFluxo, resultado, diagnostico }
verificarRestricoesDuras(entrada, alocacoes, { somenteLinhasNovas?, aPartirDe? }?) -> ViolacaoDura[]   // independente do motor; o modo somenteLinhasNovas NÃO acusa linhas já congeladas
fatoresDeDesempenho(entrada, apontamentos, agoraMs, paresLegado?) / embutirFatores(entrada, f)   // f de desempenho (mesma regra da sombra) embutido nas metas — usado pela integração
explicarMudanca(ctx, referencia, novo, avRef, avNovo, "vigente"|"base")                         // decisões com ganho ADITIVO + reconciliação (usado por planejarComFluxo)
construirGrafo(pools, { paresLegado, ligacoes })     -> Grafo               // modelo lógico dos pools (útil para depurar)
```

**Fator de desempenho f (v2, integração)**: a integração calcula f por pool com `fatoresDeDesempenho` (a mesma regra de `desempenho.ts`/sombra: obs = Σ boas/Σ meta das linhas "produzindo" visíveis até o corte, clamp [0,30; 1,30], suavizado n/(n+6), n<3 ⇒ 1; pools FUNDIDOS do Conector recebem o MESMO f, calculado do realizado conjunto) e o EMBUTE nas metas (`embutirFatores`) informando `opcoes.fatoresEmbutidos`. O núcleo nunca reaplica f nesse caminho (`fatorPorPool` fica de fora): f é multiplicado UMA vez, o motor corta a última linha pelo restante com a capacidade efetiva, e planos gravados — que podem já trazer f embutido nas peças — são avaliados pela capacidade das metas, jamais pelas peças gravadas.

**Convenção de entrada** (a mesma que a Escala oficial usa hoje): `entrada.pools[].quantidade` = Q **semanal previsto**; `entrada.congeladas` = linhas gravadas dos slots
`< aPartirDe` (com o `pecas` planejado); `entrada.aPartirDe` = primeiro slot **não iniciado**; `dados.planoVigente` = todas as linhas gravadas da semana (base de churn/estabilidade e
dos postos "esperados" dos períodos passados); `dados.apontamentos` = tudo o que existe lançado (o núcleo só enxerga `lancadoEmMs <= agoraMs`). O fator de desempenho `f` deve vir
**embutido nas metas** de `entrada.pools` (como `sombraCorte.ts` faz) — nesse caso informe `opcoes.fatoresEmbutidos` (só serve para a checagem de compatibilidade do Conector);
ou passe `opcoes.fatorPorPool` para o núcleo aplicar `f` sobre as metas (não combine os dois).

**Plano base** = `gerarEscala(entrada)` (o que a Escala oficial faria hoje, sobre a entrada recebida). **Plano vigente** = o futuro (slots ≥ `aPartirDe`) de `dados.planoVigente`.
`planejarComFluxo` (v2) nunca devolve plano pior que o base NEM pior que o vigente VÁLIDO pelo simulador, e, se nada for estritamente melhor, devolve exatamente as linhas vigentes (zero churn).

### Opções (`OpcoesFluxo`)
`paresLegado`, `ligacoes` (produto único), `limiarEstabilidadePecas` (θ; **default 0 desde a v2**), `estabilizarPessoas` (default true), `maxIteracoes` (default 4), `fatorPorPool`, `fatoresEmbutidos`, `ponderarPorValor` (default false),
`fluxoMesmoPeriodo` (default true), `incluirTrajetoria` (default true), `incluirMarginais` (default false), `maxDecisoes` (default **500**), `limitesRemPorPool` (só `avaliarPlano`).
Campos acrescentados depois da FASE 0 (todos opcionais/aditivos): `fatoresEmbutidos`, `ligacoes`, `limitesRemPorPool`, `maxDecisoes`, `EstadoProduto.restanteEmAPartirDe`,
`TotaisAvaliacao.{capacidadeDesperdicada, excessoFinal}`, `DiagnosticoFluxo.{decisoesTotal, resumoDecisoes}`, `ResumoDecisao`, `LigacaoProdutos`.

## 2. Estado da produção (`estado.ts`)

Período **fechado**: `fimMs + fechamentoMinutos(10) ≤ agoraMs`. Por (período, máquina, pool):

| estado | quando | `boas` (lo, hi) |
|---|---|---|
| `confirmado` | há linha `produzindo` | (Σboas, Σboas) — `boas` nunca negativa |
| `zero_confirmado` | só linhas `sem_producao` | (0, 0); `falta_material` ⇒ diagnóstico `SEM_PRODUCAO_FALTA_MATERIAL` |
| `nao_confirmado` | período fechado, máquina planejada no plano vigente, **nenhuma** linha da máquina | (0, planejado) ⇒ `PRODUCAO_NAO_CONFIRMADA`. Nunca assume o planejado |
| `futuro` | período não fechado | (0, 0); linhas já lançadas (parciais) contam como **produção real** (lo = hi) |

* Refugo: o apontamento já traz `boas = produzida − refugo`. Refugo intermediário não vira WIP; refugo final não reduz a meta final.
* Lançamento depois do fechamento do período: `tardio` + `AJUSTE_TARDIO`; entra no estado, não reescreve nada (só pesa nos períodos futuros).
* Máquina com linha em outro pool que o planejado: vale o pool apontado (`APONTAMENTO_FORA_DO_PLANO`).
* **Etapa final** = maior `ordemEtapa` do produto (empate ⇒ `ETAPA_FINAL_AMBIGUA`). Só ela reduz a demanda final: `R_f = max(0, Q_f − B_f,lo)`.
* **WIP do par k→k+1**: estimado `W_lo = max(0, B_k,lo − B_k+1,hi)`, `W_hi = max(0, B_k,hi − B_k+1,lo)`; confiança `media` (nenhum não confirmado e sem
  inconsistência) ou `baixa`. Saldo estimado negativo **mesmo no melhor caso** (`bruto.hi < 0`) ⇒ piso 0 + `WIP_NEGATIVO_ESTIMADO` (negativo só no `lo` é incerteza normal, sem diagnóstico).
  Saldo **confirmado** (`dados.wipConfirmado`): `lo = saldo`, `hi = max(saldo, W_hi estimado)`, origem `confirmado`, confiança `alta`. Decisão conservadora: o confirmado é o piso;
  a produção nova da origem desde a confirmação só entra no teto (hi) — nunca é misturado em silêncio (a origem fica marcada).
* **Projeção até `aPartirDe`**: o fechado + o que as linhas congeladas (período em andamento / comprometido) ainda produzem (capacidade meta×f das linhas sem apontamento).
  É isto que o motor enxerga (`EstadoFluxo.projecao`), pois o rem legado também desconta os créditos congelados.

## 3. Demanda de fluxo → `remPorPool` (`estado.ts › calcularDemanda`)

No grafo (§6), para cada nó n com sucessor `m` pela aresta `e` (peso `s_e`, 1 em cadeia simples), com `W` = estoque projetado em `aPartirDe`:

```
Need_f   = R_f = max(0, Q_f − B_f,lo)                         (nó final)
Need_n   = max(0, s_e · Need_m − W_e,lo)                       (= R_f − Pipe_n,lo em cadeia)
CapDown_n = min(capFutura(m), CapDown_m)                       (capacidade das etapas seguintes, ignora pessoas)
Teto_n   = capacidade de 1 período do nó n (máquinas disponíveis; se 0, todas as selecionadas ⇒ nunca zero)
Allowed_n = max(0, ConsumoDownstream_n + Teto_n − Pipe_n,hi)
rem_n    = min(Need_n, Allowed_n)        (nó final: R_f)
```
`ConsumoDownstream_n = max(s_e·CapDown_n, CapDown_n − Σ reivindicações dos ramos irmãos)`; a reivindicação de um ramo irmão = o que ele consegue entregar (estoque_hi + produção
possível, limitada à sua demanda), no máximo a sua parte proporcional da capacidade ⇒ a divisão proporcional é o **piso**, e um ramo que não consegue usar a sua parte libera o resto.
`Pipe_hi` = estoque à frente do nó, inteiro (conservador). O resultado vai para `EntradaEscala.remPorPool` (rep. do nó; membros não-representantes fundidos saem com 0).

## 4. Simulador de fluxo (`simulador.ts`, `avaliar.ts`) — a régua única

Por grupo (componente conexo do grafo), slot a slot, nós em ordem topológica:
`x = real + base + adicional`, cada parcela ≤ material disponível (W das arestas de entrada **+ produção da etapa anterior no mesmo período** quando `fluxoMesmoPeriodo`), `base` ≤
restante previsto do nó (`Q − B` ou o `rem` explícito do plano de fluxo), e no nó final ≤ falta para a meta. O consumo sai das arestas proporcionalmente ao disponível; o **legado**
(estoque inicial) é consumido primeiro (FIFO). Capacidade de uma linha = meta do período × f (não o `pecas` gravado — assim plano oficial e inteligente são medidos igual);
linhas só de carga adicional usam `min(meta×f, pecasAdicional)`.
Dois cenários com a mesma função: **lo** (pessimista: boas e WIP no limite inferior — usado para consumir WIP e para a falta) e **hi** (otimista — usado para o excesso de WIP).

`AvaliacaoPlano`: final entregue / falta final (lo, hi), WIP final por par, WIP legado residual, excesso de WIP (> `max(W0_hi, Teto)` do par), gargalo de fluxo
(`potencial = (capacidade futura do plano + estoque) / peso do caminho + estoque além` ⇒ menor potencial; `folga = potencial − R_f`), `capacidadeDesperdicada`, `excessoFinal`,
trajetória do WIP por slot, e `postos[]` = **peças finais atribuíveis a cada posto** (remoção marginal re-simulada; só os de contribuição > 0).

## 5. Planejar com fluxo (`planejar.ts`, `otimizar.ts`, `explicar.ts`)

1. `base = gerarEscala(entrada)`; `P0 = gerarEscala(entrada + remPorPool)`; `vigente = linhas de dados.planoVigente em slots ≥ aPartirDe`.
2. Iteração `i = 1..maxIteracoes`: **varredura cronológica por contagens** (`otimizar.ts`): para cada slot ≥ `aPartirDe`, dado o resto do plano (slots anteriores já atualizados),
   escolhe por guloso com re-simulação exata os postos (nó + máquina menos disputada) de maior ganho em peças finais (cenário lo) até acabar as pessoas disponíveis; só troca as contagens
   anteriores se o valor total do slot melhorar (nunca piora). Captura a complementaridade etapa anterior × seguinte. As contagens viram `ordemPostos.valorMarginal`
   (o k-ésimo posto do nó vale o ganho de removê-lo; fora das contagens 0) e o motor decide pessoas/rotação/máquinas. Para por convergência ou hash repetido.
3. **Candidatos** = plano vigente mantido (`indice -2`, só se VÁLIDO: 0 violação dura HOJE pelo `verificarRestricoesDuras` — funcionário desativado/ausente, máquina em Parada etc. descartam — e COMPLETO: as mesmas pessoas por slot mutável que o motor escalaria; senão `PLANO_VIGENTE_DESCARTADO`), base (`-1`), P0 e as iterações.
4. **Estabilização de pessoas (v2)**: cada candidato gerado passa por `estabilizarPessoas` (o mesmo mecanismo do modo restrito, `estabilidade.ts`: atribuição de custo mínimo por período mantendo a pessoa no mesmo posto do vigente,
   respeitando revezamento duro e trocas manuais) ANTES de ser avaliado; falta e restrições duras são **reavaliadas depois**, e a re-atribuição é descartada (`ESTABILIZACAO_DESCARTADA`) se piorar a falta ou criar violação. Mesmos postos, mesma falta, menos linhas alteradas.
5. Elegível = **0 violação dura** **e** falta final lo ≤ min(falta do base, falta do vigente válido). Escolhe-se a menor tupla J (lexicográfica, tolerância 1e-6 nas faltas, 1 peça nas demais):
   `[falta_lo (ou ponderada), falta_hi, −capacidadeGargalo, wipLegadoResidual, excessoWip, capacidadeDesperdicada, churn]`. Desempate: vigente (churn 0) > base > fluxo — só se troca por candidato **estritamente** melhor. O vigente escolhido
   volta como as MESMAS linhas gravadas (sem churn, para o NO-OP do recálculo). Um candidato gerado cujas linhas são idênticas às vigentes É o vigente (`planoEscolhido = "vigente"`): seus `alertas`/`resumoSlots` são devolvidos junto, de modo que a assinatura de alertas do recálculo anterior se repete; se nenhum candidato coincide (vigente produzido por outra via), valem os do base.
6. **θ**: `bonusContinuidade[aPartirDe][maq|pool] = θ` para os postos do plano vigente no 1º período mutável. **θ padrão = 0 (sem retenção)**: medido nos dados reais de PROD (docs/escala-fluxo-criterios-ativacao.md §4), reter por θ só custa peça final e quase não reduz o churn — o churn estava nas PESSOAS, e a re-atribuição resolve isso de graça. θ > 0 continua disponível (`limiarEstabilidadePecas`). Restrição dura ignora θ.
7. **Diagnóstico (item 35, v2: CONTRA o plano vigente)**: `referencia` ("vigente", ou "base" se não há vigente futuro), `vigente` (disponível/válido/motivo/falta), `estabilizacao`, `antes` (R_f, rem legado, WIP, gargalos e falta DO VIGENTE),
   `decisoes` (grupos período × posto de→para, ganho **aditivo** por marginal sequencial cronológico: o simulador é re-executado a cada decisão aplicada sobre a capacidade do vigente; `wipConsumido`/`wipEvitado`/`wipFinalVariacao` da mesma re-simulação),
   `decisoesTotal` + `resumoDecisoes` (por pool de→para E por período `porSlot`; cobrem 100% das linhas alteradas mesmo se a lista for limitada por `maxDecisoes`), `reconciliacao` (final do plano − final do vigente = Σ ganhos + `residuo` explícito: teto de demanda `rem` e quantidades em postos mantidos),
   `depois`, `depoisBase`, `depoisVigente`, `churn`, `iteracoes` (tuplas; `-2` = vigente, `-1` = base), `violacoes`, `estado`, `avaliacaoBase`, `avaliacaoFluxo`, `diagnosticos`. Tudo JSON puro (testado: sem NaN/Infinity). `incluirTrajetoria:false` e `maxDecisoes` reduzem o tamanho.

## 6. Grafo, Conector legado e produto único (`grafo.ts`)

Cada pool é um nó; o nó k liga ao k+1 do mesmo produto (aresta com `chavePar = "produto|etapaOrigem"`). Dois adaptadores, ambos puros:

* **Conector legado** (`ParLegado`, spec §5): as etapas comuns (Etiquetar, Embalar) dos dois produtos são **fundidas num nó** (membros[]) se, para cada uma: mesma `operacaoId`, mesmo conjunto
  de máquinas, metas compatíveis (tolerância 1%, comparadas sobre as metas **nominais** = meta / `fatoresEmbutidos`), e forem o **sufixo** das duas cadeias. Os trechos exclusivos
  (Rosquear/Parafusar; Máquina 8) alimentam o nó comum com peso `Q_ramo/ΣQ`; demanda comum `R_f,total = Q_conv + Q_auto − boas (conv + auto)` no corte (`PoolFundido.demandaComum` desconta as boas desde a v2); WIP por ramo
  `W_b = f(B_exclusivo_b − s_b·B_comum)` (estimado, proporcional). Linhas do pool fundido saem no produto convencional (`remPorPool` do membro automática = 0). Qualquer condição falha ⇒
  **tudo legado** + `PRODUTO_EM_COMPORTAMENTO_LEGADO` (aviso; "info" se só um dos produtos está na Previsão). Nada altera apontamentos.
* **Produto único** (F#CONV / F#AUTO / F#COMUM, desenho de 02/11, `src/features/rotas` ainda não existe nesta branch): `opcoes.ligacoes = [{produtoOrigemId, produtoDestinoId}]` liga a última
  etapa de um produto à primeira de outro; o WIP dos dois trechos exclusivos alimenta o pool comum e há uma única demanda final. Testado com ids sintéticos nesse formato.

## 7. Hooks aditivos do motor (`gerarEscala.ts`, `types.ts`)

Todos opcionais; **ausentes (ou vazios) ⇒ saída byte-idêntica** (golden: `golden.test.ts` compara com a cópia congelada `__tests__/gerarEscalaAntes.ts` em todos os `cenariosGolden`,
nos instantâneos reais de PROD e reproduz os `hash_decisao`/`hash_plano_sombra` gravados).
* `remPorPool: Record<"produto|etapa", number>` — rem explícito no 1º slot mutável; substitui `Q − créditos congelados` (não abate crédito planejado); chave ausente = regra antiga.
* `ordemPostos.valorMarginal[slot]["produto|etapa"][n]` — valor marginal do n-ésimo posto do pool; passa a ser o **1º critério** de seleção (maior valor; empate ⇒ ordem legada gargalo → folga → valor → …).
* `bonusContinuidade[slot]["maquina|produto|etapa"]` — somado ao valor marginal do posto vigente (só com `ordemPostos` ou sozinho).

## 8. Limites e escolhas conservadoras

* 1 peça de entrada = 1 peça de saída; sem lead time dentro do período além do flag `fluxoMesmoPeriodo` (com `false`, a conclusão dos replays se mantém, com ganho menor).
* Capacidade por posto = meta×f; pessoas, setup e quebras não-registradas não entram no simulador (as pessoas são decididas pelo motor).
* Os ganhos reportados são **relativos ao modelo** (o plano de fluxo é otimizado contra o simulador): usar para comparar planos, não como previsão absoluta.
* Estoque inicial de semana desconhecido ⇒ não inventado (WIP negativo ⇒ piso 0 + diagnóstico). Saldo confirmado é só piso.
* Pool final = maior `ordemEtapa` (não consulta as RPCs do Apontado Real). Linhas congeladas entram pela capacidade, não pelo `pecas` (os congelados do sombra têm `pecas = 0`).
* A camada de carga adicional/WIP do motor permanece como está; suas linhas entram na avaliação como capacidade adicional.
* θ padrão = 0 (v2); a calibração foi feita por replay de PROD.
* Desempenho: ver docs/escala-fluxo-criterios-ativacao.md §8 (medido em série com a carga real; p50/p95/máx por recálculo).
* O vigente é candidato "tudo ou nada": se uma só linha vigente viola a restrição dura de hoje, o vigente inteiro é descartado (o plano novo sempre respeita as restrições).
* `sem_producao` com motivo `sem_programacao` (valor real de PROD fora da spec original) é zero confirmado com diagnóstico próprio `SEM_PRODUCAO_SEM_PROGRAMACAO`; não infere falta de material.

## 9. Como depurar um diagnóstico

1. `diagnostico.planoEscolhido`: `vigente` = nenhum candidato foi estritamente melhor que o plano em vigor (`PLANO_VIGENTE_MANTIDO`, saída = linhas vigentes); `base` = o regenerado foi estritamente melhor (ou não há vigente futuro; ver `iteracoes[].tupla` e `PLANO_BASE_MANTIDO`); `fluxo` = `iteracaoEscolhida`.
2. `estado.demanda[]`: por pool `remLegado` × `demandaFluxo` (Need) × `tetoUtilidade` (Allowed) × `remFluxo`. `limitadoPorUtilidade` + `TETO_UTILIDADE_APLICADO` explicam um pool "frio".
3. `estado.pares[]`: WIP `lo/hi`, `origem`, `confianca`, `bruto` (antes do piso). `WIP_NEGATIVO_ESTIMADO` = dado inconsistente (investigar apontamento/estoque inicial).
4. `estado.celulas[]` filtrando `estado = nao_confirmado` mostra o que ficou sem apontamento (a incerteza do `lo/hi`); `tardio = true` = lançamento atrasado.
5. `avaliacaoBase` × `avaliacaoFluxo`: `totais`, `produtos[].gargaloFluxo`, `trajetoria` (WIP por slot) e `postos` (quem produz peça final). Rode `avaliarPlano(..., { incluirMarginais: true })` para ver o valor marginal por slot/pool/n.
6. `decisoes[]` / `resumoDecisoes[]`: de→para (o `de` é o posto no plano VIGENTE) e o motivo; `reconciliacao` fecha a conta do ganho; `estabilizacao` mostra quantas linhas a re-atribuição de pessoas poupou; `vigente` explica por que o plano em vigor foi ou não candidato.
7. `violacoes` deve ser vazio; qualquer item é bug (o candidato seria descartado — ver `VIOLACAO_RESTRICAO_DURA` nos diagnósticos).
8. Reproduzir: o par `(entrada, dados, opcoes)` é determinístico — `planejarComFluxo` duas vezes dá o mesmo JSON.

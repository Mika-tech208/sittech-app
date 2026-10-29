# Fonte econômica da tela Produtos: rastreio, reprodução e validade para a Escala

Base: `main = 6bb8d3b` (= PROD) + módulo novo na branch `feat/escala-economia-dados`. PROD só com SELECT (29/10/2026 ~07:48 BRT). Prova numérica: `src/features/economia/__tests__/economiaProduto.test.ts` (16 testes passando) com fixture `src/features/economia/__fixtures__/prod-2026-10-29.json` (dados reais agregados: sem salários individuais nem linhas de custo).

## 1. Rastreio exato (tela Produtos)

| Coluna da tela | Onde é calculada | Fórmula | Origem no banco |
|---|---|---|---|
| **Valor recebido** | `ProdutosPage.tsx` renderiza `formatBRL(p.valorUnitario)`; `useProdutos.ts` (`linhaParaProduto`) | valor cadastrado, sem cálculo | `produtos.valor_unitario` (vivo) |
| **Custo de produção** (por peça) | `calcularMargem(p)` → `calcularMargemProduto` → `calcularIndicadoresProducao` (`src/features/custo-hora/calculations.ts`) | Σ por etapa de `tempoPorPeça × custoHora(operação)`; `tempoPorPeça = Σ duração dos períodos com meta>0 / Σ metas desses períodos` | `roteiro_etapas.meta_m1..meta_t3`, `periodos` (início/fim), custo/hora abaixo |
| **Margem** (R$ e %) | `calcularMargemProduto` | `valor − custo`; `% = margem / valor × 100` (tela mostra `toFixed(0)`) | idem |
| **Lucro/hora** | `calcularMargemProduto` | `margem / Σ tempoPorPeça` (horas de operador por peça final) | idem |
| **Custo/hora da operação** | `calcularCustoHoraEOperacoes` | por funcionário ativo: `(salário+extras)/horas produtivas + rateio fixo/h`; operação = média dos ativos; **operação sem ativo = custoHoraEmpresa** | `funcionarios.salario_base,ativo`, `funcionario_custos.valor`, `fixed_costs.valor,ativo`, `configuracoes_empresa.dias_uteis`, `periodos` |
| **Custo/hora da empresa** | idem | `(Σ folha ativa + Σ fixos ativos) / (Σ horas dos períodos × dias_uteis × nº ativos)` | idem |
| **Metas por período (M1..T3)** | `ProdutosPage.tsx` monta `metasTexto` de `periodos` × `e.metas` | exibição | `roteiro_etapas.meta_*` via `useProdutos` (select com `meta_m1..meta_t3`) |
| **Máquinas/postos** | `ProdutosPage.tsx`: `maquinas.filter(m ∈ e.maquinasIds)` | exibição | `roteiro_etapa_maquinas` (máquinas **elegíveis** da etapa) + `maquinas.nome` |

Dependências: hooks `useCadastrosBase` (períodos, dias úteis), `useFuncionarios`, `useMaquinas`, `useProdutos`, `useCustos` (nesta ordem). Não há RPC no caminho da tela. O mesmo cálculo é usado por Previsão (`PrevisaoSemanalPage`: `getLucroHora`), Capacidade e Custo por Hora. `valor_atribuido` (paradas) é outra coisa (RPC de valor da parada), não entra aqui.

Existem **duas cópias da fórmula do custo/hora**: a TypeScript acima e a SQL dentro de `registrar_apontamento_producao` (e `vincular_ocorrencias_retroativo`), que grava `apontamentos_producao.custo_hora_operacao_vigente`. Conferência cruzada: o valor TypeScript hoje (31,92204) é igual ao snapshot SQL mais recente (31,9220). Na branch `origin/feat/escala-producao` o servidor carrega o custo com `src/lib/custo/custoHoraDados.ts`, que reutiliza a função TypeScript (sem terceira cópia).

## 2. Reprodução numérica (tabelas de PROD → fórmula do código → tela)

Custo/hora da empresa calculado: **31,92204** (mão de obra 21,578 + rateio de fixos 10,344); folha ativa R$ 62.068,75 / 15 ativos; fixos ativos R$ 29.755; 8,7167 h/dia × 22 dias = 191,767 h/pessoa/mês.

| Produto | Tela: valor / custo / margem / lucro-h | Calculado: custo / margem % / lucro-h | Erro abs. do lucro-h | Observação |
|---|---|---|---|---|
| Automática | 0,18 / 0,06 / 65% / 60,17 | 0,06309 / 65,34 / 60,1716 | 0,0016 | |
| Pino | 0,07 / 0,03 / 63% / 54,81 | 0,02576 / 63,19 / 54,8084 | 0,0016 | |
| Caixa Amarela | 0,22 / 0,09 / 58% / 44,13 | 0,09108 / 58,03 / 44,1317 | 0,0017 | |
| Plug Macho | 0,10 / 0,04 / 57% / 43,04 | 0,04216 / 57,41 / 43,0378 | 0,0022 | |
| Conector 3/4 conv. | 0,18 / 0,08 / 54% / 37,31 | 0,08415 / 53,89 / 37,3094 | 0,0006 | |
| Conector 1.1/4" | (fora do recorte) | 0,27651 / 24,24 / 10,2159 | n/d | tela deve mostrar 0,28 / 24% / 10,22 |

Todos os erros são menores que meio centavo (a tela exibe 2 casas): **reprodução exata**. Os testes exigem a igualdade dos valores formatados e, para todos os produtos com roteiro, igualdade bit a bit com `calcularMargemProduto`.

## 3. Por que custo/peça e lucro/hora variam, e o que é constante

- **Constante**: o custo/hora (31,92). Só a operação "Produção" tem funcionários ativos (15); nenhuma etapa de roteiro se chama "Produção". Pelo código, operação sem ativo usa `custoHoraEmpresa`, então **todas as etapas de todos os produtos custam o mesmo R$/h**. Provado em teste (`custoHoraPorOperacao` só tem a chave "Produção"; `custoHoraAplicado` = 31,92 em todos).
- **Varia**: `T` = Σ tempo/peça das etapas (horas de operador por peça final). `custo/peça = 31,92 × T`; `lucro/h = valor/T − 31,92`.
- O que entra na "cadeia": **todas** as etapas do `roteiro` somadas, 1 operador por etapa, sem ordem, sem gargalo, sem paralelismo, sem número de máquinas, sem rota. O tempo/peça vem da meta (peças por período): `Σ duração / Σ metas`. Etapa sem nenhuma meta>0 é ignorada em silêncio (custo 0): o módulo novo sinaliza `etapa_sem_meta`.
- Exemplos (h de operador por 1.000 peças = T): Pino 0,807 (1 etapa); Automática 1,976 (3 etapas, uma delas "Rosquear+Parafusar" conta como UMA etapa); Conector conv. 2,636 (4 etapas); Conector 1.1/4" 8,662 (metas baixas: Rosquear 337/h, Embalar 175/h).

| Produto | T (h/1.000 pç) | Receita/h = valor/T | Lucro/h = receita/h − 31,92 |
|---|---|---|---|
| Automática | 1,976 | 92,09 | 60,17 |
| Pino | 0,807 | 86,73 | 54,81 |
| Caixa Amarela | 2,853 | 76,05 | 44,13 |
| Plug Macho | 1,321 | 74,96 | 43,04 |
| Conector conv. | 2,636 | 69,23 | 37,31 |
| Conector 1.1/4" | 8,662 | 42,14 | 10,22 |

## 4. O indicador serve para decidir a alocação marginal da próxima pessoa/hora?

**Parcialmente.** Condições verificadas:

1. **Custo/h fixo é afundado na semana**: folha CLT e fixos não mudam com o mix. Para a decisão marginal o que importa é a receita que a hora gera; o 31,92 é irrelevante. (Só deixa de ser irrelevante com hora extra, contratação ou temporário.)
2. **Preserva o ranking?** Sim, **enquanto** o custo/h for igual para todas as etapas: `lucro/h = receita/h − k`. Hoje é igual (provado). Deixa de preservar se alguém cadastrar funcionários por operação (aí o custo médio aplicado muda por produto) ou se entrar custo variável por peça `v`: `(p−v)/T − c`.
3. **Onde NÃO vale** (mesmo com k constante):
   - **O recurso escasso é uma máquina, não a hora do operador da cadeia.** Valor por hora da *máquina*: preço × meta da etapa. Exemplo real: Etiquetadora 16 é compartilhada. Caixa Amarela rende R$ 351/h nela; Conector 3/4 rende R$ 408/h. O ranking pelo lucro/h da cadeia (Caixa 44,13 > Conector 37,31) **inverte** o ranking por hora de E16. O mesmo vale para Embalagem 17 (única) e Rosqueadeira 7.
   - **Cadeias com número de operadores por peça diferente do suposto** (1 por etapa): a fórmula não vê 2 pessoas num posto nem 1 pessoa em 2 máquinas. A Automática é tratada como 1 etapa/1 operador; é premissa **não verificada** que um operador atende a máquina o tempo todo.
   - **Posto produzindo × ocioso**: o critério "lucro/h > 0" rejeitaria um produto com receita/h < 31,92 que, com a equipe já paga e ociosa, ainda traz receita. Hoje o menor é 42,14, então não muda nada; é um limite a conhecer.
   - **Limites de demanda e capacidade**: ranking por razão não resolve alocação com vários recursos compartilhados (é um problema de otimização, não ordenação).
   - **Nominal × real**: metas são cadastro manual; a produtividade real difere (ex.: Conector conv. 64 vs 69 R$/h).
4. **Custo por máquina vs por pessoa**: o sistema não tem custo de máquina ("Decisão 14"); o custo é por pessoa-hora. Para o motor, usar **receita por peça final**, restrições de capacidade/equipe do motor e, se quiser desempate econômico, receita/h por recurso escasso, nunca a soma de "preço × meta" entre etapas.

Conclusão: o indicador "lucro/h" da tela é um bom rótulo de **receita por hora de operador da cadeia** (com um deslocamento constante) e **não é custo variável nem margem de contribuição**. Para decisão marginal use receita (valor congelado do item); o custo da tela serve para análise de absorção, não para a decisão.

## 5. Metas: o motor lê a mesma fonte?

**Sim, provado por código.** Tela: `useProdutos.ts` seleciona `roteiro_etapas(... meta_m1, meta_m2, meta_m3, meta_t1, meta_t2, meta_t3 ...)`. Motor: `supabaseIO.ts` define `META_COLS = "meta_m1, ... meta_t3"`, lê `roteiro_etapas` e `montarEntrada.ts` copia `metas: { ...etapa.metas }` para `pool.metas`. Há teste de contrato que lê esses três arquivos (falha se alguém criar fonte paralela). Diferença legítima nas **máquinas**: a tela mostra as elegíveis (`roteiro_etapa_maquinas`); o motor usa as escolhidas na semana (`previsao_item_maquinas`) filtradas pelas elegíveis. O preço do motor é `previsao_itens.valor_unitario` (congelado), não `produtos.valor_unitario`.

## 6. Fonte única

Antes: existia função pura compartilhada (`calcularMargemProduto`/`calcularCustoHoraEOperacoes`), mas **sem carga de dados única** (cada tela monta com seus hooks; o servidor só na branch das rotas) e sem contrato de saída para o motor.

Entregue (branch, sem migration, sem publicar): `src/features/economia/economiaProduto.ts`
- `economiaProduto(produtoId, contexto)` e `prepararBaseEconomia` + `economiaProdutoCom` (vários produtos) → `{ valorRecebido, custoProducao, margem{rs,pct}, lucroHora, tempoTotalHoras, receitaHora, custoHoraAplicado, usaFallbackEmpresa, avisos, origem, formula, versao }`. Sem roteiro: `calculavel=false` e nulos (a tela mostra "—").
- Zero fórmula nova: delega às funções da tela. `margemDoProduto` é o ponto de entrada compartilhado.
- A tela Produtos agora chama `margemDoProduto` (mudança de 2 linhas, delegação pura; golden: saídas bit a bit idênticas, `tsc` sem erros novos). Não publicado.
- Observação de ambiente: o `vitest` padrão (jsdom) não sobe os workers nesta máquina (nem para testes antigos); rodei com config temporária `environment: node` (não commitada). O arquivo de teste declara `@vitest-environment node`.

## 7. Congelamento semanal

Hoje:

| Dado | Congelado? | Onde |
|---|---|---|
| Valor recebido | Sim (item da Previsão) | `previsao_itens.valor_unitario`; `apontamentos_producao.valor_unitario_produto_vigente` |
| Custo/hora no apontamento | Sim | `custo_hora_operacao_vigente` (+ `custo_operacional_periodo_vigente`, `custo_unitario_referencia_periodo_vigente`, `meta_periodo_vigente`); 4 valores distintos entre 30,17 e 31,92 desde 08/09 |
| Entradas da Previsão do plano (itens com preço, equipe, dias, indisponíveis) | Sim, por versão de plano | `escala_plano_versoes.entrada` (jsonb) + `hash_plano`; **não** guarda metas/etapas nem custo |
| Metas por período | Só nos apontamentos | `apontamentos_producao.meta_periodo_vigente`; o plano da Escala relê `roteiro_etapas` ao vivo |
| Custo/margem/lucro-h nas telas e em `previsao_itens` | **Não** | recalculados ao vivo |

Muda retroativamente nas telas se alguém editar: salário/extras, desligar ou admitir (já ocorreu: 30,17 → 31,92), custos fixos (ativar/pausar/valor), `dias_uteis`, períodos (horários), metas, `produtos.valor_unitario`. Os indicadores históricos (`economico.ts`) usam preço vivo (limitação documentada).

Desenho proposto (sem migration aplicada):
1. `produto_economia_versoes` (append-only): `id, produto_id, vigente_de, valor_recebido, tempo_total_horas, custo_producao, custo_hora_empresa, rateio_fixo_hora, mao_obra_hora, metas_hash, entrada_hash, formula_versao, origem, criado_em`. Nova linha só quando `entrada_hash` mudar.
2. `previsao_itens`: coluna `economia_versao_id` (FK, nula = não congelado), preenchida na criação do item/primeira leitura da semana, como já é o preço. Semana antiga nunca é recalculada.
3. A Escala lê a versão do item (receita/h, e custo de absorção apenas informativo) em vez de recalcular; `metas_hash` na versão permite detectar que a meta mudou depois do congelamento (hoje o plano relê as metas ao vivo).
4. Se vier custo variável: `produto_custo_variavel_versoes` (ver `docs/escala-economia-dados.md` §6).

## Riscos e pendências

- Rótulo: "lucro/hora" da tela é lucro por **absorção** (folha + fixos, pró-labore e aluguel inclusos); não usar como lucro nem como contribuição.
- Premissa de 1 operador por etapa/posto e da Automática como 1 operador contínuo: confirmar com o usuário.
- A cópia SQL do custo/hora pode divergir da TypeScript se uma delas mudar sem a outra: criar teste de paridade antes de qualquer mudança.
- Fixture é de 29/10; refazer após mudanças de equipe/fixos.

# Escala Inteligente (fluxo) — preservação da atingibilidade da meta semanal

Regra GERAL (nenhum `if produto == ...`) do núcleo `src/features/escala/fluxo/` (`otimizar.ts`, `atingibilidade.ts`, `planejar.ts`, `avaliar.ts`). **Default desligado**: sem a flag a saída é byte-idêntica (golden). A quantidade da Previsão é COMPROMISSO, não referência.

## 1. Formalização

Por **grupo** (cadeia de etapas até um produto final; o Conector fundido tem os dois produtos), com `Q` = meta semanal, `B` = boas finais já entregues (cenário pessimista `lo`), `t` = período:

* **Máximo possível** `M_g(t)` = final alcançável (simulador de fluxo, `lo`) se, a partir de `t` (inclusive), TODAS as máquinas disponíveis de TODAS as etapas trabalharem em TODOS os períodos restantes. WIP/material (contagem física/confirmado + produção upstream, no mesmo período), gargalo upstream, dias e períodos restantes limitam; **pessoas não limitam** (cota superior). Meta **atingível** ⇔ `M_g ≥ Q`; **falta inevitável** = `max(0, Q − M_g)`.
* **Produção obrigatória agora** = `max(0, M_g(t) − alcance com ZERO postos em t)` (restante_final − capacidade_máxima_DEPOIS no último elo isolado).
* **Postos mínimos agora**: menor conjunto de postos por etapa em `t` que mantém `alcance(t, depois no máximo) ≥ M_g(t)`. Último elo isolado: `ceil(max(0, restante − capacidade_máxima_depois) / capacidade_por_posto)` (`postosMinimosUltimoElo`); no fluxo é achado por re-simulação exata (parte do máximo e **poda**: remove postos, etapas finais primeiro, enquanto o alcance se mantém).
* **Prioridade global** quando os mínimos de todos os grupos não cabem nas pessoas/máquinas do período: só metas **atingíveis** reservam postos; ordem = maior falta relativa `(Q−B)/Q`, depois ordem estável. O que sobrar fora vira `META_NAO_ATINGIVEL` (`status = META_EM_CONFLITO`). Metas fisicamente inatingíveis NÃO reservam postos (seguem o ganho de peças finais) e ganham `META_NAO_ATINGIVEL` (`status = META_NAO_ATINGIVEL`, com `maximoPossivel` e `faltaInevitavel`).

## 2. Função objetivo (J)

HARD (disponibilidade, revezamento, 1 pessoa/posto, 1 máquina/período, roteiro, WIP/material) → **1. atingibilidade** (tupla `[nº de metas atingíveis que o plano NÃO entrega, Σ falta evitável/meta]`) → 2. final entregue (falta total) → 3. gargalo → 4–5. WIP → 6. estabilidade (churn). Elegibilidade do candidato: sem violação dura, tier 1 nunca pior que a melhor referência (base / vigente válido) e falta total ≤ referência **a menos que** o tier 1 melhore estritamente. Peças absolutas deixam de decidir sozinhas entre produtos.

Implementação: `varrerContagensPreservando` (por período, cronológico): (1) alvo `M_g(t)` por grupo atingível; (2) postos mínimos (poda); (3) guloso de peças finais com as pessoas que sobram (igual ao anterior); (4) aceita o período só se o déficit de atingibilidade melhora, ou empata e as peças melhoram. `tabelaMarginal(.., minimos)` soma `OFFSET_TIER1 = 1e7` ao valor marginal dos postos mínimos, de modo que o motor (`ordemPostos.valorMarginal`) os escolhe antes de qualquer posto "mais rentável". `gerarEscala` não foi alterado.

## 3. Flag e rollout (sem migration)

`escala_parametros.producao_real_atingibilidade` ∈ {`"desligado"` (padrão/ausente), `"ativo"`} → `OpcoesFluxo.preservarAtingibilidade` (lida em `supabaseIO.ts` → `insumosFluxo`). Só vale onde o fluxo está `ativo` na semana. A chave casa com `producao_real_%`: o gatilho existente pede recálculo a cada mudança de valor (passado e período em andamento são imutáveis).

```sql
-- LIGAR (só com autorização)
insert into public.escala_parametros (chave, valor, grupo, descricao)
values ('producao_real_atingibilidade', '"ativo"', 'operacional', 'Escala Inteligente (fluxo): preserva a atingibilidade das metas semanais (tier 1) antes de maximizar peças finais')
on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
-- ROLLBACK
update public.escala_parametros set valor = '"desligado"', atualizado_em = now() where chave = 'producao_real_atingibilidade';
```

## 4. Diagnóstico

Com a flag: `AvaliacaoPlano.atingibilidade` (por grupo: `meta, restante, maximoPossivel, atingivel, faltaInevitavel, finalPrevisto, faltaEvitavel, status`), `DiagnosticoFluxo.atingibilidade` (`antes` = referência, `depois` = escolhido, `postosMinimos[]` por período/grupo com `alvo, producaoObrigatoria, minimos, noPlano, atendido`), `diagnosticos[]` com `META_NAO_ATINGIVEL` e `POSTOS_MINIMOS_APLICADOS`, e a tupla J com 2 componentes a mais (`iteracoes[].tupla` de 9 em vez de 7).

## 5. Limites conhecidos

* Máximo possível ignora pessoas e a regra de revezamento (cota superior): com revezamento duro, os mínimos podem não caber e o motor corta (diagnóstico `META_EM_CONFLITO`). Integração com o revezamento por bloco (`feat/escala-rev-bloco`) é por merge, sem tocar `rotacao.ts`.
* Os mínimos de um período assumem os períodos seguintes "no máximo"; conflitos futuros entre produtos só aparecem quando o varrimento chega lá (replanejamento a cada fechamento corrige).
* O guloso de peças finais (tier 2) não é ótimo; após satisfazer o tier 1 pode deixar mais WIP no fim da semana (medido no replay de 28/10).
* O replay usa a entrada reconstruída (ausências/paradas do último snapshot), não reproduz byte a byte o plano de PROD.

## 6. Ferramentas

`scripts/escala-fluxo-atingibilidade/`: `buscar.ts` (SELECT em PROD → cache), `replay.ts` (estado real × vigente × flag off × on), `prova.ts` (prova matemática da Caixa), `criterios.ts` (replay das decisões gravadas, flag off × on). Testes: `src/features/escala/fluxo/__tests__/atingibilidade.test.ts` (cenários A–F com dois conjuntos de ids), `src/lib/escala/__tests__/fluxoIntegracao.test.ts` (flag).


## 7. Objetivo FINANCEIRO (Camada 2) e Camada 3 — direção do usuário: o objetivo é R$, não peças

Hierarquia: **0 HARD** (disponibilidade, revezamento por bloco, roteiro, máquinas da Previsão, WIP/material, 1 pessoa/posto, 1 máquina/período, passado e período atual congelados) → **1 ATINGIBILIDADE** (§1–2; não obriga pessoas sem necessidade) → **2 FINANCEIRO** → **3 FLUXO** → 4 estabilidade/churn → 5 equidade/custo.

* **Valor** = PREÇO CONGELADO do item da Previsão (`previsao_itens.valor_unitario` → `PoolEscala.valorUnitario`; conferido por SELECT em PROD na semana 26/10: congelado = cadastro). R$ só da ETAPA FINAL (`financeiro.ts`); intermediárias geram WIP, não R$ (sem dupla contagem). No Conector fundido o preço do nó final é a média ponderada pela quantidade dos membros.
* `objetivo = "financeiro"` implica `ponderarPorValor`: o valor marginal de um posto = R$ adicionais de produto final até o fim da semana (re-simulação exata); a falta do J e a elegibilidade são em R$; conflitos entre metas atingíveis são priorizados pelo R$ ainda por produzir. A heurística de PEÇAS entra como mais um candidato (o financeiro nunca fica abaixo do R$ que ela alcança).
* **Peso comercial manual** por produto (`pesoComercial`, default 1, nunca inventado): só desloca a DECISÃO; as métricas em R$ usam o preço puro.
* **Camada 3**: no objetivo financeiro o componente de excesso de WIP do J passa a ser `excessoWip2p` (WIP final acima de 2 períodos de capacidade da origem) — só PENALIDADE SECUNDÁRIA, nunca limite duro; postos sem valor de etapas intermediárias ficam por último na ocupação de quem sobra.
* **Métricas** (`AvaliacaoPlano.financeiro`, `DiagnosticoFluxo.financeiro`): por produto META, REALIZADO FINAL, RESTANTE, MÁXIMO PRODUZÍVEL, META ATINGÍVEL, FALTA INEVITÁVEL (peças e R$), final/falta projetados, R$ meta/realizado/faltante/máximo atingível/projetado de fechamento/falta inevitável; total. `variacao[]` e `PRODUTO_SACRIFICADO` mostram, produto a produto, peças e R$ perdidos contra a referência (nada silencioso).

### Flags (`escala_parametros`, sem migration; todas casam `producao_real_%` ⇒ o gatilho existente pede recálculo)

| chave | valores | padrão |
|---|---|---|
| `producao_real_atingibilidade_modo` | `"off"` \| `"sombra"` (mede e reporta, não altera o plano) \| `"ativo"`; substitui `producao_real_atingibilidade` (legada, `"ativo"` ainda vale se a nova não existir) | off |
| `producao_real_objetivo_escala` | `"pecas"` \| `"financeiro"` | pecas |
| `producao_real_pesos_comerciais` | `{ "<produto_id>": peso > 0 }` | `{}` |
| `revezamento_escopo` | consecutivo \| bloco (agente feat/escala-rev-bloco) | consecutivo |

```sql
-- sombra de atingibilidade + R$ (nada muda na Escala)
insert into public.escala_parametros (chave, valor, grupo, descricao) values
 ('producao_real_atingibilidade_modo', '"sombra"', 'operacional', 'Atingibilidade da meta semanal: off | sombra | ativo'),
 ('producao_real_objetivo_escala', '"pecas"', 'operacional', 'Objetivo da Escala: pecas | financeiro (R$ pelo preço congelado da Previsão)')
on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
-- ligar:   update ... set valor = '"ativo"' where chave = 'producao_real_atingibilidade_modo';  update ... set valor = '"financeiro"' where chave = 'producao_real_objetivo_escala';
-- reverter: valores '"off"' / '"pecas"' (o futuro volta ao motor anterior no próximo recálculo; passado intacto)
```

### Ordem de deploy
1) migration do revezamento por bloco (feat/escala-rev-bloco, 20261105200000) em DEV → 2) código (esta branch já contém o merge) com TODAS as flags desligadas → 3) `revezamento_escopo = bloco` → 4) `atingibilidade_modo = sombra` + `objetivo = pecas` (comparar `diagnostico.financeiro`) → 5) `ativo`/`financeiro` só após critérios de PROD. Rollback: voltar cada flag ao padrão (sem migration, sem deploy).


## 8. Objetivo ECONÔMICO (v3): receita/hora por posto, capacidade física, limite econômico da atingibilidade

**Correção conceitual**: nem peças, nem preço unitário, nem R$/peça isolados — o que importa é quanto resultado econômico um RECURSO gera na capacidade disponível (A: R$1,00×100/h = R$100/h < B: R$0,30×1.000/h = R$300/h). Três níveis, mesma arquitetura:

| nível | valor por peça final | como entra | estado |
|---|---|---|---|
| N1 receita/unidade | preço congelado da Previsão (`PoolEscala.valorUnitario`) | `objetivo = "financeiro"` (≡ `"receita"`) | real |
| N2 receita/hora por posto | preço × produtividade esperada (meta × f ou `ProdutividadeProvider`) ÷ horas do período | implícito no valor marginal (peças × preço); exposto em `CapacidadeEtapaSlot.receitaPorHoraPosto` | real |
| N3 margem de contribuição/hora | (preço − custo variável) × produtividade, via `MargemProvider` | `objetivo = "margem"`; sem margem confiável cai para RECEITA ("receita marginal", `MARGEM_INDISPONIVEL`) | **indisponível hoje** (docs/escala-economia-dados.md: não há custo variável por peça; custo/hora do sistema é todo fixo e NÃO entra na decisão) |

Receita só da **peça final** (nunca soma "preço × produtividade da etapa" entre etapas); intermediárias geram WIP. Custo fixo nunca é rateado.

### Fórmulas
* **Produtividade esperada** `p(pool, período)` = média, nas máquinas SELECIONADAS na Previsão, de `pecasPorPeriodo × fator` (`ProdutividadeProvider(produto, etapa, máquina, período, agora)`; default = meta nominal × f do pool, como hoje). `produtividadeBase = "nominal" | "real"` escolhe a base (a ordem de receita/h entre produtos muda com a base).
* **Capacidade da etapa** `CAP_ETAPA(t) = min( postosMáx(t)·p , min(postosMáx, pessoas presentes)·p , produção da etapa com todos os postos pela simulação [material/WIP e absorção downstream] )`. Postos máximos = máquinas da Previsão disponíveis (Paradas/bloqueios descontados); nunca máquinas compatíveis do cadastro. Capacidade do produto final = elo mais restritivo da cadeia com o estoque entre etapas = `maximosPossiveis`.
* **Valor marginal** de uma pessoa neste posto neste período = `Δ (R$ de produto FINAL até o fim da semana)` por re-simulação exata da cadeia (`calcularMarginais`): só conta o que CHEGA ao produto final (3.000/período de upstream com downstream consumindo 1.000 ⇒ 1.000 contam; produzir acima da etapa limitante vale 0). Não premia WIP.
* **Saturação/gargalos** (`analisarCapacidade`): `SATURADO_POR_POSTO` (todos os postos ocupados ⇒ valor marginal 0), `GARGALO_PESSOA` (posto livre com valor, sem pessoa), `GARGALO_WIP_MATERIAL` (posto livre sem material), `GARGALO_DOWNSTREAM` (a cadeia/demanda não absorve), `FOLGA_FUTURA` (o posto produz mas a capacidade dos períodos seguintes já cobre o material da semana: mais uma pessoa só antecipa).
* **Custo de oportunidade** de uma pessoa = melhor valor marginal alternativo no mesmo período (posto livre de outra etapa); `ganho líquido = valor marginal − custo de oportunidade`. Log por decisão em `diagnostico.economia.decisoes[].texto`: "Pessoa X → posto Y porque: posto k de N, há material, downstream absorve, produtividade esperada N, receita marginal R$ A, alternativa seguinte R$ B, ganho líquido R$ C".

### Limite econômico da atingibilidade (regra geral, `atingibilidadeK`)
Preservar uma meta atingível só se `custo de oportunidade (R$ da semana) ≤ k × valor recuperado (R$)`, com `custo = R$ falta(c) − R$ falta(A)` (A = melhor plano puramente econômico, todos os candidatos reavaliados da mesma forma) e `valor recuperado = Σ (falta evitável_A − falta evitável_c) × valor` nas metas atingíveis. Candidatos que preservam e passam no limite competem pela J (tier 1 primeiro); os que não passam geram `ATINGIBILIDADE_NAO_PRESERVADA_CUSTO` (custo, valor, razão, k). Quando não dá para cumprir todas as metas, vale a otimização econômica e `PRODUTO_SACRIFICADO` mostra produto, peças e R$ perdidos.

**Escolha de k**: k = 1 é o piso racional (não pagar mais do que se recupera); a incerteza do próprio modelo (produtividade real ficou até 16% abaixo do plano em M1) exige folga de ~1/(1−0,16)² ≈ 1,4 para o julgamento não ser ruído; k = 2 deixa uma meta atingível valer até 2× a sua receita (prêmio de compromisso explícito e parametrizado). A sensibilidade nos replays de 28/10 mostra um platô: a decisão é IDÊNTICA para qualquer k < 5,24 (Pino: custo R$183 × valor R$35) e muda só para k ≥ 5,24. Padrão: k = 2; k maior é decisão comercial, não técnica.

### Flags novas (todas desligadas por padrão; `producao_real_%`)
`producao_real_objetivo_escala` (pecas|financeiro|receita|margem), `producao_real_atingibilidade_modo` (off|sombra|ativo), `producao_real_pesos_comerciais`, `producao_real_atingibilidade_k` (número > 0; padrão 2). Provedores `produtividade`/`margem` são injetados por código (nenhum em PROD hoje).

### Pendências conhecidas
* Os provedores reais de produtividade (feat/escala-produtividade) e de margem (feat/escala-economia-dados) não foram publicados; usam-se os padrões.
* Revezamento por bloco é hard e vem do merge de main; as equivalências ficam desligadas.


## 9. Fonte econômica = tela PRODUTOS (decisão do usuário, 29/10)

A tela Produtos é a REFERÊNCIA: o motor não tem margem própria. `economiaProduto.ts › lucroHoraDaTela(entrada)` chama a MESMA `calcularMargemProduto` (src/features/custo-hora/calculations.ts, fonte única de Produtos/Previsão/Capacidade): `margem = valor − Σ_etapas(tempo/peça × custo/hora)`, `lucro/h = margem ÷ Σ tempo/peça`, tempo/peça = Σ horas ÷ Σ metas dos períodos. Verificado contra a tela com as metas nominais de PROD e custo/hora R$ 31,92: Automática 0,182/0,0631/65%/60,17; Pino 0,070/0,0258/63%/54,81; Caixa 0,217/0,0911/58%/44,13; Plug 0,099/0,0422/57%/43,04; Conector conv. 0,1825/0,0841/54%/37,31; 1.1/4" 0,365/0,2765/24%/10,22.

* **Metas**: o Escala lê `roteiro_etapas.meta_m1..meta_t3` (supabaseIO `META_COLS`) — a mesma coluna do cadastro da tela; não há tabela paralela. A produtividade esperada = meta nominal ajustada pelo desempenho real (f atual embutido ou o estimador do agente de produtividade via `ProdutividadeProvider`).
* **Convenção, não custo variável**: o "custo/peça" da tela é folha + rateio de fixos (todos os postos pagam R$ 31,92/h; docs/escala-economia-dados.md). Por isso lucro/h = receita/h − k (k constante) e **não altera a ordem entre postos**; o que muda é o peso por peça final (margem = valor − k·Σtempo/peça), que favorece cadeias rápidas. Rótulo: "lucro (tela Produtos)"; troca pelo módulo canônico quando publicado.
* **Modos de valor** (`objetivo`): A `pecas`; B `financeiro|receita` (preço congelado); C `lucro_hora` + `produtividadeBase:"nominal"` (como a tela, capacidade nominal); D `lucro_hora` (margem da tela com a produtividade REAL = valor econômico marginal final). `margem` + `MargemProvider` continua para margem de contribuição verdadeira (indisponível).
* **Valor marginal final**: margem por peça final × peças que CHEGAM ao produto final (re-simulação da cadeia), limitado por demanda restante, máquinas SELECIONADAS e disponíveis, pessoas, WIP/material, downstream e períodos restantes; posto saturado = 0.


## 10. Dados de ESTADO × ADERÊNCIA ao plano (contexto operacional de 29/10)

Desde a tarde de 28/10 a produção não vem seguindo fielmente a Escala. Regra de leitura de TODOS os relatórios e replays desta branch:

* **DADOS DE ESTADO (válidos sempre)**: boas finais, WIP, demanda restante, paradas, disponibilidade, produtividade por máquina/operação (inclusive de períodos pouco aderentes, se a máquina/operação executadas estão no apontamento).
* **ADERÊNCIA AO PLANO (confiável só na janela 26–28/10 até ~13h, a confirmar)**: nunca usar "a fábrica fez X" para dizer que o motor acertou ou errou. Os replays desta branch são CONTRAFACTUAIS a partir do mesmo estado inicial (28/10 09:00–09:45, dentro da janela) — é a única avaliação do motor feita aqui.
* **Aderência por PESSOA não é medível**: o apontamento é por máquina/posto (produto, operação, status, motivo); `funcionario_id` é quem lançou.

### Métrica de aderência por período (`aderencia.ts › aderenciaPorPeriodo`, pura)
Para cada período FECHADO, por posto (máquina) planejado: `igual` (mesmo produto E mesma operação), `divergente_produto_operacao`, `nao_executado` (só sem_producao, com motivo), `sem_apontamento`; mais `foraDoPlano` (máquina apontada sem posto planejado) e `intervencoesManuais` (linha planejada com origem "manual"). Resultados: `aderencia = igual ÷ apontados`, `aderenciaBruta = igual ÷ planejados`, `motivos`, e o rótulo `janela` (`janela_confiavel` | `aderencia_nao_confiavel` conforme `janelaConfiavelAteMs`). Limites: usa o plano atual em `escala_producao_alocacoes` (períodos passados ficam congelados como foram planejados); não vê quem estava em cada máquina; "sem_apontamento" é ausência de lançamento, não necessariamente de produção. Script: `scripts/escala-fluxo-atingibilidade/aderencia.ts`.

### Flags novas (defaults desligados, `producao_real_%`)
`producao_real_objetivo_escala` aceita também `receita`, `margem`, `lucro_hora`; `producao_real_produtividade_base` (real|nominal); `producao_real_custo_hora_empresa` (R$/h do lucro/h da tela; padrão 31,92).

### Diversificação de candidatos (`diversificarCandidatos`, opção do núcleo; default false)
Acrescenta candidatos: sweeps sobre variantes determinísticas da produtividade (último período do dia −9%, intermediárias −10%, finais −10%) e BUSCA LOCAL por trocas de posto (`melhorarPorTrocas`: move uma pessoa de a→b por período se o valor final melhora, re-simulação exata). Todos julgados no modelo real. Replay 28/10: M3 +R$79, M2 +R$157, 29–30 +R$215 e WIP 1.736→80; a variante com estimador de produtividade ainda acha +R$1.060 em M3 pelo mesmo critério de medida (ela liga a Máquina 8 em TODOS os períodos e tira posto do Parafusar convencional); causa ainda não explicada — a busca continua deixando ~2% na mesa.


## 11. Valor do posto OCUPADO × +1 pessoa × +1 máquina; saturação completa (29/10)

Três valores distintos por posto/período (`CapacidadeEtapaSlot`, `capacidade.ts`), todos em R$ do critério econômico e SEM identificador de pessoa:
* **A) valor do posto JÁ OCUPADO** = remoção exata do posto naquele período. Dois cálculos: `valorPostoOcupadoRestoFixo` (resto da semana como está no plano) e `valorPostoOcupadoRestoReplanejado` (o resto da semana é REPLANEJADO pelo motor depois da remoção; função `replanejar` injetada, o núcleo não importa o planejador; caro, limitado a `slotsReplan` períodos e `maxReplan` replanejamentos). **Lição de 29/10:** com o resto FIXO o valor pode ser um FALSO ZERO (a Embalagem 17 dava R$ 0,00; com o resto replanejado vale R$ 765,49 em T1 = 7.694 pç finais), porque o plano atual de 30/10+ é fraco e deixa capacidade ociosa que "recupera" a remoção. Posto ocupado com A fixo = 0 sempre traz `explicacaoValorZero`.
* **B) +1 PESSOA** (`valorMaisUmaPessoa`): 0 quando não há máquina livre (a seleção da Previsão é absoluta); com máquina livre, o valor marginal exato.
* **C) +1 MÁQUINA/posto** (`valorMaisUmaMaquinaInformativo`): só medido quando todos os postos estão ocupados; INFORMATIVO, nunca recomendar.

**Saturação** (`saturacao.ts`, `classificarSaturacao`): MAQUINA > PESSOA > TEMPO > WIP > DOWNSTREAM > DEMANDA; o primeiro verdadeiro é o primário e todos aparecem em `motivos` (regra no cabeçalho do arquivo; testada). SATURADO_POR_TEMPO = último período do horizonte e +1 pessoa/máquina não vira peça final em etapa intermediária. Os códigos antigos (`SATURADO_POR_POSTO`, `GARGALO_*`, `FOLGA_FUTURA`) continuam em `diagnostico` por compatibilidade.

Relatório da proposta (`proposta-tarde.v3.ts`, `rodar-proposta-v3.sh`): seções E/F com as colunas A (fixo e replanejado), B, C e a saturação, para o plano atual e para o econômico; custo medido: ~55 replanejamentos ≈ 16 s. Flag: nenhuma nova (uso offline). Proposta de flag futura, se for ao motor: `producao_real_valor_posto_replanejado` (off|sombra) para gravar A replanejado no diagnóstico do fluxo.

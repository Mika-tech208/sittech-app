# Produto único com múltiplas rotas de fabricação — DESENHO TÉCNICO

Status: **somente desenho.** Nada implementado, nenhuma migration aplicada, nada em PROD. Números de PROD foram lidos em modo somente leitura (26/10/2026).

## 0. Resumo executivo

- O modelo atual **não** suporta rotas: um produto tem **uma cadeia linear** de etapas (`roteiro_etapas`, `UNIQUE (produto_id, ordem)`), e todo o resto (Previsão, capacidade, Escala, WIP, Produção Real, custo) assume essa cadeia.
- A mudança mínima e segura é **aditiva**: um conceito de **rota** = lista ordenada de etapas **do mesmo produto**, em que as etapas comuns (depois da convergência) pertencem a todas as rotas. Produto sem rotas cadastradas continua sendo uma "rota única implícita" — nada muda para os produtos atuais.
- A Previsão passa a enxergar **uma demanda final** (116.625). Um **planejador de rotas** (função pura, determinística, antes do motor da Escala) divide essa demanda entre as rotas respeitando capacidade, gargalos comuns, equipe e custo — **sem regra rígida** e **sem "sempre automática"**. O motor da Escala continua trabalhando com *pools* (produto, etapa); só muda a **quantidade de cada pool** e o conceito de "etapa de origem" no WIP/alertas (passa a aceitar mais de uma origem na convergência).
- Produção Real não muda de estrutura: o produto concluído continua contado **só na última etapa (Embalar)**. A **rota** de cada apontamento é derivada da etapa (etapas exclusivas pertencem a uma rota; as comuns, a nenhuma) — não há dupla contagem.
- Custo/margem por rota saem das metas e do custo/hora de cada etapa da rota (já existe `calcularIndicadoresProducao`), e do snapshot de custo dos apontamentos no realizado.
- Histórico: os dois cadastros antigos continuam existindo como estão. Um **mapa de equivalência** (`produto_variante_legada`) diz que "Conector 3/4" – Máq. Automática" é a **rota Automática** do "Conector 3/4"" só para **análises**, sem reescrever nenhuma linha antiga. As semanas passam para o modelo novo **uma a uma**, por uma chave **por semana** (`previsoes.modelo_rotas`), nunca silenciosamente.

## 1. Diagnóstico do modelo atual (o que existe hoje)

### 1.1 Dados reais (PROD, leitura)

| | Conector 3/4" (convencional) | Conector 3/4" – Máq. Automática |
|---|---|---|
| Etapas (ordem) | 0 Rosquear · 1 Parafusar · 2 Etiquetar · 3 Embalar | 0 Rosquear + Parafusar · 1 Etiquetar · 2 Embalar |
| Máquinas | Rosq. 3/5/6 · Parafus. 9/10/11/12 · Etiq. 15/16 · Embal. 17 | Máq. Automática 8 · Etiq. 15/16 · Embal. 17 |
| Meta (peças/máquina/período, M1–M3 / T1–T3) | 2000/1600 · 1500/1200 · 3500/3000 · 5000/4500 | 1275/1100 · 3500/3000 · 5000/4500 |
| Valor unitário | 0,1825 | 0,182 |
| Custo/peça nas etapas (snapshot dos apontamentos, out/26) | Rosq. 0,02479 · Parafus. 0,03291 · Etiq. 0,01368 · Embal. 0,00979 | R+P 0,03737 · Etiq. 0,01368 · Embal. 0,00979 |

- As etapas **Etiquetar e Embalar já são fisicamente as mesmas** (mesmas máquinas, mesmas metas) nos dois cadastros — isso confirma que o "produto automático" é, na prática, a convergência já ocorrendo, só que modelada duas vezes.
- Previsão 26/10: Conector 3/4" = 81.000 (+22.800 adicional) e Conector 3/4" – Máq. Automática = 35.625. **35.625 = 1.275×3 + 1.100×3 = 7.125/dia × 5 dias** — exatamente a capacidade da única máquina automática na semana.
- Histórico: 205 apontamentos do convencional (462.623 peças) e 80 da automática (74.529) desde 08/09.

### 1.2 Respostas à investigação (§20)

1. **O modelo suporta múltiplas rotas por produto?** **Não.** `roteiro_etapas` é uma lista linear por produto (`UNIQUE (produto_id, ordem)`); a "etapa seguinte" é sempre a de `ordem` imediatamente maior (ex.: criação do controle de WIP em `20261023100000_wip_controle.sql`, "próxima etapa por ordem"); "última etapa" = `max(ordem)` (RPCs de indicadores e `obter_apontado_real_previsao_por_semana`).
2. **Mudança mínima:** acrescentar **rotas e o mapeamento rota→etapas** (tabelas novas) e deixar as etapas existentes como estão. Sem rotas cadastradas, vale a cadeia por `ordem` (rota implícita). Detalhes em §3.
3. **Precisamos de…**
   - `produto_rota` — **sim** (identidade, nome, ativa, preferência).
   - `rota_etapas` — **sim** (a lista ordenada de etapas de cada rota; as comuns aparecem em todas).
   - **Etapa de convergência** — **não como cadastro**: é *derivada* (a primeira etapa presente em mais de uma rota).
   - **Grupo de fluxo** — **não**: o produto já é o grupo; a demanda mora no produto.
4. **Não quebrar os produtos lineares:** rota implícita (sem linhas em `produto_rota`) + chave por semana. Todo código novo passa por `rotasDoProduto(produto)`, que devolve uma rota única com as etapas por `ordem` quando não há rotas cadastradas.
5. **Demanda única de 116.625:** é um único `previsao_itens` do produto final; a divisão por rota é **resultado do planejador**, não entrada (opcionalmente restringida por min/max/fixo por rota, §4).
6. **Divisão dinâmica automática × convencional:** planejador de rotas (§5), recalculado a cada replanejamento sobre o horizonte ainda mutável, com histerese para não oscilar.
7. **Evitar dupla contagem após a convergência:** a demanda mora no produto (uma vez); as etapas comuns são **um pool só** com a quantidade total; produzido do produto = Σ boas em **Embalar** (última etapa); produção das etapas exclusivas é **semiacabado** (WIP), nunca produto.
8. **Custo/margem por rota:** custo da rota = Σ (tempo/peça × custo/hora da operação) das etapas da rota (exclusivas + comuns); margem = valor unitário − custo. No realizado, pelos snapshots dos apontamentos por etapa (§8).
9. **Produção Real rastreável:** a rota de um apontamento decorre da **etapa** (exclusiva → rota; comum → sem rota). Atribuição do acabado por rota é **contábil** (regra explícita, §7.4), com rastreabilidade por lote só se um dia for exigida.
10. **Migrar sem reescrever histórico:** tabelas aditivas; mapa de equivalência para os dois cadastros antigos; chave de modelo por semana; semana corrente **não** é migrada (§11).

### 1.3 Consumidores do modelo linear (o que precisa ser "ciente de rotas")

| Área | Onde | Suposição linear | Impacto |
|---|---|---|---|
| Cadastro de produto | `ProdutosPage`, `produtos/calculations.ts` | roteiro = array linear, ordem = posição | editor de rotas |
| Previsão (item) | `previsao_itens`, `previsao_item_maquinas` | 1 item = 1 produto; máquinas por **etapa** | já aceita etapas de rotas diferentes (chave `etapa_id`); falta escolha de rota |
| Capacidade/atingibilidade da Previsão | `capacidade/calculations.ts` (`calcularCapacidadeMaximaProduto`, `calcularHorasPorMaquina`) | cada etapa é **restrição independente**, gargalo = mínimo entre etapas | trocar "mínimo entre etapas" por "mínimo entre (Σ rotas, comuns)" (§9) |
| Motor da Escala | `escala/types.ts` `PoolEscala`, `gerarEscala.ts`, `adicionalWip.ts`, `wipSaldo.ts`, `cobertura.ts` | pool = (produto, etapa); etapas do produto em cadeia por `ordemEtapa`; WIP entre etapas **consecutivas** | quantidade por pool + origens múltiplas na convergência |
| Atingibilidade da Escala | `escala/atingibilidade.ts` | status do produto = pior etapa; necessidade por etapa | necessidade por pool vinda do planejador; gargalo comum |
| WIP | `wip_controle (etapa_origem, etapa_seguinte)` `UNIQUE(origem, seguinte)` | próxima etapa por `ordem` | próxima etapa passa a vir de `rota_etapas` (duas origens → duas linhas de controle, saldo combinado na convergência) |
| Produção Real | `apontamentos_producao (produto_id, etapa_id, …)` | última etapa = `max(ordem)` | **sem mudança de schema**; cauda comum precisa ter as maiores `ordem` |
| Indicadores/Validação/Apontado real | RPCs `is_ultima_etapa`, `obter_apontado_real_previsao_por_semana` | `max(ordem)` | funcionam no produto único; histórico agrupado via mapa de equivalência |
| Custo/rentabilidade | `custo-hora/calculations.ts` | custo = Σ etapas do produto | custo por rota = Σ etapas da rota |
| Relatórios PDF (revezamento) | `escala-relatorio` | por operação (`operacao_id`) | sem mudança (a operação "Rosquear + Parafusar" já é uma operação) |

## 2. Princípios do desenho

1. **Produto final único; rotas são formas de fabricar.** Demanda, preço e Produção Real ficam no produto.
2. **Aditivo.** Nada de UPDATE/DELETE destrutivo em dados existentes; produtos atuais seguem iguais.
3. **Uma contagem.** Demanda uma vez; produto concluído só em Embalar; semiacabado nunca soma como produto.
4. **Divisão é decisão do motor, não cadastro.** Pode ser guiada por limites (min/máx/fixo) quando o gestor quiser; por padrão é livre.
5. **Determinístico e explicável.** Mesma entrada ⇒ mesma divisão; cada divisão registra o porquê (capacidade, custo, gargalo comum).
6. **Histórico intocado.** Semanas antigas continuam no modelo em que foram feitas; o novo só vale para frente, por semana.

## 3. Modelo de dados proposto (somente desenho)

### 3.1 Tabelas novas

```
produto_rota
  id uuid PK, produto_id uuid FK produtos, codigo text, nome text,           -- 'CONV' "Convencional" · 'AUTO' "Automática"
  ativa boolean, preferencia smallint,                                        -- desempate (NÃO é regra rígida)
  UNIQUE (produto_id, codigo)

rota_etapas                                                                    -- a rota como lista ordenada de etapas
  rota_id FK produto_rota, etapa_id FK roteiro_etapas, posicao smallint,
  PK (rota_id, etapa_id), UNIQUE (rota_id, posicao)
  CHECK/trigger: etapa.produto_id = rota.produto_id
  -- etapas comuns (Etiquetar, Embalar) aparecem nas duas rotas; a CONVERGÊNCIA = primeira etapa presente em >1 rota (derivada)

previsao_item_rota                                                             -- restrições OPCIONAIS por semana (padrão: todas as rotas ativas, livres)
  item_id FK previsao_itens, rota_id FK produto_rota, ativa boolean default true,
  modo text check in ('livre','minimo','maximo','fixo') default 'livre', quantidade numeric null,
  UNIQUE (item_id, rota_id)

escala_rota_divisao                                                            -- append-only: o que o planejador decidiu e por quê
  id, previsao_id, produto_id, rota_id, versao_plano_id (escala_plano_versoes), quantidade_alvo numeric,
  capacidade_rota numeric, motivo jsonb, criado_em

produto_variante_legada                                                        -- mapa de equivalência (só leitura/analise)
  produto_legado_id PK FK produtos, produto_final_id FK produtos, rota_id FK produto_rota, desde date
```

### 3.2 Colunas novas (aditivas)

- `previsoes.modelo_rotas boolean not null default false` — **chave por semana**. `false` = semana inteira no modelo atual.
- (opcional, fase tardia) `roteiro_etapas.operadores_por_maquina smallint not null default 1` — hoje "operadores necessários" = nº de máquinas selecionadas; a automática continua 1.

### 3.3 O que **não** muda

`apontamentos_producao`, `previsao_itens` (apenas é usado com o produto único), `previsao_item_maquinas` (já é por `etapa_id`), `wip_*` (mesmas tabelas), `roteiro_etapa_maquinas`, metas por etapa, custo por operação.

### 3.4 Regra de `ordem` (atenção)

`UNIQUE (produto_id, ordem)` e `is_ultima_etapa = max(ordem)` exigem que **as etapas da cauda comum tenham as maiores `ordem`** e que a nova etapa exclusiva ("Rosquear + Parafusar") entre **antes** delas. Para o "Conector 3/4"": Rosquear 0, Parafusar 1, **Rosquear + Parafusar 2**, Etiquetar 3, Embalar 4. Isso exige renumerar `ordem` de Etiquetar/Embalar do produto (UPDATE de uma coluna sem outras referências — apontamentos referenciam `etapa_id`, não `ordem`). É a **única** alteração em dado existente e deve ser feita numa transação própria, com ensaio, na fase de ativação. (Alternativa: definir "última etapa" como o *sumidouro* do grafo de `rota_etapas`, mas isso mexeria em RPCs de indicadores/apontado real; a renumeração é menos invasiva.)

### 3.5 Como o produto atual vira "dois produtos antigos + um novo" sem merge

1. **Não** se funde nada. O "Conector 3/4"" (P) ganha: a rota `CONV` (Rosquear, Parafusar, Etiquetar, Embalar) e a rota `AUTO` (Rosquear + Parafusar *[nova etapa em P]*, Etiquetar, Embalar), com Etiquetar/Embalar **compartilhadas**. A nova etapa copia as metas e a máquina (Máq. Automática 8) do cadastro antigo.
2. O cadastro "… – Máq. Automática" (A) **continua existindo** com seus apontamentos e etapas (referências por `etapa_id` intactas); é registrado em `produto_variante_legada` (A → P, rota `AUTO`) e, a partir da primeira semana em modo rotas, fica `ativo = false` para novas Previsões.

## 4. Previsão (demanda e escolha de rotas)

- **Entrada:** um item `Conector 3/4" = 116.625`. Máquinas continuam sendo marcadas **por etapa** (`previsao_item_maquinas`): Rosquear/Parafusar convencionais, **Máq. Automática 8** na etapa exclusiva da rota AUTO, Etiquetar e Embalar comuns.
- **Rotas disponíveis da semana:** por padrão, uma rota está **disponível** se todas as suas etapas têm máquina selecionada (a rota AUTO sem a máquina marcada simplesmente não entra). `previsao_item_rota` só existe para restringir: *desativar* uma rota na semana, *mínimo* (ex.: "pelo menos 20.000 pela automática"), *máximo* ou *fixo*. Sem linhas = divisão livre.
- **Exibição:** a Previsão mostra só a demanda final e, ao lado, a **divisão sugerida** (somente leitura): "Automática 35.625 · Convencional 81.000 · atingível" com o porquê.
- **Migração do dado de entrada:** 81.000 + 35.625 → 116.625 (ver §11).

## 5. Planejador de rotas (a regra de divisão)

Função pura `planejarRotas(entrada) → { alvoPorRota, motivo, folga, gargalos }`, executada **antes** do motor (em `montarEntrada`), no horizonte ainda mutável (períodos futuros), e registrada em `escala_rota_divisao`.

### 5.1 Entradas

- Demanda restante do produto **final**: `D_rest = D − acabado já produzido (Σ boas em Embalar) `.
- Por rota *r*: etapas exclusivas *E_r* (com máquinas selecionadas, metas, períodos restantes, indisponibilidades) e **capacidade exclusiva** `cap_r = min_{e∈E_r} capacidade_e` (já existe a fórmula "máquinas × meta × períodos disponíveis" em `atingibilidade.ts`).
- Etapas comuns *C*: `cap_c` por etapa comum (e capacidade já comprometida por outros produtos nas mesmas máquinas).
- **Estoques** de semiacabado: `s_r` (saída da rota *r*) e estoque já na cauda comum.
- **Equipe:** períodos-pessoa disponíveis (e **revezamento duro**: a automática só roda se houver pessoa elegível que não tenha acabado de executar a mesma operação).
- Custo por peça de cada rota `c_r` (§8).

### 5.2 Problema (lexicográfico)

Variáveis `y_r ≥ 0` = peças **acabadas** que passam pela rota *r* nesta semana (inclui o semi em estoque).

1. **Maximizar** `Σ y_r` (atender a demanda) sujeito a:
   - `y_r ≤ cap_r + s_r` (capacidade da rota + estoque dela);
   - `Σ y_r ≤ cap_c + s_c` para **cada** etapa comum (gargalo comum);
   - `Σ y_r ≤ D_rest`;
   - recursos compartilhados (mesma máquina/hora em mais de uma etapa/produto) e equipe (períodos-pessoa) — mesmo conjunto de provas já usado em atingibilidade.
2. Dentre as soluções com o mesmo atendimento, **minimizar custo** `Σ c_r y_r` (equivale a preferir a rota de maior margem — a automática, quando válida).
3. **Estabilidade:** dentre custos empatados (ou dentro de uma tolerância), **manter a divisão anterior** (histerese: só muda se a diferença passar de ~1 período da rota ou ~3%).
4. Desempate final: `produto_rota.preferencia`.

Rotas com máquinas **disjuntas** têm solução fechada: `y_B = min(D, cap_B + s_B, cap_comum)`; `y_A = min(D − y_B, cap_A + s_A, cap_comum − y_B)` (rota mais barata primeiro). O caso geral (máquinas compartilhadas) é um LP pequeno (2–3 variáveis), resolvível de forma exata e determinística.

### 5.3 Por que não é "sempre automática"

A automática é preferida **só** enquanto (a) cabe na capacidade real (inclui máquina parada/indisponível), (b) não cria gargalo inútil em Etiquetar/Embalar (a soma é limitada pelo mínimo das etapas comuns), (c) há pessoa elegível pelo revezamento, (d) o **estoque** não passa do teto de WIP. Se qualquer coisa impedir, o planejador devolve a demanda para a rota convencional e registra o motivo.

### 5.4 Quando roda

Na geração semanal e em **cada replanejamento** (evento da outbox); o passado fica congelado (já é a regra do motor). A cada rodada, `D_rest` e estoques refletem a Produção Real. Se a automática produz mais/menos que o alvo, o alvo da convencional se ajusta no próximo ciclo (cenário B).

## 6. Escala (como escolhe rota)

- A Escala **não "escolhe rota" por pessoa**: ela recebe **pools** — *Rosquear* (conv), *Parafusar* (conv), *Rosquear + Parafusar* (auto), *Etiquetar* (comum), *Embalar* (comum) — cada um com a **quantidade alvo** do planejador, e aloca pessoas aos postos como hoje (mesmas regras de equidade, revezamento, ausência, máquina indisponível).
- Quantidades por pool: exclusivas = `alvo_r − estoque_r`; **comuns = demanda restante total** (um pool só, **sem** duplicar Etiquetar/Embalar).
- Prioridade dentro do período: já é por `ordemEtapa` (upstream primeiro); mantém. O `ordemEtapa` das exclusivas é menor que o da cauda comum (§3.4).
- **Alertas:** `risco_falta_material` passa a considerar a **soma** das origens na convergência (produção acumulada das duas rotas + saldo) em vez de uma origem única; `subcarga_previsao`/`demanda_nao_atendida` por pool continuam.
- Postos das duas rotas convivem na mesma grade: parte da equipe em Rosquear/Parafusar convencionais, outra na **Máq. Automática 8**; todos alimentam Etiquetar/Embalar.
- **Máquina automática parada:** o pool da rota AUTO fica com capacidade 0 (indisponibilidade já existe) → o planejador realoca para a convencional na rodada seguinte.

## 7. WIP / semiacabado

### 7.1 Conceitos
- **Estoque por saída de rota**: Parafusados (conv) e Rosqueados+Parafusados (auto) — cada um com seu `wip_controle` (par `origem → Etiquetar`). O schema atual já suporta duas linhas com a mesma etapa seguinte (`UNIQUE (origem, seguinte)`).
- **Disponível para Etiquetar** = `saldo_conv + saldo_auto` (**saldo combinado da convergência**). Exemplo: 8.000 + 5.000 = **13.000** (§1.9 do pedido).
- Depois da convergência a origem **não importa** para o fluxo (Etiquetar e Embalar são comuns); só importa para o custo por rota (§8).

### 7.2 Saldo estimado
`estimado_r = saldo_inicial_r + boas na saída da rota r − consumo atribuído a r`. O **consumo** de Etiquetar (boas) é atribuído às origens pela regra de atribuição do §7.4 (padrão: **FIFO por rota**, i.e. consome primeiro o estoque mais antigo; alternativa: proporcional). A soma dos estimados = `Σ saídas − boas em Etiquetar` — **invariante** que evita dupla contagem.

### 7.3 O que o motor usa
Somente o **saldo confirmado combinado** (como hoje: "confirmado é a única entrada canônica") e os **tetos de estoque** por par. O adicional (acabado além do previsto) e o estoque intermediário planejado passam a trabalhar **por rota**, na versão inicial restritos à rota preferida com capacidade (evoluir depois).

### 7.4 Regra de atribuição (contábil)
Para a análise por rota, o **acabado** do período é atribuído às rotas pela mesma regra do consumo de estoque (FIFO por rota). Não exige apontamento adicional do operador. Se um dia for necessária rastreabilidade **por lote**, entra um campo opcional de origem nos apontamentos de Etiquetar/Embalar — **fora do escopo** do desenho mínimo.

## 8. Custo e rentabilidade por rota

- **Planejado:** `custo_rota = Σ_{e∈rota} tempo_por_peça(e) × custo_hora(operação(e))`, reaproveitando `calcularIndicadoresProducao` com o roteiro **da rota**; `margem_rota = valor_unitário − custo_rota`; `lucro/hora` idem. Hoje o código soma **todas** as etapas do produto — passa a somar as da rota.
- **Realizado:** cada apontamento já grava `custo_hora_operacao_vigente`, `custo_operacional_periodo_vigente`, `custo_unitario_referencia_periodo_vigente` e `valor_unitario_produto_vigente` (snapshots). O custo da rota = Σ dos apontamentos das **etapas exclusivas da rota** + parcela das **comuns** atribuída à rota pela regra do §7.4.
- **Economia da automática** = `(custo_conv_exclusivo − custo_auto_exclusivo) × peças pela auto` (com dados de out/26: (0,05770 − 0,03737) = **R$ 0,02033/peça**; 35.625 peças ⇒ **R$ 724,26/semana**). Também em horas-pessoa (automática usa 1 operador onde a convencional usa 2).
- **Preço:** hoje 0,1825 × 0,182 — no produto único é **um** valor; decidir qual (diferença de R$ 0,0005/peça).

## 9. Atingibilidade (capacidade combinada)

### 9.1 Previsão (potencial, sem equipe)
`maxPecas(produto) = min( Σ_r min_{e∈E_r} cap_e , min_{e∈comuns} cap_e )` (rotas com máquinas disjuntas; com máquinas compartilhadas, o LP do §5). Pergunta respondida: *"com todas as rotas disponíveis, conseguimos 116.625?"* — e a divisão que melhor atende vem do planejador. Hoje `calcularCapacidadeMaximaProduto` faz `min` sobre **todas** as etapas, o que, sem mudança, trataria exclusiva+exclusiva em série e subestimaria.

### 9.2 Escala (plano)
Status por **produto final** (atingível / no limite / em risco / impossível) calculado sobre o **acabado planejado** (Σ das rotas limitado pelo gargalo comum), com causas novas: `gargalo_comum` (qual etapa), `rota_indisponivel`, além das atuais. Cada rota aparece como **detalhe** (necessidade, capacidade, falta). **Não** se avalia cada rota como produto final separado, e a parada da automática **não** torna o produto "impossível" se a convencional recupera.

### 9.3 Gargalo
Pode ser qualquer pool: Rosquear/Parafusar convencional, Máquina Automática, Etiquetar comum, Embalar comum. Se o gargalo é **comum**, produzir mais semiacabado nas duas rotas **não ajuda**: o planejador limita `Σ y_r` ao mínimo das comuns e **não** gera meta de semi acima disso (evita estoque inútil).

## 10. Produção Real

- O apontamento continua sendo `(produto, etapa, máquina, funcionário, período, produzido, refugo)`. Com produto único, `produto_id = Conector 3/4"` e `etapa_id` indica se é exclusiva (rota) ou comum.
- **Apontado real do produto** = Σ boas em **Embalar** (como hoje; `max(ordem)` do produto). Exemplo: 5.000 vindas da automática + 7.000 da convencional, embaladas 11.500 ⇒ **11.500** (um produto).
- **Rota do apontamento** = função da etapa (visão `v_apontamento_rota`): exclusiva → sua rota; comum → nenhuma (atribuída contabilmente, §7.4).
- Semanas antigas: apontamentos do cadastro legado seguem com seu `produto_id`; relatórios "por produto final" somam via `produto_variante_legada` **com rótulo explícito** da origem legada.

## 11. Migração (sem reescrever histórico)

1. **Fase M0 — só leitura.** Criar tabelas aditivas (vazias) e o mapa de equivalência. Nada ativo.
2. **Fase M1 — cadastro.** Criar rotas CONV/AUTO no "Conector 3/4"", renumerar `ordem` (§3.4) e criar a etapa "Rosquear + Parafusar" em P. O produto antigo A permanece intacto.
3. **Fase M2 — sombra (comparação).** O planejador roda **em sombra** sobre as semanas já feitas/atuais, com a demanda combinada (81.000 + 35.625), e compara com a divisão manual real e com o realizado. Nada altera a Escala oficial (mesmo padrão das fases anteriores do WIP/replanejamento).
4. **Fase M3 — primeira semana em modo rotas.** A **semana corrente (26/10) não é migrada**. A partir de uma semana futura escolhida, `previsoes.modelo_rotas = true`. A conversão do dado de entrada é feita por RPC com **prévia** (quantidade combinada, máquinas por etapa, rotas disponíveis) e **snapshot** antes/depois (reversível enquanto não houver apontamento). Condição: semana sem apontamento e sem períodos congelados.
5. **Fase M4 — desativar o cadastro legado para novas Previsões** (`ativo=false`), mantendo todo o histórico e o mapa de equivalência.
- **Reversão:** `modelo_rotas=false` volta a semana ao modelo antigo (enquanto os itens originais estiverem preservados no snapshot).

## 12. Simulação obrigatória (cálculo conceitual)

**Hipóteses (declaradas):** semana de 5 dias; custo/peça das etapas = snapshots reais de out/26 (§1.1); valor unitário 0,1825; capacidade da **automática 35.625** (máquina única); capacidade **convencional 81.000** (equipe); etapas **comuns** disponíveis para este produto: Etiquetar 140.000 e Embalar 130.000 (compartilhadas com outros produtos — *valores ilustrativos*); estoque inicial opcional: 8.000 parafusados (conv) + 5.000 R+P (auto).

Custos/peça: **conv** = 0,02479 + 0,03291 + 0,01368 + 0,00979 = **0,08117** (margem 0,10133 = 55,5%); **auto** = 0,03737 + 0,01368 + 0,00979 = **0,06084** (margem 0,12166 = 66,7%).

### 12.1 Caso base (sem estoque inicial)
| Item | Valor |
|---|---|
| Demanda final | **116.625** |
| Divisão do planejador | **Automática 35.625** (capacidade cheia, mais barata) · **Convencional 81.000** |
| Fluxo diário (semis) | auto 7.125/dia + conv 16.200/dia = **23.325/dia** → entra em Etiquetar (cap. ~28.000/dia) → Embalar (~26.000/dia) |
| Acabado acumulado (seg→sex) | 23.325 · 46.650 · 69.975 · 93.300 · **116.625** |
| WIP na convergência | ~0 (pipeline no mesmo dia; Etiquetar/Embalar não saturam) |
| Atingibilidade | **Atingível no limite**: a convencional e a automática estão a 100%; folga do gargalo comum (Embalar 130.000) = 13.375 (**11,5%**) |
| Custo | A: 81.000 × 0,08117 = R$ 6.574,77 · B: 35.625 × 0,06084 = R$ 2.167,42 · total **R$ 8.742,19** |
| Receita / margem | 116.625 × 0,1825 = R$ 21.284,06 · margem **R$ 12.541,87 (58,9%)** — A: R$ 8.207,73 · B: R$ 4.334,14 |
| Economia da automática | se tudo fosse convencional: R$ 9.466,45 ⇒ economia **R$ 724,26** |

### 12.2 Com estoque inicial (WIP)
Disponíveis para Etiquetar no início: 8.000 (conv) + 5.000 (auto) = **13.000**. O planejador usa a automática na capacidade cheia (35.625 novas + 5.000 de estoque = 40.625 acabados) e a convencional entrega 76.000 acabados, dos quais **8.000 já estão prontos** ⇒ **produzir de novo na convencional: 68.000** (antes 81.000; libera 13.000 peças ≈ 1,6 dia da convencional). Produto final continua 116.625; custo desta semana só conta a produção **nova**.

### 12.3 Cenário A — automática parada
- Capacidade AUTO = 0 → alvo AUTO = 0; convencional vai ao limite: **81.000** (sem estoque) ⇒ atendimento **69,5%**, falta **35.625 (30,5%)**.
- O produto **não** fica "impossível por cadastro": o motor mostra o que a convencional recupera e a **ação**: **+2 operadores** (1 Rosquear + 1 Parafusar convencionais) adicionam até 8.100/dia (limite da parafusadeira) = **+40.500/semana ≥ 35.625** ⇒ recuperável **se** as máquinas estiverem livres (compartilhadas com Luva etc.). Com o estoque de 5.000 da automática (12.2) o déficit cai para 30.625.
- Observação econômica: a margem cai (toda a produção a 0,08117).

### 12.4 Cenário B — automática acima do esperado
Se a máquina entrega 7.800/dia (**39.000/semana**, +9,5%): no replanejamento seguinte o alvo AUTO sobe para 39.000 e o da convencional cai para **77.625** (libera 3.375 peças ≈ 0,2 dia de convencional). Só vale se Etiquetar/Embalar absorvem (aqui sim, 116.625 ≤ 130.000). **Sobra de capacidade da automática** (ex.: horas extras ⇒ 50.000): AUTO 50.000 / CONV 66.625, desde que o gargalo comum permita; se Etiquetar já estiver em 100.000, **não adianta** — o planejador não move nada.

### 12.5 Cenário C — Etiquetadora vira gargalo (disponível 100.000)
`Σ y_r ≤ 100.000` ⇒ AUTO 35.625 (mais barata) + CONV **64.375**; **atendimento 85,7%**, falta **16.625**, causa **`gargalo_comum: Etiquetar`**. A chegada em Etiquetar é 20.000/dia (100.000/5): **sem estoque acumulado**. O motor **não** pede os 81.000 da convencional (gerariam 16.625 de semiacabado parado no teto de estoque) — libera essas pessoas para outros postos. Ação: priorizar a segunda etiquetadora/horas extras; recuperar 16.625 (14,3%) só com mais capacidade de Etiquetar.

### 12.6 Cenário D — falta operador na convencional
Capacidade CONV por equipe cai para **60.000**: AUTO 35.625 + CONV 60.000 = 95.625 ⇒ falta **21.000 (18,0%)**, causa `semana_sem_equipe`/`capacidade_rota`; ação: **+2 operadores** (a convencional precisa de 2 pessoas por fluxo; a automática, 1). A automática **não** é sacrificada: é a rota mais barata e já está no teto.

## 13. Riscos e pontos em aberto

1. **Renumeração de `ordem`** (§3.4): única alteração em dado existente; exige ensaio e janela. Alternativa (sumidouro do grafo) altera RPCs de indicadores — descartada por risco.
2. **Motor da Escala:** a generalização "mais de uma origem na convergência" toca `cobertura`, `adicionalWip`, `wipSaldo`, alertas e atingibilidade; entra **primeiro em sombra** e só depois no motor oficial (padrão já usado). Testes de equivalência: produtos lineares precisam gerar **exatamente** a mesma escala/hash de hoje.
3. **Equipe e revezamento:** a única máquina automática exige pessoas **diferentes** em períodos consecutivos (revezamento duro) — a capacidade real da automática pode ficar abaixo de 35.625 se faltarem pessoas aptas; o planejador precisa enxergar isso (pessoas elegíveis por operação).
4. **Regra de atribuição do acabado por rota** (FIFO × proporcional) é uma convenção contábil — precisa de aprovação; sem rastreabilidade por lote não há "verdade física" por peça.
5. **Duas máquinas/metas diferentes na mesma etapa comum** não existem hoje; se surgirem (ex.: Etiquetar com metas por rota), o modelo aceita metas **por etapa**, não por rota — decidir se é necessário.
6. **Preço único** (0,1825 × 0,182) e **margem histórica** do cadastro legado — comparativos históricos usam o mapa de equivalência com rótulo.
7. **Adicional/estoque planejado** (camada de WIP extra) por rota: versão inicial limitada à rota preferida; refinamento depois.
8. **Desempenho/Intelligence/PDFs** que agrupam por produto precisam de revisão para o mapa de equivalência (relatórios sem mudança de schema).
9. **Custo das etapas comuns por rota** é rateio (não medição); a "economia da automática" mede a **diferença das etapas exclusivas**, que é a parte física realmente distinta.
10. **Demanda adicional** (`quantidade_adicional`) permanece no produto único; o desenho do adicional por rota é item à parte.

## 14. Decisões que preciso de você

1. **Preço único:** 0,1825 (do convencional) ou 0,182?
2. **Regra de atribuição** do acabado por rota para custo/margem: FIFO por rota (recomendada) ou proporcional?
3. **Política do planejador:** maximizar atendimento e depois custo (recomendada) — ou aceitar atender menos para usar mais a automática? (não recomendo)
4. **Limites por rota na Previsão** (mínimo/máximo/fixo): quer já na primeira versão ou só divisão automática?
5. **Primeira semana em modo rotas:** qual (sugiro a primeira sem apontamento, ex.: a de 02/11 se já existir Previsão), com a de 26/10 intacta.
6. **Operadores:** confirmar que a automática usa 1 operador e a convencional 2 por fluxo (Rosquear e Parafusar) — e se há mais de uma pessoa apta a operar a automática (revezamento).
7. **Rastreabilidade por lote** (rota de origem no apontamento de Etiquetar/Embalar) é necessária? (hoje proponho **não**.)

## 15. Plano de fases (quando for implementar)

| Fase | Entrega | Risco |
|---|---|---|
| M0 | tabelas aditivas + mapa de equivalência + `rotasDoProduto` (rota implícita) + testes de equivalência dos produtos lineares | muito baixo |
| M1 | cadastro de rotas no produto (UI), renumeração de `ordem` do Conector 3/4" (com ensaio) | médio (única mudança em dado) |
| M2 | planejador de rotas **puro** + atingibilidade/capacidade da Previsão ciente de rotas (somente leitura) | baixo |
| M3 | **sombra** do planejador/motor com pools por rota nas semanas atuais; comparação com o manual e o realizado | baixo |
| M4 | motor oficial com rotas (primeira semana em modo rotas); WIP convergente; Produção Real/custo por rota | médio/alto (gated por aprovação) |
| M5 | conversão de semanas futuras, desativação do cadastro legado, relatórios por produto final | médio |

Cada fase: DEV/Preview primeiro; PROD só com aprovação explícita; nenhuma fase altera `ativo_restrito`, revezamento duro, WIP existente ou semanas passadas sem autorização.

# Produto único com múltiplas rotas de fabricação — DESENHO TÉCNICO (revisão 2)

Status: **somente desenho.** Nada implementado, nenhuma migration aplicada, nada alterado em PROD. Esta revisão incorpora as decisões definitivas de 26/10/2026 e os **resultados da leitura somente leitura de PROD** (§15), que resolveram os quatro pontos que estavam "a verificar".

## 0. O que mudou em relação à revisão 1

| Tema | Revisão 1 | **Revisão 2 (definitiva)** |
|---|---|---|
| Roteiro legado | renumerar `ordem` de Etiquetar/Embalar do Conector 3/4" | **nenhum UPDATE, nenhuma reutilização de `etapa_id`.** O novo modelo nasce em **um produto final novo, com etapas novas** (§3) |
| Atribuição do acabado por rota | FIFO | **Proporcional**; e a análise econômica principal é **até o ponto de convergência** (§7) |
| Convergência | derivada | **explícita**: "pool comum" é um conceito de primeira classe (§4.3) |
| Economia da automática | diferença de custo das etapas exclusivas | idem, medida pelo **volume entregue ao pool comum**; custos comuns **rateados proporcionalmente** (§8) |
| Limites por rota | mínimo/máximo/fixo | **V1 só MÁXIMO**; arquitetura preparada para mín/fixo (§5.4) |
| Operadores | coluna opcional | **sem coluna**; resultado natural dos postos ativos (§6.4) |
| Lote | opcional, fora de escopo | **explicitamente fora da V1** |
| Primeira semana | a definir | **02/11/2026**; 26/10 integralmente legada (§11) |
| Política do planejador | atendimento → custo → estabilidade | **6 passos definitivos**, nunca sacrificar atendimento por custo (§5.2) |
| Compatibilidade | testes | **protocolo de prova de equivalência** para produtos lineares (§10) |

**É possível fazer sem alterar o roteiro existente? Sim** — a condição é o novo modelo viver em um **produto final novo** (com etapas novas) e a troca ser feita **por semana**. Reutilizar o produto atual para hospedar as rotas **não** é possível sem alterar significado (explicado em §3.2) — por isso foi descartado.

## 1. Decisões definitivas e onde cada uma é atendida

| # | Decisão | Onde |
|---|---|---|
| 1 | não alterar o roteiro legado (sem UPDATE de `ordem`, sem trocar significado de `etapa_id`, sem reutilizar etapa antiga) | §3, §4, §11 |
| 2 | primeira semana 02/11/2026; 26/10 intacta (Previsão, Escala, WIP, Produção Real) | §11 |
| 3 | produto final único; rotas CONV/AUTO; cadastro "…Máq. Automática" continua só como histórico | §3, §4 |
| 4 | um preço comercial por produto final (R$ 0,1825 se confirmado no cadastro vigente) | §3.3 |
| 5 | custo por rota calculado do sistema, nunca hardcoded | §8 |
| 6 | sem FIFO; atribuição proporcional | §7.3, §8 |
| 7 | economia medida até a convergência; comuns rateados proporcionalmente | §8 |
| 8 | política do planejador em 6 passos | §5.2 |
| 9 | automática favorecida só onde há capacidade útil | §5.3 |
| 10 | V1: máximo por rota | §5.4 |
| 11 | operadores = postos ativos; sem coluna | §6.4 |
| 12 | aptidão: vários funcionários podem operar a automática | §6.5 |
| 13 | sem rastreabilidade por lote | §7.5 |
| 14 | convergência explícita (pool comum) | §4.3 |
| 15 | WIP separado por rota antes; comum depois | §7 |
| 16 | uma demanda única na Previsão; divisão calculada | §5.1 |
| 17 | Produção Real: rota pela `rota_etapa` antes da convergência; Embalar conta | §9 |
| 18–21 | atingibilidade, parada, acima do esperado, gargalo comum | §5.5, §12 |
| 22 | estruturas sem alteração destrutiva; produtos lineares intactos | §4, §10 |
| 23 | prova de equivalência | §10 |
| 24 | migração M0–M5 aditiva, reversível, sombra | §11 |

## 2. Diagnóstico resumido do modelo atual

- **Uma cadeia linear por produto:** `roteiro_etapas` com `UNIQUE (produto_id, ordem)`.
- **A ordem carrega significado:** "última etapa" = `max(ordem)` (RPCs de indicadores e `obter_apontado_real_previsao_por_semana`); "etapa seguinte" do WIP = a de `ordem` imediatamente maior (`wip_controle_criar` recusa pares não consecutivos: `WIP_ETAPAS_NAO_CONSECUTIVAS`).
- **Pool do motor = (produto, etapa)**, cadeia por `ordemEtapa`; WIP/adicional/alertas assumem origem única → etapa seguinte.
- **Capacidade da Previsão:** cada etapa é restrição independente; gargalo = mínimo entre as etapas do produto (`calcularCapacidadeMaximaProduto`).
- **Custo:** soma das etapas do produto (`calcularIndicadoresProducao`); apontamentos guardam snapshots de custo e de valor.
- **Dados reais (leitura anterior, out/26):** convencional Rosquear→Parafusar→Etiquetar→Embalar (meta/máquina/período 2000·1500·3500·5000 de manhã) e automática (R+P 1275 → Etiquetar → Embalar), valor unitário 0,1825 × 0,182; Etiquetar e Embalar **já são as mesmas máquinas e metas** nos dois cadastros. Previsão 26/10: 81.000 + 35.625; **35.625 = 7.125/dia × 5** (capacidade da única máquina automática).

## 3. Estratégia aditiva: produto final novo, etapas novas

### 3.1 Estrutura

Um **novo cadastro de produto** — o **produto final único** (a seguir "**F**") — com **etapas novas** (ids novos, `ordem` próprias dentro de F):

```
F (Conector 3/4" — produto final único, valor único)
  etapas exclusivas da rota CONV : Rosquear (ordem 0) → Parafusar (ordem 1)
  etapa  exclusiva  da rota AUTO : Rosquear + Parafusar (ordem 2)
  ── POOL COMUM (convergência) ──
  etapas comuns                  : Etiquetar (ordem 3) → Embalar (ordem 4)   ← última etapa = max(ordem)
```

O cadastro atual **Conector 3/4"** (P) e **Conector 3/4" – Máq. Automática** (A) permanecem **exatamente como estão** (etapas, ordens, apontamentos, WIP, Previsões antigas, incluindo a semana 26/10).

### 3.2 Por que não hospedar as rotas dentro de P

Adicionar a etapa "Rosquear + Parafusar" a P sem renumerar exige `ordem` maior que as existentes — o que faria o novo Embalar (cauda comum) ter `max(ordem)` e **deixaria de ser "última etapa" o Embalar legado**, reinterpretando semanas antigas em RPCs de indicadores e apontado real. Renumerar viola a decisão 1. Reaproveitar o `etapa_id` legado para a nova semântica também. **Logo:** o novo modelo precisa ser outro produto.

### 3.3 Cadastro de F (parâmetros, sem hardcode)

- `valor_unitario`: **um só** — o valor comercial vigente do Conector 3/4" (0,1825 **se** confirmado no cadastro/contrato; o cadastro legado da automática tem 0,182 e **não** é propagado).
- Metas, máquinas e operações das etapas de F são **copiadas por cadastro** (valores, não referências) a partir dos cadastros atuais e **passam a ser mantidas em F** — mudar meta em P/A não muda F e vice-versa. Custo/hora por operação continua vindo do sistema; nada é gravado como constante no código.
- `nome`/`referencia`: **confirmado em PROD** (§15) que `produtos.nome` **não** tem restrição de unicidade — produtos são identificados só pelo `id` (uuid) e `referencia` é informativa (sem índice único). Mesmo assim F deve ter **nome distinto** para não confundir telas/relatórios que mostram o nome: **recomendado `Conector 3/4" (Final)`**, `referencia` = a do produto vendido (56126022), **valor 0,1825**. Na interface, o seletor de produtos da Previsão filtra pelo **modo da semana** (§4.4), então o usuário vê um só "Conector 3/4"" por semana.

## 4. Modelo de dados (todas as estruturas são aditivas)

### 4.1 Tabelas novas

```
produto_rota                      -- uma por forma de fabricar F
  id uuid PK, produto_id FK produtos (F), codigo text ('CONV'|'AUTO'), nome text,
  ativa boolean, preferencia smallint,                       -- só desempate (passo 6 da política)
  UNIQUE (produto_id, codigo)

rota_etapas                       -- só as etapas EXCLUSIVAS da rota, em ordem
  rota_id FK, etapa_id FK roteiro_etapas, posicao smallint,
  PK (rota_id, etapa_id), UNIQUE (rota_id, posicao)
  -- trigger: etapa.produto_id = rota.produto_id; etapa de uma rota não pode estar em outra

produto_pool_comum                -- CONVERGÊNCIA EXPLÍCITA (1 por produto com rotas)
  produto_id PK FK produtos (F), etapa_entrada_id FK roteiro_etapas   -- primeira etapa comum (Etiquetar)
  -- etapas comuns = etapas de F com ordem >= a de etapa_entrada_id (Etiquetar, Embalar)
  -- invariantes (trigger): toda etapa exclusiva tem ordem < etapa_entrada; "última etapa" (max ordem) é comum

previsao_item_rota                -- restrições opcionais por semana (V1: só MÁXIMO)
  item_id FK previsao_itens, rota_id FK produto_rota, modo text, quantidade numeric,
  CHECK (modo = 'maximo')  -- a V1 aceita só 'maximo'; 'minimo'/'fixo' entram depois por ALTER do CHECK (aditivo)
  UNIQUE (item_id, rota_id)

escala_rota_divisao               -- append-only: o que o planejador decidiu e por quê
  id, previsao_id, produto_id, rota_id, versao_plano_id, quantidade_alvo, capacidade_rota, motivo jsonb, criado_em

produto_variante_legada           -- SÓ para análises/relatórios (nunca altera dados)
  produto_legado_id PK FK produtos, produto_final_id FK produtos (F), rota_id FK produto_rota, desde date
  -- (P → F, CONV) e (A → F, AUTO)

wip_controle_encerramento         -- aditiva: encerra controles LEGADOS a partir de uma semana, sem UPDATE em wip_controle
  controle_id PK FK wip_controle, a_partir_de_semana date, motivo text, criado_por, criado_em
```

### 4.2 Coluna nova (única em tabela existente)

- `previsoes.modelo_rotas boolean not null default false` — **chave por semana** (`ADD COLUMN` com default; nenhuma linha existente muda de comportamento).

### 4.3 O pool comum (conceito explícito)

```
CONV:  Rosquear → Parafusar ─────┐
                                  ├──►  POOL COMUM  ──► Etiquetar ──► Embalar ──► Conector 3/4" (final)
AUTO:  Rosquear + Parafusar ─────┘
```

- **Pool comum** = quantidade de semiacabado **pronto para Etiquetar**, vinda de qualquer rota. Saldo do pool = `Σ entregas das rotas (+ saldos de abertura) − boas em Etiquetar`.
- Antes do pool existem **saldos por rota** (CONV pronta, AUTO pronta); depois do pool **não há mais separação**: Etiquetar e Embalar são comuns (um pool de demanda, um WIP).

### 4.4 Travas de integridade (triggers/constraints de validação)

- Semana com `modelo_rotas = true`: `previsao_itens` **só aceita** produtos com rotas (F) e **recusa** os produtos legados listados em `produto_variante_legada` (impede duplicar a demanda).
- Semana com `modelo_rotas = false`: recusa F (produto de rotas só existe em semana de rotas).
- Etapas de F e de rotas não podem ser editadas de modo que quebrem os invariantes (exclusivas antes do pool; Embalar = max ordem).

### 4.5 O que **não** muda

`produtos` e `roteiro_etapas` **legados** (linhas e valores), `apontamentos_producao`, `wip_controle/ajustes/confirmacoes/saldo_semanal` legados, `previsao_itens` e `previsao_item_maquinas` das semanas antigas, `escala_*` das semanas antigas. As tabelas existentes aceitam F sem alteração de schema (`previsao_item_maquinas` já é por `etapa_id`; `apontamentos_producao` já é `(produto_id, etapa_id)`).

## 5. Previsão e planejador de rotas

### 5.1 Previsão
Semana de rotas: **um item** `Conector 3/4" = 116.625` (demanda oficial). O usuário só marca as **máquinas por etapa** (como hoje). A divisão (ex.: AUTO 35.625 / CONV 81.000) aparece como **detalhe calculado**, não como entrada. Rotas disponíveis = rotas cujas etapas exclusivas têm máquina selecionada.

### 5.2 Política do planejador (definitiva, nesta ordem)
1. **Maximizar o atendimento** da demanda final.
2. **Respeitar capacidade e restrições físicas** (máquinas, equipe, dias, indisponibilidades, revezamento).
3. **Evitar gargalo inútil / WIP excessivo** (não gerar semiacabado que o pool comum não consegue consumir; respeitar o teto de estoque).
4. **Minimizar custo.**
5. **Preservar a estabilidade** da divisão anterior (histerese, ~1 período da rota ou ~3%).
6. **Desempatar** por `produto_rota.preferencia`.

**Nunca** se reduz o atendimento para usar a rota mais barata: o passo 4 só escolhe entre soluções que já maximizam o atendimento.

### 5.3 Favorecimento econômico da automática
A AUTO é preferida **somente até onde** existem: capacidade real; **operador válido**; revezamento permitindo; etapas comuns absorvendo; teto de WIP permitindo; sem criar semiacabado inútil. Fora disso o restante vai para a CONV.

### 5.4 Limites por rota (V1)
Só **MÁXIMO** por rota. Padrão: AUTO tem máximo = **capacidade real possível** (calculada); CONV **absorve o restante possível**. A tabela `previsao_item_rota` existe para o gestor **reduzir** o máximo de uma rota na semana; `mínimo` e `fixo` **não são suportados** na V1 (o `CHECK` as proíbe e pode ser ampliado por migration aditiva quando houver necessidade concreta).

### 5.5 Atingibilidade (pergunta principal)
"**Conseguimos entregar 116.625 Conectores 3/4"?**" — nunca "o convencional" ou "o automático" separadamente.

`capacidade de entrada no pool = Σ capacidades úteis das rotas exclusivas`, **limitada por**: Etiquetar comum; Embalar comum; equipe; dias; WIP; revezamento; indisponibilidades. Saída: atende/não atende, **qual combinação** atende melhor (a divisão do §5.2) e a **causa** do que faltar (`gargalo_comum`, `rota_indisponivel`, `semana_sem_equipe`, …). Com máquinas disjuntas entre rotas: `y_AUTO = min(D, cap_AUTO + saldo_AUTO, cap_comum)`; `y_CONV = min(D − y_AUTO, cap_CONV + saldo_CONV, cap_comum − y_AUTO)`; caso geral: pequeno LP determinístico.

### 5.6 Quando roda e como é registrado
Geração semanal e **cada replanejamento**; só o horizonte ainda mutável; passado congelado (regra atual do motor). A cada rodada grava `escala_rota_divisao` (alvo, capacidade, motivo). Parada da AUTO → capacidade 0 → o planejador recalcula quanto a CONV absorve; o produto **não** vira impossível por uma rota ter perdido capacidade. AUTO acima do esperado → alvo da CONV cai no **próximo replanejamento**; o produto final **não** passa da demanda (acabado extra só pela regra explícita de WIP/adicional já existente).

## 6. Escala

1. A Escala recebe **pools**: *Rosquear* (CONV), *Parafusar* (CONV), *Rosquear + Parafusar* (AUTO), *Etiquetar* (comum), *Embalar* (comum). Quantidades: exclusivas = alvo da rota − saldo da rota; comuns = **demanda restante total** (um pool só).
2. Equidade, revezamento duro, ausências, equipe semanal, máquina indisponível: **inalterados**.
3. Alertas de falta de material na convergência passam a somar as origens (produção acumulada das rotas + saldo do pool) em vez de origem única.
4. **Operadores (sem coluna):** resultam dos **postos ativos** — AUTO: 1 posto = 1 operador por período; CONV: Rosquear = 1 posto e Parafusar = 1 posto, logo 2 operadores quando os dois rodam. Nada de "rota convencional usa 2 operadores" como regra gravada.
5. **Aptidão:** mais de uma pessoa pode operar a máquina automática; nada amarra a rota AUTO a um funcionário (continua sujeita a disponibilidade, revezamento duro e equipe semanal).
6. Plano com a máquina automática indisponível: pool AUTO com capacidade 0 (indisponibilidade já existente).

## 7. WIP e Produção Real

### 7.1 WIP
- **Antes da convergência:** saldos **separados por rota**, cada um com seu `wip_controle` (`Parafusar(F) → pool` e `R+P(F) → pool`). Ex.: CONV pronta 8.000, AUTO pronta 5.000 ⇒ **pool disponível para Etiquetar = 13.000**.
- **Depois:** WIP **comum** — não se separa mais AUTO/CONV em Etiquetar/Embalar.
- **Criação de controles de F:** a função atual exige etapas consecutivas por `ordem`; para produtos com rotas entra uma **função nova** (a atual permanece intacta para os produtos lineares) que valida o par pela **estrutura de rotas** (origem = última etapa exclusiva de uma rota; seguinte = primeira etapa do pool comum).
- **Saldos de abertura em 02/11:** novos controles de F nascem com `saldo_inicial` vindo de **confirmações explícitas** (uma pessoa atesta quanto há de Parafusados e de Rosqueados+Parafusados na abertura); **não** se copiam nem se alteram os controles legados, que são **encerrados por semana** em `wip_controle_encerramento` (para um mesmo estoque físico não ser alocado duas vezes).

### 7.2 Produção Real
- **Antes da convergência:** o apontamento mantém a identidade da rota pela `rota_etapa` (etapa exclusiva → rota).
- **Depois:** apontamento do produto final comum (etapas comuns não têm rota).
- **Apontado real do produto** = **somente Embalar**, `produzido − refugo` (Embalar é `max(ordem)` de F, então RPCs atuais funcionam sem mudança). Ex.: 5.000 da AUTO + 7.000 da CONV, embaladas 11.500 ⇒ **11.500** — não existe segundo produto.
- **Sem alteração de schema** em `apontamentos_producao`.

### 7.3 Atribuição proporcional (análises agregadas)
Quando uma análise precisar dividir algo comum entre rotas (consumo de Etiquetar contra os saldos por rota, custo comum), usa-se **proporção ao volume entregue ao pool comum** — nunca FIFO e nunca "esta peça veio da rota X".

### 7.4 Fora da V1
**Sem lote / sem rastreabilidade física.** O necessário é saber **quanto cada rota entregou ao pool comum** — suficiente para custo, produtividade, economia, planejamento e atingibilidade.

## 8. Custo, margem e economia (calculados, nunca hardcoded)

- **Custo exclusivo da rota (planejado)** = Σ das etapas **exclusivas** da rota: `tempo/peça × custo/hora da operação` (reaproveita `calcularIndicadoresProducao` sobre as etapas da rota). **Realizado:** snapshots dos apontamentos das etapas exclusivas (`custo_unitario_referencia_periodo_vigente`, `custo_operacional_periodo_vigente`).
- **Contribuição econômica = até a convergência:** `volume entregue ao pool × (valor − custo exclusivo)` por rota, mais o **volume** e a **produtividade** de cada rota.
- **Economia da automática** = `volume AUTO entregue × (custo exclusivo CONV por peça − custo exclusivo AUTO por peça)` — medida **antes** da convergência, onde as rotas realmente diferem.
- **Custos comuns** (Etiquetar + Embalar): custo do produto final; só quando uma análise **por rota** exigir, são **rateados proporcionalmente** ao volume entregue ao pool. Com rateio proporcional ao volume o custo comum **por peça é igual** nas rotas, então a diferença entre rotas vem exclusivamente das etapas exclusivas (sem inventar origem física).
- **Preço:** um só (§3.3); a margem por rota varia pelo custo, não pelo preço.
- Os valores usados nos exemplos (§12) vêm dos snapshots reais de out/26 e **servem só de ilustração**: o sistema sempre recalcula dos custos e produtividades vigentes.

## 9. Atingibilidade, parada e gargalo (resumo das regras)

- **Parada da AUTO:** demanda continua 116.625; planejador recalcula o que a CONV absorve; mostra o déficit e as **ações** (operadores, máquinas livres) em vez de "impossível".
- **AUTO acima do esperado:** reduz a necessidade da CONV no próximo replanejamento; não cria acabado acima da demanda sem regra explícita.
- **Gargalo comum (Etiquetar/Embalar):** o planejador limita `Σ entregas` à **demanda restante + WIP permitido** e **não** gera meta de semiacabado nas rotas exclusivas sem utilidade (libera as pessoas).

## 10. Compatibilidade — prova de equivalência para produtos lineares

Objetivo: **produto sem rotas ⇒ comportamento idêntico, byte a byte**, antes e depois da arquitetura.

1. **Por construção.** Todo código novo passa por `rotasDoProduto(produto)`, que para produto **sem linhas em `produto_rota`** devolve **uma rota implícita** = etapas por `ordem`, e o planejador **não é invocado** (`rotas.length ≤ 1 ⇒ quantidades por pool = as de hoje`). Nenhuma tabela/coluna existente é alterada (exceto o `ADD COLUMN previsoes.modelo_rotas default false`).
2. **Golden-master (antes/depois).** Antes de qualquer mudança, congelar saídas de referência para um **corpus real** (leitura de todas as Previsões/produtos lineares existentes, exportadas uma vez): `calcularHorasPorMaquina`, análise de capacidade, `calcularCapacidadeMaximaProduto`, `calcularAlocacaoSemanal`, `EntradaEscala` (hash canônico existente), `gerarEscala` (hash das alocações), atingibilidade, `wipSaldo`/adicional, apontado real. Depois da mudança, o **mesmo corpus** reproduz **os mesmos hashes** — teste que falha a build se qualquer um difere.
3. **Teste de propriedade.** Gerador de produtos lineares aleatórios (etapas, metas, máquinas, WIP, ausências) executado no pipeline antigo (congelado) e no novo: saídas idênticas para milhares de sementes.
4. **Banco.** A migration M0 só **cria** objetos; o guard de PROD (contagens e hashes das tabelas operacionais, `escala_plano_versoes.hash_plano` das semanas existentes) deve sair **idêntico** antes/depois; `escala_plano_entrada` das semanas legadas não muda.
5. **Sombra em PROD.** Por um período, cada replanejamento calcula também o caminho novo e registra **divergência** (esperado: **0**) — só então o código com rotas pode ser habilitado.

## 11. Migração M0–M5 (aditiva, reversível, em sombra; 02/11/2026 como primeira candidata)

| Fase | Conteúdo | Mexe em dado existente? | Reversão |
|---|---|---|---|
| **M0** | Criar tabelas novas (vazias), `previsoes.modelo_rotas default false`, travas; `rotasDoProduto` + golden-master + prova de equivalência | **Não** | `DROP` dos objetos novos |
| **M1** | Cadastrar **F** (produto novo, valor único), suas **etapas novas** (cópia de metas/máquinas), rotas CONV/AUTO, `produto_pool_comum`, `produto_variante_legada` (P→F/CONV, A→F/AUTO) | **Não** (só inserts) | apagar linhas de F (sem uso) |
| **M2** | Planejador de rotas **puro** + atingibilidade/capacidade da Previsão ciente de rotas, somente leitura; **sombra** sobre as semanas atuais com a demanda combinada (comparação com a divisão manual e com o realizado) | Não | desligar |
| **M3** | Preparar **02/11**: conferir F, máquinas por etapa, equipe; **confirmações de WIP** de abertura (Parafusados e R+P) para os controles novos de F; `wip_controle_encerramento` dos legados **a partir de 02/11** | só inserts | remover inserts |
| **M4** | **Semana 02/11 em modo rotas** (`modelo_rotas=true`): item único 116.625 (se a Previsão de 02/11 já existir no modelo legado, conversão por RPC com **prévia e snapshot**, reversível enquanto não houver apontamento); motor oficial com pools por rota; WIP convergente; Produção Real e custo por rota | só a Previsão de 02/11 (com snapshot) | `modelo_rotas=false` + restaurar snapshot |
| **M5** | Semanas seguintes em modo rotas; relatórios por produto final via `produto_variante_legada`; legados seguem só como histórico (sem deletar, sem migrar apontamentos) | Não | por semana |

**Garantias:** a semana **26/10 permanece 100% legada** (Previsão, Escala, WIP e Produção Real não são reinterpretados); nenhuma `ordem` é alterada; nenhum `etapa_id` muda de significado; apontamentos antigos ficam onde estão.

**Compatibilidade de séries históricas:** comparar semanas antes/depois do corte por **produto final** usa `produto_variante_legada`, com rótulo "cadastro legado", sem tocar nos dados.

## 12. Simulação (cálculo conceitual, com as hipóteses declaradas)

**Hipóteses (as etapas comuns são ilustrativas; ver o dado real de 26/10 em §15, que mostra um gargalo comum de verdade):** semana de 5 dias; custos/peça = snapshots reais de out/26 (ilustrativos; o sistema recalcula); valor 0,1825; **AUTO capacidade 35.625**; **CONV 81.000** (equipe); etapas comuns disponíveis p/ este produto: Etiquetar 140.000, Embalar 130.000 (ilustrativos); estoque inicial opcional 8.000 (CONV pronta) + 5.000 (AUTO pronta).

Custo/peça: **CONV exclusivo** 0,02479 + 0,03291 = **0,05770**; **AUTO exclusivo** **0,03737**; **comum** (Etiquetar + Embalar) 0,01368 + 0,00979 = **0,02347** (igual nas duas rotas pelo rateio proporcional). Totais: CONV 0,08117 (margem 55,5%), AUTO 0,06084 (margem 66,7%).

### 12.1 Caso base (sem estoque)
| | |
|---|---|
| Demanda final | **116.625** |
| Divisão | **AUTO 35.625** (máximo = capacidade real) · **CONV 81.000** (absorve o restante) |
| Entregas ao pool comum | AUTO 7.125/dia + CONV 16.200/dia = **23.325/dia** → Etiquetar (≈28.000/dia) → Embalar (≈26.000/dia) |
| Acabado acumulado | 23.325 · 46.650 · 69.975 · 93.300 · **116.625** |
| Atingibilidade | atingível **no limite** (rotas a 100%; folga do gargalo comum 11,5%) |
| Contribuição até a convergência | AUTO 35.625 × (0,1825 − 0,03737) ; CONV 81.000 × (0,1825 − 0,05770) — comuns rateados proporcionalmente |
| Custo / margem | custo R$ 8.742,19 · receita R$ 21.284,06 · margem **R$ 12.541,87 (58,9%)** |
| **Economia da automática** | 35.625 × (0,05770 − 0,03737) = **R$ 724,26** (medida antes da convergência) |

### 12.2 Com estoque inicial
Pool disponível para Etiquetar no início = 8.000 + 5.000 = **13.000**. AUTO no máximo (35.625 novas + 5.000 prontas = 40.625); CONV precisa entregar 76.000, dos quais 8.000 já existem ⇒ **produzir de novo na CONV: 68.000** (antes 81.000). Custo da semana só conta a produção **nova**.

### 12.3 Cenário A — AUTO parada
Capacidade AUTO 0 ⇒ CONV no limite: **81.000** ⇒ atende **69,5%**, falta **35.625 (30,5%)**. Produto **não** vira "impossível": mostra o que a CONV recupera e as ações (**+2 postos** — 1 Rosquear + 1 Parafusar — somam até 8.100/dia ≈ 40.500/semana se houver máquinas e pessoas). Com os 5.000 de estoque AUTO o déficit cai para 30.625.

### 12.4 Cenário B — AUTO acima do esperado
7.800/dia (39.000/semana): no replanejamento seguinte o alvo AUTO sobe e a necessidade da CONV cai para **77.625**; produto final **não** passa de 116.625. Com sobra de capacidade AUTO (ex.: 50.000): AUTO 50.000 / CONV 66.625, **somente** se o pool comum absorve; se Etiquetar já limita, nada se move.

### 12.5 Cenário C — Etiquetar vira gargalo (disponível 100.000)
`Σ entregas ≤ 100.000`: AUTO 35.625 + CONV **64.375**; atende **85,7%**, falta **16.625**, causa `gargalo_comum: Etiquetar`; chegada 20.000/dia = capacidade, **sem estoque acumulado**. O motor **não** pede os 81.000 da CONV (geraria semiacabado sem uso) e libera essas pessoas.

### 12.6 Cenário D — falta de operador na CONV
CONV por equipe cai para 60.000 ⇒ AUTO 35.625 + CONV 60.000 = 95.625, falta **21.000 (18,0%)**, causa `semana_sem_equipe`; ação: **+2 postos** convencionais. A AUTO fica no teto (já é a rota mais barata e favorecida).

## 13. Riscos e pontos a verificar

**Pontos que estavam a verificar — resolvidos na leitura de PROD (§15):** sem unicidade em `produtos.nome`; Previsão de 02/11 **não existe** (nasce já em modo rotas, sem conversão); preço cadastrado 0,1825 (convencional) × 0,182 (automática); **nenhum** controle de WIP existe (0 controles, 0 saldos, 0 confirmações).

**Riscos:**
1. **Generalização do motor** (origens múltiplas na convergência) toca `cobertura`, `adicionalWip`, `wipSaldo`, alertas e atingibilidade — por isso entra em **sombra** e só depois no oficial, atrás da prova de equivalência (§10).
2. **Dois "Conector 3/4"" no banco** (legado e F): mitigado pelo filtro por modo da semana e pelas travas (§4.4); relatórios usam `produto_variante_legada`.
3. **Estoque físico na virada (02/11):** exige confirmações explícitas e o encerramento aditivo dos controles legados; erro aqui duplica ou perde WIP — por isso M3 é etapa própria, com conferência.
4. **Capacidade real da AUTO** depende de haver **pessoas aptas** e do **revezamento duro** (a única máquina exige pessoas diferentes em períodos seguidos).
5. **Etapas novas ⇒ história por etapa descontínua** na virada (ids novos); comparações por produto final usam o mapa de equivalência (nível produto); comparação por etapa entre os dois modelos é **por operação**, não por `etapa_id`.
6. **Adicional/estoque planejado por rota** (camada de WIP extra) fica **limitado na V1**; evoluir depois.
7. **Desempenho/Intelligence/PDFs** que agrupam por produto precisam consumir o mapa de equivalência (sem alterar schema legado).
8. **Mínimo e divisão fixa** não existem na V1 por decisão; a arquitetura (`previsao_item_rota.modo`) permite adicioná-los sem refazer.

## 14. Fases de implementação (quando houver aprovação)

DEV/Preview primeiro em todas; PROD só com aprovação explícita por fase; nenhuma fase toca `ativo_restrito`, revezamento duro, WIP legado, apontamentos antigos ou a semana 26/10.

| Fase | Entrega | Risco |
|---|---|---|
| M0 | objetos aditivos + `rotasDoProduto` + golden-master/prova de equivalência | muito baixo |
| M1 | cadastro de F, rotas e mapa de equivalência (inserts) | baixo |
| M2 | planejador puro + capacidade/atingibilidade da Previsão ciente de rotas (leitura) + sombra | baixo |
| M3 | preparação de 02/11 (confirmações de WIP, encerramento aditivo dos legados) | médio (conferência de estoque) |
| M4 | 02/11 em modo rotas (motor oficial, WIP convergente, Produção Real e custo por rota) | médio/alto, gated |
| M5 | semanas seguintes, relatórios por produto final | médio |

## 15. Leitura somente leitura de PROD (26/10/2026) — resultados

| Item | Resultado | Impacto no desenho |
|---|---|---|
| Restrições de `produtos` | só `PRIMARY KEY (id)` e `CHECK prioridade`; **sem UNIQUE em `nome`** nem em `referencia`; trigger só `updated_at` | F pode ser criado sem colisão técnica; identidade = `id`. Nome recomendado distinto: **`Conector 3/4" (Final)`** (não renomear nenhum existente) |
| Identificação dos produtos | `id` uuid; `referencia` informativa (P = 56126022; automática sem referência); o nome da automática tem **espaço no fim** (`"…Maquina Automatica "`) | confirma "não usar nome como chave"; F herda `referencia` 56126022 (mesmo produto vendido) |
| Preço vigente | P (Conector 3/4") **R$ 0,1825** (atualizado 20/10 18:22:24); automática **R$ 0,182** (atualizado 20/10 18:22:38, 14 s depois); itens da Previsão 26/10 gravam 0,1825 e 0,182 | preço único de F: **0,1825** (valor do produto vendido; 0,182 parece arredondamento — diferença R$ 0,0005/peça ≈ R$ 17,81 na semana de 35.625). **Confirmar com o contrato** antes de cadastrar F |
| Previsão de 02/11/2026 | **não existe** (nenhuma Previsão posterior a 26/10; existentes: 12/10, 19/10, 26/10) → sem Escala gerada | **02/11 segue seguro**: a Previsão nasce já em modo rotas, **sem conversão** de dados legados. Risco: alguém criar 02/11 no modelo legado antes do corte → travar/avisar na criação |
| WIP legado | **0 controles, 0 ajustes, 0 confirmações, 0 saldos semanais**; parâmetros: `wip_modo="ativo"`, `wip_dias_limite=1`, `wip_dias_limite_semanas={"2026-10-26": 2}` | **não há saldo de WIP a migrar**: os controles de F nascem do zero (confirmação de abertura opcional). `wip_controle_encerramento` provavelmente **desnecessário** (só existiria se houvesse controles legados) |
| WIP planejado de 26/10 | `previsao_item_adicional_etapa`: Conector 3/4" **Rosquear = 22.800** (adicional no intermediário); a automática sem adicional | vínculo com 26/10 permanece legado; no modelo de rotas o "adicional por etapa" por rota é item de fase posterior (V1 limitado) |
| Etapas legadas (identidade) | **Conector 3/4"**: Rosquear `ca90456c…` (ordem 0) · Parafusar `78aaa207…` (1) · Etiquetar `34371af3…` (2) · Embalar `b3db9629…` (3). **Automática**: R+P `1b72bf46…` (0) · Etiquetar `1863b452…` (1) · Embalar `fb96d08d…` (2). Operações: Rosquear `bb9da8be…`, Parafusar `11c45ab6…`, R+P `15625032…`, Etiquetar `b41b8b0e…`, Embalar `220902ab…` | **nenhum desses ids/ordens é tocado**. Confirma que a automática tem **etapas próprias** de Etiquetar e Embalar (ids distintos das do convencional), apesar de mesma operação, mesmas máquinas e mesmas metas |
| Máquinas legadas | Conv.: Rosq. 3/5/6 · Parafus. 9/10/11/12 · Etiq. 15/16 · Embal. 17. Auto: **Máq. Automática 8** (`a118f430…`, ativa) · Etiq. 15/16 · Embal. 17 | F copia (por valor) |
| Capacidade da AUTO | metas 1275/1275/1275/1100/1100/1100 ⇒ **7.125/dia**; 6 períodos/dia (M1 07:12–08:48, M2 08:48–10:24, M3 10:24–11:55, T1 13:00–14:20, T2 14:20–15:40, T3 15:40–17:00); 5 dias produtivos (26–30/10) ⇒ **35.625/semana**. Sem indisponibilidade (previsão nem recurso aberto) | **35.625 confirmado**, consistente com a Previsão |
| Máquinas escolhidas em 26/10 | **Convencional**: Rosq. 3+6 · Parafus. 10+9 · Etiq. **15** · Embal. 17. **Automática**: Máq. Aut. 8 · Etiq. **15** · Embal. 17 | veja o conflito abaixo |

**Conflitos / achados relevantes**

1. **Gargalo comum real em 26/10 (não é hipótese).** Os dois cadastros marcaram **somente a Etiquetadora 15** para Etiquetar, e ambos somam **116.625** na mesma máquina; a capacidade teórica da E15 na semana é **97.500** (19.500/dia × 5). Visto como dois produtos, cada um "cabe" (81.000 ≤ 97.500 e 35.625 ≤ 97.500); visto como **um** produto, o pool comum de Etiquetar **não fecha** sem a Etiquetadora 16 (que já tem a Caixa Amarela). É exatamente o tipo de gargalo que o modelo de rotas passa a enxergar de frente (cenário C do §12 deixa de ser hipotético para essa configuração). Embalar: Embalagem 17 = 142.500/semana ≥ 116.625 (ok).
2. **Capacidade CONV = 81.000** coincide com a **Parafusar**: 2 parafusadeiras (10 e 9) × 8.100/dia × 5 dias = 81.000 — ou seja, o "81.000 convencional" do pedido é o teto de Parafusar com duas máquinas marcadas (não uma quantidade livre).
3. **Preço divergente** 0,1825 × 0,182 (confirmar no contrato antes de cadastrar F).
4. **Sem WIP real hoje:** a Fase de WIP está "ativa" por parâmetro, mas não há nenhum controle/saldo — a virada para rotas não herda estoque.
5. **Nenhum conflito com a decisão de não renumerar:** F nasce com ids e ordens próprias; P e A ficam intactos.

## 16. Implementação M0 + M1 (somente DEV) — o que foi efetivamente criado

**Migrations** (aplicadas só no DEV; nenhuma em PROD): `20261106100000_rotas_m0_estruturas.sql` (M0, DDL aditivo) e `20261106110000_rotas_m1_cadastro_conector_final.sql` (M1, só INSERT, idempotente, copia metas/máquinas **por valor** dos cadastros legados no momento da aplicação; **para** se Etiquetar/Embalar divergirem entre P e A).

**Ajustes em relação ao desenho (decisões finais):** sem `wip_controle_encerramento` (não há WIP legado); `previsao_item_rota` virou **`previsao_rota_limite`** (chave lógica `(previsao_id, produto_id, rota_id)`, porque a Previsão recria `previsao_itens` a cada save); o pool comum é **uma tabela com a etapa final marcada** (`produto_pool_comum.final`), sem depender de `max(ordem)`; `escala_rota_divisao` existe só como estrutura (append-only); sem conversão de Previsão.

**Tabelas novas:** `produto_rota`, `rota_etapas`, `produto_pool_comum`, `previsao_rota_limite` (V1: `CHECK modo='maximo'`), `escala_rota_divisao`, `produto_variante_legada`. **Única coluna em tabela existente:** `previsoes.modelo_rotas boolean not null default false` (todas as semanas existentes = legado).

**Funções:** `produto_rotas_validar` (integridade), `produto_estrutura_rotas(produto)` e `produto_etapa_final(produto)` (**único ponto de verdade**: produto linear ⇒ regra legada `max(ordem)` explicitada; produto de rotas ⇒ etapa final **explícita**).

**Gatilhos novos:** validação de integridade no COMMIT (rotas, rota_etapas, pool comum e `roteiro_etapas` — no-op para produto linear); etapa pertence ao produto; vínculo legado; **proteção contra mistura** em `previsao_itens` e `previsoes` (semana de rotas recusa os produtos legados vinculados; semana legada recusa o produto de rotas; trocar o modo com itens incompatíveis é recusado). Nada disso é aplicado em PROD (a proteção para 02/11 é só DEV, como pedido).

**Produto F (DEV):** `Conector 3/4" (Final)` `0f4521cb-3aa3-43b7-b527-23dd11220481`, referência 56126022, **R$ 0,1825**; etapas **novas** (`ordem` 0..4 é só rótulo): Rosquear `571270fd…`, Parafusar `bba287e1…`, Rosquear + Parafusar `86a4e50b…`, Etiquetar `97bd404b…`, Embalar `3eb1108d…`. Rotas: **AUTO** `0e5d9bac…` (R+P) e **CONV** `982234cf…` (Rosquear → Parafusar); **pool comum**: Etiquetar → Embalar **[FINAL]**; vínculos: P → CONV, A → AUTO. (Observação: os valores copiados refletem o cadastro do DEV, que difere do PROD em Rosquear — só Rosqueadeira 6 — e Embalar 4600/3800; no PROD a M1 copia os valores de lá.)

**Código (puro, sem ativação):** `src/features/rotas/` — `estrutura.ts` (linear implícita × rotas; próxima/anterior/final explícita; validação), `capacidade.ts` (capacidade por etapa/rota/pool comum com competição por máquina; **não** é o planejador), `dados.ts`, `DiagramaRotas.tsx` e a página somente-leitura `/produtos/rotas` (demonstração; fora do sidebar).

**Prova de equivalência:** `docs/rotas-golden/README.md` — golden master TS + SQL **idênticos** antes/depois (capacidade, `EntradaEscala`, alocações, atingibilidade, WIP, apontado real, hashes da semana 26/10, colunas de todas as tabelas antigas). A 1ª comparação divergiu por um defeito do M0 (faltavam GRANTs ao `service_role`); corrigido e refeito.

**Testes:** `supabase/tests/rotas/t1_m0_m1.sql` (ids novos, legados intactos, convergência, etapas comuns únicas, final explícita, AUTO = 35.625 pelas metas, E15 = 97.500, integridade e mistura bloqueadas, privilégios) e `src/features/rotas/__tests__/rotas.test.ts` (convergência; AUTO = 35.625; **gargalo da Etiquetadora 15: 116.625 → 97.500**; **E16 não assumida livre** por causa da Caixa Amarela; AUTO parada; 1.000 produtos lineares aleatórios idênticos ao legado).

**Achados de risco (M0/M1):** (1) a página Produtos (legado) mostra F como cadeia linear de 5 etapas e calcula custo somando as 5 — enganoso só no DEV; tratar na fase da UI; (2) editar as etapas de F pela tela de Produtos é barrado pelas FKs/integridade (intencional); (3) `produto_estrutura_rotas`/`produto_etapa_final` devem ser a única fonte da "etapa final" em qualquer código novo — as RPCs de indicadores e apontado real **ainda usam `max(ordem)`** (coincide com Embalar em F, mas só por rótulo) e precisam ser trocadas antes de F ter apontamentos (Produção Real/M4); (4) o gatilho em `roteiro_etapas` roda para todo write de etapa (no-op para produtos lineares, custo mínimo).

## 17. Auditoria pós M0/M1 — o fluxo da fábrica (revisão de 26/10/2026) e correções

**Fluxo correto.** CONV: Rosquear → Parafusar → **Etiquetar → Embalar**. AUTO: Rosquear + Parafusar → **Etiquetar → Embalar**. A diferença termina **antes** de Etiquetar. A "rota" é o **trecho exclusivo** anterior à convergência; depois dela existe só o **fluxo comum** (Etiquetar → Embalar → Conector 3/4"). Rotas são caminhos **alternativos** (nenhuma peça passa de uma para a outra). `ordem` 0..4 é só rótulo.

**Respostas da auditoria**
1. **M0/M1 representavam o fluxo?** **Estruturalmente sim**: `rota_etapas` só tem etapas exclusivas, `produto_pool_comum` tem Etiquetar → Embalar uma vez, a convergência era implícita (entrada do pool). **Mas havia riscos reais fora do modelo** (itens 4–6) e a terminologia/convergência não estavam explícitas.
2. **`rota_etapas`**: **somente** as 3 etapas exclusivas (CONV: Rosquear, Parafusar; AUTO: Rosquear + Parafusar). Etiquetar/Embalar **nunca** aparecem dentro das rotas (verificado em SQL e TS).
3. **`produto_pool_comum`**: modela exatamente "CONV + AUTO → Etiquetar → Embalar [FINAL]" — uma linha por etapa comum, a final marcada.
4. **Sequência linear falsa?** **Sim, no código legado**: ele lê etapas por `ordem` (0→1→2→3→4 = Parafusar → Rosquear+Parafusar, falso). Pontos: `useProdutos` (Produtos/Previsão/Capacidade), criação de controle de WIP (aceitaria Parafusar → R+P por "consecutivas"), motor/capacidade se F entrasse numa Previsão, RPCs de indicadores/apontado real (`max(ordem)`).
5. **Duplicação de demanda por rota?** **Sim, se F entrasse no legado**: cada etapa de F viraria um pool com a demanda inteira (Rosquear = Parafusar = R+P = Etiquetar = Embalar = 116.625). No modelo novo isso **não existe**: `necessidadePorEtapa` dá às exclusivas só o que a rota entrega e ao fluxo comum **uma** necessidade (= Σ entregas).
6. **Custo de F somando CONV + AUTO + comum?** **Sim, no cálculo legado** (`calcularIndicadoresProducao` sobre a lista plana de 5 etapas ≈ R$ 0,1185/peça, contra ≈ 0,081 CONV e ≈ 0,061 AUTO). No modelo novo: custo final da rota = exclusivo da rota + comum (uma vez); teste prova a diferença.
7. **Ajustes feitos** (abaixo).

**Ajustes feitos (M0/M1 ainda não publicados ⇒ corrigidos nas próprias migrations; DEV recriado)**
- **Terminologia e convergência explícita:** comentários nas tabelas ("trecho EXCLUSIVO", "fluxo COMUM"); `produto_estrutura_rotas` passou a devolver `convergencia` = `{destinoId: Etiquetar, origens: [AUTO→Rosquear+Parafusar, CONV→Parafusar]}`; no código, `sequenciaDaRota` virou `percursoDaPeca` (caminho físico = trecho exclusivo + fluxo comum) e `Convergencia` entrou no tipo.
- **TRAVA DE SUPORTE** (`rotas_config.suporte_ativo`, padrão **false**): enquanto os consumidores do modelo de rotas não existirem, o produto de rotas **não entra** em nenhum fluxo: semana `modelo_rotas = true` é recusada; apontamento e controle de WIP do produto de rotas são recusados por gatilho. Isso elimina, por construção, a leitura linear falsa e a demanda duplicada. Virar a chave é um passo futuro e explícito (M4).
- **F nasce INATIVO** (`ativo = false`) e **invisível** para o carregador legado de produtos (`useProdutos` filtra produtos de rotas; sem a tabela/sem produtos de rotas o filtro é vazio ⇒ efeito zero nos lineares). A página `/produtos/rotas` (nova) é o único lugar que o mostra.
- **Custo correto** (`src/features/rotas/custo.ts`): exclusivo por rota + comum uma vez; **economia da AUTO** = (exclusivo CONV − exclusivo AUTO) × volume entregue ao pool; **rateio proporcional** do comum; nada fixo no código; teste mostra que a função legada sobre a lista plana daria o valor falso.
- **Demanda comum única** (`demanda.ts`): `necessidadePorEtapa` (a divisão é entrada; quem decide é o M2).
- **Procedimento de recriação do DEV** (`supabase/tests/rotas/rollback_dev_m0_m1.sql`, aborta se F tiver uso): desfez M1/M0 e reaplicou os arquivos corrigidos. Sem migration corretiva.
- **Não alterado (por escopo):** RPCs de indicadores/apontado real (`max(ordem)`) e `wip_controle_criar` (ordem+1) — ficam protegidas pela trava; a troca para `produto_etapa_final`/estrutura de rotas é tarefa do M4.

**Golden master após o ajuste:** idêntico (TS e SQL). **Testes:** `supabase/tests/rotas/t1_m0_m1.sql` e `src/features/rotas/__tests__/{rotas,custo}.test.ts` ampliados (sem passagem entre rotas; `ordem` ≠ caminho; convergência; demanda comum única; custo; trava). Observação: o SQL `t8_desativacao_logica` falha **somente** quando executado fora dos períodos cadastrados (18:35, "Horário não está dentro de nenhum período") — dependência de horário **pré-existente**, não relacionada a esta mudança (confirmado com o gatilho novo desabilitado).

## 18. M2 — Planejador puro de rotas (somente DEV/Preview; 26/10/2026)

**Escopo respeitado:** nada de PROD; `rotas_config.suporte_ativo = false`; F segue `ativo = false` e fora de qualquer tela operacional; sem Previsão 02/11; sem apontamentos de F; Escala oficial intacta; o planejador **não escreve** Previsão, Escala, WIP, apontamentos nem divisão oficial.

### 18.1 Arquitetura
`src/features/rotas/planejador.ts` (função pura `planejarRotas(entrada) → saída`, versão `rotas-planejador-1.0`) sobre os helpers **explícitos** de `estrutura.ts` / `capacidade.ts` / `custo.ts`: rotas = trecho exclusivo; convergência (origem → destino); pool comum (Etiquetar, Embalar uma vez); etapa final **explícita**. **Nada usa `max(ordem)`/`ordem+1`** (teste: embaralhar `ordem` não muda o resultado). Produto linear devolve `aplicavel:false` e segue o caminho legado.
Compatibilidade para o M4 (`compat.ts`, nenhuma RPC alterada): `etapaFinalDoProduto` (linear = maior ordem; rotas = final explícita) e `apontadoRealProduto` (só a etapa final conta produto acabado).

### 18.2 Entradas e saídas
**Entradas:** produto (estrutura + etapas), demanda final, metas/máquinas (cadastro), períodos, dias produtivos, máquinas indisponíveis, horas comprometidas por outros produtos (concorrência real, ex.: E16 × Caixa Amarela), equipe apta **por operação** + revezamento duro, teto de capacidade realizável vindo da Escala, desempenho observado, WIP inicial (por rota e no pool), limite de WIP, divisão anterior, máximo por rota (V1), custo/hora e preço.
**Saídas:** demanda final; alvo AUTO/CONV (entrega ao pool); capacidade nominal e realizável por rota; capacidade do pool e por etapa comum (Etiquetar, Embalar); final atingível, falta, % atingível; gargalo (`comum`: etapa, ou `entrada`: limitantes por rota); motivos codificados; WIP projetado (sombra); custo estimado, custo por peça (exclusivo/comum/final), **economia AUTO**, margem.

### 18.3 Algoritmo (ordem da política aprovada)
1. **Maximizar o produto final:** `F = min(D, L, W + Σ cap_r)` (D demanda; L = mín. das etapas comuns; W semiacabado pronto).
2. **Restrições físicas:** capacidade da etapa = Σ máquinas livres × metas × períodos × dias; menos máquinas indisponíveis e horas comprometidas; × fração operável pela equipe (`fracaoOperavel`: sem revezamento k/m; com revezamento duro k·⌈P/2⌉/(m·P)); × desempenho; limitado por teto da Escala. Capacidade da rota = **mínimo** das etapas exclusivas em série (Rosquear e Parafusar não se somam).
3. **Sem WIP inútil:** as rotas entregam exatamente `E = max(0, F − W)`.
4. **Menor custo:** divisão enchendo primeiro a rota de menor custo **exclusivo** (rotas disjuntas ⇒ guloso é ótimo), até o máximo realizável/V1. Nunca sacrifica atendimento por custo (o custo só escolhe entre divisões que já atendem F).
5. **Estabilidade:** divisão anterior viável (ajustada à capacidade e ao necessário) é mantida se custar ≤ 1% a mais que a ótima.
6. **Desempate:** preferência da rota, depois código.
Gargalo: se `L ≤ W + Σcap` ⇒ **comum** (corta as duas rotas); senão **entrada**.

### 18.4 Resultado dos cenários (testes `planejador.test.ts`, 39 casos; condições de 26/10 da Previsão: AUTO 35.625, CONV 81.000 limitada por Parafusar, E15 97.500, Embalar 142.500)
| Cenário | Resultado |
|---|---|
| **Real 116.625, só E15 (E16 ocupada)** | final **97.500**, falta **19.125**, **83,6%**, gargalo **Etiquetar (comum)**; AUTO 35.625 + CONV 61.875 (só o que o pool consome); 35.625+81.000 = 116.625 **não** basta |
| E16 0% / 25% / 50% / 100% livre | 97.500 / 116.625 (pool 121.875) / 116.625 (146.250→Embalar 142.500) / 116.625 |
| Demanda 20.000 | AUTO 20.000, CONV 0, sem excesso, WIP 0 |
| AUTO parada | AUTO 0, CONV 81.000, final 81.000, falta 35.625 (gargalo de entrada) |
| AUTO acima da meta (39.000) | AUTO 39.000, CONV 77.625 (soma = 116.625); com demanda 90.000 → CONV 51.000 |
| Falta de operador AUTO / Rosquear (1 de 2) / Parafusar (1 de 2) | AUTO 0 / CONV 54.000 / CONV 40.500 (cai só o posto afetado; sem número fixo por rota) |
| Revezamento duro (2 pessoas, 2 máq., 6 períodos) | CONV realizável 40.500 (nominal 81.000); teto da Escala entra como menor valor |
| Sábado produtivo (6 dias) | AUTO 42.750, CONV 97.200, E15 117.000 ⇒ 116.625 atendido |
| Máquina indisponível (P9) | CONV 40.500, final 76.125, gargalo de entrada |
| WIP inicial / limite | WIP reduz a entrega das rotas; saldo projetado acima do limite é sinalizado; exemplo 8.000+5.000−12.000 ⇒ 1.000 (rateio proporcional, sem FIFO) |
| Custo / economia | custo = Σ entrega×exclusivo + final×comum; economia AUTO = volume AUTO × (excl. CONV − excl. AUTO) ≈ R$ 724/semana com 35.625 peças; ordem inverte se AUTO ficar mais cara; estabilidade mantém divisão a ≤ 1% |
| Etapa final fora de max(ordem) | "Etapa Técnica" ordem 99: final continua Embalar (TS + `t2_m2_etapa_final_explicita.sql`) |
| Produto linear | `aplicavel:false`; golden master idêntico |

### 18.5 Sombra
`supabase/migrations/20261107100000_rotas_m2_planejador_sombra.sql` (aditiva, **só DEV**): tabela própria `rotas_planejador_sombra` **append-only** (trigger imutável; select só para admin/`produtos`; insert só `service_role`). Registra entrada (com hash SHA-256), resultado completo, gargalo, divisão, custo, timestamp, versão do algoritmo. `scripts/rotas-planejador-sombra.ts [--gravar]` roda 8 cenários sobre os **dados do DEV** (cadastro de F + Previsão 26/10 do DEV) e grava; **não usa** `escala_rota_divisao`. Os números do DEV diferem dos de PROD (DEV: Rosquear só R6 ⇒ CONV 54.000; Embalar 4.600/3.800 ⇒ 126.000); os números de PROD acima vêm dos testes com as condições lidas em 26/10.

### 18.6 Golden master e trava
TS e SQL (apontado real, sintético, hashes da semana 26/10 e das colunas das tabelas antigas, agora excluindo também `rotas_planejador_sombra`) **idênticos** aos de antes (`docs/rotas-golden/*_depois3_dev.*`). `t1_m0_m1.sql` e `t2_m2_etapa_final_explicita.sql` passam. Trava e F inativo conferidos após as execuções.

### 18.7 Riscos / limites conhecidos
- Planejador **assume rotas disjuntas** (sem máquina em comum); se houver máquina compartilhada ele sinaliza `MAQUINAS_COMPARTILHADAS_ENTRE_ROTAS` (soma pode superestimar).
- Concorrência por máquina é **estimada** (horas dos outros itens divididas entre as máquinas marcadas); a alocação real dependerá do motor da Escala.
- Revezamento: `fracaoOperavel` é um limite superior aproximado; o valor exato deve vir do motor da Escala (`capacidadeRealizavelEscala`).
- Custo/hora na UI é o real do app; no script de sombra é uma referência uniforme (ordem de grandeza).
- RPCs de apontado real/indicadores e `wip_controle_criar` continuam com `max(ordem)`/`ordem+1`: protegidos pela trava até o M4.

### 18.8 O que falta para o M3
Persistir a divisão oficial (`escala_rota_divisao`) a partir do planejador; integrar à Previsão (item único de F, `previsao_rota_limite`), à Capacidade e ao motor da Escala (itens/etapas por rota, pool comum único); obter o **revezamento realizável** do motor para alimentar `capacidadeRealizavelEscala`; decisão sobre concorrência de máquinas (E16) na alocação; telas operacionais; só então considerar `suporte_ativo`. M4: apontado real/indicadores/WIP por etapa final explícita.

## 19. M3 — desenho revisado: a Previsão escolhe as máquinas, o sistema só calcula (26/10/2026) — SOMENTE DESENHO, nada implementado

**Regra de ouro (decisão do usuário):** quem escolhe as máquinas é a pessoa, na Previsão Semanal. O sistema **nunca** adiciona máquina (E16, rosqueadeira, parafusadeira, outra automática) por ser "tecnicamente compatível". Cadastro do produto = "PODE fabricar"; Previsão = "NESTA semana SERÁ considerada". Redistribuir é permitido **somente entre recursos que a pessoa selecionou**. Sugerir "a E16 aumentaria a capacidade" fica para o futuro, como sugestão, nunca como decisão.

### 19.1 Auditoria do que existe (por que a mudança de schema é mínima)
- `previsao_item_maquinas (item_id, etapa_id, maquina_id)`, PK composta, FK `etapa_id → roteiro_etapas`, `item_id → previsao_itens` (cascade). É a **fonte oficial** da seleção da semana, gravada por `upsert_previsao_semana` (`maquinas_por_etapa: {etapaId: [maquinaId]}`), lida por Capacidade, motor da Escala (`PoolEscala.maquinasIds`: "o motor NUNCA usa máquina fora de `maquinasIds`") e snapshots de plano (`maquinasPorEtapa`).
- No modelo de rotas **cada etapa de F tem id próprio e está em exatamente um lugar** (exclusiva de uma rota ou pool comum). Logo `(previsão, item F, etapa, máquina)` **já determina a rota**: a rota sai de `rota_etapas`/`produto_pool_comum` pelo `etapa_id`. A chave exigida (Previsão + produto + etapa/rota + máquina) **já existe** na tabela atual.
- **Conclusão: nenhuma tabela nova e nenhuma coluna nova para a seleção.** Reaproveita `previsao_itens` (1 item F com a demanda final, ex. 116.625) + `previsao_item_maquinas` tal como está; o RPC `upsert_previsao_semana` não muda.
- Aditivo opcional (não obrigatório): gatilho de validação "a etapa pertence ao produto do item" — hoje o legado só valida em tempo de execução (`selecao_maquina_invalida`). Recomendo **não** criar agora.

### 19.2 Schema mínimo do M3
| Necessidade | Solução | Mudança |
|---|---|---|
| Seleção de máquinas por etapa/rota | `previsao_item_maquinas` existente | **nenhuma** |
| Demanda final de F | 1 linha em `previsao_itens` (produto F) | nenhuma |
| Limite máximo por rota (V1) | `previsao_rota_limite` (M0) | nenhuma |
| Divisão calculada (alvo, nominal × realizável, motivo) | `escala_rota_divisao` (M0, append-only): `quantidade_alvo`, `capacidade_rota` = realizável, `motivo jsonb` = {nominal, realizável, iteração, limitante, gargalo}; `versao_plano_id` liga ao plano | **nenhuma** (se faltar coluna, 1 `ADD COLUMN` aditivo) |
| Sombra do M2 | `rotas_planejador_sombra` | já existe |
| Semana no modelo de rotas | `previsoes.modelo_rotas` + trava `rotas_suporte_ativo()` | já existem (virar a trava só no fim do M3, com aprovação) |
Fonte única: **a seleção vive na Previsão**. A página `/produtos/rotas` e o planejador passam a **exigir** a seleção; etapa sem máquina marcada = capacidade 0 (sem queda para o cadastro).

### 19.3 Fluxo
```
PREVISÃO (pessoa)           CAPACIDADE (puro)             PLANEJADOR (M2)              ESCALA (motor)                 FEEDBACK
marca máquinas por    →     nominal por etapa      →      divisão AUTO/CONV      →     pessoas × máquinas ×     →     realizável por etapa
etapa: CONV{Rosq,Paraf}     só das selecionadas,          limitada pelo pool comum;    períodos × dias;               (equipe/revezamento)
AUTO{R+P} COMUM{Etiq,Emb}   descontando o que            menor custo dentro do        1 operador/posto/período;      volta como TETO ao
+ demanda final             máquinas compartilhadas       selecionado; sem WIP inútil  revezamento duro; ausência     planejador (≤ 3 rodadas)
                            já têm comprometido                                       e indisponibilidade bloqueiam
```
Prioridade (decisão do usuário): 1) máquinas escolhidas; 2) maximizar atendimento; 3) capacidade compartilhada; 4) equipe/revezamento; 5) sem WIP inútil; 6) custo; 7) estabilidade.
**Casos:** AUTO sem máquina marcada ⇒ AUTO = 0, tudo na CONV; CONV sem máquina ⇒ CONV = 0, tudo na AUTO; ambas ⇒ divide. Exemplo 116.625 com só a E15: possível 97.500, falta 19.125, 83,6%, gargalo Etiquetar; AUTO 35.625 + CONV 61.875 (não 81.000). Adicionar a E16 recalcula na hora e o novo gargalo pode ser Embalar, entrada ou equipe.

### 19.4 Como o motor da Escala recebe F (adaptador; motor intocado)
O motor trabalha com pool `(produto, etapa)` e **cadeia por `ordemEtapa`** (≈10 pontos: prioridade, WIP, execução, tetos). F não tem cadeia linear (convergência). Em vez de abrir o motor, um **adaptador** projeta F em **três cadeias lineares virtuais**, cada uma com `produtoId` virtual e quantidade própria:
- `F#CONV`: Rosquear(0) → Parafusar(1), quantidade = alvo CONV;
- `F#AUTO`: Rosquear + Parafusar(0), quantidade = alvo AUTO;
- `F#COMUM`: Etiquetar(0) → Embalar(1), quantidade = produto final planejado.
`maquinasIds` de cada pool = `previsao_item_maquinas` da etapa (nada de máquina fora). O resultado volta mapeado para o `produto_id` real de F (as colunas de alocação continuam apontando para F e a etapa real). Os produtos lineares passam pelo mesmo motor **sem mudança** (golden master). Limite conhecido: o vínculo de material entre o fim da rota e o Etiquetar (convergência) **não** entra no controle de WIP do motor na 1ª versão (WIP continua desligado em PROD); fica no planejador/`projetarPool`.

### 19.5 Máquina compartilhada entre produtos (E16: Conector F × Caixa Amarela)
- **Quem pode usar a máquina** = Previsão (as duas demandas foram autorizadas). **Quando** cada uma usa e **quem** opera = motor (slot a slot, 1 operador por máquina/período).
- **Capacidade nunca contada duas vezes.** Na prévia da Previsão, as horas semanais de cada máquina são um **orçamento único** consumido em ordem; o planejador recebe `horasComprometidasPorMaquina` **exato** (não a estimativa M2 de "horas divididas igualmente"), calculado com a seleção real de cada item. Soma por máquina ≤ horas da máquina (teste obrigatório).
- **Ordem de consumo (DECISÃO ABERTA — recomendo manter a regra que a Previsão já usa em `calcularAlocacaoSemanal`: maior lucro/hora primeiro):** (a) lucro/hora [recomendada, consistente com hoje], (b) proporcional à demanda (como `calcularCapacidadeMaximaSemana`), (c) prioridade manual por item. A decisão muda quem fica com a falta, não a regra de não contar em dobro. A prévia mostra o efeito nos **dois** produtos ("Caixa Amarela passa a ter X possível").
- O motor, no fim, é a verdade da partilha por períodos; diferença para a prévia volta como "realizável".

### 19.6 Feedback da Escala (capacidade realizável)
1. Planejador com capacidade **nominal** (só máquinas selecionadas, já descontadas as compartilhadas) → alvos AUTO/CONV.
2. Adaptador → motor (determinístico) → `analisarAtingibilidade` por pool = **realizável** com pessoas/revezamento/ausências.
3. Se algum pool não entrega o alvo: o realizável vira **teto** (`capacidadeRealizavelEscala`, já suportado no M2) e o planejador **redistribui só entre as rotas selecionadas** (ex.: AUTO 28.500 < 35.625 ⇒ CONV compensa se houver máquinas CONV marcadas, operadores e pool comum). Repete até estabilizar ou **3 rodadas** (cada rodada só reduz tetos ⇒ termina).
4. A tela mostra **nominal × realizável × final** por etapa e o motivo (equipe, revezamento, máquina, pool comum). Nenhuma máquina é acrescentada. Limite honesto: o realizável é medido com todas as demandas carregadas juntas (pessoas são compartilhadas), então o resultado é "possível", não um ótimo global provado.

### 19.7 UI da Previsão para F (agrupada por rota; mesmo componente `ItensPrevistos`)
```
Conector 3/4" (Final)   Demanda final: [116.625]
 ROTA CONV   (trecho exclusivo)
   Rosquear               [☐ Rosq. 3] [☐ Rosq. 5] [☑ Rosq. 6]
   Parafusar              [☑ Paraf. 9] [☑ Paraf. 10] [☐ ...]
 ROTA AUTO
   Rosquear + Parafusar   [☑ Máq. Automática 8]
 FLUXO COMUM (Etiquetar → Embalar)
   Etiquetar              [☑ Etiquetadora 15] [☐ Etiquetadora 16]
   Embalar                [☑ Embalagem 17]
 ── Prévia (recalcula ao marcar) ─────────────────────────────
 Demanda 116.625 · AUTO possível 35.625 · CONV possível 81.000 · Etiquetar 97.500 · Embalar 142.500
 Produto final possível 97.500 · Falta 19.125 · 83,6% · Gargalo: Etiquetar
 Divisão proposta: AUTO 35.625 + CONV 61.875 (só o necessário)
 Equipe (após a Escala): nominal 35.625 → realizável 28.500 (revezamento) · CONV compensa +7.125
```
- Máquinas oferecidas = elegíveis do cadastro (como hoje), menos as indisponíveis da semana; **nada pré-marcado para F** (a pessoa marca; o legado pré-marca todas as elegíveis ao escolher o produto — para F isso incluiria a E16 e mostraria 116.625 "possível" antes da decisão; recomendo começar vazio).
- Máquina também selecionada em outro produto mostra a etiqueta "compartilhada com Caixa Amarela" e o quanto sobra.
- Produtos lineares: tela atual sem mudança.

### 19.8 Compatibilidade com produtos lineares
Caminho legado intacto: sem `produto_rota` ⇒ `modelo:"linear"`, o planejador devolve `aplicavel:false`, UI e motor como hoje. O código que só vale para F (agrupar por rota, prévia, adaptador) é ativado por **estrutura do produto**, não por flag global. Semanas anteriores e 26/10 permanecem `modelo_rotas=false`; primeira semana de rotas = 02/11, só depois de aprovação e de a trava ser aberta. Golden master (TS+SQL) obrigatório antes/depois de cada passo do M3; a regra de mistura (legados P/A não entram em semana de rotas) já está no banco.

### 19.9 Ajustes do M2 exigidos por esta regra (primeiro passo do M3)
1. `planejarRotas`: `selecao` passa a ser **obrigatória**; ausente/etapa sem chave = nenhuma máquina (hoje o padrão cai em "todas as elegíveis do cadastro").
2. `/produtos/rotas`: o modo "todas as elegíveis" e o seletor "Etiquetadora 16 disponível" são **simulação "e se"** do M2; no M3 a seleção vem **somente** da Previsão e a página só exibe/compara (a E16 deixa de ser alternável pela tela do planejador).
3. `scripts/rotas-planejador-sombra.ts`: cenários "cadastro/todas as máquinas" são diagnóstico do DEV; a sombra do M3 usa a seleção da Previsão.
4. `horasComprometidasPorOutros` (estimativa igual por máquina) → substituída pelo orçamento exato de horas por máquina do item seguinte na ordem de consumo.

### 19.10 Decisões que preciso do usuário antes de implementar
1. **Ordem de consumo da máquina compartilhada** (a/b/c do §19.5; recomendo a).
2. **F começa sem máquinas marcadas** na Previsão (recomendado) ou pré-marcadas como no legado.
3. **Adaptador de 3 cadeias virtuais** (recomendado, motor intocado) em vez de ensinar o motor a ter convergência.
4. Confirmar **nenhuma coluna/tabela nova** para a seleção (reuso de `previsao_item_maquinas`).

## 20. M3 — implementado em DEV/Preview (26/10/2026) — nada em PROD; `suporte_ativo=false`; F `ativo=false`

**Regra respeitada:** a Previsão (uma pessoa) escolhe as máquinas; o sistema nunca acrescenta máquina. Planejador, adaptador e motor só enxergam `previsao_item_maquinas` (item, etapa, máquina). O cadastro ("pode") nunca completa a seleção ("será"): `planejarRotas` agora **exige** `selecao`; etapa sem marcação = capacidade 0.

### 20.1 O que foi feito
| Peça | Onde |
|---|---|
| Seleção de máquinas (reuso, sem tabela nova) | `previsao_item_maquinas`; F = 1 item; rota deriva do `etapa_id` (T3 SQL) |
| Adaptador F#CONV / F#AUTO / F#COMUM | `src/features/rotas/adaptador.ts` — projeta o `EstadoBruto` em cadeias lineares virtuais (quantidades = alvo das rotas e produto final), devolve tudo ao produto F; produto linear ⇒ **o mesmo objeto**, sem cópia |
| Capacidade nominal | `planejador.ts`/`capacidade.ts`: só máquinas marcadas, metas, períodos, dias, indisponibilidades da Previsão e horas já pedidas por outros itens |
| Máquina compartilhada | `compartilhada.ts`: orçamento único de horas por máquina (Σ concedido ≤ horas); F pede primeiro nas máquinas sem concorrência; falta igualada entre quem disputa (mesma lógica do motor: gargalo/menor folga) |
| Capacidade realizável + feedback (≤ 3 rodadas) | `resolucao.ts` (`resolverRotas`), chamada em `processarSemana`; só se a semana tem produto de rotas |
| Registro da divisão | `escala_rota_divisao` (append-only) + migration `20261108100000` (colunas aditivas); IO em `src/lib/escala/rotasIO.ts` (idempotente por hash+rodada) |
| UI da Previsão | `SelecaoRotasPrevisao.tsx` + `SelecaoRotasContainer.tsx`, ligados a `ItensPrevistos` **só** para produto com `estruturaRotas`; F começa tudo desmarcado; linear intacto (pré-marcação de sempre) |
| Teste/Preview sem abrir a trava | `/produtos/rotas` virou "Previsão simulada" (nada gravado): seleção manual, prévia, funil do gargalo e "Simular Escala" em memória (rodadas, hashes, nominal × realizável) |
| Trava | `useProdutos` só traz F à Previsão se `rotas_config.suporte_ativo=true` (hoje false ⇒ F invisível, como antes) |
| Parâmetro de estabilidade | `toleranciaEstabilidade` opcional; **sem valor = desligada** (o 1% do M2 virou só experimental no shadow) |

### 20.2 Feedback: critério, rodadas, auditoria
- **Convergência:** (a) `atendeu_alvo` — o motor realiza o alvo de todas as cadeias; ou (b) `estabilizou` — o plano novo (com tetos) é igual ao anterior (nenhuma compensação possível dentro do selecionado). Senão `limite_rodadas` (3): **não converge**, nada é inventado, devolve diagnóstico (etapa, planejado × realizável).
- **O que muda entre rodadas:** somente os tetos por etapa (`capacidadeRealizavelEscala` = peças que o motor conseguiu quando ficou abaixo do alvo). Seleção, demanda e metas não mudam.
- **Cada rodada registra:** hash da entrada do planejador, hash da `EntradaEscala` (cadeias virtuais), tetos, alvo, nominal/realizável por rota, final planejado/realizável, gargalo e motivos; `escala_rota_divisao` guarda uma linha por rota e por rodada (`rodada_final` marca a efetiva), com `algoritmo_versao`, semana, `capacidade_nominal`, `capacidade_rota` (= realizável), `gargalo`, `motivo`.
- Exemplo (teste): AUTO nominal 35.625, realizável 21.375 (a máquina cai na quinta, só a Escala vê) ⇒ rodada 2: AUTO 21.375 + CONV 76.125 (só com as máquinas CONV marcadas) ⇒ `atendeu_alvo`.

### 20.3 Teste crítico E16 (Caixa Amarela + Conector; motor real, inalterado)
Provado: E16 nunca dupla-contada (cada dia×período serve 1 produto e 1 operador; ≤ 30 períodos/semana; invariantes do motor); retirar a E16 do Conector remove o uso imediatamente; lucro/hora não domina (mesma divisão com Caixa a R$ 50 ou R$ 0,01); revezamento duro vale entre cadeias (Etiquetar do Conector e da Caixa = mesma `operacao_id`); com a Caixa pedindo 60.000, a Caixa completa e o Conector fica com o resto dos períodos.
**Achado a decidir (honesto):** o motor atual arbitra por **gargalo/menor folga ⇒ iguala as faltas em períodos** e usa preço só no empate. No exemplo "6 períodos": Caixa 2 + Conector 4 (cabem os dois) ✔; Conector 6 ⇒ **1 + 5** (faltas iguais); Conector que não completaria nem com 6 ⇒ **0 + 6** — **não** o "2 + 4" do exemplo conceitual (completar a Caixa). Mudar isso exige trocar a regra do motor (afeta o desempate de produtos lineares) ⇒ não foi feito; o teste de caracterização documenta o comportamento. Ver decisão em 20.6.

### 20.4 Golden master (zero divergência)
TS (`golden_ts_depois4_dev.json`) **idêntico**; SQL (apontado real, sintético, hashes da semana 26/10 e colunas das tabelas antigas) **idêntico**; novo: `processarSemana` × motor direto **idêntico** nas 4 Previsões do DEV (sem `rotas` no estado). `t1`, `t2`, `t3` SQL passam.

### 20.5 Riscos / limites
- **Prévia ≠ motor** na disputa por máquina (estimativa por horas × decisão por período): em contenção pesada (Caixa ocupando a E16 inteira) a convergência pode exigir mais que 3 rodadas — reportado como `limite_rodadas`, com diagnóstico.
- Servidor sem **custo/hora** no estado: sem custo a divisão desempata pela preferência (AUTO antes de CONV — hoje coincide com o mais barato). A UI/prévia usa o custo real.
- Planejamento da **semana inteira**: replanejamento no meio da semana usa os créditos congelados por (cadeia, etapa); a divisão não é "congelada" por rota (M4).
- WIP/adicional de F **fora** (como decidido): o vínculo rota → Etiquetar só existe no planejador, não no controle de WIP do motor.
- Demais telas (Capacidade, Produtos, indicadores, apontado real) **não** conhecem produto de rotas; por isso a trava continua fechada.
- A seleção da prévia não valida "máquina elegível no cadastro" além do que o motor já faz (descarta e avisa `selecao_maquina_invalida`).

### 20.6 Decisões e o que falta (M4)
1. **Arbitragem global na E16:** manter o motor (faltas iguais) ou criar, só para semanas de rotas, uma regra "completar o que pode ser completado"? (exige aprovação; golden master deve continuar zero para semanas lineares).
2. **M4:** apontado real/indicadores por etapa final explícita; `wip_controle_criar` e WIP entre rotas → pool comum; custo/hora no estado do servidor; tornar Capacidade/Produtos/relatórios conscientes de rotas; revisão da regra de congelamento da divisão no meio da semana; só então avaliar abrir `suporte_ativo`.

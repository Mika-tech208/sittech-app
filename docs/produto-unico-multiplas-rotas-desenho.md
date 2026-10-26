# Produto único com múltiplas rotas de fabricação — DESENHO TÉCNICO (revisão 2)

Status: **somente desenho.** Nada implementado, nenhuma migration aplicada, nada em PROD. Esta revisão incorpora as decisões definitivas de 26/10/2026 (PROD não foi consultado nesta revisão; o que depende dele está listado no §13 como **a verificar**).

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
- `nome`/`referencia`: F precisa ser distinguível de P/A no banco; **a verificar** se `produtos.nome` tem unicidade (§13). Na interface, o seletor de produtos da Previsão filtra pelo **modo da semana** (§4.4), então o usuário vê um "Conector 3/4"" só.

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

**Hipóteses:** semana de 5 dias; custos/peça = snapshots reais de out/26 (ilustrativos; o sistema recalcula); valor 0,1825; **AUTO capacidade 35.625**; **CONV 81.000** (equipe); etapas comuns disponíveis p/ este produto: Etiquetar 140.000, Embalar 130.000 (ilustrativos); estoque inicial opcional 8.000 (CONV pronta) + 5.000 (AUTO pronta).

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

**A verificar (não consultei PROD nesta revisão):**
1. `produtos.nome` tem unicidade? (define o nome de F e a necessidade de `referencia`).
2. A Previsão de **02/11/2026** já existe? Se existir no modelo legado, a conversão (M4) usa RPC com prévia e snapshot.
3. O valor comercial **vigente** do Conector 3/4" é mesmo R$ 0,1825 (confirmar no cadastro/contrato).
4. Estado dos `wip_controle` do Conector 3/4" e saldos confirmados hoje (insumo das confirmações de abertura de F).

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

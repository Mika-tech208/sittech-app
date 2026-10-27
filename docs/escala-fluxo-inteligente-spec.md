# Escala Inteligente (fluxo) — especificação de implementação (27/10/2026)

Objetivo: a Escala maximiza **produto final entregue contra a meta semanal**, olhando Produção Real, WIP, capacidade downstream, disponibilidade de pessoas/máquinas e o gargalo real do fluxo. Ocupação de máquina/pessoa NÃO é objetivo.
Rollout controlado por flag própria `producao_real_modo` = `desligado | sombra | ativo` (rollback só por flag, sem migration). **Não** reutilizar `ativo_restrito` como motor final (c+1/c+2, f duplicado, recusas estruturais).

## 1. Modelo de estado (por semana, por produto, por etapa)

- **Estados de produção** por (período, máquina, pool): `confirmado` (linha `produzindo` válida), `zero_confirmado` (`sem_producao`, motivo falta_operador|falta_material|outro), `nao_confirmado` (período FECHADO — fim+10 min ≤ agora — com máquina planejada e SEM linha), `futuro` (não ocorreu; período em andamento = futuro, mas linhas parciais já lançadas contam como confirmado).
- **Período sem apontamento**: produção ∈ [0, planejado] → `boasLo += 0`, `boasHi += planejado`. Diagnóstico `PRODUCAO_NAO_CONFIRMADA`. Nunca assumir o planejado.
- **boas = produzida − refugo** (nunca negativa). Refugo intermediário não vira WIP; refugo final não reduz a meta final.
- **Etapa final** = a etapa explícita final do roteiro (mesma regra do Apontado Real: última etapa válida; ver `apontadoReal.ts`/RPCs). Só ela reduz a **demanda final restante** `R_f = max(0, Q_f − B_f,lo)`. Apontamento intermediário NUNCA reduz meta final; alimenta WIP.
- **WIP do par k→k+1**: se houver controle com saldo CONFIRMADO usar `wipSaldo.ts` (existente); senão ESTIMADO: `W_lo = max(0, B_k,lo − B_{k+1},hi)`, `W_hi = max(0, B_k,hi − B_{k+1},lo)`. Marcar `origem: confirmado|estimado` e `confianca: alta|media|baixa` (alta só confirmado; média = estimado sem períodos não confirmados e sem inconsistência; baixa = com não confirmados ou inconsistência). Nunca misturar silenciosamente. Saldo negativo estimado → **piso 0** + diagnóstico `WIP_NEGATIVO_ESTIMADO` (estoque inicial desconhecido, apontamento inconsistente, lançamento atrasado ou identidade).
- **Pipeline além de k**: `Pipe_k = Σ_{j≥k} W_j` (lo/hi).
- **Saldo inicial**: não inventar. Sem controle confirmado → estimado.
- Apontamento atrasado (chega após o fechamento): não reescreve o passado; entra no estado; só afeta períodos futuros; registrar `ajuste_tardio` (lancadoEmMs > fechamento do período).
- `sem_producao` por `falta_material`: pode tornar a etapa temporariamente inviável (diagnóstico; não inventar material).

## 2. Demanda por pool que entra no motor (substitui o `rem` planejado quando modo=ativo)

- Pool final: `rem_final = R_f`.
- Pool não final k: `D_k = max(0, R_f − Pipe_k,lo)` (conservador: não contar estoque incerto) e **teto de utilidade**: `Allowed_k = max(0, ConsumoDownstream_k + Teto_k − Pipe_k,hi)`; `rem_k = min(D_k, Allowed_k)`.
  - `ConsumoDownstream_k` = capacidade (peças) das etapas seguintes nos slots futuros recalculáveis (máquinas selecionadas e disponíveis × metas × f), limitada por etapa mais lenta; ignora pessoas (limite superior).
  - `Teto_k` = produção de **1 período** da etapa k (capacidade máxima por período nas máquinas selecionadas/disponíveis). Derivado, sem hardcode por produto. Nunca teto zero.
- Camada "adicional" existente (pessoas sem posto) permanece como está.

## 3. Valor marginal e prioridade (regra geral; proibido `if produto == ...`)

Valor marginal de um posto (pool k, slot t, n-ésimo posto) = ganho de **peças finais entregues até o fim da semana** ao adicionar esse posto, obtido por **simulação de fluxo determinística** do plano (estado inicial = WIP lo/hi, capacidade por posto = meta×f; fluxo entre etapas no mesmo período: consumo da etapa j ≤ WIP inicial + produção da etapa j−1 no período; limitado por R_f; usar limite inferior para consumir WIP, superior para evitar excesso upstream). Algoritmo (aproximação conservadora, no máximo 4 iterações, sempre mantém o melhor J):
1. Roda o motor com `rem` de fluxo (seção 2) → plano P0.
2. Simula P0; calcula marginais M(k,t,n) por re-simulação.
3. Re-roda o motor com ordem de seleção de postos: (a) **valor marginal** desc com bônus de continuidade θ para postos já ocupados no próximo período; (b) gargalo/folga; (c) restante do desempate atual. Para por convergência ou limite; escolhe o plano de maior J lexicográfico.
Objetivo J lexicográfico (maior é melhor): (1) produto final entregue vs meta (menor falta final esperada, ponderada por valor se disponível), (2) proteger gargalo de fluxo, (3) consumir WIP existente, (4) evitar WIP desnecessário (WIP previsto acima do teto), (5–6) hard constraints (inviolável), (7) estabilidade, (8) equidade, (9) custo. **Hard constraints inalteráveis**: máquina indisponível, funcionário ausente, revezamento, uma pessoa por posto, uma máquina por período, seleção da Previsão, roteiro válido.
Hooks no motor (`EntradaEscala` ganha campos OPCIONAIS; ausentes ⇒ saída BYTE-IDÊNTICA à atual — golden-master): `remPorPool` (rem explícito por pool, sem abater crédito planejado), `ordemPostos` (comparador/valor marginal por pool×slot×n), `bonusContinuidade`.

## 4. Estabilidade / churn (regra simples inicial)

Passado e período em andamento congelados. Próximo período (c+1): só trocar uma alocação existente por otimização de fluxo se o ganho de produto final ≥ θ (peças finais); hard constraint ignora θ. c+2 em diante: livre. θ derivado/medido no replay (default proposto: max(1 posto-período da menor meta ocupada, 0,5% de R_f total) — calibrar nas repetições de 26–27/10 minimizando churn sem piorar a falta final) e persistido em `escala_parametros`. Registrar churn (linhas alteradas, trocas de posto) por recálculo.

## 5. Conector legado (adaptador de leitura; NÃO altera apontamentos nem histórico)

Par conhecido (configurável em `escala_parametros.producao_real_pares_legado`, jsonb, semeado com os ids de PROD: convencional `27c229d7…`, automática `a027ac97…`): fundir logicamente **apenas para cálculo de fluxo/demanda** os pools equivalentes Etiquetar (conv `34371af3` + auto `1863b452`, Etiquetadora 15) e Embalar (conv `b3db9629` + auto `fb96d08d`, Embalagem 17) quando: operação equivalente, mesmo conjunto de máquinas, metas compatíveis, produto no par. Se qualquer condição falhar: **produto mantido em comportamento legado, explícito no diagnóstico** (`PRODUTO_EM_COMPORTAMENTO_LEGADO`), nunca exceção silenciosa. Rosquear/Parafusar exclusivos continuam separados (Máquina 8 = trecho exclusivo Rosquear+Parafusar; sua produção gera WIP de entrada no pool comum e **não** deve produzir além do que pool comum + teto absorvem no horizonte). Demanda comum fundida: `R_f,total = Q_conv + Q_auto − (boas Embalar conv + boas Embalar auto)`; atribuição entre ramos PROPORCIONAL (`s_b = Q_b / ΣQ`), pipeline exclusivo por ramo inferido de forma proporcional (estimado). Linhas do pool fundido saem atribuídas ao produto/etapa onde o operador de fato apontou (convencional) — decisão documentada; o produto Automática final continua sem linha própria nas etapas comuns. Compatível com produto único de 02/11: F#CONV / F#AUTO / F#COMUM (`src/features/rotas/`): depois da convergência não há identidade CONV/AUTO nas etapas comuns; WIP dos dois trechos exclusivos alimenta o pool comum; apontamento mantém a rota só em etapa exclusiva.

## 6. Instrumentação (Estágio 1) e Sombra (Estágio 2)

Persistir (append-only, tabela nova + RPC service_role) a cada fechamento e a cada recálculo em modo `sombra`/`ativo`: demanda oficial × demanda real, WIP (confirmado/estimado, lo/hi, confiança, inconsistências), gargalos (por pool e de fluxo), plano oficial (hash + resumo), plano inteligente (hash + linhas), diff, violações de hard constraint, churn, falta final prevista oficial × inteligente, WIP previsto, e o **registro de cada replanejamento** com ANTES (demanda restante, WIP, gargalo), DECISÃO (recurso, de onde, para onde), MOTIVO (ganho estimado de produto final / redução de falta / consumo ou redução de WIP) e DEPOIS (produto final previsto, WIP previsto, falta prevista). Modo `sombra` nunca altera a Escala oficial.

## 7. Critérios de ativação (A–J) — avaliar por replay de TODOS os fechamentos de 26/10 e 27/10 (entradas gravadas em `escala_sombra_decisoes.entrada`) + replay completo da semana

A) 0 violação de hard constraint · B) 0 alteração de passado · C) 0 dupla alocação · D) 0 violação de revezamento · E) nenhuma piora inexplicada da falta final total (mesmo simulador para oficial e inteligente) · F) Caixa Amarela coerente (E16 × Montagem: reforça Montagem quando há WIP para consumir; mantém E16 quando WIP baixo e E16 é gargalo futuro) · G) Conector legado sem duplicidade de pools comuns · H) churn aceitável · I) WIP previsto não explode (≤ teto derivado) · J) plano explicável (diagnóstico completo). Qualquer falha ⇒ NÃO ativar, permanecer em sombra e reportar.

## 8. Ativação por flag e interlock

`producao_real_modo` e `producao_real_semanas_ativas` em `escala_parametros` (mesmo padrão de `replanejamento_modo`/`semanas_ativas`, com portão no banco). `ativo` ⇒ recálculo oficial (eventos e fechamento de período) usa o caminho de fluxo; `processarSombraDoServidor` NÃO aplica o `ativo_restrito` para semanas com `producao_real_modo=ativo` (interlock em código; não altera o parâmetro do restrito). `sombra` ⇒ calcula e persiste, não altera plano. `desligado` ⇒ comportamento atual. Mudança de flag = recálculo registrado (gatilho existente de parâmetros), reversível sem migration.

## 9. Correção do fator f duplicado (restrito)

`sombraCorte.ts` linhas ~123–124: `projetarProducao(oficialFuturo, fator)` e `horizonte.comprometidas` aplicam f sobre peças já multiplicadas pelo f da gravação. Corrigir reescalando cada linha por `f_novo / f_embutido` (`f_embutido = pecas / meta nominal` do período). Rodar todos os replays das decisões gravadas; seq 16/17/18 devem continuar recusadas (Δ corrigido +5.136 / +4.937 / +713).

## 10. Testes obrigatórios

Produto linear 1 etapa; linear multietapa; upstream sem/com WIP; downstream sem/com material; produção abaixo/acima; sem_producao; sem apontamento; apontamento atrasado; refugo; máquina parada; funcionário ausente; retorno; revezamento; máquina compartilhada; Conector legado; Conector produto único; Caixa Amarela (fixture com dados reais de 27/10); WIP negativo; saldo confirmado; saldo estimado; rollback da flag; golden-master (modo desligado ⇒ saída byte-idêntica à atual em TODOS os testes e nos replays gravados).

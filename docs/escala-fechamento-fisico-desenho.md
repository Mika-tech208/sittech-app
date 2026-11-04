# Fechamento de período com confirmação física do estoque intermediário — DESENHO v1 (03/11/2026)

> **SUBSTITUÍDO pela v2** (`escala-fechamento-fisico-especificacao-v2.md`): o usuário decidiu contar os buffers em TODOS os períodos; âncoras + gatilhos (abaixo) ficam só como registro histórico.

Status: **só desenho. Nada implementado, nada escrito em PROD.** Os números do replay vêm de SELECTs em PROD (diagnósticos `escala_fluxo_diagnosticos`, apontamentos, versões do plano) e de dados do próprio dia 03/11.

---

## 0. Resumo executivo

1. **A ideia é boa e o motor já está 80% pronto para ela.** `contagem.ts` já trata a contagem como verdade *point-in-time* (saldo no instante T; só movimento posterior a T altera; período com fim ≤ T nunca conta). Falta o que está *em volta*: onde a contagem é guardada, quem a faz, quanto o sistema errou, e o que acontece quando ela não vem.
2. **Hoje a contagem é um array jsonb numa linha de `escala_parametros`**, substituído por inteiro, sem estimado, sem histórico, sem usuário autenticado (`informadoPor` é texto livre) e digitado por SQL. Cada contagem sobrescreve a lista anterior (o rollback de hoje só existe porque eu o fiz à mão).
3. **Achado do replay de 03/11 (muda o desenho):** o erro de hoje **não foi acumulando período a período; foi um viés constante vindo do ponto de partida.** Reconstruindo para trás a partir da contagem das 12:08 com os apontamentos reais, os três buffers do Conector 3/4 têm o **mesmo erro em todas as fronteiras do dia** (−700 / −2.322 / +400). Ou seja: os fluxos (apontamentos) fecharam certo; a âncora das 02/11 20:20 estava errada. Consequência: **o valor máximo está na contagem-âncora (abertura do dia e pausa do almoço), não em seis inventários por dia.**
4. **Limite estrutural que precisa estar no desenho:** os períodos são contíguos (M1→M2→M3 sem folga). Quando o supervisor fecha o período N (fim + 10 a 20 min), o N+1 **já está em andamento** e é congelado. Fechar N confirma N+2 em diante e *valida* N+1; para proteger N+1 a contagem tem que acontecer **na virada** (fim −8 a fim +2). Hoje esta foi a causa da Etiquetadora 15 em M3 (seção 11).
5. Recomendação: **Fechamento físico em duas camadas** — (a) *fechamento de período* sempre (curto, sem inventário); (b) *contagem de buffers* pedida por política de risco (âncoras obrigatórias + gatilhos), não em todo período.

---

## 1. Arquitetura proposta

### 1.1 Princípios
* **Físico vence estimativa**, sem exceção, a partir do instante `contado_em`.
* **Append-only**: nunca atualizar nem apagar contagem. Correção = nova linha que aponta para a anterior.
* **Reconciliação, não incremento**: contagem substitui o estado do buffer naquele instante.
* **Estimativa não some**: o `saldo_estimado` do instante é gravado junto, para medir o modelo.
* **Motor sem regra nova de planejamento**: o adaptador entrega `ContagemFisicaPar[]` ao motor exatamente como hoje. O corte-v1, o despacho, a regra de lote e o gate de estabilidade não mudam.

### 1.2 Peças

```
Supervisor ──(tela "Fechar período")──► RPC escala_fechar_periodo(idempotente)
                                          ├─ grava escala_fechamentos_periodo
                                          └─ grava escala_contagens_fisicas  (append-only)
                                                    │ trigger (como trg_escala_parametros_evento)
                                                    ▼
                                      outbox de eventos → escala_agendador_chamar → /api/escala/drenar
                                                    ▼
            adaptador de leitura: "última contagem válida por buffer, contado_em ≤ agora"
                                                    ▼
                         dados.contagensFisicas  (mesmo tipo de hoje)  →  corte-v1 (inalterado)
                                                    ▼
                         plano + escala_fluxo_diagnosticos (wip.pares[] = estimado no corte)
```

Dois conceitos de "fechamento" que **não** podem se confundir:

| | Fechamento de dados (já existe) | Fechamento físico (novo) |
|---|---|---|
| Quem | automático, `fechamento.ts` | supervisor/usuário autorizado |
| Regra | fim+10 min, ≥90% dos postos com apontamento, quietude 3 min; teto fim+20 | decisão humana, com contagem |
| Efeito | congela o passado, dispara o recálculo de fechamento | injeta verdade física no estoque |
| Estado | calculado, não persistido (só `corte_periodo_id` no diagnóstico) | persistido em `escala_fechamentos_periodo` |

### 1.3 Estados de um período (por data × período)
`EM_EXECUÇÃO` → `DADOS_ESTÁVEIS` (auto) → `FÍSICO_CONFIRMADO` | `FÍSICO_PARCIAL` | `SEM_CONTAGEM` (dispensado com motivo) | `ESTIMADO_POR_PRAZO` (ninguém fechou).
O **plano** de um período futuro P recebe o rótulo:
* **CONFIRMADO** — todo buffer relevante que P consome tem contagem física com `contado_em` ≥ (início de P − 15 min), ou é posterior ao último movimento que o afeta;
* **PROVISÓRIO — aguardando fechamento físico** — caso contrário, com a **idade** da última contagem ("física há 2h20");
* **EM EXECUÇÃO** — P já começou: congelado; o sistema só *valida* (ver 8.2).

---

## 2. Esquema de dados

Nomes sugeridos; `buffer` = elo lógico (produto canônico + etapa origem → etapa seguinte).

```sql
-- 1 linha por fechamento (um período pode ter mais de um: correção/reabertura = nova linha)
escala_fechamentos_periodo (
  id uuid pk, semana_inicio date, data date, periodo_id text,
  status text check (status in ('fisico_confirmado','fisico_parcial','sem_contagem','estimado_por_prazo')),
  fechado_em timestamptz,                 -- instante em que o supervisor fechou
  fechado_por uuid references usuarios,   -- usuário autenticado (hoje é texto livre)
  diagnostico_id uuid,                    -- escala_fluxo_diagnosticos usado para mostrar o estimado
  observacao text, substitui_id uuid references escala_fechamentos_periodo,
  chave_idempotencia uuid unique, criado_em timestamptz default now()
)

-- 1 linha por buffer contado
escala_contagens_fisicas (
  id uuid pk, fechamento_id uuid null references escala_fechamentos_periodo,   -- null = contagem avulsa / legado
  periodo_id text, data date,             -- período a que a contagem se refere (informativo)
  buffer_chave text,                      -- 'prod|etapaOrigem|etapaSeguinte' (canônico)
  produto_id uuid, etapa_origem_id uuid, etapa_seguinte_id uuid,   -- cópias: histórico não muda se o cadastro mudar
  contado_em timestamptz not null,        -- INSTANTE FÍSICO (é o T do motor)
  saldo_fisico numeric not null check (saldo_fisico >= 0),
  saldo_estimado numeric, estimado_lo numeric, estimado_hi numeric,      -- do motor, no mesmo T
  diferenca numeric generated always as (saldo_fisico - saldo_estimado) stored,
  metodo text check (metodo in ('contagem','balanca','visual')),
  estado text not null default 'valida' check (estado in ('valida','corrigida','anulada')),
  corrige_id uuid references escala_contagens_fisicas,
  fonte text check (fonte in ('fechamento','avulsa','legado_param')),
  informado_por uuid references usuarios, observacao text,
  chave_idempotencia uuid unique, criado_em timestamptz default now(),
  constraint obs_se_diverge check (abs(coalesce(saldo_fisico - saldo_estimado,0)) <= greatest(200, 0.1*saldo_fisico) or length(btrim(coalesce(observacao,''))) >= 3)
)
-- imutável: trigger before update/delete/truncate (mesmo padrão de wip_confirmacoes e escala_fluxo_diagnosticos)
```

* **Visão `escala_contagens_vigentes`**: `distinct on (buffer_chave)` da mais recente por `contado_em` com `estado = 'valida'`. É a única coisa que o motor lê (evita as dezenas de diagnósticos "substituída por contagem mais recente" que `validarContagens` emitiria por recálculo).
* **Qualidade do modelo** (visões): erro com sinal (viés) e absoluto (MAE/MAPE) por buffer, por produto, por **máquina** (join buffer→etapa→máquinas compatíveis), por dia/turno, frequência de |dif| > tolerância, e "idade da âncora" no momento da contagem (para separar erro de âncora de erro de fluxo).
* **Legado**: as 25 contagens atuais entram com `fonte='legado_param'`, `saldo_estimado` nulo.
* **Chave do buffer** acompanha o roteiro. No cutover do Produto Único (09/11) a chave muda; manter tabela de-para para o histórico.
* **Buffer compartilhado Conv/Auto** (hoje): o adaptador emite Conv = total físico e Auto = 0 (o que fiz à mão às 12:21), dentro do `ContagemFisicaPar[]`. Some com o produto único.

---

## 3. UX da tela

Local sugerido: onde já vive o lançamento da Produção Real (`ApontamentoModal` / `SemProducaoModal`), como ação **"Fechar período"** do período que acabou; só perfil supervisor/autorizado.

```
Fechar M2 · 03/11 · 08:48–10:24                           [Dados: estáveis ✓ 100% dos postos]
─────────────────────────────────────────────────────────────────────────────────────────────
 1) Apontamentos       12 de 12 postos lançados · refugo 0 · 1 sem produção (Parafusadeira 9)  [ver]
─────────────────────────────────────────────────────────────────────────────────────────────
 2) Estoque físico      (só o que importa para os próximos 2 períodos)
    Conector 3/4
    Rosqueadas → Parafusar        estimado 4.850  (4.150–5.000)     físico [ 4.150 ]   Δ −700
    Parafusadas/M8 → Etiquetar    estimado 3.072  (2.800–3.100)     físico [   750 ]   Δ −2.322  ⚠ explique
    Etiquetadas → Embalar         estimado 8.600                    físico [ 9.000 ]   Δ +400
    Contado às [10:24]   método (•) contagem ( ) balança ( ) visual
    Observação [____________________]   ← obrigatória se Δ > 10% ou > 200 pç
─────────────────────────────────────────────────────────────────────────────────────────────
 [ Pular um buffer ▾ ]  [ Fechar sem contagem… (motivo) ]            [ CONFIRMAR FECHAMENTO ]
```

* Só aparecem buffers **relevantes**: estoque estimado ≥ limiar (ex.: 500 pç) **ou** consumo planejado nos próximos 2 períodos > 0. Produto sem estoque intermediário não aparece. Conector 3/4 = 3 linhas; Caixa = 1.
* **Estimado e faixa** vêm do diagnóstico de fechamento (`wip.pares[].wip.lo/hi` já é o estoque no fim do período fechado — conferido: 10:35 → 1.950 + 1.122 etc.).
* O campo físico nasce **vazio** (não pré-preenchido com o estimado): pré-preencher vira "confirmar sem contar" e envenena a âncora. Existe "Pular" explícito, que registra `nao_contado`.
* **Sanidade**: digitação com Δ > 50% pede confirmação em dois passos ("48.000 em vez de 4.800?"). Contagem posterior corrige; ninguém edita.
* **Meta de tempo**: 60–90 s para o Conector. Não há contagem por operador de máquina; é uma ação do supervisor.
* Modo **âncora** (abertura do dia e pausa do almoço): mesma tela, todos os buffers relevantes, sem tolerar "pular" sem motivo.

---

## 4. Fluxo M1 → M2 → M3 → T1 (com os horários reais)

Períodos: M1 07:12–08:48 · M2 08:48–10:24 · M3 10:24–11:55 · pausa · T1 13:00–14:20. Agendador atual: jobs pré-período a −5/−2 min e pós-período a +11/+14/+18 min.

| Momento | Ação do supervisor | O que o sistema faz | Efeito |
|---|---|---|---|
| ~07:00 (pré-M1) | **Âncora de abertura** (todos os buffers relevantes) | grava contagens; recalcula M2→ | M2 em diante CONFIRMADO. M1 já iniciou (congelado) |
| 08:40–08:50 (virada M1→M2) | *opcional/gatilhado*: contagem rápida dos buffers que M2 consome | idem | protege **M2** (o período que está começando); sem ela, M2 só é validada depois (8.2) |
| 08:59 (+11) | **Fechar M1**: apontamentos + buffers de risco | recálculo | M3 em diante CONFIRMADO; valida M2 (alerta se inviável) |
| ~10:20–10:30 (virada M2→M3) | **contagem dos buffers que M3 consome** (hoje: Parafusadas→Etiquetar) | recálculo ≈1 min | detecta M3 inviável **a tempo da bancada**; T1+ CONFIRMADO |
| 10:35 (+11) | Fechar M2 | recálculo | confirma o já contado; atualiza T1/T2/T3 |
| 11:55–12:55 (**janela do almoço**) | **Âncora de almoço** (todos os buffers relevantes) | recálculo | T1 CONFIRMADO antes das 13:00; 65 min de folga |
| 14:20–14:31 | Fechar T1 | recálculo | T3 e dia seguinte CONFIRMADOS |

Cadência recomendada (decisão sua — ver §12): *sempre* fechar o período (passo 1: apontamentos/sem produção, ~20 s); *contar buffers* nas âncoras (abertura, almoço) e por **gatilho**: (a) posto de montante com `sem_producao`/parada, (b) consumo planejado do próximo período > 60% do estimado, (c) divergência anterior > tolerância, (d) estimativa com idade ≥ 2 períodos. Isso evita "seis inventários por dia" e cobre os casos de risco.

---

## 5. O que muda no motor atual

Pequeno e localizado; o planejador não muda.

1. **Leitura** (`supabaseIO.ts`/`integracao.ts`/`parametrosFluxo.ts`): ler `escala_contagens_vigentes` + (durante a migração) a chave jsonb legada, com a mesma regra de duplicata. Saída: o mesmo `ContagemFisicaPar[]`. Verificável por igualdade de `hash_entrada`.
2. **Confiança** (`contagem.ts`: `PERIODOS_CONFIANCA_ALTA = 6`): trocar por *idade em períodos desde a contagem* + política de §8; expor `idadePeriodos` no diagnóstico.
3. **Estimado no instante T**: o diagnóstico de fechamento já guarda o estoque no fim do período; criar uma função/endpoint que devolva `{estimado, lo, hi}` por buffer para a tela (e para gravar `saldo_estimado` na contagem).
4. **Alertas novos** (diagnóstico, sem mudar plano): `FECHAMENTO_FISICO_PENDENTE`, `PLANO_EM_EXECUCAO_INVIAVEL` (consumo planejado do período em andamento > estoque físico + chegada permitida pela regra de lote), `ESTIMATIVA_ENVELHECIDA`.
5. **Evento**: trigger na tabela nova (equivalente a `trg_escala_parametros_evento`), com ordenação por `contado_em` e prioridade sobre eventos de apontamento do mesmo instante. Regra de ordem de processamento (lição de hoje: "drenar antes de gravar") passa a ser garantida pela leitura *as-of*, não por procedimento manual.
6. **Adaptador Conv/Auto** (temporário até 09/11): Conv = total, Auto = 0; observação padrão automática.
7. **Não muda**: corte-v1, `planejarFuturo`, `postosDespacho`, regra de lote, gate θ, estabilização de pessoas, revezamento, ponte M3→T1.

---

## 6. O que pode ser removido ou simplificado

| Item | Depois do fechamento físico | Recomendação |
|---|---|---|
| Projeção de período fechado (células `nao_confirmado` de períodos já contados) | desaparece para buffers contados (`fim ≤ T` já nunca conta) | manter só para buffer sem contagem |
| Fator pós-zero / λ / previsão conservadora (modelos B/C) | só afetam o **período aberto e o horizonte curto** (≤ 1–2 períodos até a próxima âncora) | **parar de calibrar**; manter o modelo A como previsão/preview/alerta |
| `DEPENDENCIA_UPSTREAM_NAO_CONFIRMADA` | útil só quando falta contagem | manter como rede de segurança, sem investir em refino |
| Fail-safe `WIP_INICIAL_DESCONHECIDO` | quase nunca dispara com âncora diária | manter, é barato |
| `wip_controle / wip_ajustes / wip_confirmacoes / wip_saldo_semanal` (Fases 1–3) | sobreposição de conceito (confirmação de saldo com `saldo_estimado`, imutável, motivo se diverge); em PROD há **0 controles** | unificar: a tabela nova faz o papel; congelar as antigas como histórico |
| Chave `producao_real_contagens_fisicas` (jsonb) | substituída | somente leitura depois da migração |
| Truque Conv/Auto (contêiner + zeros) | some com o produto único | adaptador temporário |

Dado do replay que sustenta o corte: nas reconstruções, **nenhum** dos 2.322 aparece como erro de fluxo/projeção (a diferença é a mesma em todas as fronteiras) — o fator pós-zero não teria evitado esse erro de hoje. (Vale se os apontamentos de M2/M3 estiverem corretos; o próprio resultado constante é o indício.)

---

## 7. Riscos

1. **Carimbo de aprovação**: pré-preencher/“confirmar” sem contar torna a âncora falsa. Mitigação: campo vazio, "pular" explícito, status `nao_contado`, auditoria de diferença zero repetida.
2. **Erro de digitação** (48.000 vs 4.800): limite de plausibilidade, confirmação em dois passos, contagem corretiva (nunca edição).
3. **Contagem durante a produção**: o número já está velho; a contagem carrega `contado_em` real e o motor soma só o lançado depois (já existe). Preferir contar na virada/almoço.
4. **Latência × períodos contíguos** (o mais importante): fechar N depois que N+1 começou protege N+2. Mitigação: contagem de virada para os buffers críticos + alerta de inviabilidade do período em execução.
5. **Churn**: até 6 recálculos/dia com verdade nova. O gate θ=1% e a estabilização de pessoas continuam valendo; correção física grande (como −2.322) mexe de verdade e deve mexer.
6. **Disponibilidade do supervisor** (hoje o dono estava no almoço): plano de contingência em §9; autorização para ≥2 pessoas.
7. **Incerteza da contagem visual**: registrar `metodo`; futuramente `incerteza` e usar o pior caso (lo) para consumo.
8. **Conflito físico × apontamento**: contagem 500 e depois lançamento que consome 800 do mesmo buffer ⇒ negativo (`WIP_NEGATIVO_ESTIMADO`); tratar como alerta, nunca como ajuste silencioso.
9. **Acoplamento ao Produto Único (09/11)**: chaves de buffer mudam. Não misturar com o cutover (§10).
10. **Buffer compartilhado Conv/Auto**: erro de atribuição enquanto o legado existir; só o total físico é verdade.
11. **Concorrência**: dois supervisores contando o mesmo buffer; vale a de maior `contado_em`; empate por `criado_em`.
12. **Cultura**: se virar burocracia (seis telas por dia), cai a adesão. Por isso âncoras + gatilhos, não todo período.

---

## 8. Período não fechado

### 8.1 Regras
* Nenhum bloqueio físico da fábrica. Nada trava o apontamento nem o início do período.
* Período sem fechamento físico ⇒ plano seguinte **PROVISÓRIO**, com idade da última âncora.
* Fim + 20 min sem fechamento ⇒ `ESTIMADO_POR_PRAZO`, alerta ao supervisor e a um segundo autorizado.
* Fechamento **tardio** é aceito: `contado_em` = instante real da contagem, não o fim do período (o motor já entende "contagem no meio de um período").
* Buffer com ≥ 2 períodos sem contagem: confiança `baixa` ⇒ consumo do buffer limitado ao **limite inferior** (`lo`) no plano (o que `DEPENDENCIA_UPSTREAM_NAO_CONFIRMADA` já tenta fazer).

### 8.2 Período seguinte já em andamento
Se N+1 começou antes do fechamento de N: o plano de N+1 não é reescrito. O sistema compara o plano de N+1 com o físico recém-contado e emite `PLANO_EM_EXECUCAO_INVIAVEL` com ação sugerida (ex.: *"Etiquetadora 15 M3: plano 3.500; físico 750 e a regra de lote só libera o que chega depois ⇒ desligar até chegarem parafusadas; Embalagem 17 tem 9.000 etiquetadas"*). É exatamente a intervenção que você fez à mão hoje, só que vinda do sistema.

---

## 9. Contagem faltante

| Situação | Comportamento |
|---|---|
| Supervisor não contou um buffer | `nao_contado` explícito; estimado continua, confiança cai por idade |
| Contou só parte | `FÍSICO_PARCIAL`; o resto fica pendente e pode ser completado depois (contagem tardia) |
| Impossível contar (acesso, tempo) | "Fechar sem contagem" + motivo ⇒ `SEM_CONTAGEM`; alerta de envelhecimento |
| Ninguém fechou | `ESTIMADO_POR_PRAZO` + alerta; segue o plano provisório |
| Almoço sem âncora | T1 sai PROVISÓRIO e o painel mostra "Última âncora física: 07:00 (6h)" |
| Início do dia sem âncora | usa a última âncora do dia anterior (fim de semana: ≤ 2 dias, regra atual) com confiança média |

---

## 10. Migração sem quebrar histórico

* **Fase 0 (inerte)**: tabelas, visões, triggers de imutabilidade, backfill das 25 contagens (`fonte='legado_param'`). Nenhuma mudança de comportamento. Teste: `hash_entrada` e plano idênticos no replay das versões já gravadas.
* **Fase 1 (leitura dupla)**: adaptador lê tabela ∪ jsonb com a mesma regra de duplicata. Teste de equivalência por replay das versões de plano de 03/11.
* **Fase 2 (sombra na tela)**: tela só em DEV/Preview; piloto no Conector 3/4. Saldo estimado gravado, plano ainda influenciado só pelas contagens existentes.
* **Fase 3 (PROD)**: ligar a tela para um supervisor; a tabela passa a ser a fonte; o jsonb vira somente leitura (trigger bloqueia escrita). SQL manual deixa de existir.
* **Fase 4**: congelar `wip_*` das Fases 1–3; remover calibragem de pós-zero/λ do backlog.
* **Histórico**: nada é reescrito. `escala_plano_versoes`, diagnósticos e apontamentos ficam; as contagens legadas continuam legíveis.
* **Produto Único (09/11)**: **não entregar no mesmo corte.** Sugestão: Fase 0/1 antes (inerte, chaves atuais); Fase 2/3 depois do cutover, já com a chave nova — evita migrar chaves duas vezes. Alternativa: pilotar já nas chaves atuais e usar a tabela de-para.
* **Reversão**: cada fase é reversível por flag; a Fase 3 volta ao jsonb sem perda porque a tabela é append-only e o adaptador pode regravar a lista.

---

## 11. Replay de 03/11 (dados reais)

### 11.1 Estimado do sistema × físico, por fronteira
Estimado = `escala_fluxo_diagnosticos.wip.pares` no recálculo de cada fechamento. Físico = **contagem das 12:08** (única medida) e **reconstrução para trás** com os apontamentos reais (`estoque(N−1) = estoque(N) − produção da origem em N + consumo da seguinte em N`). A reconstrução assume apontamentos corretos; o fato de ela dar **diferença idêntica nas quatro fronteiras** nos três buffers é, por si só, evidência de que os fluxos estão corretos.

**Rosqueadas → Parafusar (Conv)**

| Fronteira | Estimado | Físico (reconstr./medido) | Δ |
|---|---|---|---|
| Início do dia (07:12) | 4.000 | 3.300 | −700 |
| Fim M1 (08:48) | 5.000 | 4.300 | −700 |
| Fim M2 (10:24) | 4.850 | 4.150 | −700 |
| Fim M3 (11:55) | 1.900 | **1.200 (medido 12:08)** | −700 |

**Parafusadas/M8 → Etiquetar (Conv + Auto = um estoque físico)**

| Fronteira | Estimado Conv + Auto | Físico | Δ |
|---|---|---|---|
| Início do dia | 2.400 + 0 | 78 | **−2.322** |
| Fim M1 | 5.400 + 0 | 3.078 | −2.322 |
| Fim M2 | 1.950 + 1.122 = 3.072 | **750** | −2.322 |
| Fim M3 | 4.900 + 2.222 = 7.122 | **4.800 (medido)** | −2.322 |

**Etiquetadas → Embalar**

| Fronteira | Estimado | Físico | Δ |
|---|---|---|---|
| Início do dia | 3.600 | 4.000 | +400 |
| Fim M1 | 3.600 | 4.000 | +400 |
| Fim M2 | 8.600 | 9.000 | +400 |
| Fim M3 | 8.600 | **9.000 (medido)** | +400 |

Leitura: os três erros são **constantes desde o início do dia**. Nasceram na âncora de 02/11 20:20 (contagem visual; o próprio registro diz "Paf→Etiq … não se sabe quanto é da M8"). O modelo de fluxo não errou.

### 11.2 O que aconteceu com a Etiquetadora 15
* Planos 09:02 / 10:35 / 12:06: M3 Etiquetadora 15 = **3.500** (Conv). Real: **sem produção** (você desligou no chão). Estoque físico no início de M3 ≈ **750**.
* Real em M2: Etiquetadora 15 produziu **5.000** contra 3.500 planejados; consumiu o estoque que o plano reservava para M3.
* Planos 09:02 e 10:35 tinham **Embalagem 17 em T1 (4.500)**; o plano de 12:06 (calculado sobre 7.122 estimados contra 4.800 físicos) a **tirou** de T1; o de 12:21 (físico) continuou sem ela. Não provei que o estoque errado causou a troca; mostra, de qualquer forma, a instabilidade típica de soluções de resultado ≈ igual (o estudo do desempate, §14).
* O erro de 2.322 inflava o buffer da Etiquetadora; no plano de 12:06 a Auto aparecia com 2.222 próprios que não existiam como estoque separado.

### 11.3 Como o fluxo novo teria se comportado
| Momento | Com fechamento físico | Resultado |
|---|---|---|
| ~07:00 âncora | físico 78 em vez de 2.400 (Δ −97%); Rosq→Paf 3.300 (Δ −700); Etiq→Emb 4.000 (Δ +400) | M2+ já planejado sobre a verdade. A Etiquetadora 15 em M2 limitada a ≈ 3.078 (vs 3.500); alerta de Δ gigante logo cedo |
| 08:59 fechar M1 | confirma 3.078; erro continua 0 (fluxo certo) | M3 planejado sobre 3.078 + chegadas − M2 |
| ~10:24 virada M2→M3 (contagem do buffer crítico) | físico **750**. Com a âncora das 07:00 boa o estimado também seria ≈ 750 (Δ ≈ 0); o que o plano de M3 (3.500) ignorou foi a **execução** de M2 (5.000 contra 3.500) | `PLANO_EM_EXECUCAO_INVIAVEL`: *Etiquetadora 15 M3 3.500 × físico 750*; sugere Embalagem 17 (9.000 disponíveis) — antes de você ter que descobrir |
| 10:35 fechar M2 | T1/T2/T3 recalculados sobre 750 + chegadas | em vez de 7.122 às 12:06 |
| almoço âncora | 4.800 / 9.000 / 1.200 | T1 CONFIRMADO ≥ 1 h antes das 13:00 (igual ao que fizemos, mas sem o plano de 12:06 errado ter existido) |

**Honestidade do replay:** (i) o número 750 e os 3.078/78 são reconstruídos, não medidos; (ii) o fechamento **sozinho** não teria impedido que M3 estivesse programada com 3.500 — esse plano nasceu antes e M2 consumiu mais do que o plano; o que ele teria feito é (a) tirar o viés de 2.322 desde cedo e (b) acusar a inviabilidade de M3 no minuto em que M2 terminou, em vez de chegar pelo operador; (iii) a diferença no plano de T1 hoje foi pequena em postos (0 postos mudaram) e média em quantidades (9 linhas) — o ganho principal é **evitar a decisão errada no chão e ganhar ~1h45 de verdade física**.

### 11.4 Como medir o modelo (métrica do dia 03/11 se o fluxo existisse)
Viés Conv Rosq→Paf −700; Paf/M8→Etiq −2.322; Etiq→Emb +400. MAPE no ponto medido (12:08) ≈ 37% (58% / 48% / 4%). Erro por máquina: concentrado no elo **Parafusadeiras + M8 → Etiquetadora 15**. Frequência: 3 de 3 buffers fora da tolerância na primeira medição. Todos viés constante ⇒ classificar como **erro de âncora**, não de fluxo — informação que o desenho com contagens frequentes produz sozinho.

---

## 12. Decisões que dependem de você
1. **Cadência**: (a) toda contagem em todo período, ou (b) âncoras (abertura + almoço) + gatilhos de risco? Recomendo (b).
2. **Contagem de virada** (fim −8 a +2 min) para os buffers críticos: aceita pedir ao supervisor, ou só fechamento depois (protege N+2)?
3. **Quem fecha**: perfil supervisor + 1 substituto?
4. **Tolerância/limiar**: Δ > 10% ou 200 peças exige observação; Δ > 50% exige 2º passo.
5. **Pré-preenchimento**: campo vazio (recomendado) ou estimado sugerido?
6. **Sequência com o Produto Único**: Fase 0/1 já, Fase 2/3 depois de 09/11?
7. **Aposentar** calibração de pós-zero/λ/modelos B/C e `wip_*` das Fases 1–3?

## 13. Teste de aceitação sugerido (antes de qualquer código)
* **Replay 03/11**: reconstruir as versões do plano da semana com o adaptador e com contagens reconstruídas (§11.1) nas fronteiras; comparar M3/T1/T2/T3 com o publicado; critério: nenhum plano com consumo > físico + chegada (lote).
* **Equivalência**: tabela nova ∪ jsonb ⇒ `hash_entrada` idêntico às 25 contagens atuais.
* **Imutabilidade**: update/delete/truncate recusados; correção cria linha nova.
* **As-of**: contagem com `contado_em` antigo inserida depois não sobrescreve contagem mais recente; evento antigo processado depois não altera o saldo.
* **Faltante/tardio**: períodos sem fechamento seguem plano PROVISÓRIO com idade; fechamento tardio recalcula sem tocar o passado.

## 14. Estudo em pausa: desempate "menor WIP / produto final mais cedo"
Pausado a seu pedido. Parcial offline (`scripts/auditoria-fluxo/avaliar-embalagem.ts`, resultados em `sittech-rollbacks/2026-11-03-1208/emul/embalagem-cenarios.{txt,json}`), 111 cenários, mesmo despacho/objetivo do corte-v1, todos válidos (0 CADEIA_INVALIDA, 0 sem material, 0 violação dura):
* **Trocar** um posto por Embalagem 17 em T1/T2 (custa um posto): objetivo −18 a −291 (R$), peças da semana −175 a −2.267 — o que o motor já mostrou.
* **Permutar no tempo** (Embalagem 17 sobe para T1, o posto X desce para onde ela estava; mesmo nº de postos por período): 89 permutações válidas, 55 com perda de objetivo ≤ 0,05%. Muitas com Δobjetivo = 0 e Δpeças = 0, **Embalagem 17 em T1 (+4.500 finalizadas)**, WIP médio −344 a −3.036 e máximo até −6.047, permanência das etiquetadas −0,06 a −0,36 h; churn mínimo = 4 postos (2 removidos + 2 novos) e 2–3 pessoas (mesmo dia: Rosqueadeira 3/7, Montagem 18/19 ↔ Embalagem 17 em T3).
* Ou seja, existe **platô**: o objetivo é indiferente a esses ganhos, então um desempate secundário tem espaço. Pendente: implementar o termo no despacho (flag desligada), testar κ e o interlock com o gate θ (hoje o gate mantém o vigente se o ganho do objetivo < 1%, então o desempate nunca valeria sozinho).

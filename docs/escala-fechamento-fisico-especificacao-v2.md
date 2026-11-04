# Fechamento físico de período — ESPECIFICAÇÃO v2 (contagem em TODOS os períodos)

> **PARCIALMENTE SUPERADA** por `escala-fechamento-fisico-implantacao.md` (decisão final do usuário em 03/11): **não existe mais período PROVISÓRIO**; o fechamento é UM processo atômico na troca de período (EM_FECHAMENTO → RECALCULANDO → CONFIRMADO | ERRO_RECALCULO), com as máquinas paradas. As seções 4 (provisório/confirmado) e 8 (período não fechado) deste documento não valem mais.

Status: **especificação + migration em rascunho. Nada publicado, nada aplicado em PROD.** Substitui o desenho v1 (`escala-fechamento-fisico-desenho.md`), que propunha âncoras + gatilhos de risco. Decisão do usuário (03/11): **contar todo buffer intermediário relevante em todo fechamento (M1, M2, M3, T1, T2, T3)**; prioridade = minimizar erro de WIP; "menos inteligência especulativa, mais estado físico real".

Artefatos desta entrega
* Este documento.
* `docs/fechamento-fisico/20261110100000_escala_fechamento_fisico.sql` — migration RASCUNHO (fora de `supabase/migrations/` de propósito).
* `docs/fechamento-fisico/20261110100000_escala_fechamento_fisico_ROLLBACK.sql` — rollback atômico (arquiva antes de remover).
* `docs/fechamento-fisico/teste_fechamento_fisico.sql` — testes de comportamento (rodaram em Postgres 16 local descartável, com stubs: **migration aplicada 2×, testes OK, rollback OK**).
* `scripts/auditoria-fluxo/replay-fechamentos.ts` — replay do corte-v1 com contagens de fechamento (saída em `~/Documents/sittech-rollbacks/2026-11-03-1208/replay/`).

---

## 0. O que muda em relação ao v1 (e o que o replay mudou)

1. **Cadência**: toda contagem em todo fechamento. As âncoras viram apenas o caso particular do 1º fechamento do dia.
2. **Campo físico obrigatório e vazio** (sem pré-preenchimento). A exceção é o caso "impossível contar" (§3.7), auditado.
3. **Um só snapshot** por período: produção, refugo, sem_producao, paradas e WIP físico, imutável (revisões, nunca edição).
4. **Buffer físico ≠ par do motor**: o tablet pergunta *"Parafusadas aguardando Etiquetar"* uma vez; o servidor traduz para os pares legados (Conv recebe o total, Auto recebe 0) até o Produto Único. Isso desacopla esta entrega do cutover de 09/11.
5. Achado do replay que sustenta a decisão: **o erro de WIP de hoje foi constante desde a âncora; com contagem em todo fechamento, o fechamento do M2 sozinho (10:24) teria feito o motor trabalhar às 12:06 com 9.000 / 4.800 / 1.200 — exatamente o que o usuário mediu à mão às 12:08** (§6).

---

## 1. UX final (tablet)

### 1.1 Onde vive
Painel de Produção Real (`/producao-real`, `ProducaoRealPainelPage`), o mesmo tablet em que a supervisora já lança os apontamentos. Novo botão fixo **FECHAR M2** a partir de 5 min antes do fim do período, e **faixa de estado** no topo com o período atual e o próximo (§4).

### 1.2 Tela "Fechar período" (uma tela, três blocos)

```
FECHAR M2  ·  08:48–10:24                                   [x]
─────────────────────────────────────────────────────────────
1 APONTAMENTOS                              ✓ 11/11 coletados
   (se faltar:  ⚠ 2 pendentes → [Parafusadeira 9] [M8]   toque para lançar / sem produção)

2 ESTOQUE FÍSICO – CONECTOR 3/4
   Rosqueadas aguardando Parafusar
      Estimado: 4.850                       Físico: [        ]
   Parafusadas aguardando Etiquetar
      Estimado: 3.072                       Físico: [        ]
   Etiquetadas aguardando Embalar
      Estimado: 8.600                       Físico: [        ]

3 CONTAGEM FEITA ÀS [10:24 ▾]                  (padrão: agora)

   [ FINALIZAR M2 E RECALCULAR M3 ]   ← desabilitado até tudo válido
─────────────────────────────────────────────────────────────
```

Regras de tela
* **Teclado numérico grande** (`inputmode="numeric"`), separador de milhar automático, avanço automático de campo, campo vazio ao abrir. **Nunca** preencher com o estimado.
* Mostra **só buffers reais** entre operações e **só de produtos ativos na semana** (§3.2). Produto de uma operação só **não aparece**.
* **Conector 3/4 = 3 linhas** (não 5): Conv + M8 formam um estoque só antes da Etiquetadora; idem depois.
* **Diferença ao vivo** ao lado do campo (cinza ≤ 15%/500 pç; âmbar acima). Acima do limite pede **um motivo em 1 toque** (lista curta: *contagem anterior errada · peças perdidas/refugo · estoque movido · outro*). Acima de 50% pede confirmação (*"48.000 em vez de 3.072?"*).
* Rodapé fixo com o botão; ao tocar: "Fechado 10:27 por Fulana. Recalculando M3…" → estado muda para **CONFIRMADO** em ≈1 min.
* Meta: **≤ 60 s** para o Conector (3 números + 1 toque).
* Falha de rede: o fechamento fica **na fila do tablet** com a mesma `chave_idempotencia` e é reenviado sozinho; a tela mostra "pendente de envio".

### 1.3 Telas vizinhas
* **Linha do tempo dos períodos** (cabeçalho do painel, Escala e TV): chips **PASSADO · EM EXECUÇÃO · PROVISÓRIO — aguardando fechamento do período anterior · RECALCULANDO · CONFIRMADO (10:27, Fulana)**.
* **Pendência** (≥ fim+10 min sem fechamento): banner amarelo "M2 sem fechamento físico" + push; ≥ fim+20: vermelho.
* **Histórico** (`/producao-real/apontamentos`): cada período mostra o fechamento vigente, revisões e diferenças.
* **Qualidade do WIP** (página nova em Indicadores): viés, desvio absoluto e %, por período/produto/operação/máquina/dia.

---

## 2. Banco de dados

Detalhe e SQL: `docs/fechamento-fisico/20261110100000_escala_fechamento_fisico.sql`.

| Tabela / view | Papel |
|---|---|
| `escala_buffers_fisicos` | Catálogo dos buffers que o tablet mostra (chave, rótulo, ordem, ativo). Ex.: `conector34:parafusadas`. |
| `escala_buffer_pares` | Buffer → pares do motor (`produto_id`, `etapa_origem_id`, `etapa_seguinte_id`, **papel `contabil` ou `zero`**, vigência). `contabil` recebe o total físico; `zero` recebe 0 (mesmo estoque, já contado). **É a única coisa que muda no cutover do Produto Único.** |
| `escala_buffer_maquinas` | Quem produz/consome o buffer (para o erro por máquina). |
| `escala_fechamentos` (append-only) | Cabeçalho: `data`, `periodo_id`, `tipo` (`periodo`\|`abertura`), `revisao`, `fechado_em` (relógio do servidor), `contado_em` (**instante físico = T do motor**), `fechado_por`, `dispositivo`, `postos_esperados/coletados` (devem ser iguais), `buffers_obrigatorios`, `resumo_producao` (jsonb: produção, refugo, sem_producao, paradas por posto), `hash_resumo`, `chave_idempotencia`. |
| `escala_fechamento_buffers` (append-only) | Por buffer: `saldo_estimado` (+ `lo`/`hi`, **gravados pelo servidor**), `saldo_fisico` (≥ 0), `diferenca` (gerada), `motivo` (obrigatório se |Δ| > max(500, 15%)). |
| `escala_fechamentos_vigentes` | Maior revisão por período. |
| `escala_contagens_fechamento_para_motor` | A contagem mais recente por par legado, no formato do motor (`produtoId`, `etapaOrigemId`, `etapaSeguinteId`, `saldo`, `contadoEm`). |
| `escala_periodo_status` | Estado derivado de cada período: PASSADO / EM_EXECUCAO / PROVISORIO / RECALCULANDO / CONFIRMADO. |
| `escala_wip_erro`, `_dia`, `_maquina`, `_produto` | Métricas: erro assinado (viés), desvio absoluto, desvio % (|Δ|/físico), por período, dia, buffer, produto/operação, máquina. |

Garantias: imutabilidade por trigger (update/delete/truncate recusados — mesmo padrão de `wip_confirmacoes` e `escala_fluxo_diagnosticos`); escrita só pela RPC `escala_fechamento_registrar` (service_role, idempotente, com *advisory lock* por período); leitura por RLS; nova permissão `escala_fechamento`; flag `escala_fechamento_fisico_modo` (`desligado` | `sombra` | `ativo`, padrão desligado).

---

## 3. Fluxo de fechamento

### 3.1 Sequência
```
tablet                      servidor (API Next)                         banco / motor
  │ GET  /api/escala/fechamento/preparar?data&periodo
  │──────────────────────────► checa permissão escala_fechamento
  │                            lista postos esperados × apontamentos
  │                            calcula buffers ativos + ESTIMADO (lo/hi) no instante do fim
  │◄──────────────────────────  { postos, buffers[{id, rotulo, estimado}], estado }
  │ (supervisora lança o que falta, conta, digita)
  │ POST /api/escala/fechamento/confirmar {data, periodo, contadoEm, buffers[{id, fisico, motivo}], chave}
  │──────────────────────────► revalida TUDO no servidor; RECALCULA o estimado e o grava (não confia no cliente)
  │                            RPC escala_fechamento_registrar ───────► grava snapshot (1 transação) + evento 'fechamento_fisico'
  │◄── 202 {fechamento_id}     drena o evento (processarSemana) ──────► corte-v1 recalcula o PRÓXIMO período e o futuro
  │ poll estado ───────────────► escala_periodo_status ───────────────► PROVISÓRIO → RECALCULANDO → CONFIRMADO
```

### 3.2 Quais buffers são obrigatórios
Todo buffer do catálogo cujo produto tem **demanda restante na semana** (Previsão) **ou** estoque estimado > 0. "Sem alerta" não dispensa: o alerta de risco (§5.5) é informação extra. Produto de uma só operação não tem buffer.

### 3.3 Validações do servidor (antes de aceitar)
1. Permissão `escala_fechamento` (ou admin).
2. **Todos os postos esperados** do período com apontamento (inclui `sem_producao`/parada, que contam como coleta). `postos_coletados = postos_esperados` (também é CHECK no banco).
3. **Todos os buffers obrigatórios** presentes; nenhum negativo; número inteiro.
4. `contado_em` ≥ fim do período − 15 min e ≤ agora (tolerância de relógio 30 min, como já faz `contagem.ts`).
5. Motivo quando |Δ| > max(500, 15% do físico); confirmação em dois passos acima de 50%.
6. Idempotência por `chave_idempotencia` (reenvio do tablet não duplica).
7. Usuário e timestamp gravados.

### 3.4 Correção ("reabrir")
Nunca edita. Gera **nova revisão** (`revisao+1`) com os mesmos campos; a vigente é a maior; a anterior permanece como histórico. Revisão posterior que altera um período já superado recalcula o futuro (o passado em execução não é reescrito).

### 3.5 Primeiro fechamento e pausas
* **Primeiro dia / retomada** (sem período anterior): o fechamento `tipo='abertura'` antes do 1º período — mesma tela.
* **Almoço** (M3 11:55 → T1 13:00): janela folgada; o fechamento do M3 pode ser feito até ~12:55 sem atrasar T1.
* **T3 → dia seguinte**: o fechamento do T3 confirma o M1.
* **Sábado/domingo**: a cadeia segue os dias com escala (`escala_producao_dias`).

### 3.6 Fallback automático (já existe)
`fechamento.ts` continua rodando (fim+10 min, ≥ 90% dos postos, quietude 3 min) e dispara o recálculo "de dados". Sem fechamento físico o período fica `ESTIMADO_POR_PRAZO` no relatório e o seguinte permanece **PROVISÓRIO**. A fábrica não para.

### 3.7 Impossível contar
O pedido é campo obrigatório. Proponho **uma** válvula, auditada: usuário com perfil superior pode "Fechar sem contagem" informando motivo; fica `SEM_CONTAGEM`, o buffer mantém estimado, **conta como erro desconhecido** nas métricas e gera alerta. (Decisão sua — §12.)

---

## 4. Comportamento PROVISÓRIO / CONFIRMADO

| Estado | Quando | O que a fábrica vê | O que o motor faz |
|---|---|---|---|
| **EM EXECUÇÃO** | o período já começou | plano congelado; compara-se plano × físico contado | só *valida* (alerta `PLANO_EM_EXECUCAO_INVIAVEL`); nunca reescreve |
| **PROVISÓRIO — aguardando fechamento do período anterior** | período futuro cujo anterior não tem fechamento vigente | plano com selo amarelo e idade ("estimado desde 10:24") | usa projeção (corte-v1 como hoje), confiança marcada |
| **RECALCULANDO** | fechamento gravado, evento ainda não processado | selo azul, ≈ 1 min | processa `fechamento_fisico` com prioridade |
| **CONFIRMADO** | fechamento vigente do anterior + evento processado | selo verde, quem e quando fechou | físico é a verdade |

* Os períodos são contíguos, então o **seguinte já pode ter começado** ao fechar o anterior: nesse caso vira EM EXECUÇÃO (não CONFIRMADO) e o benefício vai para o seguinte a ele. Por isso a UX estimula **fechar o mais perto possível da virada** (botão aparece 5 min antes do fim; `contado_em` ≥ fim − 15 min).
* Nenhum estado bloqueia apontamento, sem_producao, parada ou a operação.

---

## 5. Integração com o corte-v1

O planejador, o despacho, a regra de lote, o gate θ e a estabilização de pessoas **não mudam**. O que muda é a **entrada**:

1. **Leitura**: o adaptador lê `escala_contagens_fechamento_para_motor` (e, durante a migração, a chave jsonb legada) e entrega `contagensFisicas: ContagemFisicaPar[]` ao motor — mesmo tipo de hoje. Dedupe por par = a contagem de maior `contado_em` (regra já existente). Para o Conector: Conv = total físico, Auto = 0 (o que fiz à mão às 12:21).
2. **Semântica as-of (já existe em `contagem.ts`)**: período com fim ≤ T **nunca entra**; só movimento posterior a T altera o saldo; a mesma contagem não é "somada" ao estimado. Um evento antigo processado depois não sobrescreve o físico porque o motor sempre lê o estado *as-of* no recálculo, não por ordem de processamento.
3. **"Não usar projeção do período fechado"**: como o fechamento exige todos os postos (produção real ou sem_producao), o período fechado não tem células "não confirmadas"; o intervalo lo/hi colapsa. A projeção só vive no período em execução e no futuro.
4. **Confiança**: `alta` enquanto a última contagem é a do fechamento do período imediatamente anterior; decai por períodos sem fechamento (substitui `PERIODOS_CONFIANCA_ALTA = 6`).
5. **Alertas** (informação, não substituem a contagem): `FECHAMENTO_FISICO_PENDENTE`, `PLANO_EM_EXECUCAO_INVIAVEL`, `DIFERENCA_FISICA_GRANDE`.
6. **Evento**: `fechamento_fisico` (novo tipo no CHECK de `escala_producao_eventos`) coalescido por revisão, processado antes de eventos de apontamento do mesmo instante.
7. **Estimado no instante**: função fina `wipEstimadoNoInstante` (reaproveita `fluxo/estado.ts`/`grafo.ts` **sem rodar o planejador**) chamada em `preparar` e `confirmar`. *Spike necessário* para medir o custo (≤ 2 s alvo); se estourar, usar o diagnóstico do último recálculo (que já guarda `wip.pares`).
8. **Flags**: `desligado` (nada muda) → `sombra` (grava fechamento e **mede o erro**, o motor ainda usa o legado) → `ativo` (o motor usa o físico e o fechamento é exigido).

Pode ser descontinuado depois do `ativo` estável: modelos B/C, fator pós-zero, λ, `DEPENDENCIA_UPSTREAM_NAO_CONFIRMADA` como alavanca de plano (ficam só como previsão/preview do período aberto), `wip_controle/ajustes/confirmacoes` (Fases 1–3: 0 controles em PROD), a chave jsonb de contagens.

---

## 6. Replay de 03/11 (motor real, offline)

Método: `replay-fechamentos.ts` reproduz o recálculo oficial (`processarSemana`) em um instante, com o plano gravado de entrada, só os apontamentos criados até então e as contagens existentes até então; depois injeta as contagens de **fechamento reconstruídas**. Validação do método: **sem contagens extras o replay reproduz exatamente o plano publicado** (10:35 → versão `13ccb8da`; 12:06 → `f75d1ea0`: 0 linhas diferentes no futuro). O replay de M1 (08:59) **não** reproduz (a fila teve rajada de 5 versões entre 08:57 e 09:02); por isso M1 só entra na análise numérica.

Contagens de fechamento usadas = reconstrução para trás a partir da contagem das 12:08 e dos apontamentos reais (assume apontamentos corretos; o erro idêntico em todas as fronteiras é o indício):

| Fechamento | Rosq→Paf | Paf+M8→Etiq | Etiq→Emb | Estimado do sistema (R / P / E) | Δ |
|---|---|---|---|---|---|
| M1 08:48 | 4.300 | 3.078 | 4.000 | 5.000 / 5.400 / 3.600 | −700 / **−2.322** / +400 |
| M2 10:24 | 4.150 | 750 | 9.000 | 4.850 / 3.072 / 8.600 | −700 / −2.322 / +400 |
| M3 11:55 | 1.200 | 4.800 | 9.000 | 1.900 / 7.122 / 8.600 | −700 / −2.322 / +400 |

Os três erros existem **desde o 1º fechamento do dia** (M1): o fechamento teria acusado o erro às 08:59, ~3h antes da contagem manual.

### 6.1 O que o motor teria recebido às 12:06 (WIP no início do futuro)

| Buffer | Publicado 12:06 (estimado) | Replay com fechamento M2 | Contagem manual 12:08 |
|---|---|---|---|
| Rosqueadas → Parafusar | 1.900 | **1.200** | 1.200 |
| Parafusadas/M8 → Etiquetar (Conv + Auto) | 4.900 + 2.222 = **7.122** | 3.700 + 1.100 = **4.800** | 4.800 |
| Etiquetadas → Embalar | 8.600 | **9.000** | 9.000 |

O fechamento do **M2** sozinho, sem o M3 e sem contagem de almoço, já deixa o motor com o estoque correto de todos os buffers às 12:06. (A divisão Conv/Auto difere porque o adaptador manteria o Auto como o apontamento real do M8 pós-contagem; o **total físico é idêntico**. Com a regra do v2 — contar no fechamento do M3 — Conv = 4.800 / Auto = 0.)

### 6.2 Efeito no plano
* **10:35** (fechamento M2, físico 4.150 / 750 / 9.000): em T1–T3 de 03/11 **nenhum posto mudou**; 16 linhas com quantidades diferentes (T1 Parafusadeira 10: 1.204 → 1.139; T3 Etiquetadora 15 Auto: 2.999 → 2.829) e **2 postos a menos em 04/11** (Etiquetadora 15 M1 3.220; Embalagem 17 T3 4.496), 1 pessoa×posto trocada. O erro de 2.322 quase não aparece no plano de 10:35 porque o motor limita o consumo da Etiquetadora 15 em M3 pela disponibilidade nos dois mundos (3.072 ou 750); ele aparece no recálculo seguinte, quando o M3 real entra.
* **12:06**: o plano publicado prometia **368.672** peças futuras (soma das linhas); com o físico do M2 o plano calculado prometeria **361.283** (−2,0%), o publicado às 12:21 com a contagem manual ficou em **364.428**. A estimativa errada superestimava o plano em ~7,4 mil peças.
* **Churn**: o recálculo das 12:06 mudou **+52/−50 postos** no futuro (74 pessoa×posto) no plano real e **+48/−48** no replay com físico. Esse churn vem da **realidade do M3** (Etiquetadora 15 sem produção, Parafusadeira 10 sem produção), não do estoque; o fechamento físico **não** o elimina. O recálculo das 12:21 (contagem manual) mudou **0 postos**.
* **Histerese** (achado): com o mesmo estado físico, o plano depende do vigente. O gate θ=1% mantém o vigente; por isso a Embalagem 17, presente em T1 nos planos de 09:02 e 10:35 (4.500), saiu no plano de 12:06 e não voltou às 12:21 mesmo com o físico correto. Isso é o problema do desempate (estudo pausado), **não** do fechamento.

### 6.3 Etiquetadora 15 em M3
* O plano de M3 (3.500) nasceu às 09:02 e se manteve; em M2 a Etiquetadora 15 produziu **5.000** contra 3.500 planejados e consumiu o estoque; o físico no início de M3 ficou em ≈ **750** (reconstruído).
* O fechamento **não impede** o plano de M3 de existir (M3 está congelado ao fechar M2 — períodos contíguos). O que ele faz: (a) às 10:24–10:30 o físico 750 contra a estimativa 3.072 dispara `PLANO_EM_EXECUCAO_INVIAVEL` — *"Etiquetadora 15 M3: plano 3.500, físico 750; a regra de lote só libera o que chega depois; Embalagem 17 tem 9.000 etiquetadas"* — **a intervenção que o usuário fez à mão, vinda do sistema, no minuto do fechamento**; (b) T1+ já nasce correto no 10:35 em vez de 12:21 (≈1h46 antes); (c) nenhuma contagem manual extra às 12:08.
* Para proteger o M3 de fato, o fechamento do M2 precisa ocorrer **na virada** (10:19–10:26). É a razão da regra "botão aparece 5 min antes do fim" e "`contado_em` ≥ fim − 15 min".

### 6.4 Métrica de qualidade que esse dia teria gerado
Viés: −700 (Rosq→Paf), −2.322 (Paf/M8→Etiq), +400 (Etiq→Emb), **constantes** nos 3 fechamentos; desvio % no ponto medido: 58% / 48% / 4,4% (média 37%). Classificação automática possível: *erro constante entre fechamentos* ⇒ **âncora**; *erro que cresce* ⇒ **fluxo**. Hoje: 100% âncora.

---

## 7. Testes

**Já executados (Postgres 16 local, stubs)** — `teste_fechamento_fisico.sql`:
1. migration aplica e é idempotente (2×);
2. modo `desligado` grava mas **não enfileira evento**; modo `sombra` enfileira;
3. idempotência por `chave_idempotencia`;
4. recusa: buffers incompletos, saldo negativo, postos faltando, Δ grande sem motivo;
5. imutabilidade (update, delete, truncate) e catálogo não apagável;
6. Conector: Conv recebe o total e Auto 0 (soma = físico, sem duplicar M8);
7. revisão: a maior vira vigente, a anterior fica;
8. métricas (viés, desvio abs, desvio %) por dia/buffer;
9. estados PROVISÓRIO → RECALCULANDO → CONFIRMADO encadeando T3 → M1 do dia seguinte;
10. rollback atômico: arquiva 3 fechamentos / 9 contagens, remove objetos, mantém evento como `ignorado`.

**A escrever (vitest, antes do código de produção)**
* Adaptador: `ContagemFisicaPar[]` do fechamento ≡ jsonb legado ⇒ **`hash_entrada` idêntico**; dedupe por `contado_em`; Conv = total / Auto = 0; contagem tardia (`contado_em` antigo inserida depois) não sobrescreve a mais recente.
* `contagem.ts` (as-of): fim ≤ T nunca entra; evento antigo reprocessado depois não altera o saldo; contagem dentro de período em andamento.
* Servidor `preparar/confirmar`: permissão, completude, validações (§3.3), estimado recalculado no servidor (cliente adulterado é ignorado), idempotência, concorrência (2 abas).
* Estados: PROVISÓRIO/RECALCULANDO/CONFIRMADO, T3→M1, almoço, sábado, período sem posto.
* Engine golden: replay 03/11 (10:35, 12:06) com os números do §6 como **fixtures dourados**; plano nunca consome mais que estoque (lote).
* Métricas: viés, desvio, MAPE por máquina/produto/operação com fixture de 3 dias.
* UI (tablet 768–1024 px): campo vazio, teclado, avanço, diferença ao vivo, motivo em 1 toque, fila offline, botão desabilitado; acessibilidade; carga (12 postos × 6 períodos).
* Rollback: exportar vigentes → legado → modo desligado → o motor produz o mesmo plano que com o fechamento.

---

## 8. Plano de implementação

| Fase | Entrega | Flag | Gate para avançar |
|---|---|---|---|
| **A** (inerte) | Migration (tabelas, views, RPC), catálogo do Conector 3/4, backfill das 25 contagens como `fonte='legado'`; permissão `escala_fechamento` | desligado | testes de DB verdes em DEV; `hash_entrada` e plano idênticos no replay da semana 02/11 |
| **B** | Adaptador de leitura (tabela ∪ jsonb), `wipEstimadoNoInstante` (spike de custo), rotas `preparar/confirmar`, evento `fechamento_fisico` | desligado/sombra | testes de motor e API; replay 03/11 reproduz o §6 |
| **C** | Tela do tablet + faixa de estados + pendências + histórico, em DEV/Preview | sombra | teste em tablet real (≤ 60 s para o Conector), 1 turno inteiro simulado |
| **D** | Piloto em PROD no Conector 3/4: sombra (grava e mede, o motor ainda não usa) por 1 semana | sombra | métrica de erro estável; adesão ≥ 95% dos fechamentos; zero impacto no plano |
| **E** | `ativo`: motor usa o físico; fechamento exigido para CONFIRMADO; válvula "sem contagem" | ativo | duas semanas sem regressão; rollback ensaiado |
| **F** | Aposentadorias: jsonb legado somente leitura, `wip_*` Fases 1–3, calibração de pós-zero/λ/B/C | — | aprovação do usuário |

**Produto Único (09/11)**: A e B podem entrar antes (chaves por buffer, sem depender de produto); C–E recomendadas **depois** do cutover, com o catálogo apontando para o produto novo (uma troca de linhas em `escala_buffer_pares`). Não misturar com o corte do Produto Único.

---

## 9. Migrations

* `20261110100000_escala_fechamento_fisico.sql` (rascunho): permissão, tipo de evento, catálogo (3 tabelas), fechamentos (2 tabelas append-only + triggers), 7 views, RPC `escala_fechamento_registrar`, flag `escala_fechamento_fisico_modo` (+ função de leitura), RLS/grants. **Aditiva, idempotente e atômica; modo `desligado` não altera nada.**
* Seeds (a fazer na fase A, **não** neste rascunho): linhas de `escala_buffers_fisicos`/`escala_buffer_pares`/`escala_buffer_maquinas` do Conector 3/4 (ids reais de PROD já levantados) e o backfill das contagens legadas.
* Antes de ir para `supabase/migrations/`: reexecutar contra um clone de PROD (hoje validado só com stubs) e revisar o CHECK de permissões/eventos contra o estado real do dia.

---

## 10. Rollback

* **Por fase**: A–B sem flag ligada: `ROLLBACK.sql` (arquiva e remove; nada dependia). C: remover rota/tela por flag de feature. D (sombra): `modo='desligado'` (o motor nunca leu). E (ativo):
  1. `escala_fechamento_fisico_modo='"desligado"'`;
  2. **exportar as contagens vigentes para a chave legada** (bloco comentado no rollback; sem isso o motor "esquece" o físico);
  3. recálculo oficial (o plano volta a ser função do legado);
  4. arquivar e remover (script atômico).
* **Plano**: continua valendo o procedimento de hoje (restaurar as linhas da versão anterior de `escala_plano_versoes`; backup durável fora de `/private/tmp`).
* **Dados**: nada é apagado antes de arquivado; eventos `fechamento_fisico` pendentes viram `ignorado`; o tipo permanece permitido (não reescreve histórico).
* **Código**: reverter o commit do adaptador; com a flag desligada ele lê só a chave jsonb.

---

## 11. Impacto nas telas atuais

| Tela / código | Mudança |
|---|---|
| `ProducaoRealPainelPage` (`/producao-real`) | Botão **FECHAR Mx**, faixa de estado, pendências; permissão `escala_fechamento`. |
| `ApontamentoModal`, `SemProducaoModal` | Passam a abrir também a partir da lista de pendências do fechamento; **após o fechamento**, lançamento naquele período vira *correção* (nova revisão), via `modoRetroativo`. |
| `ParadasManuaisEditor` / paradas | Entram no snapshot do fechamento. |
| `PeriodoSeletorModal` | Mostra o estado do fechamento por período. |
| `ApontamentosRealizadosPage` | Coluna de fechamento (quem, quando, revisão), diferenças, botão corrigir. |
| `EscalaProducaoPage` e TV (`/escala-producao`, `/tv`) | Chips PROVISÓRIO/RECALCULANDO/CONFIRMADO nos períodos futuros. |
| Indicadores | Nova página **Qualidade do WIP** (viés/desvio por período, produto, operação, máquina, dia). |
| `lib/escala/disparar.ts` (`agendarFechamentoEscala`) | Timers de 10/20 min viram *fallback*; o fechamento físico dispara o processamento direto. |
| `fechamento.ts` / cron `escala-pos-periodo-*` | Mantidos como rede de segurança. |
| `Previsão › Estoque intermediário` (`EstoqueIntermediario.tsx`), `api/escala/wip` | Fase F: substituídos/unificados. |
| Relatório PDF semanal | Opcional: seção "erro de WIP da semana". |
| Permissões (`lib/permissoes.ts`, CHECK de `usuario_permissoes`) | Nova `escala_fechamento`. |

---

## 12. Decisões que ainda dependem do usuário
1. **Válvula "Fechar sem contagem"** (§3.7): aceitar, com perfil superior + motivo, ou nenhuma?
2. **Quem fecha**: perfil novo `escala_fechamento` para a pessoa do tablet (e substitutos).
3. **Limites**: Δ que exige motivo (proposto max(500, 15%)) e confirmação em dois passos (50%).
4. **Fase D em PROD (sombra por 1 semana)** antes de ativar: sim/não.
5. **Sequência com o Produto Único**: A–B antes de 09/11; C–E depois?
6. **Aposentadoria** (Fase F): pós-zero/λ/B/C e `wip_*`.

## 13. Riscos remanescentes
1. **Períodos contíguos**: fechar M2 não muda M3 (já em execução); só o fechamento na virada protege o seguinte. Mitigação: botão 5 min antes e alerta de inviabilidade.
2. **Fadiga/burocracia** (6×/dia): mitigada por 3 números + 1 toque; vigiar adesão; se cair, volta para âncoras + gatilhos (o desenho suporta).
3. **Digitar para passar** (valor ≈ estimado sem contar): campo vazio, motivo, métrica de "diferença zero repetida" e auditoria.
4. **Contagem durante a produção** (número já velho): `contado_em` real + regra de lançado-depois (existe).
5. **Churn**: fechamentos podem trazer mudança grande de plano quando a realidade diverge (replay: +52/−50 postos às 12:06 por causa do M3 real). O gate θ não segura isso, nem deve.
6. **Histerese do vigente**: o mesmo estado físico produz planos diferentes conforme o plano vigente (§6.2). Independente do fechamento; é o tema do desempate pausado.
7. **Custo do estimado no instante** (spike pendente) e **latência do recálculo** (≈1 min hoje): impactam o "CONFIRMADO em segundos".
8. **Acoplamento ao legado Conv/Auto**: só o total físico é verdade; some com o Produto Único.
9. **Migration validada com stubs**: precisa de ensaio contra clone de PROD antes de entrar em `supabase/migrations/`.

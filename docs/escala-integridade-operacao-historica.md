# Integridade da operação histórica (apontamentos × `etapa_id`)

Levantamento SOMENTE LEITURA em PROD (29/10/2026). Nenhum dado, migration ou RPC foi alterado. Código novo (puro, não ligado ao motor):
`src/features/escala/integridadeOperacao.ts` (+ 8 testes) e `scripts/escala-produtividade/integridade.ts`.
Este documento não usa a execução de 28/10 à tarde em diante como evidência de aderência ao plano — só a integridade do dado gravado.

## 1. Quantificação

### 1.1 Causa
`roteiro_etapas` é editado **no lugar, pelo id** (`atualizar_produto_com_roteiro`: `UPDATE … SET operacao_id, ordem, metas WHERE id`). O `etapa_id` é portanto um *slot* cujo significado muda. Em **21/10/2026 17:20:47Z (14:20 SP)** as duas etapas da Caixa Amarela 4x2 trocaram de operação mantendo o id (`updated_at` idêntico nas duas, uma única edição):

| etapa_id | antes de 21/10 14:20 | depois |
|---|---|---|
| `c765eb93…` (ordem 0) | Montar Presilha | Etiquetar |
| `f75cc037…` (ordem 1) | Etiquetar | Montar Presilha |

É a **única** troca de operação em todo o roteiro (os demais produtos foram editados em 13–22/10 só em metas/máquinas/ordem de máquinas; nenhuma outra etapa muda de operação; nenhum outro apontamento tem máquina fora da elegibilidade atual). Corte exato: o último apontamento no mapeamento antigo foi lançado 17:19:58Z; o primeiro no novo, 18:37:57Z; **nenhum apontamento, retroativo ou editado depois do corte, carrega mapeamento misto** (0 linhas com `data < 21/10` criadas/editadas depois do corte).

### 1.2 Tamanho (apontamentos `produzindo`, 08/09–28/10)
**693 de 2 789 (24,8%)**, todos Caixa Amarela (693 de 838 = 82,7% das linhas desse produto), **669 420 peças**, todas com `operacao_id ≠ operação atual do etapa_id`:

| semana | apont. | Caixa Amarela | incoerentes | % total | % Caixa | peças |
|---|---:|---:|---:|---:|---:|---:|
| 07/09 | 254 | 51 | 51 | 20% | 100% | 43 858 |
| 14/09 | 349 | 83 | 83 | 24% | 100% | 79 677 |
| 21/09 | 406 | 117 | 117 | 29% | 100% | 109 597 |
| 28/09 | 446 | 140 | 140 | 31% | 100% | 139 033 |
| 05/10 | 396 | 132 | 132 | 33% | 100% | 131 777 |
| 12/10 | 314 | 99 | 99 | 32% | 100% | 99 987 |
| **19/10** | 401 | 139 | **71** | 18% | 51% | 65 491 |
| 26/10 | 223 | 68 | 0 | 0% | 0% | 0 |

Por etapa: `c765eb` carrega 554 linhas de Montar Presilha (Montagem 18/18B/19/19B) e `f75cc0` 139 de Etiquetar (Etiquetadora 16); depois do corte 31+114 linhas coerentes. Semana 19/10 é mista: seg 19, ter 20 e 21/10 até 14:20 no mapeamento antigo. Outras tabelas com `etapa_id`: alocações da Escala — 49 de 721 (20/10: 24, 21/10: 25; a persistência de alocações começa em 20/10); `ocorrencias_maquina` 0 de 11; `wip_controle`/`wip_saldo_semanal` vazias; `previsao_item_adicional_etapa` 2 linhas (sem Caixa); **`previsao_item_maquinas` das 7 semanas 31/08–12/10**: Montagem 18/19(/B) estão na etapa hoje chamada Etiquetar e a Etiquetadora 16 na hoje chamada Montar Presilha (as de 19/10 e 26/10 foram corrigidas em 21/10 — `docs/correcao-previsao-roteiro-2026-10-21.md`). A Previsão não tem timestamp por linha: a regra “semana ≤ 12/10 = mapeamento antigo, 19/10 em diante = novo” é a única possível e foi validada (0 incompatibilidades máquina×operação, exceto a equivalência já declarada Parafusadeira Pino 2 / Plug).

### 1.3 O `operacao_id` gravado é snapshot correto ou erro?
**Snapshot correto.** A RPC de lançamento/edição/conversão resolve `etapa_id` e `operacao_id` juntos a partir de `roteiro_etapa_maquinas` (máquina → única etapa elegível do produto) **no instante do lançamento**; a meta (`meta_periodo_vigente`) é a dessa etapa naquele instante. Provas: (a) 100% dos 2 789 apontamentos têm `operacao_id` igual à operação cadastrada da máquina (únicas divergências: 97 linhas do Plug na Parafusadeira Pino 2, cadastro “Parafusar (Pino)” — equivalência já tratada pelo mapa de equivalências do revezamento); (b) com o mapa temporal da §1.1 (4 linhas de equivalência) **0 de 2 817 apontamentos e 0 de 721 alocações** ficam incoerentes. O que ficou desatualizado é o **`etapa_id`** (aponta o slot, não a operação).

## 2. Consumidores: o que usa qual campo

Classificação: **seguro** = usa a operação gravada (ou desenho imune); **afetado** = lê o `etapa_id` e erra só no histórico (≤ 21/10); **quebrado** = resultado sem sentido se relido hoje.

| consumidor | campo | classe | detalhe / exemplo real |
|---|---|---|---|
| Revezamento por bloco (`exposicaoBloco.ts`, `rotacao.ts`, `producaoReal.exposicoesDoPeriodo`, `historicoConsolidado`) | `operacaoId` do apontamento/alocação (“a identidade é a OPERAÇÃO”) | **seguro** | 21/10 t1: Montagem 18 gravada `c765eb`+Montar Presilha → exposição = Montar Presilha (correta). Nenhum bloqueio/liberação indevido pelo histórico. Ressalva: `operacoesDaMaquina(pools, …)` (pessoa em `sem_producao` sem vínculo) usa a operação do pool atual — hoje consistente; semanas ≤ 12/10 reconstruídas teriam as máquinas na operação errada. |
| Relatórios/PDF de revezamento (`escala-relatorio/conteudo.ts`) | `operacao_id` gravada (“nunca o roteiro atual”) | **seguro** | |
| Equidade (histórico consolidado de alocações) | `operacao_id` da alocação | **seguro** | as 49 alocações de 20–21/10 têm `etapa_id` antigo mas operação correta. |
| Desvios / funcionários / paradas / insights (`producao-real/*`) | `operacaoId` do apontamento | **seguro** | |
| Apontado Real (`obter_apontado_real_previsao_por_semana` + `apontadoReal.ts`) | agrupa por etapa+operação gravada e só conta se **coerente com o roteiro atual** | **seguro por desenho, com perda declarada** | as 693 linhas viram `ambiguoPecas` (não contadas, reportadas): Caixa Amarela de 07/09–19/10 conta 0 peça no Apontado Real e mostra o ambíguo. É subcontagem explícita, não erro. |
| Produção Real por pool do motor (`boasPorPool`/`restantePorPool`, chave `produto\|etapa_id`) | `etapaId` | **afetado (19/10 e anteriores); seguro em 26/10** | semana 19/10: o pool *Etiquetar* (`c765eb`) é creditado com 36 530 peças de **Montar Presilha** e o pool *Montar Presilha* (`f75cc0`) com 28 961 de **Etiquetar** → restante, falta e “quem fecha o acabado” errados. A Escala Inteligente/restrito só opera a semana 26/10 (0 incoerências: ex. 28/10 Etiquetadora 16 m1 = `c765eb`/Etiquetar; Montagem 18 = `f75cc0`/Montar Presilha). |
| `f` de desempenho (`desempenho.ts`, `fatores.ts`) | pool `produto\|etapa_id`, só semana corrente | **afetado só na semana 19/10** (efeito pequeno) | f misto 0,982 vs correto 0,977 (Etiquetar) e 0,960 vs 0,969 (Presilha) ao fim de 19/10: os dois estágios rendem ~96–98%; o erro grande é no restante, não no f. |
| WIP/estimativas entre etapas (`estado.ts` pares k→k+1; `wipSaldo.ts` por `etapaOrigemId`) | `etapa_id` | **afetado (19/10), latente** | WIP = B_k − B_{k+1} com boas misturadas; direção do par também mudou (antes Presilha→Etiquetar, hoje Etiquetar→Presilha). Controles/saldos de WIP estão vazios; um `wip_controle` que atravesse uma troca quebra. |
| Indicadores de Produção (RPCs `is_ultima_etapa`) e `useIndicadoresJanelaHistorica` | `etapa_id` → `roteiro_etapas.ordem` atual | **afetado** | “produção acabada” da Caixa Amarela antes de 21/10 = saída da **Etiquetadora 16** (slot `f75cc0`, ordem 1); depois = saída das **Montagens**. Semana 12/10: 49 597 (Etiquetar) vs 50 390 (Presilha); quebra de série em 21/10. Agrupamentos por operação (`agruparPorOperacao`) estão seguros. |
| Previsão histórica (`previsao_item_maquinas` 31/08–12/10) e qualquer releitura/replay dessas semanas (`scripts/escala-fluxo-replay`, fixtures com `c765eb`/`f75cc0`) | `etapa_id` do slot | **quebrado** para Caixa Amarela | a defesa `selecao_maquina_invalida` de `montarEntradaEscala` descarta as máquinas (fail-safe: etapa sem posto) — não corrige. Qualquer replay/“evidência de qualidade” que inclua a Caixa Amarela antes de 19/10 é inválido. |
| Edição/conversão de apontamento (`editar_apontamento…`, conversão sem_producao→produzindo) | **re-resolve** etapa/operação pelo roteiro de HOJE | **risco latente** | 27 conversões sem_producao→produzindo e 5 trocas de produto (21/09–27/10) já re-resolveram etapa/operação (nenhuma em linha pré-corte após 21/10). Se alguém converter hoje um `sem_producao` de 15/10 da Caixa Amarela, a linha nasce com o mapeamento novo numa data do mapeamento antigo. |
| Estimador de produtividade (`produtividade.ts`) | por padrão `etapaId`; `opcoes.operacaoId` casa por operação | **seguro com `operacaoId`** (afetado sem) | |
| Metas históricas | `meta_periodo_vigente` (snapshot) vs `pool.metas` atual | **afetado (outra classe)** | roteiro também não é versionado em metas: Pino mudou 5 vezes (1 600→2 500), Conector 3/4" Embalar 3 800→5 000. Quem usa a meta atual para semanas passadas erra a razão real/meta; o snapshot do apontamento está correto. |

## 3. Proposta (nada executado; tudo aditivo e reversível)

### 3.1 Princípio
Identidade histórica = **(produto, operação)**; `etapa_id` é só o slot atual. O dado gravado é a fonte de verdade e **não é reescrito**. Cria-se uma camada derivada com auditoria.

### 3.2 Camada derivada (visão), sem alterar linhas
```sql
-- NÃO EXECUTADO. Etapa canônica = etapa ATUAL do mesmo produto com a mesma operação (única); senão NULL + motivo.
create view public.apontamentos_producao_canonicos as
select ap.*,
       ap.operacao_id                                   as operacao_id_canonica,   -- snapshot, autoridade
       eq.id                                            as etapa_id_canonica,
       eq.ordem                                         as ordem_canonica,
       case when ap.etapa_id is null            then 'sem_dados'
            when ap.etapa_id = eq.id             then 'coerente'
            when eq.id is not null               then 'etapa_trocou_de_operacao'
            else 'sem_etapa_equivalente_ou_ambigua' end as integridade
from public.apontamentos_producao ap
left join lateral (select e.id, e.ordem from public.roteiro_etapas e
                   where e.produto_id = ap.produto_id and e.operacao_id = ap.operacao_id
                   having count(*) = 1) eq on true;
```
Idem para `escala_producao_alocacoes` e (com a regra de vigência da §3.3) `previsao_item_maquinas`. Equivalente em TS, já implementado e testado: `etapaCanonica` / `canonizarApontamentos` (reproduz exatamente 693 reclassificações, 0 ambíguas, por semana como na tabela da §1.2, idempotente).

### 3.3 Vigência explícita do roteiro (tabela de equivalência temporal)
`roteiro_etapas_historico(etapa_id, produto_id, operacao_id, ordem, metas jsonb, vigente_de, vigente_ate, motivo)`, alimentada por **trigger AFTER UPDATE/DELETE em `roteiro_etapas`** que fecha a linha anterior (OLD) e abre a nova. Semente para o passado (derivada da evidência, verificável por SELECT):
`c765eb`: [-∞, 2026-10-21 17:20:47.689033Z) Montar Presilha; [corte, ∞) Etiquetar — `f75cc0`: o inverso — demais etapas: uma linha aberta com a operação atual. Com essa tabela: apontamento/alocação → operação da vigência no `criado_em`; Previsão → operação da vigência no instante em que foi **salva** (exige §3.5-2) — hoje, só pela regra “semana ≤ 12/10 antigo”. Bônus: histórico de metas (resolve a classe “metas” da §2).

### 3.4 Log de auditoria + backfill idempotente e reversível
`apontamento_integridade_log(apontamento_id, regra_versao, etapa_id_gravada, operacao_id_gravada, etapa_id_canonica, motivo, detectado_em)` com `unique (apontamento_id, regra_versao)`. Backfill = `insert … select from apontamentos_producao_canonicos where integridade <> 'coerente' on conflict do nothing` (693 linhas hoje). Reversão = `delete … where regra_versao = 'v1'` / `drop view`. Como as linhas de `apontamentos_producao` não são tocadas, não há o que desfazer nelas. **Materializar** uma coluna `etapa_id_canonica` só se medido que a view é lenta; nesse caso por trigger, guardando o valor anterior no log. Dry-run: o script `scripts/escala-produtividade/integridade.ts` já imprime o resumo por semana sem escrever nada.

### 3.5 Como proteger futuras reordenações
1. **Não reutilizar o id quando a operação muda** em `atualizar_produto_com_roteiro`: `operacao_id` diferente para o mesmo `id` ⇒ criar etapa nova e **arquivar** a antiga (`arquivada_em`, nunca apagar) — apontamentos, alocações e Previsões antigas continuam apontando para uma etapa cujo significado nunca muda (proposta já registrada em `docs/correcao-previsao-roteiro-2026-10-21.md`; leitores a ajustar: `useProdutos`, `supabaseIO`, `wipIO`, `dataFetchers`, indicadores, `useProdutosElegiveisPorMaquina`). Reordenar só `ordem` mantém o id, mas então o consumidor precisa de `ordem` vigente (item 3).
2. **Previsão com contexto**: gravar `operacao_id` e `ordem` em `previsao_item_maquinas` (ou `roteiro_versao`/hash no item), e o hash na versão do plano — a Previsão deixa de depender de “quando foi salva”.
3. **Snapshot no apontamento**: `etapa_ordem_vigente` e `ultima_ordem_vigente` (ou `is_ultima_etapa_vigente`) gravados no lançamento, como a meta e o custo já são; Indicadores/Apontado Real passam a decidir “última etapa” pelo snapshot, não pelo roteiro de hoje (elimina a quebra de série de 21/10 para frente).
4. **RPCs de edição/conversão**: reaproveitar `etapa_id/operacao_id` da linha quando produto e máquina não mudam (hoje re-resolvem pelo roteiro atual) e recusar (ou marcar) re-resolução de data anterior à última edição de roteiro.
5. **Guarda contínua** (SELECT, no mesmo agendador/relatório de integridade): `count(*)` de apontamentos/alocações com `operacao_id ≠ operação da vigência` deve ser 0 para datas ≥ última edição; alerta se crescer. Baseline hoje: 693 (todos < 21/10 14:20).
6. **Aviso no editor de roteiro** (já proposto): ao trocar a operação de uma etapa com apontamentos/Previsões, listar o impacto e exigir confirmação.

### 3.6 Consumidores a migrar (ordem sugerida, sem mexer no núcleo do fluxo agora)
(1) `desempenho`/`fatores`/`producaoReal.boasPorPool`: aplicar `canonizarApontamentos` ao entrar na visão (um único ponto: `visivelNoCorte`/loader) — só muda semanas ≤ 19/10; semana 26/10 permanece idêntica (0 incoerências ⇒ no-op, testável por golden). (2) Indicadores/Apontado Real: usar `etapa_id_canonica`/snapshot de ordem. (3) Replays: canonizar apontamentos **e** Previsões históricas antes de montar a entrada. (4) Estimador: sempre passar `operacaoId`.

## 4. Riscos
* **Interpretação**: a troca de 21/10 foi uma correção da ordem física (Etiquetar → Montar Presilha) ou um erro? O dado gravado reflete o que cada máquina fez, então a canonização por operação vale nos dois casos; mas a “última etapa” histórica (acabado) muda de Etiquetar para Montar Presilha — confirmar com o usuário qual série deve valer para o passado.
* **Ambiguidade futura**: produto com a mesma operação repetida em duas etapas (hoje nenhum) torna a canonização ambígua — o código devolve `ambigua` e não escolhe.
* **Previsão sem timestamp**: a regra por semana é correta hoje (validada) mas é frágil; fechar com §3.5-2.
* **Equivalências de cadastro** (Parafusar ≡ Parafusar (Pino); máquina cadastrada com operação ≠ etapa) permanecem tratadas à parte (mapa de equivalências do revezamento); a canonização por operação gravada não as resolve.
* **Performance** da view lateral (2,8 mil linhas hoje; trivial) — monitorar antes de materializar.
* **Trigger de histórico de roteiro** só cobre edições futuras; o passado depende da semente derivada (verificada por SELECT, 0 incoerências).

## 5. Reprodução (SELECT / código)
* Totais e divergências: `apontamentos_producao ap join roteiro_etapas re on re.id = ap.etapa_id where ap.operacao_id is distinct from re.operacao_id`.
* Máquina × operação: `ap.operacao_id is distinct from maquinas.operacao_id`.
* Mapa temporal: `with eq(etapa_id, op_nome, vig_de, vig_ate) as (values …)` da §3.3 — 0 incoerentes em apontamentos (2 817) e alocações (721).
* Código: `npx tsx --tsconfig <ts> scripts/escala-produtividade/integridade.ts <ap.json> <roteiro.json>` e testes `integridadeOperacao.test.ts`.

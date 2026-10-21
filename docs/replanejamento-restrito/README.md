# Replanejamento dinâmico RESTRITO (`ativo_restrito`)

Status: migration `20261027100000_replanejamento_restrito.sql` aplicada em DEV (modo default `desligado`, semanas `[]`, hash da Escala idêntico antes/depois) e `t14_replanejamento_restrito.sql` passou. PROD só entra em `sombra` (ver §13).

## 1. O que muda, em uma frase
Depois de cada período fechado, a sombra continua calculando e gravando a decisão (snapshot); **só** quando o modo é `ativo_restrito` **e** a semana está em
`replanejamento_semanas_ativas`, o servidor também grava na Escala oficial **apenas os períodos alteráveis (c+2 em diante)** — o comprometido (c+1) só entra no reparo mínimo já existente.

## 2. Desenho mínimo (fluxo por corte)
```
período c fecha (10 min / 90 % / 3 min de silêncio, ou 20 min)
 (A) decisão no CORTE → executarCorteSombra (restante real por produto/etapa, ritmo f, capacidade futura, gargalo dinâmico, proposta, ociosidade)
 (B) snapshot append-only, revisão 0, modo sombra          ← sempre, mesmo no modo restrito ("o motor sugeriu X")
 (C) se ativo_restrito + semana autorizada + proposta ≠ vazia:
        relê o estado (Escala, ausências, indisponibilidades, Previsão, WIP do INSTANTE), recalcula → snapshot revisão ≥ 1 (modo ativo_restrito)
        valida a proposta → grava SÓ a região autorizada via RPC atômica (versão base de cada dia)
 (D) auditoria append-only: versões e hash antes/depois, linhas antes/depois, mudanças, resumo ("motor sugeriu X e aplicou X")
```
Eventos que reavaliam (ausência, indisponibilidade, edição relevante da Previsão, qualquer recálculo oficial que mude o futuro): depois de cada passada do worker,
`escala_replanejamento_pendentes` compara o hash da região do último registro com o hash de agora; se mudou, o período mais recente é reavaliado (nova revisão, motivo `reavaliacao`).
Não espera quinta-feira: o futuro é uma previsão viva, revista a cada período fechado e a cada evento.

## 3. Arquivos
| Camada | Arquivo | Papel |
|---|---|---|
| Parâmetros | `features/escala/parametros.ts` | `desligado \| sombra \| ativo_restrito \| ativo`; `replanejamento_semanas_ativas`; `replanejamentoPodeEscrever` |
| Núcleo | `features/escala/gargaloDinamico.ts` | meta × produtividade real × f × capacidade futura original/ajustada; pressão por recurso; gargalo dinâmico; evolução entre cortes |
| Núcleo | `features/escala/tetosWip.ts` | WIP flexível: o teto fixo em peças vira o **limite de estoque** (teto = limite, não meta) |
| Núcleo | `features/escala/replanejamentoRestrito.ts` | proposta, validação (regras da §4), diff/auditoria, controle de oscilação, diagnóstico exato de ociosidade |
| Núcleo | `features/escala/sombraCorte.ts` | flag `restrito`; prova causal "mesmo corte SEM WIP"; trocas manuais como preferência; `dinamica` na decisão |
| Núcleo | `features/escala/simulacaoRestrita.ts` | simulação período a período (testes e semana real) |
| Serviço | `lib/escala/sombraServico.ts` | `avaliarEAplicar` (A–D, 3 tentativas, conflito ⇒ relê e recalcula), reavaliação por evento |
| Adaptador | `lib/escala/sombraSupabase.ts` | RPCs `escala_replanejamento_aplicar/registrar/pendentes`, `proximaRevisao` |
| Banco | `migrations/20261027100000_replanejamento_restrito.sql` | modos, semanas, revisões da decisão, auditoria `escala_replanejamentos`, RPCs, reversão |
| Testes | `__tests__/replanejamentoRestrito.test.ts`, `lib/escala/__tests__/replanejamentoRestritoServico.test.ts`, `supabase/tests/.../t14_*.sql` | ver §8 |

## 4. Regras que a proposta obedece (`validarProposta` recusa se violar qualquer uma)
1. Nada de período ≤ c; o comprometido (c+1) só com reparo mínimo; nada antes do alterável.
2. **Revezamento duro absoluto**: 0 repetições de `operacao_id` consecutiva (M3→T1 conta, dia novo zera), 0 exceções — checado sobre executado + efetivo.
3. Sem pessoa/máquina duplicada no período; sem ausente; sem máquina indisponível; **sem máquina fora da Previsão**.
4. **WIP nunca acima do limite de estoque** (se o executado já passou do limite, a proposta só não pode acrescentar).
5. **Previsto não perde para WIP** — prova causal: o mesmo replanejamento sem nenhum adicional não pode ter previsto melhor que o com WIP (total e por etapa).
6. **Previsto não piora** em relação à Escala oficial vigente (ruído = 0,1 % do restante do acabado).
7. **Controle de oscilação**: só grava se há ganho (previsto melhor, WIP líquido ≥ 2 % ou ≥ 100 pç, ocioso preenchido, ou reparo obrigatório). Rearranjo sem ganho = `sem_mudanca`.
Ordem de prioridade (motor): previsto atual → recuperação de atraso → acabado adicional → WIP. WIP é carga **flexível**: o programado (31.510 pç em 26/10) é carga inicial, não protegida.
Trocas manuais futuras entram como preferência suave (como na Escala oficial); as que o motor não consegue manter ficam registradas (`trocasManuais.perdidas`).

### Travas adicionais (aprovação de 21/10)
- **WIP não é objetivo.** Sequência: (1) há pessoa-período futuro sem trabalho de prioridade maior? (2) há WIP válido? (3) limite? (4) estoque confirmado/reservado? (5) revezamento? só então preenche. Prova no código: o mesmo replanejamento SEM WIP gera as pessoas ociosas; **em nenhum período a proposta pode ter mais postos de WIP do que pessoas ociosas sem ele** (`WIP sem ociosidade` = recusa). Ninguém com trabalho produtivo válido é trocado por WIP. O limite é só teto de segurança; o motor ocupa apenas a capacidade ociosa válida, nunca “enche o limite”.
- **Medição de WIP em cada proposta** (`diagnostico.restrito.proposta.wip`, e `mudancas.wip` na auditoria): antes, depois, aumento/redução, postos e pessoa-horas de WIP, **postos e pessoa-horas ACRESCIDOS**, ociosos evitados, motivo de cada aumento por período, classificação (`ocupa_ociosidade | sem_ociosidade | reducao | neutro`).
- **Previsto que piora**: só se aplica se não piorar a falta projetada **ou** se corrige inviabilidade física/ergonômica obrigatória (reparo do comprometido). WIP nunca justifica piorar o previsto.
- **Estabilidade como desempate** (`estabilidade.ts`): os postos escolhidos pelo motor são re-atribuídos às pessoas por atribuição de custo mínimo mantendo a alocação vigente, respeitando revezamento duro e trocas manuais. O resultado produtivo não muda; só quem ocupa. Sem solução estável ⇒ usa a proposta original. Não sacrifica recuperação.
- **Churn medido** por proposta: linhas alteradas = produtivas + trocas equivalentes, linhas poupadas pela estabilidade; e, na auditoria, linhas revertidas no corte seguinte (`acompanhamento.sql` §7–9).
- **Recálculo estático × dinâmico** (dívida técnica aceita nesta semana): `acompanhamento.sql` §10 registra quantas vezes ocorreu, tempo até a correção, linhas regravadas pelo estático e linhas que o dinâmico mudou de novo (`gatilho = 'reavaliacao'`).
- **Worker atrasado**: região que já começou nunca é gravada; as decisões são processadas em ordem e cada evento relê o estado do momento (recalcula a partir do horizonte disponível).

## 5. Concorrência, idempotência, reversão
- **Portão no banco**: a RPC recusa (`ESCALA_REPLAN_NAO_AUTORIZADO`) se o modo não for `ativo_restrito` ou a semana não estiver autorizada. `ativo` (completo) continua sem efeito.
- **Concorrência otimista**: a gravação leva a versão de cada dia lida junto com a decisão; `escala_aplicar_recalculo` (mesmo lock advisory `escala:<previsão>`) confere versão por dia — se Clarice/ausência/Previsão/troca manual mexeu no meio, **nada é gravado**, o serviço descarta, relê, recalcula e tenta de novo (até 3×). Decisão humana mais recente nunca é sobrescrita.
- **Idempotência**: índice único `(decisao_id)` para `aplicado`; revisão única por `(previsão, data, período, revisão)`; evento reprocessado não reaplica.
- **Auditoria** (`escala_replanejamentos`, append-only, trigger de imutabilidade): corte, versões antes/depois, hash antes/depois, linhas antes/depois, diff, resumo, erro.
- **Reversão** (`escala_replanejamento_reverter`): devolve exatamente as linhas do corte **somente se** a Escala ainda é a que a aplicação deixou (hash); se alguém mexeu depois, recusa (`REVERSAO_CONFLITO`). Reversão registrada; segunda reversão recusada.

## 6. Gargalo dinâmico e capacidade (por corte, no snapshot `diagnostico.restrito.dinamica`)
Por etapa: meta original, produtividade observada (Σ boas/Σ meta), n, f, restante, capacidade futura original e ajustada. Por conjunto de máquinas compartilhadas: pressão original × ajustada
(`necessário ÷ disponível`), situação `saturado | sob_pressao | sem_gargalo`, e evolução entre cortes (`persistiu | diminuiu | aumentou | mudou | desapareceu | surgiu`).
Meta 100 pç/h × real 120 ⇒ com 6 amostras f = 1,10 (capacidade 110): acima da meta, abaixo do observado, e não presa em 100. A regra de f (n<3 ⇒ 1; clamp 0,30–1,30; peso n/(n+6)) **não mudou**.

## 7. Ociosidade futura com causa exata
Cada pessoa-período ocioso no futuro recebe uma causa: `sem_trabalho_valido | revezamento_duro | maquina_indisponivel | limite_wip | material | nenhuma_maquina_compativel | outro`.
Semana 26/10 hoje: os dois ociosos (29/10 T2 e 30/10 M2) = **`revezamento_duro`** (único posto livre repetiria a operação do período anterior). São recalculados a cada período/evento e podem receber outro trabalho válido.

## 8. Testes
- Suite completa: **717 passam / 0 falham** (eram 683); `tsc` limpo no que foi tocado (erros pré-existentes: `LayoutProps` em `layout.tsx`, 2 `react-hooks` em `EscalaProducaoPage`/`EscalaTvPage`).
- Núcleo (20): meta 100×120; tetos dinâmicos; **gargalo some** (Embalar >100 %) e **gargalo muda** (operação segura abaixo da meta); invariantes em 6 cenários (passado/comprometido intactos, rotação 0, nada fora da Previsão); 5 comportamentos; ociosidade.
- Serviço (8): portão (sombra / semana não autorizada / `ativo`), A→D com revisões 0 e 1, **concorrência (nada sobrescrito, relê e recalcula)**, idempotência, reavaliação por evento.
- SQL `t14` (DEV, em `BEGIN…ROLLBACK`): portão, aplicação atômica só do alterável, versão velha ⇒ nada gravado, mesma decisão 2× recusada, auditoria, reversão (restaura hash; recusa se alterado depois), revisões, pendentes, grants, imutabilidade.

## 9. Simulação da semana 26/10, período a período (estado real de PROD, só leitura; nada gravado)
Arquivos completos: `simulacao_2610_real.txt`, `simulacao_2610_carga_viavel.txt` (28 cortes por cenário, com gargalo, WIP, ociosos). “Estático” = mesma produção, Escala oficial sem replanejar.
Falta final do acabado (previsto − boas), em pç:

| Cenário | Real 26/10 (dinâmico × estático) | Carga viável* (dinâmico × estático) |
|---|---|---|
| Referência / 1) realizado = planejado | 95.205 × 95.205 · WIP 31.510 mantido · 0 cortes aplicados | 6.970 × 6.970 · 1 corte aplicado (WIP 31.510 → 157.580 ocupa 185→89 ociosos) e depois estável |
| 2) Embalar +18 % | **80.702 × 87.203** (−6.501) | 0 × 0; **gargalo `sob_pressao` → `sem_gargalo` (desapareceu) em 26/10 T1**, falta projetada 1.653 → 0 |
| 3) Embalar −20 % | 104.089 × 104.089 (todas as propostas pioravam o previsto ⇒ recusadas) | 19.402 × 19.527 |
| 4) outra operação (Etiquetar −30 %) | 115.035 × 115.035 (sem ganho) | **6.971 × 18.602** (−11.631); **gargalo migra Embalagem 17 → Etiquetadora 15 em 28/10 T3**; WIP retirado ao longo da semana |
| 5) produção geral +12 % | **72.388 × 77.081** (−4.693); WIP 31.510 → 63.584; ociosos 2 → 15 | 0 × 1.990 |
Em todos: **0 repetições de operação, 0 exceções, 0 violações físicas**; dinâmico nunca pior que o estático (propostas piores são recusadas). A coluna “violações” dos arquivos de saída conta só as recusas por *previsto piora* (137 propostas que NÃO foram gravadas); nenhuma outra regra foi violada.
\* mesma semana/máquinas/pessoas/WIP flexível, previsto × 0,55 (a semana real é “impossível na origem”: Embalagem 17 com pressão 1,70).

**Leitura honesta:** a semana real é dominada por uma máquina única (Embalagem 17, 3 produtos) saturada; WIP não compete com ela (uma máquina = um operador), então remover WIP **não** libera previsto ali.
O ganho real vem do reajuste entre produtos que disputam a Embalagem e do uso da capacidade liberada. Com carga viável aparece o comportamento completo (gargalo some/migra, WIP sobe/desce).

## 10. Riscos e limites conhecidos
1. **Oscilação**: o gerador é guloso; entradas quase iguais podem dar planos diferentes. Mitigado por (a) recusar o que piora, (b) não gravar sem ganho. Ainda há semanas com dezenas de linhas futuras alteradas por corte (só c+2 em diante). Os limiares são constantes nomeadas (`FRACAO_RUIDO_PREVISTO`, `FRACAO_WIP_RELEVANTE`, `LIMIAR_WIP_MINIMO`).
2. **Recálculo oficial estático**: ausência/Previsão/indisponibilidade ainda disparam o recálculo oficial (sem f nem restante real) e o futuro volta ao plano estático até a próxima passada do worker (≤ 5 min via `/api/escala/drenar`), quando a reavaliação re-aplica.
3. **WIP expansivo**: com capacidade livre o WIP cresce até o limite de estoque (ex.: 31.510 → 157.580 na carga viável). É o comportamento pedido (teto, não meta), mas a Previsão deixa de ser o teto de peças — só vale para produtos que já têm WIP programado; produto novo nunca entra.
4. **Defasagem do worker**: se o worker atrasar e a região já tiver começado, a proposta é recusada (“decisão defasada”) — nunca regrava período em andamento.
5. **Classificação de ociosidade** é determinística mas inferida do plano (não do interior do motor); `outro` sinaliza posto livre com trabalho válido que o motor não usou.
6. Trocas manuais: preferência suave; as impossíveis são perdidas e registradas (mesma regra do oficial).
7. Custo: ~2 execuções do motor por corte (com e sem WIP) + 1 por tentativa de aplicação; ~1–3 s na semana real.

## 11. Para ligar (NÃO feito) e para interromper
Pré-condições: migration em PROD, deploy, `replanejamento_modo = "sombra"` por pelo menos uma decisão real (aquecimento) conferindo `diagnostico.restrito` e hash oficial inalterado; só então:
```sql
update escala_parametros set valor = '["2026-10-26"]'::jsonb where chave = 'replanejamento_semanas_ativas';
update escala_parametros set valor = '"ativo_restrito"' where chave = 'replanejamento_modo';
```
Interromper imediatamente (voltar a `"sombra"` — uma linha) se: alteração não autorizada, gatilho atrapalhando apontamento, snapshots duplicados, fila crescendo, erro recorrente do worker, impacto operacional perceptível, ou qualquer violação (rotação ≠ 0, WIP acima do limite, previsto pior que o oficial).
Desfazer uma aplicação: `select escala_replanejamento_reverter('<id da aplicação>', 'motivo')` (service_role).

## 12. Registro: Previsão alterada às 10:08
Conector 1.1/4": 12.150 → 10.200 pç. Explica a linha de base com 31 ociosos (não é erro do motor): o plano foi gerado com a Previsão anterior e a versão temporal do plano (`escala_plano_versoes`) preserva qual Previsão valia em cada instante. Com o WIP flexível programado, a base de 26/10 ficou em 2 ociosos.

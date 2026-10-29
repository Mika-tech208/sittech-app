# Revezamento por bloco (manhã/tarde) — hotfix 28/10/2026

## 1. Regra (restrição DURA)

Uma pessoa **não** executa a **mesma operação** (`operacao_id` canônico) **mais de uma vez** na mesma **manhã** (M1, M2, M3) nem na mesma **tarde** (T1, T2, T3).
Formal: `count(F, bloco, O) <= 1`. Vale para outra máquina, outro produto e outra `etapa_id` (a identidade é a OPERAÇÃO). A exposição **zera** entre manhã e tarde
(M3 Montar → T1 Montar é permitido) e no dia seguinte. Sem solução válida o posto fica **vazio** com diagnóstico (`rotacao_sem_solucao`, motivo
`Revezamento obrigatório…`); o sistema nunca viola em silêncio para preencher posto.

Substitui, **sob flag**, a regra anterior ("mesma operação em períodos consecutivos; M3→T1 conta").

## 2. Flag e parâmetros (migration `supabase/migrations/20261105200000_escala_revezamento_bloco.sql`, NÃO aplicada em PROD)

| chave (`escala_parametros`) | valores | padrão |
|---|---|---|
| `revezamento_escopo` | `"consecutivo"` \| `"bloco"` | `"consecutivo"` (comportamento atual, byte-idêntico) |
| `revezamento_equivalencias` | `{ "<operacao_id>": ["<operacao_id>", …] }` | `{}` |

* Só tem efeito com `revezamento_modo = "duro"`.
* Mudar o escopo (ou o mapa) **recalcula** o futuro: usa o gatilho genérico de `escala_parametros` (o mesmo caminho de `revezamento_modo`; não é preciso alterar o gatilho). A criação das chaves na migration NÃO dispara recálculo.
* Leitura pela tela: RPC `escala_revezamento_regras()` → `{escopo, equivalencias}`.
* **Ligar** (após migration + deploy): `update escala_parametros set valor='"bloco"', atualizado_em=now() where chave='revezamento_escopo';`
* **Reverter**: `update escala_parametros set valor='"consecutivo"', atualizado_em=now() where chave='revezamento_escopo';` (o gatilho recalcula o futuro com a regra anterior; passado e período em andamento são imutáveis). Código novo com a flag em `consecutivo` é byte-idêntico ao anterior (golden-master `fluxo/__tests__/golden.test.ts` + teste L em `revezamentoBloco.test.ts`).

## 3. Memória de exposição e evidência real

`src/features/escala/exposicaoBloco.ts` (fonte única): `MemoriaBloco` (operações já executadas por pessoa no bloco, com equivalências), `registrarPassadoDoBloco`,
`repeticoesPorBloco` (auditor independente), `exposicaoDeApontamentos`.

* Ao recalcular o 1º slot mutável **no meio do bloco** (M3 ⇒ M1+M2; T3 ⇒ T1+T2) o motor reconstrói a memória do bloco **inteiro**, nunca só o período anterior.
* Fonte da exposição de cada (pessoa, período já iniciado) — **regra vigente desde o hotfix de 29/10**: (1) a **troca manual registrada** (linha congelada com `origem='manual'`); senão (2) a **alocação congelada** da Escala. O `funcionario_id` do apontamento é quem **lançou**, não prova quem operou (medido em 29/10: em M1+M2 só 2 de 26 apontamentos conferiam com a operação congelada do lançador), portanto **não** vira exposição (`processar.ts` não preenche mais `EntradaEscala.exposicaoExecutada`). O apontamento continua valendo para produção, boas, refugo, produto, máquina, WIP e demanda restante; a restrição é só sobre a **identidade** de quem operou. `exposicaoDeApontamentos` segue exportada (replay/testes), fora do caminho de produção. Conceito futuro (NÃO implementado): `operador_real_id` informado/confirmado — só então a evidência individual poderá voltar.
* Um recálculo não apaga a memória: a memória é reconstruída a cada cálculo a partir do congelado + evidência, e o plano novo só acrescenta.

## 4. Onde a regra foi aplicada

| Camada | Arquivo | O que muda |
|---|---|---|
| Motor oficial/legado (`gerarEscala`) | `features/escala/gerarEscala.ts` | `proibidoOp(pessoa, op)`: com `revezamentoEscopo="bloco"` usa `MemoriaBloco` (limpa na virada de bloco; reconstruída do passado); senão `histOp.get(f)===op` (idêntico). Usada na viabilidade (emparelhamento), no custo (par proibido) e nas 2 camadas (previsto e adicional). |
| Fluxo ativo | `fluxo/planejar.ts` | candidatos herdam o escopo da entrada; **novo candidato "vigente com pessoas re-atribuídas"** (ver §6); diagnóstico `PLANO_VIGENTE_REATRIBUIDO_BLOCO`. |
| Estabilização de pessoas | `features/escala/estabilidade.ts` | `estabilizarPessoas(..., regras)` respeita o bloco; nova `reatribuirPessoasBloco`. |
| Verificador independente | `fluxo/restricoes.ts` | ramo `bloco` de `verificarRestricoesDuras` (congeladas + evidência + linhas novas; `somenteLinhasNovas` suportado). |
| Troca manual (TS) | `features/escala/rotacao.ts`, `EscalaProducaoPage.tsx`, `hooks/useEscalaProducao.ts` | `validarTroca(…, regras)`; mensagem própria; a tela lê `escala_revezamento_regras()`. Bloqueia a troca que **aumenta** as repetições da pessoa no bloco (repetição antiga e alheia à troca não bloqueia, como antes). |
| Troca manual (servidor) | migration `20261105200000` (`escala_trocar_alocacoes`) | mesmo critério em SQL (`escala_repeticoes_bloco`, com equivalências); escopo `consecutivo` = função idêntica à da migration 20261024100000. Teste `supabase/tests/escala_adicional_etapa/t12_revezamento_bloco.sql`. |
| Replanejamento restrito/sombra | `replanejamentoRestrito.ts`, `compromisso.ts`, `simulacaoRestrita.ts`, `snapshotSombra.ts`, `lib/escala/sombraServico.ts` | validação da proposta, operações proibidas do período comprometido (M1..período anterior) e contagem de repetições por bloco; o escopo viaja no snapshot canônico só quando `bloco` (snapshots antigos reproduzem igual). |
| Parâmetros / entrada | `parametros.ts`, `lib/escala/montarEntrada.ts` | leitura tipada das duas chaves. |
| UI | `AlertasEscala.tsx`, `ModaisEscala.tsx` | textos genéricos (consecutivo ou bloco). |

**Não alterado (limitações conhecidas)**: (i) o PDF semanal "Revezamento" (`features/escala-relatorio/conteudo.ts`) continua auditando a regra *consecutiva* (relatório versionado/hash; só DEV/Preview); (ii) `diagnosticarOciosidade` (`replanejamentoRestrito.ts`) explica ociosidade pelo período imediatamente anterior; (iii) a versão de plano (`escala_plano_entrada`) não registra o escopo (evita mudar o hash das versões); o snapshot canônico da sombra registra; (iv) com o fluxo `desligado` os apontamentos não são carregados: a memória do bloco usa só a alocação congelada.

## 5. Identidade da operação e EQUIVALÊNCIAS (auditoria)

`operacao_id` canônico é a identidade (nunca por nome). Operações em PROD: `Embalar 220902ab…` (8 etapas, todos os produtos), `Etiquetar b41b8b0e…` (7 etapas, Caixa+Conectores), `Parafusar 11c45ab6…` (Conector + Plug),
`Montar Presilha bcc3042c…` (Caixa), `Rosquear bb9da8be…`, e duas ambíguas: **`Parafusar (Pino)` `6a2e00a7…`** (Pino; id distinto de `Parafusar`) e **`Rosquear + Parafusar` `15625032…`** (Máquina 8; combina Rosquear e Parafusar).

O mapa é **opcional, vazio por padrão** e não se ativa por nome. Semântica: `{X: [Y, Z]}` = executar X **expõe também** Y e Z (executar X é proibido se {X,Y,Z} intersecta o que a pessoa já executou no bloco). Equivalência simétrica = declarar as duas direções.
Exemplos prontos (ids completos em PROD):
* Rosquear+Parafusar expõe Rosquear e Parafusar: `{"<15625032…>": ["<bb9da8be…>", "<11c45ab6…>"]}`
* Parafusar ≡ Parafusar (Pino): `{"<11c45ab6…>": ["<6a2e00a7…>"], "<6a2e00a7…>": ["<11c45ab6…>"]}`

Avaliação operacional (a decidir pelo usuário): `Rosquear + Parafusar` é literalmente a soma das duas operações numa máquina ⇒ contar como exposição de ambas é coerente com a regra. `Parafusar (Pino)` é a mesma ação de parafusar em outra máquina/produto; se o esforço é o mesmo, contar como `Parafusar` é coerente — depende de decisão ergonômica, que o sistema não presume.

Impacto medido no replay de 28/10 (plano PROD 28–30/10, região M3→sexta; repetições "novas" = 2ª execução em período ainda alterável):

| Variante | repetições novas no plano PROD | com a regra, bloco | postos vazios | falta final (peças, Σ) | linhas com pessoa trocada (churn) |
|---|---|---|---|---|---|
| sem equivalência (padrão) | 13 | 0 | 0 | 33.082 (= PROD) | 18 |
| Parafusar (Pino) ≡ Parafusar | 21 (+8) | 0 | 0 | 33.082 | 31 |
| Rosquear+Parafusar ≡ Rosquear e Parafusar | 20 (+7) | 0 | 0 | 33.082 | 24 |
| ambas | 31 (+18) | 0 | 0 | 33.082 | 57 |

Plano do zero 29–30/10 (fluxo regenerado): sem equivalência, Pino ou Rosquear+Parafusar → 0 vazios, falta 28.354 (igual ao fluxo consecutivo); **ambas** → 2 postos vazios por revezamento e falta 31.177 (+2.823).

## 6. Como o motor evita postos vazios (lookahead)

O motor decide período a período; no último período do bloco pode faltar gente elegível. Medido nos replays: o **motor regenerado** sob a regra (candidatos do fluxo, sem lookahead) resolveu 28/10 M3+ sem vazios mas com falta +738 peças e WIP final maior (2.336 × 375) e churn de 210 linhas — pois o plano vigente (PROD) deixa de ser candidato válido.
Por isso o fluxo ganhou um candidato extra, **sem mudar o objetivo**: quando o vigente só viola o revezamento por bloco, mantém **exatamente os postos** do vigente (mesma falta, mesmo WIP) e **re-atribui apenas as pessoas** (`reatribuirPessoasBloco`: atribuição de custo mínimo por período, checagem de viabilidade dos períodos seguintes do bloco e reinícios com PRNG semeado — determinístico). Se não houver solução, o candidato não existe e valem os regenerados, que deixam o posto vazio com diagnóstico quando necessário. O motor `gerarEscala` em si não ganhou lookahead (não foi necessário nos dados reais: 0 vazios).

## 7. Testes

* `src/features/escala/__tests__/revezamentoBloco.test.ts` (28): A–F, G (M1+M2 / T1+T2, evidência × congelada), H (vazio + diagnóstico), I (dia seguinte), J (troca manual TS), K (fluxo ativo; vigente re-atribuído), L (consecutivo byte-idêntico), equivalência, propriedade com 60 cenários aleatórios, estabilização.
* SQL: `supabase/tests/escala_adicional_etapa/t12_revezamento_bloco.sql` (servidor: bloqueia no bloco, M3→T1 permitido, dia seguinte livre, equivalência, repetição antiga não bloqueia, consecutivo preservado, parâmetros validados) + `t10` (regra anterior) segue passando.
* Replay A–J do fluxo com a regra nova: `FREPLAY_ESCOPO=bloco npx tsx … scripts/escala-fluxo-replay/replay.ts tudo` → `<FREPLAY_DIR>/out_bloco`; `FREPLAY_ESCOPO=bloco … relatorio.ts <arquivo>`.

## 8. Reverter

1. `revezamento_escopo` → `"consecutivo"` (SQL do §2). Recalcula o futuro com a regra anterior.
2. Código: nenhuma reversão necessária (flag em `consecutivo` = comportamento anterior). A migration é aditiva; `escala_trocar_alocacoes` com escopo consecutivo é idêntica à anterior.

## 8. Hotfix 29/10 — sem evidência do lançador (rollback e verificação)

**O que mudou**: `src/lib/escala/processar.ts` deixou de derivar `exposicaoExecutada` dos apontamentos (3 linhas de código; teste `src/lib/escala/__tests__/revezamentoSemEvidenciaLancador.test.ts`). Motor, fluxo, estabilização, replanejamento restrito e verificador (`restricoes.ts`) já tratam a evidência como opcional: sem ela usam as congeladas — consistência motor × verificador mantida.

**Rollback**:
1. Reverter o código: `git revert <sha do commit do hotfix>` (commit único; nenhuma outra mudança).
2. Rollback imediato em produção: promover de volta, na Vercel, o deployment anterior ao hotfix (o de 28/10 14:49, `sittech-m2fr5bsst` / `dpl_F1Amtwtb626oqCTdjE6bb1juuN3h`, é o atual antes da publicação).
3. Sem migration, sem flag nova, sem mudança em banco: nada a desfazer fora do deploy. (A flag `revezamento_escopo` continua sendo o interruptor do revezamento por bloco, como antes.)

**Verificação pós-publicação** (depois do fechamento de T1): em `escala_fluxo_diagnosticos` conferir o 1º recálculo após o deploy (fechamento T1 / eventos): `resultado='ok'`, sem `fallback`, 0 violações duras (`revezamento`) e `PLANO_VIGENTE_REATRIBUIDO_BLOCO` apenas quando o vigente violava; nas linhas de T2/T3 de hoje (`escala_alocacoes`, `data=hoje`) conferir, por pessoa, que a operação de T2/T3 não repete nenhuma operação **congelada** de T1/T2 (`repeticoesPorBloco`/SQL `escala_repeticoes_bloco`) e que as trocas manuais (`origem='manual'`) de T1/T2 seguem registradas e respeitadas; períodos já iniciados/fechados permanecem intactos (mesma versão/linhas antes e depois).

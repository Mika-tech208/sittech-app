# Fechamento físico atômico na troca de período — IMPLANTAÇÃO (branch `feat/fechamento-fisico`, flag DESLIGADA)

Substitui a especificação v2 onde ela falava em período PROVISÓRIO: **não existe mais período provisório**. A troca de período é UM processo atômico, com as máquinas paradas.
Nada foi aplicado em PROD (a flag segue DESLIGADA e a migration NÃO foi aplicada lá). A migration + seed foram aplicadas em DEV e num clone local de PROD; a branch foi enviada ao remoto e há PR aberto — NÃO mesclar (seção 7). Com `escala_fechamento_fisico_modo = desligado` (padrão) o comportamento da Escala e do apontamento é o de hoje.

## 1. O fluxo (uma única ação)

```
FECHAR PERÍODO E GERAR PRÓXIMA PROGRAMAÇÃO            [tablet: /producao-real, só com permissão escala_fechamento e a flag ligada]
 1. abrir a janela de troca      → EM_FECHAMENTO: o apontamento do período só vale para quem abriu (trigger, só em `ativo`)
 2. coletar/finalizar apontamentos (produzindo, sem_producao, refugo, paradas) — todos os postos esperados, senão não fecha
 3. contar TODOS os buffers obrigatórios — campo físico nasce VAZIO; estimado do sistema ao lado
 4. confirmar → servidor revalida tudo, RECALCULA o estimado e grava o snapshot (1 transação, idempotente, trava por período)
 5. RECALCULANDO → corte-v1 com REAL + INVENTÁRIO FÍSICO (o motor parte do físico, nunca da projeção)
 6. PORTÃO HARD → só publica se: 0 CADEIA_INVALIDA · 0 sem material · 0 estoque negativo · 0 pessoa/máquina duplicada · 0 violação (revezamento) ·
    0 máquina fora da Previsão · pessoas ≤ disponíveis · passado intacto · INVENTÁRIO PRESERVADO (WIP inicial do motor = físico informado)
 7. persistir plano + fila drenada → CONFIRMADO ("M3 CONFIRMADO" + programação do M3 na tela) → liberar as máquinas
    falha em qualquer ponto → ERRO_RECALCULO: "Estoque salvo. Programação ainda não gerada." + retry seguro (sem recontar)
```
Estados persistidos (log append-only): `RECALCULANDO → CONFIRMADO | ERRO_RECALCULO` (+ `EM_FECHAMENTO` derivado do fim do período/abertura). O inventário nunca se perde: ele é gravado ANTES do recálculo.

## 2. Mapa A–K (o que foi entregue e onde)

| Item | Entrega | Onde |
|---|---|---|
| A. schema/migration | catálogo de buffers, aberturas, fechamentos+buffers+log append-only, trava, views, RPCs, flag | `supabase/migrations/20261110100000_escala_fechamento_fisico.sql` |
| B. permissões | `escala_fechamento` e `escala_fechamento_excecao` (CHECK + catálogo de permissões) | migration + `src/lib/permissoes.ts` |
| C. API transacional | `abrir`, `confirmar`, `retry`, `estado` (+ camada HTTP testável) | `src/app/api/escala/fechamento/*`, `src/lib/escala/fechamento/{http,orquestrador,supabaseFechamento}.ts` |
| D. tela do tablet | tela única, campo vazio, estimado ao lado, motivo em 1 toque, 2º passo (>50%), retry, programação nova ao confirmar | `src/features/producao-real/fechamento/*` + botão em `ProducaoRealPainelPage` |
| E. integração corte-v1 | `fechamentoFisicoFimMs`, `corteExplicito`, `portaoPublicacao`, leitura das contagens do fechamento (só em `ativo`) | `src/lib/escala/{processar,montarEntrada,supabaseIO}.ts`, `fluxo/{estado,fatores,contagem,integracao}` |
| F. validações | validação pré-gravação (pura) + portão HARD + CHECKs do banco | `src/features/escala/fechamento/validacao.ts` |
| G. retry/idempotência | chave do tablet (duplo clique), trava por semana com validade, abertura por usuário, retry sem recontar, rede de segurança na outbox | RPCs + `resgate.ts` |
| H. métricas de duração | `tempos_ms{gravacao,entrada,corte,validacao,persistencia,total}` no log + view `escala_fechamento_duracao` | migration + orquestrador |
| I. feature flag | `escala_fechamento_fisico_modo`: desligado / sombra / ativo | migration |
| J. sombra | grava o inventário, mede o erro e faz ENSAIO do recálculo (dry-run, nada publicado) registrando se o portão aprovaria e os tempos | orquestrador + `supabaseFechamento.recalcular({dryRun})` |
| K. ativação | procedimento e critérios GO/NO-GO abaixo | este documento |

Commits (em `feat/fechamento-fisico`, a partir de `origin/main` 4b3f2c4): `0a0443a` base do motor+migration+testes de banco · `c98c6a8` domínio+orquestrador+IO · `8125f5e` rotas+permissões+outbox · `f53ab19` tela do tablet · `4a7da2d` sombra/harness/screenshots/benchmark/replay (+ os commits seguintes, ver `git log origin/main..HEAD`).

## 3. Decisões técnicas (e por quê)

1. **Instante do motor = fim do período fechado.** Com as máquinas paradas, o inventário é o estado físico no fim do período; a confirmação (ex.: 10:27) é auditoria. Assim o período seguinte entra inteiro e não há "fração do período" a estimar.
2. **`corteExplicito`**: o recálculo parte do período SEGUINTE ao fechado, mesmo que o relógio já o considere iniciado (a troca atrasou o início real). Sem isso o motor trataria M3 como em andamento e só recalcularia T1 (provado em teste: `sem o fechamento … o M3 é congelado`).
3. **`fechamentoFisicoFimMs`** trata o período fechado (e os anteriores) como fechados mesmo antes de fim+10 min, e não muda nada quando ausente (byte-idêntico: 667 testes do motor continuam verdes).
4. **Portão de publicação**: o planejador de corte hoje, ao falhar, MANTÉM e regrava o plano vigente. No fechamento isso é proibido: o portão devolve `bloqueado` e **nada é gravado**.
5. **Buffer físico ≠ par do motor**: o tablet pede "Parafusadas aguardando Etiquetar" uma vez; o catálogo entrega Conv = total e Auto = 0 (até o Produto Único). Só `escala_buffer_pares` muda no cutover.
6. **Apontamento durante a janela**: só por quem abriu o fechamento; depois de confirmado, só por correção (nova revisão, perfil superior). Trigger **somente em `ativo`**.
7. **Sombra**: o motor oficial continua sem usar o físico; o ensaio mede tempo e aprovação do portão com dados reais de PROD antes de qualquer ativação.

## 4. Testes

| Camada | Arquivo | Resultado |
|---|---|---|
| Domínio puro (catálogo, validações, portão HARD, estados, selo) | `src/features/escala/fechamento/__tests__/{dominio,selo}.test.ts` | verde |
| Orquestrador (fluxo único, duplo clique, 2 usuários, motor falhando, retry, portão, exceção, sombra, bloqueio por buffer não cadastrado / semana sem corte-v1) | `src/lib/escala/fechamento/__tests__/orquestrador.test.ts` | verde |
| HTTP (permissão, entrada, desligado, exceção, revisão) | `…/http.test.ts` | verde |
| Motor real (corte-v1, banco em memória) | `src/lib/escala/__tests__/fechamentoFisicoMotor.test.ts` | verde |
| Banco local descartável (PG16): migration 2×, T1–T12 (inclui guarda do histórico liberada só para o corte, flag que não enfileira recálculo, sombra→ativo), seed, rollback atômico | `scripts/fechamento/rodar-teste-db.sh` | `TESTES-DB-OK`, `SEED-OK`, objetos restantes após rollback = 0 |
| **Ensaio estrutural no clone de PROD** (migration 2×, seed 2×, 19 verificações, compatibilidade histórica, rollback byte-idêntico, reaplicação) | `scripts/fechamento/ensaio-estrutural-clone.sh` → `docs/fechamento-fisico/ensaio-estrutural-clone.txt` | tudo OK |
| **E2E com banco real (clone de PROD + PostgREST + rotas reais)** | `scripts/fechamento/e2e.ts` → `docs/fechamento-fisico/e2e-clone.json` | todos PASS, 0 FALHA |
| Suíte completa | `npx vitest run` | 1.924 verdes / 14 falhas · **as mesmas 14 de `origin/main`** (6 arquivos: intelligence evals, producao-real desvios/funcionarios/validacao-previsao/visao-geral, relatórios) — não mexidas |
| Tipos / lint / build | `tsc --noEmit`, `eslint`, `next build --webpack` | OK (o único erro de lint, em `ProducaoRealPainelPage`, já existe em `origin/main`) |

**E2E no clone — o que cobre:** desligado ⇒ 503 · sombra (gravado, ensaio registrado, portão aprovaria, NENHUMA versão de plano criada) · ativo: EM_FECHAMENTO → apontamentos → contagem física → confirmação → persistência → corte-v1 → portão HARD → plano futuro → **CONFIRMADO**, motor partindo de contagem física em todos os buffers (7 pares; WIP inicial = inventário), log append-only `RECALCULANDO→CONFIRMADO`, inventário gravado exatamente como informado · sombra (rev 1) e oficial (rev 2) preservados · idempotência (mesma chave ⇒ mesmo fechamento) · duplo clique concorrente (1 linha só) · dois usuários (409) · **motor falhando ⇒ ERRO_RECALCULO com inventário preservado ⇒ retry sem recontar ⇒ CONFIRMADO** (+ retry idempotente) · **catálogo incompleto ⇒ BLOQUEIA em `ativo`** (BUFFER_FISICO_NAO_CADASTRADO com produto, rota, etapa origem/destino, semana, período) e só ALERTA em sombra · **semana sem corte-v1 ⇒ BLOQUEIA** (“Fechamento físico automático disponível apenas para semanas com corte-v1 ativo.”) · exceção: quem só tem `escala_fechamento` NÃO fecha sem contagem (403); perfil superior fecha com motivo, TODOS os buffers registrados sem contagem, status “programação parcial (estimativa)” · selo calculado.

**Golden 03/11** (`scripts/fechamento/replay-fechamentos.ts` → `replay-0311.txt`, dados reais): sem contagens extras o replay reproduz o plano publicado (0 diferenças); com o fechamento do M2 e do M3 o WIP do motor = contagem manual das 12:08 (`9.000 / 4.800+0 / 1.200`).

## 5. Benchmark (banco real — clone de PROD, com latência de rede injetada)

Tempos separados por etapa, 20 fechamentos completos CONFIRMADOS (20/20), ~84 idas ao banco por fechamento. `docs/fechamento-fisico/e2e-clone*.json`.

| Cenário (RTT ao banco) | abrir | contexto/buffers | entrada | gravar inventário | corte-v1 | portão HARD | persistir plano | **resposta total p50 / p95 / pior** |
|---|---|---|---|---|---|---|---|---|
| clone local (≈ 0 ms) | 82 ms | 58 ms | 77 ms | 3 ms | 668 ms | 0 ms | 37 ms | **806 / 829 / 844 ms** |
| mesma região (8–16 ms) | 452 ms | 325 ms | 440 ms | 21 ms | 690 ms | 0 ms | 55 ms | **1,35 / 1,38 / 1,40 s** |
| Mac → Supabase (46–80 ms, pessimista) | 1,69 s | 1,09 s | 1,53 s | 79 ms | 762 ms | 0 ms | 115 ms | **3,09 / 3,19 / 3,20 s** |

Meta p95 ≤ 5 s: **atendida em todos os cenários**; o custo dominante em rede é o nº de idas (carga de estado + entrada), não o motor. Honestidade: o clone é Postgres 16 local com os dados de PROD (não o Supabase hospedado); a rede foi emulada por um proxy com atraso. A medição definitiva é a sombra (o log guarda `tempos_ms` por etapa; `escala_fechamento_duracao`). Benchmark offline do motor (dados reais de 03/11): corte-v1 p95 0,84–0,96 s, portão aprova 15/15.

## 6. DEV e clone — resultado

* **Clone de PROD** (dump de PROD, somente leitura; PG16 + PostgREST 16.5): migration×2 ✓, seed×2 ✓, 19 verificações estruturais ✓ (constraints, 16 FKs validadas, RLS em 9 tabelas, policies, grants — authenticated/anon sem escrita; service_role só INSERT nas append-only —, 16 índices, funções, 8 triggers de imutabilidade, trigger de apontamento, CHECK de permissões/eventos, claim da outbox, guarda do histórico alterada em UMA condição); **contagens das tabelas pré-existentes idênticas** (nenhum dado histórico alterado, nenhum evento/recálculo enfileirado; só `escala_parametros` +1 = a flag desligada); rollback devolve funções byte-idênticas e o mesmo nº de tabelas/funções; migration+seed reaplicáveis depois.
* **DEV (`zjwcomwjmhsloyxfypax`)**: migration aplicada 2× (idempotente) e as 19 verificações passam (0 FALHA). **DEV NÃO é equivalente a PROD** (faltam as migrations do fluxo, `escala_trg_parametros` tem outro corpo): por isso o E2E completo roda no clone e a migration foi escrita para não depender do corpo das funções (reescreve a definição existente; aborta com erro claro se a âncora não existir). A migration foi aplicada em DEV via `db query` (NÃO registrada no histórico de migrations do Supabase) e a flag permanece desligada.

## 7. Plano de deploy, segurança do merge e rollback

**Merge em `main` — NÃO feito.** O repositório não tem workflow que aplique migration (os únicos workflows, `escala-drenar` e `escala-gerar-semana`, chamam endpoints) e a migration NÃO roda sozinha em merge; o Vercel faz deploy do código de `main`. Efeito de mesclar antes de aplicar a migration em PROD: o código novo sobe com a flag ausente ⇒ tratada como `desligado` ⇒ rotas respondem 503 e o motor segue idêntico ao de hoje (testes de motor byte-idêntico), e o botão do painel não aparece (depende da flag). Recomendação: mesclar só junto do plano abaixo, na ordem 1–5, para o deploy não preceder a migration.

Ordem de implantação para SOMBRA (nada disto foi executado em PROD):
1. **Backup durável** (plano vigente + hash, linhas da semana, contagens, parâmetros, eventos).
2. **Migration** `20261110100000` em PROD (inerte: flag desligada; troca o claim da outbox, relaxa a guarda do histórico só quando o fechamento libera). Rollback: `supabase/rollbacks/20261110100000_escala_fechamento_fisico_ROLLBACK.sql`.
3. **Seed do catálogo** `docs/fechamento-fisico/seed-catalogo-buffers.sql` + consulta de cobertura (0 produtos ativos/pares sem buffer nem dispensa).
4. **Permissões**: `escala_fechamento` à pessoa do tablet e aos substitutos autorizados; `escala_fechamento_excecao` SOMENTE ao perfil superior (não é concedida automaticamente a quem tem `escala_fechamento`).
5. **Deploy do código** (flag desligada): sem mudança visível além do selo.
6. **Flag → `"sombra"`** por 1–2 dias produtivos: a pessoa fecha o período de verdade no tablet com TODOS os buffers; o inventário é gravado; o motor roda contrafactual; o plano oficial de PROD NÃO é substituído.
7. Comparar por período (consultas na seção 10) → GO/NO-GO → só então `"ativo"`.

**O que aconteceria se a flag virasse `ativo` em PROD hoje** (não fazer): (a) cada troca de período passa a exigir o fechamento atômico; botão FECHAR PERÍODO aparece para quem tem a permissão; (b) durante EM_FECHAMENTO só quem abriu consegue apontar (trigger); (c) catálogo incompleto ou semana sem corte-v1 ativo BLOQUEIA (hard block) — é preciso conferir, antes, quais semanas de PROD estão em `corte-v1` (`producao_real_planejador_semanas`); (d) o plano publicado passa a nascer do inventário físico, com portão HARD; (e) selo ESCALA CONFIRMADA / AGUARDANDO FECHAMENTO nas telas. Nenhum histórico é reescrito.

**Rollback**
* **Desligar**: `escala_fechamento_fisico_modo = '"desligado"'` (não enfileira recálculo — o gatilho de parâmetros ignora a flag).
* **Exportar o físico para o legado** antes de remover: bloco comentado no início do rollback.
* **Remover objetos**: o script arquiva tudo em `*_arquivo`, restaura o claim da outbox, o CHECK de permissões e a guarda do histórico (byte-idêntico, verificado no clone), em transação.
* **Plano**: restaurar as linhas da versão anterior de `escala_plano_versoes` (procedimento de sempre).

## 8. Permissões

* `escala_fechamento`: pessoa do tablet + substitutos autorizados (conceder em Usuários → permissões).
* `escala_fechamento_excecao`: apenas admin/perfil superior; **não** vem junto com `escala_fechamento`.
* “Fechar sem contagem” não tem botão chamativo; exige a permissão de exceção, motivo obrigatório, auditoria, buffers sem contagem registrados, status especial e a programação seguinte marcada como parcialmente baseada em estimativa.

## 9. Correção administrativa (sem tela, por enquanto)

A API já aceita correção por perfil superior: nunca se edita o registro original — cria-se uma **nova revisão**. Procedimento: (1) superior com `escala_fechamento_excecao` chama `POST /api/escala/fechamento/abrir` com `forcar: true` para o período; (2) `POST /api/escala/fechamento/confirmar` com `revisao: true`, inventário corrigido e motivo; (3) o log mostra rev N+1; a anterior permanece (tabelas append-only por trigger e por privilégio). Qualidade do WIP: os dados (estimado × físico por buffer/dia) já são gravados desde o início (`escala_wip_erro_dia`); a página fica para depois do piloto.

## 10. Preparação da sombra (comparação por período)

Por período fechado em sombra, comparar: WIP estimado × físico (`escala_wip_erro_dia`); plano vigente × plano contrafactual (`detalhe` do log: hash_plano_novo × hash_plano_anterior, `publicavel`); tempo do fechamento (`escala_fechamento_duracao`); portões HARD reprovados (`motivo`); erros (`ERRO_RECALCULO`). Consultas e exemplos no E2E (`e2e-clone.json`).

## 11. Critérios GO / NO-GO para `ativo`

Resultado hoje (ambiente de teste) × exigência para PROD:

| Critério | Hoje (clone/DEV) | Falta em PROD |
|---|---|---|
| Catálogo 100% coberto para produtos ativos | seed cobre Conector 3/4 + Caixa (5 buffers/7 pares); lacuna ⇒ bloqueio provado | conferir os demais produtos ativos de PROD (consulta de cobertura) |
| 0 erro de migration | ✓ clone (PG16, dump de PROD) ×2 e DEV ×2 | aplicar em PROD |
| 0 quebra histórica / compatibilidade | ✓ contagens idênticas, histórico preservado | repetir no ensaio de PROD |
| 0 duplicidade / 0 fechamento perdido | ✓ duplo clique, 2 usuários, concorrência | observar na sombra |
| Idempotência + retry + ERRO_RECALCULO | ✓ | — |
| HARD gate | ✓ (reprova ⇒ nada gravado) | ≥ 95% aprovam na sombra |
| Replay 03/11 | ✓ reproduz o publicado e o WIP de 12:08 | — |
| p95 ≤ 5 s | ✓ 0,83 / 1,38 / 3,19 s (emulado) | confirmar com Supabase real na sombra |
| Contagem física preservada integralmente | ✓ (inclusive em ERRO_RECALCULO) | — |
| Próximo período correto | ✓ | — |
| Rollback testado | ✓ byte-idêntico no clone e no banco local | — |
| Nenhuma regressão além das 14 | ✓ mesmas 14 | — |

NO-GO imediato (voltar a `desligado`): plano publicado fora do portão; apontamento perdido; CONFIRMADO sem plano persistido; p95 > 10 s.

## 12. Lacunas conhecidas

* **Sem tela de correção pós-fechamento** (API pronta, procedimento na seção 9); **sem página Qualidade do WIP** (dados gravados).
* Medição em Supabase hospedado real só na sombra; o clone é PG16 local com latência emulada.
* **Produto Único**: deliberadamente fora (pausado); só `escala_buffer_pares` muda no cutover.
* **Harness de DEV** `/dev/fechamento` (`notFound()` em produção): UX e screenshots em `docs/fechamento-fisico/screenshots/`.

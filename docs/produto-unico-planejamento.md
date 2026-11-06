# Produto único Conector 3/4 — PLANEJAMENTO antecipado (06/11/2026)

Escopo desta publicação: programar a semana **09/11** com o produto único (Previsão com quantidade única, seleção de máquinas, geração do plano e divisão entre as rotas) **sem mudar nada da operação**.
O **cutover operacional** (apontamento, fechamento, buffers, liberação, TV, WIP oficial) fica FORA desta publicação e continua `produto_unico_cutover = null`.
Tudo foi provado no CLONE local de PROD (dump de 06/11 ~10:53); PROD nunca foi escrito.

## Modelo: UMA decisão por semana
| Modo | Quando | O que usa o produto único |
|---|---|---|
| LEGADO | semana < `produto_unico_planejamento_desde` (hoje: tudo) | nada — operação e planejamento de hoje, byte a byte |
| PLANEJAMENTO | `planejamento_desde` <= semana < `cutover` (ou cutover ausente) | Forecast/Previsão (item único aceito, legado recusado), motor novo, indicadores. O plano é **FUTURO e NÃO LIBERADO** |
| OPERACIONAL | semana >= `cutover` | tudo (fora desta publicação) |

TS: `modoProdutoUnicoDaSemana` (`src/features/produto-canonico/cutover.ts`; usado em `supabaseIO.carregarEstado`). SQL: `produto_unico_modo(date)`, `produto_unico_planejando(date)`, `produto_unico_ativo(date)` (>= cutover), `produto_unico_planejamento_desde()`.

## O que entra (arquivos)
Migrations (nesta ordem; as 3 primeiras foram EDITADAS no lugar porque ainda não estão em PROD):
1. `20261115100000_produto_canonico_estrutura.sql` — + parâmetro `produto_unico_planejamento_desde` (null; inserido com gatilhos de recálculo/versão desligados), constraint de validação (segunda-feira >= 2026-11-02), funções de modo.
2. `20261115110000_produto_canonico_conversao.sql` — guardas da Previsão passam a usar o planejamento (item único aceito / legado `previsto` recusado em semana de planejamento); `produto_unico_unificar_previsao` (botão "Unificar em Conector 3/4") exige planejamento habilitado, soma 64.800 + 28.500, **remove os 2 itens legados** da Previsão e guarda o backup (undo = `produto_unico_separar_previsao`).
3. `20261115120000_produto_unico_ativacao.sql` — `produto_unico_habilitar_planejamento(desde)`, `produto_unico_desabilitar_planejamento()`, `produto_unico_incluir_semana_nas_listas(semana)`; `produto_unico_ativar` (cutover, fora desta publicação) agora **exige** o planejamento habilitado e também garante (idempotente) a semana nas duas listas.
4. **NOVA** `20261116100000_produto_unico_planejamento_liberacao.sql` — substitui `escala_periodo_liberacao` (primeira regra: modo PLANEJAMENTO => `liberado=false`, motivo `PLANO_FUTURO_AGUARDANDO_CUTOVER`, precedência absoluta) e cria gatilhos de bloqueio em `apontamentos_producao`, `escala_fechamentos` e `escala_fechamento_aberturas`. Com planejamento/cutover null a saída da função é idêntica à de antes (provado pelo fingerprint).

Reversões (à mão, ordem inversa): `supabase/rollbacks/20261116100000_rollback_produto_unico_planejamento_liberacao.sql`, depois os 3 já existentes (`...20261115120000...`, `...20261115110000...`, `...20261115100000_*_1_backfill`, `..._2_estrutura`; este último foi atualizado para remover o parâmetro/constraint/funções novas).

Ops: `supabase/ops/produto-unico/15-habilitar-planejamento.sql` (novo; `-v desde=2026-11-09`), `20-ativar-cutover.sql` (agora exige o 15). Gate: `scripts/produto-unico/gate-planejamento.ts` (somente leitura; roda em PROD e no clone).
Código: `src/lib/escala/estado.ts` (`produtoUnico.modo`), `supabaseIO.ts` (modo PLANEJAMENTO liga o motor novo), `fechamento/orquestrador.ts` + `supabaseFechamento.ts` (PERIODO_EM_PLANEJAMENTO em abrir/confirmar, em qualquer modo da flag).

## Provas (clone)
* `supabase/tests/produto-unico/rodar.sh --do-zero`: **118 PASS · 0 FAIL · 0 erros SQL** (evidência: `docs/produto-unico-planejamento-evidencia-sql.txt`). Inclui: aplicar 4 migrations + backfill sem erro; fingerprint (funções, triggers, colunas, constraints, dados, **saída de `escala_periodo_liberacao` 28/10–13/11**, hash do plano de 02/11) idêntico ao baseline; **reverter as 4 migrations deixa o banco IDÊNTICO ao baseline**; **reaplicar** reproduz o estado migrado; `05-planejamento.sql` (22 asserts; reversão do planejamento recusada com item único na Previsão; `habilitar -> unificar -> separar -> desabilitar` devolve parâmetros, produtos, pares de buffer, versões de plano e eventos idênticos).
* `scripts/produto-unico/e2e-planejamento.ts`: **46 PASS · 0 FAIL** (evidência: `docs/produto-unico-planejamento-evidencia-e2e.txt`). Reproduzir: `scripts/produto-unico/clone-zero.sh; set -a; source ~/Documents/sittech-clone/env.clone; set +a; scripts/fechamento/ts.sh scripts/produto-unico/e2e-planejamento.ts`.
* vitest completo: 2.132 passam; as únicas falhas são as 14 já existentes na main (8 producao-real, 2 intelligence/evals, 4 relatorios). Cinco testes de propriedade estouraram o timeout de 5 s numa rodada com a máquina em load average 139 e passam isolados (5 arquivos, 76 testes) — flake de carga, não regressão. `tsc`: só o erro pré-existente de `LayoutProps`.

### Testes A–H do dono do produto
| | Teste | Prova |
|---|---|---|
| A | 06/11 continua LEGADO e inalterado | e2e `A1`, `A2/G`, `A3`, `A4`, `A5`: 23 componentes (apontamentos, planejado×real, fechamentos/buffers/log/plano/aberturas, plano e alocações < 09/11, buffers/pares/máquinas/dispensas, WIP, versões de plano, parâmetros, previsão 02/11, eventos, liberação 05–06/11, TV 06/11) idênticos depois de **habilitar** e depois de **unificar + salvar a Previsão + gerar 09/11**; hash do plano 02/11 `6ae041bb…` igual |
| B | semana 09/11 mostra o produto único | e2e `B`: item único 93.300 + 3 outros itens; nenhum legado |
| C | Forecast aceita 1 quantidade | e2e `C0` (legado recusado), `C1` (unificar remove os 2 legados), `C2` (backup/undo), `C3` (`upsert_previsao_semana` do app salva) |
| D | duas rotas selecionáveis | e2e `D`: M8 na etapa "Rosquear + Parafusar"; Rosquear=3, Parafusar=4, Etiquetar=2, Embalar=1 máquinas |
| E | motor gera a semana | e2e `E`: `processado`, planejador de corte usado, 390 linhas, ~10 s |
| F | nenhum id legado no plano | e2e `F`: legado=0, 163 linhas com posto no produto único. Divisão: Rosquear 64.800 · Rosquear+Parafusar (M8) 35.610 · Parafusar 60.800 · Etiquetar 96.645 · Embalar 93.300 |
| G | nenhum apontamento/fechamento atual alterado | e2e `A2/G` (fingerprint) |
| H | plano de 09/11 NÃO LIBERADO | e2e `(7)`, `(1)`, `(2)` x 3 estados + SQL `P6` |

### HARD GATE — 9 itens (nenhuma camada operacional trata o plano futuro como liberado)
O e2e repete os itens 1, 2, 4 e 7 em **três estados**: (i) plano gerado, T3 da sexta não fechado; (ii) T3 de 06/11 CONFIRMADO com contagem física (fechamentos reais de 05/11 M3 a 06/11 T3 com relógio simulado), plano gerado ANTES do fechamento; (iii) T3 CONFIRMADO e plano regerado DEPOIS. Em todos os estados 09/11 e 09/11–13/11 ficam NÃO LIBERADOS.
| # | Item | Teste que prova |
|---|---|---|
| 1 | TV não recebe postos de 09/11 | e2e `(1)` — `escala_tv_snapshot` como administrador devolve 0 alocações em 09–13/11 (x3 estados) |
| 2 | Produção Real não recebe postos | e2e `(2)` — `acaoPostos` (`/api/escala/fechamento/postos`) e `acaoApontamentosEstado` (`/apontamentos`) devolvem `naoLiberado` e 0 postos (x3) |
| 3 | apontamento não usa 09/11 | e2e `(3a)` INSERT direto (o que TODAS as RPCs fazem) de outro produto (Pino) recusado `APONTAMENTO_SEMANA_EM_PLANEJAMENTO`; `(3b)` `registrar_apontamento_producao_core` com data de 09/11; `(3c)(3d)(3e)` as RPCs reais `registrar_apontamento_producao_core`, `registrar_apontamentos_fechamento` e `regularizar_apontamento_historico` com a semana simulada em planejamento numa data PASSADA (transação com ROLLBACK, para a RPC não recusar antes por data futura) chegam ao INSERT e são barradas; SQL `P9` |
| 4 | fechamento físico não abre para 09/11 | e2e `(4)` `acaoAbrir` e `acaoConfirmar` => 422 `PERIODO_EM_PLANEJAMENTO` (x3); `(4b)` e SQL `P10`: INSERT em `escala_fechamento_aberturas` recusado no banco; vitest `planejamentoProdutoUnico.test.ts` (modo ativo e sombra: nada é gravado; semana que não é planejamento continua abrindo — regularização preservada) |
| 5 | WIP oficial não muda | fingerprint (`wip_controle`, `wip_ajustes`, `wip_confirmacoes`, `wip_saldo_semanal`) idêntico depois de habilitar e de gerar 09/11 |
| 6 | buffers oficiais não mudam | fingerprint (`escala_buffers_fisicos`, `escala_buffer_pares`, `escala_buffer_maquinas`, `escala_buffer_dispensas`, `escala_fechamento_buffers`) idêntico |
| 7 | `escala_periodo_liberacao` NÃO LIBERADO em todos os caminhos | e2e `(7)` 30 períodos x 3 estados (com/sem fechamento do T3, plano antes/depois); SQL `P6` |
| 8 | nenhuma regra de relógio/virada contorna | e2e `(8)` com `escala_liberacao_desde` movido para antes (02/11), exatamente (09/11 M1) e depois (20/11): segue NÃO LIBERADO; SQL `P7` (idem) e `P8` (fechamento físico `desligado` não cai em `MODO_NAO_ATIVO`). O modo PLANEJAMENTO é a PRIMEIRA linha da função |
| 9 | as listas `semanas_ativas`/`planejador_semanas` não liberam | desde o passo 2b do e2e a semana 09/11 está nas duas listas e todos os itens acima valem |

## Regras de planejamento (comportamento)
* `produto_unico_habilitar_planejamento(desde)`: idempotente; recusa se houver apontamento legado ou fechamento em/depois de `desde`; liga `produtos.ativo` do produto único (selecionável no Forecast); inclui `desde` em `producao_real_semanas_ativas` e `producao_real_planejador_semanas` **com os gatilhos de recálculo e de versão de plano desligados dentro da função** (zero evento, zero versão nova, hash do plano de 02/11 igual); NÃO toca em buffers, pares, WIP, apontamentos.
* Apontamento do produto único antes do cutover segue recusado (`APONTAMENTO_CANONICO_ANTES_DO_CUTOVER`); em semana de planejamento **qualquer** apontamento é recusado.
* `produto_unico_desabilitar_planejamento()`: recusa se o cutover estiver ligado ou se qualquer Previsão tiver o item único (use "Separar" antes); só retira das listas o que o habilitar acrescentou; nunca apaga dado.

## ORDEM DE PROD — FASE 1 (planejamento)
1. **Backup** do banco (dump completo + `select * from escala_parametros`).
2. Aplicar as migrations, nesta ordem: `20261115100000`, `20261115110000`, `20261115120000`, **`20261116100000`** (cada uma em transação; `supabase/migrations/`). Sem efeito de comportamento enquanto `planejamento_desde` e `cutover` forem null.
3. Backfill: `supabase/ops/produto-unico/10-backfill-conector-unico.sql` (cria o produto único INATIVO).
4. Validar o banco (somente leitura): `supabase/ops/produto-unico/00-preflight.sql`; conferir `select produto_unico_estado()` (cutover null, planejamento null, `problemas_cadastro` vazio) e que `escala_plano_registrar(<previsão 02/11>,'baseline')` não cria versão nova.
5. Deploy do código (cutover e planejamento ainda desligados).
6. Smoke legado: Escala/TV/Apontamento/Fechamento de hoje (06/11 e a semana 02/11) como sempre; nenhum evento pendente.
7. **Habilitar o planejamento**: `psql ... -v desde=2026-11-09 -f supabase/ops/produto-unico/15-habilitar-planejamento.sql`.
8. Gate: `SEMANA=2026-11-09 scripts/fechamento/ts.sh scripts/produto-unico/gate-planejamento.ts` (antes de unificar acusa "demanda única" FAIL — esperado) ; unificar a Previsão pela tela ("Unificar em Conector 3/4"), conferir máquinas por etapa (M8 na etapa M8), gerar a Escala da semana; rodar o gate de novo (todos PASS, 30 períodos NÃO LIBERADOS) e conferir que 06/11 segue igual.

Reverter a FASE 1 (nesta ordem): "Separar" a Previsão -> `select public.produto_unico_desabilitar_planejamento();` -> (se necessário) os rollbacks de migration na ordem inversa.

## Riscos
1. **A semana 09/11 em PLANEJAMENTO não opera.** Enquanto o cutover não for ativado, TODA a semana de 09/11 (qualquer produto) fica sem período liberado e sem apontamento/fechamento. O cutover (FASE 2) precisa acontecer antes do M1 de segunda (07:12) — ou, se o GO operacional não vier, fazer o "plano B": Separar -> `desabilitar_planejamento` (a semana volta a LEGADO e o plano legado é gerado como hoje). Decidir isso até domingo.
2. O produto único passa a `ativo` (selecionável) já no habilitar. O banco bloqueia apontamento/fechamento nele, mas as listas da UI (apontamento, Produção Real, painéis) precisam esconder o produto único fora do OPERACIONAL — trilha UI (`modoProdutoUnicoDaSemana`/`produtoUnicoOperacional`).
3. A TV/telas mostram o motivo novo `PLANO_FUTURO_AGUARDANDO_CUTOVER` pelo texto padrão fail-closed ("AGUARDANDO PROGRAMAÇÃO CONFIRMADA"); mensagem dedicada em `src/features/escala/fechamento/visaoTv.ts` (trilha UI) é opcional.
4. O plano gerado agora usa as contagens físicas VIGENTES (sexta 06/11 ainda não fechou no momento do teste): ele **não é o plano definitivo**. Regerar após o T3 e a contagem de segunda é do trabalho OPERACIONAL (parqueado, abaixo).
5. `escala_periodo_liberacao` é uma função de PROD substituída: o texto novo só ganha uma cláusula no início; a saída é idêntica com planejamento/cutover null (fingerprint). Há rollback pronto.
6. Os gatilhos de bloqueio rodam em todo INSERT de `apontamentos_producao`/`escala_fechamentos`/aberturas (1 consulta a `escala_parametros` por linha, em tabela pequena).
7. Carga do clone: os testes de propriedade do vitest têm timeout de 5 s e falham sob load alto (visto com load average 139); rodar isolados.

## Parqueado (NÃO faz parte desta publicação)
Trabalho de virada operacional já iniciado fica na branch local `wip/produto-unico-virada-operacional` (base física do plano em `escala_plano_base_fisica`, regra robusta do M1 da semana nova, migration `20261116110000`): não deve ser publicado junto. Também parqueados por decisão do dono do produto: análise dos 4.525, contagem de segunda, rollback integrado do cutover, gate completo de cutover e regeração operacional com snapshot físico. Achado que vale registrar para essa trilha: a regra `VIRADA_SEMANA` de `escala_periodo_liberacao` libera o M1 pelo relógio (plano gravado depois do fechamento) e uma troca manual (`escala_trocar_alocacoes`) após o T3 atualiza `atualizado_em` sem recalcular — fragilidade; a correção proposta (M1 só com plano calculado com o snapshot físico do T3) está na branch parqueada.

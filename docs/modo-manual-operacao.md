# Modo manual de operação (06/11/2026)

**Decisão:** a escala automática deixa de comandar o chão; o apontamento volta a ser manual (Clarice). **Nada é apagado**: migrations, tabelas, planos, fechamentos, apontamentos, snapshots e o código do corte-v1 permanecem. É desativação operacional, reversível por configuração.

## Conceito único

`escala_operacao_manual()` (SQL) / `lerOperacaoManual()` (TS, `src/lib/escala/modoManual.ts`) = **as três flags abaixo estão TODAS desligadas**. Não existe flag nova. Qualquer uma ligada ⇒ não é manual ⇒ comportamento anterior preservado byte a byte (sem "meia desativação").

| Flag (`escala_parametros`) | Controla | No modo manual |
|---|---|---|
| `producao_real_modo` | motor Escala Inteligente / **corte-v1** operacional | `desligado` |
| `replanejamento_modo` | replanejamento oficial por eventos | `desligado` |
| `escala_fechamento_fisico_modo` | **fechamento físico**, **liberação automática** de período, gates do apontamento, grade do tablet por postos programados, **TV** (via liberação) | `desligado` |
| `apontamento_simplificado_modo` | fluxo "apontamento simplificado" do fechamento (`registrar_apontamentos_fechamento`) | `desligado` |
| `produto_unico_planejamento_desde` | PLANEJAMENTO do produto único (plano futuro 09/11) | **inalterado** (preservado) |
| `wip_modo`, `revezamento_modo` | regras do motor (WIP/revezamento) | **inalterados** (sem efeito com o motor fora do chão; mudar enfileira recálculo) |

## O que muda no código (cinco pontos centrais, nenhum condicional espalhado)

Banco (migration `20261119100000_modo_operacao_manual.sql`):
1. `escala_registrar_evento` — funil único de eventos (ausência, previsão, cadastro, WIP, parâmetros…): não enfileira.
2. `escala_agendador_chamar` — funil dos 30 jobs do pg_cron: não faz a chamada HTTP.
3. `produto_unico_trg_bloqueia_planejamento` — o PLANEJAMENTO **não bloqueia o apontamento** (o do fechamento físico continua bloqueado).
4. `escala_periodo_liberacao` — nenhum período é "liberado pela escala" (`MODO_MANUAL`, `liberado=false`): **TV neutra**, grade de gestão como "ESTIMADO".
5. `escala_aplicar_recalculo` — última linha de defesa: recusa `ESCALA_AUTOMATICA_DESATIVADA`, sem exceção.

Aplicação (TS):
- `processarSemana` (funil de TODO recálculo: eventos, `/gerar`, `/gerar-semana`, fechamento, sombra) devolve `ignorado` com motivo explícito, **em semana nenhuma** (sem exceção, nem para a semana em PLANEJAMENTO). Planejar de novo exige religar a escala por configuração; o plano e os dados do planejamento permanecem consultáveis.
- `gerarEscalaSemanalDoServidor` (cron de segunda 06:30) devolve `desativada` (200, sem evento de erro).
- `/api/escala/gerar` responde 409 explícito.
- `useModoProdutoUnico.planoFuturo` é `false` no modo manual (o painel, o seletor "Outro período", a regularização e a TV não escondem a semana 09/11); a Escala interna continua tratando 09/11 como plano futuro somente leitura.
- TV: texto neutro "PROGRAMAÇÃO AUTOMÁTICA DESATIVADA" (`visaoTv.ts`).

## Gatilhos e workers auditados

| Origem | Efeito no modo manual |
|---|---|
| Gatilhos `trg_escala_evento_*` (ausência, previsão, máquina, roteiro, ocorrência, WIP, parâmetros) | passam por `escala_registrar_evento` ⇒ não enfileiram |
| `trg_escala_evento_apontamento` | já era inerte com as flags desligadas |
| pg_cron (30 jobs `escala-pre/pos-periodo-*`) | `escala_agendador_chamar` não chama o app |
| pg_cron `escala-fechar-atrasos-*` | mantido (regra de ausências em aberto, não é escala); eventos que gerar são descartados pelo funil |
| GitHub Actions `escala-drenar.yml` / `escala-gerar-semana.yml`, crons da Vercel | continuam pingando, mas viram no-op (200); **não é preciso desabilitá-los** |
| Navegador → `/api/escala/processar` (disparado a cada apontamento/ausência) | `processarSemana` ignora |
| `/api/escala/drenar`, `/reprocessar` | eventos pendentes são baixados como `ignorado` |
| Fechamento físico (`/api/escala/fechamento/*`) | no-op com a flag desligada |
| Relatório semanal PDF (sexta/sábado 18:00) | mantido (informativo) |

## Validações do apontamento que continuam

Máquina/funcionário/produto existentes e ativos, produzido ≥ 0, refugo ≥ 0 e ≤ produzido, combinação técnica válida (roteiro × máquina, 1 etapa elegível), meta do período > 0, período/data válidos (sem data futura). **Não** exige posto programado, escala liberada, plano vigente, fechamento anterior, owner, WIP/buffers, nem correspondência com o Forecast. "Sem produção" não é obrigatório.

## Vários lançamentos por máquina/período (migration `20261119110000`)

A unicidade antiga `(máquina, data, período)` ("V1: um fechamento por máquina/dia/período") impedia registrar **dois produtos** ou **troca de operador** no mesmo período. Novo modelo (aditivo, nada apagado):
- cada linha é única por **(máquina, data, período, produto, operador)**; repetir exatamente a mesma combinação é recusado com mensagem clara;
- continua existindo **um** "sem produção" por máquina/período, e "sem produção" e produção **não coexistem** (gatilho `trg_apontamentos_status_exclusivo`; converter "sem produção" em produção continua funcionando);
- tela: o cartão da máquina soma os lançamentos ("A + B · 1.400 un. · 2 lançamentos"); clicar escolhe qual lançamento abrir; `+ ADICIONAR APONTAMENTO` lista todas as máquinas (inclusive já lançadas) para acrescentar outro produto/operador; editar/excluir recarrega do banco.
- limites conhecidos: a **regularização histórica** (admin) mantém o desenho de uma linha por máquina/período e recusa quando houver mais de uma (edite pelas "Apontamentos realizadas"); a "meta do período" de cada linha é a do produto inteiro (indicadores de desempenho por linha em período dividido ficam subestimados); reativar a escala automática no futuro exige que o motor leia várias linhas por máquina.
- rollback: `20261119110000_..._ROLLBACK.sql` **aborta sem alterar nada** se existir máquina/período com mais de um lançamento.

## Permissões (sem regra por nome)

`producao_real_apontamento` (+ `producao_real_apontamentos_realizados`) cria e corrige; a RLS exige só usuário ativo. Excluir exige admin ou `producao_real_historico`. A regularização histórica segue com `escala_fechamento_excecao`/admin.

## Runbook de PROD (ordem obrigatória)

1. **Backup** (feito antes de qualquer escrita): `~/Documents/sittech-rollbacks/2026-11-06-modo-manual/` (flags, jobs, funções).
2. **Migrations** `20261119100000` (inerte com as flags ligadas: `escala_operacao_manual()=false`) e `20261119110000` (vários lançamentos; compatível com o código antigo).
3. **Deploy** do código (Vercel) — também inerte enquanto as flags estão ligadas.
4. **Flags** `supabase/ops/modo-manual/10_aplicar_flags.sql` (uma transação; aborta se gerar evento ou se o modo não ficar ativo). `producao_real_modo` vai por último.
5. **Smoke** (`escala_operacao_manual()=true`, TV neutra, fila sem pendentes, histórico idêntico).

## Rollback

1. `supabase/ops/modo-manual/90_reverter_flags.sql` (devolve exatamente os valores de 06/11; religar `producao_real_modo=ativo` enfileira **um recálculo** das semanas com escala futura — comportamento original).
2. `supabase/rollbacks/20261119110000_..._ROLLBACK.sql` e depois `supabase/rollbacks/20261119100000_modo_operacao_manual_ROLLBACK.sql` (restauram as 7 funções byte a byte).

## Testes (clone com dump novo de PROD)

- `supabase/tests/modo_operacao_manual.test.sql` — 38 verificações (antes/depois, gatilhos, TV, PLANEJAMENTO, validações, Clarice, vários lançamentos por máquina/período).
- `scripts/modo-manual/e2e-modo-manual.ts` — eventos plantados à força + `/drenar`, `/gerar`, `/gerar-semana`: plano idêntico.
- `src/lib/escala/__tests__/modoManual.test.ts` — definição única, funil, golden byte-idêntico com flags ligadas, exceção do PLANEJAMENTO, TV.

# Escala — guarda do histórico e reconciliação de funcionários (27/10/2026)

Dois bloqueadores da auditoria da Escala, resolvidos sem tocar no motor, no horizonte, no ativo_restrito, no WIP, na capacidade da Previsão nem nas rotas.

## Bloqueador 1 — o histórico é imutável
**Causa.** Sem nenhum slot futuro (semana toda ocorrida), `processar.ts` cortava no 1º período do dia removido — um período que já tinha acontecido — e `escala_aplicar_recalculo` apagava as alocações históricas desse dia e as dos dias removidos seguintes (no DEV: 180 alocações).

**Correção em duas camadas.**
1. Processador (`pontoDeCorte` em `src/lib/escala/processar.ts`): o corte é o **primeiro período que ainda não começou** entre os slots mutáveis e os períodos dos dias que deixaram de ser produtivos. Sem período futuro algum => **NO-OP** (`sem_alteracao`, nada é gravado nem apagado). Bônus: ao desmarcar *hoje* o futuro de hoje some (antes ficava lixo) e o iniciado permanece.
2. Banco (migration `20261105130000`): `escala_aplicar_recalculo` recusa corte em período iniciado (`ESCALA_CORTE_NO_PASSADO`) ou em dia sem escala (`ESCALA_CORTE_INVALIDO`) — mesmo que o processador envie dados errados. Dia removido cujo 1º período é o corte deixa de existir por inteiro. O resto da função é idêntico.

**Efeito colateral deliberado:** `escala_replanejamento_reverter` (ativo_restrito) também passa pela mesma RPC e deixa de poder regravar período já iniciado.

## Bloqueador 2 — funcionários têm reconciliação equivalente à das máquinas
**Fontes (nenhuma tabela nova, nenhum espelho):** `ausencias_funcionarios` (falta, atraso em aberto, parcial, saída antecipada), `funcionarios.ativo`, `previsao_equipe_semana.produtivo` — exatamente o que o motor lê.

`escala_divergencias_funcionarios(p_agora)` (SQL, somente leitura) compara as fontes com a Escala gravada **só nos períodos futuros** (início > agora), com a semântica do motor: ausência afeta o período por **sobreposição `[início, fim)`**; atraso em aberto = `[início, fim da jornada)`; equipe = produtivo **e** ativo. Tipos: `alocado_ausente`, `alocado_inativo`, `alocado_fora_equipe` (linha de quem não pode) e `disponivel_sem_linha` (quem pode e está sem linha: **retorno**, volta/entrada na equipe).

**Revalidação única.** `revalidarDisponibilidade` (`src/lib/escala/revalidarDisponibilidade.ts`) — chamada por `/api/escala/drenar` e `/processar`, e portanto pelos 12 jobs pg_cron pré-período (07:07 … 15:35, +3 min) — confere **máquinas e funcionários** na janela início−6 min … +15 min. Divergência de funcionário e nenhum evento de replanejamento na fila da semana => registra **um** evento `ausencia` (payload `origem=revalidacao_funcionarios` + assinatura). Já há evento na fila => reutiliza. Mesma assinatura (inclui o id da causa) já tentada nas últimas 6 h e ainda divergente => só alerta (`persistentes`), sem laço. Sem divergência => NO-OP. O evento imediato continua; a revalidação é a rede de segurança.

**Fechamento do atraso às 17:00.** 3 jobs pg_cron chamam `fechar_atrasos_vencidos()` direto no banco (17:00 e 17:05 SP, seg–sáb, e 06:05 para restos): não dependem do GitHub nem de HTTP. O plano não muda no fechamento (o motor já tratava o aberto como indisponível até o fim da jornada).

**Passado:** nada disso reescreve período iniciado — a função só enxerga períodos futuros e o recálculo continua cortando no primeiro período não iniciado (e agora o banco impõe isso).

## Testes
- TS: `guardaHistorico.test.ts`, `revalidarFuncionarios.test.ts` (+ ajustes em `processar.test.ts`, `bancoMemoria.ts`, `revalidarDisponibilidade.test.ts`).
- SQL (DEV, rollback): `supabase/tests/escala_guarda_historico.test.sql`, `escala_reconciliacao_funcionarios.test.sql`.
- E2E no DEV com o processador real: falta cadastrada + evento imediato perdido => a revalidação recupera, o funcionário sai dos períodos futuros, 3 revalidações seguintes = NO-OP, retorno com evento perdido => elegível de novo; passado idêntico, 0 duplicidade, 0 repetição de operação.

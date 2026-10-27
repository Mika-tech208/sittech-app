# Parada de máquina => indisponível para a Escala e a Capacidade (hotfix 27/10/2026)

## O bug
Uma Parada registrada em Produção Real (`ocorrencias_maquina`) nunca chegava à Escala. O motor só conhecia `maquinas.ativo`,
`previsao_maquinas_indisponiveis` (marcação manual da semana) e `escala_recurso_indisponivel` (botão manual da Escala, **nunca usado em PROD**).
Caso real: Máquina Automática 8, Parada de manutenção aberta 27/10 09:34 — a Escala continuou alocando a máquina em 21 períodos futuros
(a máquina chegava ao motor como disponível; o motor, o horizonte e o reparo de compromisso já retiravam a máquina corretamente quando recebiam a restrição).

## Arquitetura (opção A: espelho com origem — uma única verdade)
`escala_recurso_indisponivel` passa a guardar **uma linha por causa** (`origem_tipo`, `origem_id`):

| origem_tipo | quem cria | quando termina |
|---|---|---|
| `manual` | RPC `escala_bloquear_recurso` (botão "Tornar indisponível") — no máximo 1 aberta por máquina | `escala_liberar_recurso` ("Liberar bloqueio manual") |
| `ocorrencia_maquina` | trigger em `ocorrencias_maquina` (insert/update/delete) → `escala_sincronizar_ocorrencia` | encerrar a Parada (sem "Liberar" manual; `escala_liberar_recurso` recusa causa de Parada) |

**A máquina só está disponível quando NÃO existe nenhuma causa ativa** (várias linhas por máquina). O motor e o carregador não mudaram:
`supabaseIO.carregarEstado` já lia `escala_recurso_indisponivel`; `montarEntrada` já transformava em `indisponibilidades`.
Capacidade/Previsão leem as mesmas causas abertas (RPC `escala_maquinas_indisponiveis_agora`, qualquer usuário ativo) e somam às marcadas na semana
(`aplicarIndisponibilidadeEfetiva`, aplicada em `usePrevisoes`). Semanas já encerradas não mudam. O marcador manual da Capacidade regrava só
`maquinasIndisponiveisManuais` (a Parada nunca é gravada na Previsão).

## Regra de interseção (substitui "olha só o início do período")
Intervalos semiabertos `[início, fim)`. Uma causa afeta um período se `desde < fim_período E (liberada_em IS NULL OU liberada_em > início_período)`
(`causaAfetaIntervalo`, usada por `maquinaDisponivelNoSlot`, e a mesma regra em SQL na invariante). Fronteiras:

| caso | afeta? |
|---|---|
| A) começa exatamente no início | sim |
| B) começa no meio | sim (antes não: a Parada que começava no meio de M2 deixava M2 "disponível") |
| C) começa exatamente no fim | não |
| D) termina exatamente no início | não |
| E) termina no meio | sim |
| F) termina exatamente no fim | sim |
| fim NULL (aberta) | sim, todos os períodos futuros até encerrar |

Passado e período em andamento nunca são reescritos (o horizonte congela; a invariante só olha períodos que COMEÇAM depois de agora). O período em que a Parada
começou (ex.: M2 08:48–10:24 com Parada 09:34) aparece como afetado nos diagnósticos (`maquinaDisponivelNoSlot` = false) sem reescrever a alocação.

## Eventos
`escala_evento_recurso` registra `recurso_bloqueado` (abrir) / `recurso_liberado` (encerrar ou apagar a Parada) **na mesma transação** da Parada, para as semanas com
escala futura em que a máquina está selecionada na Previsão ou tem alocação futura (máquina fora da operação da Escala não gera recálculo). Mesma deduplicação de sempre
(`escala_registrar_evento` devolve o pendente do mesmo tipo/semana): retry não duplica. Editar só o horário de uma Parada já encerrada não gera evento (não altera o futuro).

## Backfill / reconciliação
`escala_reconciliar_indisponibilidades()` (idempotente) cria/atualiza/remove o espelho a partir de `ocorrencias_maquina` (abertas + encerradas nos últimos 45 dias) e remove
espelhos órfãos. Roda no final da migration (a Parada da Máquina 8 já aberta vira causa e gera o evento) e em toda chamada do worker. Sem mudança = nenhum evento.
Bloqueio manual criado como mitigação **não é tocado** (é decisão humana): ao terminar a manutenção, libere também o bloqueio manual.

## Revalidação antes de cada período
Camadas (nenhuma é a única garantia):
1. **Evento imediato** (transacional) + o navegador de quem abre/encerra a Parada chama `/api/escala/processar` na hora.
2. **Pré-checagem no navegador** (`usePreChecagemEscala`, TV e tela da Escala): 5 min antes de cada período (07:07, 08:43, 10:19, 12:55, 14:15, 15:35 com os períodos de hoje,
   calculados da tabela `periodos`, America/Sao_Paulo) chama o endpoint idempotente; ao voltar de suspensão/aba oculta dispara na hora.
3. **Servidor**: `/api/escala/drenar` e `/api/escala/processar` chamam `revalidarDisponibilidadeMaquinas` antes de drenar: (a) reconcilia; (b) dentro da janela de um período
   (início −6 min … +15 min) confere a **invariante** "nenhuma alocação futura numa máquina com causa ativa que intersecte o período". Violação sem evento de bloqueio da causa → registra o
   evento (recuperação de evento perdido); evento ainda na fila → aguarda a drenagem; evento já processado e plano ainda viola → só alerta (`persistentes`), **nunca** repete (sem laço de recálculo).
4. **Agendadores**: o GitHub `*/5` continua; foram acrescentados os 6 horários pré-período (UTC−3, seg–sáb) como redundância; o cron diário da Vercel (plano Hobby = 1×/dia) permanece.
   **Limite conhecido**: no plano Hobby não há agendador de minuto preciso garantido; o GitHub atrasa. Garantia total exigiria Vercel Pro (cron por minuto) ou `pg_cron + pg_net` no Supabase — decisão do dono do produto.

Idempotência / NO-OP: a revalidação nunca recalcula por conta própria; só registra evento quando o estado efetivo mudou (reconciliação) ou quando a invariante é violada sem evento. Checagens
repetidas sem mudança não criam versão. Falha da checagem: registra o erro, não altera o estado (a máquina com Parada aberta continua indisponível — fail closed).

## Cancelamento / exclusão / edição
`ocorrencias_maquina` não tem status de cancelada; pode ser **apagada** (exclusão de funcionário apaga as ocorrências dele) e **editada** (policy permite update direto).
Apagar: a causa some e, se estava aberta, gera `recurso_liberado`. Editar `aberta_em`/`encerrada_em`/`maquina_id`: a causa acompanha; aberta↔encerrada gera o evento correspondente.

## Testes
- Banco: `supabase/tests/escala_parada_maquina.test.sql` (DEV, transação com rollback; nunca em PROD).
- TS: `paradaMaquina.test.ts`, `preChecagem.test.ts`, `indisponibilidadeEfetiva.test.ts`, `revalidarDisponibilidade.test.ts`.

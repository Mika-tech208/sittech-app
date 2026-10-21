# Atraso em aberto (Faltas e Ausências) — implementação em DEV/Preview

Status: **implementado em DEV/Preview. Nada em PROD.** Migration `20261028100000_atraso_em_aberto.sql` aplicada só no DEV (`zjwcomwjmhsloyxfypax`); PROD aguarda autorização.

## 1. Regra
- Atraso em aberto = `funcionário + data + horário inicial`, `horario_fim = NULL`, `em_aberto = true`. Nunca é gravado/mostrado como "07:12–24:00".
- Para conflito de ausências e para a Escala: indisponível de `horario_inicio` **até o fim da jornada daquele dia** (`[início, 17:00)` no banco e no motor; o motor usa o fim do último período do snapshot do dia como limite operacional — nada é gravado enquanto aberto, `horario_fim` segue NULL).
- **Cada dia é independente.** Um atraso nunca é carregado para o dia seguinte: ao fim da jornada (17:00) ele é fechado automaticamente.
- No máximo **um** atraso em aberto por funcionário+data (índice único parcial). Vários funcionários podem estar em aberto ao mesmo tempo.
- Atraso após o almoço é permitido (início 13:00): sem chegada, vale 13:00–17:00 — **não** é falta do dia inteiro.

## 2. Banco (migration aditiva, sem tabela nova, linhas antigas intocadas)
Colunas em `ausencias_funcionarios`: `em_aberto`, `encerrada_por`, `encerrada_em`, `chegada_manual`, `encerramento_automatico`.
Constraints: `ausencia_em_aberto_forma` (em aberto só para `atraso`, com início e sem fim), `ausencia_encerramento_forma`, `ausencia_janela_completa` (NOT VALID: não toca as linhas antigas). Índice `uq_ausencia_atraso_aberto`.
Histórico (`ausencia_funcionario_historico`, append-only): `alterado_por` agora aceita NULL e há `origem` (`usuario`/`sistema`) — o fechamento automático grava como `sistema`.
Funções: `existe_conflito_ausencia` (aberto = `[início, fim da jornada)`), `minutos_produtivos_janela` (duração calculada no banco com a jornada oficial 07:12–12:00 + 13:00–17:00, almoço fora), `jornada_fim_ausencias`, `_agora()` (relógio injetável só para teste: GUC `app.agora_teste`; em produção = `now()`).

RPCs (security invoker, mesma permissão `ausencias_funcionarios`):
| RPC | O que faz |
|---|---|
| `abrir_atraso_funcionario(func, data, início?, obs, chave)` | só hoje (America/Sao_Paulo); início padrão = começo da manhã, ou 13:00; dentro da jornada e ≤ agora; recusa 2º aberto e conflitos; idempotente; histórico "Abertura" |
| `encerrar_atraso_funcionario(id, chegada?)` | `null` = **"Funcionário chegou"**: hora do **servidor** em America/Sao_Paulo (`chegada_manual=false`); informado = `chegada_manual=true`; mesmo dia, > início, ≤ agora, ≤ fim da jornada; duração calculada no banco; `encerrada_por/em`; histórico "Encerramento por chegada" |
| `corrigir_inicio_atraso_aberto(id, início, motivo)` | corrige o horário **inicial** do atraso ainda aberto; motivo obrigatório; usuário, data/hora, antes/depois no histórico; revalida conflito |
| `fechar_atrasos_vencidos()` (público) / `_fechar_atrasos_vencidos(ts)` (interno) | fecha atrasos de dia anterior ou depois do fim da jornada: `horario_fim = 17:00` (não a hora do processamento), `encerrada_em = hora real do processamento` (mesmo que tarde), `encerramento_automatico=true`, sem usuário, histórico `sistema` com "nenhuma chegada foi registrada" |
| `editar_ausencia_funcionario` | recusa atraso em aberto (encerrar/corrigir têm RPC própria) |
| lote | segue recusando atraso |
| `_funcionario_exclusao` | unificação e exclusão de funcionário **bloqueadas** (`ATRASO_EM_ABERTO`) enquanto houver atraso em aberto |

## 3. Fechamento automático (mecanismo)
- Servidor: `/api/escala/drenar` (cron/GitHub Actions a cada ~5 min) chama `fechar_atrasos_vencidos()` **antes** de drenar a outbox, então o evento gerado pelo fechamento é processado na mesma execução. Falha no fechamento nunca impede a drenagem.
- Defesa em profundidade: as RPCs `abrir/encerrar/corrigir` e a listagem de Faltas e Ausências também chamam o fechamento — nenhum atraso vencido aparece como "em aberto".
- O fim efetivo é sempre o fim da jornada (17:00), o `encerrada_em` registra quando o sistema realmente processou, e o histórico mostra que começou aberto e que nenhuma chegada foi registrada.

## 4. Escala
- `montarEntrada`: aberto → janela `[início, fim da jornada do dia)` (17:00 hoje; nunca "dia inteiro" e nunca gravada); fechado → janela exata `[início, chegada)`; `null/null` segue sendo falta (dia inteiro). Regra do motor inalterada: sobreposição com qualquer parte do período = indisponível no período inteiro.
- Eventos: abrir, encerrar, corrigir e fechamento automático são INSERT/UPDATE em `ausencias_funcionarios` ⇒ o trigger existente `trg_escala_evento_ausencia` gera o evento canônico `ausencia` ⇒ recálculo (a fila deduplica pendentes por previsão). Nenhum subsistema paralelo.
- Passado e período em andamento não mudam; o recálculo oficial só altera períodos que ainda não começaram; em sombra/`ativo_restrito` o próximo período é comprometido (reparo mínimo) e a reotimização normal começa em c+2; revezamento duro, versão/hash e concorrência são os do fluxo existente.
- Sombra/hindsight temporalmente correto: `ausencia_funcionario_historico` guarda o estado anterior de cada mudança; `estadoNoCorte` reconstrói a ausência **como era no corte** (snapshot das 08:30 vê o atraso aberto; snapshots posteriores à chegada o veem fechado; idem fechamento automático e correções).

## 5. UX
- Registrar ausência → Tipo **Atraso** → checkbox **"Funcionário ainda não chegou"** (início: manhã 07:12 ou após o almoço 13:00; só hoje).
- Lista: em aberto no topo, em destaque: `João da Silva · Atraso · Desde 07:12 · EM ABERTO · Xh XXmin até agora`, botões **FUNCIONÁRIO CHEGOU** e **INFORMAR HORÁRIO DE CHEGADA**; o detalhe permite **Corrigir horário inicial** (motivo obrigatório).
- Atraso em aberto de dia anterior aparece como inconsistência operacional ("verificar") e continua corrigível — não é o fluxo normal (o fechamento automático o encerra).
- Encerrado automaticamente: a lista/detalhe mostram "encerrado automaticamente no fim da jornada".

## 6. Resultados dos exemplos (testes automatizados; motor real, plano de 10 pessoas)
Linhas presentes do funcionário no dia (ausente = indisponível no período):
| Cenário | Períodos disponíveis |
|---|---|
| aberto desde 07:12 | nenhum (e o dia seguinte intacto) |
| 07:12 → 08:03 | M2, M3, T1, T2, T3 |
| 07:12 → 09:10 | M3, T1, T2, T3 |
| 07:12 → 11:00 | T1, T2, T3 |
| 13:00 → 13:37 | M1, M2, M3, T2, T3 |
| 13:00 aberto (sem chegada) | M1, M2, M3 (não é falta do dia) |
| 07:12 → 17:00 (fechamento automático) | nenhum |
| 13:00 → 17:00 (fechamento automático) | M1, M2, M3 |
Sequência dinâmica (Mundo): abrir às 07:20 → M1 (em andamento) preservado, M2–T3 sem a pessoa; chegou 08:03 → volta a partir de M2; chegou 09:10 → volta a partir de M3; tarde: aberto 13:10 → T1 preservado, T2/T3 sem a pessoa; chegou 13:37 → volta em T2.
SQL: 07:12→08:03 = 51 min; 07:12→08:40 manual = 88 min; 07:12→13:30 = 318 min (almoço excluído); 13:00→13:37 = 37 min; fechamento 17:12 → fim 17:00, `encerrada_em` 17:12; manhã sem chegada = 528 min (jornada toda), tarde sem chegada = 240 min.

## 7. Dia seguinte
Cada dia começa limpo. Nada em aberto é herdado: um atraso aberto de ontem é fechado em 17:00 de ontem (ou na próxima execução do fechamento) e vira registro encerrado de ontem. Hoje o mesmo funcionário pode ter um **novo** atraso (teste "novo atraso no dia seguinte").

## 8. Testes
- SQL: `supabase/tests/escala_adicional_etapa/t15_atraso_em_aberto.sql` (abrir, segundo aberto/índice único, conflito com falta/atestado/saída/janela nos dois sentidos, "chegou agora" com fuso, horário manual, chegada inválida, duração com almoço, histórico, correção do início + motivo obrigatório, edição recusada, lote recusa, unificação/exclusão bloqueadas, eventos `ausencia` (abrir/corrigir/encerrar), fechamento automático 17:00 (16:59 não fecha; 17:12 fecha com fim 17:00), idempotência, dia seguinte, permissões anon/authenticated/service_role). Regressão: `funcionarios_unificacao/t1..t7` e `t14` continuam OK no DEV.
- TS: `src/lib/escala/__tests__/atrasoEmAberto.test.ts` (22) e `src/features/ausencias/__tests__/atrasoAberto.test.ts` (11). Suíte completa: 800 passando; `tsc` limpo.

## 9. Riscos / pontos de atenção
1. **PROD**: a migration precisa ser aplicada **antes** do código (o código lê colunas novas). A leitura da Escala (`supabaseIO`) seleciona `em_aberto` e o histórico; sem a migration a semana não processa. Ordem obrigatória: backup → migration → deploy.
2. **Cadência do fechamento**: depende do cron do `/api/escala/drenar` (~5 min). Até rodar, o fim já é calculado como 17:00 (não a hora real), mas a linha pode ficar "em aberto" por alguns minutos; as telas e RPCs fecham sob demanda, então o risco é só cosmético.
3. **Duração provisória 0** enquanto aberto: o resumo mensal conta o atraso, mas soma 0 min até encerrar (a tela mostra "até agora" só para exibição).
4. **Motor conservador**: o atraso aberto é indisponibilidade até o fim da jornada; se a pessoa chegar, o recálculo devolve os períodos futuros (regra do período inteiro; um atraso que cruza o início de um período o exclui).
5. **`ativo_restrito` (26/10)**: nada nesta mudança altera parâmetros, K, tolerâncias, horizonte ou critérios; mas um atraso aberto durante a semana ativa provoca reavaliação por mudança de hash (comportamento esperado de qualquer ausência).
6. `_agora()` só existe para teste; em produção devolve `now()`.

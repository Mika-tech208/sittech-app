# Atraso em aberto (Faltas e Ausências) — desenho para aprovação

Status: **só desenho**. Nada foi implementado, nenhuma migration aplicada, nada em PROD. O SQL abaixo é rascunho (não está em `supabase/migrations/`).

## 1. Situação hoje (o que foi lido no código)
- `ausencias_funcionarios`: `atraso` guarda `horario_inicio` = início da jornada (snapshot) e `horario_fim` = chegada real; os dois são obrigatórios na prática (a duração é calculada no frontend e a RPC só valida `>= 0`).
- `existe_conflito_ausencia` compara janelas `[inicio, fim)`; com `horario_fim` nulo a comparação vira `NULL` ⇒ **não detecta conflito**.
- Escala (`montarEntrada.ts`): ausência **sem** horário completo vira **dia inteiro**. Um atraso gravado só com início (fim nulo) seria lido como **falta do dia inteiro** — exatamente o que o pedido proíbe (§5). Esta é a principal armadilha do desenho.
- Evento canônico já existe: `trg_escala_evento_ausencia` dispara `ausencia` em INSERT/UPDATE/DELETE → fila `escala_producao_eventos` → recálculo oficial (+ sombra/`ativo_restrito`). Nenhum sistema paralelo é necessário.
- Auditoria já existe: `ausencia_funcionario_historico` (antes/depois, quem, quando, motivo obrigatório), populada em edição.
- A sombra lê a ausência **atual** (filtra por `criado_em ≤ corte`); uma ausência encerrada depois do corte apareceria já fechada no passado — precisa de tratamento (§4).

## 2. Modelo proposto
Atraso em aberto = indisponibilidade **contínua** de `horario_inicio` até o encerramento. Fica explícito por coluna (nunca inferido de `null`):

```sql
-- RASCUNHO (migration futura, aditiva)
alter table public.ausencias_funcionarios
  add column em_aberto boolean not null default false,
  add column encerrada_por uuid references public.usuarios(id) on delete restrict,
  add column encerrada_em timestamptz,
  add column chegada_manual boolean;            -- true = horário informado à mão; false = "chegou agora"; null = não é atraso encerrado

alter table public.ausencias_funcionarios add constraint ausencia_em_aberto_forma check (
  (em_aberto and tipo = 'atraso' and horario_inicio is not null and horario_fim is null and encerrada_em is null)
  or (not em_aberto and (encerrada_em is null or (tipo = 'atraso' and horario_fim is not null))));

-- no máximo UM atraso em aberto por funcionário e dia
create unique index uq_ausencia_atraso_aberto on public.ausencias_funcionarios (funcionario_id, data) where em_aberto;

-- conflito: o fim em aberto vale "até o fim do dia"
create or replace function public.existe_conflito_ausencia(p_funcionario_id uuid, p_data date, p_tipo text, p_horario_inicio time, p_horario_fim time, p_ignorar_id uuid default null)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (select 1 from public.ausencias_funcionarios a
    where a.funcionario_id = p_funcionario_id and a.data = p_data and (p_ignorar_id is null or a.id <> p_ignorar_id)
      and (p_tipo in ('falta_dia_inteiro','atestado','falta_justificada','falta_nao_justificada')
        or a.tipo in ('falta_dia_inteiro','atestado','falta_justificada','falta_nao_justificada')
        or (a.horario_inicio < coalesce(p_horario_fim, time '23:59:59') and coalesce(a.horario_fim, time '23:59:59') > p_horario_inicio)));
$$;
```

RPCs novas (security invoker, mesma permissão `ausencias_funcionarios`, mesmo padrão de idempotência):
- `abrir_atraso_funcionario(p_funcionario_id, p_data, p_horario_inicio default null, p_observacao, p_idempotency_key)`: início padrão = `manha_inicio` da jornada oficial (07:12); aceita `tarde_inicio` (13:00) para atraso após o almoço; exige `data ≤ hoje (SP)` e `agora ≥ início`; checa conflito (falta dia inteiro, atestado, outra janela, outro atraso aberto); grava `em_aberto = true`, `duracao_minutos = 0` (provisória), snapshot da jornada.
- `encerrar_atraso_funcionario(p_ausencia_id, p_horario_chegada default null)`: `null` ⇒ "chegou agora" (hora de São Paulo); informado ⇒ `chegada_manual = true`. Valida `chegada > início` e `chegada ≤ agora` (se a data é hoje). **Duração calculada no banco** (minutos produtivos entre início e chegada dentro do snapshot, sem almoço). Preenche `horario_fim`, `em_aberto = false`, `encerrada_por/em`; grava linha em `ausencia_funcionario_historico` (antes/depois, motivo "Encerramento do atraso em aberto"). Reaplica a regra normal de sobreposição.
- `editar_ausencia_funcionario` (existente): corrige horário de atraso **já encerrado** (motivo obrigatório, histórico, evento). Em atraso aberto só permite observação; encerrar é pela RPC própria.
- `registrar_ausencias_funcionario_lote`: continua recusando atraso (não faz sentido em lote).
- Funcionários (unificação/exclusão): `existe_conflito_ausencia` já cobre o aberto; um atraso aberto bloqueia unificação até ser encerrado (mensagem explícita).

## 3. Eventos e Escala
- **A) abrir, B) encerrar, C) corrigir horário**: são INSERT/UPDATE em `ausencias_funcionarios` ⇒ o trigger atual já gera `ausencia`. Sem tabela, tipo de evento ou worker novos. O hook do frontend já chama `dispararProcessamentoEscala()` após registrar/editar; passa a chamá-lo também em abrir/encerrar.
- Motor (`montarEntrada`): `AusenciaBruta` ganha `emAberto` e `encerradaEm`. Mapeamento: `emAberto` ⇒ janela `[início, 24:00)`; fechado ⇒ janela exata `[início, chegada)`; `null/null` continua sendo dia inteiro (nunca por engano). Qualquer sobreposição com um período torna o funcionário indisponível **naquele período inteiro** (regra atual do motor).
- Regras do horizonte (inalteradas): passado e período em andamento não mudam; recálculo oficial só afeta períodos que ainda não começaram; na sombra/`ativo_restrito` o próximo período é comprometido (reparo mínimo se ficou inviável) e a reotimização começa em c+2.
- Sombra (hindsight): `estadoNoCorte` passa a tratar ausência com `encerradaEm > corte` como **ainda em aberto no corte** (`fim = 24:00`). Correção de horário depois do corte continua só registrada como incerteza (a linha guarda apenas a versão atual; o histórico guarda as anteriores).
- Atraso aberto de **dia anterior**: afeta só a própria data. Nunca é fechado sozinho; a lista mostra "EM ABERTO (dia anterior)" para a Clarice informar a chegada ou trocar o tipo (decisão a confirmar, §7).

## 4. UX (Faltas e Ausências)
- Tipo **Atraso** ⇒ duas opções: "Funcionário ainda não chegou" (cria em aberto, sem campo de horário) e "Informar horário de chegada" (fluxo atual).
- Lista: `Fulano · Atraso · Desde 07:12 · EM ABERTO` + botão **Funcionário chegou** (chegada = agora) e link **Informar horário de chegada**. Sem editar a ocorrência inteira.
- Em aberto aparece no topo e com destaque; duração mostrada como "em andamento (X min até agora)"; resumo mensal conta o atraso em aberto como atraso e soma minutos provisórios só na tela (o banco grava 0 até encerrar).
- Mensagens de conflito reaproveitam as das RPCs (segundo atraso aberto, falta dia inteiro, atestado, janela sobreposta).

## 5. Auditoria
Aberto por/quando: `criado_por/criado_em` + início. Encerrado por/quando/horário real: `encerrada_por/em`, `horario_fim`, `chegada_manual`. Alteração manual posterior: linha em `ausencia_funcionario_historico` (append-only, como hoje). Nenhuma linha é apagada.

## 6. Comportamento nos exemplos (simulação com o motor real; nada gravado)
Funcionário com postos planejados em M1, M3, T1, T3 (plano de 05:00). "Aberto" = janela `[07:12, 24:00)`.

| Cenário | Depois de abrir (07:20) | Depois de encerrar |
|---|---|---|
| Pedido: chega 08:03 (antes de M2) | M1 mantém (período em andamento), M2–T3 sem posto | **volta a ficar disponível a partir de M2**; neste plano o motor o aloca em M3, T1 e T3 (31 linhas futuras recalculadas) |
| Chega 09:10 (depois do início de M2) | idem | indisponível em M2 (a janela sobrepõe 08:48–09:10); **disponível a partir de M3**; neste plano o motor o aloca em T2 e T3 |
| Atravessa vários períodos (chega 11:00) | idem | indisponível em M1–M3 (a janela sobrepõe M3 até 11:00); disponível a partir de T1; o motor o aloca em T2/T3 |
| Correção 08:03 → 09:10 (às 08:20) | — | M2 volta a ficar indisponível; plano com posto só em T2/T3 (42 linhas realocadas) |
| Nunca encerrado | indisponível o dia todo | segue indisponível; nenhum novo evento |
Cada abertura/encerramento/correção realoca dezenas de linhas futuras pelo recálculo oficial (comportamento atual de qualquer ausência, dívida técnica já registrada); com `ativo_restrito` a reavaliação corrige em seguida o que for alterável.

## 7. Casos de teste (a implementar após aprovação)
SQL (`t15_atraso_em_aberto.sql`, em transação desfeita): abre sem fim; segundo aberto recusado; conflito com falta dia inteiro/atestado/janela; encerra "agora"; encerra com horário manual; chegada ≤ início e chegada futura recusadas; duração calculada sem almoço; histórico e `encerrada_*`; lote recusa; unificação bloqueada; evento `ausencia` em abrir/encerrar/corrigir; grants.
TypeScript: mapeamento em aberto ⇒ `[início, 24:00)` e **nunca** dia inteiro; fechado ⇒ janela exata; chegada antes/depois do próximo período; atraso atravessando períodos; correção de horário; Escala sem posto enquanto aberto e com posto após encerrar; replanejamento após abrir e após encerrar; sombra trata encerrada-depois-do-corte como aberta no corte; resumo mensal com atraso aberto; UI (estado, botões, mensagens).

## 8. Migrations necessárias
Uma, aditiva e reversível: colunas + constraint + índice único parcial + `existe_conflito_ausencia` + 2 RPCs + ajuste de `editar_ausencia_funcionario` e do lote. Nenhuma tabela nova, nenhum dado existente alterado (linhas atuais ficam `em_aberto = false`).

## 9. Decisões que preciso de você
1. Atraso aberto **de dia anterior**: manter aberto até alguém resolver (proposto) ou virar falta do dia automaticamente?
2. "Funcionário chegou" sempre usa a hora de São Paulo do servidor; informar horário passado só até o fim da jornada daquele dia — ok?
3. Atraso após o almoço (início 13:00): permitir (proposto) ou só o início da manhã?
4. Pode haver mais de uma pessoa com atraso aberto ao mesmo tempo (sim, uma por funcionário/dia)?

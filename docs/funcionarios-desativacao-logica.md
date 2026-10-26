# Excluir funcionário = DESATIVAR (histórico preservado) — implementação em DEV/Preview

Status: **implementado e validado em DEV/Preview. Nada em PROD.** Migration `20261029100000_funcionarios_desativacao_logica.sql` aplicada só no DEV (`zjwcomwjmhsloyxfypax`).

## 1. Regra
- Um único conceito: **ATIVO / INATIVO** (acabou o "pausado" ⏸/▶ e o "desligado"). Inativo não participa das operações futuras; todo o histórico permanece e o nome continua resolvendo.
- Somente **administrador** desativa/reativa (não há liberação pela permissão `funcionarios`).
- Desativar **nunca apaga** apontamentos, ausências, Escala passada, custos, ocorrências ou auditorias. `previsao_equipe_semana` das semanas futuras vira `produtivo = false` (UPDATE, nunca DELETE).
- Bloqueio `ATRASO_EM_ABERTO`: não desativa enquanto houver atraso em aberto.
- A exclusão física existe **só** para cadastro criado por engano e **sem nenhum vínculo** (`funcionario_remover_vazio`). O caminho destrutivo "excluir sem unificar" saiu da interface e das RPCs públicas; resta a função interna `_funcionario_exclusao` (sem permissão para `authenticated`) para administração de emergência por SQL. **Nenhuma exclusão real foi executada; a exclusão antiga da Luana e `funcionarios_exclusoes_log` não foram tocados.**

## 2. Migration (aditiva)
- `funcionarios`: `desligado_em` (instante **efetivo**), `desligado_por`, `desligamento_registrado_em` (quando o sistema recebeu), `motivo_desligamento`; constraint: só podem estar preenchidos quando inativo.
- **Linha do tempo** `funcionario_situacao_historico` (append-only, bitemporal): `acao` (desativado|reativado), `efetivo_em`, `registrado_em`, `registrado_por`, `motivo`, `ativo_antes`, `ativo_depois`. Sem FK de propósito (a auditoria sobrevive mesmo a uma unificação). UPDATE/DELETE recusados por trigger. Leitura: admin (RLS) e `service_role`.
- `funcionario_ativo_em(id, efetivo, conhecido_ate)`: estava ativo naquele instante, conhecendo só o que foi registrado até `conhecido_ate`? (1) último evento conhecido com `efetivo_em <=` instante; (2) antes de qualquer evento conhecido vale o `ativo_antes` do primeiro; (3) sem eventos (cadastros antigos) vale o `ativo` atual.
- Guarda: `UPDATE funcionarios SET ativo/desligado_*` direto é recusado (`FUNC_USE_RPC`) — inclusive o antigo botão ⏸/▶.
- `funcionarios_elegibilidade` passou a expor `desligado_em` (nomes de inativos continuam resolvendo).

## 3. RPCs
| RPC | O que faz |
|---|---|
| `desativar_funcionario(id, desligado_em?, motivo?)` | admin; trava a linha; idempotente; recusa `ATRASO_EM_ABERTO`; `desligado_em` padrão = agora, aceita instante retroativo (nunca futuro, nunca antes do cadastro/da última mudança); grava `ativo=false`, `desligado_*` e a linha do tempo; nas **semanas futuras** (semana_inicio > segunda-feira de hoje) `produtivo=false`; registra o evento `previsao` das semanas atual/futuras em que a pessoa era produtiva (a outbox deduplica) |
| `reativar_funcionario(id, reativado_em?, motivo?)` | admin; `ativo=true`, zera `desligado_*`, grava a linha do tempo (efetivo + registrado + quem + motivo); **não** recoloca em equipes futuras |
| `funcionario_remover_vazio(id)` | admin; varre TODAS as FKs para `funcionarios` + linha do tempo + log; qualquer vínculo ⇒ `FUNC_TEM_VINCULOS`; sem vínculo ⇒ remove e registra no log (modo `exclusao`) |
| `funcionario_situacao_listar(id)` | admin; linha do tempo para a tela |
| `funcionario_resumo(id)` | passou a informar `vazio`, `atraso_em_aberto`, `desligado_em` |
| `funcionario_exclusao_simular/executar` | **recusam "sem unificar"** (`FUNC_EXCLUSAO_DESCONTINUADA`); unificação inalterada |
| `editar_apontamento_producao`, `converter_apontamento_sem_producao_para_producao` | funcionário inativo HOJE não impede corrigir apontamento antigo DELE; trocar para outro inativo continua proibido |
| `abrir_atraso_funcionario` | recusa funcionário inativo (ausência, lote, apontamento e ocorrência já recusavam) |

## 4. Escala, sombra e `ativo_restrito`
- A Escala oficial lê `funcionarios.ativo` atual: a pessoa sai de qualquer recálculo, o passado e o período em andamento ficam intactos; o comprometido seguinte usa o reparo mínimo já existente (`funcionario_fora_da_equipe`) e c+2 em diante replaneja. Testado no motor (Mundo): M1/M2 idênticos, M3→T3 e o dia seguinte sem a pessoa; reativar não altera o que passou.
- **Sombra sem hindsight:** `estadoNoCorte` reconstrói `ativo` pela linha do tempo **bitemporal** (só vale o que já tinha sido registrado até o corte). Exemplo testado: saiu sexta 17:00, registrado segunda 08:00 — o corte das 07:30 ainda vê a pessoa; o das 09:00 não. `estadoComVersao` + `estadoNoCorte` continuam a ordem de antes.
- Semana 26/10 (`ativo_restrito`): o desligamento gera o evento normal; nenhum parâmetro muda.

## 5. Impacto
- **Custos:** `funcionario_custos`, `faturamentos` e os snapshots vigentes dos apontamentos não mudam; os totais "de ativos" excluem o desligado dali em diante (mesmo efeito do ⏸ antigo). Cadastro de inativo fica somente leitura (salvar apagaria e recriaria os custos extras).
- **Faltas e Ausências:** histórico intacto; nova ausência/atraso para inativo é recusada; o **resumo do período** inclui inativos com registros no período (ou ainda ativos em algum momento dele), nos totais e no denominador de horas previstas.
- **Produção Real:** apontamentos intactos; filtros e nomes já usavam a lista completa; edição de apontamento antigo de inativo passou a funcionar.
- **Previsão:** semanas passadas/atual intactas; futuras com `produtivo=false` (linha preservada, "(inativo)"); não dá para marcar um inativo como produtivo de novo sem reativar.

## 6. Interface (Funcionários)
Filtro **Ativos / Inativos / Todos** (padrão Ativos), selo discreto "Inativo". Para ativo (admin): **DESATIVAR FUNCIONÁRIO** → modal com o texto "Este funcionário será removido das operações futuras, mas todo o histórico de produção, ausências, escalas e custos será preservado.", data/hora efetiva (padrão agora, São Paulo, retroativo permitido), motivo opcional, lista do que é preservado e bloqueio explícito por atraso em aberto. Para inativo: **REATIVAR FUNCIONÁRIO** (efetivo + motivo) e histórico de situação; edição/duplicação ocultas. ⇄ = unificar cadastro duplicado (ou remover cadastro vazio). Nada de "Excluir sem unificar".

## 7. Testes
- SQL: `supabase/tests/funcionarios_unificacao/t8_desativacao_logica.sql` (somente admin; UPDATE direto recusado; ATRASO_EM_ABERTO; desligamento retroativo; registro posterior; linha do tempo bitemporal; equipes futuras `produtivo=false` sem DELETE; hash idêntico do histórico/alocações; edição de apontamento e de ausência antigos de inativo; novas operações recusadas; reativação sem recolocar em equipe; append-only; remoção só de cadastro vazio; exclusão destrutiva descontinuada; unificação separada; log antigo intacto). `t2`, `t7` e `t15` passaram a exercitar a exclusão destrutiva pela função interna (wrappers temporários). Regressão `t1..t7` (funcionarios_unificacao) e `t15` OK no DEV com a migration.
- TS: `desativacaoFuncionario.test.ts`, `situacao.test.ts`, `resumoHistorico.test.ts` (linha do tempo, sombra antes/depois do `desligado_em`, reativação temporal, Escala, filtros, datas de São Paulo, resumo com inativos).

## 8. Publicar em PROD (quando autorizado)
Backup → migration **antes** do código → guard (hash de alocações/apontamentos/ausências/equipe, modos, `escala_replanejamentos`) → deploy → smoke por rollback. PROD hoje: 17 ativos, 0 inativos, 1 exclusão antiga (Luana) no log — a migration não altera nenhuma linha existente.

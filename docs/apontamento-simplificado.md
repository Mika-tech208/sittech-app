# Apontamento simplificado dentro do fechamento do período (Frente 2)

Branch `feat/apontamento-simplificado` (empilhada sobre `feat/fechamento-fisico`, PR #1). **Flag `apontamento_simplificado_modo`, padrão `desligado`**: com ela desligada nada muda
(tela, API e banco se comportam como na branch do fechamento).

## 1. Levantamento do modelo atual (o que existia)

| Tema | Como é hoje |
|---|---|
| Apontamento | `apontamentos_producao`, **1 linha por (máquina, data, período)** (`unique`). `status` = `produzindo` (exige produto, etapa, operação, funcionário, meta, custo) ou `sem_producao` (exige `motivo_sem_producao` ∈ 5 valores grossos; `outro` exige descrição). |
| Quem lança | RPCs `registrar_apontamento_producao[_retroativo]` e `registrar_sem_producao[_retroativo]` (SECURITY INVOKER, `criado_por` = `auth.uid()`), que delegam para `registrar_apontamento_producao_core` / `registrar_sem_producao_core` (período explícito, sem a restrição de "período de hoje ainda não terminou"). A etapa/operação é **derivada** de máquina×produto via `roteiro_etapa_maquinas` (exatamente 1 etapa elegível, senão erro); meta, custo/hora e preço são congelados no insert. |
| "Operador" | `apontamentos_producao.funcionario_id` (1 só). Registro de quem estava no posto, não métrica. |
| Plano oficial do período | `escala_producao_alocacoes` (PK `data, periodo_id, funcionario_id`; **índice único (data, periodo, máquina)** = 1 operador por máquina/período) com produto/etapa/operação/peças. |
| Postos esperados no fechamento | `supabaseFechamento.contexto`: máquinas distintas das alocações do período; status vem dos apontamentos da semana (`escala_sombra_apontamentos`): `pendente` (sem linha) / `produzindo` / `sem_producao`. `validarConfirmacao` bloqueia com `POSTOS_PENDENTES`; `acaoAbrir` devolve `tem_pendentes`. |
| Janela do fechamento | gatilho `trg_apontamentos_producao_fechamento` (só modo físico `ativo`): com a janela aberta, o apontamento do período só pode ser lançado por quem a abriu. |
| Planejado × real | **Não existia**: o plano só vive em `escala_producao_alocacoes`, que pode ser recalculado; nada era guardado do lado do apontamento, nem "posto não planejado". |

### Decisões (a) e (b)

**(a) Precisa de migration?** Sim, uma migration **nova e pequena** (`20261111100000_apontamento_simplificado.sql`, independente da `20261110100000`, não a edita).
O REAL já cabe nas colunas existentes (máquina/operador/produto/quantidades/status/motivo). O PLANEJADO não: ler de `escala_producao_alocacoes` na hora de auditar é frágil (o plano é recalculável) e
`POSTO_NAO_PLANEJADO` + o motivo fino do NÃO PRODUZIU (6 motivos, o CHECK aceita 5 grossos) não têm coluna. Guardar em `observacao` (texto livre) seria hack não consultável. A migration é só aditiva: tabela
`apontamento_planejado_real` + RPC + flag; **nenhuma tabela existente é alterada** (só o gatilho de parâmetros ganha uma saída antecipada para a flag, igual ao que o fechamento fez para a dele).

**(b) Pequena ou relevante?** **Relevante de modelo/API → segunda PR** (nova tabela, nova RPC, nova rota, mudança de tela do tablet). O isolamento é alto (779 linhas em arquivos novos; 2 arquivos
existentes tocados com 18 linhas) mas ela muda o que a supervisora faz no chão e grava dado novo.

## 2. Arquitetura

```
FechamentoPeriodoModal (existente; +17 linhas)
 ├─ PassosFechamento ........ barra 1–6 (visual; estado em passos.ts)
 └─ PassoApontamentos ....... PASSOS 1–2 (UI) ──► GET/POST /api/escala/fechamento/apontamentos
                                                   └─ httpApontamentos.ts (permissão escala_fechamento, flag, parser estrito payload.ts)
                                                      └─ apontamentoSimplificado.ts (IO) ─► RPC registrar_apontamentos_fechamento (com a sessão do USUÁRIO)
supabaseFechamento.contexto (existente; +5 linhas) ─► ajustarPostosDoFechamento (flag ativo: posto programado realizado em outra máquina fica resolvido)
```

Domínio puro em `src/features/producao-real/apontamento-simplificado/` (sem IO): `tipos`, `prefill` (postos programados pela escala), `linhas` (edição imutável), `diff` (planejado × real),
`validacao` (linha/conjunto/completude/payload), `motivos`, `payload` (leitura estrita no servidor), `passos`, `modo`, `api` (cliente), UI.

- **Gravação atômica**: `registrar_apontamentos_fechamento(data, periodo, linhas jsonb)` grava **todas** as linhas numa transação (falha de uma = nada gravado; erro vem com `LINHA[chave]`), reaproveitando as `*_core`
  (elegibilidade, meta, custo e preço **não** foram reimplementados). SECURITY DEFINER, mas `criado_por` vem do `auth.uid()` e exige admin ou `escala_fechamento`/`producao_real_apontamento`; respeita o gatilho da janela
  (testado com janela de outro usuário e do próprio).
- **Reenvio substitui só o que o fluxo criou** (vínculo existente): apaga o apontamento antigo (histórico em `apontamento_producao_historico` com o vínculo anterior) e regrava. Nunca toca em apontamento lançado no painel
  (a tela o mostra bloqueado, "LANÇADO NO PAINEL") e **recusa** se a linha foi editada fora do fluxo (parada manual ou correção).
- **Planejado lido no banco**: o snapshot do posto programado sai de `escala_producao_alocacoes` dentro da RPC, nunca do cliente. Divergências (`MAQUINA/OPERADOR/PRODUTO/OPERACAO`) também calculadas no banco com os dados autoritativos.
- **Contrato do fechamento intacto**: nada mudou em `orquestrador.ts`, `http.ts`, `tipos.ts`, `validacao.ts`. "Apontamentos completos" continua sendo `POSTOS_PENDENTES`/`tem_pendentes` sobre `contexto.postos`; o significado novo
  é obtido porque (i) NÃO PRODUZIU grava `sem_producao` (já conta como coletado) e (ii) a única adição é o ajuste de postos descrito abaixo.

## 3. Modelo de dados — planejado vs real

Tabela `apontamento_planejado_real` (**append-only**: UPDATE bloqueado por gatilho; sem grant de escrita; só some por cascata se o apontamento for excluído):

| Coluna | Conteúdo |
|---|---|
| `data`, `periodo_id` | período |
| `origem` | `PROGRAMADO` \| `POSTO_NAO_PLANEJADO` (**persistido**) |
| `maquina_planejada_id`, `planejado` (jsonb) | **snapshot do plano oficial** no instante do lançamento: máquina, operador, produto, etapa, operação (ids e nomes), peças (+adicional). `null` em posto não planejado. Nunca sobrescrito |
| `apontamento_id` (único), `maquina_real_id`, `real` (jsonb) | o apontamento real e seu snapshot (status, máquina, operador, produto, operação, produzido, refugo, motivo) |
| `divergencias` text[] | subconjunto de `MAQUINA, OPERADOR, PRODUTO, OPERACAO` |
| `nao_produziu`, `motivo_nao_produziu` | motivo fino: `SEM_MATERIAL, PARADA, AUSENCIA, SETUP_REGULAGEM, FALTA_COMPONENTE, OUTRO` |
| `linha_chave`, `criado_por`, `criado_em` | idempotência da linha e auditoria |

**NÃO PRODUZIU → `sem_producao` existente** (o CHECK de 5 motivos não é alterado, indicadores/relatórios continuam funcionando):

| Tela | `motivo_sem_producao` | `descricao_sem_producao` |
|---|---|---|
| Sem material | `falta_material` | — |
| Parada | `outro` | "Parada de máquina[: texto]" |
| Ausência / sem operador | `falta_operador` | — |
| Setup / regulagem | `outro` | "Setup/regulagem[: texto]" |
| Falta de componente | `falta_material` | "Falta de componente[: texto]" |
| Outro | `outro` | texto obrigatório |

## 4. Fluxo (6 passos, dentro do modal de fechamento)

1. **Apontamentos dos postos programados**: só as máquinas do plano oficial daquele período (nunca máquina não programada), pré-preenchidas (operador, produto, operação, peças). Normalmente só `produzido` e `refugo`
   (refugo vazio = 0, igual ao modal de hoje). `NÃO PRODUZIU` + motivo. **Tudo editável**: máquina, operador e produto (a operação é derivada de máquina×produto pelo roteiro); o programado fica visível ao lado e as
   divergências aparecem como etiquetas. Nada bloqueia a edição; só o salvar valida (produto sem etapa na máquina, refugo > produzido, duas linhas na mesma máquina…).
2. **Apontamento extra** (`+ ADICIONAR APONTAMENTO`): produção fora da escala; aceita o real e grava `POSTO_NAO_PLANEJADO`. Extra em branco é ignorada; extra iniciada precisa estar correta.
   `SALVAR APONTAMENTOS` grava o que está pronto (salvamento parcial permitido; postos intocados seguem pendentes).
3. **Inventário intermediário físico** (já existia, inalterado).
4. **Fechar período** (botão só libera com 0 pendentes **no servidor** e sem alterações não salvas).
5. **Recalcular** (já existia). 6. **Nova programação** (já existia).

**Posto programado realizado em OUTRA máquina** (a pessoa trocou a máquina da linha): o posto programado original fica resolvido no fechamento (`sem_producao`, "realizado em X") — senão o fechamento acusaria
pendência de um posto que a pessoa já tratou. Isso é feito por `ajustarPostosDoFechamento` (só com a flag ativa) e o `resumoProducao` do fechamento ganha `apontamento_simplificado` (nº de vínculos, não planejados, divergências).

## 5. Flag, ativação e reversão

- `escala_parametros.apontamento_simplificado_modo` ∈ {`"desligado"` (padrão), `"ativo"`}; CHECK de valores; o gatilho de parâmetros **não** enfileira recálculo por causa dela.
- Desligada: GET devolve só `{modo:"desligado"}`; POST responde 409; a RPC recusa; o modal mostra o fluxo anterior sem a barra de passos (teste de UI).
- Ligar: `update escala_parametros set valor='"ativo"' where chave='apontamento_simplificado_modo'` (depois de aplicar a migration; **depende da `20261110100000`**).
- Reverter: voltar a flag para `"desligado"` (basta); remoção total: `supabase/rollbacks/20261111100000_apontamento_simplificado_ROLLBACK.sql` (arquiva `apontamento_planejado_real_arquivo`; **não toca em nenhum apontamento**).

## 6. TESTES

| Camada | Arquivo | Resultado |
|---|---|---|
| Domínio puro (pré-preenchimento, edição de qualquer campo, planejado preservado e congelado, NÃO PRODUZIU + 6 motivos + mapeamento, POSTO_NAO_PLANEJADO, completude, payload estrito, passos, flag) | `src/features/producao-real/apontamento-simplificado/__tests__/dominio.test.ts` | 35 |
| UI (React Testing Library; API mockada): flag desligada, pré-preenchimento, salvar, editar real, extra, erro; **modal** com flag desligada (fluxo anterior) e ativa (passos + botão só libera após salvar) | `__tests__/ui.test.tsx` | 7 |
| Orquestrador/HTTP: ajuste de postos, `acaoAbrir` (`tem_pendentes`), `acaoConfirmar` (`POSTOS_PENDENTES` 422 sem gravar; fecha com NÃO PRODUZIU/realizado em outra máquina), rotas do apontamento (403/400/409/422/500) | `src/lib/escala/fechamento/__tests__/apontamentoSimplificado.test.ts` | 10 |
| **Banco** (clone local de PROD copiado para um Postgres descartável; migration 2× + teste + rollback + reaplicação) | `supabase/tests/apontamento_simplificado.test.sql` via `scripts/apontamento-simplificado/rodar-teste-db.sh` | 29 verificações ok, termina em ROLLBACK |

`npx vitest run` completo: **1976 passam / 14 falham em 6 arquivos — exatamente as 14 falhas de `origin/main`** (intelligence evals, producao-real desvios/funcionarios/validacao-previsao/visao-geral, relatorios arquivo; baseline medido
antes das mudanças: 1924 passam / 14 falham; +52 testes novos). `tsc --noEmit` limpo; `eslint` limpo nos arquivos novos e tocados; `next build --webpack` (env dummy pedido) compila e lista `/api/escala/fechamento/apontamentos`.

Banco (casos): flag desligada recusa; ligar a flag não enfileira recálculo; lote com 4 linhas (igual ao plano / NÃO PRODUZIU PARADA / operador trocado / extra) → vínculos, divergências, `POSTO_NAO_PLANEJADO`, `criado_por`;
append-only; reenvio substitui e guarda histórico+vínculo; máquina duplicada, posto inexistente, OUTRO sem descrição, motivo inválido, produto inexistente (atomicidade: nada gravado); apontamento do painel preservado;
linha editada fora do fluxo bloqueia o reenvio; usuário sem permissão; janela do fechamento físico aberta por outro usuário recusa e pelo próprio usuário permite.

Verificação visual: harness `/dev/apontamento-simplificado` (não renderiza em produção) + `scripts/apontamento-simplificado/capturas.cjs` (Chrome headless): `docs/apontamento-simplificado/screenshots/01…09`.

### O que NÃO foi testado (honestidade)
- **Não** rodou contra o Supabase real nem contra o PostgREST do clone com JWT de usuário: a camada IO (`criarApontamentosIO`) foi validada só por (i) conferência das colunas/grants das consultas como `service_role` no clone e (ii) fakes. A RPC foi testada direto no Postgres com `request.jwt.claims`.
- Revezamento real de vários funcionários num mesmo posto/período: não há modelo (1 `funcionario_id`).
- Navegador real em tablet físico; apenas harness com dados scriptados.
- Fluxo completo com o fechamento em modo `ativo` + recálculo real (motor) — o orquestrador foi coberto com IO fake; o ensaio completo precisa do clone com a migration aplicada e usuários reais.

## 7. CONFLITOS COM feat/fechamento-fisico

`git diff --name-only origin/feat/fechamento-fisico...HEAD` cruzado com `git diff --name-only origin/main...origin/feat/fechamento-fisico` → **interseção de 2 arquivos** (todo o resto é novo):

| Arquivo (que a branch do fechamento também toca) | O que mudei | Risco |
|---|---|---|
| `src/features/producao-real/fechamento/FechamentoPeriodoModal.tsx` | +13/−4: imports; estado `simplificado`/`naoSalvo`; `<PassosFechamento>` e `<PassoApontamentos>` condicionais; a seção legada "Apontamentos" fica **idêntica** dentro de `simplificado === "desligado"`; `pode` ganha `&& !naoSalvo`. | Conflito textual se a #1 ainda mexer nesse modal. Funcional: com flag desligada o DOM do fluxo anterior é o mesmo (coberto por teste); durante o instante `indefinido` (antes da resposta do GET, ~centenas de ms) aparece "Carregando os postos programados…" em vez da seção legada. |
| `src/lib/escala/fechamento/supabaseFechamento.ts` | +5/−2: `import`; `postos` → `postosBase`; 1 chamada `ajustarPostosDoFechamento(...)` (lê só a flag quando desligada: +1 query leve por `contexto`); `resumoProducao` ganha `apontamento_simplificado` só quando ativa. | Baixo; +1 SELECT em `escala_parametros` por `contexto` mesmo com a flag desligada. |

Não tocados (nem em outra forma): `orquestrador.ts`, `http.ts`, `api.ts`, `leitura.ts`, `tipos.ts`, `validacao.ts`, a migration `20261110100000`, `permissoes.ts`, o harness `/dev/fechamento`. Arquivos novos sem equivalente na #1: toda a pasta `apontamento-simplificado/`,
`apontamentoSimplificado.ts`, `httpApontamentos.ts`, a rota `/api/escala/fechamento/apontamentos`, a migration `20261111100000`, rollback, teste SQL, scripts e o harness novo.

**Dependência de ordem no banco**: a migration nova exige a `20261110100000` aplicada (usa `escala_fechamento_apontamento_permitido` e o padrão de gatilho de parâmetros); aborta com mensagem clara se não estiver. Se a #1 for reformulada (renomear essa função), ajustar a RPC.

## 8. RECOMENDAÇÃO: integrar **DEPOIS** da ativação do fechamento físico (segunda PR)

1. Muda o que a supervisora faz no tablet **e** grava dado novo (tabela + RPC). A ativação de amanhã já carrega risco (primeiro dia do motor lendo o físico); somar uma segunda mudança de comportamento mistura causas se algo sair do esperado.
2. Não é trivialmente isolada: 2 arquivos compartilhados com a #1 (um é a tela principal do fechamento), uma migration dependente da dela e +1 consulta por `contexto`.
3. Nada nela é necessário para a ativação: o fluxo atual (apontar no painel e tocar "Atualizar") continua válido e é o que foi ensaiado (replay de 03/11, ensaio final no dump).
4. Reversível sem custo: flag `desligado` por padrão. Ordem sugerida: ativar o fechamento (#1) → observar 1–2 dias → mergear esta PR com a flag desligada → ensaio com a flag ativa em Preview/clone → ligar no horário de menor risco (fora da troca de período).
Se a decisão for integrar antes, o mínimo seguro é: mergear com a flag desligada (comportamento idêntico, mas a migration e a +1 query já valem em PROD).

## 9. Decisões tomadas por default e perguntas para o Mikael

1. **Revezamento / operador**: o apontamento tem 1 `funcionario_id`. Default: pré-preenche o operador do plano e a pessoa escolhe quem estava no posto (registro, não desempenho); se várias pessoas revezaram, a tela registra uma só. *Pergunta*: registrar mais de uma (exige modelo novo)? Mantém-se "postos primeiro".
2. **Operação editável?** No banco a operação é derivada de máquina×produto (1 etapa elegível). Default: mostrada e atualizada ao trocar máquina/produto, não editável isoladamente. *Pergunta*: precisa realmente trocar a operação mantendo máquina e produto?
3. **Produto/máquina sem etapa cadastrada**: "realidade do chão" bate no limite do cadastro (o banco recusa). Default: a tela explica e a pessoa escolhe outro par; a RPC não grava nada. *Pergunta*: aceitar um apontamento "sem etapa" (relaxar os CHECK) ou exigir o cadastro do roteiro?
4. **Posto programado trocado de máquina** conta como resolvido (não exige NÃO PRODUZIU na máquina original). *Pergunta*: a máquina original deveria exigir motivo?
5. **Refugo vazio = 0** (como o modal atual). *Pergunta*: exigir digitar 0?
6. **Linhas lançadas no painel** são só exibidas (corrigir em Apontamentos realizados, que já audita). Reenvio só substitui o que o fluxo criou.
7. "Parada" mapeia para `outro` (não para `manutencao_programada`): quebra real continua pelo fluxo de ocorrências de máquina.

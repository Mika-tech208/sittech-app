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
   (refugo vazio = 0, igual ao modal de hoje). `NÃO PRODUZIU` + motivo. **Tudo editável**: máquina, operador e produto (a operação é derivada de máquina×produto pelo roteiro); o programado fica visível ao lado e um selo
   discreto "ALTERADO DO PLANEJADO" aparece quando operador, máquina ou produto mudam (sem confirmação extra). Nada bloqueia a edição; só o salvar valida (produto sem etapa na máquina, refugo > produzido, duas linhas na mesma máquina…).
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
| Domínio puro (pré-preenchimento, edição de qualquer campo, planejado preservado e congelado, **selo ALTERADO DO PLANEJADO**, NÃO PRODUZIU + 6 motivos + mapeamento, POSTO_NAO_PLANEJADO, completude, payload estrito, passos, flag) | `src/features/producao-real/apontamento-simplificado/__tests__/dominio.test.ts` | 36 |
| UI (React Testing Library; API mockada): flag desligada, pré-preenchimento, salvar, editar real, **selo ALTERADO DO PLANEJADO (aparece/some, sem confirmação extra)**, **opção "Parada" → motivo fino PARADA**, extra, erro; **modal** com flag desligada (fluxo anterior) e ativa (passos + botão só libera após salvar) | `__tests__/ui.test.tsx` | 9 |
| Orquestrador/HTTP: ajuste de postos, `acaoAbrir` (`tem_pendentes`), `acaoConfirmar` (`POSTOS_PENDENTES` 422 sem gravar; fecha com NÃO PRODUZIU/realizado em outra máquina), rotas do apontamento (403/400/409/422/500; **máquina×produto sem etapa ⇒ 422 com explicação clara, sem ids**) | `src/lib/escala/fechamento/__tests__/apontamentoSimplificado.test.ts` | 10 |
| **Banco** (clone local de PROD copiado para um Postgres descartável; migration 2× + teste + rollback + reaplicação) | `supabase/tests/apontamento_simplificado.test.sql` via `scripts/apontamento-simplificado/rodar-teste-db.sh` | 29 verificações ok, termina em ROLLBACK |
| **Ensaio supabase-js/RPC com JWT de usuário via PostgREST** (clone local; ver 6.1) | `scripts/apontamento-simplificado/ensaio-supabasejs.sh` | 28 PASS / 0 FAIL |

`npx vitest run` completo: **1979 passam / 14 falham em 6 arquivos — exatamente as 14 falhas de `origin/main`** (intelligence evals, producao-real desvios/funcionarios/validacao-previsao/visao-geral, relatorios arquivo; baseline medido
antes das mudanças: 1924 passam / 14 falham; +55 testes novos). `tsc --noEmit` limpo; `eslint` limpo nos arquivos novos e tocados; `next build --webpack` (env dummy pedido) compila e lista `/api/escala/fechamento/apontamentos`.

Banco (casos): flag desligada recusa; ligar a flag não enfileira recálculo; lote com 4 linhas (igual ao plano / NÃO PRODUZIU PARADA / operador trocado / extra) → vínculos, divergências, `POSTO_NAO_PLANEJADO`, `criado_por`;
append-only; reenvio substitui e guarda histórico+vínculo; máquina duplicada, posto inexistente, OUTRO sem descrição, motivo inválido, produto inexistente (atomicidade: nada gravado); apontamento do painel preservado;
linha editada fora do fluxo bloqueia o reenvio; usuário sem permissão; janela do fechamento físico aberta por outro usuário recusa e pelo próprio usuário permite.

Verificação visual: harness `/dev/apontamento-simplificado` (não renderiza em produção) + `scripts/apontamento-simplificado/capturas.cjs` (Chrome headless): `docs/apontamento-simplificado/screenshots/01…09`.

### 6.1 Ensaio da camada supabase-js/RPC (JWT de usuário via PostgREST) — resultado

`scripts/apontamento-simplificado/ensaio-supabasejs.sh` (+ `.ts`): copia o clone local de PROD para o banco descartável `sittech_apont_e2e` (o clone compartilhado **não** recebe a migration), aplica a migration, sobe um PostgREST e um proxy próprios
(3311/3310, mesmo `jwt-secret` do clone lido do arquivo e nunca impresso), emite JWTs HS256 de usuário e roda as camadas **reais** do app: `acaoApontamentos*` → `criarApontamentosIO` → RPC → `criarFechamentoIO.contexto` → `acaoAbrir/acaoConfirmar`.
Desenho idêntico ao de produção: `supabaseAsUser` = anon key + `Authorization: Bearer <jwt do usuário>` para gravar; `service_role` para ler. Aborta se a URL não for local ou se o banco for o `sittech_clone`.

**Resultado (rodado em 03/11, contra o clone local): 28 PASS, 0 FAIL.** Cobriu: JWT aceito pelo PostgREST (`auth.uid()` chega ao banco); flag desligada (estado só `{modo}`, POST 409, RPC recusa via PostgREST); flag ativa: postos = máquinas do plano oficial (12 em 30/10 M1),
catálogo/elegibilidade; salvar 3 linhas numa transação (igual ao plano / NÃO PRODUZIU PARADA / operador trocado) com `criado_por` = usuário do JWT, divergência `OPERADOR`, motivo fino `PARADA` e `sem_producao` legado `outro` + "Parada de máquina";
estado de volta (SALVA_FLUXO, motivo fino volta); contexto REAL do fechamento (motor/estado do clone): 12 postos, 9 pendentes → após completar (um posto realizado em OUTRA máquina) e **reenviar (substitui 3, histórico preservado)**: 0 pendentes e `resumoProducao` com o resumo;
`acaoAbrir` (`tem_pendentes=false`) e `acaoConfirmar` (`POSTOS_PENDENTES` 422 quando falta posto); com o fechamento físico em modo `ativo`: janela aberta por A ⇒ JWT de B recusado pelo gatilho, JWT de A grava; usuário sem permissão recusado; **anon e service_role não executam a RPC**; vínculo append-only também via PostgREST.
Limites do ensaio: não há GoTrue no clone (a validação do token em `autenticarRequisicaoIntelligence`, `admin.auth.getUser`, não é exercitada; o ensaio usa os mesmos clientes que ela produziria); o motor completo de recálculo (confirmação até CONFIRMADO) não foi repetido aqui (coberto pelo e2e do fechamento).

**Antes de ligar `apontamento_simplificado_modo` em PROD**: repetir este ensaio é necessário mas não suficiente; falta rodar em Preview/DEV com login real (GoTrue) e conferir o grant/permissão dos usuários reais (`escala_fechamento`).

### O que NÃO foi testado (honestidade)
- Login real (GoTrue) e Supabase DEV/Preview: só clone local (ver 6.1).
- Revezamento real de vários funcionários num mesmo posto/período: não há modelo (1 `funcionario_id`).
- Navegador real em tablet físico; apenas harness com dados scriptados.
- Confirmação completa até CONFIRMADO (motor de recálculo) com o apontamento simplificado: o ensaio 6.1 chega até a validação (`POSTOS_PENDENTES`/`tem_pendentes`) e o orquestrador foi coberto com IO fake.

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
**Decidido pelo usuário**: não entra antes da ativação de amanhã; ligar a flag só depois do ensaio em Preview/DEV com login real (item 8 da seção 9).
Se a decisão for integrar antes, o mínimo seguro é: mergear com a flag desligada (comportamento idêntico, mas a migration e a +1 query já valem em PROD).

## 9. Decisões do usuário (DECIDIDAS e aplicadas)

1. **Operador**: 1 só por apontamento, pré-preenchido pelo plano e editável. Sem modelo de múltiplos operadores (registro de quem estava no posto, não desempenho; "postos primeiro").
2. **Operação**: continua **derivada** de máquina+produto; sem edição isolada. Ao mudar máquina ou produto a operação é recalculada na hora (exibida na linha); se o par não gera exatamente uma etapa, a linha fica inválida (ver 3).
3. **Máquina×produto sem etapa cadastrada**: o CHECK **não** é relaxado. A tela valida antes e o servidor recusa (422, `PRODUTO_SEM_ETAPA_NA_MAQUINA`, nada gravado) com a explicação: "A combinação real precisa ser tecnicamente válida: escolha outro produto/máquina ou peça o cadastro do roteiro" (sem expor ids).
4. **Posto planejado que produziu em outra máquina**: resolvido pelo próprio apontamento alterado; **não** exige NÃO PRODUZIU na máquina original. Fica guardado PLANEJADO A / REAL B (`planejado` + `real` + `divergencias`, tabela append-only). No fechamento, o posto original aparece resolvido ("realizado em B").
5. **Refugo vazio = 0** (não obriga digitar).
6. **"Parada"** é motivo **resumido** do NÃO PRODUZIU (a ocorrência detalhada segue no módulo de Paradas; não duplica diagnóstico). Aparece como "Parada" na UI e grava `motivo_nao_produziu = 'PARADA'` no registro novo, mesmo que o `sem_producao` legado receba `outro` + "Parada de máquina" (testado em UI, SQL e ensaio).
7. **Selo discreto "ALTERADO DO PLANEJADO"** na linha quando operador, máquina ou produto diferem do plano (tooltip lista o que mudou), **sem confirmação adicional** (um toque para salvar). A operação sozinha não aciona o selo (é consequência). Cobertura: domínio, UI (aparece, some ao voltar ao plano, sem `alertdialog`) e screenshots/harness atualizados.
8. **Sequência**: esta PR **não** entra antes da ativação do fechamento físico de amanhã. Antes de ligar `apontamento_simplificado_modo`: ensaio da camada supabase-js/RPC (feito no clone, 6.1) e repetição em Preview/DEV com login real.

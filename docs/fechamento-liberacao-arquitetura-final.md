# Fechamento Físico + Liberação de escala — arquitetura final (release estrutural única)

Status: **preparada, NÃO publicada** (nada em PROD além do que já estava: PRs #2–#6 de 04/11). Branch `feat/fechamento-liberacao-final` (base `origin/main` 0fcba70 + merge da Frente 2).
Princípio: **corretude > velocidade**. O chão só vê uma programação depois que o estado físico foi fechado, o motor recalculou, o portão HARD aprovou e o plano ficou **vinculado explicitamente** ao fechamento.

## 1. Causa raiz arquitetural dos erros de 04/11

Não foi um bug isolado: foram **três fluxos paralelos sem um dono único**.

| Sintoma | Causa de fundo |
|---|---|
| M1 fechado sem estoque físico | A ativação (migration/flag) era um passo manual do runbook e **não foi feito**; o fluxo legado continuou sendo o único ativo. Nada no sistema distinguia "fechamento ativo" de "fechamento inexistente". |
| M3 apareceu antes do fechamento | "Plano existir" era tratado como "escala liberada". A TV/painel liam `escala_producao_alocacoes` direto; a regra de ocultação vivia **só no JavaScript** (bundle do navegador) e não no banco. |
| 22 máquinas no tablet | A grade do painel nascia das máquinas **ativas** (cadastro), não das **alocações do plano**; falha de carga caía em silêncio no comportamento antigo (fail-open). |
| Pedido de justificativa no estoque | Regras de plausibilidade herdadas (CHECK no banco + diálogos) tratavam o software como mais confiável que a contagem física. |
| Cópias manuais da Frente 2 | O mesmo pré-preenchimento foi reimplementado (PR #3) em paralelo ao da Frente 2 — dois caminhos de apontamento. |

Correção estrutural (esta release): (1) **uma** função de liberação no banco; (2) vínculo **explícito** fechamento→plano; (3) **um** fluxo de apontamentos (Frente 2) e **uma** fonte de postos programados; (4) tudo **fail-closed**; (5) caminhos legados que contradiziam o fluxo novo desativados quando `escala_fechamento_fisico_modo = ativo`.

## 2. Desenho final

```
tablet: abrir janela ─► apontamentos (Frente 2, RPC atômica) ─► estoque físico (todos os buffers; verdade, sem motivo)
        ─► confirmar ─► corte-v1 (inalterado) ─► portão HARD ─► escala_aplicar_recalculo (versões por dia)
        ─► escala_fechamento_resultado('CONFIRMADO', plano_versoes) ──► [MESMA TRANSAÇÃO] escala_fechamento_plano (vínculo imutável)
escala_periodo_liberacao(data, periodo)  ◄── única regra; lida por: RPC da TV, /api/…/postos (Produção Real), /api/…/apontamentos, Escala interna
```

**Liberado ⇔** fechamento oficial do período **anterior** existe ∧ estado `CONFIRMADO` ∧ vínculo `escala_fechamento_plano(fechamento_id, data do período)` ∧ versão atual do dia ≥ versão vinculada. Portão HARD: `CONFIRMADO` só é gravado se o portão aprovou (recusa ⇒ `ERRO_RECALCULO`, sem vínculo). Qualquer dúvida ⇒ **não liberado**. Plano existir no banco nunca libera.

Motivos devolvidos: `TRANSICAO`, `MODO_NAO_ATIVO`, `AGUARDANDO_FECHAMENTO`, `RECALCULANDO`, `ERRO_RECALCULO`, `CONFIRMADO_SEM_PLANO`, `PLANO_DIVERGENTE`, `PERIODO_DESCONHECIDO`, `CONFIRMADO` (+ `vinculo`: `APLICADO` | `INALTERADO` | `BACKFILL_HASH_HORARIO` | `VIRADA_SEMANA`).

## 3. Migrations (nesta ordem)

1. `20261111100000_apontamento_simplificado.sql` (Frente 2; flag `apontamento_simplificado_modo`, padrão **desligado**): tabela append-only `apontamento_planejado_real`, RPC `registrar_apontamentos_fechamento`. Rollback validado.
2. `20261112100000_escala_liberacao_vinculo_explicito.sql`:
   - tabela imutável `escala_fechamento_plano` (+ RLS/grants); `escala_fechamento_resultado` grava o vínculo **na transação do CONFIRMADO** (idempotente, `on conflict do nothing`; sombra e CONFIRMADO sem plano **não** vinculam);
   - **backfill** dos fechamentos já confirmados (M2→M3 e M3→T1 de 04/11) com `BACKFILL_HASH_HORARIO` — só quando a prova antiga (hash aplicado + dia regravado depois) existe;
   - `escala_periodo_liberacao` pelo vínculo (hash vira auditoria); exceção explícita e rotulada `VIRADA_SEMANA` (ver §9);
   - remove o CHECK `escala_fechamento_buffers_motivo`; coluna gerada `diferenca_pct` (a diferença absoluta já existia); motivo OPCIONAL;
   - gate de **UPDATE/DELETE** de apontamento em período em fechamento/fechado (antes só INSERT era barrado); sem usuário autenticado (jobs/service_role) nada muda;
   - `escala_trg_parametros` ignora `escala_liberacao_desde` (não enfileira recálculo).
   Rollback: `supabase/rollbacks/20261112100000_escala_liberacao_vinculo_explicito_ROLLBACK.sql` (arquiva o vínculo, restaura funções originais, não apaga dados).
   Compatível com o código antigo: sem `plano_versoes` no log o vínculo sai como `INALTERADO` com as versões atuais.

## 4. Código (resumo)

- **Frente 2 integrada por merge real** (não mais por cópia): `PassoApontamentos` é o **único** passo de apontamentos do modal; `PostosProgramadosFechamento` e `gravacao.ts` (PR #3) removidos.
- **Uma fonte** de postos programados: `carregarPostosProgramados` (grade do tablet **e** apontamentos do fechamento).
- **Fail-closed**: sem carregar postos ⇒ "NÃO FOI POSSÍVEL CARREGAR OS POSTOS PROGRAMADOS." (sem "usar o painel"); período não liberado ⇒ mesma mensagem; fluxo de apontamento desligado ⇒ "APONTAMENTOS DO FECHAMENTO INDISPONÍVEIS" e **fechar travado**.
- Estoque físico: sem motivo, sem diálogo, sem plausibilidade; `motivoAutomatico` removido (motivo nulo; nada de texto falso).
- Orquestrador devolve `plano_versoes` (versões aplicadas por dia) no log CONFIRMADO.
- **Caminhos legados** (auditoria §5): fechamento legado por tempo/completude não recalcula com fechamento ativo; botão **Gerar** devolve 409 com plano já existente.

## 5. Caminhos legados auditados (resultado)

| # | Caminho | Perigo (fechamento ativo) | Decisão |
|---|---|---|---|
| 2/3 | Fechamento legado por tempo (`aoFechamento`, fim+10 min / 90%) via `/processar`,`/drenar` | SIM | **Desativado** com `ativo` (`sombraSupabase.aoFechamento` devolve null; falha de leitura ⇒ erro) |
| 6 | `/api/escala/gerar` (botão Gerar) regrava plano por relógio | SIM | **409** se a semana já tem plano (semana sem plano ainda pode ser criada) |
| 12/13 | Editar/converter/excluir apontamento de período fechado | SIM | **Gate no banco** (UPDATE/DELETE = mesma regra do INSERT) |
| 9 | `escala_liberacao_desde` enfileirava recálculo | SIM | Early-exit no gatilho |
| 8 | Início de semana (plano de segunda não nasce de fechamento) | SIM | Regra `VIRADA_SEMANA` rotulada — **decisão pendente do usuário** |
| 1/5/7 | Recálculo por evento (ausência, parada, previsão) por relógio | PARCIAL | **Mantido**: replanejamento legítimo sobe a versão e continua liberado; regressão de versão ⇒ `PLANO_DIVERGENTE` (fail-closed) |
| 10 | Replanejamento restrito | PARCIAL | Já tem interlock nas semanas com fluxo ativo; sem alteração |
| 11 | Troca manual de alocação (período não iniciado) | PARCIAL | Aceita (ação manual auditada) |
| 14 | Servidor não valida posto programado nas RPCs do painel | PARCIAL | Aceito: o fluxo do fechamento valida (RPC da Frente 2); painel = exceção explícita |
| 18/19 | Escala interna lê alocações direto; relatório semanal parcial lista planejado de períodos não liberados | PARCIAL | Escala interna rotula "ESTIMADO — NÃO LIBERADO"; **rotular relatório parcial = pendente** |
| 15–17,20–24 | Painel (grade), TV, leituras internas, simulações, scripts, guard de passado | NÃO | Já seguros |

## 6. Testes

- Vitest completo: **2.010 passam / 14 falham** — as mesmas 14 de `origin/main` (intelligence evals, produção-real desvios/funcionários/validação-previsão/visão-geral, relatórios). `tsc` limpo; eslint limpo nos arquivos tocados; `next build --webpack` compila.
- SQL `scripts/fechamento/teste-liberacao-vinculo.sql`: **23/23** (G, J, K, L, M, P, PLANO_DIVERGENTE, sombra, virada de semana, imutabilidade, D e F no banco).
- Banco da Frente 2 (`rodar-teste-db.sh`, 29 verificações) verde com as duas migrations.
- Gate UPDATE/DELETE (clone, dados reais): usuário bloqueado em M3 fechado; permitido em período sem fechamento; sem usuário permitido.
- Retry/idempotência: reenvio da mesma chave e `acaoRetry` não duplicam fechamento nem vínculo.

## 7. E2E completo (clone local de PROD, banco real, camadas reais)

`scripts/fechamento/e2e-ciclo.ts` — **126 PASS / 0 FAIL** em M1→M2, M2→M3, M3→T1, T1→T2, T2→T3 e T3→M1 do dia seguinte. Em cada virada: próximo invisível antes (liberação, RPC da TV, API dos postos); H apontamentos incompletos recusados; apontamentos pelo fluxo único (igual ao plano, NÃO PRODUZIU/PARADA, operador trocado → divergência); I estoque incompleto recusado; físico 0 e ±25% do estimado aceitos sem motivo; portão HARD; vínculo gravado cobrindo o dia seguinte; próximo liberado e visível na TV/API; período seguinte ao próximo segue invisível; retry idempotente. O caminho ERRO_RECALCULO→retry→CONFIRMADO foi provado antes por `scripts/fechamento/e2e.ts` (fechamento físico) e **não foi reexecutado nesta release** (o script faz RESET do clone para a migration antiga); aqui só o retry de CONFIRMADO foi reexecutado.

## 8. Screenshots

`docs/apontamento-simplificado/screenshots/01…11` (harness `/dev/apontamento-simplificado`, dados scriptados): fluxo completo e os novos estados fail-closed (08 fluxo desligado, 10 falha ao carregar postos, 11 período não liberado). **Sem captura de tela autenticada em PROD/DEV** (não há sessão).

## 9. Matriz COMPONENTE | ESTADO | TESTE | RESULTADO

| Componente | Estado | Teste | Resultado |
|---|---|---|---|
| Produção Real (grade só programados, fail-closed) | pronto | UI A/B/C + e2e API postos | verde |
| Apontamento simplificado (fluxo único) | integrado | domínio 36 + UI + HTTP + banco 29 + e2e | verde |
| Modal de fechamento | pronto | UI (bloqueio, B, D/E/F, não liberado) | verde |
| Inventário (físico = verdade) | pronto | dominio + UI D/E/F + SQL D/F | verde |
| API (estado/postos/apontamentos) | pronto | HTTP + e2e | verde |
| corte-v1 | **inalterado** | e2e 6 viradas | verde |
| Portão HARD | **inalterado** | dominio + e2e | verde |
| Vínculo fechamento→plano | novo | SQL L/M/P + e2e | verde |
| Serviço de liberação (função única) | novo | SQL 23 + e2e | verde |
| TV (RPC filtra no servidor) | já em PROD | SQL + e2e | verde |
| Escala interna (rótulo) | já em PROD | UI | verde |
| Retry | pronto | SQL P + e2e | verde |
| Legado desativado (gerar, fechamento por tempo, gate UPDATE/DELETE) | novo | tsc/build + teste de gate | verde (sem teste automatizado do #2/#6 no CI) |
| Rollback | pronto | ensaiado em transação descartável | verde |
| **Ensaio autenticado (login real, GoTrue)** | **PENDENTE** | — | **NÃO FEITO** |

## 10. Plano de deploy (fora do horário produtivo: depois do T3 ou antes das 07:12)

1. Backup: `pg_dump` do schema `public` de PROD + `escala_parametros` + fechamentos (pasta `~/Documents/sittech-rollbacks/<data>-release-final/`).
2. Aplicar `20261111100000` e `20261112100000` (via `supabase db query` no worktree vinculado a PROD, **uma de cada vez**, conferindo cada saída). Conferir: backfill = fechamentos confirmados de hoje; `escala_periodo_liberacao` do período corrente = liberado; TV sem períodos futuros.
3. Setar `apontamento_simplificado_modo = "ativo"` **enquanto o frontend antigo ainda está no ar** (o modal antigo ignora a flag).
4. Merge do PR e deploy (Vercel Production); conferir commit servido e bundle (mensagens novas).
5. Smoke autenticado como a Elizabeth e como admin **antes do próximo fechamento**; observar o primeiro fechamento real (tempo, vínculo `APLICADO`, T+1 visível só depois).

## 11. Rollback

- Frontend: promover o deploy anterior no Vercel (o modal antigo funciona com as migrations aplicadas).
- Banco: `…20261112100000_…_ROLLBACK.sql` e depois `…20261111100000_…_ROLLBACK.sql` (ambos arquivam, não apagam).
- Parcial: `apontamento_simplificado_modo = "desligado"` **trava o fechamento** no frontend novo (por desenho) — usar só junto com o rollback do frontend.

## 12. GO / NO-GO

| Item | Situação |
|---|---|
| Testes automatizados, E2E clone, build, rollback ensaiado | ✅ |
| Backup antes do deploy | ⬜ (executar no dia) |
| **Ensaio com login real (GoTrue) em Preview/DEV: tablet + admin** | ❌ **NO-GO até feito** (a Frente 2 exige; o ensaio local usa JWT forjado) |
| Decisão do usuário: regra de **virada de semana** (§ abaixo) | ❌ pendente |
| Decisão do usuário: bloquear botão **Gerar** (409) e exigir **reabertura** para editar período fechado | ❌ pendente (mudança de comportamento de gestão) |
| Janela de deploy fora do horário produtivo | ⬜ |

### Decisões pendentes

1. **Virada de semana (sexta T3 → segunda M1).** O fechamento da sexta não gera o plano da semana seguinte (outra Previsão). Implementei: libera quando o plano da semana nova foi gravado **depois** do fechamento confirmado, marcado `VIRADA_SEMANA` (é a única exceção ao vínculo explícito). **Precisa confirmar**: (a) a geração semanal de segunda 06:30 lê o inventário físico vigente (não verifiquei no motor); (b) se a semana nova já existir antes do fechamento de sexta, o plano dela é anterior ⇒ **não libera** até ser regerado. Alternativa: o fechamento de T3 de sexta regerar a semana seguinte.
2. **Editar período fechado**: agora exige reabertura do fechamento (UI de reabertura não foi construída; a mensagem do banco orienta).
3. **Botão Gerar** bloqueado com plano existente.

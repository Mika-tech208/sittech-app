# Escala Inteligente (fluxo) — camada de integração (banco + worker)

Núcleo puro: `src/features/escala/fluxo/` (outro pacote). Esta camada liga o núcleo ao recálculo oficial **por flag**, reversível **sem migration**.
Especificação: `docs/escala-fluxo-inteligente-spec.md` (§6 instrumentação/sombra, §8 flag e interlock).

## 1. Peças

| Peça | Onde |
|---|---|
| Migration (aditiva, idempotente, atômica) | `supabase/migrations/20261105190000_escala_producao_real_fluxo.sql` |
| Teste SQL | `supabase/tests/escala_producao_real_fluxo.test.sql` (F1–F12) |
| Leitura tipada dos parâmetros | `src/lib/escala/fluxo/parametrosFluxo.ts` |
| Orquestração pura (ativo/sombra/fallback/registro) | `src/lib/escala/fluxo/integracao.ts` |
| Fechamento de período | `src/lib/escala/fluxo/fechamento.ts` |
| Adaptador Supabase (apontamentos + `escala_fluxo_registrar`) | `src/lib/escala/fluxo/supabaseFluxo.ts` |
| Pontos de entrada | `processar.ts` (processarSemana), `supabaseIO.ts` (carregarEstado/registrarFluxo), `sombraServico.ts` + `sombraSupabase.ts` (fechamento e interlock) |

## 2. Parâmetros (`escala_parametros`) — com portão no banco

| chave | valores | padrão |
|---|---|---|
| `producao_real_modo` | `"desligado"` \| `"sombra"` \| `"ativo"` | `"desligado"` |
| `producao_real_semanas_ativas` | array de segundas-feiras ISO, **nunca anteriores a 2026-10-26** (constraint) | `[]` |
| `producao_real_limiar_estabilidade` | número ≥ 0 (θ, peças finais) ou `null` = padrão do núcleo (v2: θ = 0; a estabilidade vem da re-atribuição de pessoas) | `null` |
| `producao_real_pares_legado` | `ParLegado[]` (Conector 3/4" convencional × automática; Etiquetar e Embalar) | semeado |

**Modo efetivo da semana** = `producao_real_modo` se a semana está em `producao_real_semanas_ativas`; senão `desligado`
(`escala_producao_real_modo_semana(date)`). O código repete a regra (defesa em profundidade) e a RPC de registro recusa fora dela.

**Gatilho de parâmetros** (`escala_trg_parametros`): ao ligar `sombra`/`ativo` grava a versão BASELINE do plano; mudar a flag cria nova versão do plano
(`escala_plano_entrada.parametros.producaoReal`). Pede **recálculo** das semanas com escala futura **somente quando o modo `ativo` participa**
(entrar ou sair; ou mudar semanas/limiar/pares com o modo ativo). `desligado ⇄ sombra` não recalcula (o plano não muda).
O evento de fechamento de período (`apontamento_periodo`) passou a nascer também quando só o fluxo está ligado.

## 3. O que cada modo faz

* **desligado** (padrão): nenhuma leitura extra, o núcleo nunca é chamado, saída byte-idêntica à anterior.
* **sombra**: a cada **recálculo oficial** da semana e a cada **fechamento de período** (fim + 10 min, regra de `fechamento.ts`) calcula `planejarComFluxo`,
  avalia o plano oficial vigente e o plano de fluxo pelo mesmo simulador (`avaliarPlano`), roda `verificarRestricoesDuras` e grava um diagnóstico
  (`escala_fluxo_registrar`, idempotente). **Nunca altera a Escala.** Qualquer falha vira log + diagnóstico `erro`; nunca impede a drenagem.
* **ativo**: o recálculo oficial (eventos **e** fechamento) usa `planejarComFluxo` no lugar de `gerarEscala`, só nas semanas autorizadas. Mantidos: NO-OP do
  plano idêntico, guarda do passado (`ESCALA_CORTE_NO_PASSADO`), retry por conflito de versão. **Fallback**: exceção do núcleo, violação de hard constraint
  (verificador independente) ou linha no passado ⇒ usa o `gerarEscala` oficial e registra `resultado = 'fallback'`. A semana nunca fica sem plano.
  `aplicado = true` só quando o plano gravado é o do fluxo (NO-OP e fallback gravam `aplicado = false`). O resumo do recálculo carrega `resumo.fluxo`.
* **Interlock**: nas semanas com fluxo `ativo`, `processarSombraDoServidor` **não aplica o `ativo_restrito`** (decisão sombra continua gravada; o parâmetro do
  restrito não é alterado; `resumo.interlockFluxo` lista as semanas). Em `sombra` o restrito segue como está.

**Insumos do núcleo (v2)** — `insumosFluxo(estado, entrada, agoraMs)`: o f de desempenho (realizado visível no corte, a mesma regra da sombra; pools fundidos do Conector com f conjunto) é EMBUTIDO nas metas da entrada passada ao núcleo e informado em `opcoes.fatoresEmbutidos`;
`fatorPorPool` não é usado (f é aplicado uma só vez). Plano vigente gravado com f nas peças é avaliado pelas metas, nunca pelas peças. O plano **vigente** é candidato do núcleo: quando nada é estritamente melhor, o plano gravado volta idêntico
(`planoEscolhido = "vigente"`, zero churn; `resultado.alertas` vêm do candidato idêntico às linhas vigentes — o que repete a assinatura de alertas e preserva o NO-OP — ou, se nenhum coincide, do `gerarEscala` sobre a entrada: nesse caso a assinatura pode diferir e só sobe a versão do dia, sem linhas novas). As pessoas são re-atribuídas (`estabilizarPessoas`) para manter o posto vigente.
O registro (`escala_fluxo_diagnosticos`) traz, em `diff` e `replanejamento`: `referencia`, `reconciliacao` (Σ ganhos + resíduo = diferença), `resumoDecisoes` (por pool e por período — cobre 100% das linhas alteradas), `totalDecisoes`, `truncado`, `vigente`, `estabilizacao`, `depoisVigente`.

## 4. Ligar / desligar (SQL exato — rodar em PROD só com autorização)

```sql
-- 1) SOMBRA na semana corrente (nada muda na Escala; só grava diagnósticos)
update escala_parametros set valor = '["2026-10-26"]'::jsonb, atualizado_em = now() where chave = 'producao_real_semanas_ativas';
update escala_parametros set valor = '"sombra"', atualizado_em = now() where chave = 'producao_real_modo';

-- 2) ATIVO (só se os critérios A–J passaram): a Escala dessa semana passa a ser recalculada pelo fluxo no próximo ciclo do worker
update escala_parametros set valor = '"ativo"', atualizado_em = now() where chave = 'producao_real_modo';

-- 3) ROLLBACK (sem migration, sem deploy)
update escala_parametros set valor = '"sombra"', atualizado_em = now() where chave = 'producao_real_modo';     -- ativo -> sombra: o gatilho pede o recálculo; o motor oficial reassume o FUTURO
update escala_parametros set valor = '"desligado"', atualizado_em = now() where chave = 'producao_real_modo';  -- tudo inerte
-- (alternativa cirúrgica: tirar só a semana)  update escala_parametros set valor = '[]'::jsonb where chave = 'producao_real_semanas_ativas';
```
Nota: o passado e o período em andamento são imutáveis; o rollback devolve ao oficial **apenas o futuro**. O histórico de diagnósticos é append-only e permanece.

## 5. Consultas prontas (`escala_fluxo_diagnosticos`; leitura para admin/usuários da Escala)

```sql
-- último diagnóstico de cada semana
select distinct on (semana_inicio) semana_inicio, criado_em, gatilho, modo, resultado, aplicado, corte_data, corte_periodo_id, corte_c, versao_motor
  from escala_fluxo_diagnosticos order by semana_inicio, criado_em desc, seq desc;

-- diff oficial × fluxo (falta final: menor é melhor) por registro
select criado_em, gatilho, modo, resultado,
       (avaliacao_oficial -> 'totais' ->> 'faltaFinalLo')::numeric as falta_oficial,
       (avaliacao_fluxo   -> 'totais' ->> 'faltaFinalLo')::numeric as falta_fluxo,
       (diff -> 'faltaFinalLo' ->> 'delta')::numeric               as delta,
       (diff ->> 'linhasAlteradas')::int                           as linhas_alteradas
  from escala_fluxo_diagnosticos where semana_inicio = '2026-10-26' order by seq;

-- churn por recálculo
select criado_em, gatilho, aplicado, (churn ->> 'linhasAlteradas')::int linhas, (churn ->> 'trocasDePosto')::int trocas,
       (churn ->> 'postosAlterados')::int postos, (churn ->> 'alteradasNoPrimeiroPeriodo')::int primeiro_periodo, (churn ->> 'retidasPorEstabilidade')::int retidas
  from escala_fluxo_diagnosticos where semana_inicio = '2026-10-26' order by seq;

-- violações de hard constraint, erros e fallbacks (critérios A–D)
select criado_em, gatilho, modo, resultado, erro, jsonb_array_length(violacoes) violacoes
  from escala_fluxo_diagnosticos where resultado <> 'ok' or jsonb_array_length(violacoes) > 0 order by seq desc;

-- ANTES / DECISÃO / MOTIVO / DEPOIS de um registro (spec §6)
select replanejamento -> 'antes' as antes, d as decisao_e_motivo, replanejamento -> 'depois' as depois
  from escala_fluxo_diagnosticos, jsonb_array_elements(replanejamento -> 'decisoes') d
 where id = '<uuid>';

-- WIP (confirmado/estimado, lo/hi, confiança) e demanda real × oficial do último registro
select wip -> 'pares' as pares_wip, demanda_oficial -> 'porPool' as rem_oficial, demanda_real -> 'remPorPool' as rem_fluxo
  from escala_fluxo_diagnosticos order by seq desc limit 1;

-- ativo: quantos recálculos aplicaram o fluxo × caíram em fallback × NO-OP, por dia
select (criado_em at time zone 'America/Sao_Paulo')::date dia,
       count(*) filter (where aplicado) aplicados, count(*) filter (where resultado = 'fallback') fallbacks,
       count(*) filter (where resultado = 'ok' and not aplicado and modo = 'ativo') noop
  from escala_fluxo_diagnosticos where modo = 'ativo' group by 1 order by 1;
```

## 6. Runbook de rollback

1. **Sintoma** (violação, fallback frequente, churn alto, plano estranho na Escala): `ativo → sombra` (SQL 3). No próximo ciclo do worker o recálculo oficial reassume o futuro; confira que `resumo.fluxo` não aparece mais nos recálculos novos.
2. Se o problema é o próprio registro (carga no banco): `sombra → desligado`.
3. Se só uma semana está ruim: esvazie `producao_real_semanas_ativas` (as outras seguem).
4. O restrito (`replanejamento_modo = ativo_restrito`) volta a aplicar sozinho nas semanas que saíram do `ativo` do fluxo (nada a religar).
5. Nunca apagar `escala_fluxo_diagnosticos` (imutável por trigger — é a prova do que foi calculado).

## 7. Checklist de smoke

1. Aplicar a migration (após autorização) e rodar `escala_producao_real_fluxo.test.sql` no DEV: F1–F12 `ok`.
2. `select chave, valor from escala_parametros where chave like 'producao_real%'` ⇒ modo `"desligado"`, semanas `[]`, limiar `null`, 1 par legado.
3. Com tudo desligado: um ciclo do worker (`/api/escala/drenar`) ⇒ sem linhas novas em `escala_fluxo_diagnosticos`; resposta sem `sombra.fluxo`.
4. Ligar **sombra** (SQL 1) ⇒ próximo recálculo/fechamento gera linhas `modo = 'sombra'`, `aplicado = false`, `resultado = 'ok'`; a Escala (hash do plano) não muda; `violacoes = []`.
5. Repetir o mesmo cálculo ⇒ não duplica (idempotente).
6. Conferir os critérios A–J da spec §7 pelos diagnósticos + replays. **Só então** SQL 2 (ativo).
7. Ativo: `resultado = 'ok'` e `aplicado = true` em recálculo com mudança; NO-OP sem versão nova; `ativo_restrito` sem aplicar na semana (interlock).
8. Rollback ensaiado (SQL 3) e Escala futura de volta ao oficial.

## 8. Notas de operação

* Apontamentos: a RPC `escala_sombra_apontamentos(date)` já devolve TODAS as linhas da semana (produzindo e sem_producao, `motivo`, `criado_em` = lançamento) — reaproveitada; não há RPC nova de leitura.
* Escrita: somente `escala_fluxo_registrar(jsonb)` (service_role). O portão do banco recusa semana fora da lista, `ativo` sem autorização e `aplicado` sem `ativo`; `gatilho = 'replay'` é isento do portão da semana (histórico, nunca altera a Escala).
* Idempotência: `unique (previsao_id, gatilho, hash_entrada, hash_plano_fluxo, modo)` + `on conflict do nothing`.
* Se a leitura dos apontamentos falhar, a semana segue pelo motor oficial (log `escala/fluxo: apontamentos indisponíveis`).
* Custo: o núcleo roda `gerarEscala` até 1 + 1 + 4 vezes por cálculo, mais estabilização e avaliação de cada candidato e a explicação aditiva; o worker tem `maxDuration = 60 s`. Medido em série com a carga real (docs/escala-fluxo-criterios-ativacao.md §8). Acompanhe a latência do ciclo ao ligar a sombra.

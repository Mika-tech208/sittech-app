# Escala Inteligente (fluxo) — fail-safe de estoque desconhecido e CONTAGEM FÍSICA confirmada

Runbook operacional. Sem migration: a chave `producao_real_contagens_fisicas` é uma linha nova em `escala_parametros` (a tabela aceita qualquer `chave`; só `grupo` é obrigatório e deve ser `operacional` ou `tecnico`). O código tolera a chave ausente (= nenhuma contagem).

## 1. O que existe

### 1.1 Fail-safe (automático, localizado por par)
Um par origem→seguinte vira **ESTOQUE INICIAL DESCONHECIDO** quando, ao mesmo tempo:
(a) não tem saldo confirmado (nem `wip_controle`, nem contagem física), (b) a confiança é `baixa`, (c) o saldo bruto é negativo em algum cenário plausível (`bruto.lo < 0`).
O WIP 0 derivado nesse caso significa "não sei", não "não há material".

Efeito (só nesse par, só no elo seguinte):
* diagnóstico `WIP_INICIAL_DESCONHECIDO` (aviso) com par, bruto e motivo; `pares[].desconhecido = true` em `escala_fluxo_diagnosticos.wip`;
* a física do simulador e o teto de utilidade (Allowed) / demanda de TODOS os nós ficam exatamente como antes;
* os postos do elo seguinte que o plano BASE (`gerarEscala`) aloca em cada período ficam **garantidos** nos candidatos de fluxo (piso na tabela de valor marginal): o WIP 0 derivado não retira a Embalagem do plano;
* pares com confiança média/alta (ex.: Caixa Amarela) e pares com contagem/saldo confirmado **não mudam**.

Alternativa avaliada e NÃO usada: tornar o consumo do elo seguinte ilimitado no simulador, em que o material do par deixa de limitar o consumo do elo seguinte no simulador. Reduz a falta modelada, mas libera produção a montante demais (a Rosqueadeira passa a valer zero e o motor a usa como enchimento, acumulando WIP: +42 mil peças somadas em 12 fechamentos na aresta Rosquear→Parafusar).

É temporário: some sozinho quando o par ganha uma contagem física. Reversão = redeploy do código anterior, ou `failSafeWipDesconhecido: false` nas opções do núcleo (volta ao comportamento anterior, byte-idêntico).

### 1.2 Contagem física
Substitui o estimado do par por um saldo inicial CONFIRMADO no instante da contagem.

Formato (jsonb array) de `producao_real_contagens_fisicas`:

```json
[{ "produtoId": "…", "etapaOrigemId": "…", "etapaSeguinteId": "…", "saldo": 6000,
   "contadoEm": "2026-10-28T06:30:00-03:00", "informadoPor": "Mikael", "observacao": "contagem visual aproximada" }]
```

Regras de validação (item inválido é IGNORADO, com diagnóstico `CONTAGEM_FISICA_IGNORADA`; nunca derruba o recálculo):
* `produtoId`, `etapaOrigemId`, `etapaSeguinteId` obrigatórios; o par precisa existir e ser consecutivo na semana (para o Conector, vale o par do produto convencional ou do automática: é o mesmo elo lógico);
* `saldo` numérico finito `>= 0`;
* `contadoEm` ISO **com fuso** (ex.: `-03:00`); sem fuso o item é ignorado. Até 30 min à frente de "agora" é aceito (tratado como agora); mais que isso = futuro, ignorado. Mais de 2 dias antes do início da semana = ignorado;
* mais de uma contagem do mesmo par: vale a de `contadoEm` mais recente (a outra gera diagnóstico informativo).

Semântica: `saldo` = estoque FÍSICO no instante `contadoEm`.
`WIP(depois) = saldo + Σ boas da origem − Σ boas da seguinte`, somando só a produção **posterior** à contagem, pela regra de lo/hi do não confirmado:
* período que terminou antes da contagem: **nunca entra** (já está no estoque contado, mesmo se for lançado depois);
* período que começa depois da contagem: entra inteiro (confirmado = boas; não confirmado = [0, planejado]);
* período em andamento na hora da contagem: entra só o que for **lançado depois** dela (linhas com `lancadoEm` posterior); se ainda não há lançamento, [0, planejado × fração do período após a contagem].
Piso 0; se ainda ficar negativo mesmo no melhor caso, vale `WIP_NEGATIVO_ESTIMADO`.

Origem `confirmado` (`fonteConfirmacao = contagem_fisica`), confiança **alta** enquanto houver até 6 períodos fechados desde a contagem e nenhuma célula não confirmada desses dois postos depois dela; depois, **média**.

Garantias: não altera apontamentos nem períodos passados; só muda o estoque inicial usado nos períodos futuros. É independente de `wip_controle`/`wip_confirmacoes` (não abate `pool.quantidade`, não passa por `saldosWipConfirmados`): não há contagem dupla. Se o par tiver as duas fontes, a contagem física prevalece.

Recomendação: informe a contagem com `contadoEm` fora de um período em andamento (ex.: antes do 1º período do dia). Contagem feita até 10 min depois do fim de um período ainda não "fechado" pode contar essa produção duas vezes na projeção.

## 2. IDs dos pares (PROD, semana de 26/10)

| Contagem | produtoId | etapaOrigemId | etapaSeguinteId |
|---|---|---|---|
| Caixa: E16 → Montagem | `238ca607-2111-4aff-9a19-a9ae6f20da7e` | `c765eb93-4597-405f-803a-91c7fab9ad8e` | `f75cc037-a579-4e82-b457-3287dbb6f694` |
| Conector 3/4": Etiquetar → Embalar | `27c229d7-f192-41eb-aad1-0c69ece53eba` | `34371af3-2608-42cc-9ded-1f7815a635a8` | `b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4` |
| Conector 3/4": Parafusar → Etiquetar | `27c229d7-f192-41eb-aad1-0c69ece53eba` | `78aaa207-b8cc-412a-8a8b-d17bd95a1930` | `34371af3-2608-42cc-9ded-1f7815a635a8` |

## 3. Informar (upsert — substitui a lista inteira)

Troque os três `saldo` e o `contadoEm` (mantenha o `-03:00`). Uma única instrução; se a chave não existe, cria.

```sql
insert into public.escala_parametros (chave, valor, grupo, descricao)
values (
  'producao_real_contagens_fisicas',
  jsonb_build_array(
    jsonb_build_object('produtoId','238ca607-2111-4aff-9a19-a9ae6f20da7e','etapaOrigemId','c765eb93-4597-405f-803a-91c7fab9ad8e','etapaSeguinteId','f75cc037-a579-4e82-b457-3287dbb6f694',
      'saldo', 0 /* <- Caixa E16→Montagem */, 'contadoEm','2026-10-28T06:30:00-03:00','informadoPor','Mikael','observacao','contagem física aproximada'),
    jsonb_build_object('produtoId','27c229d7-f192-41eb-aad1-0c69ece53eba','etapaOrigemId','34371af3-2608-42cc-9ded-1f7815a635a8','etapaSeguinteId','b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4',
      'saldo', 0 /* <- Conector Etiquetar→Embalar */, 'contadoEm','2026-10-28T06:30:00-03:00','informadoPor','Mikael','observacao','contagem física aproximada'),
    jsonb_build_object('produtoId','27c229d7-f192-41eb-aad1-0c69ece53eba','etapaOrigemId','78aaa207-b8cc-412a-8a8b-d17bd95a1930','etapaSeguinteId','34371af3-2608-42cc-9ded-1f7815a635a8',
      'saldo', 0 /* <- Conector Parafusar→Etiquetar */, 'contadoEm','2026-10-28T06:30:00-03:00','informadoPor','Mikael','observacao','contagem física aproximada')
  ),
  'operacional',
  'Escala Inteligente (fluxo): contagens físicas de estoque entre etapas (saldo no instante contadoEm). Ausente ou [] = nenhuma'
)
on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
```

Para **acrescentar/corrigir um item** sem reescrever os outros, repita a lista completa acima (a instrução substitui o array). Se corrigir um número depois, informe uma contagem mais recente do mesmo par ou reenvie a lista.

Efeito dos gatilhos (verificado nas migrations `20261022100000` e `20261105190000`): a chave casa com `producao_real_%`, então `trg_escala_parametros_evento` registra **um evento de recálculo por previsão com escala futura, a cada INSERT/UPDATE que muda o valor** (UPDATE com valor idêntico não faz nada). Com o modo `ativo` ligado isso é desejado: a escala futura é recalculada logo com a contagem. Passado congelado não é tocado; o recálculo é idempotente (NO-OP se o plano não mudar). `trg_escala_plano_versao` NÃO cria versão de plano para esta chave (ela não está na lista de chaves versionadas); o registro do que foi usado fica em `escala_fluxo_diagnosticos` (`hash_entrada` muda quando há contagem; diagnóstico `CONTAGEM_FISICA_USADA`). Informe as três contagens numa só instrução para gerar um único recálculo.

## 4. Ver o efeito (somente leitura)

Último diagnóstico da semana, pares com contagem e pares ainda desconhecidos:

```sql
select d.criado_em, d.gatilho, d.resultado, d.aplicado,
       (select jsonb_agg(jsonb_build_object('produto', p->>'produtoId', 'origem', p->>'etapaOrigemId', 'fonte', p->>'fonteConfirmacao',
                         'confianca', p->>'confianca', 'wip', p->'wip', 'bruto', p->'bruto', 'contagem', p->'contagem'))
          from jsonb_array_elements(d.wip->'pares') p where p ? 'contagem') as pares_com_contagem,
       (select jsonb_agg(jsonb_build_object('origem', p->>'etapaOrigemId', 'bruto', p->'bruto'))
          from jsonb_array_elements(d.wip->'pares') p where (p->>'desconhecido')::boolean is true) as pares_desconhecidos,
       (select jsonb_agg(x->>'mensagem') from jsonb_array_elements(d.diagnosticos) x
          where x->>'codigo' in ('CONTAGEM_FISICA_USADA','CONTAGEM_FISICA_IGNORADA','WIP_INICIAL_DESCONHECIDO','WIP_NEGATIVO_ESTIMADO')) as mensagens
from public.escala_fluxo_diagnosticos d
where d.semana_inicio = '2026-10-26'
order by d.seq desc
limit 1;
```

Contagem usada = `pares_com_contagem` com `fonte = contagem_fisica`. Se um item foi recusado, a mensagem `CONTAGEM_FISICA_IGNORADA #n` diz o motivo.

## 5. Desfazer

* Apagar todas: `update public.escala_parametros set valor = '[]'::jsonb, atualizado_em = now() where chave = 'producao_real_contagens_fisicas';`
* Remover a chave: `delete from public.escala_parametros where chave = 'producao_real_contagens_fisicas';`
* Remover só um par: reenvie a lista (seção 3) sem o item.

Qualquer um dispara novo recálculo (o gatilho trata a mudança de valor); o par volta ao estimado e, se continuar negativo/baixa, ao fail-safe.

# Escala Inteligente (fluxo) — preservação da atingibilidade da meta semanal

Regra GERAL (nenhum `if produto == ...`) do núcleo `src/features/escala/fluxo/` (`otimizar.ts`, `atingibilidade.ts`, `planejar.ts`, `avaliar.ts`). **Default desligado**: sem a flag a saída é byte-idêntica (golden). A quantidade da Previsão é COMPROMISSO, não referência.

## 1. Formalização

Por **grupo** (cadeia de etapas até um produto final; o Conector fundido tem os dois produtos), com `Q` = meta semanal, `B` = boas finais já entregues (cenário pessimista `lo`), `t` = período:

* **Máximo possível** `M_g(t)` = final alcançável (simulador de fluxo, `lo`) se, a partir de `t` (inclusive), TODAS as máquinas disponíveis de TODAS as etapas trabalharem em TODOS os períodos restantes. WIP/material (contagem física/confirmado + produção upstream, no mesmo período), gargalo upstream, dias e períodos restantes limitam; **pessoas não limitam** (cota superior). Meta **atingível** ⇔ `M_g ≥ Q`; **falta inevitável** = `max(0, Q − M_g)`.
* **Produção obrigatória agora** = `max(0, M_g(t) − alcance com ZERO postos em t)` (restante_final − capacidade_máxima_DEPOIS no último elo isolado).
* **Postos mínimos agora**: menor conjunto de postos por etapa em `t` que mantém `alcance(t, depois no máximo) ≥ M_g(t)`. Último elo isolado: `ceil(max(0, restante − capacidade_máxima_depois) / capacidade_por_posto)` (`postosMinimosUltimoElo`); no fluxo é achado por re-simulação exata (parte do máximo e **poda**: remove postos, etapas finais primeiro, enquanto o alcance se mantém).
* **Prioridade global** quando os mínimos de todos os grupos não cabem nas pessoas/máquinas do período: só metas **atingíveis** reservam postos; ordem = maior falta relativa `(Q−B)/Q`, depois ordem estável. O que sobrar fora vira `META_NAO_ATINGIVEL` (`status = META_EM_CONFLITO`). Metas fisicamente inatingíveis NÃO reservam postos (seguem o ganho de peças finais) e ganham `META_NAO_ATINGIVEL` (`status = META_NAO_ATINGIVEL`, com `maximoPossivel` e `faltaInevitavel`).

## 2. Função objetivo (J)

HARD (disponibilidade, revezamento, 1 pessoa/posto, 1 máquina/período, roteiro, WIP/material) → **1. atingibilidade** (tupla `[nº de metas atingíveis que o plano NÃO entrega, Σ falta evitável/meta]`) → 2. final entregue (falta total) → 3. gargalo → 4–5. WIP → 6. estabilidade (churn). Elegibilidade do candidato: sem violação dura, tier 1 nunca pior que a melhor referência (base / vigente válido) e falta total ≤ referência **a menos que** o tier 1 melhore estritamente. Peças absolutas deixam de decidir sozinhas entre produtos.

Implementação: `varrerContagensPreservando` (por período, cronológico): (1) alvo `M_g(t)` por grupo atingível; (2) postos mínimos (poda); (3) guloso de peças finais com as pessoas que sobram (igual ao anterior); (4) aceita o período só se o déficit de atingibilidade melhora, ou empata e as peças melhoram. `tabelaMarginal(.., minimos)` soma `OFFSET_TIER1 = 1e7` ao valor marginal dos postos mínimos, de modo que o motor (`ordemPostos.valorMarginal`) os escolhe antes de qualquer posto "mais rentável". `gerarEscala` não foi alterado.

## 3. Flag e rollout (sem migration)

`escala_parametros.producao_real_atingibilidade` ∈ {`"desligado"` (padrão/ausente), `"ativo"`} → `OpcoesFluxo.preservarAtingibilidade` (lida em `supabaseIO.ts` → `insumosFluxo`). Só vale onde o fluxo está `ativo` na semana. A chave casa com `producao_real_%`: o gatilho existente pede recálculo a cada mudança de valor (passado e período em andamento são imutáveis).

```sql
-- LIGAR (só com autorização)
insert into public.escala_parametros (chave, valor, grupo, descricao)
values ('producao_real_atingibilidade', '"ativo"', 'operacional', 'Escala Inteligente (fluxo): preserva a atingibilidade das metas semanais (tier 1) antes de maximizar peças finais')
on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
-- ROLLBACK
update public.escala_parametros set valor = '"desligado"', atualizado_em = now() where chave = 'producao_real_atingibilidade';
```

## 4. Diagnóstico

Com a flag: `AvaliacaoPlano.atingibilidade` (por grupo: `meta, restante, maximoPossivel, atingivel, faltaInevitavel, finalPrevisto, faltaEvitavel, status`), `DiagnosticoFluxo.atingibilidade` (`antes` = referência, `depois` = escolhido, `postosMinimos[]` por período/grupo com `alvo, producaoObrigatoria, minimos, noPlano, atendido`), `diagnosticos[]` com `META_NAO_ATINGIVEL` e `POSTOS_MINIMOS_APLICADOS`, e a tupla J com 2 componentes a mais (`iteracoes[].tupla` de 9 em vez de 7).

## 5. Limites conhecidos

* Máximo possível ignora pessoas e a regra de revezamento (cota superior): com revezamento duro, os mínimos podem não caber e o motor corta (diagnóstico `META_EM_CONFLITO`). Integração com o revezamento por bloco (`feat/escala-rev-bloco`) é por merge, sem tocar `rotacao.ts`.
* Os mínimos de um período assumem os períodos seguintes "no máximo"; conflitos futuros entre produtos só aparecem quando o varrimento chega lá (replanejamento a cada fechamento corrige).
* O guloso de peças finais (tier 2) não é ótimo; após satisfazer o tier 1 pode deixar mais WIP no fim da semana (medido no replay de 28/10).
* O replay usa a entrada reconstruída (ausências/paradas do último snapshot), não reproduz byte a byte o plano de PROD.

## 6. Ferramentas

`scripts/escala-fluxo-atingibilidade/`: `buscar.ts` (SELECT em PROD → cache), `replay.ts` (estado real × vigente × flag off × on), `prova.ts` (prova matemática da Caixa), `criterios.ts` (replay das decisões gravadas, flag off × on). Testes: `src/features/escala/fluxo/__tests__/atingibilidade.test.ts` (cenários A–F com dois conjuntos de ids), `src/lib/escala/__tests__/fluxoIntegracao.test.ts` (flag).

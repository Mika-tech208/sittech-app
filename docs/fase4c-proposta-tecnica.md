# Fase 4c — Proposta técnica (para aprovação, NADA implementado)

Escopo: **modo sombra**, só DEV/Preview, sem migration (migrations e trigger são da 4d), sem tela (4e). A 4c entrega **módulos puros e testados** que a 4d vai orquestrar.

## 1. Regras herdadas (congeladas, não mudam na 4c)

Hierarquia, da mais forte para a mais fraca:

1. **Revezamento ergonômico duro** (4a): ninguém repete `operacao_id` em períodos consecutivos do mesmo dia; M3→T1 conta; dia novo zera; sem solução ⇒ posto vazio + alerta; sem exceção manual.
2. **Período comprometido** (4b): protegido contra *otimização*, não contra o item 1. Congelado ≤ c, comprometido c+1, alterável ≥ c+2.
3. **Reparo mínimo do comprometido** (extensão da 4b, `compromisso.ts`): quando o item 1 é violado pela execução real, só se troca **quem** ocupa cada posto; postos, produtos, máquinas e peças ficam; custo lexicográfico: *postos vazios → linhas alteradas → linha manual → uso de ocioso → equidade*.
4. Otimização/recuperação: só do segundo período à frente em diante.

## 2. O que a 4c acrescenta

| Módulo (puro) | Função |
|---|---|
| `producaoReal.ts` | Agrega `apontamentos_producao` **de períodos fechados** em *boas / refugo / meta / n / status* por (período, pool) e por (período, posto): é a única forma como a Produção Real entra no motor. |
| `desempenho.ts` | Ritmo `f` por etapa: `n<3 ⇒ 1`; `n≥3 ⇒ 1 + n/(n+6)·(obs−1)`, `obs = Σboas/Σmeta` limitado a [0,30; 1,30]. Metas futuras × `f`. |
| `execucao.ts` | **Atingibilidade de execução**: restante real por pool, falta prevista (oficial × sombra), gargalo, e as 4 situações A/B/C/D. |
| `sombraCorte.ts` | Orquestra **um corte** (função pura `(entradaCanônica, corteMs) → DecisãoSombra`). A 4d só liga isso ao relógio/worker. |

Nada disso lê o banco; as entradas são agregados que a 4d vai gravar no snapshot (reprodutibilidade).

## 3. Fluxo de um corte (período c fechado)

```
1. Reunir só o que existia no corte: execução (≤ c), ausências/indisponibilidades com criado_em ≤ corte, equipe, previsão.
2. Estado executado ≤ c vem da Produção Real (quem apontou onde). Quem não apontou ⇒ linha sem posto; sem_producao não conta como operação exercida.
3. Avaliar o COMPROMETIDO (c+1) — três perguntas, nessa ordem, sempre sem reotimizar:
     a. conflito de rotação com o executado em c?      → reparo mínimo (já existe)
     b. posto de ausente / fora da equipe / máquina parada? → (ver §4)
     c. nada?                                          → compromisso_valido
   Resultado: comprometido EFETIVO (original ou reparado) + status + alertas. O original fica no snapshot.
4. Restante por pool = previsto − boas reais (≤ c) − produção esperada do comprometido efetivo × f.
5. Replanejar SÓ o alterável (≥ c+2) com o comprometido efetivo como entrada congelada, metas × f, revezamento duro.
6. Atingibilidade de EXECUÇÃO (§5) e RECUPERAÇÃO (§6).
7. Registrar tudo no resultado (que a 4d grava como snapshot append-only).
```

## 4. Reparo mínimo também para ausência/máquina? Recomendação: **SIM, com limites**

Concordo com a tendência: não faz sentido preservar cegamente uma instrução fisicamente impossível. Proposta:

- **Mesmo mecanismo** (`avaliarCompromisso`), mesma função de custo, mesma ordem de status.
- **Funcionário ausente / fora da equipe**: o posto fica *órfão*; entra no problema como posto a cobrir por colegas presentes (troca entre alocados ou ocioso), respeitando o revezamento. Sem cobertura válida ⇒ posto vazio + alerta crítico (`compromisso_nao_reparavel`).
- **Máquina indisponível**: o posto **não pode existir**. Proposta: o posto vira *vazio* e a pessoa liberada pode cobrir um posto órfão (se houver) ou ficar ociosa. **Não** realocar para outra máquina/produto: isso já é reotimizar. (Decisão 1, abaixo.)
- O reparo nunca cria repetição, nunca toca em período ≤ c, nunca escolhe produto/máquina novos.
- Status adicionais: `compromisso_inviavel_reparavel` / `compromisso_inviavel_nao_reparavel` (mesma semântica), separados do replanejamento normal.

## 5. Atingibilidade de execução

Para cada corte: `restante_acabado`, `falta prevista oficial` (plano oficial futuro × ritmo `f`) e `falta prevista sombra` (plano sombra futuro). Tolerância `max(1, 1% do restante)`.

| Situação | Critério |
|---|---|
| **A** programação impossível na origem | atingibilidade de planejamento (Fase 2) já indicava impossível/limite excedido no T0 |
| **B** possível que entrou em risco | T0 atingível, oficial com falta > tolerância, sombra ainda fecha |
| **C** recuperável | oficial com falta, sombra fecha usando só o alterável |
| **D** não mais recuperável | sombra também com falta |

(Nos dados reais: 12/10 = A em todos os 22 cortes; 19/10 = recuperável nos 2 primeiros cortes e D depois.)

## 6. Recuperação (somente a partir de c+2)

Ordem de remoção de capacidade para recuperar o gargalo: **adicional → WIP → antecipação**, nunca previsto de outro produto abaixo do mínimo. Regras: nunca em ≤ c nem em c+1 (nem no reparo), nunca violando rotação, nunca mudando posto de quem já está comprometido. O reparo ergonômico do comprometido **não** é recuperação: é obrigação da regra 1 e não pode ser usado para ganhar capacidade (custo lexicográfico garante).

## 7. Reprodutibilidade

Mesmas entradas canônicas + mesmo passado executado + mesmo comprometido (original **e** reparado) ⇒ mesmo plano sombra e mesmos hashes. O comprometido efetivo é *entrada*, nunca saída reconstruída. Dado tardio não reescreve um corte (já previsto no adendo).

## 8. Testes e medições da 4c

- Unitários: agregação de Produção Real (parcial/atrasada/sem_producao), `f` (n<3, n≥3, limites), restante, situações A–D, comprometido efetivo (válido / reparado / não reparável / inviável por ausência / por máquina), recuperação só ≥ c+2, rotação absoluta, idempotência, determinismo, invariantes.
- Reprocessar 12/10 e 19/10 corte a corte com o pipeline completo (Produção Real + `f` + reparo + atingibilidade) e comparar com a regra anterior.
- Teste de estresse com equipe reduzida (−2/−4/−6) para medir **frequência de reparo não-reparável**, que nas semanas reais não ocorreu.

## 9. Fora da 4c

Trigger/fechamento de período/worker/tabelas (4d), oportunidade teórica de redistribuição e tela (4e), modo ativo, Fase 5, PROD.

## 10. Riscos

- Semanas históricas divergem ~97% do plano oficial (execução manual): servem de estresse, não de previsão.
- Reparo em modo ativo exige comunicar a quem já viu o posto; fora do escopo agora.
- `sem_producao`: tratado como *não exerceu a operação* (para rotação) — precisa de confirmação (Decisão 3).
- Reparo mínimo trata todas as pessoas como equivalentes em produtividade; se houver habilitação por operação no futuro, entra como par proibido.

## 11. Decisões que preciso de você

1. Máquina indisponível no comprometido: posto vira **vazio** (recomendado) ou pode ser realocado para outra máquina equivalente?
2. Ausente no comprometido: aceitar cobertura por **pessoa ociosa** do mesmo período (recomendado)?
3. Linha `sem_producao` (pessoa estava no posto, máquina/sem material) conta como operação exercida para o revezamento?
4. Aprovar `compromisso_inviavel_*` como status separados dos 4 já definidos.
5. Autorizar a sequência: 4c (módulos puros) → parar → 4d.

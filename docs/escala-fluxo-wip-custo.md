# Escala Inteligente (fluxo) — ferramenta de custo operacional do WIP

Ferramenta de ANÁLISE, somente leitura (só `SELECT` em PROD; nada é gravado; `gerarEscala`, `planejarComFluxo` e a função objetivo não são tocados). Código em `scripts/escala-fluxo-wip-custo/`; reaproveita o harness `scripts/escala-fluxo-replay/` (`montarCenario`) e o núcleo `src/features/escala/fluxo/` (`prepararFluxo`, `rodar`/`capsDoPlano` do simulador, `estadoDaProducao`, `avaliarPlano`, `verificarRestricoesDuras`).

## Como rodar

```bash
cd /Users/mikaellonghi/Documents/sittech-app/.worktrees/wip-custo
npx tsx --tsconfig <tsconfig com paths @/*> scripts/escala-fluxo-wip-custo/rodar.ts [opções] [--out arquivo.md]
```

| Opção | Efeito |
|---|---|
| (nenhuma) | seções A–D para "agora" (hora real), plano vigente = `escala_producao_alocacoes` |
| `--agora <ISO com fuso>` | simula o horário (define quais períodos estão fechados e quais apontamentos são visíveis) |
| `--fechamento M1` | acrescenta a seção E (ANTES × REAL × NOVO) do período M1 de `--data` (default: hoje) |
| `--data AAAA-MM-DD` | dia do fechamento |
| `--antes-ate <ISO>` | plano ANTES = última versão de `escala_plano_versoes` válida antes deste instante (default `<data>T08:50-03:00`) |
| `--depois-ate <ISO>` | NOVO = última versão antes deste instante (default: o plano atual de `escala_producao_alocacoes`) |
| `--so A,B,C,D,E` | limita as seções |
| `--cache` | reaproveita os `.out` já buscados (sem tocar PROD) |
| `--semana 2026-10-26` | segunda-feira da semana |

Variáveis: `WIPCUSTO_RODAPROD` (executor de SELECT: `bash <exec> <arq.sql>` grava `<arq.sql>.out` com `{rows:[...]}`; default: scratchpad `rodaprod.sh`) e `WIPCUSTO_CACHE` (diretório de trabalho dos SQL/`.out`). Os modelos SQL estão em `scripts/escala-fluxo-wip-custo/sql/` (`__SEMANA__`, `__SEMANA_FIM__`, `__ANTES_ISO__`, `__DEPOIS_ISO__`); "login role timed out" é repetido automaticamente (até 4 vezes).

Às 09:05 de 28/10/2026 (após o fechamento do M1): `rodar.ts --fechamento M1 --out <arquivo>.md`.

## Como o estado é reconstruído

Entrada = snapshot da última decisão (`escala_sombra_decisoes.entrada`: pools, metas, equipe, ausências/paradas do corte) + apontamentos reais da semana + `escala_parametros` (pares legados, contagens físicas `producao_real_contagens_fisicas`, θ) + plano vigente de `escala_producao_alocacoes`. O f de desempenho é embutido nas metas pela mesma função da integração (`fatoresDeDesempenho`/`embutirFatores`); `aPartirDe` = primeiro período não fechado (fim + 10 min > agora); contagens entram em `DadosProducaoReal.contagensFisicas` (mesmo caminho de `dadosProducaoReal` da integração); não há `wip_controle`. A trajetória é a do simulador do núcleo (`rodar`, cenários `lo` e `hi`), WIP medido ao FIM de cada período.

## Definições (seção A/B/C)

* **WIP atual**: faixa lo–hi do par no início do primeiro período aberto (confirmado por contagem física ou estimado pelos apontamentos).
* **Produção de um período do upstream** = capacidade média do plano (Σ metas×f das linhas do nó origem) nos períodos em que o upstream tem posto. **Capacidade de um período do downstream** = idem no nó destino; se o plano nunca escala o downstream, usa o máximo técnico (máquinas disponíveis × meta). WIP em períodos = WIP ÷ essa capacidade.
* **Pico**: máximo da trajetória `hi` (produção otimista = pior caso de acúmulo) incluindo o instante atual; até o fim do dia de referência e até sexta, com o período do pico.
* **Primeiro período com posto no downstream** = primeiro slot ≥ aberto com capacidade planejada no nó destino. **Primeiro consumo** = primeiro slot em que a simulação consome > 1 peça. **Saldo atual consumido** = quando o consumo acumulado (FIFO) cobre o WIP inicial.
* **Volta a ~0** = primeiro fim de período após o pico em que o WIP ≤ 5% do pico; "não volta até sexta" caso contrário. Horas = horas úteis (soma das durações dos períodos) desde o início do período aberto.
* **Capacidade livre do downstream** (por período, de cada período aberto até sexta; "pós-pico" = períodos após o do pico): *ociosa* = máquinas selecionadas disponíveis (indisponibilidades/inativas descontadas) SEM posto no plano naquele período × meta × f; *teórica* = máquinas disponíveis × meta − consumo planejado (inclui máquinas hoje usadas por outro produto); *garantida por pessoas* = min(máquinas ociosas, pessoas sem posto no período) × meta. A razão de folga usa a **ociosa** (não tira ninguém de outro produto).

### Limiares do risco (fixos no código, `LIMIARES` em `analise.ts`; sem nada por produto)

| Componente | Médio | Alto |
|---|---|---|
| Pico ÷ capacidade técnica de 1 dia do downstream | > 0,5 | > 1,0 |
| Fila = pico ÷ consumo médio por hora útil (consumo planejado do downstream) em turnos (meio dia útil) | > 1 turno | > 2 turnos |
| Ociosa pós-pico ÷ pico | < 1,5 (ajustado) | < 1,0 (risco); ≥ 1,5 = folgado |
| WIP não volta a ~0 até sexta | médio | — |

Risco final = o maior dos componentes (colunas "Risco físico" = tamanho/fila, "Folga" = recuperação). O risco só é avaliado quando pico > 1 peça.

## Seção D — limites candidatos

Para cada par: (i) X × produção/período do upstream, X = 1, 2, 3; (ii) X × capacidade/período do downstream; (iii) T × consumo médio por hora útil do downstream, T = 4 h, 1 turno, 1 dia útil (calculados das durações dos períodos); (iv) 5% e 10% da demanda restante do nó destino (quantidade − boas acumuladas em `aPartirDe`). A tabela mostra o valor de cada limite e se o pico do plano atual até sexta o respeita (OK) ou viola (+excesso e %). Só análise: nada é aplicado ao motor.

## Seção E — `--fechamento Mx`

1. **ANTES**: versão de `escala_plano_versoes` anterior a `--antes-ate`; produção esperada do período por produto/etapa (Σ pecas+pecasAdicional das linhas do período).
2. **REAL**: `apontamentos_producao` do período: por produto/etapa e por máquina (produzindo / sem produção / não confirmado = planejada sem apontamento / fora do plano), boas, refugo, Δ peças e %.
3. **NOVO**: plano atual dos períodos seguintes × ANTES: pessoas-período com posto alterado, de→para (máquina/produto/etapa), churn (trocas, postos distintos, alterações no primeiro período aberto, linhas só com peças diferentes) e, se houver `escala_fluxo_diagnosticos` aplicado com corte ≥ período, suas decisões (`diff.decisoes`: ganho, WIP consumido, texto).
4. Demanda final restante antes × depois (`estadoDaProducao`), WIP por par e pico até sexta antes × depois, falta final prevista (pessimista) do plano antigo no estado de antes, do plano antigo no estado novo ("sem corrigir") e do NOVO plano no estado novo (a diferença é o ganho do replanejamento), gargalos de fluxo antes × depois e violações de restrição dura do novo plano.

## Limites da análise

* Ausências, paradas e equipe vêm do último snapshot de decisão; mudanças posteriores a ele não são vistas (a seção A imprime a contagem de violações do plano vigente contra essa entrada como verificação de sanidade).
* A contagem física de 07:12 é somada ao M1 inteiro simulado a partir de `aPartirDe` = M1 (o núcleo trata a contagem como saldo no início do período aberto); no horário em que o M1 já fechou isso deixa de importar.
* "Capacidade" é de máquinas e metas × f; pessoas só entram na coluna "garantida". Peças por hora são de relógio de período, sem tempo de preparação.
* O pico é o do cenário `hi`; o `lo` é mostrado como faixa. Pares estimados (sem contagem) têm confiança baixa.
* Durante o dia, apontamentos ainda não lançados contam como "não confirmado" (produção em [0, planejado]).

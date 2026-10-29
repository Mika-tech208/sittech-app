# Escala econômica: que dados existem hoje (PROD, 28–29/10/2026)

Investigação **somente leitura** (SELECT em PROD; nenhum custo inventado). Base: `main = 6bb8d3b` (= PROD). Consultas e script de cálculo em `docs/economia-dados-analise/` (q*.sql, calc.py).

## 1. Resposta curta

- **Preço por peça**: existe, é estável e congelado (por item de Previsão e por apontamento). **CONFIÁVEL.**
- **Custo variável por peça** (matéria-prima, embalagem, etiqueta, insumo por peça): **AUSENTE**. Não há tabela nem coluna. O código registra a decisão de negócio: a matéria-prima é do cliente (Tramontina), o preço é de serviço (`economico.ts`). Embalagem/etiquetas/álcool: ninguém modelou consumo por peça.
- **Custo de processo/hora** (R$ 31,92/h): existe e é calculado pela mesma fonte da tela, mas é **100% custo fixo na prática** (folha mensal + custos fixos rateados), idêntico para todas as operações. **Não é custo variável.** Usá-lo na decisão do motor viola a premissa do usuário (sem rateio de fixo).
- **Conclusão**: hoje só dá para usar **RECEITA marginal** (R$/hora). Margem de contribuição verdadeira: **nenhum produto** tem hoje dado confiável. O rótulo na UI/motor deve ser "receita", nunca "lucro" nem "margem".

## 2. Onde cada dado mora

| Dado | Tabela / código | Observação |
|---|---|---|
| Preço cadastral | `produtos.valor_unitario` (vivo) | 11 produtos; última atualização 20–22/10 |
| Preço congelado por semana | `previsao_itens.valor_unitario` (snapshot por item) | Escala já lê: `supabaseIO.ts` → `valorUnitario` |
| Preço congelado por apontamento | `apontamentos_producao.valor_unitario_produto_vigente` | 0 nulos; sem variação de preço desde 08/09 nos 6 produtos |
| Custo/hora por operação | `src/features/custo-hora/calculations.ts` → `calcularCustoHoraEOperacoes` | Mesma fonte da tela. Na branch `origin/feat/escala-producao`: `src/lib/custo/custoHoraDados.ts` (`carregarCustoHora`) |
| Insumos do cálculo | `funcionarios.salario_base` + `funcionario_custos` + `fixed_costs` (ativos) + `configuracoes_empresa.dias_uteis` + `periodos` | Sem vigência (data início/fim): é o estado de hoje |
| Snapshot de custo | `apontamentos_producao.custo_hora_operacao_vigente` (+ custo_operacional/unitario_referencia, GENERATED) | Congela o custo/hora no momento do apontamento |
| Margem por produto (telas) | `calcularMargemProduto` (Produtos/Previsão/Capacidade): `valor − Σ(tempo/peça × custo/hora da etapa)`; `lucroHora = margem / Σ tempo/peça` | Metas por período (`roteiro_etapas.meta_*`) dão o tempo/peça |
| Margem realizada | `indicadores/economico.ts` (`calcularMargemProcessamento`) | Aproximação declarada; receita só na última etapa |
| Custo por rota | `docs/produto-unico-multiplas-rotas-desenho.md` §8 (`origin/feat/escala-producao`) | CONV 0,08117 × AUTO 0,06084 R$/peça: calculados pela mesma fórmula, ilustrativos |
| Faturamento real mensal | `faturamentos` + `receitas` | Total mensal lançado à mão; sem quebra por produto |

Não existe: tabela de insumos/materiais, custo por peça, BOM, custo de máquina ("Decisão 14: sem custo próprio de máquina"), `variable_entries` (a tabela existe e está **vazia** em PROD; é custo pontual mensal, não por peça).

## 3. Como o custo/hora é formado (e por que não serve como custo variável)

Fórmula: `custoHoraEmpresa = (Σ folha ativa + Σ fixed_costs ativos) / (horas/dia dos períodos × dias úteis × nº ativos)`.

Valores de PROD hoje:

| Item | Valor |
|---|---|
| Funcionários ativos | 15 (todos na operação "Produção"; salário base 2.536,77 + encargos/benefícios ≈ 1.566–1.686) |
| Folha mensal (salário + extras) | R$ 62.068,75 |
| Custos fixos ativos | R$ 29.755 (14 linhas: pró-labore 11.500, aluguel 6.600, cartão 3.495, energia 1.200, ferramentas/EPIs 1.150, álcool 900, ... ) |
| Horas produtivas/dia | 8,7167 h (6 períodos); 22 dias úteis → 191,77 h/mês/pessoa |
| **Custo/hora empresa** | **R$ 31,922** = mão de obra 21,578 + rateio de fixos 10,344 |
| Snapshots em apontamentos | 30,17 a 31,92 (varia com o headcount na data) |

Achados que enfraquecem a confiança:

1. **Todas as operações caem no fallback**: só a operação "Produção" tem funcionários; Rosquear, Parafusar, Etiquetar, Embalar, Montar Presilha etc. têm 0. Logo `custoHoraPorOperacao` é vazio para o roteiro e toda etapa usa o mesmo R$ 31,92/h. O custo/hora **não diferencia** postos.
2. Consequência matemática: `lucroHora = receita/h − 31,92` para todo produto. A ordenação "lucro/hora" das telas é **idêntica** à ordenação por receita por hora-operador. A constante não altera nenhuma decisão.
3. Mão de obra CLT de equipe fixa na semana é custo **afundado** para a decisão semanal (não varia com o mix). Fixos, idem. Nenhum dos dois é custo variável.
4. Há linhas que seriam semivariáveis, hoje lançadas como fixo mensal sem direcionador de consumo: álcool (900), ferramentas/EPIs (1.150), energia (1.200). Soma 3.250/mês ≈ **R$ 1,13 por hora-operador** (~3,5% do custo/hora), valor apenas ilustrativo; não atribuível a produto sem medir consumo.
5. Sem vigência: mudar um fixo ou um salário muda o custo de **todas** as semanas retroativamente nas telas (só os snapshots dos apontamentos ficam congelados).
6. Refugo registrado = 0,00% em todos os apontamentos recentes (campo não usado na prática): custo por peça boa = custo por peça produzida.
7. Os "tempos humanos" e as metas são cadastrais/manuais; o optimizer não os estima.

## 4. Os 6 produtos da Previsão 26/10

Premissas: 1 operador por posto; tempo/peça de cada etapa = 1/produtividade; receita/h da cadeia = preço / Σ(1/produtividade das etapas) (receita reconhecida **uma vez** por peça final). Produtividade nominal = Σ metas do dia / 8,7167 h. Real = Σ peças / Σ horas dos apontamentos `produzindo` desde 05/10 (Conector 3/4 desde 19/10, 1.1/4 desde 20/10), todas as máquinas da etapa.

| Produto | Preço (congelado 26/10) | Etapas e produtividade (nominal → real, peças/h) | Receita/h-operador da cadeia (nominal / real) | Custo fixo+folha do sistema/peça (R$ 31,92/h) | "Margem" do sistema (nom.) |
|---|---|---|---|---|---|
| Pino | 0,070 | Parafusar (Pino) 1.239 → 1.376 | **86,7 / 96,3** | 0,0258 | 63% |
| Conector 3/4 AUTO | 0,182 | Rosq+Paraf 817 → 693; Etiq 2.237 → 2.275*; Emb 3.270 → 2.781* | **92,1 / 81,2** | 0,0631 | 65% |
| Caixa Amarela 4x2 | 0,217 | Etiquetar 1.618 → 1.608; Montar Presilha 447 → 439 | **76,1 / 74,8** | 0,0911 | 58% |
| Plug Macho | 0,099 | Parafusar 757 → 703 | **75,0 / 69,6** | 0,0422 | 57% |
| Conector 3/4 CONV | 0,1825 | Rosq 1.239 → 1.086; Paraf 929 → 894; Etiq 2.237 → 2.275; Emb 3.270 → 2.781 | **69,2 / 64,3** | 0,0842 | 54% |
| Conector 1.1/4" | 0,365 | Rosquear 337 → 373; Embalar 175 → 149 | **42,1 / 38,9** | 0,2765 | 24% |

\* Etiquetar/Embalar do produto AUTO não têm apontamento próprio (os apontamentos dessas etapas ficam no produto Conector 3/4 convencional); usei a produtividade real dele como proxy (mesmas máquinas e metas, conforme §15 do desenho de rotas).

Verificação: com os snapshots (~30,8/h) o cálculo reproduz exatamente 0,08117 (CONV) e 0,06084 (AUTO) do documento de rotas.

Receita por hora de **posto** (preço × produtividade da etapa), útil para ver o valor de um posto isolado (não somar entre etapas; duplicaria receita): ex. Caixa: Etiquetar 351 R$/h, Montar Presilha 97 R$/h; Conector CONV: Rosquear 226, Parafusar 170, Etiquetar 408, Embalar 597.

### Classificação por número

| Número | Pino | Plug | Caixa | CONV | AUTO | 1.1/4" | Classe |
|---|---|---|---|---|---|---|---|
| Preço/peça | OK | OK | OK | OK | OK (0,182 vs 0,1825 do CONV: possível arredondamento, confirmar contrato) | OK | **CONFIÁVEL** (preço de serviço manual, estável, congelado) |
| Produtividade nominal | OK | OK | OK | OK | OK | OK | **CONFIÁVEL** (cadastro manual) |
| Produtividade real | 2 máquinas, 112+60 h | 2 máq., 127 h | 5 máq., 650 h | 4 etapas, 103–136 h | só Rosq+Paraf; Etiq/Emb por proxy | 1 máq. por etapa, 31–45 h | CONFIÁVEL (Pino/Plug/Caixa/CONV); **PARCIAL** (AUTO: proxy; 1.1/4": amostra de 1 semana) |
| Receita/h (cadeia) | | | | | | | **CONFIÁVEL** onde preço e produtividade são, **PARCIAL** onde há proxy |
| Custo de mão de obra/peça | | | | | | | **PARCIAL**: é custo médio da empresa (todas as operações iguais) e fixo na semana |
| Custo fixo rateado/peça | | | | | | | **CONFIÁVEL como número, INADEQUADO para a decisão** (rateio proibido pela premissa) |
| **Custo variável/peça** (MP, embalagem, etiqueta, insumo) | | | | | | | **AUSENTE** para os 6 |
| **Margem de contribuição** | | | | | | | **AUSENTE** para os 6 (não calculável sem custo variável) |

## 5. Conclusão objetiva

- **Conseguimos calcular margem de contribuição HOJE com dados confiáveis para: nenhum produto.**
- **Somente receita (R$/h) para: os 6 produtos** (Pino, Conector 3/4 AUTO\*, Caixa Amarela 4x2, Plug Macho, Conector 3/4 CONV, Conector 1.1/4"); \*AUTO com Etiquetar/Embalar por proxy; 1.1/4" com produtividade real de apenas uma semana (nominal é confiável).
- **Faltam**: custo variável por peça (matéria-prima se algum produto não for beneficiamento, embalagem, etiqueta, insumos como álcool, ferramental por peça), confirmação do que a Sittech compra por peça, e (opcional) separação de energia/ferramentas em fixo × variável com direcionador de consumo. Também falta vigência temporal dos custos.
- Ordem por receita/h (nominal): AUTO 92 > Pino 87 > Caixa 76 > Plug 75 > CONV 69 > 1.1/4" 42. Com produtividade real: Pino 96 > AUTO 81 > Caixa 75 > Plug 70 > CONV 64 > 1.1/4" 39. A diferença Pino × AUTO depende da fonte (nominal × real), sinal de que o motor deve usar um parâmetro explícito (nominal, real ou misto), nunca embutido.
- Perguntas ao usuário (decisão dele): (1) A Sittech compra algo por peça (embalagem, etiqueta, fita, álcool)? (2) A folha de 15 CLT é fixa na semana ou há hora extra/temporário variável? (3) Preço do AUTO é 0,182 ou 0,1825?

## 6. Interface proposta (sem implementar)

```ts
type NaturezaEconomica = "receita" | "contribuicao";
interface MargemUnitaria {
  valor: number | null;          // R$ por peça final; null = sem dado
  natureza: NaturezaEconomica;   // hoje sempre "receita"; só vira "contribuicao" com custo variável confiável
  fonte: string;                 // ex.: "previsao_itens.valor_unitario@2026-10-26"
  confiavel: boolean;
  componentes?: { preco: number; custoVariavel: number | null; fonteCustoVariavel: string | null };
  versao: string;                // versão da regra, para a prévia/sombra
}
function margemUnitaria(produtoId: string, semana: string): MargemUnitaria;
```

Regras:

- `valor = preco − (custoVariavel ?? 0)`; se `custoVariavel == null`, `natureza = "receita"` e a UI/PDF rotula "receita", jamais "lucro/margem". O fixo e a folha **nunca** entram (os campos de custo/hora do sistema ficam só informativos).
- Hoje a implementação é trivial: lê `valorUnitario` que o `EntradaEscala` **já tem** (snapshot de `previsao_itens`), então o motor passa a depender da interface sem mudar de insumo.
- O objetivo do motor usa **receita por peça final × peças finais**, sob as mesmas restrições de capacidade/equipe; não somar "preço × produtividade da etapa" entre etapas (conta a receita várias vezes).

Como plugar sem mudar o passado:

1. **Congelar por semana no próprio item**: coluna `previsao_itens.custo_variavel_unitario numeric null` (+ `custo_variavel_fonte text`), preenchida na criação do item (null = desconhecido). Mesmo padrão já usado para o preço. Semana antiga nunca é recalculada.
2. **Fonte do valor vigente**: tabela de versões `produto_custo_variavel_versoes(produto_id, vigente_de, valor, fonte, criado_por)`, append-only; a criação do item copia a versão vigente. Evita editar o cadastro vivo e alterar o passado (limitação já existente em `economico.ts`, que usa preço vivo).
3. **Parâmetro** em `escala_parametros`: `economia_objetivo` = `desligado` | `receita` | `contribuicao` (padrão `desligado`; ativar primeiro em sombra, como feito nas outras frentes) e `economia_produtividade_base` = `nominal` | `real`. Com `contribuicao` e custo variável nulo, o motor cai para `receita` e sinaliza `confiavel=false`.
4. Produto único com rotas (F): `margemUnitaria` é do produto final (um preço); a diferença entre rotas é tempo/peça, não preço (consistente com §8 do desenho de rotas).

## 7. Riscos

- Chamar a receita de "margem/lucro" e ser lido como contribuição: rótulo obrigatório "receita".
- O custo/hora atual não diferencia postos; se alguém cadastrar funcionários por operação, o custo/hora por operação passa a diferir e a ordem das telas deixa de coincidir com receita/h. Mesmo assim, não é custo variável.
- O preço do cadastro é vivo e muda retroativamente nas telas; o motor deve usar sempre o snapshot do item/semana.
- Priorizar por receita/h pode preterir produtos de baixo valor com compromisso de entrega; a otimização econômica não pode quebrar atendimento mínimo (política de prioridades existente).
- Amostras curtas (1.1/4", AUTO) e refugo não registrado inflam a produtividade real.
- Verificações pendentes: nenhuma consulta de escrita foi feita; scripts em `docs/economia-dados-analise/`.

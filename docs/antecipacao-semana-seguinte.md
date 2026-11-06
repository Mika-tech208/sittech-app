# Antecipação para a semana seguinte e formação deliberada de estoque

Status: implementado **somente no clone / branch `feat/antecipacao-semana-seguinte`**. Nada em PROD. Desligado por padrão.
Dois conceitos, uma mesma fase do planejador (corte-v1):

| | **ANTECIPAÇÃO_SEMANA_SEGUINTE** | **FORMAÇÃO_ESTOQUE** |
|---|---|---|
| Quem pode | produto com Forecast confirmado na semana seguinte, **sem** política de estoque | **apenas** produtos com política explícita (`escala_formacao_estoque_produtos`) |
| Teto | **demanda futura líquida** (Forecast − já antecipado). Nunca ultrapassa | **teto físico explícito** (sem teto de Forecast); padrão conservador, configurável por produto |
| Máquinas | interseção Previsão atual × Previsão da semana seguinte | as selecionadas na Previsão **atual** |
| Semana de destino | sempre **desconta** (demanda líquida) | só desconta se `escala_formacao_estoque_desconta_destino = true` (padrão: não; fica visível) |
| Peso no objetivo | 1 × margem | `0,25` × margem (estoque especulativo vale menos que demanda confirmada) |

Fora de ambos, por construção: produtos excluídos (legados do Conector 3/4 / produto único em cutover), produtos encerrados (quantidade 0 na semana atual, p.ex. Caixa 4x2) e qualquer produto sem pool na semana atual. Nenhuma regra por nome de produto ou de pessoa (há teste que varre o código).

## 1. Princípio e onde a regra entra

Prioridade **por construção**, não por peso:

1. **Fase 1** = `planejarFuturo`/`buscaLocal` exatamente como antes, sem conhecer a fase 2. Define os postos da demanda restante da semana, o consumo do WIP atual e o que completa a semana. É a ordem do dono do produto: (1) demanda restante, (2) WIP atual, (3) produção necessária para completar a semana.
2. **Fase 2** (`antecipacao.ts#planejarFase2`, chamada por `planejadorFuturo.ts#comFase2`) só roda **depois**, sobre o que sobrou (máquinas e pessoas). As linhas da fase 1 ficam **fixas** (`ConfigDespacho.fixas`): não são removidas nem movidas, e nelas os pools da demanda produzem primeiro (prioridade mais alta); a fase 2 só **acrescenta** linhas novas, que só servem aos produtos-sombra, e usa a fração ociosa das linhas fixas. Logo a produção da demanda atual **não pode diminuir** (adicionar linha nunca reduz a produção de um pool que não a usa) — provado por teste (`produção − extra = produção sem a regra`, em 40 cenários aleatórios e nos cenários dirigidos).
3. Pessoa sem trabalho fisicamente válido **continua sem posto**: a busca da fase 2 é gulosa (ganho marginal do objetivo do despacho) e uma poda remove qualquer linha acrescentada cuja remoção não reduz o objetivo.

Cada produto elegível vira um **produto-sombra** (mesma rota e taxas; máquinas restritas; estoque próprio):

- `wipInicial` da sombra = **o WIP que a demanda atual nunca toca** (mínimo, depois do consumo do período, do estoque do plano da fase 1 por ligação — `wipNaoTocado`). O WIP existente conta; não se produz upstream desnecessário (teste 8). "Demanda + sombra" é uma cadeia válida porque cada uma só consome o que tem; o agregado é validado pelo validador independente de cadeia.
- Lote de 1 período (Tn → Tn+1) vale como em todo o despacho (teste 10).
- Teto de peças finais da sombra: ver as duas colunas acima. O teto de produção upstream segue `alvo − WIP além da etapa`.

### Função objetivo / pesos
`obj = Σ margem·peças finais (demanda) + crédito de estoque de saída (já existente) + Σ peso·margem·peças finais da sombra + crédito de estoque intermediário da sombra`. Como as linhas da demanda são fixas, os termos da demanda **não variam** durante a busca da fase 2; só os termos da sombra decidem. O peso menor da FORMAÇÃO faz a antecipação confirmada vencer o estoque especulativo quando disputam a mesma pessoa (teste). A margem é a do snapshot `producao_real_planejador_config.margemPorPeca` (ou `valorUnitario`).

### Limites físicos (sem "WIP absurdo")
- **Buffer entre etapas**: nível máximo do estoque da sombra na ligação k = `max(WIP não tocado, capacidade LIVRE do consumidor nos períodos restantes)` + `bufferExtraPecas` (por produto, padrão 0). Capacidade livre = Σ(taxa × máquinas permitidas, períodos t0+1…) − o que a demanda já consome na mesma etapa. Ou seja: nunca se forma mais estoque intermediário do que a etapa seguinte ainda consegue absorver até o fim do horizonte. Quer pré-etiquetar além disso para a semana seguinte? Dê `bufferExtraPecas` explícito na política.
- **Estoque final de FORMAÇÃO**: teto = `tetoPecas` da política (por produto) ou, padrão, `max(quantidade da Previsão atual, Forecast da semana seguinte)` (no máximo ~1 semana de consumo parada). Do teto saem o já formado nos períodos iniciados (ledger) e o **excedente real** da semana (boas − Q, p.ex. Pino 51.780 × 43.200 = 8.580): conta como estoque real, **não é corrigido para baixo**, mas ocupa o teto.
- Capacidade, pessoas, revezamento (bloco + ponte M3→T1) e HARD gates vêm do pipeline existente: a fase 2 passa por `montar` (atribuição de pessoas com revezamento, validação de cadeia, verificador de restrições duras). Se o conjunto não fecha, as linhas acrescentadas são reduzidas uma a uma até valer; no limite devolve o plano da fase 1 **inalterado**.

## 2. Demanda futura líquida e desconto na semana de destino

- Na origem: `tetoFinal = Forecast_futuro − Σ ANTECIPAÇÃO já registrada em períodos iniciados` (linhas futuras do mesmo plano são substituídas, não contam). Só o Forecast **realmente registrado** (`previsao_itens.tipo = 'previsto'`); produto sem Forecast = nada inventado.
- No destino: `carregarEstado` (supabaseIO) lê `escala_antecipacoes` com `semana_destino = esta semana` e reduz `quantidade` dos itens (`aplicarDescontoNosItens`): Pino 54.000 com 8.000 antecipados → o motor enxerga 46.000 (`restante` e `piso` já derivam disso). Independe do modo estar ligado: é fato físico; sem linhas no registro nada muda. O que foi descontado vai para os diagnósticos do recálculo (`ANTECIPACAO_RESUMO`, "DESCONTADA"/"NÃO descontada").
- Quando o total antecipado para uma semana de destino muda, a RPC registra um evento `previsao` para a Previsão de destino (recalcula se ela já tem escala).
- **FORMAÇÃO não desconta por padrão** (decisão do dono: o estoque formado não é erro/excesso e não deve fazer a semana seguinte produzir menos em silêncio). Ligar `escala_formacao_estoque_desconta_destino` faz o estoque formado também reduzir a quantidade; em qualquer caso o diagnóstico mostra o valor e se foi aplicado.
- Antecipação/formação **já executada** (períodos iniciados) é **devolvida ao restante da semana atual** (`planoCorte.restanteDe`): o apontamento não distingue a peça extra da peça da demanda e, sem isso, a peça extra mascararia falta de demanda atual. Conservador: com restante 0 usa só as boas confirmadas.

## 3. Rastreabilidade — `escala_antecipacoes` (append-only)

Migration `20261118100000_antecipacao_semana_seguinte.sql` (aditiva; rollback em `supabase/rollbacks/`). Colunas principais: `origem` (`DEMANDA_SEMANA` | `ANTECIPACAO_SEMANA_SEGUINTE` | `FORMACAO_ESTOQUE`), `semana_origem`, `semana_destino` (ANTECIPAÇÃO: semana cuja demanda foi antecipada; FORMAÇÃO: semana em que o estoque estará disponível — só desconta se decidido), `data`, `periodo_id`, `produto_id`, `etapa_id`, `etapa_idx`, `etapa_final`, `operacao_id`, `maquina_id`, `funcionario_id` (operador), `quantidade`, `plano_hash` (hash das alocações do plano que autorizou), `plano_versao_dia`, `autorizado_em`, `autorizado_por`, `substituida_em`, `substituida_por_hash`.

- Registra a produção **além da demanda** por posto (uma linha por produto × etapa × posto) e, só nos postos mistos, a parte `DEMANDA_SEMANA` (para o "A × B" do posto: `pecas` da linha do plano = demanda + extra). Linhas de postos 100% demanda não entram (evita inflar o ledger); o total por produto = Σ `pecas` do plano − extra.
- **Append-only**: trigger recusa DELETE/TRUNCATE e qualquer UPDATE além de marcar uma linha vigente como substituída. RLS ligada sem políticas, `revoke` de anon/authenticated (só service_role). Sem FKs (auditoria sobrevive a cadastros).
- **Regra de substituição** (`escala_antecipacao_registrar`): regerar o plano marca como `substituida_em` as linhas **vigentes** cujo período é ≥ ao ponto de corte (futuras, não iniciadas) e insere as novas; linhas de períodos já iniciados/fechados **nunca** são tocadas (o corte é o mesmo validado pela RPC do plano, que recusa corte no passado; linha nova em período congelado é recusada). Plano mantido (entrada idêntica) ⇒ registro intocado. Regra desligada ⇒ próximo recálculo substitui as futuras por vazio.
- **Atomicidade**: `escala_aplicar_recalculo_antecipacao` chama a RPC antiga e o registro na mesma transação (plano e registro andam juntos ou nenhum dos dois). Sem registro a gravar, o recálculo usa a RPC de sempre.

## 4. Parâmetros (`escala_parametros`) — nenhum dispara recálculo

| chave | valor | efeito |
|---|---|---|
| `escala_antecipacao_modo` | `"desligado"` (padrão; ausente/desconhecido = desligado) \| `"ativo"` | liga a fase 2 inteira |
| `escala_formacao_estoque_produtos` | lista de `produto_id` ou `{produtoId, tetoPecas?, bufferExtraPecas?}` | política por produto (nunca global); itens inválidos ignorados |
| `escala_formacao_estoque_desconta_destino` | `true` \| `false` (padrão) | formação desconta a semana de destino? |

Seguem o padrão de `escala_liberacao_desde`: `escala_trg_parametros` retorna cedo para essas chaves (a regra vale no próximo recálculo natural). **Desligar = apagar a chave ou `"desligado"`**; com a regra desligada o resultado do plano é **byte-idêntico** ao anterior (teste de golden: `scripts/fechamento/golden-antecipacao.ts` × `golden-antecipacao-base.json`, e `planejarFuturo` sem `antecipacao` ≡ com `antecipacao` vazia em vários cenários).

## 5. Checagens independentes (`checarAntecipacao`) — devem ser 0 para o plano valer

`foraDoDestino` (ANTECIPAÇÃO em máquina fora da interseção), `demandaFuturaUltrapassada` (ANTECIPAÇÃO acima do Forecast líquido), `tetoFisicoUltrapassado` (FORMAÇÃO acima do teto), `produtoProibido` (extra em produto excluído/encerrado/sem política). Além das checagens de sempre (cadeia, material, restrições duras, máquina da Previsão, pessoas, duplicidade, passado). **Produzir além da demanda por FORMAÇÃO não é violação nem "demanda ultrapassada"**; `resultadoDe` mede o corte da demanda só com o que serve à demanda.

## 6. O que NÃO faz (e limitações)

- Não antecipa/forma estoque de produto excluído (Conector 3/4 legado e produto único), encerrado (4x2) ou sem pool na semana atual (rota/metas não estão carregadas para o produto que só existe na semana seguinte).
- **Produto único (semana em PLANEJAMENTO/OPERACIONAL como origem)**: regra desligada na semana (não desdobra o canônico).
- Não usa máquina fora da Previsão (ANTECIPAÇÃO: interseção das duas Previsões; FORMAÇÃO: Previsão atual). Máquina só da semana seguinte nunca entra.
- Não cria estoque se a semana seguinte não tem Previsão salva e o produto não tem política.
- O desconto da semana de destino usa a quantidade **planejada** dos períodos iniciados (o apontamento não distingue extra de demanda); se o operador produzir menos que o planejado o destino fica sub-produzido — risco aceito e conservador do lado da demanda atual (o restante da origem é devolvido), mas não do destino. Refinamento futuro: capar o registro pelo apontado da máquina×período.
- Não corrige o excedente real (ex.: Pino +8.580): só o conta no teto de FORMAÇÃO.
- Busca da fase 2 é gulosa (ótimo local por linha); pares upstream→downstream em dois períodos dependem do crédito de estoque intermediário.
- A atribuição de pessoas é refeita para o conjunto união: as pessoas dos postos da demanda podem trocar de posto em relação ao plano sem a regra (os **postos** da demanda não mudam).
- Em produção real, o ledger registra o **plano**; a conferência plano × apontado fica para a Produção Real.

## 7. Arquivos

`src/features/escala/fluxo/antecipacao.ts` (fase 2, funções puras de regra, descontos) · `planejadorFuturo.ts` (`comFase2`, fusão sombra→produto real em `montar`) · `postosDespacho.ts` (`fixas`, `sombra`, `tetoNivel`, `saidaTetoObj` — todos opcionais/inertes) · `planoCorte.ts` (entrada, restante devolvido, checagens, diagnósticos) · `src/lib/escala/{supabaseIO,processar,estado,montarEntrada}.ts`, `fluxo/parametrosAntecipacao.ts`, `fluxo/integracaoCorte.ts` · `supabase/migrations/20261118100000_*`, `supabase/tests/escala_antecipacao.test.sql` · testes `fluxo/__tests__/antecipacao.test.ts`, `lib/escala/__tests__/antecipacaoIntegracao.test.ts` · ensaio `scripts/fechamento/ensaio-antecipacao.ts`, golden `scripts/fechamento/golden-antecipacao*.{ts,json}`.

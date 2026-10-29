# Escala Inteligente v2 — semana atual + antecipação útil (PROPOSTA OFFLINE/SOMBRA)

> Status: **proposta e protótipo offline**. Nada foi gravado em PROD (só SELECT), nenhuma flag/migration/deploy, rotas não publicadas, equivalências de operação desligadas, estimador de produtividade só como *gerador* de candidato. Produtividade só por **posto** (produto × operação × máquina); a pessoa é escolhida depois. Revezamento por bloco continua HARD. Código novo: `src/features/escala/fluxo/{demandaFutura,proximaSemana,pessoaParada}.ts` (puros, testados em `__tests__/antecipacao.test.ts`, incluídos no contrato "sem funcionarioId" de `contratoSemProdutividadeIndividual.test.ts`). Análise reproduzível: `scripts/escala-fluxo-atingibilidade/rodar-30-10.sh` (foto projetada) e `rodar-30-10.sh --agora 14:35|17:15` (foto real). Números: relatórios em `scratchpad/ating30/analise-30-10-*.md|json` (a PARTE II do relatório é a medida; este documento é a arquitetura).
> ⚠ = baixa confiança.

## 1. Função objetivo revisada
Lexicográfica, nesta ordem (cada nível só decide entre planos empatados — dentro da materialidade — no nível anterior):
0. **Hard constraints** (núcleo + verificador independente): máquina da Previsão e disponível, ausência, revezamento por bloco, passado/período em andamento congelados, sem dupla alocação.
1. **Resultado econômico da semana atual** = receita final (preço congelado do item da Previsão) de produto FINAL entregue, limitada à meta de cada produto. (Lucro-tela, R$ 31,92/h, é só referência.)
2. **Preservar metas atuais economicamente justificáveis** (atingibilidade com custo de oportunidade, k = 2: não gastar R$ 222 para salvar R$ 35).
3. **Reduzir falta atual**; 4. **proteger gargalos atuais**; 5. **consumir WIP necessário**.
6. **Se sobrar capacidade:** maximizar **VALOR_FUTURO** da próxima semana (item 4), dentro do **TETO** (item 5).
7. Evitar WIP excessivo (WIP sem demanda atual nem futura); 8. minimizar churn; 9. equilibrar pessoas (exposição por operação).
**VALOR_ATUAL > VALOR_FUTURO sempre**: uma opção que reduz a receita atual em mais que R$ 0,50 nunca entra por causa do futuro. Não se otimiza por peças, preço isolado, lucro/h local, ocupação, maior meta ou maior WIP.

## 2. Semana atual
Inalterado: o núcleo (`planejarComFluxo`/`avaliarPlano`) com objetivo econômico decide os postos; o **valor do posto ocupado** é medido por remoção com o **resto da semana REPLANEJADO** (nunca com resto fixo, que dá falso zero) e é distinto do valor marginal de +1 pessoa/+1 máquina (+1 pessoa sem outra máquina livre = 0, SATURADO_POR_MAQUINA). Diagnóstico de saturação por posto×período: MAQUINA / PESSOA / DOWNSTREAM / DEMANDA / WIP / TEMPO (`analise-30-10.ts`, tabela (c)).

## 3. Próxima semana
Modelada com **o mesmo motor e avaliador** (`proximaSemana.ts`): `slotsProximaSemana` (dias ativos da Previsão seguinte, mesmos horários), `montarEntradaProximaSemana` (pools = os da Previsão atual com Q = demanda esperada; nada congelado), `avaliarSemanaSeguinte` (planeja e mede receita, lucro, produção por etapa). ⚠ Premissas: equipe e máquinas = as da semana atual (a Previsão seguinte pode ser uma casca sem itens/máquinas — é o caso de 02/11 em 29/10); sem ausências futuras.

## 4. Regra de valor futuro
`VALOR_FUTURO(plano) = R$ final esperado da próxima semana com o WIP de abertura do plano − o mesmo com o WIP de abertura do plano-base (motor)`. A demanda limita (pool.Q = demanda esperada ⇒ peça que a próxima semana não consome vale R$ 0) e a capacidade da próxima semana limita (mesmo simulador). **Monotonia:** o replanejamento é heurístico e pode piorar por ruído; por isso o plano de referência é reavaliado com o novo WIP e vale o MELHOR dos dois. ⚠ Ruído residual do valor futuro: ±R$ 50–400; por isso ele só decide a destinação de capacidade que ficaria ociosa, nunca troca pessoas sozinho.

## 5. Teto de antecipação (geral, sem hardcode por produto)
Demanda futura por produto (`demandaFutura.ts`), fontes em ordem: (a) Previsão da próxima semana (se tiver **itens**; uma casca vazia não conta), (b) pedido/demanda conhecida, (c) histórico recorrente das Previsões das últimas 6 semanas, (d) configuração explícita de produto recorrente. Histórico: `mediana(últimas ≤3 ocorrências) × frequência desde a 1ª aparição × maturidade min(1, ocorrências/3) × dias produtivos/5`; ausente nas 2 últimas semanas = descontinuado (0). Em PROD (29/10): Previsão 2026-11-02 existe mas **sem itens e sem máquinas** (equipe 16, dias ativos 03–06/11; 02/11 inativo); histórico 6 semanas: Caixa 6/6, Pino 6/6, Plug 4/5, Conector Conv 3/3 (desde 12/10), Conector Autom 4/6 ⚠, Conector 1.1/4" 1/1 ⚠ (1 semana). Luva 3/4" e Conector 2" saíram (ausentes nas 2 últimas semanas).
**Teto por par** (origem→seguinte): `max(0, min(demanda do produto no par, capacidade do destino na próxima semana) − WIP já existente)`. Antecipação acima do teto vale R$ 0 e é rejeitada. Produto **final** não é antecipado (peça final entra no realizado da semana atual: acima da meta atual não conta; ⚠ premissa a confirmar com o negócio).

## 6. Transição de WIP entre semanas
O WIP **não é zerado** na virada. O saldo final por par vira **contagem de abertura** (`contagensDeAbertura`: produto, etapa origem/seguinte, saldo, instante da virada, origem "simulação"/"contagem física", confiança). Na abertura o estado lê o saldo exato (lo = hi) e a próxima semana planeja menos produção upstream. **Teste de transição (simulado, sexta 30/10 T3 → terça 03/11 M1):** saldo simulado = saldo lido em 100% dos pares com demanda futura; pares de produto sem demanda futura aparecem como WIP **órfão** (alerta). ⚠ Saldo simulado ≠ contagem física: exigir contagem física na sexta T3 (ou na 1ª hora da abertura) para elevar a confiança de média a alta. **Calendário:** 31/10 e 01/11 não têm períodos e 02/11 é inativo na Previsão ⇒ a "segunda M1 de 02/11" não existe; a abertura é 03/11 M1 (WIP envelhece 4 dias corridos — ⚠ risco de avaria/obsolescência não modelado).

## 7. Regra "nunca deixar pessoa parada"
`decidirPessoaParada` (puro, sem identidade de pessoa): para cada pessoa-período sem posto, entre os postos livres, permitidos, com material e que não violam hard constraints: (1) o de maior **valor atual** (> R$ 0,50); (2) senão, **antecipação** de maior valor futuro, com custo atual ≥ −R$ 0,50 e dentro do teto; (3) senão, **antecipação por alívio de capacidade** (valor futuro em R$ zero, mas libera posto-períodos da próxima semana dentro do teto); (4) senão **exceção auditável**: `nenhuma_maquina_permitida` | `nenhum_material` | `nenhuma_demanda_atual_nem_futura` | `hard_constraints_impedem` — registrada no plano/diagnóstico.

## 8–15. Replay de 30/10, uso dos pessoa-períodos livres, impactos, WIP, gargalos, capacidade, churn
Ver PARTE II do relatório `analise-30-10-<foto>-<HHMM>.md` (mesmas bases: avaliador oficial, resto replanejado, T1–T3 de hoje projetados; depois foto real). Resumo da foto projetada de 29/10 13:00: ver o relatório; a camada nova encontra +R$ 196,67 na semana atual (Máquina 8 em 30/10 M2, que o motor deixa sem ocupante) e destina os demais pessoa-períodos livres a antecipação (1.1/4", Máquina 8, Rosquear Conv.) dentro do teto. Leitura honesta: o motor sozinho já "antecipa" implicitamente ao manter pessoas em postos upstream sem valor atual; a camada nova torna a escolha explícita, auditável e limitada pelo teto, e corrige o que o motor deixou na mesa (valor atual).

## 16. Hard constraints
Núcleo + verificador independente (incluindo repetição de operação no bloco, FREPLAY_ESCOPO=bloco) = 0 violações em todos os planos apresentados; só máquinas da Previsão; passado e período em andamento congelados (candidatos só alteram o dia-alvo). A camada nova **só reatribui pessoas livres a postos** (não move quem já tem posto).

## 17. Riscos
1. Valor futuro de baixa confiança (Previsão seguinte vazia; histórico curto; Autom e 1.1/4" ⚠). 2. Máquinas/equipe da próxima semana desconhecidas. 3. WIP parado 4 dias corridos (feriado 02/11). 4. Saldo de WIP simulado ≠ contagem física. 5. Premissa "produto final não se antecipa". 6. O motor ativo replaneja a cada fechamento e pode desfazer a antecipação (a camada precisa estar no replanejamento, não só num ajuste manual). 7. Produtividade de Máquina 8/Automática ainda é substituta no motor oficial (posto real: n=17, 88% ⚠). 8. Ruído do replanejamento heurístico (±R$ 50–400).

## 18. Flags propostas (NADA gravado; rollback por UPDATE em `escala_parametros`)
- `producao_real_antecipacao_modo`: `off` (padrão) | `sombra` (calcula e grava diagnóstico, não altera o plano) | `ativo`.
- `producao_real_antecipacao_teto`: `{ "janelaSemanas": 6, "fatorDemanda": 1.0, "produtosRecorrentes": { "<produto_id>": <qtd/semana> }, "tetoMaxPct": 1.0 }` (fatorDemanda < 1 reduz o teto; `produtosRecorrentes` = fonte (d)).
- `producao_real_valor_posto_replanejado`: `off` | `sombra` | `ativo` (valor do posto por remoção com resto replanejado no diagnóstico e na escolha de postos).
- `producao_real_pessoa_parada`: `off` | `sombra` | `ativo` (regra do item 7 + exceção auditável).
Rollback: `UPDATE escala_parametros SET valor = '"off"' WHERE chave = '<flag>'`.

## 19. Rollout em SOMBRA
1. Gravar só o diagnóstico (demanda futura, teto, opções por pessoa-período, decisão) em cada recálculo, sem alterar o plano. 2. Comparar com o realizado: a antecipação sugerida foi executada? o WIP sugerido existiu na abertura da semana seguinte (contagem física)? 3. Calibrar demanda futura contra a Previsão efetivamente criada (erro de previsão por produto). 4. Só então `ativo` para a semana de teste, mantendo o rollback à mão.

## 20. Critérios de ativação ("PROVAR A LÓGICA. Depois ATIVAR")
Não ativar sem: (a) replay com 0 violações duras e valor atual **nunca** menor que o do plano sem a camada; (b) teste de transição aprovado com **contagem física** na virada; (c) erro de demanda futura (histórico × Previsão real) ≤ o ruído do modelo por 2 semanas consecutivas; (d) valor futuro medido em sombra > 0 e acima da materialidade em ≥ 2 semanas; (e) churn mediano ≤ o do motor; (f) Previsão da próxima semana com itens e máquinas (ou configuração explícita de produtos recorrentes). Enquanto isso, a camada fica em sombra.

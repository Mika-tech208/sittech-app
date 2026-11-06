# Meta mínima de produção, formação de estoque e antecipação da semana seguinte

Status: implementado **somente no clone / branch `feat/antecipacao-semana-seguinte`**. Nada em PROD. Desligado por padrão.

## 0. Vocabulário (decisão do dono do produto, 06/11)

- **Meta mínima de produção** (`meta_minima_producao`) = a quantidade da Previsão da semana ("o mínimo que aceito produzir"). **Não é teto, nem capacidade máxima.** Pino 108.000 = pelo menos 108.000.
- **Formação de estoque** = produção **além da meta mínima** de um produto **autorizado** (`permitir_formacao_estoque`, política **por produto**, parâmetro `escala_formacao_estoque_produtos`). Origem `FORMACAO_ESTOQUE`. Não é erro, excesso, nem "demanda ultrapassada": nenhum diagnóstico ou checagem trata como violação.
- **Antecipação da semana seguinte** = opt-in separado (`escala_antecipacao_semana_seguinte = "ativo"`): produzir hoje a meta da semana seguinte, **com desconto** na semana de destino. Origem `ANTECIPACAO_SEMANA_SEGUINTE`. Só vale se o usuário pedir.
- Produto **não autorizado** (sem política): para ao atingir a meta, como sempre. Conector 3/4 (cutover do produto único) e Caixa 4x2 (encerrada) nunca formam estoque nem antecipam.

## 1. Prioridades — por construção, não por peso

1. **Fase 1** (planejador de sempre, `planejarFuturo`/`buscaLocal`): leva **todos** os produtos até suas metas mínimas (demanda restante da semana) e consome o WIP atual. Não conhece a fase 2. Produto que já atingiu a meta tem restante 0 na fase 1 ⇒ **nunca ocupa pessoa/máquina de produto ainda abaixo da meta** (ex.: Pino atingiu, Plug abaixo e a mesma pessoa/máquina ajuda o Plug ⇒ Plug primeiro).
2. **Fase 2** (`antecipacao.ts#planejarFase2`) só roda **depois**, sobre o que **sobrou** (máquinas e pessoas). As linhas da fase 1 ficam **fixas**; a fase 2 só **acrescenta** linhas (que servem só aos produtos-sombra) e usa a fração ociosa das linhas fixas (a meta produz primeiro em cada linha). A produção até a meta **não pode diminuir**. Testes: `produção − extra = produção sem a regra`, em cenários dirigidos e 40 aleatórios.
3. **Pessoa sem trabalho fisicamente válido continua sem posto**: busca gulosa pelo ganho marginal + poda de qualquer linha cuja remoção não reduz o objetivo.

**Função objetivo (revisão).** O peso entre meta e estoque é estrutural (lexicográfico), logo mais forte que qualquer peso: nada de estoque compete com meta. Dentro da fase 1 o objetivo continua `Σ margem·peças finais` (cada produto até o seu restante) com o piso do EQUILIBRIO (`coberturaMinima`, padrão 0,45 — **cobertura 0,45 NÃO é meta atingida**: só impede que produto fique abaixo de 45% do total; a meta é 100%). Para "penalizar fortemente" produto abaixo da meta basta `coberturaMinima = 1` em `producao_real_planejador_config` (parâmetro já existente; **não alterado** aqui para não mudar o plano da demanda — byte-identidade). Na fase 2: FORMAÇÃO pesa `0,25 × margem` (estoque especulativo), antecipação opt-in pesa `1 ×`.

## 2. Autorizados: sem teto comercial; limites físicos

Para produto autorizado **não existe teto baseado na Previsão**. Limites, todos físicos/operacionais: máquinas selecionadas na Previsão **atual**, pessoas, revezamento (bloco + ponte M3→T1), matéria-prima/WIP, lote Tn → Tn+1, cadeia, HARD gates e:

- **Buffer entre etapas** (ex.: Caixa 4x4 Etiquetar → buffer → Montar Presilha): nível máximo da ligação k = `max(WIP não tocado, capacidade LIVRE do consumidor nos períodos restantes)` + `bufferExtraPecas` (por produto, padrão 0). Capacidade livre = Σ(taxa × máquinas permitidas) − o que a meta já consome na mesma etapa. Nunca se forma mais estoque intermediário do que a etapa seguinte ainda absorve até o fim do horizonte.
- **WIP existente conta**: cada produto-sombra herda o WIP que a meta atual nunca toca (`wipNaoTocado`); não se produz upstream desnecessário.
- **Limite físico opcional** `limiteFisicoPecas` na política (espaço), por produto. **Padrão: nenhum** (`SEM_LIMITE_FISICO`); só a capacidade limita. Excedente real da semana (Pino 51.780 − 43.200 = 8.580) conta como estoque real e não é "corrigido para baixo"; só ocupa o limite se este existir.

## 3. Meta futura nunca é descontada em silêncio

`escala_formacao_estoque_desconta_destino` = **false** (padrão). A meta da semana seguinte (ex.: Pino 108.000) continua aparecendo **inteira**; o estoque formado aparece **separado** (diagnóstico `ANTECIPACAO_RESUMO`: "NÃO descontada (estoque formado visível; desconto é decisão explícita)", ledger e view `escala_meta_estoque_v`). Só a **antecipação opt-in** desconta (e mostra "DESCONTADA"). O motor pode considerar o estoque existente como disponibilidade física (WIP/contagem física), mas a meta não é reduzida.
Produção de antecipação/formação já **executada** (períodos iniciados, ledger) é devolvida ao restante da meta da semana atual (`planoCorte.restanteDe`), senão a peça extra mascararia falta de meta.

## 4. Rastreabilidade e relatório

Tabela `escala_antecipacoes` (append-only; migration `20261118100000`, já em PROD inerte) + colunas `meta_minima_producao` e `quantidade_alem_da_meta` (migration **aditiva** `20261118110000`, rollback próprio). `origem`: `DEMANDA_SEMANA` (só a parte da meta de postos mistos) | `ANTECIPACAO_SEMANA_SEGUINTE` | `FORMACAO_ESTOQUE`. Cada linha: semana de origem/destino (FORMAÇÃO: semana em que o estoque estará disponível), data, período, produto, etapa, operação, máquina, **operador**, quantidade, **meta mínima**, **quantidade além da meta**, hash e versão do plano que autorizou, instante. Regerar substitui só as linhas futuras vigentes (`substituida_em`); períodos iniciados nunca são tocados. RPC atômica `escala_aplicar_recalculo_antecipacao` (plano + ledger na mesma transação).

**Relatório META MÍNIMA × PLANEJADA × REAL × FORMAÇÃO**: view SQL `escala_meta_estoque_v` (por semana e produto: `meta_minima_producao`, `producao_planejada`, `producao_real`, `formacao_estoque_registrada`, `alem_da_meta_planejado`, `alem_da_meta_real`) e função pura `relatorioMetaEstoque` (mesma conta). Ex.: meta 108.000; planejada 116.000; real 114.500 ⇒ além da meta (real) 6.500; falta para a meta 0.

## 5. Parâmetros (`escala_parametros`) — nenhum dispara recálculo

| chave | valor | efeito |
|---|---|---|
| `escala_antecipacao_modo` | `"desligado"` (padrão) \| `"ativo"` | liga a fase 2 |
| `escala_formacao_estoque_produtos` | lista de `produto_id` ou `{produtoId, limiteFisicoPecas?, bufferExtraPecas?}` (legado `tetoPecas` = `limiteFisicoPecas`) | política por produto (nunca global) |
| `escala_formacao_estoque_desconta_destino` | `true` \| `false` (padrão) | formação também desconta a meta da semana de destino |
| `escala_antecipacao_semana_seguinte` | `"desligado"` (padrão) \| `"ativo"` | opt-in da antecipação com desconto |

Com a regra desligada o plano é **byte-idêntico** ao anterior (golden: `scripts/fechamento/golden-antecipacao.ts`). Única exceção deliberada: o **conserto do fallback** (seção 6), que só altera o resultado quando a 1ª tentativa de atribuição de pessoas falhava.

## 6. Fallback de 06/11 13:08 — causa e correção

**Evento**: `ausencia` 13:08:38, **Aly**, `saida_antecipada`, 13:08–17:00 (232 min), 06/11. Cobre T1 (já em andamento), T2 e T3. Equipe disponível em T2/T3 = 11. O recálculo a partir de T2 caiu em `fallback` ("sem plano executável com as pessoas disponíveis (revezamento)") e o plano vigente (12:18) foi mantido — reproduzido no clone com o **mesmo hash do PROD** (`d6237eb0…`).

**Causa (inviabilidade real, não limitação do húngaro)**: as linhas produzidas pela busca tinham **8 postos de Montar Presilha na tarde (4 em T2 + 4 em T3)**. Regra dura: a mesma pessoa não repete a operação na tarde. Em T1 (congelado) Joa, Karelis, Rosa e Tania fizeram Montar Presilha ⇒ não podem mais; Aly saiu; elegíveis = 11 − 4 = **7 < 8** (violação de Hall). A busca exata (`resolverBlocoExato`, CSP com emparelhamento por período e por operação) **provou** a inviabilidade e foi conferida contra força bruta em 300 instâncias aleatórias (0 divergências). A heurística (húngaro por período) também falhou, mas **corretamente**.

**Por que o planejador não se recuperou**: o limite de linhas por operação/bloco (`limiteOp`) parte de `max(pessoas)` da semana (12, de dias sem a ausência) e a retentativa o aperta de 1 em 1. Mas a busca local só valida restrições nos períodos que ela *toca*; a partida da retentativa (as 8 linhas) já violava o limite novo e, sendo o "melhor plano", **permanecia para sempre** — o aperto não apertava nada. **Correção** (`apertarLinhasAoLimite`, só nas retentativas): a partida também obedece ao limite apertado (remove a linha cuja saída menos reduz o objetivo). Resultado: 7 postos de Montar Presilha (1 a menos em T2) e plano válido. Mais: `reatribuirPessoasBloco` agora tem **fallback exato** (nunca relaxa regra) quando a heurística falha — rede de segurança; nas 245 instâncias viáveis aleatórias a heurística sozinha não falhou.

**O plano vigente mantido era INVÁLIDO para a Aly**: v35 (12:18) tem Aly em **T3 Montar Presilha / Montagem 18B** (e sem posto em T1/T2); a ausência 13:08–17:00 deixa esse posto sem operador. O fallback mantém o plano mesmo assim (comportamento existente: "plano vigente mantido + alerta").
A regra de estoque **não** muda o resultado: o fallback ocorre na fase 1 (meta), antes; com ou sem formação o código antigo cai em fallback e o novo recalcula (testado nos dois).

## 7. Ensaio no clone (06/11, T1 congelado; T2 e T3)

Saída completa por período/pessoa/posto em `docs/ensaio-antecipacao-2026-11-06.txt`. Reproduzir: `scripts/fechamento/ensaio-antecipacao.ts`; diagnóstico: `scripts/fechamento/diagnostico-fallback-revezamento.ts`.

## 8. O que NÃO faz / limitações

- Sem pool na semana atual ⇒ sem formação nem antecipação (rota/metas não carregadas). Produto único (semana de origem em PLANEJAMENTO/OPERACIONAL): regra desligada.
- O ledger registra o **plano**; o apontamento não distingue peça extra da peça da meta (por isso o extra executado é devolvido ao restante da meta da semana atual).
- Busca da fase 2 é gulosa; a atribuição de pessoas é refeita no conjunto união (os **postos** da meta não mudam, quem os ocupa pode mudar).
- A UI dos relatórios fica para depois.

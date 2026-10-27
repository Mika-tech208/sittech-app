# Pré-voo SOMENTE LEITURA em PROD — produto único com rotas (26/10/2026, 21h29 SP)

**Nada foi alterado em PROD** (só `SELECT`; nenhuma migration, deploy, produto F, Previsão 02/11, configuração ou `suporte_ativo`). Leitura feita com o mesmo script de leitura de sempre; as consultas estão em `supabase/tests/rotas/golden/prod_baseline_{a,b}.sql` (baseline) e abaixo.

## 1. Resultado do pré-voo
| Item | Estado em PROD | Apto? | Observação |
|---|---|---|---|
| Banco | PostgreSQL 17.6; 70 migrations; última `20261105100000` | ✔ | Nenhuma tabela/função do modelo de rotas existe (`produto_rota`, `rotas_config`, `rotas_planejador_sombra` ausentes) |
| Colisão de nomes / dependências | 8 tabelas e 10 funções novas **não** existem; dependências (`escala_sombra_trg_imutavel`, `is_admin`, `has_permissao`, `is_usuario_ativo`, `calcular_custo_hora_operacao_vigente`, `escala_plano_entrada`, `wip_controle_criar`, RPCs de indicadores/apontado real) **existem** | ✔ | Coluna `previsoes.modelo_rotas` ainda não existe |
| **Máquinas ambíguas** | **0 ambiguidades** (consulta equivalente a `produto_rotas_maquinas_ambiguas` sobre os 5 cadastros que serão copiados: 11 pares etapa×máquina, 11 máquinas distintas, nenhuma em duas etapas de F) | ✔ | O apontamento deriva a etapa por produto×máquina: cada máquina cai em UMA etapa |
| Etapas comuns P × Máquina Automática | Etiquetar e Embalar **idênticos** em metas e máquinas (a M1 não vai parar) | ✔ | Máquinas inativas entre as copiadas: 0 |
| F já existe? | Não (`Conector 3/4" (Final)` = 0 produtos) | ✔ | Os 2 produtos legados existem, ativos, com os mesmos ids do DEV (`27c229d7…`, `a027ac97…`) |
| Preço | P = **R$ 0,1825**; Máquina Automática = **R$ 0,182**; a M1 cria F com **R$ 0,1825** | ⚠ decisão | Diferença de R$ 0,0005/peça entre os legados (já conhecida). **Confirmar R$ 0,1825 antes de ativar** (não bloqueia publicar a infraestrutura) |
| Metas / máquinas | Ver §3 (valores de PROD; diferem do DEV) | ✔ | CONV: 3 rosqueadeiras (54.000/sem cada) e 4 parafusadeiras (40.500/sem cada); AUTO: Máq. Automática 8 (35.625/sem); comum: E15 e E16 (97.500/sem cada), Embalagem 17 (142.500/sem) |
| **Previsão 02/11** | **Não existe.** Última Previsão: 26/10 (atualizada em 20/10). Nenhuma semana posterior | ✔ | Nada a converter ou apagar |
| Semana 26/10 (em andamento) | 6 itens previstos, 451 alocações da Escala, 132 apontamentos (47 `sem_producao`), 16 funcionários ativos, 5 dias produtivos, equipe 17 linhas | ✔ | Semana viva: apontamentos continuam chegando |
| WIP (controles/saldos/ajustes/confirmações) | **0 / 0 / 0 / 0**; nenhum controle dos legados | ✔ | **`wip_modo = ativo` hoje** (antes era desligado) e `wip_dias_limite_semanas {26/10: 2}`; testado: semana de F com WIP ativo e sem controles = mesmo plano |
| **Adicionais** | 3 itens da semana 26/10 com adicional: Caixa Amarela 7.200; Conector 1.1/4" 1.510 (Rosquear); **Conector 3/4" (P) 22.800 em Rosquear** | ⚠ atenção | Atravessa a virada: peças de **Rosquear a mais** (semiacabado aguardando Parafusar) podem sobrar em 02/11. Não há controle de WIP, então o sistema não as enxerga. Ver §6 |
| Apontamentos | 3.827 no total; Conector (P+A) 285, 32 na semana 26/10 (Embalar 18.100, Etiquetar 17.074, Parafusar 13.950, Rosquear 9.920, R+P 5.410) | ✔ | Último apontamento: 26/10. Triggers novos na tabela: leves (consulta por `produto_id`) |
| Equipe / dias | 16 funcionários ativos; 26/10: 5 dias, 17 linhas de equipe; dias úteis 22/mês, 5/semana; períodos m1 07:12–08:48 … t3 15:40–17:00 | ✔ | Sem ausências a partir de 02/11 |
| Indisponibilidades | 0 abertas; 0 por Previsão; 0 máquinas inativas | ✔ | — |
| Escala / eventos | 37 versões de plano; 7 replanejamentos (`ativo_restrito` só para 26/10); 0 eventos pendentes; 0 alocações a partir de 02/11 | ✔ | O replanejamento restrito não é tocado (semana linear) |
| Custo/hora no servidor | 16 funcionários ativos, 14 custos fixos ativos, `configuracoes_empresa` presente; **`service_role` NÃO tem SELECT** em `fixed_costs`, `funcionario_custos`, `configuracoes_empresa` | ✔ (corrige a migration 6) | A migration 6 concede só SELECT ao `service_role` |
| Golden baseline | Congelado (§5); estável em duas execuções seguidas | ✔ | Arquivos em `docs/rotas-prod/` |
| Teste visual com login | **Não feito** (ver §9) | ⚠ | Exigência para a ATIVAÇÃO; para publicar a infraestrutura há checklist pós-deploy |

## 2. Diagnóstico de máquinas ambíguas (PROD, somente leitura)
Consulta: união (etapa nova × máquina) das 5 etapas-fonte; `group by maquina having count(distinct etapa_nova) > 1` → **0 linhas**. `etapas_fonte=5 · pares=11 · máquinas_distintas=11 · maquinas_ambiguas=0 · etiq/emb divergem=false · máquinas inativas=0 · F já existe=0`.

## 3. O que a M1 copiaria em PROD (valores de PROD, não do DEV)
Metas = `m1/m2/m3/t1/t2/t3`.
| Etapa nova (rota) | Máquina | Meta copiada | Fonte legada | Capacidade/sem. por máquina (5 dias) |
|---|---|---|---|---|
| Rosquear (CONV) | Rosqueadeira 3 | 2000/2000/2000/1600/1600/1600 | Conector 3/4" · etapa `ca90456c` (ordem 0) | 54.000 |
| Rosquear (CONV) | Rosqueadeira 5 | idem | idem | 54.000 |
| Rosquear (CONV) | Rosqueadeira 6 | idem | idem | 54.000 |
| Parafusar (CONV) | Parafusadeira 9 | 1500/1500/1500/1200/1200/1200 | Conector 3/4" · etapa `78aaa207` (ordem 1) | 40.500 |
| Parafusar (CONV) | Parafusadeira 10 | idem | idem | 40.500 |
| Parafusar (CONV) | Parafusadeira 11 | idem | idem | 40.500 |
| Parafusar (CONV) | Parafusadeira 12 | idem | idem | 40.500 |
| Rosquear + Parafusar (AUTO) | Máquina Automática 8 | 1275/1275/1275/1100/1100/1100 | Conector 3/4" – Máq. Automática · etapa `1b72bf46` (ordem 0) | 35.625 |
| Etiquetar (comum) | Etiquetadora 15 | 3500/3500/3500/3000/3000/3000 | Conector 3/4" · etapa `34371af3` (ordem 2) — idêntica à da Automática | 97.500 |
| Etiquetar (comum) | Etiquetadora 16 | idem | idem | 97.500 |
| Embalar (comum, final) | Embalagem 17 | 5000/5000/5000/4500/4500/4500 | Conector 3/4" · etapa `b3db9629` (ordem 3) — idêntica à da Automática | 142.500 |
Cadastro nascerá **inativo** (R$ 0,1825), com rotas AUTO (preferência 1) e CONV (2), pool comum Etiquetar → Embalar [final], vínculo analítico P→CONV e A→AUTO. **A seleção de máquinas da Previsão NÃO é copiada**: F começa com tudo desmarcado.

## 4. As 6 migrations (nenhuma aplicada em PROD)
| # | Arquivo | Objetivo | Cria / altera | Reversibilidade | Risco |
|---|---|---|---|---|---|
| 1 | `20261106100000_rotas_m0_estruturas.sql` | Estruturas do modelo de rotas + trava | **Cria** `produto_rota`, `rota_etapas`, `produto_pool_comum`, `previsao_rota_limite`, `escala_rota_divisao`, `produto_variante_legada`, `rotas_config` (`suporte_ativo=false`), 14 funções (validação, `produto_estrutura_rotas`, `produto_etapa_final`, guards) e triggers. **Altera** `previsoes` (+ coluna `modelo_rotas boolean default false`) e adiciona triggers em `previsoes`, `previsao_itens`, `apontamentos_producao`, `wip_controle` | Reversível enquanto F não tiver uso (procedimento de DEV `rollback_dev_m0_m1.sql`; `drop` das tabelas/funções/triggers e da coluna). Não destrutivo para dados antigos | **Baixo-médio**: `ALTER TABLE previsoes ADD COLUMN` (lock curto); triggers novos em tabelas vivas (cada INSERT em `apontamentos_producao` faz 1 consulta indexável). Aplicar fora do expediente |
| 2 | `20261106110000_rotas_m1_cadastro_conector_final.sql` | Cadastra F (inativo) copiando metas/máquinas dos legados | **Insere** 1 produto, 5 etapas, 11 vínculos etapa×máquina, 2 rotas, 3 linhas de `rota_etapas`, 2 de `produto_pool_comum`, 2 de `produto_variante_legada`. **Nenhum UPDATE/DELETE em dados antigos** | Reversível (delete das linhas novas) enquanto F não tiver uso | **Baixo**: PARA com exceção se Etiquetar/Embalar divergirem (hoje não divergem); idempotente |
| 3 | `20261107100000_rotas_m2_planejador_sombra.sql` | Tabela de diagnóstico do planejador em sombra | **Cria** `rotas_planejador_sombra` (append-only) | `drop table` | **Baixo** |
| 4 | `20261108100000_rotas_m3_divisao_registro.sql` | Colunas de registro das rodadas | **Altera** `escala_rota_divisao` (vazia): +8 colunas, +trigger, +índices | `drop column` / `drop index` | **Baixo** (tabela vazia) |
| 5 | `20261109100000_rotas_m4_consumidores.sql` | Apontado real, indicadores e WIP por percurso | **Cria** `produto_usa_rotas`, `etapa_grupo_rota`, `produto_arestas_rotas`. **Substitui** `obter_indicadores_producao`, `obter_apontado_real_previsao_por_semana`, `wip_controle_criar` (ramo antigo preservado como `else`) | Reaplicar o corpo anterior (as 3 migrations originais: `20260903190000`, `20261030100000`, `20261023100000`) | **Médio**: troca de corpo de funções usadas por telas vivas. Mitigado: hash idêntico à função antiga (provado no DEV, inclusive com a função antiga recriada em transação) |
| 6 | `20261109110000_rotas_m4_custo_servidor_e_apontamento.sql` | Custo no servidor, coerência de apontamento, adicional, valor atribuído, cobertura | **Concede** SELECT ao `service_role` (7 tabelas); **cria** triggers em `apontamentos_producao`, `previsao_itens`, `previsao_item_adicional_etapa` (só agem em produto de rotas), `produto_rotas_maquinas_ambiguas`, `etapas_do_percurso`, `rotas_cobertura_apontamentos`; **substitui** `calcular_valor_atribuido_operacao` | Reaplicar o corpo anterior (`20260909150000`); `drop trigger/function`; `revoke select` | **Médio-baixo**: triggers só agem em produto de rotas; função de valor atribuído idêntica para linear (126 combinações) |
**Ordem obrigatória** 1→6 (cada uma depende da anterior). Após cada uma: baseline (§5) + `suporte_ativo=false`.

## 5. Baseline PROD (congelado ANTES da 1ª migration)
Pacote: `supabase/tests/rotas/golden/prod_baseline_a.sql` (hashes e contagens) e `prod_baseline_b.sql` (RPCs de indicadores e apontado real como administrador, `begin read only`), executados **duas vezes** — A estável. Valores atuais em `docs/rotas-prod/baseline_prod_{A,B}_2026-10-26T21h29.txt`.
Cobre: produtos, `roteiro_etapas`, `roteiro_etapa_maquinas`, máquinas, operações, períodos, Previsões (todas), itens e máquinas por item (semanas **fechadas** + semana 26/10 "viva"), adicionais, dias/equipe, indisponibilidades, Escala (dias e alocações fechadas + 26/10 viva), `escala_plano_versoes`, `escala_plano_entrada(26/10)`, parâmetros, replanejamentos, apontamentos (fechados + 26/10), WIP (contagens), custos (hash de funcionários + custos fixos), `calcular_valor_atribuido_operacao` (180 combinações), indicadores e apontado real (fechado e vivo), hash das colunas das tabelas antigas, lista de funções públicas e o corpo das 4 funções que mudam de propósito.
**Regra de comparação:** linhas `*_fechado` e cadastros devem ser **idênticos** após cada migration; `*_vivo` mudam com o uso (comparar contagens/marcador `marcador_t0` e explicar); `funcoes_publicas`/`funcoes_corpo_alteradas_pelo_m4` mudam **de propósito** nas migrations 1, 5 e 6 (conferir só o conjunto esperado).

## 6. WIP e adicionais atravessando a virada (para 02/11)
- Nenhum controle, saldo, ajuste ou confirmação de WIP dos legados.
- **P tem adicional planejado de 22.800 em Rosquear** (semana 26/10): semiacabado que pode existir em 02/11 aguardando Parafusar. Como não há controle de WIP, o sistema não o enxerga hoje e **também não o enxergará em F**; efeito: a CONV de F pode produzir Rosquear a mais que o necessário (as Parafusadeiras continuam sendo o limite; o produto acabado não é afetado). **Decisão antes de ativar:** contar o estoque físico no fim da semana e (a) ignorar (custo: algumas peças de Rosquear em excesso) ou (b) lançar como WIP inicial de F depois da ativação (requer controle de WIP Rosquear→Parafusar de F e confirmação).
- Caixa Amarela (7.200) e Conector 1.1/4" (1.510) não são do Conector 3/4".
- `wip_modo` está **ativo** em PROD: a Escala de F foi testada com WIP ativo e sem controles (mesmo plano; nenhum adicional inventado).

## 7. Apontamentos atrasados — produção CONFIRMADA × PRESUMIDA × SEM PRODUÇÃO
Implementado em DEV (pequeno): `rotas_cobertura_apontamentos(semana)` (servidor) devolve, por período/máquina, apontamentos `produzindo` (com as peças boas) e `sem_producao`. No replanejamento de F:
| Situação do período passado | Tratamento | Rótulo |
|---|---|---|
| Há apontamento `produzindo` | vale o **apontado** (boas = produzido − refugo) | **CONFIRMADA** |
| Há apontamento `sem_producao` | zero **conhecido** | **SEM PRODUÇÃO** (não é incerteza) |
| Passou e **não há apontamento algum** | preserva o plano congelado (evita replanejamento caótico) | **PRESUMIDA — “não confirmada por apontamento”** |
O presumido **nunca** entra como produção real: aparece como aviso `producao_presumida` (com as peças) no resultado da Escala, no `diagnóstico de incerteza` da resolução (`incertezas`) e em `escala_rota_divisao.motivo.restante.presumidoPorEtapa`. **O Apontado Real continua vindo só de apontamentos válidos** (`obter_apontado_real_previsao_por_semana`): período sem apontamento não entra como produzido (testado em SQL e TS). Sem arquitetura nova: 1 função de leitura + classificação em `calcularRestante`.

## 8. Plano revisado de ativação (nada executado)
**Fase 0 — esta rodada:** pré-voo (feito). **Decisões pendentes do usuário** (§10).
**Fase 1 — infraestrutura com trava FECHADA** (fora do expediente, após o fim da Escala do dia; semana 26/10 em curso): (1) rodar baseline A/B e guardar; (2) migrations 1→6, comparando o baseline após **cada** uma; (3) deploy do código (`main`) — as consultas novas toleram banco sem as tabelas (testado), então a ordem migrations→código é segura; (4) conferir `rotas_config.suporte_ativo=false`, F inativo, produto invisível; (5) checklist visual (§9).
**Fase 2 — shadow com dados reais de PROD (trava fechada):** rodar o shadow (leitura) sobre a Previsão 26/10 e cenários com seleção explícita; comparar capacidade, divisão, máquinas, gargalo, custo (custo/hora real de PROD) e Escala (invariantes). Sem escrever operação oficial (só `rotas_planejador_sombra`).
**Fase 3 — abertura controlada** (só após shadow aprovado e aprovação explícita): (1) ativar F; (2) abrir `suporte_ativo`; (3) criar a Previsão 02/11 com **um** item F e a quantidade final; (4) **você** seleciona as máquinas (nada pré-marcado); (5) revisar a prévia (máquinas CONV/AUTO, etiquetadoras, embaladoras, capacidade nominal, gargalo, divisão, custo, falta); (6) só então gerar a Escala; (7) validar: ninguém em dois postos, máquina em um produto por período, revezamento duro, nenhuma cadeia virtual visível, operações corretas, nominal × realizável, feedback e convergência. Os legados (P e Máq. Automática) não coexistem na semana de rotas (trava no banco).
**Rollback operacional (para frente, nunca destrutivo):** fechar `suporte_ativo`, `produtos.ativo=false` em F, impedir novos usos; **preservar** apontamentos, Escala, `escala_rota_divisao`, sombra, WIP e decisões; voltar a semana seguinte ao modelo legado (Previsão com P e Máq. Automática). Nada de `DELETE`/`rollback_dev` em dados de uso.

## 9. Teste visual (pendente) — o que conferir logo após o deploy com a trava fechada
Não foi possível abrir as telas com login funcional nesta rodada (o Preview exige login e este ambiente não usa credenciais reais; só renderizei os componentes novos isoladamente). **Não vale como validação de ativação.** Checklist imediato (com login, trava fechada, F inativo):
1. **Previsão:** semana 26/10 igual (itens, máquinas, viabilidade, "Itens previstos", PDF "Programação"); **F não aparece** na lista de produtos; produtos lineares continuam pré-marcando máquinas; sem erro no console.
2. **Capacidade:** mesmos números da semana 26/10 (alocação por produto, capacidade por operação, resumos); sem painel de produto de rotas.
3. **Produtos:** lista idêntica; **F não aparece**; edição de produto linear normal.
4. **Escala:** grade da semana 26/10 idêntica; rótulos de rota ausentes (sem produto de rotas); alertas iguais.
5. **Produção Real:** lançar/editar apontamento normal; modal sem texto de rota; lista de produtos por máquina igual.
6. Console e rede: nenhuma requisição nova com erro (as tabelas novas respondem vazio/permitido).
Só na **Fase 3** (F ativo, trava aberta) repetir o mesmo roteiro com F: Previsão (seleção desmarcada, prévia), Capacidade (painel do produto), Produtos (CONV/AUTO/comum e custos), Escala (rótulos discretos) e Produção Real (rótulo de rota no modal).

## 10. Decisões que ainda dependem do usuário
1. Preço final de F (R$ 0,1825 vs 0,182).
2. Tratamento das 22.800 peças de Rosquear adicionais da semana 26/10 (ignorar ou lançar como WIP inicial de F).
3. Janela para aplicar as migrations (fora do expediente).

## 11. Recomendação
**APTO PARA PUBLICAR INFRAESTRUTURA COM TRAVA FECHADA** (migrations 1→6 + deploy), condicionado a: baseline comparado após cada migration; aplicação fora do expediente; checklist visual do §9 executado logo após o deploy; `suporte_ativo=false` e F inativo.
**NÃO APTO PARA ATIVAR** (Fase 3) ainda: faltam o shadow com dados de PROD, a validação visual com login e as decisões 1 e 2 do §10.

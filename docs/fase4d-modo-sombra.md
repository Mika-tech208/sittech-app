# Fase 4d — Infraestrutura do MODO SOMBRA (DEV/Preview; nada em PROD)

A Escala oficial **não é alterada** em nenhum ponto: não existe `aplicar` no caminho da sombra, e o parâmetro `replanejamento_modo = 'ativo'` ainda não faz nada além de se comportar como `sombra`.

## O que existe
- **Migration** `20261025100000_escala_sombra.sql` (aplicada só no DEV): parâmetro `replanejamento_modo` (`desligado` padrão | `sombra` | `ativo`); evento lógico `apontamento_periodo` na outbox existente (colunas `chave`, `ultimo_lancamento_em`, `lancamentos`, `lancamentos_tardios`; índice único por chave); trigger `trg_escala_evento_apontamento` em `apontamentos_producao` (não faz nada com o modo `desligado`; nunca falha o apontamento); tabelas `escala_sombra_decisoes` (append-only, trigger de imutabilidade, único por previsão+data+período) e `escala_sombra_resultados` (append-only, separada); RPCs só `service_role`: `escala_sombra_listar_eventos`, `escala_sombra_reivindicar`, `escala_sombra_gravar_decisao` (idempotente), `escala_sombra_apontamentos`. Trocar o modo NÃO recalcula a escala oficial.
- **Regra de fechamento** (`fechamento.ts`): ≥ 10 min do fim, ≥ 90% dos postos esperados (máquinas do plano oficial) apontados, 3 min sem lançamento; aos 20 min processa incompleto com `dados_completos = false` (percentual, esperados, recebidos, faltantes, último lançamento). O CORTE é o primeiro instante (passo 1 min) em que a regra vale — calculado pelos carimbos (`criado_em`), não por quando o worker roda.
- **Serviço** (`src/lib/escala/sombraServico.ts`, IO injetado): lê o modo; lista eventos; enquanto não fechou **não reivindica** (não consome tentativa); reivindica (atômico) → `executarCorteSombra` → snapshot → grava (idempotente) → conclui. Adaptador `sombraSupabase.ts`. Chamado por `/api/escala/processar` e `/api/escala/drenar` (mesma infraestrutura; erros da sombra nunca derrubam o fluxo oficial). Cliente: `agendarFechamentoEscala()` depois de gravar apontamento (agora, +10 min, +20 min, best-effort).
- **Snapshot** (`snapshotSombra.ts`): identificação, completude, horizonte, compromisso (status original/após, hashes original e reparado, mudanças, postos vazios, **contingências** de máquina fora da Previsão), entradas (restante, realizado, performance, equipe, ausências…), planos (hash oficial/sombra, diferenças, próximos períodos), diagnóstico (A/OK/B→C/B→D, faltas, gargalo, cobertura, alertas, incertezas) e a **entrada canônica compacta** que permite `reproduzirSnapshot` (SHA-256 em JSON canônico). Tamanho: ~28 KB armazenado (DEV, jsonb comprimido); ~10–14 KB gzip por decisão no replay.

## Regras decididas nesta fase
- Máquina **fora da Previsão** nunca é usada automaticamente: vira `contingencia_possivel` no diagnóstico/snapshot (`contingencia_maquina_disponivel = true`, `motivoNaoUsada: "fora da Previsão"`).
- **Pessoa sem apontamento** com alocação oficial inequívoca e sem evidência de ausência / `falta_operador` na máquina dela / outro operador produzindo nela ⇒ EXPOSTA à operação oficial. Sem alocação oficial alguma ⇒ operação desconhecida (incerteza registrada; nada inventado).
- Lançamento depois da decisão: só incrementa `lancamentos_tardios` no evento; o snapshot nunca é reescrito.

## Integridade temporal (correção do bloqueador)
- **Problema:** o plano oficial era lido na hora em que o worker processa; se mudasse entre o corte e o processamento, a decisão histórica usaria uma Escala que ainda não existia.
- **Solução (migration `20261025110000_escala_plano_versoes.sql`):** `escala_plano_versoes`, append-only. Gatilhos ADIADOS (rodam no commit, com o estado final) em `escala_producao_alocacoes`, `escala_producao_dias` e nas 6 tabelas da Previsão gravam uma versão a cada mudança: instante de validade (`valido_desde`), versão dos dias, alocações compactas, entradas da Previsão (dias produtivos, equipe, itens/máquinas, máquinas indisponíveis) e SHA-256. Uma versão por transação, dedupe por hash, e uma versão BASELINE ao ligar o modo. Inertes com o modo `desligado`; nunca falham a operação da Escala/Previsão.
- **Leitura:** `escala_plano_versao_em(previsão, instante)` devolve a versão vigente no instante. O worker usa a versão do FIM do período (postos esperados) e a do CORTE (todo o resto); se não há versão anterior, o evento é IGNORADO com motivo — nunca cai na Escala atual.
- **No snapshot (`planoOficialRef`):** id da versão, timestamp de validade, hash (banco e das alocações), versão de cada dia, período comprometido e o futuro oficial dos 6 períodos seguintes NAQUELE instante.
- **O que continua fora do versionamento:** catálogos (metas do roteiro, nomes, máquinas inativas, parâmetros), ausências (têm carimbo próprio, mas edição/exclusão posterior não é refletida) e a versão ATUAL da linha de apontamento (edição posterior fica registrada em `diagnostico.avisos`/`incertezas.apontamento_editado_apos_corte`).
- **Testes:** hindsight explícito (recálculo automático, troca manual, ausência, indisponibilidade e alteração da Previsão depois do corte não alteram a decisão; a leitura ingênua alteraria), `t12_plano_versoes.sql` (DEV) e paridade total do banco com o carregador do servidor numa semana real do DEV.

## Alertas: evento novo × estado que continua (`alertasAgregados.ts`)
O snapshot técnico mantém os alertas de cada corte. A agregação (para a futura interface) gera: `iniciou_em`, `continua_ativo`, `resolveu_em`/`expirou_em` (período já passou), cortes em que persistiu, pior valor, reaparição. Alertas de EVENTO (conflito de rotação, inviável, não reparável, contingência) nunca são agrupados; mudança de situação (OK → B→C → B→D) e o caminho do compromisso (válido → conflito → reparado) são sempre eventos.

## Estratégia de rollout (nada disto foi executado em PROD)
1. Backup fresco → diff limitado → **migration primeiro** (modo continua `desligado`; o trigger só lê o parâmetro) → push na main → guard/smoke (apontamento de teste não gera evento).
2. Ligar `sombra` por **uma semana** e acompanhar: decisões/dia, `dados_completos`, latência, eventos em erro, tamanho; rollback = `replanejamento_modo = 'desligado'` (o histórico fica; trigger inerte).
3. Só depois decidir a 4e (oportunidade teórica e tela de leitura) com os dados reais acumulados.

## Riscos conhecidos
- Nenhum chamador garante a execução aos +10 min (Vercel Hobby; GitHub `*/5` real ≈ 4 h): a decisão pode sair atrasada, mas o corte e o conteúdo não mudam (a latência fica registrada em `latencia_ms`); o plano e a Previsão do corte vêm das versões, não do estado atual.
- `apontamentos_producao` guarda só a versão atual da linha: edição depois do corte é registrada como incerteza (`apontamento_editado_apos_corte`).
- Com WIP ativo o adicional não entra na sombra (registrado como incerteza).

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

## Estratégia de rollout (nada disto foi executado em PROD)
1. Backup fresco → diff limitado → **migration primeiro** (modo continua `desligado`; o trigger só lê o parâmetro) → push na main → guard/smoke (apontamento de teste não gera evento).
2. Ligar `sombra` por **uma semana** e acompanhar: decisões/dia, `dados_completos`, latência, eventos em erro, tamanho; rollback = `replanejamento_modo = 'desligado'` (o histórico fica; trigger inerte).
3. Só depois decidir a 4e (oportunidade teórica e tela de leitura) com os dados reais acumulados.

## Riscos conhecidos
- Nenhum chamador garante a execução aos +10 min (Vercel Hobby; GitHub `*/5` real ≈ 4 h): a decisão pode sair atrasada, mas o corte e o conteúdo não mudam (a latência fica registrada em `latencia_ms`). O plano oficial e o estado são lidos no instante do processamento: se o oficial foi recalculado entre o corte e o processamento, o comprometido lido pode diferir — por isso a latência é gravada.
- `apontamentos_producao` guarda só a versão atual da linha: edição depois do corte é registrada como incerteza (`apontamento_editado_apos_corte`).
- Com WIP ativo o adicional não entra na sombra (registrado como incerteza).

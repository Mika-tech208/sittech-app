# Previsão semanal — coluna "Apontado real" (diagnóstico)

Status: **DEV/Preview. Nada em PROD.** Migration `20261030100000_apontado_real_previsao.sql` (RPC somente leitura) aplicada só no DEV.

## O que é
Coluna nova em "Itens previstos": Produto · Previsto · Possível · Realizado · **Apontado real** · Falta · %. É **só comparação**: não substitui o Realizado manual, não soma com ele e **não entra** em Falta, %, resultado financeiro, atingibilidade nem "Concluído da previsão". O hero (Previsto/Possível/Realizado/Falta) e o quadro financeiro continuam exatamente como estavam.

## Origem dos dados
- `apontamentos_producao` (estado ATUAL; a edição é UPDATE no lugar), `status = 'produzindo'`, `data` (data operacional da Produção Real) entre a segunda-feira da semana e +6 dias, por `produto_id`.
- Peças boas = `quantidade_produzida − quantidade_refugo` por apontamento. `sem_producao` nunca soma (e por constraint nem tem produto). `apontamento_producao_historico` é outra tabela e não entra.
- Agregação no banco (uma chamada por semana, resultado pequeno): RPC `obter_apontado_real_previsao_por_semana(semana)` → linhas por (produto, etapa, operação gravada no apontamento) + roteiro ATUAL da etapa/produto. Mesma permissão (`previsao`) do antigo `obter_realizado_previsao_por_semana` (SECURITY DEFINER). Produto fora da Previsão não vira linha nova.

## Regra da última etapa (src/features/previsao/apontadoReal.ts)
- Última etapa = a de maior `ordem` do roteiro atual do produto (produto de 1 etapa: ela é a final).
- Só CONTA um apontamento se a etapa é a final **e** a operação gravada no apontamento ainda é a operação atual dessa etapa (roteiro não mudou de significado).
- Se o roteiro mudou depois do lançamento (mesmos ids, outra operação) e alguma leitura (etapa final pelo id OU operação final) colocaria o apontamento na etapa final: **não conta e é REPORTADO** (marcador ⚠ na linha com tooltip e coluna de diagnóstico); nenhuma correção silenciosa. Empate de ordem na última etapa também é reportado.
- Produto sem apontamento na última etapa mostra 0 (diagnóstico útil: etapa final não registrada).

## Riscos
1. O roteiro não é versionado: apontamentos anteriores a uma troca de operação ficam como "ambíguo" (ex.: Caixa Amarela 4x2, 19–21/10: 71 apontamentos / 65.491 peças).
2. Refugo está 0 em todos os apontamentos recentes — hoje Apontado real = produzido da última etapa.
3. O valor só atualiza ao recarregar/trocar de semana (sem tempo real).
4. Em PROD a RPC precisa ser aplicada antes do código (sem ela a coluna mostra "—" e a página segue normal).

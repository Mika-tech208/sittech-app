# Previsão semanal — Apontado real como andamento da semana

Mudança independente do projeto de múltiplas rotas (nenhuma migration; não toca `suporte_ativo`, produto F nem a ativação de 02/11).

## Regra
- **Fonte do andamento**: Apontado real (Produção Real) = produção **boa** (`produzido − refugo`) da **última etapa válida** do produto. Etapa intermediária e `sem_producao` não contam. Produto de uma operação: ela própria é a final. Roteiro alterado → ambíguo **não** vira quantidade (continua o aviso ⚠).
- **Falta** = `max(Previsto − Apontado, 0)`; **%** = `Apontado / Previsto` (sem teto: 105% aparece como 105,0%).
- **Totais**: Previsto total = Σ previstos; Apontado total = Σ apontados; Falta total = `max(Previsto total − Apontado total, 0)` (excesso em um produto abate o total; a tela avisa quando difere da soma das faltas por produto); % = Apontado total / Previsto total.
- **R$**: `apontado × valor_unitario` **congelado em previsao_itens** (nunca o preço atual do cadastro). Previsto R$, Realizado R$, Falta R$ = `max(Previsto R$ − Realizado R$, 0)`; Concluído = % em peças (mostra também % em valor).
- **Possível** continua sendo capacidade/atingibilidade; alerta "PREVISÃO NÃO ATINGÍVEL" intocado.
- **Sem dupla contagem**: `calcularProdutosProgramados` nem recebe o Realizado manual. Mesmo produto em dois itens da semana: o apontado é distribuído em sequência (cada item até o seu previsto; excesso no último) e soma uma única vez.
- Apontado indisponível (carregando/erro) → "—" (nunca 0 inventado).
- **Atualização**: hook recarrega ao voltar para a aba/janela e a cada 60 s com a página visível; registrar/corrigir apontamento reflete na Previsão sem editar nada.

## Código
- `src/features/previsao/progressoSemana.ts` (ex-`realizado.ts`): regra pura + histórico. `formatPct.ts`.
- `src/hooks/useApontadoRealSemana.ts`: `useApontadoRealSemana` (semana) e `useApontadoRealSemanas` (histórico; lotes de 6 chamadas à RPC já existente `obter_apontado_real_previsao_por_semana`).
- UI: `PrevisaoSemanalPage.tsx` (cards, painel Resultado da semana, histórico), `ProdutosProgramados.tsx`, `GlobalStyles.tsx` (grid 6 colunas).
- Testes: `__tests__/progressoSemana.test.ts` (A–M) e `apontadoReal.test.ts`.

## Consumidores do Realizado manual (`previsao_itens tipo='realizado'`, `itensRealizados`)
| Onde | Uso | Decisão |
|---|---|---|
| Previsão: cards, tabela, Resultado da semana, Histórico | acompanhamento | **trocado** para Apontado real |
| Previsão: bloco "Itens realizados" | digitação | **mantido**, recolhido como "Realizado manual (legado)", fora do acompanhamento |
| `calcularResumoSemana` / `calcularHistoricoSemanas` (capacidade) | `valorRealizado`/`pct`/`diferenca` | funções mantidas (legado); nenhuma tela usa mais esses campos; as demais telas só leem `valorPrevisto` |
| Validação da Previsão (Produção Real) | compara manual × apontado | **intocada** (auditoria) |
| Home legada `SittechApp.tsx` (card ponto de equilíbrio) | usa manual | **não alterada** — decisão pendente |
| Assistente (`intelligence/dataFetchers`) | lê itens realizados | **não alterado** |
| Banco (`upsert_previsao_semana`, `obter_realizado_previsao_por_semana`) | gravação/leitura | **preservado**, sem migration |

# Previsão semanal — Apontado real como andamento da semana

Mudança independente do projeto de múltiplas rotas (nenhuma migration; não toca `suporte_ativo`, produto F nem a ativação de 02/11).

## VIGÊNCIA (decisão de 27/10/2026)
`APONTADO_REAL_PROGRESSO_DESDE = 2026-10-26` (`src/features/previsao/vigencia.ts`). **Nunca** "semana atual".
- Semana **< 26/10/2026**: metodologia **histórica** = Realizado manual (peças, R$, %, diferença/falta, Histórico semanal, painel Resultado da semana). Código = `progressoLegado.ts` + `ProdutosProgramadosLegado.tsx`, cópia fiel do que existia antes da feature. Apontamentos lançados depois para essas semanas não alteram nada (o Apontado real nem é consultado para o Histórico delas).
- Semana **>= 26/10/2026** (e futuras): Apontado real (regra abaixo). A linha 26/10 do Histórico é a primeira no método novo (marcada com `*`).
- O Histórico escolhe a metodologia **linha a linha** (`calcularHistoricoSemanal`). Só leitura/apresentação: nenhum dado é alterado.

## Regra (semanas em vigência)
- **Fonte do andamento**: Apontado real (Produção Real) = produção **boa** (`produzido − refugo`) da **última etapa válida** do produto. Etapa intermediária e `sem_producao` não contam. Produto de uma operação: ela própria é a final. Roteiro alterado → ambíguo **não** vira quantidade (continua o aviso ⚠).
- **Falta** = `max(Previsto − Apontado, 0)`; **%** = `Apontado / Previsto` (sem teto: 105% aparece como 105,0%).
- **Falta por produto** = `max(previsto do item − apontado do item, 0)`. **Falta total** = soma das faltas dos produtos: o excesso de um produto **não** compensa a falta de outro (A 10.000/12.000 e B 10.000/5.000 → falta total 5.000, não 3.000). Previsto total = Σ previstos; Apontado total = Σ apontados; **% geral** = Apontado total / Previsto total (pode passar de 100%).
- **Excedente**: apontado acima do previsto é avisado por item ("+N acima") e no total (aviso sob a tabela), sem abater a falta.
- **R$**: `apontado × valor_unitario` **congelado em previsao_itens** (nunca o preço atual do cadastro). Previsto R$ = Σ previsto × preço; Realizado R$ = Σ apontado × preço; **Falta realizar R$ = Σ (falta do item × preço congelado)**; Concluído = % em peças (mostra também % em valor).
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

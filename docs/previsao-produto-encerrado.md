# Produto encerrado na semana (Previsão)

**Problema (08/11/2026):** a Caixa Amarela 4x2 foi encerrada zerando `previsao_itens.quantidade` (para o motor parar de programá-la). Isso misturou *planejamento futuro* com *histórico real*: a Previsão passou a mostrar `Previsto 0 / Apontado 27.930 / +27.930 acima / % N/A`, perdeu a meta original (56.400) e inflou o % (88,5%: as 27.930 entravam no numerador sem entrar no denominador).

## Modelo

Separar **o que havia sido previsto** de **o que ainda se quer produzir**:

| Conceito | Onde vive | Quem lê |
|---|---|---|
| Meta ORIGINAL | `previsao_encerramentos.quantidade_original` (por semana + produto) | tela da Previsão |
| Demanda restante ativa | `previsao_itens.quantidade` / `quantidade_adicional` = **0** enquanto encerrado | **motor** (não muda) |
| Produção real | `apontamentos_producao` | tela, relatórios, indicadores (fato histórico) |

- O encerramento mora em **tabela própria** porque o "salvar" da Previsão (`upsert_previsao_semana`) apaga e recria os itens.
- O gatilho `trg_previsao_itens_encerrado` força `quantidade = 0` e `quantidade_adicional = 0` em qualquer INSERT/UPDATE de item de produto encerrado (salvar, edição manual, importação); o adicional por etapa nunca é gravado.
- RPC `previsao_produto_encerrar(previsao, produto, motivo)` (permissão Previsão ou admin): guarda a meta original, zera a demanda, registra quem/quando. RPC `previsao_produto_reabrir` (só admin): devolve a meta ao primeiro item (o motor volta a programar no próximo recálculo).
- A tela: botão **■** em "Itens previstos" (com confirmação e motivo); item encerrado fica travado com o selo **ENCERRADO**.

## Fórmulas (semanas em vigência do Apontado real)

- **Previsto (original)** = item ativo: `quantidade`; item encerrado: meta original guardada.
- **Previsto operacional** = item ativo: `quantidade`; item encerrado: `min(original, apontado)` (o saldo cancelado sai da obrigação).
- **Falta** = `max(previsto operacional − apontado, 0)` → **0** para encerrado (o cancelado **não é falta**).
- **Excedente** = `max(apontado − previsto original, 0)` → sem "+acima" por causa do encerramento.
- **Cancelado** = `max(original − apontado, 0)` de produto encerrado (informativo: "27.930 produzidas antes do encerramento").
- **Apontado real total** = Σ apontado de TODOS os itens, inclusive encerrados.
- **% concluído** = `apontado real total ÷ previsto operacional total` (sem teto). Produto encerrado entra com o que produziu nos dois lados; o cancelado não pesa.
- **Histórico semanal (R$)**: previsto = original × preço congelado; realizado = apontado × preço congelado; % sobre o previsto operacional.
- Semana sem produto encerrado: **idêntica à regra anterior**.

## Caso real: Caixa Amarela 4x2, semana 02/11–08/11

| | Antes | Depois |
|---|---|---|
| 4x2 previsto | 0 | **56.400** (original recuperado do backup r13) |
| 4x2 apontado real | 27.930 | 27.930 |
| 4x2 falta | 0 | 0 (cancelado 28.470 não é falta) |
| 4x2 excedente | +27.930 acima | 0 |
| 4x2 status | — | **ENCERRADO** |
| Apontado real total | 158.430 | 158.430 (já somava as 27.930, agora por regra) |
| Previsto total | 179.020 | 235.420 (original) |
| Falta total | 58.800 | 58.800 |
| Excedente total | 38.210 | 10.280 |
| % concluído | 88,5% | **76,6%** (206.950 operacional) |

## Garantias

- **Motor:** continua lendo demanda 0 e adicional 0; não programa, não ocupa máquina/pessoa, não gera WIP. Prova com o motor real sobre o estado real da semana: 0 peças e 0 postos de 4x2 (controle com 56.400: 90.600 peças em 94 postos).
- **Rollback:** `supabase/rollbacks/20261120100000_previsao_encerramento_produto_ROLLBACK.sql` renomeia a tabela (preserva os registros). Reverter só o registro da 4x2: `supabase/ops/previsao-encerramento/90_reverter_caixa_4x2.sql`.
- **Limites:** Validação da Previsão e Visão Geral (Produção Real) seguem lendo `quantidade` (0 para o encerrado: sem déficit e sem falta); só a tela da Previsão mostra a meta original.

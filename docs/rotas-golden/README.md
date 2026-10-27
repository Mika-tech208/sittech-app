# Golden master dos produtos lineares (rotas M0/M1)

Prova de equivalência: **mesmas entradas ⇒ mesmos resultados** antes e depois da arquitetura de rotas, para o corpus de produtos lineares (todos os produtos que não têm `produto_rota`) nas Previsões do ambiente.

- `scripts/rotas-golden-master.ts <saida.json>` (somente leitura; recusa banco que não seja o DEV): por Previsão calcula os hashes de capacidade da Previsão (análise por máquina, capacidade máxima da semana, por item, horas por máquina, alocação semanal), `EntradaEscala` (hash canônico), alocações do motor, alertas, atingibilidade, WIP (4 tabelas), e os hashes dos cadastros legados (produtos, roteiro_etapas, roteiro_etapa_maquinas).
- `supabase/tests/rotas/golden/*.sql` (rodar com `supabase db query`): apontado real (todas as semanas e com apontamentos sintéticos dentro de transação desfeita) e hashes SQL da semana 26/10 (Previsão, itens, máquinas, adicional, dias/equipe, Escala dias/alocações, `escala_plano_entrada`, apontamentos, parâmetros) + hash das colunas de todas as tabelas antigas.
- Procedimento: capturar **antes** das migrations, aplicar, capturar **depois**, `diff`. Qualquer diferença ⇒ **parar**.
- Arquivos `*_antes_dev.*` / `*_depois_dev.*`: capturas desta rodada (DEV). Resultado: **idênticos**.

Nota honesta da 1ª comparação: a primeira execução do "depois" divergiu porque o M0 não concedeu SELECT ao `service_role` nas tabelas novas — o script não conseguiu ler `produto_rota` e tratou o produto F como linear. O golden master achou o defeito; o M0 foi corrigido (GRANTs) e a comparação refeita: idêntica. Também havia um nome de tabela desatualizado na lista de exclusão do hash de colunas (corrigido).

## Revisão pós M0/M1 (26/10/2026)
Após a correção do fluxo (trava de suporte, F inativo/invisível ao carregador legado, convergência explícita) o DEV foi recriado (rollback + migrations corrigidas) e o golden master repetido: **TS idêntico** (`golden_ts_depois2_dev.json`) e **SQL idêntico** (`sql*_depois2_dev.txt`; hash de colunas agora exclui também `rotas_config`).

## M3 (26/10/2026)
Repetido após o M3 (adaptador, resolução com feedback, divisão, UI da Previsão): `golden_ts_depois4_dev.json` e `sql*_depois4_dev.txt` **idênticos** aos de `depois3`. O script TS agora também confere, nas Previsões do DEV, que `processarSemana` produz exatamente as alocações do motor direto e que o estado de semana linear não carrega `rotas`.

## M4 (26/10/2026)
Repetido após o M4 (RPCs de indicadores/apontado real, WIP por percurso, custo servidor, replanejamento, telas): TS (`golden_ts_depois5_dev.json`) e SQL (`sql*_depois5_dev.txt`) **idênticos** aos de `depois4`.
Novos golden SQL (função **antiga** definida dentro de uma transação desfeita × função **nova**): `indicadores.sql` (hash idêntico `166803db…`, sem o id gerado a cada execução) e `valor_atribuido.sql` (126 combinações produto×operação×período, todas não nulas, hash idêntico `d2aa9543…`). O hash dos indicadores do M3 (`23a5577f…`) divergia só porque incluía `apontamento_id` (uuid novo a cada execução): o script foi corrigido.

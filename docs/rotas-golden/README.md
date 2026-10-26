# Golden master dos produtos lineares (rotas M0/M1)

Prova de equivalência: **mesmas entradas ⇒ mesmos resultados** antes e depois da arquitetura de rotas, para o corpus de produtos lineares (todos os produtos que não têm `produto_rota`) nas Previsões do ambiente.

- `scripts/rotas-golden-master.ts <saida.json>` (somente leitura; recusa banco que não seja o DEV): por Previsão calcula os hashes de capacidade da Previsão (análise por máquina, capacidade máxima da semana, por item, horas por máquina, alocação semanal), `EntradaEscala` (hash canônico), alocações do motor, alertas, atingibilidade, WIP (4 tabelas), e os hashes dos cadastros legados (produtos, roteiro_etapas, roteiro_etapa_maquinas).
- `supabase/tests/rotas/golden/*.sql` (rodar com `supabase db query`): apontado real (todas as semanas e com apontamentos sintéticos dentro de transação desfeita) e hashes SQL da semana 26/10 (Previsão, itens, máquinas, adicional, dias/equipe, Escala dias/alocações, `escala_plano_entrada`, apontamentos, parâmetros) + hash das colunas de todas as tabelas antigas.
- Procedimento: capturar **antes** das migrations, aplicar, capturar **depois**, `diff`. Qualquer diferença ⇒ **parar**.
- Arquivos `*_antes_dev.*` / `*_depois_dev.*`: capturas desta rodada (DEV). Resultado: **idênticos**.

Nota honesta da 1ª comparação: a primeira execução do "depois" divergiu porque o M0 não concedeu SELECT ao `service_role` nas tabelas novas — o script não conseguiu ler `produto_rota` e tratou o produto F como linear. O golden master achou o defeito; o M0 foi corrigido (GRANTs) e a comparação refeita: idêntica. Também havia um nome de tabela desatualizado na lista de exclusão do hash de colunas (corrigido).

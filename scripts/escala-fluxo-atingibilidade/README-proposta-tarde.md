# Proposta de T1–T3 da tarde (para aprovação) — comando de um passo

**Nada é gravado em PROD.** O pipeline só faz `SELECT` (via `rodaprod.sh`, com retry) e calcula offline. As contagens físicas entram só como argumentos.

## REGRAS (aprovadas 29/10) — v2: `rodar-proposta-v2.sh` (mesmos argumentos)
1. **Produtividade individual NÃO existe no motor.** Produtividade esperada, receita/h, lucro/h, valor marginal e custo de oportunidade só em produto × operação × máquina/posto. Teste de contrato: `fluxo/__tests__/contratoSemProdutividadeIndividual.test.ts` (estrutural + permutação de pessoas).
2. **Duas etapas:** (1) decidir QUAIS POSTOS ocupar (meta, Produção Real, WIP, gargalo, capacidade, receita/h, valor marginal final, custo de oportunidade); (2) escolher QUAL PESSOA ocupa cada posto só por disponibilidade, elegibilidade, revezamento por bloco, hard constraints, churn/estabilidade, equilíbrio de exposição e evitar repetição.
3. **Texto:** A) DECISÃO DO POSTO ("o posto é prioritário porque há WIP/material; downstream/final absorve; valor marginal = R$ X; custo de oportunidade = R$ Y; ganho líquido = R$ Z") e B) ESCOLHA DA PESSOA (válida: disponível, elegível, sem violar o bloco, exposição, churn). Nunca "a pessoa gera R$".
4. **Desempate do ajuste fino** (`fluxo/desempate.ts`, puro, testado): ganho (± R$ 0,01) → folga de revezamento no bloco → desvio de exposição na operação de destino (`ContadoresEquidade.desvioOperacao`, menor = preferido) → churn → continuidade de máquina → id (último). A ordem do array não decide.
5. **Exposição = Escala registrada** (alocação congelada/troca manual). O v2 não define `FREPLAY_ESCOPO` antes de montar o estado (isso faria o `montar.ts` derivar `exposicaoExecutada` do `funcionario_id` do apontamento). Para o bloco da TARDE de hoje não há período passado: resultado numérico idêntico ao v1. O bloco "⚠ CONFIANÇA / BUG CONHECIDO" inclui `exposicao_audit.md` (env `EXPOSICAO_AUDIT`).

## Rodar (12:05–12:10, depois do fechamento de M3 e do recálculo do motor ativo às 12:06)

```bash
/Users/mikaellonghi/Documents/sittech-app/.worktrees/atingibilidade/scripts/escala-fluxo-atingibilidade/rodar-proposta.sh \
  --contagem "Caixa Amarela 4x2:Etiquetar>Montar Presilha=<saldo>@12:05" \
  --contagem "Conector 3/4 Conv.:Etiquetar>Embalar=<saldo>@12:05" \
  --contagem "Conector 3/4 Conv.:Parafusar>Etiquetar=<saldo>@12:05"
```

* Formato: `"<Produto>:<OpOrigem>><OpSeguinte>=<saldo>[@[dd/mm ]HH:MM]"`. O produto casa por trecho do nome (o mais curto vence: `Conector 3/4` = convencional; `Conector 3/4 Autom.` = automática); as operações casam por trecho do nome e precisam ser consecutivas. Sem `@`, vale "agora". `--listar-pares` imprime todos os pares válidos. Pares não informados mantêm a última contagem de `escala_parametros` (07:12/10:24) acumulada com os apontamentos posteriores; para o mesmo par vale a contagem mais recente.
* Outros argumentos: `--agora <ISO>` (padrão: relógio), `--data 2026-10-29`, `--periodo-inicial t1` (use `t2` para propor só T2–T3 depois que T1 começar), `--saida arq.md`, `--sem-estimador`, `--cache` (reaproveita o último SELECT; só para ensaio), `--contagens-json arq.json`.
* Saída: arquivo `.md` (A–N + validações; caminho impresso no fim) + arquivo `.json` irmão (entrada do aplicar) + resumo no stdout. Tempo medido: ~55 s (≈ 48 s de SELECTs em PROD + ~5 s de cálculo).

## O que ele faz
1. Lê de PROD: plano atual (`escala_producao_alocacoes`), apontamentos, último registro do fluxo, decisão-snapshot (pools/Previsão), contagens físicas, e **relê ao vivo** equipe, ausências, paradas (`escala_recurso_indisponivel`) e máquinas inativas/indisponíveis (o snapshot pode estar defasado).
2. Motor econômico (offline): objetivo lucro/h da tela Produtos limitado pelo valor marginal final; atingibilidade com limite econômico (k=2); WIP/downstream como penalidade; diversificação de candidatos; revezamento por bloco HARD; só máquinas da Previsão; T1 em diante (períodos anteriores congelados). Depois, **ajuste fino pessoa a pessoa** (move uma pessoa para um posto livre de maior valor marginal se continuar 0 violação).
3. **Três estados** comparados: (1) estado real após M3, (2) plano ATIVO gravado pelo motor (auditado, não presumido correto), (3) plano econômico offline com as contagens novas. **Recomendação final obrigatória**: `MANTER PLANO ATUAL` ou `APLICAR PLANO ECONÔMICO`, só trocando se TODOS os critérios valerem: ganho de lucro ≥ limiar de materialidade; atingibilidade, WIP excessivo e receita não pioram; 0 violação. Limiar objetivo = 1 erro-padrão do R$ de T1–T3 (σ robusto da razão boas÷meta por período fechado ÷ √3 × R$ de T1–T3), ou seja, o ruído do próprio modelo; ganho menor que isso não se distingue de erro de estimativa e não justifica trocar pessoas. Mostra ganho R$ absoluto, % sobre o restante da semana, nº de pessoas e de postos alterados, e para cada troca: ganho em B, perda em A, líquido, contribuição re-simulada, efeito na meta e no WIP, com `⚠ CONFIANÇA BAIXA` onde o cálculo depende de WIP estimado, amostra pequena, Automática (produtividade substituta), 1.1/4" (1 semana) ou períodos sem apontamento.
4. Variante com o estimador de produtividade (NÃO ativo): mostra se alguma decisão muda materialmente.
5. Valida o plano escolhido com o verificador do núcleo **e** o independente (inclui repetição de operação no bloco e máquinas da Previsão).

## Se o motor ativo ainda não processou M3
A seção A avisa ("M3 AINDA NÃO FECHADO" / "o motor ativo ainda não processou o fechamento de M3"). Antes das 12:05 o período é projetado pela capacidade das linhas congeladas (ensaio).

## Aplicar depois da aprovação (NÃO executar em PROD sem aprovação)
```bash
# 1) gera SQL de aplicar + reverter (não executa nada)
scripts/.../ts.sh scripts/escala-fluxo-atingibilidade/aplicar-proposta.ts --json <proposta>.json --alvo prod --aprovado-por "Mikael" [--commit]
# 2) revisar <proposta>.aplicar.sql; executar com o executor de escrita aprovado (rodaprod.sh é SÓ-LEITURA por convenção)
```
Ver `aplicar-proposta.ts` (cabeçalho) e o relatório: mecanismo (`escala_aplicar_recalculo`, mesma RPC do worker), trava `PROPOSTA_DESATUALIZADA`, janela (T1 não pode ter começado), limite (origem `manual` = preferência, não trava), reversão (`.reverter.sql`). Ensaio local: `scripts/escala-fluxo-atingibilidade/ensaio-aplicar.sh 2026-10-29` (banco `prodcopy`, 127.0.0.1:55432).

## Limites
* Aderência da fábrica ao plano desde 28/10 à tarde não é confiável: só ESTADO de produção é usado (boas, WIP, paradas, presença).
* `Conector 3/4 Autom.:Etiquetar>Embalar` é o mesmo estoque do convencional (nó fundido): informe só um.
* O motor ativo em PROD (objetivo peças) replaneja no fechamento de cada período e pode desfazer postos de T2–T3 mesmo depois de aplicado.

# Fechamento físico atômico na troca de período — IMPLANTAÇÃO (branch `feat/fechamento-fisico`, flag DESLIGADA)

Substitui a especificação v2 onde ela falava em período PROVISÓRIO: **não existe mais período provisório**. A troca de período é UM processo atômico, com as máquinas paradas.
Nada foi aplicado em PROD, nada foi publicado, a branch não foi enviada ao remoto. Com `escala_fechamento_fisico_modo = desligado` (padrão) o comportamento da Escala e do apontamento é o de hoje.

## 1. O fluxo (uma única ação)

```
FECHAR PERÍODO E GERAR PRÓXIMA PROGRAMAÇÃO            [tablet: /producao-real, só com permissão escala_fechamento e a flag ligada]
 1. abrir a janela de troca      → EM_FECHAMENTO: o apontamento do período só vale para quem abriu (trigger, só em `ativo`)
 2. coletar/finalizar apontamentos (produzindo, sem_producao, refugo, paradas) — todos os postos esperados, senão não fecha
 3. contar TODOS os buffers obrigatórios — campo físico nasce VAZIO; estimado do sistema ao lado
 4. confirmar → servidor revalida tudo, RECALCULA o estimado e grava o snapshot (1 transação, idempotente, trava por período)
 5. RECALCULANDO → corte-v1 com REAL + INVENTÁRIO FÍSICO (o motor parte do físico, nunca da projeção)
 6. PORTÃO HARD → só publica se: 0 CADEIA_INVALIDA · 0 sem material · 0 estoque negativo · 0 pessoa/máquina duplicada · 0 violação (revezamento) ·
    0 máquina fora da Previsão · pessoas ≤ disponíveis · passado intacto · INVENTÁRIO PRESERVADO (WIP inicial do motor = físico informado)
 7. persistir plano + fila drenada → CONFIRMADO ("M3 CONFIRMADO" + programação do M3 na tela) → liberar as máquinas
    falha em qualquer ponto → ERRO_RECALCULO: "Estoque salvo. Programação ainda não gerada." + retry seguro (sem recontar)
```
Estados persistidos (log append-only): `RECALCULANDO → CONFIRMADO | ERRO_RECALCULO` (+ `EM_FECHAMENTO` derivado do fim do período/abertura). O inventário nunca se perde: ele é gravado ANTES do recálculo.

## 2. Mapa A–K (o que foi entregue e onde)

| Item | Entrega | Onde |
|---|---|---|
| A. schema/migration | catálogo de buffers, aberturas, fechamentos+buffers+log append-only, trava, views, RPCs, flag | `supabase/migrations/20261110100000_escala_fechamento_fisico.sql` |
| B. permissões | `escala_fechamento` e `escala_fechamento_excecao` (CHECK + catálogo de permissões) | migration + `src/lib/permissoes.ts` |
| C. API transacional | `abrir`, `confirmar`, `retry`, `estado` (+ camada HTTP testável) | `src/app/api/escala/fechamento/*`, `src/lib/escala/fechamento/{http,orquestrador,supabaseFechamento}.ts` |
| D. tela do tablet | tela única, campo vazio, estimado ao lado, motivo em 1 toque, 2º passo (>50%), retry, programação nova ao confirmar | `src/features/producao-real/fechamento/*` + botão em `ProducaoRealPainelPage` |
| E. integração corte-v1 | `fechamentoFisicoFimMs`, `corteExplicito`, `portaoPublicacao`, leitura das contagens do fechamento (só em `ativo`) | `src/lib/escala/{processar,montarEntrada,supabaseIO}.ts`, `fluxo/{estado,fatores,contagem,integracao}` |
| F. validações | validação pré-gravação (pura) + portão HARD + CHECKs do banco | `src/features/escala/fechamento/validacao.ts` |
| G. retry/idempotência | chave do tablet (duplo clique), trava por semana com validade, abertura por usuário, retry sem recontar, rede de segurança na outbox | RPCs + `resgate.ts` |
| H. métricas de duração | `tempos_ms{gravacao,entrada,corte,validacao,persistencia,total}` no log + view `escala_fechamento_duracao` | migration + orquestrador |
| I. feature flag | `escala_fechamento_fisico_modo`: desligado / sombra / ativo | migration |
| J. sombra | grava o inventário, mede o erro e faz ENSAIO do recálculo (dry-run, nada publicado) registrando se o portão aprovaria e os tempos | orquestrador + `supabaseFechamento.recalcular({dryRun})` |
| K. ativação | procedimento e critérios GO/NO-GO abaixo | este documento |

Commits (em `feat/fechamento-fisico`, a partir de `origin/main` 4b3f2c4): `0a0443a` base do motor+migration+testes de banco · `c98c6a8` domínio+orquestrador+IO · `8125f5e` rotas+permissões+outbox · `f53ab19` tela do tablet · `4a7da2d` sombra/harness/screenshots/benchmark/replay (+ os commits seguintes, ver `git log origin/main..HEAD`).

## 3. Decisões técnicas (e por quê)

1. **Instante do motor = fim do período fechado.** Com as máquinas paradas, o inventário é o estado físico no fim do período; a confirmação (ex.: 10:27) é auditoria. Assim o período seguinte entra inteiro e não há "fração do período" a estimar.
2. **`corteExplicito`**: o recálculo parte do período SEGUINTE ao fechado, mesmo que o relógio já o considere iniciado (a troca atrasou o início real). Sem isso o motor trataria M3 como em andamento e só recalcularia T1 (provado em teste: `sem o fechamento … o M3 é congelado`).
3. **`fechamentoFisicoFimMs`** trata o período fechado (e os anteriores) como fechados mesmo antes de fim+10 min, e não muda nada quando ausente (byte-idêntico: 667 testes do motor continuam verdes).
4. **Portão de publicação**: o planejador de corte hoje, ao falhar, MANTÉM e regrava o plano vigente. No fechamento isso é proibido: o portão devolve `bloqueado` e **nada é gravado**.
5. **Buffer físico ≠ par do motor**: o tablet pede "Parafusadas aguardando Etiquetar" uma vez; o catálogo entrega Conv = total e Auto = 0 (até o Produto Único). Só `escala_buffer_pares` muda no cutover.
6. **Apontamento durante a janela**: só por quem abriu o fechamento; depois de confirmado, só por correção (nova revisão, perfil superior). Trigger **somente em `ativo`**.
7. **Sombra**: o motor oficial continua sem usar o físico; o ensaio mede tempo e aprovação do portão com dados reais de PROD antes de qualquer ativação.

## 4. Testes

| Camada | Arquivo | Resultado |
|---|---|---|
| Domínio puro (catálogo Conv/Auto, validações, portão HARD, estados) | `src/features/escala/fechamento/__tests__/dominio.test.ts` | 27 |
| Orquestrador (fluxo único, duplo clique, 2 usuários, 2 recálculos, fila com evento antigo, motor falhando, retry, portão, exceção, sombra/ensaio, M1→M2→M3, último período, tempos) | `src/lib/escala/fechamento/__tests__/orquestrador.test.ts` | 16 |
| HTTP (permissão, entrada, desligado, exceção, revisão, mapa de status) | `…/http.test.ts` | 7 |
| Motor real (corte-v1, banco em memória): recálculo do PRÓXIMO período com o relógio dentro dele, passado intacto, WIP = físico, consumo do M3 ≤ físico (lote), portão recusa ⇒ nada gravado, byte-idêntico sem flag, M1→M2→M3 | `src/lib/escala/__tests__/fechamentoFisicoMotor.test.ts` | 7 |
| Banco (Postgres 16 local): migration 2× (idempotente), flag desligado/sombra/ativo, campo faltando, negativo, postos incompletos, diferença sem motivo, imutabilidade, duplo clique, dois usuários, trava concorrente, evento antigo/fila, revisão, ERRO→CONFIRMADO, bloqueio de apontamento (ativo), exceção, seed do catálogo, **rollback atômico** | `scripts/fechamento/rodar-teste-db.sh` | OK (203 fechamentos arquivados no rollback de teste) |
| Suíte completa do repositório | `npx vitest run` | 1.913 verdes (entre 1.927) · **14 falhas que já existiam em `origin/main`** (6 arquivos de intelligence/indicadores/relatórios; confirmado rodando-os em um worktree limpo de `origin/main`) |
| Build | `next build --webpack` | OK (usei webpack porque `node_modules` é symlink e o Turbopack recusa) |
| Lint nos arquivos novos | `eslint` | limpo (o erro de memoização de `ProducaoRealPainelPage` já existe em `origin/main`) |

Cenários pedidos × cobertura: fechamento normal ✓ · inventário muito diferente ✓ (motivo + 2º passo) · campo faltando ✓ · duplo clique ✓ · dois usuários ✓ · fila com evento antigo ✓ · motor falhando ✓ · retry ✓ · ausência/parada/M8/revezamento/produto de uma operação: **cobertos pelo motor existente** (667 testes) e pelo integração acima; o portão HARD valida os mesmos checks (`violacoesDuras`, `maquinaForaDaPrevisao`, `excedePessoas`, `duplicidade`) · Conector 3/4 com buffers compartilhados ✓ · rollback ✓ · M1→M2→M3 ✓ (domínio, orquestrador, motor).

**Golden 03/11** (`scripts/fechamento/replay-fechamentos.ts`, saída em `docs/fechamento-fisico/replay-0311.txt`, dados reais de PROD):
* sem contagens extras o replay **reproduz o plano publicado** (10:35 → versão `13ccb8da`; 12:06 → `f75d1ea0`: 0 linhas diferentes);
* WIP que o motor usou às 12:06: publicado `8.600 / 4.900+2.222 / 1.900`; **com o fechamento do M2** `9.000 / 3.700+1.100 / 1.200`; **com M2+M3** `9.000 / 4.800+0 / 1.200` — exatamente a contagem manual das 12:08 (o motor não depende das projeções erradas);
* teste dourado em miniatura no motor real: físico 30 contra plano de 90 ⇒ o M3 recalculado consome ≤ 30.

## 5. Benchmark

Offline com dados reais de 03/11 (`scripts/fechamento/benchmark.ts`, 15 execuções por cenário + aquecimento; JSON em `docs/fechamento-fisico/benchmark-fechamento.json`). O motor aprovou o portão em **15/15** execuções nos dois cenários.

| Cenário | total p50 | total p95 | pior | corte-v1 + montagem p95 |
|---|---|---|---|---|
| fechamento do M2 (10:35) | 673 ms | 842 ms | 842 ms | 842 ms |
| fechamento do M3 (12:06) | 653 ms | 961 ms | 961 ms | 961 ms |

Banco (Postgres local, `registrar + resultado`, 200 execuções): p50 0,15 ms · p95 0,18 ms · pior 0,39 ms.

**O que NÃO está medido (e por quê):** o custo real de rede/consultas do Supabase (≈ 25 idas ao banco: carga do estado, apontamentos, catálogo, RPCs de gravação/aplicação/log) e a RPC `escala_aplicar_recalculo` em PROD. Esta máquina não tem credenciais de PROD (e eu não escrevo em PROD). Estimativa de engenharia: 2–3,5 s p50; **a medição oficial é a fase SOMBRA** (o ensaio registra entrada/corte/validação; o `gravacao` e o total são medidos no próprio clique) e a ativação só ocorre se p95 ≤ 5 s (abaixo).

## 6. Plano de deploy (nada disto foi executado)

Pré-requisito: semana ativa no planejador `corte-v1` (`producao_real_planejador_semanas`), senão o portão recusa (por desenho).
1. **Backup durável** (fora de `/private/tmp`): hash/versão do plano, linhas da semana, contagens, parâmetros, eventos (mesmo pacote de 03/11 12:2x).
2. **Migration** `20261110100000` em PROD (inerte: modo desligado, só cria objetos e troca o `escala_reivindicar_eventos` para também reivindicar o novo tipo). Rollback: `supabase/rollbacks/20261110100000_escala_fechamento_fisico_ROLLBACK.sql`.
3. **Seed do catálogo** `docs/fechamento-fisico/seed-catalogo-conector34.sql` (Conector 3/4 + Caixa) e a query de cobertura (0 pares sem buffer).
4. **Permissões**: conceder `escala_fechamento` à(s) pessoa(s) do tablet e `escala_fechamento_excecao` ao perfil superior.
5. **Deploy do código** (flag ainda desligada): sem mudança visível.
6. **SOMBRA** (`"sombra"`) por pelo menos 3 dias úteis completos (≥ 15 fechamentos): a pessoa do tablet já usa a tela; o motor oficial NÃO usa o físico; o banco acumula erro de WIP e ensaios.
7. **GO/NO-GO** (abaixo) → `"ativo"` numa segunda-feira (começo de semana), com o procedimento de rollback à mão.
8. Monitorar: `select * from escala_fechamento_duracao order by 1 desc`, `escala_wip_erro_dia`, eventos `fechamento_fisico` pendentes/erro.

## 7. Rollback

* **Desligar**: `escala_fechamento_fisico_modo = '"desligado"'` — tela some, trigger de apontamento fica inerte, o motor volta às contagens legadas.
* **Exportar o físico para o legado** antes de remover (senão o motor "esquece" a verdade): bloco comentado no início do rollback (`update escala_parametros … || (select … from escala_contagens_fechamento_para_motor)`).
* **Remover objetos**: o script arquiva tudo em `*_arquivo` (tabelas append-only nunca são apagadas sem cópia), restaura o claim da outbox, devolve o CHECK de permissões e roda em transação. O tipo de evento `fechamento_fisico` permanece permitido (histórico não é reescrito).
* **Plano**: o recálculo do fechamento só publica via portão HARD; para desfazer um plano publicado vale o procedimento de sempre (restaurar as linhas da versão anterior de `escala_plano_versoes`).
* **Código**: reverter os commits da branch; com a flag desligada nada depende deles.

## 8. Critérios GO / NO-GO para `ativo`

GO somente se TODOS valerem em ≥ 15 fechamentos reais em sombra (≥ 3 dias):
1. **Tempo**: p95 do fechamento completo (`total_ms` + `aplicar` estimado) ≤ **5 s**; pior caso ≤ 10 s. Acima de 10 s ⇒ NO-GO e investigar o gargalo (log traz entrada/corte/validação/persistência).
2. **Portão**: ≥ 95% dos ensaios com `publicavel = true`; todo `false` explicado e corrigido (o motivo vem no log).
3. **Catálogo**: 0 `pares_sem_buffer` nos ensaios.
4. **Adesão**: ≥ 95% dos períodos com fechamento gravado; 0 fechamentos "sem contagem" que não sejam emergência registrada.
5. **Qualidade do dado**: desvio médio do WIP estimado medido; viés constante entre fechamentos classificado como erro de âncora (esperado cair a ~0 após o 1º dia).
6. **Segurança**: 0 apontamentos bloqueados indevidamente em teste de aceitação com a flag `ativo` num ambiente de Preview; rollback ensaiado uma vez.
7. **Equipe**: pessoa do tablet treinada; perfil superior definido para a exceção; plano de contingência (fechamento por exceção) conhecido.
NO-GO imediato (reverter para `desligado`): qualquer plano publicado fora do portão; apontamento perdido; fechamento CONFIRMADO sem plano persistido; p95 > 10 s.

## 9. Impacto nas telas atuais

* `/producao-real` (painel): novo botão **FECHAR PERÍODO E GERAR PRÓXIMA PROGRAMAÇÃO** (só com flag ≠ desligado, permissão `escala_fechamento` e nos últimos 5 min/depois do fim do período); faixa verde quando confirmado.
* Apontamento (`ApontamentoModal`/`SemProducaoModal`): durante o fechamento (modo ativo) só o responsável lança; mensagem clara quando o trigger recusa.
* Permissões de usuário: duas permissões novas.
* Nada muda nas telas de Escala/TV/Previsão (a tela de Escala já mostra o plano novo porque ele é publicado).

## 10. Lacunas conhecidas (não escondo)

* **Correção pós-fechamento**: o backend e a API aceitam nova revisão (perfil superior), mas **não há tela** para isso.
* **Páginas "Qualidade do WIP" e selo CONFIRMADO nas telas de Escala/TV**: as views existem; as telas não foram feitas (a confirmação aparece na própria tela do fechamento e no painel).
* **Medição de rede/banco do Supabase**: depende da fase sombra (seção 5).
* **Gate de catálogo**: pares sem buffer geram **aviso** (e métrica), não bloqueio — decisão para não parar a fábrica por lacuna de cadastro; o GO exige 0.
* **Produto Único**: deliberadamente fora; só `escala_buffer_pares` muda no cutover.
* **Harness de DEV** `/dev/fechamento` (mock de fetch, `notFound()` em produção, padrão de `/dev/intelligence`): serve à revisão da UX e aos screenshots (`docs/fechamento-fisico/screenshots/`).

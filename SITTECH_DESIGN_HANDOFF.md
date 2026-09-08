# Sittech — Design Handoff

Documento de levantamento do estado ATUAL do frontend Sittech, para entrega ao Claude Design. Gerado por leitura de código + navegação real em DEV (sessão autenticada, dados de teste). **Nenhum código foi alterado para produzir este documento.**

Convenções de status usadas neste documento:
- **ATIVO** — em uso normal, é a fonte de verdade hoje.
- **ATIVO (legado)** — em uso normal, mas vive dentro do monólito antigo (`SittechApp.tsx`), não em uma rota migrada.
- **DEV ONLY** — só existe fora de produção.
- **PLACEHOLDER** — reachable, mas sem funcionalidade real ainda.
- **ORPHANED/MORTO** — código ainda existe no arquivo, mas nenhum botão leva até ele mais.

---

## Sumário

- [1. Mapa completo do produto](#1-mapa-completo-do-produto)
- [2. Navegação](#2-navegação)
- [3. Produção Real](#3-produção-real)
- [4. Sittech Intelligence](#4-sittech-intelligence)
- [5. Previsão / Capacidade](#5-previsão--capacidade)
- [6. Cadastros / Gestão](#6-cadastros--gestão)
- [7. Financeiro / Custos](#7-financeiro--custos)
- [8. Component inventory](#8-component-inventory)
- [9. Design tokens atuais](#9-design-tokens-atuais)
- [10. CSS / estilização](#10-css--estilização)
- [11. Ícones](#11-ícones)
- [12. Gráficos](#12-gráficos)
- [13. Tabelas](#13-tabelas)
- [14. Formulários](#14-formulários)
- [15. Permissões e design](#15-permissões-e-design)
- [16. Estados funcionais](#16-estados-funcionais)
- [17. Responsividade](#17-responsividade)
- [18. Tablet / chão de fábrica](#18-tablet--chão-de-fábrica)
- [19. Futuro PWA](#19-futuro-pwa)
- [20. Identidade Sittech](#20-identidade-sittech)
- [21. Screenshots](#21-screenshots)
- [22. Problemas visuais (UX debt)](#22-problemas-visuais-ux-debt)
- [23. Regras que design não pode quebrar](#23-regras-que-design-não-pode-quebrar)
- [24. Prioridade da informação](#24-prioridade-da-informação)
- [25. O que pode / não pode mudar visualmente](#25-o-que-pode--não-pode-mudar-visualmente)
- [26. Direção futura](#26-direção-futura)
- [27. Apêndices A–N](#27-apêndices-an)

---

## 1. Mapa completo do produto

### 1.1 Arquitetura de rotas — achado mais importante deste levantamento

O app tem uma **rota-raiz `/` que ainda é um monólito pré-Next.js** (`src/features/legacy/SittechApp.tsx`, ~2240 linhas, `// @ts-nocheck`) coexistindo com 14 rotas migradas do App Router. O monólito **não foi todo migrado** — ele ainda é a **única** fonte de 8 telas reais (Início, Custos mensais, Funcionários-custo, Faturamento mensal, Análise de faturamento, Importar dados, Usuários+Auditoria, Dados Importados-placeholder), e mantém ~6 blocos de tela mortos (código que existe mas nenhum botão alcança mais, porque a Sidebar foi trocada para apontar direto para as rotas migradas).

**Bug real de navegação encontrado**: toda página migrada passa `onNavigateTab={() => router.push("/")}` para a Sidebar, ignorando qual item foi clicado. Resultado: clicar em qualquer item ainda-legado (Custos mensais, Funcionários, Faturamento mensal, Análise de faturamento, Usuários, Importar dados, Dados Importados) **a partir de uma página migrada sempre leva para "Início"**, nunca para a aba certa. Só funciona corretamente saindo do próprio `/`. Isso deveria ser corrigido (ou pelo menos considerado) antes/durante o redesign, senão o problema persiste visualmente diferente mas funcionalmente igual.

### 1.2 Mapa de rotas

| Rota | Renderiza | Status |
|---|---|---|
| `/` | `SittechApp` (monólito) | **ATIVO (legado)** — hospeda 8 abas reais, ver §1.3 |
| `/produtos` | `ProdutosPage` | ATIVO |
| `/maquinas` | `MaquinasPage` | ATIVO |
| `/previsao` | `PrevisaoSemanalPage` | ATIVO |
| `/capacidade` | `CapacidadeSemanalPage` | ATIVO |
| `/custo-hora` | `CustoHoraPage` | ATIVO (mas sem CRUD de custo fixo — ver §7) |
| `/producao-real` | `ProducaoRealPainelPage` — **"Apontamento"**, não "visão geral" | ATIVO — chão de fábrica |
| `/producao-real/apontamentos` | `ApontamentosRealizadosPage` — "Apontamentos realizados" | ATIVO |
| `/producao-real/visao-geral` | `VisaoGeralPage` | ATIVO |
| `/producao-real/indicadores` | `IndicadoresProducaoPage` — Sidebar chama de "Produtividade" | ATIVO |
| `/producao-real/funcionarios` | `FuncionariosPage` (analytics, não cadastro) | ATIVO |
| `/producao-real/desvios` | `DesviosPage` | ATIVO |
| `/producao-real/paradas` | `ParadasPage` | ATIVO |
| `/producao-real/validacao-previsao` | `ValidacaoPrevisaoPage` | ATIVO |
| `/dev/intelligence` | `DevIntelligencePage` | **DEV ONLY** — `notFound()` em produção; harness técnico, não é a UI final |

API (server-only, sem UI própria): `POST /api/admin/usuarios`, `POST /api/admin/usuarios/[id]/reset-senha`, `POST /api/intelligence/chat`.

Não há `src/middleware.ts` — nenhuma rota tem guarda de nível de framework; cada página se autoprotege (client-side via `temPermissao`) e cada API se autoprotege no handler.

### 1.3 As 8 telas reais que só existem dentro do monólito (`abaAtiva`)

| Aba | Tela | Permissão | Único lugar que existe? |
|---|---|---|---|
| `inicio` | Dashboard "Início" — faturamento, lucro, ponto de equilíbrio, meta, tendência (chart) | nenhuma direta | **Sim** |
| `custos` | Custos mensais (CRUD de custos fixos/pontuais) | `financeiro` | **Sim** |
| `funcionarios` | Funcionários — CRUD de custo (salário, custos extras) | `funcionarios` | **Sim** — não confundir com `/producao-real/funcionarios` (analytics, permissão diferente) |
| `faturamento` | Faturamento mensal (lançamento de receita por data) | `financeiro` | **Sim** |
| `bi` | Análise de faturamento (BI com filtros de período + gráficos) | `financeiro` | **Sim** |
| `importar` | Importar dados / gerar backup | admin | **Sim** |
| `usuarios` | Usuários (CRUD admin) + Registro de atividade (auditoria) embutido | admin (não a permissão `usuarios`/`auditoria` — ver §15) | **Sim** — não existe aba "Auditoria" separada |
| `prDadosImportados` | Placeholder "Aguardando integração com a Plataforma Ninja" | grupo Produção Real | Sim, mas é placeholder mesmo lá |

### 1.4 Blocos mortos no monólito (não usar como referência de design)

`prVisaoGeral`, `prProdutividade`, `prFuncionarios`, `prDesvios`, `prParadas`, `prValidacao` — todos placeholders (`PainelAguardandoIntegracao`) sem nenhum botão que os alcance mais; foram substituídos pelas rotas migradas reais. **Ignorar completamente.**

### 1.5 Inventário resumido de telas (23 telas reais + 1 harness DEV)

| # | Tela | Rota/aba | Status | Usuário típico | Permissão |
|---|---|---|---|---|---|
| 1 | Início (dashboard) | `/` aba `inicio` | ATIVO (legado) | Gestor/financeiro | nenhuma (redireciona quem só tem `producao_real_apontamento`) |
| 2 | Custos mensais | `/` aba `custos` | ATIVO (legado) | Financeiro | `financeiro` |
| 3 | Funcionários (custo) | `/` aba `funcionarios` | ATIVO (legado) | Gestor de RH/custo | `funcionarios` |
| 4 | Faturamento mensal | `/` aba `faturamento` | ATIVO (legado) | Financeiro | `financeiro` |
| 5 | Análise de faturamento | `/` aba `bi` | ATIVO (legado) | Financeiro/diretoria | `financeiro` |
| 6 | Importar dados | `/` aba `importar` | ATIVO (legado) | Admin | admin |
| 7 | Usuários + Auditoria | `/` aba `usuarios` | ATIVO (legado) | Admin | admin |
| 8 | Dados Importados | `/` aba `prDadosImportados` | PLACEHOLDER | Produção | grupo Produção Real |
| 9 | Produtos | `/produtos` | ATIVO | Cadastro/gestão | `produtos` |
| 10 | Máquinas | `/maquinas` | ATIVO | Cadastro/gestão | `maquinas` |
| 11 | Previsão semanal | `/previsao` | ATIVO | Planejamento | `previsao` |
| 12 | Capacidade semanal | `/capacidade` | ATIVO | Planejamento | `capacidade` |
| 13 | Custo por hora | `/custo-hora` | ATIVO | Gestão | `custo_hora` |
| 14 | Apontamento | `/producao-real` | ATIVO — tablet/chão de fábrica | Supervisora | `producao_real_apontamento` (+`_ocorrencias`) |
| 15 | Apontamentos realizados | `/producao-real/apontamentos` | ATIVO | Supervisão/gestão | `producao_real_historico` |
| 16 | Visão Geral | `/producao-real/visao-geral` | ATIVO — hub executivo | Gestão | `producao_real_historico` |
| 17 | Produtividade (Indicadores) | `/producao-real/indicadores` | ATIVO — engine central | Gestão/análise | `producao_real_historico` |
| 18 | Funcionários (analytics) | `/producao-real/funcionarios` | ATIVO | Gestão | `producao_real_historico` |
| 19 | Desvios | `/producao-real/desvios` | ATIVO — fila automática | Gestão | `producao_real_historico` |
| 20 | Paradas | `/producao-real/paradas` | ATIVO — engine central | Gestão/análise | `producao_real_historico` |
| 21 | Validação da Previsão | `/producao-real/validacao-previsao` | ATIVO — cruza 2 domínios | Gestão/planejamento | `previsao` **e** `producao_real_historico` |
| 22 | Sittech Intelligence | painel global (não é rota) | ATIVO — recém-implementado | Qualquer um com `producao_real_historico` | `producao_real_historico` (+ `financeiro` por tool) |
| — | `/dev/intelligence` | harness | **DEV ONLY** | Dev | `producao_real_historico` + `NODE_ENV≠production` |

Detalhe screen-by-screen (filtros/KPIs/tabelas/estados/drill-down) nas seções 3, 5, 6, 7.

---

## 2. Navegação

### 2.1 Sidebar (`src/components/shell/Sidebar.tsx`)

Um único componente, **compartilhado literalmente pelo monólito e por todas as 14 páginas migradas** (não há duplicação). Grupos:

| Grupo | Visível se | Itens |
|---|---|---|
| (nenhum, topo) | sempre | Início |
| Gestão | `financeiro`\|`funcionarios`\|`produtos`\|`maquinas`\|`custo_hora` | Custos mensais*, Funcionários*, Produtos, Máquinas, Custo por hora |
| Financeiro | `financeiro` | Faturamento mensal*, Análise de faturamento* |
| Planejamento | `previsao`\|`capacidade` | Previsão semanal, Capacidade semanal |
| Produção Real | qualquer `producao_real_*` | Apontamento, Apontamentos realizados, Visão Geral, Produtividade, Funcionários, Desvios, Paradas, Validação da Previsão, Dados Importados* |
| Administração | `papel === admin` | Usuários*, Importar dados* |

(`*` = ainda navega para dentro do monólito via `onNavigateTab`, não é uma rota real — ver bug do §1.1.)

**Accordion é mutuamente exclusivo**, não independente: `useGruposAbertosSidebar` guarda um único `grupoAberto: Grupo | null`. Abrir um grupo sempre fecha o que estava aberto. Ao montar, abre automaticamente o grupo dono da aba atual.

Card "Meta semanal" fixo no rodapé da Sidebar (visível só com `financeiro`), clicável → volta pra Início.

Sem breadcrumbs em lugar nenhum do app (confirmado — grep zero resultados).

### 2.2 TopBar / TopBarActions

Mesmo componente em toda tela autenticada: **Intelligence** (trigger, só com `producao_real_historico`) · **Ocultar valores** (toggle modo privado) · **Modo claro/escuro** · **Minha conta** (abre `AccountModal`, trocar a própria senha) · **Sair** · **sino de notificação** — **confirmado decorativo**, sem `onClick`, sem contagem, sempre com o pontinho aceso.

### 2.3 Árvore de navegação (resumo textual)

```
/ (legado)
├── Início                      [visível sempre]
├── Gestão
│   ├── Custos mensais          [financeiro]      → aba legado
│   ├── Funcionários            [funcionarios]     → aba legado
│   ├── Produtos                [produtos]         → /produtos
│   ├── Máquinas                [maquinas]         → /maquinas
│   └── Custo por hora          [custo_hora]       → /custo-hora
├── Financeiro                  [financeiro]
│   ├── Faturamento mensal      → aba legado
│   └── Análise de faturamento  → aba legado
├── Planejamento                [previsao|capacidade]
│   ├── Previsão semanal        → /previsao
│   └── Capacidade semanal      → /capacidade
├── Produção Real                [qualquer producao_real_*]
│   ├── Apontamento             [producao_real_apontamento] → /producao-real
│   ├── Apontamentos realizados [producao_real_historico]   → /producao-real/apontamentos
│   ├── Visão Geral             [producao_real_historico]   → /producao-real/visao-geral
│   ├── Produtividade           [producao_real_historico]   → /producao-real/indicadores
│   ├── Funcionários            [producao_real_historico]   → /producao-real/funcionarios
│   ├── Desvios                 [producao_real_historico]   → /producao-real/desvios
│   ├── Paradas                 [producao_real_historico]   → /producao-real/paradas
│   ├── Validação da Previsão   [previsao & producao_real_historico] → /producao-real/validacao-previsao
│   └── Dados Importados        [grupo]            → aba legado (placeholder)
└── Administração               [admin]
    ├── Usuários (+auditoria)   → aba legado
    └── Importar dados          → aba legado

TopBar (toda tela): Intelligence · Ocultar valores · Tema · Minha conta · Sair · sino (decorativo)
```

---

## 3. Produção Real

Todas as 7 telas migradas + o fluxo de Apontamento compartilham o mesmo padrão de composição: `GlobalStyles` → gate de recovery/login → `Sidebar`+`TopBarActions` → gate de permissão (`AcessoNegado`) → conteúdo. Nenhuma tem paginação nativa; a maioria usa `useSearchParams` para receber drill-down (não para navegação própria).

### 3.1 Apontamento (`/producao-real`) — chão de fábrica

Tela **operacional**, tablet-first. Comentário no código: *"Meta, custo/hora, OEE, disponibilidade, qualidade e atingimento nunca aparecem nesta tela — só o necessário pra supervisora saber o que já fechou e o que falta."*

- **Sem filtros de data/produto** — é sempre o período atual (ou "Outro período" para lançamento retroativo).
- Banner de período + progresso ("N de M máquinas fechadas"), botão grande vermelho "⚠ INFORMAR MÁQUINA PARADA".
- Grid de cards, um por máquina ativa: nome, estado (PENDENTE/APONTADO/SEM PRODUÇÃO), pill "🔴 PARADA AGORA" se aplicável.
- **Fluxo de apontamento completo** (a sequência mais importante para redesenhar bem):
  1. Toca no card → `EscolhaFluxoModal`: **"REGISTRAR PRODUÇÃO"** ou **"SEM PRODUÇÃO NESTE PERÍODO"**.
  2a. Registrar produção → Produto (só elegíveis) → Funcionário → Quantidade + Refugo → Paradas do período (editor embutido, paradas automáticas de ocorrência ficam bloqueadas 🔒) → Observação → **SALVAR** → confirmação com badge de Performance → "PRÓXIMA MÁQUINA" ou "VER TODAS".
  2b. Sem produção → grid de 5 motivos (+ descrição se "Outro") → **CONFIRMAR**.
  3. Ocorrência (máquina parada, permissão separada `producao_real_ocorrencias`): Máquina → Produto → Funcionário → Motivo → descrição → **INFORMAR MÁQUINA PARADA**; encerrar depois com "O que foi feito para resolver?".
- Estados: vazio "Nenhuma máquina ativa cadastrada.", erro em `stx-save-error`, acesso negado.

### 3.2 Apontamentos realizados (`/producao-real/apontamentos`)

**Analítico/consulta**, não operacional. Filtros completos (data/período/máquina/produto/funcionário/status), colapsados por padrão. Lista clicável (não tabela), cada linha abre `ResumoApontamentoModal` com 5 modos: resumo → editar → confirmar exclusão (irreversível, com aviso explícito) → salvo/excluído. **Limite de 100 resultados** com aviso para refinar filtro — não há paginação real.

### 3.3 Visão Geral (`/producao-real/visao-geral`)

**Camada 100% de composição** — texto literal no código e na tela: *"nenhum dado é calculado de novo aqui"*. 6 cards, cada um reaproveitando a engine de outra tela e linkando pra ela: Saúde da fábrica → Produtividade; Situação da semana → Validação da Previsão; Agora (ocorrências abertas) → Apontamento; Principais atenções → Desvios; Paradas → Paradas; Recurso mais pressionado → Validação da Previsão. Sem filtros (janela fixa: semana atual). É um **hub**, nunca um destino de drill-down.

### 3.4 Produtividade / Indicadores (`/producao-real/indicadores`)

A **engine central** do módulo — 8 abas: Resumo geral, Evolução diária (gráfico), Máquinas, Produtos, Operações, Funcionários, Pareto de paradas (gráfico), Economia. Filtros completos com `useSearchParams` (aceita drill-down). Tabelas em Máquinas/Produtos/Operações/Funcionários são expansíveis (clique abre sub-tabela por outra dimensão, sem nova consulta). Resumo geral distingue explicitamente **"Produção acabada"** (só última etapa) de **"Produção processada"** (volume bruto, qualquer etapa) — ver §23.

### 3.5 Funcionários — analytics (`/producao-real/funcionarios`)

**Nunca ranking.** Comentário: *"como as pessoas estão performando dentro de contextos realmente comparáveis (nunca ranking geral)"*. Sem filtros manuais (janela fixa: semana atual vs. anterior). 3 abas: Merecem atenção / Destaques positivos / Lista de funcionários (sempre alfabética). Detalhe por funcionário mostra Performance/Qualidade **por contexto** (produto+operação+máquina), nunca uma nota única; paradas e resultado econômico são sempre "observados durante os apontamentos", nunca "causados pelo funcionário".

**Não confundir com a tela de cadastro de funcionários** (nome/salário/custos extras), que só existe dentro do monólito (`/` aba `funcionarios`, permissão `funcionarios`) — são duas telas diferentes sobre a mesma tabela.

### 3.6 Desvios (`/producao-real/desvios`)

Fila automática priorizada, explicitamente **"nunca um dashboard a mais"**. Sem filtro de data (janelas automáticas: semana atual vs. semana anterior + últimos 28 dias vs. 28 anteriores). Filtros client-side: tipo/severidade/produto/máquina. Cards expansíveis mostram comparação, magnitude, "possíveis fatores" (nunca causa confirmada), confiança. Nunca atribui causa a uma pessoa.

### 3.7 Paradas (`/producao-real/paradas`)

A tela com **mais abas** (7): Resumo, Pareto (gráfico), Evolução e tendência (gráfico), Recorrência, Por máquina/operação/produto, Sem produção, Detalhado (lista plana, limite de 200 linhas). Distingue sempre **"Custo do tempo ocioso"** (R$) de **"Capacidade local perdida"** (peças) — nunca "faturamento perdido" (conceito que não existe no sistema).

### 3.8 Validação da Previsão (`/producao-real/validacao-previsao`)

Única tela que exige **duas permissões simultâneas** (`previsao` E `producao_real_historico`) — cruza os dois domínios. Sempre semana atual, sem filtro. 5 estados de risco por produto (ver §23). Nunca escreve de volta na Previsão Semanal — comentário explícito: *"Nunca altera a Previsão Semanal — só analisa."*

---

## 4. Sittech Intelligence

Implementado nesta mesma sessão de trabalho (arquitetura em `src/features/intelligence/`, UI em `src/features/intelligence/components/`). Documentado aqui para o handoff porque **é a peça mais nova do produto e a que mais precisa de cuidado de design** — mas seu contrato funcional não pode mudar sem aprovação (é DEV-only e recém-validada com evals reais).

**Princípio central**: Intelligence **não é um dashboard**. É uma camada de investigação em linguagem natural sobre os motores determinísticos que já existem — nunca calcula nada sozinha, sempre cita evidências estruturadas, nunca inventa números.

### 4.1 Estrutura visual atual

- **Trigger global**: pill no TopBar (ícone `Radar` + "Intelligence"), só visível com `producao_real_historico`.
- **Desktop**: painel fixo à direita, `min(440px, 94vw)`, sem escurecer o resto da tela (o usuário continua vendo a página atrás).
- **Mobile/tablet** (`&lt;760px`): sheet full-screen.
- **Empty state**: "O que você quer entender da fábrica?" + subtítulo + 4 chips de sugestão + composer.
- **Composer**: textarea, Enter envia, Shift+Enter quebra linha, botão redondo de enviar.
- **Conversa**: pergunta em texto leve (não bolha) → resposta (parece análise de sistema, preserva texto do core, só troca `**negrito**` por `&lt;strong&gt;`) → Evidências (seção recolhível, cards com métrica/valor formatado/confiança/contexto/"Ver dados") → Tool trace (recolhível, "Análise baseada em N consultas", nomes amigáveis) → Follow-ups (chips, hoje sempre vazio — schema não populado ainda).
- **Loading**: mensagens progressivas por tempo decorrido ("Entendendo sua pergunta..." → "Consultando os dados..." → "Cruzando os dados disponíveis..." após 15s → "Esta análise envolve mais de uma fonte de dados." após 30s) + timer.
- **Confidence**: texto pequeno/mono, nunca badge colorido gritante — FATO/CALCULADO neutros, ESTIMATIVA/APROXIMAÇÃO em amarelo (`--warning`), sem ícone de alerta.
- **Debug DEV**: barra discreta (tools/evidências/tokens/latência), só fora de produção; **não mostra o nome do modelo** (o endpoint não devolve esse campo).
- **Erros**: mapeados para mensagens seguras (429 → limite; 401 → sessão expirou; 500/rede → "temporariamente indisponível") — nunca o texto cru do provider.

### 4.2 O que o Claude Design PODE mudar

Toda a apresentação: cores, espaçamento, tipografia, animação de abertura, layout dos cards de evidência, ícone do trigger, texto do empty state, estilo do composer.

### 4.3 O que NÃO pode mudar sem aprovação

- O contrato do endpoint (`answer`/`evidences`/`followUps`/`context`/`usage`/`debug` — ver `src/features/intelligence/types.ts`).
- A regra de nunca esconder confidence/evidência de um número citado.
- A ausência de streaming/SSE (a resposta chega inteira — qualquer "loading" tem que continuar honesto, nunca fingir progresso real de tool específica).
- O uso de `history` como mecanismo de contexto entre perguntas (não há `ultimoContexto` persistido de fato — ver limitação abaixo).

**Limitação conhecida**: o campo `ConversationContext.ultimoContexto` existe no tipo mas não é usado na prática — a continuidade de conversa funciona só reenviando o texto da conversa (`history`), validado nos evals reais. Um redesign não deve assumir que existe memória estruturada de entidade "por trás".

---

## 5. Previsão / Capacidade

### 5.1 Previsão Semanal (`/previsao`)

Bancada semanal (segunda a segunda). Conceitos exibidos, cada um com fonte própria — **nunca intercambiáveis**:

| Rótulo na UI | O que é | Fonte |
|---|---|---|
| **Previsto** | Quantidade planejada pra semana | `previsao_itens` (lançamento manual) |
| **Possível** | Máximo produzível dado o gargalo mais apertado (redução proporcional entre itens) | `calcularCapacidadeMaximaSemana` |
| **Realizado** | Quantidade lançada manualmente como "realizada" | `previsao_itens tipo='realizado'` — **decisão de negócio**: não vem de Produção Real |
| **Falta** | `max(0, Previsto − Realizado)`, nunca negativo | derivado |
| **%** | `Realizado/Previsto`, **sem teto em 100%** | derivado |

Painel "Status da programação": ✓/⚠ atingível, máquina mais carregada, barras por máquina (`gargalo`/`proximo`/`atencao`/`normal`), seção "Gargalos da semana" com produtos concorrentes, sugestões de sequenciamento de setup. Modal "Ajustar para capacidade" reduz previsto até o possível (com preview de diff). "Modo simulação" testa cenários sem gravar. Exportação PDF via impressão do navegador.

### 5.2 Capacidade Semanal (`/capacidade`)

Console de **alocação** (algoritmo diferente do de Previsão: guloso por lucro/hora, não proporcional). Permite marcar máquinas indisponíveis só naquela semana (não mexe no cadastro). Painéis: disponibilidade de máquinas, resumo em linguagem natural (atendidos/com déficit/sobra), tabela "Alocação por produto" (ordenada por lucro/hora), "Capacidade por operação". Sem filtro de produto, sem forms de criação (edição de item é só em Previsão).

### 5.3 Relação Previsão ↔ Capacidade ↔ Validação da Previsão

As três leem **o mesmo registro semanal** (`previsoes`, via `selecionarSemana`), mas cada uma roda um algoritmo diferente sobre ele:
- Previsão → "Possível" = redução proporcional entre todos os itens.
- Capacidade → "Alocação" = greedy por lucro/hora.
- Validação da Previsão → reaproveita literalmente as funções de Capacidade, nunca recalcula, e cruza com Produção Real observada.

---

## 6. Cadastros / Gestão

Produtos, Máquinas e Funcionários(custo, no legado) seguem o **mesmo padrão de cadastro**: painel "+ Novo X" → formulário inline (nunca modal) acima de uma lista de cards; edição reabre o mesmo formulário preenchido; **toggle ativo/pausado é soft** (nunca remove); **exclusão é hard delete sem confirmação nenhuma na UI**, protegida só no banco (FK `RESTRICT`) com mensagem de erro amigável quando bloqueada.

| Tela | Rota/aba | Form principal | Exclusão |
|---|---|---|---|
| Produtos | `/produtos` | Nome, Referência, Valor unitário, Prioridade (não afeta cálculo ainda), Fluxo de produção (etapas → operação → meta por período → máquinas elegíveis) | ✕ sem confirmação; bloqueada se usada em previsão lançada |
| Máquinas | `/maquinas` | Nome, Operação | ✕ sem confirmação; bloqueada se usada em produto/previsão |
| Funcionários (custo) | `/` aba `funcionarios` | Nome, Salário base, Operação, custos extras repetíveis | — |
| Usuários | `/` aba `usuarios` | Nome, e-mail, papel, permissões (checkboxes por grupo) | reset de senha, ativar/desativar |

Produtos mostra card com Valor recebido / Custo de produção / Margem / Lucro-hora (calculados, não editáveis) — lista já ordenada por lucro/hora. Máquinas mostra card expansível "quais produtos usam esta máquina".

---

## 7. Financeiro / Custos

**Não existe uma tela `/financeiro` migrada.** O que existe:

- **Custo por Hora** (`/custo-hora`, migrada): mostra a derivação custo/hora (períodos de trabalho → horas produtivas → custo/hora empresa e por operação/funcionário) — **mas não tem CRUD de custo fixo nenhum**. Isso só existe em "Custos mensais" (legado).
- **Custos mensais** (`/` aba `custos`, legado): CRUD de custos fixos/pontuais.
- **Faturamento mensal** (`/` aba `faturamento`, legado): lançamento de receita por data + "Custos do mês" + resultado (bruto/imposto 9%/custo total/lucro líquido) + histórico mensal.
- **Análise de faturamento** (`/` aba `bi`, legado): 3 modos de filtro (todo período/mês específico/intervalo), 4 KPIs (faturamento acumulado, lucro acumulado, melhor mês, pior mês), 2 gráficos com seletor Barra/Linha/Área.
- **Início** (`/` aba `inicio`, legado): dashboard com os mesmos números resumidos + gráfico de tendência (6 meses).

Nenhuma fórmula foi reinterpretada aqui — só documentado o que a UI mostra hoje.

---

## 8. Component inventory

### 8.1 GLOBAL (shell — `src/components/shell/`)

Só 7 arquivos, todos chrome de app, **sem duplicação** (o mesmo componente serve o legado e as rotas migradas):

| Componente | Papel |
|---|---|
| `GlobalStyles.tsx` | injeta o `&lt;style&gt;` único do app inteiro |
| `Sidebar.tsx` | menu lateral, grupos/accordion, gates de permissão |
| `TopBarActions.tsx` | Intelligence + toggles + conta + sair + sino |
| `AccountModal.tsx` | trocar a própria senha |
| `LoginScreen.tsx` | login (dobra como splash de loading) |
| `RecoveryPasswordScreen.tsx` | fluxo de recuperação de senha |
| `AcessoNegado.tsx` | mensagem de "Acesso restrito" |

### 8.2 COMPARTILHADO (feature-agnóstico, mas fora do shell)

- `src/lib/performance.ts` → `classificarPerformance` (critico/atencao/atingido/indisponivel), usado por `PerformanceIndicador.tsx` (Produção Real) e reimplementado localmente em Desvios/Visão Geral/Validação com suas próprias variantes.
- `src/lib/format.ts` → `formatBRL`/`formatQtd`/cores por margem-lucro, usado em quase toda tela com número.

### 8.3 FEATURE-SPECIFIC (não exaustivo — ~45 componentes)

Produção Real (maior concentração): `SaudeFabricaCards`, `SituacaoSemanaCard`, `OcorrenciasAbertasCard`, `PrincipaisAtencoes`, `ParadasResumoCard`, `RecursoPressionadoCard` (Visão Geral); `ResumoCards`, `EvolucaoDiariaChart`, `TabelaGrupos`, `ParetoParadas`, `EconomiaCards`/`EconomiaPorProduto` (Indicadores); `ResumoParadasCards`, `ParetoParadasSeletor`, `EvolucaoTendenciaParadas`, `RecorrenciaParadas`, `AnaliseParadasPorRecurso`, `SemProducaoResumoView`, `DrillDownParadasLista` (Paradas); `ResumoDesviosCards`, `FilaDesvios`, `DetalheDesvio` (Desvios); `ResumoEquipeCards`, `CardsSinais`, `ListaFuncionarios`, `DetalheFuncionario` (Funcionários); `ResumoSemanaCards`, `ListaProdutosComDetalhe`, `RecursosEEvidencias` (Validação); `ApontamentoModal`, `SemProducaoModal`, `EscolhaFluxoModal`, `AbrirOcorrenciaModal`, `EncerrarOcorrenciaModal`, `ParadasManuaisEditor`, `PeriodoSeletorModal`, `ResumoApontamentoModal` (Apontamento).

Previsão/Capacidade: `ItensPrevistos`, `ItensRealizados`, `ProdutosProgramados`, `StatusProgramacao`, `AjustarCapacidadeModal`.

Cadastros: `ProdutoForm`, `MaquinaForm`.

Intelligence (15 componentes, todos criados nesta sessão): `IntelligenceTrigger`, `IntelligencePanel`, `IntelligenceEmptyState`, `IntelligenceComposer`, `IntelligenceInteraction`, `IntelligenceResponse`, `IntelligenceEvidenceList`, `IntelligenceToolTrace`, `IntelligenceFollowUps`, `IntelligenceLoading`, `IntelligenceError`, `IntelligenceDebugBar` — ver §4.

**Total aproximado: ~65-70 componentes principais catalogados.**

---

## 9. Design tokens atuais

Fonte: `src/lib/constants.ts` (`THEMES`) + `src/components/shell/GlobalStyles.tsx`. **Nenhum token abaixo foi inventado** — todos vêm literalmente do código.

### 9.1 Cores

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#000000` | `#f2f4f2` |
| `--surface` | `#161616` | `#ffffff` |
| `--surface-hover` | `#212121` | `#eaeee9` |
| `--border` | `#2a2a2a` | `#dde2de` |
| `--text` | `#ededed` | `#1a1d21` |
| `--text-muted` | `#8f8f8f` | `#69737d` |
| `--accent` (verde Sittech) | `#30B09B` | `#1F8A73` |
| `--accent-soft` | `rgba(48,176,155,0.16)` | `rgba(31,138,115,0.10)` |
| `--blueprint` (verde secundário) | `#1D7A68` | `#145C4E` |
| `--danger` | `#d9534f` | `#c0392b` |
| `--warning` | `#f0b429` | `#b8790a` |
| `--laranja` | `#e0812f` | `#b8631a` |
| `--btn-text` | `#ffffff` | `#ffffff` |

Não há tokens semânticos separados de "success"/"info" — `accent` faz o papel de success, não existe cor "info" dedicada (usa `blueprint` ou `accent-soft` ad hoc).

### 9.2 Tipografia

- `--font-display`: **Sora** (títulos, 700/800 weight)
- `--font-body`: **Inter** (texto geral)
- `--font-mono`: **JetBrains Mono** (todo número/valor)
- Carregadas via `@import` do Google Fonts dentro do próprio `&lt;style&gt;`.
- Escala observada: 10-12px (meta/eyebrow, uppercase, letter-spacing 0.03-0.08em) · 12.5-14px (corpo/tabela) · 15-19px (títulos de card) · 21-27px (títulos de página) · 38-48px (número de destaque, ex. performance do apontamento).

### 9.3 Forma / elevação

- Border-radius: 6px (botão/input/pill) · 8px (card) · 10-12px (painel/modal).
- Sombra de painel: `0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08)`.
- Sombra de modal: `0 8px 30px rgba(0,0,0,.3)`.
- Motivo decorativo recorrente: "cantos técnicos" (`::before`/`::after` de 8×8px, borda dupla em L) em `stx-total-box`/`stx-destaque-box` — vale de referência pro "industrial premium" pedido em §26.

### 9.4 Layout

- Sidebar: 220px fixa, `position: sticky`.
- Breakpoints: **760px** (cutoff principal — sidebar vira linha horizontal com scroll), 600px (compactação adicional), 480px e 720px (grids específicos).
- Sem framework de grid (Tailwind/Bootstrap) — grids são `display:grid`/`grid-template-columns` manuais por componente.

### 9.5 z-index relevantes

- Modal padrão: 200.
- Intelligence backdrop: 300 / painel: 301.

### 9.6 Ícones

Tamanho dominante: **16px**. Chevrons 13px. Sino 18px. Intelligence trigger 14px. Ver §11.

---

## 10. CSS / estilização

- **Sem Tailwind, sem shadcn, sem Radix, sem CSS Modules.** Confirmado: zero dependência desse tipo no `package.json`.
- Todo o CSS do app inteiro vive em **um único arquivo**, `GlobalStyles.tsx`, injetado como `&lt;style&gt;{`...`}&lt;/style&gt;` — ~2000+ linhas, classes com prefixo `stx-`.
- Esse componente precisa ser montado em **toda página** (cada `page.tsx` renderiza `&lt;GlobalStyles cores={...}&gt;` de novo) — se uma tela nova esquecer de montá-lo, fica sem estilo nenhum.
- Todo elemento estilizado fica dentro de um wrapper `.stx-root` (é ele que declara as CSS custom properties `--bg`/`--accent`/etc.) — qualquer novo componente/página precisa renderizar dentro dele.
- Responsividade: só `@media` queries dentro desse mesmo arquivo, nos breakpoints do §9.4.
- Inline styles (`style={{...}}`) aparecem bastante nas páginas de feature para ajustes pontuais de espaçamento — não há convenção rígida de "sempre classe" vs "sempre inline".
- **Duplicação visual real encontrada**: as famílias de classes `stx-tabela-producao-*`, `stx-ind-tabela-*` e `stx-hist-row` implementam o mesmo padrão de "linha de tabela em grid" três vezes com pequenas diferenças (ex.: só `stx-hist-row` tem `text-align:right` explícito nas colunas numéricas — as outras duas dependem só da fonte monoespaçada, então number columns ficam alinhados à esquerda nelas).

---

## 11. Ícones

Biblioteca única: **`lucide-react`**. Vocabulário pequeno e consistente — a maioria das telas não usa ícone nenhum (confia em cor/badge de texto).

| Área | Ícones usados |
|---|---|
| Sidebar (23 ícones, um por item) | Home, CalendarClock, Gauge, Package, Cog, Receipt, LineChart, Wallet, Clock, Users, Upload, Crown, ChevronDown/Right, Factory, Activity, PauseCircle, ClipboardCheck, ClipboardList, History, Database, UserCog, AlertTriangle |
| TopBar | Bell |
| Produção Real | AlertTriangle (botão de parada), ChevronDown/Right (toggle de filtros, 3 telas) |
| Previsão | AlertTriangle, CheckCircle2, ChevronDown/Up (status atingível/não atingível) |
| Produtos | Percent, Clock (11px, rótulo de margem/lucro-hora) |
| Financeiro/legado | Package, Clock, Users, DollarSign, Scale, Target, Sparkles, ClipboardList, Layers, TrendingUp/Down |
| Intelligence | Radar (trigger), ChevronDown/Right, ExternalLink, ArrowUp, X |

Tamanho: quase sempre 16px; nunca ícone-only clicável exceto o X de fechar/ícones de ação em linha de tabela (✎/✕/⏸/▶, alguns em emoji literal, não lucide — outra pequena inconsistência).

**Recomendação**: manter `lucide-react` no redesign — é a única biblioteca instalada e já cobre o vocabulário atual sem clash de estilo.

---

## 12. Gráficos

Biblioteca única: **`recharts`**, sempre dentro de `&lt;ResponsiveContainer&gt;` (nenhum gráfico de largura fixa encontrado).

| Tela | Tipo | Métrica |
|---|---|---|
| Indicadores → Evolução diária | LineChart | Performance/Disponibilidade/OEE por dia |
| Indicadores → Pareto de paradas | ComposedChart (Bar+Line) | minutos + % acumulado |
| Paradas → Pareto | ComposedChart | métrica selecionável + % acumulado |
| Paradas → Evolução e tendência | LineChart | minutos parados + qtd. paradas por dia |
| Início (legado) | AreaChart | Faturamento bruto vs. Lucro líquido, 6 meses |
| Análise de faturamento (legado) | Line/Area/Bar (seletor) | Faturamento×Custo, Composição de custo, Nº funcionários, Custo médio |
| Análise de faturamento (legado) | Line/Area/Bar | Lucro líquido/mês, Margem % (cor do ponto por faixa) |
| Custos por categoria (legado) | PieChart | distribuição de custos do mês |

Padrão Pareto (Bar+Line combinado) se repete em Paradas e Indicadores — vale manter como um "componente de gráfico" reconhecível no redesign. Uma tela (BI de faturamento) usa legenda customizada em HTML (`stx-legenda-cores`) em vez do `&lt;Legend&gt;` nativo do recharts — inconsistência pequena a resolver.

**Nenhum problema grave de legibilidade observado nos dados de teste** (poucos pontos), mas os gráficos densos do legado (Análise de faturamento, com 20 meses no eixo X) tendem a apertar rótulos — vale atenção em telas largas de histórico.

---

## 13. Tabelas

**Não existe nenhum `&lt;table&gt;` HTML real no app inteiro.** Tudo é `&lt;div&gt;` em CSS grid, com famílias de classe diferentes por tela (`stx-ind-tabela-*`, `stx-tabela-producao-*`, `stx-hist-row`, ou simplesmente listas de "cards" tipo `stx-entry`/`stx-func-card`).

- **Nenhum cabeçalho é sticky** (o único `position:sticky` do app inteiro é a Sidebar).
- **Nenhuma tabela tem paginação.** As únicas duas exceções têm um corte fixo com aviso de texto: Apontamentos realizados (100 registros) e Paradas → Detalhado (200 linhas) — "Mostrando os N mais recentes/maiores — refine os filtros".
- **Alinhamento numérico é inconsistente**: só a família `stx-hist-row` tem `text-align:right` explícito nas colunas de número; as outras dependem só da fonte mono, então ficam à esquerda.
- Linhas clicáveis/expansíveis (drill-down inline sem nova consulta) aparecem em Indicadores (Máquinas/Produtos/Operações/Funcionários), Paradas (Pareto/Recorrência), Funcionários (lista → detalhe), Máquinas cadastro (produto que usa a máquina).
- Sem ordenação nativa em nenhuma tabela (a ordem vem pronta do cálculo, ex. "sempre alfabética" em Funcionários, "maior lucro/hora primeiro" em Produtos).
- Sem seleção múltipla/checkbox em nenhuma lista.

---

## 14. Formulários

Padrão consistente: `&lt;label className="stx-label"&gt;` diretamente acima de `&lt;input className="stx-input"&gt;`/`&lt;select className="stx-select"&gt;`. Botões sempre em par primário+secundário (`stx-btn-primary`+`stx-btn-secondary`) dentro de `stx-form-actions`.

- **Nenhum indicador visual de campo obrigatório** (sem asterisco, sem badge "obrigatório") em nenhum formulário do app.
- **Validação é inconsistente**: Produtos/Máquinas falham **silenciosamente** (o submit só faz `return` se um campo obrigatório estiver vazio — nenhuma mensagem aparece); só alguns formulários mostram erro, e de formas diferentes: `AccountModal` usa um parágrafo colorido condicional (verde se contém "sucesso", vermelho senão); modais com round-trip ao servidor (ex. Encerrar ocorrência) usam a classe dedicada `stx-save-error`; o form de novo usuário (legado) usa um parágrafo vermelho inline ad hoc.
- Forms de cadastro (Produtos/Máquinas/Usuários) são **inline na página**, nunca modal. Forms de ação pontual (trocar senha, encerrar ocorrência, apontamento) são **sempre modal** (`stx-modal-card`).
- Datas: sempre `&lt;input type="date"&gt;`/`type="month"` nativo — não existe date-picker customizado em lugar nenhum.
- Ação destrutiva (excluir produto/máquina): **dispara na hora, sem diálogo de confirmação** — só protegida no banco. A única exclusão com confirmação de verdade na UI é o apontamento (`ResumoApontamentoModal`, texto explícito "Esta ação não pode ser desfeita").

---

## 15. Permissões e design

A navegação **muda de verdade** por permissão — grupos inteiros da Sidebar podem sumir, não só o conteúdo da página. Um mock de design não pode assumir Sidebar fixa.

| Permissão | Controla |
|---|---|
| `financeiro` | grupo Financeiro inteiro + item "Custos mensais" + card "Meta semanal" |
| `funcionarios` | item "Funcionários" (custo, dentro de Gestão) |
| `produtos` / `maquinas` / `custo_hora` | itens homônimos |
| `previsao` / `capacidade` | grupo Planejamento (aparece se tiver qualquer uma) |
| `producao_real_apontamento` | só a tela `/producao-real` |
| `producao_real_ocorrencias` | só o botão/fluxo de "máquina parada" dentro de `/producao-real` |
| `producao_real_historico` | as outras 6 telas de Produção Real |
| papel `admin` | grupo Administração inteiro (Usuários, Importar dados) — **não** as permissões catalogadas `usuarios`/`auditoria`, que existem no formulário mas nunca são checadas em lugar nenhum (achado — provavelmente vestigial) |

Enquanto as permissões ainda não carregaram, o comportamento é "tratar como sem nenhuma" (nunca libera à toa) — um redesign de Sidebar precisa contemplar esse estado transitório (Sidebar praticamente vazia por um instante).

Intelligence: visível com `producao_real_historico`; perguntas de `financeiro` são bloqueadas dentro da tool (`get_economic_summary`), não na UI — um usuário sem `financeiro` **vê** o painel normalmente, só recebe recusa quando pergunta algo financeiro.

---

## 16. Estados funcionais

| Estado | Como aparece hoje |
|---|---|
| Loading (troca de página) | Splash de tela cheia com logo + "Carregando..." |
| Loading (dentro de painel) | Texto simples `"Carregando…"` |
| Sem dados | Texto explicativo por tela (ex. "Sem dados no período.", "Nenhum apontamento encontrado.") — nunca vira "0" silenciosamente, exceto faturamento com produção zero (caso documentado como fato genuíno) |
| Amostra insuficiente | Texto dedicado (ex. "amostra insuficiente pra comparar") — tratado como estado próprio, não como zero |
| Sucesso | Texto verde (`--accent`) ou ✓ + mensagem, geralmente numa tela de confirmação dedicada (não um toast) |
| Warning | Cor `--warning`, geralmente como badge de estado (ex. "Atenção") |
| Erro | `stx-save-error` (vermelho) — string vinda do hook, geralmente já amigável |
| Bloqueio de permissão | `AcessoNegado` — "Acesso restrito / Você não tem permissão para acessar esta área." |
| Disabled | Opacidade reduzida + `cursor:not-allowed` em botões |
| Offline/rede | Não tratado explicitamente na maior parte do app (só Intelligence tem esse estado dedicado) |
| Confirmação destrutiva | Só existe de verdade em 1 lugar (excluir apontamento) — o resto (excluir produto/máquina) não tem |

Não existe sistema de toast/notificação global — feedback é sempre inline, na própria tela/modal.

---

## 17. Responsividade

**Avaliação real** (testado ao vivo em 375px/768px/1440px):

| Área | Desktop | Tablet (768px) | Mobile (375px) |
|---|---|---|---|
| Sidebar | Coluna fixa 220px, ok | **Ainda em coluna** (768&gt;760, não ativa o modo mobile) — telas "tablet" no sentido comum ficam com a sidebar de desktop, que é estreita mas utilizável | Vira linha horizontal com scroll, boa |
| Apontamento (grid de cards) | Ok, cards largos | **Boa** — cards grandes, toque confortável | Cards empilham em 1-2 colunas, ok |
| Tabelas de Indicadores/Paradas | Ok | Aperta — muitas colunas em grid fixo, sem scroll horizontal dedicado em todas | Provavelmente estoura — várias tabelas usam `grid-template-columns` com muitas colunas fixas sem `overflow-x` garantido em toda instância |
| Filtros (múltiplos selects em linha) | Ok | Ok | Empilha, mas telas com 6-7 filtros (Paradas/Indicadores) ficam com formulário longo |
| Gráficos | Ok, `ResponsiveContainer` | Ok | Comprimem, mas funcionam (sem teste de legibilidade fina) |
| Modais | Ok, centralizados | Ok | Ok, `max-height:85vh` com scroll interno |
| Intelligence | Painel lateral 440px | Painel lateral (768&gt;760) | Sheet full-screen, testado e ok |
| Financeiro/BI (legado, gráficos densos) | Ok | Aperta — muitos meses no eixo X | Não testado a fundo, risco de espremer |

**Achado específico**: o breakpoint de 760px deixa "tablet" (768px, o valor comum de teste) do lado desktop — ou seja, hoje um iPad em retrato recebe a Sidebar completa de desktop, não a versão mobile compacta. Isso é bom pro toque (cards grandes) mas ruim pro aproveitamento de espaço vertical (sidebar ainda ocupa uma coluna inteira). Vale decisão de design explícita sobre isso.

---

## 18. Tablet / chão de fábrica

Foco: `/producao-real` (Apontamento). Já documentado em detalhe no §3.1 e §8 (Apontamento). Resumo da sequência completa:

```
Grid de máquinas (card por máquina, estado PENDENTE/APONTADO/SEM PRODUÇÃO)
  ↓ toca em PENDENTE
Escolha do fluxo: REGISTRAR PRODUÇÃO | SEM PRODUÇÃO
  ↓                                    ↓
Produto → Funcionário →                Motivo (grid de 5) → [Descrição se "Outro"]
Quantidade + Refugo →                       ↓
Paradas do período (opcional) →        CONFIRMAR
Observação →
SALVAR APONTAMENTO
  ↓
Confirmação (✓ + Performance) → PRÓXIMA MÁQUINA | VER TODAS
```

Fluxo paralelo independente (ocorrência de máquina parada): Máquina → Produto → Funcionário → Motivo → Descrição → INFORMAR MÁQUINA PARADA; depois, Encerrar com "O que foi feito para resolver?".

Filosofia documentada no código (não uma citação literal de "precisa ser rápido", mas o comportamento observável): meta/custo/OEE nunca aparecem aqui; as opções de produto/funcionário já vêm pré-filtradas pelas elegíveis pra aquela máquina (nunca deixa a supervisora escolher algo que o servidor rejeitaria). Esse é o princípio a preservar num redesign: **reduzir a superfície de escolha, não necessariamente o número de telas**.

---

## 19. Futuro PWA

**Registrado aqui como requisito futuro — nada disso está implementado hoje.** Não há manifest.json, não há service worker, não há lógica de "instalar na tela inicial", não há push notification. O design deve nascer já considerando:

- Desktop, tablet e celular como alvos igualmente válidos (hoje o app é "desktop-first com adaptação", não "mobile-first").
- Modo standalone (sem chrome de navegador) — atenção a áreas de toque no topo/rodapé que hoje assumem uma barra de navegador visível.
- Touch targets — o padrão atual de botão (`padding: 9px 18px`, ~13px de fonte) é confortável em mouse mas apertado pra dedo; os únicos elementos já pensados pra toque grande são os cards de Apontamento e os botões dos modais de chão de fábrica (`stx-pr-modal`, inputs com `padding:14px`, botões full-width).
- Safe areas (notch/home indicator) — nada tratado hoje.
- Navegação mobile — hoje é a mesma Sidebar comprimida; um redesign PWA provavelmente vai querer uma tab bar ou drawer dedicado.

Web Push também é requisito futuro — o sino do TopBar já existe visualmente (decorativo hoje) e seria o gancho natural pra essa funcionalidade quando implementada.

---

## 20. Identidade Sittech

| Asset | Caminho | Formato |
|---|---|---|
| Logo (dark theme) | `src/lib/logos.ts` → `LOGO_DARK` | PNG embutido em base64 no próprio TS (~15KB) |
| Logo (light theme) | `src/lib/logos.ts` → `LOGO_LIGHT` | PNG embutido em base64 |
| Ícone de app (usado) | `public/sittech-icon-v2.png` | PNG 512×512 |
| Apple touch icon (usado) | `public/sittech-apple-icon-v2.png` | PNG 180×180 |
| Ícone auto-detectado Next.js (não referenciado no metadata) | `src/app/icon.png` | PNG 512×512, mesmo tamanho de bytes do `-v2` |
| Apple icon auto-detectado (não referenciado) | `src/app/apple-icon.png` | PNG 180×180, idem |

Nome do produto: **"Sittech"**, tagline vista na tela de loading: **"soluções industriais"**. Título da aba do navegador: "Sittech — Gestão". Sem `manifest.json`, sem outros assets de marca em `public/`.

**Achado**: os dois pares de ícone (`src/app/*.png` vs `public/sittech-*-v2.png`) parecem duplicados/redundantes — o app só usa explicitamente os `-v2.png` via `metadata.icons` em `layout.tsx`. Vale limpeza, mas não é urgente. Marca não foi redesenhada aqui, só documentada.

---

## 21. Screenshots

**Nota de ferramenta**: as capturas abaixo foram vistas ao vivo (sessão DEV real, `localhost:3000`) durante este levantamento, mas a ferramenta de navegador usada não expõe uma forma de salvar o PNG em disco — então não há arquivo de imagem para anexar a este `.md`. O que segue é o índice descritivo do que foi verificado visualmente; se quiser os arquivos de imagem de verdade, posso recapturar tela a tela e exportar via outra rota.

| # | Tela | Viewport | Observado |
|---|---|---|---|
| 1 | Visão Geral | Desktop 1440px | Sidebar completa, 6 cards, "Recurso mais pressionado" mostrando 1123,1% (confirma §23 — sem teto em 100%) |
| 2 | Apontamento | Desktop | Grid de 16 máquinas, banner de período, fluxo de modal completo (escolha → registrar produção → parada inline) testado |
| 3 | Apontamento | Tablet 768px | Sidebar ainda em coluna (não ativa modo mobile), cards grandes e tocáveis |
| 4 | Apontamentos realizados | Desktop | Estado vazio ("Nenhum apontamento encontrado.") |
| 5 | Produtividade (Indicadores) | Desktop | Filtros expandidos, aba Resumo geral com "Produção acabada" vs. "Produção processada" lado a lado, aba Pareto de paradas vazia |
| 6 | Paradas | Desktop | Resumo com "Custo do tempo ocioso" e "Capacidade local perdida" separados, 7 abas visíveis |
| 7 | Desvios | Desktop | Texto de janelas automáticas, fila vazia |
| 8 | Funcionários (analytics) | Desktop | "Sempre por contexto — nunca ranking", 3 abas, fila vazia |
| 9 | Validação da Previsão | Desktop | Lista de produtos com badge de estado ("Inviável teoricamente" em vermelho), % de capacidade teórica restante |
| 10 | Previsão Semanal | Desktop | "Previsto/Possível/Realizado/Falta" lado a lado por produto, banner "Previsão não atingível · 1 gargalo" |
| 11 | Capacidade Semanal | Desktop | Checkboxes de disponibilidade de máquina por operação, "Dias úteis nessa semana" |
| 12 | Produtos | Desktop | Cards com Valor recebido/Custo/Margem/Lucro-hora, badge de referência |
| 13 | Máquinas | Desktop | Lista com badge "N produtos", botão Pausar |
| 14 | Custo por Hora | Desktop | Dois painéis lado a lado (Períodos de trabalho / Custo por operação), nomes reais de funcionários de teste |
| 15 | Início (legado) | Desktop | 5 KPIs + AreaChart de tendência (gradiente sob a linha) |
| 16 | Faturamento mensal (legado) | Desktop | Lançamento por data, "Custos do mês", histórico mensal colorido (vermelho/verde) |
| 17 | Análise de faturamento (legado) | Desktop | 3 modos de filtro, seletor de tipo de gráfico Barra/Linha/Área |
| 18 | Usuários (legado) | Desktop | Lista de usuários + "Registro de atividade" (auditoria) na mesma tela |
| 19 | Intelligence — fechado | Desktop | Trigger visível no TopBar, primeiro item |
| 20 | Intelligence — aberto, vazio | Desktop | Painel lateral, 4 chips de sugestão, composer |
| 21 | Intelligence — com resposta real | Desktop | Pergunta real enviada ("Quais foram as principais paradas?"), evidências (3) e tool trace expansíveis, barra de debug DEV com tokens/latência reais |
| 22 | Intelligence — mobile | 375px | Sheet full-screen, mesma resposta real, totalmente legível |
| 23 | Visão Geral — mobile | 375px | Nav horizontal com scroll, TopBar quebra em pills, badges de estado preservam cor |

---

## 22. Problemas visuais (UX debt)

Lista objetiva, sem propor redesign:

- **Navegação quebrada pra 7 itens do menu** quando clicados a partir de uma página migrada (§1.1) — sempre caem em "Início" em vez da aba certa.
- **6 blocos de código mortos** no monólito (telas de Produção Real antigas, substituídas) — risco de confundir quem for procurar referência visual ali.
- **Sino de notificação sem função** — visualmente sugere uma feature que não existe (nem contagem, nem clique).
- **Duas telas diferentes com o mesmo nome "Visão geral"** — Início (legado, financeiro) e `/producao-real/visao-geral` (produção) — risco real de confusão de nome no redesign também.
- **Duas permissões vestigiais** (`usuarios`, `auditoria`) que existem no formulário de permissões mas nunca são checadas — um admin pode "conceder" algo que não faz nada.
- **Inconsistência de alinhamento numérico** entre as 3 famílias de "tabela" (só uma tem `text-align:right` explícito).
- **Inconsistência de validação de formulário** — de "falha silenciosa" (Produtos/Máquinas) a "parágrafo vermelho ad hoc" (3 padrões diferentes de exibir erro).
- **Nenhum indicador de campo obrigatório** em formulário nenhum.
- **Exclusão sem confirmação** em Produtos/Máquinas (só protegida no banco) — inconsistente com o apontamento, que tem confirmação explícita.
- **Ícones misturados**: a maioria é `lucide-react`, mas ações de linha de tabela (⏸▶✎✕🔒🔴) usam emoji/glifo de texto solto, não a mesma biblioteca.
- **Breakpoint de "tablet" real (768px) cai do lado desktop** do único breakpoint que existe (760px) — sidebar não compacta em tablets comuns.
- **Densidade alta em telas de filtro** (Paradas/Indicadores chegam a 6-7 selects em linha) — hierarquia visual fraca entre "filtro principal" e "filtro secundário".
- **Gráfico de 20 meses no eixo X** (Análise de faturamento) sem tratamento de rótulo — tende a apertar.
- **Legenda de gráfico não-nativa** numa tela (BI), nativa (`&lt;Legend&gt;`) nas outras — inconsistência de padrão de gráfico.
- **Sem sistema de toast/notificação global** — todo feedback é inline, o que é consistente, mas significa que ações fora da viewport atual (ex. salvar algo scrollado) podem passar despercebidas.

---

## 23. Regras que design não pode quebrar

Extraídas literalmente do código (comentários/lógica), nunca inventadas. Cada uma tem citação de arquivo.

1. **Performance/OEE/"% de pressão" nunca tem teto visual em 100%.** Valores acima de 100% são dado real (demanda acima da capacidade, produção acima da meta), não erro. *(`producao-real/calculations.ts:7-9`; `visao-geral/components/RecursoPressionadoCard.tsx:3-6,45` — "Acima de 100% significa demanda acima da capacidade restante da semana — não é um erro de cálculo.")*
2. **"Meta" de produção é por período de turno (intraday: M1/M2/M3/T1/T2/T3), não semanal/mensal.** Existe uma "meta semanal" separada, mas é de faturamento, não de produção — as duas nunca devem se fundir num mesmo widget. *(`src/types/domain.ts:38-71`; `indicadores/calculations.ts:19-25`)*
3. **"Produção acabada" = só a última etapa do roteiro do produto.** "Produção processada" (qualquer etapa) é um número maior e diferente — nunca somar os dois. *(`indicadores/calculations.ts:9-17`; `validacao-previsao/producaoAcabada.ts:1-5`)*
4. **Previsto / Possível / Realizado (oficial) / Falta são quatro números distintos, nunca substituíveis um pelo outro.** "Falta" sempre usa produção acabada observada, nunca o realizado manual. *(`validacao-previsao/types.ts:75-91`; `previsao/realizado.ts`)*
5. **"Realizado oficial" (lançamento manual) e "Produção acabada observada" (Produção Real) são fontes diferentes — nunca somadas.** A diferença entre as duas é só um "sinal de conferência" (divergência), nunca somada ao previsto. *(`intelligence/systemPrompt.ts:32`; `validacao-previsao/components/ResumoSemanaCards.tsx:21`)*
6. **Vocabulário de confiança FATO/CALCULADO/ESTIMATIVA/APROXIMAÇÃO nunca é promovido para um nível mais forte.** Visualmente, ESTIMATIVA/APROXIMAÇÃO precisam continuar parecendo menos certas que CALCULADO/FATO. *(`intelligence/types.ts:10-15`; `intelligence/confidence.ts:19-22,49-50`)*
7. **Só existem 5 estados de risco de previsão, sem score numérico**: Concluído, No ritmo, Atenção, Inviável teoricamente, Sem estimativa — com essa ordem de severidade implícita. Não substituir por um gradiente/percentual único. *(`validacao-previsao/types.ts:41-42`; `validacao-previsao/estado.ts:6-16`)*
8. **Permissão muda a navegação, não só o acesso à página** — grupos/itens inteiros da Sidebar somem conforme o usuário. Um design não pode assumir menu fixo. *(`Sidebar.tsx:9,25-27,97,115,122-145`)*
9. **"Sem dados" e "zero" são estados visualmente diferentes.** Um período "sem produção" registrado explicitamente não vira "100% disponível" nem "0" — some do cálculo e conta como registro à parte. (Exceção documentada: faturamento com produção acabada zero É zero de fato.) *(`indicadores/calculations.ts:22-25`; `indicadores/economico.ts:189`)*
10. **"Capacidade local perdida" (peças) e "Custo do tempo ocioso" (R$) nunca viram "faturamento perdido"** — esse conceito não existe em nenhum motor do sistema, nem é permitido nem pra IA calcular. *(`intelligence/tools/getDowntimeAnalysis.ts:78`; `intelligence/tools/getEconomicSummary.ts:6-8,76`)*
11. **A tela de Apontamento nunca mostra meta/custo/OEE/disponibilidade/qualidade** — só o essencial pra supervisora saber o que falta apontar, com as opções já pré-filtradas pelo que é válido. *(`producao-real/ProducaoRealPainelPage.tsx:11-13`; `producao-real/ApontamentoModal.tsx:3-8`)*
12. **Funcionários nunca tem ranking, nota geral ou 1º/2º/3º lugar** — só sinais por contexto (produto+operação+máquina) comparáveis entre si. *(`producao-real/funcionarios/FuncionariosPage.tsx:3-7`; `ListaFuncionarios.tsx`)*
13. **Desvios/causalidade nunca atribuem a causa a uma pessoa** — sempre "possíveis fatores"/"hipóteses para investigação", nunca causa confirmada; drill-down pra Funcionários nunca isola um `funcionarioId` específico a partir de um desvio.
14. **Visão Geral nunca recalcula nada** — é composição pura das outras 6 engines; qualquer novo card nela deve continuar assim.
15. **Validação da Previsão nunca escreve na Previsão Semanal** — é só leitura/análise cruzada.
16. **Intelligence nunca esconde confidence ou evidência de um número citado**, nunca promove ESTIMATIVA a fato, e nunca converte capacidade perdida em faturamento (mesma regra do item 10, reforçada na própria ferramenta de IA).

---

## 24. Prioridade da informação

| Tela | PRIMARY | SECONDARY | DETAIL |
|---|---|---|---|
| Apontamento | Card da máquina pendente + botão de ação | Progresso "N de M fechadas" | Histórico de paradas dentro do form |
| Visão Geral | Os 6 títulos de card (Saúde/Situação/Agora/Atenções/Paradas/Recurso) | Números dentro de cada card | Botões "Ver X" |
| Indicadores | Produção acabada (peças) | KPIs da grade (Performance/OEE/etc.) | Tabelas por dimensão, drill-down expandido |
| Paradas | Minutos parados + Custo do tempo ocioso | Pareto/Recorrência | Lista Detalhado (200 linhas) |
| Desvios | Severidade + título do incidente | Comparação (referência→atual) | Evidências relacionadas, possíveis fatores |
| Funcionários | Nome + badge (atenção/destaque) | Métrica vs. referência | Contextos individuais no detalhe |
| Validação da Previsão | Estado do produto (badge) | Previsto/Acabado/Falta | Projeção estimada, recursos pressionados |
| Previsão Semanal | Previsto vs. Realizado por produto | Status atingível/gargalo | Observações de setup, histórico semanal |
| Produtos/Máquinas (cadastro) | Nome | Métricas calculadas (margem/lucro-hora) | Fluxo de produção / lista de usos |
| Intelligence | Resposta em texto | Evidências | Tool trace, debug DEV |

---

## 25. O que pode / não pode mudar visualmente

**PODE redesenhar livremente**: layout, spacing, tipografia, hierarquia visual, cards, tabelas (inclusive introduzir `&lt;table&gt;` de verdade se ajudar), filtros, navegação visual (inclusive Sidebar), responsividade, gráficos (inclusive trocar de biblioteca se justificado), empty states, feedback/toasts, apresentação da Intelligence.

**NÃO PODE alterar sem aprovação explícita**: as 16 regras do §23; os contratos de permissão do §15; os fluxos críticos do §3.1/§18 (sequência do Apontamento) e do §4 (contrato do endpoint da Intelligence); os conceitos financeiros/de produção em si (fórmulas, dados); a separação Realizado-oficial vs. Produção-acabada-observada; os 5 estados de `EstadoValidacao`; os 4 níveis de confiança da Intelligence.

---

## 26. Direção futura

Registrado como briefing — **não implementado nesta etapa**.

Queremos que o Sittech pareça um software **industrial premium e tecnologicamente avançado**. Evitar: aparência de template genérico, "dashboard comprado", visual gerado por IA, excesso de gradiente, glassmorphism gratuito, neon, cards espalhados por toda parte, cantos excessivamente arredondados, ícones decorativos, visual gamer/futurista.

Desejado: precisão, confiança, densidade controlada, hierarquia forte, industrial, sofisticado, moderno, rápido, profissional, identidade própria. O motivo de "cantos técnicos" (`stx-total-box`/`stx-destaque-box`, §9.3) já existente no app é um bom ponto de partida nessa direção — vale considerar evoluir esse motivo em vez de descartá-lo.

---

## 27. Apêndices A–N

- **A. Route map** → §1.2
- **B. Navigation map** → §2
- **C. Screen inventory** → §1.5, detalhado em §3/§5/§6/§7
- **D. Component inventory** → §8
- **E. Design tokens** → §9
- **F. Responsive behavior** → §17
- **G. Permission-sensitive UI** → §15
- **H. Critical workflows** → §3.1 (Apontamento) e §4 (Intelligence)
- **I. Business/UI invariants** → §23
- **J. UX debt** → §22
- **K. Brand/assets** → §20
- **L. PWA/mobile future requirements** → §19
- **M. Screenshots index** → §21
- **N. "Do not break" checklist** → §23 + §25 (coluna "NÃO PODE")

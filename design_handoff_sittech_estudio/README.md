# Handoff: Sittech — redesign visual (linguagem "Estúdio")

## Overview
Redesenho visual do Sittech (gestão e produção industrial). Esta etapa define a **direção visual aprovada** e a aplica em quatro experiências: Visão Geral (`/producao-real/visao-geral`), Apontamento (`/producao-real`), Previsão Semanal (`/previsao`) e Sittech Intelligence (painel global). Inclui design system, shell (sidebar + topbar), comportamento responsivo com sidebar recolhível e demonstração de dark e light mode.

Nenhuma regra funcional foi alterada. As 16 invariantes do §23 do `SITTECH_DESIGN_HANDOFF.md`, os contratos de permissão do §15, a sequência do Apontamento (§3.1/§18) e o contrato do endpoint da Intelligence (§4) permanecem exatamente como estão hoje.

## About the Design Files
Os arquivos deste pacote são **referências de design feitas em HTML** — protótipos que mostram aparência e comportamento pretendidos, **não código de produção para copiar**. A tarefa é **recriar estes designs no ambiente já existente do Sittech**: Next.js App Router + React + TypeScript, CSS global único em `src/components/shell/GlobalStyles.tsx` com classes `stx-`, `lucide-react` para ícones e `recharts` para gráficos. Manter essas escolhas; trocar apenas os valores visuais e a estrutura de layout descritos aqui.

Os mocks usam SVGs inline simples para ícones apenas por conveniência — na implementação, usar `lucide-react` (mapa de ícones na seção Assets).

## Fidelity
**High-fidelity.** Cores, tipografia, espaçamentos, raios e estados são finais e devem ser reproduzidos com precisão. Os números exibidos nos mocks são dados de exemplo — não são valores reais nem novas métricas.

## Direção visual em uma frase
Grafite quente, uma família tipográfica, uma cor de destaque. Hierarquia por **escala tipográfica e espaço**, não por caixas. Sem bordas em volta de tudo, sem monoespaçada, sem uppercase como linguagem, sem gradiente, sem glassmorphism. A indústria está nos dados e nos fluxos, não na decoração.

## Design Tokens

### Cores — dark (modo primário)
| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#1A1918` | canvas de conteúdo |
| `--surface` | `#201E1D` | superfície (tiles, modal, campo) |
| `--surface-hover` | `#262422` | hover de superfície e botão secundário |
| `--surface-raised` | `#302D2B` | hover de botão secundário |
| `--plane` | `#161514` | plano recuado: sidebar, painel da Intelligence |
| `--line` | `#262422` | hairline (única linha estrutural) |
| `--text` | `#F0EEEB` | texto primário |
| `--text-2` | `#96918B` | secundário |
| `--text-3` | `#7A756F` | terciário / metadado |
| `--label` | `#635F5A` | rótulo de grupo, trace |
| `--faint` | `#4A4642` | separador de trilha, chevron |
| `--accent` | `#3ECFA5` | verde Sittech |
| `--accent-hover` | `#55DBB4` | hover do primário |
| `--accent-deep` | `#2C8F73` | série secundária de gráfico |
| `--warning` | `#E0A340` | atenção, estimativa |
| `--danger` | `#E2695C` | crítico, inviável, parada |
| `--on-accent` | `#141312` | texto sobre verde/vermelho preenchido |
| tile parada | `#2A1E1D` (hover `#33221F`) | tile de máquina parada |
| tile concluído | `#1D1C1B` (hover `#232120`) | tile já apontado |

Escala de barras de pareto: `#3ECFA5`, `#2C8F73`, `#276F60`, `#245B50`, `#2A2E2C`, `#2A2725`.

### Cores — light
| Token | Hex |
|---|---|
| conteúdo | `#FBFAF8` |
| plano recuado (sidebar) | `#EFECE7` |
| superfície | `#FFFFFF` |
| hover de linha | `#F5F2ED` |
| superfície neutra | `#E7E3DC` → hover `#DFDAD2` |
| hairline | `#E3DFD8` |
| texto | `#1A1918` · secundário `#6E6963` · terciário `#8A857E` · rótulo `#A39D95` · faint `#C6C0B8` |
| accent | `#1B8A6D` → hover `#146453` · série secundária `#3FA487` |
| warning | `#B47A15` (claro `#D3A354`) |
| danger | `#C0483B` · fundo de tile parada `#FDF3F1` |
| sombra | `0 1px 2px rgba(26,25,24,.06)` e `0 18px 40px -28px rgba(26,25,24,.4)` |

Regra: o light **não é inversão**. O plano da sidebar é mais quente que o conteúdo (não mais claro), e a hairline sustenta a estrutura porque não há sombra.

### Disciplina do verde
Verde aparece em cinco papéis e em nenhum outro: marca, item de navegação ativo, ação primária, resultado positivo (delta, estado "concluído", performance ≥ meta) e **uma** série de gráfico.

### Tipografia
Família única: **Schibsted Grotesk** (Google Fonts, pesos 400/500/600/700). Substitui Sora + Inter + JetBrains Mono. **Nenhuma monoespaçada** em nenhuma das telas; números usam a mesma família em peso 600 com tracking negativo.

⚠️ **Não usar `font-variant-numeric: tabular-nums` com Schibsted Grotesk** — nessa família a figura tabular alarga a pontuação e "1.284" renderiza como "1 . 284". Alinhamento de coluna numérica é resolvido por `text-align: right` + largura de coluna fixa.

| Papel | Tamanho | Peso | Tracking |
|---|---|---|---|
| número herói (produção acabada) | 72px (52–56px em tablet/mobile) | 600 | −.045em, line-height .95 |
| número secundário | 30–34px | 500 | −.03em |
| título de página | 40px (32px tablet) | 600 | −.035em |
| título de seção | 17px | 600 | −.02em |
| título de bloco de contexto | 15px | 600 | −.015em |
| KPI | 25px | 600 | −.03em |
| nome de máquina (tile) | 19px | 600 | −.02em |
| corpo de resposta da Intelligence | 15,5px (16px mobile) | 400 | line-height 1.62 |
| item de navegação | 14px (15px na gaveta mobile) | 400 / 600 ativo | — |
| linha de tabela | 14px | 400 | — |
| rótulo / legenda / metadado | 12,5px | 400 | — |
| rótulo de grupo na sidebar | 11,5px | 400 | .05em |

Sentence case em toda a interface. Uppercase não é usado.

### Espaçamento
Escala: 4 · 8 · 14 · 22 · 32 · 44 · 64. Padding de página 22–32px; gap entre blocos de contexto 36–38px; gap de grade de tiles 12px; gap de colunas de KPI 26px.

### Grid
- Desktop ≥1280: sidebar 248px + coluna primária fluida + **coluna de contexto 372px** (separada por hairline à esquerda).
- Tablet 768–1279: 8 colunas; sidebar recolhida a 72px; a coluna de contexto vira faixa abaixo do conteúdo.
- Mobile ≤767: 4 colunas, padding 20px; gaveta de navegação 296px.

### Raio
8px superfícies · 10px campos e botões pequenos · 12px modal, tile de máquina, botão de toque · 14px painel e cartão da Intelligence · 999px chips, pills e o gatilho da Intelligence.

### Profundidade
Sombra só onde o elemento flutua de fato:
- modal: `0 30px 70px -30px rgba(0,0,0,.95)`
- painel lateral da Intelligence: `-24px 0 60px -30px rgba(0,0,0,.9)`
- gaveta de navegação: `24px 0 60px -24px rgba(0,0,0,.95)`
- gatilho da Intelligence: `inset 0 1px 0 rgba(255,255,255,.05), 0 6px 18px -10px rgba(0,0,0,.9)`

## Screens / Views

### 1. Shell — Sidebar + TopBar
**Sidebar** (248px, plano `#161514`, sem borda):
- Marca: círculo de 16px em `--accent` + "Sittech" 16px/600/−.02em. Padding `0 26px 30px`.
- Rótulo de grupo: 11,5px, `.05em`, `--label`, padding `22px 26px 8px`.
- Item: flex, gap 12px, padding `8px 26px`, 14px, `--text-2`; ícone 16px traço 1,5 com `opacity .8`. Hover: cor `--text`.
- Item ativo: peso 600, cor `--text`, ícone em `--accent`, e um traço vertical `position:absolute; left:0; top:9px; bottom:9px; width:2px; border-radius:2px; background:var(--accent)`.
- Badge de contagem (Desvios): 12,5px em `--warning`, alinhado à direita.
- Rodapé: "Meta semanal" (12,5px `--text-3`) + percentual 22px/600 + valor 12,5px + barra de 4px (trilha `--line`, preenchimento `--accent`); abaixo, avatar 26px + nome 13px + chevron. **Só visível com permissão `financeiro`.**

**TopBar** (altura ~56px, padding `18px 32px`, sem borda inferior):
- Trilha de contexto à esquerda: "Produção real" `--text-3` · "/" `--faint` · página atual `--text` — resolve a ausência de breadcrumb e desambigua as duas telas chamadas "Visão geral".
- À direita: gatilho da Intelligence (único elemento com elevação), depois "Ocultar valores" e "Tema" em 13px `--text-3`.
- **Remover o sino decorativo** até existir push real.

**Gatilho da Intelligence**: pill `#211F1E`, `padding:6px 8px 6px 13px`, gap 11px, raio 999px, sombra listada acima. Dentro: anel de 18px (`border:1px solid rgba(62,207,165,.38)`) com ponto de 6px em `--accent` pulsando (`@keyframes`: `0%,100% box-shadow 0 0 0 0 rgba(62,207,165,.32)`; `60% box-shadow 0 0 0 6px rgba(62,207,165,0)`; 3,4s ease-in-out infinite), rótulo "Intelligence" 13,5px/500, e chip "⌘K" 11px em `#2C2927` raio 6px. Hover: fundo `#282524`. Só renderizar com `producao_real_historico`.

**Permissões**: grupos e itens somem conforme `§15`; a ausência não deixa espaço vazio nem item desabilitado. Acordeão passa a ser **independente** (abrir um grupo não fecha outro) e o grupo dono da rota atual já vem aberto. Enquanto as permissões carregam, mostrar só a marca.

Corrigir também o bug do §1.1: cada item do menu deve navegar para o próprio destino (hoje qualquer item legado cai em "Início" quando clicado a partir de uma rota migrada).

### 2. Visão Geral — `/producao-real/visao-geral`
Hub de composição; nada é recalculado aqui. Sem filtros, janela fixa na semana atual.

Layout: coluna primária + coluna de contexto de 372px.

Coluna primária, de cima para baixo:
1. Linha de janela: "Semana 36 · 1 a 7 de setembro · composição das seis engines, nada recalculado aqui" (13px `--text-3`) + pill "Semana atual ⌄" à direita.
2. Título "Visão geral" 40px/600.
3. **Par de números**: "Produção acabada" 72px/600 com legenda "peças · só a última etapa do roteiro"; ao lado, "Produção processada" 32px/500 com "volume bruto, qualquer etapa". Nunca somar os dois (§23.3).
4. **Quatro KPIs** em grade de 4 colunas: rótulo 12,5px `--text-2`, valor 25px/600, delta 12,5px colorido (verde/âmbar), e sparkline SVG de 18px de altura (`polyline`, `stroke-width 1.3`, `vector-effect:non-scaling-stroke`) em Performance e Disponibilidade. Qualidade e OEE trazem uma linha de nota em vez de sparkline; OEE informa "sem teto em 100%" (§23.1).
5. **Situação da semana**: tabela `1.6fr 116px 1fr 104px`. Coluna "Realizado vs. possível" é uma barra de 4px (trilha `--line`) + percentual 13px à direita. Estado como texto colorido, sem badge. Última linha é total, em `--text-3`, com os valores em `--text`.
6. **Principais atenções**: lista de desvios, ponto de 7px colorido por severidade + título 14px + linha de comparação 12,5px que termina em "possíveis fatores, não causa confirmada" (§23.13).

Coluna de contexto (blocos separados por 38px, sem caixas): **Agora** (ocorrências abertas com duração colorida, barra de progresso "9/16 fechadas", link para Apontamento) · **Paradas** (minutos parados, custo do tempo ocioso, capacidade local perdida — nunca "faturamento perdido", §23.10 — mais barra empilhada de composição e legenda em texto) · **Recurso mais pressionado** (nome + valor 24px/600 em `--danger`, podendo passar de 100%, com a frase que explica que não é erro) · **Equipe** (contagens "merecem atenção" / "destaques positivos" + nota "sempre por contexto comparável — o produto nunca produz ranking", §23.12).

Cada bloco linka para a tela dona do cálculo. §23.14 permanece: esta tela nunca calcula.

### 3. Apontamento — `/producao-real`
Operacional, tablet-first. **Não exibe meta, custo, OEE, disponibilidade nem qualidade** (§23.11).

Cabeçalho: "Período atual" + pill "Outro período"; abaixo, o período em 40px/600 ("M2") ao lado da data e faixa horária em 15px `--text-2`; abaixo, barra de progresso de 6px (verde = fechadas, `#3A3734` = em curso) + "**9** de 16 máquinas fechadas". À direita do cabeçalho, isolado, o botão **"Informar máquina parada"**: `--danger` preenchido, raio 12px, `min-height:56px`, padding `0 24px`. Só com `producao_real_ocorrencias`.

Legenda de fila: "Pendentes primeiro" + contagens com pontos de 6px (pendente âmbar, apontada verde, sem produção cinza).

**Grade de tiles** (4 colunas no desktop, 3 no tablet, 1–2 no mobile), gap 12px, `min-height:108px`, raio 12px, padding 18px, área inteira clicável:
- Pendente: fundo `--surface`, hover `#262422`; nome 19px/600; pill "Pendente" 12px âmbar sobre `rgba(224,163,64,.12)`; pé com operação + "N produtos elegíveis".
- Parada agora: fundo `#2A1E1D`, pill "Parada agora" em `--danger`, pé com motivo + duração em `--danger`.
- Apontado: fundo `#1D1C1B`, nome 19px/500 em `--text-2`, estado "Apontado" em texto verde sem pill, pé com produto + quantidade.
- Sem produção: igual ao apontado, estado em `--text-3` (`#8A857E`).

**Fluxo preservado integralmente** (§3.1): tile → escolha do fluxo → produto → funcionário → quantidade + refugo → paradas do período → observação → salvar → confirmação → próxima máquina. Opções sempre pré-filtradas pelas elegíveis.
- **Escolha do fluxo**: dois botões de 72px empilhados — "Registrar produção" (verde preenchido) e "Sem produção neste período" (`#262422`).
- **Modal de quantidade**: 660px, `--surface`, raio 14px; cabeçalho com contexto 12,5px + título 24px/600 + ✕; indicador de 5 etapas (barras de 3px, concluídas em verde) com rótulos abaixo, o atual em `--text`; dois campos de 30px/600 alinhados à direita (o ativo com `border:1px solid var(--accent)` e `outline:3px solid rgba(62,207,165,.14)`); linha de botões rápidos +1/+10/+50/+100/Limpar com 52px de altura; rodapé com "Voltar" (`#262422`) e "Continuar para paradas" (verde), ambos 56px.
- **Paradas do período**: itens vindos de ocorrência aparecem com `opacity .75` e o rótulo "Origem: ocorrência aberta · não editável" — sem cadeado.
- **Confirmação**: "Apontamento salvo" 13px verde, performance 52px/600 em verde, legenda, e botões "Próxima máquina" (verde) + "Ver todas".
- Exclusão de apontamento mantém confirmação explícita ("Esta ação não pode ser desfeita").

### 4. Previsão Semanal — `/previsao`
Cabeçalho: navegação de semana (‹ / rótulo / ›) em pills, título 40px/600, e à direita "Modo simulação", "Exportar PDF" e o primário "Ajustar para capacidade".

**Quatro números do topo**, lado a lado, cada um com rótulo próprio: Previsto na semana (60px/600) · Possível (30px/500, âmbar quando menor que o previsto) · Realizado oficial (30px/500) · Falta (30px/500). Abaixo, a nota de origem: "Previsto e realizado são lançamentos manuais; possível vem do cálculo de capacidade; falta é previsto menos realizado, nunca negativo" (§23.4).

**Tabela de itens previstos**: `1.7fr 100px 100px 100px 100px 76px 26px` — Produto (com referência em `--label`), Previsto, Possível, Realizado, Falta, % e chevron. Percentual sem teto em 100% (verde ≥100%, âmbar/vermelho conforme faixa). Linha expandida (fundo `#1E1D1C`) mostra: "Possível limitado por", "Produção acabada observada", "Divergência vs. realizado oficial" (âmbar) e "Sequenciamento", com a nota de que a divergência é sinal de conferência entre fontes distintas e **nunca somada** (§23.5). Linha final de total.

Coluna de contexto: **Status da programação** ("Não atingível" 28px/600 âmbar + explicação) · **Carga por máquina** (barras de 4px; gargalo em vermelho com marca de 100% e nota dos produtos concorrentes) · **Gargalos da semana** (texto + botões "Simular" e "Ajustar" em pill, com a nota de que ajustar só reduz o previsto até o possível, com prévia) · faixa de **simulação ativa** (`#211F1E`, texto âmbar "Simulação ativa · nada é gravado" + "Sair").

Esta tela nunca é escrita pela Validação da Previsão (§23.15).

### 5. Sittech Intelligence — painel global
Não é chatbot. Desktop: painel de **440px** à direita, plano `#161514`, sem escurecer a página. Mobile: tela cheia.

- Cabeçalho: anel + ponto pulsante (mesmo do gatilho) + "Intelligence" 15px/600 + ✕.
- Pergunta: 13px `--text-3`, sem bolha.
- **Resposta protagonista**: 15,5px, line-height 1,62; números citados em peso 600; segundo parágrafo em `--text-2`. Preservar o texto do core, trocando apenas `**negrito**` por `<strong>`.
- **Evidências**: cabeçalho "Evidências · N" recolhível; cada item é uma linha rótulo/valor (13,5px `--text-2` / 14,5px 600) mais uma linha de confiança + "Ver dados". Confiança em palavra, no texto: "Fato" e "Calculado" em `--text-3`; "Estimativa" e "Aproximação" em `--warning`. Sem badge colorida, sem ícone de alerta (§23.6, §23.16).
- **Tool trace**: uma linha discreta no pé, "Análise baseada em 3 consultas · 4,2s" em `--label`, recolhível.
- **Follow-ups**: chips em pill `#211F1E`.
- **Composer**: caixa `--surface` raio 14px com botão verde de 34px (44px no mobile); nota "Enter envia · Shift+Enter quebra linha".
- **Loading honesto**: ponto pulsante + mensagem progressiva por tempo decorrido + cronômetro, e a nota "A resposta chega inteira; nenhum progresso é simulado" — sem streaming falso.
- **Erros**: mensagens seguras já mapeadas (limite, sessão expirada, indisponível). Estado "fora do escopo" para pedidos que violariam §23.10.
- Estado inicial: pergunta "O que você quer entender da fábrica?" 20px/600 + subtítulo + 4 sugestões em blocos de 13,5px.

### Cobertura

Todas as 18 telas ativas do produto estão desenhadas. Nenhuma tela ficou de fora, exceto o harness `/dev/intelligence` (DEV only) e os 6 blocos mortos do monólito listados no §1.4 do handoff — que não devem ser usados como referência.

| Tela | Arquivo · seção |
|---|---|
| Design system, shell, sidebar recolhível, light mode | `Sittech Estudio.dc.html` · 4A, 4B, 4G, 4H |
| Visão Geral · `/producao-real/visao-geral` | `Sittech Estudio.dc.html` · 4C |
| Apontamento · `/producao-real` | `Sittech Estudio.dc.html` · 4D |
| Previsão Semanal · `/previsao` | `Sittech Estudio.dc.html` · 4E |
| Sittech Intelligence · painel global | `Sittech Estudio.dc.html` · 4F |
| Início · `/` aba `inicio` | `Sittech Estudio Telas.dc.html` · 5A |
| Produtividade · `/producao-real/indicadores` | `Sittech Estudio Telas.dc.html` · 5B |
| Desvios · `/producao-real/desvios` | `Sittech Estudio Telas.dc.html` · 5C |
| Validação da Previsão · `/producao-real/validacao-previsao` | `Sittech Estudio Telas.dc.html` · 5D |
| Apontamentos realizados · `/producao-real/apontamentos` | `Sittech Estudio Telas.dc.html` · 5E |
| Capacidade Semanal · `/capacidade` | `Sittech Estudio Telas.dc.html` · 5F |
| Produtos · Máquinas · Custo por hora | `Sittech Estudio Telas.dc.html` · 5G |
| Custos mensais · Faturamento mensal · Análise de faturamento | `Sittech Estudio Telas.dc.html` · 5H |
| Funcionários analytics · `/producao-real/funcionarios` | `Sittech Estudio Telas.dc.html` · 5I |
| Paradas · `/producao-real/paradas` | `Sittech Estudio Telas.dc.html` · 5J |
| Funcionários (custo) · Usuários + Auditoria · Importar dados · Dados Importados | `Sittech Estudio Telas.dc.html` · 5K |

### ⚠️ Regra absoluta desta entrega

**Isto é exclusivamente um redesenho visual.** Nenhuma fórmula, nenhum campo de formulário, nenhuma métrica, nenhuma permissão e nenhum dado muda. Se em algum ponto o mock parecer sugerir um número, campo ou cálculo que não existe hoje no código, o código vence — mantenha o comportamento atual e reporte a divergência em vez de implementar o que o mock mostra.

As únicas mudanças de comportamento aprovadas, todas de UI e nenhuma tocando dados:

1. **Confirmação de exclusão nos cadastros** (Produtos, Máquinas). Hoje a exclusão é imediata; passa a pedir confirmação, e o bloqueio por uso (FK `RESTRICT`) é verificado e explicado ANTES da tentativa, oferecendo "pausar" como alternativa.
2. **Confirmação de importação** com checkbox "já gerei um backup" travando o botão. O fluxo e o formato de arquivo não mudam.
3. **Acordeão da sidebar independente** em vez de mutuamente exclusivo.
4. **Sino decorativo removido** da TopBar até existir push real.
5. **Breakpoints 1024/768/430** substituindo o corte único de 760px.
6. **Correção do bug de navegação do §1.1** — cada item do menu navega para o próprio destino.

## Interactions & Behavior
- **Hover**: superfícies sobem um degrau (`#201E1D`→`#262422`, `#1D1C1B`→`#232120`); linhas de tabela recebem `background:#1E1D1C`; itens de navegação mudam a cor do texto. Transição sugerida: 120ms ease-out em `background-color` e `color`.
- **Foco de teclado**: `outline:2px solid rgba(62,207,165,.35); outline-offset:3px`.
- **Disabled**: `opacity .6` + `cursor:not-allowed`.
- **Drill-down**: linhas de tabela expandem inline, sem nova consulta (mesmo comportamento atual).
- **Modais**: entram com fade + 8px de subida, 160ms; fecham por ✕, toque fora ou Esc.
- **Sidebar recolhível** (novo):
  - Desktop ≥1280: fixa em 248px, recolhível para 72px pela seta no rodapé.
  - Tablet 768–1279: **recolhida por padrão**; expandir **sobrepõe** o conteúdo (248px + `rgba(12,11,10,.45)` sobre a área restante) em vez de empurrar, para a tabela atrás não refluir.
  - Mobile ≤767: gaveta de 296px, itens de 46px, aberta pelo botão de menu de 44px na topbar; fecha por toque fora, arraste para a esquerda ou Esc. Transição 200ms ease-out em `transform`.
  - Recolhida, cada ícone tem alvo de 44px, rótulo em tooltip ao segurar, e o item ativo mantém o traço verde à esquerda.
  - O estado recolhido é lembrado por dispositivo; a rota atual sempre abre o grupo dono dela.
- **Touch / PWA**: alvo mínimo 44px (48px no chão de fábrica); botões de fluxo com 56–72px; gaveta e rodapés respeitam `env(safe-area-inset-*)`.
- **Breakpoints**: substituir o único corte atual de 760px por **1024 / 768 / 430**, para que tablet em retrato receba a versão de toque e não a de desktop.
- **Estados de sistema**: "Sem dados" e "zero" continuam visualmente distintos — sem dados é frase, zero é número (§23.9). "Amostra insuficiente pra comparar" é estado próprio.

## State Management
Nenhum estado novo de domínio. O redesenho acrescenta apenas estado de interface:
- `sidebarRecolhida: boolean` (persistido por dispositivo) e `gavetaAberta: boolean` no mobile.
- `gruposAbertos: Set<Grupo>` substituindo o `grupoAberto: Grupo | null` atual (acordeão independente).
- Estado de expansão de linha de tabela e de seções recolhíveis da Intelligence (evidências, trace).
- Tudo mais — filtros, janelas, permissões, fetch — permanece como está.

## Assets
- **Fonte**: Schibsted Grotesk (Google Fonts, 400/500/600/700). Carregar por `next/font` em vez do `@import` dentro do `<style>`. Remover Sora, Inter e JetBrains Mono.
- **Ícones**: manter `lucide-react`, 16px com `strokeWidth={1.5}` (18–19px no mobile). Mapa usado nos mocks: Início → `Home`; Previsão semanal → `CalendarClock`; Capacidade semanal → `Gauge`; Apontamento → `ClipboardCheck`; Apontamentos realizados → `ClipboardList`; Visão geral → `LayoutGrid`; Produtividade → `BarChart3`; Funcionários → `Users`; Desvios → `AlertTriangle`; Paradas → `PauseCircle`; Validação da previsão → `CheckCircle2`; Produtos → `Package`; Máquinas → `Cog`; Custo por hora → `Clock`; menu mobile → `Menu`; fechar → `X`; recolher/expandir → `ChevronLeft`/`ChevronRight`; enviar → `ArrowUp`; ver dados → `ExternalLink`. Substituir os glifos de texto (⏸ ▶ ✎ ✕ 🔒 🔴) por ícones da mesma biblioteca.
- **Gráficos**: manter `recharts` em `ResponsiveContainer`. Sem gride de fundo, sem legenda flutuante: rótulos em texto abaixo do eixo, uma série em `--accent`, comparação em `--accent-deep`, acumulado do pareto em `--warning`. Barras com `radius={[6,6,3,3]}`. Sparklines podem ser `polyline` SVG simples.
- **Marca**: logos atuais em `src/lib/logos.ts` permanecem; nos mocks a marca aparece como círculo de 16px em `--accent` + "Sittech".

## Files

- `Sittech Estudio.dc.html` — design system, shell e as quatro experiências da primeira etapa (4A a 4H).
- `Sittech Estudio Telas.dc.html` — as demais 14 telas (5A a 5K), na mesma linguagem e com os mesmos tokens.
- `Sittech Concepts.dc.html` — os três conceitos explorados; 3A ("Estúdio com sidebar") é o aprovado, os outros ficam como registro da decisão.
- `SITTECH_DESIGN_HANDOFF.md` — levantamento do estado atual e **fonte das regras funcionais**. Em qualquer conflito entre estes mocks e o handoff, **o handoff vence**.

Para abrir os `.dc.html`: qualquer navegador. São protótipos de referência, não código de produção.

## Checklist antes de considerar pronto
- [ ] Nenhuma fórmula, métrica ou permissão alterada.
- [ ] Performance/OEE/pressão sem teto visual em 100%.
- [ ] Produção acabada e processada nunca somadas; previsto/possível/realizado/falta em campos distintos.
- [ ] Realizado oficial e produção acabada observada nunca somados; divergência apenas como conferência.
- [ ] Apontamento sem meta, custo, OEE, disponibilidade ou qualidade.
- [ ] Confiança da Intelligence nunca promovida; evidência sempre visível para número citado.
- [ ] Capacidade perdida nunca convertida em faturamento.
- [ ] Sem ranking de funcionários; desvios sem causa atribuída a pessoa.
- [ ] Visão Geral sem cálculo próprio; Validação sem escrita na Previsão.
- [ ] "Sem dados" ≠ "zero".
- [ ] Sidebar funciona com qualquer combinação de permissões, inclusive só `producao_real_apontamento`.
- [ ] Nenhum `tabular-nums` em Schibsted Grotesk.
- [ ] Nenhum campo de formulário adicionado, removido ou renomeado em nenhuma tela.
- [ ] Imposto de 9%, ponto de equilíbrio e resultado mensal idênticos aos atuais.
- [ ] Funcionários analytics sem ranking, sem nota única e sem valor individual de salário.
- [ ] Paradas mantendo custo do tempo ocioso (R$) e capacidade local perdida (peças) separados.
- [ ] Capacidade (guloso por lucro/hora) e Previsão (redução proporcional) permanecem algoritmos distintos.
- [ ] Dados Importados continua placeholder, sem simular conteúdo.

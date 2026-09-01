# BRIEFING COMPLETO — Migração do Sistema Sittech

Este documento reúne tudo que você precisa saber antes de começar a trabalhar na migração do Sistema Sittech de Artifact do Claude.ai para uma aplicação Next.js real. Leia tudo antes de tocar em qualquer arquivo.

O arquivo do código atual (`sittech-custos.jsx`) está anexado/salvo junto com este documento — é a cópia integral do sistema em produção hoje.

---

# PARTE 1 — DIAGNÓSTICO TÉCNICO

## A. Estado atual

**Arquitetura hoje:** um único componente React (arquivo `.jsx`, ~5.800 linhas), publicado como Artifact do Claude.ai. Não existe framework de rotas, backend, banco de dados relacional ou build pipeline — é uma SPA inteira dentro de um arquivo, com troca de "página" controlada por uma variável de estado (`abaAtiva`).

**Tecnologias em uso:**
- React (hooks: `useState`, `useMemo`, `useEffect` — sem Redux/Context, tudo no componente raiz)
- `lucide-react` (ícones), `recharts` (gráficos)
- CSS puro, injetado via `<style>` dentro do próprio JSX (sem Tailwind, sem CSS Modules)

**Persistência:** um mecanismo proprietário do Claude.ai (`window.storage`) — key-value simples, sem schema, sem relações, sem controle de concorrência. Todo o sistema salvo como um único blob de JSON, sob uma única chave.

**Roteamento:** não existe. Sem URLs por página, sem deep-linking.

**Autenticação:** lista de usuários dentro do próprio blob, senha em hash SHA-256 + salt, verificado inteiramente no navegador — sem backend validando nada.

## B. Riscos atuais

**CRÍTICO**
1. Não existe backend real — toda regra roda no navegador do cliente, incluindo autenticação.
2. Publicar uma nova versão do artefato às vezes cria um link novo com armazenamento vazio, em vez de atualizar o existente — comportamento de plataforma imprevisível, já causou susto de "perda de dados" real.
3. Um único blob de JSON como "banco" — sem transação, sem schema, sem proteção contra dois usuários salvando ao mesmo tempo (last-write-wins sem merge).
4. Sem backup automático — só exportação manual.

**ALTO**
5. Autenticação não é segura de verdade, mesmo com hash — sem servidor validando.
6. Sem ambiente de teste separado da produção.
7. Arquivo único gigante, dificultando manutenção.

**MÉDIO**
8. Sem histórico de alterações além do backup manual.
9. Nomes usados como referência em vários lugares em vez de IDs relacionais garantidos por banco.

**BAIXO**
10. Responsividade mobile não testada exaustivamente nos módulos mais novos.

## C. Arquitetura recomendada

Next.js + Vercel + Supabase (PostgreSQL + Auth) — adequado ao porte do projeto, sem overengineering.

Vantagem específica do Next.js: as API Routes resolvem sozinhas o problema de CORS de uma futura integração com a Plataforma Ninja (chamada servidor-servidor, sem exigir CORS liberado do lado deles, e sem expor chave de API no frontend).

**Ajustes já aprovados pelo dono do projeto:**
- Não considerar Vercel Hobby ou Supabase Free como solução definitiva de produção comercial — avaliar planos pagos com backup/recuperação adequados quando o sistema entrar oficialmente em produção. Ambos servem para desenvolvimento/preview por enquanto.
- Autenticação/perfis: começar só com Administrador/Usuário — não construir matriz de permissão granular antes de precisar.
- Auditoria: só onde já faz sentido hoje (usuários, exclusões, dados financeiros) — não em toda tabela por padrão.

## D. Diagrama simples

```
USUÁRIO (navegador)
   ↓
VERCEL (hospedagem + deploy automático)
   ↓
NEXT.JS (frontend + API Routes)
   ↓
SUPABASE
   ├── PostgreSQL (dados)
   ├── Auth (login, sessão, senha)
   └── Row Level Security

(futuro) API Routes do Next.js → API da Plataforma Ninja (servidor-servidor, sem CORS)
```

## E. Modelo de dados — tabelas principais propostas (referência para fases futuras, NÃO implementar ainda)

| Tabela | Finalidade | Relacionamentos-chave |
|---|---|---|
| `usuarios` | Login, papel (admin/usuario), ativo | — |
| `funcionarios` | Cadastro + custos adicionais (`funcionario_custos`) | — |
| `maquinas` | Nome, operação | — |
| `produtos` | Valor unitário, prioridade | — |
| `produto_etapas` | Roteiro de produção (operação, metas por período) | `produto_id` |
| `produto_etapa_maquinas` | Máquinas que atendem a etapa (N:N) | `etapa_id`, `maquina_id` |
| `periodos` | M1–T3, horário real | — |
| `custos_fixos` / `custos_pontuais` | Por categoria, mês | — |
| `faturamentos` | Receita datada, por mês | — |
| `previsoes_semanais` | Semana + itens | `produto_id`, `previsao_itens` |
| `producao_apontamentos` | (futuro) Lançamento real | `maquina_id`, `produto_id`, `funcionario_id` |
| `producao_paradas` | (futuro) Paradas | `apontamento_id` |
| `auditoria` | Quem fez o quê, quando | `usuario_id` |

UUID como chave em todas as tabelas. `deleted_at`/`ativo` em cadastros referenciados por histórico; hard delete aceitável só em rascunhos sem histórico associado.

## F–L (resumo — auth, ambientes, deploy, migrations, backup, segurança, custos)

- **Auth:** migrar para Supabase Auth (elimina o problema de senha gerenciada por nós). Papéis via RLS no Postgres, não só escondendo botão no frontend.
- **Dev x Produção:** dois projetos Supabase separados, preview automático por PR no Vercel + produção na `main`.
- **Deploy:** Claude Code → commit/push → GitHub → Preview Deployment → validação → merge → produção automática. Branch simples: `main` + feature branches curtas, sem `develop`.
- **Migrations:** todo schema versionado em SQL numerado, aplicado via Supabase CLI — nunca alteração manual direto no banco.
- **Backup:** Supabase já oferece backup automático; complementar com o "Gerar backup" manual que já existe hoje.
- **Segurança:** nenhuma chave privada no frontend; RLS ativo em tabelas sensíveis; autorização sempre validada no banco/servidor.
- **Custos:** GitHub e Vercel (preview) gratuitos no início; Supabase gratuito em desenvolvimento, plano pago avaliado antes de produção oficial; domínio próprio pago desde o início (~R$40-60/ano).

## M. Plano de migração completo (fases futuras, para contexto)

0. Backup do estado atual · 1. Estruturar projeto Next.js local · 2. Criar Supabase dev + schema de cadastros · 3. Migrar autenticação · 4. Migrar módulos de cadastro · 5. Migrar Previsão Semanal + Análise de Capacidade · 6. Migrar Faturamento · 7. Configurar Vercel preview/produção · 8. Validação em paralelo · 9. Desligar artefato antigo · 10. (futuro) Módulo de apontamento de produção.

**Estamos começando agora só pelas Fases 0 e 1.** Todo o resto é contexto para as próximas sessões, não para executar já.

## N. Pontos de atenção já sinalizados

- Migrar Previsão Semanal + Análise de Capacidade **cedo** entre os módulos difíceis (não por último) — é a lógica mais valiosa e mais testada; quanto antes rodar no ambiente novo, antes se valida que a migração preservou o comportamento certo.
- O hash SHA-256 client-side do módulo de Usuários é **temporário e deve ser completamente substituído** por Supabase Auth, não "aproveitado".
- Não modelar `producao_apontamentos`/`producao_paradas` antes do módulo de lançamento estar perto de ser usado de verdade.

---

# PARTE 2 — FORMATO EXATO DOS DADOS ATUAIS

## Chave utilizada

Uma única chave, um único blob de JSON:
```
STORAGE_KEY = "sittech-custos-mensais"
shared = true
```
Não existe nenhuma outra chave em uso.

## Formato completo do objeto salvo

```ts
{
  fixedCosts: Array<{ id: string; descricao: string; categoria: string; valor: number; ativo: boolean; }>;

  variableEntries: Array<{ id: string; mes: string /* AAAA-MM */; descricao: string; categoria: string; valor: number; }>;

  categorias: string[];
  operacoes: string[];

  funcionarios: Array<{
    id: string; nome: string; operacao: string; salarioBase: number; ativo: boolean;
    custos: Array<{ id: string; descricao: string; valor: number }>;
  }>;

  periodos: Array<{ id: string /* "m1".."t3" */; nome: string; inicio: string /* "07:12" */; fim: string; }>;

  diasUteis: string;         // dias úteis do MÊS
  diasUteisSemana: string;   // dias úteis da SEMANA

  faturamentos: Array<{
    mes: string;
    receitas: Array<{ id: string; data: string; descricao: string; valor: number }>;
    numFuncionarios: string | number;
    custoFuncionariosTotal: string | number;
    custoFixoTotal: string | number;
  }>;

  produtos: Array<{
    id: string; nome: string; referencia: string; valorUnitario: number; ativo: boolean;
    prioridade: "alta" | "media" | "baixa"; // ainda não usado em cálculo
    roteiro: Array<{
      id: string; operacao: string;
      metas: { m1: number; m2: number; m3: number; t1: number; t2: number; t3: number };
      maquinasIds: string[]; // referência a maquinas[].id
    }>;
  }>;

  maquinas: Array<{ id: string; nome: string; operacao: string; ativo: boolean; }>;

  previsoes: Array<{
    semanaInicio: string; // AAAA-MM-DD, sempre segunda-feira
    itens: Array<{
      id: string; produtoId: string; produtoNome: string; valorUnitario: number; quantidade: number;
      maquinasPorEtapa: { [etapaId: string]: string[] };
    }>;
    itensRealizados: Array<{ /* mesmo formato de itens */ }>;
    maquinasIndisponiveis?: string[];
  }>;

  usuarios: Array<{
    id: string; nome: string; login: string; senhaHash: string; senhaSalt: string;
    papel: "admin" | "usuario"; ativo: boolean; criadoEm: string; ultimoAcesso: string | null;
  }>;

  auditoria: Array<{ id: string; quando: string; quem: string; acao: string; usuarioAfetado: string | null; }>;
}
```

## Observações importantes

- `produtoNome`/`valorUnitario` dentro de `previsoes.itens` são **cópias** no momento do lançamento, não referências vivas — histórico não muda retroativamente se o produto mudar depois.
- `maquinasPorEtapa` é a peça mais importante e mais frágil — alimenta toda a Análise de Capacidade. A chave é o `id` da etapa dentro do roteiro do produto específico, não um id global.
- Campos numéricos às vezes aparecem como `string`, às vezes como `number` (resultado de digitação manual ao longo do tempo) — validar/normalizar na migração, não assumir consistência.
- Não existe soft-delete formal — o padrão usado é `ativo: boolean` em cadastros, não `deletedAt`.
- Para uma **amostra real e completa** desse formato: use "Gerar backup" já existente no sistema (aba Importar dados → Gerar backup → Baixar arquivo) — gera esse JSON exato, com dados reais da empresa.

---

# PARTE 3 — INSTRUÇÕES DE EXECUÇÃO (FASE 0 + FASE 1)

DIAGNÓSTICO APROVADO, COM ALGUNS AJUSTES. Podemos iniciar a implementação.

Antes de começar, considere estas correções:

1. Não assuma Vercel Hobby como solução definitiva de produção comercial. Para desenvolvimento/preview podemos avaliar opções gratuitas, mas a hospedagem definitiva da aplicação empresarial precisa respeitar os termos comerciais do provedor.
2. Não assuma que Supabase Free possui backup automático adequado para produção. Durante desenvolvimento podemos utilizar Free, mas quando o sistema Sittech entrar oficialmente em produção quero avaliar Supabase Pro ou uma estratégia equivalente que tenha backup automático e recuperação confiável.
3. Por enquanto NÃO desenvolva: módulo de apontamento de produção; integração com Ninja; OEE; novas funcionalidades; novos dashboards; novas regras de negócio.

Primeiro vamos transformar a base existente em um projeto de software profissional SEM alterar o comportamento funcional atual.

## INICIAR FASE 0 + FASE 1

Quero começar agora pela preparação e estruturação do projeto.

**Objetivo desta fase:** sair do Artifact monolítico atual e criar um projeto Next.js organizado, versionável e executável localmente. Nesta fase ainda NÃO quero migrar os dados para Supabase. O sistema deverá continuar utilizando temporariamente a persistência atual ou, se `window.storage` não existir fora do Artifact, criar uma camada temporária de persistência compatível para desenvolvimento. Não misture ainda refatoração estrutural com migração de banco. Primeiro quero provar que conseguimos transportar o software atual para uma aplicação independente.

### ETAPA 0 — PRESERVAÇÃO

Antes de alterar qualquer coisa:
1. Faça uma cópia integral do código atual (arquivo `sittech-custos.jsx` anexado a este briefing).
2. Não sobrescreva o arquivo original.
3. Identifique todas as funcionalidades existentes.
4. Identifique todas as chaves utilizadas no `window.storage` (ver Parte 2 acima — já documentado).
5. Identifique o formato completo do JSON atualmente salvo (ver Parte 2 acima — já documentado).
6. Preserve uma amostra desse formato para futura migração (gerar via "Gerar backup" no sistema, ver Parte 2).

### ETAPA 1 — CRIAR PROJETO NEXT.JS

TypeScript, App Router, estrutura limpa de pastas, ESLint, configuração adequada para Vercel. Sem Redux. Sem Tailwind por preferência — o sistema atual usa CSS próprio e queremos preservar a identidade visual inicialmente (podemos reorganizar CSS depois se houver benefício real).

### ETAPA 2 — QUEBRAR O COMPONENTE DE 5.800 LINHAS

REFATORAR NÃO SIGNIFICA REDESENHAR. Preserve aparência, textos, comportamento, cálculos, navegação, filtros, formulários, gráficos, estados, lógica. A primeira refatoração muda a arquitetura do código, NÃO o produto percebido pelo usuário.

Organize aproximadamente em `app/`, `components/`, `features/`, `lib/`, `types/`, `hooks/`, `services/`, `styles/` — adapte conforme o projeto real, sem forçar.

### ETAPA 3 — ORGANIZAR POR DOMÍNIO

`features/dashboard`, `custos`, `funcionarios`, `produtos`, `maquinas`, `previsao`, `capacidade`, `faturamento`, `usuarios`. O componente principal deve coordenar a aplicação, não conter toda a aplicação.

### ETAPA 4 — TIPAGEM

Criar tipos/interfaces para as entidades reais (Produto, Maquina, Funcionario, Usuario, Previsao, Etapa, Custo, Faturamento etc. — ver Parte 2 para os formatos exatos). Não inventar propriedades. Evitar `any` sempre que razoável.

### ETAPA 5 — SEPARAR REGRA DE NEGÓCIO DA INTERFACE

Extrair cálculos (produtividade, capacidade, custos, margens, previsões, percentuais, totais) para módulos como `lib/calculations/`, preservando exatamente os resultados atuais. Não "melhorar" fórmulas nesta fase — se encontrar algo suspeito, documentar como `COMPORTAMENTO ATUAL — REVISAR FUTURAMENTE` e preservar.

### ETAPA 6 — CRIAR CAMADA DE DADOS

Abstração tipo `DataRepository`/`StorageService` (`getProdutos()`, `saveProduto()`, `getMaquinas()`, `savePrevisao()`, etc.) em vez de acesso direto a `window.storage` espalhado pelos componentes. Nesta fase, a implementação ainda pode usar armazenamento temporário/local — o objetivo é permitir trocar por Supabase depois sem reescrever telas.

### ETAPA 7 — COMPATIBILIDADE COM O FORMATO ANTIGO

Manter função temporária capaz de EXPORTAR o estado atual, IMPORTAR o estado antigo, e VALIDAR minimamente sua estrutura — necessário para a futura migração de dados reais para PostgreSQL.

### ETAPA 8 — ROTAS

Migrar de `abaAtiva` para rotas reais (`/dashboard`, `/custos`, `/funcionarios`, `/produtos`, `/maquinas`, `/previsao`, `/faturamento`, `/usuarios`, mapeadas conforme as telas reais existentes). Objetivo: deep linking, refresh sem perder página, URLs previsíveis. Preservar o menu atual visualmente.

### ETAPA 9 — AUTENTICAÇÃO

AINDA NÃO migrar para Supabase Auth nesta fase. Isolar completamente a autenticação atual, sem espalhar lógica de login pelos componentes. Preparar uma interface/serviço substituível depois. A solução atual (hash client-side) é TEMPORÁRIA — não investir tempo sofisticando-a.

### ETAPA 10 — TESTES DE REGRESSÃO

Fase só será concluída se o novo projeto produzir os mesmos resultados do sistema atual. Prioridade de testes: 1) Análise de capacidade, 2) Previsão semanal, 3) Custo/hora, 4) Faturamento e indicadores, 5) demais cálculos importantes. Usar exemplos reais existentes no sistema atual como casos de teste.

### ETAPA 11 — GITHUB

Inicializar Git, criar `.gitignore`, garantir que secrets não sejam versionados, criar README (objetivo, tecnologias, instalação, como rodar, estrutura, comandos, variáveis de ambiente, estratégia futura de deploy), commit inicial. O repositório passa a ser a fonte oficial do código.

### ETAPA 12 — PREPARAR VERCEL, MAS NÃO PUBLICAR PRODUÇÃO AINDA

Garantir compatibilidade com Vercel e, se possível, gerar um Preview Deployment sem comprometer nada — mas isso ainda não é a produção oficial (faltam Supabase, Auth, dados, RLS, backups, ambientes).

## REGRA SOBRE REFATORAÇÃO

Não uma refatoração perfeccionista — não transformar 5.800 linhas em 300 arquivos. Separação só onde há benefício real. Evitar abstrações desnecessárias, componentes minúsculos sem razão, arquitetura acadêmica, design patterns por elegância, complexidade que dificulte futuras alterações pelo Claude Code. O código deve ficar simples de entender.

## CRITÉRIO DE ACEITE DA FASE 1

- [ ] Projeto roda fora do Claude Artifact
- [ ] Builda sem erro
- [ ] TypeScript sem erros relevantes
- [ ] Todas as principais telas continuam acessíveis
- [ ] Visual permanece essencialmente igual
- [ ] Regras de negócio produzem os mesmos resultados
- [ ] Código não depende diretamente de `window.storage` espalhado pelos componentes
- [ ] Existe camada de dados substituível futuramente pelo Supabase
- [ ] JSON antigo pode ser exportado/importado
- [ ] Principais regras de cálculo possuem testes
- [ ] Projeto versionado com Git
- [ ] README suficiente para outro desenvolvedor executar o projeto
- [ ] Nenhum secret dentro do repositório

## NÃO FAÇA AINDA

Não criar tabelas Supabase. Não migrar dados. Não substituir autenticação por Supabase Auth. Não construir apontamento de produção. Não integrar Ninja. Não alterar fórmulas. Não redesenhar telas. Não adicionar funcionalidades não pedidas. Não tentar resolver todas as fases de uma vez.

## COMO TRABALHAR

Execução incremental. Antes de alterar arquivos importantes, examinar o código existente. Depois de cada bloco relevante: rodar build, rodar TypeScript, rodar testes, corrigir regressões. Comportamento duvidoso encontrado no sistema atual: registrar como `COMPORTAMENTO ATUAL — REVISAR FUTURAMENTE`, mas preservar nesta fase. Objetivo primeiro é PARIDADE FUNCIONAL — melhorias vêm depois.

## ENTREGA DA FASE

Ao finalizar, entregar: 1) estrutura final das pastas, 2) o que foi separado do monolito, 3) o que permaneceu temporariamente, 4) quais testes foram criados, 5) resultado do build, 6) pendências encontradas, 7) riscos identificados, 8) próxima fase recomendada.

**NÃO comece a Fase 2 / Supabase automaticamente. Pare após concluir e validar esta fase.**

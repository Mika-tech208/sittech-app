# Sittech — Custos e Produção

Sistema interno de custos, previsão semanal, capacidade produtiva e
faturamento da Sittech. Migração do Artifact original do Claude.ai
(`docs/legacy/briefing-claude-code-fase0-1.md` tem o briefing completo da
migração) para um projeto Next.js versionado e executável localmente.

## Status da migração

**Fase 0 + Fase 1 (em andamento).** As constantes, tipos, utilitários puros e
a camada de dados já foram extraídos para `src/lib`, `src/types` e
`src/services`. A tela em si (`src/features/legacy/SittechApp.tsx`) ainda é o
componente original quase intacto — a quebra em componentes por domínio e em
rotas reais (uma URL por aba) é o próximo passo, feita incrementalmente com
verificação no navegador a cada domínio.

## Tecnologias

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- `lucide-react` (ícones), `recharts` (gráficos)
- CSS próprio injetado via `<style>` no componente (sem Tailwind, de
  propósito — preserva a identidade visual original)
- Vitest + Testing Library para os testes

## Instalação

Requer Node.js 20.9+ (ver `node -v`).

```bash
npm install
cp .env.example .env.local
```

Preencha `.env.local` com os usuários reais (ver seção **Variáveis de
ambiente** abaixo) — sem isso não é possível logar localmente.

## Como rodar

```bash
npm run dev        # servidor de desenvolvimento em http://localhost:3000
npm run build       # build de produção (Turbopack)
npm run start        # roda o build de produção
npm run lint          # ESLint
npm run test            # roda os testes uma vez
npm run test:watch       # testes em modo watch
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NEXT_PUBLIC_SEED_USUARIOS_JSON` | Sim (dev local) | Array JSON `[{usuario, senha, nome}]` usado **uma única vez** para popular o primeiro usuário admin quando o `localStorage` está vazio. Roda no navegador (por isso o prefixo `NEXT_PUBLIC_`) e é temporário — some quando a autenticação migrar para Supabase Auth. Nunca commitar valores reais; use `.env.local` (gitignored). |

## Estrutura

```
src/
  app/                   # rotas Next.js (App Router)
  features/legacy/        # tela transplantada da Fase 1 (ver Status acima)
  lib/                      # constantes, tipos utilitários, cálculos puros
    calculations/             # funções de cálculo puras e testáveis
  services/                    # camada de dados (storage, backup) — trocável por Supabase depois
  types/                         # tipos de domínio (Produto, Funcionario, Previsao, etc.)
docs/legacy/                       # briefing da migração + cópia de referência do sistema original
```

## Persistência de dados (temporária)

Os dados ficam no `localStorage` do navegador via `src/services/storage-service.ts`,
que implementa a mesma interface `get/set(key, value, shared)` que o sistema
original usava com `window.storage` dentro do Artifact do Claude.ai — trocável
por uma implementação sobre Supabase numa fase futura sem reescrever as
telas. **Isso significa que os dados são por navegador/dispositivo, não
compartilhados entre usuários** — essa é uma limitação conhecida da Fase 1,
resolvida quando a Fase 2 (Supabase) entrar.

## Deploy

Ainda não configurado para produção — ver `docs/legacy/briefing-claude-code-fase0-1.md`
(Parte 3, Etapa 12) para o plano: Vercel + Supabase (Postgres + Auth), com
ambientes de desenvolvimento e produção separados.

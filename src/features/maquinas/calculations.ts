import type { Maquina, Produto } from "@/types/domain";
import type { ProdutoQueUsaMaquina } from "@/features/maquinas/types";
import { uid } from "@/lib/id";

export function ordenarMaquinasPorNome(maquinas: Maquina[]): Maquina[] {
  return [...maquinas].sort((a, b) => a.nome.localeCompare(b.nome));
}

// Descobre quais produtos usam essa máquina, e em quais etapas — sempre via
// produto.roteiro[].maquinasIds (por ID), nunca por nome ou operação. Mesma
// lógica que já existia no monólito (produtosQueUsamMaquina), extraída
// aqui pra função pura testável.
export function encontrarProdutosQueUsamMaquina(maquinaId: string, produtos: Produto[]): ProdutoQueUsaMaquina[] {
  return produtos
    .map((p) => {
      const etapas = (p.roteiro || []).filter((e) => (e.maquinasIds || []).includes(maquinaId));
      return etapas.length > 0 ? { produto: p, etapas } : null;
    })
    .filter((x): x is ProdutoQueUsaMaquina => x !== null);
}

// ---- CRUD (mesmo padrão de Produtos/Funcionários) ----

export function criarMaquina(maquinas: Maquina[], dados: Omit<Maquina, "id" | "ativo">): Maquina[] {
  return [...maquinas, { id: uid(), ...dados, ativo: true }];
}

// Preserva `maquina.id` e `ativo` — a edição nunca troca a identidade nem
// mexe no estado ativo/pausada.
export function atualizarMaquina(maquinas: Maquina[], id: string, dados: Omit<Maquina, "id" | "ativo">): Maquina[] {
  return maquinas.map((m) => (m.id === id ? { ...m, ...dados } : m));
}

export function alternarMaquinaAtiva(maquinas: Maquina[], id: string): Maquina[] {
  return maquinas.map((m) => (m.id === id ? { ...m, ativo: !m.ativo } : m));
}

// COMPORTAMENTO ATUAL — REVISAR PARA BANCO: exclusão é destrutiva (remove
// do array). Não checa se a máquina está referenciada em roteiro de produto
// (produto.roteiro[].maquinasIds) nem em previsões já lançadas
// (PrevisaoItem.maquinasPorEtapa) — as referências ficam órfãs (ver
// `analisarIntegridadeRoteiro` em features/produtos, que passa a apontar a
// máquina removida em `maquinasInexistentes`). Pra PostgreSQL, a
// recomendação é usar `ativo=false` (já existe, via alternarMaquinaAtiva)
// ou `deleted_at`, preservando a linha pra manter a integridade referencial
// do que já foi lançado. Preservado como hard-delete nesta etapa.
export function removerMaquina(maquinas: Maquina[], id: string): Maquina[] {
  return maquinas.filter((m) => m.id !== id);
}

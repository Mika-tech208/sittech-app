// Catálogo único das permissões de módulo — mesma lista do CHECK de
// usuario_permissoes (migration 20260902190000). Fonte única pro
// formulário de usuário, pro Sidebar e pro gate de cada página: nunca
// duplicar essa lista de string em outro lugar.

export type Permissao =
  | "financeiro"
  | "produtos"
  | "maquinas"
  | "funcionarios"
  | "custo_hora"
  | "previsao"
  | "capacidade"
  | "producao_real_apontamento"
  | "producao_real_historico"
  | "producao_real_ocorrencias"
  | "usuarios"
  | "auditoria";

export interface PermissaoInfo {
  chave: Permissao;
  label: string;
}

export interface GrupoPermissoes {
  titulo: string;
  itens: PermissaoInfo[];
}

// Agrupamento exatamente como pedido no formulário — Produção / Cadastros
// / Gestão / Administração.
export const GRUPOS_PERMISSOES: GrupoPermissoes[] = [
  {
    titulo: "Produção",
    itens: [
      { chave: "previsao", label: "Previsão" },
      { chave: "capacidade", label: "Capacidade" },
      { chave: "producao_real_apontamento", label: "Produção Real — Apontamento" },
      { chave: "producao_real_historico", label: "Produção Real — Histórico" },
      { chave: "producao_real_ocorrencias", label: "Produção Real — Ocorrências" },
    ],
  },
  {
    titulo: "Cadastros",
    itens: [
      { chave: "produtos", label: "Produtos" },
      { chave: "maquinas", label: "Máquinas" },
      { chave: "funcionarios", label: "Funcionários" },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { chave: "financeiro", label: "Financeiro" },
      { chave: "custo_hora", label: "Custo por Hora" },
    ],
  },
  {
    titulo: "Administração",
    itens: [
      { chave: "usuarios", label: "Usuários" },
      { chave: "auditoria", label: "Auditoria" },
    ],
  },
];

// Lista plana das chaves válidas — mesmos valores do CHECK da migration,
// usada pra validar o payload no Route Handler de criação de usuário.
export const PERMISSOES_VALIDAS: Permissao[] = GRUPOS_PERMISSOES.flatMap((g) => g.itens.map((i) => i.chave));

// Atalho de seleção, não um cargo — só marca essas 3 e some. O admin
// continua livre pra marcar/desmarcar qualquer permissão depois de
// aplicar, inclusive misturar com outras.
export const PRESET_SUPERVISAO_PRODUCAO: Permissao[] = [
  "producao_real_apontamento",
  "producao_real_historico",
  "producao_real_ocorrencias",
];

// papel === "admin" sempre passa, sem precisar de nenhuma linha em
// usuario_permissoes — mesma regra da RLS (is_admin() em has_permissao()).
export function temPermissao(
  usuarioLogado: { papel: "admin" | "usuario"; permissoes?: string[] } | null | undefined,
  permissao: Permissao
): boolean {
  if (!usuarioLogado) return false;
  if (usuarioLogado.papel === "admin") return true;
  return (usuarioLogado.permissoes || []).includes(permissao);
}

// Qualquer uma das 3 de Produção Real — usado pra decidir se o grupo
// "Produção Real" (com as sub-abas ainda não implementadas) aparece no
// Sidebar.
export function temAlgumaPermissaoProducaoReal(
  usuarioLogado: { papel: "admin" | "usuario"; permissoes?: string[] } | null | undefined
): boolean {
  return (
    temPermissao(usuarioLogado, "producao_real_apontamento") ||
    temPermissao(usuarioLogado, "producao_real_historico") ||
    temPermissao(usuarioLogado, "producao_real_ocorrencias")
  );
}

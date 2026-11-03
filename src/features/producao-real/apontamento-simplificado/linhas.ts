// PASSOS 1 e 2 — edição das linhas. TUDO é editável (máquina, operador, produto), sem bloqueio: o que vale é a realidade do chão.
// O planejado NUNCA é tocado: nenhuma função aqui cria um novo `planejado` (a referência é a mesma, congelada). Funções puras e imutáveis.
import type { Catalogo, ElegibilidadeItem, LinhaApontamento, MotivoNaoProduziu, Opcao } from "./tipos";
import { linhaVazia } from "./prefill";

export type PatchReal = Partial<{ maquinaId: string | null; funcionarioId: string | null; produtoId: string | null }>;

/** Linhas que o fluxo pode alterar (as lançadas no painel ficam como estão). */
export const editavel = (l: LinhaApontamento) => l.situacao !== "EXISTENTE_PAINEL";

/** Produtos elegíveis (roteiro) em uma máquina. */
export function produtosDaMaquina(cat: Catalogo, maquinaId: string | null): Opcao[] {
  if (!maquinaId) return [];
  const ids = new Set(cat.elegibilidade.filter((e) => e.maquinaId === maquinaId).map((e) => e.produtoId));
  return cat.produtos.filter((p) => ids.has(p.id));
}

/** Etapa/operação derivadas do par máquina×produto. null = par sem etapa elegível OU ambíguo (o banco só aceita exatamente uma). */
export function etapaDoPar(cat: Catalogo, maquinaId: string | null, produtoId: string | null): ElegibilidadeItem | null {
  if (!maquinaId || !produtoId) return null;
  const itens = cat.elegibilidade.filter((e) => e.maquinaId === maquinaId && e.produtoId === produtoId);
  return itens.length === 1 ? itens[0] : null;
}
export const operacaoDaLinha = (cat: Catalogo, l: LinhaApontamento): { id: string; nome: string } | null => {
  const e = etapaDoPar(cat, l.real.maquinaId, l.real.produtoId);
  return e ? { id: e.operacaoId, nome: cat.operacoes[e.operacaoId] ?? "—" } : null;
};

/** Altera o REAL. Trocar a máquina mantém o produto se ele for elegível na nova máquina; se não for, o produto é limpo (a pessoa escolhe) — nunca bloqueia. */
export function editarReal(l: LinhaApontamento, patch: PatchReal, cat: Catalogo): LinhaApontamento {
  if (!editavel(l)) return l;
  const real = { ...l.real, ...patch };
  if ("maquinaId" in patch && patch.maquinaId !== l.real.maquinaId && real.produtoId && !etapaDoPar(cat, real.maquinaId, real.produtoId)) real.produtoId = null;
  return { ...l, real };
}

const inteiro = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.max(0, Math.floor(v)));
export function informarQuantidades(l: LinhaApontamento, q: Partial<{ produzido: number | null; refugo: number | null }>): LinhaApontamento {
  if (!editavel(l)) return l;
  return { ...l, ...("produzido" in q ? { produzido: inteiro(q.produzido ?? null) } : {}), ...("refugo" in q ? { refugo: inteiro(q.refugo ?? null) } : {}), naoProduziu: false, motivo: null, descricao: "" };
}

/** Botão rápido NÃO PRODUZIU: zera as quantidades e exige motivo (validação). */
export function marcarNaoProduziu(l: LinhaApontamento, motivo: MotivoNaoProduziu | null = null, descricao = ""): LinhaApontamento {
  if (!editavel(l)) return l;
  return { ...l, naoProduziu: true, motivo, descricao, produzido: null, refugo: null };
}
export function desfazerNaoProduziu(l: LinhaApontamento): LinhaApontamento {
  if (!editavel(l)) return l;
  return { ...l, naoProduziu: false, motivo: null, descricao: "" };
}
export function escolherMotivo(l: LinhaApontamento, motivo: MotivoNaoProduziu, descricao?: string): LinhaApontamento {
  if (!editavel(l) || !l.naoProduziu) return l;
  return { ...l, motivo, descricao: descricao ?? l.descricao };
}
export function editarDescricao(l: LinhaApontamento, descricao: string): LinhaApontamento { return editavel(l) && l.naoProduziu ? { ...l, descricao } : l; }

/** PASSO 2 — `+ ADICIONAR APONTAMENTO`: linha fora da escala (POSTO_NAO_PLANEJADO). */
export const adicionarExtra = (linhas: LinhaApontamento[], chave: string): LinhaApontamento[] => [...linhas, linhaVazia(chave)];
/** Só extras ainda não gravadas saem da tela direto; extra já gravada some do banco no próximo salvamento (reenvio substitui). Posto programado nunca é removido. */
export const removerExtra = (linhas: LinhaApontamento[], chave: string): LinhaApontamento[] =>
  linhas.filter((l) => !(l.chave === chave && l.origem === "POSTO_NAO_PLANEJADO" && l.situacao !== "EXISTENTE_PAINEL"));

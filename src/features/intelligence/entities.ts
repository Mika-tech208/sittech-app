// Sittech Intelligence V1 — resolução determinística de entidades (§10 da
// análise aprovada). O LLM NUNCA inventa um ID — só manda um nome/alias
// em texto livre ("Embalagem 17", "Luva 3/4"); esta função resolve contra
// a lista real de candidatos (já carregada via dataFetchers.ts) e devolve
// o ID exato, ou sinaliza ambiguidade/ausência — nunca escolhe um UUID
// "no chute".

export interface CandidatoEntidade {
  id: string;
  nome: string;
}

export type ResultadoResolucaoEntidade =
  | { status: "resolvido"; id: string; nome: string }
  | { status: "ambiguo"; candidatos: CandidatoEntidade[] }
  | { status: "nao_encontrado" };

// ̀-ͯ = faixa Unicode das marcas diacríticas combinantes (o que
// sobra de um acento depois de normalize("NFD") separar base+acento).
const MARCAS_DIACRITICAS_RE = /[̀-ͯ]/g;

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(MARCAS_DIACRITICAS_RE, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Resolução em 3 passos, do mais estrito ao mais permissivo — nunca pula
// direto pro fuzzy se já existe um match exato, pra minimizar falso
// positivo:
//   1) match exato (normalizado) — só 1 candidato -> resolvido.
//   2) match por prefixo/substring (normalizado) — só 1 candidato -> resolvido.
//   3) mais de 1 candidato em qualquer passo -> ambíguo (nunca escolhe um).
//   nenhum candidato em nenhum passo -> não encontrado.
export function resolverEntidade(nomeBuscado: string, candidatos: CandidatoEntidade[]): ResultadoResolucaoEntidade {
  const alvo = normalizar(nomeBuscado);
  if (!alvo) return { status: "nao_encontrado" };

  const exatos = candidatos.filter((c) => normalizar(c.nome) === alvo);
  if (exatos.length === 1) return { status: "resolvido", id: exatos[0].id, nome: exatos[0].nome };
  if (exatos.length > 1) return { status: "ambiguo", candidatos: exatos };

  const porSubstring = candidatos.filter((c) => normalizar(c.nome).includes(alvo) || alvo.includes(normalizar(c.nome)));
  if (porSubstring.length === 1) return { status: "resolvido", id: porSubstring[0].id, nome: porSubstring[0].nome };
  if (porSubstring.length > 1) return { status: "ambiguo", candidatos: porSubstring };

  return { status: "nao_encontrado" };
}

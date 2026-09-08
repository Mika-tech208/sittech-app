// Sittech Intelligence V1 — filtro leve de causalidade (§10/§15 da
// análise aprovada). Regra: correlação/coincidência NÃO é causa. Isto
// NÃO é um parser linguístico — é um filtro simples e testável de
// padrões de superfície, aplicado UMA vez sobre a resposta final antes
// de exibi-la (§15: "máximo 1 tentativa de correção", nunca loop).
//
// O filtro é deliberadamente conservador (prefere falso positivo — pedir
// reformulação de algo que já era seguro — a deixar passar uma frase
// causal). A instrução principal de não afirmar causa é do system prompt
// (ver instrucaoCausalidadeParaPrompt); este filtro é a segunda camada,
// não a única.

const PADROES_CAUSAIS_PROIBIDOS: RegExp[] = [
  /\bcaiu porque\b/i,
  /\bfoi causad[oa] por\b/i,
  /\bcausou\b/i,
  /\bculpa d[eoa]\b/i,
  /\bpor causa d[eoa] funcion[aá]ri/i,
  /\bmotivo de a m[aá]quina estar\b/i,
  /\bfoi respons[aá]vel por\b/i,
  /\baconteceu porque\b/i,
];

// Termos que, combinados com um padrão causal, aumentam a gravidade
// (atribuição causal em cima de pessoa é a pior classe de erro aqui —
// ver §16 da implementação, "Funcionários").
const MARCADOR_PESSOA_RE = /\bfuncion[aá]ri[oa]\b/i;

export interface AvaliacaoCausalidade {
  violacao: boolean;
  padroesEncontrados: string[];
  envolveFuncionario: boolean;
}

export function avaliarCausalidade(texto: string): AvaliacaoCausalidade {
  const padroesEncontrados = PADROES_CAUSAIS_PROIBIDOS.filter((re) => re.test(texto)).map((re) => re.source);
  return {
    violacao: padroesEncontrados.length > 0,
    padroesEncontrados,
    envolveFuncionario: MARCADOR_PESSOA_RE.test(texto),
  };
}

export function instrucaoCausalidadeParaPrompt(): string {
  return [
    "Correlação e coincidência NUNCA significam causa.",
    'Nunca escreva "aconteceu porque...", "foi causado por...", "funcionário X causou...", "culpa de...".',
    'Prefira: "coincidiu com...", "os dados mostram associação com...", "uma evidência relacionada é...", "vale investigar...".',
    "Isso vale especialmente quando a frase envolve o nome de um funcionário — nunca atribua a um funcionário a causa de um problema de máquina/produto/processo.",
  ].join("\n");
}

// Estratégia de correção (§15): se o filtro detectar violação, o
// orquestrador deve pedir ao provider UMA reformulação (nunca mais que
// uma), passando de volta o texto original + o motivo da rejeição. Se a
// segunda tentativa ainda violar, o orquestrador substitui a resposta por
// um texto seguro genérico (nunca expõe a versão com causalidade
// indevida) — ver orchestrator.ts.
export function instrucaoReformulacaoParaPrompt(motivos: string[]): string {
  return [
    "Sua resposta anterior continha uma afirmação de causa que os dados não sustentam.",
    `Trecho(s) problemático(s) detectado(s): ${motivos.join("; ")}.`,
    "Reescreva a resposta usando linguagem de associação/evidência, nunca de causa direta, preservando os mesmos números e evidências.",
  ].join("\n");
}

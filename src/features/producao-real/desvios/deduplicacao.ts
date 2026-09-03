// Desvios V1 — deduplicação (§13, aprovado). "Incidente principal" +
// "efeitos observados": agrupa quando há mesmo contexto + mesma janela +
// mesmo fenômeno operacional dominante CONFIÁVEL (aparece em pelo menos 2
// desvios do grupo). Se não houver fator dominante confiável, NÃO inventa
// um — cada desvio vira seu próprio incidente (preferir 2 cards a criar
// uma causa falsa, literal ao aprovado).

import type { DesvioDetectado, IncidenteDesvio, SeveridadeDesvio, PossivelFator } from "@/features/producao-real/desvios/types";

function rankSeveridade(s: SeveridadeDesvio): number {
  return s === "critico" ? 2 : s === "atencao" ? 1 : 0;
}

function maiorSeveridade(severidades: SeveridadeDesvio[]): SeveridadeDesvio {
  return severidades.reduce((max, s) => (rankSeveridade(s) > rankSeveridade(max) ? s : max), "informativo" as SeveridadeDesvio);
}

function unificarFatores(desvios: DesvioDetectado[]): PossivelFator[] {
  const porFator = new Map<string, PossivelFator>();
  desvios.forEach((d) => d.possiveisFatores.forEach((f) => { if (!porFator.has(f.fator)) porFator.set(f.fator, f); }));
  return Array.from(porFator.values());
}

function chaveContextoJanela(d: DesvioDetectado): string {
  return [
    d.contexto.produtoId ?? "-", d.contexto.operacaoId ?? "-", d.contexto.maquinaId ?? "agregado",
    d.janelaAtual.dataInicial, d.janelaAtual.dataFinal, d.origemJanela,
  ].join("::");
}

export function deduplicarDesvios(desvios: DesvioDetectado[]): IncidenteDesvio[] {
  const porContextoJanela = new Map<string, DesvioDetectado[]>();
  desvios.forEach((d) => {
    const chave = chaveContextoJanela(d);
    const atual = porContextoJanela.get(chave);
    if (atual) atual.push(d);
    else porContextoJanela.set(chave, [d]);
  });

  const incidentes: IncidenteDesvio[] = [];

  porContextoJanela.forEach((grupo, chave) => {
    // Fator dominante = o `fator` (rótulo) mais repetido entre os
    // possíveisFatores dos desvios do grupo — só é "confiável" se
    // compartilhado por >=2 desvios distintos (nunca inventado a partir
    // de 1 único desvio isolado).
    const contagemFator = new Map<string, number>();
    grupo.forEach((d) => {
      new Set(d.possiveisFatores.map((f) => f.fator)).forEach((fator) => contagemFator.set(fator, (contagemFator.get(fator) ?? 0) + 1));
    });
    let fatorDominante: string | null = null;
    let maxContagem = 0;
    contagemFator.forEach((contagem, fator) => {
      if (contagem > maxContagem) { maxContagem = contagem; fatorDominante = fator; }
    });
    const temFatorDominanteConfiavel = grupo.length >= 2 && maxContagem >= 2;

    if (temFatorDominanteConfiavel) {
      const ordenado = [...grupo].sort((a, b) => rankSeveridade(b.severidade) - rankSeveridade(a.severidade));
      const [principal, ...efeitos] = ordenado;
      incidentes.push({
        id: `incidente:${chave}:${fatorDominante}`,
        contexto: principal.contexto, janelaAtual: principal.janelaAtual, janelaReferencia: principal.janelaReferencia,
        chaveFatorDominante: fatorDominante,
        desvioPrincipal: principal, efeitos,
        severidade: maiorSeveridade(grupo.map((d) => d.severidade)),
        possiveisFatores: unificarFatores(grupo),
      });
    } else {
      // Sem consenso de fator -> nunca inventar causa: 1 incidente por
      // desvio, ainda agrupáveis visualmente pelo mesmo contexto na UI.
      grupo.forEach((d) => {
        incidentes.push({
          id: `incidente:${d.id}`,
          contexto: d.contexto, janelaAtual: d.janelaAtual, janelaReferencia: d.janelaReferencia,
          chaveFatorDominante: null,
          desvioPrincipal: d, efeitos: [],
          severidade: d.severidade,
          possiveisFatores: d.possiveisFatores,
        });
      });
    }
  });

  return incidentes;
}

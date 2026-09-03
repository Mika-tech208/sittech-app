// Desvios V1 — prioridade (§14, aprovado). Ordenação LEXICOGRÁFICA por
// critérios (severidade -> recência -> impacto -> persistência) — nunca
// soma ponderada. Cada critério é explicável isoladamente na UI.

import type { IncidenteDesvio, SeveridadeDesvio } from "@/features/producao-real/desvios/types";

function rankSeveridade(s: SeveridadeDesvio): number {
  return s === "critico" ? 2 : s === "atencao" ? 1 : 0;
}

// Recência: um incidente detectado pela leitura OPERACIONAL (mais
// granular/recente) prioriza sobre um detectado só pela ESTRUTURAL.
function rankRecencia(inc: IncidenteDesvio): number {
  return inc.desvioPrincipal.origemJanela === "operacional" ? 1 : 0;
}

// Impacto: soma só os impactos em R$ do incidente (principal + efeitos)
// — únicos diretamente comparáveis entre tipos de desvio diferentes.
function impactoTotalReais(inc: IncidenteDesvio): number {
  const todos = [inc.desvioPrincipal, ...inc.efeitos];
  return todos.reduce((s, d) => s + d.impactos.filter((i) => i.unidade === "R$").reduce((s2, i) => s2 + i.valor, 0), 0);
}

function rankPersistencia(inc: IncidenteDesvio): number {
  return inc.desvioPrincipal.percentualPeriodosAfetados ?? 0;
}

export function priorizarIncidentes(incidentes: IncidenteDesvio[]): IncidenteDesvio[] {
  return [...incidentes].sort((a, b) => {
    const severidade = rankSeveridade(b.severidade) - rankSeveridade(a.severidade);
    if (severidade !== 0) return severidade;
    const recencia = rankRecencia(b) - rankRecencia(a);
    if (recencia !== 0) return recencia;
    const impacto = impactoTotalReais(b) - impactoTotalReais(a);
    if (impacto !== 0) return impacto;
    return rankPersistencia(b) - rankPersistencia(a);
  });
}

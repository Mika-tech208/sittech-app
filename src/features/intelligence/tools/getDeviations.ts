// Tool 5/7 — wrapper direto de gerarFilaDesvios (Desvios V1). Já
// deduplicado e priorizado (severidade -> recência -> impacto ->
// persistência) — a tool NUNCA reordena nem cria um score novo. Janela é
// sempre a interna do motor (operacional + estrutural de 28 dias) —
// filtro opcional só recorta o RESULTADO por máquina/produto, nunca
// refaz a detecção com outra janela.

import { toISODate } from "@/lib/date";
import { gerarFilaDesvios } from "@/features/producao-real/desvios";
import { rotuloContexto } from "@/features/producao-real/desvios/contexto";
import { buscarApontamentosEParadas, buscarMaquinas, buscarProdutos, ehErroConsulta } from "@/features/intelligence/dataFetchers";
import { resolverEntidade } from "@/features/intelligence/entities";
import type { IntelligenceTool, IntelligenceToolContext } from "@/features/intelligence/tools/types";
import { erroFalhaConsulta } from "@/features/intelligence/tools/types";
import type { IntelligenceToolResult, IntelligenceEvidence, IntelligenceConfidence } from "@/features/intelligence/types";

const JANELA_ESTRUTURAL_BUSCA_DIAS = 28;

interface Params {
  maquinaNome?: string;
  produtoNome?: string;
}

function confiancaDesvio(c: "calculado" | "estimativa"): IntelligenceConfidence {
  return c === "calculado" ? "CALCULADO" : "ESTIMATIVA";
}

async function handler(ctx: IntelligenceToolContext, params: Params): Promise<IntelligenceToolResult> {
  const { supabase, agora } = ctx;
  const dataInicial = toISODate(new Date(agora.getTime() - JANELA_ESTRUTURAL_BUSCA_DIAS * 24 * 60 * 60 * 1000));

  const [apEParadas, maquinas, produtos] = await Promise.all([
    buscarApontamentosEParadas(supabase, dataInicial, toISODate(agora)),
    buscarMaquinas(supabase),
    buscarProdutos(supabase),
  ]);
  for (const r of [apEParadas, maquinas, produtos]) if (ehErroConsulta(r)) return erroFalhaConsulta("get_deviations", r.erro);
  const { apontamentos, paradas } = apEParadas as Exclude<typeof apEParadas, { erro: string }>;

  let maquinaFiltro: { id: string; nome: string } | undefined;
  if (params.maquinaNome) {
    const lista = (maquinas as Exclude<typeof maquinas, { erro: string }>).map((m) => ({ id: m.id, nome: m.nome }));
    const r = resolverEntidade(params.maquinaNome, lista);
    if (r.status === "nao_encontrado") return { success: false, tool: "get_deviations", code: "entidade_nao_encontrada", message: `Nenhuma máquina corresponde a "${params.maquinaNome}".` };
    if (r.status === "ambiguo") return { success: false, tool: "get_deviations", code: "entidade_ambigua", message: `Mais de uma máquina corresponde a "${params.maquinaNome}".`, candidatos: r.candidatos };
    maquinaFiltro = { id: r.id, nome: r.nome };
  }
  let produtoFiltro: { id: string; nome: string } | undefined;
  if (params.produtoNome) {
    const lista = (produtos as Exclude<typeof produtos, { erro: string }>).map((p) => ({ id: p.id, nome: p.nome }));
    const r = resolverEntidade(params.produtoNome, lista);
    if (r.status === "nao_encontrado") return { success: false, tool: "get_deviations", code: "entidade_nao_encontrada", message: `Nenhum produto corresponde a "${params.produtoNome}".` };
    if (r.status === "ambiguo") return { success: false, tool: "get_deviations", code: "entidade_ambigua", message: `Mais de um produto corresponde a "${params.produtoNome}".`, candidatos: r.candidatos };
    produtoFiltro = { id: r.id, nome: r.nome };
  }

  const { incidentes } = gerarFilaDesvios(apontamentos, paradas, agora);
  const filtrados = incidentes.filter((inc) => {
    if (maquinaFiltro && inc.contexto.maquinaId !== maquinaFiltro.id) return false;
    if (produtoFiltro && inc.contexto.produtoId !== produtoFiltro.id) return false;
    return true;
  });

  const evidences: IntelligenceEvidence[] = filtrados.map((inc) => ({
    id: `desvio-${inc.id}`, domain: "desvios", metric: inc.desvioPrincipal.tipo,
    value: inc.desvioPrincipal.valorAtual, unit: inc.desvioPrincipal.unidade,
    context: { produtoId: inc.contexto.produtoId ?? undefined, produtoNome: inc.contexto.produtoNome ?? undefined, maquinaId: inc.contexto.maquinaId ?? undefined, maquinaNome: inc.contexto.maquinaNome ?? undefined, operacaoId: inc.contexto.operacaoId ?? undefined, operacaoNome: inc.contexto.operacaoNome ?? undefined },
    confidence: confiancaDesvio(inc.desvioPrincipal.confianca),
    source: "gerarFilaDesvios",
    drillDown: inc.desvioPrincipal.linkSugerido === "produtividade" ? "/producao-real/indicadores" : inc.desvioPrincipal.linkSugerido === "paradas" ? "/producao-real/paradas" : "/producao-real/desvios",
  }));

  return {
    success: true, tool: "get_deviations",
    data: { incidentes: filtrados.map((inc) => ({ id: inc.id, titulo: inc.desvioPrincipal.titulo, contexto: rotuloContexto(inc.contexto), severidade: inc.severidade, justificativa: inc.desvioPrincipal.justificativaSeveridade, possiveisFatores: inc.possiveisFatores.map((f) => ({ fator: f.fator, descricao: f.descricao })) })) },
    evidences,
  };
}

export const getDeviationsTool: IntelligenceTool<Params> = {
  name: "get_deviations",
  description: "Principais desvios/atenções já priorizados (severidade > recência > impacto > persistência), comparando a semana atual até agora e os últimos 28 dias contra os períodos anteriores equivalentes. Filtro opcional por máquina ou produto. Nunca afirma causa — só evidência e possíveis fatores associados.",
  parameters: {
    type: "object",
    properties: {
      maquinaNome: { type: "string", description: "Filtrar desvios de uma máquina específica. Opcional." },
      produtoNome: { type: "string", description: "Filtrar desvios de um produto específico. Opcional." },
    },
    additionalProperties: false,
  },
  permissoesRequeridas: ["producao_real_historico"],
  handler,
};

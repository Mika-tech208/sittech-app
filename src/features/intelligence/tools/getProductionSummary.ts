// Tool 3/7 — wrapper direto de calcularResumoIndicadores +
// agrupamentos oficiais (Indicadores V1). Cobre "minha produtividade
// melhorou", "qual operação está abaixo da meta", e (encadeada com outra
// chamada, §7/§20 da análise) perguntas por máquina/produto específico —
// não existe get_machine_analysis/get_product_analysis nesta V1 por
// decisão explícita (§4 da instrução).

import { calcularResumoIndicadores, agruparPorMaquina, agruparPorProduto, agruparPorOperacao } from "@/features/producao-real/indicadores/calculations";
import { buscarApontamentosEParadas, buscarProdutos, buscarMaquinas, ehErroConsulta } from "@/features/intelligence/dataFetchers";
import { resolverJanela, JanelaInvalidaError } from "@/features/intelligence/dates";
import { resolverEntidade } from "@/features/intelligence/entities";
import type { IntelligenceTool, IntelligenceToolContext } from "@/features/intelligence/tools/types";
import { erroFalhaConsulta, erroParametroInvalido } from "@/features/intelligence/tools/types";
import type { IntelligenceToolResult, IntelligenceEvidence, JanelaChave } from "@/features/intelligence/types";
import { JANELAS_VALIDAS } from "@/features/intelligence/dates";

interface Params {
  janela: JanelaChave;
  dataInicialCustom?: string;
  dataFinalCustom?: string;
  maquinaNome?: string;
  produtoNome?: string;
  agruparPor?: "maquina" | "produto" | "operacao";
}

async function handler(ctx: IntelligenceToolContext, params: Params): Promise<IntelligenceToolResult> {
  const { supabase, agora } = ctx;
  let janelaResolvida;
  try {
    janelaResolvida = resolverJanela({ janela: params.janela, dataInicialCustom: params.dataInicialCustom, dataFinalCustom: params.dataFinalCustom }, agora);
  } catch (e) {
    if (e instanceof JanelaInvalidaError) return erroParametroInvalido("get_production_summary", e.message);
    throw e;
  }

  const [apEParadas, produtos, maquinas] = await Promise.all([
    buscarApontamentosEParadas(supabase, janelaResolvida.dataInicial, janelaResolvida.dataFinal),
    buscarProdutos(supabase),
    buscarMaquinas(supabase),
  ]);
  for (const r of [apEParadas, produtos, maquinas]) if (ehErroConsulta(r)) return erroFalhaConsulta("get_production_summary", r.erro);
  let { apontamentos, paradas } = apEParadas as Exclude<typeof apEParadas, { erro: string }>;

  let contextoMaquina: { maquinaId: string; maquinaNome: string } | undefined;
  if (params.maquinaNome) {
    const lista = (maquinas as Exclude<typeof maquinas, { erro: string }>).map((m) => ({ id: m.id, nome: m.nome }));
    const r = resolverEntidade(params.maquinaNome, lista);
    if (r.status === "nao_encontrado") return { success: false, tool: "get_production_summary", code: "entidade_nao_encontrada", message: `Nenhuma máquina corresponde a "${params.maquinaNome}".` };
    if (r.status === "ambiguo") return { success: false, tool: "get_production_summary", code: "entidade_ambigua", message: `Mais de uma máquina corresponde a "${params.maquinaNome}".`, candidatos: r.candidatos };
    apontamentos = apontamentos.filter((a) => a.maquinaId === r.id);
    paradas = paradas.filter((p) => p.maquinaId === r.id);
    contextoMaquina = { maquinaId: r.id, maquinaNome: r.nome };
  }

  let contextoProduto: { produtoId: string; produtoNome: string } | undefined;
  if (params.produtoNome) {
    const lista = (produtos as Exclude<typeof produtos, { erro: string }>).map((p) => ({ id: p.id, nome: p.nome }));
    const r = resolverEntidade(params.produtoNome, lista);
    if (r.status === "nao_encontrado") return { success: false, tool: "get_production_summary", code: "entidade_nao_encontrada", message: `Nenhum produto corresponde a "${params.produtoNome}".` };
    if (r.status === "ambiguo") return { success: false, tool: "get_production_summary", code: "entidade_ambigua", message: `Mais de um produto corresponde a "${params.produtoNome}".`, candidatos: r.candidatos };
    apontamentos = apontamentos.filter((a) => a.produtoId === r.id);
    paradas = paradas.filter((p) => p.produtoId === r.id);
    contextoProduto = { produtoId: r.id, produtoNome: r.nome };
  }

  if (apontamentos.length === 0) {
    return { success: false, tool: "get_production_summary", code: "sem_dados", message: "Não há dados no período." };
  }

  const resumo = calcularResumoIndicadores(apontamentos, paradas);
  let agrupamento: unknown = undefined;
  if (params.agruparPor === "maquina") agrupamento = agruparPorMaquina(apontamentos, paradas).map((g) => ({ rotulo: g.rotulo, resumo: g.resumo }));
  if (params.agruparPor === "produto") agrupamento = agruparPorProduto(apontamentos, paradas).map((g) => ({ rotulo: g.rotulo, resumo: g.resumo }));
  if (params.agruparPor === "operacao") agrupamento = agruparPorOperacao(apontamentos, paradas).map((g) => ({ rotulo: g.rotulo, resumo: g.resumo }));

  const contexto = { ...contextoMaquina, ...contextoProduto };
  const evidences: IntelligenceEvidence[] = [
    { id: "prod-performance", domain: "producao", metric: "performance_pct", value: resumo.performancePct ?? undefined, unit: "%", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "CALCULADO", source: "calcularResumoIndicadores", drillDown: "/producao-real/indicadores" },
    { id: "prod-disponibilidade", domain: "producao", metric: "disponibilidade_pct", value: resumo.disponibilidadePct ?? undefined, unit: "%", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "CALCULADO", source: "calcularResumoIndicadores" },
    { id: "prod-qualidade", domain: "producao", metric: "qualidade_pct", value: resumo.qualidadePct ?? undefined, unit: "%", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "CALCULADO", source: "calcularResumoIndicadores" },
    { id: "prod-oee", domain: "producao", metric: "oee_pct", value: resumo.oeePct ?? undefined, unit: "%", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, confidence: "CALCULADO", source: "calcularResumoIndicadores" },
  ];

  return { success: true, tool: "get_production_summary", period: { start: janelaResolvida.dataInicial, end: janelaResolvida.dataFinal, label: janelaResolvida.rotulo }, context: contexto, data: { resumo, agrupamento }, evidences };
}

export const getProductionSummaryTool: IntelligenceTool<Params> = {
  name: "get_production_summary",
  description: "KPIs de produção (Performance, Disponibilidade, Qualidade, OEE, produção acabada/processada) para uma janela e filtro opcional de máquina/produto. Use para comparar janelas ('minha produtividade melhorou'), analisar uma máquina/produto específico, ou agrupar por máquina/produto/operação.",
  parameters: {
    type: "object",
    properties: {
      janela: { type: "string", enum: JANELAS_VALIDAS, description: "Janela semântica — nunca calcule datas você mesmo." },
      dataInicialCustom: { type: "string", description: "Só quando janela=custom, formato AAAA-MM-DD." },
      dataFinalCustom: { type: "string", description: "Só quando janela=custom, formato AAAA-MM-DD." },
      maquinaNome: { type: "string", description: "Nome (ou parte) de uma máquina, ex.: 'Embalagem 17'. Opcional." },
      produtoNome: { type: "string", description: "Nome (ou parte) de um produto, ex.: 'Luva 3/4'. Opcional." },
      agruparPor: { type: "string", enum: ["maquina", "produto", "operacao"], description: "Opcional — devolve o resumo já quebrado por máquina/produto/operação." },
    },
    required: ["janela"],
    additionalProperties: false,
  },
  permissoesRequeridas: ["producao_real_historico"],
  handler,
};

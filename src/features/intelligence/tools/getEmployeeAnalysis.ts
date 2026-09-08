// Tool 6/7 — wrapper direto de gerarAnaliseFuncionarios (Funcionários V1).
// Regra dura (§11/§16 da análise aprovada, reforçada pela implementação):
// SEM funcionarioNome, devolve só a CONTAGEM neutra de sinais de atenção
// (nunca uma lista pronta pra virar ranking na resposta do LLM — o
// orquestrador/system prompt reforça isso). COM funcionarioNome, exige
// contexto (produto+operação+máquina) igual ao já registrado — nunca
// compara fora do contexto que gerou o sinal.

import { toISODate } from "@/lib/date";
import { gerarAnaliseFuncionarios } from "@/features/producao-real/funcionarios";
import { buscarApontamentosEParadas, ehErroConsulta } from "@/features/intelligence/dataFetchers";
import { resolverEntidade, type CandidatoEntidade } from "@/features/intelligence/entities";
import type { IntelligenceTool, IntelligenceToolContext } from "@/features/intelligence/tools/types";
import { erroFalhaConsulta } from "@/features/intelligence/tools/types";
import type { IntelligenceToolResult, IntelligenceEvidence } from "@/features/intelligence/types";

const JANELA_BUSCA_DIAS = 28; // mesma janela estrutural que Funcionários V1 reaproveita de Desvios V1.

interface Params {
  funcionarioNome?: string;
  maquinaNome?: string;
  produtoNome?: string;
  operacaoNome?: string;
}

async function handler(ctx: IntelligenceToolContext, params: Params): Promise<IntelligenceToolResult> {
  const { supabase, agora } = ctx;
  const dataInicial = toISODate(new Date(agora.getTime() - JANELA_BUSCA_DIAS * 24 * 60 * 60 * 1000));

  const apEParadas = await buscarApontamentosEParadas(supabase, dataInicial, toISODate(agora));
  if (ehErroConsulta(apEParadas)) return erroFalhaConsulta("get_employee_analysis", apEParadas.erro);
  const { apontamentos, paradas } = apEParadas;

  const resultado = gerarAnaliseFuncionarios(apontamentos, paradas, agora);

  // SEM funcionário: só a contagem + lista de sinais já contextualizados —
  // nunca ordenados como ranking (mantém a ordem de detecção do motor).
  if (!params.funcionarioNome) {
    const evidences: IntelligenceEvidence[] = resultado.atencao.map((s) => ({
      id: s.id, domain: "funcionarios", metric: s.metrica, value: s.valorFuncionario, unit: "%",
      context: { funcionarioId: s.funcionarioId, funcionarioNome: s.funcionarioNome, produtoId: s.contexto.produtoId, produtoNome: s.contexto.produtoNome, operacaoId: s.contexto.operacaoId, operacaoNome: s.contexto.operacaoNome, maquinaId: s.contexto.maquinaId, maquinaNome: s.contexto.maquinaNome },
      confidence: "CALCULADO", source: "gerarAnaliseFuncionarios", drillDown: "/producao-real/funcionarios",
    }));
    return { success: true, tool: "get_employee_analysis", data: { modo: "contagem_neutra", quantidadeContextosEmAtencao: resultado.atencao.length, sinais: evidences.length > 0 ? "ver evidences" : "nenhum" }, evidences };
  }

  const candidatos: CandidatoEntidade[] = Array.from(new Map(resultado.analises.map((a) => [a.funcionarioId, { id: a.funcionarioId, nome: a.funcionarioNome }])).values());
  const r = resolverEntidade(params.funcionarioNome, candidatos);
  if (r.status === "nao_encontrado") return { success: false, tool: "get_employee_analysis", code: "entidade_nao_encontrada", message: `Nenhum funcionário corresponde a "${params.funcionarioNome}".` };
  if (r.status === "ambiguo") return { success: false, tool: "get_employee_analysis", code: "entidade_ambigua", message: `Mais de um funcionário corresponde a "${params.funcionarioNome}".`, candidatos: r.candidatos };

  let analisesDoFuncionario = resultado.analises.filter((a) => a.funcionarioId === r.id);
  if (params.maquinaNome || params.produtoNome || params.operacaoNome) {
    // Contexto pedido explicitamente — resolve cada parte contra os
    // contextos REAIS já existentes desse funcionário (nunca aceita um
    // nome que não corresponda a nenhum contexto registrado).
    if (params.maquinaNome) {
      const lista: CandidatoEntidade[] = Array.from(new Map(analisesDoFuncionario.map((a) => [a.contexto.maquinaId, { id: a.contexto.maquinaId, nome: a.contexto.maquinaNome }])).values());
      const rm = resolverEntidade(params.maquinaNome, lista);
      if (rm.status !== "resolvido") analisesDoFuncionario = [];
      else analisesDoFuncionario = analisesDoFuncionario.filter((a) => a.contexto.maquinaId === rm.id);
    }
    if (params.produtoNome) {
      const lista: CandidatoEntidade[] = Array.from(new Map(analisesDoFuncionario.map((a) => [a.contexto.produtoId, { id: a.contexto.produtoId, nome: a.contexto.produtoNome }])).values());
      const rp = resolverEntidade(params.produtoNome, lista);
      if (rp.status !== "resolvido") analisesDoFuncionario = [];
      else analisesDoFuncionario = analisesDoFuncionario.filter((a) => a.contexto.produtoId === rp.id);
    }
    if (params.operacaoNome) {
      const lista: CandidatoEntidade[] = Array.from(new Map(analisesDoFuncionario.map((a) => [a.contexto.operacaoId, { id: a.contexto.operacaoId, nome: a.contexto.operacaoNome }])).values());
      const ro = resolverEntidade(params.operacaoNome, lista);
      if (ro.status !== "resolvido") analisesDoFuncionario = [];
      else analisesDoFuncionario = analisesDoFuncionario.filter((a) => a.contexto.operacaoId === ro.id);
    }
  }

  if (analisesDoFuncionario.length === 0) {
    return { success: false, tool: "get_employee_analysis", code: "sem_dados", message: "Nenhum contexto (produto+operação+máquina) encontrado para esse funcionário no período/filtro pedido." };
  }

  const evidences: IntelligenceEvidence[] = analisesDoFuncionario.flatMap((a) => {
    const ctx = { funcionarioId: a.funcionarioId, funcionarioNome: a.funcionarioNome, produtoId: a.contexto.produtoId, produtoNome: a.contexto.produtoNome, operacaoId: a.contexto.operacaoId, operacaoNome: a.contexto.operacaoNome, maquinaId: a.contexto.maquinaId, maquinaNome: a.contexto.maquinaNome };
    const evs: IntelligenceEvidence[] = [];
    if (a.performanceFuncionario !== null) evs.push({ id: `${a.funcionarioId}-perf-${a.contexto.maquinaId}`, domain: "funcionarios", metric: "performance_pct", value: a.performanceFuncionario, unit: "%", context: ctx, confidence: "CALCULADO", source: "gerarAnaliseFuncionarios", drillDown: "/producao-real/funcionarios" });
    if (a.performancePares !== null) evs.push({ id: `${a.funcionarioId}-perf-pares-${a.contexto.maquinaId}`, domain: "funcionarios", metric: "performance_pares_pct", value: a.performancePares, unit: "%", context: ctx, confidence: "CALCULADO", source: "gerarAnaliseFuncionarios (baseline pares, exclui o próprio)" });
    return evs;
  });

  return { success: true, tool: "get_employee_analysis", data: { modo: "contexto_especifico", analises: analisesDoFuncionario }, evidences };
}

export const getEmployeeAnalysisTool: IntelligenceTool<Params> = {
  name: "get_employee_analysis",
  description: "Sinais de funcionário sempre contextualizados por produto+operação+máquina+janela. Sem funcionarioNome, devolve só uma contagem neutra de contextos em atenção (NUNCA ranking, NUNCA melhor/pior funcionário). Com funcionarioNome (e opcionalmente maquinaNome/produtoNome/operacaoNome), devolve o sinal daquele contexto específico, comparado contra a média dos pares no MESMO contexto (nunca o próprio funcionário incluído na baseline).",
  parameters: {
    type: "object",
    properties: {
      funcionarioNome: { type: "string", description: "Nome do funcionário. Omitir para ver só a contagem neutra de contextos em atenção." },
      maquinaNome: { type: "string" },
      produtoNome: { type: "string" },
      operacaoNome: { type: "string" },
    },
    additionalProperties: false,
  },
  permissoesRequeridas: ["producao_real_historico"],
  handler,
};

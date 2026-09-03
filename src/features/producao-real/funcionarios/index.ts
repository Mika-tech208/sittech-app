// Funcionários V1 — orquestrador. Reaproveita literalmente a janela
// operacional já aprovada em Desvios V1 (semana atual até agora vs.
// mesmo trecho da semana anterior) — nenhuma lógica de data nova.

import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import { calcularJanelaOperacional, alinharPeriodosDoUltimoDia } from "@/features/producao-real/desvios/janelas";
import { agruparPorContextoEFuncionario } from "@/features/producao-real/funcionarios/contexto";
import { analisarContextoFuncionario } from "@/features/producao-real/funcionarios/analise";
import { calcularCoberturaOperacional } from "@/features/producao-real/funcionarios/cobertura";
import type { AnaliseFuncionarioContexto, Janela, ResultadoAnaliseFuncionarios } from "@/features/producao-real/funcionarios/types";

export * from "@/features/producao-real/funcionarios/types";
export * from "@/features/producao-real/funcionarios/contexto";

function filtrarPorJanela<T extends { data: string }>(itens: T[], janela: Janela): T[] {
  return itens.filter((i) => i.data >= janela.dataInicial && i.data <= janela.dataFinal);
}

export function gerarAnaliseFuncionarios(
  apontamentos: ApontamentoIndicador[], paradas: ParadaComContexto[], hoje: Date = new Date()
): ResultadoAnaliseFuncionarios {
  const janelas = calcularJanelaOperacional(hoje);

  const apAtualBruto = filtrarPorJanela(apontamentos, janelas.atual);
  const apAnteriorBruto = filtrarPorJanela(apontamentos, janelas.referencia);
  const apAnterior = alinharPeriodosDoUltimoDia(apAtualBruto, apAnteriorBruto, janelas.atual.dataFinal, janelas.referencia.dataFinal);
  // Evidência de paradas é só da janela atual (§11) — janela anterior não
  // precisa desse recorte fino (evolução só usa minutos agregados).
  const paradasAtual = filtrarPorJanela(paradas, janelas.atual);

  const gruposAtual = agruparPorContextoEFuncionario(apAtualBruto);

  // Lookup de apontamentos do MESMO funcionário+contexto na janela anterior, pra evolução (§13).
  const gruposAnteriorPorChave = new Map(
    agruparPorContextoEFuncionario(apAnterior).map((g) => [g.chave, g.apontamentosFuncionario])
  );

  const analises: AnaliseFuncionarioContexto[] = gruposAtual.map((grupo) => {
    const paradasFuncionario = paradasAtual.filter(
      (p) => p.funcionarioId === grupo.funcionarioId && p.produtoId === grupo.contexto.produtoId &&
        p.operacaoId === grupo.contexto.operacaoId && p.maquinaId === grupo.contexto.maquinaId
    );
    const apontamentosFuncionarioAnterior = gruposAnteriorPorChave.get(grupo.chave) || [];
    return analisarContextoFuncionario(grupo, paradasFuncionario, janelas.atual, apontamentosFuncionarioAnterior, janelas.referencia);
  });

  const atencao = analises.flatMap((a) => [a.sinalPerformance, a.sinalQualidade]).filter((s): s is NonNullable<typeof s> => s !== null && s.polaridade === "atencao");
  const destaques = analises.flatMap((a) => [a.sinalPerformance, a.sinalQualidade]).filter((s): s is NonNullable<typeof s> => s !== null && s.polaridade === "positivo");

  const coberturaPorFuncionario = new Map<string, { funcionarioNome: string; cobertura: ReturnType<typeof calcularCoberturaOperacional> }>();
  const apAtualPorFuncionario = new Map<string, ApontamentoIndicador[]>();
  apAtualBruto.forEach((ap) => {
    if (!ap.funcionarioId) return;
    const atual = apAtualPorFuncionario.get(ap.funcionarioId);
    if (atual) atual.push(ap);
    else apAtualPorFuncionario.set(ap.funcionarioId, [ap]);
  });
  apAtualPorFuncionario.forEach((aps, funcionarioId) => {
    coberturaPorFuncionario.set(funcionarioId, { funcionarioNome: aps[0].funcionarioNome || "", cobertura: calcularCoberturaOperacional(aps) });
  });

  return { analises, atencao, destaques, coberturaPorFuncionario };
}

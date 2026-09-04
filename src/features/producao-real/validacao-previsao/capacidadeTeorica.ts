// Validação da Previsão V1 — capacidade teórica restante (§6, aprovado).
// NÃO duplica a lógica de roteiro/compartilhamento/fator global/máquina
// limitante — reaproveita `calcularCapacidadeMaximaSemana` (Previsão/
// Capacidade, já existente) tal como está. A única adaptação: (1) o
// escalar de horas passa a ser "horas restantes a partir de agora" em vez
// de "horas da semana inteira" (mesmo parâmetro, valor diferente); (2)
// máquinas marcadas indisponíveis são excluídas da SELEÇÃO de entrada
// (pré-processamento fora da função reaproveitada — nunca dentro dela),
// com uma checagem posterior pra tratar corretamente o caso em que TODAS
// as máquinas de uma etapa ficaram indisponíveis (a função reaproveitada
// silenciosamente ignora etapa sem seleção nenhuma — aqui isso precisa
// virar capacidade zero pro item, não "sem restrição").

import type { Produto, Maquina, PeriodoComDuracao, PrevisaoItem } from "@/types/domain";
import { calcularCapacidadeMaximaSemana } from "@/features/capacidade/calculations";
import type { CapacidadeMaximaSemana } from "@/features/capacidade/types";

function filtrarMaquinasIndisponiveis(
  maquinasPorEtapa: Record<string, string[]> | undefined,
  maquinasIndisponiveis: string[]
): Record<string, string[]> {
  const resultado: Record<string, string[]> = {};
  Object.entries(maquinasPorEtapa || {}).forEach(([etapaId, ids]) => {
    resultado[etapaId] = (ids || []).filter((id) => !maquinasIndisponiveis.includes(id));
  });
  return resultado;
}

export function calcularCapacidadeTeoricaRestante(
  itensComFalta: PrevisaoItem[],
  produtos: Produto[],
  maquinas: Maquina[],
  periodosComDuracao: PeriodoComDuracao[],
  horasRestantes: number,
  maquinasIndisponiveis: string[]
): CapacidadeMaximaSemana {
  const itensFiltrados = itensComFalta.map((it) => ({
    ...it,
    maquinasPorEtapa: filtrarMaquinasIndisponiveis(it.maquinasPorEtapa, maquinasIndisponiveis),
  }));

  const resultado = calcularCapacidadeMaximaSemana(itensFiltrados, produtos, maquinas, periodosComDuracao, horasRestantes);

  // Correção do caso "todas as máquinas selecionadas de uma etapa estão
  // indisponíveis" — a função reaproveitada trata etapa sem seleção como
  // "sem restrição" (idsSelecionadas.length === 0 -> return, sem afetar
  // fatorItem). Isso está certo quando é dado incompleto (etapa nunca
  // configurada), mas errado quando a causa é indisponibilidade real —
  // aqui o item fica travado em 0, não "sem restrição".
  const resultadosPorItem = resultado.resultadosPorItem.map((r) => {
    const item = itensComFalta.find((it) => it.id === r.itemId);
    const produto = item ? produtos.find((p) => p.id === item.produtoId) : undefined;
    if (!item || !produto) return r;

    const etapaTravada = (produto.roteiro || []).find((etapa) => {
      const selecaoOriginal = (item.maquinasPorEtapa || {})[etapa.id] || [];
      if (selecaoOriginal.length === 0) return false; // dado incompleto, não é indisponibilidade
      return selecaoOriginal.every((id) => maquinasIndisponiveis.includes(id));
    });
    if (!etapaTravada) return r;
    return { ...r, maximoPossivel: 0, etapaLimitante: etapaTravada.operacao };
  });

  const maximoTotalReais = resultadosPorItem.reduce((s, r) => s + r.maximoPossivel * r.valorUnitario, 0);
  return { ...resultado, resultadosPorItem, maximoTotalReais };
}

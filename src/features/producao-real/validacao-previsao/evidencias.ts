// Validação da Previsão V1 — evidências (§15/§16/§17, aprovado). Nunca
// entram no número de capacidade — só contexto. Reaproveita
// detectarPossivelRestricaoOperacional (Motor Econômico V1) e
// calcularRecorrenciaParadas (Paradas V1) sem recalcular nada.

import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import { detectarPossivelRestricaoOperacional } from "@/features/producao-real/indicadores/economico";
import { calcularRecorrenciaParadas, type ParadaComContexto } from "@/features/producao-real/paradas/calculations";
import type { Evidencia, EvidenciaProdutoForaDaPrevisao, EvidenciaSemProducao, MotivoSemProducao } from "@/features/producao-real/validacao-previsao/types";

// §15, aprovado: produto fora da previsão é SOMENTE evidência — nunca
// desconta da capacidade futura (o tempo já foi consumido no PASSADO,
// penalizar de novo seria dupla penalização). Nunca vira item "previsto".
export function calcularProdutosForaDaPrevisao(apontamentosSemanaAtual: ApontamentoIndicador[], produtosIdsPrevistos: Set<string>): EvidenciaProdutoForaDaPrevisao[] {
  const porChave = new Map<string, EvidenciaProdutoForaDaPrevisao & { periodosSet: Set<string> }>();
  apontamentosSemanaAtual
    .filter((ap) => ap.status === "produzindo" && ap.produtoId !== null && !produtosIdsPrevistos.has(ap.produtoId))
    .forEach((ap) => {
      const chave = `${ap.produtoId}::${ap.maquinaId}`;
      const atual = porChave.get(chave);
      const minutos = ap.duracaoPeriodoHorasVigente * 60;
      if (atual) {
        atual.minutosObservados += minutos;
        atual.quantidadeObservada += ap.quantidadeProduzida;
        atual.periodosSet.add(`${ap.data}|${ap.periodoId}`);
      } else {
        porChave.set(chave, {
          produtoId: ap.produtoId as string, produtoNome: ap.produtoNome || "",
          maquinaId: ap.maquinaId, maquinaNome: ap.maquinaNome,
          minutosObservados: minutos, quantidadeObservada: ap.quantidadeProduzida,
          periodos: 0, periodosSet: new Set([`${ap.data}|${ap.periodoId}`]),
        });
      }
    });
  return Array.from(porChave.values()).map(({ periodosSet, ...resto }) => ({ ...resto, periodos: periodosSet.size }));
}

const LABEL_MOTIVO: Record<string, string> = {
  sem_programacao: "Sem programação", falta_material: "Falta de material",
  falta_operador: "Falta de operador", manutencao_programada: "Manutenção programada", outro: "Outro",
};

// §16, aprovado: nunca entra numericamente na capacidade provável — só
// contagem (mesma disciplina de Paradas V1: nunca inventa minutos aqui,
// sem_producao não tem duração/custo/capacidade calculável por design).
export function calcularEvidenciasSemProducao(apontamentosSemanaAtual: ApontamentoIndicador[]): EvidenciaSemProducao[] {
  const porChave = new Map<string, EvidenciaSemProducao>();
  apontamentosSemanaAtual
    .filter((ap) => ap.status === "sem_producao")
    .forEach((ap) => {
      const motivo = (ap.motivoSemProducao || "outro") as MotivoSemProducao;
      const chave = `${motivo}::${ap.maquinaId}`;
      const atual = porChave.get(chave);
      if (atual) atual.quantidadeRegistros += 1;
      else porChave.set(chave, { motivo, maquinaNome: ap.maquinaNome, quantidadeRegistros: 1 });
    });
  void LABEL_MOTIVO; // rótulo aplicado na UI, não aqui — mantém este módulo só com fatos.
  return Array.from(porChave.values());
}

// §17, aprovado — RESTRIÇÃO OBSERVADA (nunca "gargalo confirmado").
// Reaproveita os dois motores já existentes, sem recalcular fórmula.
export function calcularRestricoesObservadas(
  produtoId: string, produtoNome: string,
  apontamentos14dias: ApontamentoIndicador[], paradas14dias: ParadaComContexto[]
): Evidencia[] {
  const evidencias: Evidencia[] = [];

  const apontamentosDoProduto = apontamentos14dias.filter((ap) => ap.produtoId === produtoId);
  const restricao = detectarPossivelRestricaoOperacional(apontamentosDoProduto, apontamentos14dias);
  if (restricao && restricao.etapaSinalizada) {
    evidencias.push({
      fonte: "detectarPossivelRestricaoOperacional (Motor Econômico V1)",
      descricao: `${restricao.observacao} — possível restrição operacional, nunca gargalo confirmado.`,
      contexto: `${produtoNome} — ${restricao.etapaSinalizada.operacaoNome}`,
      periodo: "últimos 14 dias",
      valor: `${restricao.etapaSinalizada.sinais} sinal(is) de 3 possíveis`,
    });
  }

  const paradasDoProduto = paradas14dias.filter((p) => p.produtoId === produtoId);
  const recorrencias = calcularRecorrenciaParadas(paradasDoProduto, apontamentosDoProduto);
  recorrencias
    .filter((r) => r.percentualPeriodosAfetados !== null && r.percentualPeriodosAfetados >= 40)
    .forEach((r) => {
      evidencias.push({
        fonte: "Recorrência de motivo (Paradas V1)",
        descricao: `Motivo "${r.motivoNome}" coincidiu com ${r.periodosDistintosAfetados} de ${r.totalPeriodosApontadosMaquina} períodos apontados de ${r.maquinaNome} — vale investigar.`,
        contexto: `${produtoNome} — ${r.maquinaNome}`,
        periodo: "últimos 14 dias",
        valor: `${(r.percentualPeriodosAfetados ?? 0).toFixed(0)}% dos períodos`,
      });
    });

  return evidencias;
}

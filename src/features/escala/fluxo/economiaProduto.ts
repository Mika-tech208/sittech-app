// LUCRO/HORA exatamente como a tela PRODUTOS (REFERÊNCIA do motor): reaproveita `calcularMargemProduto` (src/features/custo-hora/calculations.ts, fonte única da tela, Previsão e Capacidade):
//   margemRS = valor − Σ_etapas( tempo/peça × custo/hora da operação ) ;  lucroHora = margemRS / Σ tempo/peça ;  tempo/peça da etapa = Σ horas / Σ metas dos períodos com meta.
// As metas são as do POOL (que o Escala lê de roteiro_etapas.meta_m1..t3 — a MESMA coluna da tela; não há tabela paralela de produtividade). Sem custo/hora por operação a tela usa o
// custo/hora da empresa para todas as etapas ⇒ lucro/h = receita/h − k (k constante). ATENÇÃO: esse "custo" é folha + rateio de fixos (não é custo variável): vale como CONVENÇÃO DO USUÁRIO
// (a tela é a referência), com rótulo próprio; será trocado pelo módulo canônico `economiaProduto` quando o agente de dados o publicar (feat/escala-economia-dados).
import { calcularMargemProduto } from "../../custo-hora/calculations";
import type { EntradaEscala } from "../types";
import type { LucroHoraProduto, LucroHoraProvider } from "./tipos";

export const CUSTO_HORA_EMPRESA_TELA = 31.92; // R$/h (tela Custo por Hora em 28/10/2026); provisório até o módulo canônico

export function lucroHoraDaTela(entrada: EntradaEscala, o: { custoHoraEmpresa?: number; custoHoraPorOperacao?: Record<string, number> } = {}): LucroHoraProvider {
  const k = o.custoHoraEmpresa ?? CUSTO_HORA_EMPRESA_TELA;
  const periodos = [...new Map(entrada.slots.map((s) => [s.periodoId, { id: s.periodoId, nome: s.periodoId, inicio: "", fim: "", duracaoHoras: (s.fimMin - s.inicioMin) / 60 }])).values()];
  const porProduto = new Map<string, EntradaEscala["pools"]>();
  entrada.pools.forEach((p) => (porProduto.get(p.produtoId) ?? porProduto.set(p.produtoId, []).get(p.produtoId)!).push(p));
  return (produtoId) => {
    const pools = porProduto.get(produtoId);
    if (!pools || pools.length === 0) return null;
    const ord = [...pools].sort((a, b) => a.ordemEtapa - b.ordemEtapa);
    const final = ord[ord.length - 1];
    const roteiro = ord.map((p) => ({ id: p.etapaId, operacao: p.operacaoId, metas: p.metas, maquinasIds: p.maquinasIds }));
    const m = calcularMargemProduto({ roteiro, valorUnitario: final.valorUnitario } as never, o.custoHoraPorOperacao ?? {}, k, periodos as never);
    const rec = m.tempoTotalHoras > 0 ? final.valorUnitario / m.tempoTotalHoras : 0;
    return {
      produtoId, preco: final.valorUnitario, custoUnitario: m.custo, margemUnitaria: m.margemRS, margemPct: m.margemPct, tempoTotalHoras: m.tempoTotalHoras, lucroHora: m.lucroHora, receitaHora: rec,
      fonte: "tela Produtos (calcularMargemProduto; custo/hora da empresa para todas as etapas)", confiavel: m.tempoTotalHoras > 0,
    } satisfies LucroHoraProduto;
  };
}

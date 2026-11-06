// ANÁLISE de capacidade/horas da Previsão para o produto único (PURO). calcularAnaliseCapacidadeSemanal/calcularHorasPorMaquina aplicam `quantidade` do item a TODAS as etapas do roteiro:
// para o canônico isso exigiria que as 93.300 peças passassem pela M8 E por Rosquear/Parafusar (carga dobrada). Solução sem tocar nessas funções: desdobrar o item canônico em um item
// VIRTUAL por rota (roteiro linear da rota, quantidade da rota, só as máquinas da rota); as máquinas do trecho comum somam as horas das duas rotas (= demanda total, uma vez).
// A divisão é uma ESTIMATIVA para a análise (proporcional à capacidade de cada rota) — o plano da Escala escolhe o mix real; a tela deve rotular como estimativa.
import type { PeriodoComDuracao, PrevisaoItem, Produto } from "@/types/domain";
import { capacidadeProdutoUnico } from "./capacidadeRotas";
import { roteiroDaRota } from "./margemRotas";
import type { ModeloCanonico } from "./tipos";

/** Reparte `total` proporcionalmente aos pesos (capacidade por rota); soma exata; sem capacidade em nenhuma rota => tudo na primeira (sobrecarga visível, nunca sumir demanda). */
export function dividirDemandaPorCapacidade(total: number, pesos: number[]): number[] {
  if (pesos.length === 0) return [];
  const soma = pesos.reduce((s, p) => s + Math.max(0, p), 0);
  if (soma <= 0) return pesos.map((_, i) => (i === 0 ? total : 0));
  const base = pesos.map((p) => Math.floor((total * Math.max(0, p)) / soma));
  let resto = total - base.reduce((s, v) => s + v, 0);
  const ordem = pesos.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of ordem) { if (resto <= 0) break; if (pesos[i] > 0) { base[i] += 1; resto -= 1; } }
  return base;
}

export interface ItensParaAnalise {
  itens: PrevisaoItem[];
  produtos: Produto[];
  /** itemId do canônico -> divisão estimada por rota */
  divisao: Record<string, { rotaId: string; rotulo: string; quantidade: number }[]>;
}

export function itensParaAnalise(
  itens: PrevisaoItem[], produtos: Produto[], modelos: ModeloCanonico[], periodosComDuracao: PeriodoComDuracao[], horasPorMaquinaSemana: number,
): ItensParaAnalise {
  if (modelos.length === 0 || !itens.some((i) => modelos.some((m) => m.produtoCanonicoId === i.produtoId))) return { itens, produtos, divisao: {} };
  const outrosProdutos = produtos.filter((p) => !modelos.some((m) => m.produtoCanonicoId === p.id));
  const virtuais: Produto[] = [];
  const divisao: ItensParaAnalise["divisao"] = {};
  const saida: PrevisaoItem[] = [];
  itens.forEach((it) => {
    const modelo = modelos.find((m) => m.produtoCanonicoId === it.produtoId);
    const produto = produtos.find((p) => p.id === it.produtoId);
    if (!modelo || !produto) { saida.push(it); return; }
    const cap = capacidadeProdutoUnico(produto, it.maquinasPorEtapa, modelo, periodosComDuracao, horasPorMaquinaSemana);
    const qtds = dividirDemandaPorCapacidade(it.quantidade, cap.porRota.map((r) => r.maxPecas));
    divisao[it.id] = cap.porRota.map((r, i) => ({ rotaId: r.rota.id, rotulo: r.rota.nome, quantidade: qtds[i] }));
    cap.porRota.forEach((r, i) => {
      if (qtds[i] <= 0) return;
      const roteiro = roteiroDaRota(produto, modelo, r.rota.id);
      const vid = `${produto.id}#${r.rota.codigo}`;
      if (!virtuais.some((v) => v.id === vid)) virtuais.push({ ...produto, id: vid, nome: `${produto.nome} — ${r.rota.nome}`, roteiro });
      const ids = new Set(roteiro.map((e) => e.id));
      const maquinasPorEtapa = Object.fromEntries(Object.entries(it.maquinasPorEtapa || {}).filter(([etapaId]) => ids.has(etapaId)));
      saida.push({ ...it, id: `${it.id}#${r.rota.codigo}`, produtoId: vid, produtoNome: `${it.produtoNome} — ${r.rota.nome}`, quantidade: qtds[i], maquinasPorEtapa });
    });
  });
  return { itens: saida, produtos: [...outrosProdutos, ...virtuais], divisao };
}

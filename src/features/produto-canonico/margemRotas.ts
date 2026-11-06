// Custo/margem POR ROTA do produto canônico (PURO). Reusa a fórmula única de custo (calcularMargemProduto): cada rota é um "roteiro" linear = etapas exclusivas da rota (na ordem do grafo)
// + trecho comum até a etapa FINAL. Um único valor de venda; o custo difere por rota (item 20 do pedido). O motor usa a margem de rota para escolher o mix — aqui só a leitura.
import { calcularMargemProduto, type MargemProduto } from "@/features/custo-hora/calculations";
import type { PeriodoComDuracao, Produto, RoteiroEtapa } from "@/types/domain";
import type { ModeloCanonico, RotaCanonica } from "./tipos";

/** Distância (nº de arestas) de cada etapa até a FINAL; maior = mais a montante. */
function distanciaAteFinal(m: ModeloCanonico): Map<string, number> {
  const final = m.etapas.find((e) => e.papel === "FINAL")?.etapaId;
  const d = new Map<string, number>();
  if (!final) return d;
  d.set(final, 0);
  for (let i = 0; i <= m.etapas.length; i++) {
    m.arestas.forEach((a) => {
      const dd = d.get(a.destinoEtapaId);
      if (dd !== undefined && (d.get(a.origemEtapaId) ?? -1) < dd + 1) d.set(a.origemEtapaId, dd + 1);
    });
  }
  return d;
}

/** Roteiro linear de UMA rota: exclusivas da rota + comuns/final, do começo ao produto final. */
export function roteiroDaRota(produto: Pick<Produto, "roteiro">, modelo: ModeloCanonico, rotaId: string): RoteiroEtapa[] {
  const ids = new Set(modelo.etapas.filter((e) => e.rotaId === rotaId || e.rotaId === null).map((e) => e.etapaId));
  const dist = distanciaAteFinal(modelo);
  return produto.roteiro.filter((e) => ids.has(e.id)).sort((a, b) => (dist.get(b.id) ?? 0) - (dist.get(a.id) ?? 0));
}

export interface MargemRota { rota: RotaCanonica; etapas: number; roteiro: RoteiroEtapa[]; margem: MargemProduto }

export function margemPorRota(
  produto: Pick<Produto, "roteiro" | "valorUnitario">,
  modelo: ModeloCanonico,
  custoHoraPorOperacao: Record<string, number>,
  custoHoraEmpresa: number,
  periodosComDuracao: PeriodoComDuracao[],
): MargemRota[] {
  return [...modelo.rotas].sort((a, b) => a.ordem - b.ordem).filter((r) => r.ativa).map((rota) => {
    const roteiro = roteiroDaRota(produto, modelo, rota.id);
    return { rota, etapas: roteiro.length, roteiro, margem: calcularMargemProduto({ roteiro, valorUnitario: produto.valorUnitario }, custoHoraPorOperacao, custoHoraEmpresa, periodosComDuracao) };
  });
}

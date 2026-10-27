// WIP DE PRODUTO DE ROTAS (M4) — modelo PURO. Antes da convergência cada rota tem o seu saldo; no pool comum só existe UM saldo; depois de Etiquetar não há mais "origem CONV/AUTO".
//   rota (CONV: Rosquear → Parafusar):  saldo interno = produzido na etapa − produzido na seguinte da MESMA rota; entrega ao pool = produzido na ÚLTIMA etapa exclusiva
//   pool comum:   disponível para a 1ª etapa comum = saldo inicial válido + Σ entregas das rotas;  consumo = produzido na 1ª etapa comum (Etiquetar);  saldo = disponível − consumo
//   fluxo comum:  saldo entre etapas (etiquetado aguardando Embalar) = produzido na etapa − produzido na seguinte. Não existe WIP comum por rota.
// Atribuição do saldo do pool às rotas (só informativa) é PROPORCIONAL ao que cada uma colocou lá — nunca FIFO. Nada aqui lê banco nem altera o planejamento.
import type { EstruturaProduto } from "./tipos";

const EPS = 1e-9;

export interface EntradaWipRotas {
  executado: Record<string, number>;                          // peças BOAS produzidas por etapa no horizonte (Produção Real)
  inicial?: { pool?: number; porRota?: Record<string, number> };   // saldo inicial válido já pronto para a 1ª etapa comum (total e/ou por rota de origem)
}
export interface WipRota { rotaCodigo: string; saldoInterno: { de: string; para: string; saldo: number }[]; entregueAoPool: number; inicial: number }
export interface WipPool { disponivel: number; consumido: number; saldo: number; inconsistente: boolean; porRota: Record<string, number> }
export interface WipProdutoRotas { rotas: WipRota[]; pool: WipPool; entreEtapasComuns: { de: string; para: string; saldo: number }[] }

export function wipDoProdutoRotas(est: EstruturaProduto, e: EntradaWipRotas): WipProdutoRotas {
  const x = (id: string) => e.executado[id] ?? 0;
  const rotas: WipRota[] = est.rotas.filter((r) => r.ativa).map((r) => ({
    rotaCodigo: r.codigo,
    saldoInterno: r.etapas.slice(0, -1).map((id, k) => ({ de: id, para: r.etapas[k + 1], saldo: Math.max(0, x(id) - x(r.etapas[k + 1])) })),
    entregueAoPool: r.etapas.length ? x(r.etapas[r.etapas.length - 1]) : 0,
    inicial: e.inicial?.porRota?.[r.codigo] ?? 0,
  }));
  const comuns = est.poolComum?.etapas ?? [];
  const inicialTotal = (e.inicial?.pool ?? 0) + rotas.reduce((s, r) => s + r.inicial, 0);
  const disponivel = inicialTotal + rotas.reduce((s, r) => s + r.entregueAoPool, 0);
  const consumido = comuns.length ? x(comuns[0]) : 0;
  const bruto = disponivel - consumido;
  const colocado = rotas.map((r) => r.inicial + r.entregueAoPool);
  const somaColocado = colocado.reduce((s, v) => s + v, 0);
  const saldo = Math.max(0, bruto);
  const porRota = Object.fromEntries(rotas.map((r, i) => [r.rotaCodigo, somaColocado > EPS ? (saldo * colocado[i]) / somaColocado : 0]));
  return {
    rotas,
    pool: { disponivel, consumido, saldo, inconsistente: bruto < -EPS, porRota },     // inconsistente: Etiquetar consumiu mais do que as rotas entregaram (apontamento faltando?)
    entreEtapasComuns: comuns.slice(0, -1).map((id, k) => ({ de: id, para: comuns[k + 1], saldo: Math.max(0, x(id) - x(comuns[k + 1])) })),
  };
}

// Arestas do PERCURSO (iguais às de `produto_arestas_rotas` no banco): dentro da rota, convergência e fluxo comum. Substituem "ordem+1" para produto de rotas.
export interface Aresta { origemId: string; destinoId: string; grupo: string }
export function arestasDoPercurso(est: EstruturaProduto): Aresta[] {
  const out: Aresta[] = [];
  est.rotas.forEach((r) => r.etapas.slice(0, -1).forEach((id, k) => out.push({ origemId: id, destinoId: r.etapas[k + 1], grupo: r.codigo })));
  const comuns = est.poolComum?.etapas ?? [];
  if (comuns.length) est.rotas.filter((r) => r.etapas.length > 0).forEach((r) => out.push({ origemId: r.etapas[r.etapas.length - 1], destinoId: comuns[0], grupo: "CONVERGENCIA" }));
  comuns.slice(0, -1).forEach((id, k) => out.push({ origemId: id, destinoId: comuns[k + 1], grupo: "COMUM" }));
  return out;
}
export const arestaValida = (est: EstruturaProduto, origemId: string, destinoId: string) => arestasDoPercurso(est).some((a) => a.origemId === origemId && a.destinoId === destinoId);

// Pertencimento de uma etapa (e portanto de um ADICIONAL planejado nela): decidido pela ETAPA, nunca pela ordem. null = etapa fora do produto.
export function grupoDaEtapa(est: EstruturaProduto, etapaId: string): string | null {
  const r = est.rotas.find((x) => x.etapas.includes(etapaId));
  if (r) return r.codigo;
  return est.poolComum?.etapas.includes(etapaId) ? "COMUM" : null;
}

// CUSTO por rota (leitura PURA; nenhum valor fixo no código — tudo vem das metas, períodos e custo/hora informados).
//   custo exclusivo da rota = Σ etapas do TRECHO EXCLUSIVO (CONV: Rosquear + Parafusar; AUTO: Rosquear + Parafusar em uma máquina)
//   custo comum             = Σ etapas do FLUXO COMUM (Etiquetar + Embalar)
//   custo final da rota     = exclusivo da rota + comum      — NUNCA CONV + AUTO + comum (a peça passa por UM trecho exclusivo, não pelos dois)
//   economia da automática  = (exclusivo CONV − exclusivo AUTO) × volume que a AUTO entregou ao pool comum
// O custo/hora por operação segue a mesma fórmula do legado (tempo por peça × custo/hora da operação).
import { tempoPorPeca } from "./capacidade";
import type { EstruturaProduto, EtapaCadastro, PeriodoDuracao } from "./tipos";

export interface ContextoCusto {
  periodos: PeriodoDuracao[];
  custoHoraPorOperacao: Record<string, number>;   // por NOME da operação (como no sistema); ausente → custoHoraPadrao
  custoHoraPadrao: number;                        // fallback (custo/hora da empresa), como no legado
}
export interface CustoRota { rotaCodigo: string; exclusivo: number; comum: number; final: number; margem: number | null }

export function custoPecaEtapa(etapa: EtapaCadastro, ctx: ContextoCusto): number {
  const t = tempoPorPeca(etapa, ctx);
  return t * (ctx.custoHoraPorOperacao[etapa.operacao] ?? ctx.custoHoraPadrao);
}
const somar = (ids: string[], etapas: Map<string, EtapaCadastro>, ctx: ContextoCusto) => ids.reduce((s, id) => s + custoPecaEtapa(etapas.get(id) as EtapaCadastro, ctx), 0);

export function custoComum(estrutura: EstruturaProduto, etapas: Map<string, EtapaCadastro>, ctx: ContextoCusto): number {
  return somar(estrutura.poolComum?.etapas ?? [], etapas, ctx);
}
export function custoExclusivoRota(estrutura: EstruturaProduto, rotaCodigo: string, etapas: Map<string, EtapaCadastro>, ctx: ContextoCusto): number {
  const r = estrutura.rotas.find((x) => x.codigo === rotaCodigo);
  return r ? somar(r.etapas, etapas, ctx) : 0;
}

// um custo final POR rota (cada uma com o seu trecho exclusivo + o fluxo comum, uma vez)
export function custoPorRota(estrutura: EstruturaProduto, etapas: Map<string, EtapaCadastro>, ctx: ContextoCusto, valorUnitario?: number): CustoRota[] {
  const comum = custoComum(estrutura, etapas, ctx);
  return estrutura.rotas.map((r) => {
    const exclusivo = somar(r.etapas, etapas, ctx);
    const final = exclusivo + comum;
    return { rotaCodigo: r.codigo, exclusivo, comum, final, margem: valorUnitario === undefined ? null : valorUnitario - final };
  });
}

// economia medida ATÉ a convergência: onde as rotas realmente diferem
export function economiaDaRota(custos: CustoRota[], rotaEconomica: string, rotaBase: string, volumeEntregueAoPool: number): { porPeca: number; total: number } {
  const e = custos.find((c) => c.rotaCodigo === rotaEconomica), b = custos.find((c) => c.rotaCodigo === rotaBase);
  if (!e || !b) return { porPeca: 0, total: 0 };
  const porPeca = b.exclusivo - e.exclusivo;
  return { porPeca, total: porPeca * volumeEntregueAoPool };
}

// custo comum rateado PROPORCIONALMENTE ao volume entregue ao pool (nunca FIFO; nunca "esta peça veio de qual rota")
export function ratearComum(custoComumTotal: number, volumePorRota: Record<string, number>): Record<string, number> {
  const total = Object.values(volumePorRota).reduce((s, v) => s + v, 0);
  return Object.fromEntries(Object.entries(volumePorRota).map(([r, v]) => [r, total > 0 ? (custoComumTotal * v) / total : 0]));
}

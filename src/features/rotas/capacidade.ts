// CAPACIDADE do produto de rotas (leitura PURA — não divide a demanda entre rotas, não é o planejador, não altera a Escala).
// Pergunta: "com todas as rotas disponíveis, quanto o PRODUTO FINAL consegue entregar?"
//   capacidade da etapa   = Σ máquinas elegíveis (horas livres da semana ÷ tempo por peça da etapa)
//   capacidade da rota    = mínimo das suas etapas EXCLUSIVAS (em série)
//   capacidade de entrada = Σ capacidades das rotas (rotas paralelas, máquinas disjuntas)
//   capacidade comum      = mínimo das etapas COMUNS (Etiquetar, Embalar…)
//   entregável            = min(entrada, comum)
// As horas já comprometidas por OUTROS produtos numa máquina são descontadas: nunca se assume capacidade livre que não existe (ex.: Etiquetadora 16 × Caixa Amarela).
import { PERIODOS_DO_DIA, type AnaliseCapacidadeRotas, type CapacidadeEtapa, type CapacidadeRota, type ContextoCapacidade, type EstruturaProduto, type EtapaCadastro, type GargaloRotas } from "./tipos";

const EPS = 1e-9;

// horas de calendário de UMA máquina na semana = Σ durações dos períodos × dias produtivos
export function horasMaquinaSemana(ctx: Pick<ContextoCapacidade, "periodos" | "diasProdutivos">): number {
  return (ctx.periodos.reduce((s, p) => s + p.minutos, 0) / 60) * ctx.diasProdutivos;
}

// tempo médio (h) por peça: Σ horas dos períodos com meta ÷ Σ metas (mesma fórmula de `tempoPorPecaEtapa` da Previsão)
export function tempoPorPeca(etapa: Pick<EtapaCadastro, "metas">, ctx: Pick<ContextoCapacidade, "periodos">): number {
  let pecas = 0, horas = 0;
  PERIODOS_DO_DIA.forEach((id) => {
    const meta = Number(etapa.metas[id] ?? 0);
    const dur = ctx.periodos.find((p) => p.id === id)?.minutos ?? 0;
    if (meta > 0 && dur > 0) { pecas += meta; horas += dur / 60; }
  });
  return pecas > 0 ? horas / pecas : 0;
}

// `maquinasSelecionadas`: se informado, só estas máquinas contam (seleção da Previsão); senão todas as da etapa
export function capacidadeEtapa(etapa: EtapaCadastro, ctx: ContextoCapacidade, maquinasSelecionadas?: string[]): CapacidadeEtapa {
  const t = tempoPorPeca(etapa, ctx);
  const horas = horasMaquinaSemana(ctx);
  const indisp = new Set(ctx.maquinasIndisponiveis ?? []);
  const maquinas = (maquinasSelecionadas ?? etapa.maquinasIds).filter((m) => etapa.maquinasIds.includes(m) && !indisp.has(m));
  const livres = maquinas.map((m) => Math.max(0, horas - (ctx.horasComprometidasPorMaquina?.[m] ?? 0)));
  const porMaquina: Record<string, number> = {};
  maquinas.forEach((m, i) => { porMaquina[m] = t > 0 ? livres[i] / t : 0; });
  // aritmética idêntica à do legado (n × horas ÷ tempo/peça) quando todas as máquinas têm a mesma folga — a equivalência é EXATA, não aproximada
  const horasTotais = livres.length > 0 && livres.every((x) => x === livres[0]) ? livres.length * livres[0] : livres.reduce((s, x) => s + x, 0);
  return { etapaId: etapa.id, operacao: etapa.operacao, pecas: t > 0 ? horasTotais / t : 0, porMaquina };
}

export function capacidadeRota(estrutura: EstruturaProduto, rotaCodigo: string, etapas: Map<string, EtapaCadastro>, ctx: ContextoCapacidade, selecao?: Record<string, string[]>): CapacidadeRota {
  const rota = estrutura.rotas.find((r) => r.codigo === rotaCodigo);
  if (!rota || !rota.ativa) return { rotaCodigo, pecas: 0, limitante: null, etapas: [] };
  const caps = rota.etapas.map((id) => capacidadeEtapa(etapas.get(id) as EtapaCadastro, ctx, selecao?.[id]));
  const limitante = caps.reduce<CapacidadeEtapa | null>((m, c) => (m === null || c.pecas < m.pecas ? c : m), null);
  return { rotaCodigo, pecas: limitante?.pecas ?? 0, limitante, etapas: caps };
}

export function analisarCapacidadeRotas(
  estrutura: EstruturaProduto, etapas: Map<string, EtapaCadastro>, demanda: number, ctx: ContextoCapacidade, selecao?: Record<string, string[]>
): AnaliseCapacidadeRotas {
  const porRota = estrutura.rotas.map((r) => capacidadeRota(estrutura, r.codigo, etapas, ctx, selecao));
  const capacidadeEntrada = porRota.reduce((s, r) => s + r.pecas, 0);
  const comum = (estrutura.poolComum?.etapas ?? []).map((id) => capacidadeEtapa(etapas.get(id) as EtapaCadastro, ctx, selecao?.[id]));
  const limComum = comum.reduce<CapacidadeEtapa | null>((m, c) => (m === null || c.pecas < m.pecas ? c : m), null);
  const capacidadeComum = limComum ? limComum.pecas : Infinity;
  const maxEntregavel = Math.min(capacidadeEntrada, capacidadeComum);
  const falta = Math.max(0, demanda - maxEntregavel);
  let gargalo: GargaloRotas = null;
  if (demanda > maxEntregavel + EPS) {
    if (capacidadeComum <= capacidadeEntrada + EPS && limComum) gargalo = { tipo: "comum", etapaId: limComum.etapaId, operacao: limComum.operacao };
    else {
      // o que limita é a SOMA das rotas: lista quem limita cada rota (da menor para a maior capacidade)
      const limitantes = porRota.filter((r) => r.limitante).sort((a, b) => a.pecas - b.pecas || (a.rotaCodigo < b.rotaCodigo ? -1 : 1))
        .map((r) => ({ rotaCodigo: r.rotaCodigo, etapaId: (r.limitante as CapacidadeEtapa).etapaId, operacao: (r.limitante as CapacidadeEtapa).operacao, pecas: r.pecas }));
      gargalo = { tipo: "entrada", limitantes };
    }
  }
  return { demanda, capacidadePorRota: porRota, capacidadeEntrada, capacidadeComum, comum, maxEntregavel, atende: falta <= EPS, falta, folga: demanda > 0 ? (maxEntregavel - demanda) / demanda : 0, gargalo };
}

// Produto LINEAR (rota implícita): a mesma conta do legado — mínimo entre TODAS as etapas (cada uma com suas máquinas). Usado na prova de equivalência.
export function capacidadeLinear(etapasOrdenadas: EtapaCadastro[], ctx: ContextoCapacidade, selecao?: Record<string, string[]>): number {
  let max = Infinity;
  etapasOrdenadas.forEach((e) => { max = Math.min(max, capacidadeEtapa(e, ctx, selecao?.[e.id]).pecas); });
  return max === Infinity ? 0 : max;
}

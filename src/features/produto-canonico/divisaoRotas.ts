// DIVISÃO entre as rotas do produto único lida DIRETO do plano (PURO, só leitura): peças planejadas na SAÍDA de cada rota (a última etapa exclusiva da rota, a que alimenta o trecho
// comum: Parafusar na convencional, Máquina 8 na automática), por dia e na semana. Nada é estimado aqui: é a soma das linhas do plano (escala_producao_alocacoes.pecas) daquela etapa.
// Sem modelo, sem linhas do produto único ou sem peças => `temDados` false (a tela não mostra número nenhum).
import type { ModeloCanonico } from "./tipos";

export interface LinhaPlanoMinima { data: string; produtoId: string | null; etapaId: string | null; pecas: number }

export interface SaidaRota { rotaId: string; rotulo: string; tipo: string; etapaSaidaId: string }
export interface DivisaoRotas {
  temDados: boolean;
  rotas: SaidaRota[];
  /** dia -> rota -> peças */
  porDia: Record<string, Record<string, number>>;
  /** rota -> peças na semana */
  total: Record<string, number>;
  totalGeral: number;
}

/** Última etapa exclusiva de cada rota ativa: a exclusiva que tem aresta para uma etapa de trecho comum (rotaId null). Rota sem essa etapa fica de fora (não inventa). */
export function saidasDasRotas(modelo: ModeloCanonico): SaidaRota[] {
  const rotaDe = new Map(modelo.etapas.map((e) => [e.etapaId, e.rotaId] as const));
  return [...modelo.rotas].filter((r) => r.ativa).sort((a, b) => a.ordem - b.ordem).flatMap((r) => {
    const saida = modelo.etapas.find((e) => e.rotaId === r.id && modelo.arestas.some((a) => a.origemEtapaId === e.etapaId && rotaDe.get(a.destinoEtapaId) === null));
    return saida ? [{ rotaId: r.id, rotulo: r.nome, tipo: r.tipo, etapaSaidaId: saida.etapaId }] : [];
  });
}

export function divisaoEntreRotas(linhas: LinhaPlanoMinima[], modelo: ModeloCanonico | null | undefined): DivisaoRotas {
  const vazio: DivisaoRotas = { temDados: false, rotas: [], porDia: {}, total: {}, totalGeral: 0 };
  if (!modelo) return vazio;
  const rotas = saidasDasRotas(modelo);
  if (rotas.length < 2) return vazio;
  const rotaDaSaida = new Map(rotas.map((r) => [r.etapaSaidaId, r.rotaId] as const));
  const porDia: DivisaoRotas["porDia"] = {};
  const total: DivisaoRotas["total"] = Object.fromEntries(rotas.map((r) => [r.rotaId, 0]));
  linhas.forEach((l) => {
    if (l.produtoId !== modelo.produtoCanonicoId || !l.etapaId) return;
    const rotaId = rotaDaSaida.get(l.etapaId);
    const pecas = Number(l.pecas) || 0;
    if (!rotaId || pecas <= 0) return;
    porDia[l.data] ??= Object.fromEntries(rotas.map((r) => [r.rotaId, 0]));
    porDia[l.data][rotaId] += pecas;
    total[rotaId] += pecas;
  });
  const totalGeral = Object.values(total).reduce((s, v) => s + v, 0);
  return { temDados: totalGeral > 0, rotas, porDia, total, totalGeral };
}

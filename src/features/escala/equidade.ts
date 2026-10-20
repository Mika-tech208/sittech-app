// Equidade automática (anti-favorecimento) — regra INTERNA do motor.
//
// Ideia: para cada operação (e, secundariamente, cada máquina), a exposição
// REAL de cada funcionário é comparada com a exposição ESPERADA, normalizada
// pela disponibilidade:
//
//   esperada(f, X) = total(X) × disponíveis(f) / Σ_g disponíveis(g)
//   desvio(f, X)   = real(f, X) − esperada(f, X)
//
// onde X = operação ou máquina, total(X) = exposições de X somadas sobre a
// EQUIPE ATUAL na janela, e disponíveis(f) = nº de períodos em que f podia ter
// sido escalado (ausência NÃO conta — não cria dívida). desvio > 0: já fez
// mais que a parcela justa; desvio < 0: fez menos. O custo da atribuição
// soma o desvio (limitado), então o motor favorece quem está abaixo e evita
// quem está acima — sempre DEPOIS do gargalo (que decide quais postos são
// cobertos) e do revezamento (custo muito maior).
//
// Fonte dos dados: a escala realmente gravada (janela JANELA_EQUIDADE_DIAS) +
// o que o próprio motor já decidiu na geração em curso. Sem aleatoriedade.

import type { HistoricoEquidadeFuncionario } from "./types";

// Horizonte padrão da janela histórica (dias) — ajustável sem reescrever o motor.
export const JANELA_EQUIDADE_DIAS = 30;

// Limite do desvio (em exposições) usado no custo: garante que o revezamento
// (custo 1e9) sempre domine, mesmo somando todas as pessoas.
export const LIMITE_DESVIO_EQUIDADE = 40;

// Pesos (por exposição de desvio). Ordem de grandeza = ordem de prioridade:
// operação (1e5) >> máquina (1e3) > minimizar mudanças (100, no motor).
export const PESO_EQUIDADE_OPERACAO = 100_000;
export const PESO_EQUIDADE_MAQUINA = 1_000;

function limitar(v: number): number {
  return v > LIMITE_DESVIO_EQUIDADE ? LIMITE_DESVIO_EQUIDADE : v < -LIMITE_DESVIO_EQUIDADE ? -LIMITE_DESVIO_EQUIDADE : v;
}

export class ContadoresEquidade {
  private disp = new Map<string, number>();
  private op = new Map<string, Map<string, number>>();
  private maq = new Map<string, Map<string, number>>();
  private totalDisp = 0;
  private totalOp = new Map<string, number>();
  private totalMaq = new Map<string, number>();

  // Só a equipe atual entra nos totais (quem saiu da equipe não dilui a parcela).
  constructor(private readonly equipe: string[], historico: HistoricoEquidadeFuncionario[] = []) {
    const naEquipe = new Set(equipe);
    equipe.forEach((id) => {
      this.disp.set(id, 0);
      this.op.set(id, new Map());
      this.maq.set(id, new Map());
    });
    [...historico]
      .sort((a, b) => (a.funcionarioId < b.funcionarioId ? -1 : 1))
      .forEach((h) => {
        if (!naEquipe.has(h.funcionarioId)) return;
        this.somarDisp(h.funcionarioId, h.periodosDisponiveis);
        Object.keys(h.porOperacao).sort().forEach((k) => this.somarOp(h.funcionarioId, k, h.porOperacao[k]));
        Object.keys(h.porMaquina).sort().forEach((k) => this.somarMaq(h.funcionarioId, k, h.porMaquina[k]));
      });
  }

  private somarDisp(f: string, n: number) {
    if (!this.disp.has(f) || n <= 0) return;
    this.disp.set(f, (this.disp.get(f) as number) + n);
    this.totalDisp += n;
  }
  private somarOp(f: string, k: string, n: number) {
    if (!this.op.has(f) || n <= 0) return;
    const m = this.op.get(f) as Map<string, number>;
    m.set(k, (m.get(k) ?? 0) + n);
    this.totalOp.set(k, (this.totalOp.get(k) ?? 0) + n);
  }
  private somarMaq(f: string, k: string, n: number) {
    if (!this.maq.has(f) || n <= 0) return;
    const m = this.maq.get(f) as Map<string, number>;
    m.set(k, (m.get(k) ?? 0) + n);
    this.totalMaq.set(k, (this.totalMaq.get(k) ?? 0) + n);
  }

  // Um período decidido (ou congelado): quem estava disponível e quem teve posto.
  registrarPeriodo(disponiveis: string[], postos: { funcionarioId: string; operacaoId: string; maquinaId: string }[]) {
    disponiveis.forEach((f) => this.somarDisp(f, 1));
    postos.forEach((p) => {
      this.somarOp(p.funcionarioId, p.operacaoId, 1);
      this.somarMaq(p.funcionarioId, p.maquinaId, 1);
    });
  }

  private esperada(f: string, total: number): number {
    if (this.totalDisp <= 0) return 0;
    return (total * ((this.disp.get(f) as number) ?? 0)) / this.totalDisp;
  }

  desvioOperacao(f: string, operacaoId: string): number {
    if (!this.op.has(f)) return 0;
    const real = this.op.get(f)!.get(operacaoId) ?? 0;
    return real - this.esperada(f, this.totalOp.get(operacaoId) ?? 0);
  }

  desvioMaquina(f: string, maquinaId: string): number {
    if (!this.maq.has(f)) return 0;
    const real = this.maq.get(f)!.get(maquinaId) ?? 0;
    return real - this.esperada(f, this.totalMaq.get(maquinaId) ?? 0);
  }

  // Custo de equidade de pôr f na (operação, máquina): negativo quando abaixo
  // da parcela justa (favorece), positivo quando acima (evita).
  custo(f: string, operacaoId: string, maquinaId: string): number {
    return PESO_EQUIDADE_OPERACAO * limitar(this.desvioOperacao(f, operacaoId)) + PESO_EQUIDADE_MAQUINA * limitar(this.desvioMaquina(f, maquinaId));
  }
}

// Agrega linhas da escala gravada (uma por pessoa disponível no período) no
// histórico por funcionário. Linha sem posto conta como disponibilidade;
// ausência não gera linha, portanto não entra.
export function agregarHistoricoEquidade(linhas: { funcionarioId: string; maquinaId: string | null; operacaoId: string | null }[]): HistoricoEquidadeFuncionario[] {
  const mapa = new Map<string, HistoricoEquidadeFuncionario>();
  linhas.forEach((l) => {
    let h = mapa.get(l.funcionarioId);
    if (!h) {
      h = { funcionarioId: l.funcionarioId, periodosDisponiveis: 0, porOperacao: {}, porMaquina: {} };
      mapa.set(l.funcionarioId, h);
    }
    h.periodosDisponiveis++;
    if (l.maquinaId && l.operacaoId) {
      h.porOperacao[l.operacaoId] = (h.porOperacao[l.operacaoId] ?? 0) + 1;
      h.porMaquina[l.maquinaId] = (h.porMaquina[l.maquinaId] ?? 0) + 1;
    }
  });
  return [...mapa.values()].sort((a, b) => (a.funcionarioId < b.funcionarioId ? -1 : 1));
}

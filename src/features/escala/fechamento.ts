// FECHAMENTO DE PERÍODO (Fase 4d) — regra PURA e determinística (sem relógio, sem banco).
//
// Um período é ESTÁVEL quando, no instante t:
//   1. t ≥ fim + 10 min;  2. ≥ 90% dos POSTOS ESPERADOS (máquinas do plano oficial do período) têm apontamento;
//   3. nenhum lançamento novo nos últimos 3 min (quietude).
// Aos 20 min (t ≥ fim + 20) processa mesmo incompleto, marcando dados_completos = false — nunca finge que dado incompleto é completo.
// O CORTE da decisão é o primeiro instante (passo de 1 min) em que a regra é satisfeita (ou fim + 20 min): é calculado SÓ com os
// carimbos dos lançamentos, então não depende de quando o worker roda. Lançamento posterior ao corte é "tardio" e não reescreve nada.

export const FECHAMENTO = { minutosAposFim: 10, completudeMinima: 0.9, quietudeMin: 3, prazoMin: 20, passoMs: 60_000 } as const;

export interface LancamentoCarimbado { maquinaId: string | null; ms: number }

export interface AvaliacaoFechamento {
  pronto: boolean;
  motivo: "estavel" | "prazo" | null;
  dadosCompletos: boolean; // true só se TODOS os critérios de estabilidade valiam no corte
  percentual: number; // 0..100, postos esperados com apontamento
  esperados: number;
  recebidos: number;
  faltantes: string[]; // máquinas esperadas ainda sem lançamento
  ultimoLancamentoMs: number | null;
  proximaAvaliacaoMs: number | null;
}

const MIN = 60_000;

export function avaliarFechamento(p: { fimMs: number; agoraMs: number; postosEsperados: string[]; lancamentos: LancamentoCarimbado[] }): AvaliacaoFechamento {
  const esperados = [...new Set(p.postosEsperados)].sort();
  const ate = p.lancamentos.filter((l) => l.ms <= p.agoraMs);
  const comLanc = new Set(ate.filter((l) => l.maquinaId).map((l) => l.maquinaId as string));
  const recebidos = esperados.filter((m) => comLanc.has(m));
  const faltantes = esperados.filter((m) => !comLanc.has(m));
  const percentual = esperados.length === 0 ? 100 : (100 * recebidos.length) / esperados.length;
  const ultimo = ate.length ? Math.max(...ate.map((l) => l.ms)) : null;
  const apos10 = p.agoraMs >= p.fimMs + FECHAMENTO.minutosAposFim * MIN;
  const completo = percentual >= FECHAMENTO.completudeMinima * 100 - 1e-9;
  const quieto = ultimo === null || p.agoraMs - ultimo >= FECHAMENTO.quietudeMin * MIN;
  const estavel = apos10 && completo && quieto;
  const prazo = p.agoraMs >= p.fimMs + FECHAMENTO.prazoMin * MIN;
  const pronto = estavel || prazo;
  return {
    pronto, motivo: estavel ? "estavel" : prazo ? "prazo" : null, dadosCompletos: estavel, percentual, esperados: esperados.length, recebidos: recebidos.length, faltantes,
    ultimoLancamentoMs: ultimo,
    proximaAvaliacaoMs: pronto ? null : Math.min(p.fimMs + FECHAMENTO.prazoMin * MIN, Math.max(p.agoraMs + FECHAMENTO.passoMs, apos10 && completo && ultimo !== null ? ultimo + FECHAMENTO.quietudeMin * MIN : 0)),
  };
}

// Primeiro instante (passo de 1 min a partir de fim+10) em que o período fecha; null se ainda não fechou até `agoraMs`.
export function instanteDeFechamento(p: { fimMs: number; agoraMs: number; postosEsperados: string[]; lancamentos: LancamentoCarimbado[] }): { corteMs: number; avaliacao: AvaliacaoFechamento } | { corteMs: null; avaliacao: AvaliacaoFechamento } {
  const inicio = p.fimMs + FECHAMENTO.minutosAposFim * MIN;
  const limite = p.fimMs + FECHAMENTO.prazoMin * MIN;
  for (let t = inicio; t <= limite; t += FECHAMENTO.passoMs) {
    if (t > p.agoraMs) break;
    const a = avaliarFechamento({ ...p, agoraMs: t });
    if (a.pronto) return { corteMs: t, avaliacao: a };
  }
  return { corteMs: null, avaliacao: avaliarFechamento(p) };
}

// Lançamentos depois do corte (tardios): não alteram a decisão; só são contados/registrados.
export const lancamentosTardios = (lancamentos: LancamentoCarimbado[], corteMs: number) => lancamentos.filter((l) => l.ms > corteMs).length;

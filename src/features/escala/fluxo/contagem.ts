// CONTAGEM FÍSICA CONFIRMADA — validação e acúmulo pós-contagem (puro, sem IO). Ver docs/escala-fluxo-contagem-fisica.md.
//
// Uma contagem diz: "no instante T havia `saldo` peças entre a etapa origem e a seguinte do produto". O WIP do par depois de T é
//   saldo + Σ boas da origem lançadas DEPOIS de T − Σ boas da seguinte lançadas DEPOIS de T            (lo/hi pela regra do não confirmado)
// Quais células entram (por período, [início, fim) e T):
//   • fim ≤ T            → NUNCA (a produção do período já está no estoque contado, mesmo que seja lançada depois);
//   • início ≥ T         → inteira (confirmado: Σ boas; não confirmado: [0, planejado]; zero confirmado: 0);
//   • início < T < fim   → período em ANDAMENTO na contagem: entra só o que for LANÇADO depois de T (confirmado: linhas com lancadoEmMs > T);
//                          sem lançamento visível (não confirmado) entra [0, planejado × fração do período após T].
// Nada aqui lê wip_controle/wip_confirmacoes; nada altera apontamentos nem períodos passados: só muda o estoque inicial dos períodos futuros.

import { chavePool } from "../types";
import type { ArestaFluxo, Grafo } from "./grafo";
import type { ContagemFisicaPar, DadosProducaoReal, DiagnosticoItem, Intervalo } from "./tipos";

/** Tolerância de relógio: contagem até 30 min à frente de "agora" é aceita e tratada como agora; além disso é "futuro distante" (inválida). */
export const TOLERANCIA_FUTURO_MS = 30 * 60_000;
/** Contagem anterior ao início da semana: aceita até 2 dias antes (fim de semana); a produção entre a contagem e a semana não é conhecida (aviso). */
export const ANTECEDENCIA_MAXIMA_MS = 2 * 24 * 3_600_000;
/** Até este nº de períodos FECHADOS desde a contagem a confiança é `alta`; depois decai para `media`. */
export const PERIODOS_CONFIANCA_ALTA = 6;

export interface ContagemValida {
  aresta: ArestaFluxo;
  item: ContagemFisicaPar;
  /** instante efetivo (epoch ms): o informado, limitado a "agora" */
  instanteMs: number;
  /** posição do item na lista informada (diagnóstico) */
  indice: number;
}

export interface RegistroFechado {
  t: number;
  no: string;
  estado: "confirmado" | "nao_confirmado";
  linhas: { boas: number; lancadoEmMs: number }[];
  planejado: number;
}

export interface SlotMs { inicioMs: number; fimMs: number }

const iso = (ms: number) => new Date(ms).toISOString();

export function acharAresta(grafo: Grafo, c: Pick<ContagemFisicaPar, "produtoId" | "etapaOrigemId" | "etapaSeguinteId">): ArestaFluxo | null {
  const exata = Object.values(grafo.arestas).find((e) => e.produtoId === c.produtoId && e.etapaOrigemId === c.etapaOrigemId && e.etapaSeguinteId === c.etapaSeguinteId);
  if (exata) return exata;
  // membro de pool fundido (Conector legado): o par do produto "irmão" é a MESMA aresta lógica
  const no = grafo.noDoPool[chavePool(c.produtoId, c.etapaOrigemId)];
  const e = no ? grafo.arestas[no] : undefined;
  if (e && grafo.nos[e.destino].membros.includes(chavePool(c.produtoId, c.etapaSeguinteId))) return e;
  return null;
}

/** Valida as contagens do núcleo (par existente/consecutivo, saldo ≥ 0, instante finito e não no futuro distante). Duplicadas por par: vale a mais recente. Nunca lança. */
export function validarContagens(grafo: Grafo, dados: DadosProducaoReal, slots: SlotMs[]): { validas: Map<string, ContagemValida>; diagnosticos: DiagnosticoItem[] } {
  const diagnosticos: DiagnosticoItem[] = [];
  const validas = new Map<string, ContagemValida>();
  const lista = Array.isArray(dados.contagensFisicas) ? dados.contagensFisicas : [];
  const inicioSemana = slots.length > 0 ? slots[0].inicioMs : Number.NEGATIVE_INFINITY;
  const ignorar = (i: number, c: Partial<ContagemFisicaPar> | null | undefined, motivo: string, severidade: "aviso" | "info" = "aviso") => {
    diagnosticos.push({
      codigo: "CONTAGEM_FISICA_IGNORADA", severidade, ...(c?.produtoId ? { produtoId: c.produtoId } : {}), ...(c?.etapaOrigemId ? { etapaId: c.etapaOrigemId } : {}),
      mensagem: `Contagem física #${i + 1} ignorada: ${motivo}`, detalhes: { indice: i, motivo },
    });
  };
  lista.forEach((c, i) => {
    if (!c || typeof c !== "object") return ignorar(i, null, "item malformado");
    if (typeof c.produtoId !== "string" || typeof c.etapaOrigemId !== "string" || typeof c.etapaSeguinteId !== "string") return ignorar(i, c, "produtoId/etapaOrigemId/etapaSeguinteId ausentes");
    if (typeof c.saldo !== "number" || !Number.isFinite(c.saldo) || c.saldo < 0) return ignorar(i, c, "saldo deve ser um número finito ≥ 0");
    if (typeof c.contadoEmMs !== "number" || !Number.isFinite(c.contadoEmMs)) return ignorar(i, c, "contadoEm inválido");
    const aresta = acharAresta(grafo, c);
    if (!aresta) return ignorar(i, c, "par inexistente ou etapas não consecutivas nesta semana");
    if (c.contadoEmMs > dados.agoraMs + TOLERANCIA_FUTURO_MS) return ignorar(i, c, `contadoEm (${iso(c.contadoEmMs)}) está no futuro`);
    if (c.contadoEmMs < inicioSemana - ANTECEDENCIA_MAXIMA_MS) return ignorar(i, c, `contadoEm (${iso(c.contadoEmMs)}) é anterior demais ao início da semana`);
    const instanteMs = Math.min(c.contadoEmMs, dados.agoraMs);
    const atual = validas.get(aresta.id);
    if (atual) {
      // duplicada: vale a mais recente (empate: a que aparece depois na lista)
      if (instanteMs >= atual.instanteMs) {
        ignorar(atual.indice, atual.item, `substituída por contagem mais recente do mesmo par (${iso(instanteMs)})`, "info");
        validas.set(aresta.id, { aresta, item: c, instanteMs, indice: i });
      } else ignorar(i, c, `há contagem mais recente do mesmo par (${iso(atual.instanteMs)})`, "info");
      return;
    }
    validas.set(aresta.id, { aresta, item: c, instanteMs, indice: i });
  });
  return { validas, diagnosticos };
}

/** Produção acumulada de um nó DEPOIS do instante T (regra no cabeçalho). */
export function acumuladoDesde(registros: RegistroFechado[], slots: SlotMs[], T: number, no: string): Intervalo {
  let lo = 0;
  let hi = 0;
  registros.forEach((r) => {
    if (r.no !== no) return;
    const s = slots[r.t];
    if (s.fimMs <= T) return;
    const emAndamento = s.inicioMs < T;
    if (r.estado === "confirmado") {
      const v = r.linhas.filter((l) => !emAndamento || l.lancadoEmMs > T).reduce((a, l) => a + l.boas, 0);
      lo += v;
      hi += v;
    } else {
      const fracao = emAndamento ? (s.fimMs - T) / Math.max(1, s.fimMs - s.inicioMs) : 1;
      hi += r.planejado * fracao;
    }
  });
  return { lo, hi };
}

/** Existe célula NÃO confirmada, depois de T, em algum dos nós? (rebaixa a confiança) */
export function temNaoConfirmadoDesde(registros: RegistroFechado[], slots: SlotMs[], T: number, nos: string[]): boolean {
  return registros.some((r) => r.estado === "nao_confirmado" && nos.includes(r.no) && slots[r.t].fimMs > T);
}

export const contagemIso = iso;

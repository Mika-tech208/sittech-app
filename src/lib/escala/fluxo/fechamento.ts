// ESCALA INTELIGENTE (fluxo) — o que acontece quando um PERÍODO FECHA (fim + ~10 min; detecção em fechamento.ts / processarSombra). PURO (IO injetado).
//   • modo ATIVO  → dispara o recálculo oficial da semana pelo MESMO processarSemana (c+1 estável, c+2 em diante livre — o núcleo aplica θ);
//   • modo SOMBRA → calcula o plano de fluxo e avalia oficial × fluxo, grava o diagnóstico; a Escala NÃO é tocada.
// Nunca lança: falha vira log + retorno `erro`; nunca impede a drenagem.

import type { OpcoesProcessamento } from "../processar";
import type { EstadoBruto, ResultadoProcessamento } from "../estado";
import { montarEntradaEscala } from "../montarEntrada";
import { avaliarFluxoSombra, nucleoFluxo, regiaoRecalculavel, type NucleoFluxo, type RegistroFluxo } from "./integracao";

export interface DepsFechamentoFluxo {
  nucleo?: NucleoFluxo;
  /** processarSemana(criarEscalaIO(...), opcoes) da semana (somente modo ativo). */
  recalcular(opcoes: Pick<OpcoesProcessamento, "agoraMs" | "criarSeNaoExiste" | "gatilhoFluxo" | "corteFluxo">): Promise<ResultadoProcessamento>;
  registrar(registro: RegistroFluxo): Promise<void>;
}

export interface ResultadoFechamentoFluxo {
  modo: "sombra" | "ativo";
  resultado: "ok" | "fallback" | "erro";
  recalculo?: ResultadoProcessamento["status"];
  erro?: string;
}

export async function fluxoNoFechamento(deps: DepsFechamentoFluxo, a: { estado: EstadoBruto; ev: { data: string; periodoId: string }; agoraMs: number }): Promise<ResultadoFechamentoFluxo | null> {
  const pr = a.estado.producaoReal;
  if (!pr) return null; // desligado (ou leitura indisponível): nada a fazer
  try {
    if (pr.modoEfetivo === "ativo") {
      const r = await deps.recalcular({ agoraMs: a.agoraMs, criarSeNaoExiste: false, gatilhoFluxo: "fechamento", corteFluxo: { data: a.ev.data, periodoId: a.ev.periodoId } });
      return { modo: "ativo", resultado: r.fluxo?.resultado ?? "ok", recalculo: r.status };
    }
    const entrada = montarEntradaEscala(a.estado, a.agoraMs).entrada;
    if (entrada.aPartirDe >= entrada.slots.length) return { modo: "sombra", resultado: "ok" }; // nada recalculável (semana toda ocorrida)
    const registro = avaliarFluxoSombra({ nucleo: deps.nucleo ?? nucleoFluxo, estado: a.estado, entrada, agoraMs: a.agoraMs, gatilho: "fechamento", corte: a.ev }, regiaoRecalculavel(entrada, a.estado.alocacoes));
    await deps.registrar(registro);
    return { modo: "sombra", resultado: registro.resultado };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error("escala/fluxo (fechamento):", erro);
    return { modo: pr.modoEfetivo, resultado: "erro", erro };
  }
}

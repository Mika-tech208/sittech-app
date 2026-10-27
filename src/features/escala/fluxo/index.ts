// Escala Inteligente (fluxo) — API pública do núcleo puro. Contrato fixo (FASE 0); implementação nos módulos irmãos.
import type { AlocacaoEscala, EntradaEscala } from "../types";
import type { AvaliacaoPlano, DadosProducaoReal, EstadoFluxo, OpcoesFluxo, ResultadoFluxo, ViolacaoDura } from "./tipos";

export * from "./tipos";

const NAO_IMPLEMENTADO = "not implemented";

/** Estados por período/pool (confirmado/zero_confirmado/nao_confirmado/futuro), boas lo/hi, WIP por par (origem, confiança), diagnósticos. */
export function estadoDaProducao(_entrada: EntradaEscala, _dados: DadosProducaoReal, _opcoes?: OpcoesFluxo): EstadoFluxo {
  throw new Error(NAO_IMPLEMENTADO);
}

/** Simulador de fluxo determinístico — a MESMA régua para o plano oficial e o inteligente. */
export function avaliarPlano(_entrada: EntradaEscala, _dados: DadosProducaoReal, _alocacoes: AlocacaoEscala[], _opcoes?: OpcoesFluxo): AvaliacaoPlano {
  throw new Error(NAO_IMPLEMENTADO);
}

/** Estado + hooks do motor + iteração por valor marginal. Nunca pior que o plano base pelo simulador. */
export function planejarComFluxo(_entrada: EntradaEscala, _dados: DadosProducaoReal, _opcoes?: OpcoesFluxo): ResultadoFluxo {
  throw new Error(NAO_IMPLEMENTADO);
}

/** Verificador INDEPENDENTE do motor (não reutiliza gerarEscala nem a seleção de postos). */
export function verificarRestricoesDuras(_entrada: EntradaEscala, _alocacoes: AlocacaoEscala[]): ViolacaoDura[] {
  throw new Error(NAO_IMPLEMENTADO);
}

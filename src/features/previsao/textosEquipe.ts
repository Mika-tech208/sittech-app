// Textos do resumo semanal de equipe (tela e PDF). Dois indicadores SEPARADOS:
//  - "Máquinas envolvidas na semana": máquinas únicas selecionadas (fato do cadastro da Previsão);
//  - "Funcionários necessários para executar esta programação": menor equipe que entrega a produção máxima (servidor, motor da Escala).
// Sem valor do servidor o texto diz "calculando…"/"indisponível": nunca cai para a contagem de máquinas.

import type { EstadoFuncionariosNecessarios } from "./useFuncionariosNecessarios";

export const ROTULO_FUNCIONARIOS_NECESSARIOS = "Funcionários necessários para executar esta programação";
export const ROTULO_MAQUINAS_ENVOLVIDAS = "Máquinas envolvidas na semana";

export function textoMaquinasEnvolvidas(n: number): string {
  return `${ROTULO_MAQUINAS_ENVOLVIDAS}: ${n}`;
}

/** Valor numérico do headcount, ou null quando o servidor ainda não respondeu / não há valor. */
export function funcionariosNecessariosDe(e: EstadoFuncionariosNecessarios): number | null {
  return e.status === "ok" ? e.dados.funcionariosNecessarios : null;
}

/** Só o valor (para a tela destacar em negrito): "14", "calculando…", "indisponível (motivo)" ou "—". */
export function valorFuncionariosNecessarios(e: EstadoFuncionariosNecessarios): string {
  if (e.status === "ok") return String(e.dados.funcionariosNecessarios);
  if (e.status === "calculando") return "calculando…";
  if (e.status === "indisponivel") return `indisponível (${e.motivo})`;
  return "—";
}

export function textoFuncionariosNecessarios(e: EstadoFuncionariosNecessarios): string {
  return `${ROTULO_FUNCIONARIOS_NECESSARIOS}: ${valorFuncionariosNecessarios(e)}`;
}

/** Comparação neutra com a equipe marcada na semana (não afirma nada sobre "ativos"). */
export function textoEquipeMarcada(necessarios: number | null, equipeProdutivaCount: number): string {
  const base = `equipe produtiva marcada nesta semana: ${equipeProdutivaCount}`;
  if (necessarios !== null && necessarios > equipeProdutivaCount) return `${base} — ${necessarios - equipeProdutivaCount} a menos do que o necessário`;
  return base;
}

export const TEXTO_USO_HORAS_MAQUINA =
  "Carga média: horas-máquina demandadas ÷ horas-máquina disponíveis da equipe produtiva na semana. Não é a % de pessoas necessárias nem o pico de equipe, e pode passar de 100% (carga acima da capacidade). Para saber quantas pessoas a programação exige, veja Funcionários necessários; para saber se a equipe tem posto em cada período, veja a Cobertura da equipe.";

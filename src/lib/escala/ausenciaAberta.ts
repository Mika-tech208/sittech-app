// Atraso em aberto (e correções/encerramentos) na Escala: janela de indisponibilidade e reconstrução "como era no corte" (sombra).
// Funções puras — sem IO.
import { minutosDoHorario } from "@/features/escala/tempo";
import type { AusenciaBruta, AusenciaHistorico } from "./estado";

// Fallback conservador quando o dia não tem períodos conhecidos (não ocorre na Escala: todo dia tem snapshot ou períodos atuais).
export const FIM_DO_DIA_MIN = 24 * 60;

// Fim da jornada do dia = o fim do último período do snapshot daquele dia (hoje 17:00). É o limite OPERACIONAL do atraso em aberto no motor;
// o banco continua com horario_fim = NULL enquanto estiver aberto (17:00 só é gravado no fechamento).
export function fimDaJornadaMin(periodos: { fim: string }[]): number {
  if (periodos.length === 0) return FIM_DO_DIA_MIN;
  return Math.max(...periodos.map((p) => minutosDoHorario(p.fim)));
}

interface LinhaHistoricoBruta {
  alterado_em: string;
  dados_anteriores: Record<string, unknown> | null;
}

// ausencia_funcionario_historico -> mudanças com o estado ANTERIOR (dados_anteriores = '{}' marca a abertura/criação).
export function historicoDaAusencia(linhas: LinhaHistoricoBruta[]): AusenciaHistorico[] {
  return linhas
    .map((l): AusenciaHistorico => {
      const d = l.dados_anteriores;
      if (!d || Object.keys(d).length === 0) return { alteradoEm: l.alterado_em, anterior: null };
      return {
        alteradoEm: l.alterado_em,
        anterior: {
          horarioInicio: (d.horario_inicio as string | null | undefined) ?? null,
          horarioFim: (d.horario_fim as string | null | undefined) ?? null,
          emAberto: d.em_aberto === true,
        },
      };
    })
    .sort((x, y) => Date.parse(x.alteradoEm) - Date.parse(y.alteradoEm));
}

// Como a ausência era no instante `corteMs`: null = ainda não existia. Desfaz, da mais recente para a mais antiga, as mudanças POSTERIORES ao corte
// (um atraso que estava aberto no corte e foi encerrado depois volta a ser lido como aberto; uma correção de horário posterior é desfeita).
export function ausenciaNoCorte(a: AusenciaBruta, corteMs: number): AusenciaBruta | null {
  if (a.registradaEm && Date.parse(a.registradaEm) > corteMs) return null;
  const posteriores = (a.historico ?? []).filter((h) => Date.parse(h.alteradoEm) > corteMs).sort((x, y) => Date.parse(y.alteradoEm) - Date.parse(x.alteradoEm));
  let atual: AusenciaBruta = a;
  for (const h of posteriores) {
    if (!h.anterior) continue; // abertura: a existência já foi decidida por registradaEm
    atual = { ...atual, horarioInicio: h.anterior.horarioInicio, horarioFim: h.anterior.horarioFim, emAberto: h.anterior.emAberto };
  }
  return atual;
}

// Janela [inicio, fim) em minutos do dia; null/null = dia inteiro. Em aberto: do início até o FIM DA JORNADA do dia (`fimJornadaMin`) — NUNCA dia inteiro,
// nunca 07:12–24:00 e nada gravado no banco (horario_fim segue NULL).
export function janelaDaAusencia(a: Pick<AusenciaBruta, "horarioInicio" | "horarioFim" | "emAberto">, fimJornadaMin: number = FIM_DO_DIA_MIN): { inicioMin: number | null; fimMin: number | null } {
  if (a.emAberto && a.horarioInicio) return { inicioMin: minutosDoHorario(a.horarioInicio), fimMin: fimJornadaMin };
  if (a.horarioInicio && a.horarioFim) return { inicioMin: minutosDoHorario(a.horarioInicio), fimMin: minutosDoHorario(a.horarioFim) };
  return { inicioMin: null, fimMin: null };
}

// Cálculo de duração de ausência — Faltas e Ausências V1.
//
// Jornada padrão global (decisão explícita, sem jornada individual por
// funcionário nesta V1): soma da duração de cada período cadastrado
// (M1/M2/M3/T1/T2/T3), reaproveitando a MESMA ideia já usada em
// src/lib/calculations/periodos.ts (calcularHorasPorDia) — o intervalo
// entre períodos (ex.: 12:00–13:00, almoço) nunca é coberto por nenhum
// período, então nunca entra na soma. Nenhuma lógica nova de "almoço":
// é só não contar o que não está dentro de nenhum período.
//
// Os tipos "dia inteiro" (falta_dia_inteiro, atestado, falta_justificada,
// falta_nao_justificada) usam a jornada inteira do dia. Os tipos "janela de
// horário" (atraso, saida_antecipada, saida_durante_expediente, outro)
// contam só os minutos dentro de algum período que caem dentro da janela
// informada — minutos fora de qualquer período (almoço ou qualquer buraco)
// nunca contam, mesmo que a janela os atravesse. "Outro" NÃO é dia inteiro
// (decisão explícita) — sempre pede início/fim, igual saída durante
// expediente; se no futuro precisar de "outro dia inteiro", é um tipo novo.

export type TipoAusencia =
  | "falta_dia_inteiro"
  | "atraso"
  | "saida_antecipada"
  | "saida_durante_expediente"
  | "atestado"
  | "falta_justificada"
  | "falta_nao_justificada"
  | "outro";

export const TIPOS_AUSENCIA: { valor: TipoAusencia; label: string }[] = [
  { valor: "falta_dia_inteiro", label: "Falta dia inteiro" },
  { valor: "atraso", label: "Atraso" },
  { valor: "saida_antecipada", label: "Saída antecipada" },
  { valor: "saida_durante_expediente", label: "Saída durante expediente" },
  { valor: "atestado", label: "Atestado" },
  { valor: "falta_justificada", label: "Falta justificada" },
  { valor: "falta_nao_justificada", label: "Falta não justificada" },
  { valor: "outro", label: "Outro" },
];

export const LABEL_TIPO_AUSENCIA: Record<TipoAusencia, string> = Object.fromEntries(
  TIPOS_AUSENCIA.map((t) => [t.valor, t.label])
) as Record<TipoAusencia, string>;

// Tipos que pedem um horário real da supervisora (os outros usam a
// jornada inteira do dia, sem nenhum campo de horário).
export const TIPOS_COM_HORARIO: TipoAusencia[] = ["atraso", "saida_antecipada", "saida_durante_expediente", "outro"];

// Dentro de TIPOS_COM_HORARIO: estes dois pedem uma JANELA explícita
// (início + fim, os dois horários reais) — os outros dois (atraso/saída
// antecipada) pedem só UM horário real, o outro lado vem da jornada.
export const TIPOS_COM_JANELA_EXPLICITA: TipoAusencia[] = ["saida_durante_expediente", "outro"];

export interface PeriodoSimples {
  id: string;
  nome: string;
  inicio: string; // "HH:MM"
  fim: string;
}

function minutosDoHorario(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function overlapMinutos(aIni: number, aFim: number, bIni: number, bFim: number): number {
  const ini = Math.max(aIni, bIni);
  const fim = Math.min(aFim, bFim);
  return Math.max(0, fim - ini);
}

// Soma, entre todos os períodos, só os minutos que caem dentro de
// [horaInicio, horaFim) — minutos fora de qualquer período (almoço,
// antes do primeiro período, depois do último) nunca contam.
export function minutosProdutivosEntre(periodos: PeriodoSimples[], horaInicio: string, horaFim: string): number {
  const ini = minutosDoHorario(horaInicio);
  const fim = minutosDoHorario(horaFim);
  if (fim <= ini) return 0;
  return periodos.reduce(
    (soma, p) => soma + overlapMinutos(ini, fim, minutosDoHorario(p.inicio), minutosDoHorario(p.fim)),
    0
  );
}

// Duração da jornada inteira do dia — soma de todos os períodos.
export function minutosJornadaCompleta(periodos: PeriodoSimples[]): number {
  return periodos.reduce((soma, p) => soma + Math.max(0, minutosDoHorario(p.fim) - minutosDoHorario(p.inicio)), 0);
}

// Início/fim da jornada do dia — o mais cedo que algum período começa e o
// mais tarde que algum período termina. Usado como "previsto" de
// atraso/saída antecipada.
export function jornadaInicioFim(periodos: PeriodoSimples[]): { inicio: string; fim: string } | null {
  if (periodos.length === 0) return null;
  const ordenados = [...periodos].sort((a, b) => minutosDoHorario(a.inicio) - minutosDoHorario(b.inicio));
  const fimMaisTarde = periodos.reduce((max, p) => (minutosDoHorario(p.fim) > minutosDoHorario(max.fim) ? p : max));
  return { inicio: ordenados[0].inicio, fim: fimMaisTarde.fim };
}

export interface ParametrosCalculoAusencia {
  tipo: TipoAusencia;
  periodos: PeriodoSimples[];
  // "atraso": horarioReal = chegada. "saida_antecipada": horarioReal = saída.
  horarioReal?: string;
  // TIPOS_COM_JANELA_EXPLICITA ("saida_durante_expediente", "outro"): os
  // dois horários reais da janela (saída/retorno, ou início/fim livre).
  horarioJanelaInicio?: string;
  horarioJanelaFim?: string;
}

export interface ResultadoCalculoAusencia {
  duracaoMinutos: number;
  horarioInicio: string | null;
  horarioFim: string | null;
}

// Função única de cálculo — usada pelo formulário (preview em tempo real)
// e reaproveitada igual antes de enviar à RPC.
export function calcularAusencia(params: ParametrosCalculoAusencia): ResultadoCalculoAusencia | null {
  const { tipo, periodos } = params;

  if (!TIPOS_COM_HORARIO.includes(tipo)) {
    return { duracaoMinutos: minutosJornadaCompleta(periodos), horarioInicio: null, horarioFim: null };
  }

  const jornada = jornadaInicioFim(periodos);
  if (!jornada) return null;

  if (tipo === "atraso") {
    if (!params.horarioReal) return null;
    return {
      duracaoMinutos: minutosProdutivosEntre(periodos, jornada.inicio, params.horarioReal),
      horarioInicio: jornada.inicio,
      horarioFim: params.horarioReal,
    };
  }

  if (tipo === "saida_antecipada") {
    if (!params.horarioReal) return null;
    return {
      duracaoMinutos: minutosProdutivosEntre(periodos, params.horarioReal, jornada.fim),
      horarioInicio: params.horarioReal,
      horarioFim: jornada.fim,
    };
  }

  // saida_durante_expediente / outro — janela explícita (início + fim reais)
  if (!params.horarioJanelaInicio || !params.horarioJanelaFim) return null;
  return {
    duracaoMinutos: minutosProdutivosEntre(periodos, params.horarioJanelaInicio, params.horarioJanelaFim),
    horarioInicio: params.horarioJanelaInicio,
    horarioFim: params.horarioJanelaFim,
  };
}

// ---- resumo mensal ----

// Tipos que contam como "falta" na coluna do resumo — todos os que usam a
// jornada inteira do dia (ver TIPOS_COM_HORARIO, o complemento). "Outro"
// não entra mais aqui — passou a exigir início/fim, não é mais dia inteiro.
const TIPOS_FALTA_DIA_INTEIRO: TipoAusencia[] = [
  "falta_dia_inteiro", "atestado", "falta_justificada", "falta_nao_justificada",
];

export interface AusenciaParaResumo {
  funcionarioId: string;
  tipo: TipoAusencia;
  duracaoMinutos: number;
}

export interface ResumoFuncionarioAusencias {
  funcionarioId: string;
  funcionarioNome: string;
  faltas: number;
  atrasos: number;
  saidasAntecipadas: number;
  minutosPerdidos: number;
}

// Uma linha por funcionário ATIVO (mesmo os sem nenhuma ausência no
// período — aparecem com tudo zerado) + agregação pronta pra linha TOTAL
// DA EQUIPE (soma de todas as linhas, não recalculada do zero).
export function calcularResumoPorFuncionario(
  ausencias: AusenciaParaResumo[],
  funcionariosAtivos: { id: string; nome: string }[]
): ResumoFuncionarioAusencias[] {
  return funcionariosAtivos
    .map((f) => {
      const dele = ausencias.filter((a) => a.funcionarioId === f.id);
      return {
        funcionarioId: f.id,
        funcionarioNome: f.nome,
        faltas: dele.filter((a) => TIPOS_FALTA_DIA_INTEIRO.includes(a.tipo)).length,
        atrasos: dele.filter((a) => a.tipo === "atraso").length,
        saidasAntecipadas: dele.filter((a) => a.tipo === "saida_antecipada").length,
        minutosPerdidos: dele.reduce((soma, a) => soma + a.duracaoMinutos, 0),
      };
    })
    .sort((a, b) => a.funcionarioNome.localeCompare(b.funcionarioNome, "pt-BR"));
}

export function calcularTotalEquipe(linhas: ResumoFuncionarioAusencias[]): Omit<ResumoFuncionarioAusencias, "funcionarioId" | "funcionarioNome"> {
  return linhas.reduce(
    (tot, l) => ({
      faltas: tot.faltas + l.faltas,
      atrasos: tot.atrasos + l.atrasos,
      saidasAntecipadas: tot.saidasAntecipadas + l.saidasAntecipadas,
      minutosPerdidos: tot.minutosPerdidos + l.minutosPerdidos,
    }),
    { faltas: 0, atrasos: 0, saidasAntecipadas: 0, minutosPerdidos: 0 }
  );
}

// Disponibilidade = (horas previstas - horas de ausência) / horas previstas.
// `minutosPrevistosEquipe` já deve vir pronto do chamador — reaproveita
// calcularHorasProdutivasFuncionario/calcularTotalHorasProdutivasEmpresa
// (src/features/custo-hora/calculations.ts), mesma fórmula já usada no
// Custo por Hora, não uma conta nova.
export function calcularDisponibilidadePct(minutosPrevistosEquipe: number, minutosPerdidosEquipe: number): number | null {
  if (minutosPrevistosEquipe <= 0) return null;
  const pct = ((minutosPrevistosEquipe - minutosPerdidosEquipe) / minutosPrevistosEquipe) * 100;
  return Math.max(0, Math.min(100, pct));
}

// "1h48" — mesmo formato dos exemplos que motivaram a feature.
export function formatarDuracao(minutos: number): string {
  if (minutos <= 0) return "0min";
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

// Atraso em aberto — regras de apresentação/validação no cliente. O banco é a autoridade (RPCs abrir/encerrar/corrigir); aqui só se evita o erro óbvio
// e se calcula o que a tela mostra ("Desde 07:12", minutos até agora). "Agora" e "hoje" são SEMPRE o relógio de America/Sao_Paulo.
import { jornadaInicioFim, minutosProdutivosEntre, type PeriodoSimples } from "./calculations";

const FUSO = "America/Sao_Paulo";

function partesSP(agora: Date): Record<string, string> {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return Object.fromEntries(f.formatToParts(agora).map((p) => [p.type, p.value]));
}

export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  const p = partesSP(agora);
  return `${p.year}-${p.month}-${p.day}`;
}

export function horaEmSaoPaulo(agora: Date = new Date()): string {
  const p = partesSP(agora);
  return `${p.hour}:${p.minute}`;
}

export const hhmm = (t: string | null | undefined): string => (t ? t.slice(0, 5) : "");
const min = (t: string): number => {
  const [h, m] = hhmm(t).split(":").map(Number);
  return h * 60 + m;
};

// Horários em que um atraso em aberto pode começar: início da manhã e início da tarde (primeiro período depois do almoço).
export function opcoesInicioAtraso(periodos: PeriodoSimples[]): { valor: string; label: string }[] {
  const ord = [...periodos].sort((a, b) => min(a.inicio) - min(b.inicio));
  if (ord.length === 0) return [];
  const opcoes = [{ valor: hhmm(ord[0].inicio), label: `Início da manhã (${hhmm(ord[0].inicio)})` }];
  const aposAlmoco = ord.find((p, i) => i > 0 && min(p.inicio) > min(ord[i - 1].fim));
  if (aposAlmoco) opcoes.push({ valor: hhmm(aposAlmoco.inicio), label: `Após o almoço (${hhmm(aposAlmoco.inicio)})` });
  return opcoes;
}

// Minutos produtivos já perdidos até agora por um atraso em aberto (almoço não conta; o limite é o fim da jornada). Só exibição: o banco grava 0 até encerrar.
export function minutosEmAndamento(periodos: PeriodoSimples[], horarioInicio: string, agoraHHMM: string): number {
  const j = jornadaInicioFim(periodos);
  const ate = j && min(agoraHHMM) > min(j.fim) ? j.fim : agoraHHMM;
  return minutosProdutivosEntre(periodos, hhmm(horarioInicio), ate);
}

export interface AtrasoAbertoVisao {
  texto: string; // "Desde 07:12 · EM ABERTO"
  // Aberto de um dia anterior = inconsistência operacional (o fechamento automático deveria ter encerrado às 17:00).
  inconsistente: boolean;
}

export function visaoAtrasoAberto(a: { data: string; horarioInicio: string | null }, hoje: string): AtrasoAbertoVisao {
  const inconsistente = a.data < hoje;
  return { texto: `Desde ${hhmm(a.horarioInicio)} · EM ABERTO`, inconsistente };
}

// Chegada informada à mão: mesmo dia, depois do início, não no futuro, dentro da jornada. Retorna a mensagem do erro ou null.
export function validarChegadaInformada(a: { data: string; horarioInicio: string }, chegada: string, periodos: PeriodoSimples[], hoje: string, agoraHHMM: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(chegada)) return "Informe o horário de chegada.";
  if (a.data > hoje) return "Este atraso é de um dia futuro.";
  if (min(chegada) <= min(a.horarioInicio)) return `A chegada precisa ser depois do início do atraso (${hhmm(a.horarioInicio)}).`;
  const j = jornadaInicioFim(periodos);
  if (j && min(chegada) > min(j.fim)) return `A chegada não pode ser depois do fim da jornada (${j.fim}).`;
  if (a.data === hoje && min(chegada) > min(agoraHHMM)) return "A chegada não pode estar no futuro.";
  return null;
}

// Utilitários de tempo do motor — funções puras. O fuso operacional é
// America/Sao_Paulo (a fábrica); o motor em si só vê minutos do dia e
// milissegundos absolutos já calculados por estas funções.

import type { PeriodoEscala, SlotEscala } from "./types";

export const FUSO_OPERACIONAL = "America/Sao_Paulo";

export function minutosDoHorario(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

// [a,b) e [c,d) se sobrepõem quando a<d e c<b — janelas que só se encostam
// (b == c) NÃO se sobrepõem.
export function sobrepoe(aIni: number, aFim: number, bIni: number, bFim: number): boolean {
  return aIni < bFim && bIni < aFim;
}

// Instante absoluto (ms) de "data hh:mm" no fuso operacional.
export function epochMsNoFuso(data: string, hhmm: string, fuso: string = FUSO_OPERACIONAL): number {
  const [y, mo, d] = data.split("-").map(Number);
  const [h, mi] = hhmm.slice(0, 5).split(":").map(Number);
  const chute = Date.UTC(y, mo - 1, d, h, mi);
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(chute));
  const p = (t: string) => Number(partes.find((x) => x.type === t)?.value);
  const localComoUtc = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second"));
  return chute - (localComoUtc - chute);
}

// "YYYY-MM-DD" e "HH:MM" locais (fuso operacional) de um instante absoluto.
export function dataHoraNoFuso(ms: number, fuso: string = FUSO_OPERACIONAL): { data: string; minutos: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms));
  const p = (t: string) => partes.find((x) => x.type === t)!.value;
  return { data: `${p("year")}-${p("month")}-${p("day")}`, minutos: Number(p("hour")) * 60 + Number(p("minute")) };
}

export interface DiaParaSlots {
  data: string;
  periodos: PeriodoEscala[];
  // Dia que deixou de ser produtivo mas já tem períodos iniciados: só os
  // períodos com início <= este instante entram (consumo congelado).
  somenteIniciadosAte?: number;
}

// Slots da semana: dias (ordenados) × períodos válidos (duração > 0,
// ordenados por id — m1,m2,m3,t1,t2,t3). Cada dia pode ter seus próprios
// horários (snapshot do dia).
export function construirSlotsDeDias(dias: DiaParaSlots[], fuso: string = FUSO_OPERACIONAL): SlotEscala[] {
  const slots: SlotEscala[] = [];
  [...dias].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0)).forEach((dia) => {
    const validos = [...dia.periodos]
      .filter((p) => minutosDoHorario(p.fim) > minutosDoHorario(p.inicio))
      .sort((a, b) => a.id.localeCompare(b.id));
    let primeiro = true;
    validos.forEach((p) => {
      const inicioMs = epochMsNoFuso(dia.data, p.inicio, fuso);
      if (dia.somenteIniciadosAte !== undefined && inicioMs > dia.somenteIniciadosAte) return;
      slots.push({
        data: dia.data,
        periodoId: p.id,
        indice: slots.length,
        primeiroDoDia: primeiro,
        inicioMin: minutosDoHorario(p.inicio),
        fimMin: minutosDoHorario(p.fim),
        inicioMs,
        fimMs: epochMsNoFuso(dia.data, p.fim, fuso),
      });
      primeiro = false;
    });
  });
  return slots;
}

// Atalho: mesmos períodos em todos os dias produtivos.
export function construirSlots(diasProdutivos: string[], periodos: PeriodoEscala[], fuso: string = FUSO_OPERACIONAL): SlotEscala[] {
  return construirSlotsDeDias(diasProdutivos.map((data) => ({ data, periodos })), fuso);
}

// Primeiro slot AINDA NÃO INICIADO (início estritamente depois de `agoraMs`).
// O período em andamento e os concluídos ficam congelados. Se não houver
// nenhum slot futuro, devolve slots.length (nada mutável).
export function primeiroSlotFuturo(slots: SlotEscala[], agoraMs: number): number {
  const i = slots.findIndex((s) => s.inicioMs > agoraMs);
  return i === -1 ? slots.length : i;
}

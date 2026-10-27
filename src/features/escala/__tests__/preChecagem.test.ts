import { describe, it, expect } from "vitest";
import { dentroDaJanelaPreChecagem, proximaPreChecagemMs } from "../preChecagem";
import { dataHoraNoFuso, epochMsNoFuso } from "../tempo";
import { PERIODOS_REAIS } from "./helpers";

const DIA = "2026-10-27";
const em = (hhmm: string, dia = DIA) => epochMsNoFuso(dia, hhmm);
const hhmm = (ms: number) => { const { minutos } = dataHoraNoFuso(ms); return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`; };

describe("pré-checagem: início do período − 5 min (America/Sao_Paulo)", () => {
  it("os alvos do dia são 07:07, 08:43, 10:19, 12:55, 14:15 e 15:35", () => {
    const alvos: string[] = [];
    let cursor = em("00:00");
    for (let i = 0; i < 7; i++) {
      const prox = proximaPreChecagemMs(cursor, PERIODOS_REAIS);
      if (prox === null || dataHoraNoFuso(prox).data !== DIA) break;
      alvos.push(hhmm(prox)); cursor = prox;
    }
    expect(alvos).toEqual(["07:07", "08:43", "10:19", "12:55", "14:15", "15:35"]);
  });
  it("depois do último alvo do dia o próximo é 07:07 de amanhã", () => {
    const p = proximaPreChecagemMs(em("16:00"), PERIODOS_REAIS) as number;
    expect(dataHoraNoFuso(p).data).toBe("2026-10-28");
    expect(hhmm(p)).toBe("07:07");
  });
  it("atraso de alguns minutos: 12:57 ainda é a janela de T1 (13:00)", () => {
    expect(dentroDaJanelaPreChecagem(em("12:57"), PERIODOS_REAIS)).toBe(true);
    expect(dentroDaJanelaPreChecagem(em("12:54"), PERIODOS_REAIS)).toBe(true);
    expect(dentroDaJanelaPreChecagem(em("12:53"), PERIODOS_REAIS)).toBe(false);
  });
  it("depois do início a janela ainda vale (o período em andamento não é reescrito pelo horizonte) e fecha em 15 min", () => {
    expect(dentroDaJanelaPreChecagem(em("13:10"), PERIODOS_REAIS)).toBe(true);
    expect(dentroDaJanelaPreChecagem(em("13:16"), PERIODOS_REAIS)).toBe(false);
  });
  it("fora de qualquer janela (ex.: 11:30, 17:30) não faz a verificação completa", () => {
    expect(dentroDaJanelaPreChecagem(em("11:30"), PERIODOS_REAIS)).toBe(false);
    expect(dentroDaJanelaPreChecagem(em("17:30"), PERIODOS_REAIS)).toBe(false);
  });
  it("sem períodos: nada a agendar", () => {
    expect(proximaPreChecagemMs(em("10:00"), [])).toBeNull();
    expect(dentroDaJanelaPreChecagem(em("10:00"), [])).toBe(false);
  });
});

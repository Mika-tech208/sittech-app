// ATRASO EM ABERTO na Escala: o funcionário que ainda não chegou fica indisponível do horário inicial até o fim do dia (nunca "dia inteiro" por engano);
// ao chegar, a disponibilidade volta a valer exatamente a partir do primeiro período que NÃO se sobrepõe à janela [início, chegada).
import { describe, it, expect } from "vitest";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { ausenciaNoCorte, fimDaJornadaMin, FIM_DO_DIA_MIN, historicoDaAusencia, janelaDaAusencia } from "../ausenciaAberta";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import type { AusenciaBruta } from "../estado";
import { montarEntradaEscala } from "../montarEntrada";
import { estadoNoCorte } from "../sombraServico";
import { estadoDeTeste, Mundo } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = [SEMANA, "2026-11-03"];
const P = ["m1", "m2", "m3", "t1", "t2", "t3"];
const F = "f03";
const aberto = (inicio: string, extra: Partial<AusenciaBruta> = {}): AusenciaBruta => ({ funcionarioId: F, data: SEMANA, horarioInicio: inicio, horarioFim: null, emAberto: true, ...extra });
const fechado = (inicio: string, fim: string): AusenciaBruta => ({ funcionarioId: F, data: SEMANA, horarioInicio: inicio, horarioFim: fim, emAberto: false });

// períodos em que F tem LINHA (posto ou ocioso) no dia: sem linha = indisponível
function periodosDe(aus: AusenciaBruta[], agoraMs = epochMsNoFuso("2026-10-30", "10:00")): string[] {
  const e = estadoDeTeste(SEMANA, DIAS, { pessoas: 10 });
  e.ausencias = aus;
  const r = gerarEscala(montarEntradaEscala(e, agoraMs).entrada);
  return P.filter((p) => r.alocacoes.some((a) => a.funcionarioId === F && a.data === SEMANA && a.periodoId === p));
}

describe("janela da ausência (montarEntrada)", () => {
  it("em aberto: [início, FIM DA JORNADA) — nunca dia inteiro, nunca 24:00 e nada gravado (o banco guarda horario_fim NULL)", () => {
    expect(janelaDaAusencia({ horarioInicio: "07:12:00", horarioFim: null, emAberto: true }, 17 * 60)).toEqual({ inicioMin: 432, fimMin: 1020 });
    expect(janelaDaAusencia({ horarioInicio: "13:00:00", horarioFim: null, emAberto: true }, 17 * 60)).toEqual({ inicioMin: 780, fimMin: 1020 });
    const e = estadoDeTeste(SEMANA, DIAS);
    e.ausencias = [aberto("07:12:00")];
    const a = montarEntradaEscala(e, epochMsNoFuso("2026-10-30", "10:00")).entrada.ausencias;
    expect(a).toEqual([{ funcionarioId: F, data: SEMANA, inicioMin: 432, fimMin: 1020 }]);
  });
  it("o fim da jornada vem do snapshot do DIA (jornada diferente => limite diferente); sem períodos, cai no fim do dia", () => {
    expect(fimDaJornadaMin(PERIODOS_REAIS)).toBe(1020);
    expect(fimDaJornadaMin([{ fim: "12:00" }, { fim: "16:30" }])).toBe(990);
    expect(fimDaJornadaMin([])).toBe(FIM_DO_DIA_MIN);
    const e = estadoDeTeste(SEMANA, DIAS);
    e.ausencias = [aberto("07:12:00")];
    e.diasExistentes = [{ data: SEMANA, versao: 0, periodosSnapshot: PERIODOS_REAIS.map((p) => (p.id === "t3" ? { ...p, fim: "16:30" } : p)) }];
    expect(montarEntradaEscala(e, epochMsNoFuso("2026-10-30", "10:00")).entrada.ausencias[0].fimMin).toBe(990);
  });
  it("fechado: janela exata [início, chegada); null/null segue sendo dia inteiro (falta)", () => {
    expect(janelaDaAusencia({ horarioInicio: "07:12:00", horarioFim: "08:03:00" })).toEqual({ inicioMin: 432, fimMin: 483 });
    expect(janelaDaAusencia({ horarioInicio: null, horarioFim: null })).toEqual({ inicioMin: null, fimMin: null });
  });
});

describe("disponibilidade por período (regra do período inteiro)", () => {
  it("sem ausência: tem linha em todos os períodos (base do contraste)", () => {
    expect(periodosDe([])).toEqual(P);
  });
  it("EM ABERTO desde 07:12: indisponível o dia todo; o dia seguinte não é afetado", () => {
    expect(periodosDe([aberto("07:12:00")])).toEqual([]);
    const e = estadoDeTeste(SEMANA, DIAS, { pessoas: 10 });
    e.ausencias = [aberto("07:12:00")];
    const r = gerarEscala(montarEntradaEscala(e, epochMsNoFuso("2026-10-30", "10:00")).entrada);
    expect(P.filter((p) => r.alocacoes.some((a) => a.funcionarioId === F && a.data === "2026-11-03" && a.periodoId === p))).toEqual(P);
  });
  it("07:12 → 08:03: indisponível em M1; disponível a partir de M2", () => {
    expect(periodosDe([fechado("07:12:00", "08:03:00")])).toEqual(["m2", "m3", "t1", "t2", "t3"]);
  });
  it("07:12 → 09:10 (depois do início de M2): indisponível em M1 e M2; disponível a partir de M3", () => {
    expect(periodosDe([fechado("07:12:00", "09:10:00")])).toEqual(["m3", "t1", "t2", "t3"]);
  });
  it("07:12 → 11:00 (atravessa M1–M3): disponível a partir de T1", () => {
    expect(periodosDe([fechado("07:12:00", "11:00:00")])).toEqual(["t1", "t2", "t3"]);
  });
  it("tarde: 13:00 → 13:37: indisponível em T1; disponível a partir de T2 (a manhã não é afetada)", () => {
    expect(periodosDe([fechado("13:00:00", "13:37:00")])).toEqual(["m1", "m2", "m3", "t2", "t3"]);
  });
  it("tarde sem chegada: 13:00 em aberto = 13:00–17:00, NÃO falta do dia inteiro (manhã segue disponível)", () => {
    expect(periodosDe([aberto("13:00:00")])).toEqual(["m1", "m2", "m3"]);
  });
  it("fechamento automático às 17:00 (fim efetivo = 17:00): equivale a nunca ter chegado — manhã inteira indisponível; tarde idem", () => {
    expect(periodosDe([fechado("07:12:00", "17:00:00")])).toEqual([]);
    expect(periodosDe([fechado("13:00:00", "17:00:00")])).toEqual(["m1", "m2", "m3"]);
  });
  it("chegada ANTES do próximo período (08:03) e DEPOIS do início dele (09:10) divergem exatamente em M2", () => {
    const a = periodosDe([fechado("07:12:00", "08:03:00")]);
    const b = periodosDe([fechado("07:12:00", "09:10:00")]);
    expect(a.includes("m2")).toBe(true);
    expect(b.includes("m2")).toBe(false);
  });
  it("correção do início/chegada muda a disponibilidade de acordo (08:03 → 09:10 tira o M2 de volta)", () => {
    expect(periodosDe([fechado("07:12:00", "08:03:00")]).includes("m2")).toBe(true);
    expect(periodosDe([fechado("07:12:00", "09:10:00")]).includes("m2")).toBe(false);
  });
});

describe("como era no corte (sombra / hindsight)", () => {
  const T = (hhmm: string) => `2026-11-02T${hhmm.length === 5 ? hhmm + ":00" : hhmm}-03:00`;
  const hist = historicoDaAusencia([
    { alterado_em: T("07:20:00"), dados_anteriores: {} }, // abertura
    { alterado_em: T("07:40:00"), dados_anteriores: { horario_inicio: "07:12:00", horario_fim: null, em_aberto: true } }, // correção do início 07:12 -> 07:30 (ainda aberto)
    { alterado_em: T("08:03:00"), dados_anteriores: { horario_inicio: "07:30:00", horario_fim: null, em_aberto: true } }, // encerramento com chegada
  ]);
  // linha atual: início 07:30, fim 08:03, fechada
  const atual: AusenciaBruta = { funcionarioId: F, data: SEMANA, horarioInicio: "07:30:00", horarioFim: "08:03:00", emAberto: false, registradaEm: T("07:20:00"), historico: hist };
  const ms = (hhmm: string) => Date.parse(T(hhmm));

  it("antes da abertura: a ausência ainda não existia", () => {
    expect(ausenciaNoCorte(atual, ms("07:10"))).toBeNull();
  });
  it("snapshot das 07:30 vê o atraso EM ABERTO com o início original", () => {
    const x = ausenciaNoCorte(atual, ms("07:30"))!;
    expect(x.emAberto).toBe(true);
    expect(x.horarioFim).toBeNull();
    expect(x.horarioInicio).toBe("07:12:00");
  });
  it("snapshot das 07:50 (depois da correção, antes da chegada) vê aberto com o início corrigido", () => {
    const x = ausenciaNoCorte(atual, ms("07:50"))!;
    expect(x.emAberto).toBe(true);
    expect(x.horarioInicio).toBe("07:30:00");
  });
  it("snapshot posterior à chegada vê o atraso FECHADO", () => {
    const x = ausenciaNoCorte(atual, ms("09:00"))!;
    expect(x.emAberto).toBe(false);
    expect(x.horarioFim).toBe("08:03:00");
    expect(janelaDaAusencia(x)).toEqual({ inicioMin: 450, fimMin: 483 });
  });
  it("sem hindsight: snapshot das 08:30 vê o funcionário INDISPONÍVEL (aberto até o fim da jornada); a chegada das 08:40 não o altera; o corte posterior vê o atraso encerrado às 08:40", () => {
    const h = historicoDaAusencia([
      { alterado_em: T("07:20"), dados_anteriores: {} },
      { alterado_em: T("08:40"), dados_anteriores: { horario_inicio: "07:12:00", horario_fim: null, em_aberto: true } },
    ]);
    const a: AusenciaBruta = { funcionarioId: F, data: SEMANA, horarioInicio: "07:12:00", horarioFim: "08:40:00", emAberto: false, registradaEm: T("07:20"), historico: h };
    const e = estadoDeTeste(SEMANA, DIAS);
    e.ausencias = [a];
    const janela = (corte: string) => montarEntradaEscala(estadoNoCorte(e, ms(corte)), ms(corte)).entrada.ausencias.find((x) => x.funcionarioId === F);
    expect(janela("08:30")).toEqual({ funcionarioId: F, data: SEMANA, inicioMin: 432, fimMin: 1020 }); // aberto: [07:12, 17:00)
    expect(janela("08:30")).toEqual(janela("08:39")); // nada muda até a chegada
    expect(janela("08:45")).toEqual({ funcionarioId: F, data: SEMANA, inicioMin: 432, fimMin: 520 }); // encerrado às 08:40: [07:12, 08:40)
    // a decisão do corte 08:30 é reproduzível depois da chegada (mesma entrada canônica)
    expect(JSON.stringify(janela("08:30"))).toBe(JSON.stringify(montarEntradaEscala(estadoNoCorte(e, ms("08:30")), ms("08:30")).entrada.ausencias.find((x) => x.funcionarioId === F)));
  });
  it("fechamento automático: snapshot das 16:00 vê aberto; o das 17:30 vê fechado até 17:00", () => {
    const h = historicoDaAusencia([
      { alterado_em: T("07:20:00"), dados_anteriores: {} },
      { alterado_em: T("17:12:00"), dados_anteriores: { horario_inicio: "07:12:00", horario_fim: null, em_aberto: true } },
    ]);
    const a: AusenciaBruta = { funcionarioId: F, data: SEMANA, horarioInicio: "07:12:00", horarioFim: "17:00:00", emAberto: false, registradaEm: T("07:20:00"), historico: h };
    expect(ausenciaNoCorte(a, ms("16:00"))!.emAberto).toBe(true);
    expect(ausenciaNoCorte(a, ms("17:30"))!.horarioFim).toBe("17:00:00");
  });
  it("estadoNoCorte aplica a reconstrução ao estado inteiro; ausência sem histórico (legado) continua valendo como antes", () => {
    const e = estadoDeTeste(SEMANA, DIAS);
    const legado: AusenciaBruta = { funcionarioId: "f04", data: SEMANA, horarioInicio: null, horarioFim: null, registradaEm: T("06:00:00") };
    e.ausencias = [atual, legado];
    const no0730 = estadoNoCorte(e, ms("07:30")).ausencias;
    expect(no0730.map((a) => a.funcionarioId).sort()).toEqual([F, "f04"]);
    expect(no0730.find((a) => a.funcionarioId === F)!.emAberto).toBe(true);
    expect(estadoNoCorte(e, ms("07:10")).ausencias.map((a) => a.funcionarioId)).toEqual(["f04"]);
  });
});

describe("replanejamento: abrir, corrigir e encerrar o atraso mudam o plano futuro; passado e período em andamento não mudam", () => {
  const D = SEMANA;
  const base = epochMsNoFuso("2026-10-30", "10:00");
  const at = (hhmm: string) => epochMsNoFuso(D, hhmm);

  it("abrir às 07:20: M1 (em andamento) preservado; F sem linha de M2 em diante. Encerrar às 08:03: F volta a partir de M2. Fechar de novo (09:10) tira M2.", async () => {
    const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
    await m.recalcular(base, true);
    const m1Antes = JSON.stringify(m.alocacoes.filter((a) => a.data === D && a.periodoId === "m1").sort((x, y) => (x.funcionarioId < y.funcionarioId ? -1 : 1)));

    m.editar((e) => e.ausencias.push(aberto("07:12:00")));
    await m.recalcular(at("07:20"));
    const linhas = (p: string) => m.alocacoes.filter((a) => a.funcionarioId === F && a.data === D && a.periodoId === p).length;
    expect(JSON.stringify(m.alocacoes.filter((a) => a.data === D && a.periodoId === "m1").sort((x, y) => (x.funcionarioId < y.funcionarioId ? -1 : 1)))).toBe(m1Antes); // período em andamento não é reotimizado
    expect(linhas("m1")).toBe(1);
    ["m2", "m3", "t1", "t2", "t3"].forEach((p) => expect(linhas(p)).toBe(0));

    // chegou às 08:03 => janela [07:12, 08:03): disponível a partir de M2
    m.editar((e) => (e.ausencias = [fechado("07:12:00", "08:03:00")]));
    await m.recalcular(at("08:03"));
    ["m2", "m3", "t1", "t2", "t3"].forEach((p) => expect(linhas(p)).toBe(1));
    expect(linhas("m1")).toBe(1); // o passado continua como estava
  });

  it("encerrar com chegada que atravessa M2 (09:10): M2 em andamento às 09:10 não ganha F; disponível a partir de M3", async () => {
    const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
    await m.recalcular(base, true);
    m.editar((e) => e.ausencias.push(aberto("07:12:00")));
    await m.recalcular(at("07:20"));
    m.editar((e) => (e.ausencias = [fechado("07:12:00", "09:10:00")]));
    await m.recalcular(at("09:10"));
    const linhas = (p: string) => m.alocacoes.filter((a) => a.funcionarioId === F && a.data === D && a.periodoId === p).length;
    expect(linhas("m2")).toBe(0);
    ["m3", "t1", "t2", "t3"].forEach((p) => expect(linhas(p)).toBe(1));
  });

  it("tarde: aberto 13:00 às 13:10 => T1 em andamento preservado, T2/T3 sem F; chegou 13:37 => F volta em T2", async () => {
    const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
    await m.recalcular(base, true);
    m.editar((e) => e.ausencias.push(aberto("13:00:00")));
    await m.recalcular(at("13:10"));
    const linhas = (p: string) => m.alocacoes.filter((a) => a.funcionarioId === F && a.data === D && a.periodoId === p).length;
    ["m1", "m2", "m3", "t1"].forEach((p) => expect(linhas(p)).toBe(1));
    ["t2", "t3"].forEach((p) => expect(linhas(p)).toBe(0));
    m.editar((e) => (e.ausencias = [fechado("13:00:00", "13:37:00")]));
    await m.recalcular(at("13:37"));
    ["t2", "t3"].forEach((p) => expect(linhas(p)).toBe(1));
  });

  it("dia seguinte independente: o atraso do dia 02/11 não influencia 03/11 (nem aberto, nem fechado automaticamente)", async () => {
    const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
    await m.recalcular(base, true);
    m.editar((e) => e.ausencias.push(aberto("07:12:00")));
    await m.recalcular(at("07:20"));
    const dia2 = m.alocacoes.filter((a) => a.funcionarioId === F && a.data === "2026-11-03").length;
    expect(dia2).toBe(P.length);
  });
});

// DESATIVAR funcionário (histórico preservado): linha do tempo bitemporal (sombra sem hindsight) e efeito na Escala (passado intacto, futuro sem a pessoa).
import { describe, it, expect } from "vitest";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EstadoBruto, SituacaoFuncionarioEvento } from "../estado";
import { montarEntradaEscala } from "../montarEntrada";
import { ativoNoCorte, historicoDeSituacao } from "../situacaoFuncionario";
import { estadoNoCorte } from "../sombraServico";
import { estadoDeTeste, Mundo } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = [SEMANA, "2026-11-03"];
const F = "f03";
const ms = (iso: string) => Date.parse(iso);

// João saiu na sexta 30/10 às 17:00 (efetivo) e o admin registrou na segunda 02/11 às 08:00
const DESATIVADO: SituacaoFuncionarioEvento = { acao: "desativado", efetivoEm: "2026-10-30T17:00:00-03:00", registradoEm: "2026-11-02T08:00:00-03:00", ativoAntes: true, ativoDepois: false };
const REATIVADO: SituacaoFuncionarioEvento = { acao: "reativado", efetivoEm: "2026-11-02T12:00:00-03:00", registradoEm: "2026-11-02T13:30:00-03:00", ativoAntes: false, ativoDepois: true };

describe("ativoNoCorte (espelho de funcionario_ativo_em)", () => {
  it("sem eventos (cadastro anterior à linha do tempo): vale o estado atual", () => {
    expect(ativoNoCorte(undefined, ms("2026-11-02T10:00:00-03:00"), null, true)).toBe(true);
    expect(ativoNoCorte([], ms("2026-11-02T10:00:00-03:00"), null, false)).toBe(false);
  });
  it("conhecendo tudo: antes do efetivo estava ativo; no efetivo e depois, inativo", () => {
    expect(ativoNoCorte([DESATIVADO], ms("2026-10-30T16:59:00-03:00"), null, false)).toBe(true);
    expect(ativoNoCorte([DESATIVADO], ms("2026-10-30T17:00:00-03:00"), null, false)).toBe(false);
    expect(ativoNoCorte([DESATIVADO], ms("2026-11-03T10:00:00-03:00"), null, false)).toBe(false);
  });
  it("registro posterior ao desligamento: um corte ANTES do registro não o conhece (sem hindsight), mesmo com o efetivo anterior", () => {
    const corte = ms("2026-11-02T07:30:00-03:00");
    expect(ativoNoCorte([DESATIVADO], corte, corte, false)).toBe(true);
    const corteDepois = ms("2026-11-02T08:30:00-03:00");
    expect(ativoNoCorte([DESATIVADO], corteDepois, corteDepois, false)).toBe(false);
  });
  it("reativação temporal: inativo entre o desligamento e a reativação; ativo antes e depois; reativação ainda não registrada não vale", () => {
    const ev = [DESATIVADO, REATIVADO];
    expect(ativoNoCorte(ev, ms("2026-11-02T09:00:00-03:00"), null, true)).toBe(false);
    expect(ativoNoCorte(ev, ms("2026-11-02T12:30:00-03:00"), null, true)).toBe(true);
    // corte às 13:00: a reativação tem efetivo 12:00, mas só foi registrada 13:30 => o corte ainda a desconhece
    expect(ativoNoCorte(ev, ms("2026-11-02T13:00:00-03:00"), ms("2026-11-02T13:00:00-03:00"), true)).toBe(false);
    expect(ativoNoCorte(ev, ms("2026-11-02T14:00:00-03:00"), ms("2026-11-02T14:00:00-03:00"), true)).toBe(true);
  });
  it("historicoDeSituacao agrupa por funcionário", () => {
    const h = historicoDeSituacao([{ funcionario_id: F, acao: "desativado", efetivo_em: DESATIVADO.efetivoEm, registrado_em: DESATIVADO.registradoEm, ativo_antes: true, ativo_depois: false }]);
    expect(h[F]).toEqual([DESATIVADO]);
  });
});

function estadoComEventos(eventos: SituacaoFuncionarioEvento[], ativoAtual: boolean): EstadoBruto {
  const e = estadoDeTeste(SEMANA, DIAS, { pessoas: 10 });
  e.equipeProdutiva = e.equipeProdutiva.map((m) => (m.funcionarioId === F ? { ...m, ativo: ativoAtual } : m));
  e.situacaoFuncionarios = { [F]: eventos };
  return e;
}
const noPool = (e: EstadoBruto, corteMs: number) => montarEntradaEscala(estadoNoCorte(e, corteMs), corteMs).entrada.funcionarios.some((f) => f.id === F);

describe("sombra: pool no corte (sem hindsight)", () => {
  it("corte às 07:30, ANTES do registro (08:00): o desligamento ainda não existe para ele => a pessoa está no pool", () => {
    const e = estadoComEventos([DESATIVADO], false);
    expect(noPool(e, ms("2026-11-02T07:30:00-03:00"))).toBe(true);
  });
  it("corte às 09:00, depois do registro: fora do pool", () => {
    const e = estadoComEventos([DESATIVADO], false);
    expect(noPool(e, ms("2026-11-02T09:00:00-03:00"))).toBe(false);
  });
  it("com reativação: corte às 13:00 (reativação ainda não registrada) segue fora; às 14:00, de volta ao pool", () => {
    const e = estadoComEventos([DESATIVADO, REATIVADO], true);
    expect(noPool(e, ms("2026-11-02T13:00:00-03:00"))).toBe(false);
    expect(noPool(e, ms("2026-11-02T14:00:00-03:00"))).toBe(true);
  });
  it("sem linha do tempo (legado): o `ativo` atual vale, como antes", () => {
    const e = estadoDeTeste(SEMANA, DIAS, { pessoas: 10 });
    e.equipeProdutiva = e.equipeProdutiva.map((m) => (m.funcionarioId === F ? { ...m, ativo: false } : m));
    expect(noPool(e, ms("2026-11-02T09:00:00-03:00"))).toBe(false);
  });
});

describe("Escala oficial: desativar no meio da semana não toca o passado e retira a pessoa do futuro", () => {
  const agora = (hhmm: string) => epochMsNoFuso(SEMANA, hhmm);
  const linhasDe = (m: Mundo, periodos: string[]) => m.alocacoes.filter((a) => a.funcionarioId === F && a.data === SEMANA && periodos.includes(a.periodoId));

  it("desativado às 09:00 (M2 em andamento): M1 e M2 ficam como estavam; de M3 em diante e o dia seguinte, sem a pessoa", async () => {
    const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
    await m.recalcular(epochMsNoFuso("2026-10-30", "10:00"), true);
    const antes = JSON.stringify(linhasDe(m, ["m1", "m2"]));
    expect(linhasDe(m, ["m1", "m2"]).length).toBe(2);
    expect(linhasDe(m, ["m3", "t1", "t2", "t3"]).length).toBe(4);

    m.editar((e) => (e.equipeProdutiva = e.equipeProdutiva.map((x) => (x.funcionarioId === F ? { ...x, ativo: false } : x))));
    await m.recalcular(agora("09:00"));
    expect(JSON.stringify(linhasDe(m, ["m1", "m2"]))).toBe(antes); // passado e período em andamento intactos
    expect(linhasDe(m, ["m3", "t1", "t2", "t3"]).length).toBe(0); // o comprometido (M3) é reparado e o resto replanejado sem a pessoa
    expect(m.alocacoes.filter((a) => a.funcionarioId === F && a.data === "2026-11-03").length).toBe(0);
  });

  it("reativar NÃO muda o que já passou; a pessoa só volta a entrar nos recálculos seguintes (ainda produtiva na equipe da semana)", async () => {
    const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
    await m.recalcular(epochMsNoFuso("2026-10-30", "10:00"), true);
    m.editar((e) => (e.equipeProdutiva = e.equipeProdutiva.map((x) => (x.funcionarioId === F ? { ...x, ativo: false } : x))));
    await m.recalcular(agora("09:00"));
    const passado = JSON.stringify(linhasDe(m, ["m1", "m2"]));
    m.editar((e) => (e.equipeProdutiva = e.equipeProdutiva.map((x) => (x.funcionarioId === F ? { ...x, ativo: true } : x))));
    await m.recalcular(agora("11:30"));
    expect(JSON.stringify(linhasDe(m, ["m1", "m2"]))).toBe(passado);
    expect(m.alocacoes.filter((a) => a.funcionarioId === F && a.data === "2026-11-03").length).toBeGreaterThan(0);
  });
});

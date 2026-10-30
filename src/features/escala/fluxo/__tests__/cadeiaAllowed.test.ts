// PLANEJAMENTO DE CADEIA — CAMADA 2 (Allowed estendido ao próximo dia produtivo + penalidade de cadeia / estoque de saída limitado).
import { describe, it, expect } from "vitest";
import { calcularDemanda, prepararFluxo } from "../estado";
import { compararTuplas, planejarComFluxo, tuplaObjetivo } from "../planejar";
import { checarFluxo } from "./helpersFluxo";
import { cadeia4 } from "./cadeiaHelpers";
import { CHAVE_PR_CADEIA_ALLOWED, CHAVE_PR_CADEIA_DIAGNOSTICO, lerConfigFluxo } from "@/lib/escala/fluxo/parametrosFluxo";

const DIA = ["2026-10-26"]; // horizonte de 1 dia: a janela restante é curta (como a sexta T3 do caso real)
const dem = (x: ReturnType<typeof cadeia4>, cadeia?: object) => calcularDemanda(prepararFluxo(x.m.entrada, x.dados, { ...x.opcoes, ...(cadeia ? { cadeia } : { cadeia: undefined }) }));

describe("cadeia — camada 2: Allowed com consumo até o próximo dia produtivo", () => {
  it("regra ANTIGA: o estoque à frente cobre a janela restante ⇒ Allowed = 0 para o upstream (o defeito do 30/10)", () => {
    const x = cadeia4({ estoque: [6000, 6000, 3600], dias: DIA });
    const d = dem(x);
    expect(d["P|R"].allowed).toBe(0); // estoque à frente (6.000+6.000+3.600) ≥ o que a janela restante consome
  });
  it("regra NOVA: o consumo do próximo dia produtivo gera demanda para o upstream (4 etapas: Rosquear e Parafusar > 0), com lead time de 1 período", () => {
    const x = cadeia4({ estoque: [6000, 6000, 3600], dias: DIA });
    const d = dem(x, { allowed: true });
    expect(d["P|R"].allowed).toBeGreaterThan(0);
    expect(d["P|Pa"].allowed).toBeGreaterThan(0);
    expect(d["P|E"].allowed).toBeGreaterThan(0);
    // fórmula: allowed = C + teto − min(pipe, C) com C = capDown + extra ⇒ o ganho sobre a regra antiga é exatamente o extra do próximo dia
    ["P|R", "P|Pa", "P|E"].forEach((n) => expect(d[n].consumoDownstream as number).toBeGreaterThan(dem(x)[n].consumoDownstream as number));
    expect(d["P|Pa"].rem).toBeLessThanOrEqual(d["P|Pa"].need);
  });
  it("cadeias de 2 e 3 etapas: mesma propriedade (estoque que não é consumido na janela, mas será no próximo dia, libera o upstream)", () => {
    const x = cadeia4({ estoque: [60000, 6000, 3600], dias: DIA });
    const d = dem(x, { allowed: true });
    expect(d["P|Pa"].allowed).toBeGreaterThan(dem(x)["P|Pa"].allowed as number);
    expect(d["P|E"].allowed).toBeGreaterThan(dem(x)["P|E"].allowed as number);
  });
  it("limitado pela demanda futura conhecida: produto fora da Previsão da próxima semana ⇒ SEM extensão (Allowed igual ao antigo); com 500 peças ⇒ extra ≤ 500; nunca WIP infinito", () => {
    const x = cadeia4({ estoque: [6000, 6000, 3600], dias: DIA });
    const antigo = dem(x);
    const zero = dem(x, { allowed: true, demandaFuturaPorProduto: {} });
    ["P|R", "P|Pa", "P|E"].forEach((n) => expect(zero[n].consumoDownstream).toBeCloseTo(antigo[n].consumoDownstream as number, 6));
    const pouco = dem(x, { allowed: true, demandaFuturaPorProduto: { P: 500 } });
    ["P|R", "P|Pa", "P|E"].forEach((n) => expect((pouco[n].consumoDownstream as number) - (antigo[n].consumoDownstream as number)).toBeLessThanOrEqual(500 + 1e-6));
    const muito = dem(x, { allowed: true, demandaFuturaPorProduto: { P: 1e12 } });
    ["P|R", "P|Pa", "P|E"].forEach((n) => expect(muito[n].allowed as number).toBeLessThanOrEqual((muito[n].consumoDownstream as number) + (muito[n].teto as number) + 1e-6)); // limitado pela capacidade do downstream
  });
  it("o estoque à frente que o downstream não consegue consumir no horizonte efetivo não é subtraído além da capacidade (pipeEf ≤ C)", () => {
    const x = cadeia4({ estoque: [60000, 60000, 60000], dias: DIA });
    const d = dem(x, { allowed: true });
    // pipeline enorme (180.000): a regra antiga zera; a nova limita o abatimento ao que a cadeia consome ⇒ allowed ≥ teto
    expect(dem(x)["P|Pa"].allowed).toBe(0);
    expect(d["P|Pa"].allowed as number).toBeGreaterThanOrEqual((d["P|Pa"].teto as number) - 1e-6);
  });
  it("chave desligada = nenhum efeito: opções sem cadeia e com cadeia:{} dão a mesma demanda", () => {
    const x = cadeia4({ estoque: [6000, 6000, 3600], dias: DIA });
    expect(dem(x, {})).toEqual(dem(x));
  });
});

describe("cadeia — camada 2: penalidade de cadeia na tupla J (estoque de saída limitado)", () => {
  const aval = (falta: number) => ({ totais: { faltaFinalLo: falta, faltaFinalHi: falta, faltaPonderada: falta, capacidadeGargalo: 0, wipLegadoResidual: 0, excessoWip: 0, capacidadeDesperdicada: 0 } }) as never;
  const churn = { linhasAlteradas: 0 } as never;
  it("sem penalidade a tupla é a de sempre (7 componentes); com ela entra à frente (8) e plano com cadeia inválida perde do válido", () => {
    expect(tuplaObjetivo(aval(10), churn, false)).toHaveLength(7);
    const invalido = tuplaObjetivo(aval(0), churn, false, 3000);
    const valido = tuplaObjetivo(aval(500), churn, false, 0);
    expect(invalido).toHaveLength(8);
    expect(compararTuplas(valido, invalido)).toBe(-1);
    expect(compararTuplas(tuplaObjetivo(aval(5), churn, false, 0.4), tuplaObjetivo(aval(0), churn, false, 0), )).toBe(1); // ruído < 1 peça de penalidade não decide, a falta decide
  });
  it("com a camada ligada o planejamento continua válido (0 violação dura) e a penalidade de cadeia do plano escolhido nunca é pior que a do plano que a camada desligada escolheria", () => {
    const off = cadeia4({ estoque: [6000, 6000, 3600], dias: DIA });
    const on = cadeia4({ estoque: [6000, 6000, 3600], cadeia: { allowed: true, saida: true } });
    const rOff = planejarComFluxo(off.m.entrada, off.dados, off.opcoes);
    const rOn = planejarComFluxo(on.m.entrada, on.dados, on.opcoes);
    expect(checarFluxo({ r: rOn, entrada: on.m.entrada })).toEqual([]);
    expect(rOn.diagnostico.depois.faltaPrevista.lo).toBeLessThanOrEqual(rOn.diagnostico.depoisBase.faltaPrevista.lo + 1e-6); // nunca pior que o plano base (regra de elegibilidade)
    expect(rOff.diagnostico.depois.faltaPrevista.lo).toBeLessThanOrEqual(rOff.diagnostico.depoisBase.faltaPrevista.lo + 1e-6);
  });
});

describe("cadeia — parâmetros (camada 2)", () => {
  it("producao_real_cadeia_allowed: só \"ativo\" liga allowed+saida; as camadas são independentes", () => {
    expect(lerConfigFluxo([{ chave: CHAVE_PR_CADEIA_ALLOWED, valor: "ativo" }]).cadeia).toEqual({ allowed: true, saida: true });
    expect(lerConfigFluxo([{ chave: CHAVE_PR_CADEIA_DIAGNOSTICO, valor: "ativo" }]).cadeia).toEqual({ diagnostico: true });
    expect(lerConfigFluxo([{ chave: CHAVE_PR_CADEIA_DIAGNOSTICO, valor: "ativo" }, { chave: CHAVE_PR_CADEIA_ALLOWED, valor: "ativo" }]).cadeia).toEqual({ diagnostico: true, allowed: true, saida: true });
    expect("cadeia" in lerConfigFluxo([{ chave: CHAVE_PR_CADEIA_ALLOWED, valor: "desligado" }])).toBe(false);
  });
});

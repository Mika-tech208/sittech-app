// PLANEJAMENTO DE CADEIA — CAMADA 3 (reparo): retropropagação com lead time, último período seguro, portões.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { prepararFluxo } from "../estado";
import { planejarComFluxo } from "../planejar";
import { simularCadeia } from "../cadeia";
import { numeroDeVariantes, ociosasEvitaveis, pedirReposicao } from "../cadeiaReparo";
import { verificarRestricoesDuras } from "../restricoes";
import { checarFluxo } from "./helpersFluxo";
import { cadeia4 } from "./cadeiaHelpers";
import { CHAVE_PR_CADEIA_REPARO, lerConfigFluxo } from "@/lib/escala/fluxo/parametrosFluxo";

const DIA = ["2026-10-26"];

describe("cadeia — camada 3: retropropagação real (demanda final → Embalar → Etiquetar → Parafusar → Rosquear)", () => {
  it("o pedido ao upstream NASCE do déficit do downstream, um período antes por ligação (lead time 1), em cascata", () => {
    // Etiquetar (E) e Embalar (B) rodam; estoques: R→P 3.000, P→E 0, E→B 0 ⇒ E fica sem material; P precisa ligar no período anterior ao de E; R no anterior ao de P
    const x = cadeia4({ estoque: [3000, 0, 60000], dias: DIA, cadeia: { reparo: true } });
    const sim = simularCadeia(x.ctx, x.m.planoCompleto, { semProximoDia: true });
    const a0 = x.ctx.aPartirDe;
    const v0 = sim.violacoes.filter((v) => v.noId === "P|E").sort((a, b) => a.slot - b.slot)[0];
    expect(v0.slot).toBe(a0);
    const rep = pedirReposicao(x.ctx, x.m.planoCompleto, 0);
    // E precisa de material já no 1º período alterável e P só pode ter produzido antes (não há período anterior alterável): inevitável no 1º; mas os períodos seguintes são reparados
    expect(rep.inevitaveis.some((v) => v.noId === "P|E" && v.slot === a0)).toBe(true);
    const slotsP = Object.entries(rep.minimos).filter(([, m]) => m["P|Pa"]).map(([s]) => Number(s)).sort((a, b) => a - b);
    expect(slotsP.length).toBeGreaterThan(0);
    expect(slotsP[0]).toBe(a0); // religar P no 1º período para servir E no 2º (último período seguro)
    const slotsR = Object.entries(rep.minimos).filter(([, m]) => m["P|R"]).map(([s]) => Number(s)).sort((a, b) => a - b);
    // R só liga quando o estoque R→P (3.000) deixa de cobrir P: P consome ~2.280/período ⇒ R é pedido depois de P
    if (slotsR.length > 0) expect(slotsR[0]).toBeGreaterThanOrEqual(slotsP[0]);
  });
  it("6.000 em estoque e consumo de 3.000/período ⇒ religar um período antes da ruptura (não antes: mínimo necessário)", () => {
    const x = cadeia4({ estoque: [60000, 9000, 60000], maqP: 3, dias: ["2026-10-26", "2026-10-27"], cadeia: { reparo: true } });
    const sim = simularCadeia(x.ctx, x.m.planoCompleto, { semProximoDia: true });
    const v = sim.violacoes.filter((y) => y.noId === "P|E").sort((a, b) => a.slot - b.slot)[0];
    const rep = pedirReposicao(x.ctx, x.m.planoCompleto, 0);
    const slotsP = Object.entries(rep.minimos).filter(([, m]) => m["P|Pa"]).map(([s]) => Number(s)).sort((a, b) => a - b);
    expect(slotsP[0]).toBe(v.slot - 1);
    expect(slotsP[0]).toBeGreaterThan(x.ctx.aPartirDe); // não "sempre ligado": os períodos cobertos pelo estoque ficam de fora
  });
  it("sem déficit nada é pedido", () => {
    const x = cadeia4({ estoque: [60000, 60000, 60000], dias: DIA, cadeia: { reparo: true } });
    const rep = pedirReposicao(x.ctx, x.m.planoCompleto, 0);
    expect(rep.postosExtra).toBe(0);
    expect(rep.minimos).toEqual({});
  });
  it("a ordem das fontes NÃO é fixa: o nº de variantes = maior nº de ligações de entrada (cada fonte vai na frente uma vez)", () => {
    const x = cadeia4({ estoque: [6000, 6000, 3600], dias: DIA, cadeia: { reparo: true } });
    expect(numeroDeVariantes(x.ctx)).toBe(1); // cadeia linear: uma fonte por nó
  });
});

describe("cadeia — camada 3: candidato reparado no planejarComFluxo", () => {
  const rodar = (cadeia?: object) => {
    const x = cadeia4({ estoque: [60000, 6000, 60000], dias: ["2026-10-26", "2026-10-27"], ...(cadeia ? { cadeia } : {}) });
    const r = planejarComFluxo(x.m.entrada, x.dados, x.opcoes);
    return { x, r, ctx: prepararFluxo(x.m.entrada, x.dados, x.opcoes) };
  };
  it("desligado: byte-idêntico (mesmo plano com cadeia ausente e com cadeia:{})", () => {
    const a = rodar();
    const b = rodar({});
    expect(JSON.stringify(b.r.resultado.alocacoes)).toBe(JSON.stringify(a.r.resultado.alocacoes));
  });
  it("ligado: a ruptura prevista de Etiquetar some (déficit de material da semana cai), sem violação dura, sem passado alterado e sem pessoa sem posto a mais", () => {
    const off = rodar();
    const on = rodar({ reparo: true });
    const defOff = simularCadeia(off.ctx, off.r.resultado.alocacoes, { semProximoDia: true }).deficit;
    const defOn = simularCadeia(on.ctx, on.r.resultado.alocacoes, { semProximoDia: true }).deficit;
    expect(defOff).toBeGreaterThan(0);
    expect(defOn).toBeLessThan(defOff);
    expect(checarFluxo({ r: on.r, entrada: on.x.m.entrada })).toEqual([]);
    expect(verificarRestricoesDuras(on.x.m.entrada, on.r.resultado.alocacoes)).toEqual([]);
    // passado congelado intocado: nenhuma linha do plano devolvido cai antes de aPartirDe
    expect(on.r.resultado.alocacoes.filter((a) => (on.ctx.idxSlot.get(`${a.data}|${a.periodoId}`) as number) < on.x.m.entrada.aPartirDe)).toEqual([]);
  });
  it("reposição pedida + motor com o hook: o déficit cai, 0 violação dura, passado igual, sem pessoa sem posto a mais (candidato reparado montado à mão)", () => {
    const x = cadeia4({ estoque: [60000, 6000, 60000], dias: ["2026-10-26", "2026-10-27"], cadeia: { reparo: true } });
    const ctx = x.ctx;
    const base = x.m.planoCompleto;
    const rep = pedirReposicao(ctx, base, 0);
    expect(rep.postosExtra).toBeGreaterThan(0);
    const remPorPool: Record<string, number> = {};
    x.pools.forEach((p) => (remPorPool[`${p.produtoId}|${p.etapaId}`] = p.quantidade));
    const res = gerarEscala({ ...x.m.entrada, remPorPool, reposicaoMinima: rep.minimos });
    const antes = simularCadeia(ctx, base, { semProximoDia: true }).deficit;
    const depois = simularCadeia(ctx, res.alocacoes, { semProximoDia: true }).deficit;
    expect(depois).toBeLessThan(antes);
    expect(verificarRestricoesDuras(x.m.entrada, res.alocacoes)).toEqual([]);
    expect(ociosasEvitaveis(ctx, res.alocacoes)).toBeLessThanOrEqual(ociosasEvitaveis(ctx, base));
  });
  it("o reparo vira CANDIDATO julgado pela mesma tupla: nunca produz falta final pior que a do plano base (valor líquido pelo produto final ≥ 0)", () => {
    const on = rodar({ reparo: true });
    expect(on.r.diagnostico.depois.faltaPrevista.lo).toBeLessThanOrEqual(on.r.diagnostico.depoisBase.faltaPrevista.lo + 1e-6);
  });
  it("hook reposicaoMinima ausente ⇒ gerarEscala idêntico (a camada 3 é a única que o preenche)", () => {
    const x = cadeia4({ estoque: [6000, 6000, 3600], dias: DIA });
    const a = gerarEscala(x.m.entrada);
    const b = gerarEscala({ ...x.m.entrada, reposicaoMinima: {} });
    expect(JSON.stringify(b.alocacoes)).toBe(JSON.stringify(a.alocacoes));
  });
});

describe("cadeia — parâmetros (camada 3)", () => {
  it("producao_real_cadeia_reparo: só \"ativo\" liga", () => {
    expect(lerConfigFluxo([{ chave: CHAVE_PR_CADEIA_REPARO, valor: "ativo" }]).cadeia).toEqual({ reparo: true });
    expect("cadeia" in lerConfigFluxo([{ chave: CHAVE_PR_CADEIA_REPARO, valor: "desligado" }])).toBe(false);
  });
});

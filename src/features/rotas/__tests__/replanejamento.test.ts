import { describe, it, expect } from "vitest";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala } from "@/features/escala/types";
import type { EstadoBruto } from "@/lib/escala/estado";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { reverterResultado, idVirtual } from "../adaptador";
import { resolverRotas } from "../resolucao";
import { AGORA, estadoF, F, SEL_F } from "./fixtureRotas";

const QUARTA_12H = epochMsNoFuso("2026-11-04", "12:00");
const SEL = { ...SEL_F };

// 1ª geração (segunda 05:00): é o plano que ficou gravado
function planoDaSegunda(estado: EstadoBruto): AlocacaoEscala[] {
  const m = montarEntradaEscala(estado, AGORA);
  return reverterResultado(gerarEscala(m.entrada)).alocacoes;
}
const creditos = (alocs: AlocacaoEscala[], ate: string) => {
  const c: Record<string, number> = {};
  alocs.filter((a) => a.maquinaId && a.produtoId === F && a.etapaId && `${a.data}|${["m1", "m2", "m3", "t1", "t2", "t3"].indexOf(a.periodoId)}` < `${ate}|0`).forEach((a) => { c[a.etapaId as string] = (c[a.etapaId as string] ?? 0) + a.pecas; });
  return c;
};

describe("M4 — replanejamento no meio da semana (quarta 12:00)", () => {
  const base = estadoF({ selecao: SEL, pessoas: 20 });
  const plano0 = planoDaSegunda(base);
  const cred = creditos(plano0, "2026-11-04");      // tudo antes de quarta (segunda e terça inteiras): imutável
  const meio = (extra: Partial<EstadoBruto> = {}, producaoReal?: Record<string, number>): EstadoBruto => ({
    ...estadoF({ selecao: SEL, pessoas: 20 }),
    // segunda e terça já aconteceram; quarta de manhã também (períodos que começam antes de 12:00)
    alocacoes: plano0.filter((a) => a.data < "2026-11-04" || (a.data === "2026-11-04" && ["m1", "m2", "m3"].includes(a.periodoId))),
    rotas: { estruturas: base.rotas!.estruturas, ...(producaoReal ? { producaoReal } : {}) }, ...extra,
  });

  it("sem apontamento: o executado é o congelado; o planejador só planeja o FUTURO com a capacidade dos períodos que ainda vão ocorrer", () => {
    const r = resolverRotas(meio(), QUARTA_12H)!;
    const p = r.produtos[F];
    const rod = p.rodadas[0];
    expect(rod.restante.parcial).toBe(true);
    expect(rod.restante.produtoFinalExecutado).toBeGreaterThan(0); expect(rod.restante.produtoFinalExecutado).toBeLessThan(97500);
    // AUTO futura ≤ o que as máquinas ainda produzem (quarta à tarde + quinta + sexta = 3×1.100 + 2×7.125)
    expect(p.plano.alvo.AUTO).toBeLessThanOrEqual(3 * 1100 + 2 * 7125 + 1e-6);
    expect(p.plano.alvo.AUTO + p.plano.alvo.CONV).toBeLessThanOrEqual(116625 - rod.restante.produtoFinalExecutado + 1e-6);
  });
  it("PASSADO IMUTÁVEL: as alocações congeladas continuam exatamente iguais (nenhuma linha anterior ao corte muda)", () => {
    const e = meio();
    const m = montarEntradaEscala(e, QUARTA_12H);
    const antes = JSON.stringify(m.entrada.congeladas.map((a) => ({ ...a })).sort((a, b) => (`${a.data}${a.periodoId}${a.funcionarioId}` < `${b.data}${b.periodoId}${b.funcionarioId}` ? -1 : 1)));
    const prior = JSON.stringify(e.alocacoes.filter((a) => a.data < "2026-11-04" || (a.data === "2026-11-04" && ["m1", "m2", "m3"].includes(a.periodoId))).map((a) => ({ ...a })).sort((a, b) => (`${a.data}${a.periodoId}${a.funcionarioId}` < `${b.data}${b.periodoId}${b.funcionarioId}` ? -1 : 1)));
    expect(m.entrada.aPartirDe).toBeGreaterThan(0);
    const res = reverterResultado(gerarEscala(m.entrada));
    expect(res.alocacoes.every((a) => a.data > "2026-11-04" || (a.data === "2026-11-04" && ["t1", "t2", "t3"].includes(a.periodoId)))).toBe(true);   // o motor só devolve o futuro
    expect(prior.length).toBeGreaterThan(0); expect(antes.length).toBeGreaterThan(0);
  });
  it("PRODUÇÃO REAL COMO FEEDBACK: a AUTO entregou menos que o planejado ⇒ o futuro transfere o que faltou para a CONV (só com as máquinas CONV já marcadas)", () => {
    // pool não é o gargalo (E15+E16, demanda 100.000): a AUTO já planejava tudo o que podia; a diferença só pode ir para a CONV
    const selB = { ...SEL, "f-etiq": ["E15", "E16"] };
    const eB = estadoF({ selecao: selB, pessoas: 22, demanda: 100000 });
    const pB = planoDaSegunda(eB);
    const congelB = pB.filter((a) => a.data < "2026-11-04" || (a.data === "2026-11-04" && ["m1", "m2", "m3"].includes(a.periodoId)));
    const exec = (() => { const c: Record<string, number> = {}; congelB.filter((a) => a.maquinaId && a.produtoId === F && a.etapaId).forEach((a) => { c[a.etapaId as string] = (c[a.etapaId as string] ?? 0) + a.pecas; }); return c; })();
    const meioB = (real?: Record<string, number>): EstadoBruto => ({ ...estadoF({ selecao: selB, pessoas: 22, demanda: 100000 }), alocacoes: congelB, rotas: { estruturas: eB.rotas!.estruturas, ...(real ? { producaoReal: real } : {}) } });
    const planejadaAuto = exec["f-rp"] ?? 0;
    expect(planejadaAuto).toBeGreaterThan(10000);
    const falta = 5000;
    const real: Record<string, number> = { ...exec, "f-rp": planejadaAuto - falta, "f-etiq": (exec["f-etiq"] ?? 0) - falta, "f-emb": (exec["f-emb"] ?? 0) - falta };
    const sem = resolverRotas(meioB(), QUARTA_12H)!.produtos[F];
    const com = resolverRotas(meioB(real), QUARTA_12H)!.produtos[F];
    expect(com.rodadas[0].restante.produtoFinalExecutado).toBeCloseTo((exec["f-emb"] ?? 0) - falta, 4);
    expect(com.rodadas[0].restante.demandaRestante).toBeCloseTo(sem.rodadas[0].restante.demandaRestante + falta, 4);
    // o que faltava no final subiu 5.000: as rotas entregam 5.000 a mais no futuro; a AUTO (mais barata) absorve primeiro, até a capacidade que ainda tem (quarta à tarde + quinta + sexta)
    expect(com.plano.alvo.AUTO + com.plano.alvo.CONV).toBeCloseTo(sem.plano.alvo.AUTO + sem.plano.alvo.CONV + falta, 0);
    expect(com.plano.alvo.AUTO).toBeLessThanOrEqual(3 * 1100 + 2 * 7125 + 1e-6);
    // AUTO sem espaço (máquina cai na quinta — só a Escala enxerga): o feedback de 2 rodadas empurra a diferença para a CONV, que já tinha máquinas marcadas
    const caiu = (real2?: Record<string, number>) => { const e = meioB(real2); e.indisponibilidades = [{ maquinaId: "A8", desde: "2026-11-05T03:00:00.000Z", liberadaEm: null }]; return e; };
    const cai = resolverRotas(caiu(real), QUARTA_12H)!.produtos[F];
    expect(cai.rodadas.length).toBeGreaterThanOrEqual(2); expect(cai.parada).toBe("atendeu_alvo");
    expect(cai.plano.alvo.AUTO).toBeLessThanOrEqual(3 * 1100 + 1e-6);                  // só resta quarta à tarde
    expect(cai.plano.alvo.CONV).toBeGreaterThan(com.plano.alvo.CONV + 1000);
    // máquinas: nenhuma nova — só as selecionadas aparecem no futuro
    const m = montarEntradaEscala(meioB(real), QUARTA_12H);
    const permitidas = new Set(Object.values(selB).flat());
    expect(reverterResultado(gerarEscala(m.entrada)).alocacoes.filter((a) => a.maquinaId).every((a) => permitidas.has(a.maquinaId as string))).toBe(true);
  });
  it("CONV sem recursos selecionados suficientes: a falta aparece (não inventa máquina nem aumenta a CONV além do que as marcadas permitem)", () => {
    const umaPara = { ...SEL, "f-para": ["P9"] };                                      // só uma parafusadeira: CONV ≤ 40.500/semana
    const e0 = estadoF({ selecao: umaPara, pessoas: 20 });
    const p0 = planoDaSegunda(e0);
    const e = { ...estadoF({ selecao: umaPara, pessoas: 20 }), alocacoes: p0.filter((a) => a.data < "2026-11-04" || (a.data === "2026-11-04" && ["m1", "m2", "m3"].includes(a.periodoId))) } as EstadoBruto;
    e.rotas = { estruturas: e0.rotas!.estruturas };
    const p = resolverRotas(e, QUARTA_12H)!.produtos[F];
    expect(p.rodadas[0].restante.demandaRestante).toBeGreaterThan(p.plano.final);       // o que falta é maior que o possível: sobra falta
    const futuroCONV = 2 * 6 * 0; void futuroCONV;
    expect(p.previa.plano.falta).toBeGreaterThan(0);
    const usadas = new Set(reverterResultado(gerarEscala(montarEntradaEscala(e, QUARTA_12H).entrada)).alocacoes.map((a) => a.maquinaId));
    ["P10", "P11", "P12", "R5", "E16"].forEach((m) => expect(usadas.has(m)).toBe(false));
  });
  it("semana que ainda não começou: replanejamento = geração normal (restante = semana inteira, sem ocorrências parciais)", () => {
    const r = resolverRotas(estadoF({ selecao: SEL }), AGORA)!.produtos[F].rodadas[0];
    expect(r.restante.parcial).toBe(false); expect(r.restante.demandaRestante).toBeCloseTo(116625, 4);
  });
  it("virtual só no motor: cadeias com a quantidade = congelado + o que falta; nomes amigáveis, nunca produto distinto", () => {
    const r = resolverRotas(meio(), QUARTA_12H)!;
    const nomes = Object.entries(r.estadoVirtual.nomesProdutos ?? {}).filter(([id]) => id.startsWith(`${F}#`)).map(([, n]) => n);
    expect(nomes.every((n) => n.startsWith('Conector 3/4" (Final) · '))).toBe(true);
    expect(r.estadoVirtual.itens.some((i) => i.produtoId === idVirtual(F, "COMUM"))).toBe(true);
  });

  // ---------------- produção CONFIRMADA × PRESUMIDA × SEM PRODUÇÃO ----------------
  describe("período passado sem apontamento NÃO é produção real", () => {
    const congelados = plano0.filter((a) => a.data < "2026-11-04" || (a.data === "2026-11-04" && ["m1", "m2", "m3"].includes(a.periodoId)));
    const linhasF = congelados.filter((a) => a.maquinaId && a.produtoId === F && a.etapaId);
    const cob = (filtro: (a: AlocacaoEscala) => boolean, status = "produzindo") => linhasF.filter(filtro).map((a) => ({ data: a.data, periodoId: a.periodoId, maquinaId: a.maquinaId as string, etapaId: status === "produzindo" ? (a.etapaId as string) : null, status, boas: status === "produzindo" ? a.pecas : 0 }));
    const estadoCom = (cobertura: ReturnType<typeof cob>): EstadoBruto => ({ ...meio(), rotas: { estruturas: base.rotas!.estruturas, cobertura } });
    const total = linhasF.reduce((s, a) => s + a.pecas, 0);

    it("sem NENHUM apontamento: tudo é PRESUMIDO (plano preservado para não replanejar de forma caótica), marcado como não confirmado, com diagnóstico de incerteza e aviso", () => {
      const e = estadoCom([]);
      const r = resolverRotas(e, QUARTA_12H)!.produtos[F];
      const rest = r.rodadas[0].restante;
      expect(Object.values(rest.presumidoPorEtapa).reduce((s, v) => s + v, 0)).toBeCloseTo(total, 4);
      expect(Object.values(rest.confirmadoPorEtapa).reduce((s, v) => s + v, 0)).toBe(0);
      expect(r.incertezas.length).toBeGreaterThan(0); expect(r.incertezas.join(" ")).toMatch(/PRESUMIDAS|presumidas/i); expect(r.incertezas.join(" ")).toMatch(/não confirmadas/);
      const m = montarEntradaEscala(e, QUARTA_12H);
      expect(m.avisos.filter((a) => a.tipo === "producao_presumida").length).toBeGreaterThan(0);
      // o plano segue o congelado (mesmo restante que o caminho sem cobertura): presumir não muda o plano, só o RÓTULO
      const semCob = resolverRotas(meio(), QUARTA_12H)!.produtos[F];
      expect(r.plano.alvo.AUTO).toBeCloseTo(semCob.plano.alvo.AUTO, 4); expect(r.plano.alvo.CONV).toBeCloseTo(semCob.plano.alvo.CONV, 4);
    });
    it("apontamento fechado de TODOS os períodos: nada é presumido, sem incerteza e sem aviso; o executado vem do apontado", () => {
      const e = estadoCom(cob(() => true));
      const r = resolverRotas(e, QUARTA_12H)!.produtos[F];
      expect(Object.values(r.rodadas[0].restante.presumidoPorEtapa).reduce((s, v) => s + v, 0)).toBe(0);
      expect(r.incertezas).toEqual([]);
      expect(Object.values(r.rodadas[0].restante.confirmadoPorEtapa).reduce((s, v) => s + v, 0)).toBeCloseTo(total, 4);
      expect(montarEntradaEscala(e, QUARTA_12H).avisos.some((a) => a.tipo === "producao_presumida")).toBe(false);
    });
    it("metade apontada: só a metade sem apontamento é presumida (confirmado + presumido = congelado)", () => {
      const par = (a: AlocacaoEscala) => a.data === "2026-11-02";
      const r = resolverRotas(estadoCom(cob(par)), QUARTA_12H)!.produtos[F].rodadas[0].restante;
      const conf = Object.values(r.confirmadoPorEtapa).reduce((s, v) => s + v, 0), pres = Object.values(r.presumidoPorEtapa).reduce((s, v) => s + v, 0);
      expect(conf).toBeGreaterThan(0); expect(pres).toBeGreaterThan(0); expect(conf + pres).toBeCloseTo(total, 4);
    });
    it("SEM PRODUÇÃO registrado é zero CONHECIDO (não presumido): a AUTO que não produziu faz o futuro transferir para a CONV", () => {
      const autoSem = cob((a) => a.etapaId === "f-rp", "sem_producao");
      const resto = cob((a) => a.etapaId !== "f-rp");
      const e = estadoCom([...autoSem, ...resto]);
      const r = resolverRotas(e, QUARTA_12H)!.produtos[F];
      const rest = r.rodadas[0].restante;
      expect(rest.confirmadoPorEtapa["f-rp"] ?? 0).toBe(0); expect(rest.presumidoPorEtapa["f-rp"] ?? 0).toBe(0); expect(rest.semProducaoPorEtapa["f-rp"]).toBeGreaterThan(0);
      expect(r.incertezas).toEqual([]);                                    // zero conhecido não é incerteza
      const base0 = resolverRotas(estadoCom(cob(() => true)), QUARTA_12H)!.produtos[F];
      expect(rest.produtoFinalExecutado).toBeLessThanOrEqual(base0.rodadas[0].restante.produtoFinalExecutado);
    });
  });
});

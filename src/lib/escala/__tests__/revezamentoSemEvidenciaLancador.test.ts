// HOTFIX 29/10 — o `funcionario_id` do APONTAMENTO é quem LANÇOU, não prova quem operou. A exposição individual do revezamento por bloco é:
// (1) troca manual registrada; senão (2) a alocação congelada da Escala. O apontamento segue valendo para produção/boas/refugo/WIP/demanda, mas NÃO vira
// `entrada.exposicaoExecutada`. (`exposicaoDeApontamentos` continua exportada p/ replay; o conceito futuro é `operador_real_id`.)
import { describe, it, expect } from "vitest";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { exposicaoDeApontamentos, repeticoesPorBloco } from "@/features/escala/exposicaoBloco";
import { verificarRestricoesDuras } from "@/features/escala/fluxo/restricoes";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala, EntradaEscala } from "@/features/escala/types";
import { entrada, equipe, pool } from "@/features/escala/__tests__/helpers";
import type { EstadoProducaoReal } from "../estado";
import { nucleoFluxo, type NucleoFluxo } from "../fluxo/integracao";
import { montarEntradaEscala } from "../montarEntrada";
import { Mundo, estadoDeTeste } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const TER = "2026-11-03";
const GERA = epochMsNoFuso(SEMANA, "05:00");
const AGORA = epochMsNoFuso(TER, "09:30"); // terça, M2 em andamento => o recálculo começa em M3 (M1+M2 = passado do bloco)

const mundo = (modo: "sombra" | "ativo", apontamentos: ApontamentoReal[] = [], escopo: "bloco" | "consecutivo" = "bloco") => {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
  const pr: EstadoProducaoReal = { modoEfetivo: modo, limiar: null, paresLegado: [], apontamentos };
  m.editar((e) => {
    e.producaoReal = pr;
    e.parametros = { wipModo: "desligado", wipDiasLimite: 1, revezamentoModo: "duro", revezamentoEscopo: escopo };
  });
  return m;
};

/** Captura a `entrada` e os `dados` que o processar entrega ao núcleo (delegando ao núcleo real). */
function espiao() {
  const capt: { entrada: EntradaEscala; apontamentos: number }[] = [];
  const nucleo: NucleoFluxo = {
    planejarComFluxo(ent, dados, op) { capt.push({ entrada: ent, apontamentos: dados.apontamentos.length }); return nucleoFluxo.planejarComFluxo(ent, dados, op); },
    avaliarPlano: (...a) => nucleoFluxo.avaliarPlano(...a),
    verificarRestricoesDuras: (...a) => nucleoFluxo.verificarRestricoesDuras(...a),
  };
  return { nucleo, capt };
}

const ap = (a: Partial<ApontamentoReal> & Pick<ApontamentoReal, "data" | "periodoId" | "funcionarioId" | "operacaoId">): ApontamentoReal => ({
  maquinaId: "m1", produtoId: "pA", etapaId: "eA1", boas: 10, refugo: 0, meta: 10, status: "produzindo", motivo: null, lancadoEmMs: AGORA - 60_000, ...a,
});
const sig = (m: Mundo) => Mundo.assinatura(m.alocacoes, true);

/** Gera a semana e devolve as linhas de M1/M2 de terça (o que cada pessoa FEZ segundo a Escala congelada). */
async function planoBase() {
  const m = mundo("sombra");
  await m.recalcular(GERA, true);
  return m.alocacoes.filter((a) => a.data === TER && (a.periodoId === "m1" || a.periodoId === "m2") && a.maquinaId && a.operacaoId);
}
/** Apontamentos de lançadores que DIVERGEM da operação congelada (cada pessoa "lançou" uma operação diferente da que a Escala lhe deu). */
function apontamentosDivergentes(congeladas: AlocacaoEscala[]): ApontamentoReal[] {
  const ops = ["opRosca", "opEmbal", "opMont", "opEtiq"];
  return congeladas.map((a) => ap({ data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, operacaoId: ops[(ops.indexOf(a.operacaoId as string) + 1) % ops.length], maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId }));
}
/** Controle: MESMOS apontamentos (mesma produção/boas/produto/etapa) mas com o lançador coerente com a congelada (operação = a da Escala). */
const apontamentosCoerentes = (congeladas: AlocacaoEscala[]): ApontamentoReal[] =>
  congeladas.map((a) => ap({ data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, operacaoId: a.operacaoId as string, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId }));

describe("HOTFIX: o apontamento NÃO prova o operador (processarSemana)", () => {
  it("a) lançador diverge da operação congelada: a entrada do núcleo NÃO leva evidência e o plano é o da Escala congelada", async () => {
    const cong = await planoBase();
    expect(cong.length).toBeGreaterThan(4);
    const aps = apontamentosDivergentes(cong);
    // não-vacuidade: com a regra ANTIGA (evidência do lançador) a mesma entrada produziria evidência para M1+M2
    const base = montarEntradaEscala({ ...mundo("sombra").entradas, producaoReal: undefined }, AGORA);
    expect(exposicaoDeApontamentos(aps, base.entrada.slots, base.entrada.aPartirDe, AGORA).length).toBeGreaterThan(0);

    for (const modo of ["sombra", "ativo"] as const) {
      const sem = mundo(modo, apontamentosCoerentes(cong)); // controle: lançador = congelada (mesma produção)
      const com = mundo(modo, aps);
      await sem.recalcular(GERA, true);
      com.alocacoes = sem.alocacoes.map((x) => ({ ...x })); com.dias = new Map(sem.dias);
      const e1 = espiao(), e2 = espiao();
      await sem.recalcular(AGORA, false, { nucleoFluxo: e1.nucleo });
      await com.recalcular(AGORA, false, { nucleoFluxo: e2.nucleo });
      expect(e1.capt.length).toBeGreaterThan(0);
      expect(e2.capt.length).toBeGreaterThan(0);
      e2.capt.forEach((c) => {
        expect(c.entrada.exposicaoExecutada).toBeUndefined();
        expect(c.entrada.revezamentoEscopo).toBe("bloco");
      });
      expect(com.alocacoes.length).toBe(sem.alocacoes.length);
      expect(sig(com)).toBe(sig(sem)); // plano idêntico com ou sem os apontamentos divergentes
    }
  });

  it("c) o apontamento CONTINUA alimentando o fluxo (produção/WIP/demanda): o núcleo recebe os apontamentos e o hash de entrada do registro os inclui", async () => {
    const cong = await planoBase();
    const aps = apontamentosDivergentes(cong);
    const m0 = mundo("sombra", []), m1 = mundo("sombra", aps);
    const e1 = espiao();
    await m0.recalcular(GERA, true); await m0.recalcular(AGORA, false);
    await m1.recalcular(GERA, true, { nucleoFluxo: e1.nucleo }); await m1.recalcular(AGORA, false, { nucleoFluxo: e1.nucleo });
    expect(e1.capt.at(-1)!.apontamentos).toBe(aps.length);
    const hash = (m: Mundo) => m.registrosFluxo.at(-1)!.hashEntrada;
    expect(hash(m1)).not.toBe(hash(m0)); // o estado do fluxo (produção real) mudou; a identidade do operador não entrou na exposição
  });

  it("d) sem apontamentos a saída é idêntica à de antes (golden): entrada sem exposicaoExecutada e plano igual ao do oficial sem fluxo", async () => {
    const m = mundo("sombra", []);
    await m.recalcular(GERA, true);
    const e = espiao();
    await m.recalcular(AGORA, false, { nucleoFluxo: e.nucleo });
    e.capt.forEach((c) => expect(c.entrada.exposicaoExecutada).toBeUndefined());
    expect(montarEntradaEscala(m.entradas, AGORA).entrada.exposicaoExecutada).toBeUndefined();
    const off = new Mundo(estadoDeTeste(SEMANA, DIAS));
    off.editar((x) => { x.parametros = { wipModo: "desligado", wipDiasLimite: 1, revezamentoModo: "duro", revezamentoEscopo: "bloco" }; });
    await off.recalcular(GERA, true); await off.recalcular(AGORA);
    expect(sig(m)).toBe(sig(off));
  });

  it("b) troca manual registrada continua na memória do bloco (congelada, origem 'manual'); 0 repetições no dia mesmo com apontamentos divergentes", async () => {
    const m = mundo("sombra", []);
    await m.recalcular(GERA, true);
    m.relogioMs = GERA;
    const m2 = m.alocacoes.filter((a) => a.data === TER && a.periodoId === "m2" && a.maquinaId && a.operacaoId);
    let trocou: { a: AlocacaoEscala; b: AlocacaoEscala } | null = null;
    for (const x of m2) for (const y of m2) { if (trocou || x.funcionarioId >= y.funcionarioId || x.operacaoId === y.operacaoId) continue; try { m.trocarManual(TER, "m2", x.funcionarioId, y.funcionarioId); trocou = { a: x, b: y }; } catch { /* troca inválida: tenta outra */ } }
    expect(trocou).not.toBeNull();
    const a = trocou!.a;
    const opDeAemM2 = m.alocacoes.find((x) => x.data === TER && x.periodoId === "m2" && x.funcionarioId === a.funcionarioId)!.operacaoId as string;
    const aps = apontamentosDivergentes(m.alocacoes.filter((x) => x.data === TER && (x.periodoId === "m1" || x.periodoId === "m2") && x.maquinaId));
    m.editar((e) => { e.producaoReal!.apontamentos = aps; });
    const esp = espiao();
    await m.recalcular(AGORA, false, { nucleoFluxo: esp.nucleo });
    esp.capt.forEach((c) => expect(c.entrada.exposicaoExecutada).toBeUndefined());
    expect(m.alocacoes.find((x) => x.data === TER && x.periodoId === "m2" && x.funcionarioId === a.funcionarioId)!.origem).toBe("manual"); // troca preservada
    const m3a = m.alocacoes.find((x) => x.data === TER && x.periodoId === "m3" && x.funcionarioId === a.funcionarioId);
    if (m3a?.maquinaId) expect(m3a.operacaoId).not.toBe(opDeAemM2); // a operação que a troca deu a `a` em M2 está exposta
    const slots = montarEntradaEscala(m.entradas, AGORA).entrada.slots;
    expect(repeticoesPorBloco(m.alocacoes.filter((x) => x.data === TER), slots)).toEqual([]);
  });
});

describe("HOTFIX: motor — exposição = congelada (que contém a troca manual), nunca o lançador", () => {
  const D1 = "2026-10-28";
  const linha = (periodoId: string, f: string, op: string, maq: string, extra: Record<string, unknown> = {}): AlocacaoEscala => ({
    data: D1, periodoId, funcionarioId: f, maquinaId: maq, produtoId: "P", etapaId: "P-e1", operacaoId: op, pecas: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, ...extra,
  });

  it("troca manual em M2 (origem 'manual') bloqueia a repetição em M3", () => {
    const pools = [pool({ produto: "P", op: "Mo", q: 600, maquinas: ["m1"] }), pool({ produto: "Q", op: "Et", q: 600, maquinas: ["m2"] }), pool({ produto: "R", op: "Z", q: 600, maquinas: ["m3"] })];
    const base: EntradaEscala = { ...entrada({ funcionarios: equipe(1), pools }, [D1]), revezamentoDuro: true, revezamentoEscopo: "bloco" };
    const cong = [linha("m1", "f01", "Mo", "m1"), linha("m2", "f01", "Et", "m2", { origem: "manual" })];
    const e: EntradaEscala = { ...base, aPartirDe: 2, congeladas: cong };
    const r = gerarEscala(e);
    expect(r.alocacoes.filter((a) => a.periodoId === "m3")[0].operacaoId).toBe("Z"); // Mo (M1) e Et (M2, manual) expostas
    expect(verificarRestricoesDuras(e, r.alocacoes).filter((x) => x.tipo === "revezamento")).toEqual([]);
    expect(repeticoesPorBloco([...e.congeladas, ...r.alocacoes], e.slots)).toEqual([]);
  });

  it("casos reais de 29/10 (Luana, Damaris, Kelly): lançador diverge da congelada => M3 usa só a congelada; o verificador (sem evidência) concorda", () => {
    const ops = ["ParafusarPino", "Parafusar", "MontarPresilha", "Etiquetar", "Rosquear"];
    const pools = ops.map((op, i) => pool({ produto: `P${i}`, op, q: 600, maquinas: [`mq${i}`] }));
    const base: EntradaEscala = { ...entrada({ funcionarios: equipe(3), pools }, [D1]), revezamentoDuro: true, revezamentoEscopo: "bloco" };
    const [luana, damaris, kelly] = ["f01", "f02", "f03"];
    const cong = [
      linha("m1", luana, "ParafusarPino", "mq0"), linha("m2", luana, "Etiquetar", "mq3"),
      linha("m1", damaris, "Parafusar", "mq1"), linha("m2", damaris, "ParafusarPino", "mq0"),
      linha("m1", kelly, "Rosquear", "mq4"), linha("m2", kelly, "MontarPresilha", "mq2"),
    ];
    const lanc = [{ f: luana, op: "Parafusar" }, { f: damaris, op: "MontarPresilha" }, { f: kelly, op: "Etiquetar" }];
    const aps = lanc.map((l) => ({ data: D1, periodoId: "m1", funcionarioId: l.f, operacaoId: l.op, status: "produzindo" as const, lancadoEmMs: 0 }));
    const e: EntradaEscala = { ...base, aPartirDe: 2, congeladas: cong };
    expect(exposicaoDeApontamentos(aps, e.slots, e.aPartirDe, 1).length).toBe(3); // a função continua existindo/funcionando (replay)
    const r = gerarEscala(e);
    const jaFez: Record<string, string[]> = { [luana]: ["ParafusarPino", "Etiquetar"], [damaris]: ["Parafusar", "ParafusarPino"], [kelly]: ["Rosquear", "MontarPresilha"] };
    r.alocacoes.filter((a) => a.periodoId === "m3" && a.maquinaId).forEach((a) => expect(jaFez[a.funcionarioId] ?? []).not.toContain(a.operacaoId));
    expect(verificarRestricoesDuras(e, r.alocacoes).filter((x) => x.tipo === "revezamento")).toEqual([]);
    expect(JSON.stringify(gerarEscala({ ...e, exposicaoExecutada: undefined }))).toBe(JSON.stringify(r));
  });
});

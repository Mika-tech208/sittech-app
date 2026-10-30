/* eslint-disable @typescript-eslint/no-explicit-any */
// REPLAY OFFLINE do FORECAST DE BUFFER sobre os recálculos reais de 28/10 a 30/10 (SOMENTE SELECT em cache; nada é gravado em PROD, nada é publicado).
// Por recálculo: (1) forecast sobre o plano GRAVADO na época (antecipação × realidade); (2) forecast sobre o plano do motor de hoje (OFF) e simulação ON
// (mínimo de reposição upstream imposto no período indicado + regeração pelo gerarEscala) — SIMULAÇÃO sobre o mesmo simulador (pode ser otimista).
// Env: AGORAS=iso,iso  OUT=arquivo.json  JANELA=14  NMIN=3  FATOR=medido|1
import * as fs from "node:fs";
import { abrir, estadoEm, versaoEm, receita, SEMANA, type Ambiente, type EstadoReplay } from "./comum";
import { avaliarPlano, planejarComFluxo, verificarRestricoesDuras } from "@/features/escala/fluxo";
import { capsDoPlano } from "@/features/escala/fluxo/avaliar";
import { forecastDoPlano, reposicaoMinimaDe, type ForecastDoPlano } from "@/features/escala/fluxo/forecastBufferPlano";
import { criarEstimadorPosto, fatorReposicaoMedido, type ConsultaPosto } from "@/features/escala/fluxo/produtividadePosto";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { estabilizarPessoas } from "@/features/escala/estabilidade";
import { chavePool, type AlocacaoEscala } from "@/features/escala/types";
import { churnIndependente } from "../escala-fluxo-replay/independente";

const AGORAS_PADRAO = [
  "2026-10-28T08:50:00-03:00", "2026-10-28T10:26:00-03:00", "2026-10-28T11:57:00-03:00", "2026-10-28T14:22:00-03:00", "2026-10-28T15:42:00-03:00",
  "2026-10-29T05:00:00-03:00", "2026-10-29T08:50:00-03:00", "2026-10-29T10:26:00-03:00", "2026-10-29T11:57:00-03:00", "2026-10-29T14:22:00-03:00", "2026-10-29T15:42:00-03:00",
  "2026-10-30T05:00:00-03:00", "2026-10-30T08:50:00-03:00", "2026-10-30T10:26:00-03:00", "2026-10-30T11:42:00-03:00",
];
const AGORAS = (process.env.AGORAS ?? AGORAS_PADRAO.join(",")).split(",").filter(Boolean);
const JANELA = Number(process.env.JANELA ?? 14);
const NMIN = Number(process.env.NMIN ?? 3);
const AGORA_FINAL = Date.parse("2026-10-30T12:20:52-03:00");

const A = abrir();
const { d, slots, ix, nome, hist } = A;
const todosAps = [...hist, ...d.apontamentos];
const posto = (a?: AlocacaoEscala) => (a && a.maquinaId ? `${a.maquinaId}|${a.produtoId}|${a.etapaId}` : "ocioso");
const chave = (a: AlocacaoEscala) => `${ix(a)}|${a.funcionarioId}`;
const rotuloNo = (ctxNos: any) => (k: string) => { const [p, e] = k.split("|"); void ctxNos; return `${nome(e)} ${nome(p).replace('Conector 3/4" - Maquina Automatica', "Con3/4 Autom").replace('Conector 3/4"', "Con3/4")}`; };

function diff(base: AlocacaoEscala[], novo: AlocacaoEscala[], ap: number) {
  const b = new Map(base.filter((a) => ix(a) >= ap).map((a) => [chave(a), a])), n = new Map(novo.filter((a) => ix(a) >= ap).map((a) => [chave(a), a]));
  let linhas = 0; const pessoas = new Set<string>();
  new Set([...b.keys(), ...n.keys()]).forEach((k) => {
    const x = b.get(k), y = n.get(k);
    if (posto(x) !== posto(y) || Math.round(x?.pecas ?? 0) !== Math.round(y?.pecas ?? 0)) { linhas++; pessoas.add(k.split("|")[1]); }
  });
  return { linhasAlteradas: linhas, pessoasAlteradas: pessoas.size };
}

function postosDoPlano(plano: AlocacaoEscala[], ap: number, ctx: EstadoReplay["ctx"]): ConsultaPosto[] {
  const seen = new Map<string, ConsultaPosto>();
  plano.filter((a) => ix(a) >= ap && a.maquinaId && a.produtoId && a.etapaId).forEach((a) => {
    const pool = ctx.poolsPorChave.get(chavePool(a.produtoId as string, a.etapaId as string));
    if (!pool) return;
    const q = { produtoId: a.produtoId as string, operacaoId: pool.operacaoId, maquinaId: a.maquinaId as string };
    seen.set(`${q.produtoId}|${q.operacaoId}|${q.maquinaId}`, q);
  });
  return [...seen.values()];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Verdade terrestre (hindsight) por (nó, slot fechado): material no início, produção real, falta_material
// ---------------------------------------------------------------------------------------------------------------------------------
const versoes = AGORAS_PADRAO.map((iso) => ({ iso, ms: Date.parse(iso), plano: versaoEm(iso) }));
const ufechFinal = (() => { let u = -1; slots.forEach((s) => { if (s.fimMs + 10 * 60_000 <= AGORA_FINAL) u = s.indice; }); return u; })();
interface CelulaVerdade { slot: number; no: string; rotulo: string; w0lo: number; w0hi: number; confirmado: boolean; planejado: number; real: number | null; faltaMaterial: boolean; apontado: boolean }
function verdade(): CelulaVerdade[] {
  const out: CelulaVerdade[] = [];
  for (let s = 0; s <= ufechFinal; s++) {
    const agoraS = s === 0 ? slots[0].inicioMs : slots[s - 1].fimMs + 10 * 60_000;
    // plano em vigor no início do slot: versão gravada do 1º recálculo em/depois do início do slot (ou o plano atual)
    const v = versoes.find((x) => x.ms >= slots[s].inicioMs) ?? null;
    const planoS = v ? v.plano : d.planoAtual;
    // hindsight: apontamentos de slots < s entram todos; slots ≥ s ficam fora
    const apsS = d.apontamentos.filter((x) => ix(x) < s).map((x) => ({ ...x, lancadoEmMs: Math.min(x.lancadoEmMs, agoraS - 1) }));
    const est = estadoEm(A, agoraS, planoS, { aps: apsS, apOverride: s, mesmoPeriodo: false });
    const caps = capsDoPlano(est.ctx, planoS.filter((a) => ix(a) === s));
    Object.values(est.ctx.grafo.nos).forEach((no) => {
      const ins = est.ctx.grafo.entradas[no.id];
      if (ins.length === 0) return;
      const w0lo = ins.reduce((q, e) => q + (est.ctx.iniAPartirDe.lo.W0[e] ?? 0), 0);
      const w0hi = ins.reduce((q, e) => q + (est.ctx.iniAPartirDe.hi.W0[e] ?? 0), 0);
      const confirmado = ins.every((e) => { const ar = est.ctx.grafo.arestas[e]; const par = est.ctx.pares.find((p) => p.produtoId === ar.produtoId && p.etapaOrigemId === ar.etapaOrigemId && p.etapaSeguinteId === ar.etapaSeguinteId); return par?.origem === "confirmado"; });
      const planejado = (caps[no.id]?.base[s] ?? 0) + (caps[no.id]?.adic[s] ?? 0);
      if (planejado <= 0) return;
      const linhas = d.apontamentos.filter((x) => ix(x) === s && x.produtoId && x.etapaId && est.ctx.grafo.noDoPool[chavePool(x.produtoId, x.etapaId)] === no.id);
      out.push({
        slot: s, no: no.id, rotulo: rotuloNo(null)(no.id), w0lo, w0hi, confirmado, planejado,
        real: linhas.length > 0 ? linhas.filter((x) => x.status === "produzindo").reduce((q, x) => q + x.boas, 0) : null,
        faltaMaterial: linhas.some((x) => x.motivo === "falta_material"), apontado: linhas.length > 0,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
const celulasVerdade = verdade();
const saida: any = { parametros: { JANELA, NMIN, agoras: AGORAS.length, ufechFinal, slotFinal: `${slots[ufechFinal].data} ${slots[ufechFinal].periodoId}` }, verdadeCelulas: celulasVerdade, recalculos: [] as any[] };
const previsoes: { agora: string; ap: number; slot: number; no: string; falta: number; desejado: number; rotulo: string; previsto: boolean }[] = [];
const ligacaoTexto: Record<string, string[]> = {};

for (const iso of AGORAS) {
  const t0 = Date.now();
  const agoraMs = Date.parse(iso);
  const plano = versaoEm(iso);
  const E = estadoEm(A, agoraMs, plano, { mesmoPeriodo: false });
  const { ent, dados, opcoes, ap, ctx } = E;
  if (ap >= slots.length) continue;
  const vig = plano.filter((a) => ix(a) >= ap);
  // estimador do posto (janela curta) e fator de reposição medido
  const estimador = criarEstimadorPosto(todosAps, agoraMs, { janelaDias: JANELA, nMin: NMIN });
  const r0 = planejarComFluxo(ent, dados, opcoes);
  const rem = r0.diagnostico.estado.remPorPool;
  const off = r0.resultado.alocacoes.filter((a) => ix(a) >= ap);
  const fatMed = fatorReposicaoMedido(estimador, postosDoPlano(off, ap, ctx));
  const fator = process.env.FATOR === "1" ? 1 : process.env.FATOR === "medido" ? fatMed.fator : 1;
  const rn = rotuloNo(null);
  const fopt = { limites: rem, estimador, rotuloNo: rn, fatorReposicao: fator, mesmoPeriodo: false };

  // (1) forecast sobre o plano GRAVADO (o que a produção tinha na época)
  const fRec = forecastDoPlano(ctx, vig, fopt);
  fRec.resultado.nos.forEach((n) => n.producaoDesejada.forEach((des, i) => {
    const falta = des - n.producaoPlano[i];
    if (fRec.entrada.ligacoes.some((l) => l.destino === n.noId)) previsoes.push({ agora: iso, ap, slot: fRec.mapa.slotDoPeriodo[i], no: n.noId, falta: Math.max(0, falta), desejado: des, rotulo: n.rotulo, previsto: falta > 1e-3 });
  }));

  // (2) forecast sobre o plano do motor de hoje (OFF) e simulações ON (mínimo de reposição imposto + regeração)
  const fOff = forecastDoPlano(ctx, off, fopt);
  // mesma estabilização de pessoas que o planejador aplica (mantém a pessoa no posto do plano vigente quando os postos são os mesmos)
  const estab = (linhas: AlocacaoEscala[]) => {
    const marc = linhas.filter((a) => ix(a) >= ap);
    if (vig.length === 0 || marc.length === 0) return marc;
    const e = estabilizarPessoas(marc, vig, ent.congeladas, ent.slots, { escopo: "bloco", equivalencias: ent.equivalenciaOperacoes, ...(ent.revezamentoPonteM3T1 ? { ponteM3T1: true } : {}) });
    return e.estabilizou ? e.linhas.filter((a) => ix(a) >= ap) : marc;
  };
  const offRegen = estab(gerarEscala(r0.entradaFluxo).alocacoes);

  // mundo W2: produtividade do posto pelo HISTÓRICO real (em vez de meta × f do motor), aproximada por pool (média da razão das máquinas do pool)
  const entW2 = { ...ent, pools: ent.pools.map((p) => {
    const k = chavePool(p.produtoId, p.etapaId);
    const f = (ctx.fator[k] ?? 1) || 1;
    const rs = p.maquinasIds.map((m) => estimador({ produtoId: p.produtoId, operacaoId: p.operacaoId, maquinaId: m })).filter((t) => t.fonte === "historico").map((t) => t.razao);
    const razao = rs.length > 0 ? rs.reduce((q, v) => q + v, 0) / rs.length : f;
    return { ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([per, v]) => [per, (v / f) * razao])) };
  }) };

  const avalia = (plan: AlocacaoEscala[], rm: Record<string, number>, mesmo: boolean, mundo: "W1" | "W2" = "W1") => {
    const e2 = mundo === "W2" ? entW2 : ent;
    const op = { ...opcoes, fluxoMesmoPeriodo: mesmo, limitesRemPorPool: rm };
    const av = avaliarPlano(e2, dados, [...ent.congeladas, ...plan], op);
    const vio = verificarRestricoesDuras(ent, [...ent.congeladas, ...plan], { somenteLinhasNovas: true }).length;
    return {
      finalLo: Math.round(av.totais.finalEntregueLo), faltaLo: Math.round(av.totais.faltaFinalLo), receitaLo: receita(e2, av), wipFinalLo: Math.round(av.totais.wipFinalLo), excessoWip: Math.round(av.totais.excessoWip),
      semPosto: plan.filter((a) => !a.maquinaId).length, comPosto: plan.filter((a) => a.maquinaId).length, violacoes: vio,
    };
  };
  const construirON = (f: ForecastDoPlano, K: number) => {
    const { reposicaoMinima, remExtra } = reposicaoMinimaDe(f, K);
    const remON: Record<string, number> = { ...rem };
    const remGer: Record<string, number> = { ...(r0.entradaFluxo.remPorPool ?? {}) };
    Object.entries(remExtra).forEach(([k, v]) => { remON[k] = (remON[k] ?? 0) + v; remGer[k] = (remGer[k] ?? 0) + v; });
    const plano = estab(gerarEscala({ ...r0.entradaFluxo, reposicaoMinima, remPorPool: remGer }).alocacoes);
    return { plano, remON, postosPedidos: Object.values(reposicaoMinima).reduce((q, o) => q + Object.keys(o).length, 0) };
  };
  const variantes: Record<string, any> = {};
  for (const [nomeV, K] of [["agora", 1], ["prox2", 2], ["horizonte", Number.POSITIVE_INFINITY]] as [string, number][]) {
    const v = construirON(fOff, K);
    const fv = forecastDoPlano(ctx, v.plano, { ...fopt, limites: v.remON });
    variantes[nomeV] = {
      W1: avalia(v.plano, v.remON, false), W2: avalia(v.plano, v.remON, false, "W2"), W1_mesmoTrue: avalia(v.plano, v.remON, true),
      diffVsRegen: diff(offRegen, v.plano, ap), diffVsOff: diff(off, v.plano, ap), churnVsVigente: churnIndependente(ent, v.plano, vig),
      rupturasRestantes: fv.resultado.ligacoes.filter((l) => l.rupturaPrevista).length, postosPedidos: v.postosPedidos,
    };
  }
  const m = {
    off: avalia(off, rem, false), offRegen: avalia(offRegen, rem, false),
    off_W2: avalia(off, rem, false, "W2"), offRegen_W2: avalia(offRegen, rem, false, "W2"), offRegen_mesmoTrue: avalia(offRegen, rem, true),
  };
  const fOnRup = variantes.horizonte.rupturasRestantes as number;
  const rupOff = fOff.resultado.ligacoes.filter((l) => l.rupturaPrevista).length;
  const rupOn = fOnRup;
  const individuais: any[] = [];
  fOff.resultado.ligacoes.filter((l) => l.acao.tipo !== "nenhuma" && l.acao.ligarEm !== null && l.acao.ligarEm <= 1).forEach((l) => {
    const fOne: ForecastDoPlano = { ...fOff, resultado: { ...fOff.resultado, ligacoes: [l] } };
    const v = construirON(fOne, 2);
    const mi = avalia(v.plano, v.remON, false);
    individuais.push({ ligacao: l.rotulo, tipo: l.acao.tipo, faltaEvitada: Math.round(l.acao.faltaEvitada), postosPeriodo: l.acao.postosPeriodoAdicionais, ligarEm: l.acao.ligarEmRotulo, adicionar: Math.round(l.acao.adicionar.slice(0, 2).reduce((q, x) => q + x, 0)), dFinal: mi.finalLo - m.offRegen.finalLo, dReceita: mi.receitaLo - m.offRegen.receitaLo, dWip: mi.wipFinalLo - m.offRegen.wipFinalLo, pessoas: diff(offRegen, v.plano, ap).pessoasAlteradas, linhas: diff(offRegen, v.plano, ap).linhasAlteradas });
  });
  const linhasDiag = fOff.resultado.ligacoes.filter((l) => l.rupturaPrevista || l.acao.tipo !== "nenhuma" || l.coberturaSemReposicao.periodos !== null).map((l) => ({
    ligacao: l.rotulo, wip: Math.round(l.wipInicial), conf: l.confianca, coberturaPeriodos: l.coberturaSemReposicao.periodos, ruptura: l.rupturaPrevista ? { p: l.rupturaPrevista.rotulo, per: l.rupturaPrevista.periodo, falta: Math.round(l.rupturaPrevista.faltaPecas) } : null,
    gatilho: l.gatilhoPontoDePedido, acao: l.acao.tipo, ligarEm: l.acao.ligarEmRotulo, ligarEmIdx: l.acao.ligarEm, adicionar: Math.round(l.acao.adicionar.reduce((q, x) => q + x, 0)), postosAdic: l.acao.postosAdicionais.reduce((q, x) => q + x, 0), inevitavel: Math.round(l.acao.inevitavel),
    antecedencia: l.rupturaPrevista && l.acao.ligarEm !== null ? l.rupturaPrevista.periodo - l.acao.ligarEm : null, rupturaComAcao: !!l.rupturaComAcao,
  }));
  const capLivre = fOff.resultado.nos.map((n) => ({ no: n.rotulo, postosLivresMax: Math.max(0, ...n.postosLivres), periodosComLivre: n.postosLivres.filter((v) => v > 0).length, removivelTotalMax: Math.round(Math.max(0, ...n.removivel)) })).filter((x) => x.postosLivresMax > 0);
  saida.recalculos.push({
    agora: iso, aPartirDe: `${slots[ap].data} ${slots[ap].periodoId}`, ap, horizonte: slots.length - ap, planoEscolhido: r0.diagnostico.planoEscolhido, segundos: (Date.now() - t0) / 1000,
    fatorMedido: { ...fatMed }, fatorUsado: fator, confianca: fOff.resultado.confianca, menorCobertura: fOff.resultado.menorCobertura,
    forecastGravado: { rupturas: fRec.resultado.ligacoes.filter((l) => l.rupturaPrevista).length, ligacoes: fRec.resultado.ligacoes.length },
    forecastOff: { rupturas: rupOff, acoes: fOff.resultado.ligacoes.filter((l) => l.acao.tipo === "ligar_upstream").length, semFonte: fOff.resultado.ligacoes.filter((l) => l.acao.tipo === "sem_fonte").length },
    forecastOnRupturas: rupOn, metricas: m, variantes, churnOff: churnIndependente(ent, off, vig), churnOffRegen: churnIndependente(ent, offRegen, vig),
    individuais, linhasDiag, capLivre,
  });
  console.error("ok", iso, (Date.now() - t0) / 1000, "s", "rup OFF", rupOff, "acoes", fOff.resultado.ligacoes.filter((l) => l.acao.tipo !== "nenhuma").length, "dFinal agora/prox2/hor", variantes.agora.W1.finalLo - m.offRegen.finalLo, variantes.prox2.W1.finalLo - m.offRegen.finalLo, variantes.horizonte.W1.finalLo - m.offRegen.finalLo);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (a) antecipação: TODAS as avaliações (recálculo × nó × slot) do forecast sobre o plano gravado, com a verdade do slot (quando fechado)
// ---------------------------------------------------------------------------------------------------------------------------------
const vd = new Map(celulasVerdade.map((c) => [`${c.slot}|${c.no}`, c]));
saida.avaliacoes = previsoes.filter((p) => vd.has(`${p.slot}|${p.no}`)).map((p) => {
  const c = vd.get(`${p.slot}|${p.no}`) as CelulaVerdade;
  const quedaReal = c.real !== null && c.real < 0.85 * c.planejado;
  const estoqueInsuf = c.w0hi < c.planejado;
  return { agora: p.agora, lead: p.slot - p.ap, slot: p.slot, no: p.no, rotulo: p.rotulo, previsto: p.previsto, falta: Math.round(p.falta), desejado: Math.round(p.desejado), confirmado: c.confirmado, apontado: c.apontado, planejado: Math.round(c.planejado), real: c.real, w0lo: Math.round(c.w0lo), w0hi: Math.round(c.w0hi), faltaMaterial: c.faltaMaterial, quedaReal, estoqueInsuf, verdadeMaterial: c.faltaMaterial || (estoqueInsuf && quedaReal) };
});
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(saida, null, 1));
void SEMANA; void ligacaoTexto;

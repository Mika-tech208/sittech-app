/* eslint-disable @typescript-eslint/no-explicit-any */
// REPLAY OFFLINE do FORECAST DE BUFFER sobre os recálculos reais de 28/10 a 30/10 (SOMENTE SELECT em cache; nada é gravado em PROD, nada é publicado).
// Por recálculo: (1) forecast sobre o plano GRAVADO na época (antecipação × realidade); (2) forecast sobre o plano do motor de hoje (OFF) e simulação ON
// (mínimo de reposição upstream imposto no período indicado + regeração pelo gerarEscala) — SIMULAÇÃO sobre o mesmo simulador (pode ser otimista).
// Env: AGORAS=iso,iso  OUT=arquivo.json  JANELA=14  NMIN=3  FATOR=medido|1
import * as fs from "node:fs";
import { abrir, estadoEm, versaoEm, receita, SEMANA, type EstadoReplay } from "./comum";
import { avaliarPlano, planejarComFluxo, verificarRestricoesDuras } from "@/features/escala/fluxo";
import { capsDoPlano } from "@/features/escala/fluxo/avaliar";
import { cenarioContinuo, forecastDoPlano, reposicaoMinimaDe, transferenciaPorArestaDe, type ForecastDoPlano, type OpcoesForecastPlano } from "@/features/escala/fluxo/forecastBufferPlano";
import { criarEstimadorPosto, fatorReposicaoMedido, type ConsultaPosto } from "@/features/escala/fluxo/produtividadePosto";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { estabilizarPessoas } from "@/features/escala/estabilidade";
import { maquinaDisponivelNoSlot } from "@/features/escala/disponibilidade";
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
type Cen = "cons" | "cont"; // cenário das ligações DESCONHECIDAS: cons = lote de 1 período (conservador), cont = contínuo
const previsoes: { cen: Cen; agora: string; ap: number; slot: number; no: string; falta: number; desejado: number; rotulo: string; previsto: boolean }[] = [];

for (const iso of AGORAS) {
  const t0 = Date.now();
  const agoraMs = Date.parse(iso);
  const plano = versaoEm(iso);
  const E = estadoEm(A, agoraMs, plano, { mesmoPeriodo: false });
  const { ent, dados, opcoes, ap, ctx } = E;
  if (ap >= slots.length) continue;
  const vig = plano.filter((a) => ix(a) >= ap);
  const estimador = criarEstimadorPosto(todosAps, agoraMs, { janelaDias: JANELA, nMin: NMIN });
  const r0 = planejarComFluxo(ent, dados, opcoes); // OFF = motor de HOJE (regra global conservadora)
  const rem = r0.diagnostico.estado.remPorPool;
  // teto de produção útil do nó p/ o forecast = demanda D_k do fluxo, NÃO o rem do motor (que já desconta o teto de utilidade e zeraria a reposição extra)
  const demandaFluxo: Record<string, number> = Object.fromEntries(r0.diagnostico.estado.demanda.map((x) => [x.chave, x.demandaFluxo]));
  const off = r0.resultado.alocacoes.filter((a) => ix(a) >= ap);
  const fatMed = fatorReposicaoMedido(estimador, postosDoPlano(off, ap, ctx));
  const fator = process.env.FATOR === "1" ? 1 : process.env.FATOR === "medido" ? fatMed.fator : 1;
  const rn = rotuloNo(null);
  const fopt: OpcoesForecastPlano = { limites: demandaFluxo, estimador, rotuloNo: rn, fatorReposicao: fator, mesmoPeriodo: false };

  // (1) forecast sobre o plano GRAVADO (antecipação × realidade), nos DOIS cenários das ligações desconhecidas
  const fRec = forecastDoPlano(ctx, vig, fopt);
  const lagsCen = { cons: transferenciaPorArestaDe(fRec.entrada, "conservador"), cont: transferenciaPorArestaDe(fRec.entrada, "continuo") };
  (["cons", "cont"] as Cen[]).forEach((c) => {
    const fr = c === "cons" ? fRec : cenarioContinuo(fRec);
    fr.resultado.nos.forEach((n) => n.producaoDesejada.forEach((des, i) => {
      const falta = des - n.producaoPlano[i];
      if (fr.entrada.ligacoes.some((l) => l.destino === n.noId)) previsoes.push({ cen: c, agora: iso, ap, slot: fr.mapa.slotDoPeriodo[i], no: n.noId, falta: Math.max(0, falta), desejado: des, rotulo: n.rotulo, previsto: falta > 1e-3 });
    }));
  });

  // (2) forecast sobre o plano do motor de hoje (OFF) e simulações ON
  const fOff = forecastDoPlano(ctx, off, fopt);
  const scen: Record<Cen, ForecastDoPlano> = { cons: fOff, cont: cenarioContinuo(fOff) };
  const estab = (linhas: AlocacaoEscala[]) => {
    const marc = linhas.filter((a) => ix(a) >= ap);
    if (vig.length === 0 || marc.length === 0) return marc;
    const e = estabilizarPessoas(marc, vig, ent.congeladas, ent.slots, { escopo: "bloco", equivalencias: ent.equivalenciaOperacoes, ...(ent.revezamentoPonteM3T1 ? { ponteM3T1: true } : {}) });
    return e.estabilizou ? e.linhas.filter((a) => ix(a) >= ap) : marc;
  };
  void estab;

  // mundo W2: produtividade do posto pelo HISTÓRICO real (em vez de meta × f do motor), aproximada por pool
  const entW2 = { ...ent, pools: ent.pools.map((p) => {
    const k = chavePool(p.produtoId, p.etapaId);
    const f = (ctx.fator[k] ?? 1) || 1;
    const rs = p.maquinasIds.map((m) => estimador({ produtoId: p.produtoId, operacaoId: p.operacaoId, maquinaId: m })).filter((t) => t.fonte === "historico").map((t) => t.razao);
    const razao = rs.length > 0 ? rs.reduce((q, v) => q + v, 0) / rs.length : f;
    return { ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([per, v]) => [per, (v / f) * razao])) };
  }) };
  /** mundo de avaliação: transferência (global conservadora | por aresta no cenário c) × produtividade (W1 meta×f | W2 histórico) */
  type Mundo = { c?: Cen; w2?: boolean };
  const avalia = (plan: AlocacaoEscala[], rm: Record<string, number>, m: Mundo = {}) => {
    const e2 = m.w2 ? entW2 : ent;
    const op = { ...opcoes, fluxoMesmoPeriodo: false, limitesRemPorPool: rm, ...(m.c ? { transferenciaPorAresta: lagsCen[m.c] } : {}) };
    const av = avaliarPlano(e2, dados, [...ent.congeladas, ...plan], op);
    const vio = verificarRestricoesDuras(ent, [...ent.congeladas, ...plan], { somenteLinhasNovas: true }).length;
    return { finalLo: Math.round(av.totais.finalEntregueLo), faltaLo: Math.round(av.totais.faltaFinalLo), receitaLo: receita(e2, av), wipFinalLo: Math.round(av.totais.wipFinalLo), excessoWip: Math.round(av.totais.excessoWip), semPosto: plan.filter((a) => !a.maquinaId).length, violacoes: vio };
  };
  const aplicarMinimos = (basePlano: AlocacaoEscala[], minimos: Record<string, Record<string, number>>, remAv: Record<string, number>, m: Mundo) => {
    let plano = basePlano.map((a) => ({ ...a }));
    let trocas = 0, falhas = 0;
    const fin = (pl: AlocacaoEscala[]) => { const r = avalia(pl, remAv, m); return { f: r.finalLo, w: r.wipFinalLo }; };
    for (const sStr of Object.keys(minimos).sort((x, y) => Number(x) - Number(y))) {
      const sl = Number(sStr);
      for (const [chave, n] of Object.entries(minimos[sStr])) {
        const pool = ctx.poolsPorChave.get(chave);
        const no = ctx.grafo.noDoPool[chave];
        if (!pool || !no) { falhas++; continue; }
        const membros = ctx.grafo.nos[no].membros;
        const doNo = (a: AlocacaoEscala) => !!a.maquinaId && !!a.produtoId && !!a.etapaId && membros.includes(chavePool(a.produtoId, a.etapaId));
        let atual = plano.filter((a) => ix(a) === sl && doNo(a)).length;
        while (atual < n) {
          const usadas = new Set(plano.filter((a) => ix(a) === sl && a.maquinaId).map((a) => a.maquinaId));
          const livres = pool.maquinasIds.filter((mq) => !usadas.has(mq) && maquinaDisponivelNoSlot(ent, mq, ent.slots[sl]));
          const doadores = plano.filter((a) => ix(a) === sl && !doNo(a));
          let melhor: { pl: AlocacaoEscala[]; f: number; w: number } | null = null;
          for (const mq of livres) for (const dnr of doadores) {
            const mu = (pool.metas[ent.slots[sl].periodoId] ?? 0) * (ctx.fator[chave] ?? 1);
            const novo = plano.map((a) => (a === dnr ? { ...a, maquinaId: mq, produtoId: pool.produtoId, etapaId: pool.etapaId, operacaoId: pool.operacaoId, pecas: mu, pecasAdicional: 0, motivoSemPosto: null } : a));
            if (verificarRestricoesDuras(ent, [...ent.congeladas, ...novo.filter((a) => ix(a) >= ap)], { somenteLinhasNovas: true }).length > 0) continue;
            const r = fin(novo.filter((a) => ix(a) >= ap));
            if (!melhor || r.f > melhor.f + 1e-9 || (Math.abs(r.f - melhor.f) <= 1e-9 && r.w < melhor.w)) melhor = { pl: novo, f: r.f, w: r.w };
          }
          if (!melhor) { falhas++; break; }
          plano = melhor.pl; atual++; trocas++;
        }
      }
    }
    return { plano: plano.filter((a) => ix(a) >= ap), trocas, falhas };
  };

  // motor de hoje com a regra global × o mesmo motor se conhecesse o modo de cada ligação (custo da regra global inadequada)
  const motorPorAresta: Record<string, any> = {};
  (["cons", "cont"] as Cen[]).forEach((c) => {
    const rr = planejarComFluxo(ent, dados, { ...opcoes, transferenciaPorAresta: lagsCen[c] });
    const pl = rr.resultado.alocacoes.filter((a) => ix(a) >= ap);
    motorPorAresta[c] = { escolhido: rr.diagnostico.planoEscolhido, final: avalia(pl, rr.diagnostico.estado.remPorPool, { c }).finalLo, planoDeHojeNesseMundo: avalia(off, rem, { c }).finalLo, pessoasAlteradas: diff(off, pl, ap).pessoasAlteradas };
  });

  const porCenario: Record<string, any> = {};
  for (const c of ["cons", "cont"] as Cen[]) {
    const f = scen[c];
    const variantes: Record<string, any> = {};
    const base = { W1: avalia(off, rem, { c }), W1h: avalia(off, rem, { c, w2: true }) };
    for (const [nomeV, K] of [["agora", 1], ["prox2", 2], ["horizonte", Number.POSITIVE_INFINITY]] as [string, number][]) {
      const mm = reposicaoMinimaDe(f, K);
      const remAv: Record<string, number> = { ...rem };
      Object.entries(mm.remExtra).forEach(([k, v]) => (remAv[k] = (remAv[k] ?? 0) + v));
      const ed = aplicarMinimos(off, mm.reposicaoMinima, remAv, { c });
      const fe = forecastDoPlano(ctx, ed.plano, fopt);
      const fec = c === "cons" ? fe : cenarioContinuo(fe);
      variantes[nomeV] = {
        M: avalia(ed.plano, remAv, { c }), Mh: avalia(ed.plano, remAv, { c, w2: true }), cruzado: avalia(ed.plano, remAv, { c: c === "cons" ? "cont" : "cons" }),
        trocas: ed.trocas, falhas: ed.falhas, diffVsOff: diff(off, ed.plano, ap), churnVsVigente: churnIndependente(ent, ed.plano, vig),
        rupturasRestantes: fec.resultado.ligacoes.filter((l) => l.rupturaPrevista).length,
      };
    }
    const individuais: any[] = [];
    f.resultado.ligacoes.filter((l) => l.acao.tipo !== "nenhuma" && l.acao.ligarEm !== null && l.acao.ligarEm <= 1).forEach((l) => {
      const fOne: ForecastDoPlano = { ...f, resultado: { ...f.resultado, ligacoes: [l] } };
      const mm = reposicaoMinimaDe(fOne, 2);
      const remI: Record<string, number> = { ...rem };
      Object.entries(mm.remExtra).forEach(([k, v]) => (remI[k] = (remI[k] ?? 0) + v));
      const ed = aplicarMinimos(off, mm.reposicaoMinima, remI, { c });
      const mi = avalia(ed.plano, remI, { c }), mh = avalia(ed.plano, remI, { c, w2: true });
      individuais.push({ ligacao: l.rotulo, incerta: l.incerta, tipo: l.acao.tipo, faltaEvitada: Math.round(l.acao.faltaEvitada), postosPeriodo: l.acao.postosPeriodoAdicionais, ligarEm: l.acao.ligarEmRotulo, adicionar: Math.round(l.acao.adicionar.slice(0, 2).reduce((q, x) => q + x, 0)), trocas: ed.trocas, dFinal: mi.finalLo - base.W1.finalLo, dFinalW2: mh.finalLo - base.W1h.finalLo, dReceita: mi.receitaLo - base.W1.receitaLo, dWip: mi.wipFinalLo - base.W1.wipFinalLo });
    });
    const linhasDiag = f.resultado.ligacoes.map((l) => ({
      ligacao: l.rotulo, modo: l.transferencia, incerta: l.incerta, diverge: l.divergeEntreCenarios, wip: Math.round(l.wipInicial), conf: l.confianca, coberturaPeriodos: l.coberturaSemReposicao.periodos,
      ruptura: l.rupturaPrevista ? { p: l.rupturaPrevista.rotulo, per: l.rupturaPrevista.periodo, falta: Math.round(l.rupturaPrevista.faltaPecas) } : null,
      gatilho: l.gatilhoPontoDePedido, acao: l.acao.tipo, ligarEm: l.acao.ligarEmRotulo, ligarEmIdx: l.acao.ligarEm, adicionar: Math.round(l.acao.adicionar.reduce((q, x) => q + x, 0)), postosAdic: l.acao.postosAdicionais.reduce((q, x) => q + x, 0), inevitavel: Math.round(l.acao.inevitavel),
      antecedencia: l.rupturaPrevista && l.acao.ligarEm !== null ? l.rupturaPrevista.periodo - l.acao.ligarEm : null, rupturaComAcao: !!l.rupturaComAcao,
    }));
    porCenario[c] = { base, variantes, individuais, linhasDiag, rupturas: f.resultado.ligacoes.filter((l) => l.rupturaPrevista).length, acoesLigar: f.resultado.ligacoes.filter((l) => l.acao.tipo === "ligar_upstream").length, semFonte: f.resultado.ligacoes.filter((l) => l.acao.tipo === "sem_fonte").length,
      postosSemMaterial: Math.round(f.resultado.nos.reduce((q, n) => q + n.postosSemMaterial.reduce((s, v) => s + v, 0), 0) * 10) / 10 };
  }
  const incertas = fOff.resultado.ligacoes.filter((l) => l.incerta);
  saida.recalculos.push({
    agora: iso, aPartirDe: `${slots[ap].data} ${slots[ap].periodoId}`, ap, horizonte: slots.length - ap, planoEscolhido: r0.diagnostico.planoEscolhido, segundos: (Date.now() - t0) / 1000,
    fatorMedido: { ...fatMed }, fatorUsado: fator, confianca: fOff.resultado.confianca,
    ligacoes: fOff.resultado.ligacoes.length, ligacoesIncertas: incertas.length, ligacoesQueDivergem: incertas.filter((l) => l.divergeEntreCenarios).length,
    motorPorAresta, porCenario,
  });
  console.error("ok", iso, (Date.now() - t0) / 1000, "s", "incertas", incertas.length, "divergem", incertas.filter((l) => l.divergeEntreCenarios).length, "dFinal edit agora/hor cons", porCenario.cons.variantes.agora.M.finalLo - porCenario.cons.base.W1.finalLo, porCenario.cons.variantes.horizonte.M.finalLo - porCenario.cons.base.W1.finalLo, "cont", porCenario.cont.variantes.agora.M.finalLo - porCenario.cont.base.W1.finalLo, porCenario.cont.variantes.horizonte.M.finalLo - porCenario.cont.base.W1.finalLo);
}

// (a) antecipação por cenário: TODAS as avaliações (recálculo × nó × slot) com a verdade do slot fechado
const vd = new Map(celulasVerdade.map((c) => [`${c.slot}|${c.no}`, c]));
saida.avaliacoes = previsoes.filter((p) => vd.has(`${p.slot}|${p.no}`)).map((p) => {
  const c = vd.get(`${p.slot}|${p.no}`) as CelulaVerdade;
  const quedaReal = c.real !== null && c.real < 0.85 * c.planejado;
  const estoqueInsuf = c.w0hi < c.planejado;
  return { cen: p.cen, agora: p.agora, lead: p.slot - p.ap, slot: p.slot, no: p.no, rotulo: p.rotulo, previsto: p.previsto, falta: Math.round(p.falta), desejado: Math.round(p.desejado), confirmado: c.confirmado, apontado: c.apontado, planejado: Math.round(c.planejado), real: c.real, w0lo: Math.round(c.w0lo), w0hi: Math.round(c.w0hi), faltaMaterial: c.faltaMaterial, quedaReal, estoqueInsuf, verdadeMaterial: c.faltaMaterial || (estoqueInsuf && quedaReal) };
});
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(saida, null, 1));
void SEMANA;

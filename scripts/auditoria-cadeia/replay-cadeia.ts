/* eslint-disable @typescript-eslint/no-explicit-any */
// REPLAY OFFLINE do PLANEJAMENTO DE CADEIA (validar + reparar o candidato vigente) — base: replay do forecast de buffer sobre os recálculos reais de 28/10 a 30/10 (SOMENTE SELECT em cache; nada é gravado em PROD, nada é publicado).
// Por recálculo: (1) forecast sobre o plano GRAVADO na época (antecipação × realidade); (2) forecast sobre o plano do motor de hoje (OFF) e simulação ON
// (mínimo de reposição upstream imposto no período indicado + regeração pelo gerarEscala) — SIMULAÇÃO sobre o mesmo simulador (pode ser otimista).
// Env: AGORAS=iso,iso  OUT=arquivo.json  JANELA=14  NMIN=3  FATOR=medido|1
import * as fs from "node:fs";
import { abrir, estadoEm, versaoEm, receita, SEMANA, type EstadoReplay } from "../auditoria-buffer/comum";
import { avaliarPlano, planejarComFluxo, verificarRestricoesDuras } from "@/features/escala/fluxo";
import { capsDoPlano } from "@/features/escala/fluxo/avaliar";
import { entradaForecastDoPlano, type OpcoesForecastPlano } from "@/features/escala/fluxo/forecastBufferPlano";
import { repararCadeia, validarCadeia, type CandidatoCadeia } from "@/features/escala/fluxo/planejamentoCadeia";
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

const saida: any = { parametros: { JANELA, NMIN, agoras: AGORAS.length, ufechFinal }, verdadeCelulas: celulasVerdade, recalculos: [] as any[], alertas: [] as any[] };
const num = (x: number) => Math.round(x);
const soma = (a: number[]) => a.reduce((s, v) => s + v, 0);

for (const iso of AGORAS) {
  const t0 = Date.now();
  const agoraMs = Date.parse(iso);
  const plano = versaoEm(iso);
  const E = estadoEm(A, agoraMs, plano, { mesmoPeriodo: false });
  const { ent, dados, opcoes, ap, ctx } = E;
  if (ap >= slots.length) continue;
  const vig = plano.filter((a) => ix(a) >= ap);
  const estimador = criarEstimadorPosto(todosAps, agoraMs, { janelaDias: JANELA, nMin: NMIN });
  const r0 = planejarComFluxo(ent, dados, opcoes);
  const rem = r0.diagnostico.estado.remPorPool;
  const demandaFluxo: Record<string, number> = Object.fromEntries(r0.diagnostico.estado.demanda.map((x) => [x.chave, x.demandaFluxo]));
  const off = r0.resultado.alocacoes.filter((a) => ix(a) >= ap);
  const rn = rotuloNo(null);
  const fopt: OpcoesForecastPlano = { limites: demandaFluxo, estimador, rotuloNo: rn, mesmoPeriodo: false };
  const mk = (pl: AlocacaoEscala[]) => entradaForecastDoPlano(ctx, pl, fopt);
  const proxDe = (en: ReturnType<typeof mk>["entrada"]) => ({ rotulo: "ter M1", duracaoMin: 80, producaoPorNo: Object.fromEntries(en.nos.map((n) => [n.id, Math.max(0, ...n.producaoPrevista.slice(-3))])) });

  // ---- alerta sobre o plano GRAVADO na época (verdade por célula) ----
  const enRec = mk(vig);
  const vRec = validarCadeia(enRec.entrada);
  vRec.violacoes.forEach((v) => {
    const slot = enRec.mapa.slotDoPeriodo[v.periodo];
    saida.alertas.push({ agora: iso, ap, slot, lead: slot - ap, no: v.noId, rotulo: v.rotulo, falta: num(v.falta), desejada: num(v.desejada) });
  });

  const entW2 = { ...ent, pools: ent.pools.map((p) => {
    const k = chavePool(p.produtoId, p.etapaId);
    const f = (ctx.fator[k] ?? 1) || 1;
    const rs = p.maquinasIds.map((m) => estimador({ produtoId: p.produtoId, operacaoId: p.operacaoId, maquinaId: m })).filter((t) => t.fonte === "historico").map((t) => t.razao);
    const razao = rs.length > 0 ? rs.reduce((q, v) => q + v, 0) / rs.length : f;
    return { ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([per, v]) => [per, (v / f) * razao])) };
  }) };
  type Mundo = { w2?: boolean };
  const avalia = (plan: AlocacaoEscala[], rm: Record<string, number>, m: Mundo = {}) => {
    const e2 = m.w2 ? entW2 : ent;
    const av = avaliarPlano(e2, dados, [...ent.congeladas, ...plan], { ...opcoes, fluxoMesmoPeriodo: false, limitesRemPorPool: rm });
    const vio = verificarRestricoesDuras(ent, [...ent.congeladas, ...plan], { somenteLinhasNovas: true }).length;
    return { finalLo: Math.round(av.totais.finalEntregueLo), faltaLo: Math.round(av.totais.faltaFinalLo), receitaLo: receita(e2, av), wipFinalLo: Math.round(av.totais.wipFinalLo), excessoWip: Math.round(av.totais.excessoWip), semPosto: plan.filter((a) => !a.maquinaId).length, violacoes: vio };
  };
  const valorDoNo = (noId: string) => { const pool = ctx.poolsPorChave.get(ctx.grafo.nos[noId].membros[0]); return pool?.valorUnitario ?? 0; };
  const aplicarMinimos = (basePlano: AlocacaoEscala[], minimos: Record<string, Record<string, number>>, remAv: Record<string, number>, m: Mundo) => {
    let pl = basePlano.map((a) => ({ ...a }));
    let trocas = 0, falhas = 0;
    const fin = (x: AlocacaoEscala[]) => { const r = avalia(x, remAv, m); return { f: r.finalLo, w: r.wipFinalLo }; };
    for (const sStr of Object.keys(minimos).sort((x, y) => Number(x) - Number(y))) {
      const sl = Number(sStr);
      for (const [chave, n] of Object.entries(minimos[sStr])) {
        const pool = ctx.poolsPorChave.get(chave);
        const no = ctx.grafo.noDoPool[chave];
        if (!pool || !no) { falhas++; continue; }
        const membros = ctx.grafo.nos[no].membros;
        const doNo = (a: AlocacaoEscala) => !!a.maquinaId && !!a.produtoId && !!a.etapaId && membros.includes(chavePool(a.produtoId, a.etapaId));
        let atual = pl.filter((a) => ix(a) === sl && doNo(a)).length;
        while (atual < n) {
          const usadas = new Set(pl.filter((a) => ix(a) === sl && a.maquinaId).map((a) => a.maquinaId));
          const livres = pool.maquinasIds.filter((mq) => !usadas.has(mq) && maquinaDisponivelNoSlot(ent, mq, ent.slots[sl]));
          const doadores = pl.filter((a) => ix(a) === sl && !doNo(a));
          let melhor: { pl: AlocacaoEscala[]; f: number; w: number } | null = null;
          for (const mq of livres) for (const dnr of doadores) {
            const mu = (pool.metas[ent.slots[sl].periodoId] ?? 0) * (ctx.fator[chave] ?? 1);
            const novo = pl.map((a) => (a === dnr ? { ...a, maquinaId: mq, produtoId: pool.produtoId, etapaId: pool.etapaId, operacaoId: pool.operacaoId, pecas: mu, pecasAdicional: 0, motivoSemPosto: null } : a));
            if (verificarRestricoesDuras(ent, [...ent.congeladas, ...novo.filter((a) => ix(a) >= ap)], { somenteLinhasNovas: true }).length > 0) continue;
            const r = fin(novo.filter((a) => ix(a) >= ap));
            if (!melhor || r.f > melhor.f + 1e-9 || (Math.abs(r.f - melhor.f) <= 1e-9 && r.w < melhor.w)) melhor = { pl: novo, f: r.f, w: r.w };
          }
          if (!melhor) { falhas++; break; }
          pl = melhor.pl; atual++; trocas++;
        }
      }
    }
    return { plano: pl.filter((a) => ix(a) >= ap), trocas, falhas };
  };
  const minimosDe = (en: ReturnType<typeof mk>, c: CandidatoCadeia) => {
    const reposicaoMinima: Record<string, Record<string, number>> = {};
    const remExtra: Record<string, number> = {};
    en.entrada.nos.forEach((n) => c.extra[n.id].forEach((ex, i) => {
      if (i >= en.entrada.periodos.length || ex <= 1e-6) return;
      const slot = String(en.mapa.slotDoPeriodo[i]);
      const chave = en.mapa.poolDoNo[n.id].representante;
      const total = (n.postosPrevistos?.[i] ?? 0) + c.postosExtra[n.id][i];
      (reposicaoMinima[slot] ??= {})[chave] = Math.max(reposicaoMinima[slot]?.[chave] ?? 0, total);
      remExtra[chave] = (remExtra[chave] ?? 0) + ex;
    }));
    return { reposicaoMinima, remExtra };
  };

  const base = { W1: avalia(off, rem), W1h: avalia(off, rem, { w2: true }) };
  const enOff = mk(off);
  const cadeiaDe = (plan: AlocacaoEscala[], comTerca: boolean) => {
    const en = mk(plan);
    const sim = validarCadeia(en.entrada, undefined, comTerca ? { proximoDia: proxDe(en.entrada) } : {});
    const iF = en.entrada.periodos.length - 1;
    const sinks = en.entrada.nos.filter((n) => !en.entrada.ligacoes.some((l) => l.origem === n.id));
    return {
      violacoes: sim.violacoes.length, violacoesNaSemana: sim.violacoes.filter((v) => !v.proximoDia).length, pecasSemMaterial: num(soma(sim.violacoes.map((v) => v.falta))), valido: sim.valido,
      postosSemMaterial: Math.round(soma(sim.nos.flatMap((n) => n.postosSemMaterial)) * 10) / 10,
      periodosDownstreamSemMaterial: sim.violacoes.filter((v) => en.entrada.ligacoes.some((l) => l.origem === v.noId) || sinks.some((s) => s.id === v.noId)).length,
      wipSaidaSexta: num(soma(sim.ligacoes.map((l) => l.saldoFinal[iF] ?? 0))),
      wipSaidaPorLigacao: sim.ligacoes.map((l) => ({ l: l.rotulo, v: num(l.saldoFinal[iF] ?? 0) })).filter((x) => x.v > 0),
    };
  };
  const out: any = { agora: iso, aPartirDe: `${slots[ap].data} ${slots[ap].periodoId}`, ap, horizonte: slots.length - ap, planoEscolhido: r0.diagnostico.planoEscolhido, base, cadeiaBase: { semana: cadeiaDe(off, false), semanaTerca: cadeiaDe(off, true) }, cadeiaVigente: { semana: cadeiaDe(vig, false), semanaTerca: cadeiaDe(vig, true) }, arms: {} };
  for (const [nomeArm, comTerca] of [["semana", false], ["semanaTerca", true]] as [string, boolean][]) {
    const opArm = comTerca ? { proximoDia: proxDe(enOff.entrada) } : {};
    const cache = new Map<string, { ed: ReturnType<typeof aplicarMinimos>; remAv: Record<string, number>; m: ReturnType<typeof minimosDe> }>();
    const aplica = (c: CandidatoCadeia) => {
      const m = minimosDe(enOff, c);
      const k = JSON.stringify(m.reposicaoMinima);
      let h = cache.get(k);
      if (!h) {
        const remAv: Record<string, number> = { ...rem };
        Object.entries(m.remExtra).forEach(([kk, v]) => (remAv[kk] = (remAv[kk] ?? 0) + v));
        h = { ed: Object.keys(m.reposicaoMinima).length === 0 ? { plano: off, trocas: 0, falhas: 0 } : aplicarMinimos(off, m.reposicaoMinima, remAv, {}), remAv, m };
        cache.set(k, h);
      }
      return h;
    };
    const avaliar = (c: CandidatoCadeia) => {
      const h = aplica(c);
      const r = avalia(h.ed.plano, h.remAv);
      const sinkVal = enOff.entrada.nos.filter((n) => !enOff.entrada.ligacoes.some((l) => l.origem === n.id)).reduce((q, n) => q + valorDoNo(n.id), 0) / Math.max(1, enOff.entrada.nos.filter((n) => !enOff.entrada.ligacoes.some((l) => l.origem === n.id)).length);
      return r.receitaLo + (comTerca ? c.pecasProximoDia * sinkVal : 0) - 1e-3 * h.ed.trocas;
    };
    const rep = repararCadeia(enOff.entrada, undefined, { ...opArm, avaliar, familias: ["manter", "religar_upstream", "trocar_fonte", "reduzir_downstream", "religar_e_reduzir"] });
    const esc = rep.escolhido;
    const h = aplica(esc);
    const W1 = avalia(h.ed.plano, h.remAv), W1h = avalia(h.ed.plano, h.remAv, { w2: true });
    out.arms[nomeArm] = {
      candidatos: rep.candidatos.map((c) => ({ id: c.id, tipo: c.tipo, valida: c.valida, viol: c.violacoesRestantes, pecasFinais: num(c.pecasFinais), pecasTerca: num(c.pecasProximoDia), pessoasExtra: c.pessoasPeriodoExtra, valor: c.valor === null ? null : num(c.valor) })),
      escolhido: esc.id, tipo: esc.tipo, trocas: h.ed.trocas, falhas: h.ed.falhas, extra: Object.fromEntries(Object.entries(esc.extra).filter(([, v]) => v.some((x) => x > 1e-6)).map(([k, v]) => [rn(ctx.grafo.nos[k].membros[0]), v.map(num)])),
      W1, W1h, dFinal: W1.finalLo - base.W1.finalLo, dFinalW2: W1h.finalLo - base.W1h.finalLo, dReceita: W1.receitaLo - base.W1.receitaLo, dWip: W1.wipFinalLo - base.W1.wipFinalLo,
      diffVsOff: diff(off, h.ed.plano, ap), churnVsVigente: churnIndependente(ent, h.ed.plano, vig), churnBase: churnIndependente(ent, off, vig),
      cadeiaDepois: { semana: cadeiaDe(h.ed.plano, false), semanaTerca: cadeiaDe(h.ed.plano, true) },
    };
  }
  saida.recalculos.push(out);
  const a = out.arms.semanaTerca, b = out.arms.semana;
  console.error("ok", iso, ((Date.now() - t0) / 1000).toFixed(0) + "s", "viol base", out.cadeiaBase.semana.violacoes, "/", out.cadeiaBase.semanaTerca.violacoes, "semana:", b.tipo, "dFinal", b.dFinal, "trocas", b.trocas, "| +terça:", a.tipo, "dFinal", a.dFinal, "trocas", a.trocas, "viol depois", a.cadeiaDepois.semanaTerca.violacoes);
}

// antecipação do ALERTA (plano gravado) × verdade (igual ao D2: célula ancorada e apontada)
const vd = new Map(celulasVerdade.map((c) => [`${c.slot}|${c.no}`, c]));
saida.avaliacoesAlerta = saida.alertas.filter((x: any) => vd.has(`${x.slot}|${x.no}`)).map((x: any) => {
  const c = vd.get(`${x.slot}|${x.no}`) as CelulaVerdade;
  const quedaReal = c.real !== null && c.real < 0.85 * c.planejado;
  return { ...x, apontado: c.apontado, planejado: Math.round(c.planejado), real: c.real, w0hi: Math.round(c.w0hi), faltaMaterial: c.faltaMaterial, verdadeMaterial: c.faltaMaterial || (c.w0hi < c.planejado && quedaReal) };
});
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(saida, null, 1));
void SEMANA; void fatorReposicaoMedido; void gerarEscala; void estabilizarPessoas; void capsDoPlano; void (null as unknown as ConsultaPosto); void (null as unknown as EstadoReplay);

// Resumo serializável de uma Rodada (tabelas por fechamento).
import type { Rodada } from "./rodar";
import type { ViolacaoInd } from "./independente";

export const arred = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n));

export interface ResumoRodada {
  id: string; data: string; periodoId: string; rev: number; modo: string; c: number; aPartirDe: number; corteMs: number; ms: number; bytesDiagnostico: number;
  determinismo: boolean;
  hashPlanoFluxo: string;
  hashResultado: string;
  planoEscolhido: string; iteracao: number | null; theta: number;
  demandaPool: { chave: string; final: boolean; remLegado: number | null; demandaFluxo: number | null; remFluxo: number | null; tetoUtilidade: number | null; limitadoPorUtilidade: boolean }[];
  produtos: { produtoId: string; Qf: number; boasLo: number; boasHi: number; Rf: number; RfMin: number }[];
  pares: { produtoId: string; origem: string; seguinte: string; tipo: string; conf: string; lo: number; hi: number; negativo: boolean }[];
  gargalos: { produtoId: string; etapaId: string; potencial: number; folga: number }[];
  falta: { vigente: [number, number]; base: [number, number]; baseRegen: [number, number]; fluxo: [number, number] };
  final: { vigente: [number, number]; fluxo: [number, number] };
  wipFinal: { vigente: [number, number]; fluxo: [number, number] };
  excessoWip: { vigente: number; fluxo: number };
  simInd: { vigente: number; fluxo: number; baseRegen: number };
  faltaLegada: { vigente: number; fluxo: number; baseRegen: number };
  violNucleoCompleto: number;
  /** J: mudanças (pessoa×período com posto diferente) contra o plano VIGENTE e quantas têm explicação — pela lista detalhada e pelo agregado por período. */
  coberturaDecisoes: { mudancasVsVigente: number; cobertasLista: number; cobertasResumo: number; decisoesTotal: number; listadas: number; semTexto: number; deInconsistente: number };
  vigente: { disponivel: boolean; valido: boolean; motivo: string | null; violNucleo: number; violIndependente: number; faltaLo: number | null };
  estabilizacao: { aplicada: boolean; periodosAjustados: number; linhasAntes: number; linhasDepois: number; motivoDescarte: string | null };
  reconciliacao: { referencia: string; diferenca: number; somaGanhos: number; residuo: number; somaDasDecisoes: number; somaDoResumo: number };
  violNucleoNovas: number;
  alertas: { base: Record<string, number>; fluxo: Record<string, number> };
  churnNucleo: unknown;
  churnInd: { vsVigente: Rodada["churnVsVigente"]; vsBase: Rodada["churnVsBase"]; baseVsVigente: Rodada["churnBaseVsVigente"] };
  violacoes: { A: number; B: number; C: number; D: number; avisos: number; nucleo: number; porTipo: Record<string, number> };
  decisoes: { n: number; listadas: number; semTexto: number; qtdPessoas: number; semJustificativa: number; negativas: number; somaNegativas: number; neutras: number; brutoPositivo: number; brutoNegativo: number; maxAbs: number; resumoTop: { de: string; para: string; pessoas: number; slots: number; ganho: number }[]; ganhoTotal: number; amostra: string[]; anteCompleto: boolean; depoisCompleto: boolean };
  codigos: Record<string, number>;
  erro?: string;
}


export function resumir(r: Rodada): ResumoRodada {
  const d = r.res.diagnostico;
  const st = d.estado;
  const v: ViolacaoInd[] = r.viol;
  const porTipo: Record<string, number> = {};
  v.forEach((x) => (porTipo[`${x.criterio}:${x.tipo}${x.aviso ? "*" : ""}`] = (porTipo[`${x.criterio}:${x.tipo}${x.aviso ? "*" : ""}`] ?? 0) + 1));
  const cod: Record<string, number> = {};
  [...d.diagnosticos, ...st.diagnosticos, ...d.avaliacaoFluxo.diagnosticos].forEach((x) => (cod[x.codigo] = (cod[x.codigo] ?? 0) + 1));
  const tot = (a: Rodada["avFluxo"]) => a.totais;
  return {
    id: r.cen.dec.id, data: r.cen.dec.data, periodoId: r.cen.dec.periodoId, rev: r.cen.dec.revisao, modo: r.cen.dec.modo, c: r.cen.c, aPartirDe: r.cen.aPartirDe, corteMs: r.cen.dec.corteMs, ms: r.ms, bytesDiagnostico: r.bytesDiagnostico,
    determinismo: r.hashDeterminismoOk, hashPlanoFluxo: r.hashPlanoFluxo, hashResultado: r.hashResultado, planoEscolhido: d.planoEscolhido, iteracao: d.iteracaoEscolhida, theta: d.theta,
    demandaPool: st.demanda.map((x) => ({ chave: x.chave, final: x.final, remLegado: arred(x.remLegado), demandaFluxo: arred(x.demandaFluxo), remFluxo: arred(x.remFluxo), tetoUtilidade: arred(x.tetoUtilidade), limitadoPorUtilidade: x.limitadoPorUtilidade })),
    produtos: st.produtos.map((p) => ({ produtoId: p.produtoId, Qf: Math.round(p.quantidadeFinal), boasLo: Math.round(p.boasFinais.lo), boasHi: Math.round(p.boasFinais.hi), Rf: Math.round(p.demandaFinalRestante), RfMin: Math.round(p.demandaFinalRestanteMin) })),
    pares: st.pares.map((p) => ({ produtoId: p.produtoId, origem: p.etapaOrigemId, seguinte: p.etapaSeguinteId, tipo: p.origem, conf: p.confianca, lo: Math.round(p.wip.lo), hi: Math.round(p.wip.hi), negativo: p.negativo })),
    gargalos: d.antes.gargalosFluxo.map((g) => ({ produtoId: g.produtoId, etapaId: g.etapaId, potencial: Math.round(g.potencial), folga: Math.round(g.folga) })),
    falta: { vigente: [Math.round(tot(r.avVigente).faltaFinalLo), Math.round(tot(r.avVigente).faltaFinalHi)], base: [Math.round(tot(r.avBase).faltaFinalLo), Math.round(tot(r.avBase).faltaFinalHi)], baseRegen: [Math.round(tot(r.avBaseRegenerado).faltaFinalLo), Math.round(tot(r.avBaseRegenerado).faltaFinalHi)], fluxo: [Math.round(tot(r.avFluxo).faltaFinalLo), Math.round(tot(r.avFluxo).faltaFinalHi)] },
    final: { vigente: [Math.round(tot(r.avVigente).finalEntregueLo), Math.round(tot(r.avVigente).finalEntregueHi)], fluxo: [Math.round(tot(r.avFluxo).finalEntregueLo), Math.round(tot(r.avFluxo).finalEntregueHi)] },
    wipFinal: { vigente: [Math.round(tot(r.avVigente).wipFinalLo), Math.round(tot(r.avVigente).wipFinalHi)], fluxo: [Math.round(tot(r.avFluxo).wipFinalLo), Math.round(tot(r.avFluxo).wipFinalHi)] },
    excessoWip: { vigente: Math.round(tot(r.avVigente).excessoWip), fluxo: Math.round(tot(r.avFluxo).excessoWip) },
    simInd: { vigente: Math.round(r.simInd.vigente.faltaTotal), fluxo: Math.round(r.simInd.fluxo.faltaTotal), baseRegen: Math.round(r.simInd.baseRegen.faltaTotal) },
    faltaLegada: { vigente: Math.round(r.faltaLegada.vigente), fluxo: Math.round(r.faltaLegada.fluxo), baseRegen: Math.round(r.faltaLegada.baseRegen) },
    violNucleoCompleto: r.violNucleoPlanoCompleto.length,
    violNucleoNovas: r.violNucleoNovas.length,
    vigente: { disponivel: d.vigente.disponivel, valido: d.vigente.valido, motivo: d.vigente.motivo, violNucleo: r.violVigenteNucleo.length, violIndependente: r.violVigente.filter((x) => !x.aviso && x.criterio !== "B").length, faltaLo: d.vigente.falta ? Math.round(d.vigente.falta.lo) : null },
    estabilizacao: d.estabilizacao,
    reconciliacao: { referencia: d.referencia, diferenca: d.reconciliacao.diferenca, somaGanhos: d.reconciliacao.somaGanhos, residuo: d.reconciliacao.residuo, somaDasDecisoes: Math.round(1000 * d.decisoes.reduce((s, x) => s + x.motivo.ganhoProdutoFinal, 0)) / 1000, somaDoResumo: Math.round(1000 * d.resumoDecisoes.reduce((s, x) => s + x.ganhoProdutoFinal, 0)) / 1000 },
    alertas: r.alertas,
    coberturaDecisoes: cobertura(r),
    churnNucleo: d.churn,
    churnInd: { vsVigente: r.churnVsVigente, vsBase: r.churnVsBase, baseVsVigente: r.churnBaseVsVigente },
    violacoes: { A: v.filter((x) => x.criterio === "A" && !x.aviso).length, B: v.filter((x) => x.criterio === "B").length, C: v.filter((x) => x.criterio === "C").length, D: v.filter((x) => x.criterio === "D" && !x.aviso).length, avisos: v.filter((x) => x.aviso).length, nucleo: r.violNucleo.length, porTipo },
    decisoes: {
      n: d.decisoesTotal ?? d.decisoes.length, listadas: d.decisoes.length, semTexto: d.decisoes.filter((x) => !x.motivo?.texto).length, qtdPessoas: (d.resumoDecisoes ?? []).reduce((s, x) => s + x.pessoasPeriodo, 0) || d.decisoes.reduce((s, x) => s + x.quantidade, 0),
      semJustificativa: d.decisoes.filter((x) => !(x.motivo.ganhoProdutoFinal > 0 || x.motivo.wipConsumido > 0 || x.motivo.wipEvitado > 0 || x.motivo.reducaoFalta > 0)).length,
      negativas: d.decisoes.filter((x) => x.motivo.ganhoProdutoFinal < -0.5).length, somaNegativas: Math.round(d.decisoes.filter((x) => x.motivo.ganhoProdutoFinal < -0.5).reduce((s, x) => s + x.motivo.ganhoProdutoFinal, 0)), neutras: d.decisoes.filter((x) => Math.abs(x.motivo.ganhoProdutoFinal) <= 0.5 && !(x.motivo.wipConsumido > 0 || x.motivo.wipEvitado > 0)).length,
      brutoPositivo: Math.round(d.decisoes.filter((x) => x.motivo.ganhoProdutoFinal > 0).reduce((s, x) => s + x.motivo.ganhoProdutoFinal, 0)), brutoNegativo: Math.round(d.decisoes.filter((x) => x.motivo.ganhoProdutoFinal < 0).reduce((s, x) => s + x.motivo.ganhoProdutoFinal, 0)), maxAbs: Math.round(Math.max(0, ...d.decisoes.map((x) => Math.abs(x.motivo.ganhoProdutoFinal)))),
      resumoTop: [...(d.resumoDecisoes ?? [])].sort((a, b) => Math.abs(b.ganhoProdutoFinal) - Math.abs(a.ganhoProdutoFinal)).slice(0, 8).map((x) => ({ de: x.de.produtoId ? `${x.de.produtoId}|${x.de.etapaId}` : "ocioso", para: x.para.produtoId ? `${x.para.produtoId}|${x.para.etapaId}` : "ocioso", pessoas: x.pessoasPeriodo, slots: x.slots, ganho: Math.round(x.ganhoProdutoFinal) })),
      ganhoTotal: Math.round((d.resumoDecisoes ?? []).reduce((s, x) => s + x.ganhoProdutoFinal, 0)),
      amostra: d.decisoes.slice(0, 3).map((x) => `${x.periodoId}: ${x.motivo.texto}`),
      anteCompleto: !!d.antes && Object.keys(d.antes.demandaRestante).length > 0 && Array.isArray(d.antes.wip) && Array.isArray(d.antes.gargalosFluxo) && !!d.antes.faltaFinal,
      depoisCompleto: !!d.depois && !!d.depois.produtoFinalPrevisto && !!d.depois.wipPrevisto && !!d.depois.faltaPrevista && typeof d.depois.excessoWip === "number",
    },
    codigos: cod,
  };
}

// J: quantas mudanças de posto (pessoa×slot) do plano proposto CONTRA o plano VIGENTE (o que o supervisor enxerga) têm explicação — pela lista detalhada de decisões
// (funcionários listados) e pelo agregado `resumoDecisoes` (pool de→para por período, conferido por contagem; vale mesmo quando a lista detalhada é limitada).
function cobertura(r: Rodada) {
  const slots = r.cen.entrada.slots;
  const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const posto = (a?: { maquinaId: string | null; produtoId: string | null; etapaId: string | null }) => (a && a.maquinaId ? `${a.maquinaId}|${a.produtoId}|${a.etapaId}` : "ocioso");
  const pool = (a?: { maquinaId: string | null; produtoId: string | null; etapaId: string | null }) => (a && a.maquinaId ? `${a.produtoId ?? null}|${a.etapaId ?? null}` : "null|null");
  const mapa = (l: Rodada["planoFluxoFuturo"]) => new Map(l.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= r.cen.aPartirDe).map((a) => [`${idx.get(`${a.data}|${a.periodoId}`)}|${a.funcionarioId}`, a]));
  const flu = mapa(r.planoFluxoFuturo), vig = mapa(r.cen.planoVigente);
  const d = r.res.diagnostico;
  const explicadas = new Set<string>();
  d.decisoes.forEach((x) => x.funcionarios.forEach((f) => explicadas.add(`${x.slot}|${f}`)));
  const contagem = new Map<string, number>();
  (d.resumoDecisoes ?? []).forEach((x) => x.porSlot.forEach((ps) => { const k = `${ps.slot}|${x.de.produtoId ?? null}|${x.de.etapaId ?? null}>${x.para.produtoId ?? null}|${x.para.etapaId ?? null}`; contagem.set(k, (contagem.get(k) ?? 0) + ps.pessoas); }));
  const alteradas = [...flu.entries()].filter(([k, x]) => posto(x) !== posto(vig.get(k))).map(([k, x]) => ({ k, slot: k.split("|")[0], de: pool(vig.get(k)), para: pool(x) }));
  let viaResumo = 0;
  alteradas.forEach((a) => { const kk = `${a.slot}|${a.de}>${a.para}`; if ((contagem.get(kk) ?? 0) > 0) { contagem.set(kk, (contagem.get(kk) as number) - 1); viaResumo++; } });
  return { mudancasVsVigente: alteradas.length, cobertasLista: alteradas.filter((a) => explicadas.has(a.k)).length, cobertasResumo: viaResumo, decisoesTotal: d.decisoesTotal ?? d.decisoes.length, listadas: d.decisoes.length, semTexto: d.decisoes.filter((x) => !x.motivo?.texto).length, deInconsistente: d.decisoes.filter((x) => x.funcionarios.some((f) => ((r.cen.planoVigente.find((a) => a.funcionarioId === f && a.data === x.data && a.periodoId === x.periodoId))?.maquinaId ?? null) !== x.de.maquinaId)).length };
}

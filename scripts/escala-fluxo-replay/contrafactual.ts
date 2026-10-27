// F — Caixa Amarela: contrafactuais do mesmo tipo dos feitos manualmente em 27/10, mas avaliados pelo simulador de fluxo do núcleo.
//   base      : motor oficial (gerarEscala) sem hooks
//   reforcoM  : Montagem com prioridade total nos slots mutáveis, E16 mantida (valor marginal artificial)
//   semE16    : E16 desligada (remPorPool[E16] = 0) nos slots mutáveis
//   reforcoMsemE16
//   fluxo     : plano escolhido pelo planejarComFluxo
import { avaliarPlano } from "@/features/escala/fluxo";
import { gerarEscala } from "@/features/escala/gerarEscala";
import type { AlocacaoEscala, EntradaEscala } from "@/features/escala/types";
import { CXE, CXM } from "./extras";
import { rodar, fechamentos } from "./comum";
import type { Rodada } from "./rodar";

const CX = CXE.split("|")[0];

function variante(r: Rodada, nome: string, fn: (e: EntradaEscala) => EntradaEscala) {
  const ent = fn(r.cen.entrada);
  const fut = gerarEscala(ent).alocacoes.filter((a) => (ent.slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId)) >= r.cen.aPartirDe);
  return avaliar(r, nome, fut);
}
function avaliar(r: Rodada, nome: string, fut: AlocacaoEscala[]) {
  const cen = r.cen;
  const av = avaliarPlano(cen.entrada, cen.dados, [...cen.entrada.congeladas, ...fut], cen.opcoes);
  const p = av.produtos.find((x) => x.produtoId === CX);
  const idx = new Map(cen.entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  let E = 0, M = 0, pe = 0, pm = 0;
  fut.forEach((a) => { if (!a.maquinaId) return; const k = `${a.produtoId}|${a.etapaId}`; if ((idx.get(`${a.data}|${a.periodoId}`) ?? -1) < cen.aPartirDe) return; if (k === CXE) { E += a.pecas; pe++; } else if (k === CXM) { M += a.pecas; pm++; } });
  return { nome, cxFinal: p ? [Math.round(p.finalEntregue.lo), Math.round(p.finalEntregue.hi)] : null, cxFalta: p ? [Math.round(p.faltaFinal.lo), Math.round(p.faltaFinal.hi)] : null, faltaTotal: [Math.round(av.totais.faltaFinalLo), Math.round(av.totais.faltaFinalHi)], E16pecas: Math.round(E), Mpecas: Math.round(M), postosE: pe, postosM: pm };
}

export function contrafactualCX(offsets = 2, quais: { data: string; periodoId: string }[]) {
  const out: unknown[] = [];
  for (const q of quais) {
    const d = fechamentos.find((x) => x.data === q.data && x.periodoId === q.periodoId);
    if (!d) continue;
    const r = rodar(d, { offset: offsets });
    const ap = r.cen.aPartirDe;
    const slots = r.cen.entrada.slots;
    const valorMarg: Record<string, Record<string, number[]>> = {};
    for (let t = ap; t < slots.length; t++) valorMarg[String(t)] = { [CXM]: [1e6, 1e6, 1e6, 1e6, 1e6] };
    const st = r.res.diagnostico.estado;
    const par = st.pares.find((p) => p.produtoId === CX);
    const variantes = [
      avaliar(r, "vigente (gravado)", r.cen.planoVigente.filter((a) => (slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId)) >= ap)),
      variante(r, "base (motor oficial agora)", (e) => e),
      variante(r, "reforço Montagem, mantém E16", (e) => ({ ...e, ordemPostos: { valorMarginal: valorMarg } })),
      variante(r, "sem E16", (e) => ({ ...e, remPorPool: { ...(e.remPorPool ?? {}), [CXE]: 0 } })),
      variante(r, "reforço Montagem + sem E16", (e) => ({ ...e, remPorPool: { ...(e.remPorPool ?? {}), [CXE]: 0 }, ordemPostos: { valorMarginal: valorMarg } })),
      avaliar(r, `FLUXO (${r.res.diagnostico.planoEscolhido})`, r.planoFluxoFuturo),
    ];
    out.push({ rotulo: `${q.data.slice(5)} ${q.periodoId}`, wipE16Montagem: par ? { origem: par.origem, confianca: par.confianca, lo: Math.round(par.wip.lo), hi: Math.round(par.wip.hi), negativo: par.negativo } : null, variantes });
  }
  return out;
}

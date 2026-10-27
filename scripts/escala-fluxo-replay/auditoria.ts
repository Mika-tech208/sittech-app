// Auditoria independente de `estadoDaProducao`: recalcula, a partir dos apontamentos brutos, boas por etapa, R_f e WIP estimado por par e compara com o núcleo.
import { estadoDaProducao } from "@/features/escala/fluxo";
import { apontamentos, fechamentos } from "./comum";
import { montarCenario } from "./montar";

import { PARES_LEGADO_PROD } from "./paresLegado";

export interface DivergenciaEstado { fechamento: string; item: string; esperado: number | string; nucleo: number | string }

export function auditarEstado() {
  const div: DivergenciaEstado[] = [];
  let conferidos = 0;
  for (const d of fechamentos) {
    const cen = montarCenario(d, apontamentos, { paresLegado: PARES_LEGADO_PROD });
    const st = estadoDaProducao(cen.entrada, cen.dados, cen.opcoes);
    const slots = cen.entrada.slots;
    const idx = (a: { data: string; periodoId: string }) => slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId);
    const rot = `${d.data.slice(5)} ${d.periodoId}`;
    const fechado = (i: number) => slots[i].fimMs + 10 * 60_000 <= d.corteMs;
    // boas confirmadas por pool nos períodos FECHADOS (lançadas até o corte)
    const B: Record<string, number> = {};
    apontamentos.filter((a) => a.lancadoEmMs <= d.corteMs && a.status === "produzindo" && a.produtoId && a.etapaId && idx(a) >= 0 && fechado(idx(a))).forEach((a) => {
      const k = `${a.produtoId}|${a.etapaId}`; B[k] = (B[k] ?? 0) + Math.max(0, a.boas);
    });
    st.etapas.forEach((e) => {
      const k = `${e.produtoId}|${e.etapaId}`;
      if (PARES_LEGADO_PROD.some((q) => q.produtoConvencionalId === e.produtoId || q.produtoAutomaticaId === e.produtoId)) return;
      conferidos++;
      if (Math.abs((B[k] ?? 0) - e.boas.lo) > 0.5) div.push({ fechamento: rot, item: `boas.lo ${k.slice(0, 8)}|${k.split("|")[1].slice(0, 4)}`, esperado: Math.round(B[k] ?? 0), nucleo: Math.round(e.boas.lo) });
      if (e.boas.hi + 0.5 < e.boas.lo) div.push({ fechamento: rot, item: `boas.hi<lo ${k}`, esperado: "hi ≥ lo", nucleo: `${e.boas.hi}<${e.boas.lo}` });
    });
    // projeção no corte = fechado confirmado + produção PLANEJADA (× f) das linhas congeladas posteriores ao último fechado e anteriores a aPartirDe
    const f = cen.opcoes.fatorPorPool ?? {};
    const proj: Record<string, number> = { ...B };
    cen.entrada.congeladas.forEach((a) => {
      const i = idx(a);
      if (i > st.ultimoFechado && i < cen.aPartirDe && a.maquinaId && a.produtoId && a.etapaId) { const k = `${a.produtoId}|${a.etapaId}`; proj[k] = (proj[k] ?? 0) + a.pecas * (f[k] ?? 1); }
    });
    Object.entries(st.projecao.boas).forEach(([k, v]) => {
      if (PARES_LEGADO_PROD.some((q) => k.startsWith(q.produtoConvencionalId) || k.startsWith(q.produtoAutomaticaId))) return;
      conferidos++;
      if (Math.abs((proj[k] ?? 0) - v.lo) > 1) div.push({ fechamento: rot, item: `projecao.boas.lo ${k.slice(0, 8)}|${k.split("|")[1].slice(0, 4)}`, esperado: Math.round(proj[k] ?? 0), nucleo: Math.round(v.lo) });
    });
    st.produtos.forEach((p) => {
      if (PARES_LEGADO_PROD.some((q) => q.produtoConvencionalId === p.produtoId || q.produtoAutomaticaId === p.produtoId)) return;
      const pools = cen.entrada.pools.filter((x) => x.produtoId === p.produtoId).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
      const fin = pools[pools.length - 1];
      const bf = B[`${fin.produtoId}|${fin.etapaId}`] ?? 0;
      conferidos++;
      if (Math.abs(p.boasFinais.lo - bf) > 0.5) div.push({ fechamento: rot, item: `boasFinais.lo ${p.produtoId.slice(0, 8)}`, esperado: Math.round(bf), nucleo: Math.round(p.boasFinais.lo) });
      const rfConfirmado = Math.max(0, fin.quantidade - bf);
      if (Math.abs(rfConfirmado - p.demandaFinalRestante) > 0.5) div.push({ fechamento: rot, item: `R_f=Q−B_lo ${p.produtoId.slice(0, 8)}`, esperado: Math.round(rfConfirmado), nucleo: Math.round(p.demandaFinalRestante) });
    });
    // WIP estimado por par = diferença das boas FECHADAS: bruto.lo = B_k.lo − B_{k+1}.hi ; bruto.hi = B_k.hi − B_{k+1}.lo (pares do Conector fundido são conferidos à parte, pela soma)
    const legado = new Set([PARES_LEGADO_PROD[0].produtoConvencionalId, PARES_LEGADO_PROD[0].produtoAutomaticaId]);
    st.pares.forEach((p) => {
      if (legado.has(p.produtoId)) return;
      const e0 = st.etapas.find((e) => `${e.produtoId}|${e.etapaId}` === `${p.produtoId}|${p.etapaOrigemId}`), e1 = st.etapas.find((e) => `${e.produtoId}|${e.etapaId}` === `${p.produtoId}|${p.etapaSeguinteId}`);
      if (!e0 || !e1) return;
      conferidos++;
      const brutoLo = e0.boas.lo - e1.boas.hi, brutoHi = e0.boas.hi - e1.boas.lo;
      const k0 = `${p.produtoId}|${p.etapaOrigemId}`;
      if (p.origem === "estimado" && (Math.abs(p.bruto.lo - brutoLo) > 1 || Math.abs(p.bruto.hi - brutoHi) > 1)) div.push({ fechamento: rot, item: `WIP bruto ${k0.slice(0, 8)}|${p.etapaOrigemId.slice(0, 4)}`, esperado: `${Math.round(brutoLo)}..${Math.round(brutoHi)}`, nucleo: `${Math.round(p.bruto.lo)}..${Math.round(p.bruto.hi)}` });
      if (p.wip.lo < 0 || p.wip.hi < 0) div.push({ fechamento: rot, item: `WIP negativo ${k0}`, esperado: ">=0", nucleo: `${p.wip.lo}..${p.wip.hi}` });
      if (p.negativo !== (p.bruto.hi < 0)) div.push({ fechamento: rot, item: `flag negativo ${k0}`, esperado: String(p.bruto.hi < 0), nucleo: String(p.negativo) });
      if (Math.abs(p.wip.lo - Math.max(0, p.bruto.lo)) > 1e-6 || Math.abs(p.wip.hi - Math.max(0, p.bruto.hi)) > 1e-6) div.push({ fechamento: rot, item: `piso 0 ${k0}`, esperado: "max(0,bruto)", nucleo: `${p.wip.lo}..${p.wip.hi} vs ${p.bruto.lo}..${p.bruto.hi}` });
    });
    // Conector fundido: Σ boas do Embalar (conv+auto) deve ser preservada pela redistribuição proporcional
    const somaMinhas = (B[`${PARES_LEGADO_PROD[0].produtoConvencionalId}|${PARES_LEGADO_PROD[0].etapasComuns[1].etapaConvencionalId}`] ?? 0) + (B[`${PARES_LEGADO_PROD[0].produtoAutomaticaId}|${PARES_LEGADO_PROD[0].etapasComuns[1].etapaAutomaticaId}`] ?? 0);
    const somaNucleo = st.produtos.filter((p) => legado.has(p.produtoId)).reduce((x, p) => x + p.boasFinais.lo, 0);
    conferidos++;
    if (Math.abs(somaMinhas - somaNucleo) > 1) div.push({ fechamento: rot, item: "Σ boas Embalar conv+auto (fundido)", esperado: Math.round(somaMinhas), nucleo: Math.round(somaNucleo) });
  }
  return { conferidos, divergencias: div };
}

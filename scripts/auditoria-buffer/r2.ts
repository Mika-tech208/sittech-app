/* eslint-disable @typescript-eslint/no-explicit-any */
import { carregarTudo, versoes, hhmm, nomeador, montarEstadoAting, slotsDa } from "./lib";
import { planejarComFluxo, avaliarPlano } from "@/features/escala/fluxo";
import type { AlocacaoEscala } from "@/features/escala/types";

const { d } = carregarTudo();
const nome = nomeador(d.nomes);
const slots = slotsDa(d);
const V = versoes();
const iT1 = 27;
const agoraMs = Date.parse("2026-10-30T15:36:30Z");
const e = montarEstadoAting(d, agoraMs, V["08:59"].linhas, 100 + iT1, { fluxoMesmoPeriodo: false }, true);
const r = planejarComFluxo(e.entrada, e.dados, e.opcoes);
const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
const resumo = (tit: string, l: AlocacaoEscala[]) => {
  console.log("==", tit);
  for (let t = iT1; t < 30; t++) {
    const m = new Map<string, number>();
    l.filter((a) => idx.get(`${a.data}|${a.periodoId}`) === t).forEach((a) => {
      const k = a.maquinaId ? `${nome(a.produtoId)}/${nome(a.etapaId)}@${nome(a.maquinaId)}` : "SEM POSTO";
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    console.log(" ", slots[t].periodoId, [...m.entries()].sort().map(([k, v]) => `${k}${v > 1 ? " x" + v : ""}`).join(" | "));
  }
};
resumo("PROD 12:36", V["12:36"].linhas);
resumo("PROD 13:06", V["13:06"].linhas);
resumo("REPRODUZIDO (agora=12:36:30, vigente=08:59, mesmoPeriodo=false)", r.resultado.alocacoes);
console.log("escolhido", r.diagnostico.planoEscolhido, "iter", r.diagnostico.iteracaoEscolhida);
r.diagnostico.iteracoes.forEach((it) => console.log("  it", it.indice, JSON.stringify(it.tupla), it.escolhida ? "<== escolhida" : ""));
// trajetoria WIP do plano reproduzido
const comp = (tit: string, l: AlocacaoEscala[]) => {
  const av = avaliarPlano(e.entrada, e.dados, [...e.entrada.congeladas, ...l.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= iT1)], { ...e.opcoes, incluirTrajetoria: true, limitesRemPorPool: r.diagnostico.estado.remPorPool } as any);
  console.log("== aval", tit, "faltaLo", Math.round(av.totais.faltaFinalLo), "finalLo", Math.round(av.totais.finalEntregueLo), "wipFinalLo", Math.round(av.totais.wipFinalLo));
  av.produtos.forEach((p: any) => { if (nome(p.produtoId).startsWith("Con3/4")) console.log(JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => ["wipFinal", "trajetoria", "gargaloFluxo"].includes(k))), null, 0).slice(0, 2500)); });
};
comp("PROD 12:36", V["12:36"].linhas);

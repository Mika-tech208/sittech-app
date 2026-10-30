/* eslint-disable @typescript-eslint/no-explicit-any */
// Métricas comuns dos replays da cadeia (OFFLINE). Mesmo simulador/mesma régua para todos os planos.
import { avaliarPlano, verificarRestricoesDuras } from "@/features/escala/fluxo";
import { simularCadeia } from "@/features/escala/fluxo/cadeia";
import { ociosasEvitaveis } from "@/features/escala/fluxo/cadeiaReparo";
import { prepararFluxo } from "@/features/escala/fluxo/estado";
import type { DadosProducaoReal, OpcoesFluxo } from "@/features/escala/fluxo";
import type { AlocacaoEscala, EntradaEscala } from "@/features/escala/types";

export const receitaDe = (ent: EntradaEscala, av: any) => {
  const val = new Map<string, number>();
  ent.pools.forEach((p) => val.set(p.produtoId, Math.max(val.get(p.produtoId) ?? 0, p.valorUnitario)));
  return Math.round(av.produtos.reduce((s: number, p: any) => s + p.finalEntregue.lo * (val.get(p.produtoId) ?? 0), 0));
};

export interface Metricas {
  pecasFinais: number; receita: number; wipFinal: number; rupturas: number; deficit: number; deficitProxDia: number; postosSemMaterial: number;
  pessoasSemPosto: number; ociosasEvitaveis: number; violacoes: Record<string, number>; passado: number; churnLinhas: number; pessoasAlteradas: number; reparos: number; realocacoes: number; wipEstimado: string;
}
/** `ref` = plano de referência para churn (futuro, mesmas chaves slot|pessoa). */
export function medir(ent: EntradaEscala, dados: DadosProducaoReal, opcoes: OpcoesFluxo, ap: number, planoFut: AlocacaoEscala[], ref: AlocacaoEscala[], diag: any[] | null): Metricas {
  const idx = new Map(ent.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const ix = (a: { data: string; periodoId: string }) => idx.get(`${a.data}|${a.periodoId}`) ?? -1;
  const todo = [...ent.congeladas, ...planoFut.filter((a) => ix(a) >= ap)];
  const av = avaliarPlano(ent, dados, todo, opcoes);
  const ctx = prepararFluxo(ent, dados, { ...opcoes, cadeia: { diagnostico: true } });
  const fut = planoFut.filter((a) => ix(a) >= ap);
  const sem = simularCadeia(ctx, fut, { semProximoDia: true });
  const comp = simularCadeia(ctx, fut);
  const viol = verificarRestricoesDuras(ent, todo, { somenteLinhasNovas: true });
  const violacoes: Record<string, number> = {};
  viol.forEach((v) => (violacoes[v.tipo] = (violacoes[v.tipo] ?? 0) + 1));
  const refM = new Map(ref.filter((a) => ix(a) >= ap).map((a) => [`${ix(a)}|${a.funcionarioId}`, a]));
  let linhas = 0;
  const pessoas = new Set<string>();
  fut.forEach((a) => { const v = refM.get(`${ix(a)}|${a.funcionarioId}`); if (!v || v.maquinaId !== a.maquinaId || v.etapaId !== a.etapaId) { linhas++; pessoas.add(a.funcionarioId); } });
  const mu = (n: string, s: number) => Math.max(...ctx.grafo.nos[n].membros.map((m) => (ctx.poolsPorChave.get(m)?.metas[ent.slots[s].periodoId] ?? 0)), 1);
  const postosSem = sem.violacoes.reduce((q, v) => q + Math.min(Math.ceil(v.deficit / mu(v.noId, v.slot)), 99), 0);
  return {
    pecasFinais: Math.round(av.totais.finalEntregueLo), receita: receitaDe(ent, av), wipFinal: Math.round(av.totais.wipFinalLo), rupturas: sem.violacoes.length, deficit: Math.round(sem.deficit), deficitProxDia: Math.round(comp.deficit - sem.deficit),
    postosSemMaterial: postosSem, pessoasSemPosto: fut.filter((a) => !a.maquinaId).length, ociosasEvitaveis: ociosasEvitaveis(ctx, fut), violacoes, passado: planoFut.filter((a) => ix(a) < ap).length + (violacoes["passado_alterado"] ?? 0),
    churnLinhas: linhas, pessoasAlteradas: pessoas.size, reparos: (diag ?? []).filter((d) => d.codigo === "CADEIA_REPARADA" && d.severidade === "info").length, realocacoes: (diag ?? []).filter((d) => d.codigo === "POSTO_SEM_MATERIAL_REALOCADO").length,
    wipEstimado: `${ctx.pares.filter((p) => p.origem !== "confirmado").length}/${ctx.pares.length}`,
  };
}

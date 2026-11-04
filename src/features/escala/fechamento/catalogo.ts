// Catálogo de buffers físicos → pares do motor (puro). O tablet pergunta por BUFFERS; o motor continua recebendo PARES.
// Conector 3/4 enquanto Convencional e Automático existirem separados: "Parafusadas aguardando Etiquetar" é UM estoque físico (Conv + saída da M8):
// o par Convencional recebe o total, o par Automático recebe 0 — nunca se duplica a pilha da M8.
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import type { BufferCatalogo, BufferInformado, EstimativaBuffer, ParEstimado } from "./tipos";

/** Buffers que precisam de contagem neste fechamento: algum produto do buffer está ativo na semana. Ordem do catálogo. */
export function buffersObrigatorios(catalogo: BufferCatalogo[], produtosAtivos: ReadonlySet<string>): BufferCatalogo[] {
  return catalogo.filter((b) => b.pares.some((p) => produtosAtivos.has(p.produtoId))).sort((a, b) => a.ordem - b.ordem || a.chave.localeCompare(b.chave));
}

/** Estimado de um buffer = soma dos estoques estimados de TODOS os pares dele (Conv + Auto = um estoque físico). */
export function estimarBuffers(buffers: BufferCatalogo[], pares: ParEstimado[]): EstimativaBuffer[] {
  return buffers.map((b) => {
    let lo = 0, hi = 0;
    b.pares.forEach((p) => {
      const x = pares.find((q) => q.produtoId === p.produtoId && q.etapaOrigemId === p.etapaOrigemId && q.etapaSeguinteId === p.etapaSeguinteId);
      if (x) { lo += x.wip.lo; hi += x.wip.hi; }
    });
    const r = (v: number) => Math.round(v);
    return { bufferId: b.id, estimado: r((lo + hi) / 2), lo: r(lo), hi: r(hi) };
  });
}

/** Contagens do motor a partir do inventário informado: contábil = total; zero = 0. `instanteMs` = fim do período fechado (estado congelado). */
export function contagensDoInventario(buffers: BufferCatalogo[], informados: BufferInformado[], instanteMs: number, informadoPor: string, observacao: string): ContagemFisicaPar[] {
  const out: ContagemFisicaPar[] = [];
  buffers.forEach((b) => {
    const inf = informados.find((i) => i.bufferId === b.id);
    if (!inf || inf.fisico === null || !Number.isFinite(inf.fisico)) return;
    b.pares.forEach((p) => out.push({ produtoId: p.produtoId, etapaOrigemId: p.etapaOrigemId, etapaSeguinteId: p.etapaSeguinteId, saldo: p.papel === "contabil" ? inf.fisico! : 0, contadoEmMs: instanteMs, informadoPor, observacao }));
  });
  return out;
}

/** A soma dos pares de cada buffer (contábil + zero) é exatamente o físico informado — invariante "não duplicar M8". */
export function somaPorBuffer(buffers: BufferCatalogo[], contagens: ContagemFisicaPar[]): Record<string, number> {
  return Object.fromEntries(buffers.map((b) => [b.id, b.pares.reduce((s, p) => s + (contagens.find((c) => c.produtoId === p.produtoId && c.etapaOrigemId === p.etapaOrigemId && c.etapaSeguinteId === p.etapaSeguinteId)?.saldo ?? 0), 0)]));
}

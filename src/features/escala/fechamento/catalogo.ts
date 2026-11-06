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

/**
 * PRODUTO ÚNICO: o catálogo do produto canônico tem EXATAMENTE os 3 buffers físicos, cada um com UM par contábil (Rosquear→Parafusar, Parafusar→Etiquetar [comum, recebe também a M8],
 * Etiquetar→Embalar), e NENHUM par `zero` nem par da M8 (não existe adapter Conv=total/Auto=0). Devolve os problemas ([] = ok). Puro.
 */
export function verificarCatalogoUnico(
  catalogo: BufferCatalogo[],
  modelo: { produtoCanonicoId: string; etapas: { etapaId: string; papel: string; rotaId: string | null }[]; arestas: { origemEtapaId: string; destinoEtapaId: string }[]; rotas: { id: string; tipo: string }[] },
): string[] {
  const CAN = modelo.produtoCanonicoId;
  const problemas: string[] = [];
  const doProduto = catalogo.flatMap((b) => b.pares.filter((p) => p.produtoId === CAN).map((p) => ({ b, p })));
  const auto = modelo.rotas.find((r) => r.tipo === "automatica");
  const m8 = auto ? modelo.etapas.find((e) => e.rotaId === auto.id)?.etapaId : undefined;
  if (doProduto.some(({ p }) => p.papel !== "contabil")) problemas.push("par `zero` no catálogo do produto único (adapter Conv/Auto proibido)");
  if (m8 && doProduto.some(({ p }) => p.etapaOrigemId === m8 || p.etapaSeguinteId === m8)) problemas.push("par da Máquina 8 no catálogo: a saída da M8 é o buffer comum (Parafusar→Etiquetar), sem par próprio");
  const buffers = new Set(doProduto.map(({ b }) => b.id));
  if (doProduto.length > 0 && (buffers.size !== 3 || doProduto.length !== 3)) problemas.push(`o produto único deve ter exatamente 3 buffers com 1 par cada (encontrado: ${buffers.size} buffer(s), ${doProduto.length} par(es))`);
  return problemas;
}

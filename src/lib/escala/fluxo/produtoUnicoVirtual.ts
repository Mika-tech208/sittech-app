// PRODUTO ÚNICO — ponte PURA entre o estado do recálculo/fechamento (ids CANÔNICOS) e a representação INTERNA do planejador de corte (duas cadeias de planejamento, adaptadorMotor.ts).
// Usada por quem precisa do estado do motor com produto único: o recálculo (integracaoCorte) e o fechamento físico (estimativas de buffers e portão HARD). Nada virtual é gravado.
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import type { EntradaEscala } from "@/features/escala/types";
import { dadosParaVirtual, desdobrarCanonico, paresParaCanonico, type Desdobramento, type ParCanonico } from "@/features/produto-canonico/adaptadorMotor";
import { canonizarAlocacoes, canonizarContagens, resolverEtapa, resolverProduto } from "@/features/produto-canonico/mapeamento";
import type { ModeloCanonico } from "@/features/produto-canonico/tipos";
import { prepararProdutoUnico, produtoUnicoDePar } from "@/features/escala/fluxo/produtoUnico";
import type { EstadoBruto } from "../estado";
import { dadosProducaoReal, insumosFluxo } from "./integracao";

export const canonizarApontamento = (a: ApontamentoReal, m: ModeloCanonico): ApontamentoReal => {
  const e = a.etapaId ? resolverEtapa(m, a.etapaId) : null;
  const produtoId = a.produtoId ? resolverProduto(m, a.produtoId).produtoId : a.produtoId;
  return e && e.entrada !== "fora" ? { ...a, produtoId: e.produtoId ?? produtoId, etapaId: e.etapaId } : produtoId !== a.produtoId ? { ...a, produtoId } : a;
};

export interface ContextoVirtual { d: Desdobramento; estadoV: EstadoBruto; entradaV: EntradaEscala }

/** Estado + entrada do recálculo (canônicos) -> estado + entrada na representação interna do planejador. `{erro}` quando o modelo/entrada não permite (o chamador mantém o plano vigente). */
export function virtualizar(estado: EstadoBruto, entrada: EntradaEscala, agoraMs: number, modelo: ModeloCanonico): ContextoVirtual | { erro: string } {
  const entradaC = { ...entrada, congeladas: canonizarAlocacoes(entrada.congeladas, modelo), ...(entrada.trocasManuais ? { trocasManuais: canonizarAlocacoes(entrada.trocasManuais, modelo) } : {}) };
  const d = desdobrarCanonico(entradaC, modelo);
  if ("erro" in d) return d;
  const pr = estado.producaoReal;
  const dadosC = {
    apontamentos: (pr?.apontamentos ?? []).map((a) => canonizarApontamento(a, modelo)), agoraMs, fechamentoMinutos: 10,
    planoVigente: canonizarAlocacoes(estado.alocacoes, modelo), contagensFisicas: canonizarContagens(pr?.contagensFisicas ?? [], modelo).contagens,
  };
  const dv = dadosParaVirtual(dadosC, d);
  const estadoV: EstadoBruto = {
    ...estado, alocacoes: dv.planoVigente,
    ...(pr ? { producaoReal: { ...pr, paresLegado: [d.par], apontamentos: dv.apontamentos, contagensFisicas: dv.contagensFisicas && dv.contagensFisicas.length > 0 ? dv.contagensFisicas : undefined } } : {}),
  };
  return { d, estadoV, entradaV: d.entrada };
}

/** Pares de estoque (3 buffers, ids canônicos) do estado ATUAL — o que o fechamento mostra como estimativa. Sem rodar a busca do planejador. */
export function paresCanonicosDoEstado(estado: EstadoBruto, entrada: EntradaEscala, agoraMs: number, modelo: ModeloCanonico): ParCanonico[] {
  const v = virtualizar(estado, entrada, agoraMs, modelo);
  if ("erro" in v) throw new Error(`produto único: ${v.erro}`);
  const { entrada: ev, opcoes } = insumosFluxo(v.estadoV, v.entradaV, agoraMs);
  const prep = prepararProdutoUnico(ev, dadosProducaoReal(v.estadoV, agoraMs), opcoes, produtoUnicoDePar(v.d.par));
  if ("motivo" in prep) throw new Error(`produto único: ${prep.motivo}`);
  return paresParaCanonico(prep.estado.pares, v.d);
}

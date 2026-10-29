// PRODUTIVIDADE ESPERADA (nível 2: receita/hora = preço × produtividade REAL). Provedor injetável; o default é "meta nominal × f do pool" (o que o núcleo já faz).
// Com provedor: a meta efetiva de cada pool/período vira a MÉDIA das máquinas SELECIONADAS na Previsão de pecasPorPeriodo × fator (nunca máquinas fora da Previsão).
import { chavePool, type EntradaEscala } from "../types";
import type { OpcoesFluxo, ProdutividadeEsperada } from "./tipos";

export interface ProdutividadePool { chave: string; nominal: Record<string, number>; esperada: Record<string, number>; fonte: string; amostra: number }

export function aplicarProdutividade(entrada: EntradaEscala, opcoes: OpcoesFluxo, agoraMs: number): { entrada: EntradaEscala; pools: ProdutividadePool[] } {
  const prov = opcoes.produtividade;
  if (!prov && opcoes.produtividadeBase === "nominal" && opcoes.fatoresEmbutidos) {
    // base NOMINAL: remove o f embutido nas metas (a decisão usa a produtividade nominal)
    const f = opcoes.fatoresEmbutidos;
    return { entrada: { ...entrada, pools: entrada.pools.map((p) => { const k = chavePool(p.produtoId, p.etapaId); const fk = f[k] ?? 1; return fk > 0 && fk !== 1 ? { ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([per, v]) => [per, v / fk])) } : p; }) }, pools: [] };
  }
  if (!prov) return { entrada, pools: [] };
  const info: ProdutividadePool[] = [];
  const pools = entrada.pools.map((p) => {
    const metas: Record<string, number> = {};
    const fontes = new Set<string>();
    let amostra = Number.POSITIVE_INFINITY;
    Object.keys(p.metas).forEach((per) => {
      const rs: ProdutividadeEsperada[] = [];
      p.maquinasIds.forEach((m) => {
        const r = prov!({ produtoId: p.produtoId, etapaId: p.etapaId, maquinaId: m, periodoId: per, agoraMs, metaNominal: p.metas[per] });
        if (r && Number.isFinite(r.pecasPorPeriodo) && Number.isFinite(r.fator) && r.pecasPorPeriodo >= 0 && r.fator >= 0) { rs.push(r); fontes.add(r.fonte); amostra = Math.min(amostra, r.amostra); }
      });
      metas[per] = rs.length === p.maquinasIds.length && rs.length > 0 ? rs.reduce((s, r) => s + r.pecasPorPeriodo * r.fator, 0) / rs.length : p.metas[per];
    });
    info.push({ chave: chavePool(p.produtoId, p.etapaId), nominal: p.metas, esperada: metas, fonte: [...fontes].sort().join("+") || "nominal", amostra: Number.isFinite(amostra) ? amostra : 0 });
    return { ...p, metas };
  });
  return { entrada: { ...entrada, pools }, pools: info };
}

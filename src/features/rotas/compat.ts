// COMPATIBILIDADE (prepara o M4; NENHUMA RPC oficial é alterada agora): como "apontado real" e indicadores localizam a etapa final.
//   produto LINEAR  → etapa de maior ordem (regra atual, preservada byte a byte);
//   produto de ROTAS → etapa final EXPLÍCITA do pool comum (Embalar), nunca max(ordem): uma "Etapa Técnica" ordem 99 não vira final.
import { estruturaLinear } from "./estrutura";
import type { EstruturaProduto, EtapaCadastro } from "./tipos";

export function etapaFinalDoProduto(estrutura: EstruturaProduto | null, etapas: Pick<EtapaCadastro, "id" | "ordem">[]): string | null {
  if (estrutura && estrutura.modelo === "rotas") return estrutura.etapaFinalId;
  return estruturaLinear(estrutura?.produtoId ?? "", etapas).etapaFinalId;
}

export interface Apontamento { etapaId: string; quantidade: number }
// apontado real do produto = Σ apontamentos da etapa final (uma só); apontar Rosquear/Parafusar/Etiquetar NÃO conta como produto acabado
export function apontadoRealProduto(estrutura: EstruturaProduto | null, etapas: Pick<EtapaCadastro, "id" | "ordem">[], apontamentos: Apontamento[]): number {
  const fim = etapaFinalDoProduto(estrutura, etapas);
  return fim === null ? 0 : apontamentos.filter((a) => a.etapaId === fim).reduce((s, a) => s + a.quantidade, 0);
}

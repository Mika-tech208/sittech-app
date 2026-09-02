import type { Produto, RoteiroEtapa } from "@/types/domain";

export interface MaquinaForm {
  nome: string;
  operacao: string;
}

export const EMPTY_MAQUINA_FORM: MaquinaForm = { nome: "", operacao: "" };

// Produto que usa essa máquina em pelo menos uma etapa do roteiro, com as
// etapas exatas — descoberto por produto.roteiro[].maquinasIds (por ID),
// nunca por nome ou por operação (ver `encontrarProdutosQueUsamMaquina`).
export interface ProdutoQueUsaMaquina {
  produto: Produto;
  etapas: RoteiroEtapa[];
}

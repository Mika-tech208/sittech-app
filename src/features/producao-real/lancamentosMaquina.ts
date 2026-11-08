// VÁRIOS LANÇAMENTOS POR MÁQUINA/PERÍODO (06/11/2026): a máquina pode ter DOIS PRODUTOS no mesmo período ou TROCAR DE OPERADOR dentro dele; cada linha é um lançamento
// (única por máquina+produto+operador). "Sem produção" continua único e não coexiste com produção. Este módulo resume as linhas de UMA máquina/período para o cartão do painel.
export type EstadoPeriodoMaquinaResumo = "pendente" | "apontado" | "sem_producao";

export interface LinhaLancamento {
  status: string;
  quantidade_produzida: number | string | null;
  motivo_sem_producao: string | null;
  produtos: { nome: string } | null;
}

export interface ResumoLancamentos {
  estadoPeriodo: EstadoPeriodoMaquinaResumo;
  produtoNome: string | null;
  quantidadeProduzida: number | null;
  motivoSemProducao: string | null;
  lancamentos: number;
}

/** Junta nomes de produto sem repetir ("A" + "B"; "A" + "A" = "A"). */
export function juntarProdutoNome(atual: string | null | undefined, novo: string | null | undefined): string | null {
  const nomes = [...(atual ? atual.split(" + ") : []), ...(novo ? [novo] : [])].filter(Boolean);
  const unicos = [...new Set(nomes)];
  return unicos.length ? unicos.join(" + ") : null;
}

export function resumirLancamentos(linhas: LinhaLancamento[]): ResumoLancamentos {
  if (linhas.length === 0) return { estadoPeriodo: "pendente", produtoNome: null, quantidadeProduzida: null, motivoSemProducao: null, lancamentos: 0 };
  const producao = linhas.filter((l) => l.status !== "sem_producao");
  if (producao.length === 0) {
    return { estadoPeriodo: "sem_producao", produtoNome: null, quantidadeProduzida: null, motivoSemProducao: linhas[0].motivo_sem_producao || null, lancamentos: linhas.length };
  }
  return {
    estadoPeriodo: "apontado",
    produtoNome: producao.reduce<string | null>((acc, l) => juntarProdutoNome(acc, l.produtos?.nome), null),
    quantidadeProduzida: producao.reduce((s, l) => s + Number(l.quantidade_produzida ?? 0), 0),
    motivoSemProducao: null,
    lancamentos: producao.length,
  };
}

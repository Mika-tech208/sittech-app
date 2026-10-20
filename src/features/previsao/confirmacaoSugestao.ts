// Resumo da confirmação de "Aplicar sugestão" de carga adicional — função PURA (a modal só mostra).
// Confirmar apenas PREENCHE a coluna Adicional para revisão; nada é salvo.

import type { CoberturaSemana } from "@/features/escala/cobertura";

export interface ResumoConfirmacaoSugestao {
  totalPecas: number;
  produtos: { produtoId: string; nome: string; pecas: number }[]; // só os produtos afetados (pecas > 0)
  coberturaAtual: number;
  coberturaEstimada: number;
  pessoasPeriodoRestantes: number;
  horasPessoaRestantes: number;
  titulo: string;
  linhas: string[];
}

const fmtNum = (v: number, casas = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export function resumirConfirmacaoSugestao(
  sugestao: { porProduto: { produtoId: string; adicionalSugerido: number }[]; totalPecas: number; coberturaApos: CoberturaSemana },
  coberturaAtual: CoberturaSemana,
  nomeProduto: (produtoId: string) => string
): ResumoConfirmacaoSugestao {
  const produtos = sugestao.porProduto
    .filter((p) => p.adicionalSugerido > 0)
    .map((p) => ({ produtoId: p.produtoId, nome: nomeProduto(p.produtoId), pecas: p.adicionalSugerido }));
  const restantes = sugestao.coberturaApos.pessoasPeriodoSemPosto;
  const horas = sugestao.coberturaApos.horasSemPosto;
  return {
    totalPecas: sugestao.totalPecas,
    produtos,
    coberturaAtual: coberturaAtual.percentual,
    coberturaEstimada: sugestao.coberturaApos.percentual,
    pessoasPeriodoRestantes: restantes,
    horasPessoaRestantes: horas,
    titulo: "Aplicar carga adicional sugerida?",
    linhas: [
      `+${fmtNum(sugestao.totalPecas)} peças em ${produtos.length} ${produtos.length === 1 ? "produto" : "produtos"}`,
      `Cobertura: ${fmtNum(coberturaAtual.percentual, 1)}% → ${fmtNum(sugestao.coberturaApos.percentual, 1)}%`,
      restantes > 0
        ? `Ainda restarão ${fmtNum(restantes)} pessoas-período sem posto (${fmtNum(horas, 1)} horas-pessoa).`
        : "Nenhuma pessoa ficará sem posto.",
    ],
  };
}

// Funcionários V1 — cobertura operacional (§14, aprovado). SÓ fatos
// (contagens) — nunca nota/competência/ranking. "Trabalhou em mais
// máquinas" não significa "é melhor funcionário": aqui não existe
// nenhuma classificação, só contagem.

import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import type { CoberturaOperacional, ContextoFuncionario } from "@/features/producao-real/funcionarios/types";

export function calcularCoberturaOperacional(apontamentosFuncionario: ApontamentoIndicador[]): CoberturaOperacional {
  const produzindo = apontamentosFuncionario.filter((ap) => ap.status === "produzindo" && ap.produtoId && ap.operacaoId);

  const produtos = new Set<string>();
  const operacoes = new Set<string>();
  const maquinas = new Set<string>();
  const porContextoMap = new Map<string, { contexto: ContextoFuncionario; periodos: number }>();

  produzindo.forEach((ap) => {
    produtos.add(ap.produtoId as string);
    operacoes.add(ap.operacaoId as string);
    maquinas.add(ap.maquinaId);
    const chave = `${ap.produtoId}::${ap.operacaoId}::${ap.maquinaId}`;
    const atual = porContextoMap.get(chave);
    if (atual) atual.periodos += 1;
    else
      porContextoMap.set(chave, {
        contexto: {
          produtoId: ap.produtoId as string, produtoNome: ap.produtoNome as string,
          operacaoId: ap.operacaoId as string, operacaoNome: ap.operacaoNome as string,
          maquinaId: ap.maquinaId, maquinaNome: ap.maquinaNome,
        },
        periodos: 1,
      });
  });

  return {
    quantidadeProdutos: produtos.size,
    quantidadeOperacoes: operacoes.size,
    quantidadeMaquinas: maquinas.size,
    quantidadeContextosDistintos: porContextoMap.size,
    porContexto: Array.from(porContextoMap.values()).sort((a, b) => b.periodos - a.periodos),
  };
}

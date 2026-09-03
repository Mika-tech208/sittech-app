// Funcionários V1 — agrupamento por contexto (§3, aprovado: produto +
// operação + máquina, nunca agregado). Reaproveita literalmente
// `agruparPorContextoMaquina` de Desvios V1 (mesma regra de contexto) —
// aqui só acrescenta a divisão por funcionário DENTRO de cada grupo.

import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import { agruparPorContextoMaquina } from "@/features/producao-real/desvios/contexto";
import type { ContextoFuncionario } from "@/features/producao-real/funcionarios/types";

export interface GrupoContextoFuncionario {
  contexto: ContextoFuncionario;
  chave: string;
  funcionarioId: string;
  funcionarioNome: string;
  apontamentosFuncionario: ApontamentoIndicador[];
  apontamentosPares: ApontamentoIndicador[]; // mesmo contexto, TODOS os outros funcionários — nunca inclui o próprio (§4)
}

export function rotuloContextoFuncionario(c: ContextoFuncionario): string {
  return `${c.produtoNome} — ${c.operacaoNome} — ${c.maquinaNome}`;
}

// Um item por (contexto, funcionário) presente na janela — a baseline de
// pares já vem calculada como "todos os outros apontamentos do mesmo
// contexto", filtrando o próprio funcionário fora, sempre.
export function agruparPorContextoEFuncionario(apontamentos: ApontamentoIndicador[]): GrupoContextoFuncionario[] {
  const gruposContexto = agruparPorContextoMaquina(apontamentos);
  const resultado: GrupoContextoFuncionario[] = [];

  gruposContexto.forEach((grupo) => {
    // agruparPorContextoMaquina sempre grava maquinaId/maquinaNome (nunca
    // null — isso só acontece na variante "por etapa", não usada aqui).
    const contexto: ContextoFuncionario = {
      produtoId: grupo.contexto.produtoId as string,
      produtoNome: grupo.contexto.produtoNome as string,
      operacaoId: grupo.contexto.operacaoId as string,
      operacaoNome: grupo.contexto.operacaoNome as string,
      maquinaId: grupo.contexto.maquinaId as string,
      maquinaNome: grupo.contexto.maquinaNome as string,
    };
    const porFuncionario = new Map<string, { nome: string; apontamentos: ApontamentoIndicador[] }>();
    grupo.apontamentos.forEach((ap) => {
      if (ap.funcionarioId === null) return;
      const atual = porFuncionario.get(ap.funcionarioId);
      if (atual) atual.apontamentos.push(ap);
      else porFuncionario.set(ap.funcionarioId, { nome: ap.funcionarioNome || "", apontamentos: [ap] });
    });

    porFuncionario.forEach((v, funcionarioId) => {
      resultado.push({
        contexto,
        chave: `${grupo.chave}::${funcionarioId}`,
        funcionarioId,
        funcionarioNome: v.nome,
        apontamentosFuncionario: v.apontamentos,
        // pares = todos os apontamentos do MESMO contexto, EXCLUINDO o próprio funcionário — sempre, sem exceção (§4).
        apontamentosPares: grupo.apontamentos.filter((ap) => ap.funcionarioId !== funcionarioId),
      });
    });
  });

  return resultado;
}

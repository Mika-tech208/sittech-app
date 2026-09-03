"use client";

// Lista de funcionários (§17-D) — nome + cobertura operacional + contextos
// analisáveis. SEM ranking, sem nota, sem 1º/2º/3º (§18) — ordenado só
// alfabeticamente.

import type { ResultadoAnaliseFuncionarios } from "@/features/producao-real/funcionarios/types";

export default function ListaFuncionarios({
  resultado, onSelecionar,
}: {
  resultado: ResultadoAnaliseFuncionarios;
  onSelecionar: (funcionarioId: string) => void;
}) {
  const funcionarios = Array.from(resultado.coberturaPorFuncionario.entries())
    .map(([funcionarioId, v]) => ({ funcionarioId, ...v }))
    .sort((a, b) => a.funcionarioNome.localeCompare(b.funcionarioNome, "pt-BR"));

  if (funcionarios.length === 0) {
    return <div className="stx-empty">Nenhum funcionário com apontamentos no período atual.</div>;
  }

  return (
    <div className="stx-ind-tabela-wrap">
      <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
        <span>Funcionário</span>
        <span>Produtos</span>
        <span>Operações</span>
        <span>Máquinas</span>
        <span>Contextos distintos</span>
      </div>
      {funcionarios.map((f) => (
        <div
          key={f.funcionarioId}
          className="stx-ind-tabela-linha"
          style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", cursor: "pointer" }}
          onClick={() => onSelecionar(f.funcionarioId)}
        >
          <span style={{ fontFamily: "inherit" }}>{f.funcionarioNome}</span>
          <span>{f.cobertura.quantidadeProdutos}</span>
          <span>{f.cobertura.quantidadeOperacoes}</span>
          <span>{f.cobertura.quantidadeMaquinas}</span>
          <span>{f.cobertura.quantidadeContextosDistintos}</span>
        </div>
      ))}
    </div>
  );
}

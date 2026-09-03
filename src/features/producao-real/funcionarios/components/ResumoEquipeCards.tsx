"use client";

// Resumo da equipe (§17-A) — só contagens do que já saiu do motor de
// análise. Nenhuma fórmula aqui.

import type { ResultadoAnaliseFuncionarios } from "@/features/producao-real/funcionarios/types";

export default function ResumoEquipeCards({ resultado }: { resultado: ResultadoAnaliseFuncionarios }) {
  const funcionariosComDadosSuficientes = new Set(
    resultado.analises.filter((a) => a.amostraFuncionario.suficiente).map((a) => a.funcionarioId)
  ).size;
  const contextosAnalisados = new Set(resultado.analises.map((a) => `${a.contexto.produtoId}::${a.contexto.operacaoId}::${a.contexto.maquinaId}`)).size;

  return (
    <div className="stx-panel">
      <p className="stx-panel-title">Resumo da equipe</p>
      <p className="stx-panel-sub">
        Sempre por contexto (produto + operação + máquina) — nunca uma nota geral da pessoa. Semana atual até agora, comparada ao mesmo trecho da semana anterior.
      </p>
      <div className="stx-capacidade-reais-grid" style={{ marginTop: 12 }}>
        <div>
          <p className="stx-capacidade-reais-label">Funcionários com dados suficientes</p>
          <p className="stx-capacidade-reais-valor">{funcionariosComDadosSuficientes}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">Contextos analisados</p>
          <p className="stx-capacidade-reais-valor">{contextosAnalisados}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">
            <span className="stx-performance-badge critico" style={{ marginRight: 6 }}>Atenção</span>
          </p>
          <p className="stx-capacidade-reais-valor">{resultado.atencao.length}</p>
        </div>
        <div>
          <p className="stx-capacidade-reais-label">
            <span className="stx-performance-badge atingido" style={{ marginRight: 6 }}>Destaque</span>
          </p>
          <p className="stx-capacidade-reais-valor">{resultado.destaques.length}</p>
        </div>
      </div>
    </div>
  );
}

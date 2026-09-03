"use client";

// "Sem produção" — SEMPRE separado do Pareto/análise de paradas. Só
// contagens (fato), nunca minutos/custo/capacidade inventados aqui.

import { calcularSemProducaoResumo } from "@/features/producao-real/paradas/calculations";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";

function Bloco({ titulo, itens }: { titulo: string; itens: { chave: string; rotulo: string; quantidade: number }[] }) {
  return (
    <div style={{ marginTop: 14 }}>
      <p className="stx-analise-secao-titulo" style={{ margin: "0 0 6px 0" }}>{titulo}</p>
      {itens.length === 0 ? (
        <p className="stx-panel-sub">Nenhum registro.</p>
      ) : (
        itens.map((it) => (
          <div key={it.chave} className="stx-tabela-producao-linha" style={{ gridTemplateColumns: "2fr 1fr" }}>
            <span>{it.rotulo}</span>
            <span>{it.quantidade}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default function SemProducaoResumoView({ apontamentos }: { apontamentos: ApontamentoIndicador[] }) {
  const resumo = calcularSemProducaoResumo(apontamentos);

  return (
    <div className="stx-panel">
      <p className="stx-panel-title">Sem produção — registros explícitos</p>
      <p className="stx-panel-sub">
        Nunca misturado com parada — motivos e significado operacional diferentes. Só contagem de registros (fato); não existe base confiável pra minutos, custo ou capacidade perdida nesses períodos (meta e custo/hora ficam vazios por design quando o status é &quot;sem produção&quot;).
      </p>
      <p className="stx-produto-programado-valor" style={{ fontSize: 22, marginTop: 8 }}>{resumo.totalRegistros} registros</p>
      <Bloco titulo="Por motivo" itens={resumo.porMotivo} />
      <Bloco titulo="Por máquina" itens={resumo.porMaquina} />
      <Bloco titulo="Por período" itens={resumo.porPeriodo} />
    </div>
  );
}

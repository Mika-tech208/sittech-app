"use client";

// Máquina/Operação/Produto num único componente com seletor — mesmo
// padrão de ParetoParadasSeletor, reaproveitando os agrupamentos de
// calculations.ts (fórmula sempre vem de calcularResumoParadas).

import { useState } from "react";
import {
  agruparParadasPorMaquina, agruparParadasPorOperacao, agruparParadasPorProduto,
  type GrupoParadas, type ParadaComContexto,
} from "@/features/producao-real/paradas/calculations";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import { formatarBRLIndicador, formatarMinutos, formatarPecas, formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

type Dimensao = "maquina" | "operacao" | "produto";

const DIMENSOES: { key: Dimensao; label: string }[] = [
  { key: "maquina", label: "Máquina" },
  { key: "operacao", label: "Operação" },
  { key: "produto", label: "Produto" },
];

const TEMPLATE_COLUNAS = "1.6fr 1fr 1fr 1fr 1fr 1fr";

function Linha({ grupo }: { grupo: GrupoParadas }) {
  return (
    <div className="stx-ind-tabela-linha" style={{ gridTemplateColumns: TEMPLATE_COLUNAS, cursor: "default" }}>
      <span style={{ fontFamily: "inherit" }}>{grupo.rotulo || "(sem valor)"}</span>
      <span>{formatarMinutos(grupo.resumo.minutosParadosTotal)}</span>
      <span>{grupo.resumo.quantidadeParadas}</span>
      <span>{formatarBRLIndicador(grupo.resumo.custoTempoOciosoTotal)}</span>
      <span>{formatarPecas(grupo.resumo.capacidadePerdidaTotal)}</span>
      <span>{formatarPercentualIndicador(grupo.resumo.pctTempoApontadoPerdido)}</span>
    </div>
  );
}

export default function AnaliseParadasPorRecurso({ paradas, apontamentos }: { paradas: ParadaComContexto[]; apontamentos: ApontamentoIndicador[] }) {
  const [dimensao, setDimensao] = useState<Dimensao>("maquina");

  const grupos =
    dimensao === "maquina" ? agruparParadasPorMaquina(paradas, apontamentos)
    : dimensao === "operacao" ? agruparParadasPorOperacao(paradas, apontamentos)
    : agruparParadasPorProduto(paradas, apontamentos);

  return (
    <div>
      <div className="stx-ind-tabs" style={{ margin: "0 0 14px 0" }}>
        {DIMENSOES.map((d) => (
          <button key={d.key} type="button" className={`stx-ind-tab ${dimensao === d.key ? "active" : ""}`} onClick={() => setDimensao(d.key)}>
            {d.label}
          </button>
        ))}
      </div>
      {grupos.length === 0 ? (
        <div className="stx-empty">Nenhuma parada no período/filtro.</div>
      ) : (
        <div className="stx-ind-tabela-wrap">
          <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: TEMPLATE_COLUNAS }}>
            <span>{DIMENSOES.find((d) => d.key === dimensao)?.label}</span>
            <span>Minutos</span>
            <span>Qtd.</span>
            <span>Custo ocioso</span>
            <span>Cap. perdida</span>
            <span>% tempo perdido</span>
          </div>
          {grupos.map((g) => (
            <Linha key={g.chave} grupo={g} />
          ))}
        </div>
      )}
    </div>
  );
}

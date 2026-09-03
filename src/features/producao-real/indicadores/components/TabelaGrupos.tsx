"use client";

// Tabela genérica reutilizada pelas visões "Máquinas", "Produtos",
// "Operações" e "Funcionários" — o mesmo componente, só muda o rótulo da
// coluna e a função de agrupamento (todas vêm de calculations.ts). Clicar
// numa linha abre um drill-down (reagrupando os apontamentos/paradas
// BRUTOS já carregados por outra dimensão, sem nova chamada ao banco) —
// não é BI, é só uma segunda camada de contexto (ex.: Máquina -> Produto).
//
// Funcionários: este componente nunca ordena por Performance nem destaca
// "melhor/pior" — a ordenação é sempre alfabética pelo rótulo (ver
// agruparIndicadores) e todas as colunas aparecem lado a lado, sem
// ranking visual.

import { useState } from "react";
import type { GrupoIndicadores } from "@/features/producao-real/indicadores/calculations";
import { formatarMinutos, formatarPecas, formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

const TEMPLATE_COLUNAS = "1.6fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr";

function LinhaCabecalho({ colunaRotulo }: { colunaRotulo: string }) {
  return (
    <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: TEMPLATE_COLUNAS }}>
      <span>{colunaRotulo}</span>
      <span>Prod. acabada</span>
      <span>Performance</span>
      <span>Disponib.</span>
      <span>Qualidade</span>
      <span>OEE</span>
      <span>Paradas</span>
      <span>Cap. perdida</span>
    </div>
  );
}

function LinhaValores({ grupo }: { grupo: GrupoIndicadores }) {
  const r = grupo.resumo;
  return (
    <>
      <span>{formatarPecas(r.producaoAcabadaTotal)}</span>
      <span>{formatarPercentualIndicador(r.performancePct)}</span>
      <span>{formatarPercentualIndicador(r.disponibilidadePct)}</span>
      <span>{formatarPercentualIndicador(r.qualidadePct)}</span>
      <span>{formatarPercentualIndicador(r.oeePct)}</span>
      <span>{formatarMinutos(r.minutosParadosTotais)}</span>
      <span>{formatarPecas(r.capacidadePerdidaPecas)}</span>
    </>
  );
}

interface TabelaGruposProps {
  grupos: GrupoIndicadores[];
  colunaRotulo: string;
  vazio: string;
  subAgrupar?: (grupo: GrupoIndicadores) => GrupoIndicadores[];
  colunaSub?: string;
}

export default function TabelaGrupos({ grupos, colunaRotulo, vazio, subAgrupar, colunaSub }: TabelaGruposProps) {
  const [expandido, setExpandido] = useState<string | null>(null);

  if (grupos.length === 0) return <div className="stx-empty">{vazio}</div>;

  return (
    <div className="stx-ind-tabela-wrap">
      <LinhaCabecalho colunaRotulo={colunaRotulo} />
      {grupos.map((g) => {
        const aberto = expandido === g.chave;
        return (
          <div key={g.chave}>
            <div
              className="stx-ind-tabela-linha"
              style={{ gridTemplateColumns: TEMPLATE_COLUNAS }}
              onClick={() => subAgrupar && setExpandido(aberto ? null : g.chave)}
            >
              <span style={{ fontFamily: "var(--font-sans, inherit)" }}>{g.rotulo || "(sem valor)"}</span>
              <LinhaValores grupo={g} />
            </div>
            {aberto && subAgrupar && colunaSub && (
              <div className="stx-ind-drilldown">
                <p className="stx-analise-secao-titulo" style={{ margin: "0 0 6px 0" }}>{g.rotulo} — por {colunaSub.toLowerCase()}</p>
                {(() => {
                  const subgrupos = subAgrupar(g);
                  if (subgrupos.length === 0) return <p className="stx-panel-sub">Sem detalhamento disponível.</p>;
                  return (
                    <>
                      <LinhaCabecalho colunaRotulo={colunaSub} />
                      {subgrupos.map((sub) => (
                        <div key={sub.chave} className="stx-ind-tabela-linha" style={{ gridTemplateColumns: TEMPLATE_COLUNAS, cursor: "default" }}>
                          <span>{sub.rotulo || "(sem valor)"}</span>
                          <LinhaValores grupo={sub} />
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

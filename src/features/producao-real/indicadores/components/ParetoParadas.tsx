"use client";

// Pareto dos motivos de parada — barras (minutos por motivo) + linha de %
// acumulado, clássico 80/20. Clicar num motivo abre o drill-down: quais
// máquina/operação/produto tiveram aquele motivo (ponto 9 do pedido —
// "Paradas -> motivo -> máquina/operação/produto").

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ParadaIndicador, ParetoMotivoItem } from "@/features/producao-real/indicadores/calculations";
import { formatarMinutos } from "@/features/producao-real/indicadores/format";
import { THEMES } from "@/lib/constants";

interface ParetoParadasProps {
  pareto: ParetoMotivoItem[];
  paradas: ParadaIndicador[];
  tema: "dark" | "light";
}

export default function ParetoParadas({ pareto, paradas, tema }: ParetoParadasProps) {
  const cores = THEMES[tema];
  const [motivoAberto, setMotivoAberto] = useState<string | null>(null);

  if (pareto.length === 0) return <div className="stx-empty">Nenhuma parada registrada no período/filtro.</div>;

  const dadosGrafico = pareto.map((p) => ({ nome: p.motivoNome, minutos: Math.round(p.minutos), acumulado: Math.round(p.percentualAcumulado) }));

  return (
    <div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <ComposedChart data={dadosGrafico} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={cores.border} vertical={false} />
            <XAxis dataKey="nome" tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={{ stroke: cores.border }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={70} />
            <YAxis yAxisId="min" tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: cores.surface, border: `1px solid ${cores.border}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: cores.text }}
              formatter={(value, name) => (name === "minutos" ? formatarMinutos(Number(value)) : `${value}%`)}
            />
            <Bar yAxisId="min" dataKey="minutos" name="minutos" fill={cores.accent} radius={[4, 4, 0, 0]} />
            <Line yAxisId="pct" type="monotone" dataKey="acumulado" name="acumulado" stroke={cores.warning} strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="stx-ind-tabela-wrap" style={{ marginTop: 16 }}>
        <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr" }}>
          <span>Motivo</span>
          <span>Categoria</span>
          <span>Minutos</span>
          <span>Qtd. paradas</span>
          <span>% acumulado</span>
        </div>
        {pareto.map((p) => {
          const aberto = motivoAberto === p.motivoId;
          return (
            <div key={p.motivoId}>
              <div
                className="stx-ind-tabela-linha"
                style={{ gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr" }}
                onClick={() => setMotivoAberto(aberto ? null : p.motivoId)}
              >
                <span style={{ fontFamily: "inherit" }}>{p.motivoNome}</span>
                <span>{p.motivoCategoria}</span>
                <span>{formatarMinutos(p.minutos)}</span>
                <span>{p.quantidadeParadas}</span>
                <span>{p.percentualAcumulado.toFixed(0)}%</span>
              </div>
              {aberto && (
                <div className="stx-ind-drilldown">
                  <p className="stx-analise-secao-titulo" style={{ margin: "0 0 6px 0" }}>{p.motivoNome} — por máquina</p>
                  {agruparIndicadoresParadasPorMaquina(paradas.filter((pp) => pp.motivoId === p.motivoId)).map((g) => (
                    <div key={g.chave} className="stx-tabela-producao-linha" style={{ gridTemplateColumns: "2fr 1fr" }}>
                      <span>{g.rotulo}</span>
                      <span>{formatarMinutos(g.minutos)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Drill-down simples (motivo -> máquina), sem precisar do motor genérico
// de calculations.ts (que agrupa ApontamentoIndicador, não ParadaIndicador)
// — mantido local por ser um caso de uso único desta view.
function agruparIndicadoresParadasPorMaquina(paradas: ParadaIndicador[]): { chave: string; rotulo: string; minutos: number }[] {
  const porMaquina = new Map<string, { rotulo: string; minutos: number }>();
  paradas.forEach((p) => {
    const atual = porMaquina.get(p.maquinaId);
    if (atual) atual.minutos += p.minutos;
    else porMaquina.set(p.maquinaId, { rotulo: p.maquinaNome, minutos: p.minutos });
  });
  return Array.from(porMaquina.entries())
    .map(([chave, v]) => ({ chave, ...v }))
    .sort((a, b) => b.minutos - a.minutos);
}

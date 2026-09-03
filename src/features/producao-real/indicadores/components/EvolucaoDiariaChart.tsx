"use client";

// Evolução por dia — Performance/Disponibilidade/OEE em linha (sempre a
// versão agregada de calculations.ts, um ponto por dia) + tabela com o
// resto das métricas do dia. Nenhuma fórmula aqui, só apresentação.

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GrupoIndicadores } from "@/features/producao-real/indicadores/calculations";
import { formatarMinutos, formatarPecas, formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";
import { THEMES } from "@/lib/constants";

export default function EvolucaoDiariaChart({ dias, tema }: { dias: GrupoIndicadores[]; tema: "dark" | "light" }) {
  const cores = THEMES[tema];

  if (dias.length === 0) return <div className="stx-empty">Nenhum apontamento no período/filtro.</div>;

  const dadosGrafico = dias.map((d) => ({
    dia: d.rotulo,
    performance: d.resumo.performancePct === null ? null : Math.round(d.resumo.performancePct),
    disponibilidade: d.resumo.disponibilidadePct === null ? null : Math.round(d.resumo.disponibilidadePct),
    oee: d.resumo.oeePct === null ? null : Math.round(d.resumo.oeePct),
  }));

  return (
    <div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={dadosGrafico} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={cores.border} vertical={false} />
            <XAxis dataKey="dia" tick={{ fill: cores.textMuted, fontSize: 11 }} axisLine={{ stroke: cores.border }} tickLine={false} />
            <YAxis tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: cores.surface, border: `1px solid ${cores.border}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: cores.text }}
              formatter={(value) => (value === null || value === undefined ? "N/A" : `${value}%`)}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: cores.textMuted }} />
            <Line type="monotone" dataKey="performance" name="Performance" stroke={cores.accent} strokeWidth={2.5} dot={{ r: 4 }} connectNulls={false} />
            <Line type="monotone" dataKey="disponibilidade" name="Disponibilidade" stroke={cores.blueprint} strokeWidth={2.5} dot={{ r: 4 }} connectNulls={false} />
            <Line type="monotone" dataKey="oee" name="OEE" stroke={cores.warning} strokeWidth={2.5} dot={{ r: 4 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="stx-ind-tabela-wrap" style={{ marginTop: 16 }}>
        <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr 1fr" }}>
          <span>Dia</span>
          <span>Prod. acabada</span>
          <span>Performance</span>
          <span>Disponib.</span>
          <span>Qualidade</span>
          <span>OEE</span>
          <span>Paradas</span>
        </div>
        {dias.map((d) => (
          <div key={d.chave} className="stx-ind-tabela-linha" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr 1fr", cursor: "default" }}>
            <span style={{ fontFamily: "inherit" }}>{d.rotulo}</span>
            <span>{formatarPecas(d.resumo.producaoAcabadaTotal)}</span>
            <span>{formatarPercentualIndicador(d.resumo.performancePct)}</span>
            <span>{formatarPercentualIndicador(d.resumo.disponibilidadePct)}</span>
            <span>{formatarPercentualIndicador(d.resumo.qualidadePct)}</span>
            <span>{formatarPercentualIndicador(d.resumo.oeePct)}</span>
            <span>{formatarMinutos(d.resumo.minutosParadosTotais)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

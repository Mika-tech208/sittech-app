"use client";

// Pareto de paradas com seletor de métrica (minutos/quantidade/custo/
// capacidade) — nunca um "ranking econômico inteligente", só ordena pela
// métrica escolhida. Drill-down por máquina reagrupa as paradas do
// próprio motivo já carregadas, sem nova chamada ao banco.

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  calcularParetoParadasPorMetrica,
  type MetricaParetoParadas,
  type ParadaComContexto,
} from "@/features/producao-real/paradas/calculations";
import { formatarBRLIndicador, formatarMinutos, formatarPecas } from "@/features/producao-real/indicadores/format";
import { THEMES } from "@/lib/constants";

const METRICAS: { key: MetricaParetoParadas; label: string }[] = [
  { key: "minutos", label: "Minutos" },
  { key: "quantidade", label: "Quantidade" },
  { key: "custo", label: "Custo do tempo ocioso" },
  { key: "capacidade", label: "Capacidade perdida" },
];

function formatarValor(metrica: MetricaParetoParadas, valor: number, baseConfiavel: boolean): string {
  if (!baseConfiavel) return "N/A";
  if (metrica === "minutos") return formatarMinutos(valor);
  if (metrica === "quantidade") return String(valor);
  if (metrica === "custo") return formatarBRLIndicador(valor);
  return `${formatarPecas(valor)} peças`;
}

function agruparParadasPorMaquina(paradas: ParadaComContexto[]): { chave: string; rotulo: string; minutos: number }[] {
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

export default function ParetoParadasSeletor({ paradas, tema }: { paradas: ParadaComContexto[]; tema: "dark" | "light" }) {
  const cores = THEMES[tema];
  const [metrica, setMetrica] = useState<MetricaParetoParadas>("minutos");
  const [motivoAberto, setMotivoAberto] = useState<string | null>(null);

  const pareto = calcularParetoParadasPorMetrica(paradas, metrica);

  if (paradas.length === 0) return <div className="stx-empty">Nenhuma parada registrada no período/filtro.</div>;

  const dadosGrafico = pareto.map((p) => ({
    nome: p.motivoNome,
    valor: p.baseConfiavel ? Math.round(p.valor) : 0,
    acumulado: Math.round(p.percentualAcumulado),
  }));

  return (
    <div>
      <div className="stx-ind-tabs" style={{ margin: "0 0 14px 0" }}>
        {METRICAS.map((m) => (
          <button key={m.key} type="button" className={`stx-ind-tab ${metrica === m.key ? "active" : ""}`} onClick={() => setMetrica(m.key)}>
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <ComposedChart data={dadosGrafico} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={cores.border} vertical={false} />
            <XAxis dataKey="nome" tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={{ stroke: cores.border }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={70} />
            <YAxis yAxisId="val" tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: cores.surface, border: `1px solid ${cores.border}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: cores.text }}
            />
            <Bar yAxisId="val" dataKey="valor" name={METRICAS.find((m) => m.key === metrica)?.label} fill={cores.accent} radius={[4, 4, 0, 0]} />
            <Line yAxisId="pct" type="monotone" dataKey="acumulado" name="acumulado" stroke={cores.warning} strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="stx-ind-tabela-wrap" style={{ marginTop: 16 }}>
        <div className="stx-ind-tabela-header" style={{ gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr" }}>
          <span>Motivo</span>
          <span>Categoria</span>
          <span>{METRICAS.find((m) => m.key === metrica)?.label}</span>
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
                <span>{formatarValor(metrica, p.valor, p.baseConfiavel)}</span>
                <span>{p.quantidadeParadas}</span>
                <span>{p.percentualAcumulado.toFixed(0)}%</span>
              </div>
              {aberto && (
                <div className="stx-ind-drilldown">
                  <p className="stx-analise-secao-titulo" style={{ margin: "0 0 6px 0" }}>{p.motivoNome} — por máquina</p>
                  {agruparParadasPorMaquina(paradas.filter((pp) => pp.motivoId === p.motivoId)).map((g) => (
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

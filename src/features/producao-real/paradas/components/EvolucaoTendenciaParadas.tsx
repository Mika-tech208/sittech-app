"use client";

// Evolução diária de paradas + tendência (default: últimos 7 dias vs 7
// dias anteriores a esses, dentro do que já foi carregado pelo filtro —
// nenhuma chamada nova ao banco). calcularComparativoTendenciaParadas é
// agnóstica de "semana": só compara duas janelas já filtradas por quem
// chama, então o mesmo componente já suporta janelas maiores no futuro.

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  agruparParadasPorDia,
  calcularComparativoTendenciaParadas,
  type ParadaComContexto,
} from "@/features/producao-real/paradas/calculations";
import type { ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import { formatarBRLIndicador, formatarMinutos, formatarPecas } from "@/features/producao-real/indicadores/format";
import { THEMES } from "@/lib/constants";

function formatarDelta(v: number | null, formatador: (n: number) => string): string {
  if (v === null || !Number.isFinite(v)) return "N/A";
  const sinal = v > 0 ? "+" : "";
  return `${sinal}${formatador(v)}`;
}

function diasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

export default function EvolucaoTendenciaParadas({
  paradas,
  apontamentos,
  tema,
  dataInicialFiltro,
  dataFinalFiltro,
}: {
  paradas: ParadaComContexto[];
  apontamentos: ApontamentoIndicador[];
  tema: "dark" | "light";
  dataInicialFiltro: string;
  dataFinalFiltro: string;
}) {
  const cores = THEMES[tema];
  const dias = agruparParadasPorDia(paradas, apontamentos);

  const hoje = diasAtras(0);
  const inicioJanelaAtual = diasAtras(6);
  const inicioJanelaAnterior = diasAtras(13);
  const fimJanelaAnterior = diasAtras(7);

  const paradasJanelaAtual = paradas.filter((p) => p.data >= inicioJanelaAtual && p.data <= hoje);
  const apontamentosJanelaAtual = apontamentos.filter((ap) => ap.data >= inicioJanelaAtual && ap.data <= hoje);
  const paradasJanelaAnterior = paradas.filter((p) => p.data >= inicioJanelaAnterior && p.data <= fimJanelaAnterior);
  const apontamentosJanelaAnterior = apontamentos.filter((ap) => ap.data >= inicioJanelaAnterior && ap.data <= fimJanelaAnterior);

  // Cobertura é sobre o FILTRO de datas escolhido, não sobre existir dado —
  // um período real sem produção nos 7 dias anteriores é uma resposta válida
  // da comparação (delta = tudo), não motivo pra esconder o comparativo.
  const cobreAsDuasJanelas = dataInicialFiltro <= inicioJanelaAnterior && dataFinalFiltro >= hoje;
  const comparativo = calcularComparativoTendenciaParadas(paradasJanelaAtual, apontamentosJanelaAtual, paradasJanelaAnterior, apontamentosJanelaAnterior);

  const dadosGrafico = dias.map((d) => ({
    dia: d.rotulo,
    minutos: d.resumo.minutosParadosTotal,
    quantidade: d.resumo.quantidadeParadas,
  }));

  return (
    <div>
      <p className="stx-analise-secao-titulo" style={{ margin: "0 0 6px 0" }}>Evolução diária</p>
      {dias.length === 0 ? (
        <div className="stx-empty">Nenhuma parada no período/filtro.</div>
      ) : (
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={dadosGrafico} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={cores.border} vertical={false} />
              <XAxis dataKey="dia" tick={{ fill: cores.textMuted, fontSize: 11 }} axisLine={{ stroke: cores.border }} tickLine={false} />
              <YAxis tick={{ fill: cores.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: cores.surface, border: `1px solid ${cores.border}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: cores.text }} />
              <Legend wrapperStyle={{ fontSize: 11, color: cores.textMuted }} />
              <Line type="monotone" dataKey="minutos" name="Minutos parados" stroke={cores.accent} strokeWidth={2.5} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="quantidade" name="Qtd. paradas" stroke={cores.warning} strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="stx-analise-secao-titulo" style={{ margin: "22px 0 6px 0" }}>Tendência — últimos 7 dias vs 7 dias anteriores</p>
      {!cobreAsDuasJanelas ? (
        <p className="stx-panel-sub">
          O filtro de data atual não cobre os últimos 14 dias — amplie o período pra comparar as duas janelas.
        </p>
      ) : (
        <div className="stx-capacidade-reais-grid">
          <div>
            <p className="stx-capacidade-reais-label">Minutos parados</p>
            <p className="stx-capacidade-reais-valor">{formatarDelta(comparativo.deltaMinutos, (n) => formatarMinutos(Math.abs(n)))}</p>
          </div>
          <div>
            <p className="stx-capacidade-reais-label">Quantidade de paradas</p>
            <p className="stx-capacidade-reais-valor">{formatarDelta(comparativo.deltaQuantidade, (n) => String(Math.abs(n)))}</p>
          </div>
          <div>
            <p className="stx-capacidade-reais-label">Duração média</p>
            <p className="stx-capacidade-reais-valor">{formatarDelta(comparativo.deltaDuracaoMedia, (n) => formatarMinutos(Math.abs(n)))}</p>
          </div>
          <div>
            <p className="stx-capacidade-reais-label">Custo do tempo ocioso</p>
            <p className="stx-capacidade-reais-valor">{formatarDelta(comparativo.deltaCusto, (n) => formatarBRLIndicador(Math.abs(n)))}</p>
          </div>
          <div>
            <p className="stx-capacidade-reais-label">Capacidade perdida</p>
            <p className="stx-capacidade-reais-valor">{formatarDelta(comparativo.deltaCapacidadePerdida, (n) => `${formatarPecas(Math.abs(n))} peças`)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

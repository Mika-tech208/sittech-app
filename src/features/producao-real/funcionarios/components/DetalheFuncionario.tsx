"use client";

// Detalhe individual (§17-E/F/G/H) — SEMPRE por contexto, nunca um
// resumo único da pessoa atravessando produto/operação/máquina
// diferentes (§2/§13). Evidências de paradas/economia nunca viram card
// autônomo — só acompanham o contexto (§11/§12).

import { useRouter } from "next/navigation";
import { rotuloContextoFuncionario } from "@/features/producao-real/funcionarios/contexto";
import type { AnaliseFuncionarioContexto, ResultadoAnaliseFuncionarios } from "@/features/producao-real/funcionarios/types";
import { formatarBRLIndicador, formatarMinutos, formatarPecas, formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

function blocoContexto(a: AnaliseFuncionarioContexto, router: ReturnType<typeof useRouter>) {
  function verEmParadas() {
    const qs = new URLSearchParams();
    qs.set("dataInicial", a.janelaAtual.dataInicial);
    qs.set("dataFinal", a.janelaAtual.dataFinal);
    qs.set("produtoId", a.contexto.produtoId);
    qs.set("maquinaId", a.contexto.maquinaId);
    qs.set("operacaoId", a.contexto.operacaoId);
    router.push(`/producao-real/paradas?${qs.toString()}`);
  }

  return (
    <div key={`${a.contexto.produtoId}-${a.contexto.operacaoId}-${a.contexto.maquinaId}`} className="stx-panel" style={{ marginTop: 10 }}>
      <p className="stx-panel-title" style={{ fontSize: 14 }}>{rotuloContextoFuncionario(a.contexto)}</p>

      {!a.amostraFuncionario.suficiente ? (
        <p className="stx-panel-sub">Amostra insuficiente neste contexto: {a.amostraFuncionario.motivoInsuficiencia}.</p>
      ) : (
        <>
          <p className="stx-panel-sub" style={{ marginTop: 6 }}>
            <strong>Performance:</strong> {formatarPercentualIndicador(a.performanceFuncionario)}
            {a.performancePares !== null && ` · Referência comparável (outros operadores): ${formatarPercentualIndicador(a.performancePares)}`}
            {a.performancePares === null && " · Meta oficial: 100,0%"}
          </p>
          {!a.amostraPares.suficiente && (
            <p className="stx-panel-sub">Sem pares comparáveis suficientes neste contexto/janela ({a.amostraPares.motivoInsuficiencia}) — comparado contra a meta oficial.</p>
          )}

          {a.amostraFuncionarioQualidade.suficiente ? (
            <p className="stx-panel-sub">
              <strong>Qualidade:</strong> {formatarPercentualIndicador(a.qualidadeFuncionario)}
              {a.qualidadePares !== null
                ? ` · Referência comparável: ${formatarPercentualIndicador(a.qualidadePares)}`
                : a.evolucao.qualidadeAnterior !== null
                ? ` · Histórico do próprio funcionário (janela anterior): ${formatarPercentualIndicador(a.evolucao.qualidadeAnterior)}`
                : " · Sem referência disponível ainda (pares e histórico próprio insuficientes)"}
            </p>
          ) : (
            <p className="stx-panel-sub">Qualidade: amostra insuficiente ({a.amostraFuncionarioQualidade.motivoInsuficiencia}).</p>
          )}

          <p className="stx-panel-sub" style={{ marginTop: 8 }}><strong>Evolução</strong> (mesmo contexto, janela atual vs. anterior)</p>
          {a.evolucao.disponivel ? (
            <p className="stx-panel-sub">
              Performance: {formatarPercentualIndicador(a.evolucao.performanceAnterior)} → {formatarPercentualIndicador(a.evolucao.performanceAtual)}
              {a.evolucao.qualidadeAnterior !== null && a.evolucao.qualidadeAtual !== null &&
                ` · Qualidade: ${formatarPercentualIndicador(a.evolucao.qualidadeAnterior)} → ${formatarPercentualIndicador(a.evolucao.qualidadeAtual)}`}
            </p>
          ) : (
            <p className="stx-panel-sub">Evolução indisponível: {a.evolucao.motivoIndisponivel}.</p>
          )}

          <p className="stx-panel-sub" style={{ marginTop: 8 }}><strong>Paradas observadas durante os apontamentos</strong> (nunca "causadas pelo funcionário")</p>
          <p className="stx-panel-sub">
            {formatarMinutos(a.paradas.minutosParados)} em {a.paradas.quantidadeParadas} parada(s)
            {a.paradas.duracaoMediaMinutos !== null && ` · duração média ${formatarMinutos(a.paradas.duracaoMediaMinutos)}`}
          </p>
          {a.paradas.principaisMotivos.length > 0 && (
            <p className="stx-panel-sub">
              Principais motivos: {a.paradas.principaisMotivos.map((m) => `${m.motivoNome} (${formatarMinutos(m.minutos)})`).join(", ")}
            </p>
          )}
          {a.paradas.motivoRecorrente && (
            <p className="stx-panel-sub">
              Motivo &quot;{a.paradas.motivoRecorrente.motivoNome}&quot; associado a {a.paradas.motivoRecorrente.percentualPeriodosAfetados.toFixed(0)}% dos períodos apontados neste contexto.
            </p>
          )}
          <p className="stx-panel-sub">
            Custo do tempo ocioso: {formatarBRLIndicador(a.paradas.custoTempoOciosoTotal)} · Capacidade local perdida: {formatarPecas(a.paradas.capacidadePerdidaTotal)}
          </p>

          <p className="stx-panel-sub" style={{ marginTop: 8 }}><strong>Resultado econômico observado durante os apontamentos</strong> (nunca "custo causado pelo funcionário")</p>
          <p className="stx-panel-sub">
            Custo/peça: {formatarBRLIndicador(a.economia.custoMedioPorPecaProduzida)}
            {a.economia.diferencaCustoTeoricoObservadoMedia !== null && ` · Diferença teórico×observado (média): ${formatarBRLIndicador(a.economia.diferencaCustoTeoricoObservadoMedia)}`}
          </p>
          <p className="stx-panel-sub">
            {a.economia.margemDisponivel
              ? `Margem de processamento: ${formatarPercentualIndicador(a.economia.margemPct)}`
              : "Margem de processamento: não aplicável (funcionário não trabalhou a última etapa do roteiro neste contexto/janela)."}
          </p>

          <button type="button" className="stx-btn-secondary" style={{ marginTop: 8 }} onClick={verEmParadas}>Ver em Paradas</button>
        </>
      )}
    </div>
  );
}

export default function DetalheFuncionario({
  funcionarioId, resultado, onFechar,
}: {
  funcionarioId: string;
  resultado: ResultadoAnaliseFuncionarios;
  onFechar: () => void;
}) {
  const router = useRouter();
  const cobertura = resultado.coberturaPorFuncionario.get(funcionarioId);
  const analisesDoFuncionario = resultado.analises.filter((a) => a.funcionarioId === funcionarioId);

  if (!cobertura) return null;

  return (
    <div className="stx-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p className="stx-panel-title">{cobertura.funcionarioNome}</p>
        <button type="button" className="stx-btn-secondary" onClick={onFechar}>Fechar</button>
      </div>
      <p className="stx-panel-sub">
        Cobertura operacional observada: {cobertura.cobertura.quantidadeProdutos} produto(s) · {cobertura.cobertura.quantidadeOperacoes} operação(ões) · {cobertura.cobertura.quantidadeMaquinas} máquina(s) · {cobertura.cobertura.quantidadeContextosDistintos} contexto(s) distinto(s) — fato observado, não é medida de competência.
      </p>

      <p className="stx-panel-sub" style={{ marginTop: 10 }}><strong>Contextos trabalhados</strong></p>
      {cobertura.cobertura.porContexto.map((c) => (
        <p key={`${c.contexto.produtoId}-${c.contexto.operacaoId}-${c.contexto.maquinaId}`} className="stx-panel-sub">
          {rotuloContextoFuncionario(c.contexto)} — {c.periodos} período(s)
        </p>
      ))}

      {analisesDoFuncionario.map((a) => blocoContexto(a, router))}
    </div>
  );
}

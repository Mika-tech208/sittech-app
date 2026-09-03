"use client";

// Detalhe expansível (§19-D) — separa explicitamente DESVIO / COMPARAÇÃO
// / EVIDÊNCIAS / IMPACTOS / POSSÍVEIS FATORES / CONFIANÇA (§11), e nunca
// afirma causalidade (§11/§12: "possível fator associado", "coincidiu
// com", "vale investigar" — nunca "foi causado por").

import { useRouter } from "next/navigation";
import type { DesvioDetectado, IncidenteDesvio } from "@/features/producao-real/desvios/types";
import { formatarBRLIndicador, formatarPecas, formatarPercentualIndicador, formatarMinutos } from "@/features/producao-real/indicadores/format";

function formatarValor(valor: number, unidade: DesvioDetectado["unidade"]): string {
  if (unidade === "%") return formatarPercentualIndicador(valor);
  if (unidade === "min") return formatarMinutos(valor);
  if (unidade === "R$") return formatarBRLIndicador(valor);
  return formatarPecas(valor);
}

function linhaDesvio(d: DesvioDetectado) {
  return (
    <div key={d.id} className="stx-panel" style={{ marginTop: 10 }}>
      <p className="stx-panel-title" style={{ fontSize: 14 }}>{d.titulo}</p>

      <p className="stx-panel-sub" style={{ marginTop: 8 }}><strong>Comparação</strong> ({d.origemJanela === "operacional" ? "semana atual até agora vs. mesmo trecho da semana anterior" : "últimos 28 dias vs. 28 dias anteriores"})</p>
      <p className="stx-capacidade-reais-valor" style={{ fontSize: 16 }}>
        {formatarValor(d.valorReferencia, d.unidade)} → {formatarValor(d.valorAtual, d.unidade)}
        {d.deltaPercentual !== null && <span className="stx-panel-sub"> ({d.deltaPercentual > 0 ? "+" : ""}{d.deltaPercentual.toFixed(1)}%)</span>}
      </p>
      <p className="stx-panel-sub">
        Magnitude: {d.magnitude} · Persistência: {d.persistente ? "sim" : "não"}
        {d.percentualPeriodosAfetados !== null && ` (${d.percentualPeriodosAfetados.toFixed(0)}% dos períodos)`}
      </p>
      <p className="stx-panel-sub">{d.justificativaSeveridade}</p>

      {d.evidencias.length > 0 && (
        <>
          <p className="stx-panel-sub" style={{ marginTop: 8 }}><strong>Evidências relacionadas</strong> (mesmo contexto e janela — não prova causa)</p>
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
            {d.evidencias.map((e, i) => (
              <li key={i} className="stx-panel-sub">{e.descricao} — <em>{e.valor}</em> ({e.fonte})</li>
            ))}
          </ul>
        </>
      )}

      {d.impactos.length > 0 && (
        <>
          <p className="stx-panel-sub" style={{ marginTop: 8 }}><strong>Impactos</strong> (só métricas já defensáveis — nunca faturamento perdido)</p>
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
            {d.impactos.map((imp, i) => (
              <li key={i} className="stx-panel-sub">{imp.metrica}: {formatarValor(imp.valor, imp.unidade)}</li>
            ))}
          </ul>
        </>
      )}

      {d.possiveisFatores.length > 0 && (
        <>
          <p className="stx-panel-sub" style={{ marginTop: 8 }}><strong>Possíveis fatores</strong> (hipóteses para investigação, nunca causa confirmada)</p>
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
            {d.possiveisFatores.map((f, i) => (
              <li key={i} className="stx-panel-sub">{f.fator} — {f.descricao}</li>
            ))}
          </ul>
        </>
      )}

      <p className="stx-panel-sub" style={{ marginTop: 8 }}>
        <strong>Confiança:</strong> {d.confianca === "estimativa" ? "Estimativa (nunca gargalo/causa confirmada)" : "Calculado a partir dos snapshots oficiais"}
      </p>
    </div>
  );
}

export default function DetalheDesvio({ incidente }: { incidente: IncidenteDesvio }) {
  const router = useRouter();

  function verNaOrigem() {
    if (!incidente.desvioPrincipal.linkSugerido) return;
    const rota = incidente.desvioPrincipal.linkSugerido === "produtividade" ? "/producao-real/indicadores" : "/producao-real/paradas";
    const f = incidente.desvioPrincipal.filtrosDrillDown;
    const qs = new URLSearchParams();
    qs.set("dataInicial", f.dataInicial);
    qs.set("dataFinal", f.dataFinal);
    if (f.produtoId) qs.set("produtoId", f.produtoId);
    if (f.maquinaId) qs.set("maquinaId", f.maquinaId);
    if (f.operacaoId) qs.set("operacaoId", f.operacaoId);
    router.push(`${rota}?${qs.toString()}`);
  }

  // Funcionários V1 (§18 daquela análise): sempre disponível, preservando
  // produto/operação/máquina/janela — NUNCA um funcionarioId específico
  // (um Desvio nunca isola uma pessoa como causa, só evidência de que
  // houve troca de operador no contexto — quem foi, a tela de
  // Funcionários mostra sem concluir causalidade).
  function verEmFuncionarios() {
    const f = incidente.desvioPrincipal.filtrosDrillDown;
    const qs = new URLSearchParams();
    qs.set("dataInicial", f.dataInicial);
    qs.set("dataFinal", f.dataFinal);
    if (f.produtoId) qs.set("produtoId", f.produtoId);
    if (f.maquinaId) qs.set("maquinaId", f.maquinaId);
    if (f.operacaoId) qs.set("operacaoId", f.operacaoId);
    router.push(`/producao-real/funcionarios?${qs.toString()}`);
  }

  return (
    <div>
      {incidente.chaveFatorDominante && (
        <p className="stx-panel-sub">
          <strong>Incidente principal:</strong> agrupado por fator dominante confiável (&quot;{incidente.chaveFatorDominante}&quot;) — {incidente.efeitos.length} efeito(s) observado(s) do mesmo fenômeno, listados abaixo.
        </p>
      )}
      {linhaDesvio(incidente.desvioPrincipal)}
      {incidente.efeitos.length > 0 && (
        <>
          <p className="stx-panel-sub" style={{ marginTop: 10 }}><strong>Efeitos observados no mesmo incidente</strong></p>
          {incidente.efeitos.map((e) => linhaDesvio(e))}
        </>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {incidente.desvioPrincipal.linkSugerido && (
          <button type="button" className="stx-btn-secondary" onClick={verNaOrigem}>
            {incidente.desvioPrincipal.linkSugerido === "produtividade" ? "Ver na Produtividade" : "Ver em Paradas"}
          </button>
        )}
        <button type="button" className="stx-btn-secondary" onClick={verEmFuncionarios}>Ver em Funcionários</button>
      </div>
    </div>
  );
}

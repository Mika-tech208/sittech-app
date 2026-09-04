"use client";

// Produtos programados (§17/§18/§22-B/C) — cards por produto, detalhe
// expansível. Nunca soma peças entre produtos (cada card é 1 produto).

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ItemValidacaoPrevisao } from "@/features/producao-real/validacao-previsao/types";
import { formatarPecas, formatarPercentualIndicador } from "@/features/producao-real/indicadores/format";

const LABEL_ESTADO: Record<ItemValidacaoPrevisao["estado"], { label: string; classe: string }> = {
  concluido: { label: "Concluído", classe: "atingido" },
  no_ritmo: { label: "No ritmo", classe: "atingido" },
  atencao: { label: "Atenção", classe: "atencao" },
  inviavel_teoricamente: { label: "Inviável teoricamente", classe: "critico" },
  sem_estimativa: { label: "Sem estimativa", classe: "indisponivel" },
};

function qsDe(filtros: ItemValidacaoPrevisao["filtrosDrillDown"]): string {
  const qs = new URLSearchParams();
  qs.set("dataInicial", filtros.dataInicial);
  qs.set("dataFinal", filtros.dataFinal);
  if (filtros.produtoId) qs.set("produtoId", filtros.produtoId);
  return qs.toString();
}

export default function ListaProdutosComDetalhe({ itens }: { itens: ItemValidacaoPrevisao[] }) {
  const router = useRouter();
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  if (itens.length === 0) return <div className="stx-empty">Nenhum produto previsto para esta semana.</div>;

  return (
    <div>
      {itens.map((it) => {
        const expandido = expandidoId === it.itemId;
        const estadoInfo = LABEL_ESTADO[it.estado];
        return (
          <div key={it.itemId} className="stx-panel" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <span className={`stx-performance-badge ${estadoInfo.classe}`}>{estadoInfo.label}</span>
                <p className="stx-panel-title" style={{ marginTop: 6 }}>{it.produtoNome}</p>
                <p className="stx-panel-sub">
                  Previsto {formatarPecas(it.previsto)} · Acabado {formatarPecas(it.producaoAcabadaObservada)} · Falta {formatarPecas(it.faltaOperacional)}
                </p>
                <p className="stx-panel-sub">
                  Capacidade teórica restante {formatarPecas(it.capacidadeTeoricaRestante)} · provável {it.capacidadeProvavelRestante !== null ? formatarPecas(it.capacidadeProvavelRestante) : "indisponível"}
                </p>
              </div>
              <button type="button" className="stx-btn-secondary" onClick={() => setExpandidoId(expandido ? null : it.itemId)}>
                {expandido ? "Ocultar" : "Ver detalhe"}
              </button>
            </div>

            {expandido && (
              <div style={{ marginTop: 10 }}>
                <p className="stx-panel-sub"><strong>Realizado oficial</strong> (previsao_itens, lançamento manual): {formatarPecas(it.realizadoOficial)}</p>
                <p className="stx-panel-sub">
                  <strong>Divergência</strong> (acabado observado − realizado oficial): {it.divergenciaRealizado > 0 ? "+" : ""}{formatarPecas(it.divergenciaRealizado)} — sinal de conferência, nunca somado ao previsto.
                </p>
                <p className="stx-panel-sub"><strong>Tempo restante da semana:</strong> {it.tempoRestanteHoras.toFixed(1)}h</p>

                {it.restricaoTeorica && (
                  <p className="stx-panel-sub"><strong>Restrição teórica</strong> (motor de capacidade): {it.restricaoTeorica.etapaOuMaquina}</p>
                )}

                {it.projecaoFinal !== null ? (
                  <>
                    <p className="stx-panel-sub" style={{ marginTop: 6 }}>
                      <strong>Projeção estimada</strong> — se o comportamento recente se mantiver: acabado {formatarPecas(it.producaoAcabadaObservada)} + provável restante {formatarPecas(it.capacidadeProvavelRestante)} ≈ {formatarPecas(it.projecaoFinal)}
                    </p>
                    <p className="stx-panel-sub">Déficit estimado: {formatarPecas(it.deficitProjetado)} ({it.confianca === "estimativa" ? "estimativa baseada em desempenho recente acima da meta" : "calculado"})</p>
                  </>
                ) : (
                  <p className="stx-panel-sub">Projeção indisponível — amostra insuficiente para capacidade provável neste(s) contexto(s).</p>
                )}

                {it.wipLimitacaoAplicavel && (
                  <p className="stx-panel-sub" style={{ marginTop: 6 }}>
                    Limitação conhecida (V1): a capacidade considera o roteiro completo a partir do início — peças já em etapas intermediárias não são rastreadas, então esta leitura é conservadora (pode subestimar quanto falta).
                  </p>
                )}

                {it.fatoresProvaveisUsados.length > 0 && (
                  <>
                    <p className="stx-panel-sub" style={{ marginTop: 8 }}><strong>Contextos usados no fator provável</strong> (produto + operação + máquina)</p>
                    <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
                      {it.fatoresProvaveisUsados.map((f, i) => (
                        <li key={i} className="stx-panel-sub">
                          {f.contexto.operacaoNome} — {f.contexto.maquinaNome}:{" "}
                          {f.amostra.suficiente
                            ? `OEE ${formatarPercentualIndicador(f.oeePct)}${f.performanceSustentadaAcimaDeMeta ? " (Performance recente acima da meta)" : ""}`
                            : `amostra insuficiente (${f.amostra.motivoInsuficiencia})`}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {it.restricoesObservadas.length > 0 && (
                  <>
                    <p className="stx-panel-sub" style={{ marginTop: 8 }}><strong>Restrições observadas</strong> (nunca gargalo confirmado)</p>
                    <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
                      {it.restricoesObservadas.map((e, i) => (
                        <li key={i} className="stx-panel-sub">{e.descricao} — <em>{e.valor}</em> ({e.fonte})</li>
                      ))}
                    </ul>
                  </>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button type="button" className="stx-btn-secondary" onClick={() => router.push("/previsao")}>Ver Previsão</button>
                  <button type="button" className="stx-btn-secondary" onClick={() => router.push(`/producao-real/indicadores?${qsDe(it.filtrosDrillDown)}`)}>Ver Produtividade</button>
                  <button type="button" className="stx-btn-secondary" onClick={() => router.push(`/producao-real/paradas?${qsDe(it.filtrosDrillDown)}`)}>Ver Paradas</button>
                  <button type="button" className="stx-btn-secondary" onClick={() => router.push("/producao-real/desvios")}>Ver Desvios</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

"use client";

// "Status da programação" — o bloco de atingibilidade (Planejamento ×
// Capacidade), recolhível. Mesmo conteúdo que já existia em dois painéis
// separados na página (capacidade em R$ + análise em horas por máquina),
// só reorganizado num único bloco expansível — nenhuma fórmula muda.
//
// Status = analiseCapacidadeSemana.atingivel (calcularAnaliseCapacidadeSemanal,
// já existente) — "Previsão atingível" / "Previsão não atingível" é
// EXATAMENTE esse booleano, não uma categoria nova. Reage sozinho a
// qualquer mudança na programação porque é só um useMemo recalculado no
// componente pai, igual já acontecia antes.
//
// A tabela "Produção possível por produto" (Previsto/Possível/Diferença)
// que ficava dentro do painel de capacidade em R$ SAIU daqui — agora vive
// consolidada em ProdutosProgramados (Previsto/Possível/Realizado/Falta/%),
// pra não duplicar a mesma lista de produtos em dois lugares da tela.

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import type { AnaliseCapacidadeSemanal, CapacidadeMaximaSemana, ObservacaoSetupMaquina } from "@/features/capacidade/types";

export interface StatusProgramacaoProps {
  analise: AnaliseCapacidadeSemanal;
  capacidadeMaximaSemana: CapacidadeMaximaSemana;
  observacoesSetup: ObservacaoSetupMaquina[];
  modoSimulacao: boolean;
  onAjustar: () => void;
  formatBRL: (v: number) => string;
}

export default function StatusProgramacao({
  analise, capacidadeMaximaSemana, observacoesSetup, modoSimulacao, onAjustar, formatBRL,
}: StatusProgramacaoProps) {
  const [expandido, setExpandido] = useState(false);
  const atingivel = analise.atingivel;

  return (
    <div className={`stx-panel stx-analise-capacidade ${atingivel ? "ok" : "alerta"}`}>
      <button type="button" className="stx-status-header" onClick={() => setExpandido((v) => !v)}>
        <div className="stx-analise-resumo" style={{ marginBottom: 0 }}>
          <span className={`stx-analise-icone ${atingivel ? "ok" : "alerta"}`}>
            {atingivel ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
          </span>
          <div>
            <p className="stx-analise-titulo">
              {atingivel ? "✓ Previsão atingível" : "⚠ Previsão não atingível"}
              {!atingivel && analise.gargalos.length > 0 && (
                <span className="stx-status-compacto"> · {analise.gargalos.length} gargalo{analise.gargalos.length > 1 ? "s" : ""}</span>
              )}
              {modoSimulacao && <span className="stx-simulacao-tag">simulado</span>}
            </p>
            {!expandido && (
              <p className="stx-analise-sub">
                {atingivel
                  ? (analise.maquinaMaisCarregada ? `Máquina mais carregada: ${analise.maquinaMaisCarregada.nome} — ${analise.maquinaMaisCarregada.pct.toFixed(0)}%.` : "Marca as máquinas de cada item pra essa análise aparecer.")
                  : `Principal gargalo: ${analise.gargalos[0]?.nome} — ${analise.gargalos[0]?.pct.toFixed(0)}%.`}
              </p>
            )}
          </div>
        </div>
        <span className="stx-status-toggle">
          {expandido ? "Recolher" : "Expandir"} {expandido ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {expandido && (
        <div className="stx-status-detalhes">
          <p className="stx-analise-sub">
            {atingivel
              ? (analise.maquinaMaisCarregada
                  ? `Todas as máquinas têm capacidade suficiente. Máquina mais carregada: ${analise.maquinaMaisCarregada.nome} — ${analise.maquinaMaisCarregada.pct.toFixed(0)}%.`
                  : "Marca as máquinas de cada item pra essa análise aparecer.")
              : `A produção planejada excede a capacidade de ${analise.gargalos.length} máquina${analise.gargalos.length > 1 ? "s" : ""}. Principal gargalo: ${analise.gargalos[0]?.nome} — ${analise.gargalos[0]?.pct.toFixed(0)}%, faltam ${analise.gargalos[0]?.deficit.toFixed(1)}h.`}
          </p>

          {capacidadeMaximaSemana.temDados && (
            <div className="stx-capacidade-reais-grid">
              <div>
                <p className="stx-capacidade-reais-label">Previsto</p>
                <p className="stx-capacidade-reais-valor">{formatBRL(capacidadeMaximaSemana.previstoTotalReais)}</p>
              </div>
              <div>
                <p className="stx-capacidade-reais-label">{capacidadeMaximaSemana.temGargalo ? "Máximo estimado" : "Capacidade estimada"}</p>
                <p className="stx-capacidade-reais-valor">{formatBRL(capacidadeMaximaSemana.capacidadeEstimadaReais)}</p>
              </div>
              <div>
                <p className="stx-capacidade-reais-label">{capacidadeMaximaSemana.temGargalo ? "Atingível" : "Uso da capacidade"}</p>
                <p className="stx-capacidade-reais-valor" style={{ color: capacidadeMaximaSemana.temGargalo ? "var(--danger)" : "var(--accent)" }}>
                  {capacidadeMaximaSemana.temGargalo
                    ? `${((capacidadeMaximaSemana.capacidadeEstimadaReais / capacidadeMaximaSemana.previstoTotalReais) * 100).toFixed(1)}%`
                    : `${((capacidadeMaximaSemana.previstoTotalReais / capacidadeMaximaSemana.capacidadeEstimadaReais) * 100).toFixed(1)}%`}
                </p>
              </div>
              <div>
                <p className="stx-capacidade-reais-label">{capacidadeMaximaSemana.temGargalo ? "Excesso planejado" : "Folga estimada"}</p>
                <p className="stx-capacidade-reais-valor" style={{ color: capacidadeMaximaSemana.temGargalo ? "var(--danger)" : "var(--accent)" }}>
                  {formatBRL(Math.abs(capacidadeMaximaSemana.capacidadeEstimadaReais - capacidadeMaximaSemana.previstoTotalReais))}
                </p>
              </div>
            </div>
          )}

          {capacidadeMaximaSemana.maquinaLimitante && (
            <p className="stx-analise-sub" style={{ marginTop: 10 }}>
              Máquina {capacidadeMaximaSemana.temGargalo ? "limitante" : "mais carregada"}: <b>{capacidadeMaximaSemana.maquinaLimitante.nome} — {capacidadeMaximaSemana.maquinaLimitante.pct.toFixed(0)}%</b>
            </p>
          )}

          {capacidadeMaximaSemana.temGargalo && (
            <div className="stx-ajustar-box">
              <div>
                <p className="stx-ajustar-titulo">Sugestão para tornar a previsão atingível</p>
                <p className="stx-analise-sub">
                  Reduz cada produto na mesma proporção da carga que ele representa nas máquinas sobrecarregadas, até caber na capacidade da semana.
                </p>
              </div>
              <button className="stx-btn-primary" onClick={onAjustar}>AJUSTAR PARA CAPACIDADE</button>
            </div>
          )}

          {analise.maquinas.length > 0 && (
            <div className="stx-analise-lista">
              <p className="stx-analise-secao-titulo">Uso por máquina, da maior pra menor</p>
              {analise.maquinas.map((m) => (
                <div className="stx-analise-maquina-linha" key={m.maquinaId}>
                  <div className="stx-analise-maquina-topo">
                    <span className="stx-analise-maquina-nome">{m.nome}</span>
                    <span className={`stx-analise-pct stx-status-${m.status}`}>{m.pct.toFixed(1)}%</span>
                  </div>
                  <div className="stx-analise-barra-bg">
                    <div className={`stx-analise-barra-fill stx-status-${m.status}`} style={{ width: `${Math.min(100, m.pct)}%` }} />
                  </div>
                  <p className="stx-analise-maquina-detalhe">
                    {m.horasNecessarias.toFixed(1)}h necessárias / {m.horasDisponiveis.toFixed(1)}h disponíveis
                    {m.deficit > 0 && ` · excesso: ${m.deficit.toFixed(1)}h`}
                  </p>
                </div>
              ))}
            </div>
          )}

          {analise.gargalos.length > 0 && (
            <div className="stx-analise-gargalos">
              <p className="stx-analise-secao-titulo">Gargalos da semana</p>
              {analise.gargalos.map((m) => (
                <div className="stx-analise-gargalo-card" key={m.maquinaId}>
                  <p className="stx-analise-gargalo-nome">🔴 {m.nome} — {m.pct.toFixed(0)}%</p>
                  <p className="stx-analise-gargalo-detalhe">
                    Necessário: {m.horasNecessarias.toFixed(1)}h &nbsp;·&nbsp; Disponível: {m.horasDisponiveis.toFixed(1)}h &nbsp;·&nbsp; Déficit: {m.deficit.toFixed(1)}h
                  </p>
                  <p className="stx-analise-gargalo-produtos-titulo">Produtos consumindo essa máquina:</p>
                  {m.produtosConsumidores.map((p) => (
                    <p className="stx-analise-gargalo-produto" key={p.produtoId}>{p.nome} → {p.horas.toFixed(1)}h</p>
                  ))}
                </div>
              ))}
            </div>
          )}

          {observacoesSetup.length > 0 && (
            <div className="stx-analise-lista">
              <p className="stx-analise-secao-titulo">Observações</p>
              {observacoesSetup.map((obs) => (
                <div className="stx-observacao-card" key={obs.maquinaId}>
                  <p className="stx-observacao-texto">
                    💡 <b>{obs.nome}</b> está sendo dividida entre {obs.ordenados.map((p) => p.nome).join(" e ")}.
                    {" "}Pra reduzir trocas de setup, sugiro rodar o lote inteiro de <b>{obs.ordenados[0].nome}</b> primeiro
                    {obs.ordenados[0].lucroHora > -Infinity && ` (maior lucro/hora)`}, depois {obs.ordenados.slice(1).map((p) => p.nome).join(", depois ")} — em vez de intercalar entre eles.
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

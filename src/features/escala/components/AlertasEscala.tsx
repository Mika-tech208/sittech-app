"use client";

import type { AlertaEscala } from "@/features/escala/types";
import type { AlocacaoLinha, Nomes } from "@/hooks/useEscalaProducao";

function rotuloSlot(data?: string, periodoId?: string): string {
  if (!data) return "";
  const [, m, d] = data.split("-");
  return `${d}/${m}${periodoId ? ` ${periodoId.toUpperCase()}` : ""}`;
}

export default function AlertasEscala({ alocacoes, alertas, nomes }: { alocacoes: AlocacaoLinha[]; alertas: AlertaEscala[]; nomes: Nomes }) {
  const semPosto = alocacoes.filter((a) => !a.maquinaId);
  const porMotivo = new Map<string, number>();
  semPosto.forEach((a) => porMotivo.set(a.motivoSemPosto || "", (porMotivo.get(a.motivoSemPosto || "") ?? 0) + 1));
  const excecoes = alocacoes.filter((a) => a.excecaoRevezamento);

  const naoAtendida = alertas.filter((a) => a.tipo === "demanda_nao_atendida");
  const gargalos = alertas.filter((a) => a.tipo === "gargalo_sem_operador");
  const risco = alertas.filter((a) => a.tipo === "risco_falta_material");
  const semFunc = alertas.filter((a) => a.tipo === "sem_funcionarios");
  const acimaLimite = alertas.filter((a) => a.tipo === "wip_acima_do_limite");

  const vazio = semPosto.length === 0 && excecoes.length === 0 && alertas.length === 0;
  return (
    <div className="stx-esc-painel">
      <h2>Alertas gerenciais</h2>
      {vazio && <p className="stx-esc-muted">Nenhum alerta no último cálculo.</p>}
      <div className="stx-esc-lista">
        {semPosto.length > 0 && (
          <div className="stx-esc-linha">
            <span>
              <b>Possível subcarga da Previsão:</b> {semPosto.length} funcionário-período sem posto.
              <div className="stx-esc-muted">{[...porMotivo.entries()].map(([m, n]) => `${m} (${n})`).join(" · ")}</div>
            </span>
          </div>
        )}
        {gargalos.length > 0 && (
          <div className="stx-esc-linha">
            <span><b>Gargalo sem operador:</b> {gargalos.length} período(s) com posto de gargalo descoberto por falta de funcionários (primeiro: {rotuloSlot(gargalos[0].data, gargalos[0].periodoId)}, {nomes.produtos.get(gargalos[0].produtoId || "") || "produto"}).</span>
          </div>
        )}
        {naoAtendida.length > 0 && (
          <div className="stx-esc-linha">
            <span>
              <b>Demanda da Previsão não atendida pela escala:</b>
              <div className="stx-esc-muted">{naoAtendida.map((a) => `${nomes.produtos.get(a.produtoId || "") || "Produto"}: ${Math.round(a.pecas || 0).toLocaleString("pt-BR")} peças`).join(" · ")}</div>
            </span>
          </div>
        )}
        {risco.length > 0 && (
          <div className="stx-esc-linha">
            <span><b>Risco de falta de material:</b> {risco.length} etapa(s) seguinte(s) processariam mais peças do que a anterior já produziu ({risco.map((a) => nomes.produtos.get(a.produtoId || "") || "produto").join(", ")}). Estoque intermediário inicial é desconhecido — é alerta, não bloqueio.</span>
          </div>
        )}
        {acimaLimite.length > 0 && (
          <div className="stx-esc-linha">
            <span>
              <b>Estoque intermediário acima do limite definido:</b> novo WIP impedido; o previsto continua podendo consumir o saldo.
              <div className="stx-esc-muted">{acimaLimite.map((a) => `${nomes.produtos.get(a.produtoId || "") || "Produto"}: ${Math.round(a.pecas || 0).toLocaleString("pt-BR")} confirmadas, limite ${Math.round(a.quantidade || 0).toLocaleString("pt-BR")}`).join(" · ")}</div>
            </span>
          </div>
        )}
        {semFunc.length > 0 && (
          <div className="stx-esc-linha"><span><b>Sem funcionários disponíveis</b> em {semFunc.length} período(s).</span></div>
        )}
        {excecoes.length > 0 && (
          <div className="stx-esc-linha">
            <span>
              <b>Exceções de revezamento ({excecoes.length}):</b>
              <div className="stx-esc-muted">
                {excecoes.slice(0, 6).map((a) => `${nomes.funcionarios.get(a.funcionarioId) || "Funcionário"} — ${rotuloSlot(a.data, a.periodoId)}: ${a.motivoExcecao}`).join(" | ")}
                {excecoes.length > 6 ? ` … e mais ${excecoes.length - 6}` : ""}
              </div>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

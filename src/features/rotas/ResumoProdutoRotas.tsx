"use client";

// Linha/cartão de CAPACIDADE do produto de rotas (tela Capacidade): Previsto, Possível, AUTO e CONV (nominal × realizável), fluxo comum (Etiquetar, Embalar) e gargalo.
// O produto aparece UMA vez ("Conector 3/4\"…"); as cadeias internas do cálculo nunca aparecem como produtos.
import type { PreviaRotas } from "./compartilhada";
import type { RealizavelDaEscala } from "./SelecaoRotasPrevisao";

const n = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString("pt-BR") : "∞");
const NOME_ROTA: Record<string, string> = { CONV: "Rota convencional", AUTO: "Rota automática" };

export default function ResumoProdutoRotas({ nome, previsto, previa, realizavel }: { nome: string; previsto: number; previa: PreviaRotas; realizavel?: RealizavelDaEscala | null }) {
  const p = previa.plano;
  const gargalo = p.gargalo === null ? "—" : p.gargalo.tipo === "comum" ? `${p.gargalo.operacao} (fluxo comum — limita as duas rotas)` : `entrada: ${p.gargalo.limitantes.map((l) => `${l.rotaCodigo}/${l.operacao}`).join(" + ")}`;
  const cel = { padding: "4px 8px" } as const;
  return (
    <div className="stx-cap-section" aria-label={`Capacidade de ${nome}`}>
      <div className="stx-cap-section-head">
        <h2 className="stx-cap-section-title">{nome}</h2>
        <span className="stx-cap-ref">produto com rotas — capacidade NOMINAL das máquinas marcadas (não é garantia; a Escala confirma)</span>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "6px 0 10px", fontSize: 14 }}>
        <span>Previsto <b>{n(previsto)}</b></span>
        <span>Possível <b style={{ color: p.falta > 0 ? "var(--warning)" : "var(--accent)" }}>{n(p.finalAtingivel)}</b> ({p.percentualAtingivel.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)</span>
        <span>Falta <b>{n(p.falta)}</b></span>
        <span>Gargalo <b style={{ color: p.gargalo ? "var(--danger)" : undefined }}>{gargalo}</b></span>
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead><tr style={{ textAlign: "left" }}><th style={cel}>Trecho</th><th style={{ ...cel, textAlign: "right" }}>Nominal</th><th style={{ ...cel, textAlign: "right" }}>Realizável</th><th style={{ ...cel, textAlign: "right" }}>Divisão proposta</th></tr></thead>
        <tbody>
          {Object.values(p.capacidadePorRota).map((r) => (
            <tr key={r.rotaCodigo}>
              <td style={cel}>{NOME_ROTA[r.rotaCodigo] ?? r.rotaCodigo}{r.limitante ? ` — limita: ${r.limitante.operacao}` : " — sem máquina marcada"}</td>
              <td style={{ ...cel, textAlign: "right" }}>{n(r.realizavel)}</td>
              <td style={{ ...cel, textAlign: "right" }}>{realizavel ? n(realizavel.porRota[r.rotaCodigo] ?? r.realizavel) : "após a Escala"}</td>
              <td style={{ ...cel, textAlign: "right" }}>{n(p.alvo[r.rotaCodigo] ?? 0)}</td>
            </tr>
          ))}
          <tr><td style={cel}><b>Fluxo comum</b> — Etiquetar</td><td style={{ ...cel, textAlign: "right" }}>{n(p.poolComum.porOperacao.Etiquetar ?? 0)}</td><td style={{ ...cel, textAlign: "right" }}>—</td><td style={{ ...cel, textAlign: "right" }}>{n(p.finalAtingivel)}</td></tr>
          <tr><td style={cel}><b>Fluxo comum</b> — Embalar</td><td style={{ ...cel, textAlign: "right" }}>{n(p.poolComum.porOperacao.Embalar ?? 0)}</td><td style={{ ...cel, textAlign: "right" }}>—</td><td style={{ ...cel, textAlign: "right" }}>{n(p.finalAtingivel)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

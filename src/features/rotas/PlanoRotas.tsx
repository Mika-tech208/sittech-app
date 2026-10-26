// Resultado do PLANEJADOR (somente leitura): demanda final → rotas de entrada → pool comum (Etiquetar, Embalar) → resultado. O gargalo comum aparece como um "funil" vermelho
// que corta as duas rotas ao mesmo tempo. Puramente apresentacional; nada é gravado.
import type { SaidaPlanejador } from "./planejador";

const n = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString("pt-BR") : "∞");
const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Caixa({ titulo, valor, sub, tom, grande }: { titulo: string; valor: string; sub?: string; tom?: "ok" | "erro" | "aviso" | "neutro"; grande?: boolean }) {
  const cor = tom === "erro" ? "var(--danger)" : tom === "ok" ? "var(--accent)" : tom === "aviso" ? "var(--warning)" : "var(--border)";
  return (
    <div style={{ border: `${tom && tom !== "neutro" ? 2 : 1}px solid ${cor}`, borderRadius: 10, padding: "8px 12px", minWidth: 128, flex: "1 1 auto" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: "var(--text-muted)" }}>{titulo}</div>
      <div style={{ fontSize: grande ? 22 : 17, fontWeight: 700, color: tom === "erro" ? "var(--danger)" : "var(--text)" }}>{valor}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}
const Seta = () => <span aria-hidden style={{ alignSelf: "center", color: "var(--text-muted)", fontSize: 18 }}>→</span>;

export default function PlanoRotas({ plano }: { plano: SaidaPlanejador }) {
  const comum = plano.gargalo?.tipo === "comum" ? plano.gargalo : null;
  const etiq = plano.poolComum.porOperacao.Etiquetar, emb = plano.poolComum.porOperacao.Embalar;
  const rotas = Object.values(plano.capacidadePorRota);
  const gargaloOp = comum?.operacao;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-label="Plano de rotas">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        <Caixa titulo="DEMANDA FINAL" valor={n(plano.demandaFinal)} sub="uma só, do produto final" grande />
        <Seta />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "2 1 260px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: "var(--text-muted)" }}>ROTAS DE ENTRADA — entrega planejada (máx. realizável)</div>
          {rotas.map((r) => (
            <Caixa key={r.rotaCodigo} titulo={r.rotaCodigo} valor={n(plano.alvo[r.rotaCodigo] ?? 0)}
              sub={`máx. ${n(r.realizavel)}${r.nominal - r.realizavel > 1 ? ` (nominal ${n(r.nominal)})` : ""}${r.limitante ? ` · limita: ${r.limitante.operacao}` : ""}`} tom={r.realizavel <= 0 ? "aviso" : "neutro"} />
          ))}
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>capacidade somada das rotas: {n(plano.capacidadeEntrada)}</div>
        </div>
        <Seta />
        <div style={{ border: `2px dashed ${comum ? "var(--danger)" : "var(--accent)"}`, borderRadius: 12, padding: 8, display: "flex", flexDirection: "column", gap: 6, flex: "2 1 300px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: comum ? "var(--danger)" : "var(--accent)" }}>POOL COMUM {comum ? "— GARGALO: corta as DUAS rotas" : ""}</div>
          <Caixa titulo="POOL COMUM (capacidade)" valor={n(plano.poolComum.capacidade)} sub="menor de Etiquetar e Embalar" tom={comum ? "erro" : "ok"} grande />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Caixa titulo="ETIQUETAR" valor={n(etiq ?? Infinity)} tom={gargaloOp === "Etiquetar" ? "erro" : "neutro"} sub={gargaloOp === "Etiquetar" ? "gargalo" : undefined} />
            <Seta />
            <Caixa titulo="EMBALAR" valor={n(emb ?? Infinity)} tom={gargaloOp === "Embalar" ? "erro" : "neutro"} sub={gargaloOp === "Embalar" ? "gargalo" : undefined} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Caixa titulo="RESULTADO" valor={`${n(plano.finalAtingivel)} / ${n(plano.demandaFinal)}`} sub={`${plano.percentualAtingivel.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% atingível`} tom={plano.falta > 0 ? "erro" : "ok"} grande />
        <Caixa titulo="FALTA" valor={n(plano.falta)} tom={plano.falta > 0 ? "erro" : "neutro"} />
        <Caixa titulo="GARGALO" valor={plano.gargalo === null ? "—" : plano.gargalo.tipo === "comum" ? plano.gargalo.operacao : "Entrada"}
          sub={plano.gargalo?.tipo === "entrada" ? plano.gargalo.limitantes.map((l) => `${l.rotaCodigo}/${l.operacao}`).join(" + ") : plano.gargalo ? "fluxo comum" : "demanda atendida"} tom={plano.gargalo ? "erro" : "ok"} />
        <Caixa titulo="WIP PROJETADO (SOMBRA)" valor={n(plano.wip.saldoFinal)} sub={`entregas ${n(plano.wip.entregas.total)} − consumo ${n(plano.wip.consumoPool)} + inicial ${n(plano.wip.inicial.total)}`} tom={plano.wip.acimaDoLimite ? "aviso" : "neutro"} />
        {plano.custo && <Caixa titulo="CUSTO ESTIMADO" valor={BRL(plano.custo.estimado)} sub={plano.custo.economiaAuto ? `economia AUTO ${BRL(plano.custo.economiaAuto.total)} (${n(plano.custo.economiaAuto.volume)} pç × ${plano.custo.economiaAuto.porPeca.toLocaleString("pt-BR", { maximumFractionDigits: 5 })})` : undefined} />}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
        {plano.motivos.map((m) => <li key={m.codigo + m.texto}><b>{m.codigo}</b> — {m.texto}</li>)}
      </ul>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Planejador {plano.versao} · simulação somente em memória (não grava Previsão, Escala, WIP nem apontamentos).</div>
    </div>
  );
}

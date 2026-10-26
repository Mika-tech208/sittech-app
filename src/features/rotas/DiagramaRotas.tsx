// Diagrama (SVG) das rotas e da CONVERGÊNCIA no pool comum. Puramente apresentacional; mostra capacidade por caixa quando informada.
import type { AnaliseCapacidadeRotas, EstruturaProduto, EtapaCadastro } from "./tipos";

const fmt = (n: number) => Math.round(n).toLocaleString("pt-BR");

export default function DiagramaRotas({ estrutura, etapas, analise, nomeProduto }: { estrutura: EstruturaProduto; etapas: Map<string, EtapaCadastro>; analise?: AnaliseCapacidadeRotas | null; nomeProduto: string }) {
  const W = 128, H = 52, GX = 34, GY = 36, X0 = 16, Y0 = 40;
  const capDe = (id: string) => analise?.capacidadePorRota.flatMap((r) => r.etapas).find((c) => c.etapaId === id)?.pecas ?? analise?.comum.find((c) => c.etapaId === id)?.pecas;
  const caixa = (id: string, x: number, y: number, destaque = false) => {
    const e = etapas.get(id);
    const cap = analise ? capDe(id) : undefined;
    const gargalo = analise?.gargalo && ((analise.gargalo.tipo === "comum" && analise.gargalo.etapaId === id) || (analise.gargalo.tipo === "entrada" && analise.gargalo.limitantes.some((l) => l.etapaId === id)));
    return (
      <g key={id}>
        <rect x={x} y={y} width={W} height={H} rx={8} fill="var(--panel, none)" stroke={gargalo ? "var(--danger)" : destaque ? "var(--accent)" : "var(--border)"} strokeWidth={gargalo ? 2 : 1.2} />
        <text x={x + W / 2} y={y + 21} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text)">{e?.operacao ?? id}</text>
        <text x={x + W / 2} y={y + 38} textAnchor="middle" fontSize={10.5} fill="var(--text-muted)">{cap !== undefined ? `${fmt(cap)} pç/sem` : `${e?.maquinasIds.length ?? 0} máquina(s)`}</text>
      </g>
    );
  };
  const seta = (x1: number, y1: number, x2: number, y2: number) => <line key={`${x1},${y1},${x2},${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text-muted)" strokeWidth={1.4} markerEnd="url(#seta)" />;

  const rotas = estrutura.rotas;
  const maxLen = Math.max(...rotas.map((r) => r.etapas.length));
  const xPool = X0 + maxLen * (W + GX) + 10;
  const linhas = rotas.length;
  const hTotal = Y0 + linhas * (H + GY) + 18;
  const yMeio = Y0 + ((linhas * (H + GY)) - GY) / 2 - H / 2;
  const poolEtapas = estrutura.poolComum?.etapas ?? [];
  const larguraPool = poolEtapas.length * (W + GX) + (W + 10);
  const wTotal = xPool + larguraPool + 30;

  return (
    <svg viewBox={`0 0 ${wTotal} ${hTotal}`} role="img" aria-label={`Rotas de fabricação de ${nomeProduto}`} style={{ width: "100%", maxWidth: wTotal, height: "auto" }}>
      <defs><marker id="seta" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="var(--text-muted)" /></marker></defs>
      {rotas.map((r, i) => {
        const y = Y0 + i * (H + GY);
        return (
          <g key={r.codigo}>
            <text x={X0} y={y - 6} fontSize={11} fontWeight={700} fill="var(--accent)">{r.codigo} — {r.nome}</text>
            {r.etapas.map((id, k) => <g key={id}>{caixa(id, X0 + k * (W + GX), y)}{k > 0 && seta(X0 + (k - 1) * (W + GX) + W, y + H / 2, X0 + k * (W + GX), y + H / 2)}</g>)}
            {seta(X0 + (r.etapas.length - 1) * (W + GX) + W, y + H / 2, xPool, yMeio + H / 2)}
          </g>
        );
      })}
      <rect x={xPool} y={Y0 - 22} width={larguraPool} height={linhas * (H + GY) + 4} rx={12} fill="none" stroke="var(--accent)" strokeDasharray="5 4" strokeWidth={1.4} />
      <text x={xPool + 10} y={Y0 - 8} fontSize={11} fontWeight={700} fill="var(--accent)">POOL COMUM (convergência)</text>
      {poolEtapas.map((id, k) => <g key={id}>{caixa(id, xPool + 10 + k * (W + GX), yMeio, estrutura.etapaFinalId === id)}{k > 0 && seta(xPool + 10 + (k - 1) * (W + GX) + W, yMeio + H / 2, xPool + 10 + k * (W + GX), yMeio + H / 2)}</g>)}
      <text x={xPool + 10 + (poolEtapas.length - 1) * (W + GX) + W / 2} y={yMeio + H + 16} textAnchor="middle" fontSize={10.5} fill="var(--accent)">etapa FINAL → {nomeProduto}</text>
    </svg>
  );
}

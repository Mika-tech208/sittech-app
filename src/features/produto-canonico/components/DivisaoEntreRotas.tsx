// Divisão do plano entre as rotas do produto único (só leitura; vem das linhas do plano, nada estimado). Não renderiza nada sem dados.
import { divisaoEntreRotas, type LinhaPlanoMinima } from "../divisaoRotas";
import type { ModeloCanonico } from "../tipos";

const fmt = (v: number) => Math.round(v).toLocaleString("pt-BR");
const pct = (v: number, t: number) => (t > 0 ? `${((v / t) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
const dia = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;

export default function DivisaoEntreRotas({ linhas, modelo, nomeEtapa }: { linhas: LinhaPlanoMinima[]; modelo: ModeloCanonico | null | undefined; nomeEtapa?: (etapaId: string) => string | null }) {
  const d = divisaoEntreRotas(linhas, modelo);
  if (!d.temDados) return null;
  const dias = Object.keys(d.porDia).sort();
  return (
    <div className="stx-esc-painel" data-testid="divisao-rotas">
      <h2>Divisão entre as rotas (plano)</h2>
      <p className="stx-esc-muted">Peças planejadas na saída de cada rota, somadas das linhas do plano. Só leitura: não é capacidade nem previsão de resultado.</p>
      <table className="stx-esc-tabela">
        <thead>
          <tr>
            <th className="colf">Rota</th>
            {dias.map((x) => <th key={x}>{dia(x)}</th>)}
            <th>Semana</th>
          </tr>
        </thead>
        <tbody>
          {d.rotas.map((r) => (
            <tr key={r.rotaId}>
              <td className="colf">{r.rotulo}{nomeEtapa?.(r.etapaSaidaId) ? ` (saída: ${nomeEtapa(r.etapaSaidaId)})` : ""}</td>
              {dias.map((x) => <td key={x}>{fmt(d.porDia[x][r.rotaId])}</td>)}
              <td><b>{fmt(d.total[r.rotaId])}</b> · {pct(d.total[r.rotaId], d.totalGeral)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

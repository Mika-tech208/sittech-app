"use client";

// Fluxo do produto único por ROTA (Tela de Produtos): "ROTA 1 — Convencional: A → B → C → D" e "ROTA 2 — Automática: …", com custo e margem de cada rota.
// Apresentação pura: recebe as margens já calculadas (margemRotas.ts) e os nomes das máquinas. Só é renderizada para produto canônico (escondido até o cutover).
import type { Maquina } from "@/types/domain";
import type { MargemRota } from "../margemRotas";

export interface RotasDoProdutoProps {
  rotas: MargemRota[];
  maquinas: Pick<Maquina, "id" | "nome">[];
  formatarMoeda: (v: number) => string;
}

export default function RotasDoProduto({ rotas, maquinas, formatarMoeda }: RotasDoProdutoProps) {
  return (
    <div data-testid="rotas-do-produto">
      {rotas.map(({ rota, roteiro, margem }) => (
        <p className="stx-prod-fluxo" key={rota.id}>
          <strong>{rota.nome}</strong>
          {": "}
          {roteiro.map((e) => {
            const nomes = maquinas.filter((m) => (e.maquinasIds || []).includes(m.id)).map((m) => m.nome);
            return `${e.operacao}${nomes.length ? ` (${nomes.join(", ")})` : ""}`;
          }).join(" → ")}
          {` · custo ${formatarMoeda(margem.custo)} · margem ${margem.margemPct.toFixed(0)}%`}
        </p>
      ))}
      <p className="stx-prod-ref">O sistema escolhe quanto produzir em cada rota; Etiquetadora 15 e Embalagem 17 são comuns às duas.</p>
    </div>
  );
}

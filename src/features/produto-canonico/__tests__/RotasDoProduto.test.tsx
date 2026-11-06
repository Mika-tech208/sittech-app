import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RotasDoProduto from "../components/RotasDoProduto";
import { margemPorRota } from "../margemRotas";
import type { PeriodoComDuracao, Produto } from "@/types/domain";
import { C, CAN, MAQ, modelo } from "./fixture";

const m = (a: number, b: number) => ({ m1: a, m2: a, m3: a, t1: b, t2: b, t3: b });
const PER = ["m1", "m2", "m3", "t1", "t2", "t3"].map((id) => ({ id, nome: id, duracaoHoras: 1.5 })) as unknown as PeriodoComDuracao[];
const PRODUTO = {
  id: CAN, nome: "Conector", referencia: "", valorUnitario: 0.1825, ativo: true, prioridade: "media",
  roteiro: [
    { id: C.m8, operacao: "Rosquear + Parafusar", metas: m(1275, 1100), maquinasIds: [MAQ.m8] }, { id: C.ros, operacao: "Rosquear", metas: m(2000, 1600), maquinasIds: [MAQ.r3] },
    { id: C.par, operacao: "Parafusar", metas: m(1500, 1200), maquinasIds: [MAQ.p9] }, { id: C.eti, operacao: "Etiquetar", metas: m(3500, 3000), maquinasIds: [MAQ.et15] }, { id: C.emb, operacao: "Embalar", metas: m(5000, 4500), maquinasIds: [MAQ.em17] },
  ],
} as Produto;

describe("RotasDoProduto (Produtos: ROTA 1 / ROTA 2)", () => {
  it("mostra as duas rotas com seus fluxos, máquinas, custo e margem; o trecho comum aparece nas duas", () => {
    const rotas = margemPorRota(PRODUTO, modelo(), { Rosquear: 20, Parafusar: 20, "Rosquear + Parafusar": 25, Etiquetar: 18, Embalar: 16 }, 17, PER);
    render(<RotasDoProduto rotas={rotas} maquinas={[{ id: MAQ.m8, nome: "Máquina 8" }, { id: MAQ.r3, nome: "Rosqueadeira 3" }, { id: MAQ.p9, nome: "Parafusadeira 9" }, { id: MAQ.et15, nome: "Etiquetadora 15" }, { id: MAQ.em17, nome: "Embalagem 17" }]} formatarMoeda={(v) => `R$ ${v.toFixed(4)}`} />);
    const texto = screen.getByTestId("rotas-do-produto").textContent ?? "";
    expect(texto).toContain("ROTA 1 — Convencional: Rosquear (Rosqueadeira 3) → Parafusar (Parafusadeira 9) → Etiquetar (Etiquetadora 15) → Embalar (Embalagem 17)");
    expect(texto).toContain("ROTA 2 — Automática: Rosquear + Parafusar (Máquina 8) → Etiquetar (Etiquetadora 15) → Embalar (Embalagem 17)");
    expect(texto.match(/custo R\$/g)).toHaveLength(2);
    expect(texto).toContain("O sistema escolhe quanto produzir em cada rota");
  });
});

// Postos programados do fechamento com o PRODUTO ÚNICO: o plano canônico (produto único, etapas canônicas, M8 = "Rosquear + Parafusar") vira postos do tablet sem nenhum tratamento especial.
import { describe, expect, it } from "vitest";
import { montarEstadoPostos } from "../postosProgramados";

describe("postos programados × produto único", () => {
  it("M8, Rosquear, Parafusar, Etiquetar e Embalar do produto canônico aparecem como postos do período", () => {
    const aloc = (maq: string, fun: string, etapa: string, op: string) => ({ maquina_id: maq, funcionario_id: fun, produto_id: "PK", etapa_id: etapa, operacao_id: op, pecas: 100, pecas_adicional: 0 });
    const e = montarEstadoPostos({
      alocacoes: [aloc("m8", "f1", "k_m8", "opM"), aloc("r1", "f2", "k_ros", "opR"), aloc("p1", "f3", "k_par", "opP"), aloc("e1", "f4", "k_eti", "opE"), aloc("b1", "f5", "k_emb", "opB")],
      maquinas: ["m8", "r1", "p1", "e1", "b1"].map((id) => ({ id, nome: id })), funcionarios: ["f1", "f2", "f3", "f4", "f5"].map((id) => ({ id, nome: id })), produtos: [{ id: "PK", nome: "Conector 3/4" }],
      operacoes: [{ id: "opM", nome: "Rosquear + Parafusar" }, { id: "opR", nome: "Rosquear" }, { id: "opP", nome: "Parafusar" }, { id: "opE", nome: "Etiquetar" }, { id: "opB", nome: "Embalar" }],
      etapas: ["k_m8:opM", "k_ros:opR", "k_par:opP", "k_eti:opE", "k_emb:opB"].map((x) => ({ id: x.split(":")[0], produto_id: "PK", operacao_id: x.split(":")[1] })),
      etapaMaquinas: [["k_m8", "m8"], ["k_ros", "r1"], ["k_par", "p1"], ["k_eti", "e1"], ["k_emb", "b1"]].map(([etapa_id, maquina_id]) => ({ etapa_id, maquina_id })), apontamentos: [],
    });
    expect(e.postos).toHaveLength(5);
    expect(new Set(e.postos.map((p) => p.maquinaId))).toEqual(new Set(["m8", "r1", "p1", "e1", "b1"]));
    expect(e.postos.every((p) => p.produtoId === "PK")).toBe(true);
    expect(e.postos.find((p) => p.maquinaId === "m8")?.operacaoId).toBe("opM");
  });
});

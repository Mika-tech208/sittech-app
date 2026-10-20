import { describe, it, expect } from "vitest";
import type { AtingibilidadeProduto } from "@/features/escala/atingibilidade";
import { faltaDoProduto, manchete, periodosTexto, ROTULO_STATUS, textoAcao, NOTA_INDEPENDENTES } from "../atingibilidadeTexto";

const base: AtingibilidadeProduto = { produtoId: "p", status: "em_risco", causa: "maquina_livre_nao_priorizada", faltaPlano: 8400, faltaMinima: 0, valorEmRisco: 0, gargaloEtapaId: "e", periodosNecessarios: 2, acao: null, etapas: [] };

describe("textos da atingibilidade", () => {
  it("classificação com os três rótulos pedidos", () => {
    expect(ROTULO_STATUS).toEqual({ atingivel: "Atingível", em_risco: "Em risco", impossivel: "Impossível com a capacidade atual" });
  });
  it("manchete: em risco de faltar X peças", () => {
    expect(manchete(base)).toBe("Em risco de faltar 8.400 peças");
  });
  it("manchete: impossível usa a falta mínima provada quando o plano não mostra falta", () => {
    expect(manchete({ ...base, status: "impossivel", faltaPlano: 0, faltaMinima: 1200 })).toBe("Impossível com a capacidade atual — faltam 1.200 peças");
    expect(faltaDoProduto({ faltaPlano: 5, faltaMinima: 9 })).toBe(9);
  });
  it("manchete: fecha sem folga", () => {
    const t = manchete({ ...base, faltaPlano: 0, etapas: [{ folgaPercentual: 3.2 } as never] });
    expect(t).toContain("folga de só 3,2%");
  });
  it("ação de priorizar máquina com número de períodos", () => {
    expect(textoAcao({ tipo: "priorizar_maquina", produtoId: "p", etapaId: "e", maquinaId: "m15", periodos: 2 }, () => "Etiquetadora 15")).toBe("Priorizar Etiquetadora 15 nos próximos 2 períodos.");
    expect(textoAcao({ tipo: "priorizar_maquina", produtoId: "p", etapaId: "e", maquinaId: "m15", periodos: 1 }, () => "Etiquetadora 15")).toBe("Priorizar Etiquetadora 15 nos próximos 1 período.");
    expect(textoAcao(null, () => "")).toBeNull();
  });
  it("períodos necessários e a nota de independência", () => {
    expect(periodosTexto(0)).toBeNull();
    expect(periodosTexto(3)).toContain("3 períodos");
    expect(NOTA_INDEPENDENTES).toContain("não é contradição");
  });
});

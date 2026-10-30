// CADEIA — diagnóstico NUNCA lança: erro vira CADEIA_DIAGNOSTICO_FALHOU (info) e o plano segue idêntico.
import { describe, it, expect, vi } from "vitest";
import { planejarComFluxo } from "../planejar";
import { cadeia4 } from "./cadeiaHelpers";

vi.mock("../cadeia", async (orig) => ({ ...(await orig<typeof import("../cadeia")>()), simularCadeia: () => { throw new Error("boom"); } }));

describe("cadeia diagnóstico: falha interna", () => {
  it("exceção na validação é capturada: diagnóstico CADEIA_DIAGNOSTICO_FALHOU (info) e o plano é idêntico ao da flag desligada", () => {
    const off = cadeia4({ estoque: [6000, 6000, 3600] });
    const on = cadeia4({ estoque: [6000, 6000, 3600], cadeia: { diagnostico: true } });
    const rOff = planejarComFluxo(off.m.entrada, off.dados, off.opcoes);
    const rOn = planejarComFluxo(on.m.entrada, on.dados, on.opcoes);
    expect(JSON.stringify(rOn.resultado.alocacoes)).toBe(JSON.stringify(rOff.resultado.alocacoes));
    const f = rOn.diagnostico.diagnosticos.filter((d) => d.codigo === "CADEIA_DIAGNOSTICO_FALHOU");
    expect(f).toHaveLength(1);
    expect(f[0].severidade).toBe("info");
    expect(f[0].mensagem).toContain("boom");
  });
});

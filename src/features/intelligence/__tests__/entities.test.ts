import { describe, expect, it } from "vitest";
import { resolverEntidade, type CandidatoEntidade } from "@/features/intelligence/entities";

const MAQUINAS: CandidatoEntidade[] = [
  { id: "maq-1", nome: "Embalagem 17" },
  { id: "maq-2", nome: "Rosqueadeira 3" },
  { id: "maq-3", nome: "Rosqueadeira 5" },
  { id: "maq-4", nome: "Parafusadeira 10" },
  { id: "maq-5", nome: "Parafusadeira 11" },
];

describe("Resolução determinística de entidades (§10)", () => {
  it("caso 1: nome exato resolve direto", () => {
    const r = resolverEntidade("Embalagem 17", MAQUINAS);
    expect(r).toEqual({ status: "resolvido", id: "maq-1", nome: "Embalagem 17" });
  });

  it("caso 2: nome com case/acentuação diferente ainda resolve (normalização)", () => {
    const r = resolverEntidade("embalagem 17", MAQUINAS);
    expect(r.status).toBe("resolvido");
  });

  it("caso 3: substring única resolve (ex.: só 'Embalagem')", () => {
    const r = resolverEntidade("Embalagem", MAQUINAS);
    expect(r).toEqual({ status: "resolvido", id: "maq-1", nome: "Embalagem 17" });
  });

  it("caso 4: substring ambígua entre 2+ candidatos -> ambíguo, nunca escolhe um", () => {
    const r = resolverEntidade("Parafusadeira", MAQUINAS);
    expect(r.status).toBe("ambiguo");
    if (r.status === "ambiguo") expect(r.candidatos.length).toBe(2);
  });

  it("caso 5: substring ambígua entre 'Rosqueadeira 3' e 'Rosqueadeira 5' via 'Rosqueadeira' -> ambíguo", () => {
    const r = resolverEntidade("Rosqueadeira", MAQUINAS);
    expect(r.status).toBe("ambiguo");
  });

  it("caso 6: nome sem nenhuma correspondência -> não encontrado, nunca inventa ID", () => {
    const r = resolverEntidade("Máquina Que Não Existe", MAQUINAS);
    expect(r).toEqual({ status: "nao_encontrado" });
  });

  it("caso 7: string vazia -> não encontrado", () => {
    expect(resolverEntidade("", MAQUINAS)).toEqual({ status: "nao_encontrado" });
    expect(resolverEntidade("   ", MAQUINAS)).toEqual({ status: "nao_encontrado" });
  });

  it("caso 8: lista de candidatos vazia -> nunca encontrado, nunca erro", () => {
    expect(resolverEntidade("Embalagem 17", [])).toEqual({ status: "nao_encontrado" });
  });

  it("caso 9: resultado NUNCA contém um id que não veio da lista de candidatos", () => {
    const r = resolverEntidade("Rosqueadeira 3", MAQUINAS);
    if (r.status === "resolvido") {
      expect(MAQUINAS.map((m) => m.id)).toContain(r.id);
    }
  });

  it("caso 10: nome exato tem prioridade sobre substring (nunca fica ambíguo se um exato bate sozinho)", () => {
    const candidatosComPrefixo: CandidatoEntidade[] = [{ id: "a", nome: "Luva 3/4" }, { id: "b", nome: "Luva 3/4 Reforçada" }];
    const r = resolverEntidade("Luva 3/4", candidatosComPrefixo);
    expect(r).toEqual({ status: "resolvido", id: "a", nome: "Luva 3/4" });
  });
});

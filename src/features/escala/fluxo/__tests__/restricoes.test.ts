// Verificador INDEPENDENTE de restrições duras: cada regra é provada com uma violação construída à mão, e o motor (base e fluxo) nunca viola.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../../gerarEscala";
import { epochMsNoFuso } from "../../tempo";
import type { AlocacaoEscala } from "../../types";
import { entrada, equipe, pool } from "../../__tests__/helpers";
import { verificarRestricoesDuras } from "../restricoes";

const pools = [
  pool({ produto: "P", etapa: "P1", op: "opA", ordem: 1, q: 9000, maquinas: ["a1", "a2"], mu: 300 }),
  pool({ produto: "P", etapa: "P2", op: "opB", ordem: 2, q: 9000, maquinas: ["b1"], mu: 300 }),
];
const base = () => entrada({ pools: [{ ...pools[0], maquinasCompativeisIds: ["a1", "a2"] }, pools[1]], funcionarios: equipe(3), revezamentoDuro: true }, ["2026-10-26", "2026-10-27"]);
const linha = (p: Partial<AlocacaoEscala> & Pick<AlocacaoEscala, "periodoId" | "funcionarioId">): AlocacaoEscala => ({
  data: "2026-10-26", maquinaId: "a1", produtoId: "P", etapaId: "P1", operacaoId: "opA", pecas: 300, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, ...p,
});
const tipos = (e: ReturnType<typeof base>, l: AlocacaoEscala[]) => verificarRestricoesDuras(e, l).map((v) => v.tipo);

describe("verificarRestricoesDuras", () => {
  it("plano válido do motor não tem violações", () => {
    const e = base();
    expect(verificarRestricoesDuras(e, gerarEscala(e).alocacoes)).toEqual([]);
  });
  it("máquina indisponível (parada que intersecta o período), indisponível na Previsão e inativa", () => {
    const e = { ...base(), indisponibilidades: [{ maquinaId: "a1", desdeMs: epochMsNoFuso("2026-10-26", "08:00"), liberadaEmMs: null }], maquinasIndisponiveisPrevisao: ["a2"], maquinasInativas: ["b1"] };
    expect(tipos(e, [linha({ periodoId: "m1", funcionarioId: "f01" })])).toEqual(["maquina_indisponivel"]); // parada começa NO MEIO do M1 (07:12–08:48)
    expect(tipos(e, [linha({ periodoId: "m1", funcionarioId: "f01", maquinaId: "a2" })])).toEqual(["maquina_indisponivel"]);
    expect(tipos(e, [linha({ periodoId: "m1", funcionarioId: "f01", maquinaId: "b1", produtoId: "P", etapaId: "P2", operacaoId: "opB" })])).toContain("maquina_inativa");
    const livre = { ...e, indisponibilidades: [{ maquinaId: "a1", desdeMs: epochMsNoFuso("2026-10-26", "08:48"), liberadaEmMs: null }] };
    expect(tipos(livre, [linha({ periodoId: "m1", funcionarioId: "f01" })])).toEqual([]); // começa exatamente no fim: não afeta
  });
  it("funcionário ausente (janela) e fora da equipe", () => {
    const e = { ...base(), ausencias: [{ funcionarioId: "f01", data: "2026-10-26", inicioMin: 13 * 60, fimMin: 15 * 60 }] };
    expect(tipos(e, [linha({ periodoId: "t1", funcionarioId: "f01" })])).toEqual(["funcionario_ausente"]);
    expect(tipos(e, [linha({ periodoId: "m1", funcionarioId: "f01" })])).toEqual([]);
    expect(tipos(base(), [linha({ periodoId: "m1", funcionarioId: "zz" })])).toContain("funcionario_fora_da_equipe");
  });
  it("revezamento: mesma operação em períodos consecutivos do mesmo dia; o 1º período do dia zera", () => {
    const e = base();
    expect(tipos(e, [linha({ periodoId: "m1", funcionarioId: "f01" }), linha({ periodoId: "m2", funcionarioId: "f01", maquinaId: "a2" })])).toEqual(["revezamento"]);
    expect(tipos(e, [linha({ periodoId: "t3", funcionarioId: "f01" }), linha({ data: "2026-10-27", periodoId: "m1", funcionarioId: "f01" })])).toEqual([]);
    expect(tipos(e, [linha({ periodoId: "m3", funcionarioId: "f01" }), linha({ periodoId: "t1", funcionarioId: "f01", maquinaId: "a2" })])).toEqual(["revezamento"]); // M3 → T1 conta
  });
  it("uma pessoa por posto e um posto por pessoa", () => {
    const e = base();
    expect(tipos(e, [linha({ periodoId: "m1", funcionarioId: "f01" }), linha({ periodoId: "m1", funcionarioId: "f02" })])).toContain("duas_pessoas_no_posto");
    expect(tipos(e, [linha({ periodoId: "m1", funcionarioId: "f01" }), linha({ periodoId: "m1", funcionarioId: "f01", maquinaId: "a2" })])).toContain("pessoa_em_dois_postos");
  });
  it("máquina fora da seleção da Previsão e fora do roteiro", () => {
    const e = base();
    expect(tipos(e, [linha({ periodoId: "m1", funcionarioId: "f01", maquinaId: "zz" })])).toContain("maquina_fora_da_selecao");
    const sel = { ...e, pools: [{ ...e.pools[0], maquinasIds: ["a1", "a2", "a3"], maquinasCompativeisIds: ["a1", "a2"] }, e.pools[1]] };
    expect(tipos(sel, [linha({ periodoId: "m1", funcionarioId: "f01", maquinaId: "a3" })])).toEqual(["maquina_fora_do_roteiro"]);
  });
  it("passado alterado: linha antes de aPartirDe diferente do congelado", () => {
    const e0 = base();
    const cong = [linha({ periodoId: "m1", funcionarioId: "f01" })];
    const e = { ...e0, aPartirDe: 2, congeladas: cong };
    expect(tipos(e, [linha({ periodoId: "m1", funcionarioId: "f01" })])).toEqual([]);
    expect(tipos(e, [linha({ periodoId: "m1", funcionarioId: "f01", maquinaId: "a2" })])).toEqual(["passado_alterado"]);
  });
  it("o último período congelado conta para o revezamento do 1º mutável", () => {
    const e0 = base();
    const e = { ...e0, aPartirDe: 1, congeladas: [linha({ periodoId: "m1", funcionarioId: "f01" })] };
    expect(tipos(e, [linha({ periodoId: "m2", funcionarioId: "f01", maquinaId: "a2" })])).toEqual(["revezamento"]);
  });
});

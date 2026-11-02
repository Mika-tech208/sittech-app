// LINHAS COMPARTILHADAS — prova por CONSUMIDOR de que a quantidade de uma linha física compartilhada (Etiquetadora 15/Embalagem 17: Conector Convencional + Automática) é atribuída ao SEU produto
// em tudo que atribui peças a produto (demanda restante, cobertura, atingibilidade, fluxo/estado, produção projetada, hash), e que SEM distribuição tudo é byte-idêntico ao comportamento anterior.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { hashAlocacoes } from "../horizonte";
import { projetarProducao } from "../execucao";
import { remLegado } from "../fluxo/estado";
import { distribuicaoEfetiva, expandirPorProduto, validarDistribuicao } from "../distribuicao";
import { planosIguais } from "@/lib/escala/planoIgual";
import { chavePool, type AlocacaoEscala } from "../types";
import { entrada, equipe, pool } from "./helpers";

const DIA = "2026-10-19";
const conv = pool({ produto: "pConv", etapa: "eConvEtiq", op: "opEtiq", q: 1000, maquinas: ["mqEtiq"], mu: 400 });
const aut = pool({ produto: "pAut", etapa: "eAutEtiq", op: "opEtiq", q: 600, maquinas: ["mqEtiq"], mu: 400 });
const base = { data: DIA, funcionarioId: "f01", maquinaId: "mqEtiq", operacaoId: "opEtiq", pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null } as const;
const compartilhada = (periodoId: string): AlocacaoEscala => ({ ...base, periodoId, produtoId: "pConv", etapaId: "eConvEtiq", pecas: 300, distribuicao: [{ produtoId: "pConv", etapaId: "eConvEtiq", pecas: 200 }, { produtoId: "pAut", etapaId: "eAutEtiq", pecas: 100 }] });
const simples = (periodoId: string): AlocacaoEscala => ({ ...base, periodoId, produtoId: "pConv", etapaId: "eConvEtiq", pecas: 300 });

describe("consumidores que atribuem quantidade a produto leem a visão POR PRODUTO", () => {
  it("gerarEscala: a demanda restante do Convencional e da Automática abate cada uma o SEU pedaço da linha congelada", () => {
    const e = entrada({ pools: [conv, aut], funcionarios: equipe(2), aPartirDe: 1, congeladas: [compartilhada("m1")] }, [DIA]);
    const r = gerarEscala(e);
    expect(r.pecasRestantes[chavePool("pConv", "eConvEtiq")] ?? 0).toBeLessThanOrEqual(1000 - 200 + 1e-6);
    // contra-prova do erro antigo: sem distribuição, TUDO (300) abateria do Convencional e a Automática ficaria com 600 inteiros
    const ant = gerarEscala(entrada({ pools: [conv, aut], funcionarios: equipe(2), aPartirDe: 1, congeladas: [simples("m1")] }, [DIA]));
    const totalAut = (res: ReturnType<typeof gerarEscala>) => res.alocacoes.filter((a) => a.produtoId === "pAut").reduce((s, a) => s + a.pecas, 0);
    expect(totalAut(r)).toBeLessThanOrEqual(600 - 100 + 1e-6); // com distribuição: restam 500 da Automática
    expect(totalAut(ant)).toBeLessThanOrEqual(600 + 1e-6);
    expect(r.alocacoes.filter((a) => a.produtoId === "pConv").reduce((s, a) => s + a.pecas, 0)).toBeLessThanOrEqual(800 + 1e-6);
  });

  it("cobertura, atingibilidade, remLegado e produção projetada: soma por produto = soma da linha; Automática nunca vira Convencional", () => {
    const e = entrada({ pools: [conv, aut], funcionarios: equipe(2), aPartirDe: 1, congeladas: [compartilhada("m1")] }, [DIA]);
    const rem = remLegado(e);
    expect(rem[chavePool("pConv", "eConvEtiq")]).toBe(800);
    expect(rem[chavePool("pAut", "eAutEtiq")]).toBe(500);
    const proj = projetarProducao(e.congeladas, null);
    expect(proj[chavePool("pConv", "eConvEtiq")]).toBe(200);
    expect(proj[chavePool("pAut", "eAutEtiq")]).toBe(100);
    expect(Object.values(proj).reduce((s, v) => s + v, 0)).toBe(300);
  });

  it("SEM distribuição: expandirPorProduto devolve o MESMO array (identidade) e o hash/plano é o anterior byte a byte", () => {
    const l = [simples("m1"), simples("m2")];
    expect(expandirPorProduto(l)).toBe(l);
    const comUm: AlocacaoEscala = { ...simples("m3"), distribuicao: [{ produtoId: "pConv", etapaId: "eConvEtiq", pecas: 300 }] }; // 1 item = idêntico à linha ⇒ efetivamente ausente
    expect(distribuicaoEfetiva(comUm)).toBeNull();
    expect(hashAlocacoes([comUm])).toBe(hashAlocacoes([simples("m3")]));
    expect(planosIguais([comUm], [simples("m3")])).toBe(true);
  });

  it("hash e NO-OP enxergam a repartição: mudar só a distribuição muda o hash e o plano deixa de ser 'igual'", () => {
    const a = compartilhada("m1");
    const b: AlocacaoEscala = { ...a, distribuicao: [{ produtoId: "pConv", etapaId: "eConvEtiq", pecas: 150 }, { produtoId: "pAut", etapaId: "eAutEtiq", pecas: 150 }] };
    expect(hashAlocacoes([a])).not.toBe(hashAlocacoes([b]));
    expect(planosIguais([a], [b])).toBe(false);
    expect(planosIguais([a], [{ ...a, distribuicao: [...a.distribuicao!].reverse() }])).toBe(true); // ordem do vetor é irrelevante
  });

  it("validarDistribuicao: Σ ≠ pecas, produto da linha não dominante, repetido, quantidade ≤ 0 e linha sem posto são recusados (mesmas regras do CHECK do banco)", () => {
    const ok = compartilhada("m1");
    expect(validarDistribuicao(ok)).toEqual([]);
    expect(validarDistribuicao({ ...ok, pecas: 301 }).length).toBeGreaterThan(0);
    expect(validarDistribuicao({ ...ok, produtoId: "pAut", etapaId: "eAutEtiq" }).length).toBeGreaterThan(0);
    expect(validarDistribuicao({ ...ok, distribuicao: [{ produtoId: "pConv", etapaId: "eConvEtiq", pecas: 150 }, { produtoId: "pConv", etapaId: "eConvEtiq", pecas: 150 }] }).length).toBeGreaterThan(0);
    expect(validarDistribuicao({ ...ok, distribuicao: [{ produtoId: "pConv", etapaId: "eConvEtiq", pecas: 300 }, { produtoId: "pAut", etapaId: "eAutEtiq", pecas: 0 }] }).length).toBeGreaterThan(0);
    expect(validarDistribuicao({ ...ok, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0 }).length).toBeGreaterThan(0);
  });
});

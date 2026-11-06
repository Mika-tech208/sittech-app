// O modelo montado a partir das tabelas REAIS do ensaio local (backfill sobre o cadastro de PROD, ids reais dos legados) respeita as regras do TS e traduz o histórico.
import { describe, expect, it } from "vitest";
import linhas from "./modelo-local.json";
import { lerModelosCanonicos, montarModelosCanonicos, type ClienteLeitura, type LinhasModeloDb } from "../modeloDb";
import { problemasDoModelo, resolverEtapa, resolverProduto, rotaDaMaquina } from "../mapeamento";
import { desdobrarCanonico } from "../adaptadorMotor";
import { AUTO, CONV, L, MAQ } from "./fixture";

const [modelo] = montarModelosCanonicos(linhas as unknown as LinhasModeloDb);

describe("modelo canônico montado das tabelas (backfill real do ensaio local)", () => {
  it("1 produto, 2 rotas, 5 etapas (1 FINAL), 4 arestas, 7 etapas legadas mapeadas; sem problemas", () => {
    expect(modelo.codigo).toBe("CONECTOR_3_4");
    expect(modelo.rotas.map((r) => r.tipo)).toEqual(["convencional", "automatica"]);
    expect(modelo.etapas.map((e) => e.papel).sort()).toEqual(["COMUM", "FINAL", "ROTA", "ROTA", "ROTA"]);
    expect(modelo.arestas).toHaveLength(4);
    expect(Object.keys(modelo.etapasLegado)).toHaveLength(7);
    expect(problemasDoModelo(modelo)).toEqual([]);
  });
  it("etapas legadas reais (ids de PROD) caem na etapa canônica certa; Etiquetar/Embalar das duas rotas convergem", () => {
    expect(resolverEtapa(modelo, L.eti).etapaId).toBe(resolverEtapa(modelo, L.etiA).etapaId);
    expect(resolverEtapa(modelo, L.emb)).toMatchObject({ papel: "FINAL" });
    expect(resolverEtapa(modelo, L.m8)).toMatchObject({ papel: "ROTA", entrada: "legado" });
    expect(resolverProduto(modelo, CONV).rotaId).not.toBe(resolverProduto(modelo, AUTO).rotaId);
  });
  it("a rota é conhecida pela máquina real (Parafusadeira 9 = convencional; Máquina 8 = automática; Etiquetadora 15 = comum)", () => {
    const r = (m: string) => modelo.rotas.find((x) => x.id === rotaDaMaquina(modelo, m)?.rotaId)?.tipo ?? null;
    expect(r(MAQ.p9)).toBe("convencional");
    expect(r(MAQ.m8)).toBe("automatica");
    expect(r(MAQ.et15)).toBeNull();
    expect(rotaDaMaquina(modelo, MAQ.et15)?.papel).toBe("COMUM");
    expect(rotaDaMaquina(modelo, MAQ.em17)?.papel).toBe("FINAL");
  });
  it("o adaptador do motor aceita o modelo real (trecho exclusivo linear, convergência única)", () => {
    const e = { slots: [], aPartirDe: 0, pools: [], funcionarios: [], ausencias: [], maquinasIndisponiveisPrevisao: [], indisponibilidades: [], congeladas: [] } as never;
    const d = desdobrarCanonico(e, modelo);
    expect("erro" in d && d.erro).toMatch(/ausente da entrada/); // chegou até a checagem de entrada: o modelo em si foi aceito
  });
});

describe("leitura tolerante", () => {
  it("tabela ausente / erro / exceção => nenhum modelo (flag desligada = comportamento anterior)", async () => {
    const erro: ClienteLeitura = { from: () => ({ select: async () => ({ data: null, error: { message: "relation does not exist" } }) }) };
    const lanca: ClienteLeitura = { from: () => { throw new Error("rede"); } };
    const vazio: ClienteLeitura = { from: () => ({ select: async () => ({ data: [], error: null }) }) };
    expect(await lerModelosCanonicos(erro)).toEqual([]);
    expect(await lerModelosCanonicos(lanca)).toEqual([]);
    expect(await lerModelosCanonicos(vazio)).toEqual([]);
  });
  it("lê e monta quando as tabelas respondem", async () => {
    const l = linhas as unknown as Record<string, unknown[]>;
    const mapa: Record<string, unknown[]> = { produto_canonico: l.canonico, produto_rotas: l.rotas, produto_canonico_etapas: l.etapas, produto_canonico_arestas: l.arestas, produto_legado_mapa: l.produtosLegado, etapa_legado_mapa: l.etapasLegado, roteiro_etapas: l.roteiroEtapas, roteiro_etapa_maquinas: l.maquinasEtapa };
    const cli: ClienteLeitura = { from: (t) => ({ select: async () => ({ data: mapa[t] ?? [], error: null }) }) };
    const [m] = await lerModelosCanonicos(cli);
    expect(m.produtoCanonicoId).toBe(modelo.produtoCanonicoId);
    expect(problemasDoModelo(m)).toEqual([]);
  });
});

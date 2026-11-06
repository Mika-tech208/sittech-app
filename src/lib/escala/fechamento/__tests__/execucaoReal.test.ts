import { describe, expect, it } from "vitest";
import { linhasIniciais } from "@/features/producao-real/apontamento-simplificado/prefill";
import { completude, paraRpc } from "@/features/producao-real/apontamento-simplificado/validacao";
import type { Catalogo, PlanejadoPosto, PostoRealInformado } from "@/features/producao-real/apontamento-simplificado/tipos";
import { montarEstadoPostos } from "../postosProgramados";
import { acaoApontamentosEstado } from "../httpApontamentos";
import type { ApontamentosIO } from "../apontamentoSimplificado";
import type { UsuarioFechamento } from "../http";

const FECHA: UsuarioFechamento = { id: "u1", papel: "usuario", permissoes: ["escala_fechamento"] };
const CAD = { m1: "Montagem 19", m2: "Etiquetadora 16", m3: "Parafusadeira 12", m4: "Embalagem 17" };
const nomes = (o: Record<string, string>) => Object.entries(o).map(([id, nome]) => ({ id, nome, ativo: true }));
// PLANO ORIGINAL do período: Montagem 19 (Ana, 4x2), Embalagem 17 (Bia, Conector) — o que o sistema planejou
const bruto = () => ({
  alocacoes: [
    { maquina_id: "m1", funcionario_id: "ana", produto_id: "p42", etapa_id: "e1", operacao_id: "oMP", pecas: 400, pecas_adicional: 0 },
    { maquina_id: "m4", funcionario_id: "bia", produto_id: "pC", etapa_id: "e4", operacao_id: "oEmb", pecas: 3000, pecas_adicional: 0 },
  ],
  maquinas: nomes(CAD), funcionarios: nomes({ ana: "Ana", bia: "Bia", carol: "Carol", sam: "Samantha" }), produtos: nomes({ p42: "Caixa 4x2", p44: "Caixa 4x4", pC: "Conector 3/4", pP: "Pino" }),
  operacoes: [{ id: "oMP", nome: "Montar Presilha" }, { id: "oEt", nome: "Etiquetar" }, { id: "oEmb", nome: "Embalar" }, { id: "oPar", nome: "Parafusar" }],
  etapas: [{ id: "e1", produto_id: "p42", operacao_id: "oMP" }, { id: "e4", produto_id: "pC", operacao_id: "oEmb" }, { id: "e5", produto_id: "p44", operacao_id: "oMP" }, { id: "e6", produto_id: "p44", operacao_id: "oEt" }, { id: "e7", produto_id: "pC", operacao_id: "oPar" }],
  etapaMaquinas: [{ etapa_id: "e1", maquina_id: "m1" }, { etapa_id: "e4", maquina_id: "m4" }, { etapa_id: "e5", maquina_id: "m1" }, { etapa_id: "e6", maquina_id: "m2" }, { etapa_id: "e7", maquina_id: "m3" }],
  apontamentos: [],
});
// EXECUÇÃO REAL: Montagem 19 (mesma máquina do plano, outro operador e produto), Etiquetadora 16 e Parafusadeira 12 (fora do plano)
const REAL = [
  { maquina_id: "m1", funcionario_id: "sam", produto_id: "p44", etapa_id: null, operacao_id: null },
  { maquina_id: "m2", funcionario_id: "carol", produto_id: "p44", etapa_id: null, operacao_id: null },
  { maquina_id: "m3", funcionario_id: "ana", produto_id: "pC", etapa_id: null, operacao_id: null },
];

describe("execução real do período (regularização operacional do período atual)", () => {
  it("montarEstadoPostos: o plano original NÃO é alterado e a execução real traz nomes e operação derivada de máquina+produto", () => {
    const sem = montarEstadoPostos(bruto());
    const com = montarEstadoPostos({ ...bruto(), execucaoReal: REAL });
    expect(com.postos).toEqual(sem.postos);                                   // plano original intacto (2 postos, os mesmos)
    expect(com.postos.map((p) => p.maquinaNome)).toEqual(["Embalagem 17", "Montagem 19"]);
    expect(sem.execucaoReal).toBeUndefined();                                  // sem execução real = comportamento de hoje
    expect(com.execucaoReal?.map((r) => `${r.maquinaNome}|${r.funcionarioNome}|${r.produtoNome}|${r.operacaoNome}`)).toEqual([
      "Etiquetadora 16|Carol|Caixa 4x4|Etiquetar", "Montagem 19|Samantha|Caixa 4x4|Montar Presilha", "Parafusadeira 12|Ana|Conector 3/4|Parafusar"]);
  });

  it("linhas do tablet: máquina que estava no plano = PROGRAMADO com o planejado preservado; sem plano = POSTO_NAO_PLANEJADO; todas pré-preenchidas e EXIGIDAS; plano-só (Embalagem 17) não vira linha", () => {
    const est = montarEstadoPostos({ ...bruto(), execucaoReal: REAL });
    let n = 0;
    const linhas = linhasIniciais(est.postos, est.existentes, [], () => `k${++n}`, est.execucaoReal);
    expect(linhas).toHaveLength(3);
    const porMaq = Object.fromEntries(linhas.map((l) => [l.real.maquinaId, l]));
    expect(porMaq.m1.origem).toBe("PROGRAMADO");
    expect(porMaq.m1.planejado).toMatchObject({ maquinaNome: "Montagem 19", funcionarioNome: "Ana", produtoNome: "Caixa 4x2" });   // o que o sistema planejou
    expect(porMaq.m1.real).toEqual({ maquinaId: "m1", funcionarioId: "sam", produtoId: "p44" });                                         // o que realmente aconteceu
    expect(porMaq.m2.origem).toBe("POSTO_NAO_PLANEJADO");
    expect(porMaq.m3.origem).toBe("POSTO_NAO_PLANEJADO");
    expect(linhas.every((l) => l.exigida === true && l.produzido === null)).toBe(true);
    expect(linhas.some((l) => l.real.maquinaId === "m4")).toBe(false);          // Embalagem 17 (só no plano) não é exigida
    // pendências: as 3 (inclusive as fora do plano) precisam de produzido; sem refugo = 0
    const cat = est.catalogo as Catalogo;
    expect(completude(linhas, cat).pendentes).toHaveLength(3);
    const prontas = linhas.map((l) => ({ ...l, produzido: 100, refugo: null }));
    expect(completude(prontas, cat).completo).toBe(true);
    const rpc = paraRpc(prontas, cat);
    expect(rpc.map((r) => [r.maquina_id, r.maquina_planejada_id, r.produzido, r.refugo])).toEqual([["m2", null, 100, 0], ["m1", "m1", 100, 0], ["m3", null, 100, 0]]);
  });

  it("sem execução real as linhas são EXATAMENTE as de hoje (só os postos do plano)", () => {
    const est = montarEstadoPostos(bruto());
    let n = 0;
    const a = linhasIniciais(est.postos, est.existentes, [], () => `k${++n}`);
    n = 0;
    const b = linhasIniciais(est.postos, est.existentes, [], () => `k${++n}`, undefined);
    expect(a).toEqual(b);
    expect(a.map((l) => l.real.maquinaId)).toEqual(["m4", "m1"]);
    expect(a.every((l) => l.exigida === undefined)).toBe(true);
  });
});

function fakeIO(o: { liberado: boolean; temReal: boolean }): { io: ApontamentosIO; chamadas: string[] } {
  const chamadas: string[] = [];
  const posto = {} as PlanejadoPosto, real = {} as PostoRealInformado;
  const io: ApontamentosIO = {
    modo: async () => "ativo", liberado: async () => o.liberado,
    temExecucaoReal: async () => { chamadas.push("temExecucaoReal"); return o.temReal; },
    carregar: async () => { chamadas.push("carregar"); return { postos: [posto], catalogo: { maquinas: [], funcionarios: [], produtos: [], operacoes: {}, elegibilidade: [] }, existentes: [], vinculos: [], execucaoReal: [real] }; },
    salvar: async () => ({ substituidas: 0, linhas: [] }),
  };
  return { io, chamadas };
}
describe("API dos apontamentos do fechamento: liberação intacta, exceção SÓ com execução real registrada", () => {
  it("período NÃO liberado SEM execução real ⇒ fail-closed como sempre (programação não entregue, nada carregado)", async () => {
    const { io, chamadas } = fakeIO({ liberado: false, temReal: false });
    expect(await acaoApontamentosEstado(io, FECHA, "2026-11-06", "m3")).toEqual({ status: 200, corpo: { modo: "ativo", naoLiberado: true, postos: [] } });
    expect(chamadas).toEqual(["temExecucaoReal"]);
  });
  it("período NÃO liberado COM execução real ⇒ entrega o estado (plano original + execução real) para o fechamento deste período", async () => {
    const { io, chamadas } = fakeIO({ liberado: false, temReal: true });
    const r = await acaoApontamentosEstado(io, FECHA, "2026-11-06", "m3");
    expect(r.status).toBe(200);
    expect((r.corpo as { naoLiberado?: boolean }).naoLiberado).toBeUndefined();
    expect((r.corpo as { execucaoReal?: unknown[] }).execucaoReal).toHaveLength(1);
    expect(chamadas).toEqual(["temExecucaoReal", "carregar"]);
  });
  it("período liberado ⇒ caminho de sempre (não consulta execução real)", async () => {
    const { io, chamadas } = fakeIO({ liberado: true, temReal: true });
    await acaoApontamentosEstado(io, FECHA, "2026-11-06", "m3");
    expect(chamadas).toEqual(["carregar"]);
  });
});

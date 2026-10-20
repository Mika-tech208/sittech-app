// REPRODUTIBILIDADE E REVERSIBILIDADE com o adicional por etapa (WIP) LIGADO.
// Mesmas regras de reprodutibilidade.test.ts: mesmas entradas oficiais => mesma escala futura, por qualquer caminho.
// Aqui as entradas incluem o parâmetro wip_modo, o adicional POR ETAPA e a Previsão da semana seguinte.
import { describe, it, expect } from "vitest";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { Mundo, estadoDeTeste, type AlocacaoComOrigem } from "./bancoMemoria";
import type { EstadoBruto } from "../estado";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const ANTES = epochMsNoFuso("2026-10-30", "10:00");
const GERA = epochMsNoFuso(SEMANA, "05:00");
const MEIO = epochMsNoFuso("2026-11-03", "09:30");

const sig = (linhas: AlocacaoComOrigem[]) =>
  JSON.stringify(linhas.map((a) => [a.data, a.periodoId, a.funcionarioId, a.maquinaId, a.produtoId, a.etapaId, a.pecas, a.pecasAdicional ?? 0, a.tipoAdicional ?? null, a.motivoSemPosto, a.excecaoRevezamento]));

// equipe grande para a carga do teste => sobra gente => há adicional/WIP a distribuir
const NOVO = (pessoas = 14): EstadoBruto => {
  const e = estadoDeTeste(SEMANA, DIAS, { pessoas });
  e.itens[0].quantidade = 3000;
  e.itens[1].quantidade = 2500;
  return e;
};
const ADIC = { eA1: 3000, eA2: 1500, eB1: 2000, eB2: 1000 };
const ligarWip = (e: EstadoBruto, adicional = true) => {
  e.parametros = { wipModo: "ativo", wipDiasLimite: 1 };
  if (adicional) {
    e.itens[0].adicionalPorEtapa = { eA1: ADIC.eA1, eA2: ADIC.eA2 };
    e.itens[1].adicionalPorEtapa = { eB1: ADIC.eB1, eB2: ADIC.eB2 };
  }
};
const adicionalPorEtapa = (linhas: AlocacaoComOrigem[]) => {
  const r: Record<string, number> = {};
  linhas.forEach((a) => { if ((a.pecasAdicional ?? 0) > 0) r[a.etapaId as string] = (r[a.etapaId as string] ?? 0) + (a.pecasAdicional as number); });
  return r;
};

[
  { nome: "semana inteira no futuro", geradoEm: ANTES, agora: ANTES },
  { nome: "semana em andamento (passado congelado)", geradoEm: GERA, agora: MEIO },
].forEach(({ nome, geradoEm, agora }) => {
  describe(`WIP ligado — reversibilidade — ${nome}`, () => {
    async function baseline(wip = true) {
      const e = NOVO();
      if (wip) ligarWip(e);
      const m = new Mundo(e);
      await m.recalcular(geradoEm, true);
      if (agora !== geradoEm) await m.recalcular(agora);
      return { m, A: sig(m.futuras(agora)) };
    }

    it("o cenário realmente produz adicional por etapa (senão os testes abaixo não provam nada)", async () => {
      const { m } = await baseline();
      const futuras = m.futuras(agora);
      expect(futuras.some((a) => (a.pecasAdicional ?? 0) > 0)).toBe(true);
      expect(futuras.filter((a) => (a.pecasAdicional ?? 0) > 0).every((a) => a.tipoAdicional === "acabado" || a.tipoAdicional === "intermediario")).toBe(true);
    });

    it("reprodutível: recalcular várias vezes sem mudar nada devolve a mesma escala", async () => {
      const { m, A } = await baseline();
      for (let i = 0; i < 3; i++) {
        await m.recalcular(agora);
        expect(sig(m.futuras(agora))).toBe(A);
      }
    });

    it("adicional por etapa zerado e restaurado => volta exatamente ao plano A", async () => {
      const { m, A } = await baseline();
      m.editar((e) => { e.itens[0].adicionalPorEtapa = { eA1: 0, eA2: 0 }; e.itens[1].adicionalPorEtapa = { eB1: 0, eB2: 0 }; });
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).not.toBe(A);
      m.editar((e) => { e.itens[0].adicionalPorEtapa = { eA1: ADIC.eA1, eA2: ADIC.eA2 }; e.itens[1].adicionalPorEtapa = { eB1: ADIC.eB1, eB2: ADIC.eB2 }; });
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("modo WIP desligado e religado => volta ao plano A (parâmetro reversível)", async () => {
      const { m, A } = await baseline();
      m.editar((e) => (e.parametros = { wipModo: "desligado", wipDiasLimite: 1 }));
      await m.recalcular(agora);
      m.editar((e) => (e.parametros = { wipModo: "ativo", wipDiasLimite: 1 }));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("limite de estoque alterado e restaurado => volta ao plano A", async () => {
      const { m, A } = await baseline();
      m.editar((e) => (e.parametros = { wipModo: "ativo", wipDiasLimite: 3 }));
      await m.recalcular(agora);
      m.editar((e) => (e.parametros = { wipModo: "ativo", wipDiasLimite: 1 }));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("Previsão da semana seguinte criada e removida => volta ao plano A", async () => {
      const { m, A } = await baseline();
      m.editar((e) => (e.proximaSemana = { quantidadePorProduto: { pA: 2000, pB: 0 } }));
      await m.recalcular(agora);
      m.editar((e) => (e.proximaSemana = undefined));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("ausência criada e removida => volta ao plano A", async () => {
      const { m, A } = await baseline();
      m.editar((e) => e.ausencias.push({ funcionarioId: "f03", data: "2026-11-05", horarioInicio: null, horarioFim: null }));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).not.toBe(A);
      m.editar((e) => (e.ausencias = []));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("máquina bloqueada e liberada => volta ao plano A de referência", async () => {
      const { m } = await baseline();
      m.editar((e) => e.indisponibilidades.push({ maquinaId: "m2", desde: new Date(agora).toISOString(), liberadaEm: null }));
      await m.recalcular(agora);
      m.editar((e) => (e.indisponibilidades = [{ maquinaId: "m2", desde: new Date(agora).toISOString(), liberadaEm: new Date(agora + 60_000).toISOString() }]));
      await m.recalcular(agora + 60_000);
      const ref = await (async () => {
        const e = NOVO(); ligarWip(e);
        const r = new Mundo(e);
        await r.recalcular(geradoEm, true);
        if (agora !== geradoEm) await r.recalcular(agora + 60_000);
        return sig(r.futuras(agora + 60_000));
      })();
      expect(sig(m.futuras(agora + 60_000))).toBe(ref);
    });

    it("dois caminhos diferentes até o MESMO estado canônico => mesma escala", async () => {
      const aus = { funcionarioId: "f08", data: "2026-11-05", horarioInicio: null, horarioFim: null };
      const s1 = await baseline();
      s1.m.editar((e) => e.ausencias.push(aus));
      await s1.m.recalcular(agora);
      s1.m.editar((e) => (e.itens[0].adicionalPorEtapa = { eA1: 500, eA2: 100 }));
      await s1.m.recalcular(agora);
      s1.m.editar((e) => (e.parametros = { wipModo: "desligado", wipDiasLimite: 1 }));
      await s1.m.recalcular(agora);
      s1.m.editar((e) => { e.parametros = { wipModo: "ativo", wipDiasLimite: 1 }; e.itens[0].adicionalPorEtapa = { eA1: ADIC.eA1, eA2: ADIC.eA2 }; });
      await s1.m.recalcular(agora);

      const s2 = await baseline();
      s2.m.editar((e) => e.ausencias.push(aus));
      await s2.m.recalcular(agora);
      expect(sig(s1.m.futuras(agora))).toBe(sig(s2.m.futuras(agora)));
    });

    it("troca manual no futuro é preservada e carrega o tipo de adicional junto com a linha", async () => {
      const { m } = await baseline();
      const futuras = m.futuras(agora);
      const comAdic = futuras.find((a) => (a.pecasAdicional ?? 0) > 0)!;
      const semAdic = futuras.find((a) => a.data === comAdic.data && a.periodoId === comAdic.periodoId && a.maquinaId && !((a.pecasAdicional ?? 0) > 0))!;
      const tipo = comAdic.tipoAdicional;
      const tipoSem = semAdic.tipoAdicional ?? null; // as linhas são os próprios objetos do banco: capturar ANTES da troca
      m.trocarManual(comAdic.data, comAdic.periodoId, comAdic.funcionarioId, semAdic.funcionarioId);
      const trocada = m.alocacoes.find((a) => a.data === comAdic.data && a.periodoId === comAdic.periodoId && a.funcionarioId === semAdic.funcionarioId)!;
      expect(trocada.tipoAdicional).toBe(tipo);
      expect(m.alocacoes.find((a) => a.data === comAdic.data && a.periodoId === comAdic.periodoId && a.funcionarioId === comAdic.funcionarioId)!.tipoAdicional ?? null).toBe(tipoSem);
    });
  });
});

describe("WIP ligado — invariantes de comportamento", () => {
  const agora = ANTES;
  async function gerar(mut?: (e: EstadoBruto) => void) {
    const e = NOVO();
    mut?.(e);
    const m = new Mundo(e);
    await m.recalcular(agora, true);
    return m.futuras(agora);
  }
  const postosPrevisto = (linhas: AlocacaoComOrigem[]) =>
    linhas.filter((a) => a.maquinaId && !((a.pecasAdicional ?? 0) > 0)).map((a) => `${a.data}|${a.periodoId}|${a.maquinaId}|${a.produtoId}|${a.etapaId}|${a.pecas}`).sort();

  it("adicional ZERO com WIP ligado é idêntico ao modo desligado (compatibilidade)", async () => {
    const off = await gerar();
    const on = await gerar((e) => ligarWip(e, false));
    expect(sig(on)).toBe(sig(off));
  });

  it("o PREVISTO (postos, máquinas, peças) é o mesmo com e sem adicional/WIP", async () => {
    const sem = await gerar((e) => ligarWip(e, false));
    const com = await gerar((e) => ligarWip(e, true));
    expect(com.some((a) => (a.pecasAdicional ?? 0) > 0)).toBe(true);
    expect(postosPrevisto(com)).toEqual(postosPrevisto(sem));
  });

  it("nenhuma etapa processa adicional acima do que programado; a seguinte nunca acima da anterior (acumulado)", async () => {
    const com = await gerar((e) => ligarWip(e, true));
    const A = adicionalPorEtapa(com);
    Object.entries(A).forEach(([etapa, v]) => expect(v).toBeLessThanOrEqual((ADIC as Record<string, number>)[etapa] + 1e-6));
    expect(A.eA2 ?? 0).toBeLessThanOrEqual((A.eA1 ?? 0) + 1e-6);
    expect(A.eB2 ?? 0).toBeLessThanOrEqual((A.eB1 ?? 0) + 1e-6);
  });

  it("estoque entre etapas respeita o limite (regra B: wip_dias_limite × capacidade de 1 dia da etapa seguinte)", async () => {
    const com = await gerar((e) => ligarWip(e, true));
    const A = adicionalPorEtapa(com);
    // etapa seguinte eA2 usa m5 (1 máquina): um dia = soma das metas dos 6 períodos
    const umDiaA2 = 90 + 100 + 90 + 100 + 90 + 100;
    expect((A.eA1 ?? 0) - (A.eA2 ?? 0)).toBeLessThanOrEqual(umDiaA2 + 1e-6);
  });

  it("tipo_adicional: última etapa = acabado; as demais = intermediário", async () => {
    const com = await gerar((e) => ligarWip(e, true));
    const ultimas = new Set(["eA2", "eB2"]);
    com.filter((a) => (a.pecasAdicional ?? 0) > 0).forEach((a) => expect(a.tipoAdicional).toBe(ultimas.has(a.etapaId as string) ? "acabado" : "intermediario"));
  });
});

// REPRODUTIBILIDADE DO RECÁLCULO
//
// Regra operacional: para os períodos AINDA NÃO INICIADOS,
//     mesmas entradas oficiais + mesmo histórico congelado  =>  mesma escala futura,
// seja qual for o CAMINHO de eventos que levou a essas entradas (ausência criada e removida,
// recurso bloqueado e liberado, equipe alterada e restaurada, adicional ligado e zerado…).
// A escala futura anterior (saída derivada) nunca é entrada do recálculo; só passam adiante
// o passado congelado e as trocas manuais (decisão explícita de uma pessoa).
import { describe, it, expect } from "vitest";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { Mundo, estadoDeTeste, type AlocacaoComOrigem } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const ANTES = epochMsNoFuso("2026-10-30", "10:00"); // semana inteira no futuro
const GERA = epochMsNoFuso(SEMANA, "05:00");
const MEIO = epochMsNoFuso("2026-11-03", "09:30"); // terça M2 em andamento: M1/M2 de seg e terça M1 congelados

const sig = (linhas: AlocacaoComOrigem[]) => Mundo.assinatura(linhas);

async function mundoGerado(agoraDaBase: number): Promise<{ m: Mundo; base: string }> {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
  await m.recalcular(agoraDaBase, true);
  return { m, base: sig(m.futuras(agoraDaBase)) };
}

// Dois pontos no tempo: semana inteira futura e semana em andamento (passado congelado).
const CENARIOS: { nome: string; geradoEm: number; agora: number }[] = [
  { nome: "semana inteira no futuro", geradoEm: ANTES, agora: ANTES },
  { nome: "semana em andamento (passado congelado)", geradoEm: GERA, agora: MEIO },
];

CENARIOS.forEach(({ nome, geradoEm, agora }) => {
  describe(`reversibilidade — ${nome}`, () => {
    async function baseline() {
      const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
      await m.recalcular(geradoEm, true);
      if (agora !== geradoEm) await m.recalcular(agora); // A = plano já recalculado no instante dos testes
      return { m, A: sig(m.futuras(agora)) };
    }

    it("ausência futura criada e removida => volta exatamente ao plano A", async () => {
      const { m, A } = await baseline();
      m.editar((e) => e.ausencias.push({ funcionarioId: "f03", data: "2026-11-05", horarioInicio: null, horarioFim: null }));
      await m.recalcular(agora);
      const B = sig(m.futuras(agora));
      expect(B).not.toBe(A); // a ausência realmente muda o plano
      m.editar((e) => (e.ausencias = []));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("ausência parcial (janela de horário) criada e removida => volta ao plano A", async () => {
      const { m, A } = await baseline();
      m.editar((e) => e.ausencias.push({ funcionarioId: "f07", data: "2026-11-04", horarioInicio: "13:00:00", horarioFim: "15:40:00" }));
      await m.recalcular(agora);
      m.editar((e) => (e.ausencias = []));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("recurso bloqueado, recalculado e liberado antes dos períodos => volta ao plano A", async () => {
      const { m, A } = await baseline();
      m.editar((e) => e.indisponibilidades.push({ maquinaId: "m2", desde: new Date(agora).toISOString(), liberadaEm: null }));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).not.toBe(A);
      m.editar((e) => (e.indisponibilidades = [{ maquinaId: "m2", desde: new Date(agora).toISOString(), liberadaEm: new Date(agora + 60_000).toISOString() }]));
      await m.recalcular(agora + 60_000);
      expect(sig(m.futuras(agora + 60_000))).toBe(sig(m.futuras(agora + 60_000))); // sanidade
      // o plano de referência no instante de liberação é o A calculado naquele instante
      const ref = await baseline();
      expect(sig(m.futuras(agora))).toBe(ref.A);
    });

    it("equipe alterada (sai uma pessoa) e restaurada => volta ao plano A", async () => {
      const { m, A } = await baseline();
      const original = m.entradas.equipeProdutiva;
      m.editar((e) => (e.equipeProdutiva = e.equipeProdutiva.filter((p) => p.funcionarioId !== "f05")));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).not.toBe(A);
      m.editar((e) => (e.equipeProdutiva = original));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("carga adicional ligada e voltada a 0 => volta ao plano A", async () => {
      const { m, A } = await baseline();
      m.editar((e) => (e.itens[0].quantidadeAdicional = 4000));
      await m.recalcular(agora);
      m.editar((e) => (e.itens[0].quantidadeAdicional = 0));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("Previsão alterada (quantidade e máquinas) e desfeita => volta ao plano A", async () => {
      const { m, A } = await baseline();
      m.editar((e) => {
        e.itens[1].quantidade = 7000;
        e.itens[2].maquinasPorEtapa = { eC1: ["m4"] };
      });
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).not.toBe(A);
      m.editar((e) => {
        e.itens[1].quantidade = 4300;
        e.itens[2].maquinasPorEtapa = { eC1: ["m4", "m7"] };
      });
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("dia produtivo retirado e devolvido => os dias futuros voltam ao plano A", async () => {
      const { m, A } = await baseline();
      m.editar((e) => (e.diasProdutivos = DIAS.filter((d) => d !== "2026-11-05")));
      await m.recalcular(agora);
      m.editar((e) => (e.diasProdutivos = DIAS));
      await m.recalcular(agora);
      expect(sig(m.futuras(agora))).toBe(A);
    });

    it("recálculo sem nenhuma mudança é idempotente (aplicado várias vezes)", async () => {
      const { m, A } = await baseline();
      for (let i = 0; i < 3; i++) {
        await m.recalcular(agora);
        expect(sig(m.futuras(agora))).toBe(A);
      }
    });

    it("duas sequências de eventos diferentes que terminam no MESMO estado canônico => mesma escala", async () => {
      const ausY = { funcionarioId: "f08", data: "2026-11-05", horarioInicio: null, horarioFim: null };
      const ausX = { funcionarioId: "f02", data: "2026-11-04", horarioInicio: null, horarioFim: null };
      const bloqueio = (liberada: boolean) => ({ maquinaId: "m3", desde: new Date(agora).toISOString(), liberadaEm: liberada ? new Date(agora + 30_000).toISOString() : null });

      // sequência 1: caminho longo e tortuoso
      const s1 = await baseline();
      s1.m.editar((e) => e.ausencias.push(ausX));
      await s1.m.recalcular(agora);
      s1.m.editar((e) => e.ausencias.push(ausY));
      await s1.m.recalcular(agora);
      s1.m.editar((e) => e.indisponibilidades.push(bloqueio(false)));
      await s1.m.recalcular(agora);
      s1.m.editar((e) => (e.itens[0].quantidadeAdicional = 2500));
      await s1.m.recalcular(agora);
      s1.m.editar((e) => (e.ausencias = e.ausencias.filter((a) => a !== ausX)));
      await s1.m.recalcular(agora);
      s1.m.editar((e) => (e.indisponibilidades = [bloqueio(true)]));
      await s1.m.recalcular(agora + 30_000);
      s1.m.editar((e) => (e.itens[0].quantidadeAdicional = 0));
      await s1.m.recalcular(agora + 30_000);

      // sequência 2: caminho curto até o MESMO estado canônico (só a ausência Y)
      const s2 = await baseline();
      s2.m.editar((e) => e.ausencias.push(ausY));
      await s2.m.recalcular(agora + 30_000);

      // sequência 3: do zero, já com o estado final
      const s3 = new Mundo(estadoDeTeste(SEMANA, DIAS));
      s3.editar((e) => e.ausencias.push(ausY));
      await s3.recalcular(geradoEm, true);
      if (agora !== geradoEm) await s3.recalcular(agora + 30_000);

      const t = agora + 30_000;
      expect(sig(s1.m.futuras(t))).toBe(sig(s2.m.futuras(t)));
      if (agora === geradoEm) expect(sig(s2.m.futuras(t))).toBe(sig(s3.futuras(t))); // do zero == pelo caminho incremental
    });
  });
});

describe("independência de sequência — propriedade com eventos aleatórios", () => {
  it("20 sequências aleatórias de eventos, desfeitas em ordem diferente, sempre voltam ao plano base", async () => {
    let seed = 20261020;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const falhas: string[] = [];
    for (let rodada = 0; rodada < 20; rodada++) {
      const m = new Mundo(estadoDeTeste(SEMANA, DIAS, { pessoas: 8 + Math.floor(rnd() * 6) }));
      await m.recalcular(ANTES, true);
      const A = sig(m.futuras(ANTES));
      const desfazer: (() => void)[] = [];
      const original = m.entradas.itens.map((it) => ({ q: it.quantidade, ad: it.quantidadeAdicional ?? 0 }));
      const eventos = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < eventos; k++) {
        const tipo = Math.floor(rnd() * 4);
        if (tipo === 0) {
          const a = { funcionarioId: `f${String(1 + Math.floor(rnd() * 8)).padStart(2, "0")}`, data: DIAS[Math.floor(rnd() * 5)], horarioInicio: null, horarioFim: null };
          m.editar((e) => e.ausencias.push(a));
          desfazer.push(() => m.editar((e) => (e.ausencias = e.ausencias.filter((x) => x !== a))));
        } else if (tipo === 1) {
          const ind = { maquinaId: `m${1 + Math.floor(rnd() * 8)}`, desde: new Date(ANTES).toISOString(), liberadaEm: null as string | null };
          m.editar((e) => e.indisponibilidades.push(ind));
          desfazer.push(() => m.editar((e) => (e.indisponibilidades = e.indisponibilidades.filter((x) => x !== ind))));
        } else if (tipo === 2) {
          const i = Math.floor(rnd() * 4);
          m.editar((e) => (e.itens[i].quantidadeAdicional = Math.round(rnd() * 3000)));
          desfazer.push(() => m.editar((e) => (e.itens[i].quantidadeAdicional = original[i].ad)));
        } else {
          const i = Math.floor(rnd() * 4);
          m.editar((e) => (e.itens[i].quantidade = Math.round((original[i].q * (0.5 + rnd())) / 50) * 50));
          desfazer.push(() => m.editar((e) => (e.itens[i].quantidade = original[i].q)));
        }
        await m.recalcular(ANTES);
      }
      // desfaz em ordem EMBARALHADA, recalculando entre os passos
      while (desfazer.length) {
        const [f] = desfazer.splice(Math.floor(rnd() * desfazer.length), 1);
        f();
        await m.recalcular(ANTES);
      }
      if (sig(m.futuras(ANTES)) !== A) falhas.push(`rodada ${rodada}`);
    }
    expect(falhas).toEqual([]);
  });
});

describe("trocas manuais (decisão explícita de uma pessoa)", () => {
  // Contrato atual: a troca manual é uma PREFERÊNCIA SUAVE (custo de mudança) — não um posto fixo.
  // O motor a mantém quando nada mais forte (rotação, equidade, ociosidade) a contraria; quando a
  // mantém, a linha continua marcada "manual"; quando não, volta a ser "auto". Nunca fica uma marca
  // "manual" em linha que o motor mudou, nem uma troca "fantasma" vinda de um plano automático antigo.
  async function comTroca(dia: string, periodo: string) {
    const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
    await m.recalcular(ANTES, true);
    const linhas = m.futuras(ANTES).filter((l) => l.data === dia && l.periodoId === periodo);
    const a = linhas.find((l) => l.maquinaId)!;
    const b = linhas.find((l) => l.maquinaId && l.maquinaId !== a.maquinaId && l.operacaoId !== a.operacaoId) ?? linhas.find((l) => !l.maquinaId)!;
    m.trocarManual(dia, periodo, a.funcionarioId, b.funcionarioId);
    return { m, a: a.funcionarioId, b: b.funcionarioId };
  }

  it("a marca 'manual' só existe onde o motor realmente manteve a troca", async () => {
    const { m, a, b } = await comTroca("2026-11-05", "t1");
    const antesA = m.alocacoes.find((x) => x.data === "2026-11-05" && x.periodoId === "t1" && x.funcionarioId === a)!.maquinaId;
    const antesB = m.alocacoes.find((x) => x.data === "2026-11-05" && x.periodoId === "t1" && x.funcionarioId === b)!.maquinaId;
    m.editar((e) => e.ausencias.push({ funcionarioId: "f09", data: "2026-11-03", horarioInicio: null, horarioFim: null }));
    await m.recalcular(ANTES);
    m.alocacoes.forEach((x) => {
      if (x.origem === "manual") {
        const manteve = (x.funcionarioId === a && x.maquinaId === antesA) || (x.funcionarioId === b && x.maquinaId === antesB);
        expect(manteve).toBe(true);
      }
    });
  });

  it("com uma troca manual no estado, ausência criada e removida continua voltando ao mesmo plano", async () => {
    const { m } = await comTroca("2026-11-05", "t1");
    await m.recalcular(ANTES); // a troca é avaliada uma vez: A' = plano estável com a decisão manual
    const A = sig(m.futuras(ANTES));
    m.editar((e) => e.ausencias.push({ funcionarioId: "f09", data: "2026-11-03", horarioInicio: null, horarioFim: null }));
    await m.recalcular(ANTES);
    m.editar((e) => (e.ausencias = []));
    await m.recalcular(ANTES);
    expect(sig(m.futuras(ANTES))).toBe(A);
  });
});

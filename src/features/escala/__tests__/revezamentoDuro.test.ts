// FASE 4a — REVEZAMENTO DURO: a mesma pessoa nunca executa a mesma operacao_id em períodos consecutivos (qualquer máquina/produto/posto;
// M3→T1 conta; o dia seguinte zera). Restrição do otimizador: solução que repete é eliminada; sem solução válida => posto vazio + alerta.
import { describe, it, expect } from "vitest";
import { analisarCobertura, CAUSAS } from "../cobertura";
import { gerarEscala } from "../gerarEscala";
import { MENSAGEM_TROCA_BLOQUEADA, repeticoesDaPessoa, validarTroca, type LinhaRotacao } from "../rotacao";
import { MOTIVO_REVEZAMENTO, type AlocacaoEscala, type EntradaEscala, type PoolEscala } from "../types";
import { checarInvariantes, entrada, equipe, pool, IDS_PERIODOS } from "./helpers";
import { cenarioAleatorio, comWip } from "./adicionalWipHelpers";
import fixture from "../__fixtures__/semanas_reais.json";

const D1 = "2026-10-19";
const D2 = "2026-10-20";
const duro = (e: EntradaEscala): EntradaEscala => ({ ...e, revezamentoDuro: true });

// verificador INDEPENDENTE do motor: repetições reais de operação em períodos consecutivos (qualquer máquina/produto), por pessoa e dia
function repeticoes(e: EntradaEscala, rows: AlocacaoEscala[]): number {
  const idx = new Map(e.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const porPessoaDia = new Map<string, AlocacaoEscala[]>();
  rows.forEach((a) => porPessoaDia.set(`${a.data}|${a.funcionarioId}`, [...(porPessoaDia.get(`${a.data}|${a.funcionarioId}`) ?? []), a]));
  let n = 0;
  porPessoaDia.forEach((l) => {
    l.sort((x, y) => (idx.get(`${x.data}|${x.periodoId}`) as number) - (idx.get(`${y.data}|${y.periodoId}`) as number));
    for (let i = 1; i < l.length; i++) {
      const consecutivo = (idx.get(`${l[i].data}|${l[i].periodoId}`) as number) - (idx.get(`${l[i - 1].data}|${l[i - 1].periodoId}`) as number) === 1;
      if (consecutivo && l[i].maquinaId && l[i - 1].maquinaId && l[i].operacaoId === l[i - 1].operacaoId) n++;
    }
  });
  return n;
}
const comPosto = (rows: AlocacaoEscala[]) => rows.filter((a) => a.maquinaId).length;

describe("revezamento duro — semanas reais SEM regressão quando já existe solução sem repetição", () => {
  const semanas = fixture.semanas as { semanaInicio: string; pools: PoolEscala[] }[];
  const DIAS = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
  semanas.forEach((s) => {
    [14, 16, 18].forEach((n) => {
      it(`${s.semanaInicio} com ${n} funcionários: plano idêntico ao atual quando o atual não repete; nunca repete`, () => {
        const e = entrada({ pools: s.pools, funcionarios: equipe(n) }, DIAS);
        const atual = gerarEscala(e);
        const novo = gerarEscala(duro(e));
        expect(repeticoes(e, novo.alocacoes)).toBe(0);
        expect(novo.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
        expect(checarInvariantes(duro(e), novo)).toEqual([]);
        if (repeticoes(e, atual.alocacoes) === 0 && !atual.alocacoes.some((a) => a.excecaoRevezamento)) {
          expect(JSON.stringify(novo.alocacoes)).toBe(JSON.stringify(atual.alocacoes)); // SEM regressão
          expect(novo.alertas.some((a) => a.tipo === "rotacao_sem_solucao")).toBe(false);
        }
      });
    });
  });
});

describe("revezamento duro — propriedade em cenários aleatórios (previsto e adicional/WIP)", () => {
  it("120 cenários: nunca repete; nenhuma exceção; invariantes do motor continuam valendo", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const { base, com } = cenarioAleatorio(seed);
      for (const e of [duro(base), duro(com)]) {
        const r = gerarEscala(e);
        expect(repeticoes(e, r.alocacoes)).toBe(0);
        expect(r.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
        expect(checarInvariantes(e, r)).toEqual([]);
      }
    }
  });
  it("a camada de adicional/WIP também obedece (WIP ligado, equipe grande)", () => {
    const base = entrada({ funcionarios: equipe(8), pools: [pool({ produto: "A", op: "opX", q: 400, maquinas: ["m1", "m2"], mu: 100 }), pool({ produto: "B", op: "opY", q: 300, maquinas: ["m3"], mu: 100 })] }, [D1, D2]);
    const e = duro(comWip(base));
    const r = gerarEscala(e);
    expect(r.alocacoes.some((a) => (a.pecasAdicional ?? 0) > 0)).toBe(true); // há adicional de fato
    expect(repeticoes(e, r.alocacoes)).toBe(0);
  });
});

describe("revezamento duro — casos específicos", () => {
  it("outra MÁQUINA com a mesma operação também bloqueia (3 postos da mesma operação, 2 pessoas)", () => {
    const e = duro(entrada({ funcionarios: equipe(2), pools: [pool({ produto: "A", op: "opX", q: 1800, maquinas: ["m1", "m2", "m3"], mu: 100 })] }, [D1]));
    const r = gerarEscala(e);
    expect(repeticoes(e, r.alocacoes)).toBe(0);
    expect(r.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
    // a mesma entrada no modo antigo repete (rollback do motor documenta a diferença)
    const antigo = gerarEscala({ ...e, revezamentoDuro: false });
    expect(repeticoes(e, antigo.alocacoes)).toBeGreaterThan(0);
  });

  it("outro PRODUTO com a mesma operação também bloqueia", () => {
    const e = duro(entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "opX", q: 600, maquinas: ["m1"], mu: 100 }), pool({ produto: "B", op: "opX", q: 600, maquinas: ["m2"], mu: 100 })] }, [D1]));
    const r = gerarEscala(e);
    expect(repeticoes(e, r.alocacoes)).toBe(0);
    expect(comPosto(r.alocacoes)).toBeLessThan(6); // a pessoa não consegue trabalhar todos os períodos
  });

  it("operações DIFERENTES continuam podendo seguir (não há perda quando o revezamento é possível)", () => {
    const e = duro(entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "opX", q: 300, maquinas: ["m1"], mu: 100 }), pool({ produto: "B", op: "opY", q: 300, maquinas: ["m2"], mu: 100 })] }, [D1]));
    const r = gerarEscala(e);
    expect(comPosto(r.alocacoes)).toBe(6);
    expect(repeticoes(e, r.alocacoes)).toBe(0);
  });

  it("M3 → T1 conta como consecutivo (estado de rotação vindo do passado congelado)", () => {
    const base = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "opX", q: 600, maquinas: ["m1"], mu: 100 })] }, [D1]);
    const m3 = base.slots.findIndex((s) => s.periodoId === "m3");
    const congeladas = base.slots.slice(0, m3 + 1).map((s) => ({
      data: s.data, periodoId: s.periodoId, funcionarioId: "f01", maquinaId: s.periodoId === "m3" ? "m1" : null, produtoId: s.periodoId === "m3" ? "A" : null,
      etapaId: s.periodoId === "m3" ? "A-e1" : null, operacaoId: s.periodoId === "m3" ? "opX" : null, pecas: 0, motivoSemPosto: s.periodoId === "m3" ? null : "x", excecaoRevezamento: false, motivoExcecao: null,
    })) as AlocacaoEscala[];
    const e = duro({ ...base, aPartirDe: m3 + 1, congeladas });
    const t1 = gerarEscala(e).alocacoes.find((a) => a.periodoId === "t1")!;
    expect(t1.maquinaId).toBeNull(); // T1 não pode repetir a operação do M3
    expect(t1.motivoSemPosto).toBe(MOTIVO_REVEZAMENTO);
    // com outra pessoa disponível, ela ocupa o posto
    const e2 = duro({ ...base, funcionarios: equipe(2), aPartirDe: m3 + 1, congeladas });
    const t1b = gerarEscala(e2).alocacoes.filter((a) => a.periodoId === "t1");
    expect(t1b.filter((a) => a.maquinaId).map((a) => a.funcionarioId)).toEqual(["f02"]);
  });

  it("o PRÓXIMO DIA zera: quem fez a operação no T3 pode fazê-la no M1 do dia seguinte", () => {
    const base = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "opX", q: 2000, maquinas: ["m1"], mu: 100 })] }, [D1, D2]);
    const t3 = base.slots.findIndex((s) => s.data === D1 && s.periodoId === "t3");
    const congeladas = base.slots.slice(0, t3 + 1).map((s) => ({
      data: s.data, periodoId: s.periodoId, funcionarioId: "f01", maquinaId: s.periodoId === "t3" ? "m1" : null, produtoId: s.periodoId === "t3" ? "A" : null,
      etapaId: s.periodoId === "t3" ? "A-e1" : null, operacaoId: s.periodoId === "t3" ? "opX" : null, pecas: 0, motivoSemPosto: s.periodoId === "t3" ? null : "x", excecaoRevezamento: false, motivoExcecao: null,
    })) as AlocacaoEscala[];
    const e = duro({ ...base, aPartirDe: t3 + 1, congeladas });
    const r = gerarEscala(e).alocacoes;
    expect(r.find((a) => a.data === D2 && a.periodoId === "m1")!.maquinaId).toBe("m1"); // reset: pode repetir no dia novo
    expect(r.find((a) => a.data === D2 && a.periodoId === "m2")!.maquinaId).toBeNull(); // e volta a valer dentro do dia
  });

  it("SEM solução válida: posto fica sem operador, motivo específico, alerta rotacao_sem_solucao e NENHUMA exceção", () => {
    const e = duro(entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "opX", q: 600, maquinas: ["m1"], mu: 100 })] }, [D1]));
    const r = gerarEscala(e);
    const vazios = r.alocacoes.filter((a) => !a.maquinaId && a.motivoSemPosto === MOTIVO_REVEZAMENTO);
    expect(vazios.length).toBe(3); // trabalha em períodos alternados
    const alertas = r.alertas.filter((a) => a.tipo === "rotacao_sem_solucao");
    expect(alertas.length).toBe(3);
    expect(alertas[0].motivo).toContain("Não existe escala válida para preencher todos os postos neste período sem repetir operação consecutiva");
    expect(r.alocacoes.some((a) => a.excecaoRevezamento || a.motivoExcecao)).toBe(false);
    // a cobertura classifica essas pessoas como "revezamento obrigatório" (não como falta de carga) e as causas continuam somando os sem posto
    const { cobertura } = analisarCobertura(e, r);
    expect(cobertura.porCausa.revezamento_obrigatorio.pessoasPeriodo).toBe(3);
    cobertura.dias.forEach((d) => d.periodos.forEach((p) => expect(CAUSAS.reduce((s, c) => s + p.causas[c], 0)).toBe(p.semPosto)));
  });

  it("o motor não sacrifica a prioridade: com solução parcial, o posto de maior prioridade (gargalo) é o coberto", () => {
    // 2 postos da operação X (gargalo A, folgado B) para 1 pessoa que VEM de X: ninguém cobre; com 2 pessoas, só 1 vem de X
    const pools = [pool({ produto: "A", op: "opX", q: 600, maquinas: ["m1"], mu: 100 }), pool({ produto: "B", op: "opY", q: 100, maquinas: ["m2"], mu: 100 })];
    const e = duro(entrada({ funcionarios: equipe(2), pools }, [D1]));
    const r = gerarEscala(e);
    expect(repeticoes(e, r.alocacoes)).toBe(0);
    // A (gargalo: 600 em 6 períodos com 1 máquina) deve ser coberto no maior número de períodos possível sem repetir: alterna as 2 pessoas
    expect(r.alocacoes.filter((a) => a.produtoId === "A" && a.maquinaId).length).toBe(6);
  });

  it("modo antigo (flag desligada) continua repetindo e registrando exceção — só como rollback do motor", () => {
    const e = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "opX", q: 600, maquinas: ["m1"], mu: 100 })] }, [D1]);
    const r = gerarEscala(e);
    expect(r.alocacoes.some((a) => a.excecaoRevezamento)).toBe(true);
  });

  it("determinístico/reprodutível", () => {
    const { base } = cenarioAleatorio(7);
    const e = duro(base);
    expect(JSON.stringify(gerarEscala(e).alocacoes)).toBe(JSON.stringify(gerarEscala(e).alocacoes));
  });
});

describe("troca manual — revezamento duro, sem exceção", () => {
  const ORD = IDS_PERIODOS;
  const L = (periodoId: string, funcionarioId: string, op: string | null, maq: string | null): LinhaRotacao => ({ periodoId, funcionarioId, operacaoId: op, maquinaId: maq });
  // FA: X Y Z Y - X | FB: Z X Y X - -
  const dia: LinhaRotacao[] = [
    L("m1", "A", "X", "mA"), L("m2", "A", "Y", "mB"), L("m3", "A", "Z", "mC"), L("t1", "A", "Y", "mB"), L("t2", "A", null, null), L("t3", "A", "X", "mD"),
    L("m1", "B", "Z", "mC"), L("m2", "B", "X", "mD"), L("m3", "B", "Y", "mB"), L("t1", "B", "X", "mA"), L("t2", "B", null, null), L("t3", "B", null, null),
  ];
  it("bloqueia a troca que repetiria a operação do período anterior, mesmo em outra máquina", () => {
    const r = validarTroca(dia, ORD, "m2", "A", "B"); // A passaria a fazer X (outra máquina) logo após X
    expect(r).toEqual({ ok: false, funcionarioId: "A", mensagem: MENSAGEM_TROCA_BLOQUEADA });
    expect(MENSAGEM_TROCA_BLOQUEADA).toBe("Esta troca não pode ser realizada porque faria o funcionário repetir a mesma operação em períodos consecutivos.");
  });
  it("bloqueia a troca que repetiria a operação do período SEGUINTE", () => {
    // trocar no m1 daria Z para A (m1) e X para B; B: X(m1), X(m2) => repete com o seguinte
    expect(validarTroca(dia, ORD, "m1", "A", "B").ok).toBe(false);
  });
  it("M3 → T1 conta como consecutivo", () => {
    const r = validarTroca(dia, ORD, "t1", "A", "B"); // B faria Y no t1 logo após Y no m3
    expect(r.ok).toBe(false);
  });
  it("outro produto com a mesma operação também bloqueia (só a operação importa)", () => {
    const d: LinhaRotacao[] = [L("m1", "A", "X", "m1"), L("m2", "A", "Y", "m2"), L("m1", "B", "Z", "m3"), L("m2", "B", "X", "m4")];
    expect(validarTroca(d, ORD, "m2", "A", "B").ok).toBe(false);
  });
  it("troca válida passa; troca entre quem está sem posto passa", () => {
    const d: LinhaRotacao[] = [L("m1", "A", "X", "m1"), L("m2", "A", "Y", "m2"), L("m1", "B", "W", "m3"), L("m2", "B", "Z", "m4")];
    expect(validarTroca(d, ORD, "m2", "A", "B").ok).toBe(true);
    expect(validarTroca(dia, ORD, "t2", "A", "B").ok).toBe(true);
  });
  it("violação antiga e alheia à troca não bloqueia (só os pares do período trocado são conferidos)", () => {
    const d: LinhaRotacao[] = [...dia, L("m1", "C", "X", "mE"), L("m2", "C", "X", "mF"), L("t2", "C", "Z", "mG")];
    expect(repeticoesDaPessoa(d, "C", ORD)).toBe(1);
    expect(validarTroca(d, ORD, "t2", "A", "C").ok).toBe(true); // C já repetia no m1→m2, mas a troca é no t2
  });
  it("não existe bypass: a função não tem parâmetro de exceção nem de motivo", () => {
    expect(validarTroca.length).toBe(5);
  });
});

import { analisarAtingibilidade } from "../atingibilidade";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { Mundo, estadoDeTeste } from "@/lib/escala/__tests__/bancoMemoria";
import { epochMsNoFuso } from "../tempo";

describe("revezamento duro — atingibilidade, parâmetro, recálculo e troca manual no fluxo real", () => {
  it("atingibilidade: previsto em risco porque a máquina ficou livre por revezamento tem causa própria (não 'priorizar máquina')", () => {
    const e = duro(entrada({ funcionarios: equipe(1), pools: [pool({ produto: "A", op: "opX", q: 600, maquinas: ["m1"], mu: 100 })] }, [D1]));
    const a = analisarAtingibilidade(e, gerarEscala(e));
    expect(a.produtos[0].status).toBe("em_risco");
    expect(a.produtos[0].causa).toBe("revezamento_obrigatorio");
  });

  it("parâmetro revezamento_modo liga o motor duro; ausente = comportamento anterior na montagem (o carregador do banco assume 'duro')", () => {
    const base = estadoDeTeste("2026-11-02", ["2026-11-02"], { pessoas: 6 });
    const AGORA = epochMsNoFuso("2026-10-30", "10:00");
    expect(montarEntradaEscala({ ...base, parametros: { wipModo: "desligado", wipDiasLimite: 1, revezamentoModo: "duro" } }, AGORA).entrada.revezamentoDuro).toBe(true);
    expect(montarEntradaEscala({ ...base, parametros: { wipModo: "desligado", wipDiasLimite: 1, revezamentoModo: "mole" } }, AGORA).entrada.revezamentoDuro).toBeUndefined();
    expect(montarEntradaEscala(base, AGORA).entrada.revezamentoDuro).toBeUndefined();
  });

  const SEM = "2026-11-02";
  const DIAS = [SEM, "2026-11-03", "2026-11-04"];
  const AGORA = epochMsNoFuso("2026-10-30", "10:00");
  const mundoDuro = () => {
    const e = estadoDeTeste(SEM, DIAS, { pessoas: 7 });
    e.parametros = { wipModo: "desligado", wipDiasLimite: 1, revezamentoModo: "duro" };
    return new Mundo(e);
  };

  it("escala gerada e recalculada nunca repete; recálculo é idempotente e reproduzível", async () => {
    const m = mundoDuro();
    await m.recalcular(AGORA, true);
    const A = Mundo.assinatura(m.futuras(AGORA));
    const linhas = m.futuras(AGORA);
    const porDia = new Map<string, LinhaRotacao[]>();
    linhas.forEach((a) => porDia.set(a.data, [...(porDia.get(a.data) ?? []), { periodoId: a.periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, operacaoId: a.operacaoId }]));
    porDia.forEach((l) => new Set(l.map((x) => x.funcionarioId)).forEach((f) => expect(repeticoesDaPessoa(l, f, IDS_PERIODOS)).toBe(0)));
    await m.recalcular(AGORA);
    expect(Mundo.assinatura(m.futuras(AGORA))).toBe(A);
  });

  it("troca manual: a que violaria é BLOQUEADA (sem rastro, sem exceção); a válida é feita e vira 'manual'", async () => {
    const m = mundoDuro();
    await m.recalcular(AGORA, true);
    const dia = SEM;
    const linhasDia = m.futuras(AGORA).filter((a) => a.data === dia);
    const ids = [...new Set(linhasDia.map((a) => a.funcionarioId))];
    let bloqueada: [string, string, string] | null = null;
    let valida: [string, string, string] | null = null;
    for (const p of IDS_PERIODOS) for (const x of ids) for (const y of ids) {
      if (x >= y) continue;
      const r = validarTroca(linhasDia.map((a) => ({ periodoId: a.periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, operacaoId: a.operacaoId })), IDS_PERIODOS, p, x, y);
      const ax = linhasDia.find((a) => a.periodoId === p && a.funcionarioId === x)!;
      const ay = linhasDia.find((a) => a.periodoId === p && a.funcionarioId === y)!;
      if (!r.ok && !bloqueada) bloqueada = [p, x, y];
      if (r.ok && !valida && ax.maquinaId && ay.maquinaId && ax.operacaoId !== ay.operacaoId) valida = [p, x, y];
    }
    expect(bloqueada).not.toBeNull();
    expect(valida).not.toBeNull();
    const antes = Mundo.assinatura(m.alocacoes);
    expect(() => m.trocarManual(dia, bloqueada![0], bloqueada![1], bloqueada![2])).toThrow(/ESCALA_ROTACAO_VIOLADA/);
    expect(Mundo.assinatura(m.alocacoes)).toBe(antes); // nada mudou
    expect(m.alocacoes.some((a) => a.origem === "manual")).toBe(false);
    m.trocarManual(dia, valida![0], valida![1], valida![2]);
    expect(m.alocacoes.filter((a) => a.origem === "manual")).toHaveLength(2);
  });
});

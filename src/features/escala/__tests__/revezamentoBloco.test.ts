// REVEZAMENTO POR BLOCO (hotfix 28/10) — a mesma pessoa NÃO executa a MESMA operação mais de uma vez na mesma MANHÃ (M1-M3) nem na mesma TARDE (T1-T3).
// Testes A–L do pedido: unitários (rotacao.ts, exposicaoBloco.ts, verificador) + motor (gerarEscala) + fluxo (planejarComFluxo).
import { describe, it, expect } from "vitest";
import { gerarEscala } from "../gerarEscala";
import { blocoDoPeriodo, exposicaoDeApontamentos, MemoriaBloco, repeticoesPorBloco } from "../exposicaoBloco";
import { estabilizarPessoas } from "../estabilidade";
import { validarTroca, MENSAGEM_TROCA_BLOQUEADA_BLOCO, type LinhaRotacao } from "../rotacao";
import { lerParametros } from "../parametros";
import { verificarRestricoesDuras } from "../fluxo/restricoes";
import { planejarComFluxo } from "../fluxo";
import { MOTIVO_REVEZAMENTO, type AlocacaoEscala, type EntradaEscala } from "../types";
import { cenariosGolden } from "./cenariosGolden";
import { entrada, equipe, IDS_PERIODOS, pool } from "./helpers";
import { cenarioAleatorio } from "./adicionalWipHelpers";

const D1 = "2026-10-28";
const D2 = "2026-10-29";
const bloco = (e: EntradaEscala): EntradaEscala => ({ ...e, revezamentoDuro: true, revezamentoEscopo: "bloco" });
const L = (periodoId: string, funcionarioId: string, op: string | null, maq: string | null): LinhaRotacao => ({ periodoId, funcionarioId, operacaoId: op, maquinaId: maq });
const linha = (e: EntradaEscala, periodoId: string, f: string, op: string | null, maq: string | null, data = D1, extra: Partial<AlocacaoEscala> = {}): AlocacaoEscala => ({
  data, periodoId, funcionarioId: f, maquinaId: maq, produtoId: maq ? "P" : null, etapaId: maq ? "P-e1" : null, operacaoId: op, pecas: 0, motivoSemPosto: maq ? null : "x", excecaoRevezamento: false, motivoExcecao: null, ...extra,
});
const congelarAte = (e: EntradaEscala, ate: string, linhas: AlocacaoEscala[], data = D1): EntradaEscala => {
  const i = e.slots.findIndex((s) => s.data === data && s.periodoId === ate);
  return { ...e, aPartirDe: i + 1, congeladas: linhas };
};
const doPeriodo = (r: AlocacaoEscala[], pid: string, data = D1) => r.filter((a) => a.data === data && a.periodoId === pid);
const reps = (e: EntradaEscala, rows: AlocacaoEscala[]) => repeticoesPorBloco([...e.congeladas, ...rows], e.slots, e.equivalenciaOperacoes);

describe("exposicaoBloco — blocos e memória", () => {
  it("manhã = M1..M3, tarde = T1..T3; id fora do padrão usa o horário", () => {
    expect(IDS_PERIODOS.map((p) => blocoDoPeriodo(p))).toEqual(["manha", "manha", "manha", "tarde", "tarde", "tarde"]);
    expect(blocoDoPeriodo("x", 8 * 60)).toBe("manha");
    expect(blocoDoPeriodo("x", 14 * 60)).toBe("tarde");
  });
  it("equivalência: executar X expõe também Y; sem mapa a identidade é o operacao_id", () => {
    const m = new MemoriaBloco({ RP: ["R", "P"], P: ["PP"], PP: ["P"] });
    m.registrar("f", "R");
    expect(m.proibido("f", "R")).toBe(true);
    expect(m.proibido("f", "P")).toBe(false);
    expect(m.proibido("f", "RP")).toBe(true); // RP expõe R, que já foi feita
    m.registrar("f", "P");
    expect(m.proibido("f", "PP")).toBe(true); // simétrica
    const vazio = new MemoriaBloco();
    vazio.registrar("f", "P");
    expect(vazio.proibido("f", "PP")).toBe(false);
  });
  it("parâmetros: ausente/desconhecido = consecutivo; equivalências inválidas viram vazio", () => {
    expect(lerParametros([]).revezamentoEscopo).toBe("consecutivo");
    expect(lerParametros([{ chave: "revezamento_escopo", valor: "talvez" }]).revezamentoEscopo).toBe("consecutivo");
    expect(lerParametros([{ chave: "revezamento_escopo", valor: "bloco" }]).revezamentoEscopo).toBe("bloco");
    expect(lerParametros([]).revezamentoEquivalencias).toEqual({});
    expect(lerParametros([{ chave: "revezamento_equivalencias", valor: { A: ["B", "A", 3], C: "x" } }]).revezamentoEquivalencias).toEqual({ A: ["B"] });
  });
});

describe("A–F e I — regra por bloco (troca manual, TS)", () => {
  const R = { escopo: "bloco" as const };
  it("A) M1 Montar, M2 Etiquetar, M3 Montar → PROIBIDO", () => {
    const d = [L("m1", "A", "Mo", "m1"), L("m2", "A", "Et", "m2"), L("m3", "A", "Z", "m3"), L("m1", "B", "Z", "m4"), L("m2", "B", "Z", "m5"), L("m3", "B", "Mo", "m6")];
    const r = validarTroca(d, IDS_PERIODOS, "m3", "A", "B", R);
    expect(r).toEqual({ ok: false, funcionarioId: "A", mensagem: MENSAGEM_TROCA_BLOQUEADA_BLOCO });
  });
  it("B) M1 Embalar produto A, M2 outra, M3 Embalar produto B → PROIBIDO (a identidade é a operação, não o produto)", () => {
    const d = [L("m1", "A", "Em", "m1"), L("m2", "A", "Et", "m2"), L("m3", "A", "Z", "m3"), L("m1", "B", "Z", "m4"), L("m2", "B", "Z", "m5"), L("m3", "B", "Em", "m6")];
    expect(validarTroca(d, IDS_PERIODOS, "m3", "A", "B", R).ok).toBe(false);
  });
  it("C) M3 Montar, T1 Montar → PERMITIDO (a exposição zera entre manhã e tarde)", () => {
    const d = [L("m3", "A", "Mo", "m1"), L("t1", "A", "Z", "m2"), L("m3", "B", "Z", "m3"), L("t1", "B", "Mo", "m4")];
    expect(validarTroca(d, IDS_PERIODOS, "t1", "A", "B", R).ok).toBe(true);
    // e o escopo anterior (consecutivo) bloqueia o mesmo caso
    expect(validarTroca(d, IDS_PERIODOS, "t1", "A", "B").ok).toBe(false);
  });
  it("D) T1 Montar, T2 Etiquetar, T3 Montar → PROIBIDO", () => {
    const d = [L("t1", "A", "Mo", "m1"), L("t2", "A", "Et", "m2"), L("t3", "A", "Z", "m3"), L("t1", "B", "Z", "m4"), L("t2", "B", "Z", "m5"), L("t3", "B", "Mo", "m6")];
    expect(validarTroca(d, IDS_PERIODOS, "t3", "A", "B", R).ok).toBe(false);
  });
  it("E/F) outra máquina e outro produto com a MESMA operação → PROIBIDO; operação diferente → permitido", () => {
    const d = [L("m1", "A", "Mo", "mA"), L("m2", "A", "Z", "mB"), L("m1", "B", "Z", "mC"), L("m2", "B", "Mo", "mD")];
    expect(validarTroca(d, IDS_PERIODOS, "m2", "A", "B", R).ok).toBe(false);
    const d2 = [L("m1", "A", "Mo", "mA"), L("m2", "A", "Z", "mB"), L("m1", "B", "W", "mC"), L("m2", "B", "Y", "mD")];
    expect(validarTroca(d2, IDS_PERIODOS, "m2", "A", "B", R).ok).toBe(true);
  });
  it("I) o dia seguinte é livre (a tela troca um dia por vez: o dia novo começa sem exposição)", () => {
    expect(validarTroca([L("m1", "A", "Mo", "mA"), L("m1", "B", "Z", "mB")], IDS_PERIODOS, "m1", "A", "B", R).ok).toBe(true);
  });
  it("violação antiga e alheia à troca não bloqueia; trocar para PIOR o mesmo bloco bloqueia", () => {
    const d = [L("m1", "A", "Mo", "mA"), L("m2", "A", "Et", "mB"), L("m3", "A", "Mo", "mC"), L("m1", "B", "Z", "mD"), L("m2", "B", "Y", "mE"), L("m3", "B", "Z", "mF")];
    // A já repete Mo em m1/m3 (plano antigo). Trocar o m2 com B (Y) não piora → permitido
    expect(validarTroca(d, IDS_PERIODOS, "m2", "A", "B", R).ok).toBe(true);
    // trocar o m2 com quem faz Mo piora (3 Mo na manhã)
    const d2 = [...d.slice(0, 5), L("m2", "C", "Mo", "mG"), L("m1", "C", "Z", "mH"), L("m3", "C", "Z", "mI")];
    expect(validarTroca(d2.filter((x) => x.funcionarioId !== "B"), IDS_PERIODOS, "m2", "A", "C", R).ok).toBe(false);
  });
});

describe("auditor independente (repeticoesPorBloco) e verificador duro", () => {
  const e = bloco(entrada({ funcionarios: equipe(2), pools: [pool({ produto: "P", op: "Mo", q: 100, maquinas: ["m1"] })] }, [D1, D2]));
  it("conta repetições por (pessoa, bloco, operação) e ignora manhã×tarde e dia seguinte", () => {
    const rows = [
      linha(e, "m1", "f01", "Mo", "a"), linha(e, "m3", "f01", "Mo", "b"), // repetição na manhã
      linha(e, "m3", "f02", "Mo", "a"), linha(e, "t1", "f02", "Mo", "b"), // M3→T1: permitido
      linha(e, "t3", "f02", "Mo", "a"), // T1 e T3 na tarde: repetição
      linha(e, "m1", "f01", "Mo", "a", D2), // dia seguinte livre
    ];
    const r = repeticoesPorBloco(rows, e.slots);
    expect(r.map((x) => `${x.funcionarioId}|${x.data}|${x.bloco}|${x.periodos.join("/")}`)).toEqual([`f01|${D1}|manha|m1/m3`, `f02|${D1}|tarde|t1/t3`]);
  });
  it("verificarRestricoesDuras acusa a 2ª execução no bloco, olha congeladas e usa evidência real", () => {
    const base = congelarAte(e, "m2", [linha(e, "m1", "f01", "Mo", "a"), linha(e, "m2", "f01", "Et", "b")]);
    const novo = [linha(e, "m3", "f01", "Mo", "c")];
    const v = verificarRestricoesDuras(base, novo, { somenteLinhasNovas: true }).filter((x) => x.tipo === "revezamento");
    expect(v.length).toBe(1);
    // G) a evidência real do M1 (executou Et, não Mo) substitui a congelada: M3 Mo deixa de violar, M3 Et violaria
    const comEvid: EntradaEscala = { ...base, exposicaoExecutada: [{ data: D1, periodoId: "m1", funcionarioId: "f01", operacoes: ["Z"] }, { data: D1, periodoId: "m2", funcionarioId: "f01", operacoes: ["Z"] }] };
    expect(verificarRestricoesDuras(comEvid, novo, { somenteLinhasNovas: true }).filter((x) => x.tipo === "revezamento")).toEqual([]);
    expect(verificarRestricoesDuras(comEvid, [linha(e, "m3", "f01", "Z", "c")], { somenteLinhasNovas: true }).filter((x) => x.tipo === "revezamento").length).toBe(1);
  });
  it("sem o escopo bloco o verificador mantém a regra consecutiva", () => {
    const cons = { ...e, revezamentoEscopo: undefined } as EntradaEscala;
    const base = congelarAte(cons, "m2", [linha(e, "m1", "f01", "Mo", "a"), linha(e, "m2", "f01", "Et", "b")]);
    expect(verificarRestricoesDuras(base, [linha(e, "m3", "f01", "Mo", "c")], { somenteLinhasNovas: true }).filter((x) => x.tipo === "revezamento")).toEqual([]);
  });
  it("exposicaoDeApontamentos: só 'produzindo' com funcionário e operação, lançado até o agora e de período já iniciado", () => {
    const ap = (p: string, f: string | null, op: string | null, st: "produzindo" | "sem_producao" = "produzindo", ms = 1) => ({ data: D1, periodoId: p, funcionarioId: f, operacaoId: op, status: st, lancadoEmMs: ms });
    const ev = exposicaoDeApontamentos([ap("m1", "f01", "Mo"), ap("m1", null, "Mo"), ap("m2", "f01", "Et", "sem_producao"), ap("m3", "f01", "Mo", "produzindo", 99), ap("t1", "f01", "Mo")], e.slots, 2, 10);
    expect(ev).toEqual([{ data: D1, periodoId: "m1", funcionarioId: "f01", operacoes: ["Mo"] }]);
  });
});

describe("motor (gerarEscala) — restrição dura por bloco", () => {
  it("uma pessoa, uma operação: no máximo 1 posto por bloco; os demais ficam VAZIOS com o motivo de revezamento e alerta (nunca viola)", () => {
    const e = bloco(entrada({ funcionarios: equipe(1), pools: [pool({ produto: "P", op: "Mo", q: 600, maquinas: ["m1"] })] }, [D1]));
    const r = gerarEscala(e);
    expect(r.alocacoes.filter((a) => a.maquinaId).map((a) => a.periodoId)).toEqual(["m1", "t1"]);
    expect(r.alocacoes.filter((a) => !a.maquinaId && a.motivoSemPosto === MOTIVO_REVEZAMENTO).length).toBe(4); // H) posto vazio + diagnóstico
    expect(r.alertas.filter((a) => a.tipo === "rotacao_sem_solucao").length).toBe(4);
    expect(r.alertas.find((a) => a.tipo === "rotacao_sem_solucao")?.motivo).toContain("mesmo bloco");
    expect(reps(e, r.alocacoes)).toEqual([]);
    expect(r.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
  });
  it("E/F no motor: duas máquinas/produtos da MESMA operação, uma pessoa → nunca 2 vezes no bloco", () => {
    const pools = [pool({ produto: "P", op: "Mo", q: 300, maquinas: ["m1"] }), pool({ produto: "Q", op: "Mo", q: 300, maquinas: ["m2"] })];
    const e = bloco(entrada({ funcionarios: equipe(1), pools }, [D1]));
    expect(reps(e, gerarEscala(e).alocacoes)).toEqual([]);
  });
  it("A/D no motor: com 2 operações e 2 pessoas, a terceira etapa do bloco fica vazia em vez de repetir", () => {
    const pools = [pool({ produto: "P", op: "Mo", q: 600, maquinas: ["m1"] }), pool({ produto: "Q", op: "Et", q: 600, maquinas: ["m2"] })];
    const e = bloco(entrada({ funcionarios: equipe(2), pools }, [D1]));
    const r = gerarEscala(e);
    expect(reps(e, r.alocacoes)).toEqual([]);
    expect(doPeriodo(r.alocacoes, "m1").filter((a) => a.maquinaId).length).toBe(2);
    expect(doPeriodo(r.alocacoes, "m2").filter((a) => a.maquinaId).length).toBe(2); // cada um troca de operação
    expect(doPeriodo(r.alocacoes, "m3").filter((a) => a.maquinaId).length).toBe(0); // as duas operações já foram feitas por ambos
    expect(doPeriodo(r.alocacoes, "t1").filter((a) => a.maquinaId).length).toBe(2); // tarde: zerou
  });
  it("C no motor: M3 Montar → T1 Montar é PERMITIDO (consecutivo bloquearia)", () => {
    const base = entrada({ funcionarios: equipe(1), pools: [pool({ produto: "P", op: "Mo", q: 600, maquinas: ["m1"] })] }, [D1]);
    const cong = base.slots.filter((s) => ["m1", "m2", "m3"].includes(s.periodoId)).map((s) => linha(base, s.periodoId, "f01", s.periodoId === "m3" ? "Mo" : null, s.periodoId === "m3" ? "m1" : null));
    const e = bloco({ ...base, aPartirDe: 3, congeladas: cong });
    expect(doPeriodo(gerarEscala(e).alocacoes, "t1")[0].maquinaId).toBe("m1");
    expect(doPeriodo(gerarEscala({ ...e, revezamentoEscopo: "consecutivo" }).alocacoes, "t1")[0].maquinaId).toBeNull();
  });
  it("G) recálculo no meio do bloco olha M1+M2 inteiros (congelada) e a evidência real substitui a congelada", () => {
    const pools = [pool({ produto: "P", op: "Mo", q: 600, maquinas: ["m1"] }), pool({ produto: "Q", op: "Et", q: 600, maquinas: ["m2"] }), pool({ produto: "R", op: "Z", q: 600, maquinas: ["m3"] })];
    const base = bloco(entrada({ funcionarios: equipe(1), pools }, [D1]));
    const cong = [linha(base, "m1", "f01", "Mo", "m1"), linha(base, "m2", "f01", "Et", "m2")];
    const e = { ...base, aPartirDe: 2, congeladas: cong };
    // M3: só a terceira operação (Z) é possível — Mo (M1) e Et (M2) estão expostas
    const m3 = doPeriodo(gerarEscala(e).alocacoes, "m3")[0];
    expect(m3.maquinaId).toBe("m3");
    expect(m3.operacaoId).toBe("Z");
    // evidência: a pessoa na verdade fez Z em M2 → agora Et (que a congelada dizia) está livre, Z não
    const comEv = { ...e, exposicaoExecutada: [{ data: D1, periodoId: "m2", funcionarioId: "f01", operacoes: ["Z"] }] };
    const m3b = doPeriodo(gerarEscala(comEv).alocacoes, "m3")[0];
    expect(m3b.operacaoId).toBe("Et");
    // tarde (T1+T2 → T3): idem
    const t = (p: string, i: number) => linha(base, p, "f01", i === 0 ? "Mo" : "Et", i === 0 ? "m1" : "m2");
    const eT = { ...base, aPartirDe: base.slots.findIndex((s) => s.periodoId === "t3"), congeladas: [t("t1", 0), t("t2", 1)] };
    expect(doPeriodo(gerarEscala(eT).alocacoes, "t3")[0].operacaoId).toBe("Z");
  });
  it("I) dia seguinte livre e L) 'consecutivo' explícito é byte-idêntico à entrada sem a flag", () => {
    const e = bloco(entrada({ funcionarios: equipe(1), pools: [pool({ produto: "P", op: "Mo", q: 2000, maquinas: ["m1"] })] }, [D1, D2]));
    const r = gerarEscala(e).alocacoes;
    expect(doPeriodo(r, "m1", D2)[0].maquinaId).toBe("m1");
    cenariosGolden().slice(0, 10).forEach((c) => {
      const sem = JSON.stringify(gerarEscala({ ...c.entrada, revezamentoDuro: true }));
      const com = JSON.stringify(gerarEscala({ ...c.entrada, revezamentoDuro: true, revezamentoEscopo: "consecutivo", equivalenciaOperacoes: { x: ["y"] }, exposicaoExecutada: [] }));
      expect(com).toBe(sem);
    });
  });
  it("propriedade: 60 cenários aleatórios — 0 repetição por bloco, 0 exceção, verificador limpo", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { base, com } = cenarioAleatorio(seed);
      for (const e0 of [base, com]) {
        const e = bloco(e0);
        const r = gerarEscala(e);
        expect(reps(e, r.alocacoes)).toEqual([]);
        expect(r.alocacoes.some((a) => a.excecaoRevezamento)).toBe(false);
        expect(verificarRestricoesDuras(e, r.alocacoes).filter((x) => x.tipo === "revezamento")).toEqual([]);
      }
    }
  });
  it("equivalência (opcional) é respeitada pelo motor: Parafusar ≡ Parafusar (Pino)", () => {
    const pools = [pool({ produto: "P", op: "Pa", q: 600, maquinas: ["m1"] }), pool({ produto: "Q", op: "PP", q: 600, maquinas: ["m2"] })];
    const sem = bloco(entrada({ funcionarios: equipe(1), pools }, [D1]));
    const com = { ...sem, equivalenciaOperacoes: { Pa: ["PP"], PP: ["Pa"] } };
    expect(reps(sem, gerarEscala(sem).alocacoes)).toEqual([]);
    expect(reps(com, gerarEscala(com).alocacoes)).toEqual([]);
    expect(doPeriodo(gerarEscala(sem).alocacoes, "m2")[0].maquinaId).not.toBeNull(); // sem mapa: Pa e PP são operações distintas
    expect(doPeriodo(gerarEscala(com).alocacoes, "m2")[0].maquinaId).toBeNull(); // com mapa: já expôs Pa+PP no M1
  });
});

describe("estabilização de pessoas respeita o bloco", () => {
  it("a re-atribuição não devolve a pessoa a uma operação já executada no bloco", () => {
    const e = bloco(entrada({ funcionarios: equipe(2), pools: [pool({ produto: "P", op: "Mo", q: 600, maquinas: ["m1"] }), pool({ produto: "Q", op: "Et", q: 600, maquinas: ["m2"] })] }, [D1]));
    const antes = [linha(e, "m1", "f01", "Mo", "m1"), linha(e, "m1", "f02", "Et", "m2"), linha(e, "m2", "f01", "Et", "m2"), linha(e, "m2", "f02", "Mo", "m1")];
    // proposta do m3: tokens Mo@m1 e Et@m2 — oficial queria f01→Mo, f02→Et (ambos repetiriam); sem solução estável devolve a proposta original
    const proposta = [linha(e, "m3", "f01", "Mo", "m1"), linha(e, "m3", "f02", "Et", "m2")];
    const r = estabilizarPessoas(proposta, proposta, antes, e.slots, { escopo: "bloco" });
    expect(r.estabilizou).toBe(false);
  });
});

describe("K) fluxo ativo (planejarComFluxo) respeita o bloco", () => {
  it("nenhum plano do fluxo viola; o verificador independente fica limpo", () => {
    const pools = [
      pool({ produto: "P", etapa: "P-e1", op: "Et", ordem: 1, q: 500, maquinas: ["m1", "m2"] }),
      pool({ produto: "P", etapa: "P-e2", op: "Em", ordem: 2, q: 500, maquinas: ["m3"] }),
      pool({ produto: "Q", etapa: "Q-e1", op: "Mo", ordem: 1, q: 400, maquinas: ["m4"] }),
    ];
    const base = bloco(entrada({ funcionarios: equipe(6), pools }, [D1, D2]));
    const agoraMs = base.slots[0].inicioMs - 3600_000;
    const r = planejarComFluxo(base, { apontamentos: [], agoraMs, planoVigente: [] });
    expect(verificarRestricoesDuras(r.entradaFluxo, r.resultado.alocacoes)).toEqual([]);
    expect(reps(base, r.resultado.alocacoes)).toEqual([]);
  });
});

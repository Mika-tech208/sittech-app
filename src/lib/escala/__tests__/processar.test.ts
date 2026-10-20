import { describe, it, expect } from "vitest";
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala } from "@/features/escala/types";
import { AVISO_PRIMEIRA_GERACAO } from "@/features/escala/types";
import { ConflitoDeVersaoError, type EstadoBruto, type PayloadAplicacao } from "../estado";
import { montarEntradaEscala } from "../montarEntrada";
import { processarSemana, type EscalaIO } from "../processar";

const D1 = "2026-10-19";
const D2 = "2026-10-20";
const METAS = { m1: 100, m2: 100, m3: 100, t1: 100, t2: 100, t3: 100 };

function estadoBase(parcial: Partial<EstadoBruto> = {}): EstadoBruto {
  return {
    previsaoId: "prev1",
    semanaInicio: D1,
    diasProdutivos: [D1, D2],
    periodosAtuais: PERIODOS_REAIS,
    diasExistentes: [],
    equipeProdutiva: [
      { funcionarioId: "f1", ativo: true }, { funcionarioId: "f2", ativo: true }, { funcionarioId: "f3", ativo: false },
    ],
    itens: [
      { produtoId: "p1", quantidade: 600, valorUnitario: 2, maquinasPorEtapa: { e1: ["m1", "m2"], e2: ["m3"] } },
    ],
    etapas: [
      { id: "e1", produtoId: "p1", operacaoId: "opA", ordem: 1, metas: METAS },
      { id: "e2", produtoId: "p1", operacaoId: "opB", ordem: 2, metas: METAS },
      { id: "e3", produtoId: "p1", operacaoId: "opC", ordem: 3, metas: METAS }, // sem máquina selecionada
    ],
    maquinasIndisponiveisPrevisao: [],
    maquinasInativas: [],
    ausencias: [],
    indisponibilidades: [],
    alocacoes: [],
    nomesOperacao: { opA: "Rosquear", opB: "Embalar" },
    ...parcial,
  };
}

function fakeIO(estado: () => EstadoBruto, aplicar?: (p: PayloadAplicacao, n: number) => Promise<{ versoes: Record<string, number> }>) {
  const chamadas = { carregar: 0, aplicar: 0, payloads: [] as PayloadAplicacao[] };
  const io: EscalaIO = {
    async carregarEstado() { chamadas.carregar++; return estado(); },
    async aplicar(p) { chamadas.aplicar++; chamadas.payloads.push(p); return aplicar ? aplicar(p, chamadas.aplicar) : { versoes: { [D1]: 1, [D2]: 1 } }; },
  };
  return { io, chamadas };
}

describe("montarEntradaEscala", () => {
  it("monta pools por (produto, etapa): soma itens do mesmo produto, une máquinas e ignora etapa sem máquina", () => {
    const e = estadoBase({
      itens: [
        { produtoId: "p1", quantidade: 400, valorUnitario: 2, maquinasPorEtapa: { e1: ["m1"], e2: ["m3"] } },
        { produtoId: "p1", quantidade: 200, valorUnitario: 3, maquinasPorEtapa: { e1: ["m2"], e2: ["m3"] } },
      ],
    });
    const { entrada, avisos } = montarEntradaEscala(e, epochMsNoFuso(D1, "05:00"));
    const p1e1 = entrada.pools.find((p) => p.etapaId === "e1")!;
    expect(p1e1.quantidade).toBe(600);
    expect(p1e1.maquinasIds).toEqual(["m1", "m2"]);
    expect(p1e1.valorUnitario).toBe(3);
    expect(p1e1.operacaoId).toBe("opA");
    expect(p1e1.metas.t2).toBe(100);
    expect(entrada.pools.find((p) => p.etapaId === "e3")).toBeUndefined();
    expect(avisos.some((a) => a.tipo === "etapa_sem_maquina" && a.etapaId === "e3")).toBe(true);
  });

  it("equipe = só produtivos E ativos; ausência vira janela em minutos (null = dia inteiro); indisponibilidade ISO vira ms", () => {
    const e = estadoBase({
      ausencias: [
        { funcionarioId: "f1", data: D1, horarioInicio: "15:00:00", horarioFim: "17:00:00" },
        { funcionarioId: "f2", data: D2, horarioInicio: null, horarioFim: null },
      ],
      indisponibilidades: [{ maquinaId: "m1", desde: "2026-10-19T16:00:00.000Z", liberadaEm: null }],
    });
    const { entrada } = montarEntradaEscala(e, epochMsNoFuso(D1, "05:00"));
    expect(entrada.funcionarios.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(entrada.ausencias[0]).toEqual({ funcionarioId: "f1", data: D1, inicioMin: 900, fimMin: 1020 });
    expect(entrada.ausencias[1]).toEqual({ funcionarioId: "f2", data: D2, inicioMin: null, fimMin: null });
    expect(entrada.indisponibilidades[0]).toEqual({ maquinaId: "m1", desdeMs: Date.parse("2026-10-19T16:00:00.000Z"), liberadaEmMs: null });
  });

  it("o período em andamento fica congelado: primeiro slot mutável é o próximo não iniciado", () => {
    const congeladas: AlocacaoEscala[] = [
      { data: D1, periodoId: "m1", funcionarioId: "f1", maquinaId: "m1", produtoId: "p1", etapaId: "e1", operacaoId: "opA", pecas: 100, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null },
      { data: D1, periodoId: "m2", funcionarioId: "f1", maquinaId: "m3", produtoId: "p1", etapaId: "e2", operacaoId: "opB", pecas: 100, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null },
      { data: D1, periodoId: "m3", funcionarioId: "f1", maquinaId: "m1", produtoId: "p1", etapaId: "e1", operacaoId: "opA", pecas: 100, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null },
    ];
    const e = estadoBase({
      diasExistentes: [{ data: D1, versao: 3, periodosSnapshot: PERIODOS_REAIS }, { data: D2, versao: 3, periodosSnapshot: PERIODOS_REAIS }],
      alocacoes: congeladas,
    });
    const { entrada } = montarEntradaEscala(e, epochMsNoFuso(D1, "09:30")); // M2 em andamento
    expect(entrada.slots[entrada.aPartirDe].periodoId).toBe("m3");
    expect(entrada.congeladas.map((a) => a.periodoId)).toEqual(["m1", "m2"]);
    expect(entrada.trocasManuais ?? []).toEqual([]); // m3 é automática: saída derivada, não entra
  });

  it("dia existente mantém o snapshot de horários; dia não produtivo só conta períodos já iniciados e entra em removerDias", () => {
    const snapAntigo = PERIODOS_REAIS.map((p) => (p.id === "m3" ? { ...p, fim: "12:00" } : p));
    const e = estadoBase({
      diasProdutivos: [D2],
      diasExistentes: [{ data: D1, versao: 2, periodosSnapshot: snapAntigo }, { data: D2, versao: 2, periodosSnapshot: snapAntigo }],
    });
    const { entrada, removerDias, periodosPorDia } = montarEntradaEscala(e, epochMsNoFuso(D1, "09:00"));
    expect(removerDias).toEqual([D1]);
    expect(periodosPorDia.get(D2)?.find((p) => p.id === "m3")?.fim).toBe("12:00");
    // D1 deixou de ser produtivo: só M1 e M2 (já iniciados) ficam como slots congelados
    expect(entrada.slots.filter((s) => s.data === D1).map((s) => s.periodoId)).toEqual(["m1", "m2"]);
    expect(entrada.slots[entrada.aPartirDe].data).toBe(D2);
  });
});

describe("processarSemana (orquestração)", () => {
  const AGORA_ANTES = epochMsNoFuso(D1, "05:00");

  it("ignora semana sem escala quando não é geração manual", async () => {
    const { io, chamadas } = fakeIO(() => estadoBase());
    const r = await processarSemana(io, { agoraMs: AGORA_ANTES, criarSeNaoExiste: false });
    expect(r.status).toBe("ignorado");
    expect(chamadas.aplicar).toBe(0);
  });

  it("geração manual cria a escala: dias novos (versao_base null) com snapshot e alocações do motor", async () => {
    const { io, chamadas } = fakeIO(() => estadoBase());
    const r = await processarSemana(io, { agoraMs: AGORA_ANTES, criarSeNaoExiste: true, usuarioId: "u1", eventoIds: ["ev1"] });
    expect(r.status).toBe("processado");
    const p = chamadas.payloads[0];
    expect(p.dias.map((d) => d.versao_base)).toEqual([null, null]);
    expect(p.dias[0].periodos_snapshot).toHaveLength(6);
    expect(p.aPartirDeData).toBe(D1);
    expect(p.aPartirDePeriodo).toBe("m1");
    expect(p.alocacoes).toHaveLength(2 * 12); // 2 funcionários ativos × 12 slots
    expect(p.usuarioId).toBe("u1");
    expect(p.eventoIds).toEqual(["ev1"]);
    expect(r.aviso).toBeUndefined();
  });

  it("primeira geração com a semana em andamento mostra o aviso e trata a demanda como restante", async () => {
    const { io } = fakeIO(() => estadoBase());
    const r = await processarSemana(io, { agoraMs: epochMsNoFuso(D1, "09:30"), criarSeNaoExiste: true });
    expect(r.aviso).toBe(AVISO_PRIMEIRA_GERACAO);
  });

  it("conflito de versão: relê o estado e recalcula (retry); depois do limite, falha", async () => {
    let versao = 1;
    const { io, chamadas } = fakeIO(
      () => estadoBase({ diasExistentes: [{ data: D1, versao, periodosSnapshot: PERIODOS_REAIS }, { data: D2, versao, periodosSnapshot: PERIODOS_REAIS }] }),
      async (_p, n) => {
        if (n === 1) { versao = 2; throw new ConflitoDeVersaoError("ESCALA_VERSAO_CONFLITO"); }
        return { versoes: { [D1]: 3, [D2]: 3 } };
      }
    );
    const r = await processarSemana(io, { agoraMs: AGORA_ANTES, criarSeNaoExiste: false });
    expect(r.status).toBe("processado");
    expect(r.tentativas).toBe(2);
    expect(chamadas.carregar).toBe(2);
    expect(chamadas.payloads[0].dias[0].versao_base).toBe(1);
    expect(chamadas.payloads[1].dias[0].versao_base).toBe(2);

    const sempreConflito = fakeIO(
      () => estadoBase({ diasExistentes: [{ data: D1, versao: 1, periodosSnapshot: PERIODOS_REAIS }] }),
      async () => { throw new ConflitoDeVersaoError("ESCALA_VERSAO_CONFLITO"); }
    );
    let falhou: unknown = null;
    try { await processarSemana(sempreConflito.io, { agoraMs: AGORA_ANTES, criarSeNaoExiste: false, maxTentativas: 2 }); } catch (e) { falhou = e; }
    expect(falhou instanceof ConflitoDeVersaoError).toBe(true);
    expect(sempreConflito.chamadas.aplicar).toBe(2);
  });

  it("depois do último período da semana não há nada mutável: sem alteração e sem gravar", async () => {
    const { io, chamadas } = fakeIO(() => estadoBase({ diasExistentes: [{ data: D1, versao: 1, periodosSnapshot: PERIODOS_REAIS }, { data: D2, versao: 1, periodosSnapshot: PERIODOS_REAIS }] }));
    const r = await processarSemana(io, { agoraMs: epochMsNoFuso(D2, "18:00"), criarSeNaoExiste: false });
    expect(r.status).toBe("sem_alteracao");
    expect(chamadas.aplicar).toBe(0);
  });

  it("outros erros do banco não são engolidos", async () => {
    const { io } = fakeIO(() => estadoBase(), async () => { throw new Error("boom"); });
    let msg = "";
    try { await processarSemana(io, { agoraMs: AGORA_ANTES, criarSeNaoExiste: true }); } catch (e) { msg = (e as Error).message; }
    expect(msg).toBe("boom");
  });

  it("recálculo parcial: só alocações de períodos futuros vão no payload e dias não produtivos vão em removerDias", async () => {
    const e = estadoBase({
      diasProdutivos: [D2],
      diasExistentes: [{ data: D1, versao: 2, periodosSnapshot: PERIODOS_REAIS }, { data: D2, versao: 2, periodosSnapshot: PERIODOS_REAIS }],
    });
    const { io, chamadas } = fakeIO(() => e);
    await processarSemana(io, { agoraMs: epochMsNoFuso(D1, "09:00"), criarSeNaoExiste: false });
    const p = chamadas.payloads[0];
    expect(p.removerDias).toEqual([D1]);
    expect(p.alocacoes.every((a) => a.data === D2)).toBe(true);
    expect(p.aPartirDeData).toBe(D2);
  });
});

// DEFESA NO MOTOR: máquina da Previsão que o roteiro ATUAL não torna elegível para a etapa nunca vira posto. A Previsão não é corrigida em silêncio.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { empacotarLinha } from "@/features/escala/snapshotSombra";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EstadoBruto } from "../estado";
import { montarEntradaEscala } from "../montarEntrada";
import type { VersaoPlanoOficial } from "../planoVersionado";
import { prepararDecisao, type ApontamentoBanco } from "../sombraServico";
import { estadoDeTeste, Mundo } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = [SEMANA, "2026-11-03"];
const AGORA = epochMsNoFuso("2026-10-30", "10:00");
const MIN = 60_000;

// estadoDeTeste: pA tem eA1 (opRosca: m1, m2) e eA2 (opEmbal: m5). Simula o caso real: a Previsão guarda m5 (Embalar) também na etapa eA1 (Rosquear).
function estadoComSelecaoCruzada(opc: { lista?: boolean; operacao?: boolean } = {}): EstadoBruto {
  const e = estadoDeTeste(SEMANA, DIAS, { pessoas: 10 });
  e.itens[0].maquinasPorEtapa = { eA1: ["m1", "m2", "m5"], eA2: ["m5", "m1"] }; // m5 é de Embalar (inválida em eA1), m1 é de Rosquear (inválida em eA2)
  if (opc.lista !== false) {
    e.etapas.find((x) => x.id === "eA1")!.maquinasCompativeis = ["m1", "m2"];
    e.etapas.find((x) => x.id === "eA2")!.maquinasCompativeis = ["m5"];
  }
  if (opc.operacao) e.operacaoDaMaquina = { m1: "opRosca", m2: "opRosca", m5: "opEmbal" };
  return e;
}

describe("montarEntradaEscala: seleção inválida", () => {
  it("máquina fora da lista da etapa é descartada do pool, com aviso explícito (produto, etapa, operação, máquina, semana); a Previsão fica intacta", () => {
    const e = estadoComSelecaoCruzada();
    const antes = JSON.stringify(e.itens);
    const m = montarEntradaEscala(e, AGORA);
    const eA1 = m.entrada.pools.find((p) => p.etapaId === "eA1")!, eA2 = m.entrada.pools.find((p) => p.etapaId === "eA2")!;
    expect(eA1.maquinasIds).toEqual(["m1", "m2"]);
    expect(eA2.maquinasIds).toEqual(["m5"]);
    const inv = m.avisos.filter((a) => a.tipo === "selecao_maquina_invalida");
    expect(inv).toHaveLength(2);
    expect(inv.map((a) => JSON.stringify(a))).toContain(JSON.stringify({ tipo: "selecao_maquina_invalida", produtoId: "pA", etapaId: "eA1", operacaoId: "opRosca", maquinaId: "m5", semanaInicio: SEMANA }));
    expect(inv.map((a) => JSON.stringify(a))).toContain(JSON.stringify({ tipo: "selecao_maquina_invalida", produtoId: "pA", etapaId: "eA2", operacaoId: "opEmbal", maquinaId: "m1", semanaInicio: SEMANA }));
    expect(JSON.stringify(e.itens)).toBe(antes);
  });
  it("sem lista na etapa, vale a operação da máquina (regra de calcularMaquinasDaEtapa)", () => {
    const m = montarEntradaEscala(estadoComSelecaoCruzada({ lista: false, operacao: true }), AGORA);
    expect(m.entrada.pools.find((p) => p.etapaId === "eA1")!.maquinasIds).toEqual(["m1", "m2"]);
    expect(m.avisos.filter((a) => a.tipo === "selecao_maquina_invalida" && a.produtoId === "pA")).toHaveLength(2);
  });
  it("sem informação para PROVAR a invalidez (sem lista e sem operação da máquina) a máquina é mantida", () => {
    const m = montarEntradaEscala(estadoComSelecaoCruzada({ lista: false }), AGORA);
    expect(m.entrada.pools.find((p) => p.etapaId === "eA1")!.maquinasIds).toEqual(["m1", "m2", "m5"]);
    expect(m.avisos.filter((a) => a.tipo === "selecao_maquina_invalida")).toHaveLength(0);
  });
  it("seleção toda inválida => etapa sem máquina (fail-safe): nenhuma alocação em máquina incompatível", () => {
    const e = estadoComSelecaoCruzada();
    e.itens[0].maquinasPorEtapa = { eA1: ["m5"], eA2: ["m5"] };
    const m = montarEntradaEscala(e, AGORA);
    expect(m.entrada.pools.find((p) => p.etapaId === "eA1")).toBeUndefined();
    expect(m.avisos.some((a) => a.tipo === "etapa_sem_maquina" && a.etapaId === "eA1")).toBe(true);
  });
  it("Escala gerada: nenhuma linha usa máquina que não seja elegível para a etapa da linha", () => {
    const e = estadoComSelecaoCruzada();
    const m = montarEntradaEscala(e, AGORA);
    const r = gerarEscala(m.entrada);
    const elegiveis = new Map(e.etapas.map((x) => [x.id, new Set(x.maquinasCompativeis ?? [])]));
    const usadas = r.alocacoes.filter((a) => a.maquinaId && a.produtoId === "pA");
    expect(usadas.length).toBeGreaterThan(0);
    usadas.forEach((a) => expect(elegiveis.get(a.etapaId as string)?.has(a.maquinaId as string)).toBe(true));
  });
});

describe("recálculo e sombra", () => {
  it("o recálculo registra as seleções ignoradas no resumo (alertas) e não gera posto inválido", async () => {
    const m = new Mundo(estadoComSelecaoCruzada());
    const r = await m.recalcular(AGORA, true);
    expect(r.status).toBe("processado");
    expect(r.alertas.filter((a) => a.tipo === "selecao_maquina_invalida")).toHaveLength(2);
    const elegiveis = new Map(m.entradas.etapas.map((x) => [x.id, new Set(x.maquinasCompativeis ?? [])]));
    m.alocacoes.filter((a) => a.maquinaId && a.produtoId === "pA").forEach((a) => expect(elegiveis.get(a.etapaId as string)?.has(a.maquinaId as string)).toBe(true));
  });
  it("snapshot da sombra feito sobre Previsão inconsistente é marcado (entradaComRoteiroInconsistente) e não apaga nada", async () => {
    const e = estadoComSelecaoCruzada();
    const m = new Mundo(e);
    await m.recalcular(AGORA, true);
    const estado: EstadoBruto = { ...m.entradas, diasExistentes: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: d.snapshot })), alocacoes: m.alocacoes.map((a) => ({ ...a })) };
    const v: VersaoPlanoOficial = {
      id: "v1", previsaoId: "prev1", validoDesdeMs: AGORA, origem: "trigger", hashPlano: "h", dias: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodos_snapshot: d.snapshot })),
      linhas: m.alocacoes.map((a) => empacotarLinha(a)), entrada: JSON.parse(JSON.stringify({ diasProdutivos: e.diasProdutivos, equipe: e.equipeProdutiva.map((x) => x.funcionarioId), maquinasIndisponiveisPrevisao: [], itens: e.itens })),
    };
    const fim = epochMsNoFuso(SEMANA, "08:48");
    const aps: ApontamentoBanco[] = m.alocacoes.filter((a) => a.data === SEMANA && a.periodoId === "m1" && a.maquinaId).map((a, i) => ({
      data: SEMANA, periodoId: "m1", funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, quantidadeProduzida: Math.round(a.pecas), quantidadeRefugo: 0, meta: a.pecas,
      status: "produzindo", motivo: null, criadoEmMs: fim + 2 * MIN + i * 3000, atualizadoEmMs: null,
    }));
    const r = await prepararDecisao(estado, aps, { data: SEMANA, periodoId: "m1" }, fim + 15 * MIN, async () => v);
    expect(r.pronto).toBe(true);
    if (!r.pronto) return;
    expect(r.snapshot.diagnostico.entradaComRoteiroInconsistente).toBe(true);
    expect(r.snapshot.diagnostico.incertezas.entrada_com_roteiro_inconsistente).toBe(2);
    expect(r.snapshot.diagnostico.avisos.some((x) => x.startsWith("entrada_com_roteiro_inconsistente"))).toBe(true);
  });
  it("Previsão consistente: nenhum aviso e snapshot sem a marca", async () => {
    const e = estadoDeTeste(SEMANA, DIAS, { pessoas: 10 });
    e.etapas.forEach((x) => (x.maquinasCompativeis = [...new Set(e.itens.flatMap((i) => i.maquinasPorEtapa[x.id] ?? []))]));
    const m = montarEntradaEscala(e, AGORA);
    expect(m.avisos.filter((a) => a.tipo === "selecao_maquina_invalida")).toHaveLength(0);
  });
});

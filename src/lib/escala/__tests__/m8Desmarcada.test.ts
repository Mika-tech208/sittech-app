// AUDITORIA DA MÁQUINA 8 DESMARCADA. Se a M8 (1ª etapa da rota automática) sai da seleção da Previsão, `montarEntrada` removia a etapa e a cadeia Automática passava a COMEÇAR em Etiquetar
// com material infinito (produção "do nada"): o planejador de corte gravava a demanda inteira da Automática como atendida e NENHUMA checagem (cadeiaInvalida/semMaterial/violacoesDuras) pegava.
// Regra corrigida: etapa SEM origem (a jusante de uma etapa sem máquina) não entra no plano ⇒ rota indisponível ⇒ produção zero ⇒ demanda registrada como NÃO atendida.
import { describe, expect, it } from "vitest";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { distribuicaoEfetiva } from "@/features/escala/distribuicao";
import { planejarComFluxo } from "@/features/escala/fluxo";
import { planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { validarPlanoCadeia } from "@/features/escala/fluxo/planoReverso";
import { hashAlocacoes } from "@/features/escala/horizonte";
import type { AlocacaoEscala } from "@/features/escala/types";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { PayloadAplicacao } from "../estado";
import { montarEntradaEscala } from "../montarEntrada";
import { processarSemana } from "../processar";
import { Mundo } from "./bancoMemoria";
import { AGORA_VESPERA, estadoM8 } from "./m8Fixture";

const CFG = { objetivo: "EQUILIBRIO" as const, busca: { iter: 40000, reinicios: 1, semente: 1 } };
// golden-master do comportamento ATUAL (M8 selecionada), gerado antes da correção com scripts/auditoria-m8/golden-m8.ts
const GOLDEN_LEGADO = "2983d0db66c6a450b6167453f98ff2ebf4ba35500b45d19d67429d428301925e";
const GOLDEN_CORTE = "137e60a2c50656d644ea9c99898b54a43733f4041315cc61f564a4c4f5240809";
const dados = () => ({ apontamentos: [], agoraMs: AGORA_VESPERA, fechamentoMinutos: 10, planoVigente: [] as AlocacaoEscala[], contagensFisicas: [] });
const pecas = (ls: AlocacaoEscala[], pid: string) => ls.filter((l) => l.maquinaId).flatMap((l) => distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId as string, etapaId: l.etapaId as string, pecas: l.pecas }]).filter((i) => i.produtoId === pid).reduce((s, i) => s + i.pecas, 0);
const entradaDe = (m8: string[] | undefined, extra: Parameters<typeof estadoM8>[0] = {}) => montarEntradaEscala(estadoM8({ m8, ...extra }), AGORA_VESPERA);
const cortar = (m8?: string[], extra: Parameters<typeof estadoM8>[0] = {}) => planejarSemanaComCorte(entradaDe(m8, extra).entrada, dados(), { fluxoMesmoPeriodo: false }, CFG);
// validador INDEPENDENTE com a cadeia COMPLETA do roteiro (inclui a etapa sem máquina): é o que as checagens do planejador não enxergavam
function violacoesCadeiaCompleta(m8: string[] | undefined, linhas: AlocacaoEscala[], pid: string) {
  const e = entradaDe(m8).entrada;
  const ps = [...e.pools, ...(e.poolsSemMaquina ?? [])].filter((p) => p.produtoId === pid).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
  const idx = new Map(e.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const plano: Record<string, number[]> = Object.fromEntries(ps.map((p) => [p.etapaId, new Array(e.slots.length).fill(0)]));
  linhas.filter((l) => l.maquinaId).forEach((l) => (distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId as string, etapaId: l.etapaId as string, pecas: l.pecas }]).filter((i) => i.produtoId === pid).forEach((i) => { plano[i.etapaId][idx.get(`${l.data}|${l.periodoId}`) as number] += i.pecas; }));
  return validarPlanoCadeia({ etapas: ps.map((p) => ({ id: p.etapaId, rotulo: p.etapaId })), wipInicial: new Array(ps.length - 1).fill(0), periodos: e.slots.map((s) => ({ rotulo: `${s.data} ${s.periodoId}`, duracaoMin: s.fimMin - s.inicioMin })) }, plano).violacoes.length;
}

describe("M8 desmarcada — cenário 1: baseline (M8 selecionada) é IDÊNTICO ao comportamento anterior", () => {
  it("legado e planejador de corte: hash do plano = golden-master pré-correção", () => {
    const e = entradaDe(undefined).entrada;
    expect(hashAlocacoes(gerarEscala(e).alocacoes)).toBe(GOLDEN_LEGADO);
    const r = cortar();
    expect(r.ok).toBe(true);
    expect(hashAlocacoes(r.resultado!.alocacoes)).toBe(GOLDEN_CORTE);
  });
  it("rota automática produz nas 3 etapas; cadeia completa válida; sem avisos de montagem", () => {
    const m = entradaDe(undefined);
    expect(m.avisos).toEqual([]);
    expect(m.entrada.poolsSemMaquina ?? []).toEqual([]);
    const r = cortar();
    expect(r.checagens.cadeiaInvalida).toBe(0);
    expect(pecas(r.resultado!.alocacoes, "pA")).toBeGreaterThan(0);
    expect(r.resultado!.alocacoes.some((l) => l.maquinaId === "m8")).toBe(true);
    expect(violacoesCadeiaCompleta(undefined, r.resultado!.alocacoes, "pA")).toBe(0);
  });
});

describe("M8 desmarcada — cenários 2 e 4: rota automática indisponível ⇒ produção ZERO, sem material infinito", () => {
  it("montarEntrada: etapas SEM ORIGEM saem do plano (não começam a cadeia); demanda fica registrada como sem máquina; aviso explícito", () => {
    const m = entradaDe([]);
    expect(m.entrada.pools.filter((p) => p.produtoId === "pA")).toEqual([]);
    expect((m.entrada.poolsSemMaquina ?? []).filter((p) => p.produtoId === "pA").map((p) => p.etapaId).sort()).toEqual(["a1", "a2", "a3"]);
    expect(m.avisos.some((a) => a.tipo === "etapa_sem_maquina" && a.etapaId === "a1")).toBe(true);
    expect(m.avisos.filter((a) => a.tipo === "etapa_sem_origem").map((a) => a.etapaId).sort()).toEqual(["a2", "a3"]);
    expect(m.entrada.pools.filter((p) => p.produtoId === "pC").length).toBe(4); // a rota convencional não é afetada
  });
  it("planejador de corte (corte-v1): Automática = 0 peça em TODAS as etapas, nenhuma linha Automática, Etiquetadora só para a convencional", () => {
    const r = cortar([]);
    expect(r.ok).toBe(true);
    const ls = r.resultado!.alocacoes;
    expect(pecas(ls, "pA")).toBe(0);
    expect(ls.some((l) => l.produtoId === "pA")).toBe(false);
    expect(ls.some((l) => l.maquinaId === "m8")).toBe(false);
    expect(violacoesCadeiaCompleta([], ls, "pA")).toBe(0);
    expect(pecas(ls, "pC")).toBeGreaterThan(0); // cenário 3: convencional segue produzindo
    expect(r.checagens.cadeiaInvalida).toBe(0);
    expect(r.checagens.violacoesDuras).toBe(0);
  });
  it("legado (gerarEscala) e fluxo (planejarComFluxo): Automática = 0 peça", () => {
    const e = entradaDe([]).entrada;
    expect(pecas(gerarEscala(e).alocacoes, "pA")).toBe(0);
    expect(pecas(planejarComFluxo(e, dados(), { fluxoMesmoPeriodo: false }).resultado.alocacoes, "pA")).toBe(0);
  });
  it("(3) convencional DISPONÍVEL: entrega o mesmo que entregaria com a M8 desmarcada em qualquer caminho (a rota some, a outra não é tocada)", () => {
    const comM8 = cortar();
    const semM8 = cortar([]);
    expect(pecas(semM8.resultado!.alocacoes, "pC")).toBeGreaterThanOrEqual(pecas(comM8.resultado!.alocacoes, "pC") - 1e-6);
  });
});

describe("M8 desmarcada — o que o recálculo oficial grava e avisa", () => {
  it("processarSemana (semana ativada no planejador de corte): plano sem produção Automática + alerta persistido de demanda NÃO atendida (4.000 peças)", async () => {
    const mundo = new Mundo(estadoM8({ m8: [] }));
    mundo.editar((e) => {
      e.producaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: [], apontamentos: [], mesmoPeriodo: false };
      e.planejadorCorte = { config: CFG, vigenteDoPlanejador: false, distribuicaoSuportada: true };
    });
    let payload: PayloadAplicacao | null = null;
    const io = mundo.io();
    const aplicar = io.aplicar;
    io.aplicar = async (p) => { payload = p; return aplicar(p); };
    mundo.relogioMs = AGORA_VESPERA;
    const r = await processarSemana(io, { agoraMs: AGORA_VESPERA, criarSeNaoExiste: true });
    expect(r.status).toBe("processado");
    expect(pecas(mundo.alocacoes, "pA")).toBe(0);
    expect(pecas(mundo.alocacoes, "pC")).toBeGreaterThan(0);
    const det = (payload!.resumo as unknown as { alertasDetalhe: { tipo: string; produtoId?: string; pecas?: number; motivo?: string }[] }).alertasDetalhe;
    const nao = det.filter((a) => a.tipo === "demanda_nao_atendida" && a.produtoId === "pA");
    expect(nao.length).toBe(1);
    expect(nao[0].pecas).toBe(4000);
    expect(nao[0].motivo).toMatch(/sem máquina/i);
  });
});

describe("contraste — M8 selecionada porém INDISPONÍVEL (parada) já funcionava: produção zero e demanda cortada", () => {
  it("corte-v1 com a M8 em maquinasIndisponiveisPrevisao", () => {
    const r = planejarSemanaComCorte(montarEntradaEscala(estadoM8({ indisponiveis: ["m8"] }), AGORA_VESPERA).entrada, dados(), { fluxoMesmoPeriodo: false }, CFG);
    expect(r.ok).toBe(true);
    expect(pecas(r.resultado!.alocacoes, "pA")).toBe(0);
    expect(r.saida!.porProduto.find((p) => p.produtoId === "pA")!.cortado).toBe(4000);
  });
});

void epochMsNoFuso;

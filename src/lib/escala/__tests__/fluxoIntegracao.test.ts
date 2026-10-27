// ESCALA INTELIGENTE (fluxo) — INTEGRAÇÃO com o recálculo oficial: modos desligado/sombra/ativo, gate de semana, fallback, idempotência do registro,
// reversão ativo→sombra→desligado, NO-OP e retry de conflito preservados. O núcleo é um STUB (injetado) — a prova de que `desligado` nunca o chama.
import { describe, it, expect } from "vitest";
import { gerarEscala } from "@/features/escala/gerarEscala";
import type { AvaliacaoPlano, DiagnosticoFluxo, ViolacaoDura } from "@/features/escala/fluxo/tipos";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { ConflitoDeVersaoError, type EstadoProducaoReal, type PayloadAplicacao } from "../estado";
import { processarSemana } from "../processar";
import { regiaoRecalculavel, type NucleoFluxo } from "../fluxo/integracao";
import { fluxoNoFechamento } from "../fluxo/fechamento";
import { CONFIG_FLUXO_PADRAO, lerConfigFluxo, lerParesLegado, modoEfetivoFluxo, semanasComFluxoAtivo } from "../fluxo/parametrosFluxo";
import { montarEntradaEscala } from "../montarEntrada";
import { Mundo, estadoDeTeste } from "./bancoMemoria";

const SEMANA = "2026-11-02";
const DIAS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const GERA = epochMsNoFuso(SEMANA, "05:00");
const AGORA = epochMsNoFuso("2026-11-03", "09:30"); // terça, M2 em andamento
const sig = (m: Mundo) => Mundo.assinatura(m.alocacoes, true);

const aval = (): AvaliacaoPlano => ({ versao: 1, produtos: [], totais: { faltaFinalLo: 10, faltaFinalHi: 5, finalEntregueLo: 0, finalEntregueHi: 0, faltaPonderada: 0, wipFinalLo: 0, wipFinalHi: 0, wipLegadoResidual: 0, excessoWip: 0, capacidadeGargalo: 0 }, trajetoria: [], postos: [], marginais: {}, diagnosticos: [] });
function diagFalso(): DiagnosticoFluxo {
  const dep = { produtoFinalPrevisto: { lo: 0, hi: 0 }, wipPrevisto: { lo: 0, hi: 0 }, faltaPrevista: { lo: 0, hi: 0 }, excessoWip: 0 };
  return {
    versao: 1, planoEscolhido: "fluxo", iteracaoEscolhida: 1, theta: 5,
    antes: { demandaRestante: {}, remLegado: {}, wip: [], gargalosFluxo: [], faltaFinal: { lo: 0, hi: 0 } }, decisoes: [], depois: dep, depoisBase: dep,
    churn: { linhasAlteradas: 0, trocasDePosto: 0, postosAlterados: 0, alteradasNoPrimeiroPeriodo: 0, retidasPorEstabilidade: 0 }, iteracoes: [], violacoes: [],
    estado: { versao: 1, agoraMs: 0, fechamentoMinutos: 10, ultimoFechado: -1, aPartirDe: 0, celulas: [], etapas: [], produtos: [], pares: [], projecao: { aPartirDe: 0, boas: {}, wip: {} }, demanda: [], remPorPool: {}, poolsFundidos: [], diagnosticos: [] },
    avaliacaoBase: aval(), avaliacaoFluxo: aval(), diagnosticos: [],
  };
}

interface CfgStub { marcar?: boolean; lancarPlanejar?: boolean; lancarAvaliar?: boolean; lancarVerificar?: boolean; violacoes?: ViolacaoDura[]; passado?: boolean }
function nucleoStub(cfg: CfgStub = {}) {
  const c = { planejar: 0, avaliar: 0, verificar: 0 };
  const nucleo: NucleoFluxo = {
    planejarComFluxo(entrada) {
      c.planejar++;
      if (cfg.lancarPlanejar) throw new Error("boom");
      const r = gerarEscala(entrada);
      let alocacoes = r.alocacoes;
      if (cfg.marcar) { const i = alocacoes.findIndex((a) => a.maquinaId); alocacoes = alocacoes.map((a, k) => (k === i ? { ...a, pecas: a.pecas + 0.5 } : a)); } // plano de fluxo DIFERENTE do oficial, porém válido
      if (cfg.passado && entrada.aPartirDe > 0) { const s0 = entrada.slots[0]; alocacoes = [...alocacoes, { data: s0.data, periodoId: s0.periodoId, funcionarioId: "fantasma", maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, motivoSemPosto: "x", excecaoRevezamento: false, motivoExcecao: null }]; }
      return { entradaFluxo: entrada, resultado: { ...r, alocacoes }, diagnostico: diagFalso() };
    },
    avaliarPlano() { c.avaliar++; if (cfg.lancarAvaliar) throw new Error("aval"); return aval(); },
    verificarRestricoesDuras() { c.verificar++; if (cfg.lancarVerificar) throw new Error("verif"); return cfg.violacoes ?? []; },
  };
  return { nucleo, c };
}

const prAtivo = (modoEfetivo: "sombra" | "ativo"): EstadoProducaoReal => ({ modoEfetivo, limiar: null, paresLegado: [], apontamentos: [] });
async function mundoBase(modo: "desligado" | "sombra" | "ativo") {
  const m = new Mundo(estadoDeTeste(SEMANA, DIAS));
  if (modo !== "desligado") m.editar((e) => { e.producaoReal = prAtivo(modo); });
  return m;
}
// referência: a Escala OFICIAL (sem fluxo nenhum)
async function referencia() {
  const m = await mundoBase("desligado");
  await m.recalcular(GERA, true);
  await m.recalcular(AGORA);
  return { m, assinatura: sig(m) };
}

describe("DESLIGADO: o núcleo do fluxo nunca é chamado e a saída é byte-idêntica", () => {
  it("sem estado.producaoReal: nenhum método do núcleo roda, nenhum registro, plano idêntico à referência", async () => {
    const ref = await referencia();
    const { nucleo, c } = nucleoStub({ marcar: true });
    const m = await mundoBase("desligado");
    const r1 = await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    const r2 = await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    expect(c).toEqual({ planejar: 0, avaliar: 0, verificar: 0 });
    expect(m.tentativasRegistroFluxo).toBe(0);
    expect(sig(m)).toBe(ref.assinatura);
    expect(r1.fluxo).toBeUndefined();
    expect(r2.fluxo).toBeUndefined();
  });
  it("o payload gravado não ganha nenhum campo do fluxo (resumo idêntico ao anterior)", async () => {
    const m = await mundoBase("desligado");
    const payloads: PayloadAplicacao[] = [];
    const io = m.io(); const orig = io.aplicar;
    io.aplicar = async (p) => { payloads.push(p); return orig(p); };
    m.relogioMs = GERA;
    await processarSemana(io, { agoraMs: GERA, criarSeNaoExiste: true, nucleoFluxo: nucleoStub().nucleo });
    expect(payloads).toHaveLength(1);
    expect("fluxo" in payloads[0].resumo).toBe(false);
  });
  it("NO-OP continua valendo com o fluxo desligado", async () => {
    const m = await mundoBase("desligado");
    await m.recalcular(GERA, true);
    await m.recalcular(AGORA);
    const ap = m.aplicacoes;
    const r = await m.recalcular(AGORA);
    expect(r.status).toBe("sem_alteracao");
    expect(m.aplicacoes).toBe(ap);
  });
});

describe("SOMBRA: calcula e registra, NUNCA altera a Escala oficial", () => {
  it("o plano gravado é exatamente o oficial (mesmo com um núcleo que proporia outro) e o diagnóstico é registrado", async () => {
    const ref = await referencia();
    const { nucleo, c } = nucleoStub({ marcar: true });
    const m = await mundoBase("sombra");
    const r1 = await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    const r2 = await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    expect(sig(m)).toBe(ref.assinatura);
    expect(c.planejar).toBeGreaterThanOrEqual(2);
    expect(c.avaliar).toBe(c.planejar); // oficial avaliado pelo MESMO simulador
    expect(c.verificar).toBe(c.planejar);
    expect(r1.fluxo).toMatchObject({ modo: "sombra", resultado: "ok", usado: false });
    expect(r2.fluxo).toMatchObject({ modo: "sombra", usado: false });
    expect(m.registrosFluxo.length).toBeGreaterThanOrEqual(2);
    m.registrosFluxo.forEach((r) => expect(r).toMatchObject({ modo: "sombra", aplicado: false, resultado: "ok", previsaoId: "prev1", semanaInicio: SEMANA }));
    expect(m.registrosFluxo[0].gatilho).toBe("manual"); // geração manual
    expect(m.registrosFluxo[1].gatilho).toBe("evento");
  });
  it("hash do plano oficial = região recalculável do plano que ficou gravado; hash do fluxo ≠ (plano proposto é outro)", async () => {
    const { nucleo } = nucleoStub({ marcar: true });
    const m = await mundoBase("sombra");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    const ultimo = m.registrosFluxo.at(-1)!;
    const { entrada } = montarEntradaEscala({ ...m.entradas, diasExistentes: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: d.snapshot })), alocacoes: m.alocacoes }, AGORA);
    expect(ultimo.hashPlanoOficial).toBe(hashAlocacoes(regiaoRecalculavel(entrada, m.alocacoes)));
    expect(ultimo.hashPlanoFluxo).not.toBe(ultimo.hashPlanoOficial);
  });
  it("falha do núcleo NUNCA impede o recálculo oficial: a Escala é gravada e o diagnóstico de erro fica registrado", async () => {
    const ref = await referencia();
    const { nucleo } = nucleoStub({ lancarPlanejar: true });
    const m = await mundoBase("sombra");
    const r = await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    expect(r.status).toBe("processado");
    expect(sig(m)).toBe(ref.assinatura);
    expect(m.registrosFluxo.length).toBeGreaterThan(0);
    m.registrosFluxo.forEach((x) => expect(x).toMatchObject({ resultado: "erro", aplicado: false }));
    expect(m.registrosFluxo[0].erro).toContain("boom");
  });
  it("falha só da avaliação/verificação: o diagnóstico sai com o aviso, sem erro fatal", async () => {
    const { nucleo } = nucleoStub({ lancarAvaliar: true, lancarVerificar: true });
    const m = await mundoBase("sombra");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    expect(m.registrosFluxo[0].resultado).toBe("ok");
    expect(JSON.stringify(m.registrosFluxo[0].diagnosticos)).toContain("ERRO_AVALIACAO_OFICIAL");
    expect(JSON.stringify(m.registrosFluxo[0].diagnosticos)).toContain("ERRO_VERIFICADOR");
  });
  it("falha do BANCO ao registrar também não impede o recálculo", async () => {
    const ref = await referencia();
    const m = await mundoBase("sombra");
    m.falharRegistroFluxo = true;
    const { nucleo } = nucleoStub();
    const r = await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    expect(r.status).toBe("processado");
    expect(sig(m)).toBe(ref.assinatura);
    expect(m.tentativasRegistroFluxo).toBeGreaterThan(0);
    expect(m.registrosFluxo).toHaveLength(0);
  });
  it("violações de hard constraint do plano de fluxo viram diagnóstico (a sombra não aplica nada de qualquer forma)", async () => {
    const v: ViolacaoDura = { tipo: "revezamento", data: "2026-11-03", periodoId: "m3", funcionarioId: "f01", detalhe: "x" };
    const { nucleo } = nucleoStub({ violacoes: [v] });
    const m = await mundoBase("sombra");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    expect(m.registrosFluxo[0].violacoes).toEqual([v]);
    expect(m.registrosFluxo[0].resultado).toBe("ok");
  });
  it("idempotência: o mesmo recálculo (NO-OP) registra de novo, mas o banco (chave única) não duplica", async () => {
    const { nucleo } = nucleoStub();
    const m = await mundoBase("sombra");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    const n = m.registrosFluxo.length, t = m.tentativasRegistroFluxo;
    const r = await m.recalcular(AGORA, false, { nucleoFluxo: nucleo }); // plano idêntico => sem_alteracao
    expect(r.status).toBe("sem_alteracao");
    expect(m.tentativasRegistroFluxo).toBe(t + 1);
    expect(m.registrosFluxo).toHaveLength(n); // mesmo (previsão, gatilho, hash entrada, hash plano fluxo, modo)
  });
  it("sombra no NO-OP: não toca a Escala (nenhuma versão sobe)", async () => {
    const { nucleo } = nucleoStub({ marcar: true });
    const m = await mundoBase("sombra");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    const ap = m.aplicacoes;
    await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    expect(m.aplicacoes).toBe(ap);
  });
});

describe("ATIVO: o recálculo oficial usa o plano de fluxo — com fallback, NO-OP, guarda de passado e retry preservados", () => {
  it("o plano de FLUXO é o gravado, o diagnóstico sai com aplicado=true e o resumo da versão carrega o fluxo", async () => {
    const ref = await referencia();
    const { nucleo, c } = nucleoStub({ marcar: true });
    const m = await mundoBase("ativo");
    const payloads: PayloadAplicacao[] = [];
    const io = m.io(); const orig = io.aplicar;
    io.aplicar = async (p) => { payloads.push(p); return orig(p); };
    m.relogioMs = GERA;
    const r = await processarSemana(io, { agoraMs: GERA, criarSeNaoExiste: true, nucleoFluxo: nucleo });
    m.relogioMs = AGORA;
    const r2 = await processarSemana(io, { agoraMs: AGORA, criarSeNaoExiste: false, nucleoFluxo: nucleo });
    expect(r.status).toBe("processado");
    expect(r2.fluxo).toMatchObject({ modo: "ativo", resultado: "ok", usado: true });
    expect(sig(m)).not.toBe(ref.assinatura); // o plano gravado é o do fluxo
    expect(c.planejar).toBe(2);
    const ult = m.registrosFluxo.at(-1)!;
    expect(ult).toMatchObject({ modo: "ativo", aplicado: true, resultado: "ok", gatilho: "evento" });
    expect(payloads.at(-1)!.resumo.fluxo).toMatchObject({ modo: "ativo", resultado: "ok", usado: true });
    expect(hashAlocacoes(m.alocacoes.filter((a) => a.pecas % 1 === 0.5))).toBeDefined();
  });
  it("cada exceção/violação/passado alterado => CAI para o motor oficial (plano idêntico ao oficial) e registra `fallback` com aplicado=false", async () => {
    const ref = await referencia();
    const casos: [string, CfgStub, string][] = [
      ["exceção do núcleo", { lancarPlanejar: true }, "planejarComFluxo falhou"],
      ["exceção do verificador", { lancarVerificar: true, marcar: true }, "verificarRestricoesDuras falhou"],
      ["violação de hard constraint", { violacoes: [{ tipo: "funcionario_ausente", data: "2026-11-03", periodoId: "m3", funcionarioId: "f01", detalhe: "x" }], marcar: true }, "violação"],
      ["passado alterado", { passado: true, marcar: true }, "passado"],
    ];
    for (const [nome, cfg, trecho] of casos) {
      const { nucleo } = nucleoStub(cfg);
      const m = await mundoBase("ativo");
      const r1 = await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
      const r2 = await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
      expect(r1.status, nome).toBe("processado");
      if (Mundo.assinatura(m.futuras(AGORA), true) !== Mundo.assinatura(ref.m.futuras(AGORA), true)) throw new Error(`[${nome}] o futuro gravado difere do oficial`); // a semana NUNCA fica sem plano e o plano é o oficial
      const reg = m.registrosFluxo.at(-1)!;
      expect(reg, nome).toMatchObject({ resultado: "fallback", aplicado: false, modo: "ativo" });
      expect(reg.erro ?? "", nome).toContain(trecho);
      expect(r2.fluxo, nome).toMatchObject({ resultado: "fallback", usado: false });
    }
  });
  it("violação: as violações ficam no diagnóstico", async () => {
    const v: ViolacaoDura = { tipo: "maquina_indisponivel", data: "2026-11-03", periodoId: "m3", maquinaId: "m1", detalhe: "x" };
    const { nucleo } = nucleoStub({ violacoes: [v], marcar: true });
    const m = await mundoBase("ativo");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    expect(m.registrosFluxo.at(-1)!.violacoes).toEqual([v]);
  });
  it("NO-OP preservado: plano de fluxo idêntico ao gravado => nenhuma versão sobe, nada regravado, diagnóstico `noop` com aplicado=false", async () => {
    const { nucleo } = nucleoStub({ marcar: true });
    const m = await mundoBase("ativo");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    const ap = m.aplicacoes, s0 = sig(m), v0 = JSON.stringify([...m.dias].map(([d, x]) => [d, x.versao]));
    const r = await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    expect(r.status).toBe("sem_alteracao");
    expect(m.aplicacoes).toBe(ap);
    expect(sig(m)).toBe(s0);
    expect(JSON.stringify([...m.dias].map(([d, x]) => [d, x.versao]))).toBe(v0);
    expect(r.fluxo).toMatchObject({ modo: "ativo", usado: true });
    const ult = m.registrosFluxo.at(-1)!;
    expect(ult.aplicado).toBe(false);
    expect(ult.replanejamento).toMatchObject({ aplicacao: "noop" });
  });
  it("guarda do passado preservada: corte em período já iniciado continua recusado pelo banco (ESCALA_CORTE_NO_PASSADO) e nada é registrado como aplicado", async () => {
    const { nucleo } = nucleoStub({ marcar: true });
    const m = await mundoBase("ativo");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    m.relogioMs = epochMsNoFuso("2026-11-06", "18:00"); // o relógio do BANCO já passou de toda a semana
    const aplicadosAntes = m.registrosFluxo.filter((r) => r.aplicado).length;
    const io = m.io();
    let erro = "";
    try { await processarSemana(io, { agoraMs: AGORA, criarSeNaoExiste: false, nucleoFluxo: nucleo }); } catch (e) { erro = e instanceof Error ? e.message : String(e); }
    expect(erro).toContain("ESCALA_CORTE_NO_PASSADO");
    expect(m.registrosFluxo.filter((r) => r.aplicado)).toHaveLength(aplicadosAntes);
  });
  it("retry por conflito de versão preservado: relê, replaneja e registra UMA vez, só depois de gravar", async () => {
    const { nucleo, c } = nucleoStub({ marcar: true });
    const m = await mundoBase("ativo");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    const antes = c.planejar;
    const io = m.io(); const orig = io.aplicar;
    let n = 0;
    io.aplicar = async (p) => { n++; if (n === 1) { expect(m.registrosFluxo.filter((r) => r.aplicado)).toHaveLength(1); throw new ConflitoDeVersaoError("ESCALA_VERSAO_CONFLITO"); } return orig(p); };
    m.relogioMs = AGORA;
    const nAntes = m.registrosFluxo.length;
    const r = await processarSemana(io, { agoraMs: AGORA, criarSeNaoExiste: false, nucleoFluxo: nucleo, maxTentativas: 3 });
    expect(r.tentativas).toBeGreaterThanOrEqual(2);
    expect(c.planejar - antes).toBeGreaterThanOrEqual(2); // replanejou com o estado relido
    expect(m.registrosFluxo.length - nAntes).toBeLessThanOrEqual(1); // o conflito não gerou registro "aplicado"
  });
  it("esgotadas as tentativas de conflito: o erro sobe (a outbox retenta) e nada foi registrado como aplicado", async () => {
    const { nucleo } = nucleoStub({ marcar: true });
    const m = await mundoBase("ativo");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    const io = m.io();
    io.aplicar = async () => { throw new ConflitoDeVersaoError("ESCALA_VERSAO_CONFLITO"); };
    const antes = m.registrosFluxo.length;
    let erro = "";
    try { await processarSemana(io, { agoraMs: AGORA, criarSeNaoExiste: false, nucleoFluxo: nucleo, maxTentativas: 2 }); } catch (e) { erro = (e as Error).name; }
    expect(erro).toBe("ConflitoDeVersaoError");
    expect(m.registrosFluxo).toHaveLength(antes);
  });
  it("gatilho `fechamento` e o período fechado ficam no diagnóstico", async () => {
    const { nucleo } = nucleoStub({ marcar: true });
    const m = await mundoBase("ativo");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    await m.recalcular(AGORA, false, { nucleoFluxo: nucleo, gatilhoFluxo: "fechamento", corteFluxo: { data: "2026-11-03", periodoId: "m1" } });
    const ult = m.registrosFluxo.at(-1)!;
    expect(ult.gatilho).toBe("fechamento");
    expect(ult.corte).toMatchObject({ data: "2026-11-03", periodoId: "m1", c: 6 });
  });
});

describe("REVERSÃO sem migration: ativo → sombra → desligado só mudando o modo", () => {
  it("ativo grava o plano de fluxo; ao voltar para sombra o PRÓXIMO recálculo devolve a Escala ao oficial; desligado deixa de chamar o núcleo", async () => {
    const ref = await referencia();
    const { nucleo, c } = nucleoStub({ marcar: true });
    const m = await mundoBase("ativo");
    await m.recalcular(GERA, true, { nucleoFluxo: nucleo });
    await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    const futuroOficial = Mundo.assinatura(ref.m.futuras(AGORA), true);
    expect(Mundo.assinatura(m.futuras(AGORA), true)).not.toBe(futuroOficial);
    // ativo -> sombra (o gatilho de parâmetros do banco pede o recálculo)
    m.editar((e) => { e.producaoReal = prAtivo("sombra"); });
    const r = await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    expect(r.status).toBe("processado");
    expect(Mundo.assinatura(m.futuras(AGORA), true)).toBe(futuroOficial); // o futuro volta ao oficial (o passado já ocorrido é imutável)
    expect(m.registrosFluxo.at(-1)).toMatchObject({ modo: "sombra", aplicado: false });
    // sombra -> desligado
    m.editar((e) => { delete e.producaoReal; });
    const chamadas = { ...c }, tent = m.tentativasRegistroFluxo;
    const r2 = await m.recalcular(AGORA, false, { nucleoFluxo: nucleo });
    expect(r2.status).toBe("sem_alteracao");
    expect(c).toEqual(chamadas);
    expect(m.tentativasRegistroFluxo).toBe(tent);
    expect(Mundo.assinatura(m.futuras(AGORA), true)).toBe(futuroOficial);
  });
});

describe("parâmetros: leitura defensiva e gate de semana", () => {
  const linhas = (o: Record<string, unknown>) => Object.entries(o).map(([chave, valor]) => ({ chave, valor }));
  it("padrão = desligado; valor desconhecido = desligado; limiar JSON null = derivado (não 0)", () => {
    expect(lerConfigFluxo([])).toEqual(CONFIG_FLUXO_PADRAO);
    expect(lerConfigFluxo(linhas({ producao_real_modo: "loucura" })).modo).toBe("desligado");
    expect(lerConfigFluxo(linhas({ producao_real_limiar_estabilidade: null })).limiar).toBeNull();
    expect(lerConfigFluxo(linhas({ producao_real_limiar_estabilidade: 12 })).limiar).toBe(12);
    expect(lerConfigFluxo(linhas({ producao_real_limiar_estabilidade: -1 })).limiar).toBeNull();
  });
  it("semanas anteriores a 2026-10-26 e datas inválidas nunca valem (defesa em profundidade)", () => {
    const c = lerConfigFluxo(linhas({ producao_real_modo: "ativo", producao_real_semanas_ativas: ["2026-10-19", "2026-10-26", "lixo", 5, "2026-11-02", "2026-11-02"] }));
    expect(c.semanasAtivas).toEqual(["2026-10-26", "2026-11-02"]);
  });
  it("modo efetivo: só a semana listada; fora dela = desligado; desligado global desliga tudo", () => {
    const c = lerConfigFluxo(linhas({ producao_real_modo: "ativo", producao_real_semanas_ativas: ["2026-11-02"] }));
    expect(modoEfetivoFluxo(c, "2026-11-02")).toBe("ativo");
    expect(modoEfetivoFluxo(c, "2026-11-09")).toBe("desligado");
    expect(modoEfetivoFluxo({ ...c, modo: "sombra" }, "2026-11-02")).toBe("sombra");
    expect(modoEfetivoFluxo({ ...c, modo: "desligado" }, "2026-11-02")).toBe("desligado");
    expect(semanasComFluxoAtivo(c)).toEqual(["2026-11-02"]);
    expect(semanasComFluxoAtivo({ ...c, modo: "sombra" })).toEqual([]);
  });
  it("pares legado: semente de PROD é aceita; par malformado é descartado (produto fica em comportamento legado)", () => {
    const semente = [{ id: "conector-3-4", produtoConvencionalId: "27c229d7-f192-41eb-aad1-0c69ece53eba", produtoAutomaticaId: "a027ac97-ffd1-4834-8ed0-d3a94aac4aee", etapasComuns: [
      { rotulo: "Etiquetar", etapaConvencionalId: "34371af3-2608-42cc-9ded-1f7815a635a8", etapaAutomaticaId: "1863b452-77f3-4d5c-9c49-a6d28ae77131" },
      { rotulo: "Embalar", etapaConvencionalId: "b3db9629-c3f8-46d8-b4dd-64c9a61a5bc4", etapaAutomaticaId: "fb96d08d-bd64-43d3-8694-40230c695c39" }] }];
    const pares = lerParesLegado(semente);
    expect(pares).toHaveLength(1);
    expect(pares[0].etapasComuns.map((e) => e.rotulo)).toEqual(["Etiquetar", "Embalar"]);
    expect(lerParesLegado([{ produtoConvencionalId: "x" }, null, 3, { produtoConvencionalId: "a", produtoAutomaticaId: "b", etapasComuns: [] }])).toEqual([]);
    expect(lerParesLegado({})).toEqual([]);
  });
});

describe("fechamento de período (fluxoNoFechamento)", () => {
  const ev = { data: "2026-11-03", periodoId: "m1" };
  async function estadoVivo(modo: "sombra" | "ativo" | null) {
    const m = await mundoBase("desligado");
    await m.recalcular(GERA, true);
    await m.recalcular(AGORA);
    const estado = { ...m.entradas, diasExistentes: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: d.snapshot })), alocacoes: m.alocacoes.map((a) => ({ ...a })), ...(modo ? { producaoReal: prAtivo(modo) } : {}) };
    return { m, estado };
  }
  it("desligado (sem producaoReal): não faz nada", async () => {
    const { estado } = await estadoVivo(null);
    let chamou = 0;
    const r = await fluxoNoFechamento({ nucleo: nucleoStub().nucleo, recalcular: async () => { chamou++; throw new Error("x"); }, registrar: async () => { chamou++; } }, { estado, ev, agoraMs: AGORA });
    expect(r).toBeNull();
    expect(chamou).toBe(0);
  });
  it("sombra: registra o diagnóstico (gatilho fechamento, corte = período fechado) e NÃO recalcula a Escala", async () => {
    const { estado } = await estadoVivo("sombra");
    const regs: unknown[] = [];
    let recalculou = 0;
    const r = await fluxoNoFechamento({ nucleo: nucleoStub().nucleo, recalcular: async () => { recalculou++; throw new Error("não"); }, registrar: async (x) => { regs.push(x); } }, { estado, ev, agoraMs: AGORA });
    expect(r).toMatchObject({ modo: "sombra", resultado: "ok" });
    expect(recalculou).toBe(0);
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({ gatilho: "fechamento", modo: "sombra", corte: { data: "2026-11-03", periodoId: "m1" } });
  });
  it("ativo: dispara o recálculo da semana pelo MESMO processarSemana com gatilho fechamento", async () => {
    const { estado } = await estadoVivo("ativo");
    let args: unknown = null;
    const r = await fluxoNoFechamento({ recalcular: async (o) => { args = o; return { status: "processado", tentativas: 1, alertas: [], alocacoesGravadas: 1, fluxo: { modo: "ativo", resultado: "fallback", usado: false } }; }, registrar: async () => { throw new Error("não"); } }, { estado, ev, agoraMs: AGORA });
    expect(r).toMatchObject({ modo: "ativo", resultado: "fallback", recalculo: "processado" });
    expect(args).toMatchObject({ gatilhoFluxo: "fechamento", corteFluxo: ev, criarSeNaoExiste: false });
  });
  it("nunca lança: falha vira resultado `erro`", async () => {
    const { estado } = await estadoVivo("ativo");
    const r = await fluxoNoFechamento({ recalcular: async () => { throw new Error("banco fora"); }, registrar: async () => {} }, { estado, ev, agoraMs: AGORA });
    expect(r).toMatchObject({ modo: "ativo", resultado: "erro", erro: "banco fora" });
  });
});

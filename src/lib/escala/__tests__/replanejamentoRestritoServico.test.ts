// REPLANEJAMENTO RESTRITO — serviço: portão (modo + semana), sombra primeiro, aplicação só do alterável, concorrência otimista,
// idempotência, reavaliação por evento e auditoria. O banco é simulado com as MESMAS regras da RPC escala_replanejamento_aplicar.
import { describe, it, expect } from "vitest";
import { hashAlocacoes } from "@/features/escala/horizonte";
import type { ModoReplanejamento } from "@/features/escala/parametros";
import { empacotarLinha } from "@/features/escala/snapshotSombra";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { AlocacaoEscala } from "@/features/escala/types";
import { ConflitoDeVersaoError, type EstadoBruto } from "../estado";
import type { VersaoPlanoOficial } from "../planoVersionado";
import { processarSombra, regiaoAlvoJaIniciada, type AplicacaoRestrita, type ApontamentoBanco, type DecisaoParaGravar, type EventoSombra, type RegistroAvaliacao, type SombraIO } from "../sombraServico";
import { estadoDeTeste, Mundo } from "./bancoMemoria";
import type { ConfigFluxo } from "../fluxo/parametrosFluxo";

const D1 = "2026-11-02";
const DIAS = [D1, "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const MIN = 60_000;
const ORD = ["m1", "m2", "m3", "t1", "t2", "t3"];
const AGORA_GERACAO = epochMsNoFuso("2026-10-30", "10:00");
const FIM = (p: string) => epochMsNoFuso(D1, { m1: "08:48", m2: "10:24", m3: "11:55", t1: "14:20", t2: "15:40", t3: "17:00" }[p] as string);
const idxPeriodo = (data: string, periodoId: string) => ORD.indexOf(periodoId) + 6 * DIAS.indexOf(data);
const idxSlot = (a: { data: string; periodoId: string }) => idxPeriodo(a.data, a.periodoId);

// semana com WIP flexível programado (adicional por etapa) e folga no fim: é onde o replanejamento tem o que ajustar
async function semana(pessoas = 14) {
  const e = estadoDeTeste(D1, DIAS, { pessoas });
  [2600, 2200, 1500, 1800].forEach((q, i) => (e.itens[i].quantidade = q));
  e.parametros = { wipModo: "ativo", wipDiasLimite: 2 };
  e.itens[0].adicionalPorEtapa = { eA1: 4000, eA2: 0 };
  e.itens[1].adicionalPorEtapa = { eB1: 3000, eB2: 0 };
  e.itens[3].adicionalPorEtapa = { eD1: 2500, eD2: 0 };
  const mundo = new Mundo(e);
  await mundo.recalcular(AGORA_GERACAO, true);
  return mundo;
}
const estadoDe = (m: Mundo): EstadoBruto => ({ ...m.entradas, diasExistentes: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: d.snapshot })), alocacoes: m.alocacoes.map((a) => ({ ...a })) });
const regiao = (m: Mundo, aPartir: number) => m.alocacoes.filter((a) => idxSlot(a) >= aPartir);
const ate = (m: Mundo, ultimo: number) => Mundo.assinatura(m.alocacoes.filter((a) => idxSlot(a) <= ultimo).sort((x, y) => (x.data + x.periodoId + x.funcionarioId < y.data + y.periodoId + y.funcionarioId ? -1 : 1)), true);

interface Auditoria { decisaoId: string | null; resultado: string; motivo: string; hashAntes?: string; hashDepois?: string; aPartir?: string }
class BancoRestrito implements SombraIO {
  modo: ModoReplanejamento = "ativo_restrito";
  semanas: string[] = [D1];
  eventos = new Map<string, EventoSombra>();
  decisoes: (DecisaoParaGravar & { id: string })[] = [];
  apontamentos: ApontamentoBanco[] = [];
  versoes: VersaoPlanoOficial[] = [];
  auditoria: Auditoria[] = [];
  aplicados = new Set<string>();
  chamadasAplicar = 0;
  aoGravarDecisao: (() => void) | null = null; // intervenção "humana/operacional" entre a decisão e a gravação
  agoraMs = 0;
  lerConfigFluxo?: SombraIO["lerConfigFluxo"]; // Escala Inteligente (fluxo): ausente = comportamento anterior
  aoFechamento?: SombraIO["aoFechamento"];
  constructor(public mundo: Mundo) { this.registrarVersao(AGORA_GERACAO); }
  registrarVersao(validoDesdeMs: number) {
    const e = this.mundo.entradas;
    this.versoes.push({
      id: `v${this.versoes.length + 1}`, previsaoId: "prev1", validoDesdeMs, origem: "trigger", hashPlano: `h${this.versoes.length + 1}`,
      dias: [...this.mundo.dias].map(([data, d]) => ({ data, versao: d.versao, periodos_snapshot: d.snapshot })), linhas: this.mundo.alocacoes.map((a) => empacotarLinha(a)),
      entrada: JSON.parse(JSON.stringify({ diasProdutivos: e.diasProdutivos, equipe: e.equipeProdutiva.map((x) => x.funcionarioId), maquinasIndisponiveisPrevisao: e.maquinasIndisponiveisPrevisao, itens: e.itens })),
    });
  }
  lancar(a: ApontamentoBanco) {
    this.apontamentos.push(a);
    const chave = `prev1|${a.data}|${a.periodoId}`;
    if (!this.eventos.has(chave)) this.eventos.set(chave, { id: chave, previsaoId: "prev1", data: a.data, periodoId: a.periodoId, status: "pendente", tentativas: 0 });
  }
  async lerModo() { return this.modo; }
  async lerSemanasAtivas() { return this.semanas; }
  async listarEventos() { return [...this.eventos.values()].filter((e) => e.status === "pendente"); }
  async versaoDoPlano(_p: string, emMs: number) { return [...this.versoes].filter((v) => v.validoDesdeMs <= emMs).sort((a, b) => b.validoDesdeMs - a.validoDesdeMs)[0] ?? null; }
  async carregar() { return { estado: estadoDe(this.mundo), apontamentos: this.apontamentos.map((a) => ({ ...a })) }; }
  async reivindicar(id: string) { const e = this.eventos.get(id)!; if (e.status !== "pendente") return false; e.status = "processando"; return true; }
  async proximaRevisao(_p: string, data: string, periodoId: string) { return Math.max(-1, ...this.decisoes.filter((d) => d.snapshot.identificacao.data === data && d.snapshot.identificacao.periodoId === periodoId).map((d) => d.revisao ?? 0)) + 1; }
  async gravarDecisao(d: DecisaoParaGravar) {
    const dup = this.decisoes.find((x) => x.snapshot.identificacao.data === d.snapshot.identificacao.data && x.snapshot.identificacao.periodoId === d.snapshot.identificacao.periodoId && (x.revisao ?? 0) === (d.revisao ?? 0));
    if (dup) return { inserida: false, id: dup.id };
    const id = `dec${this.decisoes.length + 1}`;
    this.decisoes.push({ ...d, id });
    if (this.aoGravarDecisao && (d.revisao ?? 0) >= 1) { const f = this.aoGravarDecisao; this.aoGravarDecisao = null; f(); } // só na 1ª decisão de aplicação
    return { inserida: true, id };
  }
  async concluir(id: string, status: "processado" | "ignorado" | "erro") { const e = this.eventos.get(id); if (e) e.status = status; }
  // === mesmas regras da RPC escala_replanejamento_aplicar ===
  async aplicarRestrito(a: AplicacaoRestrita) {
    this.chamadasAplicar++;
    if (this.modo !== "ativo_restrito" || !this.semanas.includes(a.corte.semanaInicio)) throw new Error("ESCALA_REPLAN_NAO_AUTORIZADO");
    if (this.aplicados.has(a.decisaoId)) throw new Error("ESCALA_REPLAN_JA_APLICADO");
    a.dias.forEach((d) => { if ((this.mundo.dias.get(d.data)?.versao ?? null) !== d.versao_base) throw new ConflitoDeVersaoError("ESCALA_VERSAO_CONFLITO: dia " + d.data); }); // nada é gravado
    const corte = a.alocacoes.length > 0 ? Math.min(...a.alocacoes.map(idxSlot)) : 99;
    const aPartir = idxPeriodo(a.aPartirDeData, a.aPartirDePeriodo);
    expect(corte).toBeGreaterThanOrEqual(aPartir);
    const hashAntes = hashAlocacoes(regiao(this.mundo, aPartir));
    this.mundo.alocacoes = this.mundo.alocacoes.filter((x) => idxSlot(x) < aPartir);
    a.alocacoes.forEach((x) => this.mundo.alocacoes.push({ ...x }));
    a.dias.forEach((d) => { this.mundo.dias.get(d.data)!.versao += 1; });
    this.registrarVersao(this.agoraMs);
    const hashDepois = hashAlocacoes(regiao(this.mundo, aPartir));
    this.aplicados.add(a.decisaoId);
    this.auditoria.push({ decisaoId: a.decisaoId, resultado: "aplicado", motivo: a.corte.motivo, hashAntes, hashDepois, aPartir: `${a.aPartirDeData} ${a.aPartirDePeriodo}` });
    return { id: `aud${this.auditoria.length}`, hashAntes, hashDepois, versoesAntes: {}, versoesDepois: {} };
  }
  async registrarAvaliacao(r: RegistroAvaliacao) { this.auditoria.push({ decisaoId: r.decisaoId, resultado: r.resultado, motivo: r.motivo, aPartir: r.aPartir ? `${r.aPartir.data} ${r.aPartir.periodoId}` : undefined }); }
  async reavaliacoesPendentes() {
    const ult = this.auditoria[this.auditoria.length - 1];
    if (!ult || !ult.aPartir) return [];
    const [data, periodoId] = ult.aPartir.split(" ");
    const aPartir = idxPeriodo(data, periodoId);
    const conhecido = ult.hashDepois ?? this.hashConhecido;
    const atual = hashAlocacoes(regiao(this.mundo, aPartir));
    return conhecido !== atual ? [{ previsaoId: "prev1", data: D1, periodoId: "m1" }] : [];
  }
  hashConhecido = "";
}

// apontamentos do período `p` do dia D1 com rendimento g, lançados em sequência logo após o fim do período
function lancarPeriodo(b: BancoRestrito, p: string, g: number, so: (a: AlocacaoEscala) => boolean = () => true) {
  const fim = FIM(p);
  b.mundo.alocacoes.filter((a) => a.data === D1 && a.periodoId === p && a.maquinaId && so(a)).forEach((a, i) => b.lancar({
    data: D1, periodoId: p, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId,
    quantidadeProduzida: Math.round((a.pecas + (a.pecasAdicional ?? 0)) * g), quantidadeRefugo: 0, meta: a.pecas + (a.pecasAdicional ?? 0), status: "produzindo", motivo: null, criadoEmMs: fim + 2 * MIN + i * 3_000, atualizadoEmMs: null,
  }));
}
const agoraDe = (p: string) => FIM(p) + 15 * MIN;

async function cenario(g = 0.55) {
  const m = await semana();
  const b = new BancoRestrito(m);
  lancarPeriodo(b, "m1", g);
  return { m, b };
}

describe("portão: só escreve em ativo_restrito + semana autorizada", () => {
  it("modo sombra: calcula a decisão, grava o snapshot e NÃO toca a Escala oficial", async () => {
    const { m, b } = await cenario();
    b.modo = "sombra";
    const antes = Mundo.assinatura(m.alocacoes, true);
    const r = await processarSombra(b, agoraDe("m1"));
    expect(r).toMatchObject({ modoEfetivo: "sombra", processadas: 1, aplicadas: 0 });
    expect(b.chamadasAplicar).toBe(0);
    expect(Mundo.assinatura(m.alocacoes, true)).toBe(antes);
    expect(b.decisoes).toHaveLength(1);
    expect(b.decisoes[0].modo).toBe("sombra");
    expect(b.decisoes[0].snapshot.diagnostico.restrito?.proposta).toBeTruthy(); // "o motor sugeriu X" já fica registrado
  });
  it("ativo_restrito com a semana NÃO autorizada: igual à sombra", async () => {
    const { m, b } = await cenario();
    b.semanas = ["2026-11-09"];
    const antes = Mundo.assinatura(m.alocacoes, true);
    const r = await processarSombra(b, agoraDe("m1"));
    expect(r.aplicadas).toBe(0);
    expect(b.chamadasAplicar).toBe(0);
    expect(Mundo.assinatura(m.alocacoes, true)).toBe(antes);
  });
  it("ativo (completo) continua sem efeito: tratado como sombra", async () => {
    const { m, b } = await cenario();
    b.modo = "ativo";
    const antes = Mundo.assinatura(m.alocacoes, true);
    const r = await processarSombra(b, agoraDe("m1"));
    expect(r.modoEfetivo).toBe("sombra");
    expect(b.chamadasAplicar).toBe(0);
    expect(Mundo.assinatura(m.alocacoes, true)).toBe(antes);
  });
});

describe("aplicação restrita: só o alterável, com sombra primeiro e auditoria", () => {
  it("(A) decisão no corte (revisão 0, sombra) → (B) decisão com o estado atual (revisão 1, ativo_restrito) → (C) grava só c+2 em diante → (D) registra o que mudou", async () => {
    const { m, b } = await cenario(0.5);
    const antesPassado = ate(m, 1); // m1 (executado) e m2 (comprometido)
    const antesFuturo = hashAlocacoes(regiao(m, 2));
    b.agoraMs = agoraDe("m1");
    const r = await processarSombra(b, agoraDe("m1"));
    expect(r.processadas).toBe(1);
    expect(b.decisoes[0]).toMatchObject({ revisao: 0, modo: "sombra" });
    expect(r.aplicadas).toBe(1);
    expect(b.decisoes[1]).toMatchObject({ revisao: 1, modo: "ativo_restrito", motivo: "fechamento" });
    expect(ate(m, 1)).toBe(antesPassado); // passado/atual e comprometido INTACTOS
    expect(b.auditoria.at(-1)).toMatchObject({ resultado: "aplicado" });
    expect(b.auditoria.at(-1)?.hashAntes).toBe(antesFuturo);
    expect(b.auditoria.at(-1)?.hashDepois).toBe(hashAlocacoes(regiao(m, 2)));
    expect(b.auditoria.at(-1)?.hashDepois).not.toBe(antesFuturo);
    expect(b.auditoria.at(-1)?.aPartir).toBe(`${D1} m3`);
    // rotação absoluta no plano resultante
    const porPessoa = new Map<string, AlocacaoEscala[]>();
    m.alocacoes.forEach((a) => porPessoa.set(a.funcionarioId, [...(porPessoa.get(a.funcionarioId) ?? []), a]));
    porPessoa.forEach((l) => l.sort((x, y) => idxSlot(x) - idxSlot(y)).forEach((a, i, arr) => {
      const ant = arr[i - 1];
      if (ant && a.data === ant.data && a.maquinaId && ant.maquinaId && a.operacaoId === ant.operacaoId) throw new Error("repetição de operação consecutiva");
    }));
    expect(m.alocacoes.every((a) => !a.excecaoRevezamento)).toBe(true);
  });
});

describe("concorrência otimista e idempotência", () => {
  it("se a Escala mudou entre a decisão e a gravação, NADA é sobrescrito: descarta, relê e recalcula com a versão nova", async () => {
    const { m, b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    let intervencao = 0;
    b.aoGravarDecisao = () => { intervencao++; m.dias.get(D1)!.versao += 1; b.registrarVersao(b.agoraMs - 1000); }; // outro evento alterou a Escala do dia
    const r = await processarSombra(b, agoraDe("m1"));
    expect(intervencao).toBe(1); // a corrida foi exercitada
    expect(r.aplicadas).toBe(1); // 1ª tentativa em conflito (nada gravado), 2ª sobre a versão nova
    const conflito = b.auditoria.find((x) => x.resultado === "conflito");
    expect(conflito).toBeTruthy();
    // a 1ª tentativa NÃO escreveu; a aplicação foi sobre a versão nova (decisão de revisão posterior)
    expect(b.auditoria.find((x) => x.resultado === "aplicado")).toBeTruthy();
    expect(b.decisoes.filter((d) => (d.revisao ?? 0) >= 1).length).toBeGreaterThanOrEqual(2);
    expect(b.chamadasAplicar).toBe(2);
    expect(b.auditoria.findIndex((x) => x.resultado === "conflito")).toBeLessThan(b.auditoria.findIndex((x) => x.resultado === "aplicado"));
  });
  it("a mesma decisão nunca é aplicada duas vezes (retry do evento, worker duplicado)", async () => {
    const { m, b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    await processarSombra(b, agoraDe("m1"));
    const aplicacoes = b.auditoria.filter((x) => x.resultado === "aplicado").length;
    expect(aplicacoes).toBe(1);
    const sig = Mundo.assinatura(m.alocacoes, true);
    b.eventos.forEach((e) => (e.status = "pendente")); // o evento "volta" (queda antes de concluir)
    const r2 = await processarSombra(b, agoraDe("m1"));
    expect(r2.duplicadas).toBe(1);
    expect(r2.aplicadas).toBe(0);
    expect(b.auditoria.filter((x) => x.resultado === "aplicado")).toHaveLength(aplicacoes);
    expect(Mundo.assinatura(m.alocacoes, true)).toBe(sig);
  });
  it("RPC simulada: nova aplicação da MESMA decisão é recusada (índice único)", async () => {
    const { b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    await processarSombra(b, agoraDe("m1"));
    const ap = b.auditoria.find((x) => x.resultado === "aplicado");
    expect(ap).toBeTruthy();
    if (!ap) return;
    await expect(b.aplicarRestrito({ previsaoId: "prev1", decisaoId: ap.decisaoId as string, corte: { semanaInicio: D1, data: D1, periodoId: "m1", slot: 0, revisao: 1, motivo: "x" }, dias: [], aPartirDeData: D1, aPartirDePeriodo: "m3", alocacoes: [], hashProposta: "", mudancas: { total: 0, resumo: {} as never, churn: {} as never, wip: {} as never, ganho: {} as never, amostra: [], reparoDoComprometido: false }, resumo: {} })).rejects.toThrow("JA_APLICADO");
  });
});

describe("reavaliação por evento", () => {
  it("quando a Escala oficial muda depois da avaliação (ausência, indisponibilidade...), o período mais recente é reavaliado — e só uma vez", async () => {
    const { m, b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    await processarSombra(b, agoraDe("m1"));
    const ult = b.auditoria.at(-1);
    expect(ult?.aPartir).toBeTruthy();
    if (!ult?.aPartir) return;
    const [data, periodoId] = ult.aPartir.split(" ");
    const aPartir = idxPeriodo(data, periodoId);
    b.hashConhecido = ult.hashDepois ?? hashAlocacoes(regiao(m, aPartir));
    // o oficial recalcula por causa de uma ausência: o futuro muda sem passar pelo replanejamento
    const alvo = m.alocacoes.find((a) => idxSlot(a) >= aPartir + 1 && a.maquinaId)!;
    m.entradas.ausencias.push({ funcionarioId: alvo.funcionarioId, data: alvo.data, horarioInicio: null, horarioFim: null });
    await m.recalcular(agoraDe("m1"));
    b.registrarVersao(agoraDe("m1"));
    const r = await processarSombra(b, agoraDe("m1") + MIN);
    expect(r.reavaliacoes).toBe(1);
    const depois = b.auditoria.length;
    // sem novo evento e sem novo ganho a reavaliar, nada se repete indefinidamente
    const hashAgora = hashAlocacoes(regiao(m, aPartir));
    b.hashConhecido = hashAgora;
    b.auditoria.push({ decisaoId: null, resultado: "sem_mudanca", motivo: "estado conhecido", hashDepois: hashAgora, aPartir: ult.aPartir });
    const r2 = await processarSombra(b, agoraDe("m1") + 2 * MIN);
    expect(r2.reavaliacoes).toBe(0);
    expect(b.auditoria.length).toBe(depois + 1);
  });
});

// ESCALA INTELIGENTE (fluxo) — INTERLOCK: nas semanas em que o fluxo é ATIVO o replanejamento restrito NÃO aplica (em sombra do fluxo, segue como está)
describe("interlock com o fluxo (producao_real_modo)", () => {
  const cfg = (modo: ConfigFluxo["modo"], semanas: string[]): ConfigFluxo => ({ modo, semanasAtivas: semanas, limiar: null, paresLegado: [] });
  it("fluxo ATIVO na semana: o restrito NÃO aplica (decisão sombra gravada, Escala intacta, parâmetro do restrito intocado)", async () => {
    const { m, b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    b.lerConfigFluxo = async () => cfg("ativo", [D1]);
    const antes = Mundo.assinatura(m.alocacoes, true);
    const r = await processarSombra(b, agoraDe("m1"));
    expect(r).toMatchObject({ processadas: 1, aplicadas: 0, interlockFluxo: [D1] });
    expect(b.chamadasAplicar).toBe(0);
    expect(b.modo).toBe("ativo_restrito"); // o parâmetro do restrito não é alterado
    expect(b.semanas).toEqual([D1]);
    expect(Mundo.assinatura(m.alocacoes, true)).toBe(antes);
    expect(b.decisoes).toHaveLength(1);
    expect(b.decisoes[0].modo).toBe("sombra");
  });
  it("fluxo ATIVO só em OUTRA semana: o restrito aplica normalmente na semana autorizada", async () => {
    const { b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    b.lerConfigFluxo = async () => cfg("ativo", ["2026-11-09"]);
    const r = await processarSombra(b, agoraDe("m1"));
    expect(r.aplicadas).toBe(1);
    expect(r.interlockFluxo).toEqual(["2026-11-09"]);
  });
  it("fluxo em SOMBRA (ou desligado): o restrito segue exatamente como está", async () => {
    for (const modo of ["sombra", "desligado"] as const) {
      const { b } = await cenario(0.5);
      b.agoraMs = agoraDe("m1");
      b.lerConfigFluxo = async () => cfg(modo, [D1]);
      const r = await processarSombra(b, agoraDe("m1"));
      expect(r.aplicadas).toBe(1);
      expect(r.interlockFluxo).toBeUndefined();
    }
  });
  it("sem configuração do fluxo (io antigo): resumo idêntico ao anterior, sem campos novos", async () => {
    const { b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    const r = await processarSombra(b, agoraDe("m1"));
    expect(r.aplicadas).toBe(1);
    expect(r.fluxo).toBeUndefined();
    expect(r.interlockFluxo).toBeUndefined();
  });
  it("a reavaliação por evento também respeita o interlock", async () => {
    const { m, b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    await processarSombra(b, agoraDe("m1")); // aplica uma vez
    m.dias.get(D1)!.versao += 1; // a Escala muda depois (evento)
    m.alocacoes = m.alocacoes.map((a, i) => (i === m.alocacoes.length - 1 ? { ...a, pecas: a.pecas + 1 } : a));
    const aplicadasAntes = b.auditoria.filter((x) => x.resultado === "aplicado").length;
    b.lerConfigFluxo = async () => cfg("sombra", [D1]); // controle: com o fluxo em sombra a reavaliação ocorre
    const controle = await processarSombra(b, agoraDe("m1") + 4 * MIN);
    expect(controle.reavaliacoes).toBe(1);
    m.dias.get(D1)!.versao += 1;
    m.alocacoes = m.alocacoes.map((a, i) => (i === m.alocacoes.length - 1 ? { ...a, pecas: a.pecas + 1 } : a));
    b.lerConfigFluxo = async () => cfg("ativo", [D1]);
    const aplicadasAntes2 = b.auditoria.filter((x) => x.resultado === "aplicado").length;
    const r = await processarSombra(b, agoraDe("m1") + 5 * MIN);
    expect(r.reavaliacoes).toBe(0);
    expect(b.auditoria.filter((x) => x.resultado === "aplicado")).toHaveLength(aplicadasAntes2);
    expect(aplicadasAntes2).toBeGreaterThanOrEqual(aplicadasAntes);
  });
  it("hook de fechamento: chamado 1x quando o fluxo está ligado; nunca com o fluxo desligado; falha do hook não muda o status do evento", async () => {
    const { b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    b.modo = "sombra";
    let chamadas = 0;
    b.aoFechamento = async () => { chamadas++; return { modo: "sombra", resultado: "erro", erro: "x" }; };
    b.lerConfigFluxo = async () => cfg("desligado", [D1]);
    await processarSombra(b, agoraDe("m1"));
    expect(chamadas).toBe(0);
    const { b: b2 } = await cenario(0.5);
    b2.agoraMs = agoraDe("m1");
    b2.modo = "sombra";
    b2.aoFechamento = b.aoFechamento;
    b2.lerConfigFluxo = async () => cfg("sombra", [D1]);
    const r = await processarSombra(b2, agoraDe("m1"));
    expect(chamadas).toBe(1);
    expect(r.fluxo).toMatchObject({ fechamentos: 1, erros: 1, semanasAtivas: [D1] });
    expect([...b2.eventos.values()][0].status).toBe("processado");
  });
  it("replanejamento DESLIGADO + fluxo ligado: o fechamento é detectado e o hook roda (sem proposta restrita, Escala intacta)", async () => {
    const { m, b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    b.modo = "desligado";
    let chamadas = 0;
    b.aoFechamento = async () => { chamadas++; return null; };
    b.lerConfigFluxo = async () => cfg("sombra", [D1]);
    const antes = Mundo.assinatura(m.alocacoes, true);
    const r = await processarSombra(b, agoraDe("m1"));
    expect(r.processadas).toBe(1);
    expect(chamadas).toBe(1);
    expect(b.chamadasAplicar).toBe(0);
    expect(Mundo.assinatura(m.alocacoes, true)).toBe(antes);
    expect(b.decisoes[0].snapshot.diagnostico.restrito).toBeUndefined();
  });
  it("replanejamento desligado + fluxo desligado: retorna cedo, sem tocar em nada (comportamento anterior)", async () => {
    const { b } = await cenario(0.5);
    b.modo = "desligado";
    b.lerConfigFluxo = async () => cfg("desligado", []);
    const r = await processarSombra(b, agoraDe("m1"));
    expect(r).toMatchObject({ modoEfetivo: "desligado", eventos: 0, processadas: 0 });
    expect(b.decisoes).toHaveLength(0);
  });
});
describe("reavaliação por evento: região-alvo já iniciada e invocações concorrentes", () => {
  // avalia m1 (aplica algo), muda a Escala oficial por uma ausência e devolve o banco pronto para a reavaliação por evento
  async function pendente() {
    const { m, b } = await cenario(0.5);
    b.agoraMs = agoraDe("m1");
    await processarSombra(b, agoraDe("m1"));
    const ult = b.auditoria.at(-1);
    expect(ult?.aPartir).toBeTruthy();
    const [data, periodoId] = (ult?.aPartir as string).split(" ");
    const aPartir = idxPeriodo(data, periodoId);
    b.hashConhecido = ult?.hashDepois ?? hashAlocacoes(regiao(m, aPartir));
    const alvo = m.alocacoes.find((a) => idxSlot(a) >= aPartir + 1 && a.maquinaId)!;
    m.entradas.ausencias.push({ funcionarioId: alvo.funcionarioId, data: alvo.data, horarioInicio: null, horarioFim: null });
    await m.recalcular(agoraDe("m1"));
    b.registrarVersao(agoraDe("m1"));
    return { m, b, tamanho: b.auditoria.length, decisoes: b.decisoes.length, aplicar: b.chamadasAplicar };
  }

  it("c+2 ainda não iniciou: reavalia normalmente (grava decisão nova)", async () => {
    const { b, decisoes } = await pendente();
    const r = await processarSombra(b, agoraDe("m1") + MIN);
    expect(r.reavaliacoes).toBe(1);
    expect(r.reavaliacoesDispensadas).toBe(0);
    expect(b.decisoes.length).toBeGreaterThan(decisoes);
  });

  it("c+2 (M3) já iniciou: NÃO roda o motor nem grava decisão; registra UMA recusa 'região já iniciada' com a região-alvo e não toca a Escala", async () => {
    const { m, b, tamanho, decisoes, aplicar } = await pendente();
    const antes = Mundo.assinatura(m.alocacoes, true);
    const r = await processarSombra(b, FIM("m2") + 6 * MIN); // M3 começou às 10:24
    expect(r.reavaliacoes).toBe(0);
    expect(r.reavaliacoesDispensadas).toBe(1);
    expect(r.recusadas).toBe(1);
    expect(b.decisoes.length).toBe(decisoes);
    expect(b.chamadasAplicar).toBe(aplicar);
    expect(Mundo.assinatura(m.alocacoes, true)).toBe(antes);
    expect(b.auditoria.length).toBe(tamanho + 1);
    const reg = b.auditoria.at(-1)!;
    expect(reg).toMatchObject({ decisaoId: null, resultado: "recusado", aPartir: `${D1} m3` });
    expect(reg.motivo).toContain("região já iniciada");
  });

  it("outra invocação já tratou o pendente enquanto esta carregava: não avalia nem registra de novo", async () => {
    const { b, tamanho, decisoes } = await pendente();
    let chamadas = 0;
    const original = b.reavaliacoesPendentes.bind(b);
    b.reavaliacoesPendentes = async () => (++chamadas === 1 ? original() : []); // 1ª leitura: pendente; na reconfirmação outro worker já registrou
    const r = await processarSombra(b, agoraDe("m1") + MIN);
    expect(r.reavaliacoes).toBe(0);
    expect(r.reavaliacoesDispensadas).toBe(0);
    expect(r.concorrencia).toBe(1);
    expect(b.decisoes.length).toBe(decisoes);
    expect(b.auditoria.length).toBe(tamanho);
  });
});

describe("regiaoAlvoJaIniciada", () => {
  it("só dispensa quando c+2 já começou (c+1 sozinho não basta: o reparo é avaliado)", async () => {
    const m = await semana();
    const estado = estadoDe(m);
    expect(regiaoAlvoJaIniciada(estado, { data: D1, periodoId: "m1" }, FIM("m1") + 15 * MIN)).toBeNull(); // M2 começa 08:48, M3 só 10:24
    expect(regiaoAlvoJaIniciada(estado, { data: D1, periodoId: "m1" }, FIM("m2") + MIN)).toMatchObject({ alvo: { data: D1, periodoId: "m3" }, slotOrigem: 0 });
    expect(regiaoAlvoJaIniciada(estado, { data: D1, periodoId: "m1" }, FIM("m2") - MIN)).toBeNull();
    expect(regiaoAlvoJaIniciada(estado, { data: D1, periodoId: "inexistente" }, FIM("m2") + MIN)).toBeNull();
    expect(regiaoAlvoJaIniciada(estado, { data: "2026-11-06", periodoId: "t3" }, epochMsNoFuso("2026-11-07", "10:00"))).toBeNull(); // fim da semana: não há c+2
  });
});


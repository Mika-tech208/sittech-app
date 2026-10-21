// FASE 4d — serviço do modo sombra: fechamento, evento lógico, concorrência/retry/idempotência, snapshot reproduzível, "sombra nunca altera o oficial".
import { describe, it, expect } from "vitest";
import { reproduzirSnapshot } from "@/features/escala/snapshotSombra";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { ModoReplanejamento } from "@/features/escala/parametros";
import type { EstadoBruto } from "../estado";
import { prepararDecisao, processarSombra, type ApontamentoBanco, type DecisaoParaGravar, type EventoSombra, type SombraIO } from "../sombraServico";
import { empacotarLinha } from "@/features/escala/snapshotSombra";
import type { VersaoPlanoOficial } from "../planoVersionado";
import { estadoDeTeste, Mundo } from "./bancoMemoria";

const D1 = "2026-10-19";
const D2 = "2026-10-20";
const MIN = 60_000;
const FIM_M1 = epochMsNoFuso(D1, "08:48");

async function semana(extra: (e: EstadoBruto) => void = () => {}) {
  const base = estadoDeTeste(D1, [D1, D2], { pessoas: 12 });
  extra(base);
  const mundo = new Mundo(base);
  await mundo.recalcular(epochMsNoFuso(D1, "05:00"), true);
  return mundo;
}
const estadoDe = (m: Mundo): EstadoBruto => ({ ...m.entradas, diasExistentes: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodosSnapshot: d.snapshot })), alocacoes: m.alocacoes.map((a) => ({ ...a })) });
const assinaturaOficial = (m: Mundo) => Mundo.assinatura([...m.alocacoes].sort((x, y) => (x.data + x.periodoId + x.funcionarioId < y.data + y.periodoId + y.funcionarioId ? -1 : 1)), true);

// Versão do plano oficial (como o banco grava: Escala + dias + Previsão) no instante `validoDesdeMs`
let seqVersao = 0;
function versaoDe(m: Mundo, validoDesdeMs: number, origem: "trigger" | "baseline" = "trigger"): VersaoPlanoOficial {
  const e = m.entradas;
  return {
    id: `v${++seqVersao}`, previsaoId: "prev1", validoDesdeMs, origem, hashPlano: `h${seqVersao}`,
    dias: [...m.dias].map(([data, d]) => ({ data, versao: d.versao, periodos_snapshot: d.snapshot })),
    linhas: m.alocacoes.map((a) => empacotarLinha(a)),
    entrada: JSON.parse(JSON.stringify({ diasProdutivos: e.diasProdutivos, equipe: e.equipeProdutiva.map((x) => x.funcionarioId), maquinasIndisponiveisPrevisao: e.maquinasIndisponiveisPrevisao, itens: e.itens })),
  };
}

// apontamentos fiéis ao plano oficial de (data, período), um por posto, a partir de `inicioMs` com passo `passoMs`
function apontamentosDe(m: Mundo, data: string, periodoId: string, quantos: number, inicioMs: number, passoMs = 10_000, g = 0.9): ApontamentoBanco[] {
  return m.alocacoes.filter((a) => a.data === data && a.periodoId === periodoId && a.maquinaId).slice(0, quantos).map((a, i) => ({
    data, periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId,
    quantidadeProduzida: Math.round(a.pecas * g), quantidadeRefugo: 0, meta: a.pecas, status: "produzindo", motivo: null, criadoEmMs: inicioMs + i * passoMs, atualizadoEmMs: null,
  }));
}

// banco de eventos em memória que reproduz o trigger (evento lógico por chave), a reivindicação atômica e a gravação idempotente
class BancoSombra implements SombraIO {
  modo: ModoReplanejamento = "sombra";
  eventos = new Map<string, EventoSombra & { lancamentos: number; tardios: number; erro: string | null }>();
  decisoes = new Map<string, DecisaoParaGravar>();
  apontamentos: ApontamentoBanco[] = [];
  versoes: VersaoPlanoOficial[] = [];
  falhasGravacao = 0;
  gravacoes = 0;
  carregamentos = 0;
  constructor(private mundo: Mundo, private previsaoId = "prev1") {}
  lancar(a: ApontamentoBanco) {
    this.apontamentos.push(a);
    const chave = `${this.previsaoId}|${a.data}|${a.periodoId}`;
    const ev = this.eventos.get(chave);
    if (!ev) this.eventos.set(chave, { id: chave, previsaoId: this.previsaoId, data: a.data, periodoId: a.periodoId, status: "pendente", tentativas: 0, lancamentos: 1, tardios: 0, erro: null });
    else if (ev.status === "processado") ev.tardios++;
    else ev.lancamentos++;
  }
  async lerModo() { return this.modo; }
  async listarEventos() { return [...this.eventos.values()].filter((e) => e.status === "pendente" || (e.status === "erro" && e.tentativas < 3)); }
  async versaoDoPlano(_p: string, emMs: number) { return [...this.versoes].filter((v) => v.validoDesdeMs <= emMs).sort((a, b) => b.validoDesdeMs - a.validoDesdeMs)[0] ?? null; }
  async carregar() { this.carregamentos++; return { estado: estadoDe(this.mundo), apontamentos: this.apontamentos.map((a) => ({ ...a })) }; }
  async reivindicar(id: string) {
    const e = this.eventos.get(id)!;
    if (!(e.status === "pendente" || (e.status === "erro" && e.tentativas < 3))) return false;
    e.status = "processando"; e.tentativas++;
    return true;
  }
  async gravarDecisao(d: DecisaoParaGravar) {
    this.gravacoes++;
    if (this.falhasGravacao > 0) { this.falhasGravacao--; throw new Error("queda simulada"); }
    const chave = `${d.previsaoId}|${d.snapshot.identificacao.data}|${d.snapshot.identificacao.periodoId}`;
    if (this.decisoes.has(chave)) return { inserida: false, id: chave };
    this.decisoes.set(chave, d);
    return { inserida: true, id: chave };
  }
  async concluir(id: string, status: "processado" | "ignorado" | "erro", erro: string | null = null) { const e = this.eventos.get(id)!; e.status = status; e.erro = erro; }
}

const T_GERACAO = epochMsNoFuso(D1, "05:00");
function novoBanco(m: Mundo): BancoSombra { const b = new BancoSombra(m); b.versoes.push(versaoDe(m, T_GERACAO)); return b; }

describe("fechamento + evento lógico", () => {
  it("20 lançamentos do mesmo período = UM evento lógico; enquanto aguarda, não reivindica nem consome tentativa", async () => {
    const m = await semana();
    const b = novoBanco(m);
    const aps = apontamentosDe(m, D1, "m1", 20, FIM_M1 - 6 * MIN, 5_000);
    aps.forEach((a) => b.lancar(a));
    expect(b.eventos.size).toBe(1);
    expect([...b.eventos.values()][0].lancamentos).toBe(aps.length);
    const r = await processarSombra(b, FIM_M1 + 5 * MIN); // ainda antes dos 10 min
    expect(r).toMatchObject({ eventos: 1, aguardando: 1, processadas: 0 });
    expect([...b.eventos.values()][0]).toMatchObject({ status: "pendente", tentativas: 0 });
    expect(b.gravacoes).toBe(0);
  });

  it("89% não fecha aos 10 min; ao completar 90% + 3 min de silêncio, fecha e a decisão registra a completude", async () => {
    const m = await semana();
    const b = novoBanco(m);
    const postos = m.alocacoes.filter((a) => a.data === D1 && a.periodoId === "m1" && a.maquinaId).length;
    const n89 = Math.ceil(postos * 0.9) - 1; // abaixo de 90%
    apontamentosDe(m, D1, "m1", n89, FIM_M1 - 4 * MIN).forEach((a) => b.lancar(a));
    expect((await processarSombra(b, FIM_M1 + 10 * MIN)).aguardando).toBe(1);
    const completo = apontamentosDe(m, D1, "m1", n89 + 1, FIM_M1 - 4 * MIN);
    b.lancar(completo[n89]);
    const r = await processarSombra(b, FIM_M1 + 15 * MIN);
    expect(r.processadas).toBe(1);
    const d = [...b.decisoes.values()][0].snapshot;
    expect(d.completude).toMatchObject({ dadosCompletos: true, motivoFechamento: "estavel", postosEsperados: postos, postosRecebidos: n89 + 1 });
    expect(d.identificacao.corteMs).toBeGreaterThanOrEqual(FIM_M1 + 10 * MIN);
    expect(d.identificacao.corteMs).toBeLessThanOrEqual(FIM_M1 + 15 * MIN);
  });

  it("aos 20 min processa INCOMPLETO e marca dados_completos = false, com faltantes e último lançamento", async () => {
    const m = await semana();
    const b = novoBanco(m);
    apontamentosDe(m, D1, "m1", 4, FIM_M1 - 3 * MIN).forEach((a) => b.lancar(a));
    expect((await processarSombra(b, FIM_M1 + 19 * MIN)).aguardando).toBe(1);
    const r = await processarSombra(b, FIM_M1 + 21 * MIN);
    expect(r.processadas).toBe(1);
    const c = [...b.decisoes.values()][0].snapshot.completude;
    expect(c).toMatchObject({ dadosCompletos: false, motivoFechamento: "prazo", postosRecebidos: 4 });
    expect(c.postosFaltantes.length).toBe(c.postosEsperados - 4);
    expect(c.percentual).toBeLessThan(90);
    expect(c.ultimoLancamentoMs).not.toBeNull();
    expect([...b.decisoes.values()][0].snapshot.identificacao.corteMs).toBe(FIM_M1 + 20 * MIN);
  });
});

describe("concorrência, retry e idempotência", () => {
  async function pronto() {
    const m = await semana();
    const b = novoBanco(m);
    apontamentosDe(m, D1, "m1", 99, FIM_M1 - 5 * MIN).forEach((a) => b.lancar(a));
    return { m, b };
  }
  it("dois workers ao mesmo tempo: uma única decisão (o outro perde a reivindicação)", async () => {
    const { b } = await pronto();
    const [x, y] = await Promise.all([processarSombra(b, FIM_M1 + 30 * MIN), processarSombra(b, FIM_M1 + 30 * MIN)]);
    expect(b.decisoes.size).toBe(1);
    expect(x.processadas + y.processadas).toBe(1);
    expect(x.concorrencia + y.concorrencia).toBeGreaterThanOrEqual(0);
    expect([...b.eventos.values()][0]).toMatchObject({ status: "processado", tentativas: 1 });
  });
  it("retry: falha na gravação => evento em erro (1 tentativa); a próxima rodada conclui; nunca duplica", async () => {
    const { b } = await pronto();
    b.falhasGravacao = 1;
    const r1 = await processarSombra(b, FIM_M1 + 30 * MIN);
    expect(r1).toMatchObject({ erros: 1, processadas: 0 });
    expect([...b.eventos.values()][0]).toMatchObject({ status: "erro", tentativas: 1 });
    const r2 = await processarSombra(b, FIM_M1 + 35 * MIN);
    expect(r2.processadas).toBe(1);
    expect([...b.eventos.values()][0]).toMatchObject({ status: "processado", tentativas: 2 });
    expect(b.decisoes.size).toBe(1);
  });
  it("idempotência: rodar de novo depois de concluído não faz nada", async () => {
    const { b } = await pronto();
    await processarSombra(b, FIM_M1 + 30 * MIN);
    const r = await processarSombra(b, FIM_M1 + 40 * MIN);
    expect(r).toMatchObject({ eventos: 0, processadas: 0 });
    expect(b.decisoes.size).toBe(1);
  });
  it("lançamento TARDIO só incrementa o evento: o snapshot gravado não muda e não nasce outra decisão", async () => {
    const { m, b } = await pronto();
    await processarSombra(b, FIM_M1 + 30 * MIN);
    const antes = JSON.stringify([...b.decisoes.values()][0].snapshot);
    b.lancar({ ...apontamentosDe(m, D1, "m1", 1, FIM_M1 + 50 * MIN)[0], quantidadeProduzida: 99999 });
    expect([...b.eventos.values()][0].tardios).toBe(1);
    await processarSombra(b, FIM_M1 + 60 * MIN);
    expect(b.decisoes.size).toBe(1);
    expect(JSON.stringify([...b.decisoes.values()][0].snapshot)).toBe(antes);
  });
  it("dado posterior ao corte (apontamentos, ausências, indisponibilidades) não altera a decisão recalculada do mesmo corte", async () => {
    const { m, b } = await pronto();
    const base = await prepararDecisao(estadoDe(m), b.apontamentos, { data: D1, periodoId: "m1" }, FIM_M1 + 30 * MIN, (ms) => b.versaoDoPlano("", ms));
    if (!base.pronto) throw new Error("deveria estar pronto");
    const futuro = [...b.apontamentos, ...apontamentosDe(m, D1, "m2", 99, FIM_M1 + 40 * MIN), { ...b.apontamentos[0], criadoEmMs: FIM_M1 + 45 * MIN, quantidadeProduzida: 7777 }];
    const est = estadoDe(m);
    est.ausencias = [{ funcionarioId: "f01", data: D1, horarioInicio: null, horarioFim: null, registradaEm: new Date(FIM_M1 + 50 * MIN).toISOString() }];
    est.indisponibilidades = [{ maquinaId: "m1", desde: new Date(FIM_M1 + 50 * MIN).toISOString(), liberadaEm: null }];
    const depois = await prepararDecisao(est, futuro, { data: D1, periodoId: "m1" }, FIM_M1 + 600 * MIN, (ms) => b.versaoDoPlano("", ms));
    if (!depois.pronto) throw new Error("deveria estar pronto");
    expect(depois.corteMs).toBe(base.corteMs);
    expect(depois.snapshot.hashes.decisao).toBe(base.snapshot.hashes.decisao);
    expect(depois.snapshot.hashes.entrada).toBe(base.snapshot.hashes.entrada);
  });
});

describe("modo e a Escala oficial", () => {
  it("desligado: não processa nada; ativo: tratado como sombra (falha segura) com aviso; a escala oficial NUNCA muda", async () => {
    const m = await semana();
    const b = novoBanco(m);
    apontamentosDe(m, D1, "m1", 99, FIM_M1 - 5 * MIN).forEach((a) => b.lancar(a));
    const antes = assinaturaOficial(m);
    const rec = m.recalculos;
    b.modo = "desligado";
    expect(await processarSombra(b, FIM_M1 + 30 * MIN)).toMatchObject({ modoEfetivo: "desligado", eventos: 0, processadas: 0 });
    expect(b.carregamentos).toBe(0);
    b.modo = "ativo";
    const r = await processarSombra(b, FIM_M1 + 30 * MIN);
    expect(r).toMatchObject({ modo: "ativo", modoEfetivo: "sombra", avisoAtivoNaoImplementado: true, processadas: 1 });
    expect([...b.decisoes.values()][0].snapshot.entradas.parametros.replanejamento).toBe("sombra");
    expect(assinaturaOficial(m)).toBe(antes);
    expect(m.recalculos).toBe(rec);
  });
});

describe("snapshot reproduzível e estável", () => {
  it("reproduzirSnapshot refaz a decisão SÓ com a entrada gravada e dá os mesmos hashes — inclusive depois de ir e voltar por JSON", async () => {
    const m = await semana();
    const b = novoBanco(m);
    apontamentosDe(m, D1, "m1", 99, FIM_M1 - 5 * MIN).forEach((a) => b.lancar(a));
    await processarSombra(b, FIM_M1 + 30 * MIN);
    const s = [...b.decisoes.values()][0].snapshot;
    const r = reproduzirSnapshot(s);
    expect(r.diferentes).toEqual([]);
    expect(r.igual).toBe(true);
    const s2 = JSON.parse(JSON.stringify(s));
    expect(reproduzirSnapshot(s2).igual).toBe(true);
    expect(s.hashes.planoSombra).toMatch(/^[0-9a-f]{64}$/);
    expect(s.hashes.decisao).toMatch(/^[0-9a-f]{64}$/);
  });
  it("mesma entrada => mesmo snapshot (execuções independentes); chaves em outra ordem => mesmo hash", async () => {
    const m = await semana();
    const b = novoBanco(m);
    apontamentosDe(m, D1, "m1", 99, FIM_M1 - 5 * MIN).forEach((a) => b.lancar(a));
    const a1 = await prepararDecisao(estadoDe(m), b.apontamentos, { data: D1, periodoId: "m1" }, FIM_M1 + 30 * MIN, (ms) => b.versaoDoPlano("", ms));
    const a2 = await prepararDecisao(estadoDe(m), [...b.apontamentos].reverse(), { data: D1, periodoId: "m1" }, FIM_M1 + 31 * MIN, (ms) => b.versaoDoPlano("", ms));
    if (!a1.pronto || !a2.pronto) throw new Error("prontos");
    expect(a2.snapshot.hashes).toEqual(a1.snapshot.hashes);
    expect(JSON.stringify(a2.snapshot.diagnostico)).toBe(JSON.stringify(a1.snapshot.diagnostico));
  });
  it("conteúdo mínimo: horizonte (atual/comprometido/1º alterável), compromisso original×reparado, entradas, planos e diagnóstico; tamanho contido", async () => {
    const m = await semana();
    const b = novoBanco(m);
    apontamentosDe(m, D1, "m1", 99, FIM_M1 - 5 * MIN).forEach((a) => b.lancar(a));
    await processarSombra(b, FIM_M1 + 30 * MIN);
    const s = [...b.decisoes.values()][0].snapshot;
    expect(s.horizonte.comprometido).toMatchObject({ data: D1, periodoId: "m2" });
    expect(s.horizonte.primeiroAlteravel).toMatchObject({ data: D1, periodoId: "m3" });
    expect(s.compromisso).toMatchObject({ statusOriginal: "compromisso_valido", statusApos: "compromisso_valido" });
    expect(s.compromisso.hashOriginal).toBe(s.compromisso.hashReparado);
    expect(s.diagnostico.situacao).toMatch(/^(OK|A|B→C|B→D)$/);
    expect(Object.keys(s.entradas.restantePorPool).length).toBeGreaterThan(0);
    expect(s.planos.proximosPeriodos.length).toBeGreaterThan(0);
    expect(JSON.stringify(s).length).toBeLessThan(250_000);
  });
  it("ausência registrada ANTES do corte entra na decisão (compromisso inviável detectado/reparado); registrada DEPOIS é ignorada", async () => {
    const m = await semana();
    const b = novoBanco(m);
    apontamentosDe(m, D1, "m1", 99, FIM_M1 - 5 * MIN).forEach((a) => b.lancar(a));
    const alvo = m.alocacoes.find((a) => a.data === D1 && a.periodoId === "m2" && a.maquinaId)!;
    const est = estadoDe(m);
    est.ausencias = [{ funcionarioId: alvo.funcionarioId, data: D1, horarioInicio: null, horarioFim: null, registradaEm: new Date(FIM_M1 - 60 * MIN).toISOString() }];
    const cedo = await prepararDecisao(est, b.apontamentos, { data: D1, periodoId: "m1" }, FIM_M1 + 30 * MIN, (ms) => b.versaoDoPlano("", ms));
    if (!cedo.pronto) throw new Error("pronto");
    expect(cedo.snapshot.compromisso.statusFisico).not.toBeNull();
    expect(cedo.snapshot.compromisso.statusOriginal).toBe("impossibilidade_fisica_detectada");
    expect(cedo.snapshot.compromisso.hashOriginal).not.toBe(cedo.snapshot.compromisso.hashReparado);
    est.ausencias = [{ ...est.ausencias[0], registradaEm: new Date(FIM_M1 + 25 * MIN).toISOString() }];
    const tarde = await prepararDecisao(est, b.apontamentos, { data: D1, periodoId: "m1" }, FIM_M1 + 30 * MIN, (ms) => b.versaoDoPlano("", ms));
    if (!tarde.pronto) throw new Error("pronto");
    expect(tarde.snapshot.compromisso.statusFisico).toBeNull();
  });
  it("linha editada DEPOIS do corte: usa-se a versão atual, mas a incerteza fica registrada no snapshot", async () => {
    const m = await semana();
    const b = novoBanco(m);
    apontamentosDe(m, D1, "m1", 99, FIM_M1 - 5 * MIN).forEach((a) => b.lancar(a));
    b.apontamentos[0].atualizadoEmMs = FIM_M1 + 90 * MIN;
    const r = await prepararDecisao(estadoDe(m), b.apontamentos, { data: D1, periodoId: "m1" }, FIM_M1 + 120 * MIN, (ms) => b.versaoDoPlano("", ms));
    if (!r.pronto) throw new Error("pronto");
    expect(r.snapshot.diagnostico.incertezas.apontamento_editado_apos_corte).toBe(1);
    expect(r.snapshot.diagnostico.avisos.join(" ")).toContain("editado(s) depois do corte"); // aviso legível, não só um contador
  });
});

// ---------- INTEGRIDADE TEMPORAL: a decisão histórica só usa o que existia no corte ----------
describe("HINDSIGHT — o plano oficial (e a Previsão) são os do corte, não os de quando o worker roda", () => {
  const EV = { data: D1, periodoId: "m1" };
  const iso = (ms: number) => new Date(ms).toISOString();

  async function cenario(mutar: (m: Mundo, tMud: number) => void | Promise<void>) {
    const m = await semana();
    const b = novoBanco(m);
    apontamentosDe(m, D1, "m1", 99, FIM_M1 - 5 * MIN).forEach((a) => b.lancar(a));
    const noPrazo = await prepararDecisao(estadoDe(m), b.apontamentos, EV, FIM_M1 + 30 * MIN, (ms) => b.versaoDoPlano("", ms)); // plano A (o único que existia)
    const tMud = FIM_M1 + 25 * MIN; // depois do corte (≈ +10 a +15 min)
    await mutar(m, tMud);
    b.versoes.push(versaoDe(m, tMud)); // o banco registra a versão B no instante da mudança
    const tarde = await prepararDecisao(estadoDe(m), b.apontamentos, EV, FIM_M1 + 300 * MIN, (ms) => b.versaoDoPlano("", ms)); // worker atrasado: lê com as versões
    const ingenuo = await prepararDecisao(estadoDe(m), b.apontamentos, EV, FIM_M1 + 300 * MIN, async () => b.versoes[b.versoes.length - 1]); // o bug antigo: "a Escala de agora"
    if (!noPrazo.pronto || !tarde.pronto || !ingenuo.pronto) throw new Error("os três deveriam estar prontos");
    return { m, b, noPrazo, tarde, ingenuo, tMud };
  }
  const igual = (a: { snapshot: { hashes: object } }, b: { snapshot: { hashes: object } }) => JSON.stringify(a.snapshot.hashes) === JSON.stringify(b.snapshot.hashes);

  it("recálculo automático da Escala depois do corte (Previsão mudou): snapshot usa A; B não contamina", async () => {
    const r = await cenario(async (m, t) => { m.editar((e) => { e.itens[0].quantidade += 3000; }); await m.recalcular(t); });
    expect(igual(r.tarde, r.noPrazo)).toBe(true);
    expect(r.tarde.snapshot.planoOficialRef?.versaoId).toBe(r.noPrazo.snapshot.planoOficialRef?.versaoId);
    expect(r.tarde.snapshot.planoOficialRef?.validoDesdeMs).toBe(T_GERACAO);
    expect(igual(r.ingenuo, r.noPrazo)).toBe(false); // prova de que o teste é sensível: ler a Escala de agora MUDARIA a decisão
    expect(r.ingenuo.snapshot.planoOficialRef?.versaoId).not.toBe(r.noPrazo.snapshot.planoOficialRef?.versaoId);
  });

  it("troca manual depois do corte não altera a decisão histórica", async () => {
    const r = await cenario((m) => {
      const fut = m.alocacoes.filter((a) => a.data === D1 && a.periodoId === "m3" && a.maquinaId);
      for (const x of fut) for (const y of fut) {
        if (x.funcionarioId >= y.funcionarioId || x.operacaoId === y.operacaoId) continue;
        try { m.trocarManual(D1, "m3", x.funcionarioId, y.funcionarioId); return; } catch { /* par bloqueado pela rotação: tenta outro */ }
      }
      throw new Error("nenhuma troca válida no cenário");
    });
    expect(r.m.alocacoes.some((a) => a.origem === "manual")).toBe(true);
    expect(igual(r.tarde, r.noPrazo)).toBe(true);
    expect(igual(r.ingenuo, r.noPrazo)).toBe(false);
  });

  it("ausência lançada depois do corte (e a Escala recalculada por causa dela) não altera a decisão", async () => {
    const r = await cenario(async (m, t) => {
      const alvo = m.alocacoes.find((a) => a.data === D1 && a.periodoId === "m3" && a.maquinaId)!;
      m.editar((e) => { e.ausencias.push({ funcionarioId: alvo.funcionarioId, data: D1, horarioInicio: null, horarioFim: null, registradaEm: iso(t) }); });
      await m.recalcular(t);
    });
    expect(igual(r.tarde, r.noPrazo)).toBe(true);
    expect(r.tarde.snapshot.compromisso.statusFisico).toBeNull();
    expect(igual(r.ingenuo, r.noPrazo)).toBe(false);
  });

  it("indisponibilidade lançada depois do corte (e a Escala recalculada) não altera a decisão", async () => {
    const r = await cenario(async (m, t) => {
      const alvo = m.alocacoes.find((a) => a.data === D1 && a.periodoId === "m3" && a.maquinaId)!;
      m.editar((e) => { e.indisponibilidades.push({ maquinaId: alvo.maquinaId as string, desde: iso(t), liberadaEm: null }); });
      await m.recalcular(t);
    });
    expect(igual(r.tarde, r.noPrazo)).toBe(true);
    expect(r.tarde.snapshot.entrada.indisponibilidades).toEqual([]);
    expect(igual(r.ingenuo, r.noPrazo)).toBe(false);
  });

  it("registra no snapshot qual versão do plano foi usada (id, validade, hash, versão dos dias, comprometido e futuro oficial relevante)", async () => {
    const m = await semana();
    const b = novoBanco(m);
    apontamentosDe(m, D1, "m1", 99, FIM_M1 - 5 * MIN).forEach((a) => b.lancar(a));
    const r = await prepararDecisao(estadoDe(m), b.apontamentos, EV, FIM_M1 + 30 * MIN, (ms) => b.versaoDoPlano("", ms));
    if (!r.pronto) throw new Error("pronto");
    const ref = r.snapshot.planoOficialRef!;
    expect(ref).toMatchObject({ versaoId: b.versoes[0].id, origem: "trigger", validoDesdeMs: T_GERACAO, corteMs: r.corteMs });
    expect([ref.comprometido?.data, ref.comprometido?.periodoId]).toEqual([D1, "m2"]);
    expect(ref.hashPlanoBanco).toBe(b.versoes[0].hashPlano);
    expect(ref.hashPlanoEscala).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(ref.versoesDias).sort()).toEqual([D1, D2]);
    expect(ref.futuroRelevante).toHaveLength(6);
    expect(ref.futuroRelevante[0].periodo).toBe(`${D1} m2`);
    expect(r.snapshot.hashes.planoOficial).toBeDefined();
  });

  it("sem versão do plano anterior ao fim/corte: IGNORA (nunca cai na Escala atual)", async () => {
    const m = await semana();
    const b = new BancoSombra(m); // só existe uma versão BASELINE criada DEPOIS do corte
    b.versoes.push(versaoDe(m, FIM_M1 + 40 * MIN, "baseline"));
    apontamentosDe(m, D1, "m1", 99, FIM_M1 - 5 * MIN).forEach((a) => b.lancar(a));
    const r = await processarSombra(b, FIM_M1 + 60 * MIN);
    expect(r).toMatchObject({ ignoradas: 1, processadas: 0, erros: 0 });
    expect(b.decisoes.size).toBe(0);
    expect([...b.eventos.values()][0]).toMatchObject({ status: "ignorado" });
    expect([...b.eventos.values()][0].erro).toContain("sem versão do plano");
  });

  it("Previsão alterada depois do corte também não contamina (equipe e máquinas indisponíveis da Previsão)", async () => {
    const r = await cenario(async (m, t) => { m.editar((e) => { e.equipeProdutiva = e.equipeProdutiva.slice(0, 8); e.maquinasIndisponiveisPrevisao = ["m1"]; }); await m.recalcular(t); });
    expect(igual(r.tarde, r.noPrazo)).toBe(true);
    expect(r.tarde.snapshot.entrada.funcionarios).toHaveLength(12);
    expect(r.tarde.snapshot.entrada.maquinasIndisponiveisPrevisao).toEqual([]);
  });
});

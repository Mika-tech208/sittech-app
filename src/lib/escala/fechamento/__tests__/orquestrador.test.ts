import { describe, expect, it } from "vitest";
import { abrirFechamento, confirmarFechamento, reprocessarFechamento, type ContextoFechamento, type FechamentoIO, type FechamentoSalvo, type ResultadoRecalculo, type SnapshotParaGravar } from "../orquestrador";
import type { BufferCatalogo, EntradaConfirmacao, EstadoFechamento, ModoFechamento } from "@/features/escala/fechamento/tipos";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";

const CV = "27c229d7", AU = "a027ac97";
const CAT: BufferCatalogo[] = [
  { id: "b1", chave: "c:r", rotulo: "Rosqueadas aguardando Parafusar", ordem: 1, pares: [{ produtoId: CV, etapaOrigemId: "rq", etapaSeguinteId: "pf", papel: "contabil" }] },
  { id: "b2", chave: "c:p", rotulo: "Parafusadas aguardando Etiquetar", ordem: 2, pares: [{ produtoId: CV, etapaOrigemId: "pf", etapaSeguinteId: "et", papel: "contabil" }, { produtoId: AU, etapaOrigemId: "m8", etapaSeguinteId: "ae", papel: "zero" }] },
  { id: "b3", chave: "c:e", rotulo: "Etiquetadas aguardando Embalar", ordem: 3, pares: [{ produtoId: CV, etapaOrigemId: "et", etapaSeguinteId: "em", papel: "contabil" }, { produtoId: AU, etapaOrigemId: "ae", etapaSeguinteId: "am", papel: "zero" }] },
];
const FIM = 1_000_000;
const ctx0 = (o: Partial<ContextoFechamento> = {}): ContextoFechamento => ({
  semanaInicio: "2026-11-02", previsaoId: "prev", periodo: { data: "2026-11-03", periodoId: "m2", rotulo: "M2", inicioMs: FIM - 5_760_000, fimMs: FIM, proximo: { data: "2026-11-03", periodoId: "m3", rotulo: "M3", inicioMs: FIM } },
  postos: [{ maquinaId: "x", nome: "Etiquetadora 15", status: "produzindo", produzido: 5000, refugo: 0, motivo: null }], obrigatorios: CAT,
  estimativas: [{ bufferId: "b1", estimado: 1900, lo: 1900, hi: 1900 }, { bufferId: "b2", estimado: 7122, lo: 7122, hi: 7122 }, { bufferId: "b3", estimado: 8600, lo: 8600, hi: 8600 }],
  periodoJaFechado: false, fechamentoVigente: null, hashPlanoAnterior: "f75d1ea0", resumoProducao: {}, tempoEntradaMs: 700, ...o,
});

class Fake implements FechamentoIO {
  modoAtual: ModoFechamento = "ativo";
  ctx = ctx0();
  fechamentos = new Map<string, FechamentoSalvo & { chave: string; contagens?: ContagemFisicaPar[]; aberturaId: string | null }>();
  log: { id: string; estado: EstadoFechamento; detalhe: Record<string, unknown> }[] = [];
  travas = new Set<string>();
  aberturas: { id: string; usuario: string; usada: boolean }[] = [];
  falharMotor: string | null = null;
  statusMotor: ResultadoRecalculo["status"] = "processado";
  filaRestante = 0;
  recalculos: { contagens: ContagemFisicaPar[] }[] = [];
  excecaoOk = false;
  trocarContexto: ((c: ContextoFechamento) => ContextoFechamento) | null = null;
  async modo() { return this.modoAtual; }
  async contexto() {
    const vig = [...this.fechamentos.values()].at(-1);
    const base = this.trocarContexto ? this.trocarContexto(this.ctx) : this.ctx;
    return { ...base, periodoJaFechado: !!vig, fechamentoVigente: vig ? { id: vig.id, estado: vig.estado } : null };
  }
  async podeExcecao() { return this.excecaoOk; }
  async abrir({ usuarioId, forcar }: { usuarioId: string; forcar: boolean }) {
    const aberta = this.aberturas.find((a) => !a.usada);
    if (aberta && aberta.usuario !== usuarioId && !forcar) throw new Error("FECHAMENTO_EM_ANDAMENTO: outro usuário já abriu o fechamento");
    if (aberta && aberta.usuario === usuarioId) return { aberturaId: aberta.id, validoAteMs: 1 };
    const a = { id: `ab${this.aberturas.length + 1}`, usuario: usuarioId, usada: false }; this.aberturas.push(a);
    return { aberturaId: a.id, validoAteMs: 1 };
  }
  async aberturaAtual(_d: string, _p: string, u: string) { return this.aberturas.find((a) => a.usuario === u && !a.usada)?.id ?? null; }
  async registrar(s: SnapshotParaGravar) {
    const ja = [...this.fechamentos.values()].find((f) => f.chave === s.chave);
    if (ja) return ja.id;
    if ([...this.fechamentos.values()].length > 0 && !s.forcarRevisao) throw new Error("FECHAMENTO_JA_EXISTE");
    const id = `f${this.fechamentos.size + 1}`;
    this.fechamentos.set(id, { id, data: s.contexto.periodo.data, periodoId: s.contexto.periodo.periodoId, semanaInicio: s.contexto.semanaInicio, previsaoId: "prev", estado: "RECALCULANDO", excecao: s.excecao, instanteMotorMs: s.instanteMotorMs, fechadoPor: s.usuarioId,
      buffers: s.excecao ? [] : s.entrada.buffers.map((b) => ({ bufferId: b.bufferId, fisico: b.fisico })), tentativas: 0, estadoEmMs: 0, chave: s.chave, aberturaId: s.aberturaId });
    const ab = this.aberturas.find((a) => a.id === s.aberturaId); if (ab) ab.usada = true;
    this.log.push({ id, estado: "RECALCULANDO", detalhe: {} });
    return id;
  }
  async travaAdquirir(semana: string) { if (this.travas.has(semana)) return false; this.travas.add(semana); return true; }
  async travaLiberar(semana: string) { this.travas.delete(semana); }
  async recalcular(a: { contagens: ContagemFisicaPar[] }): Promise<ResultadoRecalculo> {
    this.recalculos.push({ contagens: a.contagens });
    if (this.falharMotor) throw new Error(this.falharMotor);
    return { status: this.statusMotor, motivo: this.statusMotor === "bloqueado" ? "CADEIA_INVALIDA (1)" : null, hashPlanoNovo: "09663708", filaRestante: this.filaRestante, temposParciais: { entrada: 300, corte: 2500, validacao: 20, persistencia: 400 } };
  }
  async resultado(id: string, estado: EstadoFechamento, detalhe: Record<string, unknown>) {
    this.log.push({ id, estado, detalhe });
    const f = this.fechamentos.get(id); if (f) { f.estado = estado; f.tentativas += estado === "RECALCULANDO" ? 0 : 1; }
  }
  async carregarFechamento(id: string) { return this.fechamentos.get(id) ?? null; }
  async fechamentoPorChave(chave: string) { return [...this.fechamentos.values()].find((f) => f.chave === chave) ?? null; }
}

const U = "00000000-0000-0000-0000-0000000000a1", U2 = "00000000-0000-0000-0000-0000000000a2";
const entrada = (o: Partial<EntradaConfirmacao> = {}): EntradaConfirmacao => ({
  data: "2026-11-03", periodoId: "m2", chave: "11111111-1111-1111-1111-111111111111",
  buffers: [{ bufferId: "b1", fisico: 1200, motivo: "contagem anterior errada" }, { bufferId: "b2", fisico: 4800, motivo: "estoque comum Conv+M8" }, { bufferId: "b3", fisico: 9000 }], confirmouDiferencaGrande: true, ...o,
});
let t = FIM + 60_000;
const relogio = () => (t += 50);

describe("fluxo único: fechar → recalcular → confirmar", () => {
  it("fechamento normal ⇒ CONFIRMADO; contagens: Conv = total, Auto = 0, no fim do período; mede os tempos", async () => {
    const io = new Fake(); await abrirFechamento(io, { data: "2026-11-03", periodoId: "m2", usuarioId: U });
    const r = await confirmarFechamento(io, entrada(), U, relogio);
    expect(r).toMatchObject({ ok: true, estado: "CONFIRMADO", mensagem: "M3 CONFIRMADO", hashPlanoAnterior: "f75d1ea0", hashPlanoNovo: "09663708" });
    expect(r.tempos!.total).toBeGreaterThan(0); expect(r.tempos).toMatchObject({ entrada: 1000, corte: 2500, validacao: 20, persistencia: 400 });
    const c = io.recalculos[0].contagens;
    expect(c.find((x) => x.produtoId === CV && x.etapaOrigemId === "pf")!.saldo).toBe(4800);
    expect(c.find((x) => x.produtoId === AU && x.etapaOrigemId === "m8")!.saldo).toBe(0);
    expect(c.every((x) => x.contadoEmMs === FIM)).toBe(true);
    expect(io.log.map((l) => l.estado)).toEqual(["RECALCULANDO", "CONFIRMADO"]);
    expect(io.travas.size).toBe(0);
  });
  it("inventário muito diferente do estimado: sem confirmação em dois passos NÃO grava nada", async () => {
    const io = new Fake();
    const r = await confirmarFechamento(io, entrada({ confirmouDiferencaGrande: false, buffers: [{ bufferId: "b1", fisico: 1200, motivo: "contagem anterior errada" }, { bufferId: "b2", fisico: 750, motivo: "estoque comum Conv+M8" }, { bufferId: "b3", fisico: 9000 }] }), U, relogio);
    expect(r.ok).toBe(false); expect(r.exigeConfirmacao).toEqual(["b2"]); expect(io.fechamentos.size).toBe(0); expect(io.recalculos).toHaveLength(0);
  });
  it("campo faltando bloqueia antes de gravar", async () => {
    const io = new Fake();
    const r = await confirmarFechamento(io, entrada({ buffers: [{ bufferId: "b1", fisico: 1200, motivo: "abc" }, { bufferId: "b3", fisico: 9000 }] }), U, relogio);
    expect(r.ok).toBe(false); expect(r.erros.some((e) => e.codigo === "BUFFER_FALTANDO" && e.bufferId === "b2")).toBe(true); expect(io.fechamentos.size).toBe(0);
  });
  it("posto sem apontamento bloqueia o fechamento", async () => {
    const io = new Fake(); io.ctx = ctx0({ postos: [{ maquinaId: "x", nome: "Paf 10", status: "pendente", produzido: 0, refugo: 0, motivo: null }] });
    const r = await confirmarFechamento(io, entrada(), U, relogio);
    expect(r.erros.map((e) => e.codigo)).toContain("POSTOS_PENDENTES"); expect(io.fechamentos.size).toBe(0);
  });
  it("DUPLO CLIQUE (mesma chave): grava uma vez, recalcula uma vez, devolve o mesmo resultado", async () => {
    const io = new Fake();
    const [a, b] = [await confirmarFechamento(io, entrada(), U, relogio), await confirmarFechamento(io, entrada(), U, relogio)];
    expect(a.estado).toBe("CONFIRMADO"); expect(b).toMatchObject({ ok: true, duplicado: true, fechamentoId: a.fechamentoId });
    expect(io.fechamentos.size).toBe(1); expect(io.recalculos).toHaveLength(1);
  });
  it("DOIS USUÁRIOS: o segundo não consegue abrir a janela nem fechar o mesmo período", async () => {
    const io = new Fake();
    expect((await abrirFechamento(io, { data: "2026-11-03", periodoId: "m2", usuarioId: U })).ok).toBe(true);
    const segundo = await abrirFechamento(io, { data: "2026-11-03", periodoId: "m2", usuarioId: U2 });
    expect(segundo.ok).toBe(false); expect(segundo.erro).toMatch(/EM_ANDAMENTO/);
    await confirmarFechamento(io, entrada(), U, relogio);
    const r2 = await confirmarFechamento(io, entrada({ chave: "22222222-2222-2222-2222-222222222222" }), U2, relogio);
    expect(r2.ok).toBe(false); expect(r2.erros.map((e) => e.codigo)).toContain("PERIODO_JA_FECHADO"); expect(io.fechamentos.size).toBe(1);
  });
  it("DOIS RECÁLCULOS CONCORRENTES na mesma semana: o segundo não roda e o estoque fica salvo", async () => {
    const io = new Fake(); io.travas.add("2026-11-02");
    const r = await confirmarFechamento(io, entrada(), U, relogio);
    expect(r.ok).toBe(false); expect(r.estado).toBe("RECALCULANDO"); expect(r.mensagem).toMatch(/Estoque|salvo/i); expect(io.recalculos).toHaveLength(0); expect(io.fechamentos.size).toBe(1);
  });
  it("FILA com evento antigo não drenado ⇒ não confirma (ERRO_RECALCULO, estoque salvo); após drenar o retry confirma", async () => {
    const io = new Fake(); io.filaRestante = 2;
    const r = await confirmarFechamento(io, entrada(), U, relogio);
    expect(r.estado).toBe("ERRO_RECALCULO"); expect(r.erros[0].mensagem).toMatch(/fila de eventos/);
    io.filaRestante = 0;
    const r2 = await reprocessarFechamento(io, r.fechamentoId!, U, relogio);
    expect(r2).toMatchObject({ ok: true, estado: "CONFIRMADO" });
  });
  it("MOTOR FALHANDO ⇒ ERRO_RECALCULO com 'Estoque salvo. Programação ainda não gerada.'; inventário preservado", async () => {
    const io = new Fake(); io.falharMotor = "planejador lançou: orçamento de tempo estourado";
    const r = await confirmarFechamento(io, entrada(), U, relogio);
    expect(r).toMatchObject({ ok: false, estado: "ERRO_RECALCULO", mensagem: "Estoque salvo. Programação ainda não gerada." });
    expect(io.fechamentos.get(r.fechamentoId!)!.buffers.map((b) => b.fisico)).toEqual([1200, 4800, 9000]);
    expect(io.log.at(-1)!.detalhe.erro).toMatch(/orçamento/); expect(io.travas.size).toBe(0);
  });
  it("RETRY seguro: usa o inventário já gravado (sem pedir a contagem de novo) e CONFIRMA; chamar de novo é idempotente", async () => {
    const io = new Fake(); io.falharMotor = "x";
    const r = await confirmarFechamento(io, entrada(), U, relogio);
    io.falharMotor = null;
    const r2 = await reprocessarFechamento(io, r.fechamentoId!, U, relogio);
    expect(r2).toMatchObject({ ok: true, estado: "CONFIRMADO" });
    expect(io.recalculos[1].contagens.find((x) => x.produtoId === CV && x.etapaOrigemId === "pf")!.saldo).toBe(4800);
    expect((await reprocessarFechamento(io, r.fechamentoId!, U, relogio)).duplicado).toBe(true);
    expect(io.recalculos).toHaveLength(2);
  });
  it("portão HARD recusou (bloqueado) ⇒ ERRO_RECALCULO e nenhuma publicação; mensagem clara", async () => {
    const io = new Fake(); io.statusMotor = "bloqueado";
    const r = await confirmarFechamento(io, entrada(), U, relogio);
    expect(r.estado).toBe("ERRO_RECALCULO"); expect(r.erros[0].mensagem).toMatch(/CADEIA_INVALIDA/);
  });
  it("exceção (sem contagem): só com permissão + motivo; nenhuma contagem vai ao motor", async () => {
    const io = new Fake();
    const sem = await confirmarFechamento(io, entrada({ buffers: [], excecao: { motivo: "galpão interditado" }, chave: "33333333-3333-3333-3333-333333333333" }), U, relogio);
    expect(sem.erros.map((e) => e.codigo)).toContain("EXCECAO_SEM_PERMISSAO");
    io.excecaoOk = true;
    const ok = await confirmarFechamento(io, entrada({ buffers: [], excecao: { motivo: "galpão interditado" }, chave: "33333333-3333-3333-3333-333333333333" }), U, relogio);
    expect(ok.ok).toBe(true); expect(io.recalculos[0].contagens).toEqual([]);
    expect(io.log.at(-1)!.detalhe.excecao).toBe(true);
  });
  it("modo desligado: nada acontece; sombra: grava e confirma SEM chamar o motor", async () => {
    const io = new Fake(); io.modoAtual = "desligado";
    expect((await confirmarFechamento(io, entrada(), U, relogio)).mensagem).toMatch(/desligado/); expect(io.fechamentos.size).toBe(0);
    io.modoAtual = "sombra";
    const r = await confirmarFechamento(io, entrada(), U, relogio);
    expect(r.ok).toBe(true); expect(io.recalculos).toHaveLength(0); expect(io.log.at(-1)!.detalhe.sombra).toBe(true);
  });
  it("fechamentos consecutivos M1→M2→M3: cada um confirma o seguinte e gera 3 históricos independentes", async () => {
    const io = new Fake();
    for (const [p, prox, i] of [["m1", "M2", 1], ["m2", "M3", 2], ["m3", "T1", 3]] as const) {
      io.fechamentos.clear(); // cada período é um fechamento próprio (fake guarda um por vez)
      io.trocarContexto = (c) => ({ ...c, periodo: { ...c.periodo, periodoId: p, proximo: { ...c.periodo.proximo!, rotulo: prox } } });
      const r = await confirmarFechamento(io, entrada({ periodoId: p, chave: `1111111${i}-1111-1111-1111-111111111111` }), U, relogio);
      expect(r.mensagem).toBe(`${prox} CONFIRMADO`);
    }
    expect(io.log.filter((l) => l.estado === "CONFIRMADO")).toHaveLength(3);
  });
  it("último período da semana: fecha sem próximo período", async () => {
    const io = new Fake(); io.ctx = ctx0({ periodo: { ...ctx0().periodo, proximo: null } });
    expect((await confirmarFechamento(io, entrada(), U, relogio)).mensagem).toMatch(/último da semana/);
  });
  it("tempos: o total inclui gravação + entrada + corte + validação + persistência (SLA medido)", async () => {
    const io = new Fake(); const r = await confirmarFechamento(io, entrada(), U, relogio);
    const x = r.tempos!; expect(x.gravacao + x.entrada + x.corte + x.validacao + x.persistencia).toBeLessThanOrEqual(x.total + 4000);
    expect(io.log.at(-1)!.detalhe.tempos_ms).toEqual(x);
  });
});

import { describe, expect, it } from "vitest";
import type { PostoFechamento } from "@/features/escala/fechamento/tipos";
import { aplicarVinculosAosPostos, type ApontamentosIO } from "../apontamentoSimplificado";
import { acaoApontamentosEstado, acaoApontamentosSalvar } from "../httpApontamentos";
import { abrirFechamento, confirmarFechamento, type ContextoFechamento, type FechamentoIO } from "../orquestrador";
import { acaoAbrir, acaoConfirmar, type UsuarioFechamento } from "../http";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FECHA: UsuarioFechamento = { id: "u1", papel: "usuario", permissoes: ["escala_fechamento"] };
const SEM: UsuarioFechamento = { id: "u2", papel: "usuario", permissoes: ["producao_real_apontamento"] };
const post = (maquinaId: string, nome: string, status: PostoFechamento["status"]): PostoFechamento => ({ maquinaId, nome, status, produzido: status === "produzindo" ? 100 : 0, refugo: 0, motivo: null });
const nome = (id: string) => ({ m3: "Rosqueadeira 3", m10: "Parafusadeira 10" })[id as "m3"] ?? id;

describe("integração com os postos do fechamento (contrato existente: pendente | produzindo | sem_producao)", () => {
  it("posto programado realizado em OUTRA máquina fica resolvido (sem_producao + 'realizado em X'); o resto é intocado", () => {
    const postos = [post("m3", "Rosqueadeira 3", "pendente"), post("m6", "Rosqueadeira 6", "pendente"), post("m10", "Parafusadeira 10", "produzindo")];
    const r = aplicarVinculosAosPostos(postos, [{ maquinaPlanejadaId: "m3", maquinaRealId: "m10", origem: "PROGRAMADO", divergencias: ["MAQUINA"], naoProduziu: false, motivo: null }], nome);
    expect(r.postos.map((p) => p.status)).toEqual(["sem_producao", "pendente", "produzindo"]);
    expect(r.postos[0].motivo).toBe("realizado em Parafusadeira 10");
    expect(postos[0].status).toBe("pendente");                          // entrada não é mutada
    expect(r.resumo).toMatchObject({ vinculos: 1, nao_planejados: 0, com_divergencia: [{ maquina_planejada_id: "m3", maquina_real_id: "m10", divergencias: ["MAQUINA"] }] });
  });
  it("vínculo na mesma máquina (ou extra) não altera nenhum status", () => {
    const postos = [post("m3", "R3", "pendente")];
    const r = aplicarVinculosAosPostos(postos, [{ maquinaPlanejadaId: "m3", maquinaRealId: "m3", origem: "PROGRAMADO", divergencias: [], naoProduziu: true, motivo: "PARADA" }, { maquinaPlanejadaId: null, maquinaRealId: "m15", origem: "POSTO_NAO_PLANEJADO", divergencias: [], naoProduziu: false, motivo: null }], nome);
    expect(r.postos[0].status).toBe("pendente");
    expect(r.resumo).toMatchObject({ vinculos: 2, nao_planejados: 1, nao_produziu: 1 });
  });
});

// mini-FechamentoIO: só o necessário para validar/gravar
function fakeIO(postos: PostoFechamento[]) {
  const ctx: ContextoFechamento = {
    semanaInicio: "2026-11-02", previsaoId: "p", periodo: { data: "2026-11-03", periodoId: "m2", rotulo: "M2", inicioMs: 0, fimMs: 1_000_000, proximo: { data: "2026-11-03", periodoId: "m3", rotulo: "M3", inicioMs: 1_000_000 } },
    postos, obrigatorios: [], estimativas: [], periodoJaFechado: false, fechamentoVigente: null, hashPlanoAnterior: "h", resumoProducao: {}, tempoEntradaMs: 1,
  };
  const gravados: string[] = [];
  const io = {
    modo: async () => "ativo", contexto: async () => ctx, fechamentoPorChave: async () => null, podeExcecao: async () => false, aberturaAtual: async () => null,
    abrir: async () => ({ aberturaId: "ab", validoAteMs: 1 }),
    registrar: async () => { gravados.push("registrar"); return "f1"; }, travaAdquirir: async () => true, travaLiberar: async () => undefined,
    recalcular: async () => ({ status: "processado", motivo: null, hashPlanoNovo: "n", temposParciais: { entrada: 1, corte: 1, validacao: 1, persistencia: 1 }, filaRestante: 0 }),
    resultado: async () => undefined, carregarFechamento: async () => null,
  } as unknown as FechamentoIO;
  return { io, gravados };
}
const CH = "11111111-2222-3333-4444-555555555555";

describe("orquestrador/HTTP do fechamento com o apontamento simplificado (sem mudar o contrato)", () => {
  it("abrir: tem_pendentes continua refletindo os postos programados sem apontamento", async () => {
    const { io } = fakeIO([post("m3", "Rosqueadeira 3", "pendente"), post("m10", "Parafusadeira 10", "sem_producao")]);
    const r = await acaoAbrir(io, FECHA, { data: "2026-11-03", periodo_id: "m2" });
    expect(r.corpo).toMatchObject({ ok: true, tem_pendentes: true });
  });
  it("confirmar: posto programado sem produzido nem NÃO PRODUZIU BLOQUEIA (POSTOS_PENDENTES, 422) e nada é gravado", async () => {
    const { io, gravados } = fakeIO([post("m3", "Rosqueadeira 3", "pendente")]);
    const r = await acaoConfirmar(io, FECHA, { data: "2026-11-03", periodo_id: "m2", chave: CH, buffers: [] });
    expect(r.status).toBe(422);
    expect((r.corpo.erros as { codigo: string }[])[0].codigo).toBe("POSTOS_PENDENTES");
    expect(gravados).toEqual([]);
  });
  it("confirmar: todos produzindo OU sem_producao (NÃO PRODUZIU com motivo) OU realizado em outra máquina → fecha", async () => {
    const ajustado = aplicarVinculosAosPostos([post("m3", "R3", "pendente"), post("m6", "R6", "sem_producao"), post("m10", "P10", "produzindo")], [{ maquinaPlanejadaId: "m3", maquinaRealId: "m10", origem: "PROGRAMADO", divergencias: ["MAQUINA"], naoProduziu: false, motivo: null }], nome).postos;
    const { io, gravados } = fakeIO(ajustado);
    const r = await acaoConfirmar(io, FECHA, { data: "2026-11-03", periodo_id: "m2", chave: CH, buffers: [] });
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ ok: true, estado: "CONFIRMADO" });
    expect(gravados).toEqual(["registrar"]);
  });
  it("extras (máquina fora da escala) nunca entram nos postos esperados: o contexto só lista máquinas do plano", async () => {
    const { io } = fakeIO([post("m3", "R3", "produzindo")]);
    const r = await confirmarFechamento(io, { data: "2026-11-03", periodoId: "m2", chave: CH, buffers: [] }, "u1");
    expect(r.ok).toBe(true);
    await expect(abrirFechamento(io, { data: "2026-11-03", periodoId: "m2", usuarioId: "u1" })).resolves.toMatchObject({ ok: true });
  });
});

function fakeApIO(o: Partial<ApontamentosIO> & { modoAtual?: "ativo" | "desligado" } = {}) {
  const chamadas: string[] = [];
  const io: ApontamentosIO = {
    modo: async () => o.modoAtual ?? "ativo",
    carregar: o.carregar ?? (async () => { chamadas.push("carregar"); return { postos: [], catalogo: { maquinas: [], funcionarios: [], produtos: [], operacoes: {}, elegibilidade: [] }, existentes: [], vinculos: [] }; }),
    salvar: o.salvar ?? (async (_d, _p, ls) => { chamadas.push(`salvar:${ls.length}`); return { substituidas: 0, linhas: [] }; }),
  };
  return { io, chamadas };
}
const LINHA = { chave: U(1), maquina_planejada_id: U(2), maquina_id: U(2), produto_id: U(3), funcionario_id: U(4), produzido: 10, refugo: 0, nao_produziu: false };

describe("HTTP do apontamento simplificado", () => {
  it("estado: flag desligada => só { modo } (a tela usa o fluxo anterior) e nada é carregado", async () => {
    const { io, chamadas } = fakeApIO({ modoAtual: "desligado" });
    expect(await acaoApontamentosEstado(io, FECHA, "2026-11-03", "m2")).toEqual({ status: 200, corpo: { modo: "desligado" } });
    expect(chamadas).toEqual([]);
  });
  it("estado: ativo devolve postos/catálogo; permissão e parâmetros são exigidos", async () => {
    const { io } = fakeApIO();
    expect((await acaoApontamentosEstado(io, FECHA, "2026-11-03", "m2")).corpo).toMatchObject({ modo: "ativo", postos: [] });
    expect((await acaoApontamentosEstado(io, SEM, "2026-11-03", "m2")).status).toBe(403);
    expect((await acaoApontamentosEstado(io, FECHA, "03/11", "m2")).status).toBe(400);
  });
  it("salvar: grava com a permissão do fechamento; recusa sem permissão, flag desligada e corpo inválido (sem tocar no banco)", async () => {
    const { io, chamadas } = fakeApIO();
    expect(await acaoApontamentosSalvar(io, FECHA, { data: "2026-11-03", periodo_id: "m2", linhas: [LINHA] })).toMatchObject({ status: 200, corpo: { ok: true } });
    expect(chamadas).toEqual(["salvar:1"]);
    expect((await acaoApontamentosSalvar(io, SEM, { data: "2026-11-03", periodo_id: "m2", linhas: [LINHA] })).status).toBe(403);
    expect((await acaoApontamentosSalvar(io, FECHA, { data: "2026-11-03", periodo_id: "m2", linhas: [{ ...LINHA, produzido: -3 }] })).status).toBe(400);
    expect((await acaoApontamentosSalvar(io, FECHA, { data: "x", periodo_id: "m2", linhas: [] })).status).toBe(400);
    expect((await acaoApontamentosSalvar(fakeApIO({ modoAtual: "desligado" }).io, FECHA, { data: "2026-11-03", periodo_id: "m2", linhas: [LINHA] })).status).toBe(409);
    expect(chamadas).toEqual(["salvar:1"]);
  });
  it("salvar: erro de regra do banco => 422 com a mensagem e 'Nada foi gravado'; falha inesperada => 500", async () => {
    const regra = fakeApIO({ salvar: async () => { throw new Error(`LINHA[${U(1)}]: Nenhuma etapa do roteiro do produto é elegível`); } });
    const r = await acaoApontamentosSalvar(regra.io, FECHA, { data: "2026-11-03", periodo_id: "m2", linhas: [LINHA] });
    expect(r.status).toBe(422); expect(r.corpo.mensagem).toBe("Nada foi gravado.");
    const queda = fakeApIO({ salvar: async () => { throw new Error("fetch failed"); } });
    expect((await acaoApontamentosSalvar(queda.io, FECHA, { data: "2026-11-03", periodo_id: "m2", linhas: [LINHA] })).status).toBe(500);
  });
});

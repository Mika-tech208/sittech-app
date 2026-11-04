import { describe, expect, it } from "vitest";
import { buffersObrigatorios, contagensDoInventario, estimarBuffers, somaPorBuffer } from "../catalogo";
import { estadoDoPeriodo, seloProximoPeriodo } from "../estados";
import { portaoHard, validarConfirmacao, type ContextoValidacao, limiteMotivo, MOTIVO_AUTOMATICO, motivoAutomatico } from "../validacao";
import type { BufferCatalogo, EntradaConfirmacao } from "../tipos";

const CV = "27c229d7-f192-41eb-aad1-0c69ece53eba", AU = "a027ac97-ffd1-4834-8ed0-d3a94aac4aee";
const RQ = "ca90456c", PF = "78aaa207", ET = "34371af3", EM = "b3db9629", M8 = "1b72bf46", AE = "1863b452", AM = "fb96d08d";
const CATALOGO: BufferCatalogo[] = [
  { id: "b1", chave: "conector34:rosqueadas", rotulo: "Rosqueadas aguardando Parafusar", ordem: 1, pares: [{ produtoId: CV, etapaOrigemId: RQ, etapaSeguinteId: PF, papel: "contabil" }] },
  { id: "b2", chave: "conector34:parafusadas", rotulo: "Parafusadas aguardando Etiquetar", ordem: 2, pares: [{ produtoId: CV, etapaOrigemId: PF, etapaSeguinteId: ET, papel: "contabil" }, { produtoId: AU, etapaOrigemId: M8, etapaSeguinteId: AE, papel: "zero" }] },
  { id: "b3", chave: "conector34:etiquetadas", rotulo: "Etiquetadas aguardando Embalar", ordem: 3, pares: [{ produtoId: CV, etapaOrigemId: ET, etapaSeguinteId: EM, papel: "contabil" }, { produtoId: AU, etapaOrigemId: AE, etapaSeguinteId: AM, papel: "zero" }] },
  { id: "b9", chave: "caixa:e16", rotulo: "Caixa E16 → Montagem", ordem: 9, pares: [{ produtoId: "CAIXA", etapaOrigemId: "x", etapaSeguinteId: "y", papel: "contabil" }] },
];
const EST = [
  { bufferId: "b1", estimado: 1900, lo: 1900, hi: 1900 }, { bufferId: "b2", estimado: 7122, lo: 7122, hi: 7122 }, { bufferId: "b3", estimado: 8600, lo: 8600, hi: 8600 },
];
const ctx = (o: Partial<ContextoValidacao> = {}): ContextoValidacao => ({
  agoraMs: 1_000_000_000, fimPeriodoMs: 1_000_000_000 - 120_000, postos: [{ maquinaId: "m", nome: "Etiquetadora 15", status: "produzindo", produzido: 3000, refugo: 0, motivo: null }],
  obrigatorios: CATALOGO.slice(0, 3), estimativas: EST, podeExcecao: false, periodoJaFechado: false, ...o,
});
const entrada = (o: Partial<EntradaConfirmacao> = {}): EntradaConfirmacao => ({
  data: "2026-11-03", periodoId: "m3", chave: "11111111-1111-1111-1111-111111111111",
  buffers: [{ bufferId: "b1", fisico: 1200, motivo: "contagem anterior errada" }, { bufferId: "b2", fisico: 4800, motivo: "estoque comum Conv+M8" }, { bufferId: "b3", fisico: 9000 }], ...o,
});

describe("catálogo — Conector 3/4 com estoque físico comum", () => {
  it("só pede os buffers dos produtos ativos (produto de uma operação não tem buffer)", () => {
    expect(buffersObrigatorios(CATALOGO, new Set([CV])).map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(buffersObrigatorios(CATALOGO, new Set([AU])).map((b) => b.id)).toEqual(["b2", "b3"]);
    expect(buffersObrigatorios(CATALOGO, new Set(["PRODUTO_SIMPLES"]))).toEqual([]);
  });
  it("estimado do buffer = Conv + Auto (um estoque só): 4.900 + 2.222 = 7.122", () => {
    const pares = [
      { produtoId: CV, etapaOrigemId: PF, etapaSeguinteId: ET, wip: { lo: 4900, hi: 4900 } },
      { produtoId: AU, etapaOrigemId: M8, etapaSeguinteId: AE, wip: { lo: 2222, hi: 2222 } },
    ];
    expect(estimarBuffers([CATALOGO[1]], pares)[0]).toMatchObject({ bufferId: "b2", estimado: 7122, lo: 7122, hi: 7122 });
  });
  it("Convencional recebe o total físico e Automático recebe 0; a soma é exatamente o físico (M8 não duplica)", () => {
    const c = contagensDoInventario(CATALOGO.slice(0, 3), entrada().buffers, 123, "Supervisora", "x");
    expect(c.find((x) => x.produtoId === CV && x.etapaOrigemId === PF)!.saldo).toBe(4800);
    expect(c.find((x) => x.produtoId === AU && x.etapaOrigemId === M8)!.saldo).toBe(0);
    expect(c.find((x) => x.produtoId === AU && x.etapaOrigemId === AE)!.saldo).toBe(0);
    expect(somaPorBuffer(CATALOGO.slice(0, 3), c)).toEqual({ b1: 1200, b2: 4800, b3: 9000 });
    expect(c.every((x) => x.contadoEmMs === 123)).toBe(true);
  });
  it("campo vazio não vira contagem (nunca preenche sozinho)", () => {
    const c = contagensDoInventario(CATALOGO.slice(0, 3), [{ bufferId: "b1", fisico: null }], 1, "u", "o");
    expect(c).toEqual([]);
  });
});

describe("validação do fechamento", () => {
  it("fechamento normal é aceito", () => expect(validarConfirmacao(entrada(), ctx()).ok).toBe(true));
  it("campo faltando bloqueia (um erro por buffer)", () => {
    const r = validarConfirmacao(entrada({ buffers: [{ bufferId: "b1", fisico: 1200, motivo: "contagem errada" }, { bufferId: "b3", fisico: 9000 }] }), ctx());
    expect(r.ok).toBe(false);
    expect(r.erros.map((e) => e.codigo)).toContain("BUFFER_FALTANDO");
    expect(r.erros.find((e) => e.codigo === "BUFFER_FALTANDO")!.bufferId).toBe("b2");
  });
  it("campo null (vazio) é campo faltando", () => {
    const r = validarConfirmacao(entrada({ buffers: [{ bufferId: "b1", fisico: null }, { bufferId: "b2", fisico: 4800, motivo: "abc" }, { bufferId: "b3", fisico: 9000 }] }), ctx());
    expect(r.erros.some((e) => e.codigo === "BUFFER_FALTANDO" && e.bufferId === "b1")).toBe(true);
  });
  it("negativo, não inteiro, NaN e texto são recusados", () => {
    const f = (v: unknown) => validarConfirmacao(entrada({ buffers: [{ bufferId: "b1", fisico: v as number, motivo: "abc" }, { bufferId: "b2", fisico: 4800, motivo: "abc" }, { bufferId: "b3", fisico: 9000 }] }), ctx()).erros.map((e) => e.codigo);
    expect(f(-1)).toContain("SALDO_NEGATIVO"); expect(f(10.5)).toContain("SALDO_NAO_INTEIRO"); expect(f(Number.NaN)).toContain("BUFFER_FALTANDO"); expect(f("12")).toContain("SALDO_INVALIDO");
  });
  it("ESTOQUE FÍSICO É A AUTORIDADE: divergência grande é aceita SEM motivo e SEM confirmação em dois passos (D, E)", () => {
    // estimado b2 = 7.122; físico 4.800 (−2.322) e 750 (−89%): aceita imediatamente
    for (const fisico of [4800, 750]) {
      const r = validarConfirmacao(entrada({ buffers: [{ bufferId: "b1", fisico: 1200 }, { bufferId: "b2", fisico }, { bufferId: "b3", fisico: 9000 }], confirmouDiferencaGrande: false }), ctx());
      expect(r.ok).toBe(true); expect(r.exigeConfirmacao).toEqual([]);
      expect(r.erros.map((e) => e.codigo)).not.toContain("MOTIVO_OBRIGATORIO"); expect(r.erros.map((e) => e.codigo)).not.toContain("CONFIRMACAO_DIFERENCA_GRANDE");
    }
  });
  it("físico = 0 é aceito normalmente (F); a validação continua só objetiva: obrigatório, inteiro, ≥ 0, buffer do período", () => {
    expect(validarConfirmacao(entrada({ buffers: [{ bufferId: "b1", fisico: 0 }, { bufferId: "b2", fisico: 0 }, { bufferId: "b3", fisico: 0 }] }), ctx()).ok).toBe(true);
    const cod = (b: { bufferId: string; fisico: number | null }[]) => validarConfirmacao(entrada({ buffers: b }), ctx()).erros.map((e) => e.codigo);
    expect(cod([{ bufferId: "b1", fisico: null }, { bufferId: "b2", fisico: 1 }, { bufferId: "b3", fisico: 1 }])).toContain("BUFFER_FALTANDO");
    expect(cod([{ bufferId: "b1", fisico: -1 }, { bufferId: "b2", fisico: 1 }, { bufferId: "b3", fisico: 1 }])).toContain("SALDO_NEGATIVO");
    expect(cod([{ bufferId: "b1", fisico: 1.5 }, { bufferId: "b2", fisico: 1 }, { bufferId: "b3", fisico: 1 }])).toContain("SALDO_NAO_INTEIRO");
    expect(cod([{ bufferId: "bX", fisico: 1 }, { bufferId: "b1", fisico: 1 }, { bufferId: "b2", fisico: 1 }, { bufferId: "b3", fisico: 1 }])).toContain("BUFFER_DESCONHECIDO");
  });
  it("o CHECK do banco (motivo acima do limite) é satisfeito em silêncio: motivo automático só quando a divergência passa do limite; o que a pessoa escrever é preservado", () => {
    expect(motivoAutomatico(4800, 7122, null)).toBe(MOTIVO_AUTOMATICO);   // −2.322 > max(500, 15%)
    expect(motivoAutomatico(0, 3000, "")).toBe(MOTIVO_AUTOMATICO);
    expect(motivoAutomatico(4900, 5000, null)).toBeNull();                 // dentro do limite: nada a registrar
    expect(motivoAutomatico(4800, 7122, "contei errado")).toBe("contei errado");
    expect(motivoAutomatico(4800, null, null)).toBeNull();                 // sem estimado: nada a comparar
    expect(Math.abs(4800 - 7122) > limiteMotivo(4800)).toBe(true);
    expect(MOTIVO_AUTOMATICO.trim().length).toBeGreaterThanOrEqual(3);     // atende length(btrim(motivo)) >= 3 do CHECK
  });
  it("posto sem apontamento (pendente) bloqueia; sem_producao conta como coletado", () => {
    const pend = ctx({ postos: [{ maquinaId: "a", nome: "Paf 10", status: "pendente", produzido: 0, refugo: 0, motivo: null }] });
    expect(validarConfirmacao(entrada(), pend).erros.map((e) => e.codigo)).toContain("POSTOS_PENDENTES");
    const sem = ctx({ postos: [{ maquinaId: "a", nome: "Paf 10", status: "sem_producao", produzido: 0, refugo: 0, motivo: "sem material" }] });
    expect(validarConfirmacao(entrada(), sem).ok).toBe(true);
  });
  it("buffer que não pertence ao fechamento / duplicado é recusado", () => {
    expect(validarConfirmacao(entrada({ buffers: [...entrada().buffers, { bufferId: "zzz", fisico: 1 }] }), ctx()).erros.map((e) => e.codigo)).toContain("BUFFER_DESCONHECIDO");
    expect(validarConfirmacao(entrada({ buffers: [...entrada().buffers, { bufferId: "b1", fisico: 1200, motivo: "abc" }] }), ctx()).erros.map((e) => e.codigo)).toContain("BUFFER_DUPLICADO");
  });
  it("período já fechado e chave inválida são recusados", () => {
    expect(validarConfirmacao(entrada(), ctx({ periodoJaFechado: true })).erros.map((e) => e.codigo)).toContain("PERIODO_JA_FECHADO");
    expect(validarConfirmacao(entrada({ chave: "x" }), ctx()).erros.map((e) => e.codigo)).toContain("CHAVE_INVALIDA");
  });
  it("horário da contagem: não pode ser futuro nem anterior a 15 min do fim do período", () => {
    expect(validarConfirmacao(entrada({ contadoEmMs: 1_000_000_000 + 31 * 60_000 }), ctx()).erros.map((e) => e.codigo)).toContain("INSTANTE_FUTURO");
    expect(validarConfirmacao(entrada({ contadoEmMs: 1_000_000_000 - 120_000 - 16 * 60_000 }), ctx()).erros.map((e) => e.codigo)).toContain("INSTANTE_ANTIGO");
  });
  it("exceção (fechar sem contagem): só perfil superior e com motivo", () => {
    expect(validarConfirmacao(entrada({ buffers: [], excecao: { motivo: "galpão interditado" } }), ctx()).erros.map((e) => e.codigo)).toContain("EXCECAO_SEM_PERMISSAO");
    expect(validarConfirmacao(entrada({ buffers: [], excecao: { motivo: "ab" } }), ctx({ podeExcecao: true })).erros.map((e) => e.codigo)).toContain("EXCECAO_SEM_MOTIVO");
    expect(validarConfirmacao(entrada({ buffers: [], excecao: { motivo: "galpão interditado" } }), ctx({ podeExcecao: true })).ok).toBe(true);
  });
});

describe("portão HARD de publicação", () => {
  const contagens = contagensDoInventario(CATALOGO.slice(0, 3), entrada().buffers, 1, "u", "o");
  const pares = contagens.map((c) => ({ produtoId: c.produtoId, etapaOrigemId: c.etapaOrigemId, etapaSeguinteId: c.etapaSeguinteId, wip: { lo: c.saldo, hi: c.saldo } }));
  const limpo = { cadeiaInvalida: 0, semMaterial: 0, violacoesDuras: 0, maquinaForaDaPrevisao: 0, distribuicaoInvalida: 0, excedePessoas: 0, passadoAlterado: 0, duplicidade: 0, cadeiaCapacidadeExcedida: 4 };
  const base = { corteUsado: true, corteMotivoFalha: null, checagens: limpo, paresDoEstado: pares, contagens };
  it("aprova quando tudo é zero e o inventário foi preservado (cadeiaCapacidadeExcedida é informativa)", () => expect(portaoHard(base)).toBeNull());
  it("recusa quando o planejador não aprovou", () => expect(portaoHard({ ...base, corteUsado: false, corteMotivoFalha: "orçamento estourado" })).toMatch(/orçamento/));
  it.each([["cadeiaInvalida", /CADEIA_INVALIDA/], ["semMaterial", /sem material/], ["violacoesDuras", /restrição dura/], ["maquinaForaDaPrevisao", /fora da Previsão/], ["excedePessoas", /pessoas disponíveis/], ["passadoAlterado", /passado/], ["duplicidade", /duplicada/]])("recusa %s > 0", (k, re) => {
    expect(portaoHard({ ...base, checagens: { ...limpo, [k]: 1 } })).toMatch(re as RegExp);
  });
  it("recusa estoque negativo e checagens ausentes", () => {
    expect(portaoHard({ ...base, paresDoEstado: pares.map((p, i) => (i === 0 ? { ...p, negativo: true } : p)) })).toMatch(/negativo/);
    expect(portaoHard({ ...base, checagens: null })).toMatch(/ausentes/);
  });
  it("recusa quando o motor NÃO partiu do inventário físico (projeção antiga vazou)", () => {
    const errado = pares.map((p) => (p.etapaOrigemId === PF && p.produtoId === CV ? { ...p, wip: { lo: 7122, hi: 7122 } } : p));
    expect(portaoHard({ ...base, paresDoEstado: errado })).toMatch(/inventário físico não preservado/);
  });
});

describe("estados do período", () => {
  const base = { agoraMs: 100, inicioMs: 0, fimMs: 50, janelaAberta: false };
  it("derivação", () => {
    expect(estadoDoPeriodo({ ...base, agoraMs: -1, fechamento: null })).toBe("FUTURO");
    expect(estadoDoPeriodo({ ...base, agoraMs: 10, fechamento: null })).toBe("EM_EXECUCAO");
    expect(estadoDoPeriodo({ ...base, fechamento: null })).toBe("EM_FECHAMENTO");
    expect(estadoDoPeriodo({ ...base, fechamento: "RECALCULANDO" })).toBe("RECALCULANDO");
    expect(estadoDoPeriodo({ ...base, fechamento: "ERRO_RECALCULO" })).toBe("ERRO_RECALCULO");
    expect(estadoDoPeriodo({ ...base, fechamento: "CONFIRMADO" })).toBe("CONFIRMADO");
  });
  it("selos do próximo período", () => {
    expect(seloProximoPeriodo("CONFIRMADO", "M3").texto).toBe("M3 CONFIRMADO");
    expect(seloProximoPeriodo("ERRO_RECALCULO", "M3").texto).toBe("Estoque salvo. Programação ainda não gerada.");
    expect(seloProximoPeriodo("RECALCULANDO", "M3").tom).toBe("andamento");
  });
});

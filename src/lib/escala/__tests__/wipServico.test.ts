import { describe, it, expect } from "vitest";
import type { ConfirmacaoWip } from "@/features/escala/wipSaldo";
import { ajustarWip, ativarControleWip, autorizadoWip, confirmarWip, criarControleWip, verWip, WipErro, type DadosWip, type UsuarioWip, type WipDb } from "../wipServico";

const ADMIN: UsuarioWip = { id: "u-admin", papel: "admin" };
const SUPERVISOR: UsuarioWip = { id: "u-sup", papel: "usuario", permissoes: ["escala_wip_confirmar", "escala_producao"] };
const SO_ESCALA: UsuarioWip = { id: "u-esc", papel: "usuario", permissoes: ["escala_producao"] };
const SO_PREVISAO: UsuarioWip = { id: "u-prev", papel: "usuario", permissoes: ["previsao"] };
const SEM_NADA: UsuarioWip = { id: "u-x", papel: "usuario", permissoes: ["produtos"] };

const HOJE = "2026-10-25";
const SEMANA = "2026-10-26";

function mundo(extra: Partial<DadosWip> = {}) {
  const dados: DadosWip = {
    controles: [{ id: "c1", produtoId: "pA", etapaOrigemId: "e1", etapaSeguinteId: "e2", dataInicio: "2026-10-05", saldoInicial: 0, ativo: true }],
    ajustes: [], confirmacoes: [], snapshots: [],
    producao: [{ etapaId: "e1", data: "2026-10-20", boas: 7200 }],
    semanas: [{ semanaInicio: SEMANA, quantidadePorProduto: { pA: 56400 } }],
    roteiro: { produtoAtivo: { pA: true }, etapasPorProduto: { pA: [{ id: "e1", ordem: 1 }, { id: "e2", ordem: 2 }] } },
    ...extra,
  };
  const chamadas: { tipo: string; args: Record<string, unknown> }[] = [];
  const chaves = new Map<string, string>();
  const db: WipDb = {
    carregar: async () => dados,
    criarControle: async (p) => { chamadas.push({ tipo: "criar", args: p }); return "novo"; },
    ativarControle: async (p) => { chamadas.push({ tipo: "ativar", args: p }); },
    ajustar: async (p) => { if (p.chave && chaves.has(p.chave)) return chaves.get(p.chave)!; chamadas.push({ tipo: "ajustar", args: p }); const id = `aj${chamadas.length}`; if (p.chave) chaves.set(p.chave, id); return id; },
    confirmar: async (p) => {
      if (p.chave && chaves.has(p.chave)) return chaves.get(p.chave)!;
      chamadas.push({ tipo: "confirmar", args: p });
      const id = `cf${chamadas.length}`;
      if (p.chave) chaves.set(p.chave, id);
      dados.confirmacoes.push({ id, controleId: p.controleId, dataReferencia: p.dataReferencia, quantidade: p.quantidade, saldoEstimado: p.saldoEstimado, motivo: p.motivo, criadoEm: `${HOJE}T12:00:00Z` } as ConfirmacaoWip);
      return id;
    },
  };
  return { db, dados, chamadas };
}

describe("permissões do estoque intermediário", () => {
  it("administrador pode tudo", () => {
    (["ver", "confirmar", "ajustar", "criar_controle", "ativar_controle"] as const).forEach((a) => expect(autorizadoWip(ADMIN, a)).toBe(true));
  });
  it("supervisor com escala_wip_confirmar pode confirmar e ajustar", () => {
    expect(autorizadoWip(SUPERVISOR, "confirmar")).toBe(true);
    expect(autorizadoWip(SUPERVISOR, "ajustar")).toBe(true);
    expect(autorizadoWip(SUPERVISOR, "ver")).toBe(true);
  });
  it("sem a permissão específica: somente leitura (Escala ou Previsão não bastam para escrever)", () => {
    [SO_ESCALA, SO_PREVISAO].forEach((u) => {
      expect(autorizadoWip(u, "ver")).toBe(true);
      expect(autorizadoWip(u, "confirmar")).toBe(false);
      expect(autorizadoWip(u, "ajustar")).toBe(false);
      expect(autorizadoWip(u, "criar_controle")).toBe(false);
    });
  });
  it("sem nenhuma permissão relacionada: nem ver", () => {
    expect(autorizadoWip(SEM_NADA, "ver")).toBe(false);
    expect(autorizadoWip(null, "ver")).toBe(false);
  });
  it("o serviço recusa a ação sem permissão e NÃO grava nada", async () => {
    const m = mundo();
    await expect(confirmarWip(m.db, SO_ESCALA, { controleId: "c1", quantidade: 7200, semanaInicio: SEMANA }, HOJE)).rejects.toBeInstanceOf(WipErro);
    await expect(ajustarWip(m.db, SO_PREVISAO, { controleId: "c1", quantidade: -100, motivo: "contagem", semanaInicio: SEMANA }, HOJE)).rejects.toThrow(/Somente administrador/);
    await expect(criarControleWip(m.db, SO_ESCALA, { produtoId: "p", etapaOrigemId: "a", etapaSeguinteId: "b", dataInicio: HOJE, saldoInicial: 0 })).rejects.toBeInstanceOf(WipErro);
    await expect(ativarControleWip(m.db, SO_ESCALA, { controleId: "c1", ativo: false })).rejects.toBeInstanceOf(WipErro);
    expect(m.chamadas).toEqual([]);
    await expect(verWip(m.db, SEM_NADA, SEMANA, HOJE)).rejects.toThrow(/Sem permissão/);
  });
});

describe("confirmar", () => {
  it("o servidor recalcula o ESTIMADO (não confia no navegador) e grava com o usuário", async () => {
    const m = mundo();
    const r = await confirmarWip(m.db, SUPERVISOR, { controleId: "c1", quantidade: 7200, semanaInicio: SEMANA }, HOJE);
    expect(r.saldoEstimado).toBe(7200);
    expect(m.chamadas[0].args).toMatchObject({ usuarioId: "u-sup", controleId: "c1", quantidade: 7200, saldoEstimado: 7200, motivo: null, dataReferencia: HOJE });
  });
  it("quantidade diferente do estimado exige motivo; com motivo é aceita e registra os dois valores", async () => {
    const m = mundo();
    await expect(confirmarWip(m.db, ADMIN, { controleId: "c1", quantidade: 6900, semanaInicio: SEMANA }, HOJE)).rejects.toThrow(/motivo/);
    expect(m.chamadas).toEqual([]);
    await confirmarWip(m.db, ADMIN, { controleId: "c1", quantidade: 6900, motivo: "contagem física", semanaInicio: SEMANA }, HOJE);
    expect(m.chamadas[0].args).toMatchObject({ quantidade: 6900, saldoEstimado: 7200, motivo: "contagem física" });
  });
  it("confirmação PARCIAL é uma confirmação menor que o estimado, com motivo", async () => {
    const m = mundo();
    await confirmarWip(m.db, ADMIN, { controleId: "c1", quantidade: 5000, motivo: "só 5.000 conferidos", semanaInicio: SEMANA }, HOJE);
    const v = await verWip(m.db, ADMIN, SEMANA, HOJE);
    expect(v.controles[0]).toMatchObject({ confirmadoDisponivel: 5000, alocado: 5000, aProduzir: 51400 });
  });
  it("validações: negativo, data futura, data antes do início, controle inexistente", async () => {
    const m = mundo();
    await expect(confirmarWip(m.db, ADMIN, { controleId: "c1", quantidade: -1, semanaInicio: SEMANA }, HOJE)).rejects.toThrow(/maior ou igual a zero/);
    await expect(confirmarWip(m.db, ADMIN, { controleId: "c1", quantidade: 1, motivo: "x contagem", dataReferencia: "2026-12-01", semanaInicio: SEMANA }, HOJE)).rejects.toThrow(/futura/);
    await expect(confirmarWip(m.db, ADMIN, { controleId: "c1", quantidade: 1, motivo: "x contagem", dataReferencia: "2026-09-01", semanaInicio: SEMANA }, HOJE)).rejects.toThrow(/anterior ao início/);
    await expect(confirmarWip(m.db, ADMIN, { controleId: "nao-existe", quantidade: 1, semanaInicio: SEMANA }, HOJE)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  });
  it("IDEMPOTENTE: repetir a mesma chave não duplica a confirmação", async () => {
    const m = mundo();
    const a = await confirmarWip(m.db, ADMIN, { controleId: "c1", quantidade: 7200, chave: "k-1", semanaInicio: SEMANA }, HOJE);
    const b = await confirmarWip(m.db, ADMIN, { controleId: "c1", quantidade: 7200, chave: "k-1", semanaInicio: SEMANA }, HOJE);
    expect(a.id).toBe(b.id);
    expect(m.chamadas.filter((c) => c.tipo === "confirmar")).toHaveLength(1);
  });
});

describe("ajustar", () => {
  it("ajuste negativo com motivo (contagem física 9.200 contra 9.600 estimados = −400)", async () => {
    const m = mundo({ producao: [{ etapaId: "e1", data: "2026-10-20", boas: 9600 }] });
    await ajustarWip(m.db, ADMIN, { controleId: "c1", quantidade: -400, motivo: "contagem física 9.200", semanaInicio: SEMANA }, HOJE);
    expect(m.chamadas[0].args).toMatchObject({ quantidade: -400, motivo: "contagem física 9.200", usuarioId: "u-admin" });
  });
  it("ajuste positivo é aceito; motivo é obrigatório; zero é recusado", async () => {
    const m = mundo();
    await ajustarWip(m.db, SUPERVISOR, { controleId: "c1", quantidade: 300, motivo: "achado no estoque", semanaInicio: SEMANA }, HOJE);
    await expect(ajustarWip(m.db, ADMIN, { controleId: "c1", quantidade: 300, motivo: "  ", semanaInicio: SEMANA }, HOJE)).rejects.toThrow(/motivo/);
    await expect(ajustarWip(m.db, ADMIN, { controleId: "c1", quantidade: 0, motivo: "nada", semanaInicio: SEMANA }, HOJE)).rejects.toThrow(/diferente de zero/);
    expect(m.chamadas).toHaveLength(1);
  });
  it("NUNCA deixa o saldo negativo", async () => {
    const m = mundo(); // estimado 7.200
    await expect(ajustarWip(m.db, ADMIN, { controleId: "c1", quantidade: -7201, motivo: "erro de digitação", semanaInicio: SEMANA }, HOJE)).rejects.toThrow(/negativo/);
    await ajustarWip(m.db, ADMIN, { controleId: "c1", quantidade: -7200, motivo: "tudo consumido", semanaInicio: SEMANA }, HOJE);
    expect(m.chamadas).toHaveLength(1);
  });
  it("idempotente pela chave", async () => {
    const m = mundo();
    const a = await ajustarWip(m.db, ADMIN, { controleId: "c1", quantidade: -100, motivo: "contagem", chave: "aj-1", semanaInicio: SEMANA }, HOJE);
    const b = await ajustarWip(m.db, ADMIN, { controleId: "c1", quantidade: -100, motivo: "contagem", chave: "aj-1", semanaInicio: SEMANA }, HOJE);
    expect(a.id).toBe(b.id);
    expect(m.chamadas).toHaveLength(1);
  });
});

describe("criar/ativar controle e leitura", () => {
  it("administrador cria o controle; saldo inicial negativo é recusado", async () => {
    const m = mundo();
    await criarControleWip(m.db, ADMIN, { produtoId: "pA", etapaOrigemId: "e1", etapaSeguinteId: "e2", dataInicio: HOJE, saldoInicial: 100 });
    await expect(criarControleWip(m.db, ADMIN, { produtoId: "pA", etapaOrigemId: "e1", etapaSeguinteId: "e2", dataInicio: HOJE, saldoInicial: -1 })).rejects.toThrow(/negativo/);
    expect(m.chamadas).toHaveLength(1);
  });
  it("somente leitura vê o estimado e o status, e podeAlterar = false", async () => {
    const m = mundo();
    const v = await verWip(m.db, SO_ESCALA, SEMANA, HOJE);
    expect(v.podeAlterar).toBe(false);
    expect(v.controles[0]).toMatchObject({ status: "estimado" });
    expect(v.controles[0].estimado.valor).toBe(7200);
    expect((await verWip(m.db, SUPERVISOR, SEMANA, HOJE)).podeAlterar).toBe(true);
  });
  it("sem controles cadastrados: lista vazia (semanas antigas sem saldo continuam como estavam)", async () => {
    const db: WipDb = { ...mundo().db, carregar: async () => undefined };
    expect((await verWip(db, ADMIN, SEMANA, HOJE)).controles).toEqual([]);
  });
});

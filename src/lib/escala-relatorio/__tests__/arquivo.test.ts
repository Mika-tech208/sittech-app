import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { digestDasFontes } from "@/features/escala-relatorio/conteudo";
import type { FontesRelatorio } from "@/features/escala-relatorio/tipos";
import { ap, aus, fontes, OP } from "@/features/escala-relatorio/__tests__/fixtures";
import { baixarPdf, listarArquivo } from "../servico";

const ids = ["m1", "m2", "m3", "t1", "t2", "t3"];
const base = (): Partial<FontesRelatorio> => ({ apontamentos: ids.map((p, i) => ap("f1", p, i % 2 === 0 ? "r3" : "m18", [OP.rosq, OP.mont, OP.emb, OP.etiq, OP.rosq, OP.mont][i])), ausencias: [aus("f3")] });
const consideradosDe = (f: FontesRelatorio) => f.diasProdutivos.flatMap((d) => (f.periodosPorDia[d] ?? f.periodosPadrao).map((p) => `${d}|${p.id}`));
const par = (s: string) => ({ data: s.split("|")[0], periodoId: s.split("|")[1] });

function mundo() {
  const f0 = fontes(base());
  const periodos = consideradosDe(f0);
  const digest = digestDasFontes(f0, periodos.map(par));
  const linha = (id: string, extra: Record<string, unknown> = {}) => ({ id, semanaInicio: f0.semanaInicio, tipo: "executada", codigo: "ESC-EXEC-2026-45-0001", versao: 2, nVersoes: 2, status: "final", geradoEm: "2026-11-06T21:07:00Z", consolidadoAte: "2026-11-06T21:00:00Z",
    fechamentoAutomatico: true, geradoPor: null, pdfBytes: 1000, hash: "h".repeat(64), cobertura: "100,0%", conformidade: "SIM", fonteDigest: digest, periodosConsiderados: periodos, ...extra });
  let fontesAtuais: FontesRelatorio = f0;
  const chamadas = { rpcArquivo: [] as Record<string, unknown>[], fontes: 0, escritas: 0 };
  const comoUsuario = { rpc: async (nome: string, args: Record<string, unknown>) => { chamadas.rpcArquivo.push({ nome, ...args }); return { data: { total: 2, anos: [2026], limite: 20, offset: 0, itens: [linha("a"), linha("b", { semanaInicio: "2026-10-26", versao: 1, nVersoes: 1, status: "parcial", fechamentoAutomatico: false })] }, error: null }; } } as unknown as SupabaseClient;
  const admin = { rpc: async (nome: string) => { if (nome !== "escala_relatorio_fontes") { chamadas.escritas++; return { data: null, error: { message: "inesperado" } }; } chamadas.fontes++; return { data: fontesAtuais, error: null }; } } as unknown as SupabaseClient;
  return { f0, admin, comoUsuario, chamadas, mudar: (f: FontesRelatorio) => { fontesAtuais = f; } };
}

describe("arquivo histórico — listarArquivo", () => {
  it("lê pela RPC com os filtros e a página; calcula 'alterações posteriores' por semana; nunca grava nem gera PDF", async () => {
    const m = mundo();
    const r = await listarArquivo(m.admin, m.comoUsuario, { ano: 2026, tipo: "executada", status: "final", busca: "ESC", pagina: 3 });
    expect(m.chamadas.rpcArquivo[0]).toMatchObject({ nome: "escala_relatorio_arquivo", p_ano: 2026, p_tipo: "executada", p_status: "final", p_busca: "ESC", p_limite: 20, p_offset: 40 });
    expect(r.total).toBe(2); expect(r.itens).toHaveLength(2);
    expect(r.itens.every((i) => i.alteracoesPosteriores === false)).toBe(true);
    expect(m.chamadas.fontes).toBe(2); // semanas distintas da página (2026-11-02 e 2026-10-26)
    expect(m.chamadas.escritas).toBe(0);
    expect("fonteDigest" in r.itens[0]).toBe(false);
  });
  it("alteração posterior nos dados-fonte aparece; o relatório antigo não muda", async () => {
    const m = mundo();
    m.mudar({ ...m.f0, apontamentos: m.f0.apontamentos.map((a, i) => (i === 0 ? { ...a, produzido: a.produzido + 1 } : a)) });
    const r = await listarArquivo(m.admin, m.comoUsuario, {});
    expect(r.itens[0].alteracoesPosteriores).toBe(true);
    expect(r.itens[0].hash).toBe("h".repeat(64)); expect(r.itens[0].codigo).toBe("ESC-EXEC-2026-45-0001");
  });
  it("mudança nos dias produtivos depois do final também aparece", async () => {
    const m = mundo();
    m.mudar({ ...m.f0, diasProdutivos: [...m.f0.diasProdutivos, "2026-11-07"] });
    expect((await listarArquivo(m.admin, m.comoUsuario, {})).itens[0].alteracoesPosteriores).toBe(true);
  });
  it("semana sem Previsão/erro ao ler fontes: alteração desconhecida (null), sem derrubar a lista; erro da RPC (sem permissão) propaga", async () => {
    const m = mundo();
    const semFontes = { rpc: async () => ({ data: null, error: { message: "ESCALA_RELATORIO_SEM_PREVISAO" } }) } as unknown as SupabaseClient;
    expect((await listarArquivo(semFontes, m.comoUsuario, {})).itens.map((i) => i.alteracoesPosteriores)).toEqual([null, null]);
    const negado = { rpc: async () => ({ data: null, error: { message: "Usuário não tem permissão para consultar relatórios da Escala" } }) } as unknown as SupabaseClient;
    await expect(listarArquivo(m.admin, negado, {})).rejects.toThrow(/permissão/);
  });
});

describe("arquivo histórico — download entrega o PDF armazenado com hash conferido", () => {
  const pdf = Buffer.from("%PDF-1.4\n…conteúdo armazenado…");
  const sha = createHash("sha256").update(pdf).digest("hex");
  const admin = (shaRegistrado: string) => ({
    from: (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (t === "escala_relatorios" ? { data: { semana_inicio: "2026-10-26", versao: 2, pdf_sha256: shaRegistrado } } : { data: { pdf: `\\x${pdf.toString("hex")}` }, error: null }) }) }) }),
  }) as unknown as SupabaseClient;
  it("devolve exatamente os bytes armazenados e o nome da versão", async () => {
    const r = await baixarPdf(admin(sha), "id");
    expect(Buffer.compare(r!.bytes, pdf)).toBe(0); expect(r!.nomeArquivo).toBe("SITTECH_Revezamento_2026-10-26_a_2026-11-01_v2.pdf");
  });
  it("hash diferente do registrado: recusa entregar", async () => {
    await expect(baixarPdf(admin("0".repeat(64)), "id")).rejects.toThrow(/não confere/);
  });
});

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { hashDoConteudo, montarConteudo, nomeArquivo } from "../conteudo";
import { DECLARACAO, renderizarPdf } from "../pdf";
import { paraPublico, type RegistroVerificacao } from "@/lib/escala-relatorio/publico";
import { ap, aus, em, fontes, META, ofi, OP, SEG } from "./fixtures";

const ids = ["m1", "m2", "m3", "t1", "t2", "t3"];
const aps = (f: string, ops: string[]) => ids.map((p, i) => ap(f, p, i % 2 === 0 ? "r3" : "m18", ops[i]));
const f0 = () => fontes({ apontamentos: [...aps("f1", [OP.rosq, OP.mont, OP.emb, OP.etiq, OP.rosq, OP.mont]), ...aps("f2", [OP.mont, OP.rosq, OP.etiq, OP.emb, OP.mont, OP.rosq])], ausencias: [aus("f3")] });
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
// texto do PDF: os streams são comprimidos (Flate); decodifica e junta as strings mostradas (Tj) — fontes padrão usam WinAnsi (= latin1 nesta faixa)
function textoDoPdf(bytes: Uint8Array): string {
  const s = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const buf = Buffer.from(m[1], "latin1");
    let txt: string;
    try { txt = inflateSync(buf).toString("latin1"); } catch { txt = buf.toString("latin1"); }
    for (const h of txt.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(h[1], "hex").toString("latin1"));
    for (const l of txt.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(l[1]);
  }
  return out.join("\n");
}
const contem = (bytes: Uint8Array, texto: string) => textoDoPdf(bytes).includes(texto);

describe("PDF do relatório", () => {
  it("gera A4 paisagem com várias páginas, cabeçalho PARCIAL/FINAL, declaração, assinaturas e rodapé com hash abreviado e Página X de Y", async () => {
    const c = montarConteudo(f0(), META(em("19:30", "2026-11-06")));
    const { hash } = hashDoConteudo(c);
    const r = await renderizarPdf(c, hash);
    expect(Buffer.from(r.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.paginas).toBeGreaterThanOrEqual(2);
    expect(r.nomeArquivo).toBe("SITTECH_Revezamento_2026-11-02_a_2026-11-08_v1.pdf");
    expect(nomeArquivo(c)).toBe(r.nomeArquivo);
    expect(contem(r.bytes, "RELATÓRIO FINAL")).toBe(true);
    expect(contem(r.bytes, "RESPONSÁVEL PELA PRODUÇÃO")).toBe(true);
    expect(contem(r.bytes, "TESTEMUNHA 2")).toBe(true);
    expect(contem(r.bytes, `Página 1 de ${r.paginas}`)).toBe(true);
    expect(contem(r.bytes, `SHA-256 ${hash.slice(0, 12)}`)).toBe(true);
    expect(contem(r.bytes, "ESC-EXEC-2026-45-0001")).toBe(true);
    expect(contem(r.bytes, DECLARACAO.slice(0, 40))).toBe(true);
    expect(c.titulo).toContain("REVEZAMENTO");
  });
  it("relatório PARCIAL traz a faixa e 'dados consolidados até'", async () => {
    const c = montarConteudo(f0(), META(em("12:00")));
    const r = await renderizarPdf(c, hashDoConteudo(c).hash);
    expect(c.status).toBe("parcial");
    expect(contem(r.bytes, "RELATÓRIO PARCIAL")).toBe(true);
    expect(contem(r.bytes, "Dados consolidados até")).toBe(true);
  });
  it("estado do revezamento e a frase explicativa aparecem no PDF (não só o rótulo)", async () => {
    const semM3 = fontes({ equipe: ["f1"], apontamentos: aps("f1", [OP.rosq, OP.mont, OP.emb, OP.etiq, OP.rosq, OP.mont]).filter((a) => a.periodoId !== "m3") });
    const c = montarConteudo(semM3, META(em("19:30", "2026-11-06")));
    expect(c.resumo.revezamento.estado).toBe("SIM_COM_RESSALVAS");
    const r = await renderizarPdf(c, hashDoConteudo(c).hash);
    expect(contem(r.bytes, "SIM COM RESSALVAS")).toBe(true);
    expect(contem(r.bytes, "Nenhuma violação comprovada.")).toBe(true);
    expect(contem(r.bytes, "por ausência de apontamento")).toBe(true);
  });
  it("violação real aparece listada no PDF", async () => {
    const c = montarConteudo(fontes({ equipe: ["f1"], apontamentos: aps("f1", [OP.rosq, OP.mont, OP.emb, OP.emb, OP.rosq, OP.mont]) }), META(em("19:30", "2026-11-06")));
    const r = await renderizarPdf(c, hashDoConteudo(c).hash);
    expect(c.resumo.revezamento.estado).toBe("NAO");
    expect(contem(r.bytes, "Violações do revezamento encontradas")).toBe(true);
    expect(contem(r.bytes, "M3 -> T1")).toBe(true);
  });
  it("determinístico: mesmo snapshot => mesmos bytes e mesmo hash de arquivo; conteúdo diferente => hash de arquivo diferente", async () => {
    const c = montarConteudo(f0(), META(em("19:30", "2026-11-06")));
    const { hash } = hashDoConteudo(c);
    const a = await renderizarPdf(c, hash), b = await renderizarPdf(c, hash);
    expect(sha(a.bytes)).toBe(sha(b.bytes));
    const g = f0(); g.apontamentos[0].produzido = 12345;
    const c2 = montarConteudo(g, META(em("19:30", "2026-11-06")));
    const d = await renderizarPdf(c2, hashDoConteudo(c2).hash);
    expect(sha(d.bytes)).not.toBe(sha(a.bytes));
    const v2 = montarConteudo(f0(), META(em("19:30", "2026-11-06"), { versao: 2 }));
    expect(sha((await renderizarPdf(v2, hashDoConteudo(v2).hash)).bytes)).not.toBe(sha(a.bytes));
  });
  it("o QR/URL aponta para a versão certa (id da versão no endereço, dentro do conteúdo hasheado e impresso)", async () => {
    const url = "https://exemplo.test/relatorios/escala/verificar/11111111-2222-3333-4444-555555555555";
    const c = montarConteudo(f0(), META(em("19:30", "2026-11-06"), { urlVerificacao: url }));
    expect(c.urlVerificacao).toBe(url);
    const r = await renderizarPdf(c, hashDoConteudo(c).hash);
    expect(contem(r.bytes, "Verificação: " + url)).toBe(true);
    const outra = montarConteudo(f0(), META(em("19:30", "2026-11-06"), { urlVerificacao: url.replace("5555", "6666") }));
    expect(hashDoConteudo(outra).hash).not.toBe(hashDoConteudo(c).hash);
  });
  it("grade longa pagina sem estourar (15 funcionários × 6 dias)", async () => {
    const dias = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"];
    const funcs = Array.from({ length: 15 }, (_, i) => ({ id: `f${i + 1}`, nome: `Funcionário ${String(i + 1).padStart(2, "0")}`, ativo: true }));
    const apontamentos = funcs.flatMap((fn, i) => dias.flatMap((d) => ids.map((p, k) => ap(fn.id, p, k % 2 ? "m18" : "r3", [OP.rosq, OP.mont, OP.emb, OP.etiq][(i + k) % 4], "p1", {}, d))));
    const f = fontes({ diasProdutivos: dias, periodosPorDia: {}, equipe: funcs.map((x) => x.id), funcionarios: funcs, apontamentos });
    const c = montarConteudo(f, META(Date.parse("2026-11-08T12:00:00-03:00")));
    const r = await renderizarPdf(c, hashDoConteudo(c).hash);
    expect(r.paginas).toBeGreaterThanOrEqual(8);
    expect(r.paginas).toBeLessThanOrEqual(14);
  });
});

describe("página pública (QR): só metadados, nunca nomes", () => {
  it("o objeto público não contém nomes, escala, apontamentos nem ausências — mesmo com nomes no conteúdo canônico", () => {
    const c = montarConteudo(f0(), META(em("19:30", "2026-11-06")));
    const { canonico, hash } = hashDoConteudo(c);
    expect(canonico).toContain("Ana"); // o snapshot guarda os nomes
    const reg: RegistroVerificacao = { id: "i", codigo: c.codigo, semanaInicio: SEG, tipo: "executada", versao: 1, status: "final", geradoEm: c.geradoEm, consolidadoAte: c.consolidadoAte, hash, pdfSha256: "b".repeat(64), integridadeBanco: true, conteudoCanonico: canonico, fonteDigest: c.fontes.digest, periodosConsiderados: [], versaoMaisRecente: 1, existeVersaoPosterior: false };
    const pub = paraPublico(reg, c.fontes.digest);
    const texto = JSON.stringify(pub);
    ["Ana", "Bia", "Clara", "Rosqueadeira", "Conector", "Caixa Amarela", "CPF"].forEach((n) => expect(texto).not.toContain(n));
    expect(pub).toMatchObject({ valido: true, integridade: "INTEGRO", codigo: "ESC-EXEC-2026-45-0001", semanaFim: "2026-11-08", existemVersoesPosteriores: false, alteracoesPosterioresNosDados: false });
    expect(Object.keys(pub).sort()).toEqual(["alteracoesPosterioresNosDados", "codigo", "existemVersoesPosteriores", "geradoEm", "hash", "integridade", "pdfSha256", "semanaFim", "semanaInicio", "status", "tipo", "valido", "versao", "versaoMaisRecente"]);
  });
  it("integridade INCONSISTENTE quando o conteúdo canônico não confere com o hash; alteração posterior quando o digest muda", () => {
    const c = montarConteudo(f0(), META(em("19:30", "2026-11-06")));
    const { canonico, hash } = hashDoConteudo(c);
    const base: RegistroVerificacao = { id: "i", codigo: c.codigo, semanaInicio: SEG, tipo: "executada", versao: 1, status: "final", geradoEm: c.geradoEm, consolidadoAte: c.consolidadoAte, hash, pdfSha256: "b".repeat(64), integridadeBanco: true, conteudoCanonico: canonico, fonteDigest: c.fontes.digest, periodosConsiderados: [], versaoMaisRecente: 2, existeVersaoPosterior: true };
    expect(paraPublico({ ...base, conteudoCanonico: canonico.replace("Ana", "Ane") }, null).integridade).toBe("INCONSISTENTE");
    const p = paraPublico(base, "0".repeat(64));
    expect(p.alteracoesPosterioresNosDados).toBe(true);
    expect(p.existemVersoesPosteriores).toBe(true);
    expect(paraPublico(base, null).alteracoesPosterioresNosDados).toBeNull();
  });
});

describe("escala planejada no PDF", () => {
  it("renderiza a planejada (sem cobertura)", async () => {
    const f = fontes({ oficial: ids.map((p, i) => ofi("f1", p, i % 2 ? "m18" : "r3", [OP.rosq, OP.mont, OP.emb, OP.etiq, OP.rosq, OP.mont][i])) });
    const c = montarConteudo(f, META(em("07:00"), { tipo: "planejada", codigo: "ESC-PLAN-2026-45-0001" }));
    const r = await renderizarPdf(c, hashDoConteudo(c).hash);
    expect(contem(r.bytes, "ESCALA PLANEJADA")).toBe(true);
    expect(contem(r.bytes, "ESC-PLAN-2026-45-0001")).toBe(true);
    expect(contem(r.bytes, "Completude da evidência")).toBe(false);
  });
});

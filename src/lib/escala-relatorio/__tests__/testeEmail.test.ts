import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { comTravaDeAmbiente, provedorMock } from "../email";
import { executarTesteEmail, type ResultadoTeste } from "../testeEmail";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function textoDoPdf(bytes: Uint8Array): string {
  const s = Buffer.from(bytes).toString("latin1"); const out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let txt: string; try { txt = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { continue; }
    for (const h of txt.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(h[1], "hex").toString("latin1"));
    for (const l of txt.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(l[1]);
  }
  return out.join("\n");
}
const registro = () => { const regs: { usuarioId: string; r: ResultadoTeste }[] = []; return { regs, registrar: async ({ usuarioId, resultado }: { usuarioId: string; resultado: ResultadoTeste }) => { regs.push({ usuarioId, r: resultado }); return "2026-11-02T12:00:00.000Z"; } }; };

describe("TESTAR ENVIO DE RELATÓRIO", () => {
  it("envia UM e-mail só para o destinatário informado pelo servidor, com PDF fictício marcado TESTE e hash igual ao informado", async () => {
    const prov = provedorMock(); const { regs, registrar } = registro();
    const r = await executarTesteEmail({ usuarioId: "u-admin", destinatario: "admin@sittech.com.br", baseUrl: "https://sittech-app.vercel.app", provedor: prov, registrar });
    expect(r).toMatchObject({ ok: true, destinatario: "admin@sittech.com.br", provedor: "mock", provedorId: "mock-1", erro: null, enviadoEm: "2026-11-02T12:00:00.000Z" });
    expect(prov.enviados).toHaveLength(1);
    const e = prov.enviados[0];
    expect(e.para).toBe("admin@sittech.com.br");
    expect(e.assunto.startsWith("[TESTE] Relatório semanal de revezamento")).toBe(true);
    expect(e.texto).toContain("E-MAIL DE TESTE"); expect(e.texto).toContain(`SHA-256 do anexo (PDF de teste): ${r.sha256}`);
    expect(e.anexos).toHaveLength(1);
    expect(e.anexos[0].nome.startsWith("TESTE_SITTECH_Revezamento_")).toBe(true);
    expect(sha(e.anexos[0].bytes)).toBe(r.sha256); expect(e.anexos[0].bytes.length).toBe(r.bytes);
    expect(Buffer.from(e.anexos[0].bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(regs).toHaveLength(1); expect(regs[0].usuarioId).toBe("u-admin");
  });
  it("o PDF é fictício e marcado TESTE em todas as páginas; nunca FINAL, sem nomes reais; QR não aponta para um relatório real", async () => {
    const prov = provedorMock();
    await executarTesteEmail({ usuarioId: "u", destinatario: "a@b.co", baseUrl: "https://sittech-app.vercel.app", provedor: prov, registrar: registro().registrar });
    const t = textoDoPdf(prov.enviados[0].anexos[0].bytes);
    expect((t.match(/TESTE . DADOS FICT/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(t).toContain("TESTE-0000"); expect(t).toContain("Funcionário Teste A");
    expect(t).not.toContain("RELATÓRIO FINAL"); expect(t).toContain("RELATÓRIO PARCIAL");
    expect(t).toContain("/relatorios/escala/verificar/TESTE");
    expect(t).toContain("RESPONSÁVEL PELA PRODUÇÃO");
  });
  it("falha do provedor: resultado 'falhou' com o erro, registrado, sem segredo", async () => {
    const prov = provedorMock(); prov.falharComo = "Provedor de e-mail recusou (HTTP 403): domínio não verificado"; const { regs, registrar } = registro();
    const r = await executarTesteEmail({ usuarioId: "u", destinatario: "a@b.co", baseUrl: "https://x.test", provedor: prov, registrar });
    expect(r.ok).toBe(false); expect(r.provedorId).toBeNull(); expect(r.erro).toContain("domínio não verificado");
    expect(regs[0].r.ok).toBe(false); expect(JSON.stringify(r)).not.toMatch(/re_[A-Za-z0-9]{8,}/);
  });
  it("fora de produção só destinatários permitidos recebem de verdade; os demais são bloqueados e registrados", async () => {
    const real = provedorMock(); const bloq = comTravaDeAmbiente({ ...real, nome: "resend" }, false, ["ok@sittech.com.br"]);
    const a = await executarTesteEmail({ usuarioId: "u", destinatario: "outro@sittech.com.br", baseUrl: "https://x.test", provedor: bloq, registrar: registro().registrar });
    expect(a.ok).toBe(false); expect(a.erro).toContain("bloqueado fora de produção"); expect(real.enviados).toHaveLength(0);
  });
  it("falha ao registrar não derruba o resultado do envio", async () => {
    const r = await executarTesteEmail({ usuarioId: "u", destinatario: "a@b.co", baseUrl: "https://x.test", provedor: provedorMock(), registrar: async () => { throw new Error("db fora"); } });
    expect(r.ok).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { digestDasFontes, fechamentoLogicoMs, hashDoConteudo, montarConteudo } from "@/features/escala-relatorio/conteudo";
import { renderizarPdf } from "@/features/escala-relatorio/pdf";
import type { ConteudoRelatorio, FontesRelatorio } from "@/features/escala-relatorio/tipos";
import { ap, aus, em, fontes, OP, SEG } from "@/features/escala-relatorio/__tests__/fixtures";
import { comTravaDeAmbiente, ErroEmail, montarEmail, provedorDoAmbiente, provedorMock, provedorResend, type ProvedorEmail } from "../email";
import { enviarEmailDoFechamento, executarFechamentoAutomatico, INTERVALO_RETENTATIVA_MS, segundaDeSP, type ConfigFechamento, type Fechamento, type PortaFechamento } from "../fechamentoAutomatico";

const SEX = "2026-11-06", SAB = "2026-11-07";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const ids = ["m1", "m2", "m3", "t1", "t2", "t3"];
const aps = (f: string, ops: string[]) => ids.map((p, i) => ap(f, p, i % 2 === 0 ? "r3" : "m18", ops[i]));
const base = (): Partial<FontesRelatorio> => ({ apontamentos: [...aps("f1", [OP.rosq, OP.mont, OP.emb, OP.etiq, OP.rosq, OP.mont]), ...aps("f2", [OP.mont, OP.rosq, OP.etiq, OP.emb, OP.mont, OP.rosq])], ausencias: [aus("f3")] });
function textoDoPdf(bytes: Uint8Array): string {
  const s = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const buf = Buffer.from(m[1], "latin1");
    let txt: string;
    try { txt = inflateSync(buf).toString("latin1"); } catch { txt = buf.toString("latin1"); }
    for (const l of txt.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(l[1]);
    for (const h of txt.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(h[1], "hex").toString("latin1"));
  }
  return out.join("\n");
}

// ---------- "banco" em memória com a mesma semântica das RPCs (unique semana+tipo, lease, geração × e-mail separados) ----------
interface RelGuardado { id: string; versao: number; codigo: string; conteudo: ConteudoRelatorio; hash: string; pdf: Uint8Array; pdfSha: string; digest: string; automatico: boolean }
function criarMundo(opcoes: { fontes?: Partial<FontesRelatorio>; cfg?: Partial<ConfigFechamento> } = {}) {
  const w = {
    agora: em("12:00", SEX),
    cfg: { ativo: true, desdeSemana: SEG, destinatario: "tamara@sittech.com.br", ...opcoes.cfg } as ConfigFechamento,
    fontesAtuais: fontes({ ...base(), ...opcoes.fontes }),
    fechamentos: new Map<string, Fechamento & { lease: number; erroGeracao: string | null; erroEmail: string | null; enviadoEm: number | null; provedorId: string | null }>(),
    relatorios: [] as RelGuardado[],
    falharGeracao: null as string | null,
    geracoes: 0,
  };
  const porta: PortaFechamento = {
    async config() { return { ...w.cfg }; },
    async lerFontes(semana) { return semana === SEG ? w.fontesAtuais : null; },
    async reivindicar(semana, logicoMs, destinatario) {
      let f = w.fechamentos.get(semana);
      if (!f) {
        f = { id: `fech-${semana}`, semana, fechamentoLogicoEm: new Date(logicoMs).toISOString(), destinatario, geracaoStatus: "pendente", geracaoTentativas: 0, geracaoUltimaTentativaEm: null, relatorioId: null, emailStatus: "pendente", emailTentativas: 0, emailUltimaTentativaEm: null, lease: 0, erroGeracao: null, erroEmail: null, enviadoEm: null, provedorId: null };
        w.fechamentos.set(semana, f);
      }
      if (f.geracaoStatus === "gerado" && f.emailStatus === "enviado") return null;
      if (f.lease > w.agora) return null;
      f.lease = w.agora + 240_000;
      return { ...f };
    },
    async gerar(semana, logicoMs) {
      const f = w.fechamentos.get(semana)!;
      w.geracoes++;
      if (f.geracaoStatus === "gerado" || w.relatorios.some((r) => r.automatico)) throw new Error("duplicate key: uq_escala_relatorio_fechamento_auto");
      if (w.falharGeracao) throw new Error(w.falharGeracao);
      // o estado "como de 18:00": apontamentos criados depois não entram (o mundo guarda só o que existia; ver teste de alteração posterior)
      const versao = w.relatorios.length + 1;
      const id = `rel-${versao}`;
      const c = montarConteudo(w.fontesAtuais, { tipo: "executada", codigo: "ESC-EXEC-2026-45-0001", versao, geradoEmMs: w.agora, geradoPor: { id: "sistema", nome: "Sistema (fechamento automático)" }, urlVerificacao: `https://exemplo.test/relatorios/escala/verificar/${id}`, consolidadoAteMs: logicoMs, fechamentoAutomatico: true });
      const { hash } = hashDoConteudo(c);
      const pdf = await renderizarPdf(c, hash);
      w.relatorios.push({ id, versao, codigo: c.codigo, conteudo: c, hash, pdf: pdf.bytes, pdfSha: sha(pdf.bytes), digest: c.fontes.digest, automatico: true });
      f.geracaoStatus = "gerado"; f.relatorioId = id; f.geracaoTentativas++; f.geracaoUltimaTentativaEm = new Date(w.agora).toISOString();
      return { id, codigo: c.codigo, tipo: "executada" as const, versao, status: c.status, hash, pdfSha256: sha(pdf.bytes), paginas: pdf.paginas, nomeArquivo: pdf.nomeArquivo, geradoEm: c.geradoEm };
    },
    async erroGeracao(id, erro) {
      const f = [...w.fechamentos.values()].find((x) => x.id === id)!;
      if (f.geracaoStatus !== "gerado") { f.geracaoStatus = "erro"; f.geracaoTentativas++; f.erroGeracao = erro; f.geracaoUltimaTentativaEm = new Date(w.agora).toISOString(); f.lease = 0; }
    },
    async carregarRelatorio(relatorioId) {
      const r = w.relatorios.find((x) => x.id === relatorioId)!;
      return { codigo: r.codigo, versao: r.versao, semanaInicio: r.conteudo.semana.inicio, nomeArquivo: `SITTECH_Revezamento_${r.conteudo.semana.inicio}_a_${r.conteudo.semana.fim}_v${r.versao}.pdf`, pdf: r.pdf };
    },
    async registrarEmail(id, ok, erro, provedorId) {
      const f = [...w.fechamentos.values()].find((x) => x.id === id)!;
      if (f.emailStatus === "enviado") return;
      f.emailStatus = ok ? "enviado" : "falhou"; f.emailTentativas++; f.emailUltimaTentativaEm = new Date(w.agora).toISOString(); f.lease = 0;
      if (ok) { f.enviadoEm = w.agora; f.provedorId = provedorId; f.erroEmail = null; } else f.erroEmail = erro;
    },
    async liberar(id) { const f = [...w.fechamentos.values()].find((x) => x.id === id); if (f) f.lease = 0; },
  };
  return { w, porta };
}
const rodar = (m: ReturnType<typeof criarMundo>, prov: ProvedorEmail = provedorMock()) => executarFechamentoAutomatico(m.porta, prov, m.w.agora);
const daSemana = (r: Awaited<ReturnType<typeof rodar>>) => r.find((x) => x.semana === SEG)!;

describe("fechamento automático — quando", () => {
  it("sexta 17:59 NÃO fecha; sexta 18:00 fecha, gera o FINAL e envia", async () => {
    const m = criarMundo(); const prov = provedorMock();
    m.w.agora = em("17:59", SEX);
    expect(daSemana(await rodar(m, prov)).acao).toBe("aguardando");
    expect(m.w.relatorios).toHaveLength(0); expect(prov.enviados).toHaveLength(0);
    m.w.agora = em("18:00", SEX);
    expect(daSemana(await rodar(m, prov)).acao).toBe("gerado_e_enviado");
    expect(m.w.relatorios).toHaveLength(1); expect(m.w.relatorios[0].conteudo.status).toBe("final"); expect(prov.enviados).toHaveLength(1);
  });
  it("worker às 18:07: gerado em 18:07, mas consolidado até 18:00 (fechamento lógico)", async () => {
    const m = criarMundo(); m.w.agora = em("18:07", SEX);
    await rodar(m);
    const c = m.w.relatorios[0].conteudo;
    expect(c.geradoEmTexto).toBe("06/11/2026 às 18:07:00");
    expect(c.consolidadoAteTexto).toBe("06/11/2026 18:00:00");
    expect(c.fechamentoAutomatico).toBe(true);
    expect(m.w.fechamentos.get(SEG)!.fechamentoLogicoEm).toBe(new Date(em("18:00", SEX)).toISOString());
  });
  it("sábado produtivo: sexta 18:05 não finaliza; sábado 18:00 finaliza", async () => {
    const m = criarMundo({ fontes: { diasProdutivos: [SEG, SAB] } }); const prov = provedorMock();
    m.w.agora = em("18:05", SEX);
    expect(daSemana(await rodar(m, prov)).acao).toBe("aguardando");
    m.w.agora = em("17:59", SAB);
    expect(daSemana(await rodar(m, prov)).acao).toBe("aguardando");
    m.w.agora = em("18:00", SAB);
    expect(daSemana(await rodar(m, prov)).acao).toBe("gerado_e_enviado");
    expect(m.w.fechamentos.get(SEG)!.fechamentoLogicoEm).toBe(new Date(em("18:00", SAB)).toISOString());
  });
  it("semana sem nenhum dia produtivo não gera nem envia relatório vazio", async () => {
    const m = criarMundo({ fontes: { diasProdutivos: [] } }); const prov = provedorMock(); m.w.agora = em("19:00", SEX);
    expect(daSemana(await rodar(m, prov)).acao).toBe("sem_dias_produtivos");
    expect(m.w.relatorios).toHaveLength(0); expect(prov.enviados).toHaveLength(0);
  });
  it("sábado NÃO produtivo: o fechamento é a sexta 18:00", () => {
    expect(fechamentoLogicoMs(fontes({ diasProdutivos: [SEG] }))).toBe(em("18:00", SEX));
  });
  it("desligado (padrão) não faz nada; semanas anteriores a desde_semana não são geradas retroativamente", async () => {
    const off = criarMundo({ cfg: { ativo: false } }); off.w.agora = em("19:00", SEX);
    expect((await rodar(off))[0].acao).toBe("desligado"); expect(off.w.relatorios).toHaveLength(0);
    const futuro = criarMundo({ cfg: { desdeSemana: "2026-11-09" } }); futuro.w.agora = em("19:00", SEX);
    expect(await rodar(futuro)).toEqual([]); expect(futuro.w.relatorios).toHaveLength(0);
  });
  it("segunda-feira de São Paulo (inclusive perto da meia-noite UTC)", () => {
    expect(segundaDeSP(em("18:00", SEX))).toBe(SEG);
    expect(segundaDeSP(em("23:59", "2026-11-08"))).toBe(SEG);   // domingo à noite em SP já é segunda em UTC
    expect(segundaDeSP(em("00:00", "2026-11-09"))).toBe("2026-11-09");
  });
});

describe("fechamento automático — o que é enviado", () => {
  it("só o EXECUTADO final, para a Tamara, com o PDF ANEXADO (mesmos bytes/hash do guardado), assunto e corpo combinados", async () => {
    const m = criarMundo(); const prov = provedorMock(); m.w.agora = em("18:07", SEX);
    await rodar(m, prov);
    const e = prov.enviados[0]; const r = m.w.relatorios[0];
    expect(e.para).toBe("tamara@sittech.com.br");
    expect(e.assunto).toBe("Relatório semanal de revezamento — Semana 02/11 a 08/11");
    expect(e.anexos).toHaveLength(1);
    expect(e.anexos[0].nome).toBe("SITTECH_Revezamento_2026-11-02_a_2026-11-08_v1.pdf");
    expect(e.anexos[0].tipo).toBe("application/pdf");
    expect(sha(e.anexos[0].bytes)).toBe(r.pdfSha);
    expect(e.texto).toContain("Olá, Tamara.");
    expect(e.texto).toContain("referente à semana de 02/11/2026 a 08/11/2026.");
    expect(e.texto).toContain("finalizado automaticamente pelo sistema em 06/11/2026 às 18:00.");
    expect(e.texto).toContain("Favor imprimir o relatório e coletar as assinaturas do responsável pela produção e das duas testemunhas indicadas no documento.");
    expect(e.texto).toContain("Código do relatório: ESC-EXEC-2026-45-0001");
    expect(e.texto).toContain("Versão: v1");
    expect(e.texto).toMatch(/Atenciosamente,\nSittech Soluções Industriais$/);
    expect(e.texto).not.toMatch(/https?:\/\//); // anexo, não link
    const t = textoDoPdf(e.anexos[0].bytes);
    expect(t).toContain("RELATÓRIO FINAL"); expect(t).toContain("Finalizado automaticamente pelo sistema"); expect(t).toContain("RESPONSÁVEL PELA PRODUÇÃO"); expect(t).toContain("TESTEMUNHA 1"); expect(t).toContain("CPF:");
  });
  it("registra o envio: destinatário, enviado_em, status, tentativas, id do provedor", async () => {
    const m = criarMundo(); m.w.agora = em("18:07", SEX); await rodar(m);
    const f = m.w.fechamentos.get(SEG)!;
    expect(f).toMatchObject({ emailStatus: "enviado", emailTentativas: 1, destinatario: "tamara@sittech.com.br", provedorId: "mock-1", enviadoEm: em("18:07", SEX), geracaoStatus: "gerado" });
  });
  it("relatório PARCIAL (geração manual) nunca é enviado automaticamente: antes do fechamento o worker não gera nem envia", async () => {
    const m = criarMundo(); const prov = provedorMock(); m.w.agora = em("17:30", SEX);
    await rodar(m, prov); await rodar(m, prov);
    expect(prov.enviados).toHaveLength(0); expect(m.w.relatorios).toHaveLength(0); expect(m.w.fechamentos.size).toBe(0);
  });
});

describe("fechamento automático — idempotência", () => {
  it("duas execuções SIMULTÂNEAS geram UM final e enviam UM e-mail", async () => {
    const m = criarMundo(); const prov = provedorMock(); m.w.agora = em("18:00", SEX);
    const [a, b] = await Promise.all([rodar(m, prov), rodar(m, prov)]);
    expect(m.w.relatorios).toHaveLength(1); expect(prov.enviados).toHaveLength(1);
    expect([daSemana(a).acao, daSemana(b).acao].sort()).toEqual(["gerado_e_enviado", "nada_a_fazer"]);
  });
  it("execuções seguintes (a cada 5 min) não fazem nada", async () => {
    const m = criarMundo(); const prov = provedorMock(); m.w.agora = em("18:00", SEX); await rodar(m, prov);
    for (const h of ["18:05", "18:10", "23:00"]) { m.w.agora = em(h, SEX); expect(daSemana(await rodar(m, prov)).acao).toBe("nada_a_fazer"); }
    expect(m.w.relatorios).toHaveLength(1); expect(prov.enviados).toHaveLength(1); expect(m.w.geracoes).toBe(1);
  });
});

describe("fechamento automático — falhas e retentativas", () => {
  it("falha na geração do PDF: não envia, registra o erro, tenta de novo depois SEM criar v2", async () => {
    const m = criarMundo(); const prov = provedorMock(); m.w.agora = em("18:00", SEX);
    m.w.falharGeracao = "pdf quebrou";
    const r1 = daSemana(await rodar(m, prov));
    expect(r1).toMatchObject({ acao: "erro_geracao", detalhe: "pdf quebrou" });
    expect(m.w.fechamentos.get(SEG)).toMatchObject({ geracaoStatus: "erro", geracaoTentativas: 1, erroGeracao: "pdf quebrou", emailStatus: "pendente" });
    expect(m.w.relatorios).toHaveLength(0); expect(prov.enviados).toHaveLength(0);
    m.w.agora += 5 * 60_000; expect(daSemana(await rodar(m, prov)).acao).toBe("aguardando_retentativa");
    m.w.falharGeracao = null; m.w.agora += INTERVALO_RETENTATIVA_MS;
    expect(daSemana(await rodar(m, prov)).acao).toBe("gerado_e_enviado");
    expect(m.w.relatorios).toHaveLength(1); expect(m.w.relatorios[0].versao).toBe(1); expect(prov.enviados).toHaveLength(1);
    expect(m.w.fechamentos.get(SEG)!.geracaoTentativas).toBe(2);
  });
  it("falha no e-mail: o relatório fica GERADO e o e-mail 'falhou'; a retentativa reenvia o MESMO PDF/v1 (sem regerar)", async () => {
    const m = criarMundo(); const prov = provedorMock(); m.w.agora = em("18:00", SEX);
    prov.falharComo = "provedor fora do ar";
    expect(daSemana(await rodar(m, prov)).acao).toBe("gerado_email_falhou");
    let f = m.w.fechamentos.get(SEG)!;
    expect(f).toMatchObject({ geracaoStatus: "gerado", emailStatus: "falhou", emailTentativas: 1, erroEmail: "provedor fora do ar", enviadoEm: null });
    const hashV1 = m.w.relatorios[0].hash, pdfV1 = m.w.relatorios[0].pdfSha;
    m.w.agora += 3 * 60_000; expect(daSemana(await rodar(m, prov)).acao).toBe("aguardando_retentativa");
    prov.falharComo = null; m.w.agora += INTERVALO_RETENTATIVA_MS;
    expect(daSemana(await rodar(m, prov)).acao).toBe("enviado");
    f = m.w.fechamentos.get(SEG)!;
    expect(f).toMatchObject({ emailStatus: "enviado", emailTentativas: 2, erroEmail: null });
    expect(m.w.relatorios).toHaveLength(1); expect(m.w.geracoes).toBe(1);
    expect(m.w.relatorios[0].hash).toBe(hashV1); expect(sha(prov.enviados[0].anexos[0].bytes)).toBe(pdfV1);
    expect(prov.enviados[0].assunto).toContain("Semana 02/11 a 08/11"); expect(prov.enviados[0].texto).toContain("Versão: v1");
  });
  it("REENVIAR E-MAIL (ação manual) reutiliza exatamente o mesmo PDF e chave por clique", async () => {
    const m = criarMundo(); const prov = provedorMock(); m.w.agora = em("18:00", SEX);
    prov.falharComo = "caixa cheia"; await rodar(m, prov);
    prov.falharComo = null;
    const f = (await m.porta.reivindicar(SEG, em("18:00", SEX), "tamara@sittech.com.br"))!;
    // o worker "esgotaria" a espera; o usuário reenvia na hora
    const r = await enviarEmailDoFechamento(m.porta, prov, f, m.w.relatorios[0].id, "-manual-x");
    expect(r.ok).toBe(true);
    expect(sha(prov.enviados[0].anexos[0].bytes)).toBe(m.w.relatorios[0].pdfSha);
    expect(prov.enviados[0].chaveIdempotencia).toBe("escala-relatorio-rel-1-manual-x");
    expect(m.w.fechamentos.get(SEG)).toMatchObject({ emailStatus: "enviado", emailTentativas: 2 });
    expect(m.w.relatorios).toHaveLength(1);
  });
  it("e-mail fora de produção para a Tamara é BLOQUEADO (a tentativa vira 'falhou', nada sai)", async () => {
    const m = criarMundo(); m.w.agora = em("18:00", SEX);
    const real = provedorMock(); const bloqueado = comTravaDeAmbiente({ ...real, nome: "resend" }, false, ["teste@example.com"]);
    expect(daSemana(await rodar(m, bloqueado)).acao).toBe("gerado_email_falhou");
    expect(m.w.fechamentos.get(SEG)!.erroEmail).toContain("bloqueado fora de produção");
    expect(real.enviados).toHaveLength(0);
  });
});

describe("alterações posteriores ao fechamento não mudam a v1", () => {
  it("o conteúdo/hash/PDF da v1 permanecem; a comparação acusa 'alterações posteriores'; nada é reenviado", async () => {
    const m = criarMundo(); const prov = provedorMock(); m.w.agora = em("18:00", SEX);
    await rodar(m, prov);
    const v1 = m.w.relatorios[0]; const { hash } = hashDoConteudo(v1.conteudo);
    expect(hash).toBe(v1.hash);
    const considerados = v1.conteudo.dias.flatMap((d) => d.periodos.filter((p) => p.considerado).map((p) => ({ data: d.data, periodoId: p.id })));
    expect(digestDasFontes(m.w.fontesAtuais, considerados)).toBe(v1.digest); // nada mudou ainda
    // correção posterior (segunda 09:00): muda um apontamento
    m.w.fontesAtuais = { ...m.w.fontesAtuais, apontamentos: m.w.fontesAtuais.apontamentos.map((a, i) => (i === 0 ? { ...a, produzido: a.produzido + 5 } : a)) };
    expect(digestDasFontes(m.w.fontesAtuais, considerados)).not.toBe(v1.digest);
    m.w.agora = em("09:00", "2026-11-09");
    const r = await rodar(m, prov);
    expect(r.find((x) => x.semana === SEG)!.acao).toBe("nada_a_fazer");
    expect(m.w.relatorios).toHaveLength(1); expect(prov.enviados).toHaveLength(1);
    expect(m.w.relatorios[0].hash).toBe(hash);
  });
});

describe("e-mail: provedores", () => {
  const dados = { semanaInicio: SEG, codigo: "ESC-EXEC-2026-45-0001", versao: 1, fechamentoMs: em("18:00", SEX), destinatario: "tamara@sittech.com.br", nomeArquivo: "x.pdf", pdf: new Uint8Array([1, 2, 3]) };
  it("Resend: POST com Bearer, destinatário, assunto e anexo em base64; devolve o id; chave de idempotência", async () => {
    let req: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => { req = { url, init }; return new Response(JSON.stringify({ id: "re_123" }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await provedorResend("re_segredo", "Sittech <relatorios@sittech.com.br>", fake).enviar({ ...montarEmail(dados), chaveIdempotencia: "k1" });
    expect(r.id).toBe("re_123");
    const h = req!.init.headers as Record<string, string>;
    expect(req!.url).toBe("https://api.resend.com/emails"); expect(h.Authorization).toBe("Bearer re_segredo"); expect(h["Idempotency-Key"]).toBe("k1");
    const corpo = JSON.parse(req!.init.body as string);
    expect(corpo).toMatchObject({ from: "Sittech <relatorios@sittech.com.br>", to: ["tamara@sittech.com.br"], subject: "Relatório semanal de revezamento — Semana 02/11 a 08/11" });
    expect(corpo.attachments).toEqual([{ filename: "x.pdf", content: Buffer.from([1, 2, 3]).toString("base64") }]);
  });
  it("Resend recusando (HTTP 4xx/5xx) ou sem rede → erro (nunca 'enviado')", async () => {
    const recusa = (async () => new Response(JSON.stringify({ message: "domínio não verificado" }), { status: 403 })) as unknown as typeof fetch;
    await expect(provedorResend("k", "a@b.c", recusa).enviar(montarEmail(dados))).rejects.toThrow(/domínio não verificado/);
    const semRede = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    await expect(provedorResend("k", "a@b.c", semRede).enviar(montarEmail(dados))).rejects.toThrow(ErroEmail);
  });
  it("sem configuração o provedor falha explicitamente; mock e Resend vêm do ambiente; chave nunca em NEXT_PUBLIC", async () => {
    await expect(provedorDoAmbiente({}).enviar(montarEmail(dados))).rejects.toThrow(/não configurado/);
    await expect(provedorDoAmbiente({ ESCALA_EMAIL_PROVIDER: "resend" }).enviar(montarEmail(dados))).rejects.toThrow(/sem RESEND_API_KEY/);
    expect(provedorDoAmbiente({ ESCALA_EMAIL_PROVIDER: "mock" }).nome).toBe("mock");
    expect(provedorDoAmbiente({ ESCALA_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", ESCALA_EMAIL_FROM: "a@b.c", VERCEL_ENV: "production" }).nome).toBe("resend");
    await expect(provedorDoAmbiente({ ESCALA_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", ESCALA_EMAIL_FROM: "a@b.c", VERCEL_ENV: "preview" }).enviar(montarEmail(dados))).rejects.toThrow(/bloqueado fora de produção/);
  });
});

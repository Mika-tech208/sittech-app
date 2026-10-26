import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { digestDasFontes, fechamentoLogicoMs, hashDoConteudo, montarConteudo } from "@/features/escala-relatorio/conteudo";
import { renderizarPdf } from "@/features/escala-relatorio/pdf";
import type { ConteudoRelatorio, FontesRelatorio } from "@/features/escala-relatorio/tipos";
import { ap, aus, em, fontes, OP, SEG } from "@/features/escala-relatorio/__tests__/fixtures";
import { executarFechamentoAutomatico, INTERVALO_RETENTATIVA_MS, MAX_TENTATIVAS_AUTOMATICAS, segundaDeSP, type ConfigFechamento, type Fechamento, type PortaFechamento } from "../fechamentoAutomatico";

const SEX = "2026-11-06", SAB = "2026-11-07", DOM = "2026-11-08";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const ids = ["m1", "m2", "m3", "t1", "t2", "t3"];
const aps = (f: string, ops: string[]) => ids.map((p, i) => ap(f, p, i % 2 === 0 ? "r3" : "m18", ops[i]));
const base = (): Partial<FontesRelatorio> => ({ apontamentos: [...aps("f1", [OP.rosq, OP.mont, OP.emb, OP.etiq, OP.rosq, OP.mont]), ...aps("f2", [OP.mont, OP.rosq, OP.etiq, OP.emb, OP.mont, OP.rosq])], ausencias: [aus("f3")] });
function textoDoPdf(bytes: Uint8Array): string {
  const s = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let txt: string;
    try { txt = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { continue; }
    for (const l of txt.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(l[1]);
    for (const h of txt.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(h[1], "hex").toString("latin1"));
  }
  return out.join("\n");
}

// ---------- "banco" em memória com a mesma semântica das RPCs (unique semana+tipo, lease, geração marcada na mesma transação do registro) ----------
interface RelGuardado { id: string; versao: number; codigo: string; conteudo: ConteudoRelatorio; hash: string; pdf: Uint8Array; pdfSha: string; digest: string; automatico: boolean; urlVerificacao: string }
function criarMundo(opcoes: { fontes?: Partial<FontesRelatorio>; cfg?: Partial<ConfigFechamento> } = {}) {
  const w = {
    agora: em("12:00", SEX),
    cfg: { ativo: true, desdeSemana: SEG, ...opcoes.cfg } as ConfigFechamento,
    fontesAtuais: fontes({ ...base(), ...opcoes.fontes }),
    fechamentos: new Map<string, Fechamento & { lease: number; erroGeracao: string | null }>(),
    relatorios: [] as RelGuardado[],
    falharGeracao: null as string | null,
    geracoes: 0,
  };
  const porta: PortaFechamento = {
    async config() { return { ...w.cfg }; },
    async lerFontes(semana) { return semana === SEG ? w.fontesAtuais : null; },
    async reivindicar(semana, logicoMs) {
      let f = w.fechamentos.get(semana);
      if (!f) {
        f = { id: `fech-${semana}`, semana, fechamentoLogicoEm: new Date(logicoMs).toISOString(), geracaoStatus: "pendente", geracaoTentativas: 0, geracaoUltimaTentativaEm: null, relatorioId: null, lease: 0, erroGeracao: null };
        w.fechamentos.set(semana, f);
      }
      if (f.geracaoStatus === "gerado") return null;
      if (f.lease > w.agora) return null;
      f.lease = w.agora + 240_000;
      return { ...f };
    },
    async gerar(semana, logicoMs) {
      const f = w.fechamentos.get(semana)!;
      w.geracoes++;
      if (f.geracaoStatus === "gerado" || w.relatorios.some((r) => r.automatico)) throw new Error("duplicate key: uq_escala_relatorio_fechamento_auto");
      if (w.falharGeracao) throw new Error(w.falharGeracao);
      const versao = w.relatorios.length + 1;
      const id = `rel-${versao}`;
      const url = `https://sittech-app.vercel.app/relatorios/escala/verificar/${id}`;
      const c = montarConteudo(w.fontesAtuais, { tipo: "executada", codigo: "ESC-EXEC-2026-45-0001", versao, geradoEmMs: w.agora, geradoPor: { id: "sistema", nome: "Sistema (fechamento automático)" }, urlVerificacao: url, consolidadoAteMs: logicoMs, fechamentoAutomatico: true });
      const { hash } = hashDoConteudo(c);
      const pdf = await renderizarPdf(c, hash);
      w.relatorios.push({ id, versao, codigo: c.codigo, conteudo: c, hash, pdf: pdf.bytes, pdfSha: sha(pdf.bytes), digest: c.fontes.digest, automatico: true, urlVerificacao: url });
      f.geracaoStatus = "gerado"; f.relatorioId = id; f.geracaoTentativas++; f.geracaoUltimaTentativaEm = new Date(w.agora).toISOString(); f.lease = 0;
      return { id, codigo: c.codigo, tipo: "executada" as const, versao, status: c.status, hash, pdfSha256: sha(pdf.bytes), paginas: pdf.paginas, nomeArquivo: pdf.nomeArquivo, geradoEm: c.geradoEm };
    },
    async erroGeracao(id, erro) {
      const f = [...w.fechamentos.values()].find((x) => x.id === id)!;
      if (f.geracaoStatus !== "gerado") { f.geracaoStatus = "erro"; f.geracaoTentativas++; f.erroGeracao = erro; f.geracaoUltimaTentativaEm = new Date(w.agora).toISOString(); f.lease = 0; }
    },
    async liberar(id) { const f = [...w.fechamentos.values()].find((x) => x.id === id); if (f) f.lease = 0; },
  };
  return { w, porta };
}
const rodar = (m: ReturnType<typeof criarMundo>) => executarFechamentoAutomatico(m.porta, m.w.agora);
const daSemana = (r: Awaited<ReturnType<typeof rodar>>) => r.find((x) => x.semana === SEG)!;

describe("fechamento automático — quando", () => {
  it("sexta 17:59 NÃO gera; sexta 18:00 gera o FINAL e arquiva", async () => {
    const m = criarMundo();
    m.w.agora = em("17:59", SEX);
    expect(daSemana(await rodar(m)).acao).toBe("aguardando");
    expect(m.w.relatorios).toHaveLength(0); expect(m.w.fechamentos.size).toBe(0);
    m.w.agora = em("18:00", SEX);
    expect(daSemana(await rodar(m)).acao).toBe("gerado");
    expect(m.w.relatorios).toHaveLength(1); expect(m.w.relatorios[0].conteudo.status).toBe("final");
  });
  it("execução atrasada (18:10): gerado em 18:10, consolidado até 18:00 (snapshot do fechamento lógico)", async () => {
    const m = criarMundo(); m.w.agora = em("18:10", SEX);
    await rodar(m);
    const c = m.w.relatorios[0].conteudo;
    expect(c.geradoEmTexto).toBe("06/11/2026 às 18:10:00");
    expect(c.consolidadoAteTexto).toBe("06/11/2026 18:00:00");
    expect(c.fechamentoAutomatico).toBe(true);
    expect(m.w.fechamentos.get(SEG)!.fechamentoLogicoEm).toBe(new Date(em("18:00", SEX)).toISOString());
  });
  it("sábado produtivo: sexta 18:05 não gera; sábado 17:59 não gera; sábado 18:00 gera", async () => {
    const m = criarMundo({ fontes: { diasProdutivos: [SEG, SAB] } });
    m.w.agora = em("18:05", SEX); expect(daSemana(await rodar(m)).acao).toBe("aguardando");
    m.w.agora = em("17:59", SAB); expect(daSemana(await rodar(m)).acao).toBe("aguardando");
    m.w.agora = em("18:00", SAB); expect(daSemana(await rodar(m)).acao).toBe("gerado");
    expect(m.w.fechamentos.get(SEG)!.fechamentoLogicoEm).toBe(new Date(em("18:00", SAB)).toISOString());
  });
  it("domingo produtivo: gera só no domingo 18:00", async () => {
    const m = criarMundo({ fontes: { diasProdutivos: [SEG, SAB, DOM] } });
    m.w.agora = em("18:30", SAB); expect(daSemana(await rodar(m)).acao).toBe("aguardando");
    m.w.agora = em("18:00", DOM); expect(daSemana(await rodar(m)).acao).toBe("gerado");
    expect(m.w.fechamentos.get(SEG)!.fechamentoLogicoEm).toBe(new Date(em("18:00", DOM)).toISOString());
  });
  it("sábado NÃO produtivo: o fechamento é a sexta 18:00; sexta sem produção também fecha na sexta", () => {
    expect(fechamentoLogicoMs(fontes({ diasProdutivos: [SEG] }))).toBe(em("18:00", SEX));
    expect(fechamentoLogicoMs(fontes({ diasProdutivos: [SEG, SEX] }))).toBe(em("18:00", SEX));
  });
  it("semana sem nenhum dia produtivo não gera relatório", async () => {
    const m = criarMundo({ fontes: { diasProdutivos: [] } }); m.w.agora = em("19:00", SEX);
    expect(daSemana(await rodar(m)).acao).toBe("sem_dias_produtivos");
    expect(m.w.relatorios).toHaveLength(0); expect(m.w.fechamentos.size).toBe(0);
  });
  it("desligado (padrão) não faz nada; semanas anteriores a desde_semana não são geradas retroativamente", async () => {
    const off = criarMundo({ cfg: { ativo: false } }); off.w.agora = em("19:00", SEX);
    expect((await rodar(off))[0].acao).toBe("desligado"); expect(off.w.relatorios).toHaveLength(0);
    const futuro = criarMundo({ cfg: { desdeSemana: "2026-11-09" } }); futuro.w.agora = em("19:00", SEX);
    expect(await rodar(futuro)).toEqual([]); expect(futuro.w.relatorios).toHaveLength(0);
  });
  it("segunda-feira de São Paulo (inclusive perto da meia-noite UTC)", () => {
    expect(segundaDeSP(em("18:00", SEX))).toBe(SEG);
    expect(segundaDeSP(em("23:59", DOM))).toBe(SEG);
    expect(segundaDeSP(em("00:00", "2026-11-09"))).toBe("2026-11-09");
  });
});

describe("o que é arquivado", () => {
  it("PDF armazenado íntegro: hash do PDF confere, hash canônico confere, QR/URL de PROD, assinaturas, FINAL automático — e nenhum e-mail existe no fluxo", async () => {
    const m = criarMundo(); m.w.agora = em("18:07", SEX);
    const r = daSemana(await rodar(m));
    expect(r).toMatchObject({ acao: "gerado", versao: 1 });
    const g = m.w.relatorios[0];
    expect(sha(g.pdf)).toBe(g.pdfSha);
    expect(hashDoConteudo(g.conteudo).hash).toBe(g.hash);
    expect(g.urlVerificacao.startsWith("https://sittech-app.vercel.app/relatorios/escala/verificar/")).toBe(true);
    const t = textoDoPdf(g.pdf);
    expect(t).toContain("RELATÓRIO FINAL"); expect(t).toContain("Finalizado automaticamente pelo sistema");
    expect(t).toContain(g.urlVerificacao);
    for (const x of ["RESPONSÁVEL PELA PRODUÇÃO", "TESTEMUNHA 1", "TESTEMUNHA 2", "CPF:"]) expect(t).toContain(x);
    // sem e-mail: nem a porta nem o serviço/orquestrador conhecem provedor/destinatário
    for (const arq of ["../fechamentoAutomatico.ts", "../servico.ts"]) {
      const fonte = readFileSync(new URL(arq, import.meta.url), "utf8");
      expect(/resend|ProvedorEmail|montarEmail|nodemailer|smtp|destinat/i.test(fonte)).toBe(false);
    }
  });
});

describe("idempotência e versões", () => {
  it("duas execuções SIMULTÂNEAS geram UM final", async () => {
    const m = criarMundo(); m.w.agora = em("18:00", SEX);
    const [a, b] = await Promise.all([rodar(m), rodar(m)]);
    expect(m.w.relatorios).toHaveLength(1); expect(m.w.geracoes).toBe(1);
    expect([daSemana(a).acao, daSemana(b).acao].sort()).toEqual(["gerado", "nada_a_fazer"]);
  });
  it("execuções seguintes (a cada 5 min, no dia seguinte, na segunda) não fazem nada", async () => {
    const m = criarMundo(); m.w.agora = em("18:00", SEX); await rodar(m);
    for (const [h, d] of [["18:05", SEX], ["23:00", SEX], ["06:00", SAB], ["09:00", "2026-11-09"]] as const) { m.w.agora = em(h, d); expect(daSemana(await rodar(m)).acao).toBe("nada_a_fazer"); }
    expect(m.w.relatorios).toHaveLength(1); expect(m.w.geracoes).toBe(1);
  });
  it("parcial MANUAL já existente → o final automático é a próxima versão (v2)", async () => {
    const m = criarMundo(); m.w.agora = em("18:00", SEX);
    m.w.relatorios.push({ id: "rel-manual", versao: 1, codigo: "ESC-EXEC-2026-45-0001", conteudo: montarConteudo(m.w.fontesAtuais, { tipo: "executada", codigo: "ESC-EXEC-2026-45-0001", versao: 1, geradoEmMs: em("10:00", SEX), geradoPor: { id: "u1", nome: "Admin" }, urlVerificacao: "https://x.test/1" }), hash: "h", pdf: new Uint8Array([1]), pdfSha: "s", digest: "d", automatico: false, urlVerificacao: "https://x.test/1" });
    expect(m.w.relatorios[0].conteudo.status).toBe("parcial");
    expect(daSemana(await rodar(m))).toMatchObject({ acao: "gerado", versao: 2 });
    expect(m.w.relatorios).toHaveLength(2); expect(m.w.relatorios[1]).toMatchObject({ versao: 2, automatico: true });
    expect(m.w.relatorios[0].hash).toBe("h"); // o parcial manual permanece intacto
  });
});

describe("falha de geração", () => {
  it("falha técnica: registra o erro, não grava relatório, tenta de novo depois SEM criar v2", async () => {
    const m = criarMundo(); m.w.agora = em("18:00", SEX);
    m.w.falharGeracao = "pdf quebrou";
    expect(daSemana(await rodar(m))).toMatchObject({ acao: "erro_geracao", detalhe: "pdf quebrou" });
    expect(m.w.fechamentos.get(SEG)).toMatchObject({ geracaoStatus: "erro", geracaoTentativas: 1, erroGeracao: "pdf quebrou" });
    expect(m.w.relatorios).toHaveLength(0);
    m.w.agora += 5 * 60_000; expect(daSemana(await rodar(m)).acao).toBe("aguardando_retentativa");
    m.w.falharGeracao = null; m.w.agora += INTERVALO_RETENTATIVA_MS;
    expect(daSemana(await rodar(m))).toMatchObject({ acao: "gerado", versao: 1 });
    expect(m.w.relatorios).toHaveLength(1); expect(m.w.fechamentos.get(SEG)!.geracaoTentativas).toBe(2);
  });
  it("depois de muitas falhas o worker para (esgotado) e o erro continua visível", async () => {
    const m = criarMundo(); m.w.agora = em("18:00", SEX); m.w.falharGeracao = "banco fora";
    for (let i = 0; i < MAX_TENTATIVAS_AUTOMATICAS; i++) { await rodar(m); m.w.agora += INTERVALO_RETENTATIVA_MS; }
    expect(daSemana(await rodar(m)).acao).toBe("esgotado");
    expect(m.w.fechamentos.get(SEG)).toMatchObject({ geracaoStatus: "erro", geracaoTentativas: MAX_TENTATIVAS_AUTOMATICAS });
  });
});

describe("worker atrasado: os fatos do relatório não dependem de quando o worker roda", () => {
  it("rodando às 18:00, 18:07, 18:25 e 19:00 o conteúdo factual é idêntico; só `gerado em` muda; consolidado até continua 18:00", async () => {
    const conteudos: ConteudoRelatorio[] = [];
    const fatos = base(); // os MESMOS fatos (mesmos ids) em todas as execuções
    for (const h of ["18:00", "18:07", "18:25", "19:00"]) {
      const m = criarMundo({ fontes: fatos }); m.w.agora = em(h, SEX);
      expect(daSemana(await rodar(m)).acao).toBe("gerado");
      conteudos.push(m.w.relatorios[0].conteudo);
    }
    const semGeracao = (c: ConteudoRelatorio) => { const { geradoEm, geradoEmTexto, ...resto } = c; void geradoEm; void geradoEmTexto; return JSON.stringify(resto); };
    expect(new Set(conteudos.map(semGeracao)).size).toBe(1);
    expect(conteudos.map((c) => c.geradoEmTexto.slice(-8))).toEqual(["18:00:00", "18:07:00", "18:25:00", "19:00:00"]);
    expect(new Set(conteudos.map((c) => c.consolidadoAteTexto)).size).toBe(1);
    expect(conteudos[0].consolidadoAteTexto).toBe("06/11/2026 18:00:00");
    expect(new Set(conteudos.map((c) => c.fontes.digest)).size).toBe(1);
  });
});

describe("alterações posteriores ao fechamento não mudam a v1", () => {
  it("o conteúdo/hash/PDF da v1 permanecem; a comparação acusa 'alterações posteriores'; nada é regerado", async () => {
    const m = criarMundo(); m.w.agora = em("18:00", SEX);
    await rodar(m);
    const v1 = m.w.relatorios[0]; const { hash } = hashDoConteudo(v1.conteudo);
    expect(hash).toBe(v1.hash);
    const considerados = v1.conteudo.dias.flatMap((d) => d.periodos.filter((p) => p.considerado).map((p) => ({ data: d.data, periodoId: p.id })));
    expect(digestDasFontes(m.w.fontesAtuais, considerados)).toBe(v1.digest); // nada mudou ainda
    m.w.fontesAtuais = { ...m.w.fontesAtuais, apontamentos: m.w.fontesAtuais.apontamentos.map((a, i) => (i === 0 ? { ...a, produzido: a.produzido + 5 } : a)) };
    expect(digestDasFontes(m.w.fontesAtuais, considerados)).not.toBe(v1.digest);
    m.w.agora = em("09:00", "2026-11-09");
    expect(daSemana(await rodar(m)).acao).toBe("nada_a_fazer");
    expect(m.w.relatorios).toHaveLength(1); expect(m.w.relatorios[0].hash).toBe(hash);
  });
});

describe("FINAL já gerado e depois mudam os dias produtivos da semana", () => {
  it("sábado vira produtivo depois do final de sexta: o PDF antigo não muda, o worker não regera, a tela acusa 'alterações posteriores'; só nova versão manual reflete a mudança", async () => {
    const m = criarMundo(); m.w.agora = em("18:00", SEX);
    expect(daSemana(await rodar(m)).acao).toBe("gerado");
    const v1 = m.w.relatorios[0]; const pdfAntes = v1.pdfSha; const hashAntes = v1.hash;
    const considerados = v1.conteudo.dias.flatMap((d) => d.periodos.filter((p) => p.considerado).map((p) => ({ data: d.data, periodoId: p.id })));
    expect(digestDasFontes(m.w.fontesAtuais, considerados)).toBe(v1.digest);               // nada mudou ainda → sem aviso
    m.w.fontesAtuais = { ...m.w.fontesAtuais, diasProdutivos: [SEG, SAB] };                // alguém marca o sábado como produtivo
    expect(fechamentoLogicoMs(m.w.fontesAtuais)).toBe(em("18:00", SAB));                   // o fechamento lógico atual passaria a ser o de sábado...
    expect(digestDasFontes(m.w.fontesAtuais, considerados)).not.toBe(v1.digest);          // ...e a v1 é marcada como tendo alterações posteriores (mesmo comparador da tela)
    for (const [h, d] of [["18:05", SEX], ["06:00", SAB]] as const) { m.w.agora = em(h, d); expect(["aguardando", "nada_a_fazer"]).toContain(daSemana(await rodar(m)).acao); } // antes do "novo" fechamento: nada é gerado
    for (const [h, d] of [["18:00", SAB], ["18:30", SAB]] as const) { m.w.agora = em(h, d); expect(daSemana(await rodar(m)).acao).toBe("nada_a_fazer"); }   // no "novo" fechamento: o final desta semana já existe
    expect(m.w.relatorios).toHaveLength(1); expect(m.w.geracoes).toBe(1);
    expect(v1.pdfSha).toBe(pdfAntes); expect(v1.hash).toBe(hashAntes); expect(hashDoConteudo(v1.conteudo).hash).toBe(hashAntes);
    expect(v1.conteudo.dias.map((d) => d.data)).toEqual([SEG]);                            // o snapshot continua com os dias de 18:00
  });
});

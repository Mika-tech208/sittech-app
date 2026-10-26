// RENDERIZAÇÃO DO PDF a partir do SNAPSHOT (nunca de dados atuais). A4 paisagem, preto e branco, só Helvetica (padrão do PDF), páginas numeradas, rodapé fixo.
// Determinístico: mesmo snapshot + mesmo hash ⇒ mesmos bytes (datas do PDF = gerado_em; sem IDs aleatórios).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { nomeArquivo, ROTULO_ESTADO } from "./conteudo";
import type { Celula, ConteudoRelatorio } from "./tipos";

const W = 841.89, H = 595.28, M = 28;
const PRETO = rgb(0, 0, 0), CINZA = rgb(0.45, 0.45, 0.45), CINZA_CLARO = rgb(0.9, 0.9, 0.9), BORDA = rgb(0.6, 0.6, 0.6);

export const DECLARACAO =
  "Os signatários declaram que, até onde lhes consta, as informações constantes neste relatório correspondem à execução das atividades de produção e ao revezamento praticado no período indicado.";

export interface ResultadoPdf { bytes: Uint8Array; paginas: number; nomeArquivo: string }

export async function renderizarPdf(c: ConteudoRelatorio, hash: string): Promise<ResultadoPdf> {
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const data = new Date(c.geradoEm);
  pdf.setTitle(`${c.codigo} v${c.versao} — ${c.titulo}`);
  pdf.setAuthor("Sittech Soluções Industriais");
  pdf.setSubject(`Semana ${c.semana.texto}`);
  pdf.setCreator("Sittech");
  pdf.setProducer("Sittech");
  pdf.setCreationDate(data);
  pdf.setModificationDate(data);

  const suportado = new Map<string, boolean>();
  const seguro = (font: PDFFont, s: string): string => {
    const t = s.replace(/→/g, "->").replace(/≠/g, "!=").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    let out = "";
    for (const ch of t) {
      const k = font === fb ? `b${ch}` : `r${ch}`;
      let ok = suportado.get(k);
      if (ok === undefined) { try { font.encodeText(ch); ok = true; } catch { ok = false; } suportado.set(k, ok); }
      out += ok ? ch : "?";
    }
    return out;
  };
  const larg = (font: PDFFont, s: string, size: number) => font.widthOfTextAtSize(seguro(font, s), size);
  const cortar = (font: PDFFont, s: string, size: number, max: number) => {
    let t = seguro(font, s);
    if (font.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
    return `${t}…`;
  };
  const quebrar = (font: PDFFont, s: string, size: number, max: number): string[] => {
    const linhas: string[] = [];
    let atual = "";
    seguro(font, s).split(/\s+/).filter(Boolean).forEach((p) => {
      const tent = atual ? `${atual} ${p}` : p;
      if (font.widthOfTextAtSize(tent, size) <= max) atual = tent;
      else { if (atual) linhas.push(atual); atual = p; }
    });
    if (atual) linhas.push(atual);
    return linhas;
  };
  const texto = (pg: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont = f, cor = PRETO) => pg.drawText(seguro(font, s), { x, y, size, font, color: cor });
  const direita = (pg: PDFPage, s: string, xDir: number, y: number, size: number, font: PDFFont = f) => texto(pg, s, xDir - larg(font, s, size), y, size, font);
  const linha = (pg: PDFPage, x1: number, y1: number, x2: number, y2: number, espessura = 0.5, cor = BORDA) => pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: espessura, color: cor });
  const caixa = (pg: PDFPage, x: number, y: number, w: number, h: number, espessura = 0.5, fundo?: ReturnType<typeof rgb>) => pg.drawRectangle({ x, y, width: w, height: h, borderWidth: espessura, borderColor: BORDA, color: fundo });

  const teste = c.codigo.startsWith("TESTE-"); // PDF do botão TESTAR ENVIO: nunca é documento oficial
  const parcial = c.status === "parcial";
  const faixa = parcial ? "RELATÓRIO PARCIAL" : "RELATÓRIO FINAL";
  const paginas: PDFPage[] = [];
  let pg!: PDFPage;
  let y = 0;

  const cabecalho = (primeira: boolean) => {
    texto(pg, c.empresa, M, H - M - 8, 10, fb);
    direita(pg, faixa, W - M, H - M - 8, 10, fb);
    if (teste) texto(pg, "TESTE — DADOS FICTÍCIOS — SEM VALOR DOCUMENTAL", M + 280, H - M - 8, 10, fb, rgb(0.75, 0.1, 0.1));
    texto(pg, c.titulo, M, H - M - 21, primeira ? 12 : 9, fb);
    texto(pg, `Semana: ${c.semana.texto}   |   ${c.codigo}   |   Versão ${c.versao}${parcial ? `   |   Dados consolidados até ${c.consolidadoAteTexto}` : ""}`, M, H - M - (primeira ? 36 : 33), 8);
    linha(pg, M, H - M - (primeira ? 42 : 38), W - M, H - M - (primeira ? 42 : 38), 0.8, PRETO);
    y = H - M - (primeira ? 54 : 50);
  };
  const novaPagina = (primeira = false) => { pg = pdf.addPage([W, H]); paginas.push(pg); cabecalho(primeira); };
  const garantir = (altura: number) => { if (y - altura < M + 28) novaPagina(); };

  // ---------------- página 1: identificação e resumo ----------------
  novaPagina(true);
  if (parcial) {
    caixa(pg, M, y - 30, W - 2 * M - 90, 30, 1.2);
    texto(pg, "RELATÓRIO PARCIAL", M + 8, y - 13, 11, fb);
    texto(pg, `Dados consolidados até: ${c.consolidadoAteTexto}. Períodos futuros e os encerrados há menos de ${c.toleranciaApontamentoMin} min não são tratados como executados.`, M + 8, y - 25, 7.5);
  } else {
    caixa(pg, M, y - 22, W - 2 * M - 90, 22, 1.2);
    texto(pg, "RELATÓRIO FINAL", M + 8, y - 14, 11, fb);
    texto(pg, c.fechamentoAutomatico ? `Finalizado automaticamente pelo sistema em ${c.elegivelFinalEmTexto.replace(/:00$/, "")}; dados consolidados até ${c.consolidadoAteTexto}.` : `Semana encerrada; dados consolidados em ${c.consolidadoAteTexto}.`, M + 120, y - 14, 8);
  }
  // QR (vetor) no canto direito
  const qr = QRCode.create(c.urlVerificacao, { errorCorrectionLevel: "M" });
  const mod = 68 / (qr.modules.size + 8);
  const qx = W - M - 72, qy = y - 70;
  pg.drawRectangle({ x: qx - 2, y: qy - 2, width: 72 + 4, height: 72 + 4, color: rgb(1, 1, 1), borderWidth: 0.5, borderColor: BORDA });
  for (let r = 0; r < qr.modules.size; r++) for (let col = 0; col < qr.modules.size; col++) {
    if (qr.modules.get(r, col)) pg.drawRectangle({ x: qx + (col + 4) * mod, y: qy + 72 - (r + 5) * mod, width: mod, height: mod, color: PRETO });
  }
  texto(pg, "Verificar autenticidade", qx - 2, qy - 10, 6.5);
  y -= 46;

  const campo = (rot: string, val: string, x: number, yy: number) => { texto(pg, rot, x, yy, 7, f, CINZA); texto(pg, val, x, yy - 10, 9.5, fb); };
  campo("Semana", c.semana.texto, M, y); campo("Código do relatório", c.codigo, M + 170, y); campo("Versão", String(c.versao), M + 340, y);
  campo("Tipo", c.tipo === "executada" ? "Revezamento executado" : "Escala planejada", M + 400, y); campo("Gerado em (America/Sao_Paulo)", c.geradoEmTexto, M + 560, y);
  y -= 30;
  campo(c.fechamentoAutomatico ? "Gerado" : "Gerado por", c.fechamentoAutomatico ? "Automaticamente pelo sistema" : c.geradoPor.nome, M, y); campo("Situação", parcial ? "PARCIAL" : "FINAL", M + 170, y);
  campo("Fechamento (FINAL a partir de)", c.elegivelFinalEmTexto, M + 340, y);
  campo("Plano oficial (versão / hash)", c.fontes.planoVersao ? `${c.fontes.planoVersao.id.slice(0, 8)} / ${c.fontes.planoVersao.hashPlano.slice(0, 12)}` : "sem versão registrada", M + 560, y);
  y -= 32;
  linha(pg, M, y, W - M, y, 0.5);
  y -= 16;

  const rev = c.resumo.revezamento;
  texto(pg, "Revezamento verificado:", M, y, 11, fb);
  texto(pg, ROTULO_ESTADO[rev.estado], M + 140, y, 13, fb);
  y -= 14;
  quebrar(f, rev.frase, 9, W - 2 * M - 100).forEach((l) => { texto(pg, l, M, y, 9); y -= 11; });
  y -= 2;
  texto(pg, `Transições verificadas (os dois períodos comprovados por apontamento): ${rev.verificadas}   |   não aplicáveis (ausência/sem posto): ${rev.naoAplicaveis}   |   não verificáveis: ${rev.naoVerificaveis}   |   violações: ${rev.violacoes.length}`, M, y, 8);
  y -= 16;

  if (c.resumo.cobertura) {
    const k = c.resumo.cobertura;
    texto(pg, "Completude da evidência (separada da conformidade do revezamento)", M, y, 10, fb);
    y -= 13;
    const linhas: [string, string][] = [
      ["Períodos/pessoas esperados", String(k.esperados)],
      ["Comprovados por apontamento", String(k.porApontamento)],
      ["Comprovados por ausência", String(k.porAusencia)],
      ["Escala oficial sem apontamento (evidência fraca)", String(k.oficialSemApontamento)],
      ["Não comprovado (escala oficial contradita pelos apontamentos)", String(k.naoComprovado)],
      ["Sem evidência", String(k.semEvidencia)],
    ];
    linhas.forEach(([a, b]) => { texto(pg, a, M, y, 9); direita(pg, b, M + 330, y, 9, fb); y -= 11.5; });
    texto(pg, "Cobertura de evidência", M, y - 2, 9.5, fb); direita(pg, k.percentualTexto, M + 330, y - 2, 9.5, fb);
    texto(pg, `= (apontamento + ausência) / esperados = ${k.numerador} / ${k.esperados}`, M + 345, y - 2, 8, f, CINZA);
    y -= 18;
    texto(pg, `Planejado diferente do realizado: ${c.resumo.divergencias} período(s)   |   Inconsistências (apontamento e ausência no mesmo período): ${c.resumo.inconsistencias}   |   Período não conta como erro: a realidade operacional pode mudar.`, M, y, 8);
    y -= 14;
  }
  texto(pg, "Legenda:  † escala oficial sem apontamento (evidência fraca, NÃO é execução comprovada)   ‡ planejado diferente do realizado   (!) violação do revezamento   — pessoa não esperada / período não consolidado", M, y, 7.5, f, CINZA);
  y -= 20;
  texto(pg, "Integridade", M, y, 9.5, fb); y -= 11;
  texto(pg, `SHA-256 do conteúdo: ${hash.slice(0, 16)}…${hash.slice(-8)} (completo registrado no sistema).`, M, y, 8); y -= 10;
  texto(pg, `Verificação: ${c.urlVerificacao}`, M, y, 8); y -= 10;
  texto(pg, "O hash prova que o conteúdo registrado não foi alterado depois de gerado; ele não substitui a conferência dos fatos pelos responsáveis.", M, y, 7.5, f, CINZA);
  c.fontes.avisos.forEach((a) => quebrar(f, `Aviso: ${a}`, 7.5, W - 2 * M).forEach((l) => { y -= 10; texto(pg, l, M, y, 7.5, f, CINZA); }));

  // ---------------- grade por funcionário (começa em página própria: a 1ª é só identificação e resumo) ----------------
  novaPagina();
  const colDia = 66, colP = (W - 2 * M - colDia) / 6;
  const viol = new Set<string>();
  rev.violacoes.forEach((v) => { viol.add(`${v.funcionario}|${v.data}|${v.de}`); viol.add(`${v.funcionario}|${v.data}|${v.para}`); });
  const nomesPeriodos = ["m1", "m2", "m3", "t1", "t2", "t3"];
  const diaInfo = new Map(c.dias.map((d) => [d.data, d]));
  const dataSemana = (iso: string) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(`${iso}T12:00:00Z`).getUTCDay()];
  const ALT = 31;

  const linhasDaCelula = (cel: Celula | null, considerado: boolean): { l: string[]; forte: boolean; fundo: boolean } => {
    if (!considerado) return { l: ["(não consolidado)"], forte: false, fundo: false };
    if (!cel) return { l: ["—"], forte: false, fundo: false };
    const un = cel.postos[0];
    switch (cel.fonte) {
      case "APONTAMENTO":
      case "PLANEJADO": {
        const sufixo = cel.divergente ? " ‡" : "";
        if (cel.postos.length === 1) return { l: [`${un.maquina}${sufixo}`, un.operacao, un.produto], forte: true, fundo: false };
        return { l: [...cel.postos.slice(0, 2).map((p) => `${p.maquina} · ${p.operacao}`), `${cel.postos.length} apontamentos${sufixo}`], forte: true, fundo: false };
      }
      case "AUSENCIA": return { l: ["AUSÊNCIA", cel.detalhe ?? ""], forte: true, fundo: false };
      case "OFICIAL_SEM_APONTAMENTO": return { l: [`† ${un.maquina}`, un.operacao, "sem apontamento"], forte: false, fundo: true };
      case "SEM_POSTO_OFICIAL": return { l: ["† SEM POSTO (oficial)", cel.detalhe ?? ""], forte: false, fundo: true };
      case "PLANEJADO_SEM_POSTO": return { l: ["SEM POSTO", cel.detalhe ?? ""], forte: true, fundo: false };
      case "NAO_COMPROVADO": return { l: ["NÃO COMPROVADO", ...quebrar(f, cel.detalhe ?? "", 5.5, colP - 6).slice(0, 2)], forte: false, fundo: true };
      default: return { l: ["SEM EVIDÊNCIA"], forte: false, fundo: true };
    }
  };

  const alturaBloco = (nDias: number) => 14 + 11 + nDias * ALT + 10;
  c.funcionarios.forEach((fn) => {
    const altura = alturaBloco(fn.dias.length);
    garantir(altura);
    pg.drawRectangle({ x: M, y: y - 13, width: W - 2 * M, height: 13, color: CINZA_CLARO });
    texto(pg, fn.nome, M + 4, y - 10, 9.5, fb);
    y -= 14;
    const diaRef = fn.dias[0] ? diaInfo.get(fn.dias[0].data) : undefined;
    texto(pg, "Dia", M + 3, y - 8, 7, fb, CINZA);
    nomesPeriodos.forEach((pid, i) => {
      const p = diaRef?.periodos.find((x) => x.id === pid);
      texto(pg, p ? `${p.nome}  ${p.inicio}–${p.fim}` : pid.toUpperCase(), M + colDia + i * colP + 3, y - 8, 7, fb, CINZA);
    });
    y -= 11;
    fn.dias.forEach((d) => {
      const info = diaInfo.get(d.data);
      caixa(pg, M, y - ALT, colDia, ALT);
      texto(pg, `${dataSemana(d.data)} ${d.data.slice(8, 10)}/${d.data.slice(5, 7)}`, M + 4, y - 12, 8.5, fb);
      nomesPeriodos.forEach((pid, i) => {
        const x = M + colDia + i * colP;
        const cel = d.celulas[pid] ?? null;
        const per = info?.periodos.find((p) => p.id === pid);
        const { l, forte, fundo } = linhasDaCelula(cel, per?.considerado ?? true);
        const periodoNome = per?.nome ?? pid.toUpperCase();
        const emViolacao = viol.has(`${fn.nome}|${d.data}|${periodoNome}`);
        caixa(pg, x, y - ALT, colP, ALT, emViolacao ? 1.6 : 0.5, fundo ? rgb(0.93, 0.93, 0.93) : undefined);
        l.slice(0, 3).forEach((s, k) => texto(pg, cortar(k === 0 && forte ? fb : f, `${emViolacao && k === 0 ? "(!) " : ""}${s}`, k === 0 ? 7 : 6.2, colP - 6), x + 3, y - 9 - k * 8.6, k === 0 ? 7 : 6.2, k === 0 && forte ? fb : f, k === 0 ? PRETO : rgb(0.2, 0.2, 0.2)));
      });
      y -= ALT;
    });
    y -= 10;
  });

  // ---------------- violações / sem produção / ausências ----------------
  const tabela = (titulo: string, cab: string[], larguras: number[], linhas: string[][], vazio: string) => {
    garantir(40);
    texto(pg, titulo, M, y, 10, fb); y -= 13;
    if (linhas.length === 0) { texto(pg, vazio, M, y, 9); y -= 16; return; }
    const desenhaCab = () => { let x = M; cab.forEach((h, i) => { texto(pg, h, x + 2, y, 7, fb, CINZA); x += larguras[i]; }); y -= 4; linha(pg, M, y, W - M, y, 0.5); y -= 9; };
    desenhaCab();
    linhas.forEach((r) => {
      if (y < M + 40) { novaPagina(); texto(pg, `${titulo} (continuação)`, M, y, 9, fb); y -= 13; desenhaCab(); }
      let x = M; r.forEach((v, i) => { texto(pg, cortar(f, v, 8, larguras[i] - 4), x + 2, y, 8); x += larguras[i]; }); y -= 10.5;
    });
    y -= 10;
  };
  const dFmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  tabela(
    "Violações do revezamento encontradas", ["Funcionário", "Data", "Transição", "Operação repetida", "Máquinas"], [200, 70, 110, 150, W - 2 * M - 530],
    rev.violacoes.map((v) => [v.funcionario, dFmt(v.data), `${v.de} -> ${v.para}`, v.operacao, v.maquinas]), "Nenhuma violação comprovada neste relatório."
  );
  if (c.tipo === "executada") {
    tabela(
      "Máquinas lançadas sem produção (Produção Real)", ["Data", "Período", "Máquina", "Motivo"], [80, 70, 260, W - 2 * M - 410],
      c.semProducao.map((s) => [dFmt(s.data), s.periodoId.toUpperCase(), s.maquina, s.motivo]), "Nenhum lançamento sem produção nos períodos consolidados."
    );
    tabela(
      "Ausências registradas na semana", ["Funcionário", "Data", "Tipo", "Janela"], [220, 80, 200, W - 2 * M - 500],
      c.ausencias.map((a) => [a.funcionario, dFmt(a.data), a.tipo, a.janela]), "Nenhuma ausência registrada."
    );
  }

  // ---------------- declaração e assinaturas ----------------
  garantir(250);
  y -= 6;
  texto(pg, "Declaração", M, y, 10, fb); y -= 13;
  quebrar(f, DECLARACAO, 9, W - 2 * M).forEach((l) => { texto(pg, l, M, y, 9); y -= 11.5; });
  y -= 14;
  const bloco = (titulo: string, x: number, w: number, cpf: boolean) => {
    texto(pg, titulo, x, y, 8.5, fb);
    const campos = cpf ? ["Nome:", "CPF:", "Assinatura:", "Data:  ___/___/______"] : ["Nome:", "Assinatura:", "Data:  ___/___/______"];
    let yy = y - 22;
    campos.forEach((rot) => { texto(pg, rot, x, yy, 8); if (!rot.startsWith("Data")) linha(pg, x + larg(f, rot, 8) + 4, yy - 2, x + w - 8, yy - 2, 0.5, PRETO); yy -= 26; });
  };
  const wB = (W - 2 * M - 30) / 3;
  bloco("RESPONSÁVEL PELA PRODUÇÃO", M, wB, false);
  bloco("TESTEMUNHA 1", M + wB + 15, wB, true);
  bloco("TESTEMUNHA 2", M + 2 * (wB + 15), wB, true);

  // ---------------- rodapé em todas as páginas ----------------
  const total = paginas.length;
  paginas.forEach((p, i) => {
    linha(p, M, M + 16, W - M, M + 16, 0.5);
    texto(p, "Sittech Soluções Industriais", M, M + 5, 7.5);
    const meio = `${c.codigo}  ·  v${c.versao}`;
    texto(p, meio, (W - larg(f, meio, 7.5)) / 2, M + 5, 7.5);
    direita(p, `Página ${i + 1} de ${total}  ·  SHA-256 ${hash.slice(0, 12)}…`, W - M, M + 5, 7.5);
  });

  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, paginas: total, nomeArquivo: nomeArquivo(c) };
}

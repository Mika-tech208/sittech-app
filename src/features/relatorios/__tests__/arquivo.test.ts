import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { temPermissao } from "@/lib/permissoes";
import { modeloLinha, montarQuery, nomeArquivoPdf, rotuloSemana, SECOES, TAMANHO_PAGINA, urlVerificar, type ItemArquivo } from "../arquivo";
import { ESTILOS_RELATORIOS } from "../estilos";

const item = (extra: Partial<ItemArquivo> = {}): ItemArquivo => ({
  id: "00000000-0000-4000-8000-000000000001", semanaInicio: "2026-10-26", tipo: "executada", codigo: "ESC-EXEC-2026-44-0001", versao: 2, nVersoes: 2, status: "final", geradoEm: "2026-10-30T21:07:00Z", consolidadoAte: "2026-10-30T21:00:00Z",
  fechamentoAutomatico: true, geradoPor: null, pdfBytes: 70000, hash: "a".repeat(64), cobertura: "98,7%", conformidade: "SIM_COM_RESSALVAS", alteracoesPosteriores: false, ...extra,
});
const fonte = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("aba Relatórios — permissão e navegação", () => {
  it("admin e quem tem escala_relatorios veem a aba; quem não tem (ou não está logado) não vê", () => {
    expect(temPermissao({ papel: "admin", permissoes: [] }, "escala_relatorios")).toBe(true);
    expect(temPermissao({ papel: "usuario", permissoes: ["escala_relatorios"] }, "escala_relatorios")).toBe(true);
    expect(temPermissao({ papel: "usuario", permissoes: ["escala_producao"] }, "escala_relatorios")).toBe(false);
    expect(temPermissao({ papel: "usuario", permissoes: [] }, "escala_relatorios")).toBe(false);
    expect(temPermissao(null, "escala_relatorios")).toBe(false);
  });
  it("o item do sidebar aponta para /relatorios e só renderiza com a permissão; a página também barra quem não tem", () => {
    const sidebar = fonte("../../../components/shell/Sidebar.tsx");
    expect(sidebar).toMatch(/temPermissao\(usuarioLogado, "escala_relatorios"\) && \(\s*<Link href="\/relatorios"/);
    expect(sidebar).toContain('abaAtiva === "relatorios"');
    expect(sidebar).toContain('"/escala-producao"'); // o acesso pela Escala continua
    const pagina = fonte("../RelatoriosPage.tsx");
    expect(pagina).toContain('temPermissao(auth.usuarioLogado, "escala_relatorios")');
    expect(pagina).toMatch(/if \(!permitido\)[\s\S]*AcessoNegado/);
    expect(existsSync(new URL("../../../app/relatorios/page.tsx", import.meta.url))).toBe(true);
    expect(fonte("../../escala/components/RelatoriosEscalaModal.tsx")).toContain('href="/relatorios"'); // a Escala leva ao arquivo
  });
  it("a API do arquivo exige a mesma permissão e a RPC também (somente leitura)", () => {
    expect(fonte("../../../app/api/escala/relatorios/arquivo/route.ts")).toContain('temPermissao(auth.usuario, "escala_relatorios")');
    const mig = readFileSync(new URL("../../../../supabase/migrations/20261105100000_relatorio_arquivo.sql", import.meta.url), "utf8");
    expect(mig).toContain("has_permissao('escala_relatorios')");
    expect(/\b(insert|update|delete)\b\s+(into|from)?\s*public\./i.test(mig.replace(/--.*$/gm, ""))).toBe(false);
  });
});

describe("aba Relatórios — listagem (modelo único: tabela e cards)", () => {
  it("o exemplo do pedido: semana, tipo, código, versão, status, gerado em, cobertura, conformidade, alterações e ações", () => {
    const l = modeloLinha(item(), true);
    expect(l).toMatchObject({ semana: "26/10/2026 – 01/11/2026", tipo: "Executado", codigo: "ESC-EXEC-2026-44-0001", versao: "v2", status: "FINAL", origem: "Gerado automaticamente", cobertura: "98,7%", conformidade: "SIM COM RESSALVAS", alteracoes: "Não", nVersoes: 2 });
    expect(l.geradoEmIso).toBe("2026-10-30T21:07:00Z");
    expect(l.acoes).toEqual({ baixar: true, verificar: true, versoes: true, gerarNova: false });
  });
  it("executado × planejado; parcial × final; manual × automático; planejado não tem cobertura", () => {
    const p = modeloLinha(item({ tipo: "planejada", status: "parcial", fechamentoAutomatico: false, cobertura: null, conformidade: "SIM", versao: 1, nVersoes: 1 }), true);
    expect(p).toMatchObject({ tipo: "Planejado", status: "PARCIAL", origem: "Gerado manualmente", cobertura: "—", conformidade: "SIM", versao: "v1" });
    expect(p.acoes.versoes).toBe(false); // só aparece "Versões" quando há mais de uma
  });
  it("alteração posterior: aviso e GERAR NOVA VERSÃO (só com permissão); desconhecido (null) não acusa nada", () => {
    const a = modeloLinha(item({ alteracoesPosteriores: true }), true);
    expect(a).toMatchObject({ alteracoes: "Sim", alteracoesPosteriores: true }); expect(a.acoes.gerarNova).toBe(true);
    expect(modeloLinha(item({ alteracoesPosteriores: true }), false).acoes.gerarNova).toBe(false);
    const n = modeloLinha(item({ alteracoesPosteriores: null }), true);
    expect(n.alteracoesPosteriores).toBe(false); expect(n.alteracoes).toBe("—"); expect(n.acoes.gerarNova).toBe(false);
  });
  it("relatório final automático aparece na lista como qualquer outro (só lê escala_relatorios; sem cópia nem registro extra)", () => {
    expect(modeloLinha(item({ fechamentoAutomatico: true, status: "final" }), true)).toMatchObject({ origem: "Gerado automaticamente", status: "FINAL" });
    const mig = readFileSync(new URL("../../../../supabase/migrations/20261105100000_relatorio_arquivo.sql", import.meta.url), "utf8");
    expect(mig).toContain("from public.escala_relatorios");
  });
  it("seção inicial RELATÓRIOS DE REVEZAMENTO, estruturada para receber outras; filtros viram query; nomes de arquivo", () => {
    expect(SECOES.map((s) => s.titulo)).toEqual(["RELATÓRIOS DE REVEZAMENTO"]);
    expect(montarQuery({ ano: 2026, tipo: "executada", status: "final", busca: " ESC-EXEC ", pagina: 3 })).toBe("ano=2026&tipo=executada&status=final&q=ESC-EXEC&pagina=3");
    expect(montarQuery({ ano: null, tipo: "", status: "", busca: "", pagina: 1 })).toBe("");
    expect(TAMANHO_PAGINA).toBe(20);
    expect(rotuloSemana("2026-12-28")).toBe("28/12/2026 – 03/01/2027");
    expect(nomeArquivoPdf({ semanaInicio: "2026-10-26", tipo: "executada", versao: 2 })).toBe("SITTECH_Revezamento_2026-10-26_a_2026-11-01_v2.pdf");
  });
});

describe("aba Relatórios — verificar, download e mobile", () => {
  it("VERIFICAR abre a página pública correta (a mesma do QR) e ela existe na rota", () => {
    expect(urlVerificar("abc")).toBe("/relatorios/escala/verificar/abc");
    expect(existsSync(new URL("../../../app/relatorios/escala/verificar/[id]/page.tsx", import.meta.url))).toBe(true);
  });
  it("o download chama a rota do PDF ARMAZENADO (que confere o SHA-256) e a tela nunca gera PDF", () => {
    const api = fonte("../../escala/relatoriosApi.ts");
    expect(api).toContain("/api/escala/relatorios/${id}/pdf");
    const pagina = fonte("../RelatoriosPage.tsx");
    expect(pagina).not.toMatch(/renderizarPdf|montarConteudo/);
    // "gerar nova versão" é uma AÇÃO explícita do usuário (POST), nunca parte da listagem
    expect(pagina).toMatch(/async function gerarNova[\s\S]*window\.confirm/);
  });
  it("mobile: abaixo de 760px a tabela some e entram cards com semana, tipo, versão, status, conformidade e as mesmas ações", () => {
    expect(ESTILOS_RELATORIOS).toMatch(/@media \(max-width: 760px\)[\s\S]*\.stx-rel-scroll \{ display:none; \}[\s\S]*\.stx-rel-cards \{ display:flex/);
    expect(ESTILOS_RELATORIOS).toMatch(/\.stx-rel-cards \{ display:none; \}/);
    const lista = fonte("../ListaArquivo.tsx");
    const card = lista.slice(lista.indexOf('className="stx-rel-cards"'));
    for (const campo of ["l.semana", "l.tipo", "l.versao", "l.status", "l.conformidade", "acoes(l)"]) expect(card).toContain(campo);
  });
});

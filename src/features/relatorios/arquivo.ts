// Aba RELATÓRIOS (arquivo histórico): modelos e rótulos PUROS. Nada aqui lê o banco nem gera PDF — a lista vem de `escala_relatorios` (RPC escala_relatorio_arquivo) e o download entrega o PDF armazenado.
import { somarDias } from "@/features/escala-relatorio/conteudo";

export type TipoRelatorio = "executada" | "planejada";
export type StatusRelatorio = "parcial" | "final";
export type Conformidade = "SIM" | "SIM_COM_RESSALVAS" | "NAO";

export interface ItemArquivo {
  id: string; semanaInicio: string; tipo: TipoRelatorio; codigo: string; versao: number; nVersoes: number; status: StatusRelatorio; geradoEm: string; consolidadoAte: string;
  fechamentoAutomatico: boolean; geradoPor: string | null; pdfBytes: number; hash: string; cobertura: string | null; conformidade: Conformidade | null;
  alteracoesPosteriores: boolean | null; // dados-fonte mudaram depois deste relatório (não invalida o relatório)
}
export interface Arquivo { total: number; anos: number[]; itens: ItemArquivo[]; limite: number; offset: number }
export interface FiltrosArquivo { ano?: number | null; tipo?: TipoRelatorio | ""; status?: StatusRelatorio | ""; busca?: string; pagina?: number }

export const TAMANHO_PAGINA = 20;
export const SECOES = [{ chave: "revezamento", titulo: "RELATÓRIOS DE REVEZAMENTO" }] as const; // futuras categorias entram aqui

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const rotuloSemana = (inicio: string) => `${br(inicio)} – ${br(somarDias(inicio, 6))}`;
export const rotuloTipo = (t: TipoRelatorio) => (t === "executada" ? "Executado" : "Planejado");
export const rotuloStatus = (s: StatusRelatorio) => (s === "final" ? "FINAL" : "PARCIAL");
export const rotuloOrigem = (auto: boolean) => (auto ? "Gerado automaticamente" : "Gerado manualmente");
export const ROTULO_CONFORMIDADE: Record<Conformidade, string> = { SIM: "SIM", SIM_COM_RESSALVAS: "SIM COM RESSALVAS", NAO: "NÃO" };
export const rotuloConformidade = (c: Conformidade | null) => (c ? ROTULO_CONFORMIDADE[c] : "—");
export const rotuloAlteracoes = (a: boolean | null) => (a === null ? "—" : a ? "Sim" : "Não");

// Modelo ÚNICO usado pela tabela (desktop) e pelos cards (mobile): mesmos campos, mesmas ações.
export interface LinhaModelo {
  id: string; semana: string; tipo: string; tipoChave: TipoRelatorio; codigo: string; versao: string; nVersoes: number; status: string; statusChave: StatusRelatorio; origem: string;
  geradoEmIso: string; cobertura: string; conformidade: string; conformidadeChave: Conformidade | null; alteracoes: string; alteracoesPosteriores: boolean;
  semanaInicio: string;
  acoes: { baixar: true; verificar: true; versoes: boolean; gerarNova: boolean };
}
export function modeloLinha(i: ItemArquivo, podeGerar: boolean): LinhaModelo {
  const alt = i.alteracoesPosteriores === true;
  return {
    id: i.id, semana: rotuloSemana(i.semanaInicio), tipo: rotuloTipo(i.tipo), tipoChave: i.tipo, codigo: i.codigo, versao: `v${i.versao}`, nVersoes: i.nVersoes,
    status: rotuloStatus(i.status), statusChave: i.status, origem: rotuloOrigem(i.fechamentoAutomatico), geradoEmIso: i.geradoEm,
    cobertura: i.cobertura ?? "—", conformidade: rotuloConformidade(i.conformidade), conformidadeChave: i.conformidade, alteracoes: rotuloAlteracoes(i.alteracoesPosteriores), alteracoesPosteriores: alt,
    semanaInicio: i.semanaInicio,
    // "GERAR NOVA VERSÃO" só quando há alteração posterior e a pessoa pode gerar (mesma permissão da aba); nunca edita o existente
    acoes: { baixar: true, verificar: true, versoes: i.nVersoes > 1, gerarNova: alt && podeGerar },
  };
}

export function montarQuery(f: FiltrosArquivo): string {
  const p = new URLSearchParams();
  if (f.ano) p.set("ano", String(f.ano));
  if (f.tipo) p.set("tipo", f.tipo);
  if (f.status) p.set("status", f.status);
  if (f.busca && f.busca.trim()) p.set("q", f.busca.trim());
  if (f.pagina && f.pagina > 1) p.set("pagina", String(f.pagina));
  return p.toString();
}
export const nomeArquivoPdf = (i: Pick<ItemArquivo, "semanaInicio" | "tipo" | "versao">) => `SITTECH_${i.tipo === "executada" ? "Revezamento" : "EscalaPlanejada"}_${i.semanaInicio}_a_${somarDias(i.semanaInicio, 6)}_v${i.versao}.pdf`;

// página pública de verificação (sem login, sem nomes) — mesma rota do QR do PDF
export const urlVerificar = (id: string) => `/relatorios/escala/verificar/${id}`;

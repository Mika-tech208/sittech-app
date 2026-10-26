// Serviço (SERVIDOR): lê os insumos (uma chamada), monta o conteúdo, congela o snapshot, calcula os hashes, renderiza o PDF e registra TUDO de forma imutável.
// O navegador só pede "semana + tipo"; nunca envia conteúdo. A permissão do usuário é checada na rota, antes de chegar aqui.
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { digestDasFontes, hashDoConteudo, montarConteudo, periodosConsiderados, SCHEMA_VERSAO, somarDias, statusDoRelatorio } from "@/features/escala-relatorio/conteudo";
import { renderizarPdf } from "@/features/escala-relatorio/pdf";
import type { FontesRelatorio, StatusRelatorio, TipoRelatorio } from "@/features/escala-relatorio/tipos";
import { paraPublico, type MetadadosPublicos, type RegistroVerificacao } from "./publico";

const sha256Bytes = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const paraBytea = (b: Uint8Array) => `\\x${Buffer.from(b).toString("hex")}`;
const deBytea = (s: string) => Buffer.from(s.replace(/^\\x/, ""), "hex");

export async function lerFontes(admin: SupabaseClient, semana: string): Promise<FontesRelatorio> {
  const { data, error } = await admin.rpc("escala_relatorio_fontes", { p_semana: semana });
  if (error) throw new Error(error.message.includes("ESCALA_RELATORIO_SEM_PREVISAO") ? "Não existe Previsão para esta semana." : `escala_relatorio_fontes: ${error.message}`);
  return data as FontesRelatorio;
}

export interface RelatorioGerado { id: string; codigo: string; tipo: TipoRelatorio; versao: number; status: StatusRelatorio; hash: string; pdfSha256: string; paginas: number; nomeArquivo: string; geradoEm: string }

export async function gerarRelatorio(
  admin: SupabaseClient,
  p: { semana: string; tipo: TipoRelatorio; usuario: { id: string; nome: string }; baseUrl: string; agoraMs?: number }
): Promise<RelatorioGerado> {
  let ultimoErro: Error | null = null;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const fontes = await lerFontes(admin, p.semana);
    const { data: prox, error: eProx } = await admin.rpc("escala_relatorio_proximo", { p_semana: p.semana, p_tipo: p.tipo });
    if (eProx) throw new Error(`escala_relatorio_proximo: ${eProx.message}`);
    const { codigo, versao } = prox as { codigo: string; versao: number };
    const id = randomUUID();
    const geradoEmMs = p.agoraMs ?? Date.now();
    const conteudo = montarConteudo(fontes, { tipo: p.tipo, codigo, versao, geradoEmMs, geradoPor: p.usuario, urlVerificacao: `${p.baseUrl.replace(/\/$/, "")}/relatorios/escala/verificar/${id}` });
    const { canonico, hash } = hashDoConteudo(conteudo);
    const pdf = await renderizarPdf(conteudo, hash);
    const pdfSha = sha256Bytes(pdf.bytes);
    const consolidados = periodosConsiderados(fontes, p.tipo, geradoEmMs).map((c) => `${c.data}|${c.periodoId}`);
    const { error } = await admin.rpc("escala_relatorio_registrar", {
      p_id: id, p_semana: p.semana, p_tipo: p.tipo, p_versao: versao, p_codigo: codigo, p_status: conteudo.status,
      p_consolidado_ate: conteudo.consolidadoAte, p_elegivel_final_em: conteudo.elegivelFinalEm, p_gerado_em: conteudo.geradoEm, p_gerado_por: p.usuario.id, p_schema: SCHEMA_VERSAO,
      p_conteudo_canonico: canonico, p_hash: hash, p_fonte_digest: conteudo.fontes.digest, p_periodos: consolidados, p_pdf: paraBytea(pdf.bytes), p_pdf_sha256: pdfSha,
    });
    if (error) {
      if (error.message.includes("ESCALA_RELATORIO_VERSAO_CONFLITO") || error.message.includes("duplicate key")) { ultimoErro = new Error(error.message); continue; }
      throw new Error(`escala_relatorio_registrar: ${error.message}`);
    }
    return { id, codigo, tipo: p.tipo, versao, status: conteudo.status, hash, pdfSha256: pdfSha, paginas: pdf.paginas, nomeArquivo: pdf.nomeArquivo, geradoEm: conteudo.geradoEm };
  }
  throw ultimoErro ?? new Error("Não foi possível registrar o relatório.");
}

export interface LinhaRelatorio {
  id: string; codigo: string; tipo: TipoRelatorio; versao: number; status: StatusRelatorio; geradoEm: string; consolidadoAte: string; geradoPor: string | null; hash: string; pdfBytes: number;
  alteracoesPosteriores: boolean | null; // dados-fonte mudaram depois deste relatório (não invalida o relatório)
}

// Lista (com a SESSÃO do usuário: a RPC checa a permissão) e compara o digest de cada relatório com os insumos de agora
export async function listarRelatorios(admin: SupabaseClient, comoUsuario: SupabaseClient, semana: string): Promise<{ relatorios: LinhaRelatorio[]; status: StatusRelatorio | null; elegivelFinalEm: string | null }> {
  const { data, error } = await comoUsuario.rpc("escala_relatorio_listar", { p_semana: semana });
  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as { id: string; codigo: string; tipo: TipoRelatorio; versao: number; status: StatusRelatorio; geradoEm: string; consolidadoAte: string; geradoPor: string | null; hash: string; pdfBytes: number; fonteDigest: string; periodosConsiderados: string[] }[];
  let fontes: FontesRelatorio | null = null;
  try { fontes = await lerFontes(admin, semana); } catch { fontes = null; }
  const relatorios = linhas.map((r) => ({
    id: r.id, codigo: r.codigo, tipo: r.tipo, versao: r.versao, status: r.status, geradoEm: r.geradoEm, consolidadoAte: r.consolidadoAte, geradoPor: r.geradoPor, hash: r.hash, pdfBytes: r.pdfBytes,
    alteracoesPosteriores: fontes ? digestDasFontes(fontes, r.periodosConsiderados.map((s) => ({ data: s.split("|")[0], periodoId: s.split("|")[1] }))) !== r.fonteDigest : null,
  }));
  const st = fontes ? statusDoRelatorio(fontes, Date.now()) : null;
  return { relatorios, status: st?.status ?? null, elegivelFinalEm: st ? new Date(st.elegivelFinalEmMs).toISOString() : null };
}

export async function baixarPdf(admin: SupabaseClient, id: string): Promise<{ bytes: Buffer; nomeArquivo: string } | null> {
  const { data: rel } = await admin.from("escala_relatorios").select("semana_inicio, versao, pdf_sha256").eq("id", id).maybeSingle();
  if (!rel) return null;
  const { data: arq, error } = await admin.from("escala_relatorio_pdfs").select("pdf").eq("relatorio_id", id).maybeSingle();
  if (error || !arq) return null;
  const bytes = deBytea(arq.pdf as string);
  if (sha256Bytes(bytes) !== rel.pdf_sha256) throw new Error("O PDF armazenado não confere com o hash registrado.");
  const fim = somarDias(String(rel.semana_inicio), 6);
  return { bytes, nomeArquivo: `SITTECH_Revezamento_${rel.semana_inicio}_a_${fim}_v${rel.versao}.pdf` };
}

// Verificação pública: só metadados (nunca nomes). Recalcula o hash do snapshot e compara os insumos de agora com o digest guardado.
export async function verificarPublico(admin: SupabaseClient, id: string): Promise<MetadadosPublicos | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data, error } = await admin.rpc("escala_relatorio_verificar", { p_id: id });
  if (error || !data) return null;
  const r = data as RegistroVerificacao;
  let digestAtual: string | null = null;
  try {
    const fontes = await lerFontes(admin, r.semanaInicio);
    digestAtual = digestDasFontes(fontes, r.periodosConsiderados.map((s) => ({ data: s.split("|")[0], periodoId: s.split("|")[1] })));
  } catch { digestAtual = null; }
  return paraPublico(r, digestAtual);
}

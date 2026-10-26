// "TESTAR ENVIO DE RELATÓRIO" (SERVIDOR, só admin): envia um PDF FICTÍCIO marcado TESTE para o e-mail do PRÓPRIO administrador logado, pelo mesmo caminho do envio real
// (montarEmail → provedor oficial do ambiente). O navegador não envia destinatário, remetente, chave nem conteúdo; o resultado é registrado à parte dos envios documentais.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pdfDeTeste } from "@/features/escala-relatorio/exemplo";
import { montarEmail, type ProvedorEmail } from "./email";

export interface ResultadoTeste { ok: boolean; destinatario: string; provedor: string; provedorId: string | null; enviadoEm: string; sha256: string; nomeArquivo: string; bytes: number; erro: string | null }
export type RegistrarTeste = (r: { usuarioId: string; resultado: ResultadoTeste }) => Promise<string | null>; // devolve o carimbo do registro (ou null)

export async function executarTesteEmail(p: { usuarioId: string; destinatario: string; baseUrl: string; provedor: ProvedorEmail; registrar: RegistrarTeste; agoraMs?: number }): Promise<ResultadoTeste> {
  const pdf = await pdfDeTeste(p.baseUrl);
  const sha256 = createHash("sha256").update(pdf.bytes).digest("hex");
  const m = montarEmail({ semanaInicio: pdf.semanaInicio, codigo: pdf.codigo, versao: 1, fechamentoMs: pdf.fechamentoMs, destinatario: p.destinatario, nomeArquivo: pdf.nomeArquivo, pdf: pdf.bytes });
  const msg = {
    ...m,
    assunto: `[TESTE] ${m.assunto}`,
    texto: `*** E-MAIL DE TESTE — DADOS FICTÍCIOS — NÃO É UM RELATÓRIO OFICIAL ***\n\n${m.texto}\n\nSHA-256 do anexo (PDF de teste): ${sha256}`,
    chaveIdempotencia: `escala-relatorio-teste-${p.usuarioId}-${p.agoraMs ?? Date.now()}`,
  };
  let r: ResultadoTeste = { ok: false, destinatario: p.destinatario, provedor: p.provedor.nome, provedorId: null, enviadoEm: new Date(p.agoraMs ?? Date.now()).toISOString(), sha256, nomeArquivo: pdf.nomeArquivo, bytes: pdf.bytes.length, erro: null };
  try {
    const { id } = await p.provedor.enviar(msg);
    r = { ...r, ok: true, provedorId: id };
  } catch (e) {
    r = { ...r, erro: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
  }
  const carimbo = await p.registrar({ usuarioId: p.usuarioId, resultado: r }).catch(() => null);
  return carimbo ? { ...r, enviadoEm: carimbo } : r;
}

export const registrarTesteSupabase = (admin: SupabaseClient): RegistrarTeste => async ({ usuarioId, resultado: r }) => {
  const { data, error } = await admin.rpc("escala_relatorio_teste_email_registrar", {
    p_usuario: usuarioId, p_destinatario: r.destinatario, p_provedor: r.provedor, p_ok: r.ok, p_erro: r.erro, p_provedor_id: r.provedorId, p_pdf_sha256: r.sha256, p_pdf_bytes: r.bytes,
  });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : null;
};

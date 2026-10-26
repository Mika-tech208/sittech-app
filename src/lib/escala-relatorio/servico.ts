// Serviço (SERVIDOR): lê os insumos (uma chamada), monta o conteúdo, congela o snapshot, calcula os hashes, renderiza o PDF e registra TUDO de forma imutável.
// O navegador só pede "semana + tipo"; nunca envia conteúdo. A permissão do usuário é checada na rota, antes de chegar aqui.
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { digestDasFontes, fechamentoLogicoMs, hashDoConteudo, montarConteudo, SCHEMA_VERSAO, somarDias, statusDoRelatorio } from "@/features/escala-relatorio/conteudo";
import { renderizarPdf } from "@/features/escala-relatorio/pdf";
import type { FontesRelatorio, StatusRelatorio, TipoRelatorio } from "@/features/escala-relatorio/tipos";
import { paraPublico, type MetadadosPublicos, type RegistroVerificacao } from "./publico";

const sha256Bytes = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const paraBytea = (b: Uint8Array) => `\\x${Buffer.from(b).toString("hex")}`;
const deBytea = (s: string) => Buffer.from(s.replace(/^\\x/, ""), "hex");

// `comoDe`: estado CONHECIDO naquele instante (fechamento lógico 18:00), mesmo que o worker rode depois
export async function lerFontes(admin: SupabaseClient, semana: string, comoDe?: string): Promise<FontesRelatorio> {
  const { data, error } = await admin.rpc("escala_relatorio_fontes", comoDe ? { p_semana: semana, p_como_de: comoDe } : { p_semana: semana });
  if (error) throw new Error(error.message.includes("ESCALA_RELATORIO_SEM_PREVISAO") ? "Não existe Previsão para esta semana." : `escala_relatorio_fontes: ${error.message}`);
  return data as FontesRelatorio;
}

const SISTEMA = { id: "sistema", nome: "Sistema (fechamento automático)" };

export interface RelatorioGerado { id: string; codigo: string; tipo: TipoRelatorio; versao: number; status: StatusRelatorio; hash: string; pdfSha256: string; paginas: number; nomeArquivo: string; geradoEm: string }

export async function gerarRelatorio(
  admin: SupabaseClient,
  p: { semana: string; tipo: TipoRelatorio; usuario: { id: string; nome: string } | null; baseUrl: string; agoraMs?: number; automatico?: { fechamentoLogicoMs: number } }
): Promise<RelatorioGerado> {
  let ultimoErro: Error | null = null;
  const auto = p.automatico ?? null;
  if (auto && p.tipo !== "executada") throw new Error("Só o Revezamento executado é gerado automaticamente.");
  if (!auto && !p.usuario) throw new Error("Geração manual exige o usuário.");
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const fontes = await lerFontes(admin, p.semana, auto ? new Date(auto.fechamentoLogicoMs).toISOString() : undefined);
    const { data: prox, error: eProx } = await admin.rpc("escala_relatorio_proximo", { p_semana: p.semana, p_tipo: p.tipo });
    if (eProx) throw new Error(`escala_relatorio_proximo: ${eProx.message}`);
    const { codigo, versao } = prox as { codigo: string; versao: number };
    const id = randomUUID();
    const geradoEmMs = p.agoraMs ?? Date.now();
    if (auto && geradoEmMs < auto.fechamentoLogicoMs) throw new Error("O fechamento automático ainda não é elegível (antes do fechamento lógico).");
    const conteudo = montarConteudo(fontes, {
      tipo: p.tipo, codigo, versao, geradoEmMs, geradoPor: auto ? SISTEMA : p.usuario!, urlVerificacao: `${p.baseUrl.replace(/\/$/, "")}/relatorios/escala/verificar/${id}`,
      ...(auto ? { consolidadoAteMs: auto.fechamentoLogicoMs, fechamentoAutomatico: true } : {}),
    });
    if (auto && conteudo.status !== "final") throw new Error("O fechamento automático precisa produzir um relatório FINAL.");
    const { canonico, hash } = hashDoConteudo(conteudo);
    const pdf = await renderizarPdf(conteudo, hash);
    const pdfSha = sha256Bytes(pdf.bytes);
    const consolidados = conteudo.dias.flatMap((d) => d.periodos.filter((x) => x.considerado).map((x) => `${d.data}|${x.id}`));
    const { error } = await admin.rpc("escala_relatorio_registrar", {
      p_id: id, p_semana: p.semana, p_tipo: p.tipo, p_versao: versao, p_codigo: codigo, p_status: conteudo.status,
      p_consolidado_ate: conteudo.consolidadoAte, p_elegivel_final_em: conteudo.elegivelFinalEm, p_gerado_em: conteudo.geradoEm, p_gerado_por: auto ? null : p.usuario!.id, p_schema: SCHEMA_VERSAO,
      p_conteudo_canonico: canonico, p_hash: hash, p_fonte_digest: conteudo.fontes.digest, p_periodos: consolidados, p_pdf: paraBytea(pdf.bytes), p_pdf_sha256: pdfSha,
      p_fechamento_automatico: auto !== null,
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
  fechamentoAutomatico: boolean;
}
export interface InfoFechamentoSemana {
  ativo: boolean; desdeSemana: string | null; fechamentoLogicoEm: string | null;
  geracaoStatus: "pendente" | "gerado" | "erro" | null; geracaoTentativas: number; geracaoUltimoErro: string | null;
}

// Lista (com a SESSÃO do usuário: a RPC checa a permissão) e compara o digest de cada relatório com os insumos de agora
export async function listarRelatorios(admin: SupabaseClient, comoUsuario: SupabaseClient, semana: string): Promise<{ relatorios: LinhaRelatorio[]; status: StatusRelatorio | null; elegivelFinalEm: string | null; fechamento: InfoFechamentoSemana }> {
  const { data, error } = await comoUsuario.rpc("escala_relatorio_listar", { p_semana: semana });
  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as { id: string; codigo: string; tipo: TipoRelatorio; versao: number; status: StatusRelatorio; geradoEm: string; consolidadoAte: string; geradoPor: string | null; hash: string; pdfBytes: number; fonteDigest: string; periodosConsiderados: string[]; fechamentoAutomatico: boolean }[];
  let fontes: FontesRelatorio | null = null;
  try { fontes = await lerFontes(admin, semana); } catch { fontes = null; }
  const relatorios = linhas.map((r) => ({
    id: r.id, codigo: r.codigo, tipo: r.tipo, versao: r.versao, status: r.status, geradoEm: r.geradoEm, consolidadoAte: r.consolidadoAte, geradoPor: r.geradoPor, hash: r.hash, pdfBytes: r.pdfBytes,
    alteracoesPosteriores: fontes ? digestDasFontes(fontes, r.periodosConsiderados.map((s) => ({ data: s.split("|")[0], periodoId: s.split("|")[1] }))) !== r.fonteDigest : null,
    fechamentoAutomatico: r.fechamentoAutomatico,
  }));
  const st = fontes ? statusDoRelatorio(fontes, Date.now()) : null;
  const { data: cfg } = await admin.from("escala_relatorio_config").select("automatico_ativo, desde_semana").eq("id", true).maybeSingle();
  const { data: fech } = await admin.from("escala_relatorio_fechamentos").select("geracao_status, geracao_tentativas, geracao_ultimo_erro").eq("semana_inicio", semana).eq("tipo", "executada").maybeSingle();
  return {
    relatorios, status: st?.status ?? null, elegivelFinalEm: st ? new Date(st.elegivelFinalEmMs).toISOString() : null,
    fechamento: {
      ativo: cfg?.automatico_ativo === true, desdeSemana: (cfg?.desde_semana as string | null) ?? null,
      fechamentoLogicoEm: fontes ? new Date(fechamentoLogicoMs(fontes)).toISOString() : null,
      geracaoStatus: (fech?.geracao_status as InfoFechamentoSemana["geracaoStatus"]) ?? null, geracaoTentativas: Number(fech?.geracao_tentativas ?? 0), geracaoUltimoErro: (fech?.geracao_ultimo_erro as string | null) ?? null,
    },
  };
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

// ---------- ARQUIVO HISTÓRICO (aba Relatórios): só leitura de escala_relatorios; nunca gera PDF ----------
export interface ItemArquivoServidor {
  id: string; semanaInicio: string; tipo: TipoRelatorio; codigo: string; versao: number; nVersoes: number; status: StatusRelatorio; geradoEm: string; consolidadoAte: string;
  fechamentoAutomatico: boolean; geradoPor: string | null; pdfBytes: number; hash: string; cobertura: string | null; conformidade: "SIM" | "SIM_COM_RESSALVAS" | "NAO" | null;
  alteracoesPosteriores: boolean | null;
}
export interface ArquivoServidor { total: number; anos: number[]; itens: ItemArquivoServidor[]; limite: number; offset: number }
export const TAMANHO_PAGINA_ARQUIVO = 20;

export async function listarArquivo(
  admin: SupabaseClient, comoUsuario: SupabaseClient, f: { ano?: number | null; tipo?: string | null; status?: string | null; busca?: string | null; pagina?: number }
): Promise<ArquivoServidor> {
  const pagina = Math.max(1, Math.floor(f.pagina ?? 1));
  const { data, error } = await comoUsuario.rpc("escala_relatorio_arquivo", {
    p_ano: f.ano ?? null, p_tipo: f.tipo || null, p_status: f.status || null, p_busca: f.busca || null, p_limite: TAMANHO_PAGINA_ARQUIVO, p_offset: (pagina - 1) * TAMANHO_PAGINA_ARQUIVO,
  });
  if (error) throw new Error(error.message);
  const d = data as { total: number; anos: number[]; limite: number; offset: number; itens: (Omit<ItemArquivoServidor, "alteracoesPosteriores"> & { fonteDigest: string; periodosConsiderados: string[] })[] };
  // "Existem alterações posteriores": compara o digest GUARDADO (snapshot) com os insumos de agora — uma leitura por semana distinta da página; o PDF antigo nunca muda
  const semanas = [...new Set(d.itens.map((i) => i.semanaInicio))];
  const digestAtual = new Map<string, FontesRelatorio | null>();
  await Promise.all(semanas.map(async (sem) => { try { digestAtual.set(sem, await lerFontes(admin, sem)); } catch { digestAtual.set(sem, null); } }));
  const itens = d.itens.map(({ fonteDigest, periodosConsiderados, ...resto }) => {
    const fontes = digestAtual.get(resto.semanaInicio) ?? null;
    const alteracoesPosteriores = fontes ? digestDasFontes(fontes, periodosConsiderados.map((s) => ({ data: s.split("|")[0], periodoId: s.split("|")[1] }))) !== fonteDigest : null;
    return { ...resto, alteracoesPosteriores } as ItemArquivoServidor;
  });
  return { total: d.total, anos: d.anos, itens, limite: d.limite, offset: d.offset };
}

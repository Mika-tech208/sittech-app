// FECHAMENTO AUTOMÁTICO do relatório semanal (SERVIDOR): sexta 18:00 (sábado 18:00 se produtivo) → gera o Revezamento EXECUTADO final, guarda o PDF e envia por e-mail.
// Chamado pelo worker (/api/escala/drenar, a cada 5 min) — NÃO depende de nenhuma tela. Idempotente: pode rodar várias vezes e em paralelo.
//
//   geração × e-mail são etapas SEPARADAS (cada uma com status, tentativas e último erro); falha de e-mail nunca regera o PDF; falha técnica de geração nunca cria v2.
//   A orquestração fala com uma "porta" (testável em memória); o adaptador do Supabase está no fim do arquivo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fechamentoLogicoMs, dataHoraSP, somarDias } from "@/features/escala-relatorio/conteudo";
import type { FontesRelatorio } from "@/features/escala-relatorio/tipos";
import { baixarPdf, gerarRelatorio, lerFontes, type RelatorioGerado } from "./servico";
import { montarEmail, type ProvedorEmail } from "./email";

export const INTERVALO_RETENTATIVA_MS = 10 * 60_000; // não insiste a cada 5 min em algo que acabou de falhar
export const MAX_TENTATIVAS_AUTOMATICAS = 12;        // depois disso só a ação manual (REENVIAR E-MAIL) tenta de novo
const SEMANAS_PARA_TRAS = 2;                          // o worker olha a semana atual e as 2 anteriores (rede de segurança para falhas/atrasos); nada retroativo antes de `desdeSemana`

export interface ConfigFechamento { ativo: boolean; desdeSemana: string | null; destinatario: string }
export interface Fechamento {
  id: string; semana: string; fechamentoLogicoEm: string; destinatario: string;
  geracaoStatus: "pendente" | "gerado" | "erro"; geracaoTentativas: number; geracaoUltimaTentativaEm: string | null; relatorioId: string | null;
  emailStatus: "pendente" | "enviado" | "falhou"; emailTentativas: number; emailUltimaTentativaEm: string | null;
}
export interface RelatorioParaEnvio { codigo: string; versao: number; semanaInicio: string; nomeArquivo: string; pdf: Uint8Array }

export interface PortaFechamento {
  config(): Promise<ConfigFechamento>;
  lerFontes(semana: string): Promise<FontesRelatorio | null>;               // null = semana sem Previsão
  reivindicar(semana: string, logicoMs: number, destinatario: string): Promise<Fechamento | null>; // null = tudo feito ou outro worker está processando
  gerar(semana: string, logicoMs: number): Promise<RelatorioGerado>;        // grava o relatório E marca o fechamento como gerado (uma transação)
  erroGeracao(fechamentoId: string, erro: string): Promise<void>;
  carregarRelatorio(relatorioId: string): Promise<RelatorioParaEnvio>;     // PDF armazenado, com o hash conferido
  registrarEmail(fechamentoId: string, ok: boolean, erro: string | null, provedorId: string | null): Promise<void>;
  liberar(fechamentoId: string): Promise<void>;
}

export type AcaoSemana = "desligado" | "sem_previsao" | "sem_dias_produtivos" | "aguardando" | "nada_a_fazer" | "aguardando_retentativa" | "esgotado" | "gerado_e_enviado" | "gerado_email_falhou" | "enviado" | "email_falhou" | "erro_geracao";
export interface ResultadoSemana { semana: string; acao: AcaoSemana; detalhe?: string }

export const segundaDeSP = (ms: number): string => {
  const d = new Date(ms - 3 * 3600_000); // dia civil em São Paulo
  const iso = d.toISOString().slice(0, 10);
  return somarDias(iso, -((d.getUTCDay() + 6) % 7));
};
const msde = (iso: string | null) => (iso ? Date.parse(iso) : 0);
const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export async function enviarEmailDoFechamento(porta: PortaFechamento, provedor: ProvedorEmail, f: Fechamento, relatorioId: string, chaveExtra = ""): Promise<{ ok: boolean; erro?: string }> {
  try {
    const r = await porta.carregarRelatorio(relatorioId);
    const msg = montarEmail({ semanaInicio: r.semanaInicio, codigo: r.codigo, versao: r.versao, fechamentoMs: Date.parse(f.fechamentoLogicoEm), destinatario: f.destinatario, nomeArquivo: r.nomeArquivo, pdf: r.pdf });
    const { id } = await provedor.enviar({ ...msg, chaveIdempotencia: `escala-relatorio-${relatorioId}${chaveExtra}` });
    await porta.registrarEmail(f.id, true, null, id);
    return { ok: true };
  } catch (e) {
    const erro = msgDe(e);
    await porta.registrarEmail(f.id, false, erro, null);
    return { ok: false, erro };
  }
}

export async function executarFechamentoAutomatico(porta: PortaFechamento, provedor: ProvedorEmail, agoraMs: number): Promise<ResultadoSemana[]> {
  const cfg = await porta.config();
  if (!cfg.ativo || !cfg.desdeSemana) return [{ semana: "-", acao: "desligado" }];
  const segunda = segundaDeSP(agoraMs);
  const semanas = Array.from({ length: SEMANAS_PARA_TRAS + 1 }, (_, i) => somarDias(segunda, -7 * (SEMANAS_PARA_TRAS - i))).filter((s) => s >= cfg.desdeSemana!);
  const out: ResultadoSemana[] = [];
  for (const semana of semanas) {
    try { out.push(await processarSemana(porta, provedor, cfg, semana, agoraMs)); }
    catch (e) { out.push({ semana, acao: "erro_geracao", detalhe: msgDe(e) }); }
  }
  return out;
}

async function processarSemana(porta: PortaFechamento, provedor: ProvedorEmail, cfg: ConfigFechamento, semana: string, agoraMs: number): Promise<ResultadoSemana> {
  const fontes = await porta.lerFontes(semana);
  if (!fontes) return { semana, acao: "sem_previsao" };
  if (fontes.diasProdutivos.length === 0) return { semana, acao: "sem_dias_produtivos" }; // semana sem produção: não há o que assinar
  const logico = fechamentoLogicoMs(fontes);
  if (agoraMs < logico) return { semana, acao: "aguardando" };

  const f = await porta.reivindicar(semana, logico, cfg.destinatario);
  if (!f) return { semana, acao: "nada_a_fazer" };
  try {
    let relatorioId = f.relatorioId;
    let gerou = false;
    if (f.geracaoStatus !== "gerado") {
      if (f.geracaoTentativas >= MAX_TENTATIVAS_AUTOMATICAS) { await porta.liberar(f.id); return { semana, acao: "esgotado", detalhe: "geração" }; }
      if (f.geracaoTentativas > 0 && agoraMs - msde(f.geracaoUltimaTentativaEm) < INTERVALO_RETENTATIVA_MS) { await porta.liberar(f.id); return { semana, acao: "aguardando_retentativa", detalhe: "geração" }; }
      try {
        relatorioId = (await porta.gerar(semana, logico)).id;
        gerou = true;
      } catch (e) {
        const erro = msgDe(e);
        await porta.erroGeracao(f.id, erro);
        return { semana, acao: "erro_geracao", detalhe: erro };
      }
    } else if (f.emailStatus !== "enviado") {
      if (f.emailTentativas >= MAX_TENTATIVAS_AUTOMATICAS) { await porta.liberar(f.id); return { semana, acao: "esgotado", detalhe: "e-mail" }; }
      if (f.emailTentativas > 0 && agoraMs - msde(f.emailUltimaTentativaEm) < INTERVALO_RETENTATIVA_MS) { await porta.liberar(f.id); return { semana, acao: "aguardando_retentativa", detalhe: "e-mail" }; }
    }
    if (!relatorioId) throw new Error("fechamento sem relatório");
    const r = await enviarEmailDoFechamento(porta, provedor, f, relatorioId);
    if (r.ok) return { semana, acao: gerou ? "gerado_e_enviado" : "enviado" };
    return { semana, acao: gerou ? "gerado_email_falhou" : "email_falhou", detalhe: r.erro };
  } catch (e) {
    await porta.liberar(f.id).catch(() => undefined);
    throw e;
  }
}

// ---------- adaptador do Supabase ----------
const paraFechamento = (r: Record<string, unknown>): Fechamento => ({
  id: r.id as string, semana: r.semana_inicio as string, fechamentoLogicoEm: r.fechamento_logico_em as string, destinatario: r.email_destinatario as string,
  geracaoStatus: r.geracao_status as Fechamento["geracaoStatus"], geracaoTentativas: Number(r.geracao_tentativas ?? 0), geracaoUltimaTentativaEm: (r.geracao_ultima_tentativa_em as string | null) ?? null,
  relatorioId: (r.relatorio_id as string | null) ?? null,
  emailStatus: r.email_status as Fechamento["emailStatus"], emailTentativas: Number(r.email_tentativas ?? 0), emailUltimaTentativaEm: (r.email_ultima_tentativa_em as string | null) ?? null,
});

export function portaSupabase(admin: SupabaseClient, baseUrl: string): PortaFechamento {
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(nome, args);
    if (error) throw new Error(`${nome}: ${error.message}`);
    return data;
  };
  return {
    async config() {
      const { data, error } = await admin.from("escala_relatorio_config").select("automatico_ativo, desde_semana, destinatario").eq("id", true).maybeSingle();
      if (error) throw new Error(`escala_relatorio_config: ${error.message}`);
      return { ativo: data?.automatico_ativo === true, desdeSemana: (data?.desde_semana as string | null) ?? null, destinatario: (data?.destinatario as string | undefined) ?? "tamara@sittech.com.br" };
    },
    async lerFontes(semana) {
      try { return await lerFontes(admin, semana); } catch (e) { if (e instanceof Error && e.message.includes("Não existe Previsão")) return null; throw e; }
    },
    async reivindicar(semana, logicoMs, destinatario) {
      const r = await rpc("escala_relatorio_fechamento_reivindicar", { p_semana: semana, p_logico: new Date(logicoMs).toISOString(), p_destinatario: destinatario });
      return r ? paraFechamento(r as Record<string, unknown>) : null;
    },
    gerar: (semana, logicoMs) => gerarRelatorio(admin, { semana, tipo: "executada", usuario: null, baseUrl, automatico: { fechamentoLogicoMs: logicoMs } }),
    async erroGeracao(id, erro) { await rpc("escala_relatorio_fechamento_erro_geracao", { p_id: id, p_erro: erro }); },
    async carregarRelatorio(relatorioId) {
      const { data: rel, error } = await admin.from("escala_relatorios").select("codigo, versao, semana_inicio").eq("id", relatorioId).maybeSingle();
      if (error || !rel) throw new Error("Relatório do fechamento não encontrado.");
      const arq = await baixarPdf(admin, relatorioId);
      if (!arq) throw new Error("PDF do relatório não encontrado.");
      return { codigo: rel.codigo as string, versao: Number(rel.versao), semanaInicio: String(rel.semana_inicio), nomeArquivo: arq.nomeArquivo, pdf: new Uint8Array(arq.bytes) };
    },
    async registrarEmail(id, ok, erro, provedorId) { await rpc("escala_relatorio_fechamento_email", { p_id: id, p_ok: ok, p_erro: erro, p_provedor_id: provedorId }); },
    async liberar(id) { await rpc("escala_relatorio_fechamento_liberar", { p_id: id }); },
  };
}

// Reenvio manual (botão REENVIAR E-MAIL): MESMO PDF/versão do fechamento — nunca regera; só quando o e-mail ainda não foi enviado.
export async function reenviarEmail(admin: SupabaseClient, provedor: ProvedorEmail, relatorioId: string, baseUrl: string): Promise<{ ok: boolean; erro?: string }> {
  const { data: fech, error } = await admin.from("escala_relatorio_fechamentos").select("*").eq("relatorio_id", relatorioId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!fech) return { ok: false, erro: "Este relatório não foi gerado pelo fechamento automático." };
  const f = paraFechamento(fech as Record<string, unknown>);
  if (f.emailStatus === "enviado") return { ok: false, erro: "O e-mail deste relatório já foi enviado." };
  const porta = portaSupabase(admin, baseUrl);
  const { data: lease, error: eL } = await admin.rpc("escala_relatorio_fechamento_reivindicar", { p_semana: f.semana, p_logico: f.fechamentoLogicoEm, p_destinatario: f.destinatario });
  if (eL) throw new Error(eL.message);
  if (!lease) return { ok: false, erro: "Outro processo está enviando este e-mail agora. Tente novamente em instantes." };
  // chave diferente por clique: o usuário quer MESMO reenviar (a chave automática protege só a retentativa do worker)
  return enviarEmailDoFechamento(porta, provedor, f, relatorioId, `-manual-${dataHoraSP(Date.now()).iso}`);
}

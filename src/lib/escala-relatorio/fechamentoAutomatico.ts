// FECHAMENTO AUTOMÁTICO do relatório semanal (SERVIDOR): no último dia produtivo às 18:00 (sexta; sábado/domingo se produtivos) gera o Revezamento EXECUTADO final e o ARQUIVA
// (snapshot as-of 18:00 → hash → PDF → hash do PDF → versão registrada → PDF armazenado → disponível para baixar/imprimir). NÃO envia e-mail.
// Chamado pelo worker (/api/escala/drenar) — NÃO depende de nenhuma tela. Idempotente: pode rodar várias vezes e em paralelo; um final automático por semana+tipo.
// Falha técnica de geração: nada é gravado, registra o erro e tenta de novo (sem criar v2); a orquestração fala com uma "porta" (testável em memória).
import type { SupabaseClient } from "@supabase/supabase-js";
import { fechamentoLogicoMs, somarDias } from "@/features/escala-relatorio/conteudo";
import type { FontesRelatorio } from "@/features/escala-relatorio/tipos";
import { gerarRelatorio, lerFontes, type RelatorioGerado } from "./servico";

export const INTERVALO_RETENTATIVA_MS = 10 * 60_000; // não insiste a cada 5 min em algo que acabou de falhar
export const MAX_TENTATIVAS_AUTOMATICAS = 12;        // depois disso o erro fica visível na tela; a geração manual continua disponível
const SEMANAS_PARA_TRAS = 2;                          // o worker olha a semana atual e as 2 anteriores (rede de segurança para falhas/atrasos); nada retroativo antes de `desdeSemana`

export interface ConfigFechamento { ativo: boolean; desdeSemana: string | null }
export interface Fechamento {
  id: string; semana: string; fechamentoLogicoEm: string;
  geracaoStatus: "pendente" | "gerado" | "erro"; geracaoTentativas: number; geracaoUltimaTentativaEm: string | null; relatorioId: string | null;
}

export interface PortaFechamento {
  config(): Promise<ConfigFechamento>;
  lerFontes(semana: string): Promise<FontesRelatorio | null>;               // null = semana sem Previsão
  reivindicar(semana: string, logicoMs: number): Promise<Fechamento | null>; // null = já gerado ou outro worker está processando
  gerar(semana: string, logicoMs: number): Promise<RelatorioGerado>;        // grava o relatório E marca o fechamento como gerado (uma transação)
  erroGeracao(fechamentoId: string, erro: string): Promise<void>;
  liberar(fechamentoId: string): Promise<void>;
}

export type AcaoSemana = "desligado" | "sem_previsao" | "sem_dias_produtivos" | "aguardando" | "nada_a_fazer" | "aguardando_retentativa" | "esgotado" | "gerado" | "erro_geracao";
export interface ResultadoSemana { semana: string; acao: AcaoSemana; detalhe?: string; relatorioId?: string; versao?: number }

export const segundaDeSP = (ms: number): string => {
  const d = new Date(ms - 3 * 3600_000); // dia civil em São Paulo
  const iso = d.toISOString().slice(0, 10);
  return somarDias(iso, -((d.getUTCDay() + 6) % 7));
};
const msde = (iso: string | null) => (iso ? Date.parse(iso) : 0);
const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export async function executarFechamentoAutomatico(porta: PortaFechamento, agoraMs: number): Promise<ResultadoSemana[]> {
  const cfg = await porta.config();
  if (!cfg.ativo || !cfg.desdeSemana) return [{ semana: "-", acao: "desligado" }];
  const segunda = segundaDeSP(agoraMs);
  const semanas = Array.from({ length: SEMANAS_PARA_TRAS + 1 }, (_, i) => somarDias(segunda, -7 * (SEMANAS_PARA_TRAS - i))).filter((s) => s >= cfg.desdeSemana!);
  const out: ResultadoSemana[] = [];
  for (const semana of semanas) {
    try { out.push(await processarSemana(porta, semana, agoraMs)); }
    catch (e) { out.push({ semana, acao: "erro_geracao", detalhe: msgDe(e) }); }
  }
  return out;
}

async function processarSemana(porta: PortaFechamento, semana: string, agoraMs: number): Promise<ResultadoSemana> {
  const fontes = await porta.lerFontes(semana);
  if (!fontes) return { semana, acao: "sem_previsao" };
  if (fontes.diasProdutivos.length === 0) return { semana, acao: "sem_dias_produtivos" }; // semana sem produção: não há o que assinar
  const logico = fechamentoLogicoMs(fontes);
  if (agoraMs < logico) return { semana, acao: "aguardando" };

  const f = await porta.reivindicar(semana, logico);
  if (!f) return { semana, acao: "nada_a_fazer" };
  try {
    if (f.geracaoTentativas >= MAX_TENTATIVAS_AUTOMATICAS) { await porta.liberar(f.id); return { semana, acao: "esgotado" }; }
    if (f.geracaoTentativas > 0 && agoraMs - msde(f.geracaoUltimaTentativaEm) < INTERVALO_RETENTATIVA_MS) { await porta.liberar(f.id); return { semana, acao: "aguardando_retentativa" }; }
    try {
      const r = await porta.gerar(semana, logico);
      return { semana, acao: "gerado", relatorioId: r.id, versao: r.versao };
    } catch (e) {
      const erro = msgDe(e);
      await porta.erroGeracao(f.id, erro);
      return { semana, acao: "erro_geracao", detalhe: erro };
    }
  } catch (e) {
    await porta.liberar(f.id).catch(() => undefined);
    throw e;
  }
}

// ---------- adaptador do Supabase ----------
const paraFechamento = (r: Record<string, unknown>): Fechamento => ({
  id: r.id as string, semana: r.semana_inicio as string, fechamentoLogicoEm: r.fechamento_logico_em as string,
  geracaoStatus: r.geracao_status as Fechamento["geracaoStatus"], geracaoTentativas: Number(r.geracao_tentativas ?? 0), geracaoUltimaTentativaEm: (r.geracao_ultima_tentativa_em as string | null) ?? null,
  relatorioId: (r.relatorio_id as string | null) ?? null,
});

export function portaSupabase(admin: SupabaseClient, baseUrl: string): PortaFechamento {
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(nome, args);
    if (error) throw new Error(`${nome}: ${error.message}`);
    return data;
  };
  return {
    async config() {
      const { data, error } = await admin.from("escala_relatorio_config").select("automatico_ativo, desde_semana").eq("id", true).maybeSingle();
      if (error) throw new Error(`escala_relatorio_config: ${error.message}`);
      return { ativo: data?.automatico_ativo === true, desdeSemana: (data?.desde_semana as string | null) ?? null };
    },
    async lerFontes(semana) {
      try { return await lerFontes(admin, semana); } catch (e) { if (e instanceof Error && e.message.includes("Não existe Previsão")) return null; throw e; }
    },
    async reivindicar(semana, logicoMs) {
      const r = await rpc("escala_relatorio_fechamento_reivindicar", { p_semana: semana, p_logico: new Date(logicoMs).toISOString() });
      return r ? paraFechamento(r as Record<string, unknown>) : null;
    },
    gerar: (semana, logicoMs) => gerarRelatorio(admin, { semana, tipo: "executada", usuario: null, baseUrl, automatico: { fechamentoLogicoMs: logicoMs } }),
    async erroGeracao(id, erro) { await rpc("escala_relatorio_fechamento_erro_geracao", { p_id: id, p_erro: erro }); },
    async liberar(id) { await rpc("escala_relatorio_fechamento_liberar", { p_id: id }); },
  };
}

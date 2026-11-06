// Leitura do fechamento físico para o carregamento de estado do motor. Sem a flag em `ativo` NADA daqui é lido (caminho anterior byte-idêntico).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import type { ModoFechamento } from "@/features/escala/fechamento/tipos";

export const CHAVE_MODO_FECHAMENTO = "escala_fechamento_fisico_modo";

export function lerModoFechamento(parametros: { chave: string; valor: unknown }[]): ModoFechamento {
  const v = parametros.find((p) => p.chave === CHAVE_MODO_FECHAMENTO)?.valor;
  return v === "sombra" || v === "ativo" ? v : "desligado";
}

interface LinhaContagemView { produtoId: string; etapaOrigemId: string; etapaSeguinteId: string; saldo: number | string; contadoEm: string; informadoPor: string | null; fechamento_id: string; data: string; periodo_id: string; revisao: number }

/** Contagens VIGENTES dos fechamentos (a mais recente por par), no formato do motor. `contadoEm` = instante do motor (fim do período fechado). */
export async function carregarContagensDeFechamento(admin: SupabaseClient): Promise<ContagemFisicaPar[]> {
  return (await carregarContagensEBaseDeFechamento(admin)).contagens;
}

/** Idem, e os ids dos fechamentos vigentes que originaram as contagens (a BASE FÍSICA do cálculo — ver escala_plano_base_fisica). */
export async function carregarContagensEBaseDeFechamento(admin: SupabaseClient): Promise<{ contagens: ContagemFisicaPar[]; fechamentoIds: string[] }> {
  const { data, error } = await admin.from("escala_contagens_fechamento_para_motor").select("*");
  if (error) throw new Error(`escala_contagens_fechamento_para_motor: ${error.message}`);
  const rows = (data ?? []) as LinhaContagemView[];
  // BASE FÍSICA = todos os fechamentos CONFIRMADOS vigentes (não-sombra) dos últimos 30 dias — inclusive o fechamento de EXCEÇÃO (sem contagem), que não gera linha na view mas é o snapshot do dia.
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const est = await admin.from("escala_fechamento_estado").select("fechamento_id").eq("estado", "CONFIRMADO").eq("sombra", false).gte("data", desde);
  if (est.error) throw new Error(`escala_fechamento_estado: ${est.error.message}`);
  return { contagens: linhasParaContagens(rows), fechamentoIds: ((est.data ?? []) as { fechamento_id: string }[]).map((r) => r.fechamento_id).sort() };
}

function linhasParaContagens(rows: LinhaContagemView[]): ContagemFisicaPar[] {
  return rows.map((r) => ({
    produtoId: r.produtoId, etapaOrigemId: r.etapaOrigemId, etapaSeguinteId: r.etapaSeguinteId, saldo: Number(r.saldo), contadoEmMs: Date.parse(r.contadoEm),
    informadoPor: "fechamento-fisico", observacao: `Fechamento físico ${r.data} ${r.periodo_id} (rev. ${r.revisao}) · ${r.fechamento_id}`,
  }));
}

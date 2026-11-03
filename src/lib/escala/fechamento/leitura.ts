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
  const { data, error } = await admin.from("escala_contagens_fechamento_para_motor").select("*");
  if (error) throw new Error(`escala_contagens_fechamento_para_motor: ${error.message}`);
  return ((data ?? []) as LinhaContagemView[]).map((r) => ({
    produtoId: r.produtoId, etapaOrigemId: r.etapaOrigemId, etapaSeguinteId: r.etapaSeguinteId, saldo: Number(r.saldo), contadoEmMs: Date.parse(r.contadoEm),
    informadoPor: "fechamento-fisico", observacao: `Fechamento físico ${r.data} ${r.periodo_id} (rev. ${r.revisao}) · ${r.fechamento_id}`,
  }));
}

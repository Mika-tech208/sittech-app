// SERVER-ONLY. Leitura dos dados brutos do controle de estoque intermediário (WIP) e gravação da foto de abertura da semana.
// Só I/O: o cálculo vive em src/features/escala/wipSaldo.ts (puro).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntradaWip } from "@/features/escala/wipSaldo";
import type { SnapshotWipParaGravar } from "./estado";

function ok<T>(resp: { data: T | null; error: { message: string } | null }, onde: string): T {
  if (resp.error) throw new Error(`${onde}: ${resp.error.message}`);
  return (resp.data ?? ([] as unknown)) as T;
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const PAGINA = 1000;

// "boas" = produzida − refugo, por etapa e dia (a Produção Real é a fonte; nada é gravado aqui)
async function producaoBoas(admin: SupabaseClient, etapaIds: string[], desde: string): Promise<EntradaWip["producao"]> {
  const saida: EntradaWip["producao"] = [];
  for (let de = 0; ; de += PAGINA) {
    const linhas = ok(
      await admin.from("apontamentos_producao").select("etapa_id, data, quantidade_produzida, quantidade_refugo").in("etapa_id", etapaIds).gte("data", desde).order("data").order("id").range(de, de + PAGINA - 1),
      "apontamentos_producao"
    ) as { etapa_id: string; data: string; quantidade_produzida: number; quantidade_refugo: number }[];
    linhas.forEach((l) => saida.push({ etapaId: l.etapa_id, data: String(l.data), boas: Number(l.quantidade_produzida ?? 0) - Number(l.quantidade_refugo ?? 0) }));
    if (linhas.length < PAGINA) break;
  }
  return saida;
}

export async function carregarWipControle(admin: SupabaseClient, semanaInicio: string): Promise<Omit<EntradaWip, "hoje"> | undefined> {
  const controlesRows = ok(
    await admin.from("wip_controle").select("id, produto_id, etapa_origem_id, etapa_seguinte_id, data_inicio, saldo_inicial, ativo").eq("ativo", true),
    "wip_controle"
  ) as { id: string; produto_id: string; etapa_origem_id: string; etapa_seguinte_id: string; data_inicio: string; saldo_inicial: number; ativo: boolean }[];
  if (controlesRows.length === 0) return undefined;
  const ids = controlesRows.map((c) => c.id);
  const produtoIds = [...new Set(controlesRows.map((c) => c.produto_id))];
  const etapaIds = [...new Set(controlesRows.flatMap((c) => [c.etapa_origem_id, c.etapa_seguinte_id]))];
  const minInicio = controlesRows.map((c) => String(c.data_inicio)).sort()[0];

  const [ajustes, confs, snaps, previsoes, etapas, produtos, producao] = await Promise.all([
    admin.from("wip_ajustes").select("controle_id, data, quantidade, motivo").in("controle_id", ids),
    admin.from("wip_confirmacoes").select("id, controle_id, data_referencia, quantidade_confirmada, saldo_estimado, motivo, criado_em").in("controle_id", ids),
    admin.from("wip_saldo_semanal").select("semana_inicio, controle_id, saldo_estimado, saldo_confirmado_disponivel, saldo_alocado").in("controle_id", ids),
    admin.from("previsoes").select("semana_inicio, previsao_itens(produto_id, quantidade, tipo)").gte("semana_inicio", somarDias(minInicio, -7)).lte("semana_inicio", semanaInicio),
    admin.from("roteiro_etapas").select("id, produto_id, ordem").in("produto_id", produtoIds),
    admin.from("produtos").select("id, ativo").in("id", produtoIds),
    producaoBoas(admin, etapaIds, minInicio),
  ]);

  const etapasPorProduto: Record<string, { id: string; ordem: number }[]> = {};
  (ok(etapas, "roteiro_etapas") as { id: string; produto_id: string; ordem: number }[]).forEach((e) => (etapasPorProduto[e.produto_id] ||= []).push({ id: e.id, ordem: Number(e.ordem) }));
  const produtoAtivo: Record<string, boolean> = {};
  (ok(produtos, "produtos") as { id: string; ativo: boolean }[]).forEach((p) => (produtoAtivo[p.id] = p.ativo));

  return {
    controles: controlesRows.map((c) => ({ id: c.id, produtoId: c.produto_id, etapaOrigemId: c.etapa_origem_id, etapaSeguinteId: c.etapa_seguinte_id, dataInicio: String(c.data_inicio), saldoInicial: Number(c.saldo_inicial), ativo: c.ativo })),
    ajustes: (ok(ajustes, "wip_ajustes") as { controle_id: string; data: string; quantidade: number; motivo: string }[]).map((a) => ({ controleId: a.controle_id, data: String(a.data), quantidade: Number(a.quantidade), motivo: a.motivo })),
    confirmacoes: (ok(confs, "wip_confirmacoes") as { id: string; controle_id: string; data_referencia: string; quantidade_confirmada: number; saldo_estimado: number; motivo: string | null; criado_em: string }[]).map((c) => ({
      id: c.id, controleId: c.controle_id, dataReferencia: String(c.data_referencia), quantidade: Number(c.quantidade_confirmada), saldoEstimado: Number(c.saldo_estimado), motivo: c.motivo, criadoEm: c.criado_em,
    })),
    producao,
    snapshots: (ok(snaps, "wip_saldo_semanal") as { semana_inicio: string; controle_id: string; saldo_estimado: number; saldo_confirmado_disponivel: number; saldo_alocado: number }[]).map((s) => ({
      semanaInicio: String(s.semana_inicio), controleId: s.controle_id, saldoEstimado: Number(s.saldo_estimado), saldoConfirmadoDisponivel: Number(s.saldo_confirmado_disponivel), saldoAlocado: Number(s.saldo_alocado),
    })),
    semanas: (ok(previsoes, "previsoes (WIP)") as { semana_inicio: string; previsao_itens: { produto_id: string; quantidade: number; tipo: string }[] | null }[]).map((p) => {
      const q: Record<string, number> = {};
      (p.previsao_itens ?? []).filter((i) => i.tipo === "previsto").forEach((i) => (q[i.produto_id] = (q[i.produto_id] ?? 0) + Number(i.quantidade)));
      return { semanaInicio: String(p.semana_inicio), quantidadePorProduto: q };
    }),
    roteiro: { produtoAtivo, etapasPorProduto },
  };
}

export async function gravarSnapshotsWip(admin: SupabaseClient, semanaInicio: string, snapshots: SnapshotWipParaGravar[]): Promise<void> {
  const { error } = await admin.rpc("wip_gravar_snapshots", {
    p_semana_inicio: semanaInicio,
    p_itens: snapshots.map((s) => ({ controle_id: s.controleId, saldo_estimado: s.saldoEstimado, saldo_confirmado_disponivel: s.saldoConfirmadoDisponivel, saldo_alocado: s.saldoAlocado })),
  });
  if (error) throw new Error(`wip_gravar_snapshots: ${error.message}`);
}

// Acesso real (service_role) usado pelo serviço — as RPCs só aceitam service_role e gravam o usuário para auditoria
import type { WipDb } from "./wipServico";

export function criarWipDb(admin: SupabaseClient): WipDb {
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(nome, args);
    if (error) throw new Error(`${nome}: ${error.message}`);
    return data as string;
  };
  return {
    carregar: (semana) => carregarWipControle(admin, semana),
    criarControle: (p) => rpc("wip_controle_criar", { p_usuario_id: p.usuarioId, p_produto_id: p.produtoId, p_etapa_origem_id: p.etapaOrigemId, p_etapa_seguinte_id: p.etapaSeguinteId, p_data_inicio: p.dataInicio, p_saldo_inicial: p.saldoInicial }),
    ativarControle: async (p) => {
      await rpc("wip_controle_ativar", { p_usuario_id: p.usuarioId, p_controle_id: p.controleId, p_ativo: p.ativo });
    },
    ajustar: (p) => rpc("wip_ajustar", { p_usuario_id: p.usuarioId, p_controle_id: p.controleId, p_data: p.data, p_quantidade: p.quantidade, p_motivo: p.motivo, p_chave: p.chave }),
    confirmar: (p) => rpc("wip_confirmar", { p_usuario_id: p.usuarioId, p_controle_id: p.controleId, p_data_referencia: p.dataReferencia, p_quantidade: p.quantidade, p_saldo_estimado: p.saldoEstimado, p_motivo: p.motivo, p_chave: p.chave }),
  };
}

// Banco ↔ modelo de rotas (M3), SERVIDOR. Dois pontos: (1) carregar a estrutura dos produtos de rotas presentes na semana (só existe se a tabela existir e algum produto da Previsão for de rotas);
// (2) registrar a divisão (append-only, idempotente). Sem produto de rotas: `undefined` e nenhuma escrita — o caminho dos produtos lineares não muda.
import type { SupabaseClient } from "@supabase/supabase-js";
import { estruturaDoBanco } from "@/features/rotas/estrutura";
import type { RegistroDivisao } from "@/features/rotas/resolucao";
import type { RotasDoEstado } from "./estado";

// tabela/coluna ainda inexistente (banco sem o M0): não é erro — a semana é linear
const ausente = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "PGRST205" || e.code === "42883" || /does not exist|schema cache/i.test(e.message ?? "");

export async function carregarRotasDoEstado(admin: SupabaseClient, produtoIds: string[]): Promise<RotasDoEstado | undefined> {
  if (produtoIds.length === 0) return undefined;
  const r = await admin.from("produto_rota").select("produto_id").in("produto_id", produtoIds);
  if (r.error) { if (ausente(r.error)) return undefined; throw new Error(`produto_rota: ${r.error.message}`); }
  const comRotas = [...new Set((r.data ?? []).map((x) => x.produto_id as string))];
  if (comRotas.length === 0) return undefined;
  const estruturas: RotasDoEstado["estruturas"] = {};
  for (const id of comRotas) {
    const { data, error } = await admin.rpc("produto_estrutura_rotas", { p_produto: id });
    if (error) throw new Error(`produto_estrutura_rotas: ${error.message}`);
    estruturas[id] = estruturaDoBanco(data as Parameters<typeof estruturaDoBanco>[0]);
  }
  return { estruturas };
}

export async function gravarDivisaoRotas(admin: SupabaseClient, registros: RegistroDivisao[]): Promise<void> {
  if (registros.length === 0) return;
  const linhas = registros.map((x) => ({
    previsao_id: x.previsaoId, produto_id: x.produtoId, rota_id: x.rotaId, semana_inicio: x.semanaInicio, rodada: x.rodada, rodada_final: x.rodadaFinal,
    quantidade_alvo: x.quantidadeAlvo, capacidade_nominal: x.capacidadeNominal, capacidade_rota: x.capacidadeRealizavel,
    algoritmo_versao: x.algoritmoVersao, hash_entrada: x.hashEntrada, hash_escala: x.hashEscala, gargalo: x.gargalo, motivo: x.motivo,
  }));
  const { error } = await admin.from("escala_rota_divisao").upsert(linhas, { onConflict: "previsao_id,produto_id,rota_id,rodada,hash_entrada,hash_escala", ignoreDuplicates: true });
  if (error) throw new Error(`escala_rota_divisao: ${error.message}`);
}

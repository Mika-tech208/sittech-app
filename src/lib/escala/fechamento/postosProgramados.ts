// SERVER-ONLY. Postos PROGRAMADOS do período (plano oficial) para pré-preencher os apontamentos do fechamento. SOMENTE LEITURA, só tabelas já existentes em PROD
// (escala_producao_alocacoes, cadastros, roteiro, apontamentos via RPC existente). Nenhuma tabela/flag/migration nova. A gravação continua nas RPCs legadas, pelo navegador.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlocacaoPlano, ApontamentoExistente, Catalogo, ElegibilidadeItem, PlanejadoPosto } from "@/features/producao-real/apontamento-simplificado/tipos";
import { postosProgramados } from "@/features/producao-real/apontamento-simplificado/prefill";
import { carregarApontamentosBanco } from "../fluxo/supabaseFluxo";

export interface EstadoPostos { postos: PlanejadoPosto[]; catalogo: Catalogo; existentes: ApontamentoExistente[] }
type Cad = { id: string; nome: string; ativo?: boolean };
export interface DadosBrutosPostos {
  alocacoes: Record<string, unknown>[]; maquinas: Cad[]; funcionarios: Cad[]; produtos: Cad[]; operacoes: { id: string; nome: string }[];
  etapas: { id: string; produto_id: string; operacao_id: string }[]; etapaMaquinas: { etapa_id: string; maquina_id: string }[];
  apontamentos: { maquinaId: string | null; funcionarioId: string | null; produtoId: string | null; operacaoId: string | null; quantidadeProduzida: number; quantidadeRefugo: number; status: string; motivo: string | null }[];
}

export const segundaDe = (data: string) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/** Parte pura (testável com dados reais do PROD, sem banco): linhas cruas → estado da tela. */
export function montarEstadoPostos(b: DadosBrutosPostos): EstadoPostos {
  const alocacoes: AlocacaoPlano[] = b.alocacoes.map((a) => ({
    maquinaId: a.maquina_id as string, funcionarioId: a.funcionario_id as string, produtoId: (a.produto_id as string | null) ?? null, etapaId: (a.etapa_id as string | null) ?? null, operacaoId: (a.operacao_id as string | null) ?? null,
    pecas: Number(a.pecas ?? 0), pecasAdicional: Number(a.pecas_adicional ?? 0),
  }));
  const usadosFun = new Set([...alocacoes.map((a) => a.funcionarioId), ...b.apontamentos.map((a) => a.funcionarioId).filter(Boolean) as string[]]);
  const usadosProd = new Set([...alocacoes.map((a) => a.produtoId).filter(Boolean) as string[], ...b.apontamentos.map((a) => a.produtoId).filter(Boolean) as string[]]);
  const usadosMaq = new Set([...alocacoes.map((a) => a.maquinaId).filter(Boolean) as string[], ...b.apontamentos.map((a) => a.maquinaId as string)]);
  const lista = (rows: Cad[], usados: Set<string>) => rows.filter((r) => r.ativo !== false || usados.has(r.id)).map((r) => ({ id: r.id, nome: String(r.nome).trim() })).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR", { numeric: true }));
  const etapaPorId = new Map(b.etapas.map((e) => [e.id, e]));
  const elegibilidade = b.etapaMaquinas.flatMap((r): ElegibilidadeItem[] => {
    const e = etapaPorId.get(r.etapa_id);
    return e ? [{ maquinaId: r.maquina_id, produtoId: e.produto_id, etapaId: e.id, operacaoId: e.operacao_id }] : [];
  });
  const catalogo: Catalogo = {
    maquinas: lista(b.maquinas, usadosMaq), funcionarios: lista(b.funcionarios, usadosFun), produtos: lista(b.produtos, usadosProd),
    operacoes: Object.fromEntries(b.operacoes.map((o) => [o.id, String(o.nome).trim()])), elegibilidade,
  };
  const existentes: ApontamentoExistente[] = b.apontamentos.map((a) => ({
    id: `maq:${a.maquinaId}`, maquinaId: a.maquinaId as string, funcionarioId: a.funcionarioId, produtoId: a.produtoId, operacaoId: a.operacaoId,
    produzido: a.quantidadeProduzida, refugo: a.quantidadeRefugo, status: a.status === "sem_producao" ? "sem_producao" : "produzindo", motivoSemProducao: a.motivo, descricaoSemProducao: null,
  }));
  return { postos: postosProgramados(alocacoes, catalogo), catalogo, existentes };
}

function ok<T>(resp: { data: T | null; error: { message: string } | null }, onde: string): T {
  if (resp.error) throw new Error(`${onde}: ${resp.error.message}`);
  return (resp.data ?? ([] as unknown)) as T;
}

export async function carregarPostosProgramados(admin: SupabaseClient, data: string, periodoId: string): Promise<EstadoPostos> {
  const [aloc, maq, fun, prod, ops, etapas, rem, apont] = await Promise.all([
    admin.from("escala_producao_alocacoes").select("maquina_id, funcionario_id, produto_id, etapa_id, operacao_id, pecas, pecas_adicional").eq("data", data).eq("periodo_id", periodoId).not("maquina_id", "is", null),
    admin.from("maquinas").select("id, nome, ativo"), admin.from("funcionarios").select("id, nome, ativo"), admin.from("produtos").select("id, nome, ativo"),
    admin.from("operacoes").select("id, nome"), admin.from("roteiro_etapas").select("id, produto_id, operacao_id"), admin.from("roteiro_etapa_maquinas").select("etapa_id, maquina_id"),
    carregarApontamentosBanco(admin, segundaDe(data)),
  ]);
  return montarEstadoPostos({
    alocacoes: ok(aloc, "escala_producao_alocacoes") as Record<string, unknown>[], maquinas: ok(maq, "maquinas") as Cad[], funcionarios: ok(fun, "funcionarios") as Cad[], produtos: ok(prod, "produtos") as Cad[],
    operacoes: ok(ops, "operacoes") as { id: string; nome: string }[], etapas: ok(etapas, "roteiro_etapas") as { id: string; produto_id: string; operacao_id: string }[],
    etapaMaquinas: ok(rem, "roteiro_etapa_maquinas") as { etapa_id: string; maquina_id: string }[],
    apontamentos: apont.filter((a) => a.data === data && a.periodoId === periodoId && a.maquinaId),
  });
}

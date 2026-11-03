// SERVER-ONLY. IO do apontamento simplificado (Frente 2). Toda regra de domínio vive em src/features/producao-real/apontamento-simplificado; aqui só leitura/gravação.
//  - leitura: service_role (plano oficial do período, catálogos, apontamentos via RPC existente, vínculos planejado×real);
//  - gravação: SEMPRE com a sessão do usuário (supabaseAsUser) chamando a RPC `registrar_apontamentos_fechamento` (criado_por = quem está no fechamento; o gatilho do fechamento físico valida a janela).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlocacaoPlano, ApontamentoExistente, Catalogo, Divergencia, ElegibilidadeItem, LinhaRpc, MotivoNaoProduziu, OrigemLinha, PlanejadoPosto, VinculoSalvo } from "@/features/producao-real/apontamento-simplificado/tipos";
import { postosProgramados } from "@/features/producao-real/apontamento-simplificado/prefill";
import { CHAVE_MODO_APONTAMENTO_SIMPLIFICADO, lerModoApontamentoSimplificado, type ModoApontamentoSimplificado } from "@/features/producao-real/apontamento-simplificado/modo";
import type { PostoFechamento } from "@/features/escala/fechamento/tipos";
import { carregarApontamentosBanco } from "./../fluxo/supabaseFluxo";

export interface EstadoApontamentos { postos: PlanejadoPosto[]; catalogo: Catalogo; existentes: ApontamentoExistente[]; vinculos: VinculoSalvo[] }
export interface ResultadoSalvar { substituidas: number; linhas: { chave: string; apontamentoId: string; origem: OrigemLinha; divergencias: Divergencia[]; naoProduziu: boolean }[] }
export interface ApontamentosIO {
  modo(): Promise<ModoApontamentoSimplificado>;
  carregar(data: string, periodoId: string): Promise<EstadoApontamentos>;
  salvar(data: string, periodoId: string, linhas: LinhaRpc[]): Promise<ResultadoSalvar>;
}

function ok<T>(resp: { data: T | null; error: { message: string } | null }, onde: string): T {
  if (resp.error) throw new Error(`${onde}: ${resp.error.message}`);
  return (resp.data ?? ([] as unknown)) as T;
}
export const segundaDe = (data: string) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
/** A chave opaca de um apontamento no estado: a leitura via RPC da Escala não expõe o id, e o par (máquina, dia, período) é único. */
export const chaveApontamento = (maquinaId: string) => `maq:${maquinaId}`;

export async function lerModo(admin: SupabaseClient): Promise<ModoApontamentoSimplificado> {
  const rows = ok(await admin.from("escala_parametros").select("chave, valor").eq("chave", CHAVE_MODO_APONTAMENTO_SIMPLIFICADO), "escala_parametros") as { chave: string; valor: unknown }[];
  return lerModoApontamentoSimplificado(rows);
}

interface VinculoRow { maquina_planejada_id: string | null; maquina_real_id: string; origem: OrigemLinha; divergencias: Divergencia[]; nao_produziu: boolean; motivo_nao_produziu: MotivoNaoProduziu | null; linha_chave: string; real: { descricao_informada?: string | null } | null }

export async function lerVinculos(admin: SupabaseClient, data: string, periodoId: string): Promise<VinculoRow[]> {
  return ok(await admin.from("apontamento_planejado_real").select("maquina_planejada_id, maquina_real_id, origem, divergencias, nao_produziu, motivo_nao_produziu, linha_chave, real").eq("data", data).eq("periodo_id", periodoId), "apontamento_planejado_real") as VinculoRow[];
}

export function criarApontamentosIO(admin: SupabaseClient, comoUsuario: SupabaseClient): ApontamentosIO {
  return {
    modo: () => lerModo(admin),

    async carregar(data, periodoId): Promise<EstadoApontamentos> {
      const [aloc, maq, fun, prod, ops, etapas, rem, vincs, apont] = await Promise.all([
        admin.from("escala_producao_alocacoes").select("maquina_id, funcionario_id, produto_id, etapa_id, operacao_id, pecas, pecas_adicional").eq("data", data).eq("periodo_id", periodoId).not("maquina_id", "is", null),
        admin.from("maquinas").select("id, nome, ativo"),
        admin.from("funcionarios").select("id, nome, ativo"),
        admin.from("produtos").select("id, nome, ativo"),
        admin.from("operacoes").select("id, nome"),
        admin.from("roteiro_etapas").select("id, produto_id, operacao_id"),
        admin.from("roteiro_etapa_maquinas").select("etapa_id, maquina_id"),
        lerVinculos(admin, data, periodoId),
        carregarApontamentosBanco(admin, segundaDe(data)),
      ]);
      const alocacoes: AlocacaoPlano[] = (ok(aloc, "escala_producao_alocacoes") as Record<string, unknown>[]).map((a) => ({
        maquinaId: a.maquina_id as string, funcionarioId: a.funcionario_id as string, produtoId: a.produto_id as string | null, etapaId: a.etapa_id as string | null, operacaoId: a.operacao_id as string | null,
        pecas: Number(a.pecas ?? 0), pecasAdicional: Number(a.pecas_adicional ?? 0),
      }));
      const existentesBanco = apont.filter((a) => a.data === data && a.periodoId === periodoId && a.maquinaId);
      const usadosFun = new Set([...alocacoes.map((a) => a.funcionarioId), ...existentesBanco.map((a) => a.funcionarioId).filter(Boolean) as string[]]);
      const usadosProd = new Set([...alocacoes.map((a) => a.produtoId).filter(Boolean) as string[], ...existentesBanco.map((a) => a.produtoId).filter(Boolean) as string[]]);
      const usadosMaq = new Set([...alocacoes.map((a) => a.maquinaId).filter(Boolean) as string[], ...existentesBanco.map((a) => a.maquinaId as string)]);
      const lista = (rows: { id: string; nome: string; ativo?: boolean }[], usados: Set<string>) => rows.filter((r) => r.ativo !== false || usados.has(r.id)).map((r) => ({ id: r.id, nome: String(r.nome).trim() })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
      const catalogo: Catalogo = {
        maquinas: lista(ok(maq, "maquinas") as { id: string; nome: string; ativo: boolean }[], usadosMaq),
        funcionarios: lista(ok(fun, "funcionarios") as { id: string; nome: string; ativo: boolean }[], usadosFun),
        produtos: lista(ok(prod, "produtos") as { id: string; nome: string; ativo: boolean }[], usadosProd),
        operacoes: Object.fromEntries((ok(ops, "operacoes") as { id: string; nome: string }[]).map((o) => [o.id, String(o.nome).trim()])),
        elegibilidade: [],
      };
      const etapaPorId = new Map((ok(etapas, "roteiro_etapas") as { id: string; produto_id: string; operacao_id: string }[]).map((e) => [e.id, e]));
      catalogo.elegibilidade = (ok(rem, "roteiro_etapa_maquinas") as { etapa_id: string; maquina_id: string }[]).flatMap((r): ElegibilidadeItem[] => {
        const e = etapaPorId.get(r.etapa_id);
        return e ? [{ maquinaId: r.maquina_id, produtoId: e.produto_id, etapaId: e.id, operacaoId: e.operacao_id }] : [];
      });
      const existentes: ApontamentoExistente[] = existentesBanco.map((a) => ({
        id: chaveApontamento(a.maquinaId as string), maquinaId: a.maquinaId as string, funcionarioId: a.funcionarioId, produtoId: a.produtoId, operacaoId: a.operacaoId,
        produzido: a.quantidadeProduzida, refugo: a.quantidadeRefugo, status: a.status === "sem_producao" ? "sem_producao" : "produzindo", motivoSemProducao: a.motivo, descricaoSemProducao: null,
      }));
      const vinculos: VinculoSalvo[] = vincs.map((v) => ({
        apontamentoId: chaveApontamento(v.maquina_real_id), origem: v.origem, maquinaPlanejadaId: v.maquina_planejada_id, divergencias: v.divergencias, naoProduziu: v.nao_produziu, motivo: v.motivo_nao_produziu,
        linhaChave: v.linha_chave, descricaoInformada: v.real?.descricao_informada ?? "",
      }));
      return { postos: postosProgramados(alocacoes, catalogo), catalogo, existentes, vinculos };
    },

    async salvar(data, periodoId, linhas): Promise<ResultadoSalvar> {
      const { data: r, error } = await comoUsuario.rpc("registrar_apontamentos_fechamento", { p_data: data, p_periodo_id: periodoId, p_linhas: linhas });
      if (error) throw new Error(error.message);
      const j = (r ?? {}) as { substituidas?: number; linhas?: { chave: string; apontamento_id: string; origem: OrigemLinha; divergencias: Divergencia[]; nao_produziu: boolean }[] };
      return { substituidas: j.substituidas ?? 0, linhas: (j.linhas ?? []).map((l) => ({ chave: l.chave, apontamentoId: l.apontamento_id, origem: l.origem, divergencias: l.divergencias, naoProduziu: l.nao_produziu })) };
    },
  };
}

/**
 * Integração com o contexto do fechamento (orquestrador/supabaseFechamento): posto PROGRAMADO cuja produção foi lançada em OUTRA máquina fica resolvido (sem_producao + "realizado em X"),
 * senão o fechamento acusaria pendência de um posto que a pessoa já tratou. Só age com a flag `ativo`; com a flag desligada devolve os postos IGUAIS e `resumo: null` (zero consulta além da flag).
 * Não muda o contrato: continua devolvendo PostoFechamento[] (status pendente | produzindo | sem_producao).
 */
export async function ajustarPostosDoFechamento(admin: SupabaseClient, data: string, periodoId: string, postos: PostoFechamento[], nomeMaquina: (id: string) => string): Promise<{ postos: PostoFechamento[]; resumo: Record<string, unknown> | null }> {
  if ((await lerModo(admin)) !== "ativo") return { postos, resumo: null };
  const vincs = await lerVinculos(admin, data, periodoId);
  return aplicarVinculosAosPostos(postos, vincs.map((v) => ({ maquinaPlanejadaId: v.maquina_planejada_id, maquinaRealId: v.maquina_real_id, origem: v.origem, divergencias: v.divergencias, naoProduziu: v.nao_produziu, motivo: v.motivo_nao_produziu })), nomeMaquina);
}

export interface VinculoResumo { maquinaPlanejadaId: string | null; maquinaRealId: string; origem: OrigemLinha; divergencias: Divergencia[]; naoProduziu: boolean; motivo: MotivoNaoProduziu | null }
/** Parte pura de `ajustarPostosDoFechamento` (testável sem banco). */
export function aplicarVinculosAosPostos(postos: PostoFechamento[], vincs: VinculoResumo[], nomeMaquina: (id: string) => string): { postos: PostoFechamento[]; resumo: Record<string, unknown> } {
  const ajustados = postos.map((p): PostoFechamento => {
    if (p.status !== "pendente") return p;
    const v = vincs.find((x) => x.maquinaPlanejadaId === p.maquinaId && x.maquinaRealId !== p.maquinaId);
    return v ? { ...p, status: "sem_producao", motivo: `realizado em ${nomeMaquina(v.maquinaRealId)}` } : p;
  });
  return {
    postos: ajustados,
    resumo: {
      vinculos: vincs.length, nao_planejados: vincs.filter((v) => v.origem === "POSTO_NAO_PLANEJADO").length, nao_produziu: vincs.filter((v) => v.naoProduziu).length,
      com_divergencia: vincs.filter((v) => v.divergencias.length > 0).map((v) => ({ maquina_planejada_id: v.maquinaPlanejadaId, maquina_real_id: v.maquinaRealId, divergencias: v.divergencias })),
    },
  };
}

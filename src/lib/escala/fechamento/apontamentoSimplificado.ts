// SERVER-ONLY. IO do apontamento simplificado (Frente 2). Toda regra de domínio vive em src/features/producao-real/apontamento-simplificado; aqui só leitura/gravação.
//  - leitura: service_role (plano oficial do período, catálogos, apontamentos via RPC existente, vínculos planejado×real);
//  - gravação: SEMPRE com a sessão do usuário (supabaseAsUser) chamando a RPC `registrar_apontamentos_fechamento` (criado_por = quem está no fechamento; o gatilho do fechamento físico valida a janela).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApontamentoExistente, Catalogo, Divergencia, LinhaRpc, MotivoNaoProduziu, OrigemLinha, PlanejadoPosto, VinculoSalvo } from "@/features/producao-real/apontamento-simplificado/tipos";
import { CHAVE_MODO_APONTAMENTO_SIMPLIFICADO, lerModoApontamentoSimplificado, type ModoApontamentoSimplificado } from "@/features/producao-real/apontamento-simplificado/modo";
import type { PostoFechamento } from "@/features/escala/fechamento/tipos";
import { carregarPostosProgramados, segundaDe as segundaDeSemana } from "./postosProgramados";

export interface EstadoApontamentos { postos: PlanejadoPosto[]; catalogo: Catalogo; existentes: ApontamentoExistente[]; vinculos: VinculoSalvo[] }
export interface ResultadoSalvar { substituidas: number; linhas: { chave: string; apontamentoId: string; origem: OrigemLinha; divergencias: Divergencia[]; naoProduziu: boolean }[] }
export interface ApontamentosIO {
  modo(): Promise<ModoApontamentoSimplificado>;
  liberado(data: string, periodoId: string): Promise<boolean>;
  carregar(data: string, periodoId: string): Promise<EstadoApontamentos>;
  salvar(data: string, periodoId: string, linhas: LinhaRpc[]): Promise<ResultadoSalvar>;
}

function ok<T>(resp: { data: T | null; error: { message: string } | null }, onde: string): T {
  if (resp.error) throw new Error(`${onde}: ${resp.error.message}`);
  return (resp.data ?? ([] as unknown)) as T;
}
export const segundaDe = segundaDeSemana;
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

    // UMA ÚNICA fonte de postos programados (alocações do plano do período + catálogo + apontamentos): a mesma da grade do tablet (`/postos`).
    async carregar(data, periodoId): Promise<EstadoApontamentos> {
      const [estado, vincs] = await Promise.all([carregarPostosProgramados(admin, data, periodoId), lerVinculos(admin, data, periodoId)]);
      const vinculos: VinculoSalvo[] = vincs.map((v) => ({
        apontamentoId: chaveApontamento(v.maquina_real_id), origem: v.origem, maquinaPlanejadaId: v.maquina_planejada_id, divergencias: v.divergencias, naoProduziu: v.nao_produziu, motivo: v.motivo_nao_produziu,
        linhaChave: v.linha_chave, descricaoInformada: v.real?.descricao_informada ?? "",
      }));
      return { postos: estado.postos, catalogo: estado.catalogo, existentes: estado.existentes, vinculos };
    },

    /** decide no banco (escala_periodo_liberacao). Período NÃO liberado ⇒ a programação dele não é entregue (nem para apontar). */
    async liberado(data, periodoId) {
      const r = await admin.rpc("escala_periodo_liberacao", { p_data: data, p_periodo: periodoId });
      if (r.error) throw new Error(`escala_periodo_liberacao: ${r.error.message}`);
      return (r.data as { liberado?: boolean } | null)?.liberado === true;
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

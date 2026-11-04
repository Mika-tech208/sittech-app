// Gravação dos apontamentos pré-preenchidos do fechamento USANDO AS RPCs LEGADAS (as mesmas do painel). Nenhum contrato novo de banco.
// planejarGravacao(): linhas prontas → operações (puro). executarGravacao(): chama as RPCs em sequência, parando no 1º erro (puro, IO injetado).
import { paraSemProducao, type MotivoSemProducaoBanco } from "../apontamento-simplificado/motivos";
import type { Catalogo, LinhaApontamento } from "../apontamento-simplificado/tipos";
import { linhaPronta } from "../apontamento-simplificado/validacao";

export type OperacaoGravacao =
  | { tipo: "producao"; chave: string; maquinaId: string; produtoId: string; funcionarioId: string; produzido: number; refugo: number }
  | { tipo: "sem_producao"; chave: string; maquinaId: string; motivo: MotivoSemProducaoBanco; descricao: string | null };

/** Chave de idempotência da operação "irmã" (posto programado resolvido quando a produção foi lançada em OUTRA máquina): determinística, sempre uuid válido e diferente. */
export const chaveIrma = (chave: string): string => chave.slice(0, -1) + (chave.endsWith("0") ? "1" : "0");

/**
 * Cada linha pronta vira 1 ou 2 operações (na ordem em que devem ser gravadas):
 *  - produziu na máquina programada: 1 apontamento de produção;
 *  - NÃO PRODUZIU: 1 `sem_producao` (mecanismo legado) na máquina programada, com o motivo escolhido;
 *  - produziu em OUTRA máquina: produção na máquina REAL (primeiro) + `sem_producao` "Produção realizada em X" na máquina PROGRAMADA (resolve o posto programado, sem tabela nova).
 */
export function planejarGravacao(linhas: LinhaApontamento[], cat: Catalogo): OperacaoGravacao[] {
  const nomeMaq = (id: string) => cat.maquinas.find((m) => m.id === id)?.nome ?? id;
  const ops: OperacaoGravacao[] = [];
  for (const l of linhas) {
    if (!linhaPronta(l, cat)) continue;
    const planejada = l.origem === "PROGRAMADO" ? (l.planejado?.maquinaId ?? null) : null;
    if (l.naoProduziu) {
      const s = paraSemProducao(l.motivo!, l.descricao);
      ops.push({ tipo: "sem_producao", chave: l.chave, maquinaId: planejada ?? (l.real.maquinaId as string), motivo: s.motivo, descricao: s.descricao });
      continue;
    }
    ops.push({ tipo: "producao", chave: l.chave, maquinaId: l.real.maquinaId as string, produtoId: l.real.produtoId as string, funcionarioId: l.real.funcionarioId as string, produzido: l.produzido as number, refugo: l.refugo ?? 0 });
    if (planejada && planejada !== l.real.maquinaId) ops.push({ tipo: "sem_producao", chave: chaveIrma(l.chave), maquinaId: planejada, motivo: "outro", descricao: `Produção realizada em ${nomeMaq(l.real.maquinaId as string)}` });
  }
  return ops;
}

export const MARGEM_ANTES_DO_FIM_MS = 15_000;
export const ESPERA_APOS_O_FIM_MS = 2_000;
/** "agora" = período ainda em curso (RPC do período atual); "retro" = período já terminou (RPC retroativa, exige o fim passado no relógio do banco). */
export function modoRpc(agoraMs: number, fimMs: number): { modo: "agora" | "retro"; esperarMs: number } {
  if (agoraMs < fimMs - MARGEM_ANTES_DO_FIM_MS) return { modo: "agora", esperarMs: 0 };
  return { modo: "retro", esperarMs: Math.max(0, fimMs + ESPERA_APOS_O_FIM_MS - agoraMs) }; // na virada espera passar o fim: nunca grava "agora" no período errado
}

export type ChamarRpc = (nome: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
export interface ResultadoGravacao { gravadas: number; erro: { chave: string; mensagem: string } | null }

export async function executarGravacao(ops: OperacaoGravacao[], ctx: { data: string; periodoId: string; fimMs: number }, io: { rpc: ChamarRpc; agora: () => number; esperar: (ms: number) => Promise<void>; traduzErro: (m: string | undefined) => string }): Promise<ResultadoGravacao> {
  let gravadas = 0;
  for (const op of ops) {
    const { modo, esperarMs } = modoRpc(io.agora(), ctx.fimMs);
    if (esperarMs > 0) await io.esperar(esperarMs);
    const retro = modo === "retro" ? { p_data: ctx.data, p_periodo_id: ctx.periodoId } : {};
    const r = op.tipo === "producao"
      ? await io.rpc(modo === "retro" ? "registrar_apontamento_producao_retroativo" : "registrar_apontamento_producao", {
          p_maquina_id: op.maquinaId, p_produto_id: op.produtoId, p_funcionario_id: op.funcionarioId, p_quantidade_produzida: op.produzido, p_quantidade_refugo: op.refugo,
          p_idempotency_key: op.chave, p_observacao: null, p_paradas: [], ...retro })
      : await io.rpc(modo === "retro" ? "registrar_sem_producao_retroativo" : "registrar_sem_producao", {
          p_maquina_id: op.maquinaId, p_motivo_sem_producao: op.motivo, p_idempotency_key: op.chave, p_descricao_sem_producao: op.descricao, ...retro });
    if (r.error) return { gravadas, erro: { chave: op.chave, mensagem: io.traduzErro(r.error.message) } };
    gravadas++;
  }
  return { gravadas, erro: null };
}

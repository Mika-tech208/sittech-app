// INTEGRIDADE DA OPERAÇÃO HISTÓRICA — núcleo PURO, NÃO ligado ao motor. docs/escala-integridade-operacao-historica.md
//
// `roteiro_etapas` é editado NO LUGAR, pelo id (atualizar_produto_com_roteiro): o `etapa_id` é um "slot" cujo significado (operação, ordem) pode mudar.
// O apontamento/alocação guarda, no lançamento, `etapa_id` E `operacao_id` — e a `operacao_id` é um SNAPSHOT correto do que foi executado (derivada da
// máquina em roteiro_etapa_maquinas; em PROD 100% dos apontamentos concordam com a operação cadastrada da máquina, exceto equivalência declarada).
// Logo a identidade estável é a OPERAÇÃO: a etapa canônica de uma linha histórica é a etapa do roteiro ATUAL do mesmo produto com a mesma operação.
// Nunca se corrige em silêncio: devolve-se uma auditoria por linha reclassificada e nada é inferido quando a operação não existe ou repete no roteiro.

import type { ApontamentoReal } from "./producaoReal";

export interface EtapaRoteiro { id: string; produtoId: string; operacaoId: string; ordem: number }
export type MotivoCanonico = "coerente" | "etapa_trocou_de_operacao" | "sem_etapa_equivalente" | "ambigua" | "sem_dados";
export interface ResultadoCanonico { etapaId: string | null; ordem: number | null; motivo: MotivoCanonico }
export interface AuditoriaCanonica { indice: number; produtoId: string; etapaIdGravada: string | null; operacaoId: string | null; etapaIdCanonica: string | null; motivo: MotivoCanonico }

/** Etapa canônica = a do roteiro atual com a MESMA operação (única). Coerente quando já é a etapa gravada. */
export function etapaCanonica(ap: { produtoId: string | null; etapaId: string | null; operacaoId: string | null }, roteiro: EtapaRoteiro[]): ResultadoCanonico {
  if (!ap.produtoId || !ap.operacaoId) return { etapaId: ap.etapaId, ordem: null, motivo: "sem_dados" };
  const mesmaOp = roteiro.filter((e) => e.produtoId === ap.produtoId && e.operacaoId === ap.operacaoId);
  const gravada = roteiro.find((e) => e.id === ap.etapaId);
  if (gravada && gravada.produtoId === ap.produtoId && gravada.operacaoId === ap.operacaoId) return { etapaId: gravada.id, ordem: gravada.ordem, motivo: "coerente" };
  if (mesmaOp.length === 1) return { etapaId: mesmaOp[0].id, ordem: mesmaOp[0].ordem, motivo: "etapa_trocou_de_operacao" };
  return { etapaId: null, ordem: null, motivo: mesmaOp.length === 0 ? "sem_etapa_equivalente" : "ambigua" };
}

/** Reescreve `etapaId` das linhas incoerentes para a etapa canônica (só quando inequívoca). Linhas ambíguas/sem equivalente ficam INTACTAS e são reportadas. */
export function canonizarApontamentos<T extends Pick<ApontamentoReal, "produtoId" | "etapaId" | "operacaoId">>(linhas: T[], roteiro: EtapaRoteiro[]): { linhas: T[]; auditoria: AuditoriaCanonica[] } {
  const auditoria: AuditoriaCanonica[] = [];
  const saida = linhas.map((l, indice) => {
    const r = etapaCanonica(l, roteiro);
    if (r.motivo === "coerente" || r.motivo === "sem_dados") return l;
    auditoria.push({ indice, produtoId: l.produtoId as string, etapaIdGravada: l.etapaId, operacaoId: l.operacaoId, etapaIdCanonica: r.etapaId, motivo: r.motivo });
    return r.motivo === "etapa_trocou_de_operacao" ? { ...l, etapaId: r.etapaId } : l;
  });
  return { linhas: saida, auditoria };
}

/** Resumo para monitorar: quantas linhas por motivo. */
export function resumirIntegridade(auditoria: AuditoriaCanonica[], total: number): Record<MotivoCanonico, number> {
  const r: Record<MotivoCanonico, number> = { coerente: 0, etapa_trocou_de_operacao: 0, sem_etapa_equivalente: 0, ambigua: 0, sem_dados: 0 };
  auditoria.forEach((a) => r[a.motivo]++);
  r.coerente = total - auditoria.length;
  return r;
}

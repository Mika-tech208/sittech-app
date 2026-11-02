// Fixture da auditoria da Máquina 8 (não é arquivo de teste): mini-Conector com rota convencional (pC: Rosquear r1 → Parafusar p1 → Etiquetar e1 → Embalar b1)
// e rota automática (pA: Máquina 8 m8 → Etiquetar e1 → Embalar b1). Etiquetadora e Embalagem são recursos únicos (mesmas máquinas nas duas rotas), como em PROD.
import { PERIODOS_REAIS } from "@/features/escala/__tests__/helpers";
import { lerParametros } from "@/features/escala/parametros";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EstadoBruto } from "../estado";

export const METAS = (a: number, b: number) => ({ m1: a, m2: b, m3: a, t1: b, t2: a, t3: b });
export const DIAS = ["2026-11-03", "2026-11-04", "2026-11-05"];
export const AGORA_VESPERA = epochMsNoFuso("2026-11-02", "18:00");
export interface VarM8 { m8?: string[]; indisponiveis?: string[]; pessoas?: number; qC?: number; qA?: number }

export function estadoM8(v: VarM8 = {}): EstadoBruto {
  return {
    previsaoId: "prev", semanaInicio: "2026-11-02", diasProdutivos: DIAS, periodosAtuais: PERIODOS_REAIS, diasExistentes: [],
    equipeProdutiva: Array.from({ length: v.pessoas ?? 8 }, (_, i) => ({ funcionarioId: `f${String(i + 1).padStart(2, "0")}`, ativo: true })),
    itens: [
      { produtoId: "pC", quantidade: v.qC ?? 6000, quantidadeAdicional: 0, valorUnitario: 1, maquinasPorEtapa: { c1: ["r1"], c2: ["p1"], c3: ["e1"], c4: ["b1"] } },
      { produtoId: "pA", quantidade: v.qA ?? 4000, quantidadeAdicional: 0, valorUnitario: 1, maquinasPorEtapa: { a1: v.m8 ?? ["m8"], a2: ["e1"], a3: ["b1"] } },
    ],
    etapas: [
      { id: "c1", produtoId: "pC", operacaoId: "opR", ordem: 1, metas: METAS(600, 520) }, { id: "c2", produtoId: "pC", operacaoId: "opP", ordem: 2, metas: METAS(500, 420) },
      { id: "c3", produtoId: "pC", operacaoId: "opE", ordem: 3, metas: METAS(900, 800) }, { id: "c4", produtoId: "pC", operacaoId: "opB", ordem: 4, metas: METAS(1200, 1100) },
      { id: "a1", produtoId: "pA", operacaoId: "opM", ordem: 1, metas: METAS(400, 340) }, { id: "a2", produtoId: "pA", operacaoId: "opE", ordem: 2, metas: METAS(900, 800) },
      { id: "a3", produtoId: "pA", operacaoId: "opB", ordem: 3, metas: METAS(1200, 1100) },
    ],
    maquinasIndisponiveisPrevisao: v.indisponiveis ?? [], maquinasInativas: [], ausencias: [], indisponibilidades: [], alocacoes: [],
    nomesOperacao: { opR: "Rosquear", opP: "Parafusar", opM: "Máquina 8", opE: "Etiquetar", opB: "Embalar" },
    parametros: { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true },
  } as unknown as EstadoBruto;
}

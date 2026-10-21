// VERSÕES DO PLANO OFICIAL (Fase 4d, integridade temporal) — PURO. O banco grava uma versão append-only a cada mudança relevante da Escala ou da
// Previsão (escala_plano_versoes). O modo sombra reconstrói o passado SÓ com a versão vigente no instante do corte — nunca com "a Escala de agora".

import { desempacotarLinha, type LinhaPacote } from "@/features/escala/snapshotSombra";
import type { PeriodoEscala } from "@/features/escala/types";
import type { EstadoBruto, ItemPrevistoBruto } from "./estado";

export interface EntradaPrevisaoVersionada {
  diasProdutivos: string[];
  equipe: string[]; // funcionários produtivos da semana
  maquinasIndisponiveisPrevisao: string[];
  itens: ItemPrevistoBruto[];
  // Configuração de WIP vigente quando a versão nasceu (versões antigas não têm: nesse caso vale a atual)
  parametros?: { wipModo: string; wipDiasLimite: number; wipDiasLimitePorSemana: number | null };
}

export interface VersaoPlanoOficial {
  id: string;
  previsaoId: string;
  validoDesdeMs: number; // a partir daqui esta versão era a vigente
  origem: "trigger" | "baseline";
  hashPlano: string; // SHA-256 calculado no banco (linhas + períodos dos dias + entradas da Previsão)
  dias: { data: string; versao: number; periodos_snapshot: PeriodoEscala[] }[];
  linhas: LinhaPacote[];
  entrada: EntradaPrevisaoVersionada;
}

// Substitui, no estado lido, TUDO que a versão sabe (Escala + Previsão). Catálogos que não são versionados (nomes, metas do roteiro, máquinas
// inativas, parâmetros, ausências com carimbo próprio, indisponibilidades com início/fim próprios) continuam vindo do estado lido.
export function estadoComVersao(estado: EstadoBruto, v: VersaoPlanoOficial): EstadoBruto {
  return {
    ...estado,
    diasProdutivos: [...v.entrada.diasProdutivos].sort(),
    diasExistentes: v.dias.map((d) => ({ data: d.data, versao: d.versao, periodosSnapshot: d.periodos_snapshot })),
    equipeProdutiva: v.entrada.equipe.map((id) => estado.equipeProdutiva.find((x) => x.funcionarioId === id) ?? { funcionarioId: id, ativo: true }),
    itens: v.entrada.itens,
    maquinasIndisponiveisPrevisao: v.entrada.maquinasIndisponiveisPrevisao,
    alocacoes: v.linhas.map(desempacotarLinha),
    ...(v.entrada.parametros
      ? {
          parametros: {
            ...(estado.parametros ?? { wipModo: "desligado", wipDiasLimite: 1 }),
            wipModo: v.entrada.parametros.wipModo === "ativo" ? "ativo" : "desligado",
            wipDiasLimite: v.entrada.parametros.wipDiasLimite,
            wipDiasLimitePorSemana: v.entrada.parametros.wipDiasLimitePorSemana === null ? {} : { [estado.semanaInicio]: v.entrada.parametros.wipDiasLimitePorSemana },
          },
        }
      : {}),
  };
}

// Linha crua do banco (escala_plano_versao_em) -> versão tipada
export function versaoDeLinhaBanco(r: Record<string, unknown>): VersaoPlanoOficial {
  return {
    id: String(r.id), previsaoId: String(r.previsao_id), validoDesdeMs: Date.parse(String(r.valido_desde)), origem: r.origem === "baseline" ? "baseline" : "trigger", hashPlano: String(r.hash_plano),
    dias: r.dias as VersaoPlanoOficial["dias"], linhas: r.linhas as LinhaPacote[], entrada: r.entrada as EntradaPrevisaoVersionada,
  };
}

"use client";

// Valores que o Sidebar precisa para o card "Meta semanal" (só aparece para
// quem tem a permissão Financeiro) — MESMA fórmula já usada em todas as
// rotas (ver AusenciasPage/PrevisaoSemanalPage); reunida aqui para telas
// novas não duplicarem o bloco inteiro.

import { useMemo } from "react";
import { useCadastrosBase } from "@/hooks/useCadastrosBase";
import { useFuncionarios } from "@/hooks/useFuncionarios";
import { usePrevisoes } from "@/hooks/usePrevisoes";
import { useCustos } from "@/hooks/useCustos";
import { calcularMetaFaturamento, calcularTotalCustoFuncionariosAtivos, calcularTotalFixoAtivo } from "@/features/custo-hora/calculations";
import { calcularResumoSemana, selecionarSemana } from "@/features/capacidade/selectors";
import { mondayOf, toISODate } from "@/lib/date";

export function useMetaSemanalShell(pronto: boolean) {
  const cadastros = useCadastrosBase(pronto);
  const funcionariosHook = useFuncionarios(pronto && !cadastros.loading);
  const previsoesHook = usePrevisoes(pronto && !cadastros.loading && !funcionariosHook.loading);
  const custosHook = useCustos(pronto && !cadastros.loading && !funcionariosHook.loading && !previsoesHook.loading);

  const ativos = useMemo(() => funcionariosHook.funcionarios.filter((f) => f.ativo), [funcionariosHook.funcionarios]);
  const totalFixo = useMemo(() => calcularTotalFixoAtivo(custosHook.fixedCosts), [custosHook.fixedCosts]);
  const totalFunc = useMemo(() => calcularTotalCustoFuncionariosAtivos(ativos), [ativos]);
  const semanaAtual = useMemo(() => toISODate(mondayOf(new Date())), []);
  const resumo = useMemo(() => calcularResumoSemana(selecionarSemana(previsoesHook.previsoes, semanaAtual)), [previsoesHook.previsoes, semanaAtual]);
  const { metaInvalida, faturamentoSemanalNecessario } = useMemo(() => calcularMetaFaturamento(totalFixo + totalFunc, 20), [totalFixo, totalFunc]);

  const usaPrevisto = resumo.valorPrevisto > 0;
  return {
    metaSemanalUsaPrevisto: usaPrevisto,
    metaInvalida,
    metaSemanalFinal: usaPrevisto ? resumo.valorPrevisto : faturamentoSemanalNecessario,
    loading: cadastros.loading || funcionariosHook.loading || previsoesHook.loading || custosHook.loading,
  };
}

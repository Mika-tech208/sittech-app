"use client";

// Liga o formulário da Previsão (tipos de domínio) ao componente de seleção por rota (tipos puros). Só é usado para produto com `estruturaRotas`; produto linear nunca passa por aqui.
import { useMemo } from "react";
import type { Maquina, PeriodoComDuracao, Previsao, Produto } from "@/types/domain";
import type { ItemSelecionado, MetasDaEtapa } from "./compartilhada";
import type { ContextoCusto } from "./custo";
import SelecaoRotasPrevisao, { type RealizavelDaEscala } from "./SelecaoRotasPrevisao";
import type { EtapaCadastro, PeriodoId } from "./tipos";

export interface SelecaoRotasContainerProps {
  produto: Produto; produtos: Produto[]; maquinas: Maquina[]; semana: Previsao; periodosComDuracao: PeriodoComDuracao[];
  diasProdutivos: number; quantidade: number; maquinasPorEtapa: Record<string, string[]>; onToggleMaquina: (etapaId: string, maquinaId: string) => void;
  editandoItemId?: string | null; custoHoraPorOperacao?: Record<string, number>; custoHoraEmpresa?: number; realizavel?: RealizavelDaEscala | null;
}

export default function SelecaoRotasContainer(p: SelecaoRotasContainerProps) {
  const estrutura = p.produto.estruturaRotas!;
  const ctx = useMemo(() => ({ periodos: p.periodosComDuracao.map((x) => ({ id: x.id as PeriodoId, minutos: Math.round(x.duracaoHoras * 60) })), diasProdutivos: p.diasProdutivos }), [p.periodosComDuracao, p.diasProdutivos]);
  const etapas = useMemo(() => new Map<string, EtapaCadastro>(p.produto.roteiro.map((e, i) => [e.id, { id: e.id, operacaoId: e.operacao, operacao: e.operacao, ordem: i, metas: e.metas as Record<PeriodoId, number>, maquinasIds: [...e.maquinasIds] }])), [p.produto.roteiro]);
  // demais itens da semana (o item em edição e outros itens do MESMO produto de rotas ficam de fora)
  const outros = useMemo<ItemSelecionado[]>(() => p.semana.itens.filter((i) => i.id !== p.editandoItemId && i.produtoId !== p.produto.id)
    .map((i) => ({ itemId: i.id, produtoNome: i.produtoNome, quantidade: i.quantidade, selecao: i.maquinasPorEtapa ?? {} })), [p.semana.itens, p.editandoItemId, p.produto.id]);
  const etapasDosOutros = useMemo(() => new Map<string, MetasDaEtapa>(p.produtos.flatMap((pr) => pr.roteiro.map((e) => [e.id, { operacaoId: e.operacao, metas: e.metas as Record<PeriodoId, number> }] as const))), [p.produtos]);
  const custo = useMemo<ContextoCusto | undefined>(() => (p.custoHoraPorOperacao ? { periodos: ctx.periodos, custoHoraPorOperacao: p.custoHoraPorOperacao, custoHoraPadrao: p.custoHoraEmpresa ?? 0 } : undefined), [p.custoHoraPorOperacao, p.custoHoraEmpresa, ctx.periodos]);
  const nome = (id: string) => p.maquinas.find((m) => m.id === id)?.nome.trim() ?? id.slice(0, 6);
  return (
    <SelecaoRotasPrevisao estrutura={estrutura} etapas={etapas} nomeMaquina={nome} maquinasIndisponiveis={p.semana.maquinasIndisponiveis ?? []} selecao={p.maquinasPorEtapa}
      onToggleMaquina={p.onToggleMaquina} demanda={p.quantidade} ctx={ctx} outros={outros} etapasDosOutros={etapasDosOutros} custo={custo} valorUnitario={p.produto.valorUnitario} realizavel={p.realizavel} />
  );
}

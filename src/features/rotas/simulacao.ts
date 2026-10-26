// Monta, EM MEMÓRIA, o estado que a Escala receberia para uma Previsão simulada (página /produtos/rotas): serve para exercitar planejador + adaptador + motor + feedback no DEV/Preview
// sem gravar nada e sem abrir a trava de suporte. Usa SOMENTE a seleção informada (nada marcado = nada usado).
import type { EstadoBruto, EtapaBruta, ItemPrevistoBruto } from "@/lib/escala/estado";
import { somarDias } from "@/features/escala-relatorio/conteudo";
import type { LinhasRotas } from "./dados";
import { estruturaDasLinhas } from "./dados";

export interface EntradaSimulacao {
  produtoId: string; nomeProduto: string; valorUnitario: number; linhas: LinhasRotas;
  todasEtapas: LinhasRotas["etapas"]; todasEtapaMaquinas: LinhasRotas["etapaMaquinas"];
  periodos: { id: string; inicio: string; fim: string }[]; semanaInicio: string; dias: number; demanda: number;
  selecao: Record<string, string[]>; maquinasIndisponiveis: string[];
  outros: { produtoId: string; nome: string; quantidade: number; valorUnitario: number; maquinasPorEtapa: Record<string, string[]> }[];
  pessoas: number; maquinaQueCai?: { maquinaId: string; desdeIso: string };   // indisponibilidade DINÂMICA (só a Escala enxerga): vira capacidade realizável menor que a nominal
  revezamentoDuro?: boolean;
  custoHoraPorOperacao?: Record<string, number>; custoHoraPadrao?: number; maxRodadas?: number;
}

export function estadoDeSimulacao(i: EntradaSimulacao): EstadoBruto {
  const opNome = Object.fromEntries(i.linhas.operacoes.map((o) => [o.id, o.nome]));
  const doProduto = (id: string): EtapaBruta[] => i.todasEtapas.filter((e) => e.produto_id === id).map((e) => ({
    id: e.id, produtoId: id, operacaoId: e.operacao_id, ordem: Number(e.ordem),
    metas: { m1: Number(e.meta_m1), m2: Number(e.meta_m2), m3: Number(e.meta_m3), t1: Number(e.meta_t1), t2: Number(e.meta_t2), t3: Number(e.meta_t3) },
    maquinasCompativeis: i.todasEtapaMaquinas.filter((x) => x.etapa_id === e.id).map((x) => x.maquina_id).sort(),
  }));
  const itens: ItemPrevistoBruto[] = [
    { produtoId: i.produtoId, quantidade: i.demanda, valorUnitario: i.valorUnitario, maquinasPorEtapa: i.selecao },
    ...i.outros.map((o) => ({ produtoId: o.produtoId, quantidade: o.quantidade, valorUnitario: o.valorUnitario, maquinasPorEtapa: o.maquinasPorEtapa })),
  ];
  const estrutura = estruturaDasLinhas({ ...i.linhas, produtoId: i.produtoId });
  return {
    previsaoId: "simulacao", semanaInicio: i.semanaInicio,
    diasProdutivos: Array.from({ length: Math.min(7, Math.max(1, i.dias)) }, (_, k) => somarDias(i.semanaInicio, k)),
    periodosAtuais: i.periodos.map((p) => ({ id: p.id, nome: p.id.toUpperCase(), inicio: p.inicio.slice(0, 5), fim: p.fim.slice(0, 5) })), diasExistentes: [],
    equipeProdutiva: Array.from({ length: i.pessoas }, (_, k) => ({ funcionarioId: `p${String(k + 1).padStart(2, "0")}`, ativo: true })),
    itens, etapas: [...doProduto(i.produtoId), ...i.outros.flatMap((o) => doProduto(o.produtoId))],
    maquinasIndisponiveisPrevisao: i.maquinasIndisponiveis, maquinasInativas: [], ausencias: [],
    indisponibilidades: i.maquinaQueCai ? [{ maquinaId: i.maquinaQueCai.maquinaId, desde: i.maquinaQueCai.desdeIso, liberadaEm: null }] : [], alocacoes: [],
    nomesOperacao: opNome, nomesProdutos: { [i.produtoId]: i.nomeProduto, ...Object.fromEntries(i.outros.map((o) => [o.produtoId, o.nome])) },
    parametros: { wipModo: "desligado", wipDiasLimite: 1, revezamentoModo: i.revezamentoDuro === false ? "mole" : "duro" } as EstadoBruto["parametros"],
    rotas: { estruturas: { [i.produtoId]: estrutura }, custoHoraPorOperacao: i.custoHoraPorOperacao, custoHoraPadrao: i.custoHoraPadrao, maxRodadas: i.maxRodadas },
  };
}

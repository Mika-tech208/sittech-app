// CUSTO do produto de rotas a partir do cadastro (tela Produtos e lucro/hora): custo exclusivo de cada rota + custo comum (Etiquetar, Embalar) UMA vez; custo final via CONV e via AUTO — nunca a soma das duas rotas.
// O custo/hora vem dos dados atuais (mesmo `custoHoraPorOperacao`/`custoHoraEmpresa` de sempre); nenhum valor fixo no código. Para um número único (lucro/hora, margem) usa-se a rota de MAIOR custo final
// (referência conservadora: é o custo de fabricar quando só a convencional está disponível).
import type { PeriodoComDuracao, Produto } from "@/types/domain";
import { custoComum, custoExclusivoRota, custoPorRota, type ContextoCusto, type CustoRota } from "./custo";
import { tempoPorPeca } from "./capacidade";
import type { EtapaCadastro, PeriodoId } from "./tipos";

export interface CustoProdutoRotas {
  porRota: CustoRota[]; comum: number; exclusivoPorRota: Record<string, number>;
  referencia: CustoRota;              // rota de maior custo final
  tempoPorPecaReferencia: number;     // horas por peça do percurso da rota de referência
}

export function custoDoProdutoDeRotas(produto: Pick<Produto, "roteiro" | "estruturaRotas" | "valorUnitario">, custoHoraPorOperacao: Record<string, number>, custoHoraEmpresa: number, periodosComDuracao: PeriodoComDuracao[]): CustoProdutoRotas | null {
  const estrutura = produto.estruturaRotas;
  if (!estrutura) return null;
  const periodos = periodosComDuracao.map((p) => ({ id: p.id as PeriodoId, minutos: Math.round(p.duracaoHoras * 60) }));
  const etapas = new Map<string, EtapaCadastro>(produto.roteiro.map((e, i) => [e.id, { id: e.id, operacaoId: e.operacao, operacao: e.operacao, ordem: i, metas: e.metas as Record<PeriodoId, number>, maquinasIds: e.maquinasIds }]));
  const ctx: ContextoCusto = { periodos, custoHoraPorOperacao, custoHoraPadrao: custoHoraEmpresa };
  const porRota = custoPorRota(estrutura, etapas, ctx, produto.valorUnitario);
  const referencia = porRota.reduce((m, c) => (c.final > m.final ? c : m), porRota[0]);
  const rota = estrutura.rotas.find((r) => r.codigo === referencia.rotaCodigo);
  const idsPercurso = [...(rota?.etapas ?? []), ...(estrutura.poolComum?.etapas ?? [])];
  return {
    porRota, comum: custoComum(estrutura, etapas, ctx), exclusivoPorRota: Object.fromEntries(estrutura.rotas.map((r) => [r.codigo, custoExclusivoRota(estrutura, r.codigo, etapas, ctx)])), referencia,
    tempoPorPecaReferencia: idsPercurso.reduce((s, id) => s + tempoPorPeca(etapas.get(id) as EtapaCadastro, { periodos }), 0),
  };
}

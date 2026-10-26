// ADAPTADOR DAS TRÊS CADEIAS (M3): projeta o produto de rotas em cadeias LINEARES VIRTUAIS para alimentar o motor atual da Escala (que só conhece cadeia linear por `ordemEtapa`):
//   F#<ROTA> (uma por rota ativa): só o trecho exclusivo (CONV: Rosquear → Parafusar; AUTO: Rosquear + Parafusar), quantidade = alvo da rota
//   F#COMUM  (UMA só):            Etiquetar → Embalar, quantidade = produto final planejado (NUNCA duplicada por rota)
// As cadeias NÃO são produtos, itens de Previsão, demandas comerciais nem produtos acabados: existem só dentro do cálculo. Tudo que sai (alocações, alertas, peças restantes)
// é DEVOLVIDO ao produto real F antes de ser gravado ou exibido. `etapaId` e `operacaoId` são sempre os REAIS (o revezamento duro "mesma operacao_id não consecutiva" continua valendo,
// porque as cadeias virtuais carregam a operação verdadeira de cada etapa). Produtos lineares não passam por aqui (a função devolve o MESMO estado).
import type { EstadoBruto, EtapaBruta, ItemPrevistoBruto } from "@/lib/escala/estado";
import type { AlertaEscala, AlocacaoEscala, ResultadoEscala } from "@/features/escala/types";
import type { EstruturaProduto } from "./tipos";

export const SEPARADOR_VIRTUAL = "#";
export const CADEIA_COMUM = "COMUM";
export const idVirtual = (produtoId: string, cadeia: string) => `${produtoId}${SEPARADOR_VIRTUAL}${cadeia}`;
export const ehVirtual = (produtoId: string | null | undefined) => !!produtoId && produtoId.includes(SEPARADOR_VIRTUAL);
export const produtoRealDe = (produtoId: string) => (ehVirtual(produtoId) ? produtoId.slice(0, produtoId.indexOf(SEPARADOR_VIRTUAL)) : produtoId);
export const cadeiaDe = (produtoId: string) => (ehVirtual(produtoId) ? produtoId.slice(produtoId.indexOf(SEPARADOR_VIRTUAL) + 1) : null);

export interface CadeiaVirtual { cadeia: string; etapas: string[] }
// cadeias de um produto de rotas: uma por rota ativa (só trecho exclusivo) + UMA comum
export function cadeiasDe(estrutura: EstruturaProduto): CadeiaVirtual[] {
  const rotas = estrutura.rotas.filter((r) => r.ativa).map((r) => ({ cadeia: r.codigo, etapas: [...r.etapas] }));
  return estrutura.poolComum ? [...rotas, { cadeia: CADEIA_COMUM, etapas: [...estrutura.poolComum.etapas] }] : rotas;
}

export interface PlanoDoProduto {
  alvo: Record<string, number>;   // entrega de cada rota ao pool comum
  final: number;                   // produto final planejado (= quantidade da cadeia comum)
}

// estado do motor com os produtos de rotas projetados em cadeias virtuais; sem produto de rotas devolve o MESMO objeto (linear intacto)
export function projetarEstado(estado: EstadoBruto, planos: Record<string, PlanoDoProduto>): EstadoBruto {
  const estruturas = estado.rotas?.estruturas;
  if (!estruturas || Object.keys(estruturas).length === 0) return estado;
  const produtosDeRotas = Object.keys(estruturas).filter((id) => estado.itens.some((i) => i.produtoId === id));
  if (produtosDeRotas.length === 0) return estado;

  const virtualDaEtapa = new Map<string, { produto: string; cadeia: string; indice: number }>();
  const itens: ItemPrevistoBruto[] = estado.itens.filter((i) => !produtosDeRotas.includes(i.produtoId));
  const etapas: EtapaBruta[] = estado.etapas.filter((e) => !produtosDeRotas.includes(e.produtoId));
  const nomesProdutos = { ...(estado.nomesProdutos ?? {}) };

  produtosDeRotas.forEach((pid) => {
    const estr = estruturas[pid];
    const plano = planos[pid] ?? { alvo: {}, final: 0 };
    const doProduto = estado.itens.filter((i) => i.produtoId === pid);
    const selecao: Record<string, string[]> = {};
    doProduto.forEach((i) => Object.entries(i.maquinasPorEtapa).forEach(([e, ms]) => { selecao[e] = [...new Set([...(selecao[e] ?? []), ...ms])].sort(); }));
    const valorUnitario = Math.max(...doProduto.map((i) => i.valorUnitario));
    const etapasDoProduto = new Map(estado.etapas.filter((e) => e.produtoId === pid).map((e) => [e.id, e]));
    cadeiasDe(estr).forEach((c) => {
      const quantidade = c.cadeia === CADEIA_COMUM ? plano.final : plano.alvo[c.cadeia] ?? 0;
      c.etapas.forEach((id, indice) => virtualDaEtapa.set(`${pid}|${id}`, { produto: idVirtual(pid, c.cadeia), cadeia: c.cadeia, indice }));
      if (quantidade <= 1e-9) return;                                     // cadeia sem entrega planejada: nem entra no motor
      const maquinasPorEtapa: Record<string, string[]> = {};
      c.etapas.forEach((id) => { if ((selecao[id] ?? []).length > 0) maquinasPorEtapa[id] = selecao[id]; });
      itens.push({ produtoId: idVirtual(pid, c.cadeia), quantidade, valorUnitario, maquinasPorEtapa });   // sem adicional: o adicional/WIP de F fica para o M4
      c.etapas.forEach((id, indice) => { const e = etapasDoProduto.get(id); if (e) etapas.push({ ...e, produtoId: idVirtual(pid, c.cadeia), ordem: indice }); });
      nomesProdutos[idVirtual(pid, c.cadeia)] = `${estado.nomesProdutos?.[pid] ?? pid} (cadeia interna ${c.cadeia})`;
    });
  });

  const alocacoes = estado.alocacoes.map((a) => {
    const v = a.produtoId && a.etapaId ? virtualDaEtapa.get(`${a.produtoId}|${a.etapaId}`) : undefined;
    return v ? { ...a, produtoId: v.produto } : a;
  });
  return { ...estado, itens, etapas, alocacoes, nomesProdutos };
}

// devolve ao produto real tudo o que o motor produziu em cadeias virtuais (a interface e o banco só conhecem F)
export const reverterAlocacao = <T extends { produtoId: string | null }>(a: T): T => (ehVirtual(a.produtoId) ? { ...a, produtoId: produtoRealDe(a.produtoId as string) } : a);
export function reverterAlocacoes(alocacoes: AlocacaoEscala[]): AlocacaoEscala[] { return alocacoes.map(reverterAlocacao); }
const reverterChave = (k: string) => { const [p, e] = k.split("|"); return ehVirtual(p) ? `${produtoRealDe(p)}|${e}` : k; };
export function reverterResultado(r: ResultadoEscala): ResultadoEscala {
  const rec = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [reverterChave(k), v]));
  const alertas: AlertaEscala[] = r.alertas.map((a) => (ehVirtual(a.produtoId) ? { ...a, produtoId: produtoRealDe(a.produtoId as string) } : a));
  return { ...r, alocacoes: reverterAlocacoes(r.alocacoes), alertas, pecasRestantes: rec(r.pecasRestantes), adicionalProduzido: rec(r.adicionalProduzido) };
}

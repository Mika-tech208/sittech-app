// Carga adicional POR ETAPA (acabado + estoque intermediário) na Previsão — funções PURAS (a tela só mostra).
// Regras espelhadas do servidor (upsert_previsao_semana): valores ≥ 0 e a etapa seguinte nunca acima da anterior
// (nada se processa sem ter sido produzido). O adicional de produto ACABADO é o da última etapa.

import type { SugestaoWip } from "@/features/escala/sugestaoWip";

export interface EtapaRef {
  id: string;
  nome: string;
}
export type ValoresEtapas = Record<string, string>; // etapaId -> texto digitado
export type RascunhoEtapas = Record<string, ValoresEtapas>; // itemId -> valores

interface ItemComAdicional {
  id: string;
  produtoId: string;
  quantidadeAdicional?: number;
  adicionalPorEtapa?: Record<string, number>;
}

export function numeroEtapa(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Valores gravados do item. Sem linhas por etapa, o adicional do item vale igual para todas as etapas
// (é a leitura que o motor faz — nada muda para quem só tem o adicional de produto acabado).
export function valoresSalvosDoItem(item: ItemComAdicional, etapas: EtapaRef[]): ValoresEtapas {
  const v: ValoresEtapas = {};
  etapas.forEach((e) => {
    const n = item.adicionalPorEtapa ? item.adicionalPorEtapa[e.id] ?? 0 : item.quantidadeAdicional ?? 0;
    v[e.id] = String(n);
  });
  return v;
}

export function rascunhoSalvo(itens: ItemComAdicional[], etapasDe: (produtoId: string) => EtapaRef[]): RascunhoEtapas {
  return Object.fromEntries(itens.map((i) => [i.id, valoresSalvosDoItem(i, etapasDe(i.produtoId))]));
}

// Erros por etapa (vazio = válido).
export function errosDeEtapas(etapas: EtapaRef[], valores: ValoresEtapas): Record<string, string> {
  const erros: Record<string, string> = {};
  let anterior: number | null = null;
  etapas.forEach((e) => {
    const bruto = valores[e.id];
    const texto = String(bruto ?? "").trim();
    const n = texto === "" ? 0 : Number(texto.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      erros[e.id] = "Informe um número maior ou igual a zero.";
      anterior = null;
      return;
    }
    if (anterior !== null && n > anterior + 1e-9) erros[e.id] = `Não pode passar do que a etapa anterior produz (${anterior.toLocaleString("pt-BR")}).`;
    anterior = n;
  });
  return erros;
}

export function numerosDeEtapas(etapas: EtapaRef[], valores: ValoresEtapas): Record<string, number> {
  return Object.fromEntries(etapas.map((e) => [e.id, numeroEtapa(valores[e.id])]));
}

// Peças que ficam aguardando a etapa seguinte (A_k − A_{k+1}); na última etapa não há estoque.
export function estoqueEntreEtapas(etapas: EtapaRef[], valores: ValoresEtapas): { deEtapaId: string; paraEtapaId: string; pecas: number }[] {
  const saida: { deEtapaId: string; paraEtapaId: string; pecas: number }[] = [];
  for (let k = 0; k + 1 < etapas.length; k++) {
    const pecas = numeroEtapa(valores[etapas[k].id]) - numeroEtapa(valores[etapas[k + 1].id]);
    if (pecas > 1e-9) saida.push({ deEtapaId: etapas[k].id, paraEtapaId: etapas[k + 1].id, pecas });
  }
  return saida;
}

export function acabadoDe(etapas: EtapaRef[], valores: ValoresEtapas): number {
  return etapas.length === 0 ? 0 : numeroEtapa(valores[etapas[etapas.length - 1].id]);
}

export function temErro(itens: ItemComAdicional[], etapasDe: (produtoId: string) => EtapaRef[], rascunho: RascunhoEtapas): boolean {
  return itens.some((i) => Object.keys(errosDeEtapas(etapasDe(i.produtoId), rascunho[i.id] ?? {})).length > 0);
}

export function alterado(itens: ItemComAdicional[], etapasDe: (produtoId: string) => EtapaRef[], rascunho: RascunhoEtapas): boolean {
  return itens.some((i) => {
    const salvo = valoresSalvosDoItem(i, etapasDe(i.produtoId));
    return etapasDe(i.produtoId).some((e) => numeroEtapa(rascunho[i.id]?.[e.id]) !== numeroEtapa(salvo[e.id]));
  });
}

// Zera tudo e preenche com a sugestão (um produto previsto em mais de um item: o 1º item recebe, como na sugestão antiga).
export function preencherComSugestao(
  itens: ItemComAdicional[],
  etapasDe: (produtoId: string) => EtapaRef[],
  sugestao: Pick<SugestaoWip, "itens">
): RascunhoEtapas {
  const novo: RascunhoEtapas = {};
  const primeiroPorProduto = new Map<string, string>();
  itens.forEach((i) => {
    if (!primeiroPorProduto.has(i.produtoId)) primeiroPorProduto.set(i.produtoId, i.id);
    novo[i.id] = Object.fromEntries(etapasDe(i.produtoId).map((e) => [e.id, "0"]));
  });
  sugestao.itens.forEach((s) => {
    const itemId = primeiroPorProduto.get(s.produtoId);
    if (itemId && novo[itemId] && s.etapaId in novo[itemId]) novo[itemId][s.etapaId] = String(s.quantidade);
  });
  return novo;
}

// Payload para a RPC/rota: etapa -> peças (todas as etapas do produto, inclusive zeros)
export function payloadEtapas(itens: ItemComAdicional[], etapasDe: (produtoId: string) => EtapaRef[], rascunho: RascunhoEtapas): Record<string, Record<string, number>> {
  return Object.fromEntries(itens.map((i) => [i.id, numerosDeEtapas(etapasDe(i.produtoId), rascunho[i.id] ?? {})]));
}

export interface LinhaSugestaoWip {
  chave: string;
  produtoId: string;
  produto: string;
  etapa: string;
  maquinas: string[];
  quantidade: number;
  tipo: "acabado" | "intermediario";
  destino: string; // "Produto acabado" | "Estoque intermediário (aguardando <próxima etapa>)"
  estoquePecas: number;
}

export function linhasSugestaoWip(
  sugestao: Pick<SugestaoWip, "itens">,
  nomeProduto: (id: string) => string,
  nomeEtapa: (id: string) => string,
  nomeMaquina: (id: string) => string
): LinhaSugestaoWip[] {
  return sugestao.itens.map((s) => ({
    chave: `${s.produtoId}|${s.etapaId}`,
    produtoId: s.produtoId,
    produto: nomeProduto(s.produtoId),
    etapa: nomeEtapa(s.etapaId),
    maquinas: s.maquinas.map(nomeMaquina),
    quantidade: s.quantidade,
    tipo: s.tipo,
    destino:
      s.tipo === "acabado"
        ? "Produto acabado"
        : s.estoquePecas > 0
          ? `Estoque intermediário (aguardando ${s.proximaEtapaId ? nomeEtapa(s.proximaEtapaId) : "a próxima etapa"})`
          : `Etapa intermediária (alimenta ${s.proximaEtapaId ? nomeEtapa(s.proximaEtapaId) : "a próxima etapa"}, sem estoque parado)`,
    estoquePecas: s.estoquePecas,
  }));
}

const fmt = (v: number, casas = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export interface ResumoConfirmacaoWip {
  titulo: string;
  linhas: string[];
  produtos: { produtoId: string; nome: string; acabado: number; estoque: number }[];
}

export function resumirConfirmacaoWip(sugestao: SugestaoWip, nomeProduto: (id: string) => string): ResumoConfirmacaoWip {
  const horas = (min: number) => fmt(min, 1);
  return {
    titulo: "Aplicar carga adicional sugerida?",
    linhas: [
      `+${fmt(sugestao.acabadoTotal)} peças de produto acabado e ${fmt(sugestao.estoqueTotal)} peças de estoque intermediário`,
      `Cobertura: ${fmt(sugestao.antes.percentual, 1)}% → ${fmt(sugestao.depois.percentual, 1)}%`,
      sugestao.depois.pessoasPeriodoSemPosto > 0
        ? `Ainda restarão ${fmt(sugestao.depois.pessoasPeriodoSemPosto)} pessoas-período sem posto (${horas(sugestao.depois.horasSemPosto)} horas-pessoa).`
        : "Nenhuma pessoa ficará sem posto.",
    ],
    produtos: sugestao.porProduto.map((p) => ({ produtoId: p.produtoId, nome: nomeProduto(p.produtoId), acabado: p.acabado, estoque: p.estoqueTotal })),
  };
}

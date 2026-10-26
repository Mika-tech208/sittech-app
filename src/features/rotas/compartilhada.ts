// MÁQUINA COMPARTILHADA entre itens da Previsão (estimativa da PRÉVIA; a verdade operacional é a Escala, período a período).
// Quem PODE usar a máquina foi decidido por uma pessoa na Previsão (previsao_item_maquinas). Aqui só se divide a capacidade real da máquina entre as demandas já autorizadas.
// INVARIANTE: a soma do que se concede por máquina nunca passa das horas da própria máquina (cada hora/período só pode ser consumido uma vez).
// Regra de repartição = a MESMA que o motor da Escala aplica (gargalo dinâmico / menor folga): quem está mais atrasado passa na frente até as FALTAS (em horas de máquina) se igualarem;
// a falta comum `s` é tal que Σ max(0, pedido_i − s) = horas da máquina. Ex.: 6 períodos, Caixa pede 2 e Conector 6 ⇒ s = 1 ⇒ Caixa 1 + Conector 5; Caixa 2 + Conector 8 ⇒ s = 2 ⇒ 0 + 6.
// Quando todos cabem (Σ pedidos ≤ horas) cada um recebe o que pediu (ex.: 2 + 4). Lucro/hora NÃO entra na conta: no motor só desempata quando as folgas são exatamente iguais.
// A prévia é uma ESTIMATIVA: o motor, período a período, é quem confirma (e o feedback corrige a diferença).
import { horasMaquinaSemana, tempoPorPeca } from "./capacidade";
import { planejarRotas, type EntradaPlanejador, type SaidaPlanejador } from "./planejador";
import type { ContextoCapacidade, EstruturaProduto, EtapaCadastro, PeriodoId } from "./tipos";

const EPS = 1e-9;

export interface Reivindicacao { itemId: string; horas: number }
export interface ItemSelecionado { itemId: string; produtoNome?: string; quantidade: number; selecao: Record<string, string[]> }
export interface MetasDaEtapa { operacaoId: string; metas: Record<PeriodoId, number> }

export function repartirMaquina(horasMaquina: number, pedidos: Reivindicacao[]): Map<string, number> {
  const concedido = new Map<string, number>(pedidos.map((p) => [p.itemId, 0]));
  const ativos = pedidos.filter((p) => p.horas > EPS).sort((a, b) => b.horas - a.horas || (a.itemId < b.itemId ? -1 : 1));
  const H = Math.max(0, horasMaquina);
  const total = ativos.reduce((s, p) => s + p.horas, 0);
  if (total <= H + EPS) { ativos.forEach((p) => concedido.set(p.itemId, p.horas)); return concedido; }
  let soma = 0;
  for (let k = 1; k <= ativos.length; k++) {
    soma += ativos[k - 1].horas;
    const s = (soma - H) / k;                                              // falta comum se só os k maiores disputarem
    const proximo = k < ativos.length ? ativos[k].horas : 0;
    if (s >= proximo - EPS) { ativos.slice(0, k).forEach((p) => concedido.set(p.itemId, Math.max(0, p.horas - Math.max(0, s)))); break; }
  }
  return concedido;
}

// Distribui as peças de UMA etapa entre as máquinas marcadas: primeiro as máquinas SEM concorrência (até a capacidade de cada uma), e só o que sobra vai para as compartilhadas (igualmente).
// É o mesmo princípio do motor (só usa a máquina disputada onde ela reduz a falta) e evita superestimar o pedido sobre a máquina compartilhada.
export function distribuirPedido(pecas: number, maquinas: string[], horasPorPeca: number, horasMaquina: number, disputadas: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (pecas <= EPS || maquinas.length === 0 || horasPorPeca <= 0) return out;
  const livres = maquinas.filter((m) => !disputadas.has(m)), comp = maquinas.filter((m) => disputadas.has(m));
  const capLivre = horasMaquina; let resto = pecas * horasPorPeca;                       // em HORAS de máquina
  if (livres.length > 0) {
    const aLivres = Math.min(resto, livres.length * capLivre);
    livres.forEach((m) => { out[m] = aLivres / livres.length; });
    resto -= aLivres;
  }
  if (resto > EPS && comp.length > 0) comp.forEach((m) => { out[m] = (out[m] ?? 0) + resto / comp.length; });
  else if (resto > EPS && livres.length > 0) livres.forEach((m) => { out[m] += resto / livres.length; });
  return out;
}

// horas que cada item QUER de cada máquina: peças × tempo/peça da etapa, divididas igualmente entre as máquinas marcadas (mesma convenção da Previsão atual)
export function reivindicacoesPorMaquina(itens: ItemSelecionado[], etapas: Map<string, MetasDaEtapa>, ctx: Pick<ContextoCapacidade, "periodos">, disputadas: Set<string> = new Set(), horasMaquina = Infinity): Record<string, Reivindicacao[]> {
  const out: Record<string, Reivindicacao[]> = {};
  itens.forEach((it) => Object.entries(it.selecao).forEach(([etapaId, maquinas]) => {
    const e = etapas.get(etapaId);
    if (!e || maquinas.length === 0) return;
    const t = tempoPorPeca({ metas: e.metas }, ctx);
    const dist = distribuirPedido(it.quantidade, maquinas, t, horasMaquina, disputadas);
    Object.entries(dist).forEach(([m, horas]) => (out[m] ??= []).push({ itemId: it.itemId, horas }));
  }));
  return out;
}

export interface DetalheMaquina {
  maquinaId: string; horasTotais: number;
  porItem: { itemId: string; produtoNome?: string; reivindicado: number; concedido: number }[];
  reivindicadoPorOutros: number; concedidoAoItem: number; restanteEstimado: number;
}
export interface PreviaRotas {
  plano: SaidaPlanejador;
  compartilhadas: DetalheMaquina[];                // só máquinas marcadas por mais de um item
  horasComprometidasParaOItem: Record<string, number>;
  estimativa: true;                                // NÃO é garantia: a Escala (pessoas, revezamento, períodos) confirma
}

export interface EntradaPrevia extends Omit<EntradaPlanejador, "ctx"> {
  itemId: string;
  ctx: ContextoCapacidade;                         // sem horasComprometidasPorMaquina: elas são calculadas aqui
  outros: ItemSelecionado[];                       // demais itens da Previsão da semana (lineares ou outros de rotas)
  etapasDosOutros: Map<string, MetasDaEtapa>;
  nomeDaMaquina?: (id: string) => string;
}

// Prévia da Previsão: (1) planeja o item F sem concorrência para saber o que ele PEDE de cada máquina; (2) reparte cada máquina compartilhada entre os pedidos; (3) planeja de novo só com o que coube.
export function previaComCompartilhamento(e: EntradaPrevia): PreviaRotas {
  const H = horasMaquinaSemana(e.ctx);
  // máquinas DISPUTADAS = marcadas por F e por ao menos um outro item (a Previsão autorizou ambos)
  const marcadasF = new Set(Object.values(e.selecao).flat());
  const disputadas = new Set<string>();
  e.outros.forEach((o) => Object.values(o.selecao).flat().forEach((m) => { if (marcadasF.has(m)) disputadas.add(m); }));
  const sozinho = planejarRotas({ ...e, ctx: { ...e.ctx, horasComprometidasPorMaquina: undefined } }) as SaidaPlanejador | { aplicavel: false };
  if (!("capacidadePorRota" in sozinho)) throw new Error("previaComCompartilhamento: produto sem rotas");
  const est = e.estrutura as EstruturaProduto;
  // pedido de F por máquina = o que F pretende produzir naquela etapa (exclusiva: entrega da rota; comum: produto final) × tempo/peça ÷ nº de máquinas marcadas da etapa
  const pedidoF: Record<string, number> = {};
  const registrar = (etapaId: string, pecas: number) => {
    const maquinas = (e.selecao[etapaId] ?? []).filter((m) => !(e.ctx.maquinasIndisponiveis ?? []).includes(m)); const et = e.etapas.get(etapaId) as EtapaCadastro;
    Object.entries(distribuirPedido(pecas, maquinas, tempoPorPeca(et, e.ctx), H, disputadas)).forEach(([m, horas]) => { pedidoF[m] = (pedidoF[m] ?? 0) + horas; });
  };
  est.rotas.forEach((r) => r.etapas.forEach((id) => registrar(id, sozinho.alvo[r.codigo] ?? 0)));
  (est.poolComum?.etapas ?? []).forEach((id) => registrar(id, sozinho.finalAtingivel));

  const outros = reivindicacoesPorMaquina(e.outros, e.etapasDosOutros, e.ctx, disputadas, H);
  const maquinas = [...new Set([...Object.keys(pedidoF), ...Object.keys(outros)])].sort();
  const comprometidas: Record<string, number> = {};
  const compartilhadas: DetalheMaquina[] = [];
  const nomeDe = new Map(e.outros.map((o) => [o.itemId, o.produtoNome]));
  maquinas.forEach((m) => {
    const pedidos: Reivindicacao[] = [...(outros[m] ?? []), ...(pedidoF[m] !== undefined ? [{ itemId: e.itemId, horas: pedidoF[m] }] : [])];
    // um mesmo item pode aparecer duas vezes na mesma máquina (duas etapas): soma
    const agrupado = [...pedidos.reduce((mp, p) => mp.set(p.itemId, (mp.get(p.itemId) ?? 0) + p.horas), new Map<string, number>())].map(([itemId, horas]) => ({ itemId, horas }));
    const conc = repartirMaquina(H, agrupado);
    if (!marcadasF.has(m)) return;
    // capacidade de F na máquina = o que NÃO ficou com os outros itens (se F não está espremido, é a máquina menos o que os outros pedem — não só o que F pediu agora)
    const comOutros = agrupado.filter((p) => p.itemId !== e.itemId).reduce((s, p) => s + (conc.get(p.itemId) ?? 0), 0);
    comprometidas[m] = Math.min(H, comOutros);
    if (agrupado.some((p) => p.itemId !== e.itemId)) {
      const somaOutros = agrupado.filter((p) => p.itemId !== e.itemId).reduce((s, p) => s + p.horas, 0);
      compartilhadas.push({
        maquinaId: m, horasTotais: H,
        porItem: agrupado.map((p) => ({ itemId: p.itemId, produtoNome: p.itemId === e.itemId ? undefined : nomeDe.get(p.itemId), reivindicado: p.horas, concedido: conc.get(p.itemId) ?? 0 })),
        reivindicadoPorOutros: somaOutros, concedidoAoItem: Math.max(0, H - comOutros), restanteEstimado: Math.max(0, H - comOutros),
      });
    }
  });
  const plano = planejarRotas({ ...e, ctx: { ...e.ctx, horasComprometidasPorMaquina: comprometidas } }) as SaidaPlanejador;
  return { plano, compartilhadas, horasComprometidasParaOItem: comprometidas, estimativa: true };
}

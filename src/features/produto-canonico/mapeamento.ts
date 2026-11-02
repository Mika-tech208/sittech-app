// Resolução legado -> canônico (PURO, IDEMPOTENTE, SEM MUTAÇÃO DAS ENTRADAS). Espelha as funções SQL produto_canonico_de/etapa_canonica_de e as views vw_*_canonicos.
// Regras: (1) nada é reescrito no banco — a tradução acontece na LEITURA; (2) aplicar duas vezes = aplicar uma; (3) o que não pertence ao canônico passa intacto (mesma referência);
// (4) peças, pessoas e máquinas de uma linha nunca mudam, só o produto/etapa em que elas são contadas; (5) produto final = só a etapa FINAL.
import type { AlocacaoEscala, DistribuicaoQuantidade } from "@/features/escala/types";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import type { ModeloCanonico, PapelEtapa, ResolucaoEtapa, ResolucaoProduto } from "./tipos";

const EPS = 1e-6;

export interface DiagnosticoCanonico {
  codigo: "CONTAGEM_COMUM_DUPLICADA" | "PRECO_MEDIO_PONDERADO" | "MODELO_INVALIDO" | "ITEM_SEM_MAPA";
  mensagem: string;
  detalhes?: Record<string, unknown>;
}

export function resolverProduto(modelo: ModeloCanonico, produtoId: string): ResolucaoProduto {
  const l = modelo.produtosLegado[produtoId];
  if (l) return { produtoId: l.produtoCanonicoId, entrada: "legado", rotaId: l.rotaId };
  if (produtoId === modelo.produtoCanonicoId) return { produtoId, entrada: "canonico", rotaId: null };
  return { produtoId, entrada: "fora", rotaId: null };
}

export function resolverEtapa(modelo: ModeloCanonico, etapaId: string): ResolucaoEtapa {
  const l = modelo.etapasLegado[etapaId];
  if (l) {
    const ce = modelo.etapas.find((e) => e.etapaId === l.etapaCanonicaId);
    const rotaLegado = modelo.produtosLegado[l.produtoLegadoId]?.rotaId ?? null;
    return { etapaId: l.etapaCanonicaId, produtoId: modelo.produtoCanonicoId, entrada: "legado", papel: ce?.papel ?? null, rotaId: ce?.rotaId ?? rotaLegado };
  }
  const ce = modelo.etapas.find((e) => e.etapaId === etapaId);
  if (ce) return { etapaId, produtoId: modelo.produtoCanonicoId, entrada: "canonico", papel: ce.papel, rotaId: ce.rotaId };
  return { etapaId, produtoId: null, entrada: "fora", papel: null, rotaId: null };
}

const papelDe = (modelo: ModeloCanonico, etapaId: string): PapelEtapa | null => resolverEtapa(modelo, etapaId).papel;

// ---------------------------------------------------------------------------------------------------------------------------------
// Alocações (Escala): linha com posto => (produto canônico, etapa canônica), distribuição legado fundida em UMA fatia canônica.
// ---------------------------------------------------------------------------------------------------------------------------------
function itensDaLinha(a: AlocacaoEscala): DistribuicaoQuantidade[] | null {
  if (a.distribuicao && a.distribuicao.length > 0) return a.distribuicao;
  if (a.produtoId && a.etapaId) return [{ produtoId: a.produtoId, etapaId: a.etapaId, pecas: a.pecas }];
  return null;
}

/** Visão canônica de UMA linha. Linha fora do canônico, sem posto ou já canônica sem distribuição => a MESMA referência. */
export function canonizarAlocacao(a: AlocacaoEscala, modelo: ModeloCanonico): AlocacaoEscala {
  if (!a.maquinaId) return a;
  const itens = itensDaLinha(a);
  if (!itens) return a;
  const mapeados = itens.map((x) => {
    const e = resolverEtapa(modelo, x.etapaId);
    return e.entrada === "fora" ? x : { produtoId: e.produtoId as string, etapaId: e.etapaId, pecas: x.pecas };
  });
  const mudou = mapeados.some((m, i) => m.etapaId !== itens[i].etapaId || m.produtoId !== itens[i].produtoId);
  const fundir = new Map<string, DistribuicaoQuantidade>();
  mapeados.forEach((m) => {
    const k = `${m.produtoId}|${m.etapaId}`;
    const atual = fundir.get(k);
    fundir.set(k, atual ? { ...atual, pecas: atual.pecas + m.pecas } : { ...m });
  });
  const grupos = [...fundir.values()];
  const tinhaDistribuicao = !!a.distribuicao && a.distribuicao.length > 0;
  if (!mudou && grupos.length === itens.length) return a; // nada a traduzir nem a fundir
  const { distribuicao: _d, ...resto } = a;
  void _d;
  const dom = grupos.reduce((x, y) => (y.pecas > x.pecas + EPS ? y : x));
  const base: AlocacaoEscala = { ...resto, produtoId: dom.produtoId, etapaId: dom.etapaId };
  if (grupos.length === 1) {
    // peças da linha preservadas; sem distribuição (um só produto/etapa canônico)
    return { ...base, pecas: a.pecas };
  }
  // linha continua compartilhada com OUTRO produto (fora do canônico): mantém distribuição já traduzida
  void tinhaDistribuicao;
  return { ...base, pecas: a.pecas, distribuicao: grupos };
}

export function canonizarAlocacoes(linhas: AlocacaoEscala[], modelo: ModeloCanonico): AlocacaoEscala[] {
  let mudou = false;
  const out = linhas.map((l) => {
    const c = canonizarAlocacao(l, modelo);
    if (c !== l) mudou = true;
    return c;
  });
  return mudou ? out : linhas;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Demanda única (Previsão): itens legados do mesmo canônico viram UM item; máquinas selecionadas por etapa canônica (união).
// ---------------------------------------------------------------------------------------------------------------------------------
export interface ItemPrevisaoEntrada {
  produtoId: string;
  quantidade: number;
  quantidadeAdicional?: number;
  valorUnitario: number;
  /** etapaId -> máquinas selecionadas na Previsão (ABSOLUTAS: o motor nunca acrescenta) */
  maquinasPorEtapa: Record<string, string[]>;
}
export interface ItemUnificado extends ItemPrevisaoEntrada {
  /** composição histórica da demanda (somente informativa; o motor não a usa para dividir rotas) */
  origem: { produtoLegadoId: string; quantidade: number }[];
}

export function demandaUnica(
  itens: ItemPrevisaoEntrada[],
  modelo: ModeloCanonico,
  opcoes: { valorUnitarioCanonico?: number } = {},
): { itens: (ItemPrevisaoEntrada | ItemUnificado)[]; diagnosticos: DiagnosticoCanonico[] } {
  const diagnosticos: DiagnosticoCanonico[] = [];
  const grupo: ItemPrevisaoEntrada[] = [];
  const marcador = new Set<number>();
  itens.forEach((it, i) => {
    if (resolverProduto(modelo, it.produtoId).entrada === "fora") return;
    grupo.push(it);
    marcador.add(i);
  });
  if (grupo.length === 0) return { itens, diagnosticos };
  const primeiro = Math.min(...marcador);

  const maquinas: Record<string, string[]> = {};
  grupo.forEach((it) => {
    Object.entries(it.maquinasPorEtapa).forEach(([etapaId, ms]) => {
      const e = resolverEtapa(modelo, etapaId);
      const alvo = e.entrada === "fora" ? etapaId : e.etapaId;
      maquinas[alvo] = [...new Set([...(maquinas[alvo] ?? []), ...ms])].sort();
    });
  });
  const quantidade = grupo.reduce((s, x) => s + x.quantidade, 0);
  const adicional = grupo.reduce((s, x) => s + (x.quantidadeAdicional ?? 0), 0);
  let valor = opcoes.valorUnitarioCanonico;
  if (valor === undefined) {
    const distintos = new Set(grupo.map((x) => x.valorUnitario));
    valor = quantidade > 0 ? grupo.reduce((s, x) => s + x.valorUnitario * x.quantidade, 0) / quantidade : grupo[0].valorUnitario;
    if (distintos.size > 1) diagnosticos.push({ codigo: "PRECO_MEDIO_PONDERADO", mensagem: "Valores unitários diferentes entre os legados e nenhum preço único informado: usada a média ponderada pela quantidade", detalhes: { valores: [...distintos] } });
  }
  const unificado: ItemUnificado = {
    produtoId: modelo.produtoCanonicoId, quantidade, ...(adicional > 0 ? { quantidadeAdicional: adicional } : {}), valorUnitario: valor, maquinasPorEtapa: maquinas,
    origem: grupo.map((x) => ({ produtoLegadoId: x.produtoId, quantidade: x.quantidade })),
  };
  const saida: (ItemPrevisaoEntrada | ItemUnificado)[] = [];
  itens.forEach((it, i) => {
    if (i === primeiro) saida.push(unificado);
    else if (!marcador.has(i)) saida.push(it);
  });
  return { itens: saida, diagnosticos };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Contagens físicas (WIP): ids traduzidos na LEITURA (o jsonb de PROD nunca é reescrito). Pool comum (Etiquetar->Embalar): UMA contagem por instante.
// ---------------------------------------------------------------------------------------------------------------------------------
export function canonizarContagens(contagens: ContagemFisicaPar[], modelo: ModeloCanonico): { contagens: ContagemFisicaPar[]; diagnosticos: DiagnosticoCanonico[] } {
  const diagnosticos: DiagnosticoCanonico[] = [];
  const mapeadas = contagens.map((c) => {
    const o = resolverEtapa(modelo, c.etapaOrigemId);
    const s = resolverEtapa(modelo, c.etapaSeguinteId);
    if (o.entrada === "fora" && s.entrada === "fora" && resolverProduto(modelo, c.produtoId).entrada === "fora") return c;
    return { ...c, produtoId: resolverProduto(modelo, c.produtoId).produtoId, etapaOrigemId: o.etapaId, etapaSeguinteId: s.etapaId };
  });
  // mesma (origem, seguinte, instante) vinda de produtos legados diferentes = o MESMO estoque físico contado duas vezes: não somar
  const vistos = new Map<string, ContagemFisicaPar>();
  const out: ContagemFisicaPar[] = [];
  mapeadas.forEach((c, i) => {
    const k = `${c.etapaOrigemId}|${c.etapaSeguinteId}|${c.contadoEmMs}`;
    const ant = vistos.get(k);
    const mudou = c !== contagens[i];
    if (ant && mudou) {
      diagnosticos.push({ codigo: "CONTAGEM_COMUM_DUPLICADA", mensagem: "Duas contagens do mesmo estoque físico no mesmo instante (produtos legados diferentes): mantida a primeira, a outra descartada (não soma)", detalhes: { etapaOrigemId: c.etapaOrigemId, etapaSeguinteId: c.etapaSeguinteId, saldoMantido: ant.saldo, saldoDescartado: c.saldo } });
      return;
    }
    vistos.set(k, c);
    out.push(c);
  });
  return { contagens: out, diagnosticos };
}

/** Estoque que alimenta uma etapa: soma, por ORIGEM (rota), da contagem mais recente <= agoraMs. Convencional (Parafusar) + Automática (M8) antes da Etiquetadora; nunca duplica. */
export function somarWipEntrada(contagensCanonicas: ContagemFisicaPar[], modelo: ModeloCanonico, etapaDestinoId: string, agoraMs: number): { total: number; porOrigem: Record<string, number> } {
  const origens = modelo.arestas.filter((a) => a.destinoEtapaId === etapaDestinoId).map((a) => a.origemEtapaId);
  const porOrigem: Record<string, number> = {};
  origens.forEach((o) => {
    const c = contagensCanonicas.filter((x) => x.etapaOrigemId === o && x.etapaSeguinteId === etapaDestinoId && x.contadoEmMs <= agoraMs).sort((a, b) => b.contadoEmMs - a.contadoEmMs)[0];
    if (c) porOrigem[o] = c.saldo;
  });
  return { total: Object.values(porOrigem).reduce((s, v) => s + v, 0), porOrigem };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Produção final e demanda restante: só a etapa FINAL conta; o resto é WIP.
// ---------------------------------------------------------------------------------------------------------------------------------
export function producaoFinalBoa(apontamentos: { etapaId: string; quantidadeBoa: number }[], modelo: ModeloCanonico): number {
  return apontamentos.reduce((s, a) => s + (papelDe(modelo, a.etapaId) === "FINAL" ? a.quantidadeBoa : 0), 0);
}

export function demandaRestante(demandaTotal: number, producaoFinal: number): number {
  return Math.max(0, demandaTotal - producaoFinal);
}

/** Rota que uma máquina serve (null nas etapas comuns). Exige a elegibilidade carregada em `etapas[].maquinasIds`. */
export function rotaDaMaquina(modelo: ModeloCanonico, maquinaId: string): { rotaId: string | null; etapaId: string; papel: PapelEtapa } | null {
  const e = modelo.etapas.find((x) => x.maquinasIds?.includes(maquinaId));
  return e ? { rotaId: e.rotaId, etapaId: e.etapaId, papel: e.papel } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Validação do grafo (espelho TS de produto_canonico_problemas)
// ---------------------------------------------------------------------------------------------------------------------------------
export function problemasDoModelo(modelo: ModeloCanonico): string[] {
  const p: string[] = [];
  const finais = modelo.etapas.filter((e) => e.papel === "FINAL");
  if (finais.length !== 1) p.push(`esperada 1 etapa FINAL, há ${finais.length}`);
  const ids = new Set(modelo.etapas.map((e) => e.etapaId));
  modelo.arestas.forEach((a) => { if (!ids.has(a.origemEtapaId) || !ids.has(a.destinoEtapaId)) p.push(`aresta fora do produto: ${a.origemEtapaId}->${a.destinoEtapaId}`); });
  modelo.etapas.forEach((e) => {
    const saidas = modelo.arestas.filter((a) => a.origemEtapaId === e.etapaId).length;
    if (e.papel === "FINAL" && saidas > 0) p.push(`etapa FINAL ${e.etapaId} tem saída`);
    if (e.papel !== "FINAL" && saidas === 0) p.push(`etapa ${e.etapaId} sem saída`);
    if ((e.papel === "ROTA") !== (e.rotaId !== null)) p.push(`etapa ${e.etapaId}: papel ${e.papel} incompatível com rota`);
  });
  if (finais.length === 1) {
    const alcanca = new Set<string>([finais[0].etapaId]);
    for (let i = 0; i <= modelo.etapas.length; i++) modelo.arestas.forEach((a) => { if (alcanca.has(a.destinoEtapaId)) alcanca.add(a.origemEtapaId); });
    modelo.etapas.forEach((e) => { if (!alcanca.has(e.etapaId)) p.push(`etapa ${e.etapaId} não alcança o produto final`); });
  }
  // ciclo: ordenação topológica
  const grau = new Map(modelo.etapas.map((e) => [e.etapaId, 0]));
  modelo.arestas.forEach((a) => grau.set(a.destinoEtapaId, (grau.get(a.destinoEtapaId) ?? 0) + 1));
  const fila = [...grau.entries()].filter(([, g]) => g === 0).map(([k]) => k);
  let vistos = 0;
  while (fila.length) {
    const x = fila.pop() as string;
    vistos++;
    modelo.arestas.filter((a) => a.origemEtapaId === x).forEach((a) => { grau.set(a.destinoEtapaId, (grau.get(a.destinoEtapaId) ?? 1) - 1); if (grau.get(a.destinoEtapaId) === 0) fila.push(a.destinoEtapaId); });
  }
  if (vistos < modelo.etapas.length) p.push("ciclo no grafo");
  const porMaquina = new Map<string, number>();
  modelo.etapas.forEach((e) => (e.maquinasIds ?? []).forEach((m) => porMaquina.set(m, (porMaquina.get(m) ?? 0) + 1)));
  porMaquina.forEach((n, m) => { if (n > 1) p.push(`máquina ${m} elegível em ${n} etapas (apontamento ambíguo)`); });
  return p;
}

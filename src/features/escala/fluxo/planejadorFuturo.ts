// PLANEJADOR DO FUTURO (API PURA, sombra/offline, DESLIGADO: nada no motor chama isto ainda). Sem I/O, sem relógio, sem banco. Ids opacos.
//
// Entrada: estado CONGELADO (linhas e produção efetiva dos slots < aPartirDe) + WIP + equipe/ausências + máquinas + produtos/rotas/taxas + demanda da semana.
// Saída: linhas pessoa→posto dos slots ≥ aPartirDe, com DISTRIBUICAO_DA_QUANTIDADE_POR_PRODUTO por linha física, WIP projetado, corte e validação.
// Garantias por construção (despacho forward, postosDespacho.ts): lote de 1 período; nunca consumir mais que o estoque do início do período (cadeia válida);
// teto de WIP útil; nunca acima da demanda restante; ≤ pessoas disponíveis por slot; uma máquina = um posto = uma pessoa; revezamento de bloco + ponte M3→T1
// (atribuição de pessoas com `reatribuirPessoasBloco`, memória do passado = linhasCongeladas) e conferência por verificador independente injetado (`verificarDuras`).
import { reatribuirPessoasBloco } from "../estabilidade";
import type { AlocacaoEscala, SlotEscala } from "../types";
import { MOTIVO_DEMANDA_ESGOTADA } from "../types";
import { buscaLocal, linhasComDetalhes, prepararDespacho, despachar, linhasParaOcc, type ConfigDespacho, type LinhaPostoD } from "./postosDespacho";
import { validarPlanoCadeia, type ProdutoRev, type RecursoRev } from "./planoReverso";

export type ObjetivoPlanejador = "EQUILIBRIO" | "MAX_PECAS_FINAIS" | "MAX_RESULTADO_ECONOMICO";
export interface DistribuicaoQuantidade { produtoId: string; etapaId: string; pecas: number }
export interface LinhaPlanejada extends AlocacaoEscala { distribuicao: DistribuicaoQuantidade[] }

export interface EntradaPlanejador {
  slots: SlotEscala[];
  aPartirDe: number;
  recursos: RecursoRev[];
  produtos: ProdutoRev[]; // demandaFinal = demanda TOTAL da semana; wipInicial = WIP no início do slot 0 da semana
  equipe: { id: string }[];
  ausentes?: Record<number, string[]>;
  linhasCongeladas: AlocacaoEscala[];
  producaoCongelada: Record<string, Record<string, number[]>>;
  wipNoInicioDeAPartirDe?: Record<string, number[]>;
  objetivo?: ObjetivoPlanejador;
  margemPorPeca?: Record<string, number>;
  /** EQUILIBRIO: piso de peças finais da SEMANA por produto (default: coberturaMinima × demanda) */
  pisoPorProduto?: Record<string, number>;
  coberturaMinima?: number; // default 0.45 (≈ 0,9 × a maior cobertura uniforme viável da 02/11)
  operacaoDe: (produtoId: string, etapaId: string) => string;
  /** linhas candidatas de partida (ex.: o plano vigente para os slots futuros) — acelera; sem elas a busca parte do vazio */
  linhasIniciais?: LinhaPostoD[];
  /** ordem de prioridade entre produtos que dividem uma linha (Etiquetadora/Embalagem) */
  prioridade?: string[];
  revezamento?: { ponteM3T1: boolean; equivalencias?: Record<string, string[]> };
  /** verificador independente (ex.: verificarRestricoesDuras da entrada real) — devolve nº de violações duras do conjunto congelado + futuro */
  verificarDuras?: (linhas: AlocacaoEscala[]) => number;
  busca?: { iter?: number; reinicios?: number; semente?: number };
}

export interface SaidaPlanejador {
  linhas: LinhaPlanejada[];
  linhasPostos: LinhaPostoD[];
  porProduto: { produtoId: string; demanda: number; programado: number; cortado: number; futuro: number }[];
  wip: Record<string, number[][]>; // produto → ligação → estoque no início de cada slot (H+1)
  producao: Record<string, Record<string, number[]>>; // produto → etapa → peças por slot (congelado + futuro, inteiras)
  validacao: { cadeiaValida: boolean; violacoesCadeia: number; violacoesDuras: number | null; maxPostosSimultaneos: number; semMaterial: number; atribuicaoOk: boolean };
  avisos: string[];
  objetivoValor: number;
}

const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);

/** Estoque por ligação no início de cada slot, simulando a produção efetiva congelada (consumo = produção da etapa seguinte; lote de 1 período). */
export function simularCongelado(prods: ProdutoRev[], producao: Record<string, Record<string, number[]>>, ate: number): Record<string, number[][]> {
  const out: Record<string, number[][]> = {};
  prods.forEach((p) => {
    const L = p.etapas.length - 1;
    const st = p.wipInicial.map((w) => [w]);
    for (let t = 0; t < ate; t++) for (let k = 0; k < L; k++) {
      const entra = producao[p.id]?.[p.etapas[k].id]?.[t] ?? 0, sai = producao[p.id]?.[p.etapas[k + 1].id]?.[t] ?? 0;
      st[k].push(Math.max(0, st[k][t] + entra - sai));
    }
    out[p.id] = st;
  });
  return out;
}

export function planejarFuturo(e: EntradaPlanejador): SaidaPlanejador {
  const H = e.slots.length, t0 = e.aPartirDe;
  const avisos: string[] = [];
  const congel = simularCongelado(e.produtos, e.producaoCongelada, t0);
  const finaisCongelados: Record<string, number> = {};
  e.produtos.forEach((p) => (finaisCongelados[p.id] = soma((e.producaoCongelada[p.id]?.[p.etapas[p.etapas.length - 1].id] ?? []).slice(0, t0))));
  const prodsFuturo: ProdutoRev[] = e.produtos.map((p) => ({ ...p, wipInicial: e.wipNoInicioDeAPartirDe?.[p.id] ?? congel[p.id].map((s) => s[t0]) }));
  const alvo = Object.fromEntries(e.produtos.map((p) => [p.id, Math.max(0, p.demandaFinal - finaisCongelados[p.id])]));
  const pessoas = e.slots.map((_, t) => e.equipe.length - (e.ausentes?.[t]?.length ?? 0));
  const margem = Object.fromEntries(e.produtos.map((p) => [p.id, e.objetivo === "MAX_PECAS_FINAIS" ? 1 : e.margemPorPeca?.[p.id] ?? p.valorUnitario ?? 1]));
  const cob = e.coberturaMinima ?? 0.45;
  const piso = e.objetivo === "MAX_PECAS_FINAIS" || e.objetivo === "MAX_RESULTADO_ECONOMICO" ? undefined
    : Object.fromEntries(e.produtos.map((p) => [p.id, Math.min(alvo[p.id], Math.max(0, (e.pisoPorProduto?.[p.id] ?? cob * p.demandaFinal) - finaisCongelados[p.id]))]));
  // blocos manhã/tarde de cada dia (índices de slot)
  const blocos: number[][] = [];
  e.slots.forEach((s, i) => { const k = `${s.data}|${s.periodoId.startsWith("m") ? "m" : "t"}`; const u = blocos[blocos.length - 1]; if (u && `${e.slots[u[0]].data}|${e.slots[u[0]].periodoId.startsWith("m") ? "m" : "t"}` === k) u.push(i); else blocos.push([i]); });
  const opDoBloco = new Map<string, number>(); // `${bloco}|${op}` → linhas já usadas no passado congelado
  const slotIdx = new Map(e.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const blocoDe = new Array(H).fill(-1); blocos.forEach((b, i) => b.forEach((t) => (blocoDe[t] = i)));
  e.linhasCongeladas.forEach((a) => { const t = slotIdx.get(`${a.data}|${a.periodoId}`); if (t === undefined || t >= t0 || !a.maquinaId || !a.operacaoId) return; const k = `${blocoDe[t]}|${a.operacaoId}`; opDoBloco.set(k, (opDoBloco.get(k) ?? 0) + 1); });
  const prioridade = e.prioridade ?? e.produtos.map((p) => p.id);
  const cfgBase: Omit<ConfigDespacho, "limiteOp"> = { t0, produtos: prodsFuturo, recursos: e.recursos, pessoas, operacaoDe: e.operacaoDe, alvo, piso, margem, prioridade, blocos, penalPiso: 1, saidaTeto: Object.fromEntries(e.produtos.map((p) => [p.id, p.recorrentePorPeriodo ?? p.demandaFinal / H])), saidaPeso: 0.25, abatimentoOp: (b, op) => opDoBloco.get(`${b}|${op}`) ?? 0 };
  const ehLivre = (l: LinhaPostoD) => l.t >= t0;
  let iniciais = (e.linhasIniciais ?? []).filter(ehLivre);
  // descarta linhas além das pessoas disponíveis (ausência) — as de menor produção saem primeiro na própria busca; aqui só corta o excesso
  const porT = new Map<number, LinhaPostoD[]>();
  iniciais.forEach((l) => (porT.get(l.t) ?? porT.set(l.t, []).get(l.t)!).push(l));
  iniciais = [...porT.entries()].flatMap(([t, ls]) => ls.slice(0, Math.max(0, pessoas[t])));

  let limiteOp = Math.max(...pessoas);
  let resultado: ReturnType<typeof montar> | null = null;
  for (let tent = 0; tent < 5 && !resultado; tent++, limiteOp--) {
    const cfg: ConfigDespacho = { ...cfgBase, limiteOp };
    const r = buscaLocal(cfg, iniciais, { iter: e.busca?.iter ?? 400000, reinicios: e.busca?.reinicios ?? 2, semente: e.busca?.semente ?? 1 });
    const m = montar(e, cfg, r, prodsFuturo, congel, alvo, finaisCongelados, avisos);
    if (m.atribuicaoOk) resultado = m; else { avisos.push(`atribuição de pessoas falhou com limite ${limiteOp} linhas/operação/bloco; apertando para ${limiteOp - 1}`); iniciais = r.linhas; }
  }
  if (!resultado) throw new Error("planejarFuturo: sem plano executável com as pessoas disponíveis (revezamento)");
  return resultado.saida;
}

function montar(e: EntradaPlanejador, cfg: ConfigDespacho, r: ReturnType<typeof buscaLocal>, prodsFuturo: ProdutoRev[], congel: Record<string, number[][]>, alvo: Record<string, number>, finaisCongelados: Record<string, number>, avisos: string[]) {
  const H = e.slots.length, t0 = e.aPartirDe;
  const lcd = linhasComDetalhes(cfg, r.linhas, r.desp);
  type Row = { t: number; recursoId: string; operacaoId: string; dets: { produtoId: string; etapaId: string; etapaIdx: number; pecas: number }[] };
  const rows: Row[] = lcd.map(({ linha, detalhes }) => ({ t: linha.t, recursoId: linha.recursoId, operacaoId: linha.operacaoId, dets: detalhes.map((d) => ({ ...d })) }));
  // INTEIRIZAÇÃO com fechamento de cadeia (produção ≤ estoque do início do período), produto por produto, partindo do estado congelado
  const estoque: Record<string, number[]> = Object.fromEntries(prodsFuturo.map((p) => [p.id, p.wipInicial.slice()]));
  for (let t = t0; t < H; t++) {
    const chega: Record<string, number[]> = Object.fromEntries(prodsFuturo.map((p) => [p.id, new Array(p.etapas.length).fill(0)]));
    for (const p of prodsFuturo) {
      for (let k = 0; k < p.etapas.length; k++) {
        const ds = rows.filter((r2) => r2.t === t).flatMap((r2) => r2.dets.filter((d) => d.produtoId === p.id && d.etapaIdx === k));
        const bruto = soma(ds.map((d) => d.pecas));
        if (bruto <= 0) continue;
        const disp = k === 0 ? Number.POSITIVE_INFINITY : estoque[p.id][k - 1];
        const alvoInt = Math.min(Math.floor(bruto + 1e-6), Math.floor(disp + 1e-6));
        let resto = alvoInt;
        ds.forEach((d, i) => { const q = i === ds.length - 1 ? resto : Math.min(resto, Math.floor((d.pecas / bruto) * alvoInt)); d.pecas = q; resto -= q; });
        if (k > 0) estoque[p.id][k - 1] -= alvoInt;
        if (k < p.etapas.length - 1) chega[p.id][k] += alvoInt;
      }
    }
    prodsFuturo.forEach((p) => chega[p.id].forEach((v, k) => { if (k < p.etapas.length - 1) estoque[p.id][k] += v; }));
  }
  // produção total (congelado + futuro) por produto × etapa × slot
  const producao: Record<string, Record<string, number[]>> = {};
  e.produtos.forEach((p) => { producao[p.id] = {}; p.etapas.forEach((et) => { producao[p.id][et.id] = (e.producaoCongelada[p.id]?.[et.id] ?? new Array(H).fill(0)).map((v, t) => (t < t0 ? v : 0)); }); });
  rows.forEach((r2) => r2.dets.forEach((d) => { producao[d.produtoId][d.etapaId][r2.t] += d.pecas; }));
  // linhas pessoa→posto
  const disponiveis = e.slots.map((_, t) => e.equipe.map((q) => q.id).filter((id) => !(e.ausentes?.[t] ?? []).includes(id)));
  const lin: AlocacaoEscala[] = [];
  const dist = new Map<string, DistribuicaoQuantidade[]>();
  for (let t = t0; t < H; t++) {
    const s = e.slots[t];
    const rs = rows.filter((r2) => r2.t === t && r2.dets.some((d) => d.pecas > 0));
    disponiveis[t].forEach((fid, i) => {
      const x = rs[i];
      if (!x) { lin.push({ data: s.data, periodoId: s.periodoId, funcionarioId: fid, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, motivoSemPosto: MOTIVO_DEMANDA_ESGOTADA, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" }); return; }
      const dom = x.dets.reduce((a, b) => (b.pecas > a.pecas ? b : a));
      lin.push({ data: s.data, periodoId: s.periodoId, funcionarioId: fid, maquinaId: x.recursoId, produtoId: dom.produtoId, etapaId: dom.etapaId, operacaoId: x.operacaoId, pecas: soma(x.dets.map((d) => d.pecas)), pecasAdicional: 0, motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" });
    });
    // a distribuição acompanha a MÁQUINA (a pessoa é decidida depois pela atribuição)
    rs.forEach((x) => dist.set(`${t}|${x.recursoId}`, x.dets.filter((d) => d.pecas > 0).map((d) => ({ produtoId: d.produtoId, etapaId: d.etapaId, pecas: d.pecas }))));
  }
  const reg = reatribuirPessoasBloco(lin, e.linhasCongeladas, e.slots, { escopo: "bloco", ponteM3T1: e.revezamento?.ponteM3T1 ?? true, equivalencias: e.revezamento?.equivalencias }, 600);
  const atribuicaoOk = reg !== null;
  const finais = (reg?.linhas ?? lin).map((a): LinhaPlanejada => {
    const t = e.slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)!.indice;
    return { ...a, distribuicao: a.maquinaId ? dist.get(`${t}|${a.maquinaId}`) ?? [] : [] };
  });
  // validação de cadeia da semana inteira
  let violCadeia = 0, semMat = 0;
  e.produtos.forEach((p) => {
    const sim = validarPlanoCadeia({ etapas: p.etapas.map((x) => ({ id: x.id, rotulo: x.rotulo })), wipInicial: p.wipInicial, periodos: e.slots.map((s) => ({ rotulo: `${s.data} ${s.periodoId}`, duracaoMin: s.fimMin - s.inicioMin })) }, producao[p.id]);
    violCadeia += sim.violacoes.length;
    sim.nos.forEach((n) => (semMat += soma(n.semMaterial)));
  });
  const maxPostos = Math.max(0, ...e.slots.map((_, t) => rows.filter((r2) => r2.t === t && r2.dets.some((d) => d.pecas > 0)).length));
  const dur = e.verificarDuras ? e.verificarDuras([...e.linhasCongeladas, ...finais]) : null;
  // WIP: congelado até t0, depois o do despacho (inteirizado pela simulação do plano total)
  const wip: Record<string, number[][]> = {};
  e.produtos.forEach((p) => {
    const L = p.etapas.length - 1;
    const st: number[][] = Array.from({ length: L }, (_, k) => [p.wipInicial[k]]);
    for (let t = 0; t < H; t++) for (let k = 0; k < L; k++) st[k].push(Math.max(0, st[k][t] + (producao[p.id][p.etapas[k].id][t] ?? 0) - (producao[p.id][p.etapas[k + 1].id][t] ?? 0)));
    wip[p.id] = st;
  });
  const porProduto = e.produtos.map((p) => {
    const futuro = soma(producao[p.id][p.etapas[p.etapas.length - 1].id].slice(t0));
    const programado = finaisCongelados[p.id] + futuro;
    return { produtoId: p.id, demanda: p.demandaFinal, programado, cortado: Math.max(0, p.demandaFinal - programado), futuro };
  });
  void alvo; void prepararDespacho; void despachar; void linhasParaOcc;
  return {
    atribuicaoOk,
    saida: {
      linhas: finais, linhasPostos: r.linhas, porProduto, wip, producao,
      validacao: { cadeiaValida: violCadeia === 0, violacoesCadeia: violCadeia, violacoesDuras: dur, maxPostosSimultaneos: maxPostos, semMaterial: semMat, atribuicaoOk },
      avisos: [...avisos], objetivoValor: r.desp.obj,
    } as SaidaPlanejador,
  };
}

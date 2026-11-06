// FORMAÇÃO DELIBERADA DE ESTOQUE (e ANTECIPAÇÃO opcional para a semana seguinte) — FASE 2 DO PLANEJADOR (PURA: sem IO, sem relógio, ids opacos). Ver docs/antecipacao-semana-seguinte.md.
//
// A quantidade da Previsão é a META MÍNIMA DE PRODUÇÃO da semana ("o mínimo que aceito produzir"), NÃO um teto. Prioridades, por construção (não por peso):
//   1) FASE 1 = o planejador de sempre (planejarFuturo/buscaLocal): leva todos os produtos até as metas mínimas (demanda restante) e consome o WIP atual. Não sabe que a fase 2 existe.
//      Produto que já atingiu a meta tem demanda restante 0 na fase 1 ⇒ nunca ocupa pessoa/máquina de produto ainda abaixo da meta.
//   2) FASE 2 (este arquivo) só roda DEPOIS, sobre o que SOBROU. As linhas da fase 1 ficam FIXAS; a fase 2 só ACRESCENTA linhas (que servem só aos produtos-sombra) e usa a fração ociosa das linhas
//      fixas (os pools da meta produzem primeiro). Logo a produção até a meta NUNCA diminui. Tudo que a fase 2 produz de produto AUTORIZADO é FORMACAO_ESTOQUE (além da meta): não é erro, excesso nem violação.
// Produto AUTORIZADO = política explícita por produto (escala_formacao_estoque_produtos). Para ele NÃO existe teto comercial baseado na Previsão: o limite é físico/operacional (máquinas da Previsão,
// pessoas, revezamento, matéria-prima/WIP, lote Tn → Tn+1, buffer limitado pela capacidade LIVRE do consumidor); `limiteFisicoPecas` opcional (espaço) só existe se configurado.
// Produto NÃO autorizado para ao atingir a meta, como sempre. ANTECIPAÇÃO da meta da semana seguinte (com desconto) é OPT-IN separado (escala_antecipacao_semana_seguinte) e nunca passa do restante da
// meta mínima da semana seguinte (para não duplicar produção).
// Cada produto elegível vira um produto-SOMBRA (mesma rota/taxas, máquinas restritas, estoque próprio):
//   • wipInicial da sombra = o WIP da cadeia que a meta atual NUNCA toca (mínimo, depois de consumir, do estoque do plano da fase 1) ⇒ o WIP existente conta e não se produz upstream desnecessário;
//     a soma "meta + sombra" é uma cadeia válida (cada uma só consome o que tem).
//   • nível de estoque por ligação ≤ capacidade LIVRE do consumidor nos períodos restantes (sem WIP absurdo); lote de 1 período (Tn → Tn+1) como em todo o despacho.
// Valor: FORMAÇÃO pesa `PESO_FORMACAO_PADRAO` (0,25) × margem — sempre menor que qualquer meta ainda não atendida, que está na fase 1; ANTECIPAÇÃO opt-in pesa 1.
// Busca: gulosa determinística (ganho marginal do objetivo do despacho) + poda; só entra linha que PRODUZ algo útil — pessoa sem trabalho fisicamente válido continua sem posto.
import type { ProdutoRev } from "./planoReverso";
import { despachar, linhasParaOcc, occParaLinhas, prepararDespacho, restricoesOk, type ConfigDespacho, type LinhaPostoD, type ResultadoDespacho } from "./postosDespacho";

export const ORIGEM_DEMANDA_SEMANA = "DEMANDA_SEMANA";
export const ORIGEM_ANTECIPACAO = "ANTECIPACAO_SEMANA_SEGUINTE";
export const ORIGEM_FORMACAO = "FORMACAO_ESTOQUE";
export type OrigemProducao = typeof ORIGEM_DEMANDA_SEMANA | typeof ORIGEM_ANTECIPACAO | typeof ORIGEM_FORMACAO;
export type OrigemExtra = typeof ORIGEM_ANTECIPACAO | typeof ORIGEM_FORMACAO;

export const PESO_FORMACAO_PADRAO = 0.25;
/** FORMAÇÃO sem limite físico configurado: o único limite é a capacidade (máquinas × pessoas × períodos do horizonte, buffers, matéria-prima/WIP) */
export const SEM_LIMITE_FISICO = 1e9;

export interface ProdutoAntecipavel {
  produtoId: string;
  origem: OrigemExtra;
  /** peças FINAIS ainda permitidas. ANTECIPAÇÃO (opt-in): restante da meta mínima da semana seguinte. FORMAÇÃO: limite FÍSICO explícito restante (`SEM_LIMITE_FISICO` quando nada foi configurado) */
  maxFinal: number;
  /** meta mínima de produção da semana atual (quantidade da Previsão), só para o rastreio no ledger */
  metaMinima?: number;
  /** máquinas permitidas por etapa (id da etapa → ids de máquina). Ausente = as alternativas do produto. Etapa sem máquina permitida ⇒ produto NÃO é elegível. */
  maquinasPorEtapa?: Record<string, string[]>;
  /** multiplicador do valor (default 1 para ANTECIPAÇÃO; PESO_FORMACAO_PADRAO para FORMAÇÃO) */
  peso?: number;
  /** folga FÍSICA explícita (peças) somada ao nível máximo de cada buffer deste produto, além da capacidade LIVRE do consumidor nos períodos restantes (default 0 = conservador) */
  bufferExtraPecas?: number;
}
export interface EntradaAntecipacao { produtos: ProdutoAntecipavel[]; /** folga física somada ao nível máximo de cada buffer (default 0) */ bufferExtra?: number }

export interface LinhaAntecipada {
  data: string; periodoId: string; funcionarioId: string; maquinaId: string; operacaoId: string;
  produtoId: string; etapaId: string; etapaIdx: number; etapaFinal: boolean; pecas: number; origem: OrigemExtra;
  /** meta mínima de produção (quantidade da Previsão) do produto na semana de origem — rastreio */
  metaMinima?: number;
}
/** linha bruta (antes da atribuição de pessoas) */
export interface LinhaAntecipadaBruta { t: number; recursoId: string; operacaoId: string; produtoId: string; etapaId: string; etapaIdx: number; pecas: number; origem: OrigemExtra }

export interface ResultadoFase2 {
  cfg: ConfigDespacho;
  linhas: LinhaPostoD[];
  adicionadas: LinhaPostoD[];
  desp: ResultadoDespacho;
  produtos: ProdutoRev[];
  sombraDe: Map<string, { produtoId: string; origem: OrigemExtra }>;
  avisos: string[];
}

const SUFIXO = "\u0001ant";
const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);

/** WIP da cadeia que a demanda atual não toca: por ligação, o menor estoque (já descontado o consumo do período) no plano INTEIRO da fase 1. */
export function wipNaoTocado(p: ProdutoRev, wipT0: number[], producao: Record<string, number[]>, t0: number, H: number): number[] {
  const L = p.etapas.length - 1;
  const out: number[] = [];
  for (let k = 0; k < L; k++) {
    let st = wipT0[k] ?? 0, trough = st;
    for (let t = t0; t < H; t++) {
      st -= producao[p.etapas[k + 1].id]?.[t] ?? 0;
      trough = Math.min(trough, st);
      st += producao[p.etapas[k].id]?.[t] ?? 0;
    }
    out.push(Math.max(0, Math.floor(trough + 1e-6)));
  }
  return out;
}

export function planejarFase2(a: {
  entrada: EntradaAntecipacao;
  /** produtos da demanda (como o planejador os enxerga: wipInicial = estoque em t0) */
  produtosFuturo: ProdutoRev[];
  cfg: ConfigDespacho;
  linhasFase1: LinhaPostoD[];
  /** produção INTEIRA (inteirizada) da fase 1: produto → etapa → peças por slot */
  producaoFase1: Record<string, Record<string, number[]>>;
  parar?: () => boolean;
  /** recebe os motivos de produtos não elegíveis (diagnóstico) */
  avisos?: string[];
}): ResultadoFase2 | null {
  const { cfg } = a;
  const H = cfg.pessoas.length, t0 = cfg.t0;
  const avisos: string[] = a.avisos ?? [];
  const sombras: ProdutoRev[] = [];
  const sombraDe = new Map<string, { produtoId: string; origem: OrigemExtra }>();
  const alvo: Record<string, number> = { ...cfg.alvo };
  const margem: Record<string, number> = { ...cfg.margem };
  const saidaObj: Record<string, number> = {};
  const tetoNivel: Record<string, number[]> = {};
  const prioridade = [...cfg.prioridade];
  for (const ap of a.entrada.produtos) {
    const real = a.produtosFuturo.find((p) => p.id === ap.produtoId);
    if (!real || real.alimenta || a.produtosFuturo.some((p) => p.alimenta?.produtoId === real.id)) continue; // produto único/rotas: nunca
    if (!(ap.maxFinal > 0)) continue;
    const etapas = real.etapas.map((e) => {
      const perm = ap.maquinasPorEtapa?.[e.id];
      return { ...e, alternativas: e.alternativas.filter((alt) => (perm ? perm.includes(alt.recursoId) : true)) };
    });
    const semMaq = etapas.findIndex((e) => e.alternativas.length === 0);
    if (semMaq >= 0) { avisos.push(`produto ${real.id}: etapa ${semMaq} sem máquina permitida (Previsão/seleção) — sem ${ap.origem}`); continue; }
    const sid = real.id + SUFIXO;
    const wipAnt = wipNaoTocado(real, real.wipInicial, a.producaoFase1[real.id] ?? {}, t0, H);
    const teto = Math.floor(ap.maxFinal + 1e-6);
    sombras.push({ id: sid, rotulo: `${real.rotulo} (${ap.origem})`, etapas, demandaFinal: teto, wipInicial: wipAnt, ...(real.valorUnitario !== undefined ? { valorUnitario: real.valorUnitario } : {}) });
    sombraDe.set(sid, { produtoId: real.id, origem: ap.origem });
    alvo[sid] = teto;
    const m0 = cfg.margem[real.id] ?? 0;
    margem[sid] = (m0 > 0 ? m0 : 1e-3) * (ap.peso ?? (ap.origem === ORIGEM_FORMACAO ? PESO_FORMACAO_PADRAO : 1));
    saidaObj[sid] = teto;
    prioridade.push(sid);
    // limite FÍSICO do buffer: o que o consumidor ainda consegue absorver nos períodos que restam (lote de 1 período ⇒ a partir de t0+1), DEPOIS de atender a demanda atual
    // (capacidade total − o que a demanda já consome na mesma etapa). Nada além disso fica parado "por acaso"; folga explícita só por `bufferExtraPecas`.
    const niv: number[] = [];
    for (let k = 0; k + 1 < etapas.length; k++) {
      let cap = 0;
      for (const alt of etapas[k + 1].alternativas) {
        const rec = cfg.recursos.find((r) => r.id === alt.recursoId);
        for (let t = t0 + 1; t < H; t++) cap += (alt.pecasPorPosto[t] ?? 0) * (rec?.unidades[t] ?? 0);
      }
      const usoDemanda = soma((a.producaoFase1[real.id]?.[real.etapas[k + 1].id] ?? []).slice(t0 + 1));
      niv.push(Math.floor(Math.max(wipAnt[k] ?? 0, Math.max(0, cap - usoDemanda)) + (ap.bufferExtraPecas ?? a.entrada.bufferExtra ?? 0)));
    }
    tetoNivel[sid] = niv;
  }
  if (sombras.length === 0) return null;

  const C2: ConfigDespacho = {
    ...cfg, produtos: [...a.produtosFuturo, ...sombras], alvo, margem, prioridade, sombra: new Set(sombras.map((s) => s.id)), saidaTetoObj: saidaObj, tetoNivel,
    operacaoDe: (pid, eid) => cfg.operacaoDe(pid.endsWith(SUFIXO) ? pid.slice(0, -SUFIXO.length) : pid, eid),
  };
  const D = prepararDespacho(C2);
  const occ = linhasParaOcc(C2, D, a.linhasFase1);
  C2.fixas = occ.map((row) => row.map((v) => (v ? 1 : 0)) as unknown as Uint8Array) as Uint8Array[];
  const R = C2.recursos.length;
  const objDe = () => despachar(C2, D, occ).obj;
  // candidatos: (t, recurso, operação) livres em que algum pool-sombra tem taxa > 0
  const cands: { t: number; r: number; o: number }[] = [];
  for (let t = t0; t < H; t++) for (let r = 0; r < R; r++) {
    if (occ[t][r] || (C2.recursos[r].unidades[t] ?? 0) <= 0) continue;
    for (const o of D.opsDoRec[r]) if (D.poolsDe[r][o].some((pl) => pl.sombra && (pl.rate.get(r)?.[t] ?? 0) > 0)) cands.push({ t, r, o: o + 1 });
  }
  let obj = objDe();
  const adic: { t: number; r: number }[] = [];
  for (;;) {
    if (a.parar?.()) throw new Error("ORCAMENTO_DE_TEMPO_ESTOURADO");
    let melhor: { c: (typeof cands)[number]; g: number } | null = null;
    for (const c of cands) {
      if (occ[c.t][c.r]) continue;
      occ[c.t][c.r] = c.o;
      if (restricoesOk(C2, D, occ, c.t)) {
        const g = objDe() - obj;
        if (g > 1e-9 && (!melhor || g > melhor.g + 1e-12)) melhor = { c, g };
      }
      occ[c.t][c.r] = 0;
    }
    if (!melhor) break;
    occ[melhor.c.t][melhor.c.r] = melhor.c.o;
    obj += melhor.g;
    adic.push({ t: melhor.c.t, r: melhor.c.r });
  }
  // PODA: linha acrescentada cuja remoção não reduz o objetivo não tem destino útil ⇒ sai (pessoa sem posto é melhor que posto inútil)
  for (let i = adic.length - 1; i >= 0; i--) {
    const { t, r } = adic[i], v = occ[t][r];
    const ob = objDe();
    occ[t][r] = 0;
    if (objDe() < ob - 1e-9) occ[t][r] = v; else adic.splice(i, 1);
  }
  let desp = despachar(C2, D, occ, true);
  const fixa = (l: LinhaPostoD) => C2.fixas![l.t][D.recIdx.get(l.recursoId) as number] === 1;
  const ociosas = desp.linhasOciosas.filter((l) => !fixa(l));
  if (ociosas.length) { ociosas.forEach((l) => (occ[l.t][D.recIdx.get(l.recursoId) as number] = 0)); desp = despachar(C2, D, occ, true); }
  const sombraProd = sombras.reduce((s, p) => s + soma(desp.producao[p.id]?.flat() ?? []), 0);
  if (sombraProd <= 0) return null;
  const linhas = occParaLinhas(C2, D, occ);
  const adicionadas = linhas.filter((l) => !fixa(l));
  return { cfg: C2, linhas, adicionadas, desp, produtos: C2.produtos, sombraDe, avisos };
}

/** Recalcula o despacho completo com as primeiras `n` linhas acrescentadas (fallback quando a atribuição de pessoas/revezamento recusa o conjunto inteiro). */
export function fase2ComPrimeiras(f: ResultadoFase2, n: number): ResultadoFase2 {
  const D = prepararDespacho(f.cfg);
  const fixas = f.linhas.filter((l) => f.cfg.fixas![l.t][D.recIdx.get(l.recursoId) as number] === 1);
  const linhas = [...fixas, ...f.adicionadas.slice(0, n)];
  const occ = linhasParaOcc(f.cfg, D, linhas);
  let desp = despachar(f.cfg, D, occ, true);
  const fx = (l: LinhaPostoD) => f.cfg.fixas![l.t][D.recIdx.get(l.recursoId) as number] === 1;
  const oc = desp.linhasOciosas.filter((l) => !fx(l));
  if (oc.length) { oc.forEach((l) => (occ[l.t][D.recIdx.get(l.recursoId) as number] = 0)); desp = despachar(f.cfg, D, occ, true); }
  const ls = occParaLinhas(f.cfg, D, occ);
  return { ...f, linhas: ls, adicionadas: ls.filter((l) => !fx(l)), desp };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// FUNÇÕES PURAS DE REGRA (usadas pelo adaptador e pela camada de dados; testáveis sem banco)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Linha do registro persistido (escala_antecipacoes) na forma que a regra precisa. */
export interface RegistroAntecipacao {
  origem: OrigemProducao;
  data: string; periodoId: string; produtoId: string; etapaId: string; etapaFinal: boolean; quantidade: number;
  semanaDestino?: string | null; maquinaId?: string; funcionarioId?: string;
}

/** Peças FINAIS por produto e origem dos registros dados (só etapa final; DEMANDA_SEMANA ignorada). */
export function finaisRegistrados(regs: RegistroAntecipacao[], origem: OrigemExtra): Record<string, number> {
  const out: Record<string, number> = {};
  regs.forEach((r) => { if (r.origem === origem && r.etapaFinal) out[r.produtoId] = (out[r.produtoId] ?? 0) + r.quantidade; });
  return out;
}

/** Restante da meta mínima da semana seguinte que a ANTECIPAÇÃO (opt-in) ainda pode adiantar: meta futura − o já antecipado (períodos congelados). Nunca negativo; a meta em si continua exibida inteira. */
export function metaFuturaRestante(forecastFuturo: number, antecipadoCongelado: number): number {
  return Math.max(0, Math.floor(forecastFuturo - antecipadoCongelado + 1e-6));
}

/**
 * Desconto da semana de DESTINO (SÓ para o motor, nunca para a exibição da meta): quantidade líquida = meta mínima − antecipado registrado (peças finais). ANTECIPAÇÃO (opt-in) desconta (é produção
 * dedicada àquela meta); FORMAÇÃO_ESTOQUE só desconta com `descontaFormacao` (decisão explícita; padrão false ⇒ o estoque formado fica VISÍVEL no diagnóstico e a meta da semana seguinte continua inteira).
 * Devolve a quantidade nova por produto e o que foi descontado (para o diagnóstico).
 */
export function descontarAntecipadoNoDestino(quantidades: Record<string, number>, regs: RegistroAntecipacao[], descontaFormacao: boolean): { quantidades: Record<string, number>; descontos: { produtoId: string; origem: OrigemExtra; pecas: number; aplicado: boolean }[] } {
  const out = { ...quantidades };
  const descontos: { produtoId: string; origem: OrigemExtra; pecas: number; aplicado: boolean }[] = [];
  for (const origem of [ORIGEM_ANTECIPACAO, ORIGEM_FORMACAO] as const) {
    const fin = finaisRegistrados(regs, origem);
    for (const pid of Object.keys(fin).sort()) {
      if (!(fin[pid] > 0)) continue;
      const aplicado = origem === ORIGEM_ANTECIPACAO || descontaFormacao;
      descontos.push({ produtoId: pid, origem, pecas: fin[pid], aplicado });
      if (aplicado && pid in out) out[pid] = Math.max(0, out[pid] - fin[pid]);
    }
  }
  return { quantidades: out, descontos };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// ENTRADA DA REGRA (dados lidos do banco → o que o planejador consome). Pura.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Dados da semana seguinte e do registro, carregados pela camada de IO (EntradaEscala.antecipacao). Nada aqui é inventado: a meta mínima futura é exatamente a salva na Previsão da semana de destino. */
export interface DadosAntecipacao {
  /** 'ativo' liga a fase 2; 'desligado' só carrega o registro (descontos/limpeza de linhas já gravadas) */
  modo: "ativo" | "desligado";
  semanaOrigem: string;
  semanaDestino: string;
  /** ANTECIPAÇÃO da meta da semana seguinte (com desconto) é OPT-IN (escala_antecipacao_semana_seguinte = 'ativo'). Ausente/false: só FORMAÇÃO por política. */
  antecipacaoSolicitada?: boolean;
  /** Meta mínima (tipo 'previsto') da semana seguinte por produto, com as máquinas selecionadas por etapa naquela Previsão. Vazio = a semana seguinte não tem Previsão salva ⇒ nenhuma antecipação. */
  forecastDestino: { produtoId: string; quantidade: number; maquinasPorEtapa: Record<string, string[]> }[];
  /** POLÍTICA POR PRODUTO de formação de estoque (escala_formacao_estoque_produtos). Só esses produtos formam estoque; nunca regra global. */
  politicasFormacao: { produtoId: string; limiteFisicoPecas?: number; bufferExtraPecas?: number }[];
  /** produtos que NUNCA antecipam nem formam estoque (pares legados do produto único/Conector e canônico) */
  excluidos: string[];
  /** registros VIGENTES (não substituídos) cuja semana de origem é esta (todas as origens e períodos) */
  registros: RegistroAntecipacao[];
  bufferExtra?: number;
}

export interface DiagAntecipacao { produtoId: string; situacao: "ANTECIPA" | "FORMA_ESTOQUE" | "NAO"; motivo: string; maxFinal?: number }

/** Quantidade de peças finais já registradas (ANTECIPAÇÃO + FORMAÇÃO) em períodos JÁ INICIADOS/congelados (índice < aPartirDe), por produto. */
export function extraExecutadoPorProduto(regs: RegistroAntecipacao[], indiceDoSlot: (data: string, periodoId: string) => number, aPartirDe: number): Record<string, number> {
  const out: Record<string, number> = {};
  regs.forEach((r) => { if (r.etapaFinal && (r.origem === ORIGEM_ANTECIPACAO || r.origem === ORIGEM_FORMACAO) && indiceDoSlot(r.data, r.periodoId) < aPartirDe) out[r.produtoId] = (out[r.produtoId] ?? 0) + r.quantidade; });
  return out;
}

export function montarEntradaAntecipacao(a: {
  dados: DadosAntecipacao;
  /** pools da semana ATUAL: produto → etapas (id, ordem, quantidade, máquinas selecionadas na Previsão atual) */
  pools: { produtoId: string; etapaId: string; ordemEtapa: number; quantidade: number; maquinasIds: string[] }[];
  indiceDoSlot: (data: string, periodoId: string) => number;
  aPartirDe: number;
  /** peças finais já produzidas ALÉM da demanda da semana (boas − Q, ≥ 0) — contam como estoque real, nunca são "corrigidas para baixo" */
  excedenteReal?: Record<string, number>;
}): { entrada: EntradaAntecipacao; diagnostico: DiagAntecipacao[] } {
  const { dados } = a;
  const excl = new Set(dados.excluidos);
  const congelados = dados.registros.filter((r) => a.indiceDoSlot(r.data, r.periodoId) < a.aPartirDe);
  const antCong = finaisRegistrados(congelados, ORIGEM_ANTECIPACAO), forCong = finaisRegistrados(congelados, ORIGEM_FORMACAO);
  const porProduto = new Map<string, typeof a.pools>();
  a.pools.forEach((p) => (porProduto.get(p.produtoId) ?? porProduto.set(p.produtoId, []).get(p.produtoId)!).push(p));
  const produtos: ProdutoAntecipavel[] = [];
  const diagnostico: DiagAntecipacao[] = [];
  [...porProduto.keys()].sort().forEach((pid) => {
    const ps = (porProduto.get(pid) as typeof a.pools).slice().sort((x, y) => x.ordemEtapa - y.ordemEtapa);
    const nao = (motivo: string) => diagnostico.push({ produtoId: pid, situacao: "NAO", motivo });
    if (excl.has(pid)) return nao("produto excluído por segurança (legado do produto único em cutover): nunca antecipa nem forma estoque");
    const qAtual = ps[ps.length - 1].quantidade;
    if (!(qAtual > 0)) return nao("produto encerrado na semana atual (quantidade 0): nenhuma antecipação nem estoque");
    const pol = dados.politicasFormacao.find((x) => x.produtoId === pid);
    const fc = dados.forecastDestino.find((x) => x.produtoId === pid);
    if (pol) {
      // SEM limite comercial: a quantidade da Previsão é meta MÍNIMA. Só há limite físico se configurado (`limiteFisicoPecas`, p.ex. espaço); o excedente real e o já formado contam nele.
      const formado = Math.max(forCong[pid] ?? 0, a.excedenteReal?.[pid] ?? 0);
      const maxFinal = pol.limiteFisicoPecas === undefined ? SEM_LIMITE_FISICO : Math.max(0, Math.floor(pol.limiteFisicoPecas - formado + 1e-6));
      if (!(maxFinal > 0)) return nao(`limite físico de estoque configurado (${pol.limiteFisicoPecas}) já atingido (${Math.round(formado)} formado/excedente)`);
      produtos.push({ produtoId: pid, origem: ORIGEM_FORMACAO, maxFinal, metaMinima: qAtual, ...(pol.bufferExtraPecas ? { bufferExtraPecas: pol.bufferExtraPecas } : {}) });
      diagnostico.push({ produtoId: pid, situacao: "FORMA_ESTOQUE", motivo: `produto autorizado a formar estoque (política); meta mínima ${qAtual} é piso, não teto; ${pol.limiteFisicoPecas === undefined ? "sem limite comercial — o limite é físico (máquinas, pessoas, revezamento, buffers, WIP)" : `limite físico configurado ${pol.limiteFisicoPecas}`}; já formado/excedente ${Math.round(formado)}`, ...(pol.limiteFisicoPecas === undefined ? {} : { maxFinal }) });
      return;
    }
    if (!dados.antecipacaoSolicitada) return nao("produto não autorizado a formar estoque: para ao atingir a meta mínima (antecipação da semana seguinte não solicitada)");
    if (!fc || !(fc.quantidade > 0)) return nao("sem meta mínima confirmada na semana seguinte para este produto e sem política de formação de estoque");
    const maxFinal = metaFuturaRestante(fc.quantidade, antCong[pid] ?? 0);
    if (!(maxFinal > 0)) return nao(`meta mínima da semana seguinte (${fc.quantidade}) já coberta pelo antecipado (${Math.round(antCong[pid] ?? 0)})`);
    const maquinasPorEtapa: Record<string, string[]> = {};
    for (const p of ps) maquinasPorEtapa[p.etapaId] = p.maquinasIds.filter((m) => (fc.maquinasPorEtapa[p.etapaId] ?? []).includes(m)); // interseção: máquinas selecionadas nas DUAS Previsões
    produtos.push({ produtoId: pid, origem: ORIGEM_ANTECIPACAO, maxFinal, metaMinima: qAtual, maquinasPorEtapa });
    diagnostico.push({ produtoId: pid, situacao: "ANTECIPA", motivo: `antecipação solicitada; meta mínima da semana seguinte ${fc.quantidade} (continua exibida inteira); já antecipado ${Math.round(antCong[pid] ?? 0)}; restante a adiantar ${maxFinal}`, maxFinal });
  });
  return { entrada: { produtos, ...(dados.bufferExtra ? { bufferExtra: dados.bufferExtra } : {}) }, diagnostico };
}

/** Aplica o desconto da semana de DESTINO nos itens previstos (quantidade líquida). Itens do mesmo produto são reduzidos em ordem; nunca abaixo de 0. Sem registros ⇒ devolve os MESMOS itens. */
export function aplicarDescontoNosItens<T extends { produtoId: string; quantidade: number }>(itens: T[], regs: RegistroAntecipacao[], descontaFormacao: boolean): { itens: T[]; descontos: { produtoId: string; origem: OrigemExtra; pecas: number; aplicado: boolean }[] } {
  if (regs.length === 0) return { itens, descontos: [] };
  const total: Record<string, number> = {};
  itens.forEach((i) => (total[i.produtoId] = (total[i.produtoId] ?? 0) + i.quantidade));
  const r = descontarAntecipadoNoDestino(total, regs, descontaFormacao);
  const faltaTirar: Record<string, number> = {};
  Object.keys(total).forEach((pid) => { const d = total[pid] - (r.quantidades[pid] ?? total[pid]); if (d > 0) faltaTirar[pid] = d; });
  if (Object.keys(faltaTirar).length === 0) return { itens, descontos: r.descontos };
  return { itens: itens.map((i) => { const f = faltaTirar[i.produtoId] ?? 0; if (f <= 0) return i; const t = Math.min(i.quantidade, f); faltaTirar[i.produtoId] = f - t; return { ...i, quantidade: i.quantidade - t }; }), descontos: r.descontos };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// RELATÓRIO META MÍNIMA × PRODUÇÃO PLANEJADA × PRODUÇÃO REAL × FORMAÇÃO DE ESTOQUE (puro; a mesma conta da view SQL escala_meta_estoque_v)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface LinhaRelatorioMeta {
  produtoId: string;
  /** quantidade da Previsão (META MÍNIMA de produção; nunca descontada na exibição) */
  metaMinima: number;
  producaoPlanejada: number;
  producaoReal: number;
  /** peças finais registradas no ledger como FORMACAO_ESTOQUE */
  formacaoEstoqueRegistrada: number;
  /** max(0, planejada − meta): estoque formado ALÉM da meta no plano (intencional: não é erro, excesso nem violação) */
  alemDaMetaPlanejado: number;
  /** max(0, real − meta): estoque formado ALÉM da meta até agora */
  alemDaMetaReal: number;
  /** quanto falta para a meta mínima segundo o real (0 se atingida) */
  faltaParaMeta: number;
}
export function relatorioMetaEstoque(a: { metas: Record<string, number>; planejada?: Record<string, number>; real?: Record<string, number>; formacao?: Record<string, number> }): LinhaRelatorioMeta[] {
  return Object.keys(a.metas).sort().map((pid) => {
    const meta = a.metas[pid], pl = a.planejada?.[pid] ?? 0, re = a.real?.[pid] ?? 0;
    return { produtoId: pid, metaMinima: meta, producaoPlanejada: pl, producaoReal: re, formacaoEstoqueRegistrada: a.formacao?.[pid] ?? 0, alemDaMetaPlanejado: Math.max(0, pl - meta), alemDaMetaReal: Math.max(0, re - meta), faltaParaMeta: Math.max(0, meta - re) };
  });
}

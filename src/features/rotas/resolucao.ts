// RESOLUÇÃO DA DIVISÃO COM FEEDBACK DA ESCALA (M3): Previsão (máquinas escolhidas por uma pessoa) → capacidade NOMINAL → planejador (AUTO/CONV) → adaptador de 3 cadeias → motor da Escala
// (pessoas, revezamento, ausências, máquina compartilhada por período) → capacidade REALIZÁVEL → teto de volta ao planejador. Até 3 rodadas.
//   • NUNCA acrescenta máquina: todas as rodadas usam exatamente `maquinasPorEtapa` da Previsão. Redistribuir é só entre o que foi selecionado.
//   • Critério de CONVERGÊNCIA: (a) `atendeu_alvo` — em todas as cadeias o motor realiza o alvo planejado; ou (b) `estabilizou` — o novo plano (com os tetos realizáveis) é igual ao anterior
//     (nenhuma compensação possível dentro do que foi selecionado). Caso contrário `limite_rodadas` (3): NÃO converge — nada é inventado, devolve o diagnóstico da última rodada.
//   • O que muda entre rodadas: só os TETOS por etapa (`capacidadeRealizavelEscala` = peças que o motor conseguiu realizar quando ficou abaixo do alvo). Seleção, demanda e metas não mudam.
//   • Cada rodada registra: hash da entrada do planejador, hash da entrada da Escala, tetos, alvo, capacidade nominal/realizável por rota, final planejado/realizável e o que faltou.
import { gerarEscala } from "@/features/escala/gerarEscala";
import { jsonCanonico, sha256Hex } from "@/features/escala/hashCanonico";
import { chavePool } from "@/features/escala/types";
import { dataNoFusoSP, planejamentoDaSemana } from "@/features/escala/wipSaldo";
import type { EstadoBruto } from "@/lib/escala/estado";
import { montarEntradaBase } from "@/lib/escala/montarEntrada";
import { CADEIA_COMUM, idVirtual, projetarEstado, type PlanoDoProduto } from "./adaptador";
import { previaComCompartilhamento, type EntradaPrevia, type ItemSelecionado, type MetasDaEtapa, type PreviaRotas } from "./compartilhada";
import type { ContextoCusto } from "./custo";
import { ALGORITMO_VERSAO, type GargaloPlano, type Motivo } from "./planejador";
import type { ContextoCapacidade, EtapaCadastro, PeriodoId } from "./tipos";

export const MAX_RODADAS_PADRAO = 3;
const TOL_PECAS = 0.5;
const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const h = (v: unknown) => sha256Hex(jsonCanonico(v));

export type MotivoParada = "atendeu_alvo" | "estabilizou" | "limite_rodadas" | "sem_cadeias";
export interface RodadaProduto {
  rodada: number; produtoId: string;
  hashEntradaPlanejador: string; hashEntradaEscala: string;
  tetos: Record<string, number>;                                   // etapaId -> peças realizáveis observadas (só etapas que ficaram abaixo do alvo)
  alvo: Record<string, number>; finalPlanejado: number;
  capacidadeNominalPorRota: Record<string, number>;
  capacidadeRealizavelPorRota: Record<string, number>;             // = nominal quando o motor entregou o alvo (nenhuma limitação observada)
  realizadoPorEtapa: Record<string, { alvo: number; realizado: number }>;
  finalRealizavel: number; faltaDeEntrega: boolean;
  gargalo: GargaloPlano; motivos: Motivo[];
  restante: { parcial: boolean; demandaRestante: number; produtoFinalExecutado: number; entregueAoPool: number; consumidoPeloPool: number; saldoDoPool: number; confirmadoPorEtapa: Record<string, number>; presumidoPorEtapa: Record<string, number>; semProducaoPorEtapa: Record<string, number> };   // replanejamento: de onde partiu o plano e o que é confirmado × presumido
}
export interface ResolucaoProduto {
  produtoId: string; rodadas: RodadaProduto[]; parada: MotivoParada; convergiu: boolean;
  plano: PlanoDoProduto; previa: PreviaRotas; diagnostico: string[];
  incertezas: string[];   // o replanejamento dependeu de produção PRESUMIDA (sem apontamento) — nunca apresentada como fato
}
export interface ResolucaoRotas { estadoVirtual: EstadoBruto; produtos: Record<string, ResolucaoProduto> }

// ---------- REPLANEJAMENTO no meio da semana ----------
// Passado: imutável (créditos congelados). Período em andamento e trocas manuais: preservados pela regra existente (aPartirDe). Futuro: o planejador recalcula AUTO/CONV só para o que FALTA,
// com a capacidade dos períodos que ainda vão ocorrer, a Produção Real como feedback (ou o congelado quando ainda não há apontamento) e o saldo do pool — sempre com as máquinas JÁ selecionadas.
export interface Restante {
  parcial: boolean; demanda: number; ocorrencias?: Partial<Record<PeriodoId, number>>;
  wipInicial?: { pool?: number; entreEtapasComuns?: Record<string, number> };
  creditoPorEtapa: Record<string, number>; executadoPorEtapa: Record<string, number>;
  entregueAoPool: number; consumidoPeloPool: number; produtoFinalExecutado: number;
  // origem do 'executado' por etapa (peças): CONFIRMADO por apontamento, SEM PRODUÇÃO registrada e PRESUMIDO (período passou sem apontamento: plano congelado, NÃO é produção real)
  confirmadoPorEtapa: Record<string, number>; presumidoPorEtapa: Record<string, number>; semProducaoPorEtapa: Record<string, number>;
}
// saldo inicial confirmado do WIP (só com wip_modo = 'ativo'): pool = Σ saldos alocados das ORIGENS que convergem; entre etapas comuns = saldo do controle daquela etapa
export function wipInicialDoEstado(estado: EstadoBruto, produtoId: string, agoraMs: number): Restante["wipInicial"] {
  const w = estado.wipControle;
  const estr = estado.rotas?.estruturas[produtoId];
  if (estado.parametros?.wipModo !== "ativo" || !w || !estr || w.controles.length === 0) return estado.rotas?.wipInicial?.[produtoId];
  const q: Record<string, number> = {}; estado.itens.forEach((i) => { q[i.produtoId] = (q[i.produtoId] ?? 0) + i.quantidade; });
  const semanas = [...w.semanas.filter((x) => x.semanaInicio !== estado.semanaInicio), { semanaInicio: estado.semanaInicio, quantidadePorProduto: q }];
  const plan = planejamentoDaSemana({ ...w, semanas, hoje: dataNoFusoSP(agoraMs) }, estado.semanaInicio);
  const origens = new Set((estr.convergencia?.origens ?? []).map((o) => o.etapaId));
  const comuns = estr.poolComum?.etapas ?? [];
  const mine = plan.saldos.filter((x) => x.produtoId === produtoId);
  const pool = mine.filter((x) => origens.has(x.etapaOrigemId)).reduce((t, x) => t + x.saldo, 0);
  const entre: Record<string, number> = {};
  comuns.slice(0, -1).forEach((id) => { const v = mine.filter((x) => x.etapaOrigemId === id).reduce((t, x) => t + x.saldo, 0); if (v > 0) entre[id] = v; });
  return { pool, entreEtapasComuns: entre };
}

export function calcularRestante(estado: EstadoBruto, produtoId: string, base: ReturnType<typeof montarEntradaBase>["entrada"], agoraMs = 0): Restante {
  const cfg = estado.rotas!; const estr = cfg.estruturas[produtoId];
  const D = estado.itens.filter((i) => i.produtoId === produtoId).reduce((s, i) => s + i.quantidade, 0);
  const wip0 = wipInicialDoEstado(estado, produtoId, agoraMs);
  const parcial = base.aPartirDe > 0 && base.aPartirDe < base.slots.length;
  if (!parcial) return { parcial: false, demanda: D, wipInicial: wip0, creditoPorEtapa: {}, executadoPorEtapa: {}, entregueAoPool: 0, consumidoPeloPool: 0, produtoFinalExecutado: 0, confirmadoPorEtapa: {}, presumidoPorEtapa: {}, semProducaoPorEtapa: {} };
  const ocorrencias: Partial<Record<PeriodoId, number>> = {};
  base.slots.slice(base.aPartirDe).forEach((sl) => { ocorrencias[sl.periodoId as PeriodoId] = (ocorrencias[sl.periodoId as PeriodoId] ?? 0) + 1; });
  const credito: Record<string, number> = {};
  base.congeladas.filter((a) => a.produtoId === produtoId && a.etapaId && a.maquinaId).forEach((a) => { credito[a.etapaId as string] = (credito[a.etapaId as string] ?? 0) + a.pecas; });
  // CONFIRMADO × PRESUMIDO × SEM PRODUÇÃO. Com a cobertura de apontamentos (servidor) a classificação é por período/máquina: slot congelado sem nenhum apontamento = PRESUMIDO (plano preservado, mas sinalizado);
  // com 'sem_producao' registrado = zero conhecido; com apontamento 'produzindo' = o apontado (produção real). Sem cobertura: `producaoReal` por etapa = confirmado; etapa sem chave = presumida.
  const confirmado: Record<string, number> = {}, presumido: Record<string, number> = {}, semProducao: Record<string, number> = {}, exec: Record<string, number> = {};
  const etapasDoProduto = new Set(estr.rotas.flatMap((r) => r.etapas).concat(estr.poolComum?.etapas ?? []));
  if (cfg.cobertura) {
    const porSlot = new Map<string, { etapaId: string | null; status: string }[]>();
    cfg.cobertura.forEach((c) => {
      const k = `${c.data}|${c.periodoId}|${c.maquinaId}`;
      porSlot.set(k, [...(porSlot.get(k) ?? []), { etapaId: c.etapaId, status: c.status }]);
      if (c.status === "produzindo" && c.etapaId && etapasDoProduto.has(c.etapaId)) confirmado[c.etapaId] = (confirmado[c.etapaId] ?? 0) + c.boas;
    });
    base.congeladas.filter((a) => a.produtoId === produtoId && a.etapaId && a.maquinaId).forEach((a) => {
      const linhas = porSlot.get(`${a.data}|${a.periodoId}|${a.maquinaId}`);
      const e = a.etapaId as string;
      if (!linhas || linhas.length === 0) presumido[e] = (presumido[e] ?? 0) + a.pecas;                              // passou e ninguém apontou
      else if (linhas.every((l) => l.status === "sem_producao")) semProducao[e] = (semProducao[e] ?? 0) + a.pecas;   // registrado "sem produção": zero conhecido
      // apontamento 'produzindo' na máquina: vale o que foi apontado (já somado em `confirmado`; se for de outro produto, o plano deste não se cumpriu)
    });
    etapasDoProduto.forEach((e) => { exec[e] = (confirmado[e] ?? 0) + (presumido[e] ?? 0); });
  } else {
    etapasDoProduto.forEach((e) => {
      const real = cfg.producaoReal?.[e];
      if (real !== undefined) { confirmado[e] = real; exec[e] = real; } else if ((credito[e] ?? 0) > 0) { presumido[e] = credito[e]; exec[e] = credito[e]; } else exec[e] = 0;
    });
  }
  const executado = (etapaId: string) => exec[etapaId] ?? 0;
  const comuns = estr.poolComum?.etapas ?? [];
  const entregue = estr.rotas.filter((r) => r.ativa && r.etapas.length > 0).reduce((s, r) => s + executado(r.etapas[r.etapas.length - 1]), 0);
  const consumido = comuns.length ? executado(comuns[0]) : 0;
  const pool0 = Math.max(0, (wip0?.pool ?? 0) + entregue - consumido);
  const entre: Record<string, number> = { ...(wip0?.entreEtapasComuns ?? {}) };
  comuns.slice(0, -1).forEach((id, k) => { entre[id] = Math.max(0, (entre[id] ?? 0) + executado(id) - executado(comuns[k + 1])); });
  const final = estr.etapaFinalId ? executado(estr.etapaFinalId) : 0;
  return {
    parcial: true, demanda: Math.max(0, D - final), ocorrencias, wipInicial: { pool: pool0, entreEtapasComuns: entre },
    creditoPorEtapa: credito, executadoPorEtapa: { ...exec }, confirmadoPorEtapa: confirmado, presumidoPorEtapa: presumido, semProducaoPorEtapa: semProducao,
    entregueAoPool: entregue, consumidoPeloPool: consumido, produtoFinalExecutado: final,
  };
}

export function produtosDeRotasDoEstado(estado: EstadoBruto): string[] {
  const est = estado.rotas?.estruturas ?? {};
  return Object.keys(est).filter((id) => estado.itens.some((i) => i.produtoId === id)).sort();
}

// ---------- entrada do planejador a partir do estado da Escala (uma só fonte: a seleção da Previsão) ----------
export function entradaPrevia(estado: EstadoBruto, produtoId: string, tetos: Record<string, number>, rest?: Restante, creditoOutros?: Record<string, Record<string, number>>): EntradaPrevia {
  const cfg = estado.rotas!;
  const estrutura = cfg.estruturas[produtoId];
  const nomeOp = (id: string) => estado.nomesOperacao[id] ?? id;
  const etapasProduto = estado.etapas.filter((e) => e.produtoId === produtoId);
  const etapas = new Map<string, EtapaCadastro>(etapasProduto.map((e) => [e.id, { id: e.id, operacaoId: e.operacaoId, operacao: nomeOp(e.operacaoId), ordem: e.ordem, metas: e.metas as Record<PeriodoId, number>, maquinasIds: [...(e.maquinasCompativeis ?? [])] }]));
  const itens = estado.itens.filter((i) => i.produtoId === produtoId);
  const selecao: Record<string, string[]> = {};
  itens.forEach((i) => Object.entries(i.maquinasPorEtapa).forEach(([etapaId, ms]) => {
    const compat = etapas.get(etapaId)?.maquinasIds ?? [];
    const validas = ms.filter((m) => compat.length === 0 || compat.includes(m));          // mesma defesa do motor: máquina não elegível no roteiro atual é ignorada
    selecao[etapaId] = [...new Set([...(selecao[etapaId] ?? []), ...validas])].sort();
  }));
  const periodos = estado.periodosAtuais.map((p) => ({ id: p.id as PeriodoId, minutos: min(p.fim) - min(p.inicio) }));
  const ctx: ContextoCapacidade = { periodos, diasProdutivos: estado.diasProdutivos.length, ...(rest?.ocorrencias ? { ocorrenciasPorPeriodo: rest.ocorrencias } : {}), maquinasIndisponiveis: [...new Set([...estado.maquinasIndisponiveisPrevisao, ...estado.maquinasInativas])].sort() };
  const outrosMapa = new Map<string, ItemSelecionado>();
  estado.itens.filter((i) => i.produtoId !== produtoId).forEach((i) => {
    const o = outrosMapa.get(i.produtoId) ?? { itemId: i.produtoId, produtoNome: estado.nomesProdutos?.[i.produtoId], quantidade: 0, selecao: {}, creditoPorEtapa: creditoOutros?.[i.produtoId] };
    o.quantidade += i.quantidade;
    Object.entries(i.maquinasPorEtapa).forEach(([e, ms]) => { o.selecao[e] = [...new Set([...(o.selecao[e] ?? []), ...ms])].sort(); });
    outrosMapa.set(i.produtoId, o);
  });
  const etapasDosOutros = new Map<string, MetasDaEtapa>(estado.etapas.map((e) => [e.id, { operacaoId: e.operacaoId, metas: e.metas as Record<PeriodoId, number> }]));
  const custo: ContextoCusto | undefined = cfg.custoHoraPorOperacao ? { periodos, custoHoraPorOperacao: cfg.custoHoraPorOperacao, custoHoraPadrao: cfg.custoHoraPadrao ?? 0 } : undefined;
  return {
    itemId: produtoId, estrutura, etapas, demanda: rest ? rest.demanda : itens.reduce((s, i) => s + i.quantidade, 0), ctx, selecao, ...(rest?.wipInicial ? { wipInicial: rest.wipInicial } : {}),
    capacidadeRealizavelEscala: Object.keys(tetos).length > 0 ? tetos : undefined,
    divisaoAnterior: cfg.divisaoAnterior?.[produtoId], toleranciaEstabilidade: cfg.toleranciaEstabilidade,
    custo, valorUnitario: Math.max(0, ...itens.map((i) => i.valorUnitario)),
    outros: [...outrosMapa.values()], etapasDosOutros, nomeDaMaquina: (id) => estado.nomesMaquinas?.[id] ?? id,
  };
}

const igual = (a: PlanoDoProduto, b: PlanoDoProduto) => Math.abs(a.final - b.final) <= TOL_PECAS && [...new Set([...Object.keys(a.alvo), ...Object.keys(b.alvo)])].every((r) => Math.abs((a.alvo[r] ?? 0) - (b.alvo[r] ?? 0)) <= TOL_PECAS);

export function resolverRotas(estado: EstadoBruto, agoraMs: number): ResolucaoRotas | null {
  const pids = produtosDeRotasDoEstado(estado);
  if (!estado.rotas || pids.length === 0) return null;
  const maxRodadas = estado.rotas.maxRodadas ?? MAX_RODADAS_PADRAO;
  const tetos: Record<string, Record<string, number>> = Object.fromEntries(pids.map((p) => [p, {}]));
  const hist: Record<string, RodadaProduto[]> = Object.fromEntries(pids.map((p) => [p, []]));
  const paradas: Record<string, MotivoParada> = {};
  let planosAnt: Record<string, PlanoDoProduto> | null = null;
  const previas: Record<string, PreviaRotas> = {};
  let planosFinais: Record<string, PlanoDoProduto> = {};

  // semana em andamento: slots futuros, créditos congelados e o que cada produto JÁ produziu (a base não depende do plano)
  const baseEntrada = montarEntradaBase(estado, agoraMs).entrada;
  const rest: Record<string, Restante> = Object.fromEntries(pids.map((p) => [p, calcularRestante(estado, p, baseEntrada, agoraMs)]));
  const creditoOutros: Record<string, Record<string, number>> = {};
  baseEntrada.congeladas.filter((a) => a.produtoId && a.etapaId && a.maquinaId && !pids.includes(a.produtoId)).forEach((a) => {
    const m = (creditoOutros[a.produtoId as string] ??= {}); m[a.etapaId as string] = (m[a.etapaId as string] ?? 0) + a.pecas;
  });
  const baseDaCadeia = (p: string): Record<string, number> => {
    const estr = estado.rotas!.estruturas[p]; const cr = rest[p].creditoPorEtapa; const out: Record<string, number> = {};
    if (!rest[p].parcial) return out;
    estr.rotas.filter((x) => x.ativa).forEach((x) => { out[x.codigo] = Math.max(0, ...x.etapas.map((id) => cr[id] ?? 0)); });
    out[CADEIA_COMUM] = Math.max(0, ...(estr.poolComum?.etapas ?? []).map((id) => cr[id] ?? 0));
    return out;
  };

  for (let r = 1; r <= maxRodadas; r++) {
    const planos: Record<string, PlanoDoProduto> = {}; const entradas: Record<string, EntradaPrevia> = {};
    pids.forEach((p) => {
      entradas[p] = entradaPrevia(estado, p, tetos[p], rest[p], creditoOutros); previas[p] = previaComCompartilhamento(entradas[p]);
      planos[p] = { alvo: { ...previas[p].plano.alvo }, final: previas[p].plano.finalAtingivel, comum: Math.max(previas[p].plano.finalAtingivel, previas[p].plano.wip.consumoPool), ...(rest[p].parcial ? { base: baseDaCadeia(p) } : {}) };
    });
    if (planosAnt && pids.every((p) => igual(planos[p], (planosAnt as Record<string, PlanoDoProduto>)[p]))) { pids.forEach((p) => (paradas[p] = "estabilizou")); break; }   // sem compensação possível dentro da seleção
    planosFinais = planos; planosAnt = planos;

    const estadoV = projetarEstado(estado, planos);
    const montada = montarEntradaBase(estadoV, agoraMs);
    const resultado = gerarEscala(montada.entrada);
    const hashEscala = h(montada.entrada);
    let algumaFalta = false;
    pids.forEach((p) => {
      const estr = estado.rotas!.estruturas[p]; const plano = planos[p]; const prev = previas[p].plano;
      const real: Record<string, { alvo: number; realizado: number }> = {};
      // alvo e realizado são do FUTURO (o que ainda faltava planejar); o motor desconta o congelado de cada etapa
      const registrar = (cadeia: string, etapas: string[], q: number) => etapas.forEach((id) => {
        const virt = idVirtual(p, cadeia); const k = chavePool(virt, id);
        const tem = montada.entrada.pools.find((x) => x.produtoId === virt && x.etapaId === id);
        const qTotal = (plano.base?.[cadeia] ?? 0) + q;
        const jaFeito = rest[p].creditoPorEtapa[id] ?? 0;
        real[id] = { alvo: q, realizado: q <= 0 ? 0 : tem ? Math.max(0, qTotal - jaFeito - (resultado.pecasRestantes[k] ?? 0)) : 0 };
      });
      estr.rotas.filter((x) => x.ativa).forEach((x) => registrar(x.codigo, x.etapas, plano.alvo[x.codigo] ?? 0));
      registrar(CADEIA_COMUM, estr.poolComum?.etapas ?? [], plano.comum ?? plano.final);
      const abaixo = Object.entries(real).filter(([, v]) => v.alvo > 0 && v.realizado < v.alvo - TOL_PECAS);
      const novosTetos = { ...tetos[p] }; abaixo.forEach(([id, v]) => { novosTetos[id] = Math.min(novosTetos[id] ?? Infinity, v.realizado); });
      const nominal = Object.fromEntries(estr.rotas.filter((x) => x.ativa).map((x) => [x.codigo, hist[p][0]?.capacidadeNominalPorRota[x.codigo] ?? prev.capacidadePorRota[x.codigo].realizavel]));
      // realizável da rota = o menor entre o que o motor realizou abaixo do alvo e os tetos já conhecidos de rodadas anteriores; sem nenhuma limitação observada = a nominal
      const realizavel = Object.fromEntries(estr.rotas.filter((x) => x.ativa).map((x) => {
        const lim = Math.min(...x.etapas.map((id) => Math.min(novosTetos[id] ?? Infinity, real[id].realizado < real[id].alvo - TOL_PECAS ? real[id].realizado : Infinity)));
        return [x.codigo, Number.isFinite(lim) ? Math.min(lim, nominal[x.codigo]) : nominal[x.codigo]];
      }));
      const oferta = estr.rotas.filter((x) => x.ativa).reduce((s, x) => s + Math.min(plano.alvo[x.codigo] ?? 0, ...x.etapas.map((id) => real[id].realizado)), 0);
      const comumReal = Math.min(...(estr.poolComum?.etapas ?? []).map((id) => real[id].realizado), Infinity);
      const finalRealizavel = Math.max(0, Math.min(oferta, Number.isFinite(comumReal) ? comumReal : oferta));
      const falta = abaixo.length > 0;
      algumaFalta = algumaFalta || falta;
      hist[p].push({
        rodada: r, produtoId: p, hashEntradaPlanejador: h({ ...entradaSerializavel(entradas[p]) }), hashEntradaEscala: hashEscala, tetos: { ...tetos[p] }, alvo: { ...plano.alvo }, finalPlanejado: plano.final, restante: { parcial: rest[p].parcial, demandaRestante: rest[p].demanda, produtoFinalExecutado: rest[p].produtoFinalExecutado, entregueAoPool: rest[p].entregueAoPool, consumidoPeloPool: rest[p].consumidoPeloPool, saldoDoPool: rest[p].wipInicial?.pool ?? 0, confirmadoPorEtapa: rest[p].confirmadoPorEtapa, presumidoPorEtapa: rest[p].presumidoPorEtapa, semProducaoPorEtapa: rest[p].semProducaoPorEtapa },
        capacidadeNominalPorRota: nominal, capacidadeRealizavelPorRota: realizavel, realizadoPorEtapa: real, finalRealizavel, faltaDeEntrega: falta, gargalo: prev.gargalo, motivos: prev.motivos,
      });
      tetos[p] = novosTetos;
    });
    if (!algumaFalta) { pids.forEach((p) => (paradas[p] = "atendeu_alvo")); break; }
    if (r === maxRodadas) pids.forEach((p) => (paradas[p] = hist[p][hist[p].length - 1].faltaDeEntrega ? "limite_rodadas" : "atendeu_alvo"));
  }

  const produtos: Record<string, ResolucaoProduto> = {};
  pids.forEach((p) => {
    const ult = hist[p][hist[p].length - 1];
    const parada = paradas[p] ?? "limite_rodadas";
    const diagnostico: string[] = []; const incertezas: string[] = [];
    if (ult) Object.entries(ult.realizadoPorEtapa).filter(([, v]) => v.realizado < v.alvo - TOL_PECAS).forEach(([id, v]) => diagnostico.push(`etapa ${estado.nomesOperacao[estado.etapas.find((e) => e.id === id)?.operacaoId ?? ""] ?? id}: planejado ${Math.round(v.alvo)}, a Escala realiza ${Math.round(v.realizado)}`));
    Object.entries(ult?.restante.presumidoPorEtapa ?? {}).filter(([, v]) => v > TOL_PECAS).forEach(([id, v]) => incertezas.push(`${estado.nomesOperacao[estado.etapas.find((e) => e.id === id)?.operacaoId ?? ""] ?? id}: ${Math.round(v).toLocaleString("pt-BR")} peças de períodos passados SEM apontamento foram PRESUMIDAS como produzidas (plano congelado) — não confirmadas por apontamento`));
    if (parada === "limite_rodadas") diagnostico.push(`não convergiu em ${maxRodadas} rodadas: a divisão da última rodada não foi inventada nem ajustada; veja o realizável por etapa`);
    produtos[p] = { produtoId: p, rodadas: hist[p], parada, convergiu: parada !== "limite_rodadas", plano: planosFinais[p], previa: previas[p], diagnostico, incertezas };
  });
  return { estadoVirtual: projetarEstado(estado, planosFinais), produtos };
}

// parte da entrada do planejador que identifica a rodada (sem funções nem Maps): mesma entrada => mesmo hash
function entradaSerializavel(e: EntradaPrevia) {
  return {
    produtoId: e.estrutura.produtoId, demanda: e.demanda, ctx: e.ctx, selecao: e.selecao, tetos: e.capacidadeRealizavelEscala ?? {}, tol: e.toleranciaEstabilidade ?? null, anterior: e.divisaoAnterior ?? null, wip: e.wipInicial ?? null,
    etapas: [...e.etapas.values()].map((x) => ({ id: x.id, metas: x.metas })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    outros: e.outros.map((o) => ({ id: o.itemId, q: o.quantidade, s: o.selecao, c: o.creditoPorEtapa ?? null })).sort((a, b) => (a.id < b.id ? -1 : 1)), algoritmo: ALGORITMO_VERSAO,
  };
}

// linhas para escala_rota_divisao (append-only): uma por rota e por rodada; a rodada final é marcada
export interface RegistroDivisao {
  previsaoId: string; produtoId: string; semanaInicio: string; rotaId: string | null; rotaCodigo: string; rodada: number; rodadaFinal: boolean;
  quantidadeAlvo: number; capacidadeNominal: number; capacidadeRealizavel: number; algoritmoVersao: string; hashEntrada: string; hashEscala: string;
  gargalo: GargaloPlano; motivo: { codigos: Motivo[]; parada: MotivoParada; convergiu: boolean; tetos: Record<string, number>; final: { planejado: number; realizavel: number }; restante: RodadaProduto["restante"]; diagnostico: string[]; incertezas: string[] };
}
export function registrosDeDivisao(estado: EstadoBruto, res: ResolucaoRotas): RegistroDivisao[] {
  const out: RegistroDivisao[] = [];
  Object.values(res.produtos).forEach((p) => {
    const estr = estado.rotas!.estruturas[p.produtoId];
    p.rodadas.forEach((r, i) => estr.rotas.filter((x) => x.ativa).forEach((x) => out.push({
      previsaoId: estado.previsaoId, produtoId: p.produtoId, semanaInicio: estado.semanaInicio, rotaId: x.id, rotaCodigo: x.codigo, rodada: r.rodada, rodadaFinal: i === p.rodadas.length - 1,
      quantidadeAlvo: r.alvo[x.codigo] ?? 0, capacidadeNominal: r.capacidadeNominalPorRota[x.codigo], capacidadeRealizavel: r.capacidadeRealizavelPorRota[x.codigo], algoritmoVersao: ALGORITMO_VERSAO,
      hashEntrada: r.hashEntradaPlanejador, hashEscala: r.hashEntradaEscala, gargalo: r.gargalo,
      motivo: { codigos: r.motivos, parada: p.parada, convergiu: p.convergiu, tetos: r.tetos, final: { planejado: r.finalPlanejado, realizavel: r.finalRealizavel }, restante: r.restante, diagnostico: p.diagnostico, incertezas: p.incertezas },
    })));
  });
  return out;
}

// PLANEJADOR DE CORTE — ADAPTADOR entre o recálculo oficial (EntradaEscala + Produção Real + contagens) e o planejador puro do futuro (planejadorFuturo.ts). PURO (sem IO/relógio).
//
// Papel (ativação controlada da semana 02/11): a cada evento (ausência, apontamento, contagem, mudança) o plano do FUTURO da semana é refeito por `planejarFuturo`, partindo de:
//   (a) o PASSADO CONGELADO (slots < aPartirDe: linhas já gravadas + período em andamento) — nunca reescrito;
//   (b) a PRODUÇÃO REAL dos períodos fechados e as contagens físicas, que reconstroem o WIP do início do 1º período livre (prepararFluxo/montarEstado — o mesmo núcleo do fluxo; lote de 1 período
//       quando `fluxoMesmoPeriodo=false`) e a demanda final RESTANTE por produto;
//   (c) a equipe disponível por período (ausências), as máquinas da Previsão disponíveis por período e as metas por posto.
// Saída: linhas pessoa→posto dos slots livres com DISTRIBUICAO_DA_QUANTIDADE_POR_PRODUTO por alocação física + validação independente. NUNCA devolve plano inválido: `ok:false` ⇒ o chamador
// mantém o plano vigente (jamais cai para o motor legado numa semana ativada).
//
// Enquadramento "recomeço em aPartirDe": o planejador recebe demanda = RESTANTE e WIP = estado em aPartirDe; a produção congelada entra como zero (já está refletida no restante/WIP).
import { expandirPorProduto, distribuicaoEfetiva } from "../distribuicao";
import { maquinaDisponivelNoSlot } from "../disponibilidade";
import type { ApontamentoReal } from "../producaoReal";
import { MOTIVO_DEMANDA_ESGOTADA, chavePool, type AlertaEscala, type AlocacaoEscala, type EntradaEscala, type PoolEscala, type ResultadoEscala } from "../types";
import { montarEstado, prepararFluxo } from "./estado";
import { planejarFuturo, type EntradaPlanejador, type ObjetivoPlanejador, type SaidaPlanejador } from "./planejadorFuturo";
import type { ProdutoRev, RecursoRev } from "./planoReverso";
import { verificarRestricoesDuras } from "./restricoes";
import type { DadosProducaoReal, DiagnosticoItem, EstadoFluxo, OpcoesFluxo, ViolacaoDura } from "./tipos";

export interface ConfigPlanejadorCorte {
  /** default EQUILIBRIO (decisão do usuário 02/11); MAX_RESULTADO_ECONOMICO não é usado por padrão */
  objetivo?: ObjetivoPlanejador;
  /** R$ de margem por peça final, por produtoId — SNAPSHOT congelado na ativação (determinismo: o recálculo não muda de objetivo sozinho). Ausente ⇒ valorUnitario do pool. */
  margemPorPeca?: Record<string, number>;
  /** EQUILIBRIO: piso de peças finais da semana por produto = coberturaMinima × demanda (default do planejador 0,45) */
  coberturaMinima?: number;
  prioridade?: string[];
  busca?: { iter?: number; reinicios?: number; semente?: number };
  /** orçamento menor quando há plano vigente do próprio planejador como partida */
  buscaComVigente?: { iter?: number; reinicios?: number; semente?: number };
  /** usa as linhas do plano vigente (futuro) como partida da busca — só faz sentido quando o vigente foi gerado por este planejador */
  partirDoVigente?: boolean;
}

export interface TentativaCorte { rotulo: string; ok: boolean; motivo: string | null; ms?: number }

export interface ResultadoCorte {
  ok: boolean;
  motivo: string | null;
  resultado: ResultadoEscala | null;
  saida: SaidaPlanejador | null;
  violacoes: ViolacaoDura[];
  checagens: ChecagensCorte;
  tentativas: TentativaCorte[];
  diagnosticos: DiagnosticoItem[];
  estado: EstadoFluxo;
  entradaPlanejador: EntradaPlanejador | null;
}

/** Resultado das verificações INDEPENDENTES aplicadas ao plano do planejador (todas precisam passar para `ok`). */
export interface ChecagensCorte {
  cadeiaInvalida: number; // violações de cadeia (lote de 1 período) nos slots livres
  semMaterial: number; // peças planejadas sem material (downstream sem upstream)
  violacoesDuras: number; // verificarRestricoesDuras (revezamento, ausência, máquina, posto, passado)
  maquinaForaDaPrevisao: number; // item de distribuição em máquina fora da seleção da Previsão para o seu produto|etapa
  distribuicaoInvalida: number; // Σ distribuição ≠ pecas da linha, produto da linha não dominante etc.
  maxPostosSimultaneos: number;
  pessoasMin: number; // menor nº de pessoas disponíveis num slot livre
  excedePessoas: number; // slots com mais postos que pessoas
  passadoAlterado: number;
  duplicidade: number; // pessoa em 2 postos ou máquina com 2 pessoas
}

const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);
const chaveSlot = (a: { data: string; periodoId: string }) => `${a.data}|${a.periodoId}`;

/**
 * Linha compartilhada (Etiquetadora 15/Embalagem 17 com 2 produtos): o apontamento é UM por máquina×período (unique no banco), com o produto escolhido por quem lança.
 * Aqui as boas/refugo desse apontamento são REPARTIDAS entre os produtos da linha na proporção da distribuição PLANEJADA daquele período. Total preservado.
 * Só para apontamentos cujo produto pertence à linha (ou sem produto); qualquer outro fica como está (APONTAMENTO_FORA_DO_PLANO no núcleo).
 */
export function repartirApontamentosCompartilhados(apontamentos: ApontamentoReal[], planoVigente: AlocacaoEscala[]): { apontamentos: ApontamentoReal[]; repartidos: number } {
  const dist = new Map<string, NonNullable<ReturnType<typeof distribuicaoEfetiva>>>();
  planoVigente.forEach((a) => {
    const d = distribuicaoEfetiva(a);
    if (d && a.maquinaId) dist.set(`${chaveSlot(a)}|${a.maquinaId}`, d);
  });
  if (dist.size === 0) return { apontamentos, repartidos: 0 };
  let repartidos = 0;
  const out: ApontamentoReal[] = [];
  apontamentos.forEach((ap) => {
    const d = ap.maquinaId ? dist.get(`${chaveSlot(ap)}|${ap.maquinaId}`) : undefined;
    if (!d || ap.status !== "produzindo" || (ap.produtoId && !d.some((x) => x.produtoId === ap.produtoId))) { out.push(ap); return; }
    const total = soma(d.map((x) => x.pecas));
    if (total <= 0) { out.push(ap); return; }
    repartidos++;
    let boasResto = ap.boas, refResto = ap.refugo, metaResto = ap.meta;
    d.forEach((x, i) => {
      const ultimo = i === d.length - 1;
      const f = x.pecas / total;
      const boas = ultimo ? boasResto : Math.round(ap.boas * f), refugo = ultimo ? refResto : Math.round(ap.refugo * f), meta = ultimo ? metaResto : Math.round(ap.meta * f);
      boasResto -= boas; refResto -= refugo; metaResto -= meta;
      out.push({ ...ap, produtoId: x.produtoId, etapaId: x.etapaId, boas, refugo, meta });
    });
  });
  return { apontamentos: out, repartidos };
}

interface ProblemaMontado {
  entradaPlanejador: EntradaPlanejador;
  estado: EstadoFluxo;
  produtos: ProdutoRev[];
  poolPor: Map<string, PoolEscala>;
  repartidos: number;
}

/** Monta a entrada do planejador a partir do estado real. Ids opacos; taxas = metas efetivas do pool por período (já com o f de desempenho embutido pelo chamador). */
export function montarProblemaCorte(entrada: EntradaEscala, dados: DadosProducaoReal, opcoes: OpcoesFluxo, cfg: ConfigPlanejadorCorte, planoVigenteBruto: AlocacaoEscala[]): ProblemaMontado {
  // 1) estado de produção real: apontamentos de linha compartilhada repartidos por produto; plano vigente/congeladas na visão POR PRODUTO (atribuição de quantidade)
  const rep = repartirApontamentosCompartilhados(dados.apontamentos, planoVigenteBruto);
  const dadosP: DadosProducaoReal = { ...dados, apontamentos: rep.apontamentos, planoVigente: expandirPorProduto(dados.planoVigente) };
  const entradaP: EntradaEscala = { ...entrada, congeladas: expandirPorProduto(entrada.congeladas) };
  const opcoesP: OpcoesFluxo = { ...opcoes };
  delete opcoesP.paresLegado; // cada produto tem a SUA cadeia (a distribuição por produto é do plano; contagens/apontamentos são por produto)
  const ctx = prepararFluxo(entradaP, dadosP, opcoesP);
  const estado = montarEstado(ctx);

  // 2) produtos / rotas / taxas
  const H = entrada.slots.length;
  const porProduto = new Map<string, PoolEscala[]>();
  entrada.pools.forEach((p) => (porProduto.get(p.produtoId) ?? porProduto.set(p.produtoId, []).get(p.produtoId)!).push(p));
  porProduto.forEach((ps) => ps.sort((a, b) => a.ordemEtapa - b.ordemEtapa));
  const poolPor = new Map(entrada.pools.map((p) => [chavePool(p.produtoId, p.etapaId), p]));
  const restante = new Map(estado.produtos.map((p) => [p.produtoId, p.restanteEmAPartirDe]));
  const produtos: ProdutoRev[] = [...porProduto.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([pid, ps]) => {
    const wip = ps.slice(0, -1).map((p) => Math.round(estado.projecao.wip[chavePool(pid, p.etapaId)]?.lo ?? 0));
    return {
      id: pid, rotulo: pid, demandaFinal: Math.max(0, Math.round(restante.get(pid) ?? ps[ps.length - 1].quantidade)), valorUnitario: ps[0].valorUnitario,
      recorrentePorPeriodo: ps[ps.length - 1].quantidade / Math.max(1, H), wipInicial: wip,
      etapas: ps.map((p) => ({ id: p.etapaId, rotulo: p.operacaoId, alternativas: p.maquinasIds.map((m) => ({ recursoId: m, pecasPorPosto: entrada.slots.map((s) => p.metas[s.periodoId] ?? 0) })) })),
    };
  });
  const maquinas = [...new Set(entrada.pools.flatMap((p) => p.maquinasIds))].sort();
  const recursos: RecursoRev[] = maquinas.map((m) => ({ id: m, rotulo: m, unidades: entrada.slots.map((s) => (maquinaDisponivelNoSlot(entrada, m, s) ? 1 : 0)) }));
  const ausentes: Record<number, string[]> = {};
  entrada.slots.forEach((s) => {
    const aus = entrada.funcionarios.map((f) => f.id).filter((fid) => entrada.ausencias.some((x) => x.funcionarioId === fid && x.data === s.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < s.fimMin && x.fimMin > s.inicioMin))));
    if (aus.length > 0) ausentes[s.indice] = aus;
  });
  const operacaoDe = (pid: string, eid: string) => (poolPor.get(chavePool(pid, eid)) as PoolEscala).operacaoId;
  const wipInicio = Object.fromEntries(produtos.map((p) => [p.id, p.wipInicial]));
  const linhasIniciais = cfg.partirDoVigente
    ? planoVigenteBruto.filter((a) => a.maquinaId && a.operacaoId && (entrada.slots.find((s) => chaveSlot(s) === chaveSlot(a))?.indice ?? -1) >= entrada.aPartirDe).map((a) => ({ t: (entrada.slots.find((s) => chaveSlot(s) === chaveSlot(a)) as { indice: number }).indice, recursoId: a.maquinaId as string, operacaoId: a.operacaoId as string }))
    : undefined;
  const entradaPlanejador: EntradaPlanejador = {
    slots: entrada.slots, aPartirDe: entrada.aPartirDe, recursos, produtos, equipe: entrada.funcionarios.map((f) => ({ id: f.id })), ausentes,
    linhasCongeladas: entrada.congeladas, producaoCongelada: {}, wipNoInicioDeAPartirDe: wipInicio,
    objetivo: cfg.objetivo ?? "EQUILIBRIO", ...(cfg.margemPorPeca ? { margemPorPeca: cfg.margemPorPeca } : {}), ...(cfg.coberturaMinima !== undefined ? { coberturaMinima: cfg.coberturaMinima } : {}),
    ...(cfg.prioridade ? { prioridade: cfg.prioridade } : {}), operacaoDe, ...(linhasIniciais && linhasIniciais.length > 0 ? { linhasIniciais } : {}),
    revezamento: { ponteM3T1: entrada.revezamentoPonteM3T1 === true, ...(entrada.equivalenciaOperacoes ? { equivalencias: entrada.equivalenciaOperacoes } : {}) },
    busca: linhasIniciais && linhasIniciais.length > 0 ? cfg.buscaComVigente ?? cfg.busca : cfg.busca,
    verificarDuras: (linhas) => verificarRestricoesDuras(entrada, linhas.filter((l) => (entrada.slots.find((s) => chaveSlot(s) === chaveSlot(l))?.indice ?? 0) >= entrada.aPartirDe), { somenteLinhasNovas: true }).length,
  };
  return { entradaPlanejador, estado, produtos, poolPor, repartidos: rep.repartidos };
}

/** Linhas do planejador → AlocacaoEscala gravável (distribuição só quando ≥ 2 produtos; produto da linha = dominante). */
export function linhasGravaveis(saida: SaidaPlanejador): AlocacaoEscala[] {
  return saida.linhas.map((l) => {
    const { distribuicao, ...base } = l;
    const efetiva = distribuicaoEfetiva({ produtoId: l.produtoId, etapaId: l.etapaId, pecas: l.pecas, distribuicao });
    return { ...base, origem: "auto" as const, ...(efetiva ? { distribuicao: efetiva } : {}) };
  });
}

/** Verificações independentes do plano do planejador (nada aqui reusa o motor do planejador). */
export function checarPlanoCorte(entrada: EntradaEscala, linhas: AlocacaoEscala[], saida: SaidaPlanejador, poolPor: Map<string, PoolEscala>): { checagens: ChecagensCorte; violacoes: ViolacaoDura[] } {
  const violacoes = verificarRestricoesDuras(entrada, linhas, { somenteLinhasNovas: true });
  const livres = entrada.slots.filter((s) => s.indice >= entrada.aPartirDe);
  // máquina da Previsão para CADA item da distribuição (não só para o produto dominante da linha)
  let foraPrevisao = 0, distInvalida = 0;
  const visto = new Set<string>();
  let duplicidade = 0;
  linhas.forEach((a) => {
    if (a.maquinaId) {
      const itens = distribuicaoEfetiva(a) ?? [{ produtoId: a.produtoId as string, etapaId: a.etapaId as string, pecas: a.pecas }];
      itens.forEach((it) => { const p = poolPor.get(chavePool(it.produtoId, it.etapaId)); if (!p || !p.maquinasIds.includes(a.maquinaId as string)) foraPrevisao++; });
      const soma2 = a.distribuicao ? soma(a.distribuicao.map((x) => x.pecas)) : a.pecas;
      if (Math.abs(soma2 - a.pecas) > 1e-3) distInvalida++;
      const dom = a.distribuicao && a.distribuicao.length > 0 ? a.distribuicao.reduce((x, y) => (y.pecas > x.pecas ? y : x)) : null;
      if (dom && a.distribuicao!.filter((x) => x.pecas === dom.pecas).length === 1 && (dom.produtoId !== a.produtoId || dom.etapaId !== a.etapaId)) distInvalida++;
      const km = `${chaveSlot(a)}|m|${a.maquinaId}`;
      if (visto.has(km)) duplicidade++;
      visto.add(km);
    }
    const kp = `${chaveSlot(a)}|p|${a.funcionarioId}`;
    if (visto.has(kp)) duplicidade++;
    visto.add(kp);
  });
  const postosPorSlot = new Map<number, number>();
  linhas.forEach((a) => { if (a.maquinaId) { const t = entrada.slots.find((s) => chaveSlot(s) === chaveSlot(a))!.indice; postosPorSlot.set(t, (postosPorSlot.get(t) ?? 0) + 1); } });
  const pessoasSlot = livres.map((s) => entrada.funcionarios.filter((f) => !entrada.ausencias.some((x) => x.funcionarioId === f.id && x.data === s.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < s.fimMin && x.fimMin > s.inicioMin)))).length);
  const excede = livres.filter((s, i) => (postosPorSlot.get(s.indice) ?? 0) > pessoasSlot[i]).length;
  const passado = violacoes.filter((v) => v.tipo === "passado_alterado").length;
  return {
    violacoes,
    checagens: {
      cadeiaInvalida: saida.validacao.violacoesCadeia, semMaterial: Math.round(saida.validacao.semMaterial), violacoesDuras: violacoes.length, maquinaForaDaPrevisao: foraPrevisao, distribuicaoInvalida: distInvalida,
      maxPostosSimultaneos: Math.max(0, ...postosPorSlot.values()), pessoasMin: pessoasSlot.length ? Math.min(...pessoasSlot) : 0, excedePessoas: excede, passadoAlterado: passado, duplicidade,
    },
  };
}

export function checagensOk(c: ChecagensCorte): boolean {
  return c.cadeiaInvalida === 0 && c.semMaterial === 0 && c.violacoesDuras === 0 && c.maquinaForaDaPrevisao === 0 && c.distribuicaoInvalida === 0 && c.excedePessoas === 0 && c.passadoAlterado === 0 && c.duplicidade === 0;
}

function resultadoDe(entrada: EntradaEscala, linhas: AlocacaoEscala[], saida: SaidaPlanejador, produtos: ProdutoRev[]): ResultadoEscala {
  const alertas: AlertaEscala[] = [];
  const pecasRestantes: Record<string, number> = {};
  saida.porProduto.forEach((p) => {
    const prod = produtos.find((x) => x.id === p.produtoId) as ProdutoRev;
    const ultima = prod.etapas[prod.etapas.length - 1];
    // `demanda` aqui é a RESTANTE em aPartirDe (enquadramento de recomeço): cortado = o que não cabe fisicamente com as pessoas/máquinas
    const cortado = Math.max(0, Math.round(p.cortado));
    pecasRestantes[chavePool(p.produtoId, ultima.id)] = cortado;
    if (cortado > 0) alertas.push({ tipo: "demanda_nao_atendida", produtoId: p.produtoId, etapaId: ultima.id, pecas: cortado, motivo: "Corte explícito do planejador: a demanda restante não cabe fisicamente com as pessoas e máquinas disponíveis" });
  });
  const resumoSlots = entrada.slots.filter((s) => s.indice >= entrada.aPartirDe).map((s) => {
    const l = linhas.filter((a) => chaveSlot(a) === chaveSlot(s));
    return { data: s.data, periodoId: s.periodoId, funcionariosDisponiveis: l.length, postosComDemanda: l.filter((a) => a.maquinaId).length, postosPreenchidos: l.filter((a) => a.maquinaId).length, semPosto: l.filter((a) => !a.maquinaId).length };
  });
  return { alocacoes: linhas, alertas, resumoSlots, primeiraGeracaoComSemanaEmAndamento: false, pecasRestantes, adicionalProduzido: {} };
}

/**
 * Planeja o futuro da semana. Escada de tentativas (cada degrau só vale se TODAS as checagens independentes passam):
 *   1) planejador com o objetivo/piso configurados; 2) mesmo planejador com piso de cobertura 0 e outra semente (cobre ausências que deixam o piso inatingível);
 *   se nada passa ⇒ `ok:false` (o chamador MANTÉM o plano vigente e registra o motivo — nunca grava plano inválido nem recai no motor legado).
 */
export function planejarSemanaComCorte(entrada: EntradaEscala, dados: DadosProducaoReal, opcoes: OpcoesFluxo, cfg: ConfigPlanejadorCorte, planoVigenteBruto: AlocacaoEscala[] = dados.planoVigente): ResultadoCorte {
  const tentativas: TentativaCorte[] = [];
  const diagnosticos: DiagnosticoItem[] = [];
  const m = montarProblemaCorte(entrada, dados, opcoes, cfg, planoVigenteBruto);
  if (m.repartidos > 0) diagnosticos.push({ codigo: "APONTAMENTO_LINHA_COMPARTILHADO_REPARTIDO", severidade: "info", mensagem: `${m.repartidos} apontamento(s) de linha compartilhada repartido(s) entre os produtos pela distribuição planejada do período (um apontamento por máquina×período)` });
  const falha = (motivo: string, estado: EstadoFluxo): ResultadoCorte => ({ ok: false, motivo, resultado: null, saida: null, violacoes: [], checagens: { cadeiaInvalida: 0, semMaterial: 0, violacoesDuras: 0, maquinaForaDaPrevisao: 0, distribuicaoInvalida: 0, maxPostosSimultaneos: 0, pessoasMin: 0, excedePessoas: 0, passadoAlterado: 0, duplicidade: 0 }, tentativas, diagnosticos, estado, entradaPlanejador: m.entradaPlanejador });
  if (m.produtos.every((p) => p.demandaFinal <= 0)) {
    // nada a produzir: demanda final atendida — todos sem posto (plano válido e vazio)
    const linhas: AlocacaoEscala[] = [];
    entrada.slots.filter((s) => s.indice >= entrada.aPartirDe).forEach((s) => {
      entrada.funcionarios.filter((f) => !entrada.ausencias.some((x) => x.funcionarioId === f.id && x.data === s.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < s.fimMin && x.fimMin > s.inicioMin)))).forEach((f) =>
        linhas.push({ data: s.data, periodoId: s.periodoId, funcionarioId: f.id, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, motivoSemPosto: MOTIVO_DEMANDA_ESGOTADA, excecaoRevezamento: false, motivoExcecao: null, origem: "auto" }));
    });
    const saidaVazia = { linhas: [], linhasPostos: [], porProduto: m.produtos.map((p) => ({ produtoId: p.id, demanda: 0, programado: 0, cortado: 0, futuro: 0 })), wip: {}, producao: {}, validacao: { cadeiaValida: true, violacoesCadeia: 0, violacoesDuras: 0, maxPostosSimultaneos: 0, semMaterial: 0, atribuicaoOk: true }, avisos: [], objetivoValor: 0 } as SaidaPlanejador;
    const chk = checarPlanoCorte(entrada, linhas, saidaVazia, m.poolPor);
    tentativas.push({ rotulo: "demanda atendida", ok: checagensOk(chk.checagens), motivo: null });
    diagnosticos.push({ codigo: "DEMANDA_FINAL_ATENDIDA", severidade: "info", mensagem: "Demanda restante zerada em todos os produtos: nenhuma produção a planejar" });
    return { ok: checagensOk(chk.checagens), motivo: null, resultado: resultadoDe(entrada, linhas, saidaVazia, m.produtos), saida: saidaVazia, violacoes: chk.violacoes, checagens: chk.checagens, tentativas, diagnosticos, estado: m.estado, entradaPlanejador: m.entradaPlanejador };
  }
  const degraus: { rotulo: string; ajuste: Partial<EntradaPlanejador> }[] = [
    { rotulo: "objetivo configurado", ajuste: {} },
    { rotulo: "piso de cobertura 0 e outra semente", ajuste: { coberturaMinima: 0, pisoPorProduto: undefined, busca: { ...(m.entradaPlanejador.busca ?? {}), semente: (m.entradaPlanejador.busca?.semente ?? 1) + 6 }, linhasIniciais: undefined } },
  ];
  for (const g of degraus) {
    try {
      const saida = planejarFuturo({ ...m.entradaPlanejador, ...g.ajuste });
      const linhas = linhasGravaveis(saida);
      const chk = checarPlanoCorte(entrada, linhas, saida, m.poolPor);
      const ok = checagensOk(chk.checagens);
      tentativas.push({ rotulo: g.rotulo, ok, motivo: ok ? null : `checagens: ${JSON.stringify(chk.checagens)}` });
      if (ok) return { ok: true, motivo: null, resultado: resultadoDe(entrada, linhas, saida, m.produtos), saida, violacoes: chk.violacoes, checagens: chk.checagens, tentativas, diagnosticos: [...diagnosticos, ...saida.avisos.map((a) => ({ codigo: "PLANEJADOR_AVISO" as const, severidade: "info" as const, mensagem: a }))], estado: m.estado, entradaPlanejador: m.entradaPlanejador };
    } catch (e) {
      tentativas.push({ rotulo: g.rotulo, ok: false, motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  return falha(`nenhuma tentativa do planejador passou nas checagens independentes (${tentativas.map((t) => `${t.rotulo}: ${t.motivo}`).join(" | ")})`, m.estado);
}

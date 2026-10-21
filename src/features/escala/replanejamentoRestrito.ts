// REPLANEJAMENTO DINÂMICO RESTRITO — núcleo PURO. Transforma a decisão de um corte (DecisaoCorte) numa PROPOSTA de gravação para a Escala
// oficial, valida-a e explica o que muda e quem continua ocioso. Nada aqui lê banco, relógio ou escreve: o serviço (sombraServico) aplica.
//
// O que a proposta pode regravar:
//   • SEMPRE só o futuro alterável (c+2 em diante);
//   • o próximo período (comprometido, c+1) somente quando o REPARO MÍNIMO o alterou (revezamento duro / impossibilidade física);
//   • nunca passado nem período em andamento.
// O que ela NUNCA pode fazer (validarProposta recusa): repetir operação consecutiva, usar ausente/máquina indisponível/máquina fora da Previsão,
// duplicar pessoa ou máquina no período, ultrapassar o limite de estoque de WIP, trocar previsto por WIP enquanto ainda falta previsto,
// ou deixar o previsto pior do que a Escala oficial vigente.

import { maquinaDisponivelNoSlot } from "./disponibilidade";
import { EPS } from "./folga";
import { hashAlocacoes } from "./horizonte";
import { visaoNoCorte, type DecisaoCorte, type ParametrosCorte } from "./sombraCorte";
import { chavePool, MOTIVO_DEMANDA_ESGOTADA, MOTIVO_JA_COBERTA, MOTIVO_POSTOS_OCUPADOS, MOTIVO_RECURSOS_INDISPONIVEIS, MOTIVO_REVEZAMENTO, type AlocacaoEscala, type EntradaEscala, type SlotEscala } from "./types";
import { restanteAcabado } from "./execucao";
import type { DinamicaCorte } from "./gargaloDinamico";
import { classificarMudancas, estabilizarPessoas } from "./estabilidade";

export type NaturezaMudanca =
  | "wip_removido" // tinha WIP/adicional e passou a ocioso
  | "wip_adicionado" // ocioso passou a ter WIP/adicional
  | "wip_trocado_por_previsto" // WIP cede a máquina/pessoa ao previsto
  | "previsto_trocado_por_wip" // (proibido enquanto falta previsto)
  | "previsto_adicionado" // ocioso passou a produzir previsto
  | "previsto_removido" // produzia previsto e passou a ocioso
  | "realocado" // muda de posto sem mudar a natureza
  | "mudou_peca"; // mesmo posto, outra quantidade

export interface PostoResumo { maquinaId: string | null; produtoId: string | null; etapaId: string | null; pecas: number; pecasAdicional: number; tipoAdicional: string | null }
export interface MudancaLinha { data: string; periodoId: string; funcionarioId: string; antes: PostoResumo | null; depois: PostoResumo | null; natureza: NaturezaMudanca }

export interface ResumoMudancas {
  linhasAlteradas: number;
  previstoAntes: number; // peças de previsto planejadas na região (oficial) × (proposta)
  previstoDepois: number;
  adicionalAntes: number; // adicional/WIP planejado na região
  adicionalDepois: number;
  wipRemovido: number; // peças de adicional que saíram
  wipAdicionado: number; // peças de adicional que entraram
  ociososAntes: number; // pessoa-períodos sem posto
  ociososDepois: number;
  porNatureza: Partial<Record<NaturezaMudanca, number>>;
}

export type VereditoProposta = "aplicar" | "sem_mudanca" | "recusar";
export interface PropostaRestrita {
  c: number;
  aPartirSlot: number | null; // primeiro período regravado (null = nada a gravar)
  aPartir: { data: string; periodoId: string } | null;
  reparoDoComprometido: boolean;
  linhas: AlocacaoEscala[]; // TODAS as linhas de aPartir em diante, como ficarão
  oficialRegiao: AlocacaoEscala[]; // como estavam (plano oficial lido junto com a decisão)
  hashProposta: string;
  hashOficialRegiao: string;
  mudancas: MudancaLinha[];
  resumo: ResumoMudancas;
  trocasManuaisPreservadas: number;
  trocasManuaisPerdidas: number; // manual que o motor não pôde manter (inválida) — registrado
  veredito: VereditoProposta;
  violacoes: string[]; // vazio quando válida
  motivoVeredito: string; // por que aplicar / por que nada a gravar (controle de oscilação)
  ganho: { previsto: number; wipRemovido: number; wipAdicionado: number; ociososPreenchidos: number; reparo: boolean }; // o que justifica gravar
  churn: ChurnProposta; // quanto da mudança é produtiva e quanto é só troca equivalente de pessoa
  wip: MetricasWip; // WIP antes/depois, pessoa-horas e ociosidade evitada, motivo de cada aumento
}

export interface ChurnProposta {
  linhasAlteradas: number; // pessoa-períodos que mudam em relação à Escala vigente (já com a estabilidade aplicada)
  produtivas: number; // mudança real de posto/máquina/produto/peças/WIP
  trocasEquivalentes: number; // só muda QUEM ocupa o mesmo posto
  poupadasPelaEstabilidade: number; // linhas que o desempate por estabilidade manteve iguais à vigente
  periodosAjustados: number;
}
export interface MetricasWip {
  antes: number; // peças de adicional/WIP planejadas na região (vigente)
  depois: number;
  delta: number;
  pessoaPeriodosWip: number; // postos de WIP na proposta
  pessoaHorasWip: number;
  ociososSemWip: number; // pessoa-períodos que ficariam ociosos na mesma região SEM nenhum WIP
  ociososEvitados: number; // quantos desses o WIP ocupa
  postosAcrescidos: number; // postos de WIP que a proposta ACRESCENTA em relação à Escala vigente (o aumento, não o total)
  horasAcrescidas: number; // pessoa-horas desses postos acrescentados (todas em pessoas que ficariam ociosas)
  ociososEvitadosHoras: number;
  semOciosidade: { periodo: string; wipPostos: number; ociososSemWip: number }[]; // WIP que NÃO ocupa ociosidade (proibido)
  classificacao: "ocupa_ociosidade" | "sem_ociosidade" | "reducao" | "neutro";
  aumentos: { periodo: string; de: number; para: number; motivo: string }[]; // por período: de quantos postos de WIP para quantos, e por quê
}

/** Fração do restante do acabado abaixo da qual uma diferença de falta é ruído do motor (nem ganho nem piora). */
export const FRACAO_RUIDO_PREVISTO = 0.001;
/** Mudança LÍQUIDA de WIP só justifica regravar a Escala se for ≥ esta fração do WIP planejado na região (e ≥ LIMIAR_WIP_MINIMO peças). Evita reescrever o futuro por ruído. */
export const FRACAO_WIP_RELEVANTE = 0.02;
export const LIMIAR_WIP_MINIMO = 100;

const TOL_PECAS = 0.5;
const ruidoPrevisto = (dec: DecisaoCorte, pools: ParametrosCorte["base"]["pools"]) => Math.max(1, FRACAO_RUIDO_PREVISTO * restanteAcabado(pools, dec.restantePorPool));

const posto = (a: AlocacaoEscala): PostoResumo => ({ maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, pecas: a.maquinaId ? a.pecas : 0, pecasAdicional: a.maquinaId ? a.pecasAdicional ?? 0 : 0, tipoAdicional: a.tipoAdicional ?? null });
const chaveLinha = (a: { data: string; periodoId: string; funcionarioId: string }) => `${a.data}|${a.periodoId}|${a.funcionarioId}`;
const chaveTroca = (a: { data: string; periodoId: string; funcionarioId: string; maquinaId: string | null }) => `${chaveLinha(a)}|${a.maquinaId ?? ""}`;
const mesmoPosto = (x: PostoResumo, y: PostoResumo) => x.maquinaId === y.maquinaId && x.produtoId === y.produtoId && x.etapaId === y.etapaId;
const iguais = (x: PostoResumo, y: PostoResumo) => mesmoPosto(x, y) && Math.abs(x.pecas - y.pecas) <= TOL_PECAS && Math.abs(x.pecasAdicional - y.pecasAdicional) <= TOL_PECAS;

function natureza(a: PostoResumo | null, d: PostoResumo | null): NaturezaMudanca {
  const ativoA = !!a?.maquinaId, ativoD = !!d?.maquinaId;
  if (!ativoA && ativoD) return (d as PostoResumo).pecasAdicional > 0 && (d as PostoResumo).pecas <= 0 ? "wip_adicionado" : "previsto_adicionado";
  if (ativoA && !ativoD) return (a as PostoResumo).pecasAdicional > 0 && (a as PostoResumo).pecas <= 0 ? "wip_removido" : "previsto_removido";
  const wA = (a as PostoResumo).pecasAdicional > 0 && (a as PostoResumo).pecas <= 0, wD = (d as PostoResumo).pecasAdicional > 0 && (d as PostoResumo).pecas <= 0;
  if (wA && !wD) return "wip_trocado_por_previsto";
  if (!wA && wD) return "previsto_trocado_por_wip";
  return mesmoPosto(a as PostoResumo, d as PostoResumo) ? "mudou_peca" : "realocado";
}

export function diferencas(antes: AlocacaoEscala[], depois: AlocacaoEscala[]): MudancaLinha[] {
  const mapaA = new Map(antes.map((a) => [chaveLinha(a), a]));
  const mapaD = new Map(depois.map((a) => [chaveLinha(a), a]));
  const chaves = [...new Set([...mapaA.keys(), ...mapaD.keys()])].sort();
  const r: MudancaLinha[] = [];
  chaves.forEach((k) => {
    const a = mapaA.get(k), d = mapaD.get(k);
    const pa = a ? posto(a) : null, pd = d ? posto(d) : null;
    if (pa && pd && iguais(pa, pd)) return;
    if (!pa?.maquinaId && !pd?.maquinaId) return; // ocioso ↔ sem linha (ex.: ausente) não é mudança de posto
    const ref = (d ?? a) as AlocacaoEscala;
    r.push({ data: ref.data, periodoId: ref.periodoId, funcionarioId: ref.funcionarioId, antes: pa, depois: pd, natureza: natureza(pa, pd) });
  });
  return r;
}

function resumir(oficial: AlocacaoEscala[], novo: AlocacaoEscala[], mud: MudancaLinha[]): ResumoMudancas {
  const soma = (rows: AlocacaoEscala[], f: (a: AlocacaoEscala) => number) => rows.reduce((s, a) => s + (a.maquinaId ? f(a) : 0), 0);
  const porNatureza: Partial<Record<NaturezaMudanca, number>> = {};
  mud.forEach((m) => (porNatureza[m.natureza] = (porNatureza[m.natureza] ?? 0) + 1));
  const adicA = soma(oficial, (a) => a.pecasAdicional ?? 0), adicD = soma(novo, (a) => a.pecasAdicional ?? 0);
  return {
    linhasAlteradas: mud.length, previstoAntes: Math.round(soma(oficial, (a) => a.pecas)), previstoDepois: Math.round(soma(novo, (a) => a.pecas)), adicionalAntes: Math.round(adicA), adicionalDepois: Math.round(adicD),
    wipRemovido: Math.round(mud.reduce((s, m) => s + Math.max(0, (m.antes?.pecasAdicional ?? 0) - (m.depois?.pecasAdicional ?? 0)), 0)),
    wipAdicionado: Math.round(mud.reduce((s, m) => s + Math.max(0, (m.depois?.pecasAdicional ?? 0) - (m.antes?.pecasAdicional ?? 0)), 0)),
    ociososAntes: oficial.filter((a) => !a.maquinaId).length, ociososDepois: novo.filter((a) => !a.maquinaId).length, porNatureza,
  };
}

// Plano efetivo do corte: executado (≤ c) + comprometido efetivo + alterável proposto.
export const planoEfetivo = (dec: DecisaoCorte): AlocacaoEscala[] => [...dec.horizonte.congeladas, ...dec.horizonte.comprometidas, ...dec.horizonte.alteravel];

// `oficial` = plano oficial VIGENTE no momento da leitura (o mesmo que alimentou a decisão).
export function construirProposta(par: ParametrosCorte, dec: DecisaoCorte): PropostaRestrita {
  const slots = par.base.slots;
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? Number.POSITIVE_INFINITY;
  const hz = dec.horizonte;
  const reparou = hz.horizonte.comprometido !== null && hz.snapshot.hashComprometido !== hz.snapshot.hashComprometidoReparado;
  const aPartirSlot = reparou ? (hz.horizonte.comprometido as number) : hz.horizonte.primeiroAlteravel;
  if (aPartirSlot === null || !slots[aPartirSlot]) {
    return { c: par.c, aPartirSlot: null, aPartir: null, reparoDoComprometido: false, linhas: [], oficialRegiao: [], hashProposta: hashAlocacoes([]), hashOficialRegiao: hashAlocacoes([]), mudancas: [], resumo: resumir([], [], []), trocasManuaisPreservadas: 0, trocasManuaisPerdidas: 0, veredito: "sem_mudanca", violacoes: [], motivoVeredito: "sem período alterável", ganho: { previsto: 0, wipRemovido: 0, wipAdicionado: 0, ociososPreenchidos: 0, reparo: false }, churn: { linhasAlteradas: 0, produtivas: 0, trocasEquivalentes: 0, poupadasPelaEstabilidade: 0, periodosAjustados: 0 }, wip: { antes: 0, depois: 0, delta: 0, pessoaPeriodosWip: 0, pessoaHorasWip: 0, ociososSemWip: 0, ociososEvitados: 0, postosAcrescidos: 0, horasAcrescidas: 0, ociososEvitadosHoras: 0, semOciosidade: [], classificacao: "neutro", aumentos: [] } };
  }
  const oficialRegiao = par.planoOficial.filter((a) => idx(a) >= aPartirSlot);
  const manuais = new Set(oficialRegiao.filter((a) => a.origem === "manual").map(chaveTroca));
  const bruto = [...(reparou ? hz.comprometidas : []), ...hz.alteravel].filter((a) => idx(a) >= aPartirSlot);
  const ordenar = (rows: AlocacaoEscala[]) => rows.sort((a, b) => idx(a) - idx(b) || (a.funcionarioId < b.funcionarioId ? -1 : 1));
  const marcado = ordenar(bruto.map((a) => (manuais.has(chaveTroca(a)) ? { ...a, origem: "manual" as const } : a)));
  const antes = [...hz.congeladas, ...(reparou ? [] : hz.comprometidas)].filter((a) => idx(a) < aPartirSlot);
  const est = estabilizarPessoas(marcado, oficialRegiao, antes, slots);
  const montar = (linhas: AlocacaoEscala[]): PropostaRestrita => {
    const mudancas = diferencas(oficialRegiao, linhas);
    const cl = classificarMudancas(oficialRegiao, linhas, slots, mudancas.length);
    const brutaMud = diferencas(oficialRegiao, marcado).length;
    const prop: PropostaRestrita = {
      c: par.c, aPartirSlot, aPartir: { data: slots[aPartirSlot].data, periodoId: slots[aPartirSlot].periodoId }, reparoDoComprometido: reparou, linhas, oficialRegiao,
      hashProposta: hashAlocacoes(linhas), hashOficialRegiao: hashAlocacoes(oficialRegiao), mudancas, resumo: resumir(oficialRegiao, linhas, mudancas),
      trocasManuaisPreservadas: linhas.filter((a) => a.origem === "manual").length, trocasManuaisPerdidas: manuais.size - linhas.filter((a) => a.origem === "manual").length,
      veredito: "sem_mudanca", violacoes: [], motivoVeredito: "", ganho: { previsto: 0, wipRemovido: 0, wipAdicionado: 0, ociososPreenchidos: 0, reparo: reparou },
      churn: { linhasAlteradas: mudancas.length, produtivas: cl.produtivas, trocasEquivalentes: cl.trocasEquivalentes, poupadasPelaEstabilidade: Math.max(0, brutaMud - mudancas.length), periodosAjustados: linhas === marcado ? 0 : est.periodosAjustados },
      wip: metricasWip(par, dec, aPartirSlot, oficialRegiao, linhas),
    };
    return { ...prop, violacoes: validarProposta(par, dec, prop) };
  };
  // estabilidade como desempate: tenta primeiro a versão estabilizada; se ela (improvavelmente) violar algo e a original não, usa a original
  let prop = montar(est.estabilizou ? est.linhas : marcado);
  if (est.estabilizou && prop.violacoes.length > 0) { const alt = montar(marcado); if (alt.violacoes.length === 0) prop = alt; }
  const mudancas = prop.mudancas;
  const violacoes = prop.violacoes;
  // CONTROLE DE OSCILAÇÃO: só grava se há ganho que o justifique (previsto melhor, WIP que ocupa ociosidade, ocioso preenchido, reparo obrigatório);
  // um replanejamento que só embaralha pessoas sem ganho é ruído e fica de fora.
  const ruido = ruidoPrevisto(dec, par.base.pools);
  const ganho = { previsto: Math.round(Math.max(0, dec.faltaOficial.total - dec.faltaSombra.total)), wipRemovido: prop.resumo.wipRemovido, wipAdicionado: prop.resumo.wipAdicionado, ociososPreenchidos: Math.max(0, prop.resumo.ociososAntes - prop.resumo.ociososDepois), reparo: reparou };
  const wipLiquido = prop.resumo.adicionalDepois - prop.resumo.adicionalAntes;
  const wipRelevante = Math.abs(wipLiquido) >= Math.max(LIMIAR_WIP_MINIMO, FRACAO_WIP_RELEVANTE * Math.max(prop.resumo.adicionalAntes, prop.resumo.adicionalDepois));
  const justifica = ganho.previsto > ruido || wipRelevante || ganho.ociososPreenchidos > 0 || reparou;
  if (violacoes.length > 0) return { ...prop, ganho, veredito: "recusar", motivoVeredito: violacoes.join("; ") };
  if (mudancas.length === 0) return { ...prop, ganho, veredito: "sem_mudanca", motivoVeredito: "a proposta coincide com a Escala oficial" };
  if (!justifica) return { ...prop, ganho, veredito: "sem_mudanca", motivoVeredito: "diferença sem ganho (previsto, WIP ou ociosidade): mantida a Escala oficial" };
  return { ...prop, ganho, veredito: "aplicar", motivoVeredito: [ganho.previsto > ruido ? `previsto −${ganho.previsto} pç de falta` : "", wipRelevante && wipLiquido < 0 ? `WIP −${Math.round(-wipLiquido)} pç líquidos` : "", wipRelevante && wipLiquido > 0 ? `WIP +${Math.round(wipLiquido)} pç líquidos (ocupa ${prop.wip.ociososEvitados} pessoa-período(s) ociosa(s))` : "", ganho.ociososPreenchidos > 0 ? `${ganho.ociososPreenchidos} ocioso(s) preenchido(s)` : "", reparou ? "reparo ergonômico/físico do comprometido" : ""].filter(Boolean).join("; ") };
}

const rotuloPeriodo = (s: { data: string; periodoId: string }) => `${s.data.slice(8)}/${s.data.slice(5, 7)} ${s.periodoId.toUpperCase()}`;

// WIP na região: quanto, e SE ele ocupa pessoas que ficariam ociosas sem ele (WIP nunca é objetivo; só preenche o que sobra)
function metricasWip(par: ParametrosCorte, dec: DecisaoCorte, aPartirSlot: number, oficial: AlocacaoEscala[], linhas: AlocacaoEscala[]): MetricasWip {
  const slots = par.base.slots;
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1;
  const adic = (rows: AlocacaoEscala[]) => rows.reduce((x, a) => x + (a.maquinaId ? a.pecasAdicional ?? 0 : 0), 0);
  const antes = adic(oficial), depois = adic(linhas);
  const per = (dec.wipPreenchimento?.periodos ?? []).filter((x) => x.indice >= aPartirSlot);
  const semOciosidade = per.filter((x) => x.wipPostos > x.ociososSemWip).map((x) => ({ periodo: rotuloPeriodo(x), wipPostos: x.wipPostos, ociososSemWip: x.ociososSemWip }));
  const evitados = per.reduce((x, p) => x + Math.min(p.wipPostos, p.ociososSemWip), 0);
  const horasEvit = per.reduce((x, p) => x + (Math.min(p.wipPostos, p.ociososSemWip) * p.minutos) / 60, 0);
  const postos = per.reduce((x, p) => x + p.wipPostos, 0);
  const horas = per.reduce((x, p) => x + (p.wipPostos * p.minutos) / 60, 0);
  const oficialPostos = new Map<number, number>();
  oficial.filter((a) => a.maquinaId && (a.pecasAdicional ?? 0) > 0).forEach((a) => oficialPostos.set(idx(a), (oficialPostos.get(idx(a)) ?? 0) + 1));
  const aumentos = per.filter((p) => p.wipPostos > (oficialPostos.get(p.indice) ?? 0)).map((p) => ({
    periodo: rotuloPeriodo(p), de: oficialPostos.get(p.indice) ?? 0, para: p.wipPostos,
    motivo: p.wipPostos <= p.ociososSemWip ? `ocupa ${p.wipPostos} pessoa(s) que ficariam ociosas (sem trabalho de maior prioridade)` : `SEM OCIOSIDADE: ${p.wipPostos} posto(s) de WIP para ${p.ociososSemWip} pessoa(s) ociosa(s)`,
  }));
  return {
    antes: Math.round(antes), depois: Math.round(depois), delta: Math.round(depois - antes), pessoaPeriodosWip: postos, pessoaHorasWip: Math.round(horas * 10) / 10, ociososSemWip: per.reduce((x, p) => x + p.ociososSemWip, 0),
    postosAcrescidos: per.reduce((x, p) => x + Math.max(0, p.wipPostos - (oficialPostos.get(p.indice) ?? 0)), 0), horasAcrescidas: Math.round(per.reduce((x, p) => x + (Math.max(0, p.wipPostos - (oficialPostos.get(p.indice) ?? 0)) * p.minutos) / 60, 0) * 10) / 10,
    ociososEvitados: evitados, ociososEvitadosHoras: Math.round(horasEvit * 10) / 10, semOciosidade,
    classificacao: semOciosidade.length > 0 ? "sem_ociosidade" : depois > antes + 0.5 ? "ocupa_ociosidade" : depois < antes - 0.5 ? "reducao" : "neutro", aumentos,
  };
}

// ---------- validação (cada violação é um motivo de recusa; vazio = pode gravar) ----------
export function validarProposta(par: ParametrosCorte, dec: DecisaoCorte, prop: PropostaRestrita): string[] {
  const v: string[] = [];
  if (prop.aPartirSlot === null) return v;
  const slots = par.base.slots;
  const vis = visaoNoCorte(par);
  const ent: EntradaEscala = { ...par.base, ausencias: vis.ausencias, indisponibilidades: vis.indisponibilidades };
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? Number.POSITIVE_INFINITY;
  const slotDe = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId) as SlotEscala | undefined;

  // 1) região: nada antes de aPartir, nada no passado/atual; o comprometido só no reparo
  prop.linhas.forEach((a) => { if (idx(a) < (prop.aPartirSlot as number)) v.push(`linha fora da região alterável (${a.data} ${a.periodoId})`); });
  if (!prop.reparoDoComprometido && prop.aPartirSlot <= par.c + 1) v.push("proposta regrava o período comprometido sem reparo");
  if (prop.aPartirSlot <= par.c) v.push("proposta regrava período já iniciado");

  // 2) integridade física de cada linha
  const usoPessoa = new Set<string>(), usoMaquina = new Set<string>();
  prop.linhas.forEach((a) => {
    const s = slotDe(a);
    if (!s) { v.push(`período inexistente ${a.data} ${a.periodoId}`); return; }
    const kp = chaveLinha(a);
    if (usoPessoa.has(kp)) v.push(`pessoa duplicada no período (${kp})`);
    usoPessoa.add(kp);
    if (!a.maquinaId) return;
    const km = `${a.data}|${a.periodoId}|${a.maquinaId}`;
    if (usoMaquina.has(km)) v.push(`máquina duplicada no período (${km})`);
    usoMaquina.add(km);
    if (!maquinaDisponivelNoSlot(ent, a.maquinaId, s)) v.push(`máquina indisponível alocada (${km})`);
    const pool = ent.pools.find((p) => p.produtoId === a.produtoId && p.etapaId === a.etapaId);
    if (!pool || !pool.maquinasIds.includes(a.maquinaId)) v.push(`máquina fora da Previsão (${km})`);
    if (ent.ausencias.some((x) => x.funcionarioId === a.funcionarioId && x.data === a.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < s.fimMin && s.inicioMin < x.fimMin)))) v.push(`pessoa ausente alocada (${kp})`);
  });

  // 3) REVEZAMENTO ABSOLUTO sobre a linha do tempo completa (executado + efetivo): 0 repetições, 0 exceções
  const efetivo = [...dec.horizonte.congeladas, ...dec.horizonte.comprometidas.filter((a) => idx(a) < (prop.aPartirSlot as number)), ...prop.linhas];
  const porPessoa = new Map<string, Map<number, AlocacaoEscala>>();
  efetivo.forEach((a) => { const i = idx(a); if (!Number.isFinite(i)) return; if (!porPessoa.has(a.funcionarioId)) porPessoa.set(a.funcionarioId, new Map()); porPessoa.get(a.funcionarioId)!.set(i, a); });
  porPessoa.forEach((m, f) => m.forEach((a, i) => {
    if (i < (prop.aPartirSlot as number)) return; // só pares que a PROPOSTA cria (o histórico executado, mesmo com repetição antiga, não é culpa dela)
    const ant = m.get(i - 1);
    if (!ant || slots[i]?.primeiroDoDia || !a.maquinaId || !ant.maquinaId || !a.operacaoId) return;
    if (ant.operacaoId === a.operacaoId) v.push(`repetição de operação (${f.slice(0, 6)} ${a.data} ${a.periodoId})`);
  }));
  if (prop.linhas.some((a) => a.excecaoRevezamento)) v.push("exceção de revezamento na proposta");

  // 4) WIP: estoque entre etapas nunca acima do limite (inclui confirmado)
  if (par.base.wip && dec.wip) {
    const lim = par.base.wip.limites, conf = par.base.wip.estoqueConfirmado ?? {};
    const real: Record<string, number> = {};
    dec.wip.pares.forEach((p) => { real[chavePool(p.produtoId, p.etapaId)] = p.realizado; });
    const porProduto = new Map<string, typeof par.base.pools>();
    [...par.base.pools].sort((a, b) => a.ordemEtapa - b.ordemEtapa).forEach((p) => porProduto.set(p.produtoId, [...(porProduto.get(p.produtoId) ?? []), p]));
    const adicPorSlot = new Map<string, number>(); // `${i}|${chavePool}` -> adicional
    efetivo.forEach((a) => { if (a.maquinaId && a.produtoId && a.etapaId && (a.pecasAdicional ?? 0) > 0) { const k = `${idx(a)}|${chavePool(a.produtoId, a.etapaId)}`; adicPorSlot.set(k, (adicPorSlot.get(k) ?? 0) + (a.pecasAdicional ?? 0)); } });
    porProduto.forEach((etapas) => etapas.slice(0, -1).forEach((pl, k) => {
      const kk = chavePool(pl.produtoId, pl.etapaId), ks = chavePool(etapas[k + 1].produtoId, etapas[k + 1].etapaId);
      const L = lim[kk];
      if (L === undefined) return;
      let A = real[kk] ?? 0, B = real[ks] ?? 0;
      // O que já foi executado/comprometido pode ter levado o estoque ACIMA do limite sem culpa da proposta (produção real maior que a planejada):
      // a proposta só não pode ACRESCENTAR estoque além de max(limite, estoque no início da região que ela regrava).
      let inicio = (conf[kk] ?? 0) + Math.max(0, A - B);
      slots.forEach((s) => {
        A += adicPorSlot.get(`${s.indice}|${kk}`) ?? 0;
        B += adicPorSlot.get(`${s.indice}|${ks}`) ?? 0;
        const estoque = (conf[kk] ?? 0) + Math.max(0, A - B);
        if (s.indice === (prop.aPartirSlot as number) - 1) inicio = estoque;
        if (s.indice >= (prop.aPartirSlot as number) && estoque > Math.max(L, inicio) + 1 + EPS) v.push(`WIP acima do limite (${kk.slice(0, 6)}… ${s.data} ${s.periodoId}: ${Math.round(estoque)} > ${Math.round(Math.max(L, inicio))})`);
      });
    }));
  }

  // 5) prioridade do previsto: o previsto nunca perde máquina/pessoa para WIP enquanto ainda falta previsto, e nunca fica pior que o oficial
  const ruido = ruidoPrevisto(dec, par.base.pools);
  // WIP nunca tira capacidade do previsto — prova CAUSAL: o mesmo replanejamento SEM nenhum adicional não pode ter previsto melhor que o com WIP
  const sem = dec.faltaSemWip;
  if (sem) {
    if (dec.faltaSombra.total > sem.total + ruido) v.push(`WIP prejudica o previsto (falta ${Math.round(sem.total)} sem WIP → ${Math.round(dec.faltaSombra.total)} com WIP)`);
    par.base.pools.forEach((pl) => {
      const k = chavePool(pl.produtoId, pl.etapaId);
      const r = Math.max(1, FRACAO_RUIDO_PREVISTO * (dec.restantePorPool[k] ?? 0));
      if ((dec.faltaSombra.porPool[k] ?? 0) > (sem.porPool[k] ?? 0) + r) v.push(`WIP prejudica o previsto de ${k.slice(0, 6)}… (falta ${Math.round(sem.porPool[k] ?? 0)} → ${Math.round(dec.faltaSombra.porPool[k] ?? 0)})`);
    });
  }
  // WIP só ocupa pessoa que ficaria OCIOSA: em nenhum período da região há mais postos de WIP do que pessoas sem trabalho de prioridade maior
  prop.wip.semOciosidade.forEach((x) => v.push(`WIP sem ociosidade (${x.periodo}: ${x.wipPostos} posto(s) de WIP, ${x.ociososSemWip} pessoa(s) ociosa(s) sem ele)`));
  if (!prop.reparoDoComprometido && dec.faltaSombra.total > dec.faltaOficial.total + ruido) v.push(`previsto piora (${Math.round(dec.faltaOficial.total)} → ${Math.round(dec.faltaSombra.total)})`);
  return [...new Set(v)];
}

// ---------- diagnóstico exato de ociosidade futura ----------
export type CausaOciosidade = "sem_trabalho_valido" | "revezamento_duro" | "maquina_indisponivel" | "limite_wip" | "material" | "nenhuma_maquina_compativel" | "outro";
export interface OciosidadeFutura { data: string; periodoId: string; funcionarioId: string; causa: CausaOciosidade; detalhe: string }

export function diagnosticarOciosidade(par: ParametrosCorte, dec: DecisaoCorte, linhas: AlocacaoEscala[] = planoEfetivo(dec)): OciosidadeFutura[] {
  const slots = par.base.slots;
  const vis = visaoNoCorte(par);
  const ent: EntradaEscala = { ...par.base, ausencias: vis.ausencias, indisponibilidades: vis.indisponibilidades };
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? Number.POSITIVE_INFINITY;
  const futuras = linhas.filter((a) => idx(a) > par.c);
  const ocupadas = new Map<number, Set<string>>();
  futuras.forEach((a) => { if (a.maquinaId) { const i = idx(a); if (!ocupadas.has(i)) ocupadas.set(i, new Set()); ocupadas.get(i)!.add(a.maquinaId); } });
  const opAnterior = (f: string, i: number) => {
    if (slots[i]?.primeiroDoDia) return null;
    const a = linhas.find((x) => x.funcionarioId === f && idx(x) === i - 1);
    return a?.maquinaId ? a.operacaoId : null;
  };
  const wipPares = new Map((dec.wip?.pares ?? []).map((p) => [chavePool(p.produtoId, p.etapaId), p]));
  const flexivel = new Set(par.base.pools.filter((p) => (p.adicionalMax ?? 0) > 0).map((p) => p.produtoId));
  const adicAte = (k: string, i: number) => (wipPares.get(k)?.realizado ?? 0) + linhas.filter((a) => a.maquinaId && a.produtoId && a.etapaId && chavePool(a.produtoId, a.etapaId) === k && idx(a) > par.c && idx(a) <= i).reduce((s, a) => s + (a.pecasAdicional ?? 0), 0);
  const ultima = new Map<string, number>();
  par.base.pools.forEach((p) => ultima.set(p.produtoId, Math.max(ultima.get(p.produtoId) ?? 0, p.ordemEtapa)));

  const r: OciosidadeFutura[] = [];
  futuras.filter((a) => !a.maquinaId).forEach((a) => {
    const s = slots[idx(a)];
    if (!s) return;
    if (ent.ausencias.some((x) => x.funcionarioId === a.funcionarioId && x.data === a.data && (x.inicioMin === null || x.fimMin === null || (x.inicioMin < s.fimMin && s.inicioMin < x.fimMin)))) return; // ausente não é ocioso
    const base = { data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId };
    // O motor registra o motivo EXATO de cada posto vazio; ele manda. Só ESGOTADA/JA_COBERTA deixam espaço para o WIP — aí refinamos (limite, material, rotação).
    if (a.motivoSemPosto === MOTIVO_REVEZAMENTO) { r.push({ ...base, causa: "revezamento_duro", detalhe: "todo trabalho válido repetiria a operação do período anterior" }); return; }
    if (a.motivoSemPosto === MOTIVO_POSTOS_OCUPADOS) { r.push({ ...base, causa: "nenhuma_maquina_compativel", detalhe: "todas as máquinas da Previsão com demanda já têm operador neste período" }); return; }
    if (a.motivoSemPosto === MOTIVO_RECURSOS_INDISPONIVEIS) { r.push({ ...base, causa: "maquina_indisponivel", detalhe: "as máquinas com demanda restante estão indisponíveis" }); return; }
    const semPrevisto = a.motivoSemPosto === MOTIVO_DEMANDA_ESGOTADA || a.motivoSemPosto === MOTIVO_JA_COBERTA;
    if (!semPrevisto) { r.push({ ...base, causa: "outro", detalhe: a.motivoSemPosto ?? "sem motivo registrado" }); return; }
    const detalheSemPrevisto = a.motivoSemPosto === MOTIVO_DEMANDA_ESGOTADA ? "o previsto restante da semana está esgotado" : "o previsto restante já está coberto neste período (mais postos não produziriam mais)";
    const op = opAnterior(a.funcionarioId, s.indice);
    let bloqRot = 0, bloqLimite = 0, bloqMaterial = 0, indisp = 0, ocup = 0, valido = 0;
    const exemplos: string[] = [];
    ent.pools.forEach((pl) => {
      const k = chavePool(pl.produtoId, pl.etapaId);
      const mu = pl.metas[s.periodoId] ?? 0;
      if (mu <= 0 || pl.maquinasIds.length === 0) return;
      const previsto = false; // o motor já disse que não há previsto a mais para esta pessoa; só o WIP pode ocupá-la
      let wipOk = false, motivoWip: "limite" | "material" | null = null;
      if (!previsto && dec.wip && flexivel.has(pl.produtoId)) {
        const etapas = [...ent.pools].filter((x) => x.produtoId === pl.produtoId).sort((x, y) => x.ordemEtapa - y.ordemEtapa);
        const pos = etapas.findIndex((x) => chavePool(x.produtoId, x.etapaId) === k);
        const seg = etapas[pos + 1];
        const L = ent.wip?.limites[k];
        const conf = ent.wip?.estoqueConfirmado?.[k] ?? 0;
        if (seg && L !== undefined && conf + Math.max(0, adicAte(k, s.indice - 1) - adicAte(chavePool(seg.produtoId, seg.etapaId), s.indice - 1)) >= L - 1) motivoWip = "limite";
        else if (pos > 0) {
          const ant = etapas[pos - 1];
          const estoque = (ent.wip?.saldo0?.[chavePool(ant.produtoId, ant.etapaId)] ?? 0) + adicAte(chavePool(ant.produtoId, ant.etapaId), s.indice) - adicAte(k, s.indice - 1);
          if (estoque <= 1) motivoWip = "material"; else wipOk = true;
        } else wipOk = true;
        if (pos === etapas.length - 1 && !(wipPares.get(k)?.teto ?? 0)) wipOk = false;
      }
      if (!previsto && !wipOk && !motivoWip) return;
      [...new Set(pl.maquinasIds)].forEach((m) => {
        if (!maquinaDisponivelNoSlot(ent, m, s)) { indisp++; return; }
        if (ocupadas.get(s.indice)?.has(m)) { ocup++; return; }
        if (op !== null && pl.operacaoId === op) { bloqRot++; return; }
        if (previsto || wipOk) { valido++; if (exemplos.length < 2) exemplos.push(`${m.slice(0, 6)} em ${pl.produtoId.slice(0, 6)}/${pl.etapaId.slice(0, 6)} (${previsto ? "previsto" : "WIP"})`); }
        else if (motivoWip === "limite") bloqLimite++;
        else if (motivoWip === "material") bloqMaterial++;
      });
    });
    let causa: CausaOciosidade, detalhe: string;
    if (valido > 0) { causa = "outro"; detalhe = `${valido} posto(s) livre(s) com trabalho válido existiam (decisão do motor por equilíbrio/ordem): ${exemplos.join("; ")}`; }
    else if (bloqRot > 0) { causa = "revezamento_duro"; detalhe = "o único posto livre com trabalho repetiria a operação do período anterior"; }
    else if (bloqLimite > 0) { causa = "limite_wip"; detalhe = "WIP possível, mas o estoque entre etapas já está no limite"; }
    else if (bloqMaterial > 0) { causa = "material"; detalhe = "etapa seguinte sem estoque da anterior para consumir"; }
    else if (indisp > 0 && ocup === 0) { causa = "maquina_indisponivel"; detalhe = "as máquinas com trabalho estão indisponíveis"; }
    else if (ocup > 0) { causa = "nenhuma_maquina_compativel"; detalhe = "todas as máquinas da Previsão com trabalho já têm operador no período"; }
    else { causa = "sem_trabalho_valido"; detalhe = `${detalheSemPrevisto}; não há WIP elegível para a pessoa` ; }
    r.push({ ...base, causa, detalhe });
  });
  return r.sort((x, y) => (x.data + x.periodoId + x.funcionarioId < y.data + y.periodoId + y.funcionarioId ? -1 : 1));
}

// ---------- registro no snapshot (diagnostico.restrito): "o motor sugeriu X" ----------
export interface SnapshotRestrito {
  dinamica: DinamicaCorte; // meta × produtividade real × capacidade futura ajustada + gargalo dinâmico do corte
  proposta: {
    veredito: VereditoProposta;
    motivoVeredito: string;
    ganho: PropostaRestrita["ganho"];
    churn: ChurnProposta;
    wip: MetricasWip;
    aPartir: { data: string; periodoId: string } | null;
    reparoDoComprometido: boolean;
    hashProposta: string;
    hashOficialRegiao: string;
    resumo: ResumoMudancas;
    violacoes: string[];
    trocasManuais: { preservadas: number; perdidas: number };
    totalMudancas: number;
    mudancas: MudancaLinha[]; // as primeiras 60 (o resto é reproduzível pela entrada canônica)
  };
  ociosidade: { total: number; porCausa: Partial<Record<CausaOciosidade, number>>; linhas: OciosidadeFutura[] };
}
export function resumoRestrito(par: ParametrosCorte, dec: DecisaoCorte, prop: PropostaRestrita): SnapshotRestrito {
  const oc = diagnosticarOciosidade(par, dec);
  const porCausa: Partial<Record<CausaOciosidade, number>> = {};
  oc.forEach((o) => (porCausa[o.causa] = (porCausa[o.causa] ?? 0) + 1));
  return {
    dinamica: dec.dinamica,
    proposta: {
      veredito: prop.veredito, motivoVeredito: prop.motivoVeredito, ganho: prop.ganho, churn: prop.churn, wip: prop.wip, aPartir: prop.aPartir, reparoDoComprometido: prop.reparoDoComprometido, hashProposta: prop.hashProposta, hashOficialRegiao: prop.hashOficialRegiao, resumo: prop.resumo, violacoes: prop.violacoes,
      trocasManuais: { preservadas: prop.trocasManuaisPreservadas, perdidas: prop.trocasManuaisPerdidas }, totalMudancas: prop.mudancas.length, mudancas: prop.mudancas.slice(0, 60),
    },
    ociosidade: { total: oc.length, porCausa, linhas: oc },
  };
}

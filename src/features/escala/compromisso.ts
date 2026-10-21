// REPARO MÍNIMO DE COMPROMISSO (Fase 4b, extensão) — núcleo PURO, só para o modo sombra.
//
// HIERARQUIA: REVEZAMENTO ERGONÔMICO DURO > PERÍODO COMPROMETIDO.
//   comprometido = protegido contra OTIMIZAÇÃO;  revezamento = restrição ABSOLUTA.
// Se a execução real do período atual (c) fizer o comprometido (c+1) repetir a operação de alguém, o comprometido NÃO é reotimizado:
// calcula-se o menor reparo possível, só entre as pessoas do próprio período, mantendo os POSTOS (máquina/produto/etapa/peças) e só
// trocando QUEM ocupa cada posto. Sem reparo válido => o posto fica sem operador e há alerta crítico. Nunca se permite repetição.
//
// Problema resolvido exatamente (atribuição de custo mínimo, Hungarian, determinístico):
//   1º  nenhum posto vazio sem necessidade (preservar o máximo de postos);
//   2º  menor número de LINHAS alteradas (pessoa trocando de posto / virando ocioso / saindo da ociosidade);
//   3º  linha manual só muda em último caso; usar pessoa ociosa só como desempate;
//   4º  equidade normal (ContadoresEquidade) como desempate final.
// Pares proibidos: pessoa ausente / fora da equipe; a mesma operacao_id do período anterior (mesmo dia; M3→T1 conta; dia novo zera).
// Não trata (só detecta, ver horizonte.ts): ausência/máquina indisponível — posto de ausente ou de máquina parada é deixado como está.

import { atribuicaoMinima } from "./matching";
import { ContadoresEquidade } from "./equidade";
import { maquinaDisponivelNoSlot } from "./disponibilidade";
import { sobrepoe } from "./tempo";
import type { AlertaEscala, AlocacaoEscala, EntradaEscala, SlotEscala } from "./types";

export type StatusCompromisso =
  | "compromisso_valido" // nenhuma repetição
  | "conflito_rotacao_comprometido" // repetição detectada (ainda sem reparo avaliado)
  | "compromisso_reparavel" // existe reparo que mantém TODOS os postos
  | "compromisso_nao_reparavel"; // algum posto precisaria ficar vazio

export interface PostoRef { maquinaId: string; produtoId: string | null; etapaId: string | null; operacaoId: string | null }
export interface AlternativaTentada { com: string; viavel: boolean; motivo: string }
export interface ConflitoRotacao {
  funcionarioId: string;
  operacaoAnterior: string; // o que a pessoa EXECUTOU no período anterior (c)
  operacaoRepetida: string; // a mesma operação, no comprometido (c+1)
  periodoAnterior: { slot: number; data: string; periodoId: string };
  posto: PostoRef; // posto comprometido afetado
  alternativas: AlternativaTentada[]; // trocas simples tentadas, uma por colega do período
}
export interface TrocaReparo { funcionarioId: string; de: PostoRef | null; para: PostoRef | null }

export interface AvaliacaoCompromisso {
  status: StatusCompromisso;
  slot: number | null; // índice do período comprometido
  conflitos: ConflitoRotacao[];
  original: AlocacaoEscala[]; // linhas do comprometido como estavam (compromisso original)
  reparado: AlocacaoEscala[]; // proposta (= original quando não há conflito)
  trocas: TrocaReparo[]; // só as pessoas cuja linha mudou
  linhasAlteradas: number;
  postosPreservados: boolean;
  postosVazios: PostoRef[];
  alertas: AlertaEscala[];
}

const doSlot = (rows: AlocacaoEscala[], s: SlotEscala) => rows.filter((a) => a.data === s.data && a.periodoId === s.periodoId);
const postoDe = (a: AlocacaoEscala): PostoRef => ({ maquinaId: a.maquinaId as string, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId });
const chavePosto = (a: { maquinaId: string | null; produtoId: string | null; etapaId: string | null }) => (a.maquinaId ? `${a.maquinaId}|${a.produtoId}|${a.etapaId}` : "ocioso");

export const MOTIVO_CONFLITO_ERGONOMICO = "Conflito ergonômico: sem operador válido que não repita a operação do período anterior";

export function ausenteNoSlot(entrada: EntradaEscala, funcionarioId: string, slot: SlotEscala): boolean {
  return entrada.ausencias.some((x) => x.funcionarioId === funcionarioId && x.data === slot.data && (x.inicioMin === null || x.fimMin === null || sobrepoe(x.inicioMin, x.fimMin, slot.inicioMin, slot.fimMin)));
}

// operação executada por cada pessoa no período imediatamente anterior, MESMO DIA (null/ausente = sem posto, sem repetição possível)
function operacaoAnterior(entrada: EntradaEscala, plano: AlocacaoEscala[], slot: SlotEscala): Map<string, string> {
  const m = new Map<string, string>();
  const ant = entrada.slots[slot.indice - 1];
  if (!ant || ant.data !== slot.data) return m; // novo dia zera o revezamento
  doSlot(plano, ant).forEach((a) => { if (a.maquinaId && a.operacaoId) m.set(a.funcionarioId, a.operacaoId); });
  return m;
}

const BASE_TROCA = 1e4; // por linha alterada
const PEN_MANUAL = 1e2; // por linha manual alterada
const PEN_OCIOSO = 1; // por posto que passa a ser coberto por pessoa que estava ociosa
const VAZIO = 1e7; // por posto sem operador (preservar postos domina qualquer nº de trocas)
const PROIBIDO = 1e9;
const ESCALA_EQUIDADE = 1e9;

// `planoVigente`: tudo que vale hoje — executado até c (inclusive) e o comprometido em c+1. `slotComprometido` = índice c+1.
export function avaliarCompromisso(entrada: EntradaEscala, planoVigente: AlocacaoEscala[], slotComprometido: number | null, opcoes: { reparar?: boolean } = {}): AvaliacaoCompromisso {
  const reparar = opcoes.reparar !== false;
  const slot = slotComprometido === null ? undefined : entrada.slots[slotComprometido];
  const vazio: AvaliacaoCompromisso = { status: "compromisso_valido", slot: slot ? slot.indice : null, conflitos: [], original: [], reparado: [], trocas: [], linhasAlteradas: 0, postosPreservados: true, postosVazios: [], alertas: [] };
  if (!slot) return vazio;
  const original = doSlot(planoVigente, slot);
  const equipe = new Set(entrada.funcionarios.map((f) => f.id));
  const prevOp = operacaoAnterior(entrada, planoVigente, slot);
  const ant = entrada.slots[slot.indice - 1];

  // pessoa utilizável: na equipe e presente no período
  const utilizavel = (id: string) => equipe.has(id) && !ausenteNoSlot(entrada, id, slot);
  const permitido = (id: string, operacaoId: string | null) => !operacaoId || prevOp.get(id) !== operacaoId;

  const conflitosBrutos = original.filter((a) => a.maquinaId && a.operacaoId && utilizavel(a.funcionarioId) && prevOp.get(a.funcionarioId) === a.operacaoId);
  const descreve = (a: AlocacaoEscala): ConflitoRotacao => ({
    funcionarioId: a.funcionarioId,
    operacaoAnterior: prevOp.get(a.funcionarioId) as string,
    operacaoRepetida: a.operacaoId as string,
    periodoAnterior: { slot: ant.indice, data: ant.data, periodoId: ant.periodoId },
    posto: postoDe(a),
    alternativas: [],
  });
  const conflitos = conflitosBrutos.map(descreve);
  if (conflitos.length === 0) return { ...vazio, original, reparado: original };

  // alternativas tentadas: troca simples do conflitante com cada colega do período
  conflitos.forEach((c) => {
    const p = original.find((a) => a.funcionarioId === c.funcionarioId) as AlocacaoEscala;
    original.filter((r) => r.funcionarioId !== c.funcionarioId).sort((x, y) => (x.funcionarioId < y.funcionarioId ? -1 : 1)).forEach((r) => {
      if (!equipe.has(r.funcionarioId)) return void c.alternativas.push({ com: r.funcionarioId, viavel: false, motivo: "fora da equipe produtiva" });
      if (ausenteNoSlot(entrada, r.funcionarioId, slot)) return void c.alternativas.push({ com: r.funcionarioId, viavel: false, motivo: "ausente no período" });
      if (r.maquinaId && !maquinaDisponivelNoSlot(entrada, r.maquinaId, slot)) return void c.alternativas.push({ com: r.funcionarioId, viavel: false, motivo: `máquina ${r.maquinaId} indisponível` });
      if (!permitido(r.funcionarioId, p.operacaoId)) return void c.alternativas.push({ com: r.funcionarioId, viavel: false, motivo: `repetiria a operação ${p.operacaoId} que executou no período anterior` });
      if (r.maquinaId && !permitido(c.funcionarioId, r.operacaoId)) return void c.alternativas.push({ com: r.funcionarioId, viavel: false, motivo: `${c.funcionarioId} repetiria a operação ${r.operacaoId} no posto de ${r.funcionarioId}` });
      c.alternativas.push({ com: r.funcionarioId, viavel: true, motivo: r.maquinaId ? "troca simples válida" : "assume o posto (estava ociosa); o conflitante fica ocioso" });
    });
  });

  if (!reparar) return { ...vazio, status: "conflito_rotacao_comprometido", conflitos, original, reparado: original };

  // ---- reparo mínimo: pessoas utilizáveis do período × postos cobríveis (posto de ausente/máquina parada fica como está) ----
  const pessoas = original.filter((a) => utilizavel(a.funcionarioId) && (!a.maquinaId || maquinaDisponivelNoSlot(entrada, a.maquinaId, slot))).sort((a, b) => (a.funcionarioId < b.funcionarioId ? -1 : 1));
  const postos = pessoas.filter((a) => a.maquinaId && maquinaDisponivelNoSlot(entrada, a.maquinaId, slot));
  const n = pessoas.length;
  const m = postos.length;
  const equidade = new ContadoresEquidade(entrada.funcionarios.map((f) => f.id), entrada.historicoEquidade);
  entrada.slots.filter((s) => s.indice < slot.indice).forEach((s) => {
    const linhas = doSlot(planoVigente, s);
    equidade.registrarPeriodo(linhas.map((a) => a.funcionarioId), linhas.filter((a) => a.maquinaId && a.operacaoId).map((a) => ({ funcionarioId: a.funcionarioId, operacaoId: a.operacaoId as string, maquinaId: a.maquinaId as string })), s.fimMin - s.inicioMin);
  });
  const custo: number[][] = [];
  pessoas.forEach((pe) => {
    const linha: number[] = [];
    const manual = pe.origem === "manual";
    postos.forEach((po) => {
      if (!permitido(pe.funcionarioId, po.operacaoId)) return void linha.push(PROIBIDO);
      const igual = chavePosto(pe) === chavePosto(po);
      const mudou = igual ? 0 : BASE_TROCA + (manual ? PEN_MANUAL : 0) + (pe.maquinaId ? 0 : PEN_OCIOSO);
      linha.push(mudou + equidade.custo(pe.funcionarioId, po.operacaoId as string, po.maquinaId as string) / ESCALA_EQUIDADE);
    });
    const mudouOcioso = pe.maquinaId ? BASE_TROCA + (manual ? PEN_MANUAL : 0) : 0;
    for (let k = 0; k < n; k++) linha.push(mudouOcioso);
    custo.push(linha);
  });
  for (let k = 0; k < m; k++) custo.push([...Array(m).fill(VAZIO), ...Array(n).fill(0)]); // fantasmas absorvem posto vazio / ociosidade não usada
  const atrib = atribuicaoMinima(custo);

  const reparadasPorPessoa = new Map<string, AlocacaoEscala>();
  const ocupados = new Set<number>();
  pessoas.forEach((pe, i) => {
    const col = atrib[i];
    if (col < m) {
      ocupados.add(col);
      const po = postos[col];
      reparadasPorPessoa.set(pe.funcionarioId, chavePosto(pe) === chavePosto(po) ? pe : { ...pe, maquinaId: po.maquinaId, produtoId: po.produtoId, etapaId: po.etapaId, operacaoId: po.operacaoId, pecas: po.pecas, pecasAdicional: po.pecasAdicional, tipoAdicional: po.tipoAdicional, motivoSemPosto: null, origem: "auto" });
    } else if (pe.maquinaId) {
      reparadasPorPessoa.set(pe.funcionarioId, { ...pe, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, tipoAdicional: undefined, motivoSemPosto: MOTIVO_CONFLITO_ERGONOMICO, origem: "auto" });
    } else {
      reparadasPorPessoa.set(pe.funcionarioId, pe);
    }
  });
  const reparado = original.map((a) => reparadasPorPessoa.get(a.funcionarioId) ?? a);
  const postosVazios = postos.filter((_, j) => !ocupados.has(j)).map(postoDe);
  const trocas: TrocaReparo[] = [];
  original.forEach((a, i) => {
    const r = reparado[i];
    if (chavePosto(a) !== chavePosto(r)) trocas.push({ funcionarioId: a.funcionarioId, de: a.maquinaId ? postoDe(a) : null, para: r.maquinaId ? postoDe(r) : null });
  });
  const status: StatusCompromisso = postosVazios.length === 0 ? "compromisso_reparavel" : "compromisso_nao_reparavel";
  const rot = `${slot.periodoId.toUpperCase()} de ${slot.data.slice(8)}/${slot.data.slice(5, 7)}`;
  const alertas: AlertaEscala[] = [];
  const detalhe = conflitos.map((c) => `${c.funcionarioId}: executou ${c.operacaoAnterior} em ${c.periodoAnterior.periodoId.toUpperCase()} e repetiria ${c.operacaoRepetida} (posto ${c.posto.maquinaId}); ${c.alternativas.filter((x) => x.viavel).length} troca(s) simples viável(is) de ${c.alternativas.length} tentada(s)`).join(" | ");
  if (status === "compromisso_nao_reparavel") {
    alertas.push({ tipo: "compromisso_nao_reparavel", data: slot.data, periodoId: slot.periodoId, quantidade: postosVazios.length, motivo: `Conflito ergonômico no período ${rot}. A execução real do ${ant.periodoId.toUpperCase()} tornou a escala comprometida inválida. Não existe redistribuição válida que mantenha todos os postos sem repetição de operação (${postosVazios.length} posto(s) ficariam sem operador). ${detalhe}` });
  } else {
    alertas.push({ tipo: "conflito_rotacao_comprometido", data: slot.data, periodoId: slot.periodoId, quantidade: conflitos.length, motivo: `A execução real do ${ant.periodoId.toUpperCase()} faria ${conflitos.length} pessoa(s) repetir operação em ${rot}. Reparo mínimo possível: ${trocas.length} linha(s) alterada(s), todos os postos mantidos. ${detalhe}` });
  }
  return { status, slot: slot.indice, conflitos, original, reparado, trocas, linhasAlteradas: trocas.length, postosPreservados: postosVazios.length === 0, postosVazios, alertas };
}

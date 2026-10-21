// HORIZONTE OPERACIONAL COMPROMETIDO (Fase 4b) — núcleo PURO, usado SÓ pelo modo sombra. O motor oficial não muda.
//
// Regra real da fábrica (derivada do relógio e da sequência de períodos, sem botão de "publicar"):
//   A) CONGELADO ....... período já iniciado ou encerrado;
//   B) COMPROMETIDO .... o PRÓXIMO período, ainda não iniciado, mas já é instrução operacional (os funcionários precisam recebê-lo pronto);
//   C) ALTERÁVEL ....... do SEGUNDO período à frente em diante — o único onde a sombra pode propor mudança.
//
//   período de referência c (o último iniciado/fechado) ⇒ comprometido = c + 1, primeiro alterável = c + 2.
//   M1→(M2 | M3+)  M2→(M3 | T1+)  M3→(T1 | T2+)  T1→(T2 | T3+)  T2→(T3 | M1 do dia seguinte+)  T3→(M1 do dia seguinte | M2 do dia seguinte+)
//
// A sequência é a dos períodos dos DIAS PRODUTIVOS da Previsão (src/features/escala/tempo.ts): sábado/domingo/feriado/dia desmarcado
// não geram períodos, então o horizonte salta sozinho (sexta T3 ⇒ segunda M1 comprometido, segunda M2 alterável) — nunca há "período
// fantasma". O revezamento reseta no novo dia (motor), mas o conceito de comprometido NÃO reseta.
//
// Garantias: (1) a sombra só devolve linhas do alterável; (2) o comprometido entra no motor como entrada CONGELADA (nunca é reconstruído),
// inclusive uma troca manual feita nele; (3) se algo novo torna o comprometido fisicamente impossível (falta, máquina indisponível), ele é
// MARCADO como "compromisso inviável" e gera alerta — NÃO é recalculado em silêncio (a contingência é decidida à parte).

import { gerarEscala } from "./gerarEscala";
import { maquinaDisponivelNoSlot } from "./disponibilidade";
import { sobrepoe } from "./tempo";
import { avaliarCompromisso, type AvaliacaoCompromisso, type StatusCompromisso } from "./compromisso";
import type { ExposicaoPessoa } from "./producaoReal";
import type { AlertaEscala, AlocacaoEscala, EntradaEscala, ResultadoEscala, SlotEscala } from "./types";

export type ModoHorizonte = "comprometido" | "antigo"; // antigo = o próximo período já pode mudar (só para comparar nas simulações)

export interface HorizonteOperacional {
  referencia: number | null; // índice do período de referência (-1 = nenhum período iniciado ainda)
  atual: number | null; // último período iniciado no instante (null se nenhum)
  congeladoAte: number; // todos os índices ≤ este são congelados (-1 = nada)
  comprometido: number | null; // índice do próximo período (null se acabou a semana)
  primeiroAlteravel: number | null; // índice do segundo período à frente (null se não há)
}

// Índice do último período INICIADO em `agoraMs` (null se a semana ainda não começou).
export function periodoAtual(slots: SlotEscala[], agoraMs: number): number | null {
  let atual: number | null = null;
  for (const s of slots) if (s.inicioMs <= agoraMs) atual = s.indice;
  return atual;
}

// Horizonte a partir de um período de referência (ex.: o período recém-fechado).
export function horizonteAposPeriodo(slots: SlotEscala[], referencia: number, modo: ModoHorizonte = "comprometido", atual: number | null = null): HorizonteOperacional {
  const n = slots.length;
  const ref = Math.max(referencia, atual ?? -1); // se o seguinte já começou, ele (e não o fechado) é a referência: nunca se altera período iniciado
  const comp = modo === "comprometido" ? ref + 1 : null;
  const alt = (modo === "comprometido" ? ref + 2 : ref + 1) as number;
  return {
    referencia: ref,
    atual,
    congeladoAte: ref,
    comprometido: comp !== null && comp < n ? comp : null,
    primeiroAlteravel: alt < n ? alt : null,
  };
}

// Horizonte no instante: período atual (iniciado) congelado + o próximo comprometido. `fechado` opcional (maior índice já fechado).
export function horizonteNoInstante(slots: SlotEscala[], agoraMs: number, fechado: number | null = null, modo: ModoHorizonte = "comprometido"): HorizonteOperacional {
  const atual = periodoAtual(slots, agoraMs);
  const ref = Math.max(fechado ?? -1, atual ?? -1);
  return horizonteAposPeriodo(slots, ref, modo, atual);
}

export const rotuloPeriodo = (slots: SlotEscala[], i: number | null): string => (i === null || !slots[i] ? "—" : `${slots[i].data.slice(8)}/${slots[i].data.slice(5, 7)} ${slots[i].periodoId.toUpperCase()}`);

// ---------- hash canônico (prova de qual escala estava vigente; determinístico, sem relógio) ----------
// cyrb53: suficiente para comparar/auditar nesta fase; o snapshot definitivo (4d) pode trocar por SHA-256 no servidor.
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export function hashAlocacoes(linhas: AlocacaoEscala[]): string {
  const canonico = [...linhas]
    .sort((a, b) => (a.data + a.periodoId + a.funcionarioId < b.data + b.periodoId + b.funcionarioId ? -1 : 1))
    .map((a) => [a.data, a.periodoId, a.funcionarioId, a.maquinaId, a.produtoId, a.etapaId, a.operacaoId, a.pecas, a.pecasAdicional ?? 0, a.origem ?? "auto"]);
  return cyrb53(JSON.stringify(canonico));
}

// ---------- compromisso inviável ----------
export type ItemInviavel = { tipo: "funcionario_ausente" | "funcionario_fora_da_equipe" | "maquina_indisponivel"; funcionarioId?: string; maquinaId?: string };
export interface CompromissoInviavel {
  slot: number;
  data: string;
  periodoId: string;
  itens: ItemInviavel[];
}

// O comprometido continua executável? Confere cada posto contra o que se sabe AGORA (ausências, equipe, máquinas). Nada é recalculado aqui.
export function detectarCompromissoInviavel(entrada: EntradaEscala, comprometidas: AlocacaoEscala[], slot: SlotEscala | undefined): CompromissoInviavel | null {
  if (!slot) return null;
  const equipe = new Set(entrada.funcionarios.map((f) => f.id));
  const itens: ItemInviavel[] = [];
  comprometidas
    .filter((a) => a.data === slot.data && a.periodoId === slot.periodoId && a.maquinaId)
    .forEach((a) => {
      if (!equipe.has(a.funcionarioId)) itens.push({ tipo: "funcionario_fora_da_equipe", funcionarioId: a.funcionarioId });
      else if (entrada.ausencias.some((x) => x.funcionarioId === a.funcionarioId && x.data === slot.data && (x.inicioMin === null || x.fimMin === null || sobrepoe(x.inicioMin, x.fimMin, slot.inicioMin, slot.fimMin)))) {
        itens.push({ tipo: "funcionario_ausente", funcionarioId: a.funcionarioId });
      }
      if (!maquinaDisponivelNoSlot(entrada, a.maquinaId as string, slot)) itens.push({ tipo: "maquina_indisponivel", maquinaId: a.maquinaId as string });
    });
  return itens.length > 0 ? { slot: slot.indice, data: slot.data, periodoId: slot.periodoId, itens } : null;
}

const TEXTO_ITEM: Record<ItemInviavel["tipo"], string> = {
  funcionario_ausente: "funcionário ausente",
  funcionario_fora_da_equipe: "funcionário fora da equipe produtiva",
  maquina_indisponivel: "máquina indisponível",
};

export function alertaCompromissoInviavel(c: CompromissoInviavel): AlertaEscala {
  const tipos = [...new Set(c.itens.map((i) => TEXTO_ITEM[i.tipo]))].join(", ");
  return {
    tipo: "compromisso_inviavel",
    data: c.data,
    periodoId: c.periodoId,
    quantidade: c.itens.length,
    motivo: `O próximo período (${c.periodoId.toUpperCase()} de ${c.data.slice(8)}/${c.data.slice(5, 7)}) já está comprometido, mas ficou inviável: ${c.itens.length} posto(s) com ${tipos}. Não foi recalculado — a contingência é uma decisão operacional.`,
  };
}

// ---------- snapshot do estado (protótipo da 4d: nada é gravado aqui) ----------
export interface SnapshotHorizonte {
  geradoEm: number; // ms do corte (entrada, nunca o relógio do motor)
  modo: ModoHorizonte;
  referencia: { slot: number; data: string; periodoId: string } | null;
  atual: { slot: number; data: string; periodoId: string } | null;
  comprometido: { slot: number; data: string; periodoId: string } | null;
  primeiroAlteravel: { slot: number; data: string; periodoId: string } | null;
  hashCongelado: string; // alocações até o período de referência
  hashComprometido: string; // o próximo período
  hashAlteravel: string; // o que a sombra propôs para o futuro alterável
  compromissoInviavel: CompromissoInviavel | null;
  statusCompromisso: StatusCompromisso;
  hashComprometidoReparado: string; // = hashComprometido quando não há conflito de rotação
  reparo: { conflitos: number; linhasAlteradas: number; postosPreservados: boolean; postosVazios: number };
}

const ref = (slots: SlotEscala[], i: number | null) => (i === null || i < 0 || !slots[i] ? null : { slot: i, data: slots[i].data, periodoId: slots[i].periodoId });
const doSlot = (slots: SlotEscala[], rows: AlocacaoEscala[], i: number | null) => (i === null || !slots[i] ? [] : rows.filter((a) => a.data === slots[i].data && a.periodoId === slots[i].periodoId));
const indiceDe = (slots: SlotEscala[], a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? Number.POSITIVE_INFINITY;

export interface ResultadoSombraHorizonte {
  horizonte: HorizonteOperacional;
  congeladas: AlocacaoEscala[]; // ≤ referência (entrada)
  comprometidas: AlocacaoEscala[]; // próximo período como a sombra o trata (ORIGINAL; ou REPARADO se a execução real criou conflito de rotação)
  comprometidasOriginais: AlocacaoEscala[]; // compromisso original, intacto
  avaliacaoCompromisso: AvaliacaoCompromisso;
  alteravel: AlocacaoEscala[]; // o que a sombra propõe (só ≥ primeiro alterável)
  resultado: ResultadoEscala | null;
  compromissoInviavel: CompromissoInviavel | null;
  alertas: AlertaEscala[];
  snapshot: SnapshotHorizonte;
}

// Replaneja SÓ o alterável. `planoVigente` = tudo que vale hoje: executado/oficial até a referência e o comprometido (inclusive troca manual).
// O comprometido entra como CONGELADO (o motor nunca o reconstrói); mudanças de entrada (ausências, máquinas, previsão) só afetam o alterável.
export function replanejarComHorizonte(
  entrada: EntradaEscala,
  planoVigente: AlocacaoEscala[],
  referencia: number,
  opcoes: { modo?: ModoHorizonte; agoraMs?: number; repararRotacao?: boolean; exposicaoAnterior?: ExposicaoPessoa[] } = {}
): ResultadoSombraHorizonte {
  const modo = opcoes.modo ?? "comprometido";
  const slots = entrada.slots;
  const h = horizonteAposPeriodo(slots, referencia, modo, null);
  const limite = h.primeiroAlteravel ?? slots.length; // tudo < limite é congelado/comprometido
  const congeladas = planoVigente.filter((a) => indiceDe(slots, a) <= h.congeladoAte);
  const comprometidasOriginais = h.comprometido === null ? [] : doSlot(slots, planoVigente, h.comprometido);
  // REVEZAMENTO duro > comprometido: se a execução real de c criou repetição em c+1, aplica-se o REPARO MÍNIMO (nunca reotimização)
  const avaliacao = avaliarCompromisso(entrada, planoVigente, h.comprometido, { reparar: opcoes.repararRotacao !== false, exposicaoAnterior: opcoes.exposicaoAnterior });
  const reparou = opcoes.repararRotacao !== false && (avaliacao.conflitos.length > 0 || avaliacao.impedimentos.length > 0);
  const comprometidas = reparou ? avaliacao.reparado : comprometidasOriginais;
  let resultado: ResultadoEscala | null = null;
  let alteravel: AlocacaoEscala[] = [];
  if (h.primeiroAlteravel !== null) {
    resultado = gerarEscala({ ...entrada, aPartirDe: h.primeiroAlteravel, congeladas: [...congeladas, ...comprometidas] });
    alteravel = resultado.alocacoes.filter((a) => indiceDe(slots, a) >= limite); // garantia estrutural: nada antes do alterável
  }
  const inviavel = h.comprometido === null ? null : detectarCompromissoInviavel(entrada, comprometidasOriginais, slots[h.comprometido]);
  const alertas: AlertaEscala[] = [...(resultado?.alertas ?? []), ...(inviavel && !reparou ? [alertaCompromissoInviavel(inviavel)] : []), ...avaliacao.alertas];
  return {
    horizonte: h,
    congeladas,
    comprometidas,
    comprometidasOriginais,
    avaliacaoCompromisso: avaliacao,
    alteravel,
    resultado,
    compromissoInviavel: inviavel,
    alertas,
    snapshot: {
      geradoEm: opcoes.agoraMs ?? 0,
      modo,
      referencia: ref(slots, h.referencia),
      atual: ref(slots, h.atual),
      comprometido: ref(slots, h.comprometido),
      primeiroAlteravel: ref(slots, h.primeiroAlteravel),
      hashCongelado: hashAlocacoes(congeladas),
      hashComprometido: hashAlocacoes(comprometidasOriginais),
      hashComprometidoReparado: hashAlocacoes(comprometidas),
      hashAlteravel: hashAlocacoes(alteravel),
      compromissoInviavel: inviavel,
      statusCompromisso: avaliacao.status,
      reparo: { conflitos: avaliacao.conflitos.length, linhasAlteradas: avaliacao.linhasAlteradas, postosPreservados: avaliacao.postosPreservados, postosVazios: avaliacao.postosVazios.length },
    },
  };
}

// Quantas linhas do comprometido o motor MUDARIA se o horizonte fosse o antigo (próximo período já alterável)? Só para medir o custo da regra.
export function linhasQueOMotorMudariaNoComprometido(entrada: EntradaEscala, planoVigente: AlocacaoEscala[], referencia: number): { comprometidas: number; mudariam: number; preservadas: number } {
  const slots = entrada.slots;
  const h = horizonteAposPeriodo(slots, referencia, "comprometido", null);
  if (h.comprometido === null) return { comprometidas: 0, mudariam: 0, preservadas: 0 };
  const vigentes = doSlot(slots, planoVigente, h.comprometido);
  const livre = gerarEscala({ ...entrada, aPartirDe: h.comprometido, congeladas: planoVigente.filter((a) => indiceDe(slots, a) <= h.congeladoAte) });
  const novas = doSlot(slots, livre.alocacoes, h.comprometido);
  const posto = (a: AlocacaoEscala) => `${a.maquinaId ?? ""}|${a.produtoId ?? ""}|${a.etapaId ?? ""}`;
  const novoPorPessoa = new Map(novas.map((a) => [a.funcionarioId, posto(a)]));
  const mudariam = vigentes.filter((a) => novoPorPessoa.get(a.funcionarioId) !== posto(a)).length;
  return { comprometidas: vigentes.length, mudariam, preservadas: mudariam }; // o horizonte novo preserva TODAS as que o motor mudaria
}

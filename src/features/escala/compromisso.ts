// REPARO MÍNIMO DE COMPROMISSO (Fase 4b ext. + 4c) — núcleo PURO, só para o modo sombra.
//
// HIERARQUIA: REVEZAMENTO ERGONÔMICO DURO > PERÍODO COMPROMETIDO.  O comprometido é protegido contra REOTIMIZAÇÃO, mas sofre REPARO MÍNIMO
// quando fica (a) ergonomicamente inválido (execução real faria alguém repetir a operação) ou (b) fisicamente impossível (pessoa ausente /
// fora da equipe; máquina indisponível). Nunca se abre o período inteiro e nunca se tenta produzir mais do que o compromisso.
//
// Ordem do reparo:
//   1. REPARO DE RECURSO: máquina indisponível => substituição EQUIVALENTE (mesmo produto, mesma etapa, mesma operacao_id, na lista da
//      etapa, disponível e LIVRE no período — nunca uma máquina de outro posto). Sem equivalente => o posto some (vazio).
//   2. REPARO DE PESSOAS (atribuição de custo mínimo, Hungarian, determinística) sobre os postos que restaram, em ordem lexicográfica:
//        postos vazios  >>  linhas com pessoa trocada (manter o MESMO funcionário no posto sempre que ergonomicamente válido)
//        >> linha manual  >> uso de pessoa ociosa  >> equidade (só desempate).
//      Pares proibidos: pessoa ausente/fora da equipe; operação que ela acabou de exercer (mesmo dia; M3→T1 conta; dia novo zera).
//      Pessoa ociosa e rearranjo entre comprometidos entram na MESMA busca global; nada tira alguém de um posto só para abrir um buraco
//      equivalente (isso custa linhas e não reduz postos vazios, portanto perde).
// Status separados (não misturar ergonomia com impossibilidade física): ver StatusCompromisso.

import { atribuicaoMinima } from "./matching";
import { ContadoresEquidade } from "./equidade";
import { maquinaDisponivelNoSlot } from "./disponibilidade";
import { sobrepoe } from "./tempo";
import type { ExposicaoPessoa } from "./producaoReal";
import { chaveBloco, ehPeriodoPonte, expansaoOperacao } from "./exposicaoBloco";
import type { AlertaEscala, AlocacaoEscala, EntradaEscala, SlotEscala } from "./types";

export type StatusCompromisso =
  | "compromisso_valido" // nada a corrigir
  | "conflito_rotacao_comprometido" // repetição detectada, reparo não avaliado
  | "compromisso_reparavel" // conflito ERGONÔMICO resolvido sem perder posto
  | "compromisso_nao_reparavel" // conflito ergonômico: algum posto fica vazio
  | "compromisso_inviavel_reparavel" // impossibilidade FÍSICA (ausência/equipe/máquina) resolvida sem perder posto
  | "compromisso_inviavel_nao_reparavel"; // impossibilidade física: algum posto fica vazio

export interface PostoRef { maquinaId: string; produtoId: string | null; etapaId: string | null; operacaoId: string | null }
export interface AlternativaTentada { com: string; viavel: boolean; motivo: string }
export interface ConflitoRotacao {
  funcionarioId: string;
  operacaoAnterior: string; // o que a pessoa executou (ou pode ter executado, se incerta) no período anterior
  operacaoRepetida: string;
  exposicaoIncerta: boolean; // true: a operação anterior não é inequívoca (proibição conservadora)
  periodoAnterior: { slot: number; data: string; periodoId: string };
  posto: PostoRef;
  alternativas: AlternativaTentada[];
}
export type TipoImpedimento = "funcionario_ausente" | "funcionario_fora_da_equipe" | "maquina_indisponivel";
export interface ImpedimentoFisico { tipo: TipoImpedimento; funcionarioId?: string; maquinaId?: string; posto: PostoRef }
export interface TrocaReparo { funcionarioId: string; de: PostoRef | null; para: PostoRef | null }
export interface TrocaMaquina { funcionarioId: string; de: string; para: string; produtoId: string | null; etapaId: string | null }
export interface PostoVazio extends PostoRef { causa: "revezamento" | "inviavel"; detalhe: string }
// "Contingência possível": máquina COMPATÍVEL com a etapa, disponível e livre, mas FORA da Previsão — nunca usada automaticamente
// (setup, ferramental, regulagem, material ou restrição local que o sistema não conhece). Só diagnóstico para decisão da supervisão.
export interface ContingenciaMaquina {
  maquinaId: string;
  produtoId: string | null;
  etapaId: string | null;
  operacaoId: string | null;
  postoAfetado: { maquinaId: string; funcionarioId: string };
  motivoNaoUsada: "fora da Previsão";
}

export interface AvaliacaoCompromisso {
  status: StatusCompromisso; // físico tem precedência (statusFisico ?? statusErgonomico)
  statusErgonomico: StatusCompromisso; // valido | conflito_rotacao_comprometido | reparavel | nao_reparavel
  statusFisico: StatusCompromisso | null; // null = sem impedimento físico (ou reparo não avaliado)
  slot: number | null;
  conflitos: ConflitoRotacao[]; // ergonomia
  impedimentos: ImpedimentoFisico[]; // impossibilidade física
  original: AlocacaoEscala[];
  reparado: AlocacaoEscala[];
  trocas: TrocaReparo[]; // linhas que mudaram
  trocasMaquina: TrocaMaquina[]; // reparo de recurso
  linhasAlteradas: number;
  postosPreservados: boolean;
  postosVazios: PostoVazio[];
  contingencias: ContingenciaMaquina[]; // alternativas fora da Previsão (somente registro)
  alertas: AlertaEscala[];
}

export interface OpcoesCompromisso {
  reparar?: boolean; // false: só detecta
  // exposição ergonômica do período anterior (Produção Real, inclui "desconhecida" conservadora). Sem isto, usa as linhas do plano em c.
  exposicaoAnterior?: ExposicaoPessoa[];
}

const doSlot = (rows: AlocacaoEscala[], s: SlotEscala) => rows.filter((a) => a.data === s.data && a.periodoId === s.periodoId);
const postoDe = (a: { maquinaId: string | null; produtoId: string | null; etapaId: string | null; operacaoId: string | null }): PostoRef => ({ maquinaId: a.maquinaId as string, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId });
const chaveLinha = (a: { maquinaId: string | null; produtoId: string | null; etapaId: string | null }) => (a.maquinaId ? `${a.maquinaId}|${a.produtoId}|${a.etapaId}` : "ocioso");

export const MOTIVO_CONFLITO_ERGONOMICO = "Conflito ergonômico: sem operador válido que não repita a operação do período anterior";
export const MOTIVO_POSTO_INVIAVEL = "Posto comprometido indisponível (máquina sem equivalente): sem posto neste período";
export const MOTIVO_AUSENTE_COMPROMISSO = "Funcionário indisponível no período comprometido";

export function ausenteNoSlot(entrada: EntradaEscala, funcionarioId: string, slot: SlotEscala): boolean {
  return entrada.ausencias.some((x) => x.funcionarioId === funcionarioId && x.data === slot.data && (x.inicioMin === null || x.fimMin === null || sobrepoe(x.inicioMin, x.fimMin, slot.inicioMin, slot.fimMin)));
}

// operações proibidas por pessoa no período `slot` (mesmo dia; vazio no 1º período do dia)
function operacoesProibidas(entrada: EntradaEscala, plano: AlocacaoEscala[], slot: SlotEscala, exposicao?: ExposicaoPessoa[]): { mapa: Map<string, Set<string>>; incerta: Set<string> } {
  const mapa = new Map<string, Set<string>>();
  const incerta = new Set<string>();
  const ant = entrada.slots[slot.indice - 1];
  const bloco = entrada.revezamentoDuro === true && entrada.revezamentoEscopo === "bloco";
  // PONTE M3 → T1 (flag): T1 logo após M3 do mesmo dia herda a exposição de M3 (e só dela)
  const ponte = bloco && entrada.revezamentoPonteM3T1 === true && ehPeriodoPonte(entrada.slots, slot.indice);
  if (!ant || (bloco ? chaveBloco(ant) !== chaveBloco(slot) : ant.data !== slot.data)) { if (!ponte) return { mapa, incerta }; } // novo dia (ou, no escopo bloco, novo bloco manhã/tarde) zera o revezamento
  const add = (f: string, ops: string[], inc: boolean) => {
    if (!mapa.has(f)) mapa.set(f, new Set());
    ops.forEach((o) => (bloco ? expansaoOperacao(o, entrada.equivalenciaOperacoes) : [o]).forEach((x) => mapa.get(f)!.add(x)));
    if (inc) incerta.add(f);
  };
  if (bloco) {
    // ESCOPO BLOCO: tudo o que a pessoa executou/estava alocada em M1..(slot-1) (ou T1..) do mesmo bloco — não só o período imediatamente anterior
    for (let u = slot.indice - 1; u >= 0 && (chaveBloco(entrada.slots[u]) === chaveBloco(slot) || (ponte && u === slot.indice - 1)); u--) {
      const su = entrada.slots[u];
      if (exposicao) {
        exposicao.filter((e) => e.slot === su.indice).forEach((e) => add(e.funcionarioId, e.operacoes, e.incerta));
        continue;
      }
      doSlot(plano, su).forEach((a) => {
        if (!a.maquinaId) return;
        if (a.operacaoId) return void add(a.funcionarioId, [a.operacaoId], false);
        add(a.funcionarioId, [...new Set(entrada.pools.filter((p) => p.maquinasIds.includes(a.maquinaId as string)).map((p) => p.operacaoId))], true);
      });
    }
    return { mapa, incerta };
  }
  if (exposicao) {
    exposicao.filter((e) => e.slot === ant.indice).forEach((e) => add(e.funcionarioId, e.operacoes, e.incerta));
    return { mapa, incerta };
  }
  doSlot(plano, ant).forEach((a) => {
    if (!a.maquinaId) return;
    if (a.operacaoId) return void add(a.funcionarioId, [a.operacaoId], false);
    const ops = [...new Set(entrada.pools.filter((p) => p.maquinasIds.includes(a.maquinaId as string)).map((p) => p.operacaoId))];
    add(a.funcionarioId, ops, true);
  });
  return { mapa, incerta };
}

const BASE_TROCA = 1e4; // por pessoa que muda de posto / sai ou entra na ociosidade
const PEN_MANUAL = 1e2; // por linha manual alterada
const PEN_OCIOSO = 1; // por posto coberto por pessoa que estava ociosa
const VAZIO = 1e7; // por posto sem operador (preservar postos domina qualquer nº de trocas)
const PROIBIDO = 1e9;
const ESCALA_EQUIDADE = 1e9;

// Substituição de máquina: casamento máximo (Kuhn) entre postos com máquina indisponível e máquinas EQUIVALENTES livres.
function substituirMaquinas(entrada: EntradaEscala, slot: SlotEscala, quebrados: AlocacaoEscala[], usadas: Set<string>): Map<AlocacaoEscala, string> {
  const opcoes = quebrados.map((q) => {
    const pool = entrada.pools.find((p) => p.produtoId === q.produtoId && p.etapaId === q.etapaId && p.operacaoId === q.operacaoId);
    return pool ? [...new Set(pool.maquinasIds)].filter((m) => !usadas.has(m) && maquinaDisponivelNoSlot(entrada, m, slot)).sort() : [];
  });
  const dono = new Map<string, number>();
  const tentar = (i: number, vistos: Set<string>): boolean => {
    for (const m of opcoes[i]) {
      if (vistos.has(m)) continue;
      vistos.add(m);
      if (!dono.has(m) || tentar(dono.get(m) as number, vistos)) { dono.set(m, i); return true; }
    }
    return false;
  };
  quebrados.forEach((_, i) => void tentar(i, new Set()));
  const r = new Map<AlocacaoEscala, string>();
  dono.forEach((i, m) => r.set(quebrados[i], m));
  return r;
}

// `planoVigente`: tudo que vale hoje — executado até c e o comprometido em c+1. `slotComprometido` = índice c+1.
export function avaliarCompromisso(entrada: EntradaEscala, planoVigente: AlocacaoEscala[], slotComprometido: number | null, opcoes: OpcoesCompromisso = {}): AvaliacaoCompromisso {
  const reparar = opcoes.reparar !== false;
  const slot = slotComprometido === null ? undefined : entrada.slots[slotComprometido];
  const vazio: AvaliacaoCompromisso = {
    status: "compromisso_valido", statusErgonomico: "compromisso_valido", statusFisico: null, slot: slot ? slot.indice : null, conflitos: [], impedimentos: [],
    original: [], reparado: [], trocas: [], trocasMaquina: [], linhasAlteradas: 0, postosPreservados: true, postosVazios: [], contingencias: [], alertas: [],
  };
  if (!slot) return vazio;
  const original = doSlot(planoVigente, slot);
  const equipe = new Set(entrada.funcionarios.map((f) => f.id));
  const presente = (id: string) => equipe.has(id) && !ausenteNoSlot(entrada, id, slot);
  const { mapa: proib, incerta } = operacoesProibidas(entrada, planoVigente, slot, opcoes.exposicaoAnterior);
  const blocoEq = entrada.revezamentoDuro === true && entrada.revezamentoEscopo === "bloco";
  const proibido = (id: string, op: string | null) => !!op && (blocoEq ? expansaoOperacao(op, entrada.equivalenciaOperacoes).some((o) => !!proib.get(id)?.has(o)) : !!proib.get(id)?.has(op));
  const ant = entrada.slots[slot.indice - 1];

  // ---- detecção ----
  const impedimentos: ImpedimentoFisico[] = [];
  original.filter((a) => a.maquinaId).forEach((a) => {
    if (!equipe.has(a.funcionarioId)) impedimentos.push({ tipo: "funcionario_fora_da_equipe", funcionarioId: a.funcionarioId, posto: postoDe(a) });
    else if (ausenteNoSlot(entrada, a.funcionarioId, slot)) impedimentos.push({ tipo: "funcionario_ausente", funcionarioId: a.funcionarioId, posto: postoDe(a) });
    if (!maquinaDisponivelNoSlot(entrada, a.maquinaId as string, slot)) impedimentos.push({ tipo: "maquina_indisponivel", maquinaId: a.maquinaId as string, funcionarioId: a.funcionarioId, posto: postoDe(a) });
  });
  const conflitos: ConflitoRotacao[] = original
    .filter((a) => a.maquinaId && presente(a.funcionarioId) && proibido(a.funcionarioId, a.operacaoId))
    .map((a) => ({
      funcionarioId: a.funcionarioId,
      operacaoAnterior: a.operacaoId as string,
      operacaoRepetida: a.operacaoId as string,
      exposicaoIncerta: incerta.has(a.funcionarioId),
      periodoAnterior: { slot: ant.indice, data: ant.data, periodoId: ant.periodoId },
      posto: postoDe(a),
      alternativas: [],
    }));
  if (conflitos.length === 0 && impedimentos.length === 0) return { ...vazio, original, reparado: original };

  // alternativas tentadas (troca simples do conflitante com cada colega)
  conflitos.forEach((c) => {
    const p = original.find((a) => a.funcionarioId === c.funcionarioId) as AlocacaoEscala;
    original.filter((r) => r.funcionarioId !== c.funcionarioId).sort((x, y) => (x.funcionarioId < y.funcionarioId ? -1 : 1)).forEach((r) => {
      if (!equipe.has(r.funcionarioId)) return void c.alternativas.push({ com: r.funcionarioId, viavel: false, motivo: "fora da equipe produtiva" });
      if (ausenteNoSlot(entrada, r.funcionarioId, slot)) return void c.alternativas.push({ com: r.funcionarioId, viavel: false, motivo: "ausente no período" });
      if (r.maquinaId && !maquinaDisponivelNoSlot(entrada, r.maquinaId, slot)) return void c.alternativas.push({ com: r.funcionarioId, viavel: false, motivo: `máquina ${r.maquinaId} indisponível` });
      if (proibido(r.funcionarioId, p.operacaoId)) return void c.alternativas.push({ com: r.funcionarioId, viavel: false, motivo: `repetiria a operação ${p.operacaoId} que executou no período anterior` });
      if (r.maquinaId && proibido(c.funcionarioId, r.operacaoId)) return void c.alternativas.push({ com: r.funcionarioId, viavel: false, motivo: `${c.funcionarioId} repetiria a operação ${r.operacaoId} no posto de ${r.funcionarioId}` });
      c.alternativas.push({ com: r.funcionarioId, viavel: true, motivo: r.maquinaId ? "troca simples válida" : "assume o posto (estava ociosa); o conflitante fica ocioso" });
    });
  });

  if (!reparar) {
    const st: StatusCompromisso = conflitos.length ? "conflito_rotacao_comprometido" : "compromisso_valido";
    return { ...vazio, status: st, statusErgonomico: st, conflitos, impedimentos, original, reparado: original };
  }

  // ---- 1) REPARO DE RECURSO: máquina equivalente ----
  const usadas = new Set(original.filter((a) => a.maquinaId).map((a) => a.maquinaId as string));
  const quebrados = original.filter((a) => a.maquinaId && !maquinaDisponivelNoSlot(entrada, a.maquinaId, slot)).sort((a, b) => ((a.maquinaId as string) < (b.maquinaId as string) ? -1 : 1));
  const substituta = substituirMaquinas(entrada, slot, quebrados, usadas);
  const trocasMaquina: TrocaMaquina[] = [...substituta.entries()].map(([q, m]) => ({ funcionarioId: q.funcionarioId, de: q.maquinaId as string, para: m, produtoId: q.produtoId, etapaId: q.etapaId }));

  // ---- 2) REPARO DE PESSOAS ----
  interface PostoAtrib { linha: AlocacaoEscala; maquinaFinal: string; fisico: boolean; donoOriginal: string }
  const postos: PostoAtrib[] = [];
  const vazios: PostoVazio[] = [];
  const donoDePostoPerdido = new Set<string>();
  original.filter((a) => a.maquinaId).forEach((a) => {
    const maqOk = maquinaDisponivelNoSlot(entrada, a.maquinaId as string, slot);
    const sub = substituta.get(a);
    const fis = !presente(a.funcionarioId) || !maqOk;
    if (!maqOk && !sub) return void (donoDePostoPerdido.add(a.funcionarioId), vazios.push({ ...postoDe(a), causa: "inviavel", detalhe: `máquina ${a.maquinaId} indisponível e sem máquina equivalente livre` }));
    postos.push({ linha: a, maquinaFinal: maqOk ? (a.maquinaId as string) : (sub as string), fisico: fis, donoOriginal: a.funcionarioId });
  });
  const pessoas = original.filter((a) => presente(a.funcionarioId)).sort((a, b) => (a.funcionarioId < b.funcionarioId ? -1 : 1));
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
      if (proibido(pe.funcionarioId, po.linha.operacaoId)) return void linha.push(PROIBIDO);
      const mesmo = po.donoOriginal === pe.funcionarioId;
      const mudou = mesmo ? 0 : BASE_TROCA + (manual ? PEN_MANUAL : 0) + (pe.maquinaId ? 0 : PEN_OCIOSO);
      linha.push(mudou + equidade.custo(pe.funcionarioId, po.linha.operacaoId as string, po.maquinaFinal) / ESCALA_EQUIDADE);
    });
    const saiu = pe.maquinaId ? BASE_TROCA + (manual ? PEN_MANUAL : 0) : 0;
    for (let k = 0; k < n; k++) linha.push(saiu);
    custo.push(linha);
  });
  for (let k = 0; k < m; k++) custo.push([...Array(m).fill(VAZIO), ...Array(n).fill(0)]);
  const atrib = atribuicaoMinima(custo);

  const novaPorPessoa = new Map<string, AlocacaoEscala>();
  const ocupados = new Set<number>();
  pessoas.forEach((pe, i) => {
    const col = atrib[i];
    if (col < m) {
      ocupados.add(col);
      const po = postos[col];
      const sem = po.donoOriginal === pe.funcionarioId && po.maquinaFinal === po.linha.maquinaId;
      novaPorPessoa.set(pe.funcionarioId, sem ? pe : { ...pe, maquinaId: po.maquinaFinal, produtoId: po.linha.produtoId, etapaId: po.linha.etapaId, operacaoId: po.linha.operacaoId, pecas: po.linha.pecas, pecasAdicional: po.linha.pecasAdicional, tipoAdicional: po.linha.tipoAdicional, motivoSemPosto: null, origem: po.donoOriginal === pe.funcionarioId ? pe.origem : "auto" });
    } else if (pe.maquinaId) {
      novaPorPessoa.set(pe.funcionarioId, { ...pe, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, tipoAdicional: undefined, motivoSemPosto: donoDePostoPerdido.has(pe.funcionarioId) ? MOTIVO_POSTO_INVIAVEL : MOTIVO_CONFLITO_ERGONOMICO, origem: "auto" });
    } else novaPorPessoa.set(pe.funcionarioId, pe);
  });
  postos.forEach((po, j) => {
    if (!ocupados.has(j)) vazios.push({ ...postoDe(po.linha), maquinaId: po.maquinaFinal, causa: po.fisico ? "inviavel" : "revezamento", detalhe: po.fisico ? "posto sem pessoa válida (ausência/equipe) que não repita operação" : "nenhuma redistribuição válida mantém o posto sem repetir operação" });
  });
  const reparado = original.map((a) => {
    const nova = novaPorPessoa.get(a.funcionarioId);
    if (nova) return nova;
    return a.maquinaId ? { ...a, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, tipoAdicional: undefined, motivoSemPosto: MOTIVO_AUSENTE_COMPROMISSO, origem: "auto" as const } : a;
  });

  // contingências: posto de máquina parada SEM equivalente na Previsão, mas com máquina compatível livre fora dela (só registro)
  const contingencias: ContingenciaMaquina[] = [];
  quebrados.filter((q) => !substituta.has(q)).forEach((q) => {
    const pool = entrada.pools.find((p) => p.produtoId === q.produtoId && p.etapaId === q.etapaId && p.operacaoId === q.operacaoId);
    [...new Set(pool?.maquinasCompativeisIds ?? [])].sort()
      .filter((m) => !(pool?.maquinasIds ?? []).includes(m) && !usadas.has(m) && maquinaDisponivelNoSlot(entrada, m, slot))
      .forEach((m) => contingencias.push({ maquinaId: m, produtoId: q.produtoId, etapaId: q.etapaId, operacaoId: q.operacaoId, postoAfetado: { maquinaId: q.maquinaId as string, funcionarioId: q.funcionarioId }, motivoNaoUsada: "fora da Previsão" }));
  });
  const trocas: TrocaReparo[] = [];
  original.forEach((a, i) => { if (chaveLinha(a) !== chaveLinha(reparado[i])) trocas.push({ funcionarioId: a.funcionarioId, de: a.maquinaId ? postoDe(a) : null, para: reparado[i].maquinaId ? postoDe(reparado[i]) : null }); });

  // ---- status e alertas ----
  const vaziosRot = vazios.filter((v) => v.causa === "revezamento");
  const vaziosInv = vazios.filter((v) => v.causa === "inviavel");
  const statusErgonomico: StatusCompromisso = conflitos.length === 0 ? "compromisso_valido" : vaziosRot.length === 0 ? "compromisso_reparavel" : "compromisso_nao_reparavel";
  const statusFisico: StatusCompromisso | null = impedimentos.length === 0 ? null : vaziosInv.length === 0 ? "compromisso_inviavel_reparavel" : "compromisso_inviavel_nao_reparavel";
  const rot = `${slot.periodoId.toUpperCase()} de ${slot.data.slice(8)}/${slot.data.slice(5, 7)}`;
  const alertas: AlertaEscala[] = [];
  const detalhe = conflitos.map((c) => `${c.funcionarioId}: executou ${c.operacaoAnterior}${c.exposicaoIncerta ? " (exposição incerta, proibição conservadora)" : ""} em ${c.periodoAnterior.periodoId.toUpperCase()} e repetiria ${c.operacaoRepetida} (posto ${c.posto.maquinaId}); ${c.alternativas.filter((x) => x.viavel).length} troca(s) simples viável(is) de ${c.alternativas.length} tentada(s)`).join(" | ");
  if (statusErgonomico === "compromisso_nao_reparavel") {
    alertas.push({ tipo: "compromisso_nao_reparavel", data: slot.data, periodoId: slot.periodoId, quantidade: vaziosRot.length, motivo: `Conflito ergonômico no período ${rot}. A execução real do ${ant.periodoId.toUpperCase()} tornou a escala comprometida inválida. Não existe redistribuição válida que mantenha todos os postos sem repetição de operação (${vaziosRot.length} posto(s) ficariam sem operador). ${detalhe}` });
  } else if (statusErgonomico === "compromisso_reparavel") {
    alertas.push({ tipo: "conflito_rotacao_comprometido", data: slot.data, periodoId: slot.periodoId, quantidade: conflitos.length, motivo: `A execução real do ${ant.periodoId.toUpperCase()} faria ${conflitos.length} pessoa(s) repetir operação em ${rot}. Reparo mínimo possível: ${trocas.length} linha(s) alterada(s), todos os postos mantidos. ${detalhe}` });
  }
  const texto = impedimentos.map((i) => (i.tipo === "maquina_indisponivel" ? `máquina ${i.maquinaId} indisponível${trocasMaquina.find((t) => t.de === i.maquinaId) ? ` → substituída por ${trocasMaquina.find((t) => t.de === i.maquinaId)?.para}` : " (sem equivalente)"}` : `${i.funcionarioId} ${i.tipo === "funcionario_ausente" ? "ausente" : "fora da equipe"} (posto ${i.posto.maquinaId})`)).join("; ");
  if (statusFisico === "compromisso_inviavel_nao_reparavel") {
    alertas.push({ tipo: "compromisso_inviavel_nao_reparavel", data: slot.data, periodoId: slot.periodoId, quantidade: vaziosInv.length, motivo: `Compromisso inviável no período ${rot}: ${texto}. Não existe cobertura/recurso equivalente válido para ${vaziosInv.length} posto(s), que ficam sem operador.` });
  } else if (statusFisico === "compromisso_inviavel_reparavel") {
    alertas.push({ tipo: "compromisso_inviavel_reparavel", data: slot.data, periodoId: slot.periodoId, quantidade: impedimentos.length, motivo: `Compromisso inviável no período ${rot}: ${texto}. Reparo mínimo possível: ${trocas.length} linha(s) alterada(s), todos os postos mantidos.` });
  }
  contingencias.forEach((c) => alertas.push({ tipo: "contingencia_possivel", data: slot.data, periodoId: slot.periodoId, motivo: `Contingência possível: a máquina ${c.postoAfetado.maquinaId} está indisponível; a máquina ${c.maquinaId} é compatível com esta etapa, mas não está selecionada na Previsão — não foi usada automaticamente.` }));
  return { status: statusFisico ?? statusErgonomico, statusErgonomico, statusFisico, slot: slot.indice, conflitos, impedimentos, original, reparado, trocas, trocasMaquina, linhasAlteradas: trocas.length, postosPreservados: vazios.length === 0, postosVazios: vazios, contingencias, alertas };
}

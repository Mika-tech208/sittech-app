/* eslint-disable @typescript-eslint/no-explicit-any */
// ANÁLISE ECONÔMICA OFFLINE/SOMBRA do dia seguinte (30/10) — objetivo: maximizar o RESULTADO ECONÔMICO FINAL da semana (receita/lucro-tela de produto FINAL entregue até sexta)
// com o menor WIP inútil. NADA é gravado em PROD: só SELECT (rodaprod.sh) + cálculo offline. Produtividade só por POSTO (produto×operação×máquina); a pessoa é escolhida depois
// (disponibilidade, elegibilidade, revezamento por bloco HARD, churn, exposição). Só máquinas da Previsão. Equivalências desligadas. Passado e período em andamento congelados.
//
// Duas fotos (mesmo script):
//   (1) PROJETADA (padrão, sem --agora): estado = plano ativo seguindo até o fim de T3 de hoje (T1–T3 executados como planejado; apontamentos de T1+ de hoje IGNORADOS), instante 13:00.
//   (2) REAL (com --agora HH:MM): lê os apontamentos reais até esse instante; períodos fechados sem apontamento = [0, planejado] (nunca assumidos); o resto de hoje segue o plano.
// Uso: rodar-30-10.sh [--agora HH:MM|ISO] [--data 2026-10-29] [--alvo 2026-10-30] [--contagem "Produto:Origem>Seguinte=saldo@HH:MM"]... [--cache] [--saida-dir dir] [--sem-remocao] [--sem-maquina-extra]
import * as fs from "node:fs";
import * as path from "node:path";
import { buscar, carregar, SCRATCH, type DadosCarregados } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { slotsDa } from "./estado";
import { maquinaDisponivelNoSlot } from "@/features/escala/disponibilidade";
import { avaliarPlano, planejarComFluxo, verificarRestricoesDuras, type OpcoesFluxo } from "@/features/escala/fluxo";
import { montarEstado } from "@/features/escala/fluxo/estado";
import { analisarCapacidade } from "@/features/escala/fluxo/capacidade";
import { contagensDoPlano, varrerContagensPreservando } from "@/features/escala/fluxo/otimizar";
import { lucroHoraDaTela } from "@/features/escala/fluxo/economiaProduto";
import { fatoresParaMotor } from "@/features/escala/produtividade";
import { capsDoPlano, rodar as rodarSim } from "@/features/escala/fluxo/avaliar";
import { janelaDaAusencia, fimDaJornadaMin } from "@/lib/escala/ausenciaAberta";
import { verificarIndependente } from "../escala-fluxo-replay/independente";
import { ContadoresEquidade } from "@/features/escala/equidade";
import { melhorMovimento, type CandidatoMovimento } from "@/features/escala/fluxo/desempate";
import type { ContagemFisicaPar, DadosProducaoReal as DadosProducaoReal0 } from "@/features/escala/fluxo/tipos";
import { prepararFluxo } from "@/features/escala/fluxo/estado";
import { demandaFutura } from "@/features/escala/fluxo/demandaFutura";
import { tetoAntecipacao } from "@/features/escala/fluxo/tetoAntecipacao";
import { melhorPlano, estatisticaPosto, type PlanoMedido } from "@/features/escala/fluxo/valorFuturo";
import { aberturaProximaSemana, carregarWipAbertura } from "@/features/escala/fluxo/proximaSemana";
import { slotsProximaSemana, montarEntradaProximaSemana, contagensDeAbertura, avaliarSemanaSeguinte, tetoDeAntecipacao, type ResultadoSemanaSeguinte } from "@/features/escala/fluxo/proximaSemana";
import { decidirPessoaParada, type OpcaoDePosto } from "@/features/escala/fluxo/pessoaParada";
import type { AlocacaoEscala } from "@/features/escala/types";

const T0 = Date.now();
const marca = (m: string) => console.error(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);
const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf("--" + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; };
const args = (k: string) => argv.flatMap((a, i) => (a === "--" + k && argv[i + 1] ? [argv[i + 1]] : []));
const spData = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);
const hoje = arg("data") ?? spData(Date.now());
const parseAgora = (s: string) => (/^\d{1,2}:\d{2}$/.test(s) ? Date.parse(`${hoje}T${s.padStart(5, "0")}:00-03:00`) : Date.parse(s));
const modo: "projetada" | "real" = (arg("modo") as any) ?? (arg("agora") ? "real" : "projetada");
const agoraMs = arg("agora") ? parseAgora(arg("agora") as string) : modo === "projetada" ? Date.parse(`${hoje}T13:00:00-03:00`) : Date.now();
const segunda = (iso: string) => { const dt = new Date(iso + "T12:00:00Z"); const dow = (dt.getUTCDay() + 6) % 7; return new Date(dt.getTime() - dow * 86400000).toISOString().slice(0, 10); };
const semana = arg("semana") ?? segunda(hoje);
const somaDias = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const brl = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sg = (n: number) => (n >= 0 ? "+" : "") + brl(n);
const n0 = (n: number) => Math.round(n).toLocaleString("pt-BR");
const sn0 = (n: number) => (n >= 0 ? "+" : "") + n0(n);
const hhmm = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(11, 16);
const rotFoto = modo === "projetada" ? "PROJETADA (plano ativo segue até o fim de T3; T1–T3 de hoje como planejado)" : `REAL (apontamentos até ${hhmm(agoraMs)}; fechados sem apontamento = [0, planejado])`;
const K_TELA = 31.92;

// ------------------------------------------------------------------------------------------------ estado real (SELECT)
marca(`lendo PROD (SELECT) — foto ${modo}, instante ${hhmm(agoraMs)}`);
const bruto = buscar({
  semana, antesIso: new Date(agoraMs).toISOString(), depoisIso: "2999-01-01T00:00:00Z", usarCache: argv.includes("--cache"),
  somente: ["q_dec", "q_apont", "q_aloc", "q_fluxo", "q_nomes", "q_par", "q_live_ausencias", "q_live_paradas", "q_live_equipe", "q_live_maquinas", "q_hist", "q_prox"],
});
const d0 = carregar(bruto);
marca("estado lido");
const nome = (id: string | null | undefined) => (id ? (d0.nomes[id] ?? id.slice(0, 8)).trim().replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Autom.").replace('Conector 3/4"', "Conector 3/4 Conv.") : "—");
const snap = d0.decisao.entrada;
const periodosDia = snap.dias[0]?.periodos ?? [];
const fimJornada = fimDaJornadaMin(periodosDia as any);
const ausencias = bruto.q_live_ausencias.map((a: any) => ({ funcionarioId: a.funcionario_id, data: a.data, ...janelaDaAusencia({ horarioInicio: a.hi, horarioFim: a.hf, emAberto: !!a.em_aberto } as any, fimJornada) }));
const indisponibilidades = bruto.q_live_paradas.map((p: any) => ({ maquinaId: p.maquina_id, desdeMs: Math.round(Number(p.desde_ms)), liberadaEmMs: p.liberada_ms === null ? null : Math.round(Number(p.liberada_ms)) }));
const equipeAtiva = bruto.q_live_equipe.filter((e: any) => e.ativo).map((e: any) => e.id);
const maquinasInativas = bruto.q_live_maquinas.filter((m: any) => m.tipo === "inativa").map((m: any) => m.maquina_id);
const maquinasIndispPrev = bruto.q_live_maquinas.filter((m: any) => m.tipo === "indisponivel_previsao").map((m: any) => m.maquina_id);
const slots = slotsDa(d0);
const poolsSnap = snap.pools as any[];

function resolver(spec: string): ContagemFisicaPar {
  const m = /^([^:]+):([^>]+)>([^=]+)=([\d.,]+)(?:@(?:(\d{1,2})\/(\d{1,2}) )?(\d{1,2}):(\d{2}))?$/.exec(spec.trim());
  if (!m) throw new Error(`--contagem inválida: "${spec}"`);
  const [, tp, to, ts, sal, dd, mo, hh, mm] = m;
  const prods = [...new Set(poolsSnap.map((p) => p.produtoId as string))].filter((id) => nome(id).toLowerCase().includes(tp.trim().toLowerCase())).sort((a, b) => nome(a).length - nome(b).length);
  if (prods.length === 0) throw new Error(`produto não encontrado: ${tp}`);
  const produtoId = prods[0];
  const etapas = poolsSnap.filter((p) => p.produtoId === produtoId).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
  const i = etapas.findIndex((p) => nome(p.operacaoId).toLowerCase().includes(to.trim().toLowerCase()));
  if (i < 0 || !etapas[i + 1] || !nome(etapas[i + 1].operacaoId).toLowerCase().includes(ts.trim().toLowerCase())) throw new Error(`par não encontrado/consecutivo em ${nome(produtoId)}: ${to} > ${ts}`);
  const dia = dd ? `${hoje.slice(0, 4)}-${mo.padStart(2, "0")}-${dd.padStart(2, "0")}` : hoje;
  const quando = hh ? Date.parse(`${dia}T${hh.padStart(2, "0")}:${mm}:00-03:00`) : agoraMs;
  return { produtoId, etapaOrigemId: etapas[i].etapaId, etapaSeguinteId: etapas[i + 1].etapaId, saldo: Number(sal.replace(/\./g, "").replace(",", ".")), contadoEmMs: quando, informadoPor: "Mikael (análise offline)", observacao: spec };
}
const novas: ContagemFisicaPar[] = args("contagem").map(resolver);
const d: DadosCarregados = {
  ...d0,
  cfg: { ...d0.cfg, contagensFisicas: [...d0.cfg.contagensFisicas, ...novas] },
  decisao: { ...d0.decisao, entrada: { ...snap, ausencias: ausencias as any, indisponibilidades: indisponibilidades as any, funcionarios: equipeAtiva.length ? equipeAtiva : snap.funcionarios, maquinasInativas, maquinasIndisponiveisPrevisao: maquinasIndispPrev } },
};

// ------------------------------------------------------------------------------------------------ escopo
const alvo = arg("alvo") ?? (() => { for (let k = 1; k < 8; k++) { const dd = somaDias(hoje, k); if (slots.some((s) => s.data === dd)) return dd; } return somaDias(hoje, 1); })();
const idxAlvo = slots.find((s) => s.data === alvo)?.indice;
if (idxAlvo === undefined) throw new Error(`dia alvo ${alvo} sem períodos na semana`);
const slotsAlvo = slots.filter((s) => s.data === alvo);
const ultimoSlot = slots.length - 1;
const dia31 = somaDias(alvo, 1);
const existe31 = slots.some((s) => s.data === dia31);
const diaSemana = (iso: string) => ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][new Date(iso + "T12:00:00Z").getUTCDay()];
const idxB = slots.find((s) => s.data === hoje && s.inicioMs >= agoraMs)?.indice; // primeiro período de hoje ainda NÃO iniciado
const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
const slotDe = (a: { data: string; periodoId: string }) => idx.get(`${a.data}|${a.periodoId}`) ?? -1;
const slotRot = (t: number) => `${slots[t].data.slice(5)} ${slots[t].periodoId.toUpperCase()}`;
const planoAtual = d.planoAtual;
const posto = (a?: AlocacaoEscala) => (a ? `${a.maquinaId ?? ""}|${a.produtoId ?? ""}|${a.etapaId ?? ""}` : "");

const OPC: Partial<OpcoesFluxo> = { objetivo: "lucro_hora", atingibilidadeModo: "ativo", atingibilidadeK: 2, diversificarCandidatos: true, economiaSlots: 99 };
const OPC_FIN: Partial<OpcoesFluxo> = { ...OPC, objetivo: "financeiro" };
const MEDIR: Partial<OpcoesFluxo> = { objetivo: "lucro_hora", atingibilidadeModo: "sombra", economiaSlots: 99 };
const MEDIR_REC: Partial<OpcoesFluxo> = { objetivo: "financeiro", atingibilidadeModo: "sombra", economiaSlots: 99 };

// verificação independente + núcleo (plano completo = congeladas + futuras)
interface Escopo { idxIni: number; ST: (e: Partial<OpcoesFluxo>) => ReturnType<typeof montarEstadoAting>; estM: ReturnType<typeof montarEstadoAting>; estRec: ReturnType<typeof montarEstadoAting>; [k: string]: any }
function criarEscopo(idxIni: number, ajuste?: (pools: any[], opcoes: OpcoesFluxo) => any[]): Escopo {
  const ST = (extra: Partial<OpcoesFluxo>) => { const e = montarEstadoAting(d, agoraMs, planoAtual, 100 + idxIni, extra, true); if (!ajuste) return e; const entrada = { ...e.entrada, pools: ajuste(e.entrada.pools, e.opcoes) }; return { ...e, entrada, ctx: prepararFluxo(entrada, e.dados, e.opcoes) } as typeof e; };
  const estM = ST(MEDIR);
  const estRec = ST(MEDIR_REC);
  const fut = (l: AlocacaoEscala[]) => l.filter((a) => slotDe(a) >= idxIni);
  const completo = (futuras: AlocacaoEscala[]) => [...estM.entrada.congeladas, ...futuras];
  const foraDaPool = (a: AlocacaoEscala) => !!a.maquinaId && !(estM.entrada.pools.find((p) => p.produtoId === a.produtoId && p.etapaId === a.etapaId)?.maquinasIds ?? []).includes(a.maquinaId as string);
  const avaliar = (futuras0: AlocacaoEscala[]) => {
    const futuras = futuras0.map((a) => (foraDaPool(a) ? ({ ...a, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, motivoSemPosto: "fora_da_pool" } as AlocacaoEscala) : a));
    const L = avaliarPlano(estM.entrada, estM.dados, completo(futuras), estM.opcoes);
    const R = avaliarPlano(estRec.entrada, estRec.dados, completo(futuras), estRec.opcoes);
    return { L, R, lucro: L.financeiro!.total.rsProjetadoFechamento, receita: R.financeiro!.total.rsProjetadoFechamento };
  };
  const capDe = (futuras: AlocacaoEscala[], qual: "L" | "R" = "L") => {
    const cnt = contagensDoPlano(estM.ctx, futuras);
    const mins = varrerContagensPreservando(estM.ctx, cnt, {}, true).minimos;
    return analisarCapacidade((qual === "L" ? estM : estRec).ctx, completo(futuras), mins);
  };
  const planoCompleto = (futuras: AlocacaoEscala[]) => planoAtual.filter((a) => slotDe(a) < idxIni).concat(futuras);
  // resto da semana REPLANEJADO pelo motor a partir do slot `desde` (as linhas anteriores ficam como estão)
  const restoReplan = (futuras: AlocacaoEscala[], desde: number, qual: "prod" | "fin" | "lucro" = "fin") => {
    if (desde > ultimoSlot) return avaliar(futuras);
    const extra = qual === "prod" ? {} : qual === "fin" ? OPC_FIN : OPC;
    const full = planoCompleto(futuras);
    const e = montarEstadoAting(d, agoraMs, full, 100 + desde, extra, true);
    const r = planejarComFluxo(e.entrada, e.dados, e.opcoes);
    return avaliar(futuras.filter((a) => slotDe(a) < desde).concat(fut(r.resultado.alocacoes).filter((a) => slotDe(a) >= desde)));
  };
  const selecionadas = (futuras: AlocacaoEscala[]) => futuras.filter((a) => a.maquinaId && !(estM.entrada.pools.find((p) => p.produtoId === a.produtoId && p.etapaId === a.etapaId)?.maquinasIds ?? []).includes(a.maquinaId as string));
  const validar = (futuras: AlocacaoEscala[]) => {
    const nucleo = verificarRestricoesDuras(estM.entrada, futuras);
    const envAnt = process.env.FREPLAY_ESCOPO;
    process.env.FREPLAY_ESCOPO = "bloco";
    const indep = verificarIndependente(estM.entrada, futuras, { planoVigente: planoAtual }).filter((v) => !v.aviso);
    if (envAnt === undefined) delete process.env.FREPLAY_ESCOPO; else process.env.FREPLAY_ESCOPO = envAnt;
    return { nucleo: nucleo.length, indep: indep.length, indepTipos: [...new Set(indep.map((v) => v.tipo))], bloco: indep.filter((v) => v.tipo === "mesma_operacao_no_bloco").length, foraDaPrevisao: selecionadas(futuras).length };
  };
  return { idxIni, ST, estM, estRec, fut, completo, avaliar, capDe, planoCompleto, restoReplan, selecionadas, validar };
}

// ------------------------------------------------------------------------------------------------ geração de candidatos, ajuste fino, métricas
const nomeNo = (k: string) => { const [p, e] = k.split("|"); const pool = poolsSnap.find((x) => x.produtoId === p && x.etapaId === e); return `${nome(p)} · ${pool ? nome(pool.operacaoId) : e.slice(0, 6)}`; };
const churnDe = (E: Escopo, vig: AlocacaoEscala[], plano: AlocacaoEscala[]) => {
  const vm = new Map(vig.map((a) => [`${slotDe(a)}|${a.funcionarioId}`, a]));
  const alt = plano.filter((a) => posto(vm.get(`${slotDe(a)}|${a.funcionarioId}`)) !== posto(a));
  const cel = (l: AlocacaoEscala[]) => new Set(l.filter((a) => a.maquinaId).map((a) => `${slotDe(a)}|${a.maquinaId}`));
  const cv = cel(vig), cp = cel(plano);
  return { linhas: alt.length, pessoas: new Set(alt.map((a) => a.funcionarioId)).size, postos: [...cv].filter((k) => !cp.has(k)).length + [...cp].filter((k) => !cv.has(k)).length };
};

function polir(E: Escopo, inicial: AlocacaoEscala[], vig: AlocacaoEscala[]) {
  const equidade = new ContadoresEquidade(E.estM.entrada.funcionarios.map((f) => f.id), E.estM.entrada.historicoEquidade);
  const operacoesCatalogo = new Set(E.estM.entrada.pools.map((q) => q.operacaoId));
  let plano = inicial.map((a) => ({ ...a }));
  const movs: any[] = [];
  let rejeitadas = 0;
  let atual = E.avaliar(plano);
  const vmap = new Map(vig.map((a) => [`${slotDe(a)}|${a.funcionarioId}`, a]));
  for (let r = 0; r < 8; r++) {
    const cap = E.capDe(plano, "R");
    const alvos = cap.capacidade.filter((c) => c.valorMarginalAdicionar > 1 && c.postosDisponiveis > 0);
    interface Cand extends CandidatoMovimento { novo: AlocacaoEscala[]; mov: any; av: ReturnType<typeof E.avaliar> }
    const cands: Cand[] = [];
    for (const c of alvos) {
      const no = E.estM.ctx.grafo.nos[c.no];
      const pool = E.estM.entrada.pools.find((q) => `${q.produtoId}|${q.etapaId}` === no.id);
      if (!pool) continue;
      const slot = E.estM.entrada.slots[c.slot];
      const usadas = new Set(plano.filter((a) => slotDe(a) === c.slot && a.maquinaId).map((a) => a.maquinaId));
      const livres = pool.maquinasIds.filter((m) => !usadas.has(m) && maquinaDisponivelNoSlot(E.estM.entrada, m, slot));
      if (livres.length === 0) continue;
      for (const a of plano.filter((x) => slotDe(x) === c.slot)) {
        const noA = a.maquinaId ? E.estM.ctx.grafo.noDoPool[`${a.produtoId}|${a.etapaId}`] : null;
        if (noA === c.no) continue;
        const vUlt = noA ? cap.capacidade.find((x) => x.slot === c.slot && x.no === noA)?.valorMarginalUltimo ?? 0 : 0;
        if (vUlt >= c.valorMarginalAdicionar - 0.5) continue;
        const nova: AlocacaoEscala = { ...a, maquinaId: livres[0], produtoId: pool.produtoId, etapaId: pool.etapaId, operacaoId: pool.operacaoId, pecas: pool.metas[slot.periodoId] ?? 0, motivoSemPosto: null };
        const novo = plano.map((x) => (x === a ? nova : x));
        if (verificarRestricoesDuras(E.estM.entrada, novo).length > 0) { rejeitadas++; continue; }
        const av = E.avaliar(novo);
        if (av.L.atingibilidade!.atingiveisPerdidas > atual.L.atingibilidade!.atingiveisPerdidas) continue;
        const ganho = av.receita - atual.receita;
        if (ganho <= 1 || av.lucro < atual.lucro - 0.5) continue;
        const bloco = (x: { data: string; periodoId: string }) => `${x.data}|${x.periodoId[0]}`;
        const expostas = new Set([...E.estM.entrada.congeladas, ...novo].filter((x) => x.funcionarioId === a.funcionarioId && x.maquinaId && x.operacaoId && bloco(x) === bloco(nova)).map((x) => x.operacaoId));
        const anterior = [...E.estM.entrada.congeladas, ...novo].find((x) => x.funcionarioId === a.funcionarioId && slotDe(x) === c.slot - 1 && x.maquinaId);
        cands.push({
          novo, av, ganho, folgaRevezamento: operacoesCatalogo.size - expostas.size, desvioExposicao: equidade.desvioOperacao(a.funcionarioId, pool.operacaoId),
          churn: novo.filter((x) => posto(vmap.get(`${slotDe(x)}|${x.funcionarioId}`)) !== posto(x)).length, continuidade: anterior?.maquinaId === nova.maquinaId ? 1 : 0,
          id: `${a.funcionarioId}|${c.no}|${c.slot}`, mov: { slot: c.slot, de: noA ? nomeNo(noA) : "sem posto", para: nomeNo(c.no), ganho },
        });
      }
    }
    const melhor = melhorMovimento(cands);
    if (melhor === null) break;
    plano = melhor.novo; atual = melhor.av; movs.push(melhor.mov);
  }
  return { plano, movs, rejeitadas };
}

interface Cand { rot: string; gerador: string; futuras: AlocacaoEscala[]; av?: ReturnType<Escopo["avaliar"]>; val?: ReturnType<Escopo["validar"]>; churn?: ReturnType<typeof churnDe> }
function candidatos(E: Escopo, comEstimador: boolean): Cand[] {
  const run = (extra: Partial<OpcoesFluxo>) => { const e = E.ST(extra); return E.fut(planejarComFluxo(e.entrada, e.dados, e.opcoes).resultado.alocacoes); };
  const out: Cand[] = [];
  out.push({ rot: "Vigente (gravado em PROD)", gerador: "plano ativo", futuras: E.fut(planoAtual) });
  out.push({ rot: "Motor ativo replanejado (opções do PROD, objetivo peças)", gerador: "motor ativo", futuras: run({}) });
  out.push({ rot: "Núcleo fluxo (receita final, k=2)", gerador: "fluxo/financeiro", futuras: run(OPC_FIN) });
  out.push({ rot: "Núcleo econômico (lucro/h tela limitado pelo valor marginal final, k=2)", gerador: "econômico/lucro_hora", futuras: run(OPC) });
  if (comEstimador) {
    const e0 = E.ST({});
    const periodos = [...new Set(e0.entrada.slots.map((x) => x.periodoId))];
    const fm = fatoresParaMotor(d.apontamentos.filter((a) => a.lancadoEmMs <= agoraMs) as never, e0.entrada.pools.map((p) => ({ produtoId: p.produtoId, etapaId: p.etapaId, operacaoId: p.operacaoId, maquinasIds: p.maquinasIds })), periodos, agoraMs);
    const fAtual = e0.opcoes.fatoresEmbutidos ?? {};
    const prov = (a: { produtoId: string; etapaId: string; periodoId: string; metaNominal: number }) => { const k = `${a.produtoId}|${a.etapaId}`; return { pecasPorPeriodo: a.metaNominal / (fAtual[k] ?? 1), fator: fm.porPoolPeriodo[k]?.[a.periodoId] ?? 1, fonte: "estimador (NÃO ativo; só gerador)", amostra: 0 }; };
    out.push({ rot: "Candidato do estimador (SÓ gerador; receita final, reavaliado na capacidade oficial)", gerador: "estimador/financeiro", futuras: run({ ...OPC_FIN, produtividade: prov }) });
    out.push({ rot: "Candidato do estimador (SÓ gerador; lucro/h, reavaliado na capacidade oficial)", gerador: "estimador/lucro_hora", futuras: run({ ...OPC, produtividade: prov }) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ ESCOPO A (dia alvo) — o que o usuário decidiu: manter T1–T3 de hoje
marca("escopo A: montando estado");
const EA = criarEscopo(idxAlvo);
const vigA = EA.fut(planoAtual);
marca("escopo A: gerando candidatos");
const candsA = candidatos(EA, true);
candsA.forEach((c) => { c.av = EA.avaliar(c.futuras); c.val = EA.validar(c.futuras); c.churn = churnDe(EA, vigA, c.futuras); });
marca("escopo A: candidatos avaliados; ajuste fino do melhor");
const validos = (c: Cand) => c.val!.nucleo + c.val!.indep + c.val!.foraDaPrevisao === 0;
const melhorBruto = [...candsA].filter((c) => c.rot !== candsA[0].rot && validos(c)).sort((a, b) => b.av!.receita - a.av!.receita || b.av!.lucro - a.av!.lucro)[0] ?? candsA[0];
const pol = polir(EA, melhorBruto.futuras, vigA);
if (pol.movs.length > 0) {
  const c: Cand = { rot: `${melhorBruto.rot} + ajuste fino pessoa/posto (${pol.movs.length} mov.)`, gerador: melhorBruto.gerador + "+polimento", futuras: pol.plano };
  c.av = EA.avaliar(c.futuras); c.val = EA.validar(c.futuras); c.churn = churnDe(EA, vigA, c.futuras);
  candsA.push(c);
}
// ---- variantes ENXUTAS: para de ocupar postos que não geram receita final (WIP inútil). As pessoas desses postos ficam SEM POSTO (ociosas/uso não mapeado): decisão humana, não entra na escolha automática.
function enxugar(E: Escopo, plano: AlocacaoEscala[], desde = 0) {
  let atual = plano.map((a) => ({ ...a }));
  let av = E.avaliar(atual);
  const parados: AlocacaoEscala[] = [];
  const ordem = [...atual].filter((a) => a.maquinaId && slotDe(a) >= desde).sort((x, y) => slotDe(y) - slotDe(x));
  for (const a0 of ordem) {
    const a = atual.find((x) => x.funcionarioId === a0.funcionarioId && slotDe(x) === slotDe(a0))!;
    if (!a.maquinaId) continue;
    const sem = semLinha(atual, [a]);
    const av2 = E.avaliar(sem);
    if (av2.receita >= av.receita - 0.5 && av2.lucro >= av.lucro - 0.5 && av2.L.totais.wipFinalLo < av.L.totais.wipFinalLo - 0.5 && av2.L.atingibilidade!.atingiveisPerdidas <= av.L.atingibilidade!.atingiveisPerdidas) { atual = sem; av = av2; parados.push(a); }
  }
  return { plano: atual, parados };
}
const semLinha = (plano: AlocacaoEscala[], alvos: AlocacaoEscala[]) => plano.map((a) => (alvos.includes(a) ? ({ ...a, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, motivoSemPosto: "ensaio_remocao" } as AlocacaoEscala) : a));
const enxutos: { cand: Cand; parados: AlocacaoEscala[]; base: string }[] = [];
for (const base of [candsA[0], melhorBruto]) {
  const e = enxugar(EA, base.futuras);
  if (e.parados.length === 0) continue;
  const c: Cand = { rot: `ENXUTO: ${base.rot} + parar ${e.parados.length} posto-período(s) sem valor final (pessoas ficam sem posto: decisão humana)`, gerador: base.gerador + "+enxuto", futuras: e.plano };
  c.av = EA.avaliar(c.futuras); c.val = EA.validar(c.futuras); c.churn = churnDe(EA, vigA, c.futuras);
  candsA.push(c); enxutos.push({ cand: c, parados: e.parados, base: base.rot });
}
const avVig = candsA[0].av!;
const FIN0 = avVig.L.financeiro!.total;

// ---- limiar de materialidade (1 erro-padrão do modelo para o escopo): σ da razão boas÷meta por período fechado × √n
const fechadosAnt = slots.filter((x) => x.indice < idxAlvo && x.fimMs + 10 * 60_000 <= agoraMs);
const razoes = fechadosAnt.flatMap((x) => {
  const as = d.apontamentos.filter((a) => a.data === x.data && a.periodoId === x.periodoId && a.status === "produzindo" && a.meta > 0 && a.lancadoEmMs <= agoraMs);
  return as.length >= 3 ? [as.reduce((t, a) => t + a.boas, 0) / as.reduce((t, a) => t + a.meta, 0)] : [];
});
const mediana = (v: number[]) => { const o = [...v].sort((p, q) => p - q); const n = o.length; return n === 0 ? NaN : n % 2 ? o[(n - 1) / 2] : (o[n / 2 - 1] + o[n / 2]) / 2; };
const medR = mediana(razoes);
const sigma = razoes.length >= 5 ? 1.4826 * mediana(razoes.map((r) => Math.abs(r - medR))) : 0.16;
const limiarEscopo = (E: Escopo, av: ReturnType<Escopo["avaliar"]>, n: number) => {
  const per = Math.max(1, slots.length - E.idxIni);
  const restL = Math.max(0, av.lucro - av.L.financeiro!.total.rsRealizado), restR = Math.max(0, av.receita - av.R.financeiro!.total.rsRealizado);
  return { lucro: (sigma / Math.sqrt(n)) * restL * (n / per), receita: (sigma / Math.sqrt(n)) * restR * (n / per), restL, restR };
};
const limA = limiarEscopo(EA, avVig, slotsAlvo.length);

// ---- escolha: melhor receita final; só troca se Δreceita ≥ limiar e lucro/WIP/atingibilidade não pioram; entre próximos, o mais estável
const ok = (c: Cand) => validos(c) && c.av!.L.atingibilidade!.atingiveisPerdidas <= avVig.L.atingibilidade!.atingiveisPerdidas && c.av!.L.totais.excessoWip <= avVig.L.totais.excessoWip + 1 && c.av!.lucro >= avVig.lucro - 1e-6;
const ehEnxuto = (c: Cand) => c.rot.startsWith("ENXUTO");
const elegiveis = candsA.slice(1).filter((c) => ok(c) && !ehEnxuto(c));
const topR = Math.max(...elegiveis.map((c) => c.av!.receita), -Infinity);
const proximos = elegiveis.filter((c) => c.av!.receita >= topR - limA.receita * 0.5);
const escolhidaA = (proximos.sort((a, b) => a.churn!.linhas - b.churn!.linhas || b.av!.receita - a.av!.receita)[0]) ?? null;
const ganhoRecA = escolhidaA ? escolhidaA.av!.receita - avVig.receita : 0;
const trocarA = !!escolhidaA && ganhoRecA >= limA.receita;
const PROP = (trocarA ? escolhidaA : (elegiveis.sort((a, b) => b.av!.receita - a.av!.receita)[0] ?? candsA[0])) as Cand; // sempre apresentado (mesmo se abaixo do limiar)
const avP = PROP.av!;

// ------------------------------------------------------------------------------------------------ medidas auxiliares
const estado = montarEstado(EA.estM.ctx);
const nosOrd = Object.keys(EA.estM.ctx.grafo.nos);
const prodSim = (E: Escopo, futuras: AlocacaoEscala[]) => {
  const caps = capsDoPlano(E.estM.ctx, futuras);
  const x: Record<string, number[]> = {}; const W: Record<string, number[]> = {};
  E.estM.ctx.grafo.grupos.forEach((g, gi) => { const r = rodarSim(E.estM.ctx, gi, caps, "lo", undefined, true); g.nos.forEach((n) => (x[n] = r.x[n] ?? [])); g.arestas.forEach((e) => (W[e] = r.traj[e] ?? [])); });
  return { x, W, caps };
};
const prodVig = prodSim(EA, vigA), prodP = prodSim(EA, PROP.futuras);
const cap0 = EA.capDe(PROP.futuras, "R"); const capVig = EA.capDe(vigA, "R");

// custo agregado por peça (convenção da tela: horas/peça × R$ 31,92) até a origem de cada aresta
const horasSlot = (slots[idxAlvo].fimMin - slots[idxAlvo].inicioMin) / 60;
const fAtualA = EA.estM.opcoes.fatoresEmbutidos ?? {};
const tempoPeca = (no: string) => { const pools = EA.estM.ctx.grafo.nos[no].membros.map((m) => EA.estM.ctx.poolsPorChave.get(m)!); const nominal = Math.max(...pools.map((p) => (p.metas[slotsAlvo[0].periodoId] ?? 0) / Math.max(1e-9, fAtualA[`${p.produtoId}|${p.etapaId}`] ?? 1)), 1e-9); return horasSlot / nominal; };
const custoAteNo = (no: string): number => { const preds = Object.values(EA.estM.ctx.grafo.nos).filter((n) => n.succ === no).map((n) => n.id); return tempoPeca(no) * K_TELA + (preds.length ? Math.max(...preds.map(custoAteNo)) : 0); };
const precoGrupo = (no: string) => EA.estM.ctx.grafo.nos[EA.estM.ctx.grafo.grupos.find((g) => g.nos.includes(no))!.sink].valorUnitario;

// ---- (a) WIP por par
const tetoPar = (chave: string) => estado.demanda.find((x: any) => x.chave === chave)?.tetoPeriodo ?? 0;
interface LinhaWip { par: string; chave: string; inicio: [number, number]; origem: string; conf: string; fimM3: Record<string, [number, number]>; fim: Record<string, [number, number]>; excesso: Record<string, number>; custoPeca: number; valorFinalPeca: number }
const wipTabela = (avs: Record<string, ReturnType<Escopo["avaliar"]>>): LinhaWip[] => estado.pares.map((p: any) => {
  const chave = `${p.produtoId}|${p.etapaOrigemId}`;
  const proj = estado.projecao.wip[chave] ?? p.wip;
  const no = EA.estM.ctx.grafo.noDoPool[chave];
  const fimM3: any = {}, fim: any = {}, exc: any = {};
  for (const [k, av] of Object.entries(avs)) {
    const tr = av.L.trajetoria.find((t) => t.chave === chave);
    const sM3 = tr?.porSlot.find((x) => x.slot === idxAlvo + 2), sF = tr?.porSlot.find((x) => x.slot === ultimoSlot);
    fimM3[k] = [sM3?.lo ?? 0, sM3?.hi ?? 0]; fim[k] = [sF?.lo ?? 0, sF?.hi ?? 0];
    exc[k] = Math.max(0, (sF?.hi ?? 0) - Math.max(proj.hi, tetoPar(chave)));
  }
  return { par: `${nomeNo(chave)} → ${nome(poolsSnap.find((x) => x.produtoId === p.produtoId && x.etapaId === p.etapaSeguinteId)?.operacaoId)}`, chave, inicio: [proj.lo, proj.hi], origem: p.origem === "confirmado" ? "contagem física" : "estimado", conf: p.confianca, fimM3, fim, excesso: exc, custoPeca: custoAteNo(no), valorFinalPeca: precoGrupo(no) };
});
const avsWip: Record<string, ReturnType<Escopo["avaliar"]>> = { vigente: avVig, proposto: avP };
const motorC = candsA.find((c) => c.gerador === "motor ativo");
if (motorC) avsWip.motor = motorC.av!;
const enxP = enxutos.find((e) => e.base === melhorBruto.rot);
if (enxP) avsWip.enxuto = enxP.cand.av!;
const wipRows = wipTabela(avsWip);

// ---- (c) diagnóstico de saturação por (etapa × período) — plano VIGENTE e PROPOSTO
function motivo(c: any, tot: { ocup: number }): string {
  const ms: string[] = [];
  if (c.postosOcupados >= c.postosMaximos) ms.push("SATURADO_POR_MAQUINA");
  else {
    if (c.diagnostico === "GARGALO_PESSOA") ms.push("SATURADO_POR_PESSOA");
    else if (c.diagnostico === "GARGALO_WIP_MATERIAL") ms.push("SATURADO_POR_WIP");
    else if (c.diagnostico === "GARGALO_DOWNSTREAM") ms.push("SATURADO_POR_DOWNSTREAM");
    else if (c.diagnostico === "FOLGA_FUTURA") ms.push(c.slot >= ultimoSlot ? "SATURADO_POR_TEMPO" : "SATURADO_POR_DEMANDA");
  }
  if (c.postosOcupados > 0 && c.valorMarginalUltimo <= 0.005) ms.push("V_ÚLTIMO=0 (resto fixo)");
  void tot;
  return ms.join(" + ") || "livre com valor";
}
// refinamento POR_DOWNSTREAM/POR_DEMANDA/POR_TEMPO para posto ocupado=máx cujo último posto não vale nada
const motivoRico = (c: any, cap: ReturnType<typeof analisarCapacidade>) => {
  let m = motivo(c, { ocup: 0 });
  if (c.postosOcupados > 0 && c.valorMarginalUltimo <= 0.005) {
    // por que o último posto não vale nada? downstream sem capacidade (a jusante saturado) × demanda/meta fechada × fim da semana
    const no = EA.estM.ctx.grafo.nos[c.no];
    const sucs = no.succ ? cap.capacidade.filter((x) => x.slot === c.slot && x.no === no.succ) : [];
    if (no.final) m += c.slot >= ultimoSlot ? " ⇒ POR_DEMANDA (meta/estoque a montante já esgotado)" : " ⇒ POR_DEMANDA/POR_TEMPO (períodos seguintes têm folga para embalar o mesmo material; valor real = coluna replanejada)";
    else if (sucs.length && sucs[0].postosOcupados >= sucs[0].postosMaximos) m += " ⇒ POR_DOWNSTREAM (posto seguinte saturado)";
    else if (c.slot >= ultimoSlot) m += " ⇒ POR_TEMPO (não há período depois para consumir)";
    else m += " ⇒ POR_WIP/POR_DEMANDA (estoque/pipeline já cobre o que o final absorve; valor real = coluna replanejada)";
  }
  return m;
};

// ---- (e) valor do posto ocupado por remoção (resto fixo e resto replanejado) + (e2) +1 pessoa + (e3) +1 máquina (informativo)
interface Remocao { no: string; slot: number; maquina: string; posto: string; dReceitaFixo: number; dLucroFixo: number; dFinalFixo: number; dWipFixo: number; dReceitaRep: number | null; dLucroRep: number | null; dFinalRep: number | null; dWipRep: number | null; mais1Pessoa: number; mais1PessoaL: number }
const remocoes: Record<string, Remocao[]> = { vigente: [], proposto: [] };
const baseRep: Record<string, Record<number, ReturnType<Escopo["avaliar"]>>> = { vigente: {}, proposto: {} };
const comRemocao = !argv.includes("--sem-remocao");
const tempoLimiteRem = Number(process.env.REM_TEMPO_S ?? 900);
if (comRemocao) {
  for (const [rot, plano, cap] of [["proposto", PROP.futuras, cap0], ["vigente", vigA, capVig]] as [string, AlocacaoEscala[], typeof cap0][]) {
    const base = EA.avaliar(plano);
    marca(`remoção (${rot}): ${plano.filter((a) => a.maquinaId).length} linhas com posto`);
    const capL = EA.capDe(plano, "L");
    for (const a of plano.filter((x) => x.maquinaId).sort((x, y) => slotDe(x) - slotDe(y))) {
      const t = slotDe(a);
      const sem = semLinha(plano, [a]);
      const av = EA.avaliar(sem);
      let rep: ReturnType<Escopo["avaliar"]> | null = null;
      if ((Date.now() - T0) / 1000 < tempoLimiteRem + 600) {
        if (!baseRep[rot][t]) baseRep[rot][t] = EA.restoReplan(plano.filter((x) => slotDe(x) <= t), t + 1, "fin");
        rep = EA.restoReplan(sem.filter((x) => slotDe(x) <= t), t + 1, "fin");
      }
      const noA = EA.estM.ctx.grafo.noDoPool[`${a.produtoId}|${a.etapaId}`];
      const rowR = cap.capacidade.find((c) => c.slot === t && c.no === noA), rowL = capL.capacidade.find((c) => c.slot === t && c.no === noA);
      remocoes[rot].push({
        no: noA, slot: t, maquina: nome(a.maquinaId), posto: `${nome(a.operacaoId)} · ${nome(a.produtoId)}`,
        dReceitaFixo: av.receita - base.receita, dLucroFixo: av.lucro - base.lucro, dFinalFixo: av.L.totais.finalEntregueLo - base.L.totais.finalEntregueLo, dWipFixo: av.L.totais.wipFinalLo - base.L.totais.wipFinalLo,
        dReceitaRep: rep ? rep.receita - baseRep[rot][t].receita : null, dLucroRep: rep ? rep.lucro - baseRep[rot][t].lucro : null, dFinalRep: rep ? rep.L.totais.finalEntregueLo - baseRep[rot][t].L.totais.finalEntregueLo : null, dWipRep: rep ? rep.L.totais.wipFinalLo - baseRep[rot][t].L.totais.wipFinalLo : null,
        mais1Pessoa: rowR?.valorMarginalAdicionar ?? 0, mais1PessoaL: rowL?.valorMarginalAdicionar ?? 0,
      });
    }
  }
}
// +1 máquina (informativo): pool com máquina fantasma, plano replanejado inteiro do dia (receita)
interface MaisMaquina { no: string; rot: string; dReceita: number; dLucro: number; dWip: number }
const maisMaquina: MaisMaquina[] = [];
if (!argv.includes("--sem-maquina-extra") && comRemocao) {
  try {
    const e0 = EA.ST(OPC_FIN);
    const base = planejarComFluxo(e0.entrada, e0.dados, e0.opcoes);
    const baseAv = EA.avaliar(EA.fut(base.resultado.alocacoes));
    const nosProd = nosOrd.filter((n) => EA.estM.ctx.grafo.nos[n].membros.length > 0);
    for (const n of nosProd) {
      const membros = new Set(EA.estM.ctx.grafo.nos[n].membros);
      const entrada = { ...e0.entrada, pools: e0.entrada.pools.map((p) => (membros.has(`${p.produtoId}|${p.etapaId}`) ? { ...p, maquinasIds: [...p.maquinasIds, `__EXTRA_${n}`] } : p)) };
      const r = planejarComFluxo(entrada as any, e0.dados, e0.opcoes);
      const fu = EA.fut(r.resultado.alocacoes).map((a) => a); // ocupa a máquina extra só no plano de ensaio; avaliador oficial desconhece a máquina extra ⇒ mede com ctx modificado
      const E2 = montarEstadoAting(d, agoraMs, planoAtual, 100 + idxAlvo, MEDIR, true);
      const E2r = montarEstadoAting(d, agoraMs, planoAtual, 100 + idxAlvo, MEDIR_REC, true);
      const mod = (e: typeof E2) => ({ ...e.entrada, pools: e.entrada.pools.map((p) => (membros.has(`${p.produtoId}|${p.etapaId}`) ? { ...p, maquinasIds: [...p.maquinasIds, `__EXTRA_${n}`] } : p)) });
      const L = avaliarPlano(mod(E2) as any, E2.dados, [...E2.entrada.congeladas, ...fu], E2.opcoes);
      const R = avaliarPlano(mod(E2r) as any, E2r.dados, [...E2r.entrada.congeladas, ...fu], E2r.opcoes);
      maisMaquina.push({ no: n, rot: nomeNo(n), dReceita: R.financeiro!.total.rsProjetadoFechamento - baseAv.receita, dLucro: L.financeiro!.total.rsProjetadoFechamento - baseAv.lucro, dWip: L.totais.wipFinalLo - baseAv.L.totais.wipFinalLo });
    }
    marca("+1 máquina (informativo) concluído");
  } catch (e) { marca(`+1 máquina falhou: ${(e as Error).message}`); }
}

// ------------------------------------------------------------------------------------------------ ESCOPO B (informativo): hoje (períodos ainda não iniciados) + dia alvo, tudo livre
let EB: Escopo | null = null; let candsB: Cand[] = []; let limB: ReturnType<typeof limiarEscopo> | null = null; let avVigB: ReturnType<Escopo["avaliar"]> | null = null; let escolhidaB: Cand | null = null;
if (idxB !== undefined && idxB < idxAlvo) {
  marca("escopo B (hoje restante + alvo): candidatos");
  EB = criarEscopo(idxB);
  const vigB = EB.fut(planoAtual);
  candsB = candidatos(EB, false);
  candsB.forEach((c) => { c.av = EB!.avaliar(c.futuras); c.val = EB!.validar(c.futuras); c.churn = churnDe(EB!, vigB, c.futuras); });
  avVigB = candsB[0].av!;
  limB = limiarEscopo(EB, avVigB, slots.filter((s) => s.indice >= idxB).length);
  const okB = (c: Cand) => c.val!.nucleo + c.val!.indep + c.val!.foraDaPrevisao === 0 && c.av!.lucro >= avVigB!.lucro - 1e-6 && c.av!.L.totais.excessoWip <= avVigB!.L.totais.excessoWip + 1 && c.av!.L.atingibilidade!.atingiveisPerdidas <= avVigB!.L.atingibilidade!.atingiveisPerdidas;
  escolhidaB = candsB.slice(1).filter(okB).sort((a, b) => b.av!.receita - a.av!.receita)[0] ?? null;
}


// ================================================================================================ ANTECIPAÇÃO ÚTIL (semana atual primeiro; capacidade que sobra → próxima semana, dentro do teto)
const comAntecipacao = !argv.includes("--sem-antecipacao");
const proxSemana = somaDias(semana, 7);
const proxRows = (bruto.q_prox ?? []) as any[];
const previsaoProxExiste = proxRows.some((r) => r.k === "existe");
const itensProx = proxRows.filter((r) => r.k === "item").map((r) => ({ produtoId: r.a as string, quantidade: Number(r.b) }));
const diasProxRows = proxRows.filter((r) => r.k === "dia");
const diasAtivos: string[] = diasProxRows.length ? diasProxRows.filter((r) => r.b === true || r.b === "true").map((r) => r.a as string) : [0, 1, 2, 3, 4].map((i) => somaDias(proxSemana, i));
const diasInativos: string[] = diasProxRows.filter((r) => !(r.b === true || r.b === "true")).map((r) => r.a as string).filter((x) => x < somaDias(proxSemana, 5));
const produtosAtuais = [...new Set(EA.estM.entrada.pools.map((p) => p.produtoId))];
const demFut = demandaFutura({
  produtos: produtosAtuais, proximaSemana: proxSemana, previsaoProxima: previsaoProxExiste ? itensProx : null,
  historico: ((bruto.q_hist ?? []) as any[]).map((h) => ({ semana: h.semana, produtoId: h.produto_id, quantidade: Number(h.quantidade) })),
  diasProdutivosProxima: diasAtivos.length, diasProdutivosTipicos: 5,
});
const demMap: Record<string, number> = Object.fromEntries(demFut.map((x) => [x.produtoId, x.quantidade]));
const slotsNext = slotsProximaSemana(slotsAlvo, diasAtivos);
function montarAntecipacao(E: Escopo, dem: Record<string, number>, cfg: { zerarWipNaoConfirmado?: boolean; rolagem?: boolean }) {
const entNext = montarEntradaProximaSemana(E.estM.entrada, slotsNext, dem);
const optPlan = E.ST(OPC_FIN).opcoes, optRec = E.ST(MEDIR_REC).opcoes, optLuc = E.ST(MEDIR).opcoes;
const openMs = slotsNext[0].inicioMs - 3600_000, agoraNext = slotsNext[0].inicioMs - 60_000;
const wipFim = (av: ReturnType<Escopo["avaliar"]>): Record<string, number> => Object.fromEntries(av.L.trajetoria.map((t) => [t.chave, t.porSlot[t.porSlot.length - 1]?.lo ?? 0]));
const nextCache = new Map<string, ResultadoSemanaSeguinte>();
let nextChamadas = 0, nextSeg = 0;
const parAlta = new Set(montarEstado(E.estM.ctx).pares.filter((q: any) => q.confianca === "alta").map((q: any) => `${q.produtoId}|${q.etapaOrigemId}`));
const filtraWip = (w: Record<string, number>) => (cfg.zerarWipNaoConfirmado ? Object.fromEntries(Object.entries(w).map(([k, v]) => [k, parAlta.has(k) ? v : 0])) : w);
let planoRefProx: AlocacaoEscala[] | undefined;
const refIds = new WeakMap<object, number>();
const refId = (a?: AlocacaoEscala[]) => { if (!a) return 0; if (!refIds.has(a)) refIds.set(a, refIds.size + 1); return refIds.get(a)!; };
const proxima = (wip0: Record<string, number>, rotulo: string, ref: AlocacaoEscala[] | undefined = planoRefProx): ResultadoSemanaSeguinte => {
  const wip = filtraWip(wip0);
  const k = JSON.stringify(Object.entries(wip).map(([a, b]) => [a, Math.round(b)]).sort()) + "#" + refId(ref);
  const c = nextCache.get(k); if (c) return c;
  const t0 = Date.now();
  const r = avaliarSemanaSeguinte(entNext, {}, optPlan, optRec, optLuc, contagensDeAbertura(E.estM.ctx, wip, openMs, rotulo), agoraNext, ref);
  nextCache.set(k, r); nextChamadas++; nextSeg += (Date.now() - t0) / 1000; return r;
};
// teto de antecipação por aresta (par origem→seguinte): min(demanda no par, capacidade do destino na próxima semana) − WIP base
const arestas = Object.values(E.estM.ctx.grafo.arestas);
const capPoolProx = (k: string) => { const pool = E.estM.ctx.poolsPorChave.get(k)!; return slotsNext.reduce((t, sl) => t + pool.maquinasIds.length * (pool.metas[sl.periodoId] ?? 0), 0); };
const capGargalo = (produtoId: string) => Math.min(...[...E.estM.ctx.poolsPorChave.entries()].filter(([, pl]) => pl.produtoId === produtoId).map(([k]) => capPoolProx(k)), Number.POSITIVE_INFINITY);
const capProxDestino = (destino: string) => { const pool = E.estM.ctx.poolsPorChave.get(E.estM.ctx.grafo.nos[destino].membros[0])!; return slotsNext.reduce((t, sl) => t + pool.maquinasIds.length * (pool.metas[sl.periodoId] ?? 0), 0); };

interface OpcaoAvaliada { slot: number; pool: string; produto: string; etapa: string; maquina: string; noKey: string; dAtual: number; dLucro: number; dWipFinal: number; dWipSaida: number; fv: number; fvBruto: number; acimaDoTeto: boolean; hardOk: boolean; temMaterial: boolean; dAbertura: number; decisao?: string; alivio?: number; baixaConf?: boolean; demandaPar?: number; dDownstream?: number; tetoPar?: number }
interface Atribuicao { slot: number; linhaIdx: number; escolha?: OpcaoAvaliada; decisao: string; opcoes: OpcaoAvaliada[]; semOpcao?: string }
const nomeSaidaEdge = (noKey: string) => { const ar = arestas.find((x) => x.origem === noKey); return ar ? ar.chavePar : null; };

function antecipar(plano0: AlocacaoEscala[], livres: AlocacaoEscala[], wipBaseTeto: Record<string, number>) {
  let plano = plano0.map((a) => ({ ...a }));
  const atribs: Atribuicao[] = [];
  const todas: OpcaoAvaliada[] = [];
  const teto: Record<string, number> = {}; const limTeto: Record<string, string> = {};
  arestas.forEach((ar) => { const t = tetoAntecipacao({ demandaFuturaNoPar: dem[ar.produtoId] ?? 0, wipDisponivel: wipBaseTeto[ar.chavePar] ?? 0, capacidadeDownstreamProx: capProxDestino(ar.destino), capacidadeGargaloProx: capGargalo(ar.produtoId), maxPeriodosAntecipados: 6, periodosAntecipados: 0, pecasPorPeriodoOrigem: 1e9 }); teto[ar.chavePar] = t.teto; limTeto[ar.chavePar] = t.limitadoPor; });
  for (const lv of [...livres].sort((x, y) => slotDe(x) - slotDe(y))) {
    const t = slotDe(lv);
    const iLinha = plano.findIndex((x) => x.funcionarioId === lv.funcionarioId && slotDe(x) === t);
    if (iLinha < 0 || plano[iLinha].maquinaId) continue;
    const avCur = E.avaliar(plano); const wipCur = wipFim(avCur); const nxCur = proxima(wipCur, "plano corrente");
    const prod0 = prodSim(E, plano);
    const slot = E.estM.entrada.slots[t];
    const usadas = new Set(plano.filter((a) => slotDe(a) === t && a.maquinaId).map((a) => a.maquinaId));
    const opcoes: OpcaoAvaliada[] = [];
    for (const no of Object.values(E.estM.ctx.grafo.nos)) for (const mk of no.membros) {
      const pool = E.estM.ctx.poolsPorChave.get(mk)!;
      const maq = pool.maquinasIds.find((m) => !usadas.has(m) && maquinaDisponivelNoSlot(E.estM.entrada, m, slot));
      if (!maq) continue;
      const nova: AlocacaoEscala = { ...plano[iLinha], maquinaId: maq, produtoId: pool.produtoId, etapaId: pool.etapaId, operacaoId: pool.operacaoId, pecas: pool.metas[slot.periodoId] ?? 0, motivoSemPosto: null };
      const novo = plano.map((x, i) => (i === iLinha ? nova : x));
      const hardOk = verificarRestricoesDuras(E.estM.entrada, novo).length === 0;
      const av = hardOk ? E.avaliar(novo) : avCur;
      const w = wipFim(av); const sai = nomeSaidaEdge(no.id);
      const dSaida = sai ? (w[sai] ?? 0) - (wipCur[sai] ?? 0) : 0;
      const ps = hardOk ? prodSim(E, novo) : prod0;
      const temMaterial = (ps.x[no.id]?.[t - E.idxIni] ?? 0) > 0.5;
      const acima = sai ? (w[sai] ?? 0) > (wipBaseTeto[sai] ?? 0) + (teto[sai] ?? 0) + 0.5 : false;
      let fvBruto = 0;
      if (hardOk && temMaterial && av.receita >= avCur.receita - 0.5 && Object.keys(w).some((k) => Math.abs((w[k] ?? 0) - (wipCur[k] ?? 0)) > 0.5)) fvBruto = proxima(w, "candidato", nxCur.plano).receita - nxCur.receita;
      const o: OpcaoAvaliada = {
        slot: t, pool: mk, produto: nome(pool.produtoId), etapa: nome(pool.operacaoId), maquina: nome(maq), noKey: no.id, dAtual: av.receita - avCur.receita, dLucro: av.lucro - avCur.lucro, dWipFinal: av.L.totais.wipFinalLo - avCur.L.totais.wipFinalLo, dWipSaida: dSaida,
        fv: acima ? 0 : fvBruto, fvBruto, acimaDoTeto: acima, hardOk, temMaterial, dAbertura: av.L.totais.wipFinalLo - avCur.L.totais.wipFinalLo, baixaConf: maq === m8Maq || pool.maquinasIds.includes(m8Maq) && maq === m8Maq, demandaPar: dem[pool.produtoId] ?? 0, tetoPar: sai ? teto[sai] ?? 0 : 0,
        dDownstream: (() => { const arS = arestas.find((x) => x.origem === no.id); return arS ? (ps.x[arS.destino] ?? []).reduce((q, v) => q + v, 0) - (prod0.x[arS.destino] ?? []).reduce((q, v) => q + v, 0) : 0; })(),
      };
      opcoes.push(o); todas.push(o);
    }
    opcoes.forEach((o) => {
      const sai = nomeSaidaEdge(o.noKey);
      const pool = E.estM.ctx.poolsPorChave.get(o.pool)!;
      const muProx = Math.max(1, pool.metas[slotsNext[0].periodoId] ?? 1);
      const folga = sai ? Math.max(0, (wipBaseTeto[sai] ?? 0) + (teto[sai] ?? 0) - (wipCur[sai] ?? 0)) : 0;
      o.alivio = o.temMaterial && o.hardOk && !o.acimaDoTeto && sai ? Math.min(Math.max(0, o.dWipSaida), folga) / muProx : 0;
    });
    const entrada: OpcaoDePosto[] = opcoes.map((o) => ({ alivioPostoPeriodos: o.alivio ?? 0, posto: `${o.maquina}|${o.pool}`, produtoId: o.pool.split("|")[0], etapaId: o.pool.split("|")[1], maquinaId: o.maquina, maquinaPermitida: true, temMaterial: o.temMaterial, valorAtual: o.dAtual, valorFuturo: o.fv, hardOk: o.hardOk }));
    const dec = decidirPessoaParada(entrada, 0.5, 0.5);
    const escolha = dec.posto ? opcoes.find((o) => `${o.maquina}|${o.pool}` === dec.posto) : undefined;
    if (escolha) {
      const pool = E.estM.ctx.poolsPorChave.get(escolha.pool)!;
      const maqId = pool.maquinasIds.find((m) => nome(m) === escolha.maquina && !usadas.has(m)) ?? pool.maquinasIds.find((m) => !usadas.has(m) && maquinaDisponivelNoSlot(E.estM.entrada, m, slot))!;
      plano[iLinha] = { ...plano[iLinha], maquinaId: maqId, produtoId: pool.produtoId, etapaId: pool.etapaId, operacaoId: pool.operacaoId, pecas: pool.metas[slot.periodoId] ?? 0, motivoSemPosto: null };
      escolha.decisao = dec.decisao;
    }
    atribs.push({ slot: t, linhaIdx: iLinha, escolha, decisao: dec.descricao, opcoes, semOpcao: dec.decisao === "sem_posto_auditavel" ? dec.motivo : undefined });
  }
  return { plano, atribs, todas, teto, limTeto };
}


  // ---- bases do cenário
  const vig = E.fut(planoAtual);
  const runF = (extra: Partial<OpcoesFluxo>) => { const e = E.ST(extra); return E.fut(planejarComFluxo(e.entrada, e.dados, e.opcoes).resultado.alocacoes); };
  const mkC = (rot: string, gerador: string, fut: AlocacaoEscala[]): Cand => { const c: Cand = { rot, gerador, futuras: fut }; c.av = E.avaliar(fut); c.val = E.validar(fut); c.churn = churnDe(E, vig, fut); return c; };
  const cVig = mkC("Vigente (gravado em PROD)", "plano ativo", vig);
  const cMotor = mkC("Motor ativo replanejado", "motor ativo", runF({}));
  const cFlux = mkC("Núcleo fluxo (receita)", "fluxo", runF(OPC_FIN));
  const okC = (c: Cand) => c.val!.nucleo + c.val!.indep + c.val!.foraDaPrevisao === 0 && c.av!.L.atingibilidade!.atingiveisPerdidas <= cVig.av!.L.atingibilidade!.atingiveisPerdidas && c.av!.lucro >= cVig.av!.lucro - 1e-6;
  const base = [cMotor, cFlux].filter(okC).sort((x, y) => y.av!.receita - x.av!.receita || x.churn!.linhas - y.churn!.linhas)[0] ?? cMotor;
  const e1 = enxugar(E, base.futuras);
  const enx = mkC("ENXUTO (só para localizar pessoa-períodos livres)", "enxuto", e1.plano);
  const wipB = wipFim(base.av!), wipE = wipFim(enx.av!);
  const nextProp = proxima(wipB, "base");
  planoRefProx = nextProp.plano;
  const nextVig = proxima(wipFim(cVig.av!), "vigente");
  const nextEnx = proxima(wipE, "enxuto"), nextZero = proxima({}, "abertura zero");
  const livres = enx.futuras.filter((a) => !a.maquinaId && !/aus/i.test(String(a.motivoSemPosto ?? ""))).map((a) => ({ ...a, motivoSemPosto: "livre" } as AlocacaoEscala));
  const r = antecipar(enx.futuras, livres, wipB);
  const final = mkC("ANTECIPAÇÃO ÚTIL (sombra)", "base+enxuto+antecipação", r.plano);
  const nextFinal = proxima(wipFim(final.av!), "final");
  let rolagem: null | { rm: Cand; ra: Cand; livres: number } = null;
  if (cfg.rolagem) {
    const desde = idxAlvo + 3;
    const replanLinhas = (prefix: AlocacaoEscala[], d0: number, extra: Partial<OpcoesFluxo>) => {
      const e = montarEstadoAting(d, agoraMs, E.planoCompleto(prefix), 100 + d0, extra, true);
      const rr = planejarComFluxo(e.entrada, e.dados, e.opcoes);
      return prefix.filter((a) => slotDe(a) < d0).concat(E.fut(rr.resultado.alocacoes).filter((a) => slotDe(a) >= d0));
    };
    const rolMotor = replanLinhas(final.futuras.filter((a) => slotDe(a) < desde), desde, {});
    const enxR = enxugar(E, rolMotor, desde);
    const livresR = enxR.plano.filter((a) => slotDe(a) >= desde && !a.maquinaId && !/aus/i.test(String(a.motivoSemPosto ?? "")));
    const rr2 = antecipar(enxR.plano, livresR, wipFim(E.avaliar(rolMotor)));
    rolagem = { rm: mkC("ROLAGEM sem antecipação na tarde", "rolagem", rolMotor), ra: mkC("ROLAGEM com antecipação na tarde", "rolagem+ant", rr2.plano), livres: livresR.length };
  }
  return { E, dem, slotsNext, entNext, optPlan, openMs, agoraNext, proxima, arestas, capProxDestino, capPoolProx, capGargalo, wipFim, antecipar, vig, cVig, cMotor, cFlux, base, enx, parados: e1.parados, wipB, wipE, nextProp, nextVig, nextEnx, nextZero, livres, r, final, nextFinal, rolagem, mkC, filtraWip, parAlta };
}
type ResAnt = ReturnType<typeof montarAntecipacao>;

const m8Maq = EA.estM.entrada.pools.find((p) => /Rosquear \+ Parafusar/.test(nome(p.operacaoId)))?.maquinasIds[0] ?? "";


const m8Razoes = d.apontamentos.filter((a) => a.maquinaId === m8Maq && a.status === "produzindo" && a.meta > 0 && a.lancadoEmMs <= agoraMs).map((a) => a.boas / a.meta);
const m8Stat = estatisticaPosto(m8Razoes);
const fEmbA = EA.estM.opcoes.fatoresEmbutidos ?? {};
const ajusteM8Pess = (pools: any[]) => pools.map((p) => (p.maquinasIds.includes(m8Maq) ? { ...p, metas: Object.fromEntries(Object.entries(p.metas as Record<string, number>).map(([per, v]) => [per, Math.min(v, (v / (fEmbA[`${p.produtoId}|${p.etapaId}`] ?? 1)) * m8Stat.ic95[0])])) } : p));
const ajusteSemM8 = (pools: any[]) => pools.map((p) => (p.maquinasIds.includes(m8Maq) ? { ...p, maquinasIds: p.maquinasIds.filter((m: string) => m !== m8Maq) } : p));
const demRobusta: Record<string, number> = Object.fromEntries(demFut.map((x) => [x.produtoId, x.confianca === "baixa" ? 0 : x.quantidade]));
const ANT = comAntecipacao ? montarAntecipacao(EA, demMap, { rolagem: true }) : null;
let ER: Escopo | null = null, EC: Escopo | null = null, ANT_ROB: ResAnt | null = null, ANT_SEM8: ResAnt | null = null;
if (ANT) {
  marca("antecipação (completo) pronta; cenários robusto e sem Máquina 8");
  ER = criarEscopo(idxAlvo, ajusteM8Pess); EC = criarEscopo(idxAlvo, ajusteSemM8);
  ANT_ROB = montarAntecipacao(ER, demRobusta, { zerarWipNaoConfirmado: true });
  ANT_SEM8 = montarAntecipacao(EC, demMap, {});
  marca("cenários robusto e sem Máquina 8 prontos");
}
const proxima = ANT?.proxima as ResAnt["proxima"], arestas = (ANT?.arestas ?? []) as ResAnt["arestas"], capProxDestino = ANT?.capProxDestino as ResAnt["capProxDestino"], wipFim = ANT?.wipFim as ResAnt["wipFim"];
const entNext = ANT?.entNext as ResAnt["entNext"], optPlan = ANT?.optPlan as ResAnt["optPlan"], openMs = ANT?.openMs as number, agoraNext = ANT?.agoraNext as number;

// ------------------------------------------------------------------------------------------------ (g) validações, (h) confiança
const naoConf = estado.celulas.filter((c: any) => c.estado === "nao_confirmado");
const confianca = (produtoId: string | null | undefined, etapaId: string | null | undefined): string[] => {
  if (!produtoId) return [];
  const r: string[] = [];
  const baixa = estado.pares.filter((q: any) => q.produtoId === produtoId && q.confianca === "baixa");
  if (baixa.length) r.push(`WIP estimado sem contagem (${baixa.length} par(es))`);
  const op = EA.estM.entrada.pools.find((q) => q.produtoId === produtoId && q.etapaId === etapaId)?.operacaoId;
  const n = d.apontamentos.filter((a) => a.produtoId === produtoId && a.operacaoId === op && a.status === "produzindo").length;
  if (n < 20) r.push(`produtividade com amostra pequena (n=${n} apontamentos na semana)`);
  if (/autom/i.test(nome(produtoId))) r.push("Automática com produtividade substituta do convencional");
  if (/1\.1\/4/.test(nome(produtoId))) r.push("1.1/4\" com apenas 1 semana de dados");
  const nc = naoConf.filter((c: any) => (EA.estM.entrada.pools.find((q) => q.produtoId === produtoId)?.maquinasIds ?? []).includes(c.maquinaId)).length;
  if (nc) r.push(`${nc} período(s)/máquina(s) fechados sem apontamento (produção em [0, planejado])`);
  return r;
};
const apM8 = d.apontamentos.filter((a) => a.maquinaId === m8Maq && a.status === "produzindo" && a.lancadoEmMs <= agoraMs);
const m8B = apM8.reduce((s, a) => s + a.boas, 0), m8M = apM8.reduce((s, a) => s + a.meta, 0);

// ------------------------------------------------------------------------------------------------ relatório
const L: string[] = [];
const P = (s = "") => L.push(s);
const finV = avVig.L.financeiro!.produtos, finVR = avVig.R.financeiro!.produtos, finP = avP.L.financeiro!.produtos, finPR = avP.R.financeiro!.produtos;
const totV = avVig.L.totais, totP = avP.L.totais;
P(`# Análise econômica 30/10 — foto ${rotFoto}`);
P(`Gerado ${new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ")} SP; instante do estado ${hhmm(agoraMs)} de ${hoje}. **PROPOSTA/ANÁLISE OFFLINE — nada foi gravado, aplicado ou publicado.** Revezamento por bloco: HARD (ativo). Equivalências: desligadas. Rotas: não publicadas. Estimador: só como gerador de candidato. Produtividade só por POSTO (produto×operação×máquina); pessoa só como ocupante escolhido depois. Máquinas: só as selecionadas na Previsão.`);
P();
P(`> **Calendário:** ${alvo} é **${diaSemana(alvo)}** (${slotsAlvo.length} períodos: ${slotsAlvo.map((s) => s.periodoId.toUpperCase()).join(", ")}). ${existe31 ? `${dia31} tem períodos na semana.` : `**${dia31} (${diaSemana(dia31)}) NÃO tem períodos na semana ${semana}:** ${alvo} é o ÚLTIMO dia — todo WIP que sobrar no fim de ${alvo} T3 não vira peça final nesta semana. O escopo "${alvo}+${dia31}" é, portanto, idêntico ao escopo ${alvo}; como segundo escopo informativo uso "restante de hoje (períodos ainda não iniciados) + ${alvo}".`}`);
P();
P(`## Estado usado (foto ${modo})`);
P(`- Plano ativo (PROD, \`escala_producao_alocacoes\` lido agora): ${planoAtual.length} linhas na semana; ${vigA.length} em ${alvo}. Último fluxo ativo: ${bruto.q_fluxo[0] ? `${bruto.q_fluxo[0].criado} (${bruto.q_fluxo[0].gatilho}, corte ${bruto.q_fluxo[0].corte_data} ${String(bruto.q_fluxo[0].corte_periodo_id).toUpperCase()}, aplicado=${bruto.q_fluxo[0].aplicado})` : "nenhum"}.`);
P(`- Congelado: tudo até o fim de ${hoje} T3 (${modo === "projetada" ? "T1–T3 de hoje seguem o plano ativo como planejado; apontamentos de T1+ de hoje não entram" : "T1–T3 conforme apontamentos reais até o instante; fechados sem apontamento = [0, planejado]; abertos/futuros seguem o plano"}). Candidatos mudam só ${alvo}.`);
P(`- Apontamentos usados: ${d.apontamentos.length} (último lançado ${d.apontamentos.length ? hhmm(Math.max(...d.apontamentos.map((a) => a.lancadoEmMs))) : "—"}). Contagens físicas: ${d.cfg.contagensFisicas.length} (${d0.cfg.contagensFisicas.length} em PROD + ${novas.length} via --contagem: ${novas.map((c) => `${nomeNo(`${c.produtoId}|${c.etapaOrigemId}`)}=${c.saldo}@${hhmm(c.contadoEmMs)}`).join("; ") || "nenhuma"}; vale a mais recente por par).`);
P(`- Equipe/ausências/paradas/máquinas relidas AO VIVO: ${equipeAtiva.length} pessoas, ${ausencias.length} ausências, ${indisponibilidades.length} paradas (${indisponibilidades.filter((p: any) => p.liberadaEmMs === null).length} abertas), ${maquinasIndispPrev.length} indisponíveis na Previsão.`);
P(`- Células fechadas sem apontamento ([0, planejado], nunca assumidas): ${naoConf.length}${naoConf.length ? " — " + [...new Set(naoConf.map((c: any) => slotRot(c.slot)))].slice(0, 14).join(", ") : ""}.`);
P(`- Limiar de materialidade (1 erro-padrão do modelo): σ robusto da razão boas÷meta = ${(sigma * 100).toFixed(1)}% (${razoes.length} períodos fechados, mediana ${Number.isFinite(medR) ? (medR * 100).toFixed(0) + "%" : "n/d"}); escopo ${alvo} (n=${slotsAlvo.length}): **R$ ${brl(limA.receita)} de receita / R$ ${brl(limA.lucro)} de lucro-tela** = σ × √n × R$ por período (restante projetado ${brl(limA.restR)} receita / ${brl(limA.restL)} lucro).`);
P();

// ---- RESPOSTAS DIRETAS
const fimV = wipRows.reduce((s, r) => s + r.fim.vigente[0], 0), fimVhi = wipRows.reduce((s, r) => s + r.fim.vigente[1], 0), fimP = wipRows.reduce((s, r) => s + r.fim.proposto[0], 0), fimPhi = wipRows.reduce((s, r) => s + r.fim.proposto[1], 0);
const capitalV = wipRows.reduce((s, r) => s + r.fim.vigente[0] * r.custoPeca, 0), capitalP = wipRows.reduce((s, r) => s + r.fim.proposto[0] * r.custoPeca, 0);
const receitaV = wipRows.reduce((s, r) => s + r.fim.vigente[0] * r.valorFinalPeca, 0), receitaP = wipRows.reduce((s, r) => s + r.fim.proposto[0] * r.valorFinalPeca, 0);
const excV = totV.excessoWip, excP = totP.excessoWip;
P(`# >>> RESPOSTAS DIRETAS <<<`);
P(`**Recomendação (PROPOSTA, nada aplicado): ${trocarA ? `TROCAR o plano de ${alvo} pelo candidato "${PROP.rot}"` : `MANTER o plano vigente de ${alvo} (nenhum candidato supera o limiar de materialidade com todos os critérios)`}.** Δ receita final ${sg(avP.receita - avVig.receita)} (limiar R$ ${brl(limA.receita)}), Δ lucro-tela ${sg(avP.lucro - avVig.lucro)} (limiar R$ ${brl(limA.lucro)}), Δ peças finais ${sn0(totP.finalEntregueLo - totV.finalEntregueLo)}, Δ WIP final ${sn0(totP.wipFinalLo - totV.wipFinalLo)} pç, churn ${PROP.churn!.linhas} linhas / ${PROP.churn!.pessoas} pessoas / ${PROP.churn!.postos} postos.`);
P();
{
  const eP = enxutos.find((e) => e.base === melhorBruto.rot);
  P(`**Leitura honesta do ganho.** (1) O plano de ${alvo} gravado em PROD NÃO é o que vai rodar: o motor ativo o recalcula a cada fechamento; o baseline realista é o "motor ativo replanejado" no estado ${modo === "projetada" ? "pós-T3 projetado" : "atual"}. Contra o gravado ele rende ${sg((motorC?.av!.receita ?? 0) - avVig.receita)} de receita e ${sn0((motorC?.av!.L.totais.wipFinalLo ?? 0) - totV.wipFinalLo)} pç de WIP final — ganho que o próprio PROD tende a capturar sem intervenção. (2) Núcleo fluxo / núcleo econômico: ${sg((candsA.find((c) => c.gerador === "econômico/lucro_hora")?.av!.receita ?? 0) - (motorC?.av!.receita ?? 0))} de receita sobre o motor e WIP final maior (${n0(candsA.find((c) => c.gerador === "econômico/lucro_hora")?.av!.L.totais.wipFinalLo ?? 0)} × ${n0(motorC?.av!.L.totais.wipFinalLo ?? 0)} pç); estimador (só gerador): ${sg((candsA.find((c) => c.gerador === "estimador/financeiro")?.av!.receita ?? 0) - (motorC?.av!.receita ?? 0))} sobre o motor — reprovado. (3) O ganho adicional existente é o de WIP, não de receita: parar os postos upstream sem valor final (variante ENXUTA) mantém a receita e leva o WIP final de ${n0(motorC?.av!.L.totais.wipFinalLo ?? 0)} para ${n0(eP?.cand.av!.L.totais.wipFinalLo ?? 0)} pç liberando ${eP?.parados.length ?? 0} pessoa-período(s) (uso alternativo medido = R$ 0).`);
  P();
}
P(`**(a) WIP excessivo.** No plano vigente de ${alvo}, o WIP que sobra no fim da semana (T3 de ${alvo}) é **${n0(fimV)}–${n0(fimVhi)} pç** (excesso segundo o motor, acima de 1 período de consumo downstream: **${n0(excV)} pç**); como ${alvo} é o último dia, **tudo isso é inútil** (não vira peça final até sexta): capital parado ≈ **R$ ${brl(capitalV)}** a custo da tela acumulado (R$ ${brl(receitaV)} se valorado ao preço final, teto). No plano proposto: ${n0(fimP)}–${n0(fimPhi)} pç (excesso ${n0(excP)}), capital ≈ R$ ${brl(capitalP)}. Por par: tabela (a).`);
const decrescente = [...wipRows].sort((x, y) => y.fim.vigente[0] * y.custoPeca - x.fim.vigente[0] * x.custoPeca).slice(0, 3);
P(`  Maiores pares (vigente, fim da semana): ${decrescente.map((r) => `${r.par} ${n0(r.fim.vigente[0])} pç (R$ ${brl(r.fim.vigente[0] * r.custoPeca)})`).join("; ")}.`);
P();
const remP = remocoes.proposto, remV = remocoes.vigente;
const semValor = remV.filter((r) => r.dReceitaFixo > -0.005 && r.dWipFixo < -0.5);
const agrupa = (rs: Remocao[], f: (r: Remocao) => number | null) => { const m = new Map<string, { n: number; v: number; slots: number[] }>(); rs.forEach((r) => { const k = `${r.maquina} · ${r.posto}`; const x = m.get(k) ?? { n: 0, v: 0, slots: [] }; x.n++; x.v += f(r) ?? 0; x.slots.push(r.slot); m.set(k, x); }); return m; };
P(`**(b) Desacelerar/parar (vigente → proposto) e proteger.** Postos do plano vigente sem valor final (remover = Δ receita 0 e reduz WIP): ${semValor.length ? [...agrupa(semValor, (r) => r.dWipFixo)].map(([k, x]) => `${k} em ${[...new Set(x.slots)].map(slotRot).join("/")} (−${n0(-x.v)} pç de WIP)`).join("; ") : "nenhum"}. Mudanças de postos do vigente para o proposto: ver tabela (b). Downstream a proteger = postos cujo valor de remoção é alto e que estão a 100% com fila a montante (E17, Etiquetadora 15, E16, Montagem da Caixa quando aplicável): tabela (e).`);
P();
const satRows = cap0.capacidade.filter((c) => c.slot === idxAlvo);
P(`**(c) Saturação (${slotRot(idxAlvo)}, plano proposto):** ${satRows.map((c) => `${nomeNo(c.no)}: ${motivoRico(c, cap0)}`).join("; ")}. Demais períodos e plano vigente: tabela (c).`);
P();
P(`**(d) Receita final ainda capturável até sexta:** ver tabela (d). Total capturável (máximo físico com as máquinas da Previsão) vs. plano vigente vs. proposto: R$ ${brl(finVR.reduce((s, p) => s + Math.max(0, Math.min(p.meta, p.maximoProduzivel) - p.realizadoFinal) * p.valorEconomicoUnitario, 0))} / R$ ${brl(avVig.receita - avVig.R.financeiro!.total.rsRealizado)} / R$ ${brl(avP.receita - avP.R.financeiro!.total.rsRealizado)}.`);
P();
const top = [...remP].sort((x, y) => (y.dReceitaRep ?? y.dReceitaFixo) * -1 - (x.dReceitaRep ?? x.dReceitaFixo) * -1).slice(0, 5);
P(`**(e) Onde um período-pessoa adicional gera mais valor FINAL em ${alvo}:** o ranking do VALOR DO POSTO OCUPADO (remover o posto no plano proposto, resto replanejado) é encabeçado por ${top.map((r) => `${r.maquina}/${slotRot(r.slot)} (R$ ${brl(-(r.dReceitaRep ?? r.dReceitaFixo))})`).join(", ") || "n/d"}. **+1 pessoa sem outra máquina = R$ 0** (SATURADO_POR_MAQUINA); o valor marginal de +1 pessoa só é > 0 em postos com máquina livre: ${cap0.capacidade.filter((c) => c.valorMarginalAdicionar > 0.005 && c.postosDisponiveis > 0).map((c) => `${slotRot(c.slot)} ${nomeNo(c.no)} (R$ ${brl(c.valorMarginalAdicionar)})`).slice(0, 6).join("; ") || "nenhum (todas as máquinas disponíveis com valor já estão ocupadas)"}. Tabela (e) completa; +1 máquina é só informativo (seleção da Previsão é absoluta).`);
P();

// ---- Estados
P(`## Estados comparados (avaliador OFICIAL, capacidade oficial; ${alvo} inteiro, T1–T3 de hoje congelados)`);
P(`| | Vigente (PROD) | Proposto: ${PROP.rot} |`);
P(`|---|---|---|`);
P(`| Receita final projetada da semana (R$) | ${brl(avVig.receita)} | ${brl(avP.receita)} (${sg(avP.receita - avVig.receita)}) |`);
P(`| Lucro-tela projetado da semana (R$) | ${brl(avVig.lucro)} | ${brl(avP.lucro)} (${sg(avP.lucro - avVig.lucro)}) |`);
P(`| Peças finais (Σ produtos) | ${n0(totV.finalEntregueLo)} | ${n0(totP.finalEntregueLo)} (${sn0(totP.finalEntregueLo - totV.finalEntregueLo)}) |`);
P(`| WIP final da semana (pç, lo) / excesso | ${n0(totV.wipFinalLo)} / ${n0(totV.excessoWip)} | ${n0(totP.wipFinalLo)} / ${n0(totP.excessoWip)} |`);
P(`| Metas atingíveis NÃO entregues | ${avVig.L.atingibilidade!.atingiveisPerdidas} | ${avP.L.atingibilidade!.atingiveisPerdidas} |`);
P(`| Churn vs vigente (linhas / pessoas / postos) | — | ${PROP.churn!.linhas} / ${PROP.churn!.pessoas} / ${PROP.churn!.postos} |`);
P(`| R$ receita por pessoa alterada / por posto alterado | — | ${PROP.churn!.pessoas ? brl((avP.receita - avVig.receita) / PROP.churn!.pessoas) : "—"} / ${PROP.churn!.postos ? brl((avP.receita - avVig.receita) / PROP.churn!.postos) : "—"} |`);
P(`| Violações núcleo / independente / bloco / fora da Previsão | ${candsA[0].val!.nucleo} / ${candsA[0].val!.indep} / ${candsA[0].val!.bloco} / ${candsA[0].val!.foraDaPrevisao} | ${PROP.val!.nucleo} / ${PROP.val!.indep} / ${PROP.val!.bloco} / ${PROP.val!.foraDaPrevisao} |`);
P();

// ---- (f) candidatos
P(`## (f) Candidatos reavaliados na capacidade OFICIAL (${alvo}; limiar receita R$ ${brl(limA.receita)} / lucro R$ ${brl(limA.lucro)})`);
P(`| Candidato | Gerador | Receita R$ (Δ vs vigente / Δ vs motor replanejado) | Lucro-tela R$ (Δ) | Peças finais (Δ) | WIP final / excesso | Metas perdidas | Churn lin/pes/postos | Viol. núcleo/indep/bloco/Prev. | ≥ limiar? |`);
P(`|---|---|---|---|---|---|---|---|---|---|`);
candsA.forEach((c) => P(`| ${c.rot} | ${c.gerador} | ${brl(c.av!.receita)} (${sg(c.av!.receita - avVig.receita)} / ${motorC ? sg(c.av!.receita - motorC.av!.receita) : "—"}) | ${brl(c.av!.lucro)} (${sg(c.av!.lucro - avVig.lucro)}) | ${n0(c.av!.L.totais.finalEntregueLo)} (${sn0(c.av!.L.totais.finalEntregueLo - totV.finalEntregueLo)}) | ${n0(c.av!.L.totais.wipFinalLo)} / ${n0(c.av!.L.totais.excessoWip)} | ${c.av!.L.atingibilidade!.atingiveisPerdidas} | ${c.churn!.linhas}/${c.churn!.pessoas}/${c.churn!.postos} | ${c.val!.nucleo}/${c.val!.indep}/${c.val!.bloco}/${c.val!.foraDaPrevisao} | ${c === candsA[0] ? "—" : c.av!.receita - avVig.receita >= limA.receita ? "SIM" : "não"}${ok(c) ? "" : " (reprovado nos critérios)"} |`));
P();
P(`Regra de escolha: maior receita final entre candidatos válidos (0 violações) que não piorem lucro-tela, WIP excessivo nem atingibilidade; entre candidatos a menos de meio limiar do melhor, o de menor churn. Trocar só se Δ receita ≥ limiar. Resto de ${alvo} fixo = candidato inteiro (rolagem do motor nas medidas de remoção em (e)).`);
if (pol.movs.length) { P(); P(`Ajuste fino (receita): ${pol.movs.map((m) => `${slotRot(m.slot)}: ${m.para} ocupa posto livre no lugar de ${m.de} (+R$ ${brl(m.ganho)})`).join("; ")}; ${pol.rejeitadas} tentativa(s) rejeitada(s) por restrição dura.`); }
if (EB && limB) {
  P();
  P(`### Escopo B (informativo): reabrindo também os períodos de ${hoje} ainda não iniciados (a partir de ${slotRot(idxB!)}) — NÃO é a decisão atual (T1–T3 mantidos)`);
  P(`Limiar B (n=${slots.filter((s) => s.indice >= idxB!).length}): receita R$ ${brl(limB.receita)} / lucro R$ ${brl(limB.lucro)}.`);
  P(`| Candidato | Receita R$ (Δ) | Lucro-tela R$ (Δ) | Peças finais (Δ) | WIP final / excesso | Churn lin/pes/postos | Viol. | ≥ limiar? |`);
  P(`|---|---|---|---|---|---|---|---|`);
  candsB.forEach((c) => P(`| ${c.rot} | ${brl(c.av!.receita)} (${sg(c.av!.receita - avVigB!.receita)}) | ${brl(c.av!.lucro)} (${sg(c.av!.lucro - avVigB!.lucro)}) | ${n0(c.av!.L.totais.finalEntregueLo)} (${sn0(c.av!.L.totais.finalEntregueLo - avVigB!.L.totais.finalEntregueLo)}) | ${n0(c.av!.L.totais.wipFinalLo)} / ${n0(c.av!.L.totais.excessoWip)} | ${c.churn!.linhas}/${c.churn!.pessoas}/${c.churn!.postos} | ${c.val!.nucleo}/${c.val!.indep}/${c.val!.bloco}/${c.val!.foraDaPrevisao} | ${c === candsB[0] ? "—" : c.av!.receita - avVigB!.receita >= limB!.receita ? "SIM" : "não"} |`));
  P(`Melhor válido do escopo B: ${escolhidaB ? `${escolhidaB.rot} (Δ receita ${sg(escolhidaB.av!.receita - avVigB!.receita)})` : "nenhum"}. Obs.: com T1–T3 de hoje reabertos o ganho inclui desfazer o acúmulo de WIP de hoje; a decisão do usuário (manter T1–T3) o exclui.`);
}
P();

// ---- enxuto
P(`## Variante ENXUTA (menor WIP inútil) — pára postos sem valor final; as pessoas ficam sem posto (NÃO entra na escolha automática)`);
if (!enxutos.length) P(`Nenhum posto-período do plano pode ser parado sem perder receita/lucro.`);
enxutos.forEach((e) => {
  const c = e.cand;
  P(`- Base: ${e.base}. Para ${e.parados.length} posto-período(s) (${new Set(e.parados.map((a) => a.funcionarioId)).size} pessoas-posição, sem usar identidade): ${e.parados.sort((x, y) => slotDe(x) - slotDe(y)).map((a) => `${slotRot(slotDe(a))} ${nome(a.maquinaId)} (${nome(a.operacaoId)} · ${nome(a.produtoId)})`).join("; ")}.`);
  P(`  Resultado: receita ${brl(c.av!.receita)} (${sg(c.av!.receita - avVig.receita)} vs vigente), lucro ${brl(c.av!.lucro)}, WIP final ${n0(c.av!.L.totais.wipFinalLo)} pç (${sn0(c.av!.L.totais.wipFinalLo - totV.wipFinalLo)} vs vigente), excesso ${n0(c.av!.L.totais.excessoWip)}; violações núcleo/indep/bloco/Prev. ${c.val!.nucleo}/${c.val!.indep}/${c.val!.bloco}/${c.val!.foraDaPrevisao}. **Pessoa-períodos ociosos: ${e.parados.length}** (valor de uso alternativo medido = R$ 0: não há máquina livre com valor final). Churn ${c.churn!.linhas} linhas.`);
});
P();

// ---- (a) tabela WIP
P(`## (a) WIP por par origem → seguinte (início de ${alvo} = projetado após T3 de hoje; "fim" = fim de ${alvo} T3 = fim da semana)`);
P(`| Par | Origem do saldo (confiança) | Início ${alvo} [lo–hi] | Fim M3 vigente | Fim semana vigente [lo–hi] | Fim semana proposto [lo–hi] | Fim semana ENXUTO (lo) | Excesso vigente / proposto (acima de 1 período de consumo) | Custo acum./pç (R$) | Capital parado vigente (R$) | proposto (R$) | INÚTIL vigente → proposto (pç, lo) |`);
P(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
wipRows.forEach((r) => P(`| ${r.par} | ${r.origem} (${r.conf}) | ${n0(r.inicio[0])}–${n0(r.inicio[1])} | ${n0(r.fimM3.vigente[0])}–${n0(r.fimM3.vigente[1])} | ${n0(r.fim.vigente[0])}–${n0(r.fim.vigente[1])} | ${n0(r.fim.proposto[0])}–${n0(r.fim.proposto[1])} | ${r.fim.enxuto ? n0(r.fim.enxuto[0]) : "—"} | ${n0(r.excesso.vigente)} / ${n0(r.excesso.proposto)} | ${r.custoPeca.toFixed(4)} | ${brl(r.fim.vigente[0] * r.custoPeca)} | ${brl(r.fim.proposto[0] * r.custoPeca)} | ${n0(r.fim.vigente[0])} → ${n0(r.fim.proposto[0])} |`));
P(`_Capital = peças × custo acumulado da tela até a etapa de origem (Σ horas/peça nominal × R$ ${K_TELA}); convenção, só referência. "Inútil" = WIP que sobra no fim da semana (não vira final). Quanto do inútil é irreversível (estoque já existente que o downstream não absorve) × evitável (produzido a mais): evitável = vigente − proposto; o mínimo alcançável é o melhor candidato da tabela (f)._`);
if (motorC) { P(); P(`Motor ativo replanejado (o que o PROD tende a gerar no fechamento de T3): WIP fim da semana ${n0(motorC.av!.L.totais.wipFinalLo)} pç, excesso ${n0(motorC.av!.L.totais.excessoWip)}, receita ${brl(motorC.av!.receita)}.`); }
P();

// ---- (b) mudanças
P(`## (b) Upstreams a desacelerar/parar e downstreams a proteger — diferença vigente → proposto, por etapa × período (nº de postos ocupados; produção da etapa em peças)`);
P(`| Período | Etapa | Postos vigente → proposto | Produção vigente → proposta (pç) | Leitura |`);
P(`|---|---|---|---|---|`);
const ocupDe = (plano: AlocacaoEscala[], t: number, n: string) => plano.filter((a) => slotDe(a) === t && a.maquinaId && EA.estM.ctx.grafo.noDoPool[`${a.produtoId}|${a.etapaId}`] === n).length;
let linhasB = 0;
for (const s of slotsAlvo) for (const n of nosOrd) {
  const ov = ocupDe(vigA, s.indice, n), op = ocupDe(PROP.futuras, s.indice, n);
  const xv = prodVig.x[n]?.[s.indice - EA.idxIni] ?? 0, xp = prodP.x[n]?.[s.indice - EA.idxIni] ?? 0;
  if (ov === op && Math.abs(xv - xp) < 1) continue;
  linhasB++;
  P(`| ${slotRot(s.indice)} | ${nomeNo(n)} | ${ov} → ${op} | ${n0(xv)} → ${n0(xp)} | ${op < ov ? "DESACELERAR/PARAR (upstream sem destino final)" : op > ov ? "PROTEGER/REFORÇAR (absorve no final)" : "mesma ocupação, outra produção (efeito de fila/ordem)"} |`);
}
if (!linhasB) P(`| — | nenhuma diferença de postos entre vigente e proposto | | | |`);
P();
P(`Postos do plano VIGENTE que não geram valor final (remover = Δ receita ≈ 0 e menos WIP) — candidatos a parar mesmo sem trocar o plano: ${semValor.length ? semValor.map((r) => `${slotRot(r.slot)} ${r.maquina} (${r.posto}; WIP ${sn0(r.dWipFixo)})`).join("; ") : "nenhum"}.`);
P();

// ---- (c) saturação
P(`## (c) Saturação por etapa × período (plano proposto; entre parênteses o plano vigente quando difere)`);
P(`| Período | Etapa | ocup/máx | pessoas livres | V último posto, resto fixo (R$ rec.) | Valor do(s) posto(s) ocupado(s), resto REPLANEJADO (R$ rec.) | V +1 pessoa (R$ rec.) | Motivo (proposto) | Motivo (vigente) |`);
P(`|---|---|---|---|---|---|---|---|---|`);
for (const s of slotsAlvo) for (const c of cap0.capacidade.filter((x) => x.slot === s.indice)) {
  const cv = capVig.capacidade.find((x) => x.slot === c.slot && x.no === c.no);
  const rr = remocoes.proposto.filter((r) => r.slot === c.slot && r.no === c.no);
  const vrep = rr.length ? (rr.some((r) => r.dReceitaRep === null) ? "—" : brl(-rr.reduce((a, r) => a + (r.dReceitaRep ?? 0), 0))) : "—";
  P(`| ${slotRot(c.slot)} | ${nomeNo(c.no)} | ${c.postosOcupados}/${c.postosMaximos} | ${c.pessoasLivres} | ${brl(c.valorMarginalUltimo)} | ${vrep} | ${brl(c.valorMarginalAdicionar)} | ${motivoRico(c, cap0)} | ${cv ? motivoRico(cv, capVig) : "—"} |`);
}
P(`_Mapeamento: ocupados = máx ⇒ SATURADO_POR_MAQUINA (+1 pessoa = 0: não há máquina livre); GARGALO_PESSOA ⇒ POR_PESSOA; sem material ⇒ POR_WIP; downstream sem capacidade ⇒ POR_DOWNSTREAM; demanda/meta já coberta ⇒ POR_DEMANDA; sem período depois ⇒ POR_TEMPO. "V_ÚLTIMO=0 (resto fixo)" = com o resto do dia como está o último posto não adiciona R$ final — é o FALSO ZERO: o valor real do posto está na coluna replanejada (e na tabela (e))._`);
P();

// ---- (d) produtos
P(`## (d) Receita final capturável por produto até sexta`);
P(`| Produto | Meta (pç) | Final realizado até o início de ${alvo} (pç) | Restante (pç) | Máx. produzível (Σ semana, pç) | Capturável (pç) | Capturável receita (R$) | Capturável lucro-tela (R$) | Capturado vigente (pç / R$ rec.) | Capturado proposto (pç / R$ rec.) | Faltará (R$ rec.) no proposto |`);
P(`|---|---|---|---|---|---|---|---|---|---|---|`);
finP.forEach((p, i) => {
  const pv = finV[i], r = finPR[i], rv = finVR[i];
  const capt = Math.max(0, Math.min(p.meta, p.maximoProduzivel) - p.realizadoFinal);
  P(`| ${nome(p.produtoId)} | ${n0(p.meta)} | ${n0(p.realizadoFinal)} | ${n0(p.restante)} | ${n0(p.maximoProduzivel)} | ${n0(capt)} | ${brl(capt * r.valorEconomicoUnitario)} | ${brl(capt * p.valorEconomicoUnitario)} | ${n0(pv.finalProjetado - pv.realizadoFinal)} / ${brl((pv.finalProjetado - pv.realizadoFinal) * rv.valorEconomicoUnitario)} | ${n0(p.finalProjetado - p.realizadoFinal)} / ${brl((p.finalProjetado - p.realizadoFinal) * r.valorEconomicoUnitario)} | ${brl(Math.max(0, capt - (p.finalProjetado - p.realizadoFinal)) * r.valorEconomicoUnitario)} |`);
});
P(`_Preço = valor_unitario do item congelado da Previsão (receita); lucro-tela = convenção da tela Produtos (R$ ${K_TELA}/h), só referência. Capturável = min(meta, máximo físico) − realizado._`);
P();
const lh = lucroHoraDaTela(EA.estM.entrada);
P(`Referência (tela Produtos): ${[...new Set(EA.estM.entrada.pools.map((p) => p.produtoId))].map((pid) => { const x = lh(pid, ""); return x ? `${nome(pid)} margem R$ ${x.margemUnitaria.toFixed(4)}/pç, lucro/h ${x.lucroHora.toFixed(2)}` : ""; }).filter(Boolean).join("; ")}.`);
P();

// ---- (e)
P(`## (e) Valor do posto OCUPADO (remoção) e +1 pessoa/+1 máquina, por posto × período — ${alvo}`);
P(`Valor do posto ocupado = Δ receita final se aquele posto-período NÃO for ocupado: (fixo) resto do dia como está; (replanejado) resto do dia replanejado pelo motor econômico/receita. Nunca por pessoa. Ordenado por valor replanejado (maior primeiro).`);
for (const rot of ["proposto", "vigente"] as const) {
  const rs = remocoes[rot];
  P(); P(`### Plano ${rot}`);
  if (!rs.length) { P(`(não calculado: --sem-remocao)`); continue; }
  P(`| # | Período | Máquina | Posto | Valor do posto ocupado, resto FIXO (R$ rec.) | Δ peças finais fixo | Valor, resto REPLANEJADO (R$ rec.) | Δ peças finais replan. | Δ WIP final replan. | Valor lucro-tela replan. (R$) | +1 pessoa (R$ rec.) |`);
  P(`|---|---|---|---|---|---|---|---|---|---|---|`);
  [...rs].sort((x, y) => (x.dReceitaRep ?? x.dReceitaFixo) - (y.dReceitaRep ?? y.dReceitaFixo)).slice(0, 40).forEach((r, i) => P(`| ${i + 1} | ${slotRot(r.slot)} | ${r.maquina} | ${r.posto} | ${brl(-r.dReceitaFixo)} | ${sn0(r.dFinalFixo)} | ${r.dReceitaRep === null ? "—" : brl(-r.dReceitaRep)} | ${r.dFinalRep === null ? "—" : sn0(r.dFinalRep)} | ${r.dWipRep === null ? "—" : sn0(r.dWipRep)} | ${r.dLucroRep === null ? "—" : brl(-r.dLucroRep)} | ${brl(r.mais1Pessoa)} |`));
  const porMaq = new Map<string, { v: number; vr: number; n: number }>();
  rs.forEach((r) => { const k = `${r.maquina} (${r.posto})`; const x = porMaq.get(k) ?? { v: 0, vr: 0, n: 0 }; x.v += -r.dReceitaFixo; x.vr += -(r.dReceitaRep ?? r.dReceitaFixo); x.n++; porMaq.set(k, x); });
  P(); P(`Soma por máquina (valor de 1 período de cada posto, somado; replanejado quando disponível): ${[...porMaq].sort((a, b) => b[1].vr - a[1].vr).slice(0, 12).map(([k, x]) => `${k}: R$ ${brl(x.vr)} em ${x.n} per.`).join("; ")}.`);
}
P();
P(`**+1 pessoa sem outra máquina = R$ 0 (SATURADO_POR_MAQUINA) — valor do posto ocupado ≠ valor marginal de +1 recurso.** Postos com +1 pessoa > 0 no plano proposto: ${cap0.capacidade.filter((c) => c.valorMarginalAdicionar > 0.005).map((c) => `${slotRot(c.slot)} ${nomeNo(c.no)} R$ ${brl(c.valorMarginalAdicionar)} (${c.postosDisponiveis} máq. livre; ${c.pessoasLivres} pessoas livres)`).join("; ") || "nenhum"}.`);
if (maisMaquina.length) {
  P(); P(`+1 MÁQUINA (INFORMATIVO — a seleção da Previsão é absoluta; nenhuma máquina é adicionada): Δ receita final do dia com uma máquina extra na etapa durante todo ${alvo}, plano replanejado: ${maisMaquina.sort((a, b) => b.dReceita - a.dReceita).map((m) => `${m.rot}: ${m.dReceita > 0.5 ? sg(m.dReceita) : "≈ R$ 0 ⚠ (medida frágil: o motor com máquina fantasma replaneja diferente do base; bruta " + sg(m.dReceita) + ")"} (lucro ${sg(m.dLucro)}, WIP ${sn0(m.dWip)})`).join("; ")}. Medida heurística (motor replanejado com máquina fantasma); valores ≤ 0 devem ser lidos como 0.`);
}
P();

// ---- (g)
P(`## (g) Hard constraints e revezamento`);
P(`| Plano | Núcleo | Independente | Repetições de operação no bloco | Fora das máquinas da Previsão | Linhas sem posto |`);
P(`|---|---|---|---|---|---|`);
P(`| Vigente | ${candsA[0].val!.nucleo} | ${candsA[0].val!.indep} ${candsA[0].val!.indepTipos.join(",")} | ${candsA[0].val!.bloco} | ${candsA[0].val!.foraDaPrevisao} | ${vigA.filter((a) => !a.maquinaId).length} |`);
P(`| Proposto | ${PROP.val!.nucleo} | ${PROP.val!.indep} ${PROP.val!.indepTipos.join(",")} | ${PROP.val!.bloco} | ${PROP.val!.foraDaPrevisao} | ${PROP.futuras.filter((a) => !a.maquinaId).length} |`);
P(`Passado e período em andamento congelados (candidatos só alteram ${alvo}); exposição do revezamento = Escala registrada (nunca o funcionario_id do apontamento).`);
P();

// ---- proposta linha a linha (dia alvo)
const nomesPessoas = [...new Set(PROP.futuras.map((a) => a.funcionarioId))].sort((a, b) => nome(a).localeCompare(nome(b)));
const aus = (f: string, t: number) => ausencias.some((a: any) => a.funcionarioId === f && a.data === slots[t].data && (a.inicioMin === null || a.fimMin === null || (a.inicioMin < slots[t].fimMin && a.fimMin > slots[t].inicioMin)));
const celula = (plano: AlocacaoEscala[], f: string, t: number) => { const a = plano.find((x) => x.funcionarioId === f && slotDe(x) === t); if (!a) return "—"; if (!a.maquinaId) return `sem posto`; return `${nome(a.operacaoId)} · ${nome(a.maquinaId)} · ${nome(a.produtoId)}`; };
P(`## Plano ${trocarA ? "PROPOSTO" : "(candidato de maior receita — NÃO recomendado trocar)"} de ${alvo} por funcionário (as células que diferem do vigente em **negrito**)`);
P(`| Funcionário | ${slotsAlvo.map((s) => s.periodoId.toUpperCase()).join(" | ")} |`);
P(`|---|${slotsAlvo.map(() => "---").join("|")}|`);
nomesPessoas.forEach((f) => P(`| ${nome(f)} | ${slotsAlvo.map((s) => { if (aus(f, s.indice)) return "AUSENTE"; const c = celula(PROP.futuras, f, s.indice), v = celula(vigA, f, s.indice); return c === v ? c : `**${c}** (antes: ${v})`; }).join(" | ")} |`));
P();

// ---- (h)

// ================================================================================================ PARTE II — SEMANA ATUAL + ANTECIPAÇÃO ÚTIL
P(`# >>> PARTE II — SEMANA ATUAL + ANTECIPAÇÃO ÚTIL (nova direção do usuário, 29/10) <<<`);
P(`Hierarquia: 0 hard constraints; 1 semana atual; 2 valor econômico atual; 3 fluxo/WIP/gargalos; 4 antecipação da próxima semana; 5 estabilidade/equilíbrio. VALOR_ATUAL > VALOR_FUTURO sempre. **Correções:** (i) ${alvo} NÃO encerra a fábrica — o WIP que sobra tem valor futuro; ${dia31} não tem períodos, e a próxima semana produtiva começa em **${diasAtivos[0] ?? "—"}**${diasInativos.length ? ` (${diasInativos.join(", ")} inativo na Previsão ⇒ a "segunda M1 de 02/11" não existe; a abertura é ${diasAtivos[0]} M1)` : ""}; (ii) pessoa sem posto só com exceção auditável. A seção "Variante ENXUTA" acima deixa de ser plano final: ela só serve para localizar os pessoa-períodos livres (postos upstream sem valor atual) que agora recebem trabalho útil.`);
P();
P(`## 2–4) Demanda futura (fonte, ordem a→d) e regra de valor futuro`);
P(`- (a) Previsão da próxima semana (${proxSemana}): **${previsaoProxExiste ? `existe (criada ${proxRows.find((r) => r.k === "existe")?.b?.slice(0, 16)}) com ${itensProx.length} item(ns) previsto(s) e ${proxRows.find((r) => r.k === "equipe")?.a ?? "0"} pessoa(s) na equipe da semana; dias ativos: ${diasAtivos.join(", ")}` : "NÃO existe"}**${previsaoProxExiste && itensProx.length === 0 ? " — é uma CASCA (sem itens e sem máquinas escolhidas) ⇒ não há demanda nem máquinas oficiais; as máquinas usadas na simulação são as da Previsão ATUAL (⚠ premissa)" : ""}. (b) pedidos/demanda conhecida: nenhum cadastrado. (c) histórico recorrente das Previsões (${(bruto.q_hist ?? []).length} linhas produto×semana nas últimas 10 semanas). (d) configuração explícita: nenhuma.`);
P(`- Regra: demanda esperada = mediana das últimas ≤3 ocorrências × frequência desde a 1ª aparição na janela de 6 semanas × maturidade (min(1, ocorrências/3)) × (dias produtivos da próxima semana ÷ 5); ausente nas 2 últimas semanas = descontinuado (0). Não há hardcode por produto.`);
P(`| Produto | Fonte | Demanda esperada próxima semana (pç) | Confiança | Detalhe |`);
P(`|---|---|---|---|---|`);
demFut.forEach((x) => P(`| ${nome(x.produtoId)} | ${x.fonte} | ${n0(x.quantidade)} | ${x.confianca === "baixa" ? "⚠ baixa" : x.confianca} | ${x.detalhe} |`));
P();
P(`**VALOR_FUTURO(plano) = R$ final da próxima semana simulada com o WIP de abertura do plano − o mesmo com o WIP de abertura do plano-base (motor)**, usando o MESMO motor/avaliador (receita pelo preço congelado), com as pools limitadas à demanda esperada (peça que a próxima semana não consome vale R$ 0) e à capacidade da próxima semana (${slotsNext.length} períodos, equipe e máquinas atuais ⚠). **VALOR_ATUAL > VALOR_FUTURO**: uma opção só entra se Δ receita atual ≥ −R$ 0,50.`);
P();
if (ANT) {
  const { enx, r, final, nextProp, nextEnx, nextFinal, nextZero } = ANT;
  const nextVig = proxima(wipFim(avVig), "vigente");
  const wipV = wipFim(avVig), wipP2 = wipFim(avP), wipE2 = wipFim(enx.av!), wipF = wipFim(final.av!);
  const soma = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);
  P(`## 4b) TETO DE ANTECIPAÇÃO por par (derivado: min(demanda esperada do produto, capacidade do destino na próxima semana) − WIP do plano do motor)`);
  P(`| Par | Demanda no par (pç) | Capacidade do destino próx. semana (pç) | WIP fim da semana, motor (pç) | TETO adicional (pç) | WIP fim, antecipação (pç) |`);
  P(`|---|---|---|---|---|---|`);
  arestas.forEach((ar) => P(`| ${nomeNo(ar.chavePar)} → ${nome(EA.estM.ctx.poolsPorChave.get(EA.estM.ctx.grafo.nos[ar.destino].membros[0])?.operacaoId)} | ${n0(demMap[ar.produtoId] ?? 0)} | ${n0(capProxDestino(ar.destino))} | ${n0(wipP2[ar.chavePar] ?? 0)} | ${n0(r.teto[ar.chavePar] ?? 0)} | ${n0(wipF[ar.chavePar] ?? 0)} |`));
  P();
  P(`## 7+9) Pessoa-períodos livres (postos do motor sem valor atual + sem posto do motor) — trabalho útil para CADA um (posto, nunca por produtividade individual)`);
  P(`Origem: ${ANT.livres.length} pessoa-períodos = postos upstream do motor sem valor atual (variante enxuta) + pessoa(s) que o próprio motor deixou sem posto. Para cada um: todas as opções de posto livre (máquina da Previsão, disponível, hard constraints OK), Δ receita ATUAL, VALOR FUTURO (próxima semana simulada), WIP gerado e decisão (regra: atual primeiro; senão antecipação dentro do teto; senão exceção auditável).`);
  P(`| Período | Escolha (posto) | Decisão | Δ receita atual (R$) | Valor futuro (R$) | Δ WIP final da semana (pç) | Motivo / regra | Melhores alternativas (Δ atual / valor futuro) |`);
  P(`|---|---|---|---|---|---|---|---|`);
  r.atribs.forEach((a) => {
    const alt = [...a.opcoes].filter((o) => o !== a.escolha && o.hardOk).sort((x, y) => y.fv - x.fv || y.dAtual - x.dAtual).slice(0, 3).map((o) => `${o.produto} ${o.etapa} (${sg(o.dAtual)} / ${sg(o.fv)}${o.acimaDoTeto ? ", acima do teto" : ""}${o.temMaterial ? "" : ", sem material"})`).join("; ");
    P(`| ${slotRot(a.slot)} | ${a.escolha ? `${a.escolha.produto} · ${a.escolha.etapa} · ${a.escolha.maquina}` : `SEM POSTO (${a.semOpcao})`} | ${a.escolha?.decisao ?? "exceção auditável"} | ${a.escolha ? sg(a.escolha.dAtual) : "—"} | ${a.escolha ? sg(a.escolha.fv) : "—"} | ${a.escolha ? sn0(a.escolha.dWipFinal) : "—"} | ${a.decisao} | ${alt || "—"} |`);
  });
  P();
  P(`## 9b) Comparação da antecipação por PRODUTO (melhor opção avaliada por produto, entre todos os pessoa-períodos livres; lógica geral)`);
  P(`| Produto | Demanda futura esperada (pç) | Opções avaliadas | Melhor valor futuro (R$) | Δ atual dessa opção (R$) | Posto (etapa · máquina · período) | Δ WIP final (pç) | Acima do teto? | Observação |`);
  P(`|---|---|---|---|---|---|---|---|---|`);
  produtosAtuais.forEach((pid) => {
    const os = r.todas.filter((o) => o.produto === nome(pid));
    const melhor = [...os].filter((o) => o.hardOk).sort((x, y) => y.fv - x.fv || y.fvBruto - x.fvBruto)[0];
    P(`| ${nome(pid)} | ${n0(demMap[pid] ?? 0)} | ${os.length} | ${melhor ? sg(melhor.fv) : "—"} | ${melhor ? sg(melhor.dAtual) : "—"} | ${melhor ? `${melhor.etapa} · ${melhor.maquina} · ${slotRot(melhor.slot)}` : "—"} | ${melhor ? sn0(melhor.dWipFinal) : "—"} | ${melhor ? (melhor.acimaDoTeto ? "sim (valor 0)" : "não") : "—"} | ${(demMap[pid] ?? 0) === 0 ? "sem demanda futura ⇒ R$ 0" : !melhor ? "nenhuma opção válida" : melhor.fv <= 0.5 ? "sem ganho (gargalo da próxima semana está em outra etapa ou já coberto)" : "elegível"} |`);
  });
  P();
  P(`## 8+10+11+12+14) Resultado: semana atual × próxima semana`);
  const tf = (c: Cand) => c.av!.L.totais; const falta = (c: Cand) => c.av!.L.financeiro!.produtos.reduce((t, p) => t + p.faltaProjetada, 0);
  const rows: [string, Cand, ResultadoSemanaSeguinte, Record<string, number>][] = [["Vigente (gravado)", candsA[0], nextVig, wipV], ["Motor ativo replanejado", PROP, nextProp, wipP2], ["Enxuto (NÃO aceitável: pessoas paradas)", enx, nextEnx, wipE2], ["ANTECIPAÇÃO ÚTIL", final, nextFinal, wipF]];
  P(`| Plano | **ATUAL** receita R$ | lucro-tela R$ | peças finais | falta (pç) | WIP final (pç) | **PRÓXIMA**: WIP de abertura (pç) | receita esperada próx. semana (R$) | valor futuro vs motor (R$) | capacidade liberada próx. semana (posto-períodos vs motor) | churn lin/pes/postos | viol. núcleo/indep/bloco/Prev. | pessoas sem posto |`);
  P(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  const prodSum = (x: ResultadoSemanaSeguinte) => Object.values(x.producaoPorChavePool).reduce((a, b) => a + b, 0);
  const muP = (k: string) => Math.max(1, EA.estM.ctx.poolsPorChave.get(k)?.metas[slotsNext[0].periodoId] ?? 1);
  const postoPerLib = (x: ResultadoSemanaSeguinte) => { const ks = new Set([...Object.keys(nextProp.producaoPorChavePool), ...Object.keys(x.producaoPorChavePool)]); let t = 0; ks.forEach((k) => (t += ((nextProp.producaoPorChavePool[k] ?? 0) - (x.producaoPorChavePool[k] ?? 0)) / muP(k))); return (t >= 0 ? "+" : "") + t.toFixed(2); };
  rows.forEach(([rot, c, nx, w]) => P(`| ${rot} | ${brl(c.av!.receita)} (${sg(c.av!.receita - avVig.receita)}) | ${brl(c.av!.lucro)} | ${n0(tf(c).finalEntregueLo)} | ${n0(falta(c))} | ${n0(tf(c).wipFinalLo)} | ${n0(soma(w))} | ${brl(nx.receita)} | ${sg(nx.receita - nextProp.receita)} | ${postoPerLib(nx)} | ${c.churn!.linhas}/${c.churn!.pessoas}/${c.churn!.postos} | ${c.val!.nucleo}/${c.val!.indep}/${c.val!.bloco}/${c.val!.foraDaPrevisao} | ${c.futuras.filter((a) => !a.maquinaId).length} |`));
  P(`_Abertura zero (sem nenhum WIP no fim da semana): receita esperada da próxima semana R$ ${brl(nextZero.receita)} ⇒ o WIP do motor vale R$ ${sg(nextProp.receita - nextZero.receita)} e o da antecipação R$ ${sg(nextFinal.receita - nextZero.receita)} na próxima semana._`);
  P();
  if (ANT.rolagem) {
    const rm = ANT.rolagem.rm, ra = ANT.rolagem.ra;
    const nrm = proxima(wipFim(rm.av!), "rolagem motor"), nra = proxima(wipFim(ra.av!), "rolagem antecipação");
    P(`### 8) Replay com RESTO REPLANEJADO (manhã de ${alvo} como na antecipação; T1–T3 de ${alvo} replanejados pelo motor com as opções do PROD; a camada de antecipação reaplicada à tarde)`);
    P(`| Cenário | Receita atual R$ | lucro-tela R$ | peças finais | WIP final | Receita esperada próx. semana R$ | pessoas sem posto | viol. núcleo/indep/bloco/Prev. | churn vs vigente lin/pes/postos |`);
    P(`|---|---|---|---|---|---|---|---|---|`);
    [[rm, nrm], [ra, nra]].forEach(([c, nx]) => P(`| ${(c as Cand).rot} | ${brl((c as Cand).av!.receita)} (${sg((c as Cand).av!.receita - avVig.receita)} vs vigente) | ${brl((c as Cand).av!.lucro)} | ${n0((c as Cand).av!.L.totais.finalEntregueLo)} | ${n0((c as Cand).av!.L.totais.wipFinalLo)} | ${brl((nx as ResultadoSemanaSeguinte).receita)} | ${(c as Cand).futuras.filter((a) => !a.maquinaId).length} | ${(c as Cand).val!.nucleo}/${(c as Cand).val!.indep}/${(c as Cand).val!.bloco}/${(c as Cand).val!.foraDaPrevisao} | ${(c as Cand).churn!.linhas}/${(c as Cand).churn!.pessoas}/${(c as Cand).churn!.postos} |`));
    P(`Pessoa-períodos livres reaproveitados na tarde: ${ANT.rolagem.livres}. Leitura: o ganho é robusto ao replanejamento se a linha "com antecipação" ≥ "sem antecipação" em receita atual (nunca menor) e em receita futura.`);
    P();
  }
  P(`**Impacto em R$ ATUAL** (antecipação vs motor): receita ${sg(final.av!.receita - PROP.av!.receita)}, lucro-tela ${sg(final.av!.lucro - PROP.av!.lucro)}, peças finais ${sn0(tf(final).finalEntregueLo - tf(PROP).finalEntregueLo)} (regra: nunca negativo). **Impacto FUTURO:** receita esperada ${sg(nextFinal.receita - nextProp.receita)} na próxima semana; WIP de abertura ${n0(soma(wipP2))} → ${n0(soma(wipF))} pç; capacidade liberada vs motor ${postoPerLib(nextFinal)} posto-períodos (soma das etapas; negativo = a próxima semana passa a precisar de mais produção em etapas que hoje foram abandonadas, compensado pelas ganhas).`);
  P();
  P(`## 11) "Se eu adiantar esta operação hoje, o que deixo de precisar produzir na próxima semana?" — produção necessária por etapa (próxima semana simulada)`);
  P(`| Etapa (produto · operação) | Produção necessária, motor (pç) | Produção necessária, antecipação (pç) | Deixo de produzir (pç) | Posto-períodos liberados | Capacidade da etapa próx. semana (pç) | Utilização motor → antecipação |`);
  P(`|---|---|---|---|---|---|---|`);
  const chaves = [...new Set([...Object.keys(nextProp.producaoPorChavePool), ...Object.keys(nextFinal.producaoPorChavePool)])];
  const capPool = (k: string) => { const pool = EA.estM.ctx.poolsPorChave.get(k); return pool ? slotsNext.reduce((t, sl) => t + pool.maquinasIds.length * (pool.metas[sl.periodoId] ?? 0), 0) : 0; };
  chaves.forEach((k) => { const a0 = nextProp.producaoPorChavePool[k] ?? 0, a1 = nextFinal.producaoPorChavePool[k] ?? 0; const pool = EA.estM.ctx.poolsPorChave.get(k); const mu = pool ? (pool.metas[slotsNext[0].periodoId] ?? 1) : 1; const cap = capPool(k); P(`| ${nomeNo(k)} | ${n0(a0)} | ${n0(a1)} | ${sn0(a0 - a1)} | ${((a0 - a1) / Math.max(1, mu)).toFixed(2)} | ${n0(cap)} | ${cap > 0 ? ((100 * a0) / cap).toFixed(0) : "—"}% → ${cap > 0 ? ((100 * a1) / cap).toFixed(0) : "—"}% |`); });
  P(`_Posto-períodos = pç ÷ produção esperada de 1 posto-período (1º período da próxima semana). Utilização > ~95% = gargalo provável da próxima semana (⚠ equipe e máquinas da semana atual como premissa)._`);
  P();
  P(`## 6) TESTE DE TRANSIÇÃO: ${alvo} T3 → ${diasAtivos[0] ?? "próxima semana"} M1 (WIP antecipado entra na abertura; nenhuma escrita em PROD)`);
  const dN: DadosProducaoReal0 = { apontamentos: [], agoraMs: agoraNext, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: contagensDeAbertura(EA.estM.ctx, wipF, openMs, "transição") };
  const ctxN = prepararFluxo(entNext, dN as any, optPlan);
  const estN = montarEstado(ctxN);
  P(`| Par | Saldo simulado fim de ${alvo} T3 (pç) | Saldo lido pela próxima semana [lo–hi] | Origem | Confiança (estado) | Lido = simulado? |`);
  P(`|---|---|---|---|---|---|`);
  let transOk = true;
  arestas.forEach((ar) => {
    const sim = Math.round(wipF[ar.chavePar] ?? 0);
    const par = estN.pares.find((q: any) => `${q.produtoId}|${q.etapaOrigemId}` === ar.chavePar);
    if (!par) { if (sim > 0) transOk = false; P(`| ${nomeNo(ar.chavePar)} | ${n0(sim)} | (produto sem demanda na próxima semana ⇒ par fora) | — | — | ${sim > 0 ? "NÃO (WIP órfão: sem demanda futura)" : "n/a"} |`); return; }
    const igual = Math.abs(par.wip.lo - sim) < 1 && Math.abs(par.wip.hi - sim) < 1; if (!igual && sim > 0) transOk = false;
    P(`| ${nomeNo(ar.chavePar)} | ${n0(sim)} | ${n0(par.wip.lo)}–${n0(par.wip.hi)} | ${par.origem === "confirmado" ? "contagem simulada (virada)" : "estimado"} | ${par.confianca === "baixa" ? "⚠ baixa" : par.confianca} | ${igual ? "sim" : sim === 0 ? "n/a" : "NÃO"} |`);
  });
  P(`**Resultado do teste: ${transOk ? "APROVADO — todo saldo simulado com demanda futura entra na abertura com o valor exato (lo=hi); a semana seguinte planeja menos produção nas etapas upstream (tabela 11)" : "REPROVADO/PARCIAL — ver linhas NÃO"}.** Regras da transição (proposta): o saldo final da semana é gravado como contagem de abertura do par com origem "simulação" ⇒ confiança média (⚠ não é contagem física: precisa de contagem física real na sexta T3 / primeira hora da abertura); produto, etapa, rota e origem acompanham o par; o WIP NÃO é zerado na virada; WIP de produto sem demanda futura é "órfão" (aparece como alerta, não como ativo).`);
  P();
  P(`## 13) Gargalos`);
  const gar = chaves.map((k) => ({ k, u: capPool(k) > 0 ? (nextFinal.producaoPorChavePool[k] ?? 0) / capPool(k) : 0 })).sort((a, b) => b.u - a.u).slice(0, 5);
  P(`- Atuais (${alvo}, tabela (c)): Etiquetadora 16 / Montagens da Caixa / Pino / Plug / Embalar 1.1/4 = SATURADO_POR_MAQUINA com valor; Embalagem 17 e Etiquetadora 15 são os downstreams protegidos do Conector.`);
  P(`- Prováveis na próxima semana (utilização da capacidade, com antecipação): ${gar.map((x) => `${nomeNo(x.k)} ${(x.u * 100).toFixed(0)}%`).join("; ")}.`);
  P();
  P(`## 15) Churn e materialidade`);
  P(`Antecipação vs vigente: ${final.churn!.linhas} linhas / ${final.churn!.pessoas} pessoas / ${final.churn!.postos} postos; vs motor: ${churnDe(EA, PROP.futuras, final.futuras).linhas} linhas / ${churnDe(EA, PROP.futuras, final.futuras).pessoas} pessoas / ${churnDe(EA, PROP.futuras, final.futuras).postos} postos. Ganho atual vs motor R$ ${brl(final.av!.receita - PROP.av!.receita)} (limiar atual R$ ${brl(limA.receita)}); ganho futuro esperado R$ ${brl(nextFinal.receita - nextProp.receita)} por ${churnDe(EA, PROP.futuras, final.futuras).pessoas || 1} pessoa(s) / ${churnDe(EA, PROP.futuras, final.futuras).postos || 1} posto(s) alterado(s) vs motor. O limiar de materialidade (ruído do modelo) aplica-se ao valor ATUAL; o valor futuro é estimativa de baixa confiança e só entra como desempate/uso de capacidade que seria ociosa — por isso ocupar uma pessoa que ficaria parada é aceitável mesmo abaixo do limiar, desde que o custo atual seja ≥ −R$ 0,50.`);
  P();
}


// ================================================================================================ PARTE III — v2 (decisões aprovadas 29/10 ~14:50)
if (ANT && ANT_ROB && ANT_SEM8 && ER && EC) {
  const A = ANT, B = ANT_ROB, C = ANT_SEM8;
  P(`# >>> PARTE III — v2: DECISÕES APROVADAS (abertura derivada, demanda em 4 níveis, teto, lexicográfico, Máquina 8 em sombra, resultado robusto, WIP com idade/confirmação) <<<`);
  P(`Lexicográfico: 1º valor ATUAL; 2º, entre planos com atual indistinguível (limiar), valor FUTURO; depois menor WIP inútil, churn, estabilidade, equilíbrio. VALOR_ATUAL e VALOR_FUTURO são mostrados SEPARADOS (nunca somados). Nada gravado em PROD; flags só propostas (docs/escala-inteligente-v2.md).`);
  P();
  const ab = aberturaProximaSemana(diasAtivos, slots[slots.length - 1].data);
  P(`## v2.1) Foto, abertura da próxima semana e calendário`);
  P(`- Foto: ${rotFoto}. Último dia da semana atual: ${slots[slots.length - 1].data}. **Abertura da próxima semana (regra geral: 1º período produtivo ATIVO após o encerramento): ${ab ? ab.dia + " M1" : "indefinida"}**; dias ativos da Previsão seguinte: ${diasAtivos.join(", ")}${diasInativos.length ? `; inativos: ${diasInativos.join(", ")}` : ""}.`);
  const t1 = d.apontamentos.filter((a) => a.data === hoje && a.periodoId === "t1" && a.lancadoEmMs <= agoraMs);
  const t1p = t1.filter((a) => a.status === "produzindo");
  P(`- Execução de ${hoje} T1 lida: ${t1.length} apontamento(s) (${t1p.length} produzindo); boas ${n0(t1p.reduce((q, a) => q + a.boas, 0))} pç de meta ${n0(t1p.reduce((q, a) => q + a.meta, 0))} (${t1p.reduce((q, a) => q + a.meta, 0) > 0 ? ((100 * t1p.reduce((q, a) => q + a.boas, 0)) / t1p.reduce((q, a) => q + a.meta, 0)).toFixed(0) : "—"}%). Ausências do dia ${hoje}: ${ausencias.filter((x: any) => x.data === hoje).length}; de ${alvo}: ${ausencias.filter((x: any) => x.data === alvo).length}.`);
  P();
  P(`## v2.2) Resultados: A) COMPLETO × B) ROBUSTO × C) SEM Máquina 8 — separados atual × futuro`);
  const limAtual = limiarEscopo(EA, A.cVig.av!, slotsAlvo.length);
  const delta = (x: number, y: number) => sg(x - y);
  const rowsR: [string, number, number, number, number, string][] = [];
  // A: planos avaliados no próprio cenário
  const gA = A.final.av!.receita - A.cVig.av!.receita, gAm = A.final.av!.receita - A.base.av!.receita;
  // B1: plano da antecipação (A) avaliado com a produtividade REAL pessimista da Máquina 8 (limite inferior do IC95%)
  const b1F = ER.avaliar(A.final.futuras), b1V = ER.avaliar(A.vig), b1M = ER.avaliar(A.base.futuras);
  // C1: plano da antecipação (A) sem a Máquina 8
  const c1F = EC.avaliar(A.final.futuras), c1V = EC.avaliar(A.vig), c1M = EC.avaliar(A.base.futuras);
  const limB = limiarEscopo(ER, b1V, slotsAlvo.length), limC = limiarEscopo(EC, c1V, slotsAlvo.length);
  P(`Limiar de materialidade (1 erro-padrão do modelo, escopo ${alvo}, n=${slotsAlvo.length}): receita R$ ${brl(limAtual.receita)} (A); R$ ${brl(limB.receita)} (B, M8 pessimista); R$ ${brl(limC.receita)} (C, sem M8).`);
  P(`| Cenário | ATUAL: Δ receita vs vigente (R$) | ATUAL: Δ receita vs base/motor (R$) | limiar (R$) | passa o limiar? | FUTURO: Δ receita esperada próx. semana vs base (R$) | WIP final (pç) | WIP de abertura (pç) | pessoas sem posto | viol. núcleo/indep/bloco/Prev. |`);
  P(`|---|---|---|---|---|---|---|---|---|---|`);
  const soma = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);
  const lin = (rot: string, gv: number, gm: number, lim: number, fut: number | null, wipF: number, wipA: number, sp: number, v: Cand | null) => P(`| ${rot} | ${sg(gv)} | ${sg(gm)} | ${brl(lim)} | ${gv >= lim ? "SIM" : "**NÃO**"} | ${fut === null ? "—" : sg(fut)} | ${n0(wipF)} | ${n0(wipA)} | ${sp} | ${v ? `${v.val!.nucleo}/${v.val!.indep}/${v.val!.bloco}/${v.val!.foraDaPrevisao}` : "—"} |`);
  lin("A) COMPLETO (replanejado)", gA, gAm, limAtual.receita, A.nextFinal.receita - A.nextProp.receita, A.final.av!.L.totais.wipFinalLo, soma(A.wipB) * 0 + A.final.av!.L.totais.wipFinalLo, A.final.futuras.filter((a) => !a.maquinaId).length, A.final);
  lin("B1) plano de A avaliado com Máquina 8 PESSIMISTA (IC95% inferior)", b1F.receita - b1V.receita, b1F.receita - b1M.receita, limB.receita, null, b1F.L.totais.wipFinalLo, b1F.L.totais.wipFinalLo, A.final.futuras.filter((a) => !a.maquinaId).length, null);
  lin("B2) ROBUSTO replanejado (M8 pessimista + demanda de baixa confiança = 0 + WIP não confirmado = 0)", B.final.av!.receita - B.cVig.av!.receita, B.final.av!.receita - B.base.av!.receita, limB.receita, B.nextFinal.receita - B.nextProp.receita, B.final.av!.L.totais.wipFinalLo, B.final.av!.L.totais.wipFinalLo, B.final.futuras.filter((a) => !a.maquinaId).length, B.final);
  lin("C1) plano de A SEM Máquina 8 (as linhas da M8 rendem 0)", c1F.receita - c1V.receita, c1F.receita - c1M.receita, limC.receita, null, c1F.L.totais.wipFinalLo, c1F.L.totais.wipFinalLo, A.final.futuras.filter((a) => !a.maquinaId).length, null);
  lin("C2) replanejado SEM Máquina 8", C.final.av!.receita - C.cVig.av!.receita, C.final.av!.receita - C.base.av!.receita, limC.receita, C.nextFinal.receita - C.nextProp.receita, C.final.av!.L.totais.wipFinalLo, C.final.av!.L.totais.wipFinalLo, C.final.futuras.filter((a) => !a.maquinaId).length, C.final);
  const robusto = B.final.av!.receita - B.cVig.av!.receita;
  const semM8 = C.final.av!.receita - C.cVig.av!.receita;
  const camadaA = gAm, camadaB1 = b1F.receita - b1M.receita, camadaB2 = B.final.av!.receita - B.base.av!.receita, camadaC1 = c1F.receita - c1M.receita, camadaC2 = C.final.av!.receita - C.base.av!.receita;
  const valorM8 = A.final.av!.receita - C.final.av!.receita; // receita absoluta com M8 (A) − sem M8 (C2), mesmas premissas
  const passaSemM8 = Math.max(camadaC1, camadaC2) >= limC.receita || semM8 >= limC.receita;
  const margemSemM8 = limC.receita > 0 ? Math.max(camadaC1, camadaC2) / limC.receita - 1 : 0;
  const dependeM8 = camadaA >= limAtual.receita && !passaSemM8;
  P();
  P(`**Pergunta: quanto do ganho da camada de antecipação (A: ${sg(camadaA)} sobre o plano base do motor; limiar R$ ${brl(limAtual.receita)}) permanece no cenário robusto?** B1 (mesmo plano, Máquina 8 pessimista): ${sg(camadaB1)} (${camadaA > 0 ? ((100 * camadaB1) / camadaA).toFixed(0) : "—"}% de A). B2 (replanejado robusto: M8 pessimista + demanda de baixa confiança = 0 + WIP não confirmado = 0): ${sg(camadaB2)} (${camadaA > 0 ? ((100 * camadaB2) / camadaA).toFixed(0) : "—"}%). Sem a Máquina 8: C1 ${sg(camadaC1)} / C2 ${sg(camadaC2)} (a Máquina 8 responde por ${sg(camadaA - camadaC1)} de A pelo método C1). **Valor atribuível à Máquina 8 (receita absoluta do plano replanejado COM − SEM M8, mesmas premissas): ${sg(valorM8)}** ${Math.abs(valorM8) < limAtual.receita ? `— abaixo do limiar (R$ ${brl(limAtual.receita)}): a Máquina 8 NÃO é o que sustenta o ganho; o replanejamento sem M8 já alcança ${sg(semM8)} vs vigente (mesma régua do cenário C)` : `— acima do limiar: o resultado depende materialmente da Máquina 8`}. **Custo da INCERTEZA da produtividade da M8** (mesmo plano, produtividade real pessimista no lugar da substituta): ${sg(b1F.receita - A.final.av!.receita)} (≪ limiar) — o que a M8 incerta pode tirar do ganho é pequeno; o que pesa é usar ou não a máquina (valor acima). Margem sobre o limiar sem M8 (camada sobre a base): ${(margemSemM8 * 100).toFixed(0)}%. ${dependeM8 ? "**O plano só passa o limiar por causa da Máquina 8 ⇒ NÃO ativar automaticamente (baixa confiança); permanece em sombra.**" : passaSemM8 ? `O ganho da camada passa o limiar também SEM a Máquina 8${margemSemM8 < 0.25 ? ", mas com margem estreita (<25%): tratar como não conclusivo ⇒ manter em sombra" : ""}.` : "A camada não passa o limiar."} Em relação ao vigente gravado (inclui o replanejamento do próprio motor): A ${sg(gA)}, B2 ${sg(robusto)}, C2 ${sg(semM8)}. Candidatos de baixa confiança participam da busca em sombra mas não justificam sozinhos a ativação.`);
  P();
  P(`## v2.3) Máquina 8 — produtividade REAL do POSTO (produto × operação × Máquina 8; nunca por pessoa)`);
  const m8Ap = d.apontamentos.filter((a) => a.maquinaId === m8Maq && a.status === "produzindo" && a.meta > 0 && a.lancadoEmMs <= agoraMs);
  P(`- n = ${m8Stat.n} apontamentos 'produzindo'; razão boas÷meta: mediana ${(m8Stat.mediana * 100).toFixed(1)}%, média aparada 10% ${(m8Stat.mediaRobusta * 100).toFixed(1)}%, dispersão (MAD×1,4826) ${(m8Stat.dispersaoMAD * 100).toFixed(1)} p.p., **IC95% [${(m8Stat.ic95[0] * 100).toFixed(1)}%; ${(m8Stat.ic95[1] * 100).toFixed(1)}%]** (${m8Stat.metodo}). Classificação: **${m8Stat.confianca}**${m8Stat.confianca !== "OK" ? " — decisões que dependem da Máquina 8 ficam em sombra até haver amostra suficiente" : ""}.`);
  P(`| Período | n | boas médias (pç) | meta do apontamento (pç) | boas÷meta (média) | meta usada pelo motor (substituta) | boas reais ÷ substituta |`);
  P(`|---|---|---|---|---|---|---|`);
  const poolM8 = EA.estM.entrada.pools.find((q) => q.maquinasIds.includes(m8Maq));
  ["m1", "m2", "m3", "t1", "t2", "t3"].forEach((per) => {
    const xs = m8Ap.filter((a) => a.periodoId === per);
    if (!xs.length) { P(`| ${per.toUpperCase()} | 0 | — | — | — | ${n0(poolM8?.metas[per] ?? 0)} | — |`); return; }
    const mb = xs.reduce((q, a) => q + a.boas, 0) / xs.length, mm = xs.reduce((q, a) => q + a.meta, 0) / xs.length;
    P(`| ${per.toUpperCase()} | ${xs.length} | ${n0(mb)} | ${n0(mm)} | ${((100 * mb) / mm).toFixed(0)}% | ${n0(poolM8?.metas[per] ?? 0)} | ${poolM8?.metas[per] ? ((100 * mb) / poolM8.metas[per]).toFixed(0) + "%" : "—"} |`);
  });
  P(`Cenário B usa metas da M8 = nominal × limite inferior do IC (${(m8Stat.ic95[0] * 100).toFixed(1)}%) quando menor que a substituta atual (${poolM8 ? ((100 * (poolM8.metas.t1 ?? 0)) / ((poolM8.metas.t1 ?? 1) / (fEmbA[`${poolM8.produtoId}|${poolM8.etapaId}`] ?? 1))).toFixed(0) : "—"}% do nominal em T1).`);
  P();
  P(`## v2.4) Demanda futura USADA (hierarquia: 1 Previsão com itens › 2 pedido conhecido › 3 histórico 6 semanas › 4 configuração) e TETO de antecipação por produto/etapa`);
  P(`Previsão ${proxSemana}: ${previsaoProxExiste ? (itensProx.length ? `${itensProx.length} itens (usada)` : "CASCA sem itens ⇒ NÃO substitui o histórico") : "inexistente"}; pedidos conhecidos no sistema: nenhum cadastrado; configuração de recorrência: nenhuma.`);
  P(`| Produto | Fonte | Demanda esperada (pç) | Confiança | Usada no robusto (B)? |`);
  P(`|---|---|---|---|---|`);
  demFut.forEach((x) => P(`| ${nome(x.produtoId)} | ${x.fonte} | ${n0(x.quantidade)} | ${x.confianca === "baixa" ? "⚠ baixa" : x.confianca} | ${demRobusta[x.produtoId] > 0 ? "sim" : "não (zerada)"} |`));
  P();
  P(`| Par (origem → seguinte) | Demanda no par | WIP base (pç) | Capacidade destino próx. semana | Gargalo da cadeia próx. semana | TETO (pç) | Limitado por | WIP final com antecipação | Antecipado (pç) |`);
  P(`|---|---|---|---|---|---|---|---|---|`);
  const wipFinA = A.wipFim(A.final.av!);
  A.arestas.forEach((ar) => P(`| ${nomeNo(ar.chavePar)} | ${n0(demMap[ar.produtoId] ?? 0)} | ${n0(A.wipB[ar.chavePar] ?? 0)} | ${n0(A.capProxDestino(ar.destino))} | ${n0(A.capGargalo(ar.produtoId))} | ${n0(A.r.teto[ar.chavePar] ?? 0)} | ${A.r.limTeto[ar.chavePar] ?? "—"} | ${n0(wipFinA[ar.chavePar] ?? 0)} | ${n0(Math.max(0, (wipFinA[ar.chavePar] ?? 0) - (A.wipB[ar.chavePar] ?? 0)))} |`));
  P(`_Teto = min(demanda, capacidade do destino, gargalo) − WIP disponível − já antecipado; máx. 6 períodos antecipados por par (⚠ parâmetro). Sem estoque infinito._`);
  P();
  P(`## v2.5) Pessoa-períodos livres — CADA opção com VALOR ATUAL e VALOR FUTURO separados (a semana atual manda; o trade-off aparece sem penalizar o atual)`);
  P(`| Período | Opção (posto) | VALOR ATUAL Δ R$ | VALOR FUTURO Δ R$ | Δ WIP final (pç) | Demanda futura do produto (pç) | Teto do par (pç) | Efeito no downstream (pç produzidas a mais/menos esta semana) | Confiança | Escolhida? / motivo |`);
  P(`|---|---|---|---|---|---|---|---|---|---|`);
  A.r.atribs.forEach((a, ia) => {
    [...a.opcoes].filter((o) => o.hardOk).sort((x, y) => y.dAtual - x.dAtual || y.fv - x.fv).forEach((o) => {
      const esc = a.escolha === o;
      P(`| ${slotRot(a.slot)} (linha livre #${ia + 1}) | ${o.produto} · ${o.etapa} · ${o.maquina} | ${sg(o.dAtual)} | ${sg(o.fv)}${o.acimaDoTeto ? " (acima do teto ⇒ 0)" : ""} | ${sn0(o.dWipFinal)} | ${n0(o.demandaPar ?? 0)} | ${n0(o.tetoPar ?? 0)} | ${sn0(o.dDownstream ?? 0)} | ${o.baixaConf ? "BAIXA_CONFIANCA_PRODUTIVIDADE (M8)" : "ok"} | ${esc ? `**ESCOLHIDA** (${o.decisao}): ${a.decisao}` : o.temMaterial ? "" : "sem material"} |`);
    });
    if (!a.escolha) P(`| ${slotRot(a.slot)} | — | — | — | — | — | — | — | — | **SEM POSTO (exceção auditável: ${a.semOpcao})** |`);
  });
  P();
  P(`## v2.6) Planos: base de ${alvo} e plano SOMBRA com antecipação (pessoas só como ocupantes; células diferentes da base em **negrito**)`);
  P(`| Funcionário | ${slotsAlvo.map((s) => s.periodoId.toUpperCase()).join(" | ")} |`);
  P(`|---|${slotsAlvo.map(() => "---").join("|")}|`);
  [...new Set(A.final.futuras.map((a) => a.funcionarioId))].sort((x, y) => nome(x).localeCompare(nome(y))).forEach((f) => P(`| ${nome(f)} | ${slotsAlvo.map((s) => { if (aus(f, s.indice)) return "AUSENTE"; const c = celula(A.final.futuras, f, s.indice), b0 = celula(A.base.futuras, f, s.indice); return c === b0 ? c : `**${c}** (base: ${b0})`; }).join(" | ")} |`));
  P(`Pessoas sem posto no plano sombra: **${A.final.futuras.filter((a) => !a.maquinaId).length}** (${A.final.futuras.filter((a) => !a.maquinaId).length === 0 ? "nenhuma pessoa parada" : "exceções auditáveis na tabela v2.5"}). Churn vs vigente ${A.final.churn!.linhas}/${A.final.churn!.pessoas}/${A.final.churn!.postos}; vs base ${churnDe(EA, A.base.futuras, A.final.futuras).linhas}/${churnDe(EA, A.base.futuras, A.final.futuras).pessoas}/${churnDe(EA, A.base.futuras, A.final.futuras).postos} (linhas/pessoas/postos).`);
  P();
  P(`## v2.7) WIP entre semanas (não zera): produto, rota, etapa, quantidade, confiança, origem, última confirmação, idade; CONTAGEM_RECOMENDADA (nunca bloqueia produção)`);
  const parEst = montarEstado(EA.estM.ctx).pares as any[];
  const abMs = A.slotsNext[0].inicioMs;
  const itensAb = A.arestas.map((ar) => {
    const par = parEst.find((q) => `${q.produtoId}|${q.etapaOrigemId}` === ar.chavePar);
    const ult = par?.contagem?.contadoEm ? Date.parse(par.contagem.contadoEm) : null;
    const destPool = EA.estM.ctx.poolsPorChave.get(EA.estM.ctx.grafo.nos[ar.destino].membros[0])!;
    return { chavePar: ar.chavePar, produtoId: ar.produtoId, etapaOrigemId: ar.etapaOrigemId, etapaSeguinteId: ar.etapaSeguinteId, saldo: Math.round(wipFinA[ar.chavePar] ?? 0), confirmadoFisico: false, ultimaConfirmacaoMs: ult, confiancaBase: (par?.confianca ?? "baixa") as "alta" | "media" | "baixa", consumoPeriodoDestino: (destPool.metas[A.slotsNext[0].periodoId] ?? 0) * destPool.maquinasIds.length, demandaNoPar: demMap[ar.produtoId] ?? 0 };
  });
  const wipAb = carregarWipAbertura(itensAb, abMs);
  P(`| Par (produto · etapa origem → seguinte) | Quantidade na abertura (pç) | Origem | Confiança | Última confirmação física | Idade na abertura (h) | Sinal |`);
  P(`|---|---|---|---|---|---|---|`);
  wipAb.forEach((w) => P(`| ${nomeNo(w.chavePar)} → ${nome(EA.estM.ctx.poolsPorChave.get(EA.estM.ctx.grafo.nos[EA.estM.ctx.grafo.arestas[w.chavePar.split("|")[1] ? A.arestas.find((x) => x.chavePar === w.chavePar)!.id : ""]?.destino ?? ""]?.membros[0] ?? "")?.operacaoId)} | ${n0(w.saldo)} | ${w.origem} | ${w.confianca === "baixa" ? "⚠ baixa" : w.confianca} | ${w.ultimaConfirmacaoMs ? new Date(w.ultimaConfirmacaoMs - 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") + " SP" : "nunca"} | ${w.idadeHoras === null ? "—" : w.idadeHoras.toFixed(0)} | ${w.sinal ?? "—"}${w.motivoSinal.length ? " (" + w.motivoSinal.join("; ") + ")" : ""} |`));
  P(`WIP de abertura total ${n0(wipAb.reduce((q, w) => q + w.saldo, 0))} pç; **CONTAGEM_RECOMENDADA em ${wipAb.filter((w) => w.sinal).length} par(es)** — fazer na sexta T3 ou na 1ª hora do 1º dia produtivo; a produção NÃO é bloqueada pela falta de contagem. Fim de semana/feriado não zera o WIP: só aumenta a idade e reduz a confiança.`);
  P();
  P(`## v2.8) Respostas objetivas (entrega)`);
  P(`1) foto ${modo} ${hhmm(agoraMs)}; 2) plano base: Δ receita ${sg(A.base.av!.receita - A.cVig.av!.receita)} vs vigente (WIP final ${n0(A.base.av!.L.totais.wipFinalLo)} pç); 3) plano sombra: seção v2.6; 4) **ganho ATUAL** ${sg(gA)} vs vigente, ${sg(gAm)} vs base (limiar R$ ${brl(limAtual.receita)}); 5) **ganho FUTURO** ${sg(A.nextFinal.receita - A.nextProp.receita)} esperado na próxima semana vs base (⚠ baixa confiança; ruído ±R$ 50–400); 6) **ganho ROBUSTO da camada** ${sg(camadaB2)} (B2) / ${sg(camadaB1)} (B1) sobre a base [vs vigente ${sg(robusto)}]; 7) **sem M8 incerta** ${sg(camadaC2)} (C2) / ${sg(camadaC1)} (C1) sobre a base [vs vigente ${sg(semM8)}]; 8) demanda futura: v2.4; 9) teto: v2.4; 10) **pessoas paradas** ${A.final.futuras.filter((a) => !a.maquinaId).length}; 11) WIP final da sexta ${n0(A.final.av!.L.totais.wipFinalLo)} pç (vigente ${n0(A.cVig.av!.L.totais.wipFinalLo)}); 12) WIP de abertura ${n0(wipAb.reduce((q, w) => q + w.saldo, 0))} pç; 13) capacidade liberada: ver tabela 11; 14) churn ${A.final.churn!.linhas}/${A.final.churn!.pessoas}/${A.final.churn!.postos} vs vigente; 15) restrições: núcleo ${A.final.val!.nucleo}, independente ${A.final.val!.indep}, bloco ${A.final.val!.bloco}, fora da Previsão ${A.final.val!.foraDaPrevisao}; 16) confiança: Máquina 8 ${m8Stat.confianca}, demanda de ${demFut.filter((x) => x.confianca === "baixa").length} produto(s) baixa, WIP de abertura simulado (CONTAGEM_RECOMENDADA); 17) **recomendação:** ${dependeM8 ? "MANTER EM SOMBRA — o ganho depende da Máquina 8 (baixa confiança)" : camadaB2 >= limB.receita && margemSemM8 >= 0.25 ? "PILOTO elegível (ganho robusto da camada acima do limiar, com margem sem M8 ≥ 25%), ainda em sombra até os critérios do item 20" : "MANTER EM SOMBRA — ganho robusto sem margem suficiente (limiar R$ " + brl(limB.receita) + "; camada B2 " + sg(camadaB2) + "; sem M8 " + sg(Math.max(camadaC1, camadaC2)) + ")"}.`);
  P();
}

P(`## (h) ⚠ Baixa confiança`);
const conf = [...new Set(finP.flatMap((p) => confianca(p.produtoId, p.etapaFinalId).map((r) => `${nome(p.produtoId)}: ${r}`)))];
conf.forEach((x) => P(`- ⚠ ${x}`));
P(`- ⚠ Máquina Automática 8: produtividade REAL do posto existe (n=${apM8.length}, boas÷meta ${m8M > 0 ? ((m8B / m8M) * 100).toFixed(0) + "%" : "n/d"}); o motor oficial ainda usa a substituta do convencional.`);
P(`- ⚠ Foto ${modo}: ${modo === "projetada" ? "T1–T3 de hoje são PROJEÇÃO (a produção real não segue fielmente a Escala); a foto REAL (--agora) substitui por apontamentos" : "estado válido, mas NÃO prova a qualidade do plano (a produção não segue fielmente a Escala)"}.`);
P(`- ⚠ O lucro-tela usa a convenção R$ ${K_TELA}/h (folha + fixos rateados); a decisão principal usa receita final (preço congelado). Capital parado em R$ usa custo da tela acumulado (referência).`);
P();
P(`---\n_Gerado por scripts/escala-fluxo-atingibilidade/analise-30-10.ts em ${((Date.now() - T0) / 1000).toFixed(0)} s. Reproduzir: rodar-30-10.sh ${argv.join(" ")}_`);

const dirSaida = arg("saida-dir") ?? path.join(SCRATCH, "ating30");
fs.mkdirSync(dirSaida, { recursive: true });
const sufixo = `${modo}-${hhmm(agoraMs).replace(":", "")}${arg("sufixo") ? "-" + arg("sufixo") : ""}`;
const mdPath = path.join(dirSaida, `analise-30-10-${sufixo}.md`);
fs.writeFileSync(mdPath, L.join("\n"));
const jsonPath = mdPath.replace(/\.md$/, ".json");
fs.writeFileSync(jsonPath, JSON.stringify({
  foto: modo, instante: new Date(agoraMs).toISOString(), hoje, alvo, existe31, limiar: { sigma, receita: limA.receita, lucro: limA.lucro },
  recomendacao: trocarA ? "TROCAR" : "MANTER", propostaRot: PROP.rot,
  candidatos: candsA.map((c) => ({ rot: c.rot, gerador: c.gerador, receita: c.av!.receita, lucro: c.av!.lucro, pecasFinais: c.av!.L.totais.finalEntregueLo, wipFinal: c.av!.L.totais.wipFinalLo, excessoWip: c.av!.L.totais.excessoWip, churn: c.churn, validacao: c.val })),
  wip: wipRows, remocoes, maisMaquina,
  produtos: finP.map((p, i) => ({ produto: nome(p.produtoId), meta: p.meta, realizado: p.realizadoFinal, restante: p.restante, maximo: p.maximoProduzivel, finalVigente: finV[i].finalProjetado, finalProposto: p.finalProjetado, preco: finPR[i].valorEconomicoUnitario })),
  linhasProposta: PROP.futuras.map((a) => ({ ...a, funcionarioId: undefined, slot: slotDe(a), posto: `${nome(a.operacaoId)} · ${nome(a.maquinaId)} · ${nome(a.produtoId)}` })),
  escopoB: EB ? { limiar: limB, candidatos: candsB.map((c) => ({ rot: c.rot, receita: c.av!.receita, lucro: c.av!.lucro, churn: c.churn })) } : null,
}, null, 1));
console.log(`\nARQUIVO: ${mdPath}\nJSON: ${jsonPath}\n`);
console.log(`RESUMO — foto ${modo} @${hhmm(agoraMs)} — ${trocarA ? "TROCAR" : "MANTER"} (${PROP.rot})`);
console.log(`Receita ${brl(avVig.receita)} → ${brl(avP.receita)} (${sg(avP.receita - avVig.receita)}; limiar ${brl(limA.receita)}) | Lucro ${brl(avVig.lucro)} → ${brl(avP.lucro)} | WIP final ${n0(totV.wipFinalLo)} → ${n0(totP.wipFinalLo)} | churn ${PROP.churn!.linhas}/${PROP.churn!.pessoas}/${PROP.churn!.postos} | ${((Date.now() - T0) / 1000).toFixed(0)} s`);
void FIN0;

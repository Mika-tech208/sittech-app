/* eslint-disable @typescript-eslint/no-explicit-any */
// PROPOSTA INTELIGENTE para T1/T2/T3 (a aprovar). NÃO grava nada em PROD: só SELECT (rodaprod.sh, com retry) + cálculo offline. Revezamento por bloco = hard; equivalências desligadas;
// só máquinas selecionadas na Previsão; períodos anteriores a T1 congelados.
//
// Uso (veja o README):  ts.sh scripts/escala-fluxo-atingibilidade/proposta-tarde.ts [--agora ISO] [--data 2026-10-29] [--periodo-inicial t1]
//        [--contagem "Caixa:Etiquetar>Montar=2500@10:24"]... [--contagens-json arq.json] [--saida arq.md] [--cache] [--tolerancia-pct 0.1] [--sem-estimador]
import * as fs from "node:fs";
import { hashLinhas } from "./hashProposta";
import * as path from "node:path";
import { buscar, carregar, CACHE, SCRATCH, type DadosCarregados } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { slotsDa } from "./estado";
import { maquinaDisponivelNoSlot } from "@/features/escala/disponibilidade";
import { avaliarPlano, planejarComFluxo, verificarRestricoesDuras, type OpcoesFluxo } from "@/features/escala/fluxo";
import { montarEstado } from "@/features/escala/fluxo/estado";
import { analisarCapacidade } from "@/features/escala/fluxo/capacidade";
import { calcularChurn } from "@/features/escala/fluxo/planejar";
import { contagensDoPlano, varrerContagensPreservando } from "@/features/escala/fluxo/otimizar";
import { lucroHoraDaTela } from "@/features/escala/fluxo/economiaProduto";
import { aplicarProdutividade } from "@/features/escala/fluxo/produtividade";
import { fatoresParaMotor } from "@/features/escala/produtividade";
import { janelaDaAusencia, fimDaJornadaMin } from "@/lib/escala/ausenciaAberta";
import { verificarIndependente } from "../escala-fluxo-replay/independente";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import type { AlocacaoEscala } from "@/features/escala/types";

process.env.FREPLAY_ESCOPO = "bloco"; // verificador independente: revezamento por bloco
const T0 = Date.now();
const marca = (m: string) => console.error(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);

// ------------------------------------------------------------------------------------------------ argumentos
const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf("--" + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; };
const args = (k: string) => argv.flatMap((a, i) => (a === "--" + k && argv[i + 1] ? [argv[i + 1]] : []));
const agoraMs = Date.parse(arg("agora") ?? new Date().toISOString());
const spData = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);
const hoje = arg("data") ?? spData(agoraMs);
const periodoIni = arg("periodo-inicial") ?? "t1";
const tolPct = Number(arg("tolerancia-pct") ?? 0.1);
const semEstimador = argv.includes("--sem-estimador");
const segunda = (iso: string) => { const dt = new Date(iso + "T12:00:00Z"); const dow = (dt.getUTCDay() + 6) % 7; return new Date(dt.getTime() - dow * 86400000).toISOString().slice(0, 10); };
const semana = arg("semana") ?? segunda(hoje);
const somaDias = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const brl = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (n: number) => Math.round(n).toLocaleString("pt-BR");
const hhmm = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(11, 16);

// ------------------------------------------------------------------------------------------------ estado real (SELECT)
marca("lendo estado de PROD (SELECT)");
const bruto = buscar({
  semana, antesIso: new Date(agoraMs).toISOString(), depoisIso: "2999-01-01T00:00:00Z", usarCache: argv.includes("--cache"),
  somente: ["q_dec", "q_apont", "q_aloc", "q_fluxo", "q_nomes", "q_par", "q_live_ausencias", "q_live_paradas", "q_live_equipe", "q_live_maquinas"],
});
const d0 = carregar(bruto);
marca("estado lido");
const nome = (id: string | null | undefined) => (id ? (d0.nomes[id] ?? id.slice(0, 8)).trim().replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Autom.").replace('Conector 3/4"', "Conector 3/4 Conv.") : "—");

// snapshot da decisão + atualizações AO VIVO (equipe, ausências, paradas, máquinas): o snapshot pode estar defasado
const snap = d0.decisao.entrada;
const periodosDia = snap.dias[0]?.periodos ?? [];
const fimJornada = fimDaJornadaMin(periodosDia as any);
const ausencias = bruto.q_live_ausencias.map((a: any) => ({ funcionarioId: a.funcionario_id, data: a.data, ...janelaDaAusencia({ horarioInicio: a.hi, horarioFim: a.hf, emAberto: !!a.em_aberto } as any, fimJornada) }));
const indisponibilidades = bruto.q_live_paradas.map((p: any) => ({ maquinaId: p.maquina_id, desdeMs: Math.round(Number(p.desde_ms)), liberadaEmMs: p.liberada_ms === null ? null : Math.round(Number(p.liberada_ms)) }));
const equipeAtiva = bruto.q_live_equipe.filter((e: any) => e.ativo).map((e: any) => e.id);
const maquinasInativas = bruto.q_live_maquinas.filter((m: any) => m.tipo === "inativa").map((m: any) => m.maquina_id);
const maquinasIndispPrev = bruto.q_live_maquinas.filter((m: any) => m.tipo === "indisponivel_previsao").map((m: any) => m.maquina_id);

// contagens físicas: as de escala_parametros + as novas (a mais recente por par vale)
const slots = slotsDa(d0);
const poolsSnap = snap.pools as any[];
if (argv.includes("--listar-pares")) {
  const prods = [...new Set(poolsSnap.map((p) => p.produtoId as string))];
  console.log("Pares de estoque intermediário (use em --contagem \"<Produto>:<OpOrigem>><OpSeguinte>=<saldo>@HH:MM\"):");
  prods.forEach((pid) => { const e = poolsSnap.filter((p) => p.produtoId === pid).sort((a, b) => a.ordemEtapa - b.ordemEtapa); for (let i = 0; i + 1 < e.length; i++) console.log(`  ${nome(pid)}:${nome(e[i].operacaoId)}>${nome(e[i + 1].operacaoId)}`); });
  process.exit(0);
}
function resolver(spec: string): ContagemFisicaPar {
  const m = /^([^:]+):([^>]+)>([^=]+)=([\d.,]+)(?:@(?:(\d{1,2})\/(\d{1,2}) )?(\d{1,2}):(\d{2}))?$/.exec(spec.trim());
  if (!m) throw new Error(`--contagem inválida: "${spec}" (use "Produto:OpOrigem>OpSeguinte=saldo[@[dd/mm ]HH:MM]")`);
  const [, tp, to, ts, sal, dd, mo, hh, mm] = m;
  const prods = [...new Set(poolsSnap.map((p) => p.produtoId as string))].filter((id) => nome(id).toLowerCase().includes(tp.trim().toLowerCase())).sort((a, b) => nome(a).length - nome(b).length);
  if (prods.length === 0) throw new Error(`produto não encontrado: ${tp}`);
  const produtoId = prods[0];
  const etapas = poolsSnap.filter((p) => p.produtoId === produtoId).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
  const i = etapas.findIndex((p) => nome(p.operacaoId).toLowerCase().includes(to.trim().toLowerCase()));
  if (i < 0 || !etapas[i + 1] || !nome(etapas[i + 1].operacaoId).toLowerCase().includes(ts.trim().toLowerCase())) throw new Error(`par não encontrado/consecutivo em ${nome(produtoId)}: ${to} > ${ts}`);
  const dia = dd ? `${hoje.slice(0, 4)}-${mo.padStart(2, "0")}-${dd.padStart(2, "0")}` : hoje;
  const quando = hh ? Date.parse(`${dia}T${hh.padStart(2, "0")}:${mm}:00-03:00`) : agoraMs;
  return { produtoId, etapaOrigemId: etapas[i].etapaId, etapaSeguinteId: etapas[i + 1].etapaId, saldo: Number(sal.replace(/\./g, "").replace(",", ".")), contadoEmMs: quando, informadoPor: "Mikael (ensaio/pipeline)", observacao: spec };
}
const novas: ContagemFisicaPar[] = [...args("contagem").map(resolver), ...(arg("contagens-json") ? (JSON.parse(fs.readFileSync(arg("contagens-json") as string, "utf8")) as any[]).map((c) => (typeof c === "string" ? resolver(c) : c)) : [])];
const d: DadosCarregados = {
  ...d0,
  cfg: { ...d0.cfg, contagensFisicas: [...d0.cfg.contagensFisicas, ...novas] },
  decisao: { ...d0.decisao, entrada: { ...snap, ausencias: ausencias as any, indisponibilidades: indisponibilidades as any, funcionarios: equipeAtiva.length ? equipeAtiva : snap.funcionarios, maquinasInativas, maquinasIndisponiveisPrevisao: maquinasIndispPrev } },
};

// ------------------------------------------------------------------------------------------------ plano atual e primeiro período
const idxT1 = slots.find((s) => s.data === hoje && s.periodoId === periodoIni)?.indice;
if (idxT1 === undefined) throw new Error(`período ${hoje} ${periodoIni} não existe na semana`);
const periodosProposta = slots.filter((s) => s.indice >= idxT1 && s.data === hoje && s.periodoId.startsWith("t")); // T1..T3 de hoje
const ultimoSlotProposta = periodosProposta[periodosProposta.length - 1].indice;
const planoAtual = d.planoAtual;
const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
const slotDe = (a: { data: string; periodoId: string }) => idx.get(`${a.data}|${a.periodoId}`) ?? -1;
const fut = (l: AlocacaoEscala[]) => l.filter((a) => slotDe(a) >= idxT1);
const m3 = slots.find((s) => s.data === hoje && s.periodoId === "m3");
const m3Fechado = m3 ? m3.fimMs + 10 * 60_000 <= agoraMs : false;

const OPC: Partial<OpcoesFluxo> = { objetivo: "lucro_hora", atingibilidadeModo: "ativo", atingibilidadeK: 2, diversificarCandidatos: true, economiaSlots: 99 };
const MEDIR: Partial<OpcoesFluxo> = { objetivo: "lucro_hora", atingibilidadeModo: "sombra", economiaSlots: 99 };
const ST = (extra: Partial<OpcoesFluxo>) => montarEstadoAting(d, agoraMs, planoAtual, 100 + idxT1, extra, true);
const estM = ST(MEDIR);
const estRec = ST({ objetivo: "financeiro", atingibilidadeModo: "sombra", economiaSlots: 99 });
marca("estado reconstruído; planejando (oficial)");

const rA = planejarComFluxo(ST(OPC).entrada, ST(OPC).dados, ST(OPC).opcoes);
marca("plano oficial pronto");
let rB: ReturnType<typeof planejarComFluxo> | null = null;
if (!semEstimador) {
  const e0 = ST({});
  const periodos = [...new Set(e0.entrada.slots.map((x) => x.periodoId))];
  const fm = fatoresParaMotor(d.apontamentos.filter((a) => a.lancadoEmMs <= agoraMs) as never, e0.entrada.pools.map((p) => ({ produtoId: p.produtoId, etapaId: p.etapaId, operacaoId: p.operacaoId, maquinasIds: p.maquinasIds })), periodos, agoraMs);
  const fAtual = e0.opcoes.fatoresEmbutidos ?? {};
  const prov = (a: { produtoId: string; etapaId: string; periodoId: string; metaNominal: number }) => { const k = `${a.produtoId}|${a.etapaId}`; return { pecasPorPeriodo: a.metaNominal / (fAtual[k] ?? 1), fator: fm.porPoolPeriodo[k]?.[a.periodoId] ?? 1, fonte: "estimador (NÃO ativo; só comparação)", amostra: 0 }; };
  const eB = ST({ ...OPC, produtividade: prov });
  rB = planejarComFluxo(eB.entrada, eB.dados, eB.opcoes);
  marca("variante estimador pronta");
}

// ------------------------------------------------------------------------------------------------ avaliação comum (capacidade OFICIAL atual)
const completo = (futuras: AlocacaoEscala[]) => [...estM.entrada.congeladas, ...futuras];
const avaliar = (futuras: AlocacaoEscala[]) => {
  const L = avaliarPlano(estM.entrada, estM.dados, completo(futuras), estM.opcoes);
  const R = avaliarPlano(estRec.entrada, estRec.dados, completo(futuras), estRec.opcoes);
  return { L, R, lucro: L.financeiro!.total.rsProjetadoFechamento, receita: R.financeiro!.total.rsProjetadoFechamento };
};
const atualFut = fut(planoAtual);
const avAtual = avaliar(atualFut);
const capDe = (futuras: AlocacaoEscala[]) => {
  const cnt = contagensDoPlano(estM.ctx, futuras);
  const mins = varrerContagensPreservando(estM.ctx, cnt, {}, true).minimos;
  return analisarCapacidade(estM.ctx, completo(futuras), mins);
};

// ---- ajuste fino pessoa a pessoa (busca local sobre o plano do motor): move UMA pessoa de um posto de valor marginal baixo para um posto livre de valor marginal maior no mesmo período,
// só se o plano seguir com 0 violações duras (bloco, ausência, parada, máquina da Previsão) e sem perder meta atingível; aceita ganho de lucro ≥ R$ 1,00.
interface Mov { slot: number; funcionarioId: string; de: string; para: string; ganho: number }
function polir(inicial: AlocacaoEscala[]): { plano: AlocacaoEscala[]; movs: Mov[]; rejeitadas: number } {
  let plano = inicial.map((a) => ({ ...a }));
  const movs: Mov[] = [];
  let rejeitadas = 0;
  let atual = avaliar(plano);
  for (let r = 0; r < 8; r++) {
    const cap = capDe(plano);
    const alvos = cap.capacidade.filter((c) => c.slot <= ultimoSlotProposta && c.valorMarginalAdicionar > 1 && c.postosDisponiveis > 0);
    let melhor: { novo: AlocacaoEscala[]; mov: Mov; av: ReturnType<typeof avaliar> } | null = null;
    for (const c of alvos) {
      const no = estM.ctx.grafo.nos[c.no];
      const pool = estM.entrada.pools.find((q) => `${q.produtoId}|${q.etapaId}` === no.id);
      if (!pool) continue;
      const slot = estM.entrada.slots[c.slot];
      const usadas = new Set(plano.filter((a) => slotDe(a) === c.slot && a.maquinaId).map((a) => a.maquinaId));
      const livres = pool.maquinasIds.filter((m) => !usadas.has(m) && maquinaDisponivelNoSlot(estM.entrada, m, slot));
      if (livres.length === 0) continue;
      for (const a of plano.filter((x) => slotDe(x) === c.slot)) {
        const noA = a.maquinaId ? estM.ctx.grafo.noDoPool[`${a.produtoId}|${a.etapaId}`] : null;
        if (noA === c.no) continue;
        const vUlt = noA ? cap.capacidade.find((x) => x.slot === c.slot && x.no === noA)?.valorMarginalUltimo ?? 0 : 0;
        if (vUlt >= c.valorMarginalAdicionar - 0.5) continue;
        const nova: AlocacaoEscala = { ...a, maquinaId: livres[0], produtoId: pool.produtoId, etapaId: pool.etapaId, operacaoId: pool.operacaoId, pecas: pool.metas[slot.periodoId] ?? 0, motivoSemPosto: null };
        const novo = plano.map((x) => (x === a ? nova : x));
        if (verificarRestricoesDuras(estM.entrada, novo).length > 0) { rejeitadas++; continue; }
        const av = avaliar(novo);
        if (av.L.atingibilidade!.atingiveisPerdidas > atual.L.atingibilidade!.atingiveisPerdidas) continue;
        const ganho = av.lucro - atual.lucro;
        if (ganho > 1 && (melhor === null || ganho > melhor.mov.ganho)) melhor = { novo, av, mov: { slot: c.slot, funcionarioId: a.funcionarioId, de: noA ? nomeNoPre(noA) : "sem posto", para: nomeNoPre(c.no), ganho } };
      }
    }
    if (melhor === null) break;
    plano = melhor.novo;
    atual = melhor.av;
    movs.push(melhor.mov);
  }
  return { plano, movs, rejeitadas };
}
const nomeNoPre = (k: string) => { const [p, e] = k.split("|"); const pool = poolsSnap.find((x) => x.produtoId === p && x.etapaId === e); return `${nome(p)} · ${pool ? nome(pool.operacaoId) : e.slice(0, 6)}`; };
const propBase = fut(rA.resultado.alocacoes);
const pol = polir(propBase);
const propOficial = pol.plano;
marca(`ajuste fino: ${pol.movs.length} movimento(s), ${pol.rejeitadas} rejeitado(s) por restrição dura`);
const avProp = avaliar(propOficial);
const tol = (tolPct / 100) * Math.max(1, avAtual.lucro);
const violAtual = verificarRestricoesDuras(estM.entrada, atualFut).length;
const ganhoLucro = avProp.lucro - avAtual.lucro;
const manter = ganhoLucro < tol && violAtual === 0; // estabilidade: planos economicamente muito próximos ⇒ o atual (mais estável)
const escolhida = manter ? atualFut : propOficial;
const avEsc = manter ? avAtual : avProp;
const rotuloEsc = manter ? "MANTER O PLANO ATUAL (a proposta recalculada difere em menos de " + tolPct + "% do lucro projetado: o mais estável e simples)" : "PROPOSTA RECALCULADA";
const marc = capDe;
const capEsc = marc(escolhida);
const capAtual = marc(atualFut);
const estado = montarEstado(estM.ctx);

// validação independente
const selecionadas = (futuras: AlocacaoEscala[]) => futuras.filter((a) => a.maquinaId && !(estM.entrada.pools.find((p) => p.produtoId === a.produtoId && p.etapaId === a.etapaId)?.maquinasIds ?? []).includes(a.maquinaId as string));
const validar = (futuras: AlocacaoEscala[]) => {
  const nucleo = verificarRestricoesDuras(estM.entrada, futuras);
  const indep = verificarIndependente(estM.entrada, futuras, { planoVigente: planoAtual }).filter((v) => !v.aviso);
  const porBloco = indep.filter((v) => v.tipo === "mesma_operacao_no_bloco").length;
  return { nucleo: nucleo.length, nucleoTipos: [...new Set(nucleo.map((v) => v.tipo))], indep: indep.length, indepTipos: [...new Set(indep.map((v) => v.tipo))], bloco: porBloco, foraDaPrevisao: selecionadas(futuras).length };
};
const vEsc = validar(escolhida);
const vAtual = validar(atualFut);
marca("avaliação concluída; escrevendo relatório");

// ------------------------------------------------------------------------------------------------ relatório
const L: string[] = [];
const P = (s = "") => L.push(s);
const nomeNo = (k: string) => { const [p, e] = k.split("|"); const pool = poolsSnap.find((x) => x.produtoId === p && x.etapaId === e); return `${nome(p)} · ${pool ? nome(pool.operacaoId) : e.slice(0, 6)}`; };
const slotRot = (t: number) => `${slots[t].data.slice(5)} ${slots[t].periodoId.toUpperCase()}`;
P(`# Proposta de T1–T3 — ${hoje} (gerada ${new Date(agoraMs - 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ")} SP)`);
P(`**Para APROVAÇÃO. Nada foi gravado em PROD.** Revezamento por bloco: HARD. Equivalências de operação: desligadas. Só máquinas selecionadas na Previsão. Períodos anteriores a T1 congelados. Objetivo: lucro/hora da tela Produtos limitado pelo valor marginal final (valor = margem da tela por peça final × peças que chegam ao final); atingibilidade com limite econômico k=2; WIP/downstream = penalidade secundária; diversificação de candidatos ligada. Tempo de cálculo: ${((Date.now() - T0) / 1000).toFixed(0)} s.`);
P();
P(`**Decisão do pipeline:** ${rotuloEsc}. Lucro projetado (tela) atual R$ ${brl(avAtual.lucro)} → proposto R$ ${brl(avProp.lucro)} (Δ R$ ${brl(ganhoLucro)}); receita R$ ${brl(avAtual.receita)} → R$ ${brl(avProp.receita)}.`);
P();

// A
P(`## A) Estado atual após M3`);
const fl = bruto.q_fluxo as any[];
const ult = fl[0];
P(`- Instante do cálculo: ${hhmm(agoraMs)}; M3 de ${hoje} ${m3Fechado ? "FECHADO (≥ 12:05)" : "**AINDA NÃO FECHADO** — ENSAIO: M2/M3 (e o que faltar) são projetados pela capacidade das linhas congeladas, não por apontamento"}.`);
P(`- Plano atual = \`escala_producao_alocacoes\` lido agora (${planoAtual.length} linhas na semana; ${atualFut.length} de T1 em diante). Último registro do fluxo ativo: ${ult ? `${ult.criado} (${ult.gatilho}, corte ${ult.corte_data} ${String(ult.corte_periodo_id).toUpperCase()}, resultado=${ult.resultado}, aplicado=${ult.aplicado})` : "nenhum"}. ${m3Fechado && ult && !(ult.corte_data === hoje && ult.corte_periodo_id === "m3") ? "**ATENÇÃO: o motor ativo ainda não processou o fechamento de M3; o 'plano atual' pode ser o anterior.**" : ""}`);
P(`- Snapshot de decisão usado só para pools/Previsão: ${d0.decisao.data} ${d0.decisao.periodoId.toUpperCase()} rev ${d0.decisao.revisao} (criado ${String(d0.decisao.criadoEm).slice(0, 19)}). Equipe, ausências, paradas e máquinas foram relidas AO VIVO: ${equipeAtiva.length} pessoas, ${ausencias.length} ausências na semana, ${indisponibilidades.length} registros de parada (${indisponibilidades.filter((p: any) => p.liberadaEmMs === null).length} abertas).`);
P(`- Apontamentos lidos: ${d.apontamentos.length} (último lançado ${hhmm(Math.max(...d.apontamentos.map((a) => a.lancadoEmMs)))}).`);
P(`- Contagens físicas válidas: ${d.cfg.contagensFisicas.length} (${d0.cfg.contagensFisicas.length} em escala_parametros + ${novas.length} informadas agora; vale a mais recente por par).`);
const naoConf = estado.celulas.filter((c) => c.estado === "nao_confirmado");
P(`- Períodos/máquinas FECHADOS sem apontamento (produção em [0, planejado], nunca assumida): ${naoConf.length}${naoConf.length ? " — " + [...new Set(naoConf.map((c) => `${slotRot(c.slot)}`))].slice(0, 12).join(", ") : ""}.`);
P();

// B
P(`## B) Demanda restante por produto`);
P(`| Produto | Meta (pç) | Final realizado (pç) | Restante (pç) | Máximo ainda produzível até sexta (pç) | Meta atingível |`);
P(`|---|---|---|---|---|---|`);
avEsc.L.financeiro!.produtos.forEach((p) => P(`| ${nome(p.produtoId)} | ${n0(p.meta)} | ${n0(p.realizadoFinal)} | ${n0(p.restante)} | ${n0(p.maximoProduzivel)} | ${p.metaAtingivel ? "SIM" : "NÃO (falta inevitável " + n0(p.faltaInevitavel) + " pç)"} |`));
P(`_Realizado = boas finais confirmadas + produção projetada dos períodos entre o último fechado e T1. Atingível = máximo com todas as máquinas selecionadas em todos os períodos restantes (pessoas não limitam)._`);
P();

// C
P(`## C) WIP físico (contagem) e projetado`);
P(`| Par (origem → seguinte) | Origem do saldo | WIP agora [lo–hi] | Confiança | Projetado no início de T1 [lo–hi] |`);
P(`|---|---|---|---|---|`);
estado.pares.forEach((p: any) => {
  const proj = estado.projecao.wip[`${p.produtoId}|${p.etapaOrigemId}`];
  P(`| ${nomeNo(`${p.produtoId}|${p.etapaOrigemId}`)} → ${nome(poolsSnap.find((x) => x.produtoId === p.produtoId && x.etapaId === p.etapaSeguinteId)?.operacaoId)} | ${p.origem === "confirmado" ? "contagem física" : "estimado pelos apontamentos"} | ${n0(p.wip.lo)}–${n0(p.wip.hi)} | ${p.confianca} | ${proj ? `${n0(proj.lo)}–${n0(proj.hi)}` : "—"} |`);
});
const usadas = estM.ctx.diagnosticos.filter((x) => x.codigo === "CONTAGEM_FISICA_USADA" || x.codigo === "CONTAGEM_FISICA_IGNORADA");
if (usadas.length) { P(); usadas.forEach((x) => P(`- ${x.codigo}: ${x.mensagem}`)); }
P();

// D
P(`## D) Gargalos`);
P(`| Produto | Gargalo de fluxo (menor potencial) | Potencial (pç) | Folga vs. restante |`);
P(`|---|---|---|---|`);
avEsc.L.produtos.forEach((p) => P(`| ${nome(p.produtoId)} | ${p.gargaloFluxo ? nomeNo(`${p.gargaloFluxo.produtoId}|${p.gargaloFluxo.etapaId}`) : "—"} | ${p.gargaloFluxo ? n0(p.gargaloFluxo.potencial) : "—"} | ${p.gargaloFluxo ? n0(p.gargaloFluxo.folga) : "—"} |`));
const diagT1 = capEsc.capacidade.filter((c) => c.slot === idxT1 && c.diagnostico !== "OK");
P();
P(`Diagnósticos de posto em T1 (plano escolhido): ${diagT1.map((c) => `${nomeNo(c.no)}: ${c.diagnostico}`).join("; ") || "nenhum"}.`);
P();

// E
P(`## E) Capacidade por produto até sexta (etapa final) e por etapa em T1–T3`);
P(`| Produto | Máquinas selecionadas / disponíveis agora | Postos simultâneos (T1–T3 plano) | Capacidade/período (T1, pç) | Σ capacidade de máquinas restante (pç) | Σ CAP_ETAPA restante (pç) | Pessoas elegíveis (T1) | Downstream |`);
P(`|---|---|---|---|---|---|---|---|`);
avEsc.L.financeiro!.produtos.forEach((p) => {
  const rows = capEsc.capacidade.filter((c) => c.produtoId === p.produtoId && c.etapaId === p.etapaFinalId);
  if (rows.length === 0) { P(`| ${nome(p.produtoId)} | (nó fundido — ver Conector convencional) | | | | | | |`); return; }
  const r1 = rows.find((c) => c.slot === idxT1) ?? rows[0];
  const sel = estM.entrada.pools.find((q) => q.produtoId === p.produtoId && q.etapaId === p.etapaFinalId)?.maquinasIds.length ?? 0;
  const simult = rows.filter((c) => c.slot <= ultimoSlotProposta).map((c) => c.postosOcupados).join("/");
  P(`| ${nome(p.produtoId)} | ${sel} / ${r1.postosMaximos} | ${simult} | ${n0(r1.capEtapa)} | ${n0(rows.reduce((s, c) => s + c.capMaquinas, 0))} | ${n0(rows.reduce((s, c) => s + c.capEtapa, 0))} | ${r1.pessoasElegiveis} | ${r1.diagnostico} |`);
});
P();
P(`Por etapa (plano escolhido), T1:`);
P(`| Etapa | Postos máx | Ocupados | Livres | Mín. p/ atingibilidade | Prod. nominal | Prod. esperada | CAP_ETAPA (pç) | Valor marginal de +1 pessoa (R$) | Diagnóstico |`);
P(`|---|---|---|---|---|---|---|---|---|---|`);
capEsc.capacidade.filter((c) => c.slot === idxT1).forEach((c) => P(`| ${nomeNo(c.no)} | ${c.postosMaximos} | ${c.postosOcupados} | ${c.postosDisponiveis} | ${c.postosMinimos} | ${n0(c.produtividadeNominal)} | ${n0(c.produtividadeEsperada)} | ${n0(c.capEtapa)} | ${brl(c.valorMarginalAdicionar)} | ${c.diagnostico} |`));
P();

// F
P(`## F) Resultado econômico por hora e valor marginal final por posto`);
const provNom = lucroHoraDaTela(aplicarProdutividade(estM.entrada, { ...estM.opcoes, produtividadeBase: "nominal" }, 0).entrada);
const provReal = lucroHoraDaTela(estM.entrada);
P(`| Produto | Valor (R$/pç) | Custo da tela (R$/pç) | Margem (R$/pç) | Lucro/h tela nominal | Lucro/h tela real | Receita/h-operador real |`);
P(`|---|---|---|---|---|---|---|`);
[...new Set(estM.entrada.pools.map((p) => p.produtoId))].forEach((pid) => { const a = provNom(pid, ""), b = provReal(pid, ""); if (a && b) P(`| ${nome(pid)} | ${a.preco} | ${a.custoUnitario.toFixed(4)} | ${a.margemUnitaria.toFixed(4)} | ${a.lucroHora.toFixed(2)} | ${b.lucroHora.toFixed(2)} | ${b.receitaHora.toFixed(2)} |`); });
P(`_Lucro/h da tela = (valor − Σ tempo/peça × R$31,92) ÷ Σ tempo/peça: CONVENÇÃO da tela Produtos (folha + fixos rateados). A decisão NÃO usa ranking de lucro/h: usa o valor marginal final (abaixo)._`);
P();
P(`Valor marginal final por posto do plano escolhido (R$ de lucro da tela que o último posto ocupado gera até sexta; "+1" = mais uma pessoa):`);
P(`| Período | Etapa | Ocupados/Máx | Último posto (R$) | +1 pessoa (R$) | Diagnóstico |`);
P(`|---|---|---|---|---|---|`);
capEsc.capacidade.filter((c) => c.slot <= ultimoSlotProposta && c.slot >= idxT1 && (c.valorMarginalUltimo > 0 || c.valorMarginalAdicionar > 0 || c.diagnostico !== "OK")).forEach((c) => P(`| ${slotRot(c.slot)} | ${nomeNo(c.no)} | ${c.postosOcupados}/${c.postosMaximos} | ${brl(c.valorMarginalUltimo)} | ${brl(c.valorMarginalAdicionar)} | ${c.diagnostico} |`));
P();

// G + H
const func = [...new Set(escolhida.map((a) => a.funcionarioId))].sort((a, b) => nome(a).localeCompare(nome(b)));
const celula = (f: string, t: number) => { const a = escolhida.find((x) => x.funcionarioId === f && slotDe(x) === t); if (!a) return "—"; if (!a.maquinaId) return `sem posto (${a.motivoSemPosto ?? "?"})`; return `${nome(a.operacaoId)} · ${nome(a.maquinaId)} · ${nome(a.produtoId)}`; };
const ausH = (f: string, t: number) => ausencias.some((a: any) => a.funcionarioId === f && a.data === slots[t].data && (a.inicioMin === null || a.fimMin === null || (a.inicioMin < slots[t].fimMin && a.fimMin > slots[t].inicioMin)));
P(`## G) PROPOSTA COMPLETA de T1, T2 e T3 por funcionário (${manter ? "= plano atual" : "recalculada"})`);
P(`| Funcionário | ${periodosProposta.map((s) => s.periodoId.toUpperCase() + " " + `${String(Math.floor(s.inicioMin / 60)).padStart(2, "0")}:${String(s.inicioMin % 60).padStart(2, "0")}`).join(" | ")} |`);
P(`|---|${periodosProposta.map(() => "---").join("|")}|`);
func.forEach((f) => P(`| ${nome(f)} | ${periodosProposta.map((s) => (ausH(f, s.indice) ? "AUSENTE" : celula(f, s.indice))).join(" | ")} |`));
P();
P(`## H) Operação, máquina e produto de cada linha`);
P(`| Período | Funcionário | Operação | Máquina | Produto | Etapa | Peças (capacidade) | Origem | Mudou vs. plano atual |`);
P(`|---|---|---|---|---|---|---|---|---|`);
const atualPorChave = new Map(atualFut.map((a) => [`${slotDe(a)}|${a.funcionarioId}`, a]));
const posto = (a?: AlocacaoEscala) => (a ? `${a.maquinaId ?? ""}|${a.produtoId ?? ""}|${a.etapaId ?? ""}` : "");
escolhida.filter((a) => slotDe(a) <= ultimoSlotProposta).sort((a, b) => slotDe(a) - slotDe(b) || nome(a.funcionarioId).localeCompare(nome(b.funcionarioId))).forEach((a) => {
  const antes = atualPorChave.get(`${slotDe(a)}|${a.funcionarioId}`);
  P(`| ${slotRot(slotDe(a))} | ${nome(a.funcionarioId)} | ${nome(a.operacaoId)} | ${nome(a.maquinaId)} | ${nome(a.produtoId)} | ${a.etapaId ? nomeNo(`${a.produtoId}|${a.etapaId}`).split(" · ")[1] ?? "" : ""} | ${n0(a.pecas ?? 0)} | ${a.origem ?? "auto"} | ${posto(antes) === posto(a) ? "não" : "sim (antes: " + (antes?.maquinaId ? `${nome(antes.operacaoId)} · ${nome(antes.maquinaId)}` : "sem posto") + ")"} |`);
});
P();

// I
P(`## I) Justificativa das principais realocações`);
const changes = escolhida.filter((a) => slotDe(a) <= ultimoSlotProposta).flatMap((a) => { const antes = atualPorChave.get(`${slotDe(a)}|${a.funcionarioId}`); return posto(antes) === posto(a) ? [] : [{ a, antes }]; });
const vUlt = (cap: typeof capEsc, t: number, produtoId: string | null, etapaId: string | null) => { const r = cap.capacidade.find((c) => c.slot === t && c.produtoId === produtoId && c.etapaId === etapaId); return r ? r.valorMarginalUltimo : 0; };
const vAdd = (cap: typeof capEsc, t: number, produtoId: string | null, etapaId: string | null) => { const r = cap.capacidade.find((c) => c.slot === t && c.produtoId === produtoId && c.etapaId === etapaId); return r ? r.valorMarginalAdicionar : 0; };
P(`- Motor (candidatos): plano escolhido pelo núcleo = **${rA.diagnostico.planoEscolhido}** (${rA.diagnostico.planoEscolhido === "vigente" ? "nenhum candidato foi estritamente melhor que o plano atual no modelo" : "candidato de fluxo"}); ajuste fino pessoa a pessoa: **${pol.movs.length} movimento(s)** aceito(s), ${pol.rejeitadas} tentativa(s) rejeitada(s) por restrição dura.`);
pol.movs.forEach((m) => P(`  - ${slotRot(m.slot)}: ${nome(m.funcionarioId)}: ${m.de} → ${m.para} (+R$ ${brl(m.ganho)} de lucro projetado)`));
if (manter) P(`Plano atual mantido (ganho total < ${tolPct}% = R$ ${brl(tol)}): nenhuma realocação proposta.`);
const jus = (manter ? fut(rA.resultado.alocacoes).flatMap((a) => { const antes = atualPorChave.get(`${slotDe(a)}|${a.funcionarioId}`); return slotDe(a) <= ultimoSlotProposta && posto(antes) !== posto(a) ? [{ a, antes }] : []; }) : changes)
  .map(({ a, antes }) => {
    const t = slotDe(a);
    const ganhoB = a.maquinaId ? vUlt(manter ? capEsc : capEsc, t, a.produtoId, a.etapaId) : 0;
    const perdaA = antes?.maquinaId ? vUlt(capAtual, t, antes.produtoId, antes.etapaId) : 0;
    return { t, f: a.funcionarioId, de: antes?.maquinaId ? nomeNo(`${antes.produtoId}|${antes.etapaId}`) : "sem posto", para: a.maquinaId ? nomeNo(`${a.produtoId}|${a.etapaId}`) : "sem posto", ganhoB, perdaA, liquido: ganhoB - perdaA, alt: a.maquinaId ? vAdd(capAtual, t, a.produtoId, a.etapaId) : 0 };
  });
const agrup = new Map<string, { n: number; t: Set<number>; ganhoB: number; perdaA: number; liquido: number }>();
jus.forEach((j) => { const k = `${j.de} → ${j.para}`; const g = agrup.get(k) ?? { n: 0, t: new Set<number>(), ganhoB: 0, perdaA: 0, liquido: 0 }; g.n++; g.t.add(j.t); g.ganhoB += j.ganhoB; g.perdaA += j.perdaA; g.liquido += j.liquido; agrup.set(k, g); });
P(`Valores = lucro da tela (R$) que o último posto gera até sexta no plano em que ele existe: ganho em B (destino, plano proposto) − resultado perdido em A (origem, plano atual) = ganho líquido; o plano inteiro é re-simulado (D da lista ⇒ J/N trazem o efeito total).`);
P(`| Realocação (pessoas × períodos) | Períodos | Ganho em B (R$) | Perda em A (R$) | Ganho líquido (R$) |`);
P(`|---|---|---|---|---|`);
[...agrup.entries()].sort((x, y) => Math.abs(y[1].liquido) - Math.abs(x[1].liquido)).slice(0, 12).forEach(([k, g]) => P(`| ${k} (${g.n}) | ${[...g.t].sort().map(slotRot).join(", ")} | ${brl(g.ganhoB)} | ${brl(g.perdaA)} | ${brl(g.liquido)} |`));
const lim = rA.diagnostico.economia?.limiteEconomico;
P();
P(`- **Atingibilidade × custo (k=2):** ${lim && lim.candidatos.length ? lim.candidatos.map((c) => `candidato ${c.indice}: custo R$ ${brl(c.custoRs)} × valor recuperado R$ ${brl(c.valorRecuperadoRs)} (razão ${c.razao === null ? "∞" : c.razao.toFixed(1)}) ⇒ ${c.justificado ? "PRESERVADA" : "não preservada"}`).join("; ") : "nenhum conflito entre preservar uma meta atingível e o resultado econômico"}.`);
P(`- **Estabilidade:** churn do plano escolhido vs. atual = ${calcularChurn(estM.ctx, escolhida).linhasAlteradas} linha(s); regra: se o ganho de lucro < ${tolPct}% (R$ ${brl(tol)}), mantém-se o plano atual.`);
rA.diagnostico.diagnosticos.filter((x) => ["PRODUTO_SACRIFICADO", "MARGEM_INDISPONIVEL"].includes(x.codigo)).forEach((x) => P(`- ${x.codigo}: ${x.mensagem}`));
P();

// J K L
P(`## J) R$ final projetado da semana`);
P(`| | Plano atual | ${manter ? "Escolhido (= atual)" : "Proposta"} | Δ |`);
P(`|---|---|---|---|`);
P(`| Lucro projetado (tela) R$ | ${brl(avAtual.lucro)} | ${brl(avEsc.lucro)} | ${brl(avEsc.lucro - avAtual.lucro)} |`);
P(`| Receita projetada R$ | ${brl(avAtual.receita)} | ${brl(avEsc.receita)} | ${brl(avEsc.receita - avAtual.receita)} |`);
P(`| Peças finais | ${n0(avAtual.L.totais.finalEntregueLo)} | ${n0(avEsc.L.totais.finalEntregueLo)} | ${n0(avEsc.L.totais.finalEntregueLo - avAtual.L.totais.finalEntregueLo)} |`);
P();
P(`## K) Produtos que ficam abaixo da meta   &   L) quanto em peças e em R$`);
P(`| Produto | Meta | Projetado | Falta (pç) | Falta (R$ receita) | Falta (R$ lucro tela) | Inevitável (pç) | Evitável (pç) | Recurso limitante |`);
P(`|---|---|---|---|---|---|---|---|---|`);
const finL = avEsc.L.financeiro!.produtos, finR = avEsc.R.financeiro!.produtos;
finL.forEach((p, i) => {
  if (p.faltaProjetada < 0.5) return;
  const evit = Math.max(0, Math.min(p.meta, p.maximoProduzivel) - p.finalProjetado);
  const garg = avEsc.L.produtos.find((q) => q.produtoId === p.produtoId)?.gargaloFluxo;
  P(`| ${nome(p.produtoId)} | ${n0(p.meta)} | ${n0(p.finalProjetado)} | ${n0(p.faltaProjetada)} | ${brl(finR[i].rsFaltaProjetada)} | ${brl(p.rsFaltaProjetada)} | ${n0(p.faltaInevitavel)} | ${n0(evit)} | ${garg ? nomeNo(`${garg.produtoId}|${garg.etapaId}`) : "—"} |`);
});
P();

// M
P(`## M) WIP previsto no fim de T1, T2 e T3`);
P(`| Par | ${periodosProposta.map((s) => "fim " + s.periodoId.toUpperCase()).join(" | ")} |`);
P(`|---|${periodosProposta.map(() => "---").join("|")}|`);
avEsc.L.trajetoria.forEach((tr) => P(`| ${nomeNo(tr.chave)} | ${periodosProposta.map((s) => { const x = tr.porSlot.find((y) => y.slot === s.indice); return x ? `${n0(x.lo)}–${n0(x.hi)}` : "—"; }).join(" | ")} |`));
P();

// N
P(`## N) Comparação com o PLANO ATUAL`);
const linhasAlt = changes.length;
const trocas = escolhida.filter((a) => slotDe(a) <= ultimoSlotProposta).filter((a) => { const antes = atualPorChave.get(`${slotDe(a)}|${a.funcionarioId}`); return antes?.maquinaId && a.maquinaId && posto(antes) !== posto(a); }).length;
P(`| | Plano atual | Escolhido |`);
P(`|---|---|---|`);
P(`| Linhas pessoa/posto alteradas (T1–T3) | — | ${linhasAlt} (${trocas} trocas de posto) |`);
P(`| Lucro projetado (tela) R$ | ${brl(avAtual.lucro)} | ${brl(avEsc.lucro)} |`);
P(`| Receita projetada R$ | ${brl(avAtual.receita)} | ${brl(avEsc.receita)} |`);
P(`| Metas atingíveis NÃO entregues | ${avAtual.L.atingibilidade!.atingiveisPerdidas} | ${avEsc.L.atingibilidade!.atingiveisPerdidas} |`);
P(`| WIP final da semana (pç) | ${n0(avAtual.L.totais.wipFinalLo)} | ${n0(avEsc.L.totais.wipFinalLo)} |`);
P(`| Violações duras (núcleo) | ${vAtual.nucleo} ${vAtual.nucleoTipos.join(",")} | ${vEsc.nucleo} |`);
P(`| Violações (verificador independente, incl. repetição de operação no bloco) | ${vAtual.indep} ${vAtual.indepTipos.join(",")} | ${vEsc.indep} |`);
P(`| Repetições de operação por bloco | ${vAtual.bloco} | ${vEsc.bloco} |`);
P(`| Linhas fora das máquinas selecionadas na Previsão | ${vAtual.foraDaPrevisao} | ${vEsc.foraDaPrevisao} |`);
P(`| Churn (linhas alteradas vs. plano atual) | — | ${calcularChurn(estM.ctx, escolhida).linhasAlteradas} |`);
P();
P(`**Validação independente do plano ${manter ? "escolhido (= atual)" : "proposto"}: ${vEsc.nucleo + vEsc.indep + vEsc.foraDaPrevisao === 0 ? "0 violações (núcleo, verificador independente, bloco e máquinas selecionadas)" : "ATENÇÃO — há violações: NÃO aprovar sem revisão"}.**`);
P();

// Estimador
P(`## Variante com o ESTIMADOR de produtividade (informativa — NÃO ativo)`);
if (rB) {
  const fb = fut(rB.resultado.alocacoes);
  const difLinhas = fb.filter((a) => slotDe(a) <= ultimoSlotProposta).filter((a) => posto(propOficial.find((x) => slotDe(x) === slotDe(a) && x.funcionarioId === a.funcionarioId)) !== posto(a)).length;
  const avB = avaliar(fb);
  const material = difLinhas >= 4 || Math.abs(avB.lucro - avProp.lucro) > 0.002 * avProp.lucro;
  P(`Capacidade oficial (baseline) × estimador de produtividade (peso exponencial, shrinkage ao pool, ajuste do último período do dia): **${difLinhas} linha(s) de T1–T3 diferem** entre os dois planos; lucro projetado (medido na capacidade oficial) R$ ${brl(avProp.lucro)} (oficial) × R$ ${brl(avB.lucro)} (estimador). ${material ? "**Alguma decisão MUDA materialmente** — ver abaixo." : "Nenhuma decisão muda materialmente."}`);
  if (difLinhas > 0) {
    P(`| Período | Funcionário | Oficial | Estimador |`);
    P(`|---|---|---|---|`);
    fb.filter((a) => slotDe(a) <= ultimoSlotProposta).forEach((a) => { const o = propOficial.find((x) => slotDe(x) === slotDe(a) && x.funcionarioId === a.funcionarioId); if (posto(o) !== posto(a)) P(`| ${slotRot(slotDe(a))} | ${nome(a.funcionarioId)} | ${o?.maquinaId ? nome(o.operacaoId) + " · " + nome(o.maquinaId) : "sem posto"} | ${a.maquinaId ? nome(a.operacaoId) + " · " + nome(a.maquinaId) : "sem posto"} |`); });
  }
} else P(`(desligada com --sem-estimador)`);
P();
P(`---\n_Gerado por scripts/escala-fluxo-atingibilidade/proposta-tarde.ts. Contagens informadas agora: ${novas.length ? novas.map((c) => `${nomeNo(`${c.produtoId}|${c.etapaOrigemId}`)} → ${c.saldo} às ${hhmm(c.contadoEmMs)}`).join("; ") : "nenhuma"}. Aderência ao plano desde 28/10 à tarde não é confiável: os dados usados são de ESTADO (válidos); a qualidade das decisões do motor NÃO é inferida da execução._`);

const txt = L.join("\n");
const saida = arg("saida") ?? path.join(SCRATCH, "ating", `proposta-${hoje}-${hhmm(agoraMs).replace(":", "")}.md`);
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, txt);
// JSON da proposta (entrada do aplicar-proposta.ts): T1–T3 de hoje, todas as pessoas; `mudou` = difere do plano atual. Hash do plano atual (T1–T3) para a trava de desatualização.
const hojeProposta = (l: AlocacaoEscala[]) => l.filter((a) => a.data === hoje && slotDe(a) >= idxT1 && slotDe(a) <= ultimoSlotProposta);
const jsonSaida = saida.replace(/\.md$/, "") + ".json";
fs.writeFileSync(jsonSaida, JSON.stringify({
  geradoEmMs: agoraMs, semana, data: hoje, previsaoId: (d0.decisao as any).previsaoId ?? (bruto.q_dec[0] as any).previsao_id, periodoInicial: periodoIni, decisao: rotuloEsc, manterPlanoAtual: manter,
  hashPlanoAtualT1T3: hashLinhas(hojeProposta(atualFut)),
  linhas: hojeProposta(escolhida).map((a) => ({ ...a, mudou: posto(atualPorChave.get(`${slotDe(a)}|${a.funcionarioId}`)) !== posto(a) })),
  linhasAtuais: hojeProposta(atualFut),
}, null, 1));
console.log(`\nARQUIVO: ${saida}\nJSON (para aplicar-proposta.ts): ${jsonSaida}\n(cache de dados: ${CACHE})\n`);
console.log(`RESUMO — ${rotuloEsc}`);
console.log(`Lucro projetado (tela): R$ ${brl(avAtual.lucro)} → R$ ${brl(avEsc.lucro)} | Receita: R$ ${brl(avAtual.receita)} → R$ ${brl(avEsc.receita)} | linhas alteradas T1–T3: ${linhasAlt}`);
console.log(`Validação: núcleo ${vEsc.nucleo}, independente ${vEsc.indep}, bloco ${vEsc.bloco}, fora da Previsão ${vEsc.foraDaPrevisao}  |  M3 ${m3Fechado ? "fechado" : "NÃO fechado (ensaio)"}  |  tempo ${((Date.now() - T0) / 1000).toFixed(0)} s`);

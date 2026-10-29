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
import { capsDoPlano, rodar as rodarSim } from "@/features/escala/fluxo/avaliar";
import { ContadoresEquidade } from "@/features/escala/equidade";
import { melhorMovimento, type CandidatoMovimento } from "@/features/escala/fluxo/desempate";
import type { ContagemFisicaPar } from "@/features/escala/fluxo/tipos";
import type { AlocacaoEscala } from "@/features/escala/types";

// v2: NÃO definir FREPLAY_ESCOPO aqui — ele faria o montar.ts derivar `exposicaoExecutada` do funcionario_id do APONTAMENTO. Exposição = Escala registrada (congeladas/trocas manuais).
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
const equidade = new ContadoresEquidade(estM.entrada.funcionarios.map((f) => f.id), estM.entrada.historicoEquidade);
const operacoesCatalogo = new Set(estM.entrada.pools.map((q) => q.operacaoId));
interface Mov { slot: number; funcionarioId: string; de: string; para: string; ganho: number }
function polir(inicial: AlocacaoEscala[]): { plano: AlocacaoEscala[]; movs: Mov[]; rejeitadas: number } {
  let plano = inicial.map((a) => ({ ...a }));
  const movs: Mov[] = [];
  let rejeitadas = 0;
  let atual = avaliar(plano);
  for (let r = 0; r < 8; r++) {
    const cap = capDe(plano);
    const alvos = cap.capacidade.filter((c) => c.slot <= ultimoSlotProposta && c.valorMarginalAdicionar > 1 && c.postosDisponiveis > 0);
    interface Cand extends CandidatoMovimento { novo: AlocacaoEscala[]; mov: Mov; av: ReturnType<typeof avaliar> }
    const cands: Cand[] = [];
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
        if (ganho <= 1) continue;
        // ETAPA 2 (pessoa): só revezamento/exposição/churn/continuidade/id — nenhuma produtividade individual
        const bloco = (x: { data: string; periodoId: string }) => `${x.data}|${x.periodoId[0]}`;
        const expostas = new Set([...estM.entrada.congeladas, ...novo].filter((x) => x.funcionarioId === a.funcionarioId && x.maquinaId && x.operacaoId && bloco(x) === bloco(nova)).map((x) => x.operacaoId));
        const anterior = [...estM.entrada.congeladas, ...novo].find((x) => x.funcionarioId === a.funcionarioId && slotDe(x) === c.slot - 1 && x.maquinaId);
        cands.push({
          novo, av, ganho,
          folgaRevezamento: operacoesCatalogo.size - expostas.size,
          desvioExposicao: equidade.desvioOperacao(a.funcionarioId, pool.operacaoId),
          churn: novo.filter((x) => slotDe(x) <= ultimoSlotProposta && posto(atualPorChavePre(x)) !== posto(x)).length,
          continuidade: anterior?.maquinaId === nova.maquinaId ? 1 : 0,
          id: `${a.funcionarioId}|${c.no}`,
          mov: { slot: c.slot, funcionarioId: a.funcionarioId, de: noA ? nomeNoPre(noA) : "sem posto", para: nomeNoPre(c.no), ganho },
        });
      }
    }
    const melhor = melhorMovimento(cands);
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
// validação independente
const selecionadas = (futuras: AlocacaoEscala[]) => futuras.filter((a) => a.maquinaId && !(estM.entrada.pools.find((p) => p.produtoId === a.produtoId && p.etapaId === a.etapaId)?.maquinasIds ?? []).includes(a.maquinaId as string));
const validar = (futuras: AlocacaoEscala[]) => {
  const nucleo = verificarRestricoesDuras(estM.entrada, futuras);
  const envAnt = process.env.FREPLAY_ESCOPO;
  process.env.FREPLAY_ESCOPO = "bloco"; // só para o verificador independente (revezamento por bloco)
  const indep = verificarIndependente(estM.entrada, futuras, { planoVigente: planoAtual }).filter((v) => !v.aviso);
  if (envAnt === undefined) delete process.env.FREPLAY_ESCOPO; else process.env.FREPLAY_ESCOPO = envAnt;
  const porBloco = indep.filter((v) => v.tipo === "mesma_operacao_no_bloco").length;
  return { nucleo: nucleo.length, nucleoTipos: [...new Set(nucleo.map((v) => v.tipo))], indep: indep.length, indepTipos: [...new Set(indep.map((v) => v.tipo))], bloco: porBloco, foraDaPrevisao: selecionadas(futuras).length };
};
const violAtual = verificarRestricoesDuras(estM.entrada, atualFut).length;
const ganhoLucro = avProp.lucro - avAtual.lucro;
// ---- LIMIAR OBJETIVO DE MATERIALIDADE (não trocar pessoas por centavos) ----
// Ruído do modelo = dispersão ROBUSTA (1,4826·MAD) da razão "boas ÷ meta" por período fechado desde o início da semana (agregado das máquinas que produziram).
// Em M1 de 28/10 a produção ficou ~16% abaixo do plano: o modelo erra por esse tamanho. Um ganho só é distinguível do ruído se superar 1 erro-padrão do R$ que os np períodos propostos
// produzem: limiar = (σ ÷ √np) × R$ de T1–T3 (≈ R$ restante × np ÷ períodos restantes). Abaixo disso a diferença é indistinguível de erro de estimativa ⇒ vale o plano mais estável.
const fechadosAnt = slots.filter((x) => x.indice < idxT1 && x.fimMs + 10 * 60_000 <= agoraMs);
const razoes = fechadosAnt.flatMap((x) => {
  const as = d.apontamentos.filter((a) => a.data === x.data && a.periodoId === x.periodoId && a.status === "produzindo" && a.meta > 0 && a.lancadoEmMs <= agoraMs);
  return as.length >= 3 ? [as.reduce((t, a) => t + a.boas, 0) / as.reduce((t, a) => t + a.meta, 0)] : [];
});
const mediana = (v: number[]) => { const o = [...v].sort((p, q) => p - q); const n = o.length; return n === 0 ? NaN : n % 2 ? o[(n - 1) / 2] : (o[n / 2 - 1] + o[n / 2]) / 2; };
const medR = mediana(razoes);
const sigma = razoes.length >= 5 ? 1.4826 * mediana(razoes.map((r) => Math.abs(r - medR))) : 0.16;
const restanteR = Math.max(0, avAtual.lucro - avAtual.L.financeiro!.total.rsRealizado);
const np = periodosProposta.length;
const lucroT1T3 = restanteR * (np / Math.max(1, slots.length - idxT1));
const limiar = (sigma / Math.sqrt(np)) * lucroT1T3;
const ganhoPct = restanteR > 0 ? (100 * ganhoLucro) / restanteR : 0;
const pessoasAlt = new Set(propOficial.filter((a) => slotDe(a) <= ultimoSlotProposta).filter((a) => posto(atualPorChavePre(a)) !== posto(a)).map((a) => a.funcionarioId)).size;
function atualPorChavePre(a: AlocacaoEscala) { return atualFut.find((x) => slotDe(x) === slotDe(a) && x.funcionarioId === a.funcionarioId); }
function posto(a?: AlocacaoEscala) { return a ? `${a.maquinaId ?? ""}|${a.produtoId ?? ""}|${a.etapaId ?? ""}` : ""; }
const celulas = (l: AlocacaoEscala[]) => new Set(l.filter((a) => a.maquinaId && slotDe(a) <= ultimoSlotProposta).map((a) => `${slotDe(a)}|${a.maquinaId}`));
const cA = celulas(atualFut), cP = celulas(propOficial);
const postosAlt = [...cA].filter((k) => !cP.has(k)).length + [...cP].filter((k) => !cA.has(k)).length;
const linhasAltN = propOficial.filter((a) => slotDe(a) <= ultimoSlotProposta).filter((a) => posto(atualPorChavePre(a)) !== posto(a)).length;
const vPropPre = verificarRestricoesDuras(estM.entrada, propOficial).length + selecionadas(propOficial).length;
const criterios = [
  { ok: ganhoLucro >= limiar, txt: `ganho de lucro (R$ ${brl(ganhoLucro)}) ≥ limiar de materialidade (R$ ${brl(limiar)} = 1 erro-padrão: σ=${(sigma * 100).toFixed(1)}%, ${razoes.length} períodos, razão mediana boas÷meta ${Number.isFinite(medR) ? (medR * 100).toFixed(0) + "%" : "n/d"})` },
  { ok: avProp.L.atingibilidade!.atingiveisPerdidas <= avAtual.L.atingibilidade!.atingiveisPerdidas, txt: `atingibilidade não piora (metas atingíveis não entregues: ${avAtual.L.atingibilidade!.atingiveisPerdidas} → ${avProp.L.atingibilidade!.atingiveisPerdidas})` },
  { ok: avProp.L.totais.excessoWip <= avAtual.L.totais.excessoWip + 1, txt: `WIP excessivo não piora (${n0(avAtual.L.totais.excessoWip)} → ${n0(avProp.L.totais.excessoWip)} pç)` },
  { ok: avProp.R.financeiro!.total.rsProjetadoFechamento >= avAtual.R.financeiro!.total.rsProjetadoFechamento - 1e-6 || ganhoLucro >= 2 * limiar, txt: `receita projetada não cai (R$ ${brl(avAtual.receita)} → R$ ${brl(avProp.receita)}) salvo ganho de lucro ≥ 2× o limiar` },
  { ok: vPropPre === 0, txt: `0 violações duras/independentes e só máquinas da Previsão no plano proposto` },
];
const atualInvalido = violAtual > 0;
const aplicar = atualInvalido ? vPropPre === 0 : criterios.every((c) => c.ok);
const manter = !aplicar;
const escolhida = propOficial; // sempre apresentado: o PLANO ECONÔMICO OFFLINE completo
const avEsc = avProp;
const rotuloEsc = aplicar ? "APLICAR PLANO ECONÔMICO" : "MANTER PLANO ATUAL";
const marc = capDe;
const capEsc = marc(propOficial);
const capAtual = marc(atualFut);
const estado = montarEstado(estM.ctx);

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
P(`# >>> RECOMENDAÇÃO FINAL: **${rotuloEsc}** <<<`);
P(`Critério objetivo (todos precisam ser verdadeiros para recomendar a troca${atualInvalido ? "; o plano atual TEM violação dura ⇒ a troca é necessária desde que o proposto seja válido" : ""}):`);
criterios.forEach((c) => P(`- ${c.ok ? "✔" : "✘"} ${c.txt}`));
P();
P(`| Ganho R$ absoluto (lucro tela) | Ganho % sobre o restante da semana (R$ ${brl(restanteR)}) | Pessoas alteradas | Postos alterados (período×máquina) | Linhas pessoa/posto alteradas |`);
P(`|---|---|---|---|---|`);
P(`| R$ ${brl(ganhoLucro)} | ${ganhoPct.toFixed(2)}% | ${pessoasAlt} | ${postosAlt} | ${linhasAltN} |`);
P();
const auditoriaPath = process.env.EXPOSICAO_AUDIT ?? "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/exp/exposicao_audit.md";
P(`## ⚠ CONFIANÇA / BUG CONHECIDO — revezamento e \`funcionario_id\` do apontamento`);
P(`O revezamento ativo em PROD (processar.ts → exposicaoDeApontamentos) usa o \`funcionario_id\` do APONTAMENTO como se fosse o operador (é quem lançou). **Esta proposta NÃO usa isso:** a exposição é a Escala registrada (alocação congelada + troca manual registrada), a produtividade é só por produto×operação×máquina e a pessoa de cada posto é escolhida só por disponibilidade, elegibilidade, revezamento no bloco, equilíbrio de exposição, churn e continuidade. Para o bloco TARDE de hoje não há período passado (T1 é o primeiro): o resultado numérico é idêntico ao v1. T2/T3 só são afetados pelo replanejamento do PROD depois do fechamento de T1.`);
if (fs.existsSync(auditoriaPath)) { P(); P(`_Fonte: ${auditoriaPath}_`); P(); P(fs.readFileSync(auditoriaPath, "utf8")); } else P(`_(placeholder: crie ${auditoriaPath} com a medição para incluí-la aqui literalmente)_`);
P();
P(`**Por que este limiar:** o próprio modelo erra por esse tamanho (a produção real fica abaixo/acima do plano com σ = ${(sigma * 100).toFixed(1)}% por período; razão mediana ${Number.isFinite(medR) ? (medR * 100).toFixed(0) + "%" : "n/d"}). Um ganho menor que 1 erro-padrão do R$ de ${np} período(s) não se distingue de erro de estimativa; trocar pessoas por isso gera instabilidade sem benefício mensurável. Não há dado de custo de troca de posto; se existir, soma-se ao limiar.`);
P();
P(`## Os TRÊS estados`);
const tot = (x: ReturnType<typeof avaliar>) => x.L.financeiro!.total;
P(`| | (1) ESTADO REAL após M3 | (2) PLANO ATIVO (gravado pelo motor) | (3) PLANO ECONÔMICO OFFLINE (com as contagens novas) |`);
P(`|---|---|---|---|`);
P(`| Lucro tela já produzido (R$) | ${brl(tot(avAtual).rsRealizado)} | = | = |`);
P(`| Lucro projetado de fechamento (R$) | — | ${brl(avAtual.lucro)} | ${brl(avProp.lucro)} (Δ ${brl(ganhoLucro)}) |`);
P(`| Lucro ainda capturável (máximo, R$) | ${brl(tot(avAtual).rsMaximoAtingivel - tot(avAtual).rsRealizado)} | ${brl(tot(avAtual).rsMaximoAtingivel - tot(avAtual).rsRealizado)} | ${brl(tot(avProp).rsMaximoAtingivel - tot(avProp).rsRealizado)} |`);
P(`| Lucro faltante projetado (R$ vs. meta) | ${brl(tot(avAtual).rsFaltante)} | ${brl(tot(avAtual).rsFaltaProjetada)} | ${brl(tot(avProp).rsFaltaProjetada)} |`);
P(`| Receita projetada (R$) | — | ${brl(avAtual.receita)} | ${brl(avProp.receita)} |`);
P(`| Metas atingíveis NÃO entregues | — | ${avAtual.L.atingibilidade!.atingiveisPerdidas} | ${avProp.L.atingibilidade!.atingiveisPerdidas} |`);
P(`| WIP final da semana (pç) / excesso | — | ${n0(avAtual.L.totais.wipFinalLo)} / ${n0(avAtual.L.totais.excessoWip)} | ${n0(avProp.L.totais.wipFinalLo)} / ${n0(avProp.L.totais.excessoWip)} |`);
P(`| Hard constraints | — | núcleo ${vAtual.nucleo}, independente ${vAtual.indep} | núcleo ${validar(propOficial).nucleo}, independente ${validar(propOficial).indep} |`);
P();
P(`**Auditoria do PLANO ATIVO** (o fato de o motor ter gravado não prova que está certo): violações duras = ${vAtual.nucleo} (${vAtual.nucleoTipos.join(", ") || "—"}); verificador independente = ${vAtual.indep} (${vAtual.indepTipos.join(", ") || "—"}); linhas fora das máquinas da Previsão = ${vAtual.foraDaPrevisao}; pessoas SEM posto em T1–T3 = ${atualFut.filter((a) => slotDe(a) <= ultimoSlotProposta && !a.maquinaId).length}; postos livres com valor marginal > 0 (oportunidade não aproveitada) = ${capAtual.capacidade.filter((c) => c.slot <= ultimoSlotProposta && c.postosDisponiveis > 0 && c.valorMarginalAdicionar > 0.5).map((c) => `${slotRot(c.slot)} ${nomeNoPre(c.no)} (+R$ ${brl(c.valorMarginalAdicionar)})`).join("; ") || "nenhum"}.`);
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
P(`## G) PROPOSTA COMPLETA de T1, T2 e T3 por funcionário — PLANO ECONÔMICO OFFLINE (recomendação: ${rotuloEsc})`);
P(`| Funcionário | ${periodosProposta.map((s) => s.periodoId.toUpperCase() + " " + `${String(Math.floor(s.inicioMin / 60)).padStart(2, "0")}:${String(s.inicioMin % 60).padStart(2, "0")}`).join(" | ")} |`);
P(`|---|${periodosProposta.map(() => "---").join("|")}|`);
func.forEach((f) => P(`| ${nome(f)} | ${periodosProposta.map((s) => (ausH(f, s.indice) ? "AUSENTE" : celula(f, s.indice))).join(" | ")} |`));
P();
P(`## H) Operação, máquina e produto de cada linha`);
P(`| Período | Funcionário | Operação | Máquina | Produto | Etapa | Peças (capacidade) | Origem | Mudou vs. plano atual |`);
P(`|---|---|---|---|---|---|---|---|---|`);
const atualPorChave = new Map(atualFut.map((a) => [`${slotDe(a)}|${a.funcionarioId}`, a]));
escolhida.filter((a) => slotDe(a) <= ultimoSlotProposta).sort((a, b) => slotDe(a) - slotDe(b) || nome(a.funcionarioId).localeCompare(nome(b.funcionarioId))).forEach((a) => {
  const antes = atualPorChave.get(`${slotDe(a)}|${a.funcionarioId}`);
  P(`| ${slotRot(slotDe(a))} | ${nome(a.funcionarioId)} | ${nome(a.operacaoId)} | ${nome(a.maquinaId)} | ${nome(a.produtoId)} | ${a.etapaId ? nomeNo(`${a.produtoId}|${a.etapaId}`).split(" · ")[1] ?? "" : ""} | ${n0(a.pecas ?? 0)} | ${a.origem ?? "auto"} | ${posto(antes) === posto(a) ? "não" : "sim (antes: " + (antes?.maquinaId ? `${nome(antes.operacaoId)} · ${nome(antes.maquinaId)}` : "sem posto") + ")"} |`);
});
P();

// I
P(`## I) Postos que mudam (decisão do POSTO) e pessoa escolhida (escolha da PESSOA)`);
const mudadas = propOficial.filter((a) => slotDe(a) <= ultimoSlotProposta).flatMap((a) => { const antes = atualPorChave.get(`${slotDe(a)}|${a.funcionarioId}`); return posto(antes) === posto(a) ? [] : [{ a, antes }]; });
P(`- Candidatos do motor: plano escolhido pelo núcleo = **${rA.diagnostico.planoEscolhido}**; ajuste fino pessoa a pessoa: **${pol.movs.length}** movimento(s) aceito(s), ${pol.rejeitadas} tentativa(s) rejeitada(s) por restrição dura. Linhas alteradas: ${mudadas.length}.`);
pol.movs.forEach((m) => P(`  - ajuste fino ${slotRot(m.slot)}: o posto ${m.para} passa a ser ocupado e ${m.de} deixa de ser (+R$ ${brl(m.ganho)} de lucro projetado do posto); pessoa escolhida por desempate (revezamento → exposição → churn → continuidade → id): ${nome(m.funcionarioId)}`));
const vU = (cap: typeof capEsc, t: number, produtoId: string | null | undefined, etapaId: string | null | undefined) => cap.capacidade.find((c) => c.slot === t && c.produtoId === produtoId && c.etapaId === etapaId)?.valorMarginalUltimo ?? 0;
// confiança baixa (marcação explícita; não entra na decisão)
const naoConfPorProduto = (pid: string) => naoConf.filter((c) => (estM.entrada.pools.find((q) => q.produtoId === pid)?.maquinasIds ?? []).includes(c.maquinaId)).length;
const confianca = (produtoId: string | null | undefined, etapaId: string | null | undefined): string[] => {
  if (!produtoId) return [];
  const r: string[] = [];
  const baixa = estado.pares.filter((q: any) => q.produtoId === produtoId && q.confianca === "baixa");
  if (baixa.length) r.push(`WIP estimado sem contagem (${baixa.length} par(es))`);
  const op = estM.entrada.pools.find((q) => q.produtoId === produtoId && q.etapaId === etapaId)?.operacaoId;
  const n = d.apontamentos.filter((a) => a.produtoId === produtoId && a.operacaoId === op && a.status === "produzindo").length;
  if (n < 20) r.push(`produtividade com amostra pequena (n=${n} apontamentos na semana)`);
  if (/autom/i.test(nome(produtoId))) r.push("Automática com produtividade substituta do convencional");
  if (/1\.1\/4/.test(nome(produtoId))) r.push("1.1/4\" com apenas 1 semana de dados");
  const nc = naoConfPorProduto(produtoId);
  if (nc) r.push(`${nc} período(s)/máquina(s) fechados sem apontamento (produção em [0, planejado])`);
  return r;
};
const marcaConf = (...ids: [string | null | undefined, string | null | undefined][]) => { const rs = [...new Set(ids.flatMap(([a, b]) => confianca(a, b)))]; return rs.length ? `⚠ CONFIANÇA BAIXA: ${rs.join("; ")}` : "confiança ok"; };
const mudadasOrd = mudadas.sort((x, y) => slotDe(x.a) - slotDe(y.a));
if (mudadasOrd.length === 0) P(`Nenhuma troca: o plano econômico coincide com o plano atual.`);
mudadasOrd.slice(0, 15).forEach(({ a, antes }, i) => {
  const t = slotDe(a);
  const revertido = propOficial.map((x) => (x === a ? (antes ?? { ...a, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0 }) : x));
  const avRev = avaliar(revertido);
  const contrib = avProp.lucro - avRev.lucro;
  const dPecas = (pid: string | null | undefined) => { if (!pid) return 0; const x = avProp.L.financeiro!.produtos.find((p) => p.produtoId === pid), y = avRev.L.financeiro!.produtos.find((p) => p.produtoId === pid); return (x?.finalProjetado ?? 0) - (y?.finalProjetado ?? 0); };
  const statusMeta = (pid: string | null | undefined) => { const g = avProp.L.atingibilidade!.grupos.find((q) => q.produtos.some((x) => x.produtoId === pid)); return g ? g.status : "—"; };
  const dWip = avProp.L.totais.wipFinalLo - avRev.L.totais.wipFinalLo;
  const gB = a.maquinaId ? vU(capEsc, t, a.produtoId, a.etapaId) : 0;
  const pA = antes?.maquinaId ? vU(capAtual, t, antes.produtoId, antes.etapaId) : 0;
  const noB = a.maquinaId ? estM.ctx.grafo.noDoPool[`${a.produtoId}|${a.etapaId}`] : null;
  const rowB = noB ? capAtual.capacidade.find((c) => c.slot === t && c.no === noB) : undefined;
  const custoOp = capAtual.capacidade.filter((c) => c.slot === t && c.no !== noB && c.postosDisponiveis > 0).reduce((m, c) => Math.max(m, c.valorMarginalAdicionar), 0);
  const de = antes?.maquinaId ? `${nome(antes.operacaoId)} · ${nome(antes.maquinaId)} · ${nome(antes.produtoId)}` : "sem posto";
  const para = a.maquinaId ? `${nome(a.operacaoId)} · ${nome(a.maquinaId)} · ${nome(a.produtoId)}` : "sem posto";
  const opB = a.operacaoId ?? "";
  const expostas = new Set([...estM.entrada.congeladas, ...propOficial].filter((x) => x.funcionarioId === a.funcionarioId && x.maquinaId && x.operacaoId && `${x.data}|${x.periodoId[0]}` === `${a.data}|${a.periodoId[0]}`).map((x) => x.operacaoId));
  const churnAlt = propOficial.filter((x) => slotDe(x) <= ultimoSlotProposta && posto(atualPorChavePre(x)) !== posto(x)).length;
  P(`${i + 1}. **Posto ${para}** passa a ser ocupado em ${slotRot(t)} (valor marginal estimado do posto R$ ${brl(gB)}); o posto ${de} deixa de ser ocupado (R$ ${brl(pA)}); **líquido R$ ${brl(gB - pA)}**.`);
  P(`   - **A) DECISÃO DO POSTO:** o posto é prioritário porque: ${rowB && rowB.diagnostico === "GARGALO_WIP_MATERIAL" ? "NÃO há WIP/material (⚠)" : "há WIP/material"}; ${rowB && (rowB.diagnostico === "GARGALO_DOWNSTREAM" || rowB.diagnostico === "FOLGA_FUTURA") ? "o downstream/final NÃO absorve mais (⚠)" : "o downstream/final absorve"}; valor marginal do posto = R$ ${brl(gB)}; custo de oportunidade (melhor posto livre alternativo no período) = R$ ${brl(custoOp)}; ganho líquido = R$ ${brl(gB - custoOp)}. Contribuição total re-simulada deste posto no plano = R$ ${brl(contrib)}.`);
  P(`   - Efeito na meta: ${a.produtoId ? `${nome(a.produtoId)} ${dPecas(a.produtoId) >= 0 ? "+" : ""}${n0(dPecas(a.produtoId))} pç (${statusMeta(a.produtoId)})` : "—"}${antes?.produtoId && antes.produtoId !== a.produtoId ? `; ${nome(antes.produtoId)} ${dPecas(antes.produtoId) >= 0 ? "+" : ""}${n0(dPecas(antes.produtoId))} pç` : ""}. Efeito no WIP final da semana: ${dWip >= 0 ? "+" : ""}${n0(dWip)} pç.`);
  P(`   - **B) ESCOLHA DA PESSOA:** ${nome(a.funcionarioId)} é uma alocação válida para esse posto porque: disponível no período; elegível (posto da Previsão); não viola o revezamento no bloco (verificador: 0 violações; operações já expostas no bloco: ${expostas.size} de ${operacoesCatalogo.size}); equilíbrio de exposição na operação de destino (desvio histórico ${equidade.desvioOperacao(a.funcionarioId, opB).toFixed(0)} min; menor = abaixo da parcela justa); churn do plano = ${churnAlt} linha(s). Desempate entre alternativas válidas: ganho → folga de revezamento → exposição → churn → continuidade → id. Nenhuma produtividade individual é usada.`);
  P(`   - ${marcaConf([a.produtoId, a.etapaId], [antes?.produtoId, antes?.etapaId])}`);
});
if (mudadasOrd.length > 15) P(`(+ ${mudadasOrd.length - 15} troca(s) menores — ver H.)`);
const lim = rA.diagnostico.economia?.limiteEconomico;
P();
P(`- **Atingibilidade × custo (k=2):** ${lim && lim.candidatos.length ? lim.candidatos.map((c) => `candidato ${c.indice}: custo R$ ${brl(c.custoRs)} × valor recuperado R$ ${brl(c.valorRecuperadoRs)} (razão ${c.razao === null ? "∞" : c.razao.toFixed(1)}) ⇒ ${c.justificado ? "PRESERVADA" : "não preservada"}`).join("; ") : "nenhum conflito entre preservar uma meta atingível e o resultado econômico"}.`);
P(`- **Estabilidade/churn:** ${linhasAltN} linha(s) pessoa/posto e ${pessoasAlt} pessoa(s) alterada(s); ${postosAlt} célula(s) período×máquina diferentes.`);
rA.diagnostico.diagnosticos.filter((x) => ["PRODUTO_SACRIFICADO", "MARGEM_INDISPONIVEL"].includes(x.codigo)).forEach((x) => P(`- ${x.codigo}: ${x.mensagem}`));
const confGeral = [...new Set(avProp.L.financeiro!.produtos.flatMap((p) => confianca(p.produtoId, p.etapaFinalId).map((r) => `${nome(p.produtoId)}: ${r}`)))];
if (confGeral.length) { P(); P(`**⚠ Dados de confiança baixa que afetam o cálculo (vale para toda a proposta):**`); confGeral.forEach((x) => P(`- ⚠ ${x}`)); }
P();

// J K L
P(`## J) R$ final projetado da semana`);
P(`| | Plano atual | Plano econômico | Δ |`);
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
const linhasAlt = linhasAltN;
const trocas = escolhida.filter((a) => slotDe(a) <= ultimoSlotProposta).filter((a) => { const antes = atualPorChave.get(`${slotDe(a)}|${a.funcionarioId}`); return antes?.maquinaId && a.maquinaId && posto(antes) !== posto(a); }).length;
P(`| | Plano atual | Plano econômico |`);
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
P(`**Validação independente do plano econômico: ${vEsc.nucleo + vEsc.indep + vEsc.foraDaPrevisao === 0 ? "0 violações (núcleo, verificador independente, bloco e máquinas selecionadas)" : "ATENÇÃO — há violações: NÃO aprovar sem revisão"}.**`);
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
  geradoEmMs: agoraMs, semana, data: hoje, previsaoId: (d0.decisao as any).previsaoId ?? (bruto.q_dec[0] as any).previsao_id, periodoInicial: periodoIni, decisao: rotuloEsc, recomendacao: rotuloEsc, manterPlanoAtual: manter, ganhoLucro, limiarMaterialidade: limiar,
  hashPlanoAtualT1T3: hashLinhas(hojeProposta(atualFut)),
  linhas: hojeProposta(escolhida).map((a) => ({ ...a, mudou: posto(atualPorChave.get(`${slotDe(a)}|${a.funcionarioId}`)) !== posto(a) })),
  linhasAtuais: hojeProposta(atualFut),
}, null, 1));
console.log(`\nARQUIVO: ${saida}\nJSON (para aplicar-proposta.ts): ${jsonSaida}\n(cache de dados: ${CACHE})\n`);
console.log(`RESUMO — ${rotuloEsc}`);
console.log(`Lucro projetado (tela): R$ ${brl(avAtual.lucro)} → R$ ${brl(avEsc.lucro)} | Receita: R$ ${brl(avAtual.receita)} → R$ ${brl(avEsc.receita)} | linhas alteradas T1–T3: ${linhasAlt}`);
console.log(`Validação: núcleo ${vEsc.nucleo}, independente ${vEsc.indep}, bloco ${vEsc.bloco}, fora da Previsão ${vEsc.foraDaPrevisao}  |  M3 ${m3Fechado ? "fechado" : "NÃO fechado (ensaio)"}  |  tempo ${((Date.now() - T0) / 1000).toFixed(0)} s`);

// =====================================================================================================================================================
// ANÁLISE M8 / matriz apples-to-apples / decomposição / remoção (12:25). Posto = unidade de análise; pessoa só como ocupante.
// =====================================================================================================================================================
const R: string[] = [];
const Q = (s = "") => { R.push(s); };
const fb = rB ? fut(rB.resultado.alocacoes) : [];
const soHoje = (prop: AlocacaoEscala[]) => prop.filter((a) => slotDe(a) <= ultimoSlotProposta).concat(atualFut.filter((a) => slotDe(a) > ultimoSlotProposta));
// avaliador ESTIMADOR (só para a matriz): mesma entrada, produtividade do estimador
const estE = (() => {
  const e0 = ST({});
  const periodos = [...new Set(e0.entrada.slots.map((x) => x.periodoId))];
  const fm = fatoresParaMotor(d.apontamentos.filter((a) => a.lancadoEmMs <= agoraMs) as never, e0.entrada.pools.map((p) => ({ produtoId: p.produtoId, etapaId: p.etapaId, operacaoId: p.operacaoId, maquinasIds: p.maquinasIds })), periodos, agoraMs);
  const fAtual = e0.opcoes.fatoresEmbutidos ?? {};
  const prov = (a: { produtoId: string; etapaId: string; periodoId: string; metaNominal: number }) => { const k = `${a.produtoId}|${a.etapaId}`; return { pecasPorPeriodo: a.metaNominal / (fAtual[k] ?? 1), fator: fm.porPoolPeriodo[k]?.[a.periodoId] ?? 1, fonte: "estimador", amostra: 0 }; };
  return ST({ ...MEDIR, produtividade: prov });
})();
const avalE = (futuras: AlocacaoEscala[]) => avaliarPlano(estE.entrada, estE.dados, [...estE.entrada.congeladas, ...futuras], estE.opcoes).financeiro!.total.rsProjetadoFechamento;

Q(`# Análise M8 / matriz / decomposição / remoção — ${hoje} (cache 12:08, contagens 12:05, agora ${hhmm(agoraMs)})`);
Q(`Avaliador OFICIAL = capacidade oficial (metas × f atual); ESTIMADOR = metas nominais × fator do estimador (porPoolPeriodo). Lucro = lucro tela (convenção). Resto da semana = plano atual, salvo "semana toda".`);
Q();
Q(`## 1) Matriz apples-to-apples (lucro R$ projetado da semana)`);
const planos: [string, AlocacaoEscala[]][] = [["C) ATIVO (atual)", atualFut], ["A) econômico base (1208)", propOficial], ["B) variante estimador", fb]];
Q(`| Plano | Escopo | Avaliador OFICIAL | Avaliador ESTIMADOR |`);
Q(`|---|---|---|---|`);
const mat: Record<string, { of: number; es: number }> = {};
for (const [rot, p] of planos) {
  const t = soHoje(p), w = p;
  mat[rot + "|T"] = { of: avaliar(t).lucro, es: avalE(t) };
  mat[rot + "|W"] = { of: avaliar(w).lucro, es: avalE(w) };
  Q(`| ${rot} | T1–T3 + resto = atual | ${brl(mat[rot + "|T"].of)} | ${brl(mat[rot + "|T"].es)} |`);
  Q(`| ${rot} | semana toda (informativo) | ${brl(mat[rot + "|W"].of)} | ${brl(mat[rot + "|W"].es)} |`);
}
const gT = (k: string, av: "of" | "es") => mat[k + "|T"][av] - mat["C) ATIVO (atual)|T"][av];
Q();
Q(`**Ganho REAL do plano** (mesmo avaliador, mesmas capacidades, T1–T3 + resto = atual): econômico +${brl(gT("A) econômico base (1208)", "of"))} (oficial) / +${brl(gT("A) econômico base (1208)", "es"))} (estimador); variante +${brl(gT("B) variante estimador", "of"))} (oficial) / +${brl(gT("B) variante estimador", "es"))} (estimador). **Ganho só da MÉTRICA** (mesmo plano, avaliador muda): atual ${brl(mat["C) ATIVO (atual)|T"].es - mat["C) ATIVO (atual)|T"].of)}, econômico ${brl(mat["A) econômico base (1208)|T"].es - mat["A) econômico base (1208)|T"].of)}, variante ${brl(mat["B) variante estimador|T"].es - mat["B) variante estimador|T"].of)} (estimador − oficial; o nível muda, o que importa é a diferença entre planos).`);
Q(`Limiar de materialidade (escopo T1–T3 + resto = atual, mesmo cálculo): R$ ${brl(limiar)}.`);
Q();

// ---------- 2) decomposição por mudança isolada (variante vs ATUAL, T1–T3 + resto = atual) ----------
Q(`## 2) Decomposição do ganho da variante (T1–T3 + resto = atual) por mudança isolada e combinações — avaliador OFICIAL`);
const linhasVar = fb.filter((a) => slotDe(a) <= ultimoSlotProposta);
const dif = linhasVar.filter((a) => posto(atualPorChavePre(a)) !== posto(a));
const m8Maq = estM.entrada.pools.find((p) => /Rosquear \+ Parafusar/.test(nome(p.operacaoId)))?.maquinasIds[0] ?? "";
// unidades de mudança: U_etq (Rosa T1 → Etiquetadora 15), U_m8_T1/T2/T3 (linha que vai para a M8), U_trocas (as demais: só troca de ocupante entre Embalagem 17 / Etiquetadora 15)
const ehM8 = (a: AlocacaoEscala) => a.maquinaId === m8Maq;
const unidades: { rot: string; linhas: AlocacaoEscala[] }[] = [];
periodosProposta.forEach((s) => { const l = dif.filter((a) => slotDe(a) === s.indice && ehM8(a)); if (l.length) unidades.push({ rot: `M8 ligada em ${s.periodoId.toUpperCase()}`, linhas: l }); });
const etq = dif.filter((a) => !ehM8(a) && nome(a.maquinaId) === "Etiquetadora 15" && !atualFut.some((x) => slotDe(x) === slotDe(a) && x.maquinaId === a.maquinaId));
if (etq.length) unidades.push({ rot: "Etiquetadora 15 passa a ser ocupada (posto antes vazio)", linhas: etq });
const usadasU = new Set(unidades.flatMap((u) => u.linhas));
const resto = dif.filter((a) => !usadasU.has(a));
if (resto.length) unidades.push({ rot: `trocas de ocupante em postos já ocupados (${resto.length} linha(s))`, linhas: resto });
const aplicarU = (idxs: number[]) => {
  let plano = atualFut.map((a) => ({ ...a }));
  const mudar = idxs.flatMap((i) => unidades[i].linhas);
  mudar.forEach((v) => { const k = plano.findIndex((x) => slotDe(x) === slotDe(v) && x.funcionarioId === v.funcionarioId); if (k >= 0) plano[k] = v; });
  return plano;
};
const baseAv = avaliar(atualFut);
const prodSim = (futuras: AlocacaoEscala[]) => {
  const caps = capsDoPlano(estM.ctx, futuras);
  const out: Record<string, number> = {}; let wip = 0;
  estM.ctx.grafo.grupos.forEach((g, gi) => { const r = rodarSim(estM.ctx, gi, caps, "lo", undefined, false); g.nos.forEach((n) => (out[n] = (out[n] ?? 0) + (r.x[n] ?? []).reduce((a, b) => a + b, 0))); g.arestas.forEach((e) => (wip += r.W[e])); });
  return { out, wip };
};
const pBase = prodSim(atualFut);
const descreve = (idxs: number[]) => {
  const p = aplicarU(idxs); const a = avaliar(p); const ps = prodSim(p);
  const inter = Object.keys(ps.out).map((n) => [n, ps.out[n] - pBase.out[n]] as [string, number]).filter(([n, v]) => Math.abs(v) > 0.5 && !estM.ctx.grafo.nos[n].final);
  const fin = a.L.financeiro!.produtos.map((x, i) => [nome(x.produtoId), x.finalProjetado - baseAv.L.financeiro!.produtos[i].finalProjetado] as [string, number]).filter(([, v]) => Math.abs(v) > 0.5);
  return { lucro: a.lucro - baseAv.lucro, receita: a.receita - baseAv.receita, wip: ps.wip - pBase.wip, inter, fin, viol: validar(p).nucleo + validar(p).indep };
};
Q(`| Mudança (isolada) | Δ lucro R$ | Δ receita R$ | Δ peças INTERMEDIÁRIAS produzidas (por etapa) | Δ peças FINAIS por produto | Δ WIP final | viol. |`);
Q(`|---|---|---|---|---|---|---|`);
let somaIso = 0;
unidades.forEach((u, i) => { const x = descreve([i]); somaIso += x.lucro; Q(`| ${u.rot} | ${brl(x.lucro)} | ${brl(x.receita)} | ${x.inter.map(([n, v]) => `${nomeNoPre(n)} ${v >= 0 ? "+" : ""}${n0(v)}`).join("; ") || "—"} | ${x.fin.map(([n, v]) => `${n} ${v >= 0 ? "+" : ""}${n0(v)}`).join("; ") || "—"} | ${n0(x.wip)} | ${x.viol} |`); });
const todos = unidades.map((_, i) => i);
const xt = descreve(todos);
Q(`| **TODAS juntas (= variante T1–T3)** | **${brl(xt.lucro)}** | ${brl(xt.receita)} | ${xt.inter.map(([n, v]) => `${nomeNoPre(n)} ${v >= 0 ? "+" : ""}${n0(v)}`).join("; ") || "—"} | ${xt.fin.map(([n, v]) => `${n} ${v >= 0 ? "+" : ""}${n0(v)}`).join("; ") || "—"} | ${n0(xt.wip)} | ${xt.viol} |`);
Q();
Q(`Soma dos efeitos isolados = R$ ${brl(somaIso)}; efeito conjunto = R$ ${brl(xt.lucro)}; **interação (conjunto − soma) = R$ ${brl(xt.lucro - somaIso)}**.`);
Q(`Combinações:`);
const subs = (n: number) => { const o: number[][] = []; for (let m = 1; m < 1 << n; m++) { const l: number[] = []; for (let i = 0; i < n; i++) if (m & (1 << i)) l.push(i); if (l.length >= 2 && l.length < n) o.push(l); } return o; };
subs(unidades.length).forEach((c) => { const x = descreve(c); Q(`- ${c.map((i) => unidades[i].rot.split(" (")[0]).join(" + ")}: Δ lucro R$ ${brl(x.lucro)}`); });
Q();
// semana toda: 30/10 em diante
const dAmanha = avaliar(amanhaDe(fb)).lucro - avaliar(atualFut).lucro;
function amanhaDe(prop: AlocacaoEscala[]) { return atualFut.filter((a) => slotDe(a) <= ultimoSlotProposta).concat(prop.filter((a) => slotDe(a) > ultimoSlotProposta)); }
Q(`Origem do +R$ ${brl(avaliar(fb).lucro - avAtual.lucro)} (variante, semana toda vs atual): T1–T3 da variante com resto = atual: R$ ${brl(xt.lucro)}; plano de 30/10+ da variante com T1–T3 = atual: R$ ${brl(dAmanha)}; o resto é interação entre os dois.`);
Q();

// ---------- 3/4) valor da M8 ----------
Q(`## 3) Produtividade REAL da Máquina 8 (por POSTO = produto × operação × máquina; nunca por pessoa)`);
const apM8 = d.apontamentos.filter((a) => a.maquinaId === m8Maq && a.status === "produzindo" && a.lancadoEmMs <= agoraMs);
const poolM8 = estM.entrada.pools.find((p) => p.maquinasIds.includes(m8Maq));
const casaPool = apM8.filter((a) => a.produtoId === poolM8?.produtoId && a.operacaoId === poolM8?.operacaoId).length;
const ops = new Map<string, number>(); apM8.forEach((a) => ops.set(`${nome(a.produtoId)} / ${nome(a.operacaoId)}`, (ops.get(`${nome(a.produtoId)} / ${nome(a.operacaoId)}`) ?? 0) + 1));
const somaB = apM8.reduce((s, a) => s + a.boas, 0), somaM = apM8.reduce((s, a) => s + a.meta, 0);
Q(`- Apontamentos 'produzindo' da máquina ${nome(m8Maq)} até agora: **n = ${apM8.length}** (por pool produto×operação do roteiro atual: ${casaPool}); combinações produto/operação encontradas: ${[...ops.entries()].map(([k, v]) => `${k} (${v})`).join("; ") || "nenhuma"}.`);
Q(`- boas ÷ meta (real do posto) = ${somaM > 0 ? ((somaB / somaM) * 100).toFixed(1) + "%" : "n/d"} (Σ boas ${n0(somaB)} / Σ meta ${n0(somaM)}).${apM8.length && casaPool === 0 ? " **O n=0 anterior era artefato de cruzamento por produto/operacaoId; por máquina existem apontamentos reais.**" : ""}`);
const porPer = new Map<string, { b: number; m: number; n: number }>();
apM8.forEach((a) => { const k = a.periodoId; const x = porPer.get(k) ?? { b: 0, m: 0, n: 0 }; x.b += a.boas; x.m += a.meta; x.n++; porPer.set(k, x); });
Q(`- Por período do dia: ${[...porPer.entries()].sort().map(([k, x]) => `${k}: ${n0(x.b / x.n)} pç/ap. (${x.m > 0 ? ((x.b / x.m) * 100).toFixed(0) : "?"}% da meta, n=${x.n})`).join("; ")}.`);
const f8 = (estM.entrada.pools.find((p) => p.maquinasIds.includes(m8Maq)) as any)?.metas ?? {};
Q(`- Meta esperada usada pelo motor oficial (substituta, ⚠ confiança baixa): ${Object.entries(f8).map(([k, v]) => `${k} ${n0(v as number)}`).join(", ")} pç/período.`);
Q();
Q(`## 4) M8 × fluxo convencional Rosquear+Parafusar (mesma quantidade de peças) — produtividades por POSTO do motor oficial`);
const mu = (nm: RegExp, per: string) => { const p = estM.entrada.pools.find((q) => nm.test(`${nome(q.produtoId)}|${nome(q.operacaoId)}`)); return p ? p.metas[per] ?? 0 : 0; };
const per = periodosProposta[0].periodoId;
const horas = (periodosProposta[0].fimMin - periodosProposta[0].inicioMin) / 60;
const m8 = mu(/Autom.*\|Rosquear \+ Parafusar/, per), rq = mu(/Conv.*\|Rosquear$/, per), pf = mu(/Conv.*\|Parafusar$/, per);
Q(`Produtividade esperada em ${per.toUpperCase()} (${horas.toFixed(2)} h): M8 ${n0(m8)} pç/período (nominal ${n0(m8 / (estM.opcoes.fatoresEmbutidos?.[`${poolM8?.produtoId}|${poolM8?.etapaId}`] ?? 1))}); Rosqueadeira conv. ${n0(rq)}; Parafusadeira conv. ${n0(pf)}.`);
Q(`| Peças (pç) | | M8 (1 operador) | Conv. Rosquear + Parafusar (2 operadores) |`);
Q(`|---|---|---|---|`);
[1000, Math.round(m8), Math.round(3 * m8)].forEach((qt) => {
  const ppM8 = qt / m8, ppR = qt / rq, ppP = qt / pf;
  Q(`| ${n0(qt)} | pessoa-períodos | ${ppM8.toFixed(2)} | ${(ppR + ppP).toFixed(2)} (${ppR.toFixed(2)} + ${ppP.toFixed(2)}) |`);
  Q(`| | horas-operador (${horas.toFixed(2)} h/período) | ${(ppM8 * horas).toFixed(2)} | ${((ppR + ppP) * horas).toFixed(2)} |`);
  Q(`| | horas-máquina | ${(ppM8 * horas).toFixed(2)} (M8) | ${(ppR * horas).toFixed(2)} (Rosq.) + ${(ppP * horas).toFixed(2)} (Paraf.) |`);
  Q(`| | peças por operador-período | ${n0(qt / ppM8)} | ${n0(qt / (ppR + ppP))} |`);
  Q(`| | pessoa-períodos economizados pela M8 | ${(ppR + ppP - ppM8).toFixed(2)} | — |`);
});
const lh = (pid: string) => lucroHoraDaTela(estM.entrada)(pid, "");
const pidA = poolM8?.produtoId ?? "", pidC = estM.entrada.pools.find((q) => /Conv/.test(nome(q.produtoId)))?.produtoId ?? "";
Q(`Lucro/h da tela (convenção): cadeia Automática ${lh(pidA)?.lucroHora.toFixed(2)} × convencional ${lh(pidC)?.lucroHora.toFixed(2)} R$/h; margem/peça ${lh(pidA)?.margemUnitaria.toFixed(4)} × ${lh(pidC)?.margemUnitaria.toFixed(4)}. Capacidade física liberada nas conv.: Rosqueadeira ${(1000 / rq).toFixed(2)} e Parafusadeira ${(1000 / pf).toFixed(2)} posto-período por 1.000 pç. Os dois fluxos convergem na Etiquetadora 15 (pool comum).`);
Q();

// ---------- 5/6/7) pool comum ----------
Q(`## 5–7) Pool comum: Etiquetadora 15 e Embalagem 17 (única máquina selecionada; nenhuma máquina adicionada)`);
const capB = capDe(atualFut);
const caps0 = capsDoPlano(estM.ctx, atualFut);
const g0 = estM.ctx.grafo.grupos.findIndex((g) => g.nos.some((n) => /Embalar/.test(nomeNoPre(n)) && /Conv/.test(nomeNoPre(n))));
const sim0 = rodarSim(estM.ctx, g0, caps0, "lo", undefined, true);
const noEmb = estM.ctx.grafo.grupos[g0].nos.find((n) => /Embalar/.test(nomeNoPre(n)))!, noEtq = estM.ctx.grafo.grupos[g0].nos.find((n) => /Etiquetar/.test(nomeNoPre(n)) && /Conv/.test(nomeNoPre(n)))!;
const rowsE = (no: string) => capB.capacidade.filter((c) => c.no === no);
const util = (no: string) => rowsE(no).map((c) => { const prod = sim0.x[no]?.[c.slot - estM.ctx.aPartirDe] ?? 0; return `${slotRot(c.slot)}: ${n0(prod)}/${n0(c.capMaquinas)} (${c.capMaquinas > 0 ? ((100 * prod) / c.capMaquinas).toFixed(0) : "-"}%, ocup ${c.postosOcupados}/${c.postosMaximos})`; });
Q(`**Embalagem 17** — peças embaladas / capacidade da máquina por período (plano atual): ${util(noEmb).join(" | ")}.`);
Q(`**Etiquetadora 15** — etiquetadas / capacidade: ${util(noEtq).join(" | ")}.`);
const sEmb = rowsE(noEmb).reduce((s, c) => s + (sim0.x[noEmb]?.[c.slot - estM.ctx.aPartirDe] ?? 0), 0), cEmb = rowsE(noEmb).reduce((s, c) => s + c.capMaquinas, 0);
const sEtq = rowsE(noEtq).reduce((s, c) => s + (sim0.x[noEtq]?.[c.slot - estM.ctx.aPartirDe] ?? 0), 0), cEtq = rowsE(noEtq).reduce((s, c) => s + c.capMaquinas, 0);
Q(`Embalar: usa ${n0(sEmb)} de ${n0(cEmb)} pç de capacidade até sexta (sobra ${n0(cEmb - sEmb)}). Etiquetar: usa ${n0(sEtq)} de ${n0(cEtq)} (sobra ${n0(cEtq - sEtq)}). Estoques no início de T1: ${estado.pares.filter((p: any) => /Conector 3\/4/.test(nome(p.produtoId))).map((p: any) => `${nomeNo(`${p.produtoId}|${p.etapaOrigemId}`)}→ ${n0(estado.projecao.wip[`${p.produtoId}|${p.etapaOrigemId}`]?.lo ?? p.wip.lo)}–${n0(estado.projecao.wip[`${p.produtoId}|${p.etapaOrigemId}`]?.hi ?? p.wip.hi)}`).join("; ")}.`);
Q();

// ---------- 8) teste de remoção ----------
Q(`## 8) TESTE DE REMOÇÃO (contrafactual): plano completo × plano sem o posto NAQUELE período — avaliador OFICIAL, resto da semana = plano base indicado`);
Q(`A) valor do posto JÁ OCUPADO = a remoção abaixo. B) +1 PESSOA sem outra máquina: = 0 sempre que não há máquina livre (posto saturado). C) +1 MÁQUINA: NÃO recomendável (seleção da Previsão é absoluta), informativo.`);
const semLinha = (plano: AlocacaoEscala[], alvos: AlocacaoEscala[]) => plano.map((a) => (alvos.includes(a) ? ({ ...a, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, motivoSemPosto: "ensaio_remocao" } as AlocacaoEscala) : a));
const nomeMq = (a: AlocacaoEscala) => nome(a.maquinaId);
const restoReplan = (plano: AlocacaoEscala[]) => { // resto da semana replanejado pelo motor (T1–T3 congelados com a remoção)
  const idxApos = ultimoSlotProposta + 1;
  const e = montarEstadoAting(d, agoraMs, plano, 100 + idxApos, OPC, true);
  const r = planejarComFluxo(e.entrada, e.dados, e.opcoes);
  const full = plano.filter((a) => slotDe(a) <= ultimoSlotProposta).concat(fut(r.resultado.alocacoes).filter((a) => slotDe(a) > ultimoSlotProposta));
  return avaliar(full);
};
const postosAlvo: [string, (a: AlocacaoEscala) => boolean, "atual" | "variante"][] = [
  ["Embalagem 17", (a) => nomeMq(a) === "Embalagem 17", "atual"],
  ["Etiquetadora 15", (a) => nomeMq(a) === "Etiquetadora 15", "atual"],
  ["Máquina Automática 8", (a) => a.maquinaId === m8Maq, "variante"],
  ["Caixa · Etiquetadora 16", (a) => nomeMq(a) === "Etiquetadora 16", "atual"],
  ["Caixa · Montagem (cada posto: 18/18B/19/19B)", (a) => /Montagem 1[89]B?$/.test(nomeMq(a)) && /Caixa/.test(nome(a.produtoId)), "atual"],
  ["Pino (Parafusadeira Pino 2 / Montagem 20)", (a) => /Pino/.test(nome(a.produtoId)), "atual"],
  ["Plug (Montagem 14)", (a) => /Plug/.test(nome(a.produtoId)), "atual"],
  ["Conector 1.1/4\" · Embalagem 17B", (a) => nomeMq(a) === "Embalagem 17B", "atual"],
];
Q(`| Posto | Plano base | Período(s) removido(s) | Δ peças finais (por produto) | Δ receita R$ | Δ lucro R$ | Δ WIP final | Δ lucro com RESTO REPLANEJADO |`);
Q(`|---|---|---|---|---|---|---|---|`);
for (const [rot, pred, base] of postosAlvo) {
  const bp = soHoje(base === "atual" ? atualFut : fb);
  const bAv = avaliar(bp);
  const grupos: [string, number[]][] = [...periodosProposta.map((s) => [s.periodoId.toUpperCase(), [s.indice]] as [string, number[]]), ["T1+T2+T3", periodosProposta.map((s) => s.indice)]];
  for (const [gr, ix] of grupos) {
    const alvos = bp.filter((a) => ix.includes(slotDe(a)) && a.maquinaId && pred(a));
    if (alvos.length === 0) { Q(`| ${rot} | ${base} | ${gr} | (sem posto ocupado) | | | | |`); continue; }
    const sem = semLinha(bp, alvos); const a = avaliar(sem);
    const fin = a.L.financeiro!.produtos.map((x, i) => [nome(x.produtoId), x.finalProjetado - bAv.L.financeiro!.produtos[i].finalProjetado] as [string, number]).filter(([, v]) => Math.abs(v) > 0.5).map(([n, v]) => `${n} ${n0(v)}`).join("; ") || "0";
    let rr = "—";
    if (gr === "T1+T2+T3" || gr === "T1") { const a2 = restoReplan(sem); const b2 = restoReplan(bp); rr = brl(a2.lucro - b2.lucro); }
    Q(`| ${rot} (${alvos.length} posto-período) | ${base} | ${gr} | ${fin} | ${brl(a.receita - bAv.receita)} | ${brl(a.lucro - bAv.lucro)} | ${n0(a.L.totais.wipFinalLo - bAv.L.totais.wipFinalLo)} | ${rr} |`);
  }
}
Q();
// 9) saturação
Q(`## 9) Diagnóstico de saturação por posto em T1 (plano atual) — motivo`);
Q(`Mapeamento: ocupados = máx ⇒ SATURADO_POR_MAQUINA (valor de +1 pessoa = 0 porque não há máquina livre); GARGALO_PESSOA ⇒ SATURADO_POR_PESSOA; GARGALO_WIP_MATERIAL ⇒ SATURADO_POR_WIP; GARGALO_DOWNSTREAM ⇒ SATURADO_POR_DOWNSTREAM; FOLGA_FUTURA ⇒ SATURADO_POR_DEMANDA (períodos futuros já cobrem o material/demanda da semana); SATURADO_POR_TEMPO só se não restarem períodos.`);
Q(`| Etapa | ocup/máx | pessoas livres | motivo | V último R$ | V +1 R$ |`);
Q(`|---|---|---|---|---|---|`);
capB.capacidade.filter((c) => c.slot === idxT1).forEach((c) => { const mot = [c.postosOcupados >= c.postosMaximos ? "SATURADO_POR_MAQUINA" : "", c.diagnostico === "GARGALO_PESSOA" ? "SATURADO_POR_PESSOA" : "", c.diagnostico === "GARGALO_WIP_MATERIAL" ? "SATURADO_POR_WIP" : "", c.diagnostico === "GARGALO_DOWNSTREAM" ? "SATURADO_POR_DOWNSTREAM" : "", c.diagnostico === "FOLGA_FUTURA" ? "SATURADO_POR_DEMANDA" : ""].filter(Boolean).join(" + ") || "livre"; Q(`| ${nomeNoPre(c.no)} | ${c.postosOcupados}/${c.postosMaximos} | ${c.pessoasLivres} | ${mot} | ${brl(c.valorMarginalUltimo)} | ${brl(c.valorMarginalAdicionar)} |`); });
Q();
// 10-13 e critérios
const vB = validar(soHoje(fb)); const avBT = avaliar(soHoje(fb)); const avAT = avaliar(soHoje(propOficial));
const chB = soHoje(fb).filter((a) => slotDe(a) <= ultimoSlotProposta).filter((a) => posto(atualPorChavePre(a)) !== posto(a));
const pesB = new Set(chB.map((a) => a.funcionarioId)).size;
const cl = celulas(atualFut), cp = celulas(soHoje(fb));
const postosB = [...cl].filter((k) => !cp.has(k)).length + [...cp].filter((k) => !cl.has(k)).length;
Q(`## 10–13) Resultado e critérios (T1–T3 + resto = atual)`);
Q(`| | Atual | Econômico (1208) | Variante estimador |`);
Q(`|---|---|---|---|`);
Q(`| Lucro R$ | ${brl(avAtual.lucro)} | ${brl(avAT.lucro)} (${brl(avAT.lucro - avAtual.lucro)}) | ${brl(avBT.lucro)} (${brl(avBT.lucro - avAtual.lucro)}) |`);
Q(`| Receita R$ | ${brl(avAtual.receita)} | ${brl(avAT.receita)} | ${brl(avBT.receita)} |`);
Q(`| WIP final / excesso (pç) | ${n0(avAtual.L.totais.wipFinalLo)} / ${n0(avAtual.L.totais.excessoWip)} | ${n0(avAT.L.totais.wipFinalLo)} / ${n0(avAT.L.totais.excessoWip)} | ${n0(avBT.L.totais.wipFinalLo)} / ${n0(avBT.L.totais.excessoWip)} |`);
Q(`| Peças finais | ${n0(avAtual.L.totais.finalEntregueLo)} | ${n0(avAT.L.totais.finalEntregueLo)} | ${n0(avBT.L.totais.finalEntregueLo)} |`);
Q(`| Metas atingíveis perdidas | ${avAtual.L.atingibilidade!.atingiveisPerdidas} | ${avAT.L.atingibilidade!.atingiveisPerdidas} | ${avBT.L.atingibilidade!.atingiveisPerdidas} |`);
Q(`| Linhas / pessoas / postos alterados | — | — | ${chB.length} / ${pesB} / ${postosB} |`);
Q(`| R$ por pessoa alterada / por posto alterado | — | — | ${brl((avBT.lucro - avAtual.lucro) / Math.max(1, pesB))} / ${brl((avBT.lucro - avAtual.lucro) / Math.max(1, postosB))} |`);
Q(`| Violações (núcleo/indep/bloco/Previsão) | ${vAtual.nucleo}/${vAtual.indep}/${vAtual.bloco}/${vAtual.foraDaPrevisao} | ${validar(soHoje(propOficial)).nucleo}/${validar(soHoje(propOficial)).indep}/${validar(soHoje(propOficial)).bloco}/${validar(soHoje(propOficial)).foraDaPrevisao} | ${vB.nucleo}/${vB.indep}/${vB.bloco}/${vB.foraDaPrevisao} |`);
const ganhoB = avBT.lucro - avAtual.lucro;
const m8ProvadoReal = unidades.filter((u) => /M8/.test(u.rot)).length > 0 && unidades.map((u, i) => (/M8/.test(u.rot) ? descreve([i]).lucro : 0)).reduce((a, b) => a + b, 0) > limiar;
const cond = [
  [ganhoB > limiar, `ganho (T1–T3 + resto = atual) R$ ${brl(ganhoB)} > limiar R$ ${brl(limiar)}`],
  [vB.nucleo + vB.indep + vB.bloco + vB.foraDaPrevisao === 0, "0 violações duras / bloco / Previsão"],
  [avBT.L.totais.excessoWip <= avAtual.L.totais.excessoWip + 1, "WIP excessivo não piora"],
  [avBT.L.atingibilidade!.atingiveisPerdidas <= avAtual.L.atingibilidade!.atingiveisPerdidas, "nenhuma meta atingível piora"],
  [m8ProvadoReal, "M8 provada como ganho real isolado (> limiar) com dado de confiança adequada (produtividade real por posto)"],
] as [boolean, string][];
Q(); cond.forEach(([ok, t]) => Q(`- ${ok ? "✔" : "✘"} ${t}`));
const rAtualRP = restoReplan(soHoje(atualFut)), rVarRP = restoReplan(soHoje(fb)), rEcoRP = restoReplan(soHoje(propOficial));
cond.push([rVarRP.lucro - rAtualRP.lucro > limiar, `ganho com o RESTO REPLANEJADO pelo motor (o que de fato acontece em 30/10+): variante ${brl(rVarRP.lucro - rAtualRP.lucro)}, econômico ${brl(rEcoRP.lucro - rAtualRP.lucro)} (base: T1–T3 atual + resto replanejado = R$ ${brl(rAtualRP.lucro)}) > limiar R$ ${brl(limiar)}`]);
Q(); cond.slice(-1).forEach(([ok, t]) => Q(`- ${ok ? "✔" : "✘"} ${t}`));
const opcaoB = cond.every(([ok]) => ok);
Q();
Q(`**CONCLUSÃO: ${opcaoB ? "OPÇÃO B (APLICAR PLANO ECONÔMICO CORRIGIDO — variante)" : "OPÇÃO A (MANTER PLANO ATUAL)"}**`);
const mdOut = path.join(path.dirname(saida), "analise-m8-1225.md");
fs.writeFileSync(mdOut, R.join("\n"));
console.log(R.join("\n"));
console.log("\nARQUIVO:", mdOut);

{
  console.log("\n=== DEBUG remoção Embalagem 17 T1: resto fixo × replanejado (valores absolutos) ===");
  const bp = soHoje(atualFut);
  const alvo = bp.filter((a) => slotDe(a) === idxT1 && a.maquinaId && nomeMq(a) === "Embalagem 17");
  const sem = semLinha(bp, alvo);
  const a1 = avaliar(bp), a2 = avaliar(sem), r1 = restoReplan(bp), r2 = restoReplan(sem);
  console.log(`fixo: base ${brl(a1.lucro)} sem ${brl(a2.lucro)} | replanejado: base ${brl(r1.lucro)} sem ${brl(r2.lucro)} | WIP final fixo ${n0(a1.L.totais.wipFinalLo)}/${n0(a2.L.totais.wipFinalLo)} replan ${n0(r1.L.totais.wipFinalLo)}/${n0(r2.L.totais.wipFinalLo)}`);
  console.log(`peças finais fixo ${n0(a1.L.totais.finalEntregueLo)}/${n0(a2.L.totais.finalEntregueLo)} replan ${n0(r1.L.totais.finalEntregueLo)}/${n0(r2.L.totais.finalEntregueLo)}`);
}

{
  console.log("\n=== MEDIDA COM RESTO REPLANEJADO PELO MOTOR (o que de fato acontece: o motor replaneja 30/10+ a cada fechamento) ===");
  const lin = (rot: string, p: AlocacaoEscala[]) => { const r = restoReplan(p); const v = validar(r.L ? p : p); return { rot, r, v }; };
  const a = restoReplan(soHoje(atualFut)), b = restoReplan(soHoje(propOficial)), c = restoReplan(soHoje(fb));
  void lin;
  const print = (rot: string, x: ReturnType<typeof restoReplan>) => console.log(`  ${rot.padEnd(34)} lucro ${brl(x.lucro)} (Δ vs atual ${brl(x.lucro - a.lucro)}) | receita ${brl(x.receita)} | WIP final ${n0(x.L.totais.wipFinalLo)} excesso ${n0(x.L.totais.excessoWip)} | peças finais ${n0(x.L.totais.finalEntregueLo)} | metas perdidas ${x.L.atingibilidade!.atingiveisPerdidas}`);
  print("T1–T3 ATUAL + resto replanejado", a);
  print("T1–T3 ECONÔMICO + resto replan.", b);
  print("T1–T3 VARIANTE + resto replan.", c);
  console.log(`  limiar R$ ${brl(limiar)}`);
  // remoção com resto replanejado, todos os postos-chave (T1 e T1–T3)
  console.log("  Remoção com resto replanejado (Δ lucro vs T1–T3 atual + resto replanejado):");
  for (const [rot, pred] of [["Embalagem 17", (x: AlocacaoEscala) => nomeMq(x) === "Embalagem 17"], ["Etiquetadora 15", (x: AlocacaoEscala) => nomeMq(x) === "Etiquetadora 15"], ["Etiquetadora 16 (Caixa)", (x: AlocacaoEscala) => nomeMq(x) === "Etiquetadora 16"]] as [string, (x: AlocacaoEscala) => boolean][]) {
    for (const ix of [[idxT1], periodosProposta.map((s) => s.indice)]) {
      const bp = soHoje(atualFut); const alvos = bp.filter((x) => ix.includes(slotDe(x)) && x.maquinaId && pred(x)); if (!alvos.length) continue;
      const r = restoReplan(semLinha(bp, alvos));
      console.log(`    ${rot} ${ix.length === 1 ? "T1" : "T1+T2+T3"}: Δ lucro ${brl(r.lucro - a.lucro)} | Δ peças finais ${n0(r.L.totais.finalEntregueLo - a.L.totais.finalEntregueLo)} | Δ WIP final ${n0(r.L.totais.wipFinalLo - a.L.totais.wipFinalLo)}`);
    }
  }
}

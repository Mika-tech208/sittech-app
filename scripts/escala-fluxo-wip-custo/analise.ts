// Análise de custo operacional do WIP por par (aresta do grafo de fluxo) sobre um plano e um estado. SOMENTE LEITURA: reaproveita o simulador do núcleo
// (rodar/capsDoPlano) sem alterar nenhum comportamento da Escala. Nada aqui é específico de produto: tudo vem do grafo, das metas e das máquinas.
import { capsDoPlano, rodar, selecionarFuturas } from "@/features/escala/fluxo/avaliar";
import type { CtxFluxo } from "@/features/escala/fluxo/estado";
import { maquinaDisponivelNoSlot } from "@/features/escala/disponibilidade";
import { chavePool, type AlocacaoEscala, type PoolEscala } from "@/features/escala/types";
import type { EstadoAgora } from "./estado";
import { dataSP } from "./estado";

export const EPS = 1e-6;
/** Limiares de risco (documentados em docs/escala-fluxo-wip-custo.md). */
export const LIMIARES = {
  /** razão pico ÷ capacidade técnica de 1 dia do downstream: > médio => médio; > alto => alto */
  razaoDia: { medio: 0.5, alto: 1.0 },
  /** fila (pico ÷ consumo médio por hora útil) em múltiplos de turno (meio dia útil): > medio => médio; > alto => alto */
  filaTurnos: { medio: 1, alto: 2 },
  /** capacidade livre garantida ÷ pico: < folgado => médio ("ajustado"); < risco => alto */
  folga: { folgado: 1.5, risco: 1.0 },
  /** WIP "voltou a ~0" */
  fracaoZero: 0.05,
};

export interface PontoTraj { slot: number; rotulo: string; up: number; cons: number; hi: number; lo: number }

export interface AnalisePar {
  id: string; // id da aresta (nó origem)
  chavePar: string;
  rotulo: string;
  origemRotulo: string;
  destinoRotulo: string;
  membrosOrigem: string[];
  maquinasDown: string[];
  contagem: boolean;
  estadoAtual: { origem: string; confianca: string; fonte: string; lo: number; hi: number };
  w0: { lo: number; hi: number };
  prodUpPeriodo: number; // capacidade planejada média por período em que o upstream tem posto
  consDownPlanoPeriodo: number; // idem, downstream (plano)
  consDownTecnicoPeriodo: number; // máx. técnico: máquinas disponíveis × meta (média dos períodos restantes)
  capDiaTecnico: number;
  consDownRef: number; // o que serve de "capacidade de um período do downstream": plano se há, senão técnico
  consDownRefFonte: "plano" | "tecnico";
  wip0EmPeriodosUp: number;
  wip0EmPeriodosDown: number;
  picoDia: { hi: number; lo: number; rotulo: string; slot: number };
  picoSemana: { hi: number; lo: number; rotulo: string; slot: number };
  picoEmPeriodosUp: number;
  picoEmPeriodosDown: number;
  primeiroPostoDown: { slot: number; rotulo: string } | null;
  primeiroConsumo: { slot: number; rotulo: string } | null;
  saldoNoPrimeiroPostoDown: { hi: number; lo: number } | null;
  saldoInicialConsumido: { slot: number; rotulo: string; periodos: number; horas: number } | null;
  volta: { slot: number; rotulo: string; periodos: number; horas: number } | null; // null = não volta até sexta
  vemDeZero: boolean; // pico = 0
  livre: { teoricaTotal: number; estritaTotal: number; garantidaTotal: number; teoricaAposPico: number; estritaAposPico: number; garantidaAposPico: number; porSlot: { slot: number; rotulo: string; planejado: number; teorica: number; estrita: number; garantida: number }[] };
  razaoFolga: number | null; // ociosa (estrita) após o pico ÷ pico
  razaoFolgaGarantida: number | null; // limitada por pessoas sem posto
  razaoFolgaTeorica: number | null;
  risco: { nivel: "baixo" | "medio" | "alto"; nivelFisico: "baixo" | "medio" | "alto"; nivelFolga: "folgado" | "ajustado" | "risco"; razaoDia: number; filaHoras: number; filaTurnos: number; folga: number | null; motivos: string[] };
  traj: PontoTraj[]; // do primeiro slot aberto até sexta
  demandaRestanteDestino: number;
  consumoMedioPorHora: number;
  limites: { nome: string; valor: number; picoSemana: number; ok: boolean; excesso: number; excessoPct: number }[];
}

const r0 = (v: number) => Math.round(v);
const rot = (e: EstadoAgora, t: number) => {
  const s = e.slots[t];
  const h = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
  return `${s.data.slice(8)}/${s.data.slice(5, 7)} ${s.periodoId.toUpperCase()} ${h(s.inicioMin)}`;
};
const duracaoH = (e: EstadoAgora, t: number) => (e.slots[t].fimMs - e.slots[t].inicioMs) / 3600_000;
const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

export interface Nomeador { produto(id: string): string; etapa(id: string): string; maquina(id: string): string }

/** Tipo de linha de pessoas sem posto, por slot (a pessoa existe no plano mas sem máquina): capacidade humana disponível para absorver WIP. */
function pessoasLivresPorSlot(e: EstadoAgora, plano: AlocacaoEscala[]): number[] {
  const n = e.slots.length;
  const idx = new Map(e.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const v = new Array(n).fill(0);
  plano.forEach((a) => { const t = idx.get(`${a.data}|${a.periodoId}`); if (t !== undefined && !a.maquinaId) v[t] += 1; });
  return v;
}

export function analisarPlano(e: EstadoAgora, plano: AlocacaoEscala[], nm: Nomeador, opts: { limitesHoras?: number[] } = {}): AnalisePar[] {
  const ctx: CtxFluxo = e.ctx;
  const T = e.slots.length;
  const A = e.aPartirDe;
  const futuras = selecionarFuturas(ctx, plano);
  const caps = capsDoPlano(ctx, futuras);
  const livresPessoas = pessoasLivresPorSlot(e, plano);
  const ocupadas: Set<string>[] = e.slots.map(() => new Set<string>());
  const idx = new Map(e.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  plano.forEach((a) => { const t = idx.get(`${a.data}|${a.periodoId}`); if (t !== undefined && a.maquinaId) ocupadas[t].add(a.maquinaId); });
  const diaRef = dataSP(e.agoraMs);
  const slotsPorDia = T / new Set(e.slots.map((s) => s.data)).size;
  const horasDia = Array.from(new Set(e.slots.map((s) => s.data))).map((d) => e.slots.filter((s) => s.data === d).reduce((a, s) => a + (s.fimMs - s.inicioMs) / 3600_000, 0));
  const horasTurno = media(horasDia) / 2;
  const out: AnalisePar[] = [];

  const poolsDoNo = (n: string) => ctx.grafo.nos[n].membros.map((m) => ctx.poolsPorChave.get(m) as PoolEscala);
  const maqsDoNo = (n: string) => [...new Set(poolsDoNo(n).flatMap((p) => p.maquinasIds))].sort();
  const muNo = (n: string, t: number) => Math.max(...poolsDoNo(n).map((p) => (p.metas[e.slots[t].periodoId] ?? 0) * (ctx.fator[chavePool(p.produtoId, p.etapaId)] ?? 1)), 0);

  ctx.grafo.grupos.forEach((g, gi) => {
    const hiR = rodar(ctx, gi, caps, "hi", undefined, true);
    const loR = rodar(ctx, gi, caps, "lo", undefined, true);
    g.arestas.forEach((eid) => {
      const ar = ctx.grafo.arestas[eid];
      const orig = ar.origem;
      const dest = ar.destino;
      const w0hi = Math.max(0, ctx.iniAPartirDe.hi.W0[eid] ?? 0);
      const w0lo = Math.max(0, ctx.iniAPartirDe.lo.W0[eid] ?? 0);
      const n = T - A;
      const Whi = [w0hi, ...hiR.traj[eid]]; // índice i: fim do slot A+i-1 (0 = início de A)
      const Wlo = [w0lo, ...loR.traj[eid]];
      const upX = hiR.x[orig] ?? [];
      const cons: number[] = [];
      for (let i = 0; i < n; i++) cons.push(Math.max(0, Whi[i] + (upX[i] ?? 0) - Whi[i + 1]));
      const capUp = (t: number) => (caps[orig]?.base[t] ?? 0) + (caps[orig]?.adic[t] ?? 0);
      const capDn = (t: number) => (caps[dest]?.base[t] ?? 0) + (caps[dest]?.adic[t] ?? 0);
      const upSlots = Array.from({ length: n }, (_, i) => A + i).filter((t) => capUp(t) > EPS);
      const dnSlots = Array.from({ length: n }, (_, i) => A + i).filter((t) => capDn(t) > EPS);
      const prodUp = media(upSlots.map(capUp));
      const consPlano = media(dnSlots.map(capDn));
      // técnico do downstream
      const maqD = maqsDoNo(dest);
      const tec = (t: number) => maqD.filter((m) => maquinaDisponivelNoSlot(ctx.entrada, m, e.slots[t])).length * muNo(dest, t);
      const tecSlots = Array.from({ length: n }, (_, i) => A + i).map(tec).filter((v) => v > EPS);
      const consTec = media(tecSlots);
      const consRef = consPlano > EPS ? consPlano : consTec;
      // pico
      const pico = (ate: number) => {
        let bi = 0;
        for (let i = 0; i <= ate - A + 1 && i < Whi.length; i++) if (Whi[i] > Whi[bi] + 1e-9) bi = i;
        return { hi: Whi[bi], lo: Wlo[Math.min(bi, Wlo.length - 1)], slot: A + bi - 1, rotulo: bi === 0 ? `agora (início de ${rot(e, A)})` : `fim de ${rot(e, A + bi - 1)}` };
      };
      const ultDia = Math.max(A - 1, ...e.slots.filter((s) => s.data === diaRef).map((s) => s.indice));
      const picoDia = pico(ultDia);
      const picoSem = pico(T - 1);
      const peakIdx = picoSem.slot - A + 1; // índice em Whi
      // marcos
      const tFirstDn = dnSlots.length ? dnSlots[0] : null;
      const tFirstCons = (() => { const i = cons.findIndex((v) => v > 1); return i >= 0 ? A + i : null; })();
      const saldoPrimeiro = tFirstDn === null ? null : { hi: Whi[tFirstDn - A], lo: Wlo[tFirstDn - A] };
      let cum = 0;
      let consumido: AnalisePar["saldoInicialConsumido"] = null;
      if (w0hi > 1) for (let i = 0; i < n; i++) { cum += cons[i]; if (cum >= w0hi - 1) { const t = A + i; consumido = { slot: t, rotulo: `fim de ${rot(e, t)}`, periodos: i + 1, horas: e.slots.slice(A, t + 1).reduce((a, s) => a + (s.fimMs - s.inicioMs) / 3600_000, 0) }; break; } }
      let volta: AnalisePar["volta"] = null;
      const vemDeZero = picoSem.hi <= 1;
      if (!vemDeZero) for (let i = Math.max(peakIdx, 1); i < Whi.length; i++) { if (Whi[i] <= LIMIARES.fracaoZero * picoSem.hi) { const t = A + i - 1; volta = { slot: t, rotulo: `fim de ${rot(e, t)}`, periodos: i, horas: e.slots.slice(A, t + 1).reduce((a, s) => a + (s.fimMs - s.inicioMs) / 3600_000, 0) }; break; } }
      // capacidade livre do downstream
      const porSlot: AnalisePar["livre"]["porSlot"] = [];
      let teT = 0, esT = 0, gaT = 0, teP = 0, esP = 0, gaP = 0;
      for (let t = A; t < T; t++) {
        const mu = muNo(dest, t);
        const disp = maqD.filter((m) => maquinaDisponivelNoSlot(ctx.entrada, m, e.slots[t]));
        const planejado = capDn(t);
        const teorica = Math.max(0, disp.length * mu - planejado);
        const idle = disp.filter((m) => !ocupadas[t].has(m)).length;
        const estrita = idle * mu;
        const garantida = Math.min(idle, livresPessoas[t]) * mu;
        porSlot.push({ slot: t, rotulo: rot(e, t), planejado, teorica, estrita, garantida });
        teT += teorica; esT += estrita; gaT += garantida;
        if (t >= picoSem.slot + 1) { teP += teorica; esP += estrita; gaP += garantida; }
      }
      const capDia = consTec * slotsPorDia;
      const pk = picoSem.hi;
      const horasAtivas = dnSlots.reduce((a, t) => a + duracaoH(e, t), 0);
      const consumoPorHora = horasAtivas > 0 ? dnSlots.reduce((a, t) => a + capDn(t), 0) / horasAtivas : consTec / Math.max(1e-9, media(e.slots.map((_, t) => duracaoH(e, t))));
      const filaH = consumoPorHora > 0 ? pk / consumoPorHora : Number.POSITIVE_INFINITY;
      const filaTurnos = filaH / horasTurno;
      const razaoDia = capDia > 0 ? pk / capDia : Number.POSITIVE_INFINITY;
      const folga = pk > 1 ? esP / pk : null; // capacidade OCIOSA (máquinas sem posto no plano, disponíveis) após o pico ÷ pico
      const motivos: string[] = [];
      let nivel = 0;
      let nivFis = 0;
      let nivFolga = 0;
      const sobe = (k: number, m: string, tipo: "fis" | "folga" = "fis") => { if (k > nivel) nivel = k; if (tipo === "fis" && k > nivFis) nivFis = k; if (tipo === "folga" && k > nivFolga) nivFolga = k; motivos.push(m); };
      if (pk > 1) {
        if (razaoDia > LIMIARES.razaoDia.alto) sobe(2, `pico = ${razaoDia.toFixed(2)} dia(s) de capacidade técnica do downstream (> ${LIMIARES.razaoDia.alto})`);
        else if (razaoDia > LIMIARES.razaoDia.medio) sobe(1, `pico = ${razaoDia.toFixed(2)} dia(s) de capacidade técnica (> ${LIMIARES.razaoDia.medio})`);
        if (filaTurnos > LIMIARES.filaTurnos.alto) sobe(2, `fila de ${filaH.toFixed(1)} h úteis = ${filaTurnos.toFixed(1)} turnos (> ${LIMIARES.filaTurnos.alto})`);
        else if (filaTurnos > LIMIARES.filaTurnos.medio) sobe(1, `fila de ${filaH.toFixed(1)} h úteis = ${filaTurnos.toFixed(1)} turno(s) (> ${LIMIARES.filaTurnos.medio})`);
        if (folga !== null && folga < LIMIARES.folga.risco) sobe(2, `capacidade ociosa pós-pico/pico = ${folga.toFixed(2)} (< ${LIMIARES.folga.risco})`, "folga");
        else if (folga !== null && folga < LIMIARES.folga.folgado) sobe(1, `capacidade ociosa pós-pico/pico = ${folga.toFixed(2)} (< ${LIMIARES.folga.folgado})`, "folga");
        if (volta === null) sobe(1, "não volta a ~0 até sexta");
      }
      // pares de estado atual (controlado/estimado)
      const membros = ctx.grafo.nos[orig].membros;
      const pares = ctx.pares.filter((p) => membros.includes(chavePool(p.produtoId, p.etapaOrigemId)));
      const conf = pares.length > 0 && pares.every((p) => p.origem === "confirmado");
      const piorConf = pares.some((p) => p.confianca === "baixa") ? "baixa" : pares.some((p) => p.confianca === "media") ? "media" : "alta";
      const fontes = [...new Set(pares.map((p) => p.fonteConfirmacao ?? (p.origem === "confirmado" ? "wip_controle" : "estimado")))].join("+");
      const temContagem = e.dados.contagensFisicas?.some((c) => membros.includes(chavePool(c.produtoId, c.etapaOrigemId))) ?? false;
      // demanda restante do destino e limites
      const dem = Math.max(0, ctx.grafo.nos[dest].quantidade - (ctx.iniAPartirDe.lo.B0[dest] ?? 0));
      const horasRestantes = e.slots.slice(A).reduce((a, s) => a + (s.fimMs - s.inicioMs) / 3600_000, 0);
      const lim: AnalisePar["limites"] = [];
      const addLim = (nome: string, valor: number) => lim.push({ nome, valor, picoSemana: pk, ok: pk <= valor + 1e-6, excesso: Math.max(0, pk - valor), excessoPct: valor > 0 ? Math.max(0, (pk - valor) / valor) * 100 : 0 });
      [1, 2, 3].forEach((x) => addLim(`${x} per. produção upstream`, x * prodUp));
      [1, 2, 3].forEach((x) => addLim(`${x} per. consumo downstream`, x * consRef));
      (opts.limitesHoras ?? [4, horasTurno, media(horasDia)]).forEach((h, i) => addLim(`fila ≤ ${i === 0 ? "4 h" : i === 1 ? "1 turno" : "1 dia"} (${h.toFixed(1)} h) × consumo médio`, h * consumoPorHora));
      [0.05, 0.1].forEach((p) => addLim(`${p * 100}% da demanda restante`, p * dem));
      void horasRestantes;
      const traj: PontoTraj[] = [];
      for (let i = 0; i < n; i++) traj.push({ slot: A + i, rotulo: rot(e, A + i), up: upX[i] ?? 0, cons: cons[i], hi: Whi[i + 1], lo: Wlo[i + 1] });
      const nomeNo = (id: string) => { const no = ctx.grafo.nos[id]; return nm.produto(no.produtoId) + (no.membros.length > 1 ? " (+ fundido)" : "") + " · " + nm.etapa(no.etapaId); };
      out.push({
        id: eid, chavePar: ar.chavePar, rotulo: `${nm.produto(ar.produtoId)}${ctx.grafo.nos[orig].membros.length > 1 ? " (conv.+autom.)" : ""}: ${nm.etapa(ar.etapaOrigemId)} → ${nm.etapa(ar.etapaSeguinteId)}`,
        origemRotulo: nomeNo(orig), destinoRotulo: nomeNo(dest), membrosOrigem: membros, maquinasDown: maqD.map(nm.maquina), contagem: temContagem,
        estadoAtual: { origem: conf ? "confirmado" : "estimado", confianca: piorConf, fonte: fontes || "estimado", lo: pares.reduce((a, p) => a + p.wip.lo, 0), hi: pares.reduce((a, p) => a + p.wip.hi, 0) },
        w0: { lo: w0lo, hi: w0hi }, prodUpPeriodo: prodUp, consDownPlanoPeriodo: consPlano, consDownTecnicoPeriodo: consTec, capDiaTecnico: capDia, consDownRef: consRef, consDownRefFonte: consPlano > EPS ? "plano" : "tecnico",
        wip0EmPeriodosUp: prodUp > EPS ? w0hi / prodUp : Number.POSITIVE_INFINITY, wip0EmPeriodosDown: consRef > EPS ? w0hi / consRef : Number.POSITIVE_INFINITY,
        picoDia, picoSemana: picoSem, picoEmPeriodosUp: prodUp > EPS ? pk / prodUp : Number.POSITIVE_INFINITY, picoEmPeriodosDown: consRef > EPS ? pk / consRef : Number.POSITIVE_INFINITY,
        primeiroPostoDown: tFirstDn === null ? null : { slot: tFirstDn, rotulo: rot(e, tFirstDn) }, primeiroConsumo: tFirstCons === null ? null : { slot: tFirstCons, rotulo: rot(e, tFirstCons) },
        saldoNoPrimeiroPostoDown: saldoPrimeiro, saldoInicialConsumido: consumido, volta, vemDeZero,
        livre: { teoricaTotal: teT, estritaTotal: esT, garantidaTotal: gaT, teoricaAposPico: teP, estritaAposPico: esP, garantidaAposPico: gaP, porSlot },
        razaoFolga: folga, razaoFolgaGarantida: pk > 1 ? gaP / pk : null, razaoFolgaTeorica: pk > 1 ? teP / pk : null,
        risco: { nivel: (["baixo", "medio", "alto"] as const)[nivel], nivelFisico: (["baixo", "medio", "alto"] as const)[nivFis], nivelFolga: (["folgado", "ajustado", "risco"] as const)[nivFolga], razaoDia, filaHoras: filaH, filaTurnos, folga, motivos },
        traj, demandaRestanteDestino: dem, consumoMedioPorHora: consumoPorHora, limites: lim,
      });
    });
  });
  return out;
}
export { r0 };

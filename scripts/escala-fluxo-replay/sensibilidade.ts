// Sensibilidade e robustez: nenhuma exceção quebra; piso 0 + diagnóstico; pureza (entrada/dados não mutados); serialização JSON; `desligado` (hooks ausentes) não muda nada.
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import { hashCanonico } from "@/features/escala/hashCanonico";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { executarCorteSombra } from "@/features/escala/sombraCorte";
import { paraParametrosCorte } from "@/features/escala/snapshotSombra";
import { chavePool } from "@/features/escala/types";
import { planejarComFluxo, estadoDaProducao } from "@/features/escala/fluxo";
import { apontamentos, decisoes, fechamentos, paradas, rodar } from "./comum";
import { montarCenario } from "./montar";
import { rodarCenario } from "./rodar";
import { PARES_LEGADO_PROD } from "./paresLegado";

const MIN = 60_000;

export function naoSerializavel(v: unknown, caminho = "$", achados: string[] = [], profundidade = 0): string[] {
  if (achados.length > 20 || profundidade > 40) return achados;
  if (v === undefined) { achados.push(`${caminho}: undefined`); return achados; }
  if (typeof v === "number" && !Number.isFinite(v)) { achados.push(`${caminho}: ${v}`); return achados; }
  if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") { achados.push(`${caminho}: ${typeof v}`); return achados; }
  if (v instanceof Map || v instanceof Set || v instanceof Date) { achados.push(`${caminho}: ${v.constructor.name}`); return achados; }
  if (Array.isArray(v)) { v.forEach((x, i) => naoSerializavel(x, `${caminho}[${i}]`, achados, profundidade + 1)); return achados; }
  if (v && typeof v === "object") {
    Object.entries(v as Record<string, unknown>).forEach(([k, x]) => {
      if (x === undefined) return; // chave com undefined some no JSON — aceitável em objetos
      naoSerializavel(x, `${caminho}.${k}`, achados, profundidade + 1);
    });
  }
  return achados;
}

export interface CasoSens { nome: string; ok: boolean; excecao?: string; detalhes: Record<string, unknown> }

function tentar(nome: string, fn: () => Record<string, unknown> & { ok?: boolean }): CasoSens {
  try { const { ok, ...det } = fn(); return { nome, ok: ok !== false, detalhes: det }; } catch (e) { return { nome, ok: false, excecao: (e as Error).stack?.split("\n").slice(0, 4).join(" | "), detalhes: {} }; }
}

export function sensibilidade(offset = 2): CasoSens[] {
  const casos: CasoSens[] = [];
  const alvos = [fechamentos.find((d) => d.data === "2026-10-27" && d.periodoId === "t1")!, fechamentos.find((d) => d.data === "2026-10-26" && d.periodoId === "t1")!, fechamentos.find((d) => d.data === "2026-10-27" && d.periodoId === "m3")!];
  for (const d of alvos) {
    const rot = `${d.data.slice(5)} ${d.periodoId}`;
    const slots = montarCenario(d, apontamentos).entrada.slots;
    const idx = (a: { data: string; periodoId: string }) => slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId);
    const c = d.entrada.c;
    const rodarCom = (nome: string, mod: (ap: ApontamentoReal[]) => ApontamentoReal[], agoraDelta = 0) => tentar(`${rot} · ${nome}`, () => {
      const ap = mod(apontamentos.map((a) => ({ ...a })));
      const cen = montarCenario(d, apontamentos, { offset, apontamentos: ap, paresLegado: PARES_LEGADO_PROD });
      cen.dados = { ...cen.dados, agoraMs: cen.dados.agoraMs + agoraDelta * MIN };
      const antes = hashCanonico({ e: cen.entrada, d: cen.dados });
      const r = rodarCenario(cen, paradas);
      const depois = hashCanonico({ e: cen.entrada, d: cen.dados });
      const st = r.res.diagnostico.estado;
      const codigos: Record<string, number> = {};
      [...st.diagnosticos, ...r.res.diagnostico.diagnosticos].forEach((x) => (codigos[x.codigo] = (codigos[x.codigo] ?? 0) + 1));
      const neg = st.pares.filter((p) => p.wip.lo < 0 || p.wip.hi < 0);
      const nan = naoSerializavel(r.res.diagnostico).slice(0, 5);
      return {
        ok: antes === depois && r.hashDeterminismoOk && neg.length === 0 && nan.length === 0 && r.viol.filter((v) => !v.aviso).length === 0,
        puro: antes === depois, determinismo: r.hashDeterminismoOk, wipNegativo: neg.length, naoSerializavel: nan, violacoes: r.viol.filter((v) => !v.aviso).length, codigos,
        faltaFluxo: [Math.round(r.avFluxo.totais.faltaFinalLo), Math.round(r.avFluxo.totais.faltaFinalHi)], faltaBase: [Math.round(r.avBaseRegenerado.totais.faltaFinalLo), Math.round(r.avBaseRegenerado.totais.faltaFinalHi)],
        celulasNaoConfirmadas: st.celulas.filter((x) => x.estado === "nao_confirmado").length, gargalos: r.res.diagnostico.antes.gargalosFluxo.length,
      };
    });
    casos.push(rodarCom("controle (dados reais)", (a) => a));
    casos.push(rodarCom("sem apontamento no período c", (a) => a.filter((x) => idx(x) !== c)));
    casos.push(rodarCom("sem apontamento nos 2 últimos períodos fechados", (a) => a.filter((x) => idx(x) < c - 1)));
    casos.push(rodarCom("sem NENHUM apontamento", () => []));
    casos.push(rodarCom("apontamento do período c atrasado (chega 90 min depois)", (a) => a.map((x) => (idx(x) === c ? { ...x, lancadoEmMs: d.corteMs + 90 * MIN } : x))));
    casos.push(rodarCom("apontamento atrasado COM relógio avançado (agora = corte + 120 min)", (a) => a.map((x) => (idx(x) === c ? { ...x, lancadoEmMs: d.corteMs + 90 * MIN } : x)), 120));
    casos.push(rodarCom("lançamento tardio do período c−1 (chega depois do fechamento)", (a) => a.map((x) => (idx(x) === c - 1 ? { ...x, lancadoEmMs: d.corteMs - 5 * MIN } : x))));
    casos.push(rodarCom("refugo > produzido na etapa final (boas negativas brutas)", (a) => a.map((x) => (x.status === "produzindo" && idx(x) === c ? { ...x, boas: -Math.abs(x.boas) - 100, refugo: x.refugo + 5000 } : x))));
    casos.push(rodarCom("saldo negativo: etapa seguinte aponta 5× mais que a anterior", (a) => a.map((x) => (x.status === "produzindo" && x.etapaId && x.produtoId && idx(x) <= c && /^(f75cc037|b3db9629|78aaa207|1863b452)/.test(x.etapaId) ? { ...x, boas: x.boas * 5 } : x))));
    casos.push(rodarCom("apontamento em máquina fora do plano", (a) => a.map((x, i) => (x.status === "produzindo" && idx(x) === c && i % 7 === 0 ? { ...x, maquinaId: "00000000-0000-0000-0000-00000000dead" } : x))));
    casos.push(rodarCom("todos sem_producao falta_material no período c", (a) => a.map((x) => (idx(x) === c ? { ...x, status: "sem_producao" as const, motivo: "falta_material", boas: 0, refugo: 0 } : x))));
    casos.push(rodarCom("motivo sem_programacao (valor real fora da spec)", (a) => a.map((x) => (idx(x) === c && x.status === "sem_producao" ? { ...x, motivo: "sem_programacao" } : x))));
  }
  // `desligado`: o núcleo não lê a flag; "desligado" = chamador não usa o fluxo. Prova: motor oficial sem hooks idêntico, e todos os hashes gravados reproduzidos.
  casos.push(tentar("desligado · golden-master: 36/36 decisões reproduzem hash gravado (motor modificado pelo núcleo)", () => {
    let ok = 0; const falhas: string[] = [];
    decisoes.forEach((d) => { const r = executarCorteSombra(paraParametrosCorte(d.entrada)); const hs = hashAlocacoes([...r.horizonte.comprometidas, ...r.horizonte.alteravel]); if (r.hashDecisao === d.hashDecisao && hs === d.hashPlanoSombra) ok++; else falhas.push(d.id.slice(0, 8)); });
    return { ok: ok === decisoes.length, reproduzidas: ok, total: decisoes.length, falhas };
  }));
  casos.push(tentar("desligado · gerarEscala com hooks undefined explícitos == sem os campos (todos os cenários)", () => {
    const falhas: string[] = [];
    fechamentos.forEach((d) => { const cen = montarCenario(d, apontamentos); const a = hashAlocacoes(gerarEscala(cen.entrada).alocacoes); const b = hashAlocacoes(gerarEscala({ ...cen.entrada, remPorPool: undefined, ordemPostos: undefined, bonusContinuidade: undefined }).alocacoes); if (a !== b) falhas.push(d.id.slice(0, 8)); });
    return { ok: falhas.length === 0, falhas };
  }));
  casos.push(tentar("desligado · hooks vazios ({}) não alteram o plano (remPorPool/ordemPostos/bonus vazios)", () => {
    const falhas: string[] = [];
    fechamentos.forEach((d) => { const cen = montarCenario(d, apontamentos); const a = hashAlocacoes(gerarEscala(cen.entrada).alocacoes); const b = hashAlocacoes(gerarEscala({ ...cen.entrada, remPorPool: {}, ordemPostos: { valorMarginal: {} }, bonusContinuidade: {} }).alocacoes); if (a !== b) falhas.push(d.id.slice(0, 8)); });
    return { ok: falhas.length === 0, falhas };
  }));
  // robustez de entrada degenerada
  casos.push(tentar("entrada degenerada: aPartirDe = fim da semana (nada mutável)", () => {
    const d = fechamentos[fechamentos.length - 1]; const cen = montarCenario(d, apontamentos, { offset: 99, paresLegado: PARES_LEGADO_PROD });
    const r = planejarComFluxo(cen.entrada, cen.dados, cen.opcoes); return { ok: r.resultado.alocacoes.length === 0, linhas: r.resultado.alocacoes.length, plano: r.diagnostico.planoEscolhido };
  }));
  casos.push(tentar("entrada degenerada: sem pools", () => {
    const d = fechamentos[3]; const cen = montarCenario(d, apontamentos); const r = planejarComFluxo({ ...cen.entrada, pools: [] }, cen.dados, {}); return { ok: true, linhas: r.resultado.alocacoes.length };
  }));
  casos.push(tentar("entrada degenerada: sem funcionários", () => {
    const d = fechamentos[3]; const cen = montarCenario(d, apontamentos); const r = planejarComFluxo({ ...cen.entrada, funcionarios: [] }, cen.dados, {}); return { ok: true, linhas: r.resultado.alocacoes.length };
  }));
  casos.push(tentar("entrada degenerada: quantidade prevista 0 em todos os pools", () => {
    const d = fechamentos[3]; const cen = montarCenario(d, apontamentos); const r = planejarComFluxo({ ...cen.entrada, pools: cen.entrada.pools.map((p) => ({ ...p, quantidade: 0 })) }, cen.dados, {}); return { ok: true, linhas: r.resultado.alocacoes.length, plano: r.diagnostico.planoEscolhido };
  }));
  casos.push(tentar("estadoDaProducao isolado em todos os cortes (sem lançar)", () => {
    let n = 0; fechamentos.forEach((d) => { const cen = montarCenario(d, apontamentos, { paresLegado: PARES_LEGADO_PROD }); estadoDaProducao(cen.entrada, cen.dados, cen.opcoes); n++; }); return { ok: true, n };
  }));
  void chavePool; void rodar;
  return casos;
}

// Executa UM cenário: planejarComFluxo (duas vezes → determinismo), avaliação do plano vigente e do plano de fluxo pelo MESMO avaliarPlano,
// verificação independente (A–D), churn independente. Tudo serializável (vai para out/*.json).
import { avaliarPlano, planejarComFluxo, verificarRestricoesDuras, type AvaliacaoPlano, type ResultadoFluxo, type OpcoesFluxo } from "@/features/escala/fluxo";
import { hashCanonico } from "@/features/escala/hashCanonico";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { gerarEscala } from "@/features/escala/gerarEscala";
import type { AlocacaoEscala, EntradaEscala } from "@/features/escala/types";
import { boasPorPool, restantePorPool, visivelNoCorte } from "@/features/escala/producaoReal";
import { faltaProjetada, projetarProducao } from "@/features/escala/execucao";
import { chavePool } from "@/features/escala/types";
import type { Cenario } from "./montar";
import { simularIndependente, type ResultadoSimInd } from "./simIndependente";
import { churnIndependente, verificarIndependente, type ViolacaoInd } from "./independente";
import type { Parada } from "./dados";

export interface Rodada {
  cen: Cenario;
  ms: number;
  res: ResultadoFluxo;
  hashResultado: string; // hash do ResultadoFluxo inteiro (determinismo)
  hashDeterminismoOk: boolean;
  hashPlanoFluxo: string;
  planoFluxoFuturo: AlocacaoEscala[];
  avVigente: AvaliacaoPlano;
  avFluxo: AvaliacaoPlano;
  avBase: AvaliacaoPlano; // avaliação do plano base feita pelo próprio núcleo (diagnostico.avaliacaoBase)
  baseRegenerado: AlocacaoEscala[]; // gerarEscala(entrada) sem hooks = o que o motor oficial geraria agora
  avBaseRegenerado: AvaliacaoPlano;
  alertas: { base: Record<string, number>; fluxo: Record<string, number> }; // alertas do motor por tipo (efeito para quem opera a Escala)
  viol: ViolacaoInd[];
  violNucleo: ReturnType<typeof verificarRestricoesDuras>;
  violNucleoPlanoCompleto: ReturnType<typeof verificarRestricoesDuras>; // inclui o passado congelado (informativo)
  simInd: { vigente: ResultadoSimInd; fluxo: ResultadoSimInd; baseRegen: ResultadoSimInd }; // simulador INDEPENDENTE (sinal)
  faltaLegada: { vigente: number; fluxo: number; baseRegen: number }; // régua LEGADA de produção (execucao.faltaProjetada) — verificação cruzada do simulador
  churnVsVigente: ReturnType<typeof churnIndependente>;
  churnVsBase: ReturnType<typeof churnIndependente>;
  churnBaseVsVigente: ReturnType<typeof churnIndependente>; // o que o motor OFICIAL (regenerado) já muda sozinho — linha de base do churn
  erro?: string;
}

const semFuturo = (a: AlocacaoEscala[], ap: number, entrada: EntradaEscala) => {
  const idx = new Map(entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  return a.filter((x) => (idx.get(`${x.data}|${x.periodoId}`) ?? -1) >= ap);
};

export function rodarCenario(cen: Cenario, paradas: Parada[] = [], opcoesExtra: Partial<OpcoesFluxo> = {}, verificarDeterminismo = true): Rodada {
  const opcoes = { ...cen.opcoes, ...opcoesExtra };
  const t0 = Date.now();
  const res = planejarComFluxo(cen.entrada, cen.dados, opcoes);
  const ms = Date.now() - t0;
  const hashResultado = hashCanonico(res);
  const hashDeterminismoOk = verificarDeterminismo ? hashCanonico(planejarComFluxo(cen.entrada, cen.dados, opcoes)) === hashResultado : true;
  const futuras = res.resultado.alocacoes;
  const planoFluxoCompleto = [...cen.entrada.congeladas, ...semFuturo(futuras, cen.aPartirDe, cen.entrada)];
  const avFluxo = avaliarPlano(cen.entrada, cen.dados, planoFluxoCompleto, opcoes);
  const avVigente = avaliarPlano(cen.entrada, cen.dados, cen.planoVigente, opcoes);
  const avBase = res.diagnostico.avaliacaoBase;
  const viol = verificarIndependente(cen.entrada, futuras, { paradasReais: paradas, planoVigente: cen.planoVigente });
  const violNucleo = verificarRestricoesDuras(cen.entrada, futuras);
  const violNucleoPlanoCompleto = verificarRestricoesDuras(cen.entrada, planoFluxoCompleto);
  const vigFut = semFuturo(cen.planoVigente, cen.aPartirDe, cen.entrada);
  const churnVsVigente = churnIndependente(cen.entrada, futuras, vigFut);
  const baseRes = gerarEscala(cen.entrada);
  const baseRegenerado = semFuturo(baseRes.alocacoes, cen.aPartirDe, cen.entrada);
  const avBaseRegenerado = avaliarPlano(cen.entrada, cen.dados, [...cen.entrada.congeladas, ...baseRegenerado], opcoes);
  const churnVsBase = churnIndependente(cen.entrada, futuras, baseRegenerado);
  const churnBaseVsVigente = churnIndependente(cen.entrada, baseRegenerado, vigFut);
  const f = cen.opcoes.fatorPorPool ?? {};
  const idxS = new Map(cen.entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const comprometido = cen.entrada.congeladas.filter((a) => (idxS.get(`${a.data}|${a.periodoId}`) ?? -1) === cen.c + 1);
  const vigC = cen.planoVigente.filter((a) => (idxS.get(`${a.data}|${a.periodoId}`) ?? -1) >= cen.c + 1);
  const sim = (plano: AlocacaoEscala[]) => simularIndependente(cen.entrada, cen.dados.apontamentos, cen.dec.corteMs, cen.c + 1, plano, f);
  const simInd = { vigente: sim(vigC), fluxo: sim([...comprometido, ...futuras]), baseRegen: sim([...comprometido, ...baseRegenerado]) };
  const faltaLegada = faltaLegadaDe(cen, cen.planoVigente, futuras, baseRegenerado);
  const conta = (l: { tipo: string; quantidade?: number }[]) => { const o: Record<string, number> = {}; l.forEach((a) => (o[a.tipo] = (o[a.tipo] ?? 0) + 1)); return o; };
  const alertas = { base: conta(baseRes.alertas), fluxo: conta(res.resultado.alertas) };
  return { cen, ms, res, hashResultado, hashDeterminismoOk, hashPlanoFluxo: hashAlocacoes(futuras), planoFluxoFuturo: futuras, avVigente, avFluxo, avBase, baseRegenerado, avBaseRegenerado, alertas, viol, violNucleo, violNucleoPlanoCompleto, simInd, faltaLegada, churnVsVigente, churnVsBase, churnBaseVsVigente };
}

export const chaveP = chavePool;

// ---- régua legada (execucao.ts): restante REAL por pool (previsto − boas reais) × produção projetada das linhas de c+1 em diante ----
function faltaLegadaDe(cen: Cenario, vigente: AlocacaoEscala[], fluxo: AlocacaoEscala[], base: AlocacaoEscala[]) {
  const slots = cen.entrada.slots;
  const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const visiveis = visivelNoCorte(cen.dados.apontamentos, slots, cen.c, cen.dec.corteMs);
  const restante = restantePorPool(cen.entrada.pools, boasPorPool(visiveis));
  const f = cen.opcoes.fatorPorPool ?? {};
  const compr = cen.entrada.congeladas.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? -1) === cen.c + 1);
  const total = (linhas: AlocacaoEscala[]) => faltaProjetada(cen.entrada.pools, restante, projetarProducao(linhas, f)).total;
  return {
    vigente: total(vigente.filter((a) => (idx.get(`${a.data}|${a.periodoId}`) ?? -1) >= cen.c + 1)),
    fluxo: total([...compr, ...fluxo]),
    baseRegen: total([...compr, ...base]),
  };
}

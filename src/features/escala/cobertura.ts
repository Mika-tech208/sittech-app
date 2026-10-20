// Cobertura da equipe — diagnóstico PURO sobre a saída do motor da Escala.
//
// NÃO é um segundo algoritmo: nada aqui decide quem trabalha onde. O motor (gerarEscala)
// gera a escala; este módulo só CONTA, período a período, quantas pessoas ficaram sem
// posto e POR QUÊ, usando os mesmos dados de entrada e a mesma regra de disponibilidade
// de máquina. Os "recursos compatíveis" são verificados rodando o MESMO motor de novo.
//
// Causas (cada pessoa sem posto é atribuída a UMA, nesta ordem — as pessoas são
// intercambiáveis no motor, então a contagem por máquinas é exata):
//   A) carga ................ existe máquina SELECIONADA e livre, mas a quantidade programada
//                             (previsto + adicional) acabou — resolve programando mais peças;
//   B) maquina_nao_selecionada  não há máquina selecionada livre; mas há recurso COMPATÍVEL do
//                             roteiro (não selecionado na Previsão), livre, numa etapa que ainda
//                             teria trabalho — resolve selecionando mais postos;
//   C) recurso_indisponivel . a máquina que a etapa com trabalho usaria está indisponível
//                             (inativa, indisponível na Previsão ou bloqueada);
//   D) sem_recurso_compativel  nada acima se aplica (não há máquina possível).

import { maquinaDisponivelNoSlot } from "./disponibilidade";
import { gerarEscala } from "./gerarEscala";
import { EPS, metaNoSlot } from "./folga";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type PoolEscala, type ResultadoEscala } from "./types";

export type CausaOciosidade = "carga" | "maquina_nao_selecionada" | "recurso_indisponivel" | "sem_recurso_compativel";
export const CAUSAS: CausaOciosidade[] = ["carga", "maquina_nao_selecionada", "recurso_indisponivel", "sem_recurso_compativel"];

export type ContagemCausas = Record<CausaOciosidade, number>;

export interface CoberturaPeriodo {
  data: string;
  periodoId: string;
  minutos: number; // duração do período
  disponiveis: number; // pessoas disponíveis (linhas da escala)
  semPosto: number;
  causas: ContagemCausas; // pessoas sem posto por causa
  maquinasCompativeisLivres: string[]; // recursos compatíveis (não selecionados) livres que reduziriam a ociosidade (causa B)
}

export interface CoberturaDia {
  data: string;
  percentual: number;
  pessoasPeriodoSemPosto: number;
  minutosSemPosto: number;
  minutosDisponiveis: number;
  periodos: CoberturaPeriodo[];
}

export interface CoberturaSemana {
  percentual: number; // 0–100, ponderado por minutos; 100 quando ninguém estava disponível
  minutosDisponiveis: number;
  minutosSemPosto: number;
  horasSemPosto: number;
  pessoasPeriodoSemPosto: number;
  pessoasPeriodoTotal: number;
  porCausa: Record<CausaOciosidade, { pessoasPeriodo: number; minutos: number }>;
  dias: CoberturaDia[];
}

export interface CandidatoRecurso {
  maquinaId: string;
  frequencia: number; // períodos em que seria útil
  pools: string[]; // "produto|etapa" onde seria selecionado
}

function zeros(): ContagemCausas {
  return { carga: 0, maquina_nao_selecionada: 0, recurso_indisponivel: 0, sem_recurso_compativel: 0 };
}

export function analisarCobertura(entrada: EntradaEscala, resultado: ResultadoEscala): { cobertura: CoberturaSemana; candidatos: CandidatoRecurso[] } {
  const slots = entrada.slots.slice(entrada.aPartirDe);
  const pools = [...entrada.pools].sort((a, b) => (a.produtoId + a.etapaId < b.produtoId + b.etapaId ? -1 : 1));
  // etapas sem máquina selecionada: o motor não as simula, mas elas AINDA têm demanda — entram só como
  // "etapas que queriam máquina" (causa B), com o saldo do previsto intacto
  const poolsSemMaquina = [...(entrada.poolsSemMaquina ?? [])];
  const selecionadas = [...new Set(pools.flatMap((p) => p.maquinasIds))].sort();

  // saldos do previsto e do adicional no início do primeiro período mutável
  const rem = new Map<string, number>();
  const adic = new Map<string, number>();
  [...pools, ...poolsSemMaquina].forEach((p) => {
    rem.set(chavePool(p.produtoId, p.etapaId), Math.max(0, p.quantidade));
    adic.set(chavePool(p.produtoId, p.etapaId), Math.max(0, p.adicionalMax ?? 0));
  });
  const indice = new Map(entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  entrada.congeladas.forEach((a) => {
    const i = indice.get(`${a.data}|${a.periodoId}`);
    if (i === undefined || i >= entrada.aPartirDe || !a.maquinaId || !a.produtoId || !a.etapaId) return;
    const k = chavePool(a.produtoId, a.etapaId);
    if (rem.has(k)) rem.set(k, Math.max(0, (rem.get(k) as number) - a.pecas));
    if (adic.has(k)) adic.set(k, Math.max(0, (adic.get(k) as number) - (a.pecasAdicional ?? 0)));
  });

  const linhasPorSlot = new Map<string, AlocacaoEscala[]>();
  resultado.alocacoes.forEach((a) => {
    const k = `${a.data}|${a.periodoId}`;
    if (!linhasPorSlot.has(k)) linhasPorSlot.set(k, []);
    linhasPorSlot.get(k)!.push(a);
  });

  const candidatos = new Map<string, { frequencia: number; pools: Set<string> }>();
  const diasMap = new Map<string, CoberturaDia>();
  const porCausa: CoberturaSemana["porCausa"] = {
    carga: { pessoasPeriodo: 0, minutos: 0 },
    maquina_nao_selecionada: { pessoasPeriodo: 0, minutos: 0 },
    recurso_indisponivel: { pessoasPeriodo: 0, minutos: 0 },
    sem_recurso_compativel: { pessoasPeriodo: 0, minutos: 0 },
  };
  let minDisp = 0;
  let minSem = 0;
  let ppSem = 0;
  let ppTotal = 0;

  slots.forEach((slot) => {
    const linhas = linhasPorSlot.get(`${slot.data}|${slot.periodoId}`) ?? [];
    const minutos = slot.fimMin - slot.inicioMin;
    const disponiveis = linhas.length;
    const ociosos = linhas.filter((a) => !a.maquinaId).length;
    const usadas = new Set(linhas.filter((a) => a.maquinaId).map((a) => a.maquinaId as string));
    const causas = zeros();
    const compativeisLivres: string[] = [];

    if (ociosos > 0) {
      const disp = (m: string) => maquinaDisponivelNoSlot(entrada, m, slot);
      const livresSelecionadas = selecionadas.filter((m) => disp(m) && !usadas.has(m)).length;
      const a = Math.min(ociosos, livresSelecionadas);
      causas.carga = a;
      let resto = ociosos - a;

      // etapas que ainda queriam mais máquinas neste período (e não conseguiram)
      const insatisfeitos: PoolEscala[] = [...pools, ...poolsSemMaquina].filter((p) => {
        const mu = metaNoSlot(p, slot);
        if (mu <= 0) return false;
        const k = chavePool(p.produtoId, p.etapaId);
        const r = rem.get(k) as number;
        const ar = adic.get(k) as number;
        const doPool = linhas.filter((l) => l.maquinaId && l.produtoId === p.produtoId && l.etapaId === p.etapaId);
        const usadasPrev = doPool.filter((l) => !((l.pecasAdicional ?? 0) > 0)).length;
        const usadasAdic = doPool.length - usadasPrev;
        const quer = r > EPS ? Math.max(1, Math.ceil((r - EPS) / mu)) : 0;
        if (usadasPrev < quer) return true;
        const querAdic = ar > EPS ? Math.max(1, Math.ceil((ar - EPS) / mu)) : 0;
        return usadasAdic < querAdic;
      });

      if (resto > 0) {
        const compat = new Map<string, Set<string>>();
        insatisfeitos.forEach((p) => {
          (p.maquinasCompativeisIds ?? []).forEach((m) => {
            if (p.maquinasIds.includes(m) || !disp(m) || usadas.has(m)) return;
            if (!compat.has(m)) compat.set(m, new Set());
            compat.get(m)!.add(chavePool(p.produtoId, p.etapaId));
          });
        });
        const ids = [...compat.keys()].sort();
        const b = Math.min(resto, ids.length);
        causas.maquina_nao_selecionada = b;
        if (b > 0) {
          ids.forEach((m) => {
            compativeisLivres.push(m);
            const c = candidatos.get(m) ?? { frequencia: 0, pools: new Set<string>() };
            c.frequencia++;
            compat.get(m)!.forEach((k) => c.pools.add(k));
            candidatos.set(m, c);
          });
        }
        resto -= b;
      }
      if (resto > 0) {
        const indisponiveis = new Set<string>();
        insatisfeitos.forEach((p) => p.maquinasIds.forEach((m) => { if (!disp(m)) indisponiveis.add(m); }));
        const c = Math.min(resto, indisponiveis.size);
        causas.recurso_indisponivel = c;
        resto -= c;
      }
      causas.sem_recurso_compativel = resto;
    }

    // saldos para o próximo período: só o crédito do que foi alocado aqui
    linhas.forEach((l) => {
      if (!l.maquinaId || !l.produtoId || !l.etapaId) return;
      const k = chavePool(l.produtoId, l.etapaId);
      if (rem.has(k)) rem.set(k, Math.max(0, (rem.get(k) as number) - l.pecas));
      if (adic.has(k)) adic.set(k, Math.max(0, (adic.get(k) as number) - (l.pecasAdicional ?? 0)));
    });

    let dia = diasMap.get(slot.data);
    if (!dia) {
      dia = { data: slot.data, percentual: 100, pessoasPeriodoSemPosto: 0, minutosSemPosto: 0, minutosDisponiveis: 0, periodos: [] };
      diasMap.set(slot.data, dia);
    }
    dia.periodos.push({ data: slot.data, periodoId: slot.periodoId, minutos, disponiveis, semPosto: ociosos, causas, maquinasCompativeisLivres: compativeisLivres });
    dia.pessoasPeriodoSemPosto += ociosos;
    dia.minutosSemPosto += ociosos * minutos;
    dia.minutosDisponiveis += disponiveis * minutos;
    minDisp += disponiveis * minutos;
    minSem += ociosos * minutos;
    ppSem += ociosos;
    ppTotal += disponiveis;
    CAUSAS.forEach((c) => {
      porCausa[c].pessoasPeriodo += causas[c];
      porCausa[c].minutos += causas[c] * minutos;
    });
  });

  const dias = [...diasMap.values()];
  dias.forEach((d) => {
    d.percentual = d.minutosDisponiveis > 0 ? 100 * (1 - d.minutosSemPosto / d.minutosDisponiveis) : 100;
  });

  return {
    cobertura: {
      percentual: minDisp > 0 ? 100 * (1 - minSem / minDisp) : 100,
      minutosDisponiveis: minDisp,
      minutosSemPosto: minSem,
      horasSemPosto: minSem / 60,
      pessoasPeriodoSemPosto: ppSem,
      pessoasPeriodoTotal: ppTotal,
      porCausa,
      dias,
    },
    candidatos: [...candidatos.entries()]
      .map(([maquinaId, c]) => ({ maquinaId, frequencia: c.frequencia, pools: [...c.pools].sort() }))
      .sort((a, b) => b.frequencia - a.frequencia || (a.maquinaId < b.maquinaId ? -1 : 1)),
  };
}

export function calcularCobertura(entrada: EntradaEscala, resultado: ResultadoEscala): CoberturaSemana {
  return analisarCobertura(entrada, resultado).cobertura;
}

export interface RecursoSugerido {
  maquinaId: string;
  poolsAfetados: { produtoId: string; etapaId: string }[];
  ganhoMinutos: number; // minutos-pessoa que deixam de ficar sem posto se a máquina for selecionada (verificado pelo motor)
  ganhoHoras: number;
  ganhoPessoasPeriodo: number;
  coberturaApos: number; // % de cobertura se SOMENTE esta máquina for adicionada
  // Efeito REAL de uma máquina nova: a carga do previsto é finita (a máquina só antecipa o trabalho), então o
  // ganho aparece quando ela destrava carga adicional de produto acabado. Preenchido quando se pede sugestão.
  comCargaAdicional?: { pecas: number; coberturaApos: number; ganhoMinutosVsSugestao: number };
}

export interface RecursosVerificados {
  itens: RecursoSugerido[];
  // todos os recursos sugeridos juntos (o ganho de cada um isolado subestima o conjunto)
  combinado: { maquinas: string[]; ganhoMinutos: number; ganhoHoras: number; coberturaApos: number; comCargaAdicional?: { pecas: number; coberturaApos: number; ganhoMinutosVsSugestao: number } } | null;
}

export function comMaquinasAdicionadas(entrada: EntradaEscala, adicoes: Map<string, Set<string>>): EntradaEscala {
  // adicoes: "produto|etapa" -> máquinas a selecionar. Etapa sem máquina vira pool real com essas máquinas.
  const existentes = new Set(entrada.pools.map((p) => chavePool(p.produtoId, p.etapaId)));
  const promovidos = (entrada.poolsSemMaquina ?? []).filter((p) => adicoes.has(chavePool(p.produtoId, p.etapaId)) && !existentes.has(chavePool(p.produtoId, p.etapaId)));
  return {
    ...entrada,
    pools: [...entrada.pools, ...promovidos].map((p) => {
      const add = adicoes.get(chavePool(p.produtoId, p.etapaId));
      return add ? { ...p, maquinasIds: [...new Set([...p.maquinasIds, ...add])].sort() } : p;
    }),
    poolsSemMaquina: (entrada.poolsSemMaquina ?? []).filter((p) => !promovidos.includes(p)),
  };
}

// Verifica cada recurso compatível rodando o MESMO motor com a máquina adicionada às etapas
// onde ela seria útil. Nunca seleciona nada: devolve só a recomendação para o usuário decidir.
export function recursosCompativeisVerificados(
  entrada: EntradaEscala,
  cobertura: CoberturaSemana,
  candidatos: CandidatoRecurso[],
  limite = 12
): RecursosVerificados {
  const saida: RecursoSugerido[] = [];
  const escolhidos = candidatos.slice(0, limite);
  escolhidos.forEach((c) => {
    const nova = comMaquinasAdicionadas(entrada, new Map(c.pools.map((k) => [k, new Set([c.maquinaId])])));
    const cob = calcularCobertura(nova, gerarEscala(nova));
    const ganho = cobertura.minutosSemPosto - cob.minutosSemPosto;
    if (ganho <= 0) return;
    saida.push({
      maquinaId: c.maquinaId,
      poolsAfetados: c.pools.map((k) => {
        const [produtoId, etapaId] = k.split("|");
        return { produtoId, etapaId };
      }),
      ganhoMinutos: ganho,
      ganhoHoras: ganho / 60,
      ganhoPessoasPeriodo: cobertura.pessoasPeriodoSemPosto - cob.pessoasPeriodoSemPosto,
      coberturaApos: cob.percentual,
    });
  });
  const itens = saida.sort((a, b) => b.ganhoMinutos - a.ganhoMinutos || (a.maquinaId < b.maquinaId ? -1 : 1));

  let combinado: RecursosVerificados["combinado"] = null;
  if (itens.length > 1) {
    const adicoes = new Map<string, Set<string>>();
    escolhidos.filter((c) => itens.some((i) => i.maquinaId === c.maquinaId)).forEach((c) =>
      c.pools.forEach((k) => adicoes.set(k, new Set([...(adicoes.get(k) ?? []), c.maquinaId])))
    );
    const nova = comMaquinasAdicionadas(entrada, adicoes);
    const cob = calcularCobertura(nova, gerarEscala(nova));
    const ganho = cobertura.minutosSemPosto - cob.minutosSemPosto;
    if (ganho > 0) combinado = { maquinas: itens.map((i) => i.maquinaId), ganhoMinutos: ganho, ganhoHoras: ganho / 60, coberturaApos: cob.percentual };
  }
  return { itens, combinado };
}

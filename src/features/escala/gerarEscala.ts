// Motor da Escala de Produção — PURO, determinístico, sem I/O.
//
// Para cada slot (dia, período) a partir de `aPartirDe`, em ordem:
//   1. funcionários disponíveis (equipe produtiva sem ausência sobreposta);
//   2. postos candidatos = (máquina, pool) com demanda restante, máquina
//      disponível, MÁQUINA E PRODUTO SELECIONADOS NA PREVISÃO (nunca outra);
//   3. escolhe os K melhores postos (K = min(funcionários, postos válidos))
//      por: gargalo dinâmico / menor folga, maior valor, continuidade do
//      produto na máquina, ordem da etapa. A cobertura é decidida ANTES do
//      revezamento — por isso gargalo vence revezamento;
//   4. atribui pessoas a postos por min-cost assignment (húngaro): repetir a
//      operação do período anterior custa muito (quebrável: vira exceção
//      registrada), depois balanceamento secundário e minimizar mudanças;
//   5. sobra de pessoas => maquina nula + motivo_sem_posto obrigatório;
//   6. credita peças (meta do período específico), nunca acima do restante.
//
// Revezamento: usa exatamente operacao_id da etapa. M3 -> T1 vale; o
// primeiro slot de cada dia zera o histórico (T3 -> M1 reseta).

import { atribuicaoMinima } from "./matching";
import { calcularFolgas, EPS, metaNoSlot, type FolgaPool } from "./folga";
import { ContadoresEquidade } from "./equidade";
import { sobrepoe } from "./tempo";
import {
  chavePool, MOTIVO_DEMANDA_ESGOTADA, MOTIVO_JA_COBERTA, MOTIVO_POSTOS_OCUPADOS, MOTIVO_RECURSOS_INDISPONIVEIS,
  type AlertaEscala, type AlocacaoEscala, type EntradaEscala, type PoolEscala, type ResultadoEscala, type ResumoSlot, type SlotEscala,
} from "./types";

// Pesos do custo de atribuição (ordem de grandeza = ordem de prioridade):
// revezamento >> equidade histórica por operação >> por máquina (equidade.ts)
// > exposição à operação no dia > minimizar mudanças > equidade de ociosidade
// > mesma máquina em slots seguidos. (O gargalo vence tudo isso: ele decide
// QUAIS postos são cobertos, antes da atribuição de pessoas.)
const CUSTO_ROTACAO = 1_000_000_000;
const CUSTO_EXPOSICAO = 1_000;
const CUSTO_MUDANCA = 100;
const CUSTO_OCIO = 10;
const CUSTO_MESMA_MAQUINA = 1;

interface Par {
  m: string;
  pool: PoolEscala;
  chave: string;
  folga: FolgaPool;
  valorPosto: number;
  continuidade: number;
}

function porId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function comparar(a: Par, b: Par): number {
  if (a.folga.gargalo !== b.folga.gargalo) return a.folga.gargalo ? -1 : 1;
  const df = a.folga.folgaPeriodos - b.folga.folgaPeriodos;
  if (Math.abs(df) > 1e-9) return df < 0 ? -1 : 1;
  if (Math.abs(a.valorPosto - b.valorPosto) > 1e-9) return a.valorPosto > b.valorPosto ? -1 : 1;
  if (a.continuidade !== b.continuidade) return a.continuidade > b.continuidade ? -1 : 1;
  if (a.pool.ordemEtapa !== b.pool.ordemEtapa) return a.pool.ordemEtapa - b.pool.ordemEtapa;
  if (a.pool.produtoId !== b.pool.produtoId) return a.pool.produtoId < b.pool.produtoId ? -1 : 1;
  if (a.pool.etapaId !== b.pool.etapaId) return a.pool.etapaId < b.pool.etapaId ? -1 : 1;
  return a.m < b.m ? -1 : a.m > b.m ? 1 : 0;
}

function chaveSlot(s: { data: string; periodoId: string }): string {
  return `${s.data}|${s.periodoId}`;
}

export function gerarEscala(entrada: EntradaEscala): ResultadoEscala {
  const { slots, aPartirDe } = entrada;
  const vazio: ResultadoEscala = { alocacoes: [], alertas: [], resumoSlots: [], primeiraGeracaoComSemanaEmAndamento: false, pecasRestantes: {} };
  if (slots.length === 0 || aPartirDe >= slots.length) return vazio;

  const pools = [...entrada.pools].sort((a, b) => (a.produtoId + a.etapaId < b.produtoId + b.etapaId ? -1 : 1));
  const funcionarios = [...new Map(entrada.funcionarios.map((f) => [f.id, f])).values()].sort(porId);
  const nomeOp = (id: string) => entrada.nomesOperacao?.[id] ?? id;

  // ---- demanda restante (peças) = Q − créditos já congelados ----
  const rem = new Map<string, number>();
  pools.forEach((p) => rem.set(chavePool(p.produtoId, p.etapaId), Math.max(0, p.quantidade)));
  const indicePorSlot = new Map<string, number>(slots.map((s) => [chaveSlot(s), s.indice]));
  const congeladas = entrada.congeladas.filter((a) => {
    const i = indicePorSlot.get(chaveSlot(a));
    return i !== undefined && i < aPartirDe;
  });
  congeladas.forEach((a) => {
    if (a.maquinaId && a.produtoId && a.etapaId) {
      const k = chavePool(a.produtoId, a.etapaId);
      if (rem.has(k)) rem.set(k, Math.max(0, (rem.get(k) as number) - a.pecas));
    }
  });

  // ---- disponibilidade de máquina por slot ----
  const inativas = new Set(entrada.maquinasInativas ?? []);
  const indispPrevisao = new Set(entrada.maquinasIndisponiveisPrevisao);
  const todasMaquinas = [...new Set(pools.flatMap((p) => p.maquinasIds))].sort();
  const dispMatriz = new Map<string, boolean[]>();
  todasMaquinas.forEach((m) => {
    dispMatriz.set(
      m,
      slots.map((s) => {
        if (inativas.has(m) || indispPrevisao.has(m)) return false;
        return !entrada.indisponibilidades.some((i) => i.maquinaId === m && i.desdeMs <= s.inicioMs && (i.liberadaEmMs === null || s.inicioMs < i.liberadaEmMs));
      })
    );
  });
  const maquinaDisponivel = (m: string, u: number) => dispMatriz.get(m)?.[u] ?? false;

  // ---- ausências por (dia, funcionário) ----
  const ausenciasPor = new Map<string, { ini: number | null; fim: number | null }[]>();
  entrada.ausencias.forEach((a) => {
    const k = `${a.data}|${a.funcionarioId}`;
    if (!ausenciasPor.has(k)) ausenciasPor.set(k, []);
    ausenciasPor.get(k)!.push({ ini: a.inicioMin, fim: a.fimMin });
  });
  const ausente = (fid: string, s: SlotEscala) =>
    (ausenciasPor.get(`${s.data}|${fid}`) ?? []).some((w) => (w.ini === null || w.fim === null ? true : sobrepoe(w.ini, w.fim, s.inicioMin, s.fimMin)));

  // ---- estado de rotação/continuidade vindo do passado congelado ----
  const histOp = new Map<string, string | null>(); // funcionário -> operação do slot anterior (null = sem posto/ausente)
  const opsHoje = new Map<string, Map<string, number>>(); // funcionário -> op -> vezes no dia
  const ociosidade = new Map<string, number>(); // funcionário -> slots sem posto na semana
  const ultimaMaquinaFunc = new Map<string, string | null>();
  const ultimoProdutoMaquina = new Map<string, string>();

  const congeladasPorSlot = new Map<string, AlocacaoEscala[]>();
  congeladas.forEach((a) => {
    const k = chaveSlot(a);
    if (!congeladasPorSlot.has(k)) congeladasPorSlot.set(k, []);
    congeladasPorSlot.get(k)!.push(a);
  });
  congeladas.forEach((a) => {
    if (!a.maquinaId) ociosidade.set(a.funcionarioId, (ociosidade.get(a.funcionarioId) ?? 0) + 1);
  });
  // ---- equidade: histórico da janela + congeladas desta escala (em ordem de slot) ----
  const equidade = new ContadoresEquidade(funcionarios.map((f) => f.id), entrada.historicoEquidade);
  slots.slice(0, aPartirDe).forEach((sl) => {
    const linhas = congeladasPorSlot.get(chaveSlot(sl)) ?? [];
    equidade.registrarPeriodo(
      linhas.map((a) => a.funcionarioId),
      linhas.filter((a) => a.maquinaId && a.operacaoId).map((a) => ({ funcionarioId: a.funcionarioId, operacaoId: a.operacaoId as string, maquinaId: a.maquinaId as string }))
    );
  });
  const registrarDia = (s: SlotEscala, aloc: AlocacaoEscala[]) => {
    aloc.forEach((a) => {
      if (a.maquinaId && a.operacaoId) {
        if (!opsHoje.has(a.funcionarioId)) opsHoje.set(a.funcionarioId, new Map());
        const m = opsHoje.get(a.funcionarioId)!;
        m.set(a.operacaoId, (m.get(a.operacaoId) ?? 0) + 1);
      }
    });
    void s;
  };
  // reconstrói o dia corrente (se o primeiro slot mutável não abre o dia)
  const slotInicial = slots[aPartirDe];
  if (!slotInicial.primeiroDoDia) {
    for (let u = aPartirDe - 1; u >= 0 && slots[u].data === slotInicial.data; u--) {
      registrarDia(slots[u], congeladasPorSlot.get(chaveSlot(slots[u])) ?? []);
    }
    const anterior = congeladasPorSlot.get(chaveSlot(slots[aPartirDe - 1])) ?? [];
    anterior.forEach((a) => {
      histOp.set(a.funcionarioId, a.maquinaId ? a.operacaoId : null);
      ultimaMaquinaFunc.set(a.funcionarioId, a.maquinaId);
      if (a.maquinaId && a.produtoId) ultimoProdutoMaquina.set(a.maquinaId, a.produtoId);
    });
  } else if (aPartirDe > 0) {
    (congeladasPorSlot.get(chaveSlot(slots[aPartirDe - 1])) ?? []).forEach((a) => {
      if (a.maquinaId && a.produtoId) ultimoProdutoMaquina.set(a.maquinaId, a.produtoId);
    });
  }

  const atuais = new Map<string, string | null>();
  (entrada.alocacoesAtuais ?? []).forEach((a) => atuais.set(`${chaveSlot(a)}|${a.funcionarioId}`, a.maquinaId));

  const alocacoesSaida: AlocacaoEscala[] = [];
  const alertas: AlertaEscala[] = [];
  const resumoSlots: ResumoSlot[] = [];

  for (let t = aPartirDe; t < slots.length; t++) {
    const slot = slots[t];
    if (slot.primeiroDoDia) {
      histOp.clear();
      opsHoje.clear();
      ultimaMaquinaFunc.clear();
    }

    const disponiveis = funcionarios.filter((f) => !ausente(f.id, slot));
    // quem está ausente neste slot perde o histórico de rotação
    funcionarios.forEach((f) => {
      if (ausente(f.id, slot)) histOp.set(f.id, null);
    });

    // ---- candidatos ----
    const folgas = calcularFolgas(t, slots, pools, rem, (p) => chavePool(p.produtoId, p.etapaId), maquinaDisponivel);
    const poolsComDemanda = pools.filter((p) => (rem.get(chavePool(p.produtoId, p.etapaId)) ?? 0) > EPS && metaNoSlot(p, slot) > 0);
    const pares: Par[] = [];
    poolsComDemanda.forEach((p) => {
      const chave = chavePool(p.produtoId, p.etapaId);
      const r = rem.get(chave) as number;
      const mu = metaNoSlot(p, slot);
      [...new Set(p.maquinasIds)].sort().forEach((m) => {
        if (!maquinaDisponivel(m, t)) return;
        pares.push({
          m,
          pool: p,
          chave,
          folga: folgas.get(chave) as FolgaPool,
          valorPosto: Math.min(mu, r) * p.valorUnitario,
          continuidade: ultimoProdutoMaquina.get(m) === p.produtoId ? 1 : 0,
        });
      });
    });
    pares.sort(comparar);

    const permitido = new Map<string, number>();
    poolsComDemanda.forEach((p) => {
      const k = chavePool(p.produtoId, p.etapaId);
      permitido.set(k, Math.max(1, Math.ceil(((rem.get(k) as number) - EPS) / metaNoSlot(p, slot))));
    });
    const contagem = new Map<string, number>();
    const comprometido = new Map<string, number>();
    const maquinasUsadas = new Set<string>();
    const aceitos: { par: Par; pecas: number }[] = [];
    const maquinasCandidatas = new Set(pares.map((x) => x.m));
    for (const par of pares) {
      if (aceitos.length >= disponiveis.length) break;
      if (maquinasUsadas.has(par.m)) continue;
      if ((contagem.get(par.chave) ?? 0) >= (permitido.get(par.chave) as number)) continue;
      const mu = metaNoSlot(par.pool, slot);
      const g = Math.min(mu, (rem.get(par.chave) as number) - (comprometido.get(par.chave) ?? 0));
      if (g <= EPS) continue;
      aceitos.push({ par, pecas: g });
      maquinasUsadas.add(par.m);
      contagem.set(par.chave, (contagem.get(par.chave) ?? 0) + 1);
      comprometido.set(par.chave, (comprometido.get(par.chave) ?? 0) + g);
    }

    const K = aceitos.length;
    const n = disponiveis.length;

    // ---- alertas de gargalo sem operador (falta de pessoas) ----
    const poolsAceitos = new Set(aceitos.map((a) => a.par.chave));
    const gargalosDescobertos = new Set<string>();
    pares.forEach((par) => {
      if (par.folga.gargalo && !poolsAceitos.has(par.chave) && n <= K) gargalosDescobertos.add(par.chave);
    });
    gargalosDescobertos.forEach((k) => {
      const [produtoId, etapaId] = k.split("|");
      alertas.push({ tipo: "gargalo_sem_operador", data: slot.data, periodoId: slot.periodoId, produtoId, etapaId });
    });

    // ---- matriz de custo n×n: K postos reais + (n-K) colunas "sem posto" ----
    const custo: number[][] = disponiveis.map((f) => {
      const linha: number[] = [];
      aceitos.forEach(({ par }) => {
        let c = 0;
        const op = par.pool.operacaoId;
        if (histOp.get(f.id) === op) c += CUSTO_ROTACAO;
        c += CUSTO_EXPOSICAO * (opsHoje.get(f.id)?.get(op) ?? 0);
        c += equidade.custo(f.id, op, par.m);
        const atual = atuais.get(`${chaveSlot(slot)}|${f.id}`);
        if (atual !== undefined && atual !== par.m) c += CUSTO_MUDANCA;
        if (ultimaMaquinaFunc.get(f.id) === par.m) c += CUSTO_MESMA_MAQUINA;
        linha.push(c);
      });
      for (let j = K; j < n; j++) {
        let c = CUSTO_OCIO * (ociosidade.get(f.id) ?? 0);
        const atual = atuais.get(`${chaveSlot(slot)}|${f.id}`);
        if (atual !== undefined && atual !== null) c += CUSTO_MUDANCA;
        linha.push(c);
      }
      return linha;
    });
    const atribuicao = atribuicaoMinima(custo);

    // ---- motivo de "sem posto" ----
    let motivoSemPosto = MOTIVO_DEMANDA_ESGOTADA;
    if (n > K) {
      const pendentes = pools.filter((p) => (rem.get(chavePool(p.produtoId, p.etapaId)) ?? 0) > EPS);
      if (pendentes.length === 0) {
        motivoSemPosto = MOTIVO_DEMANDA_ESGOTADA;
      } else {
        const insatisfeitos = poolsComDemanda.filter((p) => (contagem.get(chavePool(p.produtoId, p.etapaId)) ?? 0) < (permitido.get(chavePool(p.produtoId, p.etapaId)) as number));
        if (poolsComDemanda.length === 0) motivoSemPosto = MOTIVO_RECURSOS_INDISPONIVEIS;
        else if (insatisfeitos.length === 0) motivoSemPosto = MOTIVO_JA_COBERTA;
        else if (insatisfeitos.some((p) => p.maquinasIds.some((m) => maquinaDisponivel(m, t)))) motivoSemPosto = MOTIVO_POSTOS_OCUPADOS;
        else motivoSemPosto = MOTIVO_RECURSOS_INDISPONIVEIS;
      }
    }

    // ---- exceções de rotação (Hall por operação) ----
    const postosPorOp = new Map<string, number>();
    aceitos.forEach(({ par }) => postosPorOp.set(par.pool.operacaoId, (postosPorOp.get(par.pool.operacaoId) ?? 0) + 1));
    const vinhamDaOp = new Map<string, number>();
    disponiveis.forEach((f) => {
      const o = histOp.get(f.id);
      if (o) vinhamDaOp.set(o, (vinhamDaOp.get(o) ?? 0) + 1);
    });

    const nova: AlocacaoEscala[] = [];
    disponiveis.forEach((f, i) => {
      const j = atribuicao[i];
      if (j < K) {
        const { par, pecas } = aceitos[j];
        const op = par.pool.operacaoId;
        const repetiu = histOp.get(f.id) === op;
        nova.push({
          data: slot.data,
          periodoId: slot.periodoId,
          funcionarioId: f.id,
          maquinaId: par.m,
          produtoId: par.pool.produtoId,
          etapaId: par.pool.etapaId,
          operacaoId: op,
          pecas,
          motivoSemPosto: null,
          excecaoRevezamento: repetiu,
          motivoExcecao: repetiu
            ? `Repetição inevitável da operação "${nomeOp(op)}": ${postosPorOp.get(op) ?? 0} posto(s) desta operação neste período e apenas ${n - (vinhamDaOp.get(op) ?? 0)} funcionário(s) disponível(is) que não vinham dela` +
              (par.folga.gargalo ? " (posto de gargalo mantido: gargalo vence revezamento)" : "")
            : null,
        });
      } else {
        nova.push({
          data: slot.data, periodoId: slot.periodoId, funcionarioId: f.id, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null,
          pecas: 0, motivoSemPosto, excecaoRevezamento: false, motivoExcecao: null,
        });
      }
    });

    // ---- aplica o slot ao estado ----
    aceitos.forEach(({ par, pecas }) => {
      rem.set(par.chave, Math.max(0, (rem.get(par.chave) as number) - pecas));
      ultimoProdutoMaquina.set(par.m, par.pool.produtoId);
    });
    funcionarios.forEach((f) => {
      if (ausente(f.id, slot)) ultimaMaquinaFunc.set(f.id, null);
    });
    nova.forEach((a) => {
      histOp.set(a.funcionarioId, a.maquinaId ? a.operacaoId : null);
      ultimaMaquinaFunc.set(a.funcionarioId, a.maquinaId);
      if (!a.maquinaId) ociosidade.set(a.funcionarioId, (ociosidade.get(a.funcionarioId) ?? 0) + 1);
    });
    registrarDia(slot, nova);
    equidade.registrarPeriodo(
      disponiveis.map((f) => f.id),
      nova.filter((a) => a.maquinaId && a.operacaoId).map((a) => ({ funcionarioId: a.funcionarioId, operacaoId: a.operacaoId as string, maquinaId: a.maquinaId as string }))
    );
    alocacoesSaida.push(...nova);

    if (n === 0) alertas.push({ tipo: "sem_funcionarios", data: slot.data, periodoId: slot.periodoId });
    if (n > K) alertas.push({ tipo: "subcarga_previsao", data: slot.data, periodoId: slot.periodoId, quantidade: n - K, motivo: motivoSemPosto });
    resumoSlots.push({ data: slot.data, periodoId: slot.periodoId, funcionariosDisponiveis: n, postosComDemanda: maquinasCandidatas.size, postosPreenchidos: K, semPosto: n - K });
  }

  // ---- demanda não atendida no fim da semana ----
  const pecasRestantes: Record<string, number> = {};
  pools.forEach((p) => {
    const k = chavePool(p.produtoId, p.etapaId);
    const r = rem.get(k) as number;
    if (r > EPS) {
      pecasRestantes[k] = r;
      alertas.push({ tipo: "demanda_nao_atendida", produtoId: p.produtoId, etapaId: p.etapaId, pecas: r });
    }
  });

  alertas.push(...riscoFaltaMaterial(pools, slots, [...congeladas, ...alocacoesSaida], indicePorSlot));

  alocacoesSaida.sort((a, b) => (indicePorSlot.get(chaveSlot(a)) as number) - (indicePorSlot.get(chaveSlot(b)) as number) || (a.funcionarioId < b.funcionarioId ? -1 : 1));

  return {
    alocacoes: alocacoesSaida,
    alertas,
    resumoSlots,
    primeiraGeracaoComSemanaEmAndamento: aPartirDe > 0 && congeladas.length === 0,
    pecasRestantes,
  };
}

// F1: a ordem do roteiro NÃO bloqueia nada. Só alerta quando, ao fim de um
// slot, a etapa seguinte do produto teria processado (cumulativamente) mais
// peças do que a anterior já produziu — possível falta de material, já que o
// estoque intermediário inicial é desconhecido.
function riscoFaltaMaterial(
  pools: PoolEscala[],
  slots: SlotEscala[],
  alocacoes: AlocacaoEscala[],
  indicePorSlot: Map<string, number>
): AlertaEscala[] {
  const creditoPorSlot = new Map<string, number[]>();
  pools.forEach((p) => creditoPorSlot.set(chavePool(p.produtoId, p.etapaId), new Array(slots.length).fill(0)));
  alocacoes.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const arr = creditoPorSlot.get(chavePool(a.produtoId, a.etapaId));
    const i = indicePorSlot.get(chaveSlot(a));
    if (arr && i !== undefined) arr[i] += a.pecas;
  });
  const alertas: AlertaEscala[] = [];
  const porProduto = new Map<string, PoolEscala[]>();
  pools.forEach((p) => {
    if (!porProduto.has(p.produtoId)) porProduto.set(p.produtoId, []);
    porProduto.get(p.produtoId)!.push(p);
  });
  [...porProduto.keys()].sort().forEach((produtoId) => {
    const etapas = porProduto.get(produtoId)!.sort((a, b) => a.ordemEtapa - b.ordemEtapa);
    for (let k = 0; k + 1 < etapas.length; k++) {
      const a = creditoPorSlot.get(chavePool(produtoId, etapas[k].etapaId))!;
      const b = creditoPorSlot.get(chavePool(produtoId, etapas[k + 1].etapaId))!;
      let ca = 0;
      let cb = 0;
      for (let u = 0; u < slots.length; u++) {
        ca += a[u];
        cb += b[u];
        if (cb > ca + EPS) {
          alertas.push({ tipo: "risco_falta_material", produtoId, etapaAnteriorId: etapas[k].etapaId, etapaId: etapas[k + 1].etapaId, data: slots[u].data, periodoId: slots[u].periodoId });
          break;
        }
      }
    }
  });
  return alertas;
}

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
import { maquinaDisponivelNoSlot } from "./disponibilidade";
import { sobrepoe } from "./tempo";
import { selecionarAdicionalWip } from "./adicionalWip";
import { etapasPorProduto } from "./wip";
import {
  chavePool, MOTIVO_DEMANDA_ESGOTADA, MOTIVO_JA_COBERTA, MOTIVO_POSTOS_OCUPADOS, MOTIVO_RECURSOS_INDISPONIVEIS,
  type AlertaEscala, type AlocacaoEscala, type EntradaEscala, type PoolEscala, type ResultadoEscala, type ResumoSlot, type SlotEscala,
} from "./types";

// Pesos do custo de atribuição (ordem de grandeza = ordem de prioridade):
// revezamento >> equidade histórica por operação >> por máquina (equidade.ts, em minutos)
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
  lag?: number; // só camada de adicional: quanto esta etapa está ATRASADA em relação à etapa mais atrasada do produto
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

// 2ª camada (carga adicional): só entra depois do previsto, e só em máquinas livres e
// já selecionadas dos produtos JÁ PREVISTOS (os pools vêm só dos itens da Previsão).
// Ordem: (1) fechar produto acabado e (2) usar capacidade ociosa — garantidos por quem
// define `adicionalMax` e pela própria regra da camada; (3) gargalo/fluxo: a etapa mais
// ATRASADA dentro do seu produto (a que limita o produto acabado) passa na frente;
// (4) maior valor do posto; (5) continuidade da máquina; (6) ordem do roteiro; (7) ids.
const SEM_FOLGA: FolgaPool = { folga: 0, folgaPeriodos: 0, muBarra: 0, gargalo: false };
function compararAdicional(a: Par, b: Par): number {
  const la = a.lag ?? 0;
  const lb = b.lag ?? 0;
  if (Math.abs(la - lb) > 1e-9) return la < lb ? -1 : 1;
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
  const vazio: ResultadoEscala = { alocacoes: [], alertas: [], resumoSlots: [], primeiraGeracaoComSemanaEmAndamento: false, pecasRestantes: {}, adicionalProduzido: {} };
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

  // ---- carga adicional restante (2ª camada) = adicionalMax − créditos adicionais já congelados ----
  const adicRem = new Map<string, number>();
  pools.forEach((p) => adicRem.set(chavePool(p.produtoId, p.etapaId), Math.max(0, p.adicionalMax ?? 0)));
  congeladas.forEach((a) => {
    if (a.maquinaId && a.produtoId && a.etapaId && (a.pecasAdicional ?? 0) > 0) {
      const k = chavePool(a.produtoId, a.etapaId);
      if (adicRem.has(k)) adicRem.set(k, Math.max(0, (adicRem.get(k) as number) - (a.pecasAdicional as number)));
    }
  });

  // ---- equilíbrio da cadeia (2ª camada): adicional já alocado por etapa, e etapas de cada produto ----
  const adicAlocado = new Map<string, number>();
  const chavesDoProduto = new Map<string, string[]>();
  pools.forEach((p) => {
    if ((p.adicionalMax ?? 0) <= 0 && !entrada.wip) return; // com o adicional por etapa TODA etapa participa da cadeia
    const k = chavePool(p.produtoId, p.etapaId);
    adicAlocado.set(k, 0);
    chavesDoProduto.set(p.produtoId, [...(chavesDoProduto.get(p.produtoId) ?? []), k]);
  });
  congeladas.forEach((a) => {
    if (a.maquinaId && a.produtoId && a.etapaId && (a.pecasAdicional ?? 0) > 0) {
      const k = chavePool(a.produtoId, a.etapaId);
      if (adicAlocado.has(k)) adicAlocado.set(k, (adicAlocado.get(k) as number) + (a.pecasAdicional as number));
    }
  });

  // adicional por etapa (WIP): etapas de cada produto e qual é a ÚLTIMA (produto acabado)
  const etapasWip = entrada.wip ? etapasPorProduto(pools) : null;
  const ehUltimaEtapa = new Map<string, boolean>();
  etapasWip?.forEach((l) => l.forEach((p, i) => ehUltimaEtapa.set(chavePool(p.produtoId, p.etapaId), i === l.length - 1)));

  // ---- disponibilidade de máquina por slot (regra única em disponibilidade.ts) ----
  const todasMaquinas = [...new Set(pools.flatMap((p) => p.maquinasIds))].sort();
  const dispMatriz = new Map<string, boolean[]>();
  todasMaquinas.forEach((m) => dispMatriz.set(m, slots.map((s) => maquinaDisponivelNoSlot(entrada, m, s))));
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
  const ultimoProdutoMaquina = new Map<string, string>(); // continuidade do PREVISTO (nunca influenciada pelo adicional)
  const ultimoProdutoGeral = new Map<string, string>(); // continuidade nas duas camadas (só para ordenar o adicional)

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
      linhas.filter((a) => a.maquinaId && a.operacaoId).map((a) => ({ funcionarioId: a.funcionarioId, operacaoId: a.operacaoId as string, maquinaId: a.maquinaId as string })),
      sl.fimMin - sl.inicioMin
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
      if (a.maquinaId && a.produtoId) {
        if (!((a.pecasAdicional ?? 0) > 0)) ultimoProdutoMaquina.set(a.maquinaId, a.produtoId);
        ultimoProdutoGeral.set(a.maquinaId, a.produtoId);
      }
    });
  } else if (aPartirDe > 0) {
    (congeladasPorSlot.get(chaveSlot(slots[aPartirDe - 1])) ?? []).forEach((a) => {
      if (a.maquinaId && a.produtoId) {
        if (!((a.pecasAdicional ?? 0) > 0)) ultimoProdutoMaquina.set(a.maquinaId, a.produtoId);
        ultimoProdutoGeral.set(a.maquinaId, a.produtoId);
      }
    });
  }

  const atuais = new Map<string, string | null>();
  (entrada.trocasManuais ?? []).forEach((a) => atuais.set(`${chaveSlot(a)}|${a.funcionarioId}`, a.maquinaId));

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

    // ---- custo de pôr uma pessoa num posto / deixá-la sem posto (mesma fórmula nas duas camadas) ----
    const custoPosto = (fid: string, par: Par): number => {
      let c = 0;
      const op = par.pool.operacaoId;
      if (histOp.get(fid) === op) c += CUSTO_ROTACAO;
      c += CUSTO_EXPOSICAO * (opsHoje.get(fid)?.get(op) ?? 0);
      c += equidade.custo(fid, op, par.m);
      const atual = atuais.get(`${chaveSlot(slot)}|${fid}`);
      if (atual !== undefined && atual !== par.m) c += CUSTO_MUDANCA;
      if (ultimaMaquinaFunc.get(fid) === par.m) c += CUSTO_MESMA_MAQUINA;
      return c;
    };
    const custoOcio = (fid: string): number => {
      let c = CUSTO_OCIO * (ociosidade.get(fid) ?? 0);
      const atual = atuais.get(`${chaveSlot(slot)}|${fid}`);
      if (atual !== undefined && atual !== null) c += CUSTO_MUDANCA;
      return c;
    };

    // ---- matriz de custo n×n: K postos reais + (n-K) colunas "sem posto" ----
    const custo: number[][] = disponiveis.map((f) => {
      const linha: number[] = [];
      aceitos.forEach(({ par }) => linha.push(custoPosto(f.id, par)));
      for (let j = K; j < n; j++) linha.push(custoOcio(f.id));
      return linha;
    });
    const atribuicao = atribuicaoMinima(custo);

    // ---- 2ª camada (carga ADICIONAL): ocupa SÓ quem ficaria sem posto, em máquinas livres ----
    // Nunca desloca o previsto: a seleção dos postos do previsto (acima) e a atribuição das
    // pessoas a eles (matriz acima) já estão decididas; aqui só entram os "sem posto".
    const aceitos2: { par: Par; pecas: number }[] = [];
    const destinoAdicional = new Map<number, number>(); // índice em `disponiveis` -> índice em aceitos2
    const ociosos = disponiveis.map((_, i) => i).filter((i) => atribuicao[i] >= K);
    if (ociosos.length > 0 && etapasWip) {
      // ---- adicional por ETAPA: acabado (cadeias) antes de estoque intermediário, pipeline no mesmo período ----
      const usadasWip = new Set(maquinasUsadas);
      const posts = selecionarAdicionalWip({
        etapas: etapasWip,
        adicRem,
        adicAlocado,
        saldo0: new Map(),
        ocupado: new Map(Object.entries(entrada.wip!.estoqueConfirmado ?? {})),
        limites: entrada.wip!.limites,
        livres: (p) =>
          [...new Set(p.maquinasIds)]
            .filter((m) => maquinaDisponivel(m, t))
            .sort((a, b) => {
              // continuidade SÓ do previsto: o que o estoque/adicional já fez nunca muda a escolha das máquinas do acabado
              const ca = ultimoProdutoMaquina.get(a) === p.produtoId ? 1 : 0;
              const cb = ultimoProdutoMaquina.get(b) === p.produtoId ? 1 : 0;
              return ca !== cb ? cb - ca : a < b ? -1 : 1;
            }),
        meta: (p) => metaNoSlot(p, slot),
        usadas: usadasWip,
        orcamento: ociosos.length,
      });
      posts.forEach((po) => {
        const chave = chavePool(po.pool.produtoId, po.pool.etapaId);
        aceitos2.push({
          par: { m: po.m, pool: po.pool, chave, folga: SEM_FOLGA, valorPosto: po.pecas * po.pool.valorUnitario, continuidade: ultimoProdutoGeral.get(po.m) === po.pool.produtoId ? 1 : 0 },
          pecas: po.pecas,
        });
      });
      if (aceitos2.length > 0) {
        const n1 = ociosos.length;
        const K2n = aceitos2.length;
        const custo2 = ociosos.map((i) => {
          const linha: number[] = [];
          aceitos2.forEach(({ par }) => linha.push(custoPosto(disponiveis[i].id, par)));
          for (let j = K2n; j < n1; j++) linha.push(custoOcio(disponiveis[i].id));
          return linha;
        });
        const a2 = atribuicaoMinima(custo2);
        ociosos.forEach((i, r) => {
          if (a2[r] < K2n) destinoAdicional.set(i, a2[r]);
        });
      }
    } else if (ociosos.length > 0) {
      const pares2: Par[] = [];
      const minAlocadoDoProduto = new Map<string, number>();
      chavesDoProduto.forEach((chaves, produto) => minAlocadoDoProduto.set(produto, Math.min(...chaves.map((k) => adicAlocado.get(k) as number))));
      pools.forEach((p) => {
        const chave = chavePool(p.produtoId, p.etapaId);
        const ar = adicRem.get(chave) ?? 0;
        const mu = metaNoSlot(p, slot);
        if (ar <= EPS || mu <= 0) return;
        const lag = (adicAlocado.get(chave) ?? 0) - (minAlocadoDoProduto.get(p.produtoId) ?? 0);
        [...new Set(p.maquinasIds)].sort().forEach((m) => {
          if (!maquinaDisponivel(m, t) || maquinasUsadas.has(m)) return;
          pares2.push({ m, pool: p, chave, folga: SEM_FOLGA, valorPosto: Math.min(mu, ar) * p.valorUnitario, continuidade: ultimoProdutoGeral.get(m) === p.produtoId ? 1 : 0, lag });
        });
      });
      pares2.sort(compararAdicional);
      const usadas2 = new Set<string>();
      const contagem2 = new Map<string, number>();
      const comprometido2 = new Map<string, number>();
      for (const par of pares2) {
        if (aceitos2.length >= ociosos.length) break;
        if (usadas2.has(par.m)) continue;
        const ar0 = adicRem.get(par.chave) as number;
        const ar = ar0 - (comprometido2.get(par.chave) ?? 0);
        const mu = metaNoSlot(par.pool, slot);
        if ((contagem2.get(par.chave) ?? 0) >= Math.max(1, Math.ceil((ar0 - EPS) / mu))) continue;
        const g = Math.min(mu, ar);
        if (g <= EPS) continue;
        aceitos2.push({ par, pecas: g });
        usadas2.add(par.m);
        contagem2.set(par.chave, (contagem2.get(par.chave) ?? 0) + 1);
        comprometido2.set(par.chave, (comprometido2.get(par.chave) ?? 0) + g);
      }
      if (aceitos2.length > 0) {
        const n1 = ociosos.length;
        const K2n = aceitos2.length;
        const custo2 = ociosos.map((i) => {
          const linha: number[] = [];
          aceitos2.forEach(({ par }) => linha.push(custoPosto(disponiveis[i].id, par)));
          for (let j = K2n; j < n1; j++) linha.push(custoOcio(disponiveis[i].id));
          return linha;
        });
        const a2 = atribuicaoMinima(custo2);
        ociosos.forEach((i, r) => {
          if (a2[r] < K2n) destinoAdicional.set(i, a2[r]);
        });
      }
    }
    const K2 = aceitos2.length;

    // ---- motivo de "sem posto" ----
    let motivoSemPosto = MOTIVO_DEMANDA_ESGOTADA;
    if (n > K + K2) {
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
    [...aceitos, ...aceitos2].forEach(({ par }) => postosPorOp.set(par.pool.operacaoId, (postosPorOp.get(par.pool.operacaoId) ?? 0) + 1));
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
      } else if (destinoAdicional.has(i)) {
        const { par, pecas } = aceitos2[destinoAdicional.get(i) as number];
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
          pecas: 0,
          pecasAdicional: pecas,
          ...(etapasWip ? { tipoAdicional: ehUltimaEtapa.get(par.chave) ? ("acabado" as const) : ("intermediario" as const) } : {}),
          motivoSemPosto: null,
          excecaoRevezamento: repetiu,
          motivoExcecao: repetiu
            ? `Repetição inevitável da operação "${nomeOp(op)}" (carga adicional): ${postosPorOp.get(op) ?? 0} posto(s) desta operação neste período e apenas ${n - (vinhamDaOp.get(op) ?? 0)} funcionário(s) disponível(is) que não vinham dela`
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
      ultimoProdutoGeral.set(par.m, par.pool.produtoId);
    });
    destinoAdicional.forEach((idx) => {
      const { par, pecas } = aceitos2[idx];
      adicRem.set(par.chave, Math.max(0, (adicRem.get(par.chave) as number) - pecas));
      adicAlocado.set(par.chave, (adicAlocado.get(par.chave) ?? 0) + pecas);
      ultimoProdutoGeral.set(par.m, par.pool.produtoId);
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
      nova.filter((a) => a.maquinaId && a.operacaoId).map((a) => ({ funcionarioId: a.funcionarioId, operacaoId: a.operacaoId as string, maquinaId: a.maquinaId as string })),
      slot.fimMin - slot.inicioMin
    );
    alocacoesSaida.push(...nova);

    if (n === 0) alertas.push({ tipo: "sem_funcionarios", data: slot.data, periodoId: slot.periodoId });
    if (n > K + K2) alertas.push({ tipo: "subcarga_previsao", data: slot.data, periodoId: slot.periodoId, quantidade: n - K - K2, motivo: motivoSemPosto });
    resumoSlots.push({ data: slot.data, periodoId: slot.periodoId, funcionariosDisponiveis: n, postosComDemanda: maquinasCandidatas.size, postosPreenchidos: K + K2, semPosto: n - K - K2 });
  }

  // ---- carga adicional alocada (só aparece quando há adicional) ----
  const adicionalProduzido: Record<string, number> = {};
  alocacoesSaida.forEach((a) => {
    if (a.maquinaId && a.produtoId && a.etapaId && (a.pecasAdicional ?? 0) > 0) {
      const k = chavePool(a.produtoId, a.etapaId);
      adicionalProduzido[k] = (adicionalProduzido[k] ?? 0) + (a.pecasAdicional as number);
    }
  });

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

  // estoque confirmado acima do limite: não apaga nem corrige; só impede NOVO WIP (o previsto continua consumindo) e avisa
  Object.entries(entrada.wip?.estoqueConfirmado ?? {}).forEach(([k, confirmado]) => {
    const L = entrada.wip!.limites[k];
    if (L !== undefined && confirmado > L + EPS) {
      const [produtoId, etapaId] = k.split("|");
      alertas.push({ tipo: "wip_acima_do_limite", produtoId, etapaId, pecas: confirmado, quantidade: L });
    }
  });
  alertas.push(...riscoFaltaMaterial(pools, slots, [...congeladas, ...alocacoesSaida], indicePorSlot, entrada.wip?.saldo0));

  alocacoesSaida.sort((a, b) => (indicePorSlot.get(chaveSlot(a)) as number) - (indicePorSlot.get(chaveSlot(b)) as number) || (a.funcionarioId < b.funcionarioId ? -1 : 1));

  return {
    alocacoes: alocacoesSaida,
    alertas,
    resumoSlots,
    primeiraGeracaoComSemanaEmAndamento: aPartirDe > 0 && congeladas.length === 0,
    pecasRestantes,
    adicionalProduzido,
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
  indicePorSlot: Map<string, number>,
  saldo0?: Record<string, number> // estoque confirmado entre a etapa k e a k+1 (Fase 3): material já existente
): AlertaEscala[] {
  const creditoPorSlot = new Map<string, number[]>();
  pools.forEach((p) => creditoPorSlot.set(chavePool(p.produtoId, p.etapaId), new Array(slots.length).fill(0)));
  alocacoes.forEach((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return;
    const arr = creditoPorSlot.get(chavePool(a.produtoId, a.etapaId));
    const i = indicePorSlot.get(chaveSlot(a));
    if (arr && i !== undefined) arr[i] += a.pecas + (a.pecasAdicional ?? 0);
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
      let ca = saldo0?.[chavePool(produtoId, etapas[k].etapaId)] ?? 0;
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

// ATINGIBILIDADE DO PREVISTO — diagnóstico PURO sobre a saída do motor (nada aqui decide quem trabalha onde).
//
// Pergunta que responde: "com a capacidade e os gargalos atuais, conseguimos CONCLUIR a programação?".
// É diferente de Cobertura da equipe ("estamos conseguindo ocupar as pessoas?"): uma semana pode ter cobertura 100% e
// previsto impossível (todo mundo trabalhando, mas as máquinas do gargalo não dão conta) — não é contradição.
//
// Quatro estados (o mais grave entre as etapas de cada produto):
//   • Atingível ................. cabe, com folga ≥ margem configurada;
//   • Atingível no limite ....... cabe matematicamente, mas a folga é MENOR que a margem (usa quase toda a capacidade).
//                                 Folga 0% NÃO é "em risco": é só "no limite";
//   • Em risco .................. há capacidade teórica para fechar, mas existe uma condição CONCRETA no plano que ameaça o
//                                 fechamento: o plano do motor deixa faltar peças (máquina livre sem ser priorizada, máquinas
//                                 ocupadas por outros produtos, ou o produto participa de uma semana que não cabe na equipe).
//                                 Na Fase 4 a Produção Real/performance será outra fonte desse risco;
//   • Impossível com a capacidade atual — há PROVA, independente do motor, ATRIBUÍVEL ao produto/etapa:
//       - etapa sem máquina selecionada;
//       - Σ (máquinas selecionadas × meta × períodos disponíveis) < peças necessárias (as máquinas da etapa não dão conta);
//       - recurso compartilhado saturado: os períodos-máquina que o conjunto de etapas precisa (no melhor ritmo) excedem os
//         que o conjunto de máquinas tem, e o plano deixou faltar peças do produto.
//
// INSUFICIÊNCIA GLOBAL DE EQUIPE é diagnóstico da SEMANA, não do produto: períodos-pessoa necessários (no mínimo) > disponíveis
// prova que "a programação semanal como um todo não cabe", mas não prova que cada produto, sozinho, é impossível. O produto
// que cabe sozinho e participa dessa semana aparece "Em risco" (se o plano deixou faltar peças dele), com a causa explícita.
// As provas são LIMITES (otimistas): "impossível" nunca é afirmado sem prova.

import { maquinaDisponivelNoSlot } from "./disponibilidade";
import { EPS, metaNoSlot } from "./folga";
import { chavePool, MOTIVO_REVEZAMENTO, type EntradaEscala, type PoolEscala, type ResultadoEscala } from "./types";

export type StatusAtingibilidade = "atingivel" | "atingivel_no_limite" | "em_risco" | "impossivel";
export type CausaAtingibilidade =
  | "sem_maquina" // [prova] etapa sem máquina selecionada
  | "capacidade_maquinas" // [prova] as máquinas selecionadas da etapa não produzem o necessário nos períodos restantes
  | "recurso_compartilhado_saturado" // [prova] máquinas compartilhadas entre etapas/produtos não dão conta do conjunto
  | "semana_sem_equipe" // [contexto] o produto cabe sozinho, mas a semana inteira não cabe na equipe e o plano deixou faltar peças dele
  | "maquina_livre_nao_priorizada" // [plano] máquina da etapa ficou livre com peças faltando (equipe estava em outro produto)
  | "recurso_compartilhado" // [plano] as máquinas da etapa estiveram ocupadas por outros produtos
  | "revezamento_obrigatorio" // [plano] a máquina ficou livre porque ninguém podia ocupá-la sem repetir a operação consecutiva (restrição ergonômica)
  | "folga_curta"; // fecha, mas com folga de capacidade menor que a margem (atingível no limite)

export interface AcaoRecomendada {
  tipo: "priorizar_maquina" | "selecionar_maquina" | "reduzir_quantidade" | "aumentar_equipe" | "acompanhar";
  produtoId: string;
  etapaId: string | null;
  maquinaId?: string; // priorizar_maquina
  periodos?: number; // priorizar_maquina: quantos períodos
  quantidade?: number; // reduzir_quantidade: quantidade viável com a capacidade atual (acabado)
  compativeis?: string[]; // selecionar_maquina: máquinas compatíveis do roteiro ainda não selecionadas (a verificar por cenário completo)
}

export interface AtingibilidadeEtapa {
  produtoId: string;
  etapaId: string;
  ordem: number;
  maquinas: string[];
  necessidade: number; // peças a produzir nos períodos restantes (previsto − já produzido)
  produzidoNoPlano: number;
  faltaPlano: number; // o que o plano do motor deixa sem produzir
  capacidadeMaquinas: number; // limite superior (máquinas selecionadas × metas × períodos disponíveis)
  faltaMinima: number; // o que falta MESMO com todas as máquinas selecionadas rodando sempre (prova)
  folgaPercentual: number; // (capacidade − necessidade) / necessidade × 100
  periodosMaquinaLivre: { maquinaId: string; periodos: number }[]; // períodos em que a máquina ficou livre com necessidade restante
  status: StatusAtingibilidade;
  causa: CausaAtingibilidade | null;
}

export interface AtingibilidadeProduto {
  produtoId: string;
  status: StatusAtingibilidade;
  causa: CausaAtingibilidade | null;
  faltaPlano: number; // produto acabado em falta (a etapa que mais falta)
  faltaMinima: number;
  valorEmRisco: number; // falta × valor unitário (indicador à parte)
  gargaloEtapaId: string | null;
  periodosNecessarios: number; // períodos a mais, nas máquinas atuais da etapa gargalo, para fechar o que falta
  acao: AcaoRecomendada | null;
  etapas: AtingibilidadeEtapa[];
}

export interface AtingibilidadeSemana {
  status: StatusAtingibilidade;
  margem: number;
  atingiveis: number;
  atingiveisNoLimite: number;
  emRisco: number;
  impossiveis: number;
  faltaTotalPlano: number;
  valorEmRisco: number;
  diagnosticoGlobal: DiagnosticoGlobal;
  produtos: AtingibilidadeProduto[];
}

export interface RecursoSaturado {
  maquinas: string[];
  produtos: string[]; // produtos com etapa que usa o conjunto
  necessarioPeriodosMaquina: number; // no melhor ritmo (mínimo)
  disponivelPeriodosMaquina: number;
  deficit: number;
}

// Diagnóstico da SEMANA como um todo (vem antes do detalhe por produto).
export interface DiagnosticoGlobal {
  cabe: boolean; // false = a programação semanal não cabe (equipe global ou algum produto comprovadamente impossível)
  equipe: { necessarioPeriodosPessoa: number; disponivelPeriodosPessoa: number; deficit: number; insuficiente: boolean };
  recursosSaturados: RecursoSaturado[];
  mensagem: string | null;
}

export const ORDEM_STATUS: Record<StatusAtingibilidade, number> = { atingivel: 0, atingivel_no_limite: 1, em_risco: 2, impossivel: 3 };
const pior = (a: StatusAtingibilidade, b: StatusAtingibilidade) => (ORDEM_STATUS[a] >= ORDEM_STATUS[b] ? a : b);

export function analisarAtingibilidade(entrada: EntradaEscala, resultado: ResultadoEscala, opcoes: { margem?: number } = {}): AtingibilidadeSemana {
  const margem = opcoes.margem ?? 0.1;
  const slots = entrada.slots.slice(entrada.aPartirDe);
  const comMaquina = [...entrada.pools];
  const semMaquina = (entrada.poolsSemMaquina ?? []).filter((p) => !comMaquina.some((q) => chavePool(q.produtoId, q.etapaId) === chavePool(p.produtoId, p.etapaId)));
  const todos = [...comMaquina, ...semMaquina].sort((a, b) => (a.produtoId + a.ordemEtapa.toString().padStart(4, "0") + a.etapaId < b.produtoId + b.ordemEtapa.toString().padStart(4, "0") + b.etapaId ? -1 : 1));
  const chave = (p: PoolEscala) => chavePool(p.produtoId, p.etapaId);

  // necessidade no início do primeiro período mutável (previsto menos o que o passado congelado já produziu)
  const indice = new Map(entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
  const need0 = new Map<string, number>(todos.map((p) => [chave(p), Math.max(0, p.quantidade)]));
  entrada.congeladas.forEach((a) => {
    const i = indice.get(`${a.data}|${a.periodoId}`);
    if (i === undefined || i >= entrada.aPartirDe || !a.maquinaId || !a.produtoId || !a.etapaId) return;
    const k = chavePool(a.produtoId, a.etapaId);
    if (need0.has(k)) need0.set(k, Math.max(0, (need0.get(k) as number) - a.pecas));
  });

  // capacidade das máquinas selecionadas e melhor ritmo (meta máxima) de cada etapa
  const capMaq = new Map<string, number>();
  const muMax = new Map<string, number>();
  const muMedio = new Map<string, number>();
  todos.forEach((p) => {
    let cap = 0;
    let max = 0;
    let soma = 0;
    let n = 0;
    slots.forEach((s) => {
      const mu = metaNoSlot(p, s);
      if (mu <= 0) return;
      max = Math.max(max, mu);
      soma += mu;
      n++;
      cap += mu * [...new Set(p.maquinasIds)].filter((m) => maquinaDisponivelNoSlot(entrada, m, s)).length;
    });
    capMaq.set(chave(p), cap);
    muMax.set(chave(p), max);
    muMedio.set(chave(p), n > 0 ? soma / n : 0);
  });

  // máquinas livres com necessidade restante (reconstrói o saldo período a período com a escala do motor)
  const rem = new Map(need0);
  const porSlot = new Map<string, typeof resultado.alocacoes>();
  resultado.alocacoes.forEach((a) => {
    const k = `${a.data}|${a.periodoId}`;
    if (!porSlot.has(k)) porSlot.set(k, []);
    porSlot.get(k)!.push(a);
  });
  const livres = new Map<string, Map<string, number>>(); // pool -> máquina -> períodos
  const livresPorRotacao = new Map<string, number>(); // pool -> períodos-máquina livres em períodos com posto vazio por revezamento
  const livresTotal = new Map<string, number>();
  let periodosPessoa = 0;
  slots.forEach((s) => {
    const linhas = porSlot.get(`${s.data}|${s.periodoId}`) ?? [];
    periodosPessoa += linhas.length;
    const usadas = new Set(linhas.filter((l) => l.maquinaId).map((l) => l.maquinaId as string));
    const rotacaoVazia = linhas.some((l) => !l.maquinaId && l.motivoSemPosto === MOTIVO_REVEZAMENTO);
    comMaquina.forEach((p) => {
      if ((rem.get(chave(p)) as number) <= EPS || metaNoSlot(p, s) <= 0) return;
      [...new Set(p.maquinasIds)].forEach((m) => {
        if (usadas.has(m) || !maquinaDisponivelNoSlot(entrada, m, s)) return;
        if (!livres.has(chave(p))) livres.set(chave(p), new Map());
        const mm = livres.get(chave(p)) as Map<string, number>;
        mm.set(m, (mm.get(m) ?? 0) + 1);
        livresTotal.set(chave(p), (livresTotal.get(chave(p)) ?? 0) + 1);
        if (rotacaoVazia) livresPorRotacao.set(chave(p), (livresPorRotacao.get(chave(p)) ?? 0) + 1);
      });
    });
    linhas.forEach((l) => {
      if (!l.maquinaId || !l.produtoId || !l.etapaId) return;
      const k = chavePool(l.produtoId, l.etapaId);
      if (rem.has(k)) rem.set(k, Math.max(0, (rem.get(k) as number) - l.pecas));
    });
  });

  // conjuntos de máquinas compartilhadas (componentes conexos): períodos-máquina necessários × disponíveis
  const pai = new Map<string, string>();
  const achar = (x: string): string => (pai.get(x) === x ? x : (pai.set(x, achar(pai.get(x) as string)), pai.get(x) as string));
  comMaquina.forEach((p) => p.maquinasIds.forEach((m) => { if (!pai.has(m)) pai.set(m, m); }));
  comMaquina.forEach((p) => {
    const ms = [...new Set(p.maquinasIds)];
    ms.slice(1).forEach((m) => pai.set(achar(m), achar(ms[0])));
  });
  const conjuntos = new Map<string, { pools: PoolEscala[]; maquinas: Set<string> }>();
  comMaquina.forEach((p) => {
    if (p.maquinasIds.length === 0) return;
    const raiz = achar(p.maquinasIds[0]);
    if (!conjuntos.has(raiz)) conjuntos.set(raiz, { pools: [], maquinas: new Set() });
    const c = conjuntos.get(raiz)!;
    c.pools.push(p);
    p.maquinasIds.forEach((m) => c.maquinas.add(m));
  });
  const conjuntoInviavel = new Set<string>(); // chaves de pool em conjuntos inviáveis
  const recursosSaturados: RecursoSaturado[] = [];
  conjuntos.forEach((c) => {
    const precisa = c.pools.reduce((s, p) => s + ((muMax.get(chave(p)) ?? 0) > 0 ? (need0.get(chave(p)) as number) / (muMax.get(chave(p)) as number) : 0), 0);
    let tem = 0;
    slots.forEach((s) => {
      if (!c.pools.some((p) => metaNoSlot(p, s) > 0)) return;
      tem += [...c.maquinas].filter((m) => maquinaDisponivelNoSlot(entrada, m, s)).length;
    });
    if (precisa > tem + 1e-6) {
      c.pools.forEach((p) => conjuntoInviavel.add(chave(p)));
      // só é "recurso compartilhado" se mais de uma etapa disputa o conjunto; uma etapa sozinha já é capacidade_maquinas
      if (c.pools.length > 1) recursosSaturados.push({ maquinas: [...c.maquinas].sort(), produtos: [...new Set(c.pools.map((p) => p.produtoId))].sort(), necessarioPeriodosMaquina: precisa, disponivelPeriodosMaquina: tem, deficit: precisa - tem });
    }
  });

  // equipe: períodos-pessoa mínimos (cada máquina-período precisa de uma pessoa)
  const precisaPessoa = todos.reduce((s, p) => s + ((muMax.get(chave(p)) ?? 0) > 0 ? (need0.get(chave(p)) as number) / (muMax.get(chave(p)) as number) : 0), 0);
  const equipeInsuficiente = precisaPessoa > periodosPessoa + 1e-6;

  const etapas: AtingibilidadeEtapa[] = todos
    .filter((p) => (need0.get(chave(p)) as number) > EPS)
    .map((p) => {
      const k = chave(p);
      const necessidade = need0.get(k) as number;
      const semMaq = p.maquinasIds.length === 0;
      const faltaPlano = semMaq ? necessidade : resultado.pecasRestantes[k] ?? 0;
      const cap = capMaq.get(k) as number;
      const faltaMinima = Math.max(0, necessidade - cap);
      const folga = necessidade > 0 ? ((cap - necessidade) / necessidade) * 100 : 100;
      const livresPool = [...(livres.get(k)?.entries() ?? [])].map(([maquinaId, periodos]) => ({ maquinaId, periodos })).sort((a, b) => b.periodos - a.periodos || (a.maquinaId < b.maquinaId ? -1 : 1));
      let status: StatusAtingibilidade = "atingivel";
      let causa: CausaAtingibilidade | null = null;
      if (semMaq) { status = "impossivel"; causa = "sem_maquina"; }
      else if (faltaMinima > EPS) { status = "impossivel"; causa = "capacidade_maquinas"; }
      else if (faltaPlano > EPS && conjuntoInviavel.has(k)) { status = "impossivel"; causa = "recurso_compartilhado_saturado"; }
      else if (faltaPlano > EPS && equipeInsuficiente) { status = "em_risco"; causa = "semana_sem_equipe"; }
      else if (faltaPlano > EPS) {
        status = "em_risco";
        const porRot = (livresPorRotacao.get(k) ?? 0) >= 0.5 * (livresTotal.get(k) ?? 0) && (livresPorRotacao.get(k) ?? 0) > 0;
        causa = porRot ? "revezamento_obrigatorio" : livresPool.length > 0 ? "maquina_livre_nao_priorizada" : "recurso_compartilhado";
      }
      else if (folga < margem * 100 - 1e-9) { status = "atingivel_no_limite"; causa = "folga_curta"; }
      return { produtoId: p.produtoId, etapaId: p.etapaId, ordem: p.ordemEtapa, maquinas: [...new Set(p.maquinasIds)].sort(), necessidade, produzidoNoPlano: Math.max(0, necessidade - faltaPlano), faltaPlano, capacidadeMaquinas: cap, faltaMinima, folgaPercentual: folga, periodosMaquinaLivre: livresPool, status, causa };
    });

  const periodosPorDia = new Set(slots.map((s) => s.periodoId)).size || 1;
  const produtos: AtingibilidadeProduto[] = [];
  const porProduto = new Map<string, AtingibilidadeEtapa[]>();
  etapas.forEach((e) => porProduto.set(e.produtoId, [...(porProduto.get(e.produtoId) ?? []), e]));
  [...porProduto.keys()].sort().forEach((produtoId) => {
    const es = porProduto.get(produtoId) as AtingibilidadeEtapa[];
    const valor = todos.find((p) => p.produtoId === produtoId)?.valorUnitario ?? 0;
    const status = es.reduce<StatusAtingibilidade>((acc, e) => pior(acc, e.status), "atingivel");
    // gargalo: a etapa com mais peças faltando; sem falta, a de menor folga
    const gargalo = [...es].sort((a, b) => Math.max(b.faltaPlano, b.faltaMinima) - Math.max(a.faltaPlano, a.faltaMinima) || a.folgaPercentual - b.folgaPercentual || a.ordem - b.ordem)[0];
    const doGargalo = ORDEM_STATUS[gargalo.status] === ORDEM_STATUS[status] ? gargalo : es.filter((e) => e.status === status).sort((a, b) => Math.max(b.faltaPlano, b.faltaMinima) - Math.max(a.faltaPlano, a.faltaMinima))[0] ?? gargalo;
    const faltaPlano = Math.max(...es.map((e) => e.faltaPlano));
    const faltaMinima = Math.max(...es.map((e) => e.faltaMinima));
    let periodosNecessarios = 0;
    let acao: AcaoRecomendada | null = null;
    if (status !== "atingivel" && status !== "atingivel_no_limite") {
      const pool = todos.find((p) => p.produtoId === produtoId && p.etapaId === doGargalo.etapaId) as PoolEscala;
      const porPeriodo = (muMedio.get(chave(pool)) ?? 0) * Math.max(1, doGargalo.maquinas.length);
      const faltou = Math.max(doGargalo.faltaPlano, doGargalo.faltaMinima);
      periodosNecessarios = porPeriodo > 0 && faltou > EPS ? Math.ceil(faltou / porPeriodo - 1e-9) : 0;
      const causa = doGargalo.causa;
      if (causa === "maquina_livre_nao_priorizada" && doGargalo.periodosMaquinaLivre.length > 0) {
        const m = doGargalo.periodosMaquinaLivre[0];
        acao = { tipo: "priorizar_maquina", produtoId, etapaId: doGargalo.etapaId, maquinaId: m.maquinaId, periodos: Math.max(1, Math.min(m.periodos, periodosNecessarios || m.periodos)) };
      } else if (causa === "sem_maquina" || causa === "capacidade_maquinas" || causa === "recurso_compartilhado_saturado") {
        const compat = (pool.maquinasCompativeisIds ?? []).filter((m) => !pool.maquinasIds.includes(m)).sort();
        acao = compat.length > 0
          ? { tipo: "selecionar_maquina", produtoId, etapaId: doGargalo.etapaId, compativeis: compat }
          : { tipo: "reduzir_quantidade", produtoId, etapaId: doGargalo.etapaId, quantidade: Math.max(0, Math.floor(Math.min(...es.map((e) => Math.min(e.necessidade, e.capacidadeMaquinas))))) };
      } else if (causa === "semana_sem_equipe") {
        acao = { tipo: "aumentar_equipe", produtoId, etapaId: doGargalo.etapaId };
      } else if (causa === "recurso_compartilhado") {
        const compat = (pool.maquinasCompativeisIds ?? []).filter((m) => !pool.maquinasIds.includes(m)).sort();
        acao = compat.length > 0 ? { tipo: "selecionar_maquina", produtoId, etapaId: doGargalo.etapaId, compativeis: compat } : { tipo: "acompanhar", produtoId, etapaId: doGargalo.etapaId };
      } else {
        acao = { tipo: "acompanhar", produtoId, etapaId: doGargalo.etapaId };
      }
    }
    if (status === "atingivel_no_limite") acao = { tipo: "acompanhar", produtoId, etapaId: doGargalo.etapaId };
    const gargaloRelevante = status !== "atingivel";
    produtos.push({ produtoId, status, causa: gargaloRelevante ? doGargalo.causa : null, faltaPlano, faltaMinima, valorEmRisco: Math.max(faltaPlano, faltaMinima) * valor, gargaloEtapaId: gargaloRelevante ? doGargalo.etapaId : null, periodosNecessarios, acao, etapas: es });
  });
  void periodosPorDia;

  const deficitEquipe = Math.max(0, precisaPessoa - periodosPessoa);
  const cabe = !equipeInsuficiente && !produtos.some((p) => p.status === "impossivel");
  const mensagem = equipeInsuficiente
    ? "Programação semanal não cabe na equipe disponível"
    : produtos.some((p) => p.status === "impossivel")
      ? "Há produto que não cabe nos recursos atuais"
      : null;
  const statusProdutos = produtos.reduce<StatusAtingibilidade>((acc, p) => pior(acc, p.status), "atingivel");
  const status: StatusAtingibilidade = cabe ? statusProdutos : "impossivel";
  return {
    status,
    margem,
    atingiveis: produtos.filter((p) => p.status === "atingivel").length,
    atingiveisNoLimite: produtos.filter((p) => p.status === "atingivel_no_limite").length,
    emRisco: produtos.filter((p) => p.status === "em_risco").length,
    impossiveis: produtos.filter((p) => p.status === "impossivel").length,
    faltaTotalPlano: produtos.reduce((s, p) => s + p.faltaPlano, 0),
    valorEmRisco: produtos.reduce((s, p) => s + p.valorEmRisco, 0),
    diagnosticoGlobal: {
      cabe,
      equipe: { necessarioPeriodosPessoa: precisaPessoa, disponivelPeriodosPessoa: periodosPessoa, deficit: deficitEquipe, insuficiente: equipeInsuficiente },
      recursosSaturados: recursosSaturados.sort((a, b) => b.deficit - a.deficit),
      mensagem,
    },
    produtos,
  };
}

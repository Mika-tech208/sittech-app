// Regras de negócio de Previsão Semanal + Análise de Capacidade, extraídas
// de docs/legacy/sittech-custos.jsx. Fase 1 — Etapa 2/3/5: refatoração, NÃO
// revisão matemática. As fórmulas abaixo devem produzir exatamente os
// mesmos resultados que o componente original.
//
// Funções puras: recebem dados, devolvem resultado. Nenhuma lê localStorage,
// nenhuma lê estado de componente — quem chama é responsável por passar
// tudo que a função precisa.

import type { Produto, Maquina, PeriodoComDuracao, PrevisaoItem, Previsao, RoteiroEtapa } from "@/types/domain";
import type {
  HorasPorMaquina, AnaliseCapacidadeSemanal, CapacidadeMaximaSemana, UsoMaquina, CapacidadeMaximaProduto,
  ViabilidadeItem, PeriodosEtapa, ObservacaoSetupMaquina, ItemSemanaAgregado, HistoricoSemanaResumo,
  AlocacaoSemanal, AlocacaoItemResultado, UsoPorOperacao, DiasPeriodos, StatusCapacidadeMaquina,
} from "@/features/capacidade/types";

// ---- itens previstos ----

export function calcularFuncionariosNecessarios(it: Pick<PrevisaoItem, "maquinasPorEtapa">): number {
  const idsUnicos = new Set<string>();
  Object.values(it.maquinasPorEtapa || {}).forEach((ids) => {
    (ids || []).forEach((id) => idsUnicos.add(id));
  });
  return idsUnicos.size;
}

export function calcularFuncionariosTotalSemana(itens: Pick<PrevisaoItem, "maquinasPorEtapa">[]): number {
  // conta máquinas ÚNICAS em todos os itens da semana — se a mesma máquina for usada
  // em mais de um item (ex: mesma etiquetadora em duas luvas diferentes), conta só 1 vez
  const idsUnicos = new Set<string>();
  itens.forEach((it) => {
    Object.values(it.maquinasPorEtapa || {}).forEach((ids) => {
      (ids || []).forEach((id) => idsUnicos.add(id));
    });
  });
  return idsUnicos.size;
}

export function calcularPeriodosEtapa(
  quantidade: number,
  tempoPorPeca: number,
  numMaquinas: number,
  duracaoMediaPeriodo: number
): PeriodosEtapa {
  if (tempoPorPeca <= 0 || numMaquinas <= 0 || duracaoMediaPeriodo <= 0) {
    return { manha: 0, tarde: 0, diasCompletos: 0, restantes: 0, totalPeriodos: 0, horasCalendario: 0 };
  }
  const horasCalendario = (quantidade * tempoPorPeca) / numMaquinas;
  const totalPeriodos = Math.round(horasCalendario / duracaoMediaPeriodo);
  const diasCompletos = Math.floor(totalPeriodos / 6);
  const restantes = totalPeriodos - diasCompletos * 6;
  const manha = diasCompletos * 3 + Math.ceil(restantes / 2);
  const tarde = diasCompletos * 3 + Math.floor(restantes / 2);
  return { manha, tarde, diasCompletos, restantes, totalPeriodos, horasCalendario };
}

export function textoDiasPeriodos(manha: number, tarde: number): string {
  const total = manha + tarde;
  const dias = Math.floor(Math.min(manha, tarde) / 3);
  const restoManha = manha - dias * 3;
  const restoTarde = tarde - dias * 3;
  if (total === 0) return "sem demanda calculada";
  if (restoManha === 0 && restoTarde === 0) return `totalizando ${dias} dia${dias !== 1 ? "s" : ""} completo${dias !== 1 ? "s" : ""}`;
  const partes: string[] = [];
  if (dias > 0) partes.push(`${dias} dia${dias !== 1 ? "s" : ""} completo${dias !== 1 ? "s" : ""}`);
  if (restoManha > 0) partes.push(`${restoManha} período${restoManha > 1 ? "s" : ""} de manhã`);
  if (restoTarde > 0) partes.push(`${restoTarde} período${restoTarde > 1 ? "s" : ""} de tarde`);
  return `totalizando ${partes.join(" e mais ")}`;
}

// Máquinas que efetivamente atendem uma etapa: as marcadas explicitamente
// no roteiro do produto, ou — sem seleção específica — todas as ativas
// daquela operação como reserva.
export function calcularMaquinasDaEtapa(etapa: Pick<RoteiroEtapa, "maquinasIds" | "operacao">, maquinas: Maquina[]): string[] {
  if (etapa.maquinasIds && etapa.maquinasIds.length > 0) {
    return maquinas.filter((m) => etapa.maquinasIds.includes(m.id) && m.ativo).map((m) => m.id);
  }
  return maquinas.filter((m) => m.operacao === etapa.operacao && m.ativo).map((m) => m.id);
}

// Tempo médio (em horas) pra produzir 1 peça numa etapa, derivado das metas
// por período do roteiro do produto. Repetido em várias das funções abaixo
// no código original — fatorado aqui, mesma fórmula em todo lugar.
function tempoPorPecaEtapa(etapa: Pick<RoteiroEtapa, "metas">, periodosComDuracao: PeriodoComDuracao[]): number {
  const metas = (etapa.metas || {}) as unknown as Record<string, number>;
  let totalPecasMeta = 0;
  let totalHorasMeta = 0;
  periodosComDuracao.forEach((p) => {
    const meta = Number(metas[p.id] || 0);
    if (meta > 0 && p.duracaoHoras > 0) {
      totalPecasMeta += meta;
      totalHorasMeta += p.duracaoHoras;
    }
  });
  return totalPecasMeta > 0 ? totalHorasMeta / totalPecasMeta : 0;
}

// ---- FONTE ÚNICA DE VERDADE: quantas horas cada máquina precisa, considerando TODOS os itens ----
// Quando uma etapa usa mais de uma máquina, divide o trabalho proporcional à folga real de cada
// máquina (não sempre 50/50) — máquina mais livre absorve mais, a mais ocupada absorve menos.
export function calcularHorasPorMaquina(
  itens: PrevisaoItem[],
  produtos: Produto[],
  periodosComDuracao: PeriodoComDuracao[],
  horasPorMaquinaSemana: number
): HorasPorMaquina {
  interface Par {
    produtoNome: string;
    maquinasIds: string[];
    horasTotalEtapa: number;
    contribuicaoBootstrap: Record<string, number>;
  }
  const pares: Par[] = [];
  itens.forEach((it) => {
    const produto = produtos.find((p) => p.id === it.produtoId);
    if (!produto) return;
    (produto.roteiro || []).forEach((etapa) => {
      const tempoPorPeca = tempoPorPecaEtapa(etapa, periodosComDuracao);
      if (tempoPorPeca <= 0) return;
      const idsSelecionadas = (it.maquinasPorEtapa || {})[etapa.id] || [];
      if (idsSelecionadas.length === 0) return;
      pares.push({ produtoNome: it.produtoNome, maquinasIds: idsSelecionadas, horasTotalEtapa: it.quantidade * tempoPorPeca, contribuicaoBootstrap: {} });
    });
  });

  // passada 1 (bootstrap): 50/50 entre as máquinas de cada par, só pra ter uma noção inicial de carga
  const bootstrap: Record<string, number> = {};
  pares.forEach((par) => {
    const horasPorMaquinaBoot = par.horasTotalEtapa / par.maquinasIds.length;
    par.maquinasIds.forEach((id) => {
      bootstrap[id] = (bootstrap[id] || 0) + horasPorMaquinaBoot;
      par.contribuicaoBootstrap[id] = horasPorMaquinaBoot;
    });
  });

  // passada 2 (refino): redistribui proporcional à folga real de cada máquina, excluindo a
  // contribuição do próprio par pra não distorcer o cálculo da folga dela
  const porMaquina: HorasPorMaquina = {};
  function somar(maquinaId: string, produtoNome: string, horas: number) {
    if (!porMaquina[maquinaId]) porMaquina[maquinaId] = { horasNecessarias: 0, produtos: {} };
    porMaquina[maquinaId].horasNecessarias += horas;
    porMaquina[maquinaId].produtos[produtoNome] = (porMaquina[maquinaId].produtos[produtoNome] || 0) + horas;
  }
  pares.forEach((par) => {
    if (par.maquinasIds.length === 1) {
      somar(par.maquinasIds[0], par.produtoNome, par.horasTotalEtapa);
      return;
    }
    const pesos = par.maquinasIds.map((id) => {
      const outrasCargas = (bootstrap[id] || 0) - par.contribuicaoBootstrap[id];
      return Math.max(0.01, horasPorMaquinaSemana - outrasCargas);
    });
    const somaPesos = pesos.reduce((s, p) => s + p, 0);
    par.maquinasIds.forEach((id, i) => {
      somar(id, par.produtoNome, par.horasTotalEtapa * (pesos[i] / somaPesos));
    });
  });

  return porMaquina;
}

// ---- FONTE ÚNICA DE VERDADE: análise de capacidade da semana, em horas ----
// Usada tanto pelo painel em tempo real da Previsão semanal quanto pelo relatório em PDF.
//
// IMPORTANTE: `pct` NÃO tem teto em 100 — uma máquina sobrecarregada mostra
// >100 (ex: 130), de propósito. Não reintroduzir Math.min(100, pct) aqui.
export function calcularAnaliseCapacidadeSemanal(
  itens: PrevisaoItem[],
  produtos: Produto[],
  maquinas: Maquina[],
  periodosComDuracao: PeriodoComDuracao[],
  horasPorMaquinaSemana: number
): AnaliseCapacidadeSemanal {
  const porMaquina = calcularHorasPorMaquina(itens, produtos, periodosComDuracao, horasPorMaquinaSemana);

  const listaMaquinas = Object.entries(porMaquina).map(([maquinaId, dados]) => {
    const maquina = maquinas.find((m) => m.id === maquinaId);
    const horasDisponiveis = horasPorMaquinaSemana;
    const pct = horasDisponiveis > 0 ? (dados.horasNecessarias / horasDisponiveis) * 100 : 0;
    const deficit = Math.max(0, dados.horasNecessarias - horasDisponiveis);
    let status: StatusCapacidadeMaquina;
    if (pct > 100) status = "gargalo";
    else if (pct >= 95) status = "proximo";
    else if (pct >= 80) status = "atencao";
    else status = "normal";
    return {
      maquinaId,
      nome: maquina?.nome || "Máquina removida",
      operacao: maquina?.operacao || "",
      horasNecessarias: dados.horasNecessarias,
      horasDisponiveis,
      pct,
      deficit,
      status,
      produtosConsumidores: Object.entries(dados.produtos)
        .map(([nome, horas]) => ({ nome, horas }))
        .sort((a, b) => b.horas - a.horas),
    };
  }).sort((a, b) => b.pct - a.pct);

  const gargalos = listaMaquinas.filter((m) => m.status === "gargalo");
  const atingivel = gargalos.length === 0;
  const maquinaMaisCarregada = listaMaquinas[0] || null;

  return { maquinas: listaMaquinas, gargalos, atingivel, maquinaMaisCarregada };
}

// ---- capacidade máxima da semana em R$, com redução proporcional quando não cabe tudo ----
// Diferente da alocação (calcularAlocacaoSemanal): aqui cada item é reduzido
// PROPORCIONALMENTE ao fator global da máquina mais gargalada, não por
// ordem de prioridade — um item pode ser "atingível isoladamente" e ainda
// assim aparecer reduzido aqui porque OUTRO item disputa a mesma máquina.
export function calcularCapacidadeMaximaSemana(
  itens: PrevisaoItem[],
  produtos: Produto[],
  maquinas: Maquina[],
  periodosComDuracao: PeriodoComDuracao[],
  horasPorMaquinaSemana: number
): CapacidadeMaximaSemana {
  const porMaquinaCompartilhado = calcularHorasPorMaquina(itens, produtos, periodosComDuracao, horasPorMaquinaSemana);
  const horasNecessariasPorMaquina: Record<string, number> = {};
  Object.entries(porMaquinaCompartilhado).forEach(([id, dados]) => { horasNecessariasPorMaquina[id] = dados.horasNecessarias; });

  const previstoTotalReais = itens.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
  const maquinaIds = Object.keys(horasNecessariasPorMaquina);

  if (maquinaIds.length === 0) {
    return {
      temDados: false, temGargalo: false, resultadosPorItem: [], previstoTotalReais,
      maximoTotalReais: previstoTotalReais, capacidadeEstimadaReais: previstoTotalReais, maquinaLimitante: null,
    };
  }

  const razaoPorMaquina: Record<string, number> = {};
  maquinaIds.forEach((id) => {
    razaoPorMaquina[id] = horasNecessariasPorMaquina[id] > 0 ? horasPorMaquinaSemana / horasNecessariasPorMaquina[id] : Infinity;
  });

  let fatorGlobal = Infinity;
  let maquinaLimitanteId: string | null = null;
  maquinaIds.forEach((id) => {
    if (razaoPorMaquina[id] < fatorGlobal) { fatorGlobal = razaoPorMaquina[id]; maquinaLimitanteId = id; }
  });
  const temGargalo = fatorGlobal < 1;

  const fatorReducaoPorMaquina: Record<string, number> = {};
  maquinaIds.forEach((id) => { fatorReducaoPorMaquina[id] = Math.min(1, razaoPorMaquina[id]); });

  const resultadosPorItem = itens.map((it) => {
    const produto = produtos.find((p) => p.id === it.produtoId);
    if (!produto || !(produto.roteiro || []).length) {
      return { itemId: it.id, produtoNome: it.produtoNome, valorUnitario: it.valorUnitario, previsto: it.quantidade, maximoPossivel: it.quantidade, etapaLimitante: null };
    }
    let fatorItem = 1;
    let etapaLimitante: string | null = null;
    produto.roteiro.forEach((etapa) => {
      const idsSelecionadas = (it.maquinasPorEtapa || {})[etapa.id] || [];
      if (idsSelecionadas.length === 0) return;
      const fatorEtapa = Math.min(...idsSelecionadas.map((id) => (fatorReducaoPorMaquina[id] !== undefined ? fatorReducaoPorMaquina[id] : 1)));
      if (fatorEtapa < fatorItem) { fatorItem = fatorEtapa; etapaLimitante = etapa.operacao; }
    });
    const maximoPossivel = Math.max(0, Math.floor(it.quantidade * fatorItem));
    return { itemId: it.id, produtoNome: it.produtoNome, valorUnitario: it.valorUnitario, previsto: it.quantidade, maximoPossivel, etapaLimitante };
  });

  const maximoTotalReais = resultadosPorItem.reduce((s, r) => s + r.maximoPossivel * r.valorUnitario, 0);
  const capacidadeEstimadaReais = temGargalo ? maximoTotalReais : previstoTotalReais * fatorGlobal;
  const maquinaLimitante = maquinaLimitanteId ? maquinas.find((m) => m.id === maquinaLimitanteId) : null;
  const pctMaquinaLimitante = maquinaLimitanteId && horasNecessariasPorMaquina[maquinaLimitanteId]
    ? (horasNecessariasPorMaquina[maquinaLimitanteId] / horasPorMaquinaSemana) * 100 : 0;

  return {
    temDados: true, temGargalo, resultadosPorItem, previstoTotalReais, maximoTotalReais, capacidadeEstimadaReais,
    maquinaLimitante: maquinaLimitante ? { nome: maquinaLimitante.nome, pct: pctMaquinaLimitante } : null,
  };
}

export function calcularUsoPorMaquina(analiseCapacidade: AnaliseCapacidadeSemanal, duracaoMediaPeriodo: number): UsoMaquina[] {
  // deriva a exibição em períodos (manhã/tarde) a partir da MESMA análise central em horas —
  // o % e o status de gargalo aqui são exatamente os mesmos que aparecem na tela, nunca recalculados de novo
  return analiseCapacidade.maquinas.map((m) => {
    const produtosComPeriodos: UsoMaquina["produtos"] = {};
    m.produtosConsumidores.forEach((p) => {
      const totalPeriodosProduto = Math.round(p.horas / duracaoMediaPeriodo);
      produtosComPeriodos[p.nome] = {
        manha: Math.ceil(totalPeriodosProduto / 2),
        tarde: Math.floor(totalPeriodosProduto / 2),
      };
    });
    const totalPeriodosNecessarios = Math.round(m.horasNecessarias / duracaoMediaPeriodo);
    const totalPeriodosDisponiveis = Math.round(m.horasDisponiveis / duracaoMediaPeriodo);
    const capacidadePeriodo = Math.round(totalPeriodosDisponiveis / 2);
    return {
      maquinaId: m.maquinaId,
      nome: m.nome,
      produtos: produtosComPeriodos,
      totalManha: Math.ceil(totalPeriodosNecessarios / 2),
      totalTarde: Math.floor(totalPeriodosNecessarios / 2),
      pct: Math.round(m.pct),
      excedeu: m.status === "gargalo",
      capacidadePeriodo,
      livre: Math.max(0, totalPeriodosDisponiveis - totalPeriodosNecessarios),
    };
  });
}

export function calcularCapacidadeMaximaProduto(
  produtoId: string,
  maquinasPorEtapa: Record<string, string[]>,
  produtos: Produto[],
  periodosComDuracao: PeriodoComDuracao[],
  horasPorMaquinaSemana: number
): CapacidadeMaximaProduto {
  const produto = produtos.find((p) => p.id === produtoId);
  if (!produto || !(produto.roteiro || []).length) return { maxPecas: 0, gargalo: null };
  let maxPecas = Infinity;
  let gargalo: string | null = null;
  produto.roteiro.forEach((etapa) => {
    const tempoPorPeca = tempoPorPecaEtapa(etapa, periodosComDuracao);
    if (tempoPorPeca <= 0) return;
    const maquinasEscolhidas = (maquinasPorEtapa || {})[etapa.id] || [];
    const capacidadeEtapa = maquinasEscolhidas.length * horasPorMaquinaSemana;
    const maxPorEtapa = capacidadeEtapa / tempoPorPeca;
    if (maxPorEtapa < maxPecas) {
      maxPecas = maxPorEtapa;
      gargalo = etapa.operacao;
    }
  });
  if (maxPecas === Infinity) maxPecas = 0; // nenhuma etapa com máquina marcada ainda
  return { maxPecas: Math.max(0, Math.floor(maxPecas)), gargalo };
}

export function calcularViabilidadeItem(
  it: Pick<PrevisaoItem, "produtoId" | "maquinasPorEtapa" | "quantidade">,
  produtos: Produto[],
  periodosComDuracao: PeriodoComDuracao[],
  horasPorMaquinaSemana: number
): ViabilidadeItem {
  const { maxPecas, gargalo } = calcularCapacidadeMaximaProduto(it.produtoId, it.maquinasPorEtapa, produtos, periodosComDuracao, horasPorMaquinaSemana);
  return {
    atingivel: maxPecas >= it.quantidade,
    maxPecas,
    gargalo: maxPecas < it.quantidade ? gargalo : null,
    funcionariosNecessarios: calcularFuncionariosNecessarios(it),
  };
}

// TODO / COMPORTAMENTO ATUAL A REVISAR: casa o produto consumidor pelo NOME
// (produto.nome === p.nome), não pelo id — diferente do resto do sistema,
// que sempre casa por id. Se dois produtos tiverem o mesmo nome, ou um
// produto for renomeado depois de já ter sido usado numa previsão, essa
// combinação pode silenciosamente pegar o produto errado (ou nenhum).
// Preservado assim de propósito nesta etapa — só refatoração, não revisão.
export function calcularObservacoesSetup(
  analise: AnaliseCapacidadeSemanal,
  produtos: Produto[],
  getLucroHora: (produto: Produto) => number
): ObservacaoSetupMaquina[] {
  return analise.maquinas
    .filter((m) => m.produtosConsumidores.length >= 2)
    .map((m) => {
      const ordenados = [...m.produtosConsumidores]
        .map((p) => {
          const produto = produtos.find((prod) => prod.nome === p.nome);
          const lucroHora = produto ? getLucroHora(produto) : -Infinity;
          return { ...p, lucroHora };
        })
        .sort((a, b) => b.lucroHora - a.lucroHora);
      return { maquinaId: m.maquinaId, nome: m.nome, ordenados };
    });
}

// ---- itens previstos agregados por produto (soma quantidades da semana) ----
export function calcularItensSemanaAgregados(itens: PrevisaoItem[]): ItemSemanaAgregado[] {
  const map: Record<string, ItemSemanaAgregado> = {};
  itens.forEach((it) => {
    if (!map[it.produtoId]) map[it.produtoId] = { produtoId: it.produtoId, produtoNome: it.produtoNome, quantidade: 0 };
    map[it.produtoId].quantidade += Number(it.quantidade || 0);
  });
  return Object.values(map);
}

export function calcularCapacidadeInicialPorMaquina(
  maquinas: Maquina[],
  maquinasIndisponiveis: string[],
  horasPorMaquinaSemana: number
): Record<string, number> {
  const map: Record<string, number> = {};
  maquinas.forEach((m) => {
    if (m.ativo && !(maquinasIndisponiveis || []).includes(m.id)) map[m.id] = horasPorMaquinaSemana;
  });
  return map;
}

export function calcularHistoricoSemanas(previsoes: Previsao[]): HistoricoSemanaResumo[] {
  return [...previsoes]
    .filter((p) => p.itens.length > 0 || (p.itensRealizados || []).length > 0)
    .sort((a, b) => a.semanaInicio.localeCompare(b.semanaInicio))
    .map((p) => {
      const previsto = p.itens.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
      const realizado = (p.itensRealizados || []).reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
      const pct = previsto > 0 ? (realizado / previsto) * 100 : 0;
      return { semanaInicio: p.semanaInicio, previsto, realizado, pct };
    });
}

function horasParaDiasPeriodos(horas: number, duracaoMediaPeriodo: number): DiasPeriodos {
  if (duracaoMediaPeriodo <= 0 || horas <= 0) return { dias: 0, periodos: 0 };
  const totalPeriodos = horas / duracaoMediaPeriodo;
  const dias = Math.floor(totalPeriodos / 6);
  const periodosResto = Math.round(totalPeriodos - dias * 6);
  return { dias, periodos: periodosResto };
}

// ---- alocação automática sugerida: ordena por lucro/hora e consome a capacidade em sequência ----
// Diferente de calcularCapacidadeMaximaSemana (redução proporcional): aqui é
// greedy — o item mais lucrativo/hora é atendido primeiro, até esgotar a
// máquina; o resto fica com déficit. As duas análises respondem perguntas
// diferentes e não devem ser fundidas.
//
// TODO / COMPORTAMENTO ATUAL A REVISAR: as máquinas candidatas de cada etapa
// vêm de calcularMaquinasDaEtapa(etapa, maquinas) — ou seja, do roteiro
// PADRÃO do produto (etapa.maquinasIds) — e não de `it.maquinasPorEtapa`,
// a seleção de máquina que o usuário fez PARA AQUELE ITEM na semana (que é
// o que calcularHorasPorMaquina/calcularCapacidadeMaximaSemana usam). Ou
// seja, a sugestão de alocação pode ignorar a máquina que a pessoa marcou
// manualmente pro item. Preservado assim de propósito nesta etapa.
export function calcularAlocacaoSemanal(
  itensAgregados: ItemSemanaAgregado[],
  produtos: Produto[],
  capacidadeInicialPorMaquina: Record<string, number>,
  periodosComDuracao: PeriodoComDuracao[],
  maquinas: Maquina[],
  operacoes: string[],
  horasPorMaquinaSemana: number,
  duracaoMediaPeriodo: number,
  getLucroHora: (produto: Produto) => number
): AlocacaoSemanal {
  const capacidadeRestante: Record<string, number> = { ...capacidadeInicialPorMaquina };
  const comDados = itensAgregados
    .map((item) => {
      const produto = produtos.find((p) => p.id === item.produtoId) || null;
      if (!produto) return { ...item, produto: null, lucroHora: -Infinity };
      return { ...item, produto, lucroHora: getLucroHora(produto) };
    })
    .sort((a, b) => b.lucroHora - a.lucroHora);

  const resultados: AlocacaoItemResultado[] = comDados.map((item) => {
    if (!item.produto) {
      return { ...item, quantidadeAlocada: 0, deficit: item.quantidade, semFluxo: true, semProduto: true, gargalo: null };
    }
    const roteiro = item.produto.roteiro || [];
    if (roteiro.length === 0) {
      return { ...item, quantidadeAlocada: 0, deficit: item.quantidade, semFluxo: true, semProduto: false, gargalo: null };
    }
    let maxPecas = item.quantidade;
    let gargalo: string | null = null;
    const temposPorEtapa = roteiro.map((etapa) => ({
      tempoPorPeca: tempoPorPecaEtapa(etapa, periodosComDuracao),
      maquinasIds: calcularMaquinasDaEtapa(etapa, maquinas),
      operacao: etapa.operacao,
    }));
    temposPorEtapa.forEach((info) => {
      if (info.tempoPorPeca > 0) {
        const poolDisponivel = info.maquinasIds.reduce((s, id) => s + (capacidadeRestante[id] || 0), 0);
        const maxPorEtapa = poolDisponivel / info.tempoPorPeca;
        if (maxPorEtapa < maxPecas) {
          maxPecas = maxPorEtapa;
          gargalo = info.operacao;
        }
      }
    });
    maxPecas = Math.max(0, Math.floor(maxPecas));
    temposPorEtapa.forEach(({ tempoPorPeca, maquinasIds }) => {
      if (tempoPorPeca > 0 && maquinasIds.length > 0) {
        const horasConsumidas = maxPecas * tempoPorPeca;
        const poolDisponivel = maquinasIds.reduce((s, id) => s + (capacidadeRestante[id] || 0), 0);
        if (poolDisponivel > 0) {
          maquinasIds.forEach((id) => {
            const proporcao = (capacidadeRestante[id] || 0) / poolDisponivel;
            capacidadeRestante[id] = (capacidadeRestante[id] || 0) - horasConsumidas * proporcao;
          });
        }
      }
    });
    return { ...item, quantidadeAlocada: maxPecas, deficit: item.quantidade - maxPecas, semFluxo: false, semProduto: false, gargalo: item.quantidade - maxPecas > 0 ? gargalo : null };
  });

  const usoPorOperacao: UsoPorOperacao[] = operacoes
    .map((op) => {
      const maquinasDaOp = maquinas.filter((m) => m.operacao === op && m.ativo);
      if (maquinasDaOp.length === 0) return null;
      const total = maquinasDaOp.reduce((s, m) => s + (capacidadeInicialPorMaquina[m.id] || 0), 0);
      const restante = maquinasDaOp.reduce((s, m) => s + (capacidadeRestante[m.id] || 0), 0);
      const usado = total - restante;
      const maquinasIntegrais = horasPorMaquinaSemana > 0 ? Math.floor(usado / horasPorMaquinaSemana) : 0;
      const horasParcial = usado - maquinasIntegrais * horasPorMaquinaSemana;
      return {
        operacao: op, total, restante, usado, numMaquinas: maquinasDaOp.length, maquinasIntegrais, horasParcial,
        restanteDiasPeriodos: horasParaDiasPeriodos(restante, duracaoMediaPeriodo),
      };
    })
    .filter((u): u is UsoPorOperacao => u !== null);

  const atendidos = resultados.filter((r) => !r.semFluxo && !r.semProduto && r.deficit <= 0 && r.quantidade > 0);
  const comDeficit = resultados.filter((r) => !r.semFluxo && !r.semProduto && r.deficit > 0);
  const operacoesComSobra = usoPorOperacao.filter((u) => u.restante > 0.3);

  return { resultados, usoPorOperacao, resumo: { atendidos, comDeficit, operacoesComSobra } };
}

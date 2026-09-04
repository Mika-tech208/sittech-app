// Validação da Previsão V1 — capacidade provável (§8/§9, aprovado;
// CORRIGIDO DUAS VEZES após bloqueios matemáticos: ver histórico abaixo).
//
// DECOMPOSIÇÃO OEE DO CONTEXTO — UMA perda entra UMA vez:
//   * Availability já é (duração − parados)/duração — perda de TEMPO.
//   * Performance já é produzida/teórica, onde teórica = meta × (tempo
//     produtivo DAQUELE MESMO período/duração) — já CONDICIONADA ao tempo
//     produtivo, nunca ao tempo agendado bruto. Por isso não "briga" com
//     Availability: uma mede ritmo dentro do tempo que sobrou, a outra
//     mede quanto tempo sobrou.
//   * Quality é boa/produzida — perda de ACERTO, aplicada por último.
//   * `calcularResumoIndicadores` (Indicadores V1, JÁ oficial, nunca
//     alterado aqui) já devolve oeePct = Performance × Disponibilidade ×
//     Qualidade / 10000 numa ÚNICA conta — é ISSO que usamos como taxa
//     provável DE CADA CONTEXTO (produto+etapa+máquina).
//
// HISTÓRICO DE CORREÇÕES:
//   1) Versão original: um OEE médio ÚNICO do produto inteiro, aplicado
//      sobre a capacidade teórica final. Errado — misturava contextos.
//   2) 1ª correção: por etapa/máquina, mas combinava FATORES (nunca peças)
//      usando MIN entre máquinas de uma MESMA etapa. Isso está errado pra
//      máquinas PARALELAS/alternativas: se a etapa Rosquear pode usar a
//      Máquina A (capacidade provável 5.000 peças) OU a Máquina B (3.000
//      peças), a etapa consegue 8.000 (SOMA), não 3.000 (MIN de fatores).
//      MIN faz sentido pra combinar ETAPAS SEQUENCIAIS do roteiro (todas
//      são necessárias pra terminar a peça) — nunca pra máquinas paralelas
//      dentro da MESMA etapa.
//   3) Versão atual (esta): calcula capacidade em PEÇAS por máquina
//      (nunca só um fator), SOMA as máquinas de uma mesma etapa
//      (paralelas/alternativas), e só então usa MIN entre as etapas
//      necessárias da cadeia (sequenciais).
//
// MODELO FÍSICO:
//   capacidadeProvavelMaquina (peças) =
//     horasAlocadas(máquina, produto, etapa)   [já reduzidas pelo
//                                                compartilhamento entre
//                                                itens da semana]
//     ÷ tempoPorPeca(etapa)                    [taxa META do contexto]
//     × oeePct(contexto)/100                   [observado, por máquina]
//
//   capacidadeProvavelEtapa = Σ capacidadeProvavelMaquina das máquinas que
//     efetivamente contribuem pra essa etapa (paralelas -> SOMA, nunca MIN
//     de fatores, nunca média de OEE).
//
//   capacidadeProvavelProduto = MIN(capacidadeProvavelEtapa1,
//     capacidadeProvavelEtapa2, ...) — etapas sequenciais, todas
//     necessárias pra terminar a peça.
//
// "horasAlocadas" reaproveita `calcularHorasPorMaquina` (já existente,
// inalterada) — que já resolve compartilhamento entre TODOS os itens da
// semana disputando a mesma máquina (divide proporcional à folga real,
// não 50/50) — e a mesma razão de redução por disputa
// (`fatorReducaoPorMaquina = min(1, horasRestantes/horasNecessárias)`,
// mesma fórmula que `calcularCapacidadeMaximaSemana` já computa
// internamente). Nunca duplica fatorItem/etapaLimitante/maximoPossivel —
// isso continua sendo só de capacidadeTeorica.ts.
//
// AMOSTRA (§5, conservador): uma máquina só PRECISA de amostra suficiente
// quando ela tem alocação real (horasAlocadas > 0) nesse cenário. Se o
// motor de compartilhamento já mostra que uma máquina selecionada não
// recebe nenhuma hora no cenário restante (ex.: toda sua capacidade já
// foi consumida por outros itens da semana), ela não bloqueia por falta
// de amostra — não contribui, não precisa ser avaliada. Quando uma
// máquina COM alocação positiva não tem amostra suficiente, e essa
// contribuição é necessária pra fechar a etapa: capacidade provável
// completa do produto = INDISPONÍVEL. V1 nunca redistribui essa carga
// silenciosamente pra outra máquina, nunca assume 100%/meta/OEE de outro
// contexto — sempre conservador (mesma filosofia do "sem WIP").

import { calcularResumoIndicadores, type ApontamentoIndicador } from "@/features/producao-real/indicadores/calculations";
import { avaliarAmostraSimples } from "@/features/producao-real/funcionarios/amostra";
import { calcularHorasPorMaquina } from "@/features/capacidade/calculations";
import type { HorasPorMaquina } from "@/features/capacidade/types";
import { AMOSTRA_MINIMA_PERIODOS, AMOSTRA_MINIMA_MINUTOS } from "@/features/producao-real/validacao-previsao/thresholds";
import type { ContextoOperacional, FatorProvavelContexto } from "@/features/producao-real/validacao-previsao/types";
import type { Produto, PrevisaoItem, RoteiroEtapa, PeriodoComDuracao } from "@/types/domain";

export function calcularFatorProvavelContexto(contexto: ContextoOperacional, apontamentos14dias: ApontamentoIndicador[]): FatorProvavelContexto {
  const doContexto = apontamentos14dias.filter(
    (ap) => ap.status === "produzindo" && ap.produtoId === contexto.produtoId && ap.maquinaId === contexto.maquinaId && ap.operacaoNome === contexto.operacaoNome
  );
  const amostra = avaliarAmostraSimples(doContexto, AMOSTRA_MINIMA_PERIODOS, AMOSTRA_MINIMA_MINUTOS);
  if (!amostra.suficiente) {
    return {
      contexto, amostra, performancePct: null, disponibilidadePct: null, qualidadePct: null, oeePct: null,
      performanceSustentadaAcimaDeMeta: false,
    };
  }
  const resumo = calcularResumoIndicadores(doContexto, []);
  return {
    contexto,
    amostra,
    performancePct: resumo.performancePct,
    disponibilidadePct: resumo.disponibilidadePct,
    qualidadePct: resumo.qualidadePct,
    oeePct: resumo.oeePct, // já oficial — Performance × Disponibilidade × Qualidade / 10000, uma única vez.
    performanceSustentadaAcimaDeMeta: resumo.performancePct !== null && resumo.performancePct > 100, // §12 — nunca capado, só informativo.
  };
}

// Insumos de compartilhamento (§8, uma única chamada ao motor existente):
// `porMaquina` traz, por máquina, quantas horas CADA produto demanda dela
// (já dividido proporcionalmente à folga real quando a etapa usa mais de
// uma máquina — pass 2 de `calcularHorasPorMaquina`); `fatorReducaoPorMaquina`
// é a MESMA razão de disputa que `calcularCapacidadeMaximaSemana` já
// computa internamente (`min(1, horasRestantes/horasNecessárias)`) — nunca
// recriamos fatorItem/etapaLimitante/maximoPossivel, só reaproveitamos
// esses dois insumos públicos pra resolver capacidade EM PEÇAS por máquina.
export function calcularInsumosCompartilhamento(
  itensFiltrados: PrevisaoItem[],
  produtos: Produto[],
  periodosComDuracao: PeriodoComDuracao[],
  horasRestantes: number
): { porMaquina: HorasPorMaquina; fatorReducaoPorMaquina: Record<string, number> } {
  const porMaquina = calcularHorasPorMaquina(itensFiltrados, produtos, periodosComDuracao, horasRestantes);
  const fatorReducaoPorMaquina: Record<string, number> = {};
  Object.entries(porMaquina).forEach(([id, dados]) => {
    fatorReducaoPorMaquina[id] = dados.horasNecessarias > 0 ? Math.min(1, horasRestantes / dados.horasNecessarias) : 1;
  });
  return { porMaquina, fatorReducaoPorMaquina };
}

// Réplica deliberada e documentada de `tempoPorPecaEtapa`
// (capacidade/calculations.ts:107-119, função PRIVADA/não exportada) —
// não pode ser importada sem alterar outro feature (fora de escopo aqui).
// Fórmula pura e estável: horas médias pra produzir 1 peça, derivada das
// metas por período do roteiro. Mantida em sincronia manual — qualquer
// mudança na fórmula oficial precisa ser replicada aqui também.
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

const EPS_HORAS = 1e-6;

export interface CapacidadeProvavelMaquina {
  maquinaId: string;
  maquinaNome: string;
  horasAlocadas: number; // já reduzidas pelo compartilhamento — nunca a hora bruta demandada.
  necessitaAmostra: boolean; // false quando horasAlocadas ≈ 0 — não contribui, não bloqueia por falta de amostra (§5).
  disponivel: boolean; // true quando não precisa de amostra, ou quando precisa e ela é suficiente.
  capacidadePecas: number | null; // null = indisponível (precisava de amostra e não tinha).
  contexto: FatorProvavelContexto | null; // null quando a máquina não foi avaliada (alocação zero).
}

export function calcularCapacidadeProvavelMaquina(
  etapa: Pick<RoteiroEtapa, "operacao" | "metas">,
  maquinaId: string,
  maquinaNome: string,
  produtoId: string,
  porMaquina: HorasPorMaquina,
  fatorReducaoPorMaquina: Record<string, number>,
  periodosComDuracao: PeriodoComDuracao[],
  apontamentos14dias: ApontamentoIndicador[]
): CapacidadeProvavelMaquina {
  const horasDemandadas = porMaquina[maquinaId]?.produtos[produtoId]?.horas || 0;
  const horasAlocadas = horasDemandadas * (fatorReducaoPorMaquina[maquinaId] ?? 1);

  if (horasAlocadas <= EPS_HORAS) {
    // §5/teste E: máquina selecionada mas SEM alocação real no cenário
    // restante (ex.: capacidade já consumida por outros itens da semana) —
    // não contribui, então não pode bloquear a etapa por falta de amostra.
    return { maquinaId, maquinaNome, horasAlocadas: 0, necessitaAmostra: false, disponivel: true, capacidadePecas: 0, contexto: null };
  }

  const contexto = calcularFatorProvavelContexto({ produtoId, operacaoNome: etapa.operacao, maquinaId, maquinaNome }, apontamentos14dias);
  if (!contexto.amostra.suficiente || contexto.oeePct === null) {
    // §5/teste D: alocação positiva SEM amostra suficiente -> bloqueia (via
    // quem chama, calcularCapacidadeProvavelEtapa) — nunca redistribui essa
    // carga silenciosamente pra outra máquina.
    return { maquinaId, maquinaNome, horasAlocadas, necessitaAmostra: true, disponivel: false, capacidadePecas: null, contexto };
  }

  const tempoPorPeca = tempoPorPecaEtapa(etapa, periodosComDuracao);
  const capacidadePecas = tempoPorPeca > 0 ? (horasAlocadas / tempoPorPeca) * (contexto.oeePct / 100) : 0;
  return { maquinaId, maquinaNome, horasAlocadas, necessitaAmostra: true, disponivel: true, capacidadePecas, contexto };
}

export interface CapacidadeProvavelEtapa {
  etapaId: string;
  operacaoNome: string;
  necessaria: boolean; // tem >=1 máquina selecionada (após remover indisponíveis) — sem seleção = dado incompleto, não limita.
  disponivel: boolean; // só relevante quando necessaria=true.
  capacidadePecas: number | null; // SOMA das máquinas que contribuem (paralelas) — null = indisponível.
  maquinas: CapacidadeProvavelMaquina[];
}

export function calcularCapacidadeProvavelEtapa(
  etapa: Pick<RoteiroEtapa, "id" | "operacao" | "metas">,
  idsOriginais: string[],
  maquinasIndisponiveis: string[],
  produtoId: string,
  maquinaNomePorId: Map<string, string>,
  porMaquina: HorasPorMaquina,
  fatorReducaoPorMaquina: Record<string, number>,
  periodosComDuracao: PeriodoComDuracao[],
  apontamentos14dias: ApontamentoIndicador[]
): CapacidadeProvavelEtapa {
  if (idsOriginais.length === 0) {
    return { etapaId: etapa.id, operacaoNome: etapa.operacao, necessaria: false, disponivel: true, capacidadePecas: null, maquinas: [] };
  }
  const idsSelecionadas = idsOriginais.filter((id) => !maquinasIndisponiveis.includes(id));
  if (idsSelecionadas.length === 0) {
    // Etapa necessária, mas TODAS as máquinas selecionadas ficaram
    // indisponíveis — bloqueada (espelha "etapaTravada" de
    // capacidadeTeorica.ts), não "sem seleção".
    return { etapaId: etapa.id, operacaoNome: etapa.operacao, necessaria: true, disponivel: false, capacidadePecas: null, maquinas: [] };
  }

  const maquinas = idsSelecionadas.map((maquinaId) =>
    calcularCapacidadeProvavelMaquina(etapa, maquinaId, maquinaNomePorId.get(maquinaId) || "", produtoId, porMaquina, fatorReducaoPorMaquina, periodosComDuracao, apontamentos14dias)
  );

  const bloqueiaAmostra = maquinas.some((m) => m.necessitaAmostra && !m.disponivel);
  if (bloqueiaAmostra) {
    return { etapaId: etapa.id, operacaoNome: etapa.operacao, necessaria: true, disponivel: false, capacidadePecas: null, maquinas };
  }

  // Máquinas PARALELAS/alternativas na mesma etapa: capacidades SOMAM —
  // cada uma contribui independentemente, já depois de respeitar
  // compartilhamento/alocação (horasAlocadas). Nunca MIN de fatores, nunca
  // média de OEE, nunca soma de capacidade bruta sem considerar outros
  // produtos (isso já está embutido em horasAlocadas).
  const capacidadePecas = maquinas.reduce((s, m) => s + (m.capacidadePecas || 0), 0);
  return { etapaId: etapa.id, operacaoNome: etapa.operacao, necessaria: true, disponivel: true, capacidadePecas, maquinas };
}

export interface CapacidadeProvavelItem {
  capacidadePecas: number | null; // null = indisponível.
  etapasAvaliadas: CapacidadeProvavelEtapa[];
  fatoresUsados: FatorProvavelContexto[]; // achatado (só máquinas com alocação>0, efetivamente avaliadas) — transparência no detalhe da UI.
}

export function calcularCapacidadeProvavelItem(
  item: PrevisaoItem,
  produto: Produto,
  maquinaNomePorId: Map<string, string>,
  maquinasIndisponiveis: string[],
  apontamentos14dias: ApontamentoIndicador[],
  porMaquina: HorasPorMaquina,
  fatorReducaoPorMaquina: Record<string, number>,
  periodosComDuracao: PeriodoComDuracao[]
): CapacidadeProvavelItem {
  const etapasAvaliadas = (produto.roteiro || []).map((etapa) =>
    calcularCapacidadeProvavelEtapa(
      etapa,
      (item.maquinasPorEtapa || {})[etapa.id] || [],
      maquinasIndisponiveis,
      item.produtoId,
      maquinaNomePorId,
      porMaquina,
      fatorReducaoPorMaquina,
      periodosComDuracao,
      apontamentos14dias
    )
  );
  const fatoresUsados = etapasAvaliadas.flatMap((e) => e.maquinas.map((m) => m.contexto).filter((c): c is FatorProvavelContexto => c !== null));
  const necessarias = etapasAvaliadas.filter((e) => e.necessaria);

  // Nenhuma etapa configurada com máquina selecionada = zero informação de
  // taxa — indisponível (nunca inventa um valor "sem restrição" quando não
  // há nenhum contexto pra basear uma peça sequer).
  if (necessarias.length === 0) return { capacidadePecas: null, etapasAvaliadas, fatoresUsados };
  if (necessarias.some((e) => !e.disponivel)) return { capacidadePecas: null, etapasAvaliadas, fatoresUsados };

  // ETAPAS SEQUENCIAIS do roteiro: capacidade do produto é o MIN entre as
  // etapas necessárias — todas têm que ocorrer pra terminar a peça. Sem
  // teto (§12): se o fator observado for sustentado > 100% em todas as
  // etapas necessárias, o resultado pode superar a capacidade teórica —
  // permitido e esperado, nunca capado aqui.
  const capacidadePecas = Math.max(0, Math.floor(Math.min(...necessarias.map((e) => e.capacidadePecas as number))));
  return { capacidadePecas, etapasAvaliadas, fatoresUsados };
}

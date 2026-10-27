// PLANEJADOR PURO DE ROTAS (M2) — DEV/Preview, SOMENTE em memória: não escreve Previsão, Escala, WIP, apontamentos nem divisão oficial.
// Pergunta: "como atender a demanda FINAL do produto usando as rotas (CONV, AUTO) e o fluxo COMUM (Etiquetar → Embalar)?"
//
// Fluxo (NÃO existe passagem entre rotas; nada usa max(ordem)/ordem+1 — tudo vem da estrutura: rotas = trecho exclusivo; convergência; pool comum; etapa final explícita):
//   CONV: Rosquear → Parafusar → POOL        AUTO: Rosquear + Parafusar → POOL        POOL: Etiquetar → Embalar → produto final
//
// Algoritmo (política na ORDEM aprovada):
//   1. MAXIMIZAR o produto final:  F = min( D , L , W + Σ capacidade_r )   — D demanda; L capacidade do pool comum (mínimo de Etiquetar, Embalar…); W semiacabado já pronto; capacidade_r da rota r.
//   2. RESPEITAR as restrições físicas: capacidade = máquinas × metas × períodos × dias, menos máquinas indisponíveis e horas comprometidas por outros produtos, × aptidão/revezamento da equipe × desempenho observado.
//   3. NÃO PRODUZIR WIP INÚTIL: as rotas entregam EXATAMENTE E = max(0, F − W) (nem uma peça a mais só para usar capacidade).
//   4. MINIMIZAR CUSTO: E é dividido enchendo primeiro a rota de menor custo EXCLUSIVO (rotas disjuntas ⇒ o preenchimento guloso é ótimo), até o máximo da rota.
//   5. ESTABILIDADE: se existir divisão anterior viável cujo custo exclusivo não passe de (1 + tolerância) do ótimo, ela é mantida.
//   6. DESEMPATE: preferência da rota (menor = preferida), depois o código.
// Nunca se sacrifica atendimento por custo: o passo 4 só escolhe entre divisões que já atendem F.
import { capacidadeEtapa } from "./capacidade";
import { custoComum, custoExclusivoRota, type ContextoCusto } from "./custo";
import { convergenciaDe } from "./estrutura";
import type { ContextoCapacidade, EstruturaProduto, EtapaCadastro } from "./tipos";

export const ALGORITMO_VERSAO = "rotas-planejador-1.0";
const EPS = 1e-9;

export interface EquipeDisponivel {
  pessoasPorOperacao: Record<string, number>;   // pessoas APTAS e disponíveis por operacao_id (ausente = sem limite de pessoas); a aptidão é por operação, não por rota
  revezamentoDuro: boolean;                      // a mesma pessoa NUNCA faz a mesma operação em períodos consecutivos do dia (regra da Escala — não é relaxada)
}
export interface EntradaPlanejador {
  estrutura: EstruturaProduto;
  etapas: Map<string, EtapaCadastro>;
  demanda: number;                                // demanda FINAL restante do produto (uma só)
  ctx: ContextoCapacidade;                        // períodos, dias produtivos, máquinas indisponíveis, horas comprometidas por OUTROS produtos (concorrência real, ex.: E16 × Caixa Amarela)
  selecao: Record<string, string[]>;              // máquinas marcadas NA PREVISÃO por etapa (obrigatório). Etapa sem chave/lista vazia = nenhuma máquina = capacidade 0; o cadastro (elegíveis) nunca completa a seleção
  equipe?: EquipeDisponivel;
  capacidadeRealizavelEscala?: Record<string, number>;   // teto por etapa já calculado pela Escala (revezamento duro, mesma operação não consecutiva): vale o MENOR entre ele e o nominal×equipe
  fatorDesempenho?: Record<string, number>;       // desempenho observado ÷ meta, por etapa (1 = meta; 39.000/35.625 = 1,0947)
  // semiacabado PRONTO para Etiquetar (CONV pronta, AUTO pronta, saldo inicial do pool) e, no fluxo comum, o que já passou por uma etapa e espera a seguinte (ex.: etiquetado aguardando Embalar)
  wipInicial?: { porRota?: Record<string, number>; pool?: number; entreEtapasComuns?: Record<string, number> };
  limiteWip?: number;                             // teto do saldo do pool ao fim do horizonte
  divisaoAnterior?: Record<string, number>;       // entrega por rota da rodada anterior (estabilidade)
  limiteMaximoPorRota?: Record<string, number>;   // V1: só MÁXIMO por rota (previsao_rota_limite)
  toleranciaEstabilidade?: number;                // fração do custo exclusivo aceita para manter a divisão anterior. SEM valor = estabilidade desligada (o 1% do M2 era só experimental; não é regra de negócio)
  custo?: ContextoCusto; valorUnitario?: number;
}

export type CodigoMotivo =
  | "DEMANDA_ATENDIDA" | "GARGALO_COMUM" | "ENTRADA_INSUFICIENTE" | "ROTA_SEM_CAPACIDADE" | "SEM_EXCESSO_DE_PRODUCAO" | "WIP_INICIAL_USADO" | "WIP_ACIMA_DO_LIMITE"
  | "EQUIPE_LIMITA" | "REVEZAMENTO_LIMITA" | "LIMITE_MAXIMO_ROTA" | "ROTA_PREFERIDA_POR_CUSTO" | "ESTABILIDADE_MANTIDA" | "DESEMPENHO_AJUSTA" | "MAQUINAS_COMPARTILHADAS_ENTRE_ROTAS";
export interface Motivo { codigo: CodigoMotivo; texto: string }
export interface Limitante { etapaId: string; operacao: string }
export interface CapacidadeEtapaPlano { etapaId: string; operacao: string; nominal: number; realizavel: number; maquinas: number; fatorEquipe: number }
export interface CapacidadeRotaPlano { rotaCodigo: string; nominal: number; realizavel: number; limitante: Limitante | null; etapas: CapacidadeEtapaPlano[]; maximo: number | null }
export type GargaloPlano =
  | { tipo: "comum"; etapaId: string; operacao: string }
  | { tipo: "entrada"; limitantes: { rotaCodigo: string; etapaId: string; operacao: string; realizavel: number }[] }
  | null;
export interface WipProjetado {
  inicial: { porRota: Record<string, number>; pool: number; total: number };
  entregas: { porRota: Record<string, number>; total: number };
  consumoPool: number;                            // quanto Etiquetar consome do pool (= produto final deste horizonte)
  saldoFinal: number;
  saldoFinalPorRota: Record<string, number>;      // atribuição PROPORCIONAL (sem FIFO)
  acimaDoLimite: boolean;
}
export interface CustoPlano {
  exclusivoPorPeca: Record<string, number>; comumPorPeca: number; finalPorPeca: Record<string, number>;
  estimado: number;                               // Σ entrega_r × exclusivo_r + produto final × comum (a produção NOVA deste horizonte)
  porRota: Record<string, number>;
  economiaAuto: { rotaEconomica: string; rotaBase: string; porPeca: number; volume: number; total: number } | null;
  margem: number | null;
}
export interface SaidaPlanejador {
  versao: string; aplicavel: true;
  demandaFinal: number;
  alvo: Record<string, number>;                   // entrega planejada de CADA rota ao pool (NÃO são duas demandas: só o necessário para a demanda única)
  capacidadePorRota: Record<string, CapacidadeRotaPlano>;
  capacidadeEntrada: number;                      // Σ capacidade realizável das rotas (+ não inclui WIP)
  poolComum: { capacidade: number; limitante: Limitante | null; etapas: CapacidadeEtapaPlano[]; porOperacao: Record<string, number> };
  finalAtingivel: number; falta: number; percentualAtingivel: number;
  gargalo: GargaloPlano;
  motivos: Motivo[];
  wip: WipProjetado;
  custo: CustoPlano | null;
  estabilidade: { divisaoAnteriorMantida: boolean };
  avisos: string[];
}
export interface SaidaNaoAplicavel { versao: string; aplicavel: false; motivo: "produto_linear"; texto: string }

// ---------- aptidão / revezamento → fração operável ----------
// Com revezamento duro cada pessoa só pode operar a MESMA operação em períodos alternados: no máximo ceil(P/2) dos P períodos do dia. k pessoas aptas operam, no máximo, k × ceil(P/2) máquina-períodos
// (cada máquina ocupa 1 pessoa por período): fração = min(1, k × ceil(P/2) ÷ (m × P)). Sem revezamento cada pessoa opera toda máquina que couber: fração = min(1, k ÷ m).
export function fracaoOperavel(maquinas: number, pessoas: number | undefined, periodosPorDia: number, revezamentoDuro: boolean): number {
  if (maquinas <= 0) return 0;
  if (pessoas === undefined) return 1;
  if (pessoas <= 0) return 0;
  const f = revezamentoDuro ? (pessoas * Math.ceil(periodosPorDia / 2)) / (maquinas * periodosPorDia) : pessoas / maquinas;
  return Math.min(1, f);
}

function capacidadeOperacional(e: EtapaCadastro, i: EntradaPlanejador): CapacidadeEtapaPlano {
  const nominalEtapa = capacidadeEtapa(e, i.ctx, i.selecao[e.id] ?? []);   // SEM seleção na Previsão = lista vazia (nunca "todas as elegíveis")
  const m = Object.keys(nominalEtapa.porMaquina).length;
  const f = fracaoOperavel(m, i.equipe?.pessoasPorOperacao[e.operacaoId], i.ctx.periodos.length, i.equipe?.revezamentoDuro ?? false);
  const desempenho = i.fatorDesempenho?.[e.id] ?? 1;
  const teto = i.capacidadeRealizavelEscala?.[e.id] ?? Infinity;
  return { etapaId: e.id, operacao: e.operacao, nominal: nominalEtapa.pecas, realizavel: Math.min(nominalEtapa.pecas * f * desempenho, teto), maquinas: m, fatorEquipe: f };
}

const menor = <T extends { realizavel: number }>(xs: T[]): T | null => xs.reduce<T | null>((m, c) => (m === null || c.realizavel < m.realizavel ? c : m), null);

// ---------- WIP em sombra (somente cálculo) ----------
export function projetarPool(inicialPorRota: Record<string, number>, poolExtra: number, entregaPorRota: Record<string, number>, consumoPool: number, limite?: number): WipProjetado {
  const codigos = [...new Set([...Object.keys(inicialPorRota), ...Object.keys(entregaPorRota)])];
  const disponivelPorRota = Object.fromEntries(codigos.map((c) => [c, (inicialPorRota[c] ?? 0) + (entregaPorRota[c] ?? 0)]));
  const inicialTotal = Object.values(inicialPorRota).reduce((s, v) => s + v, 0) + poolExtra;
  const entregasTotal = Object.values(entregaPorRota).reduce((s, v) => s + v, 0);
  const disponivel = inicialTotal + entregasTotal;
  const saldoFinal = Math.max(0, disponivel - consumoPool);
  // consumo atribuído proporcionalmente ao disponível de cada origem (o pool é fungível: nenhuma peça "veio" de uma rota específica)
  const somaRotas = Object.values(disponivelPorRota).reduce((s, v) => s + v, 0);
  const saldoPorRota = Object.fromEntries(codigos.map((c) => [c, somaRotas > 0 ? saldoFinal * (disponivelPorRota[c] / somaRotas) : 0]));
  return { inicial: { porRota: { ...inicialPorRota }, pool: poolExtra, total: inicialTotal }, entregas: { porRota: { ...entregaPorRota }, total: entregasTotal }, consumoPool, saldoFinal, saldoFinalPorRota: saldoPorRota, acimaDoLimite: limite !== undefined && saldoFinal > limite + EPS };
}

// ---------- planejador ----------
export function planejarRotas(i: EntradaPlanejador): SaidaPlanejador | SaidaNaoAplicavel {
  const est = i.estrutura;
  if (est.modelo !== "rotas" || !est.poolComum) return { versao: ALGORITMO_VERSAO, aplicavel: false, motivo: "produto_linear", texto: "Produto sem rotas: não passa pelo planejador de rotas (segue o caminho legado)." };

  const motivos: Motivo[] = [];
  const avisos: string[] = [];
  const D = Math.max(0, i.demanda);
  const rotas = est.rotas.filter((r) => r.ativa);

  // capacidade de cada rota até a convergência = MÍNIMO das etapas exclusivas em série (Rosquear e Parafusar não se somam)
  const capRotas: Record<string, CapacidadeRotaPlano> = {};
  rotas.forEach((r) => {
    const etapas = r.etapas.map((id) => capacidadeOperacional(i.etapas.get(id) as EtapaCadastro, i));
    const lim = menor(etapas);
    const maximo = i.limiteMaximoPorRota?.[r.codigo] ?? null;
    const realizavel = Math.min(lim?.realizavel ?? 0, maximo ?? Infinity);
    capRotas[r.codigo] = { rotaCodigo: r.codigo, nominal: menor(etapas.map((x) => ({ ...x, realizavel: x.nominal })))?.realizavel ?? 0, realizavel, limitante: lim ? { etapaId: lim.etapaId, operacao: lim.operacao } : null, etapas, maximo };
    const nominalLim = menor(etapas.map((x) => ({ realizavel: x.nominal })))?.realizavel ?? 0;
    if (nominalLim - (lim?.realizavel ?? 0) > 1e-6) {
      const porRevez = (i.equipe?.revezamentoDuro && etapas.some((x) => x.fatorEquipe < 1)) || etapas.some((x) => i.capacidadeRealizavelEscala?.[x.etapaId] !== undefined);
      motivos.push({ codigo: porRevez ? "REVEZAMENTO_LIMITA" : "EQUIPE_LIMITA", texto: `A rota ${r.codigo} fica em ${Math.round(lim?.realizavel ?? 0).toLocaleString("pt-BR")} (nominal ${Math.round(nominalLim).toLocaleString("pt-BR")}) por aptidão da equipe${porRevez ? " e revezamento duro" : ""}.` });
    }
    if (etapas.some((x) => (i.fatorDesempenho?.[x.etapaId] ?? 1) !== 1)) motivos.push({ codigo: "DESEMPENHO_AJUSTA", texto: `Desempenho observado ajusta a capacidade da rota ${r.codigo}.` });
    if (maximo !== null && maximo < (lim?.realizavel ?? 0) - EPS) motivos.push({ codigo: "LIMITE_MAXIMO_ROTA", texto: `Máximo da rota ${r.codigo} limitado a ${Math.round(maximo).toLocaleString("pt-BR")} nesta semana.` });
    if (realizavel <= EPS) motivos.push({ codigo: "ROTA_SEM_CAPACIDADE", texto: `A rota ${r.codigo} não tem capacidade (parada, sem máquina/pessoa ou período) — o produto final continua sendo atendido pelas demais.` });
  });
  // rotas que compartilham máquina: a capacidade somada pode estar superestimada (este planejador assume rotas disjuntas)
  const maqPorRota = rotas.map((r) => new Set(r.etapas.flatMap((id) => i.selecao[id] ?? [])));
  if (maqPorRota.some((a, x) => maqPorRota.some((b, y) => y > x && [...a].some((m) => b.has(m))))) { motivos.push({ codigo: "MAQUINAS_COMPARTILHADAS_ENTRE_ROTAS", texto: "Há máquina compartilhada entre rotas: a soma das capacidades pode estar superestimada." }); avisos.push("rotas com máquinas compartilhadas"); }

  // capacidade do pool comum: cada etapa comum UMA vez (Etiquetar, Embalar); o mínimo limita o produto final
  const comuns = est.poolComum.etapas.map((id) => capacidadeOperacional(i.etapas.get(id) as EtapaCadastro, i));
  const limComum = menor(comuns);
  const entradaTotal = Object.values(capRotas).reduce((s, c) => s + c.realizavel, 0);

  // WIP inicial (pronto para Etiquetar). Só vale até a demanda.
  const wipPorRota = i.wipInicial?.porRota ?? {};
  const wipPool = i.wipInicial?.pool ?? 0;
  const W = Object.values(wipPorRota).reduce((s, v) => s + v, 0) + wipPool;
  // fluxo comum EM SÉRIE com saldos entre etapas: M_1 = min(cap_1, W + entrada); M_(k+1) = min(cap_(k+1), saldo_k + M_k). Sem saldos: min(caps, W + entrada) — igual ao M2.
  const buf = (idx: number) => i.wipInicial?.entreEtapasComuns?.[est.poolComum!.etapas[idx]] ?? 0;
  const cadeia = (entrada: number) => comuns.reduce((m, c, idx) => (idx === 0 ? Math.min(c.realizavel, entrada) : Math.min(c.realizavel, buf(idx - 1) + m)), Infinity);
  const L = comuns.length ? cadeia(Infinity) : Infinity;                      // capacidade do fluxo comum (sem limite de entrada)
  const Fmax = comuns.length ? cadeia(W + entradaTotal) : W + entradaTotal;

  // 1) produto final atingível
  const F = Math.max(0, Math.min(D, Fmax));
  // 3) entregas das rotas: exatamente o necessário (sem WIP inútil): do fim para o começo, cada etapa só precisa processar o que a seguinte não tem em saldo
  let precisa = F; const ncomum: number[] = [];
  for (let idx = comuns.length - 1; idx >= 0; idx--) { ncomum[idx] = precisa; precisa = Math.max(0, precisa - (idx > 0 ? buf(idx - 1) : 0)); }
  const consumoPool = comuns.length ? ncomum[0] : F;                          // quanto a PRIMEIRA etapa comum (Etiquetar) retira do pool
  const E = Math.max(0, consumoPool - W);
  if (W > 0 && E < D) motivos.push({ codigo: "WIP_INICIAL_USADO", texto: `${Math.round(Math.min(W, F)).toLocaleString("pt-BR")} peças já prontas para Etiquetar reduzem o que as rotas precisam entregar.` });
  if (D < entradaTotal + W - EPS && F >= D - EPS) motivos.push({ codigo: "SEM_EXCESSO_DE_PRODUCAO", texto: "A capacidade das rotas supera a demanda: nada é produzido além do necessário." });

  // 4–6) divisão: menor custo exclusivo primeiro; desempate por preferência; estabilidade com divisão anterior
  const exclusivo: Record<string, number> = {};
  rotas.forEach((r) => { exclusivo[r.codigo] = i.custo ? custoExclusivoRota(est, r.codigo, i.etapas, i.custo) : 0; });
  const ordem = [...rotas].sort((a, b) => (i.custo ? exclusivo[a.codigo] - exclusivo[b.codigo] : 0) || a.preferencia - b.preferencia || (a.codigo < b.codigo ? -1 : 1));
  const preencher = (ordemRotas: typeof rotas, quanto: number, base: Record<string, number> = {}) => {
    const x: Record<string, number> = { ...base };
    let resto = quanto - Object.values(base).reduce((s, v) => s + v, 0);
    ordemRotas.forEach((r) => { const livre = Math.max(0, capRotas[r.codigo].realizavel - (x[r.codigo] ?? 0)); const q = Math.min(livre, Math.max(0, resto)); x[r.codigo] = (x[r.codigo] ?? 0) + q; resto -= q; });
    return x;
  };
  let alvo = preencher(ordem, E);
  const custoDe = (x: Record<string, number>) => rotas.reduce((s, r) => s + (x[r.codigo] ?? 0) * exclusivo[r.codigo], 0);
  let mantida = false;
  const tol = i.toleranciaEstabilidade;
  if (i.divisaoAnterior && E > EPS && tol !== undefined && tol >= 0) {
    // divisão anterior ajustada à capacidade e ao necessário de agora (nunca passa do realizável nem do total E)
    const prev: Record<string, number> = {};
    let acumulado = 0;
    [...rotas].sort((a, b) => a.preferencia - b.preferencia).forEach((r) => { const q = Math.min(capRotas[r.codigo].realizavel, i.divisaoAnterior?.[r.codigo] ?? 0, Math.max(0, E - acumulado)); prev[r.codigo] = q; acumulado += q; });
    const completa = preencher(ordem, E, prev);
    const iguais = rotas.every((r) => Math.abs((completa[r.codigo] ?? 0) - (alvo[r.codigo] ?? 0)) < 1e-6);
    if (!iguais && i.custo && custoDe(completa) <= custoDe(alvo) * (1 + tol) + EPS) { alvo = completa; mantida = true; motivos.push({ codigo: "ESTABILIDADE_MANTIDA", texto: `A divisão anterior continua viável e custa no máximo ${(tol * 100).toLocaleString("pt-BR")}% a mais que a ótima (tolerância configurada): foi mantida.` }); }
  }
  if (E > EPS && !mantida && i.custo && ordem.length > 1 && (alvo[ordem[0].codigo] ?? 0) > EPS) motivos.push({ codigo: "ROTA_PREFERIDA_POR_CUSTO", texto: `A rota ${ordem[0].codigo} tem o menor custo exclusivo e é enchida primeiro, até onde há capacidade útil.` });

  // 2) gargalo / motivos de atendimento
  let gargalo: GargaloPlano = null;
  if (D - F > EPS) {
    if (L <= W + entradaTotal + EPS && limComum) { gargalo = { tipo: "comum", etapaId: limComum.etapaId, operacao: limComum.operacao }; motivos.push({ codigo: "GARGALO_COMUM", texto: `${limComum.operacao} (fluxo comum) limita o produto final a ${Math.round(L).toLocaleString("pt-BR")}: o gargalo corta as duas rotas — produzir mais semiacabado não ajuda.` }); }
    else {
      gargalo = { tipo: "entrada", limitantes: Object.values(capRotas).filter((c) => c.limitante).sort((a, b) => a.realizavel - b.realizavel).map((c) => ({ rotaCodigo: c.rotaCodigo, etapaId: (c.limitante as Limitante).etapaId, operacao: (c.limitante as Limitante).operacao, realizavel: c.realizavel })) };
      motivos.push({ codigo: "ENTRADA_INSUFICIENTE", texto: "A soma das rotas (e do WIP pronto) não cobre a demanda." });
    }
  } else motivos.push({ codigo: "DEMANDA_ATENDIDA", texto: "A demanda final cabe nas rotas e no fluxo comum." });

  const wip = projetarPool(wipPorRota, wipPool, alvo, consumoPool, i.limiteWip);
  if (wip.acimaDoLimite) motivos.push({ codigo: "WIP_ACIMA_DO_LIMITE", texto: `O saldo projetado do pool (${Math.round(wip.saldoFinal).toLocaleString("pt-BR")}) passa do limite de WIP.` });

  // custo estimado e economia da AUTO (até a convergência)
  let custo: CustoPlano | null = null;
  if (i.custo) {
    const comum = custoComum(est, i.etapas, i.custo);
    const finalPorPeca = Object.fromEntries(rotas.map((r) => [r.codigo, exclusivo[r.codigo] + comum]));
    const porRota = Object.fromEntries(rotas.map((r) => [r.codigo, (alvo[r.codigo] ?? 0) * exclusivo[r.codigo]]));
    const base = rotas.find((r) => r.codigo === "CONV"), eco = rotas.find((r) => r.codigo === "AUTO");
    const economiaAuto = base && eco ? { rotaEconomica: "AUTO", rotaBase: "CONV", porPeca: exclusivo.CONV - exclusivo.AUTO, volume: alvo.AUTO ?? 0, total: (exclusivo.CONV - exclusivo.AUTO) * (alvo.AUTO ?? 0) } : null;
    const estimado = Object.values(porRota).reduce((s, v) => s + v, 0) + F * comum;
    custo = { exclusivoPorPeca: exclusivo, comumPorPeca: comum, finalPorPeca, estimado, porRota, economiaAuto, margem: i.valorUnitario === undefined ? null : F * i.valorUnitario - estimado };
  }

  return {
    versao: ALGORITMO_VERSAO, aplicavel: true, demandaFinal: D, alvo, capacidadePorRota: capRotas, capacidadeEntrada: entradaTotal,
    poolComum: { capacidade: L, limitante: limComum ? { etapaId: limComum.etapaId, operacao: limComum.operacao } : null, etapas: comuns, porOperacao: Object.fromEntries(comuns.map((c) => [c.operacao, c.realizavel])) },
    finalAtingivel: F, falta: Math.max(0, D - F), percentualAtingivel: D > 0 ? (F / D) * 100 : 100, gargalo, motivos, wip, custo, estabilidade: { divisaoAnteriorMantida: mantida }, avisos,
  };
}

// convergência de apoio (re-exporta para a UI/sombra não depender de estrutura.ts diretamente)
export { convergenciaDe };

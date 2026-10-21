// CONTROLE MÍNIMO DE ESTOQUE INTERMEDIÁRIO (WIP) — núcleo PURO (sem banco). Fase 3.
//
// Conceitos (por produto e par de etapas CONSECUTIVAS origem → seguinte):
//   • ESTIMADO ... saldo inicial + boas produzidas na origem − boas produzidas na etapa seguinte + ajustes. Serve só para consulta:
//                  NÃO altera o planejamento. Nunca é "corrigido" para zero: se der negativo, é INCONSISTÊNCIA.
//   • CONFIRMADO .. uma pessoa atesta quantas peças existem (confirmação). É a única entrada canônica do motor. Vale a última
//                  confirmação; depois dela o saldo confirmado só DIMINUI com o consumo (a etapa seguinte produzindo mais do que a
//                  origem) e com ajustes negativos — produção nova da origem ainda não confirmada é só estimada.
//   • ALOCADO ..... quanto do confirmado a SEMANA usa: reduz o que a etapa ORIGEM precisa produzir (previsto 56.400, WIP 7.200 → produzir
//                  49.200). O Previsto salvo nunca muda. Cada peça é alocada a UMA semana (ordem cronológica), e a foto da abertura da
//                  semana é gravada uma vez e nunca recalculada — então não há dupla utilização nem recálculo retroativo.
//
// Tudo aqui é determinístico: mesmas entradas (controles, ajustes, confirmações, Produção Real, previsões, fotos, "hoje") => mesmo resultado.

export const EPS = 1e-9;

export interface ControleWip {
  id: string;
  produtoId: string;
  etapaOrigemId: string;
  etapaSeguinteId: string;
  dataInicio: string; // "YYYY-MM-DD": a Produção Real conta a partir daqui
  saldoInicial: number;
  ativo: boolean;
}
export interface AjusteWip {
  controleId: string;
  data: string;
  quantidade: number; // + soma / − tira
  motivo: string;
  criadoEm?: string; // ISO — permite enxergar só o que existia em um corte (modo sombra)
}
export interface ConfirmacaoWip {
  id: string;
  controleId: string;
  dataReferencia: string; // vale ao FIM deste dia
  quantidade: number;
  saldoEstimado: number; // o que o sistema estimava quando foi confirmado
  motivo: string | null;
  criadoEm: string; // ISO
}
export interface ProducaoBoa {
  etapaId: string;
  data: string;
  boas: number; // quantidade_produzida − quantidade_refugo
}
export interface SnapshotWip {
  semanaInicio: string;
  controleId: string;
  saldoEstimado: number;
  saldoConfirmadoDisponivel: number;
  saldoAlocado: number;
}
export interface SemanaPrevisaoWip {
  semanaInicio: string;
  quantidadePorProduto: Record<string, number>; // previsto da semana (todas as etapas do produto têm a mesma quantidade)
}
export interface RoteiroWip {
  produtoAtivo: Record<string, boolean>;
  etapasPorProduto: Record<string, { id: string; ordem: number }[]>; // roteiro ATUAL
}
export interface EntradaWip {
  controles: ControleWip[];
  ajustes: AjusteWip[];
  confirmacoes: ConfirmacaoWip[];
  producao: ProducaoBoa[];
  snapshots: SnapshotWip[];
  semanas: SemanaPrevisaoWip[];
  roteiro: RoteiroWip;
  hoje: string; // "YYYY-MM-DD"
}

export type StatusWip = "sem_saldo" | "estimado" | "confirmado" | "divergencia";
export type CodigoInconsistenciaWip =
  | "saldo_negativo" // a etapa seguinte consumiu mais do que a origem produziu (+ saldo inicial/ajustes)
  | "rota_alterada" // as etapas não são mais consecutivas no roteiro atual
  | "etapa_inexistente"
  | "produto_inativo"
  | "confirmacao_sem_justificativa" // confirmação acima do estimado sem motivo
  | "acima_do_limite"; // estoque confirmado acima do limite definido: não apaga nada e impede NOVO WIP (o previsto ainda pode consumi-lo)

export interface InconsistenciaWip {
  codigo: CodigoInconsistenciaWip;
  mensagem: string;
  bloqueante: boolean; // bloqueante: o saldo confirmado NÃO entra no planejamento até alguém resolver
}

// "YYYY-MM-DD" do instante no fuso de São Paulo (a "hoje" do controle de WIP)
export function dataNoFusoSP(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(ms));
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const soma = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

function fluxos(c: ControleWip, e: EntradaWip, de: string, ate: string) {
  const noIntervalo = (d: string) => d >= de && d <= ate;
  const origem = soma(e.producao.filter((p) => p.etapaId === c.etapaOrigemId && noIntervalo(p.data)), (p) => p.boas);
  const seguinte = soma(e.producao.filter((p) => p.etapaId === c.etapaSeguinteId && noIntervalo(p.data)), (p) => p.boas);
  const ajustes = soma(e.ajustes.filter((a) => a.controleId === c.id && noIntervalo(a.data)), (a) => a.quantidade);
  return { origem, seguinte, ajustes };
}

export function ultimaConfirmacao(c: ControleWip, e: EntradaWip, ate: string): ConfirmacaoWip | null {
  const lista = e.confirmacoes
    .filter((x) => x.controleId === c.id && x.dataReferencia <= ate)
    .sort((a, b) => (a.dataReferencia === b.dataReferencia ? (a.criadoEm < b.criadoEm ? 1 : -1) : a.dataReferencia < b.dataReferencia ? 1 : -1));
  return lista[0] ?? null;
}

export interface EstimadoWip {
  valor: number; // pode ser negativo (= inconsistência)
  base: { tipo: "inicial" | "confirmacao"; quantidade: number; dataReferencia: string | null };
  produzidoOrigem: number;
  consumidoSeguinte: number;
  ajustes: number;
}

// Saldo ESTIMADO ao fim de `ate`. Com confirmação, a contagem física vira a nova base (substitui o que veio antes).
export function estimadoAte(c: ControleWip, e: EntradaWip, ate: string): EstimadoWip {
  const conf = ultimaConfirmacao(c, e, ate);
  const de = conf ? somarDias(conf.dataReferencia, 1) : c.dataInicio;
  const f = fluxos(c, e, de, ate);
  const base = conf ? { tipo: "confirmacao" as const, quantidade: conf.quantidade, dataReferencia: conf.dataReferencia } : { tipo: "inicial" as const, quantidade: c.saldoInicial, dataReferencia: null };
  return { valor: base.quantidade + f.origem - f.seguinte + f.ajustes, base, produzidoOrigem: f.origem, consumidoSeguinte: f.seguinte, ajustes: f.ajustes };
}

// Saldo CONFIRMADO ainda disponível ao fim de `ate`: nunca passa do que foi confirmado, nunca é negativo, e só diminui com consumo/ajuste negativo.
export function confirmadoDisponivelAte(c: ControleWip, e: EntradaWip, ate: string): number {
  const conf = ultimaConfirmacao(c, e, ate);
  if (!conf) return 0;
  const est = estimadoAte(c, e, ate).valor;
  return Math.max(0, Math.min(conf.quantidade, est));
}

export function inconsistencias(c: ControleWip, e: EntradaWip): InconsistenciaWip[] {
  const lista: InconsistenciaWip[] = [];
  if (e.roteiro.produtoAtivo[c.produtoId] === false) lista.push({ codigo: "produto_inativo", mensagem: "O produto foi desativado — o saldo não entra no planejamento até alguém revisar.", bloqueante: true });
  const etapas = [...(e.roteiro.etapasPorProduto[c.produtoId] ?? [])].sort((a, b) => a.ordem - b.ordem || (a.id < b.id ? -1 : 1));
  const io = etapas.findIndex((x) => x.id === c.etapaOrigemId);
  const is = etapas.findIndex((x) => x.id === c.etapaSeguinteId);
  if (io < 0 || is < 0) lista.push({ codigo: "etapa_inexistente", mensagem: "Uma das etapas não existe mais no roteiro do produto.", bloqueante: true });
  else if (is !== io + 1) lista.push({ codigo: "rota_alterada", mensagem: "O roteiro mudou: as etapas deixaram de ser consecutivas. Revise o controle antes de usar o saldo.", bloqueante: true });
  const est = estimadoAte(c, e, e.hoje);
  if (est.valor < -EPS) lista.push({ codigo: "saldo_negativo", mensagem: `A etapa seguinte consumiu ${Math.round(-est.valor).toLocaleString("pt-BR")} peças a mais do que a origem produziu. Confira os apontamentos ou ajuste o saldo.`, bloqueante: true });
  const ultima = ultimaConfirmacao(c, e, e.hoje);
  if (ultima && ultima.quantidade > ultima.saldoEstimado + EPS && !(ultima.motivo ?? "").trim()) lista.push({ codigo: "confirmacao_sem_justificativa", mensagem: "A última confirmação é maior que o estimado e não tem justificativa.", bloqueante: true });
  return lista;
}

export interface AlocacaoSemanaWip {
  semanaInicio: string;
  estimadoAbertura: number;
  disponivelAbertura: number; // confirmado ainda não consumido na abertura
  alocado: number; // o que a semana usa
  origem: "snapshot" | "calculado" | "bloqueado" | "sem_confirmacao";
  precisaSnapshot: boolean; // semana já aberta e ainda sem foto
}

function semanasAte(e: EntradaWip, de: string, alvo: string): SemanaPrevisaoWip[] {
  const porInicio = new Map(e.semanas.map((s) => [s.semanaInicio, s]));
  const lista: SemanaPrevisaoWip[] = [];
  for (let s = de; s <= alvo; s = somarDias(s, 7)) lista.push(porInicio.get(s) ?? { semanaInicio: s, quantidadePorProduto: {} });
  return lista;
}

// Início (segunda) da semana que contém `data`
export function inicioDaSemana(data: string): string {
  const d = new Date(`${data}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  return somarDias(data, -dow);
}

export function alocacaoDaSemana(c: ControleWip, e: EntradaWip, semanaAlvo: string): AlocacaoSemanaWip {
  const aberta = semanaAlvo <= e.hoje;
  const snap = e.snapshots.find((s) => s.controleId === c.id && s.semanaInicio === semanaAlvo);
  const estimadoAbertura = estimadoAte(c, e, somarDias(semanaAlvo, -1)).valor;
  if (snap) return { semanaInicio: semanaAlvo, estimadoAbertura: snap.saldoEstimado, disponivelAbertura: snap.saldoConfirmadoDisponivel, alocado: snap.saldoAlocado, origem: "snapshot", precisaSnapshot: false };

  const bloqueado = !c.ativo || inconsistencias(c, e).some((i) => i.bloqueante);
  const conf = ultimaConfirmacao(c, e, e.hoje);
  const zero = (origem: AlocacaoSemanaWip["origem"]): AlocacaoSemanaWip => ({ semanaInicio: semanaAlvo, estimadoAbertura, disponivelAbertura: 0, alocado: 0, origem, precisaSnapshot: aberta });
  if (!conf) return zero("sem_confirmacao");
  if (bloqueado) return zero("bloqueado");

  const primeira = inicioDaSemanaApos(conf.dataReferencia);
  if (primeira > semanaAlvo) return zero("sem_confirmacao"); // a confirmação é da própria semana (ou posterior): só vale para as seguintes
  const semanas = semanasAte(e, primeira, semanaAlvo);
  let estoque = confirmadoDisponivelAte(c, e, somarDias(semanas[0].semanaInicio, -1));
  for (const w of semanas) {
    const snapW = e.snapshots.find((s) => s.controleId === c.id && s.semanaInicio === w.semanaInicio);
    const q = Math.max(0, w.quantidadePorProduto[c.produtoId] ?? 0);
    const disponivel = snapW ? snapW.saldoConfirmadoDisponivel : estoque;
    const alocado = snapW ? snapW.saldoAlocado : Math.min(estoque, q);
    if (w.semanaInicio === semanaAlvo) return { semanaInicio: semanaAlvo, estimadoAbertura, disponivelAbertura: disponivel, alocado, origem: "calculado", precisaSnapshot: aberta };
    const fim = somarDias(w.semanaInicio, 6);
    if (fim < e.hoje) {
      // semana encerrada: vale o que a Produção Real mostrou (consumo real), não o plano
      const f = fluxos(c, e, w.semanaInicio, fim);
      estoque = Math.max(0, Math.min(disponivel, disponivel + f.origem - f.seguinte + f.ajustes));
    } else {
      estoque = Math.max(0, disponivel - alocado); // semana aberta/futura: a reserva do plano
    }
  }
  return zero("sem_confirmacao");
}

// primeira segunda-feira ESTRITAMENTE depois de `data`
function inicioDaSemanaApos(data: string): string {
  const seg = inicioDaSemana(data);
  return seg > data ? seg : somarDias(seg, 7);
}

// Espaço restante para NOVO WIP no par: limite − estoque confirmado que já ocupa o par − WIP adicional já planejado. Nunca negativo.
export function espacoRestanteWip(limite: number, confirmadoOcupando: number, adicionalPlanejado: number): number {
  return Math.max(0, limite - Math.max(0, confirmadoOcupando) - Math.max(0, adicionalPlanejado));
}

// Do saldo confirmado disponível na abertura da semana alvo, o que as semanas FUTURAS já reservam (mesma cadeia da alocação: uma só fonte)
export function reservadoParaSemanasFuturas(c: ControleWip, e: EntradaWip, semanaAlvo: string): number {
  const a = alocacaoDaSemana(c, e, semanaAlvo);
  let estoque = Math.max(0, a.disponivelAbertura - a.alocado);
  let reservado = 0;
  const futuras = e.semanas.filter((s) => s.semanaInicio > semanaAlvo).sort((x, y) => (x.semanaInicio < y.semanaInicio ? -1 : 1));
  for (const w of futuras) {
    const q = Math.max(0, w.quantidadePorProduto[c.produtoId] ?? 0);
    const usa = Math.min(estoque, q);
    reservado += usa;
    estoque -= usa;
  }
  return reservado;
}

export interface ResumoControleWip {
  controle: ControleWip;
  estimado: EstimadoWip; // ao fim de `hoje`
  confirmadoDisponivel: number;
  ultimaConfirmacao: ConfirmacaoWip | null;
  status: StatusWip;
  inconsistencias: InconsistenciaWip[];
  previstoOrigem: number; // previsto da semana alvo (todas as etapas do produto têm o mesmo)
  alocado: number; // WIP confirmado que a semana alvo usa
  aProduzir: number; // previstoOrigem − alocado (etapa origem)
  semana: AlocacaoSemanaWip;
  // Limite de estoque (Fase 3): o mesmo saldo confirmado que reduz a produção e que é reservado às semanas é o que ocupa o limite.
  limite: number | null; // teto de estoque entre as etapas (null = desconhecido)
  confirmadoOcupando: number; // confirmado disponível na abertura da semana alvo (ocupa o par, mesmo que reservado)
  reservadoSemana: number; // do confirmado, o que a semana alvo usa para reduzir a produção da origem
  reservadoFuturo: number; // do confirmado, o que semanas futuras já reservam
  adicionalPlanejado: number; // WIP adicional programado (Previsão) para o par: A_origem − A_seguinte
  espacoRestante: number | null; // limite − confirmado − adicional planejado (≥ 0)
  acimaDoLimite: boolean;
}

export interface OpcoesResumoWip {
  limites?: Record<string, number>; // "produto|etapaOrigem" -> limite
  adicionalPlanejado?: Record<string, number>; // "produto|etapaOrigem" -> WIP adicional programado
}

export function resumoWip(e: EntradaWip, semanaAlvo: string, opcoes: OpcoesResumoWip = {}): ResumoControleWip[] {
  return e.controles
    .filter((c) => c.ativo)
    .map((c) => {
      const inc = inconsistencias(c, e);
      const est = estimadoAte(c, e, e.hoje);
      const conf = confirmadoDisponivelAte(c, e, e.hoje);
      const semana = alocacaoDaSemana(c, e, semanaAlvo);
      const q = Math.max(0, e.semanas.find((s) => s.semanaInicio === semanaAlvo)?.quantidadePorProduto[c.produtoId] ?? 0);
      const chaveP = `${c.produtoId}|${c.etapaOrigemId}`;
      const limite = opcoes.limites?.[chaveP] ?? null;
      const ocupando = semana.disponivelAbertura;
      const planejado = opcoes.adicionalPlanejado?.[chaveP] ?? 0;
      const acima = limite !== null && ocupando > limite + EPS;
      if (acima) inc.push({ codigo: "acima_do_limite", mensagem: "Estoque intermediário acima do limite definido. Nada é apagado nem corrigido; novo WIP fica impedido até o estoque baixar.", bloqueante: false });
      const status: StatusWip = inc.some((i) => i.bloqueante) ? "divergencia" : conf > EPS ? "confirmado" : est.valor > EPS ? "estimado" : "sem_saldo";
      return {
        controle: c, estimado: est, confirmadoDisponivel: conf, ultimaConfirmacao: ultimaConfirmacao(c, e, e.hoje), status, inconsistencias: inc,
        previstoOrigem: q, alocado: semana.alocado, aProduzir: Math.max(0, q - semana.alocado), semana,
        limite, confirmadoOcupando: ocupando, reservadoSemana: semana.alocado, reservadoFuturo: reservadoParaSemanasFuturas(c, e, semanaAlvo), adicionalPlanejado: planejado,
        espacoRestante: limite === null ? null : espacoRestanteWip(limite, ocupando, planejado), acimaDoLimite: acima,
      };
    });
}

// O que o MOTOR recebe para a semana: só saldo CONFIRMADO alocado (> 0). Estimado nunca entra.
export interface SaldoParaMotor {
  controleId: string;
  produtoId: string;
  etapaOrigemId: string;
  etapaSeguinteId: string;
  saldo: number; // alocado à semana: reduz o que a origem produz
  disponivel: number; // confirmado disponível na abertura: OCUPA o limite de estoque do par (mesma fonte do saldo)
}
export interface PlanejamentoWip {
  saldos: SaldoParaMotor[];
  snapshotsNovos: { controleId: string; saldoEstimado: number; saldoConfirmadoDisponivel: number; saldoAlocado: number }[]; // semana já aberta e sem foto
}

export function planejamentoDaSemana(e: EntradaWip, semanaAlvo: string): PlanejamentoWip {
  const saldos: SaldoParaMotor[] = [];
  const snapshotsNovos: PlanejamentoWip["snapshotsNovos"] = [];
  e.controles
    .filter((c) => c.ativo)
    .forEach((c) => {
      const a = alocacaoDaSemana(c, e, semanaAlvo);
      if (a.alocado > EPS || a.disponivelAbertura > EPS) saldos.push({ controleId: c.id, produtoId: c.produtoId, etapaOrigemId: c.etapaOrigemId, etapaSeguinteId: c.etapaSeguinteId, saldo: a.alocado, disponivel: a.disponivelAbertura });
      if (a.precisaSnapshot) snapshotsNovos.push({ controleId: c.id, saldoEstimado: a.estimadoAbertura, saldoConfirmadoDisponivel: a.disponivelAbertura, saldoAlocado: a.alocado });
    });
  return { saldos, snapshotsNovos };
}

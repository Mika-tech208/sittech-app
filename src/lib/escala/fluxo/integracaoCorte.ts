// PLANEJADOR DE CORTE — INTEGRAÇÃO com o recálculo oficial (PURO: sem IO, sem relógio; o planejador entra por injeção).
//
// Quando a semana está em `producao_real_planejador_semanas` (com o modo efetivo "ativo"), `processarSemana` chama `tentarPlanoCorte` NO LUGAR do fluxo/gerarEscala:
//   ok     ⇒ o plano gravado é o do planejador (futuro = slots ≥ aPartirDe; passado intocado), com a distribuição por produto das linhas compartilhadas;
//   !ok    ⇒ `mantido` = o plano VIGENTE do futuro, igual, + alerta `planejador_corte_falhou`. O motor LEGADO nunca recalcula uma semana ativada, e NUNCA se grava um plano
//            que não passou nas checagens independentes (cadeia, material, pessoas, máquinas da Previsão, revezamento, passado, distribuição).
import { hashAlocacoes } from "@/features/escala/horizonte";
import { planejarSemanaComCorte, type ConfigPlanejadorCorte, type ResultadoCorte } from "@/features/escala/fluxo/planoCorte";
import type { AlertaEscala, AlocacaoEscala, ResultadoEscala } from "@/features/escala/types";
import type { EstadoBruto } from "../estado";
import { recomporAlocacoes, type Desdobramento } from "@/features/produto-canonico/adaptadorMotor";
import type { ModeloCanonico } from "@/features/produto-canonico/tipos";
import { virtualizar } from "./produtoUnicoVirtual";
import { dadosProducaoReal, hashDaEntrada, insumosFluxo, jsonPuro, registroBase, regiaoRecalculavel, type ContextoFluxo, type RegistroFluxo } from "./integracao";

export const VERSAO_PLANEJADOR_CORTE = "corte-v1";
export type PlanejarCorte = typeof planejarSemanaComCorte;

export type TentativaPlanoCorte =
  | { ok: true; resultado: ResultadoEscala; registro: RegistroFluxo; corte: ResultadoCorte; hashEntrada: string | null }
  | { ok: false; motivo: string; registro: RegistroFluxo | null; mantido: ResultadoEscala };

const chaveSlot = (a: { data: string; periodoId: string }) => `${a.data}|${a.periodoId}`;

/** O plano vigente do futuro, inalterado, como `ResultadoEscala` (alerta explícito do motivo). Nunca vazio de pessoas: são exatamente as linhas gravadas. */
export function mantidoDoPlano(estado: EstadoBruto, aPartirDe: number, slots: { data: string; periodoId: string; indice: number }[], motivo: string): ResultadoEscala {
  const idx = new Map(slots.map((s) => [chaveSlot(s), s.indice]));
  const linhas = estado.alocacoes.filter((a) => (idx.get(chaveSlot(a)) ?? -1) >= aPartirDe);
  const alertas: AlertaEscala[] = [{ tipo: "planejador_corte_falhou", motivo: `Replanejamento automático não aplicado — plano vigente mantido: ${motivo}`.slice(0, 600) }];
  const resumoSlots = slots.filter((s) => s.indice >= aPartirDe).map((s) => {
    const l = linhas.filter((a) => chaveSlot(a) === chaveSlot(s));
    return { data: s.data, periodoId: s.periodoId, funcionariosDisponiveis: l.length, postosComDemanda: l.filter((a) => a.maquinaId).length, postosPreenchidos: l.filter((a) => a.maquinaId).length, semPosto: l.filter((a) => !a.maquinaId).length };
  });
  return { alocacoes: linhas.map((a) => ({ ...a })), alertas, resumoSlots, primeiraGeracaoComSemanaEmAndamento: false, pecasRestantes: {}, adicionalProduzido: {} };
}

function churnContra(vigente: AlocacaoEscala[], novo: AlocacaoEscala[]): { linhasAlteradas: number; postosAlterados: number } {
  const v = new Map(vigente.map((a) => [`${chaveSlot(a)}|${a.funcionarioId}`, a]));
  let linhas = 0;
  novo.forEach((a) => { const x = v.get(`${chaveSlot(a)}|${a.funcionarioId}`); if (!x || x.maquinaId !== a.maquinaId || x.produtoId !== a.produtoId || x.etapaId !== a.etapaId) linhas++; });
  const postos = (l: AlocacaoEscala[]) => new Set(l.filter((a) => a.maquinaId).map((a) => `${chaveSlot(a)}|${a.maquinaId}|${a.produtoId}|${a.etapaId}`));
  const pv = postos(vigente), pn = postos(novo);
  let alt = 0;
  pn.forEach((k) => { if (!pv.has(k)) alt++; });
  pv.forEach((k) => { if (!pn.has(k)) alt++; });
  return { linhasAlteradas: linhas, postosAlterados: alt };
}

/**
 * PRODUTO ÚNICO (cutover). Único ponto do recálculo que sabe do produto único: `ctx.estado.produtoUnico` (decidido UMA vez em supabaseIO) liga este caminho; ausente = `tentarPlanoCorteBase` direto (byte-idêntico).
 * O planejador de corte pensa em "rotas = cadeias de produto" (planoReverso/ProdutoRev.alimenta): aqui o produto canônico (1 item, 5 etapas, grafo) é DESDOBRADO em memória em duas cadeias
 * de PLANEJAMENTO (adaptadorMotor), o plano volta RECOMPOSTO em ids canônicos e nada virtual é gravado. Dados reais ainda em ids legados são canonizados na leitura (idempotente).
 */
export function tentarPlanoCorte(ctx: ContextoFluxo, pc: NonNullable<EstadoBruto["planejadorCorte"]>, planejar: PlanejarCorte = planejarSemanaComCorte): TentativaPlanoCorte {
  const pu = ctx.estado.produtoUnico;
  if (!pu) return tentarPlanoCorteBase(ctx, pc, planejar);
  return tentarPlanoCorteProdutoUnico(ctx, pc, planejar, pu.modelo);
}

function tentarPlanoCorteProdutoUnico(ctx: ContextoFluxo, pc: NonNullable<EstadoBruto["planejadorCorte"]>, planejar: PlanejarCorte, modelo: ModeloCanonico): TentativaPlanoCorte {
  const estado = ctx.estado;
  const mantidoC = (motivo: string) => mantidoDoPlano(estado, ctx.entrada.aPartirDe, ctx.entrada.slots, motivo);
  const falha = (motivo: string): TentativaPlanoCorte => ({ ok: false, motivo, registro: null, mantido: mantidoC(motivo) });
  let ctxV: ContextoFluxo, d: Desdobramento, pcV: typeof pc;
  try {
    const v = virtualizar(estado, ctx.entrada, ctx.agoraMs, modelo);
    if ("erro" in v) return falha(`produto único: ${v.erro}`);
    d = v.d;
    ctxV = { ...ctx, entrada: v.entradaV, estado: v.estadoV };
    // margem por peça (snapshot congelado em producao_real_planejador_config). Os OUTROS produtos mantêm a margem deles (senão o objetivo reponderia a Escala inteira). Para o produto único:
    // base (rota convencional) = chave da ROTA convencional (produto_rotas.id) > chave do produto canônico > margem do produto LEGADO mapeado para a rota convencional; rota automática = chave da rota >
    // margem do produto legado mapeado para ela > base (delta 0). A automática entra no planejador pelo DELTA sobre a base. Sem nenhuma margem do Conector no snapshot, nada é inventado (valorUnitario).
    const m0 = pc.config.margemPorPeca;
    const rotaConv = modelo.rotas.find((r) => r.tipo === "convencional"), rotaAuto = modelo.rotas.find((r) => r.tipo === "automatica");
    const doLegado = (rotaId?: string) => Object.entries(modelo.produtosLegado).filter(([, v]) => v.rotaId === rotaId).map(([id]) => m0?.[id]).find((x) => x !== undefined);
    const baseM = m0 ? (rotaConv ? m0[rotaConv.id] : undefined) ?? m0[modelo.produtoCanonicoId] ?? doLegado(rotaConv?.id) : undefined;
    const autoM = m0 ? (rotaAuto ? m0[rotaAuto.id] : undefined) ?? doLegado(rotaAuto?.id) : undefined;
    const legados = new Set(Object.keys(modelo.produtosLegado));
    const outros = m0 ? Object.fromEntries(Object.entries(m0).filter(([k]) => !legados.has(k) && k !== modelo.produtoCanonicoId && k !== rotaConv?.id && k !== rotaAuto?.id)) : undefined;
    const margem = m0 ? { ...outros, ...(baseM !== undefined ? { [d.vConv]: baseM, [d.vAuto]: autoM ?? baseM } : {}) } : undefined;
    const { margemPorPeca: _m, ...cfgSem } = pc.config;
    void _m;
    pcV = { ...pc, config: { ...cfgSem, ...(margem ? { margemPorPeca: margem } : {}), produtoUnico: true } };
  } catch (e) {
    return falha(`produto único: preparação falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
  const t = tentarPlanoCorteBase(ctxV, pcV, planejar);
  const paraC = (r: ResultadoEscala): ResultadoEscala => ({
    ...r, alocacoes: recomporAlocacoes(r.alocacoes, d),
    alertas: r.alertas.map((a) => { const c = d.paraCanonico(a.produtoId ?? null, a.etapaId ?? null); return { ...a, ...(a.produtoId ? { produtoId: c.produtoId as string } : {}), ...(a.etapaId ? { etapaId: c.etapaId as string } : {}) }; }),
  });
  if (!t.ok) return { ...t, mantido: mantidoC(t.motivo) };
  return { ...t, resultado: paraC(t.resultado) };
}

function tentarPlanoCorteBase(ctx: ContextoFluxo, pc: NonNullable<EstadoBruto["planejadorCorte"]>, planejar: PlanejarCorte = planejarSemanaComCorte): TentativaPlanoCorte {
  const mantido = (motivo: string) => mantidoDoPlano(ctx.estado, ctx.entrada.aPartirDe, ctx.entrada.slots, motivo);
  // TUDO que pode lançar fica dentro de try: exceção na preparação do estado real ⇒ plano vigente MANTIDO + alerta `planejador_corte_falhou` (nunca evento em erro silencioso, nunca legado)
  let dados: ReturnType<typeof dadosProducaoReal>;
  let entradaF: ReturnType<typeof insumosFluxo>["entrada"];
  let opcoes: ReturnType<typeof insumosFluxo>["opcoes"];
  let base: RegistroFluxo | null = null;
  let vigenteRegiao: AlocacaoEscala[] = [];
  const falha0 = (motivo: string): TentativaPlanoCorte => ({ ok: false, motivo, registro: null, mantido: mantido(motivo) });
  try {
    dados = dadosProducaoReal(ctx.estado, ctx.agoraMs);
    ({ entrada: entradaF, opcoes } = insumosFluxo(ctx.estado, ctx.entrada, ctx.agoraMs));
    base = registroBase(ctx, "ativo", dados, opcoes);
    vigenteRegiao = regiaoRecalculavel(ctx.entrada, ctx.estado.alocacoes);
  } catch (e) {
    return falha0(`preparação do estado real falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
  const falha = (motivo: string, corte: ResultadoCorte | null): TentativaPlanoCorte => {
    let registro: RegistroFluxo | null = null;
    try {
      if (!base) throw new Error("sem base");
      registro = jsonPuro({
        ...base, resultado: "fallback" as const, erro: motivo, hashPlanoOficial: hashAlocacoes(vigenteRegiao), hashPlanoFluxo: hashAlocacoes(vigenteRegiao),
        avaliacaoFluxo: { motor: VERSAO_PLANEJADOR_CORTE, usado: false, tentativas: corte?.tentativas ?? [], checagens: corte?.checagens ?? null },
        violacoes: (corte?.violacoes ?? []).slice(0, 100),
        diagnosticos: [{ codigo: "PLANEJADOR_CORTE_FALHOU", severidade: "erro", mensagem: motivo }],
      });
    } catch { registro = null; }
    return { ok: false, motivo, registro, mantido: mantido(motivo) };
  };
  if (pc.indisponivel) return falha(pc.indisponivel, null);
  if (!pc.distribuicaoSuportada) return falha("coluna `distribuicao` indisponível no banco", null);
  let corte: ResultadoCorte;
  try {
    corte = planejar(entradaF, dados, opcoes, { ...pc.config, partirDoVigente: pc.vigenteDoPlanejador, hashEntradaAnterior: pc.hashEntradaAnterior ?? null } as ConfigPlanejadorCorte, ctx.estado.alocacoes);
  } catch (e) {
    return falha(`planejador de corte lançou: ${e instanceof Error ? e.message : String(e)}`, null);
  }
  if (!corte.ok || !corte.resultado) return falha(corte.motivo ?? "planejador sem resultado", corte);
  const linhas = corte.resultado.alocacoes;
  const ch = churnContra(vigenteRegiao, linhas);
  // contagem marcada como ESTIMADA (cenário B etc.): o plano é válido, mas o WIP inicial NÃO é físico — fica explícito no registro (decisão 10 de 02/11)
  const estimadas = (ctx.estado.producaoReal?.contagensFisicas ?? []).filter((c) => /estimad/i.test(`${c.informadoPor ?? ""} ${c.observacao ?? ""}`));
  const diagEstimado = estimadas.length > 0 ? [{ codigo: "WIP_INICIAL_ESTIMADO" as const, severidade: "aviso" as const, mensagem: `${estimadas.length} contagem(ns) física(s) marcada(s) como ESTIMADA usada(s) como WIP inicial; recalcular na primeira contagem/apontamento confiável` }] : [];
  let registro: RegistroFluxo;
  try {
    registro = jsonPuro({
      ...base, resultado: "ok" as const,
      hashEntrada: hashDaEntrada(ctx, dados, opcoes, corte.estado.ultimoFechado), hashPlanoOficial: hashAlocacoes(vigenteRegiao), hashPlanoFluxo: hashAlocacoes(linhas),
      demandaReal: { produtos: corte.estado.produtos, etapas: corte.estado.etapas, ultimoFechado: corte.estado.ultimoFechado, aPartirDe: corte.estado.aPartirDe },
      wip: { pares: corte.estado.pares, projecao: corte.estado.projecao.wip, previstoPeloPlanejador: corte.saida?.wip ?? null },
      avaliacaoFluxo: {
        motor: VERSAO_PLANEJADOR_CORTE, usado: true, objetivoValor: corte.saida?.objetivoValor ?? null, porProduto: corte.saida?.porProduto ?? [], checagens: corte.checagens,
        tentativas: corte.tentativas, validacaoPlanejador: corte.saida?.validacao ?? null,
      },
      diff: { referencia: "vigente", linhasAlteradas: ch.linhasAlteradas, postosAlterados: ch.postosAlterados },
      churn: { linhasAlteradas: ch.linhasAlteradas, postosAlterados: ch.postosAlterados },
      diagnosticos: [...corte.estado.diagnosticos, ...corte.diagnosticos, ...diagEstimado, { codigo: "PLANEJADOR_CORTE_USADO", severidade: "info", mensagem: `Plano do planejador de corte (${VERSAO_PLANEJADOR_CORTE}) gravado; ${corte.tentativas.length} tentativa(s)` }],
    });
  } catch (e) {
    return falha(`registro do planejador inválido: ${e instanceof Error ? e.message : String(e)}`, corte);
  }
  return { ok: true, resultado: corte.resultado, registro, corte, hashEntrada: corte.hashEntrada };
}

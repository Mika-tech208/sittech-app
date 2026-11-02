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
import { dadosProducaoReal, hashDaEntrada, insumosFluxo, jsonPuro, registroBase, regiaoRecalculavel, type ContextoFluxo, type RegistroFluxo } from "./integracao";

export const VERSAO_PLANEJADOR_CORTE = "corte-v1";
export type PlanejarCorte = typeof planejarSemanaComCorte;

export type TentativaPlanoCorte =
  | { ok: true; resultado: ResultadoEscala; registro: RegistroFluxo; corte: ResultadoCorte }
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

export function tentarPlanoCorte(ctx: ContextoFluxo, pc: NonNullable<EstadoBruto["planejadorCorte"]>, planejar: PlanejarCorte = planejarSemanaComCorte): TentativaPlanoCorte {
  const mantido = (motivo: string) => mantidoDoPlano(ctx.estado, ctx.entrada.aPartirDe, ctx.entrada.slots, motivo);
  const dados = dadosProducaoReal(ctx.estado, ctx.agoraMs);
  const { entrada: entradaF, opcoes } = insumosFluxo(ctx.estado, ctx.entrada, ctx.agoraMs);
  const base = registroBase(ctx, "ativo", dados, opcoes);
  const vigenteRegiao = regiaoRecalculavel(ctx.entrada, ctx.estado.alocacoes);
  const falha = (motivo: string, corte: ResultadoCorte | null): TentativaPlanoCorte => {
    let registro: RegistroFluxo | null = null;
    try {
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
    corte = planejar(entradaF, dados, opcoes, { ...pc.config, partirDoVigente: pc.vigenteDoPlanejador } as ConfigPlanejadorCorte, ctx.estado.alocacoes);
  } catch (e) {
    return falha(`planejador de corte lançou: ${e instanceof Error ? e.message : String(e)}`, null);
  }
  if (!corte.ok || !corte.resultado) return falha(corte.motivo ?? "planejador sem resultado", corte);
  const linhas = corte.resultado.alocacoes;
  const ch = churnContra(vigenteRegiao, linhas);
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
      diagnosticos: [...corte.estado.diagnosticos, ...corte.diagnosticos, { codigo: "PLANEJADOR_CORTE_USADO", severidade: "info", mensagem: `Plano do planejador de corte (${VERSAO_PLANEJADOR_CORTE}) gravado; ${corte.tentativas.length} tentativa(s)` }],
    });
  } catch (e) {
    return falha(`registro do planejador inválido: ${e instanceof Error ? e.message : String(e)}`, corte);
  }
  return { ok: true, resultado: corte.resultado, registro, corte };
}

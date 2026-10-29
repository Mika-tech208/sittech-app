// Orquestração do recálculo de UMA semana — independente de Supabase (IO
// injetado), então o retry por conflito de versão, os casos "ignorado"/
// "sem alteração" e a montagem do payload são testáveis sem banco.
//
// Fluxo: carregar estado -> montar entrada -> motor -> aplicar via RPC.
// Concorrência: a RPC serializa por semana e valida a versão de cada dia;
// em ESCALA_VERSAO_CONFLITO o estado é relido e tudo é recalculado.

import { gerarEscala } from "@/features/escala/gerarEscala";
import { AVISO_PRIMEIRA_GERACAO, type AlertaEscala, type EntradaEscala, type PeriodoEscala, type ResultadoEscala } from "@/features/escala/types";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { montarEntradaEscala } from "./montarEntrada";
import { assinaturaAlertas, planosIguais } from "./planoIgual";
import { ConflitoDeVersaoError, type EstadoBruto, type PayloadAplicacao, type ResultadoProcessamento, type SnapshotWipParaGravar } from "./estado";
import { avaliarFluxoSombra, nucleoFluxo, tentarPlanoFluxo, type GatilhoFluxo, type NucleoFluxo, type RegistroFluxo } from "./fluxo/integracao";

export const MOTIVO_ESCALA_JA_EXISTE = "Escala da semana já existe";

// PONTO DE CORTE do recálculo = o PRIMEIRO período que AINDA NÃO COMEÇOU entre (a) os slots mutáveis e (b) os períodos dos dias que deixaram de ser produtivos.
// PASSADO É IMUTÁVEL: nada que comece antes do corte é apagado nem reescrito. Sem nenhum período futuro (nem slot nem período removível) => null => NO-OP.
// (Antes: sem slot futuro, o corte virava o 1º período do dia removido — mesmo que já tivesse ocorrido — e a RPC apagava a Escala histórica.)
export function pontoDeCorte(
  entrada: Pick<EntradaEscala, "slots" | "aPartirDe">,
  removerDias: string[],
  periodosPorDia: Map<string, PeriodoEscala[]>,
  agoraMs: number
): { data: string; periodoId: string } | null {
  const candidatos: { data: string; periodoId: string; ms: number }[] = [];
  const slot = entrada.slots[entrada.aPartirDe];
  if (slot) candidatos.push({ data: slot.data, periodoId: slot.periodoId, ms: slot.inicioMs });
  for (const data of removerDias) {
    const futuro = (periodosPorDia.get(data) ?? [])
      .map((p) => ({ data, periodoId: p.id, ms: epochMsNoFuso(data, p.inicio) }))
      .filter((c) => c.ms > agoraMs)
      .sort((a, b) => a.ms - b.ms)[0];
    if (futuro) candidatos.push(futuro);
  }
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => a.ms - b.ms);
  return { data: candidatos[0].data, periodoId: candidatos[0].periodoId };
}

export interface EscalaIO {
  carregarEstado(agoraMs?: number): Promise<EstadoBruto>; // agoraMs: só o consolidado (períodos já iniciados) entra no histórico de equidade
  aplicar(payload: PayloadAplicacao): Promise<{ versoes: Record<string, number> }>;
  // Foto de abertura da semana (WIP): idempotente, a 1ª gravada vale. Opcional (só o banco real e o banco em memória implementam).
  gravarSnapshotsWip?(semanaInicio: string, snapshots: SnapshotWipParaGravar[]): Promise<void>;
  // Escala Inteligente (fluxo): grava o diagnóstico (escala_fluxo_registrar, idempotente). Só é chamado com o modo efetivo sombra/ativo. NUNCA deve impedir o recálculo.
  registrarFluxo?(registro: RegistroFluxo): Promise<void>;
}

export interface OpcoesProcessamento {
  agoraMs: number;
  usuarioId?: string | null;
  eventoIds?: string[];
  criarSeNaoExiste: boolean; // só a geração manual cria escala; eventos só recalculam escalas que já existem
  // Geração automática: só CRIA. Se a escala da semana já existe (inclusive porque outra chamada
  // acabou de criar — o retry após conflito relê o estado), nada é alterado. Idempotente.
  somenteSeNaoExiste?: boolean;
  maxTentativas?: number;
  // Escala Inteligente (fluxo) — só têm efeito quando `estado.producaoReal` existe (modo efetivo sombra/ativo da semana).
  nucleoFluxo?: NucleoFluxo; // injeção (testes); padrão = núcleo real
  gatilhoFluxo?: GatilhoFluxo; // padrão: 'manual' (geração manual) ou 'evento'
  corteFluxo?: { data: string; periodoId: string } | null; // período fechado que originou o recálculo (gatilho 'fechamento')
}

export async function processarSemana(io: EscalaIO, opcoes: OpcoesProcessamento): Promise<ResultadoProcessamento> {
  const maxTentativas = opcoes.maxTentativas ?? 3;
  let ultimoConflito: Error | null = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    const estado = await io.carregarEstado(opcoes.agoraMs);

    if (opcoes.somenteSeNaoExiste && estado.diasExistentes.length > 0) {
      return { status: "ignorado", motivoIgnorado: MOTIVO_ESCALA_JA_EXISTE, tentativas: tentativa, alertas: [], alocacoesGravadas: 0 };
    }
    if (estado.diasExistentes.length === 0 && !opcoes.criarSeNaoExiste) {
      return { status: "ignorado", motivoIgnorado: "Semana sem escala gerada", tentativas: tentativa, alertas: [], alocacoesGravadas: 0 };
    }

    const montada = montarEntradaEscala(estado, opcoes.agoraMs);
    // REVEZAMENTO POR BLOCO — exposição individual = (1) troca manual registrada; senão (2) alocação congelada da Escala. O `funcionario_id` do apontamento é quem LANÇOU,
    // não prova quem operou (29/10: só 2 de 26 apontamentos conferiam com a operação congelada do lançador), por isso NÃO vira evidência de exposição (hotfix 29/10).
    // O apontamento segue valendo para produção, boas, refugo, WIP e demanda restante. `exposicaoDeApontamentos` continua exportada (replay/testes); futuro: `operador_real_id`.
    const entrada: EntradaEscala = montada.entrada;

    if (entrada.pools.length === 0 && estado.diasExistentes.length === 0) {
      return { status: "ignorado", motivoIgnorado: "Previsão sem itens com máquinas selecionadas", tentativas: tentativa, alertas: montada.avisos, alocacoesGravadas: 0 };
    }
    const corte = pontoDeCorte(entrada, montada.removerDias, montada.periodosPorDia, opcoes.agoraMs);
    if (!corte) {
      // nada recalculável: nenhum slot futuro e nenhum período futuro a remover (semana toda já ocorrida) => NO-OP operacional; o histórico não é tocado
      return { status: "sem_alteracao", tentativas: tentativa, alertas: [], alocacoesGravadas: 0 };
    }

    // ESCALA INTELIGENTE (fluxo). `estado.producaoReal` só existe com o modo EFETIVO da semana em sombra/ativo; com `desligado` este bloco é inerte e o
    // caminho abaixo é exatamente o anterior (gerarEscala). Em ATIVO o plano vem do fluxo; qualquer falha (exceção, hard constraint, passado) CAI no oficial.
    const pr = estado.producaoReal;
    const nucleo = opcoes.nucleoFluxo ?? nucleoFluxo;
    const ctxFluxo = pr ? { nucleo, estado, entrada, agoraMs: opcoes.agoraMs, gatilho: opcoes.gatilhoFluxo ?? (opcoes.criarSeNaoExiste ? ("manual" as const) : ("evento" as const)), corte: opcoes.corteFluxo ?? null } : null;
    let resultado: ResultadoEscala | undefined;
    let registroAtivo: RegistroFluxo | null = null;
    let fluxoUsado = false;
    if (pr && ctxFluxo && pr.modoEfetivo === "ativo") {
      const t = tentarPlanoFluxo(ctxFluxo);
      registroAtivo = t.registro;
      if (t.ok) {
        resultado = { ...t.resultado, alocacoes: [...t.resultado.alocacoes] };
        fluxoUsado = true;
      } else console.error(`escala/fluxo: fallback para o motor oficial (${estado.semanaInicio}): ${t.motivo}`);
    }
    if (!resultado) resultado = gerarEscala(entrada);
    // A troca manual que o motor manteve continua sendo "manual" (decisão de uma pessoa); o resto é
    // saída automática. Sem isso a marca se perderia no 1º recálculo e a troca viraria acaso.
    const chaveTroca = (x: { data: string; periodoId: string; funcionarioId: string; maquinaId: string | null }) => `${x.data}|${x.periodoId}|${x.funcionarioId}|${x.maquinaId ?? ""}`;
    const manuaisMantidas = new Set((entrada.trocasManuais ?? []).map(chaveTroca));
    resultado.alocacoes = resultado.alocacoes.map((x) => (manuaisMantidas.has(chaveTroca(x)) ? { ...x, origem: "manual" as const } : x));
    const aPartirDeData = corte.data;
    const aPartirDePeriodo = corte.periodoId;

    // seleções da Previsão que o roteiro atual não torna elegíveis: ignoradas pelo motor e SEMPRE registradas no resumo do recálculo (a Previsão não é corrigida em silêncio)
    const invalidas: AlertaEscala[] = montada.avisos
      .filter((a) => a.tipo === "selecao_maquina_invalida")
      .map((a) => ({ tipo: "selecao_maquina_invalida" as const, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, maquinaId: a.maquinaId, motivo: `Semana ${a.semanaInicio}: a máquina selecionada não é elegível para esta etapa no roteiro atual e foi ignorada.` }));

    const diasAplicar = [...new Set(entrada.slots.map((s) => s.data))]
      .filter((data) => !montada.removerDias.includes(data) || data === aPartirDeData)
      .map((data) => ({
        data,
        versao_base: montada.diasExistentesPorData.get(data)?.versao ?? null,
        periodos_snapshot: montada.periodosPorDia.get(data) ?? [],
      }));

    // Registro do diagnóstico do fluxo (idempotente no banco). Depois que o plano foi gravado (ou confirmado idêntico): nunca antes, nunca lança.
    //  - ativo: aplicado = o plano gravado É o do fluxo; NO-OP e fallback não "aplicam" nada.
    //  - sombra: avalia o plano oficial que ficou vigente × o plano de fluxo; não altera nada.
    const registrarFluxo = async (aplicou: boolean): Promise<ResultadoProcessamento["fluxo"] | undefined> => {
      if (!pr || !ctxFluxo) return undefined;
      try {
        const registro: RegistroFluxo = pr.modoEfetivo === "ativo" ? { ...(registroAtivo as RegistroFluxo), aplicado: aplicou && fluxoUsado } : avaliarFluxoSombra(ctxFluxo, resultado!.alocacoes);
        if (pr.modoEfetivo === "ativo" && !aplicou && fluxoUsado) registro.replanejamento = { ...registro.replanejamento, aplicacao: "noop" };
        if (io.registrarFluxo) await io.registrarFluxo(registro);
        return { modo: pr.modoEfetivo, resultado: registro.resultado, usado: pr.modoEfetivo === "ativo" && fluxoUsado };
      } catch (e) {
        console.error("escala/fluxo: falha ao registrar o diagnóstico:", e instanceof Error ? e.message : e);
        return undefined;
      }
    };

    // NO-OP do recálculo oficial: o plano resultante é semanticamente IDÊNTICO ao gravado na região afetada, não há dia novo/removido e os alertas do recálculo não mudaram =>
    // nada é regravado, nenhuma `versao` sobe, nenhum evento 'recalculo' é gravado (o chamador dá os eventos como processados). Primeira geração e qualquer dia novo nunca são no-op.
    const assinatura = assinaturaAlertas([...invalidas, ...resultado.alertas]);
    if (montada.removerDias.length === 0 && estado.diasExistentes.length > 0 && diasAplicar.every((d) => d.versao_base !== null) && estado.ultimaAssinaturaAlertas === assinatura) {
      const indice = new Map(entrada.slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
      const atualNaRegiao = estado.alocacoes.filter((a) => (indice.get(`${a.data}|${a.periodoId}`) ?? -1) >= entrada.aPartirDe);
      if (planosIguais(atualNaRegiao, resultado.alocacoes)) {
        const fluxo = await registrarFluxo(false);
        return { status: "sem_alteracao", tentativas: tentativa, alertas: [], alocacoesGravadas: 0, ...(fluxo ? { fluxo } : {}) };
      }
    }

    const payload: PayloadAplicacao = {
      previsaoId: estado.previsaoId,
      dias: diasAplicar,
      aPartirDeData,
      aPartirDePeriodo,
      alocacoes: resultado.alocacoes,
      removerDias: montada.removerDias,
      usuarioId: opcoes.usuarioId ?? null,
      eventoIds: opcoes.eventoIds ?? [],
      resumo: {
        alocacoes: resultado.alocacoes.length,
        semPosto: resultado.alocacoes.filter((a) => !a.maquinaId).length,
        excecoesRevezamento: resultado.alocacoes.filter((a) => a.excecaoRevezamento).length,
        alertas: resultado.alertas.length + invalidas.length,
        alertasDetalhe: [...invalidas, ...resultado.alertas].slice(0, 300),
        selecoesInvalidas: invalidas.length, // histórico do módulo: a tela mostra os alertas do último recálculo
        assinaturaAlertas: assinatura, // base do NO-OP do próximo recálculo
        primeiraGeracaoComSemanaEmAndamento: resultado.primeiraGeracaoComSemanaEmAndamento,
        ...(registroAtivo ? { fluxo: { modo: "ativo", resultado: registroAtivo.resultado, usado: fluxoUsado, versaoMotor: registroAtivo.versaoMotor, hashPlanoFluxo: registroAtivo.hashPlanoFluxo } } : {}),
      },
    };

    try {
      // a foto da abertura é gravada ANTES da escala: se a escala for aplicada, a foto que a explica já existe
      if (montada.snapshotsWip.length > 0 && io.gravarSnapshotsWip) await io.gravarSnapshotsWip(estado.semanaInicio, montada.snapshotsWip);
      const { versoes } = await io.aplicar(payload);
      const fluxo = await registrarFluxo(true);
      return {
        status: "processado",
        tentativas: tentativa,
        versoes,
        alertas: [...resultado.alertas, ...montada.avisos],
        aviso: resultado.primeiraGeracaoComSemanaEmAndamento ? AVISO_PRIMEIRA_GERACAO : undefined,
        alocacoesGravadas: resultado.alocacoes.length,
        ...(fluxo ? { fluxo } : {}),
      };
    } catch (e) {
      if (e instanceof ConflitoDeVersaoError) {
        ultimoConflito = e;
        continue;
      }
      throw e;
    }
  }
  throw ultimoConflito ?? new ConflitoDeVersaoError("Conflito de versão após múltiplas tentativas");
}

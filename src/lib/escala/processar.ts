// Orquestração do recálculo de UMA semana — independente de Supabase (IO
// injetado), então o retry por conflito de versão, os casos "ignorado"/
// "sem alteração" e a montagem do payload são testáveis sem banco.
//
// Fluxo: carregar estado -> montar entrada -> motor -> aplicar via RPC.
// Concorrência: a RPC serializa por semana e valida a versão de cada dia;
// em ESCALA_VERSAO_CONFLITO o estado é relido e tudo é recalculado.

import { gerarEscala } from "@/features/escala/gerarEscala";
import { AVISO_PRIMEIRA_GERACAO, type AlertaEscala, type EntradaEscala, type PeriodoEscala } from "@/features/escala/types";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { reverterResultado } from "@/features/rotas/adaptador";
import { registrosDeDivisao, type RegistroDivisao } from "@/features/rotas/resolucao";
import { montarEntradaEscala } from "./montarEntrada";
import { ConflitoDeVersaoError, type EstadoBruto, type PayloadAplicacao, type ResultadoProcessamento, type SnapshotWipParaGravar } from "./estado";

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
  // Divisão entre rotas (M3, append-only, idempotente por hash+rodada). Só é chamada quando a semana tem produto de rotas; semanas só com produtos lineares nunca passam por aqui.
  gravarDivisaoRotas?(registros: RegistroDivisao[]): Promise<void>;
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

    // PRODUTO DE ROTAS (M3): divisão AUTO/CONV com feedback da Escala; o motor recebe cadeias virtuais e tudo volta ao produto real. Semana sem produto de rotas: `null` — nada muda.
    const montada = montarEntradaEscala(estado, opcoes.agoraMs);
    const rotas = montada.rotas ?? null;
    const { entrada } = montada;

    if (entrada.pools.length === 0 && estado.diasExistentes.length === 0) {
      return { status: "ignorado", motivoIgnorado: "Previsão sem itens com máquinas selecionadas", tentativas: tentativa, alertas: montada.avisos, alocacoesGravadas: 0 };
    }
    const corte = pontoDeCorte(entrada, montada.removerDias, montada.periodosPorDia, opcoes.agoraMs);
    if (!corte) {
      // nada recalculável: nenhum slot futuro e nenhum período futuro a remover (semana toda já ocorrida) => NO-OP operacional; o histórico não é tocado
      return { status: "sem_alteracao", tentativas: tentativa, alertas: [], alocacoesGravadas: 0 };
    }

    const resultado = rotas ? reverterResultado(gerarEscala(entrada)) : gerarEscala(entrada);
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
        primeiraGeracaoComSemanaEmAndamento: resultado.primeiraGeracaoComSemanaEmAndamento,
      },
    };

    try {
      // a foto da abertura é gravada ANTES da escala: se a escala for aplicada, a foto que a explica já existe
      if (montada.snapshotsWip.length > 0 && io.gravarSnapshotsWip) await io.gravarSnapshotsWip(estado.semanaInicio, montada.snapshotsWip);
      const { versoes } = await io.aplicar(payload);
      if (rotas && io.gravarDivisaoRotas) await io.gravarDivisaoRotas(registrosDeDivisao(estado, rotas));
      return {
        status: "processado",
        tentativas: tentativa,
        versoes,
        alertas: [...resultado.alertas, ...montada.avisos],
        aviso: resultado.primeiraGeracaoComSemanaEmAndamento ? AVISO_PRIMEIRA_GERACAO : undefined,
        alocacoesGravadas: resultado.alocacoes.length,
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

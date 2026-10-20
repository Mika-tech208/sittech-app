// Orquestração do recálculo de UMA semana — independente de Supabase (IO
// injetado), então o retry por conflito de versão, os casos "ignorado"/
// "sem alteração" e a montagem do payload são testáveis sem banco.
//
// Fluxo: carregar estado -> montar entrada -> motor -> aplicar via RPC.
// Concorrência: a RPC serializa por semana e valida a versão de cada dia;
// em ESCALA_VERSAO_CONFLITO o estado é relido e tudo é recalculado.

import { gerarEscala } from "@/features/escala/gerarEscala";
import { AVISO_PRIMEIRA_GERACAO } from "@/features/escala/types";
import { montarEntradaEscala } from "./montarEntrada";
import { ConflitoDeVersaoError, type EstadoBruto, type PayloadAplicacao, type ResultadoProcessamento } from "./estado";

export const MOTIVO_ESCALA_JA_EXISTE = "Escala da semana já existe";

export interface EscalaIO {
  carregarEstado(): Promise<EstadoBruto>;
  aplicar(payload: PayloadAplicacao): Promise<{ versoes: Record<string, number> }>;
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
    const estado = await io.carregarEstado();

    if (opcoes.somenteSeNaoExiste && estado.diasExistentes.length > 0) {
      return { status: "ignorado", motivoIgnorado: MOTIVO_ESCALA_JA_EXISTE, tentativas: tentativa, alertas: [], alocacoesGravadas: 0 };
    }
    if (estado.diasExistentes.length === 0 && !opcoes.criarSeNaoExiste) {
      return { status: "ignorado", motivoIgnorado: "Semana sem escala gerada", tentativas: tentativa, alertas: [], alocacoesGravadas: 0 };
    }

    const montada = montarEntradaEscala(estado, opcoes.agoraMs);
    const { entrada } = montada;

    if (entrada.pools.length === 0 && estado.diasExistentes.length === 0) {
      return { status: "ignorado", motivoIgnorado: "Previsão sem itens com máquinas selecionadas", tentativas: tentativa, alertas: montada.avisos, alocacoesGravadas: 0 };
    }
    if (entrada.aPartirDe >= entrada.slots.length && montada.removerDias.length === 0) {
      return { status: "sem_alteracao", tentativas: tentativa, alertas: [], alocacoesGravadas: 0 };
    }

    const resultado = gerarEscala(entrada);
    const slotCorte = entrada.slots[entrada.aPartirDe];
    // se só há dias a remover e nenhum slot mutável, corta no começo do dia mais próximo removido
    const aPartirDeData = slotCorte?.data ?? montada.removerDias.slice().sort()[0];
    const aPartirDePeriodo = slotCorte?.periodoId ?? (montada.periodosPorDia.get(aPartirDeData) ?? [])[0]?.id ?? "m1";

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
        alertas: resultado.alertas.length,
        alertasDetalhe: resultado.alertas.slice(0, 300), // histórico do módulo: a tela mostra os alertas do último recálculo
        primeiraGeracaoComSemanaEmAndamento: resultado.primeiraGeracaoComSemanaEmAndamento,
      },
    };

    try {
      const { versoes } = await io.aplicar(payload);
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

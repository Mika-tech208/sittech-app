// Geração automática da Escala toda segunda-feira (06:30 America/Sao_Paulo).
// Lógica PURA/orquestração com dependências injetadas — testável sem banco e
// sem relógio. O horário UTC do GitHub NÃO é confiável: tudo é validado aqui,
// no servidor, em America/Sao_Paulo.
//
//   1. calcula "agora" em America/Sao_Paulo (data, dia da semana, semana atual);
//   2. só gera em SEGUNDA-FEIRA (fuso operacional) — qualquer outro dia é no-op;
//   3. localiza a Previsão da semana; se não existe/é inválida, NÃO inventa
//      escala: registra um erro operacional detectável e responde "sem_previsao";
//   4. se a escala da semana já existe, responde "ja_existe" sem alterar nada;
//   5. senão gera (só cria) pelo mesmo processador de sempre — locks e versões
//      garantem uma única escala mesmo com chamadas simultâneas.

import { dataHoraNoFuso } from "@/features/escala/tempo";
import { MOTIVO_ESCALA_JA_EXISTE } from "./processar";
import type { ResultadoProcessamento } from "./estado";

export const MENSAGEM_SEM_PREVISAO = "Não foi possível gerar a Escala de Produção da semana porque não existe Previsão Semanal.";
export const MENSAGEM_PREVISAO_INVALIDA = "Não foi possível gerar a Escala de Produção da semana: a Previsão Semanal não tem itens com máquinas selecionadas.";

export interface ContextoSemana {
  dataLocal: string; // "YYYY-MM-DD" em America/Sao_Paulo
  diaDaSemana: number; // 0=domingo … 6=sábado
  semanaInicio: string; // segunda-feira da semana atual (America/Sao_Paulo)
  minutosDoDia: number;
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function contextoSemanaSP(agoraMs: number): ContextoSemana {
  const { data, minutos } = dataHoraNoFuso(agoraMs);
  const dia = new Date(data + "T00:00:00Z").getUTCDay();
  return { dataLocal: data, diaDaSemana: dia, semanaInicio: somarDias(data, -((dia + 6) % 7)), minutosDoDia: minutos };
}

// Segunda-feira tem 3 execuções (06:30 principal; 07:30 e 09:30 recuperação). Quem
// diferencia é o agendamento que disparou — não o relógio, que o GitHub pode atrasar.
export type TentativaGeracao = "principal" | "recuperacao";
export type ClassificacaoGeracao = "geracao_principal" | "geracao_recuperacao" | "ja_existia";

export function classificarGeracao(tentativa: TentativaGeracao): ClassificacaoGeracao {
  return tentativa === "recuperacao" ? "geracao_recuperacao" : "geracao_principal";
}

export type ResultadoGeracaoSemanal =
  | { status: "gerada"; semanaInicio: string; alocacoesGravadas: number; aviso?: string; tentativa: TentativaGeracao; classificacao: ClassificacaoGeracao }
  | { status: "ja_existe"; semanaInicio: string; tentativa: TentativaGeracao; classificacao: "ja_existia" }
  | { status: "sem_previsao"; semanaInicio: string; mensagem: string }
  | { status: "previsao_invalida"; semanaInicio: string; mensagem: string }
  | { status: "fora_da_janela"; dataLocal: string; diaDaSemana: number; motivo: string }
  | { status: "semana_nao_atual"; semanaInicio: string; semanaAtual: string };

export interface DepsGeracaoSemanal {
  resolverPrevisao(semanaInicio: string): Promise<string | null>;
  semanaTemEscala(previsaoId: string): Promise<boolean>;
  // gera SOMENTE se não existir (somenteSeNaoExiste) — a chamada pode perder a corrida e voltar "ignorado: já existe"
  gerar(previsaoId: string): Promise<ResultadoProcessamento>;
  registrarErro(semanaInicio: string, mensagem: string): Promise<void>;
  registrarGerada(semanaInicio: string, previsaoId: string, resumo: Record<string, unknown>, tentativa: TentativaGeracao): Promise<void>;
  // a escala já existia (retry, execução de recuperação ou perdeu a corrida): fica no histórico como "já existia"
  registrarJaExistia(semanaInicio: string, previsaoId: string, tentativa: TentativaGeracao): Promise<void>;
}

export interface OpcoesGeracaoSemanal {
  tentativa?: TentativaGeracao; // padrão: principal
  // Chamada agendada: exige segunda-feira. Retentativa de um evento antigo: informa a semana alvo
  // (deve ser a semana atual) e dispensa a exigência do dia da semana.
  semanaAlvo?: string;
}

export async function gerarEscalaSemanal(deps: DepsGeracaoSemanal, agoraMs: number, opcoes: OpcoesGeracaoSemanal = {}): Promise<ResultadoGeracaoSemanal> {
  const ctx = contextoSemanaSP(agoraMs);
  const tentativa: TentativaGeracao = opcoes.tentativa ?? "principal";

  let semana = ctx.semanaInicio;
  if (opcoes.semanaAlvo) {
    if (opcoes.semanaAlvo !== ctx.semanaInicio) return { status: "semana_nao_atual", semanaInicio: opcoes.semanaAlvo, semanaAtual: ctx.semanaInicio };
    semana = opcoes.semanaAlvo;
  } else if (ctx.diaDaSemana !== 1) {
    return { status: "fora_da_janela", dataLocal: ctx.dataLocal, diaDaSemana: ctx.diaDaSemana, motivo: "A geração automática só ocorre na segunda-feira (America/Sao_Paulo)" };
  }

  const previsaoId = await deps.resolverPrevisao(semana);
  if (!previsaoId) {
    await deps.registrarErro(semana, MENSAGEM_SEM_PREVISAO);
    return { status: "sem_previsao", semanaInicio: semana, mensagem: MENSAGEM_SEM_PREVISAO };
  }

  if (await deps.semanaTemEscala(previsaoId)) {
    await deps.registrarJaExistia(semana, previsaoId, tentativa);
    return { status: "ja_existe", semanaInicio: semana, tentativa, classificacao: "ja_existia" };
  }

  const r = await deps.gerar(previsaoId);
  if (r.status === "processado") {
    await deps.registrarGerada(semana, previsaoId, { alocacoesGravadas: r.alocacoesGravadas, tentativas: r.tentativas, aviso: r.aviso ?? null }, tentativa);
    return { status: "gerada", semanaInicio: semana, alocacoesGravadas: r.alocacoesGravadas, aviso: r.aviso, tentativa, classificacao: classificarGeracao(tentativa) };
  }
  if (r.motivoIgnorado === MOTIVO_ESCALA_JA_EXISTE) {
    await deps.registrarJaExistia(semana, previsaoId, tentativa); // perdeu a corrida para outra execução
    return { status: "ja_existe", semanaInicio: semana, tentativa, classificacao: "ja_existia" };
  }
  if (r.status === "sem_alteracao") {
    return { status: "fora_da_janela", dataLocal: ctx.dataLocal, diaDaSemana: ctx.diaDaSemana, motivo: "Nenhum período futuro na semana para gerar" };
  }
  await deps.registrarErro(semana, MENSAGEM_PREVISAO_INVALIDA);
  return { status: "previsao_invalida", semanaInicio: semana, mensagem: MENSAGEM_PREVISAO_INVALIDA };
}

// Serviço do MODO SOMBRA (Fase 4d) — independente de Supabase (IO injetado), como processar.ts: fechamento do período, evento lógico
// único, decisão sombra, snapshot append-only. NUNCA grava na Escala oficial (não há `aplicar` aqui) e NUNCA altera snapshot já gravado.
//
// Fluxo por evento lógico (semana + data + período):
//   1. modo: desligado => nada; sombra => processa; ativo => tratado como sombra (falha segura, aviso no resumo);
//   2. fechamento (fechamento.ts): enquanto não estável/20 min => AGUARDA sem reivindicar (não consome tentativa);
//   3. reivindica o evento (atômico no banco) => decisão => snapshot idempotente => conclui.
// O CORTE é o instante em que o período fechou (calculado pelos carimbos dos lançamentos), não o instante em que o worker roda.

import { analisarAtingibilidade } from "@/features/escala/atingibilidade";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { instanteDeFechamento, lancamentosTardios, type AvaliacaoFechamento, type LancamentoCarimbado } from "@/features/escala/fechamento";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { jsonCanonico } from "@/features/escala/hashCanonico";
import { modoEfetivoReplanejamento, type ModoReplanejamento } from "@/features/escala/parametros";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import { completudeDe, construirSnapshot, empacotarApontamento, empacotarLinha, paraParametrosCorte, type EntradaCanonicaCorte, type PlanoOficialRef, type SnapshotSombra } from "@/features/escala/snapshotSombra";
import { executarCorteSombra } from "@/features/escala/sombraCorte";
import { epochMsNoFuso } from "@/features/escala/tempo";
import type { EntradaEscala } from "@/features/escala/types";
import type { EstadoBruto } from "./estado";
import { montarEntradaEscala } from "./montarEntrada";
import { estadoComVersao, type VersaoPlanoOficial } from "./planoVersionado";

export interface ApontamentoBanco {
  data: string;
  periodoId: string;
  funcionarioId: string | null;
  maquinaId: string | null;
  produtoId: string | null;
  etapaId: string | null;
  operacaoId: string | null;
  quantidadeProduzida: number;
  quantidadeRefugo: number;
  meta: number;
  status: string;
  motivo: string | null;
  criadoEmMs: number;
  atualizadoEmMs: number | null;
}

export interface EventoSombra { id: string; previsaoId: string; data: string; periodoId: string; status: string; tentativas: number }

export interface DecisaoParaGravar { eventoId: string; previsaoId: string; snapshot: SnapshotSombra; tardios: number; latenciaMs: number }

export interface SombraIO {
  lerModo(): Promise<ModoReplanejamento>;
  listarEventos(): Promise<EventoSombra[]>; // não concluídos (pendentes, erro < 3 tentativas, processando travado)
  carregar(previsaoId: string): Promise<{ estado: EstadoBruto; apontamentos: ApontamentoBanco[] }>; // estado ATUAL (catálogos); o plano/Previsão do passado vêm das versões
  versaoDoPlano(previsaoId: string, emMs: number): Promise<VersaoPlanoOficial | null>; // a versão VIGENTE no instante (nunca "a Escala de agora")
  reivindicar(eventoId: string): Promise<boolean>; // atômico; só aqui uma tentativa é consumida
  gravarDecisao(d: DecisaoParaGravar): Promise<{ inserida: boolean; id: string }>; // idempotente: (previsão, data, período)
  concluir(eventoId: string, status: "processado" | "ignorado" | "erro", erro?: string | null): Promise<void>;
}

export interface ResumoSombra {
  modo: ModoReplanejamento;
  modoEfetivo: "desligado" | "sombra";
  avisoAtivoNaoImplementado: boolean;
  eventos: number;
  aguardando: number;
  processadas: number;
  duplicadas: number;
  ignoradas: number;
  concorrencia: number;
  erros: number;
}

const paraReal = (a: ApontamentoBanco): ApontamentoReal => ({
  data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId,
  boas: a.quantidadeProduzida - a.quantidadeRefugo, refugo: a.quantidadeRefugo, meta: a.meta, status: a.status === "produzindo" ? "produzindo" : "sem_producao", motivo: a.motivo, lancadoEmMs: a.criadoEmMs,
});

// visão do ESTADO no corte: ausências registradas e indisponibilidades iniciadas até o corte (liberação posterior = desconhecida)
export function estadoNoCorte(estado: EstadoBruto, corteMs: number): EstadoBruto {
  return {
    ...estado,
    ausencias: estado.ausencias.filter((a) => !a.registradaEm || Date.parse(a.registradaEm) <= corteMs),
    indisponibilidades: estado.indisponibilidades.filter((i) => Date.parse(i.desde) <= corteMs).map((i) => (i.liberadaEm && Date.parse(i.liberadaEm) > corteMs ? { ...i, liberadaEm: null } : i)),
  };
}

export type PreparoDecisao =
  | { pronto: false; avaliacao: AvaliacaoFechamento; motivoIgnorado?: undefined }
  | { pronto: false; avaliacao?: undefined; motivoIgnorado: string }
  | { pronto: true; snapshot: SnapshotSombra; corteMs: number; tardios: number };

// Núcleo: dado o estado ATUAL (só catálogos), os apontamentos e as VERSÕES do plano, decide se o período fechou e (se sim) monta o snapshot com a
// Escala e a Previsão que valiam no corte. Informação posterior ao corte (plano recalculado, troca manual, ausência, indisponibilidade) não entra.
export async function prepararDecisao(
  estadoAtual: EstadoBruto,
  apontamentos: ApontamentoBanco[],
  ev: { data: string; periodoId: string },
  agoraMs: number,
  obterVersao: (emMs: number) => Promise<VersaoPlanoOficial | null>
): Promise<PreparoDecisao> {
  // 1) geometria do período (horários) e plano vigente ao FIM do período => postos esperados (período encerrado = linhas congeladas)
  const geometria = montarEntradaEscala(estadoAtual, agoraMs).entrada.slots.find((s) => s.data === ev.data && s.periodoId === ev.periodoId);
  if (!geometria) return { pronto: false, motivoIgnorado: "período fora da escala da semana" };
  const v0 = await obterVersao(geometria.fimMs);
  if (!v0) return { pronto: false, motivoIgnorado: "sem versão do plano oficial anterior ao fim do período" };
  const estado0 = estadoComVersao(estadoAtual, v0);
  const base0 = montarEntradaEscala(estado0, agoraMs).entrada;
  const slot = base0.slots.find((s) => s.data === ev.data && s.periodoId === ev.periodoId);
  if (!slot) return { pronto: false, motivoIgnorado: "período fora da escala vigente ao fim do período" };
  const oficialDoSlot = estado0.alocacoes.filter((a) => a.data === ev.data && a.periodoId === ev.periodoId);
  if (oficialDoSlot.length === 0) return { pronto: false, motivoIgnorado: "período sem escala oficial" };

  // 2) fechamento (só carimbos dos lançamentos)
  const doPeriodo = apontamentos.filter((a) => a.data === ev.data && a.periodoId === ev.periodoId);
  const lanc: LancamentoCarimbado[] = doPeriodo.map((a) => ({ maquinaId: a.maquinaId, ms: a.criadoEmMs }));
  const esperados = oficialDoSlot.filter((a) => a.maquinaId).map((a) => a.maquinaId as string);
  const f = instanteDeFechamento({ fimMs: slot.fimMs, agoraMs, postosEsperados: esperados, lancamentos: lanc });
  if (f.corteMs === null) return { pronto: false, avaliacao: f.avaliacao };
  const corteMs = f.corteMs;

  // 3) Escala + Previsão VIGENTES NO CORTE, e só o que existia no corte (ausências, indisponibilidades, apontamentos)
  const v1 = corteMs === geometria.fimMs ? v0 : await obterVersao(corteMs);
  if (!v1) return { pronto: false, motivoIgnorado: "sem versão do plano oficial anterior ao corte" };
  const estado = estadoComVersao(estadoAtual, v1);
  const est = estadoNoCorte(estado, corteMs);
  const ent: EntradaEscala = montarEntradaEscala(est, corteMs).entrada;
  const chaveAp = (a: ApontamentoReal) => [a.data, a.periodoId, a.maquinaId ?? "", a.funcionarioId ?? "", a.lancadoEmMs.toString().padStart(15, "0"), a.status].join("|");
  const visiveis = apontamentos.filter((a) => a.criadoEmMs <= corteMs).map(paraReal).sort((x, y) => (chaveAp(x) < chaveAp(y) ? -1 : 1)); // ordem canônica: mesmo conteúdo => mesmo hash
  const origemMs = epochMsNoFuso(estado.semanaInicio, "05:00");
  const entOrigem = montarEntradaEscala(estadoNoCorte(estado, origemMs), origemMs).entrada;
  const zero = { ...entOrigem, aPartirDe: 0, congeladas: [], revezamentoDuro: true, pools: entOrigem.pools.map((p) => ({ ...p, adicionalMax: 0 })) };
  const impossivelNaOrigem = analisarAtingibilidade(zero, gerarEscala(zero)).status === "impossivel";

  const canonica: EntradaCanonicaCorte = {
    versao: 1, c: slot.indice, corteMs,
    dias: [...new Set(ent.slots.map((s) => s.data))].map((data) => ({ data, periodos: (estado.diasExistentes.find((d) => d.data === data)?.periodosSnapshot ?? estado.periodosAtuais) })),
    funcionarios: ent.funcionarios.map((x) => x.id).sort(), pools: ent.pools.map((p) => ({ ...p, adicionalMax: 0 })),
    ausencias: [...ent.ausencias].sort((x, y) => (jsonCanonico(x) < jsonCanonico(y) ? -1 : 1)), indisponibilidades: [...ent.indisponibilidades].sort((x, y) => (jsonCanonico(x) < jsonCanonico(y) ? -1 : 1)),
    maquinasIndisponiveisPrevisao: ent.maquinasIndisponiveisPrevisao, maquinasInativas: ent.maquinasInativas ?? [], historicoEquidade: ent.historicoEquidade ?? [],
    apontamentos: visiveis.map(empacotarApontamento),
    planoOficial: [...estado.alocacoes].sort((x, y) => (x.data + x.periodoId + x.funcionarioId < y.data + y.periodoId + y.funcionarioId ? -1 : 1)).map(empacotarLinha), impossivelNaOrigem, adicionalRestante: {}, modoHorizonte: "comprometido",
  };
  const decisao = executarCorteSombra(paraParametrosCorte(canonica));
  const tardios = lancamentosTardios(lanc, corteMs);
  const comp = decisao.horizonte.horizonte.comprometido;
  const slotsC = ent.slots;
  const futuroRelevante = slotsC.filter((s) => s.indice > slot.indice && s.indice <= slot.indice + 6).map((s) => ({
    periodo: `${s.data} ${s.periodoId}`,
    linhas: estado.alocacoes.filter((a) => a.data === s.data && a.periodoId === s.periodoId).map((a) => [a.funcionarioId, a.maquinaId, a.produtoId, a.etapaId, Math.round(a.pecas)] as [string, string | null, string | null, string | null, number]),
  }));
  const planoRef: PlanoOficialRef = {
    versaoId: v1.id, origem: v1.origem, validoDesdeMs: v1.validoDesdeMs, corteMs, hashPlanoBanco: v1.hashPlano, hashPlanoEscala: hashAlocacoes(estado.alocacoes),
    versoesDias: Object.fromEntries(v1.dias.map((d) => [d.data, d.versao])), versaoNoFimDoPeriodo: v0.id,
    comprometido: comp === null ? null : { slot: comp, data: slotsC[comp].data, periodoId: slotsC[comp].periodoId }, futuroRelevante,
  };
  const snapshot = construirSnapshot({
    semanaInicio: estado.semanaInicio, entrada: canonica, decisao, completude: completudeDe(f.avaliacao, tardios), nomesMaquinas: estado.nomesMaquinas, planoOficialRef: planoRef,
    extraIncertezas: {
      // o banco só guarda a versão ATUAL da linha: se foi editada depois do corte, o valor visto aqui pode não ser o que existia no corte
      apontamento_editado_apos_corte: apontamentos.filter((a) => a.criadoEmMs <= corteMs && a.atualizadoEmMs !== null && a.atualizadoEmMs > corteMs + 1000).length,
      wip_ativo_adicional_nao_considerado: estado.parametros?.wipModo === "ativo" ? 1 : 0,
    },
  });
  return { pronto: true, snapshot, corteMs, tardios };
}

export async function processarSombra(io: SombraIO, agoraMs: number): Promise<ResumoSombra> {
  const modo = await io.lerModo();
  const resumo: ResumoSombra = { modo, modoEfetivo: modoEfetivoReplanejamento(modo), avisoAtivoNaoImplementado: modo === "ativo", eventos: 0, aguardando: 0, processadas: 0, duplicadas: 0, ignoradas: 0, concorrencia: 0, erros: 0 };
  if (resumo.modoEfetivo === "desligado") return resumo;

  const eventos = await io.listarEventos();
  resumo.eventos = eventos.length;
  const cache = new Map<string, { estado: EstadoBruto; apontamentos: ApontamentoBanco[] }>();
  for (const ev of [...eventos].sort((a, b) => (a.data + a.periodoId < b.data + b.periodoId ? -1 : 1))) {
    try {
      if (!cache.has(ev.previsaoId)) cache.set(ev.previsaoId, await io.carregar(ev.previsaoId));
      const ctx = cache.get(ev.previsaoId)!;
      const r = await prepararDecisao(ctx.estado, ctx.apontamentos, ev, agoraMs, (ms) => io.versaoDoPlano(ev.previsaoId, ms));
      if (!r.pronto) {
        if (r.motivoIgnorado) {
          if (await io.reivindicar(ev.id)) { await io.concluir(ev.id, "ignorado", r.motivoIgnorado); resumo.ignoradas++; } else resumo.concorrencia++;
        } else resumo.aguardando++; // ainda não fechou: NÃO reivindica, NÃO consome tentativa
        continue;
      }
      if (!(await io.reivindicar(ev.id))) { resumo.concorrencia++; continue; }
      try {
        const g = await io.gravarDecisao({ eventoId: ev.id, previsaoId: ev.previsaoId, snapshot: r.snapshot, tardios: r.tardios, latenciaMs: agoraMs - r.corteMs });
        await io.concluir(ev.id, "processado", g.inserida ? null : "decisão já existia");
        if (g.inserida) resumo.processadas++; else resumo.duplicadas++;
      } catch (e) {
        await io.concluir(ev.id, "erro", e instanceof Error ? e.message : String(e));
        resumo.erros++;
      }
    } catch (e) {
      console.error("escala/sombra:", e instanceof Error ? e.message : e);
      resumo.erros++;
    }
  }
  return resumo;
}

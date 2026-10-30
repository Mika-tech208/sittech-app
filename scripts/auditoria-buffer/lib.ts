/* eslint-disable @typescript-eslint/no-explicit-any */
// Carrega o estado de PROD (somente do cache de SELECTs) e monta o estado do motor num instante "agora" qualquer.
import * as fs from "node:fs";
import { buscar, carregar } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { slotsDa } from "./estado";
import { janelaDaAusencia, fimDaJornadaMin } from "@/lib/escala/ausenciaAberta";
import { desempacotarLinha } from "@/features/escala/snapshotSombra";
import type { AlocacaoEscala } from "@/features/escala/types";

export const SCR = "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/auditoria-1030/D3";
export const SEMANA = "2026-10-26";

export function carregarTudo(antesIso = "2026-10-30T17:00:00Z") {
  const bruto = buscar({
    semana: SEMANA, antesIso, depoisIso: "2999-01-01T00:00:00Z", usarCache: true,
    somente: ["q_dec", "q_apont", "q_aloc", "q_fluxo", "q_nomes", "q_par", "q_live_ausencias", "q_live_paradas", "q_live_equipe", "q_live_maquinas", "q_hist", "q_prox", "q_ver", "q_ver_depois"],
  });
  const d0 = carregar(bruto);
  const snap = d0.decisao.entrada;
  const fimJornada = fimDaJornadaMin((snap.dias[0]?.periodos ?? []) as any);
  const ausencias = bruto.q_live_ausencias.map((a: any) => ({ funcionarioId: a.funcionario_id, data: a.data, ...janelaDaAusencia({ horarioInicio: a.hi, horarioFim: a.hf, emAberto: !!a.em_aberto } as any, fimJornada) }));
  const indisponibilidades = bruto.q_live_paradas.map((p: any) => ({ maquinaId: p.maquina_id, desdeMs: Math.round(Number(p.desde_ms)), liberadaEmMs: p.liberada_ms === null ? null : Math.round(Number(p.liberada_ms)) }));
  const equipeAtiva = bruto.q_live_equipe.filter((e: any) => e.ativo).map((e: any) => e.id);
  const maquinasInativas = bruto.q_live_maquinas.filter((m: any) => m.tipo === "inativa").map((m: any) => m.maquina_id);
  const maquinasIndispPrev = bruto.q_live_maquinas.filter((m: any) => m.tipo === "indisponivel_previsao").map((m: any) => m.maquina_id);
  const d = {
    ...d0,
    decisao: { ...d0.decisao, entrada: { ...snap, ausencias: ausencias as any, indisponibilidades: indisponibilidades as any, funcionarios: equipeAtiva.length ? equipeAtiva : snap.funcionarios, maquinasInativas, maquinasIndisponiveisPrevisao: maquinasIndispPrev } },
  };
  return { d, bruto };
}

export function versoes(): Record<string, { id: string; valido: string; linhas: AlocacaoEscala[] }> {
  const t = fs.readFileSync(SCR + "/v2.sql.out", "utf8");
  const rows = JSON.parse(t.slice(t.indexOf("{"))).rows;
  const out: any = {};
  rows.forEach((r: any) => (out[r.valido.slice(6, 11)] = { id: r.id, valido: r.valido, linhas: r.linhas.map(desempacotarLinha) }));
  return out;
}

export const hhmm = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(5, 16).replace("T", " ");

export function nomeador(nomes: Record<string, string>) {
  return (id: string | null | undefined) => (id ? (nomes[id] ?? id.slice(0, 8)).trim().replace('Conector 3/4" - Maquina Automatica', "Con3/4 Autom.").replace('Conector 3/4"', "Con3/4").replace(" 4x2", "") : "-");
}
export { montarEstadoAting, slotsDa };

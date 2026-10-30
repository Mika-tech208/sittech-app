// Cenários sintéticos de cadeia (não é teste).
import type { AlocacaoEscala } from "../../types";
import { prepararFluxo } from "../estado";
import type { ContagemFisicaPar, OpcoesFluxo } from "../tipos";
import { equipe, montar, pool, MIN } from "./helpersFluxo";

export const linha = (data: string, periodoId: string, f: string, p: ReturnType<typeof pool>, maq: string): AlocacaoEscala => ({
  data, periodoId, funcionarioId: f, maquinaId: maq, produtoId: p.produtoId, etapaId: p.etapaId, operacaoId: p.operacaoId, pecas: p.metas[periodoId], motivoSemPosto: null, excecaoRevezamento: false, motivoExcecao: null,
});

/** Cadeia de 4 etapas R→P→E→B (lote). Plano vigente: só E (mu 3000) e B (mu 2650) trabalham; R e P estão desligados. Contagens no início da semana. */
export function cadeia4(opts: { estoque?: [number, number, number]; cadeia?: OpcoesFluxo["cadeia"]; dias?: string[]; c?: number } = {}) {
  const [wRP, wPE, wEB] = opts.estoque ?? [6000, 6000, 3600];
  const R = pool({ produto: "P", etapa: "R", op: "opR", ordem: 1, q: 60000, maquinas: ["r1", "r2"], mu: 1450 });
  const P = pool({ produto: "P", etapa: "Pa", op: "opP", ordem: 2, q: 60000, maquinas: ["p1", "p2"], mu: 1140 });
  const E = pool({ produto: "P", etapa: "E", op: "opE", ordem: 3, q: 60000, maquinas: ["e1"], mu: 3000 });
  const B = pool({ produto: "P", etapa: "B", op: "opB", ordem: 4, q: 60000, maquinas: ["b1"], mu: 2650 });
  const pools = [R, P, E, B];
  const m = montar({
    pools, funcionarios: equipe(6), c: opts.c ?? 0, dias: opts.dias,
    plano: (slots) => slots.flatMap((s) => [linha(s.data, s.periodoId, "f01", E, "e1"), linha(s.data, s.periodoId, "f02", B, "b1")]),
  });
  const t0 = m.dados.agoraMs; // contagem logo antes de agora (depois do último período fechado): WIP(agora) = contagem; só movimentos posteriores entram
  const cont = (o: string, s: string, saldo: number): ContagemFisicaPar => ({ produtoId: "P", etapaOrigemId: o, etapaSeguinteId: s, saldo, contadoEmMs: t0 - MIN });
  const dados = { ...m.dados, contagensFisicas: [cont("R", "Pa", wRP), cont("Pa", "E", wPE), cont("E", "B", wEB)] };
  const opcoes: OpcoesFluxo = { fluxoMesmoPeriodo: false, ...(opts.cadeia ? { cadeia: opts.cadeia } : {}) };
  return { m, pools, dados, opcoes, ctx: prepararFluxo(m.entrada, dados, opcoes), P, R, E, B };
}


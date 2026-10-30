/* eslint-disable @typescript-eslint/no-explicit-any */
// CONFLITO DE DADOS (30/10): contagem Etiquetar→Embalar 12:00 (3.600) = produção da Etiquetadora 15 em M3 (3.600); Embalagem 17 apontou 5.400 em T1, impossível sob lote com só 3.600 disponíveis.
// Mostra como o estado do fluxo trata isso depois que T1 fecha (SOMENTE LEITURA do cache de SELECTs; nada em PROD).
import * as fs from "node:fs";
import * as path from "node:path";
import { abrir, estadoEm } from "./comum";
import { CACHE } from "./carga";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import type { AlocacaoEscala } from "@/features/escala/types";
const A = abrir();
const rd = (f: string) => { const t = fs.readFileSync(path.join(CACHE, f), "utf8"); return JSON.parse(t.slice(t.indexOf("{"))).rows as any[]; };
const aps: ApontamentoReal[] = rd("apont_now.sql.out").map((a) => ({
  data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id,
  boas: Number(a.quantidade_produzida) - Number(a.quantidade_refugo), refugo: Number(a.quantidade_refugo), meta: Number(a.meta), status: a.status === "produzindo" ? "produzindo" : "sem_producao", motivo: a.motivo, lancadoEmMs: Math.round(Number(a.criado_ms)),
}));
const plano: AlocacaoEscala[] = rd("aloc_now.sql.out").map((a) => ({ data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id, pecas: Number(a.pecas), origem: "auto" }));
const out: any = {};
const t1 = A.slots.find((s) => s.data === "2026-10-30" && s.periodoId === "t1")!;
out.t1 = { inicio: new Date(t1.inicioMs).toISOString(), fim: new Date(t1.fimMs).toISOString() };
for (const [rot, agora] of [["12:20 (T1 ainda não ocorreu)", Date.parse("2026-10-30T12:20:52-03:00")], ["após T1 fechar", t1.fimMs + 11 * 60_000]] as [string, number][]) {
  const E = estadoEm(A, agoraMs(agora), plano, { aps: aps.filter((a) => a.lancadoEmMs <= agora), mesmoPeriodo: false });
  const par = E.ctx.pares.filter((p) => A.nome(p.etapaOrigemId) === "Etiquetar" && A.nome(p.etapaSeguinteId) === "Embalar");
  out[rot] = {
    ultimoFechado: E.ctx.ultimoFechado, aPartirDe: `${A.slots[E.ap]?.data} ${A.slots[E.ap]?.periodoId}`,
    etiquetarEmbalar: par.map((p) => ({ origem: p.origem, fonte: p.fonteConfirmacao, confianca: p.confianca, wip: p.wip, bruto: p.bruto, negativo: p.negativo, contagem: p.contagem })),
    diagnosticos: E.ctx.diagnosticos.filter((d) => /NEGATIV|CONTAGEM|NAO_CONFIRM/.test(d.codigo)).map((d) => `${d.codigo}: ${d.mensagem}`).slice(0, 8),
  };
}
function agoraMs(x: number) { return x; }
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(out, null, 1));

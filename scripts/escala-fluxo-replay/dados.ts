// Carga dos dados REAIS de PROD (extraídos por SELECT; ver sql/ e README no docs). PURO sobre os arquivos .sql.out (JSON {rows:[...]}).
import * as fs from "node:fs";
import * as path from "node:path";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import type { EntradaCanonicaCorte } from "@/features/escala/snapshotSombra";

export const DIR = process.env.FREPLAY_DIR ?? "/private/tmp/claude-501/-Users-mikaellonghi-Documents/46f8091f-a2ac-4875-a213-e5a3b744b594/scratchpad/freplay";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lerRows(nome: string): any[] {
  const t = fs.readFileSync(path.join(DIR, nome + ".sql.out"), "utf8");
  return JSON.parse(t.slice(t.indexOf("{"))).rows;
}

export interface DecisaoGravada {
  id: string;
  data: string;
  periodoId: string;
  slot: number;
  revisao: number;
  modo: string;
  criadoEm: string;
  corteMs: number;
  hashDecisao: string;
  hashPlanoSombra: string;
  faltaOficialGravada: number;
  faltaSombraGravada: number;
  entrada: EntradaCanonicaCorte;
}

export function carregarDecisoes(): DecisaoGravada[] {
  return lerRows("q_dec").map((r) => ({
    id: r.id, data: r.data, periodoId: r.periodo_id, slot: r.slot, revisao: r.revisao, modo: r.replanejamento_modo, criadoEm: r.criado_em, corteMs: r.entrada.corteMs,
    hashDecisao: r.hash_decisao, hashPlanoSombra: r.hash_plano_sombra, faltaOficialGravada: Number(r.falta_of), faltaSombraGravada: Number(r.falta_so), entrada: r.entrada,
  }));
}

export interface ApontamentoBruto extends ApontamentoReal { id: string; editado: boolean }
export function carregarApontamentos(): ApontamentoBruto[] {
  return lerRows("q_apont").map((r) => ({
    id: r.id, data: r.data, periodoId: r.periodo_id, funcionarioId: r.funcionario_id, maquinaId: r.maquina_id, produtoId: r.produto_id, etapaId: r.etapa_id, operacaoId: r.operacao_id,
    boas: Number(r.quantidade_produzida) - Number(r.quantidade_refugo), refugo: Number(r.quantidade_refugo), meta: Number(r.meta), status: r.status === "produzindo" ? "produzindo" : "sem_producao", motivo: r.motivo,
    lancadoEmMs: Math.round(Number(r.criado_ms)), editado: r.atualizado_ms !== r.criado_ms,
  }));
}

export interface Parada { maquinaId: string; desdeMs: number; liberadaEmMs: number | null; origem: string }
export function carregarParadasReais(): Parada[] {
  return lerRows("q_oc").map((r) => ({ maquinaId: r.maquina_id, desdeMs: Math.round(Number(r.aberta_ms)), liberadaEmMs: r.encerrada_ms === null ? null : Math.round(Number(r.encerrada_ms)), origem: "ocorrencias_maquina" }));
}

export function carregarNomes(): Record<string, string> {
  const o: Record<string, string> = {};
  lerRows("q_nomes").forEach((r) => (o[r.id] = r.nome));
  return o;
}

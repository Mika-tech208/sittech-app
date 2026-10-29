// Aplica canonizarApontamentos aos apontamentos reais. Uso: tsx integridade.ts <ap.json> <roteiro.json>
// roteiro.json = SELECT de roteiro_etapas (campos eid, produto_id, operacao_id, ordem). Somente leitura.
import { readFileSync } from "node:fs";
import { carregar } from "./backtest";
import { canonizarApontamentos, resumirIntegridade, type EtapaRoteiro } from "../../src/features/escala/integridadeOperacao";

const todas = carregar(process.argv[2]).filter((a) => a.status === "produzindo");
const roteiro = (JSON.parse(readFileSync(process.argv[3], "utf8")) as Record<string, string>[]).map((r): EtapaRoteiro => ({ id: r.eid, produtoId: r.produto_id, operacaoId: r.operacao_id, ordem: Number(r.ordem) }));
const r = canonizarApontamentos(todas, roteiro);
console.log("resumo:", resumirIntegridade(r.auditoria, todas.length));
const porSem = new Map<string, number>();
r.auditoria.forEach((a) => { const d = todas[a.indice].data; const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); const k = t.toISOString().slice(0, 10); porSem.set(k, (porSem.get(k) ?? 0) + 1); });
console.log([...porSem.entries()].sort().map(([k, v]) => `${k}: ${v}`).join("\n"));
const dois = canonizarApontamentos(r.linhas, roteiro);
console.log("idempotente (2ª passada sem auditoria):", dois.auditoria.length === 0);

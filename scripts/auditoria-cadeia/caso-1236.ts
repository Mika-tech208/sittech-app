/* eslint-disable @typescript-eslint/no-explicit-any */
// CASO REAL 30/10 12:36:08 (OFFLINE; dados do cache de SELECTs em PROD): reproduz o plano de PROD (flags da cadeia desligadas) e mostra o diagnóstico da camada 1.
import * as fs from "node:fs";
import { abrir, estadoEm, versaoEm } from "../auditoria-buffer/comum";
import { planejarComFluxo } from "@/features/escala/fluxo";
import { calcularDemanda } from "@/features/escala/fluxo/estado";
import type { OpcoesFluxo } from "@/features/escala/fluxo";

const A = abrir();
const { slots, ix, nome } = A;
const AGORA = Date.parse("2026-10-30T12:36:08-03:00");
const vigente = versaoEm("2026-10-30T12:36:08-03:00");
export function rodar(cadeia?: OpcoesFluxo["cadeia"], mod?: (w: any) => void) {
  const E = estadoEm(A, AGORA, vigente, { mesmoPeriodo: false, ponte: true });
  if (mod) mod(E);
  const opcoes = { ...E.opcoes, ...(cadeia ? { cadeia } : {}) };
  return { E, opcoes, r: planejarComFluxo(E.ent, E.dados, opcoes) };
}
const base = rodar();
const { E } = base;
const postos = (l: any[]) => {
  const out: string[] = [];
  for (let s = E.ap; s < slots.length; s++) {
    const linhas = l.filter((a) => ix(a) === s && a.maquinaId);
    const porPosto = new Map<string, string[]>();
    linhas.forEach((a) => { const k = `${nome(a.maquinaId)} (${nome(a.produtoId).replace('Conector 3/4" - Maquina Automatica', "Con3/4 Auto").replace('Conector 3/4"', "Con3/4")}/${nome(a.etapaId)})`; (porPosto.get(k) ?? porPosto.set(k, []).get(k)!).push(nome(a.funcionarioId)); });
    out.push(`${slots[s].data.slice(5)} ${slots[s].periodoId}: ` + [...porPosto.entries()].map(([k, v]) => `${k}=${v.join("+")}`).join(" | "));
  }
  return out;
};
const diag = rodar({ diagnostico: true });
console.log("MESMO PLANO com/sem diagnóstico:", JSON.stringify(base.r.resultado.alocacoes) === JSON.stringify(diag.r.resultado.alocacoes));
console.log("planoEscolhido:", base.r.diagnostico.planoEscolhido);
console.log(diag.r.diagnostico.diagnosticos.filter((d: any) => /CADEIA|CONSUMO_REAL|FISICO/.test(d.codigo)).map((d: any) => `[${d.codigo}/${d.severidade}] ${d.mensagem}`).join("\n"));
if (process.env.PLANO) console.log(postos(base.r.resultado.alocacoes).join("\n"));
if (process.env.ALLOWED) {
  const dem = (cad?: any) => { const ctx = rodar(cad).E.ctx; return ctx; };
  void dem; void calcularDemanda; void fs;
}

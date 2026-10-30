/* eslint-disable @typescript-eslint/no-explicit-any */
// REPLAY dos 15 recálculos de 28–30/10 com o motor de HOJE (lote + ponte) e as camadas da cadeia, OFFLINE (cache de SELECTs). Plano vigente = versão gravada à época.
// Variantes: OFF · L1 (diagnóstico) · L2 (allowed+saída) · L3 (L2 + reparo) · R (só reparo). Env: OUT=json  FREPLAY_FATOR=0 ⇒ produtividade pela META (sem f); padrão = f realizado do pool (o de PROD).
import * as fs from "node:fs";
import { abrir, estadoEm, versaoEm } from "../auditoria-buffer/comum";
import { planejarComFluxo } from "@/features/escala/fluxo";
import { medir } from "./metricas";

const AGORAS = [
  "2026-10-28T08:50:00-03:00", "2026-10-28T10:26:00-03:00", "2026-10-28T11:57:00-03:00", "2026-10-28T14:22:00-03:00", "2026-10-28T15:42:00-03:00",
  "2026-10-29T05:00:00-03:00", "2026-10-29T08:50:00-03:00", "2026-10-29T10:26:00-03:00", "2026-10-29T11:57:00-03:00", "2026-10-29T14:22:00-03:00", "2026-10-29T15:42:00-03:00",
  "2026-10-30T05:00:00-03:00", "2026-10-30T08:50:00-03:00", "2026-10-30T10:26:00-03:00", "2026-10-30T11:42:00-03:00",
];
const VARIANTES: [string, any][] = [["OFF", undefined], ["L1", { diagnostico: true }], ["L2", { allowed: true, saida: true }], ["L3", { allowed: true, saida: true, reparo: true }], ["R", { reparo: true }]];
const A = abrir();
const saida: any[] = [];
for (const iso of AGORAS) {
  const vig = versaoEm(iso);
  const ms = Date.parse(iso);
  const E = estadoEm(A, ms, vig, { mesmoPeriodo: false, ponte: true });
  const ref = vig.filter((a) => A.ix(a) >= E.ap);
  const linha: any = { recalculo: iso, aPartirDe: E.ap };
  let planoOff = "";
  for (const [nome, cad] of VARIANTES) {
    const opcoes = { ...E.opcoes, ...(cad ? { cadeia: cad } : {}) };
    const t0 = Date.now();
    try {
      const r = planejarComFluxo(E.ent, E.dados, opcoes);
      const m = medir(E.ent, E.dados, E.opcoes, E.ap, r.resultado.alocacoes, ref, r.diagnostico.diagnosticos);
      const h = JSON.stringify(r.resultado.alocacoes);
      if (nome === "OFF") planoOff = h;
      linha[nome] = { ...m, escolhido: r.diagnostico.planoEscolhido, igualAoOFF: h === planoOff, ms: Date.now() - t0 };
    } catch (e: any) { linha[nome] = { erro: String(e?.message ?? e) }; }
  }
  saida.push(linha);
  process.stderr.write(`${iso} ok\n`);
}
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(saida, null, 1));

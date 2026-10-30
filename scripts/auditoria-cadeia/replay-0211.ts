/* eslint-disable @typescript-eslint/no-explicit-any */
// REPLAY OFFLINE da SEMANA 02/11 (hoje planejada pelo motor LEGADO; o fluxo NÃO está ativo nela — nada é ativado, tudo roda no simulador).
// Variantes: legado (gerarEscala) · fluxo atual (OFF) · +L1 diagnóstico · +L2 allowed/saída · +L3 (L2+reparo) · R (só reparo).
// Aberturas de WIP: A = 0 (sem estoque conhecido) · B = WIP projetado (lo) do fim da semana 26/10 (plano em vigor). Produtividade: META (nominal) × HISTÓRICA do posto (mediana real/meta, janela 14 d, n≥3; nunca por pessoa).
import * as fs from "node:fs";
import * as path from "node:path";
import { montarEstado as montarEstado1102 } from "../auditoria-buffer/carga1102";
import { abrir, estadoEm } from "../auditoria-buffer/comum";
import { CACHE } from "../auditoria-buffer/carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { avaliarPlano, planejarComFluxo } from "@/features/escala/fluxo";
import { chavePool, type AlocacaoEscala, type EntradaEscala } from "@/features/escala/types";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo";
import { medir } from "./metricas";

const A = abrir();
const { d, ix, hist } = A;
const AGORA_HOJE = Date.parse("2026-10-30T12:20:52-03:00");
const AGORA = Date.parse("2026-11-02T06:00:00-03:00");
const todos = [...hist, ...d.apontamentos];
const t = fs.readFileSync(path.join(CACHE, "aloc_now.sql.out"), "utf8");
const planoAtual: AlocacaoEscala[] = JSON.parse(t.slice(t.indexOf("{"))).rows.map((a: any) => ({
  data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id,
  pecas: Number(a.pecas), ...(Number(a.pecas_adicional) > 0 ? { pecasAdicional: Number(a.pecas_adicional) } : {}), motivoSemPosto: a.motivo_sem_posto, origem: a.origem === "manual" ? "manual" : "auto",
}));
const E0 = estadoEm(A, AGORA_HOJE, planoAtual, { mesmoPeriodo: false });
const av0 = avaliarPlano(E0.ent, E0.dados, [...E0.ent.congeladas, ...planoAtual.filter((a) => ix(a) >= E0.ap)], { ...E0.opcoes, fluxoMesmoPeriodo: false });
const wipFinal: Record<string, { lo: number; hi: number }> = Object.assign({}, ...av0.produtos.map((p) => p.wipFinal));

const { estado } = montarEstado1102();
const nominal = montarEntradaEscala(estado, AGORA).entrada;
const pares = d.cfg.paresLegado;

// produtividade HISTÓRICA do posto (produto × operação × máquina): mediana real/meta; razão do pool = média das razões dos seus postos com amostra
function entradaHistorica(ent: EntradaEscala): EntradaEscala {
  const desde = AGORA_HOJE - 14 * 86_400_000;
  const g = new Map<string, number[]>();
  todos.forEach((a) => {
    if (a.status !== "produzindo" || !(a.meta > 0) || !a.produtoId || !a.operacaoId || !a.maquinaId || a.lancadoEmMs > AGORA_HOJE || a.lancadoEmMs < desde) return;
    const k = `${a.produtoId}|${a.operacaoId}|${a.maquinaId}`;
    g.set(k, [...(g.get(k) ?? []), a.boas / a.meta]);
  });
  const mediana = (v: number[]) => { const s = [...v].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
  return {
    ...ent,
    pools: ent.pools.map((p) => {
      const rs = p.maquinasIds.map((m) => g.get(`${p.produtoId}|${p.operacaoId}|${m}`)).filter((v): v is number[] => !!v && v.length >= 3).map(mediana);
      if (rs.length === 0) return p;
      const r = rs.reduce((x, y) => x + y, 0) / rs.length;
      return { ...p, metas: Object.fromEntries(Object.entries(p.metas).map(([k, v]) => [k, v * r])) };
    }),
  };
}
function contagens(modo: "A" | "B", ent: EntradaEscala): ContagemFisicaPar[] {
  if (modo === "A") return [];
  const out: ContagemFisicaPar[] = [];
  const porProduto = new Map<string, typeof ent.pools>();
  ent.pools.forEach((p) => porProduto.set(p.produtoId, [...(porProduto.get(p.produtoId) ?? []), p]));
  porProduto.forEach((ps, produtoId) => {
    const o = [...ps].sort((a, b) => a.ordemEtapa - b.ordemEtapa);
    for (let k = 0; k + 1 < o.length; k++) {
      const w = wipFinal[chavePool(produtoId, o[k].etapaId)];
      if (w) out.push({ produtoId, etapaOrigemId: o[k].etapaId, etapaSeguinteId: o[k + 1].etapaId, saldo: w.lo, contadoEmMs: AGORA, informadoPor: "replay (WIP projetado do fim da semana 26/10)" });
    }
  });
  return out;
}
const VAR: [string, any][] = [["fluxo atual", undefined], ["+L1", { diagnostico: true }], ["+L2", { allowed: true, saida: true }], ["+L3", { allowed: true, saida: true, reparo: true }], ["R", { reparo: true }]];
const saida: any[] = [];
for (const prod of ["META", "HISTORICA"] as const) {
  const ent = prod === "META" ? nominal : entradaHistorica(nominal);
  for (const wip of ["A", "B"] as const) {
    const cont = contagens(wip, ent);
    const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], ...(cont.length ? { contagensFisicas: cont } : {}) };
    const base = { paresLegado: pares, fluxoMesmoPeriodo: false } as any;
    const legado = gerarEscala(ent).alocacoes;
    const linha: any = { produtividade: prod, abertura: wip, aPartirDe: ent.aPartirDe, legado: { ...medir(ent, dados, base, ent.aPartirDe, legado, legado, null), escolhido: "legado" } };
    let off = "";
    for (const [nome, cad] of VAR) {
      const t0 = Date.now();
      try {
        const r = planejarComFluxo(ent, dados, { ...base, ...(cad ? { cadeia: cad } : {}) });
        const h = JSON.stringify(r.resultado.alocacoes);
        if (nome === "fluxo atual") off = h;
        linha[nome] = { ...medir(ent, dados, base, ent.aPartirDe, r.resultado.alocacoes, legado, r.diagnostico.diagnosticos), escolhido: r.diagnostico.planoEscolhido, igualAoFluxoAtual: h === off, ms: Date.now() - t0 };
      } catch (e: any) { linha[nome] = { erro: String(e?.message ?? e) }; }
    }
    saida.push(linha);
    process.stderr.write(`${prod}/${wip} ok\n`);
  }
}
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(saida, null, 1));

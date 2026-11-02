/* eslint-disable @typescript-eslint/no-explicit-any */
// PREVIEW DA ATIVAÇÃO (OFFLINE, nada é gravado): calcula, com os SELECTs de PROD refrescados (SQL_DIR) e a MESMA configuração de 02-ativar.sql, o plano que o motor novo vai gravar na 1ª drenagem,
// e imprime as métricas, as checagens independentes, o plano por período e o HASH do plano (hashPlanoFluxo — o mesmo que escala_fluxo_diagnosticos.hash_plano_fluxo registra depois de ativar).
// Rodar: SQL_DIR=<pasta com q_*.sql.out refrescados> fb/ts.sh scripts/ativacao-0211/preview-ativacao.ts   (env: AGORA=ISO; CONFIG=json; OUT=arquivo.json)
import * as fs from "node:fs";
import { montarEstado as carregar } from "./carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { distribuicaoEfetiva } from "@/features/escala/distribuicao";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo/tipos";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";

const { estado } = carregar();
estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
const AGORA = Date.parse(process.env.AGORA ?? "2026-11-02T18:00:00-03:00");
const entrada = montarEntradaEscala(estado, AGORA).entrada;
const nome = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const CONFIG = lerConfigPlanejador(JSON.parse(process.env.CONFIG ?? fs.readFileSync("scripts/ativacao-0211/config-planejador.json", "utf8"))); // a MESMA config de 02-ativar.sql (gerada dela)
// WIP do cenário (B por padrão; D se WIP_JSON): por produto, na ordem das etapas
const prods = [...new Set(entrada.pools.map((p) => p.produtoId))];
const ehAut = (id: string) => /Autom/i.test(nome(id));
const conv = prods.find((id) => nome(id).startsWith('Conector 3/4"') && !ehAut(id))!, aut = prods.find(ehAut)!, cx = prods.find((id) => /Caixa/i.test(nome(id)))!;
const WIP: Record<string, number[]> = process.env.WIP_JSON ? JSON.parse(fs.readFileSync(process.env.WIP_JSON, "utf8")) : { [conv]: [3200, 3700, 3600], [aut]: [0, 0], [cx]: [2300] };
const contagens: ContagemFisicaPar[] = [];
Object.entries(WIP).forEach(([pid, v]) => {
  const ps = entrada.pools.filter((p) => p.produtoId === pid).sort((a, b) => a.ordemEtapa - b.ordemEtapa);
  for (let k = 0; k + 1 < ps.length; k++) contagens.push({ produtoId: pid, etapaOrigemId: ps[k].etapaId, etapaSeguinteId: ps[k + 1].etapaId, saldo: v[k] ?? 0, contadoEmMs: Date.parse("2026-11-02T06:00:00-03:00"), informadoPor: "Cenário B (ESTIMADO)" });
});
const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], contagensFisicas: contagens };
console.log(`semana ${estado.semanaInicio} · ${entrada.funcionarios.length} pessoas · ${entrada.slots.length} períodos · ausências ${estado.ausencias.length} · paradas ${estado.indisponibilidades.length}`);
const t0 = Date.now();
const r = planejarSemanaComCorte(entrada, dados, { fluxoMesmoPeriodo: false }, CONFIG);
console.log(`ms ${Date.now() - t0} · ok ${r.ok} ${r.motivo ?? ""}`);
console.log("checagens:", JSON.stringify(r.checagens));
if (!r.ok || !r.resultado || !r.saida) { console.log("NO-GO: o planejador não produziu plano válido:", r.motivo); process.exit(3); }
const linhas = r.resultado.alocacoes;
const tot = r.saida.porProduto.reduce((s, p) => s + p.programado, 0);
console.log("porProduto:", r.saida.porProduto.map((p) => `${nome(p.produtoId)} ${Math.round(p.programado)}/${Math.round(p.demanda)} (corte ${Math.round(p.cortado)})`).join(" · "));
console.log(`total programado ${Math.round(tot)} · linhas ${linhas.length} · com posto ${linhas.filter((l) => l.maquinaId).length} · sem posto ${linhas.filter((l) => !l.maquinaId).length} · compartilhadas ${linhas.filter((l) => distribuicaoEfetiva(l)).length}`);
const nm = (id: string | null) => (id ? (estado.nomesMaquinas?.[id] ?? id).trim() : "—");
for (const s of entrada.slots) {
  const l = linhas.filter((a) => a.data === s.data && a.periodoId === s.periodoId && a.maquinaId);
  console.log(`${s.data.slice(8)}/${s.data.slice(5, 7)} ${s.periodoId.toUpperCase()} · ${l.length} postos · ${l.map((a) => `${nm(a.maquinaId).replace("Maquina Automatica", "M8")}:${(distribuicaoEfetiva(a) ?? [{ produtoId: a.produtoId!, pecas: a.pecas }]).map((d) => `${nome(d.produtoId).slice(0, 8)}${Math.round(d.pecas)}`).join("+")}`).join(" ")}`);
}
const hash = hashAlocacoes(linhas);
console.log("HASH_PLANO_FLUXO", hash, "· hashEntrada", r.hashEntrada);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ hash, hashEntrada: r.hashEntrada, checagens: r.checagens, porProduto: r.saida.porProduto, linhas: linhas.length }, null, 1));

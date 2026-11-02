/* eslint-disable @typescript-eslint/no-explicit-any */
// PREVIEW DO PRODUTO ÚNICO COM ROTAS (OFFLINE, nada é gravado): mesma semana, mesmos dados de PROD (SQL_DIR) e MESMA configuração de 02-ativar.sql, rodando o planejador
// (a) como hoje (dois produtos, Conv + Automática) e (b) como PRODUTO ÚNICO (Conector 3/4 com duas rotas), e imprime a comparação.
// Rodar: SQL_DIR=<pasta q_*.sql.out> fe/ts.sh scripts/ativacao-0211/preview-unico.ts   (env: AGORA=ISO; CONFIG=json; OUT=arquivo.json; WIP_JSON; SO=base|unico)
import * as fs from "node:fs";
import { montarEstado as carregar } from "./carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { planejarSemanaComCorte } from "@/features/escala/fluxo/planoCorte";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { distribuicaoEfetiva } from "@/features/escala/distribuicao";
import type { ContagemFisicaPar, DadosProducaoReal, ParLegado } from "@/features/escala/fluxo/tipos";
import { lerConfigPlanejador } from "@/lib/escala/fluxo/parametrosFluxo";

const { estado, raw } = carregar();
estado.parametros = { ...estado.parametros!, revezamentoPonteM3T1: true } as any;
const AGORA = Date.parse(process.env.AGORA ?? "2026-11-02T18:00:00-03:00");
const entrada = montarEntradaEscala(estado, AGORA).entrada;
const nome = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const nm = (id: string | null) => (id ? (estado.nomesMaquinas?.[id] ?? id).trim() : "—");
const CFG_JSON = JSON.parse(process.env.CONFIG ?? fs.readFileSync("scripts/ativacao-0211/config-planejador.json", "utf8"));
if (process.env.SEMENTE) { CFG_JSON.busca = { ...CFG_JSON.busca, semente: Number(process.env.SEMENTE) }; CFG_JSON.buscaComVigente = { ...CFG_JSON.buscaComVigente, semente: Number(process.env.SEMENTE) }; }
if (process.env.COBERTURA) CFG_JSON.coberturaMinima = Number(process.env.COBERTURA);
const CONFIG = lerConfigPlanejador(CFG_JSON);
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
const parRaw = raw.q_params.find((r: any) => r.chave === "producao_real_pares_legado")?.valor;
const paresLegado: ParLegado[] = typeof parRaw === "string" ? JSON.parse(parRaw) : (parRaw ?? []);
console.log(`semana ${estado.semanaInicio} · ${entrada.funcionarios.length} pessoas · ${entrada.slots.length} períodos · pares legado ${paresLegado.length}`);

function rodar(rotulo: string, unico: boolean) {
  const t0 = Date.now();
  const r = planejarSemanaComCorte(entrada, dados, { fluxoMesmoPeriodo: false, ...(unico ? { paresLegado } : {}) }, { ...CONFIG, ...(unico ? { produtoUnico: true } : {}) });
  console.log(`\n===== ${rotulo} · ms ${Date.now() - t0} · ok ${r.ok} ${r.motivo ?? ""}`);
  if (!r.ok || !r.resultado || !r.saida) { console.log("NO-GO:", r.motivo, JSON.stringify(r.tentativas)); return null; }
  const linhas = r.resultado.alocacoes;
  console.log("checagens:", JSON.stringify(r.checagens));
  const porProd = new Map<string, number>();
  linhas.forEach((l) => {
    if (!l.maquinaId) return;
    const itens = distribuicaoEfetiva(l) ?? [{ produtoId: l.produtoId as string, etapaId: l.etapaId as string, pecas: l.pecas }];
    itens.forEach((it) => { const k = `${nome(it.produtoId).slice(0, 22)}|${it.etapaId.slice(0, 6)}`; porProd.set(k, (porProd.get(k) ?? 0) + it.pecas); });
  });
  console.log("peças por produto|etapa:", [...porProd.entries()].sort().map(([k, v]) => `${k}=${Math.round(v)}`).join(" · "));
  console.log("saida.porProduto:", r.saida.porProduto.map((p) => `${nome(p.produtoId).slice(0, 22)} ${Math.round(p.programado)}/${Math.round(p.demanda)} (corte ${Math.round(p.cortado)})`).join(" · "));
  const tot = r.saida.porProduto.filter((p) => !(unico && p.produtoId === aut)).reduce((s, p) => s + (unico && p.produtoId === conv ? p.programado : p.produtoId === aut ? 0 : p.programado), 0);
  console.log(`linhas ${linhas.length} · com posto ${linhas.filter((l) => l.maquinaId).length} · sem posto ${linhas.filter((l) => !l.maquinaId).length} · com distribuição (compartilhadas) ${linhas.filter((l) => distribuicaoEfetiva(l)).length} · máx postos ${r.checagens.maxPostosSimultaneos}`);
  if (r.unico?.resumo) {
    const u = r.unico.resumo;
    console.log(`PRODUTO ÚNICO: demanda ${u.demandaTotal} · restante ${u.restanteEntrada} · FINAL ${u.finalPlanejado} · corte ${u.corte}`);
    console.log("  rotas (peças entregues ao estoque comum):", u.porRota.map((x) => `${x.rotulo} ${x.entregue} (${x.pctDoTotal}%)${x.disponivel ? "" : " [indisponível]"}`).join(" · "), `· total ${u.entregueTotal}`);
    console.log("  trecho comum:", u.trechoComum.map((x) => `${x.rotulo} ${x.pecas}`).join(" · "));
    u.wipUnificado.forEach((w) => console.log(`  WIP ${w.rotulo}: início de cada período (${w.inicio.length}): ${w.inicio.join(",")}`));
  }
  // valor (R$ de margem das peças finais) pela MESMA tabela de margens nas duas versões — independente da função objetivo interna
  const mg = (CONFIG.margemPorPeca ?? {}) as Record<string, number>;
  let valor = 0;
  r.saida.porProduto.forEach((p) => { if (!(unico && p.produtoId === aut)) valor += (mg[p.produtoId] ?? 0) * p.programado; });
  if (unico && r.unico?.resumo) { const a = r.unico.resumo.porRota.find((x) => x.produtoId === aut); valor += ((mg[aut] ?? 0) - (mg[conv] ?? 0)) * Math.min(a?.entregue ?? 0, r.unico.resumo.finalPlanejado); }
  const finaisTotais = r.saida.porProduto.filter((p) => !(unico && p.produtoId === aut)).reduce((x, p) => x + p.programado, 0);
  console.log(`VALOR (margem R$) ${valor.toFixed(2)} · peças finais totais ${Math.round(finaisTotais)} · objetivoValor interno ${r.saida.objetivoValor.toFixed(2)}`);
  const hash = hashAlocacoes(linhas);
  console.log("HASH", hash, "· hashEntrada", r.hashEntrada, "· total Conector+demais programado", Math.round(tot));
  // ocupação da Etiquetadora 15 / Embalagem 17 e das máquinas de rota
  const ocup = new Map<string, number>();
  linhas.forEach((l) => { if (l.maquinaId) ocup.set(nm(l.maquinaId), (ocup.get(nm(l.maquinaId)) ?? 0) + 1); });
  console.log("períodos ocupados por máquina:", [...ocup.entries()].sort().map(([k, v]) => `${k.replace("Maquina Automatica", "M8")}:${v}`).join(" · "));
  return { r, hash, linhas };
}
const so = process.env.SO;
const base = so === "unico" ? null : rodar("BASE (hoje: dois produtos Conv + Automática, com distribuição)", false);
const un = so === "base" ? null : rodar("PRODUTO ÚNICO Conector 3/4 (rotas Convencional + Automática)", true);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ base: base && { hash: base.hash, checagens: base.r.checagens, porProduto: base.r.saida!.porProduto }, unico: un && { hash: un.hash, checagens: un.r.checagens, porProduto: un.r.saida!.porProduto, resumo: un.r.unico?.resumo }, linhasUnico: un?.linhas.map((l) => ({ d: l.data, p: l.periodoId, f: l.funcionarioId, m: l.maquinaId, pr: l.produtoId, e: l.etapaId, pc: l.pecas })) }, null, 1));

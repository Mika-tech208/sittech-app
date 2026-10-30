/* eslint-disable @typescript-eslint/no-explicit-any */
// ATRIBUIÇÃO CONTRAFACTUAL do recálculo de 30/10 12:36:08 (D5): qual alteração publicada às 12:27–12:29 tirou o upstream do plano?
// Mesmo motor de PROD (planejarComFluxo, fluxo ativo), estado real de 12:36 (apontamentos ≤ agora), plano vigente = versão anterior ao recálculo.
// V0 = antes da publicação (contagens antigas, mesmoPeriodo=true, sem ponte) · V1 = V0 + 4 contagens novas · V2 = V1 + ponte M3→T1 · V3 = V2 + mesmoPeriodo=false (o que subiu)
// V4 = V0 + só mesmoPeriodo=false · V5 = V1 + só mesmoPeriodo=false (sem ponte). SOMENTE LEITURA (cache/SELECT); nada é gravado.
import * as fs from "node:fs";
import { abrir, estadoEm, versaoEm, receita } from "../auditoria-buffer/comum";
import { avaliarPlano, planejarComFluxo } from "@/features/escala/fluxo";
import { entradaForecastDoPlano } from "@/features/escala/fluxo/forecastBufferPlano";
import { validarCadeia } from "@/features/escala/fluxo/planejamentoCadeia";
import type { AlocacaoEscala } from "@/features/escala/types";

const A = abrir();
const { slots, ix, nome } = A;
const AGORA = Date.parse("2026-10-30T12:36:08-03:00");
const plano = versaoEm("2026-10-30T12:36:08-03:00");
const lblProd = (id: string | null | undefined) => nome(id).replace('Conector 3/4" - Maquina Automatica', "Con3/4 Autom").replace('Conector 3/4"', "Con3/4");

const VARS: { id: string; desc: string; semNovas: boolean; ponte: boolean; lote: boolean }[] = [
  { id: "V0", desc: "antes da publicação: contagens antigas, mesmoPeriodo=true, sem ponte", semNovas: true, ponte: false, lote: false },
  { id: "V1", desc: "V0 + 4 contagens novas", semNovas: false, ponte: false, lote: false },
  { id: "V2", desc: "V1 + ponte M3→T1", semNovas: false, ponte: true, lote: false },
  { id: "V3", desc: "V2 + mesmoPeriodo=false (o que subiu às 12:27–12:29)", semNovas: false, ponte: true, lote: true },
  { id: "V4", desc: "V0 + só mesmoPeriodo=false", semNovas: true, ponte: false, lote: true },
  { id: "V5", desc: "V1 + só mesmoPeriodo=false (sem ponte)", semNovas: false, ponte: false, lote: true },
  { id: "V6", desc: "V0 + só ponte", semNovas: true, ponte: true, lote: false },
];
const saida: any[] = [];
const interesse = /Parafusadeira|Maquina Automatica 8|Rosqueadeira/i;
for (const v of VARS) {
  const E = estadoEm(A, AGORA, plano, { mesmoPeriodo: !v.lote, ponte: v.ponte, semNovas: v.semNovas });
  const { ent, dados, opcoes, ap, ctx } = E;
  const r = planejarComFluxo(ent, dados, opcoes);
  const pl: AlocacaoEscala[] = r.resultado.alocacoes.filter((a) => ix(a) >= ap);
  const postos = (sl: number) => pl.filter((a) => ix(a) === sl && a.maquinaId && interesse.test(nome(a.maquinaId)) && /3\/4/.test(nome(a.produtoId))).map((a) => `${nome(a.maquinaId)}`).sort().join(", ") || "—";
  const periodos = [ap, ap + 1, ap + 2].map((s) => ({ slot: `${slots[s].data.slice(5)} ${slots[s].periodoId}`, upstream: postos(s), etiq: pl.filter((a) => ix(a) === s && a.maquinaId && /Etiquetadora 15/.test(nome(a.maquinaId))).length, emb: pl.filter((a) => ix(a) === s && a.maquinaId && /Embalagem 17$/.test(nome(a.maquinaId))).length }));
  const rem = r.diagnostico.estado.remPorPool;
  const dem = r.diagnostico.estado.demanda;
  const pools = dem.filter((x: any) => /3\/4/.test(x.chave.split("|")[0] ? nome(x.chave.split("|")[0]) : "")).map((x: any) => ({ pool: `${nome(x.chave.split("|")[1])} ${lblProd(x.chave.split("|")[0])}`, demandaFluxo: Math.round(x.demandaFluxo), teto: x.tetoUtilidade === null ? null : Math.round(x.tetoUtilidade), rem: Math.round(rem[x.chave] ?? 0) }));
  const aval = (lote: boolean) => { const av = avaliarPlano(ent, dados, [...ent.congeladas, ...pl], { ...opcoes, fluxoMesmoPeriodo: !lote, limitesRemPorPool: rem }); return { finalLo: Math.round(av.totais.finalEntregueLo), receitaLo: receita(ent, av), wipFinalLo: Math.round(av.totais.wipFinalLo) }; };
  // ruptura previsível sob lote (cadeia): validação do plano
  const en = entradaForecastDoPlano(ctx, pl, { mesmoPeriodo: false });
  const val = validarCadeia(en.entrada);
  const nosRot = new Map(en.entrada.nos.map((n) => [n.id, n.rotulo]));
  void nosRot;
  saida.push({
    id: v.id, desc: v.desc, planoEscolhido: r.diagnostico.planoEscolhido, depois: r.diagnostico.depois, depoisVigente: r.diagnostico.depoisVigente, periodos, pools,
    avaliadoNaPropriaRegra: aval(v.lote), avaliadoSobLote: aval(true),
    rupturaSobLote: val.violacoes.filter((x) => /Etiq|Embal/i.test(x.rotulo) || true).map((x) => `${x.rotulo} ${x.periodoRotulo}: quer ${Math.round(x.desejada)}, material ${Math.round(x.disponivel)}`),
  });
}
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(saida, null, 1));

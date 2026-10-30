/* eslint-disable @typescript-eslint/no-explicit-any */
// REPLAY OFFLINE da semana FUTURA 2026-11-02 (Previsão salva em PROD; só SELECT já gravado em scratchpad/pico/sql). Plano OFICIAL (gerarEscala; o fluxo só vale em 26/10 em PROD)
// com a cobertura DESLIGADA × LIGADA, em 3 estados de abertura do WIP: A = 0 (sem estoque), B = WIP projetado (lo) do fim desta semana, C = WIP projetado (hi).
import * as fs from "node:fs";
import { montarEstado } from "./carga1102";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { avaliarPlano, planejarComFluxo } from "@/features/escala/fluxo";
import { prepararFluxo } from "@/features/escala/fluxo/estado";
import { coberturaDoPlano, repararCobertura } from "@/features/escala/fluxo/coberturaPlano";
import { chavePool } from "@/features/escala/types";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo";

const AGORA = Date.parse("2026-11-02T06:00:00-03:00");
const wipFinal: Record<string, { lo: number; hi: number }> = JSON.parse(fs.readFileSync(process.env.WIPFINAL as string, "utf8"))[0].off.wipFinal;
const pares = JSON.parse(fs.readFileSync(process.env.PARES as string, "utf8"));
const { estado } = montarEstado();
const montada = montarEntradaEscala(estado, AGORA);
const entrada = montada.entrada;
const nomeP = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim();
const nomeO = (id: string) => estado.nomesOperacao[id] ?? id;
console.log("semana", estado.semanaInicio, "slots", entrada.slots.length, "aPartirDe", entrada.aPartirDe, "pools", entrada.pools.length, "pessoas", entrada.funcionarios.length, "avisos", montada.avisos.length);

function contagens(modo: "A" | "B" | "C"): ContagemFisicaPar[] {
  if (modo === "A") return [];
  const out: ContagemFisicaPar[] = [];
  const porProduto = new Map<string, typeof entrada.pools>();
  entrada.pools.forEach((p) => porProduto.set(p.produtoId, [...(porProduto.get(p.produtoId) ?? []), p]));
  porProduto.forEach((ps, produtoId) => {
    const o = [...ps].sort((a, b) => a.ordemEtapa - b.ordemEtapa);
    for (let k = 0; k + 1 < o.length; k++) {
      const w = wipFinal[chavePool(produtoId, o[k].etapaId)];
      if (w) out.push({ produtoId, etapaOrigemId: o[k].etapaId, etapaSeguinteId: o[k + 1].etapaId, saldo: modo === "B" ? w.lo : w.hi, contadoEmMs: AGORA, informadoPor: "replay (WIP projetado do fim da semana 26/10)" });
    }
  });
  return out;
}
const res: any[] = [];
for (const modo of ["A", "B", "C"] as const) {
  const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], ...(contagens(modo).length ? { contagensFisicas: contagens(modo) } : {}) };
  const opcoes = { paresLegado: pares, fluxoMesmoPeriodo: true };
  const ctx = prepararFluxo(entrada, dados, opcoes);
  const off = gerarEscala(entrada).alocacoes; // plano OFICIAL
  const fluxoPlano = planejarComFluxo(entrada, dados, opcoes); // o que o fluxo faria (se estivesse ativo nesta semana)
  const remPorPool = fluxoPlano.diagnostico.estado.remPorPool;
  const cov = (al: any[]) => coberturaDoPlano(ctx, al, { limites: remPorPool });
  const medir = (al: any[]) => {
    const av = avaliarPlano(entrada, dados, al, { ...opcoes, incluirTrajetoria: false });
    const rs = av.produtos.reduce((s, p) => s + p.finalEntregue.lo * (entrada.pools.find((q) => q.produtoId === p.produtoId && q.etapaId === p.etapaFinalId)?.valorUnitario ?? 0), 0);
    const sem = al.filter((a) => !a.maquinaId);
    const h = sem.reduce((s, a) => { const sl = entrada.slots.find((x) => x.data === a.data && x.periodoId === a.periodoId)!; return s + (sl.fimMin - sl.inicioMin) / 60; }, 0);
    return { finalLo: Math.round(av.totais.finalEntregueLo), rsLo: Math.round(rs), faltaLo: Math.round(av.totais.faltaFinalLo), pessoasPeriodoSemPosto: sem.length, horasSemPosto: Math.round(h * 10) / 10, postos: al.filter((a) => a.maquinaId).length };
  };
  const cOff = cov(off);
  const rep = repararCobertura(ctx, entrada, { limites: remPorPool });
  const cOn = cov(rep.alocacoes);
  const cFl = cov(fluxoPlano.resultado.alocacoes);
  const repFl = repararCobertura(ctx, fluxoPlano.entradaFluxo, { limites: remPorPool });
  const lista = (c: any) => c.violacoes.map((v: any) => `${v.data.slice(5)} ${v.periodoId.toUpperCase()} ${nomeP(ctx.poolsPorChave.get(v.chave)!.produtoId)}/${nomeO(ctx.poolsPorChave.get(v.chave)!.operacaoId)} postos ${v.postos}->${v.postosSustentaveis} WIP0 ${Math.round(v.wipInicial)} up ${Math.round(v.producaoUpstream)} cons ${Math.round(v.consumoPlanejado)}`);
  const o = {
    abertura: modo, celulas: cOff.celulas.length, semMaterialModelado: cOff.semMaterialModelado,
    oficial: { ...medir(off), violacoes: cOff.violacoes.length, pecasSemMaterial: Math.round(cOff.pecasSemMaterial) },
    oficialLigada: { ...medir(rep.alocacoes), violacoes: cOn.violacoes.length, iter: rep.iteracoes, retirados: rep.postosRetirados },
    fluxo: { escolhido: fluxoPlano.diagnostico.planoEscolhido, ...medir(fluxoPlano.resultado.alocacoes), violacoes: cFl.violacoes.length, pecasSemMaterial: Math.round(cFl.pecasSemMaterial) },
    fluxoLigada: { ...medir(repFl.alocacoes), violacoes: repFl.violacoesFinais, iter: repFl.iteracoes, retirados: repFl.postosRetirados },
    amostraOficial: lista(cOff).slice(0, 14),
    restoOficialLigada: lista(cOn).slice(0, 12),
    adicRestante: rep.alocacoes.filter((a) => (a.pecasAdicional ?? 0) > 0).length,
  };
  res.push(o);
  console.log(JSON.stringify(o, null, 1));
}
fs.writeFileSync(process.env.SAIDA ?? "/tmp/replay-1102.json", JSON.stringify(res, null, 1));

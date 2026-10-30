/* eslint-disable @typescript-eslint/no-explicit-any */
// REPLAY OFFLINE da cobertura intraperíodo (SOMENTE SELECT em PROD via carga.ts; nada é gravado). Compara, no MESMO estado de produção, o plano que o motor atual
// devolve (cobertura DESLIGADA) com o plano reparado (cobertura LIGADA: tetos de postos por (slot, pool) até não haver violação).
// Uso: replay-cobertura.ts --agora ISO[,ISO...] [--cache] [--semana 2026-10-26] [--margem baixa=0.2,media=0.1]
import * as fs from "node:fs";
import { buscar, carregar } from "./carga";
import { montarEstadoAting } from "./estadoAting";
import { slotsDa } from "./estado";
import { avaliarPlano, planejarComFluxo } from "@/features/escala/fluxo";
import { coberturaDoPlano, repararCobertura } from "@/features/escala/fluxo/coberturaPlano";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { janelaDaAusencia, fimDaJornadaMin } from "@/lib/escala/ausenciaAberta";
import type { AlocacaoEscala } from "@/features/escala/types";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf("--" + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; };
const semana = arg("semana") ?? "2026-10-26";
const agoras = (arg("agora") ?? new Date().toISOString()).split(",").map((s) => Date.parse(s));
const margens: Record<string, number> = Object.fromEntries((arg("margem") ?? "").split(",").filter(Boolean).map((p) => { const [k, v] = p.split("="); return [k, Number(v)]; }));
const hhmm = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(5, 16).replace("T", " ");

const bruto = buscar({
  semana, antesIso: new Date(Math.max(...agoras)).toISOString(), depoisIso: "2999-01-01T00:00:00Z", usarCache: argv.includes("--cache"),
  somente: ["q_dec", "q_apont", "q_aloc", "q_fluxo", "q_nomes", "q_par", "q_live_ausencias", "q_live_paradas", "q_live_equipe", "q_live_maquinas", "q_hist", "q_prox", "q_ver", "q_ver_depois"],
});
const d0 = carregar(bruto);
const snap = d0.decisao.entrada;
const fimJornada = fimDaJornadaMin((snap.dias[0]?.periodos ?? []) as any);
const ausencias = bruto.q_live_ausencias.map((a: any) => ({ funcionarioId: a.funcionario_id, data: a.data, ...janelaDaAusencia({ horarioInicio: a.hi, horarioFim: a.hf, emAberto: !!a.em_aberto } as any, fimJornada) }));
const indisponibilidades = bruto.q_live_paradas.map((p: any) => ({ maquinaId: p.maquina_id, desdeMs: Math.round(Number(p.desde_ms)), liberadaEmMs: p.liberada_ms === null ? null : Math.round(Number(p.liberada_ms)) }));
const equipeAtiva = bruto.q_live_equipe.filter((e: any) => e.ativo).map((e: any) => e.id);
const maquinasInativas = bruto.q_live_maquinas.filter((m: any) => m.tipo === "inativa").map((m: any) => m.maquina_id);
const maquinasIndispPrev = bruto.q_live_maquinas.filter((m: any) => m.tipo === "indisponivel_previsao").map((m: any) => m.maquina_id);
const d = {
  ...d0,
  decisao: { ...d0.decisao, entrada: { ...snap, ausencias: ausencias as any, indisponibilidades: indisponibilidades as any, funcionarios: equipeAtiva.length ? equipeAtiva : snap.funcionarios, maquinasInativas, maquinasIndisponiveisPrevisao: maquinasIndispPrev } },
};
const nome = (id: string | null | undefined) => (id ? (d.nomes[id] ?? id.slice(0, 8)).trim().replace('Conector 3/4" - Maquina Automatica', "Con3/4 Autom.").replace('Conector 3/4"', "Con3/4").replace(" 4x2", "") : "-");
const slots = slotsDa(d);
const idx = new Map(slots.map((s) => [`${s.data}|${s.periodoId}`, s.indice]));
const slotDe = (a: { data: string; periodoId: string }) => idx.get(`${a.data}|${a.periodoId}`) ?? -1;
const planoAtual = d.planoAtual;
const resultados: any[] = [];

for (const agoraMs of agoras) {
  const idxIni = slots.find((s) => s.inicioMs >= agoraMs)?.indice;
  if (idxIni === undefined) { console.log(`agora ${hhmm(agoraMs)}: sem períodos a planejar`); continue; }
  const e = montarEstadoAting(d, agoraMs, planoAtual, 100 + idxIni, {}, true);
  const t0 = Date.now();
  const r0 = planejarComFluxo(e.entrada, e.dados, e.opcoes);
  const remPorPool = r0.diagnostico.estado.remPorPool;
  const margemPorConfianca = margens;
  const opCob = { limites: remPorPool, margemPorConfianca };
  const completo = (fu: AlocacaoEscala[]) => [...e.entrada.congeladas, ...fu.filter((a) => slotDe(a) >= e.aPartirDe)];
  const medir = (fu: AlocacaoEscala[]) => {
    const av = avaliarPlano(e.entrada, e.dados, completo(fu), { ...e.opcoes, limitesRemPorPool: remPorPool, incluirTrajetoria: false });
    const valor = av.produtos.reduce((s, p) => s + p.finalEntregue.lo * (e.entrada.pools.find((q) => q.produtoId === p.produtoId && q.etapaId === p.etapaFinalId)?.valorUnitario ?? 0), 0);
    const futuras = fu.filter((a) => slotDe(a) >= e.aPartirDe);
    const sem = futuras.filter((a) => !a.maquinaId);
    const minSem = sem.reduce((s, a) => s + (slots[slotDe(a)].fimMin - slots[slotDe(a)].inicioMin), 0);
    const wipFinal = Object.assign({}, ...av.produtos.map((p) => p.wipFinal));
    return { wipFinal, finalLo: av.totais.finalEntregueLo, finalHi: av.totais.finalEntregueHi, faltaLo: av.totais.faltaFinalLo, rsLo: valor, pessoasPeriodoSemPosto: sem.length, horasSemPosto: minSem / 60, postos: futuras.filter((a) => a.maquinaId).length };
  };
  // (0) plano em vigor hoje em PROD (linhas futuras de escala_producao_alocacoes) — quantos postos violam a cobertura?
  const vigor = planoAtual.filter((a) => slotDe(a) >= e.aPartirDe);
  const covVigor = coberturaDoPlano(e.ctx, vigor, opCob);
  // (1) OFF: o que o motor devolve (planejarComFluxo); OFF': mesmo plano regenerado sem tetos (igual ao OFF quando o escolhido não é o vigente)
  const off = r0.resultado.alocacoes;
  const covOff = coberturaDoPlano(e.ctx, off, opCob);
  const offRegen = gerarEscala(r0.entradaFluxo).alocacoes;
  const covOffRegen = coberturaDoPlano(e.ctx, offRegen, opCob);
  // (2) ON: laço de reparo sobre a entrada do plano escolhido
  const rep = repararCobertura(e.ctx, r0.entradaFluxo, opCob);
  const covOn = coberturaDoPlano(e.ctx, rep.alocacoes, opCob);
  // (3) ON-aparado: corte DURO sobre o plano que o motor publicaria (sem procurar alternativa): tira os postos que o material não sustenta e a pessoa fica SEM posto.
  //     É o custo máximo da regra quando não há alternativa melhor (limite superior da perda).
  const cobPorPool = new Map<string, number>();
  covOff.violacoes.forEach((v) => cobPorPool.set(`${v.slot}|${v.chave}`, v.postosSustentaveis));
  const mantidos = new Map<string, number>();
  const aparado: AlocacaoEscala[] = off.map((a) => {
    if (!a.maquinaId || !a.produtoId || !a.etapaId) return a;
    const k = `${slotDe(a)}|${a.produtoId}|${a.etapaId}`;
    const teto = cobPorPool.get(k);
    if (teto === undefined) return a;
    const n = mantidos.get(k) ?? 0;
    if (n < teto) { mantidos.set(k, n + 1); return a; }
    return { ...a, maquinaId: null, produtoId: null, etapaId: null, operacaoId: null, pecas: 0, pecasAdicional: 0, motivoSemPosto: "sem_material_cobertura" };
  });
  const linhaViol = (c: any) => `${hhmm(slots[c.slot].inicioMs).slice(0, 5)} ${slots[c.slot].periodoId.toUpperCase()} ${nome(e.ctx.poolsPorChave.get(c.chave)?.produtoId)}/${nome(e.ctx.poolsPorChave.get(c.chave)?.operacaoId)}: postos ${c.postos} (sust. ${c.postosSustentaveis}) WIP0 ${Math.round(c.wipInicial)} up ${Math.round(c.producaoUpstream)} cons ${Math.round(c.consumoPlanejado)} esgota ${c.minutoEsgotamento === null ? "-" : Math.round(c.minutoEsgotamento) + "min"} conf ${c.confianca}`;
  const out = {
    agora: hhmm(agoraMs), aPartirDe: e.aPartirDe, slotsFuturos: slots.length - e.aPartirDe, planoEscolhido: r0.diagnostico.planoEscolhido, segundos: (Date.now() - t0) / 1000,
    emVigor: { postos: vigor.filter((a) => a.maquinaId).length, violacoes: covVigor.violacoes.length, pecasSemMaterial: Math.round(covVigor.pecasSemMaterial), semMaterialModelado: covVigor.semMaterialModelado, lista: covVigor.violacoes.map(linhaViol) },
    off: { ...medir(off), violacoes: covOff.violacoes.length, pecasSemMaterial: Math.round(covOff.pecasSemMaterial), semMaterialModelado: covOff.semMaterialModelado, lista: covOff.violacoes.map(linhaViol) },
    onAparado: { ...medir(aparado) },
    offRegen: { ...medir(offRegen), violacoes: covOffRegen.violacoes.length, pecasSemMaterial: Math.round(covOffRegen.pecasSemMaterial) },
    on: { ...medir(rep.alocacoes), violacoes: covOn.violacoes.length, iteracoes: rep.iteracoes, postosRetirados: rep.postosRetirados, pecasSemMaterial: Math.round(covOn.pecasSemMaterial), lista: covOn.violacoes.map(linhaViol) },
    violacoesNoMeio: covOff.violacoes.filter((c) => c.minutoEsgotamento !== null && c.minutoEsgotamento > 1 && c.minutoEsgotamento < c.duracaoMin - 1).length,
    violacoesDesdeOInicio: covOff.violacoes.filter((c) => c.minutoEsgotamento !== null && c.minutoEsgotamento <= 1).length,
    celulasAvaliadas: covOff.celulas.length,
    celulasPorConfianca: covOff.celulas.reduce((m: any, c) => ((m[c.confianca] = (m[c.confianca] ?? 0) + 1), m), {}),
  };
  resultados.push(out);
  console.log(JSON.stringify(out, null, 1));
}
fs.writeFileSync(process.env.SAIDA ?? "/tmp/replay-cobertura.json", JSON.stringify(resultados, null, 1));

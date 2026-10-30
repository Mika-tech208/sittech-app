/* eslint-disable @typescript-eslint/no-explicit-any */
// FORECAST DE BUFFER para a SEMANA FUTURA 2026-11-02 (Previsão salva em PROD; SOMENTE leitura do cache de SELECTs). O plano oficial dessa semana é o do motor LEGADO (gerarEscala; o fluxo só vale em 26/10);
// o forecast também roda sobre o plano que o fluxo geraria (hipotético). Abertura do WIP: A = 0, B = WIP projetado (lo) do fim desta semana, C = (hi).
// Env: OUT=arquivo.json MD=arquivo.md
import * as fs from "node:fs";
import * as path from "node:path";
import { montarEstado as montarEstado1102 } from "./carga1102";
import { abrir, estadoEm } from "./comum";
import { CACHE } from "./carga";
import { montarEntradaEscala } from "@/lib/escala/montarEntrada";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { avaliarPlano, planejarComFluxo } from "@/features/escala/fluxo";
import { prepararFluxo } from "@/features/escala/fluxo/estado";
import { forecastDoPlano } from "@/features/escala/fluxo/forecastBufferPlano";
import { formatarDiagnosticoLigacao } from "@/features/escala/fluxo/forecastBuffer";
import { criarEstimadorPosto } from "@/features/escala/fluxo/produtividadePosto";
import { chavePool, type AlocacaoEscala } from "@/features/escala/types";
import type { ContagemFisicaPar, DadosProducaoReal } from "@/features/escala/fluxo";

const A = abrir();
const { d, ix, nome, hist } = A;
const AGORA_HOJE = Date.parse("2026-10-30T12:20:52-03:00");
const AGORA = Date.parse("2026-11-02T06:00:00-03:00");
const todos = [...hist, ...d.apontamentos];
const t = fs.readFileSync(path.join(CACHE, "aloc_now.sql.out"), "utf8");
const planoAtual: AlocacaoEscala[] = JSON.parse(t.slice(t.indexOf("{"))).rows.map((a: any) => ({
  data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id,
  pecas: Number(a.pecas), ...(Number(a.pecas_adicional) > 0 ? { pecasAdicional: Number(a.pecas_adicional) } : {}), motivoSemPosto: a.motivo_sem_posto, origem: a.origem === "manual" ? "manual" : "auto",
}));
// WIP projetado do fim desta semana (plano em vigor)
const E0 = estadoEm(A, AGORA_HOJE, planoAtual, { mesmoPeriodo: false });
const av0 = avaliarPlano(E0.ent, E0.dados, [...E0.ent.congeladas, ...planoAtual.filter((a) => ix(a) >= E0.ap)], { ...E0.opcoes, fluxoMesmoPeriodo: false });
const wipFinal: Record<string, { lo: number; hi: number }> = Object.assign({}, ...av0.produtos.map((p) => p.wipFinal));

const { estado } = montarEstado1102();
const montada = montarEntradaEscala(estado, AGORA);
const entrada = montada.entrada;
const pares = d.cfg.paresLegado;
const nomeP = (id: string) => (estado.nomesProdutos?.[id] ?? id).trim().replace('Conector 3/4" - Maquina Automatica', "Con3/4 Autom").replace('Conector 3/4"', "Con3/4");
const nomeO = (id: string) => estado.nomesOperacao[id] ?? id;
const rotulo = (k: string) => { const [p, e] = k.split("|"); return `${nome(e) || nomeO(e)} ${nomeP(p)}`; };
const estimador = criarEstimadorPosto(todos, AGORA_HOJE, { janelaDias: 14, nMin: 3 });

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
const md: string[] = [];
const out: any = { wipFinalSemana: Object.fromEntries(Object.entries(wipFinal).map(([k, v]) => [rotulo(k), { lo: Math.round(v.lo), hi: Math.round(v.hi) }])), slots: entrada.slots.length, cenarios: [] };
for (const modo of ["A", "B", "C"] as const) {
  const dados: DadosProducaoReal = { apontamentos: [], agoraMs: AGORA, fechamentoMinutos: 10, planoVigente: [], ...(contagens(modo).length ? { contagensFisicas: contagens(modo) } : {}) };
  const opcoes = { paresLegado: pares, fluxoMesmoPeriodo: false };
  const ctx = prepararFluxo(entrada, dados, opcoes);
  const legado = gerarEscala(entrada).alocacoes;
  const fluxo = planejarComFluxo(entrada, dados, opcoes);
  const rem = fluxo.diagnostico.estado.remPorPool;
  for (const [nomePlano, plano] of [["oficial (legado)", legado], ["fluxo (hipotético)", fluxo.resultado.alocacoes]] as [string, AlocacaoEscala[]][]) {
    const f = forecastDoPlano(ctx, plano, { limites: rem, rotuloNo: rotulo, estimador, mesmoPeriodo: false });
    const r = f.resultado;
    const semMat = r.nos.reduce((q, n) => q + n.postosSemMaterial.reduce((s, v) => s + v, 0), 0);
    const pecasSem = r.nos.reduce((q, n) => q + n.pecasSemMaterial.reduce((s, v) => s + v, 0), 0);
    const cob = r.ligacoes.filter((l) => l.coberturaSemReposicao.periodos !== null).map((l) => l.coberturaSemReposicao.periodos as number);
    const conectores = r.ligacoes.filter((l) => /Con3\/4/.test(l.rotulo));
    const resumo = {
      abertura: modo, plano: nomePlano, periodos: r.periodos.length, ligacoes: r.ligacoes.length, ligacoesComRuptura: r.ligacoes.filter((l) => l.rupturaPrevista).length,
      acoesLigar: r.ligacoes.filter((l) => l.acao.tipo === "ligar_upstream").length, semFonte: r.ligacoes.filter((l) => l.acao.tipo === "sem_fonte").length,
      pecasSemMaterialTotal: Math.round(pecasSem), postosPeriodoSemMaterial: Math.round(semMat * 10) / 10, menorCobertura: r.menorCobertura,
      coberturaMediana: cob.length ? [...cob].sort((a, b) => a - b)[Math.floor(cob.length / 2)] : null, confianca: r.confianca,
      conector: conectores.map((l) => ({ ligacao: l.rotulo, wip: Math.round(l.wipInicial), cobertura: l.coberturaSemReposicao.periodos, ruptura: l.rupturaPrevista ? `${l.rupturaPrevista.rotulo} (falta ${Math.round(l.rupturaPrevista.faltaPecas)})` : null, acao: l.acao.tipo, ligarEm: l.acao.ligarEmRotulo, adicionar: Math.round(l.acao.adicionar.reduce((s, v) => s + v, 0)), inevitavel: Math.round(l.acao.inevitavel) })),
      noMaisSemMaterial: r.nos.map((n) => ({ no: n.rotulo, pecas: Math.round(n.pecasSemMaterial.reduce((s, v) => s + v, 0)), postos: Math.round(n.postosSemMaterial.reduce((s, v) => s + v, 0) * 10) / 10 })).sort((a, b) => b.pecas - a.pecas).slice(0, 5),
    };
    out.cenarios.push(resumo);
    md.push(`\n#### Abertura ${modo} · plano ${nomePlano}\n`);
    md.push(`${resumo.ligacoesComRuptura}/${resumo.ligacoes} ligações com ruptura prevista; ${resumo.pecasSemMaterialTotal} pç e ${resumo.postosPeriodoSemMaterial} postos-período sem material; menor cobertura ${resumo.menorCobertura ?? "—"} períodos\n`);
    conectores.forEach((l) => md.push("- " + formatarDiagnosticoLigacao(l, r.periodos, 6)));
  }
}
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(out, null, 1));
if (process.env.MD) fs.writeFileSync(process.env.MD, md.join("\n") + "\n");

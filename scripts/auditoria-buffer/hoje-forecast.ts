/* eslint-disable @typescript-eslint/no-explicit-any */
// DIAGNÓSTICO DO FORECAST DE BUFFER para HOJE (30/10, T1–T3, após as contagens pós-M3) — SOMENTE LEITURA (cache de SELECTs em PROD); nada é gravado nem publicado.
// Env: OUT=arquivo.json  MD=arquivo.md  JANELA=14  NMIN=3
import * as fs from "node:fs";
import * as path from "node:path";
import { abrir, estadoEm, receita, modoLigacaoConector } from "./comum";
import { CACHE } from "./carga";
import { avaliarPlano, planejarComFluxo } from "@/features/escala/fluxo";
import { cenarioContinuo, forecastDoPlano, fontesDoNo, reposicaoMinimaDe, transferenciaPorArestaDe } from "@/features/escala/fluxo/forecastBufferPlano";
import { agendarMontante, compararFontes, formatarDiagnosticoLigacao } from "@/features/escala/fluxo/forecastBuffer";
import { criarEstimadorPosto, fatorReposicaoMedido } from "@/features/escala/fluxo/produtividadePosto";
import { gerarEscala } from "@/features/escala/gerarEscala";
import { chavePool, type AlocacaoEscala } from "@/features/escala/types";

const A = abrir();
const { d, slots, ix, nome, hist } = A;
const JANELA = Number(process.env.JANELA ?? 14);
const NMIN = Number(process.env.NMIN ?? 3);
const AGORA = Date.parse("2026-10-30T12:20:52-03:00");
const todos = [...hist, ...d.apontamentos];

// plano em vigor em PROD (escala_producao_alocacoes; SELECT já em cache): inclui T1–T3 do recálculo de 12:36
const t = fs.readFileSync(path.join(CACHE, "aloc_now.sql.out"), "utf8");
const planoAtual: AlocacaoEscala[] = JSON.parse(t.slice(t.indexOf("{"))).rows.map((a: any) => ({
  data: a.data, periodoId: a.periodo_id, funcionarioId: a.funcionario_id, maquinaId: a.maquina_id, produtoId: a.produto_id, etapaId: a.etapa_id, operacaoId: a.operacao_id,
  pecas: Number(a.pecas), ...(Number(a.pecas_adicional) > 0 ? { pecasAdicional: Number(a.pecas_adicional) } : {}), ...(a.tipo_adicional ? { tipoAdicional: a.tipo_adicional } : {}),
  motivoSemPosto: a.motivo_sem_posto, excecaoRevezamento: !!a.excecao_revezamento, motivoExcecao: a.motivo_excecao, origem: a.origem === "manual" ? "manual" : "auto",
}));
const E = estadoEm(A, AGORA, planoAtual, { mesmoPeriodo: false });
const { ent, dados, opcoes, ap, ctx } = E;
const vig = planoAtual.filter((a) => ix(a) >= ap);
const r0 = planejarComFluxo(ent, dados, opcoes);
const rem = r0.diagnostico.estado.remPorPool;
const demandaFluxo: Record<string, number> = Object.fromEntries(r0.diagnostico.estado.demanda.map((x) => [x.chave, x.demandaFluxo]));
const rotulo = (k: string) => { const [p, e] = k.split("|"); return `${nome(e)} ${nome(p).replace('Conector 3/4" - Maquina Automatica', "Con3/4 Autom").replace('Conector 3/4"', "Con3/4")}`; };
const estimador = criarEstimadorPosto(todos, AGORA, { janelaDias: JANELA, nMin: NMIN });
const postos = vig.filter((a) => a.maquinaId && a.produtoId && a.etapaId).map((a) => ({ produtoId: a.produtoId as string, operacaoId: ctx.poolsPorChave.get(chavePool(a.produtoId as string, a.etapaId as string))!.operacaoId, maquinaId: a.maquinaId as string }));
const fm = fatorReposicaoMedido(estimador, postos);
const md: string[] = [];
const out: any = { aPartirDe: `${slots[ap].data} ${slots[ap].periodoId}`, horizonte: slots.length - ap, planoEscolhidoMotor: r0.diagnostico.planoEscolhido, fatorReposicaoMedido: fm, janela: JANELA, nMin: NMIN, cenarios: {} };

const n0 = (v: number) => Math.round(v).toLocaleString("pt-BR");
function linhaFluxo(l: ReturnType<typeof forecastDoPlano>["resultado"]["ligacoes"][number], per: { rotulo: string }[]) {
  const T = per.map((p, t) => `${p.rotulo}: ini ${n0(l.saldoInicial[t])} +ent ${n0(l.entradaNoPeriodo[t])} −sai ${n0(l.saidaNoPeriodo[t])} (líq ${l.taxaLiquida[t] >= 0 ? "+" : ""}${n0(l.taxaLiquida[t])}) = fim ${n0(l.saldoFinal[t])}`).join(" | ");
  const rup = l.rupturaPrevista ? `RUPTURA ${l.rupturaPrevista.rotulo} (−${n0(l.rupturaPrevista.faltaPecas)} pç${l.rupturaPrevista.minuto !== null ? `, ~min ${Math.round(l.rupturaPrevista.minuto)}` : ""})` : "sem ruptura";
  const acao = l.acao.tipo === "nenhuma" ? "nenhuma" : l.acao.tipo === "sem_fonte" ? `sem fonte (${n0(l.acao.inevitavel)} pç inevitáveis${l.acao.ligarEmRotulo ? `; ligar ${l.acao.ligarEmRotulo}` : ""})` : `ligar ${l.acao.ligarEmRotulo} (+${n0(l.acao.adicionar.reduce((q, v) => q + v, 0))} pç)`;
  return `${l.rotulo} [${l.transferencia}${l.transferencia === "lote" ? ` ${l.atrasoPeriodos}p` : ""}] WIP ${n0(l.wipInicial)} | cobertura ${l.coberturaSemReposicao.periodos === null ? "cobre" : l.coberturaSemReposicao.periodos.toFixed(2) + " per."} | ${T} | ${rup} | REORDER_POINT ${l.pontoDePedido.map(n0).join("/")}${l.gatilhoPontoDePedido !== null ? ` (gatilho ${per[l.gatilhoPontoDePedido].rotulo})` : ""} | AÇÃO: ${acao}`;
}
function rodar(titulo: string, plano: AlocacaoEscala[], opts: any) {
  const f = forecastDoPlano(ctx, plano.filter((a) => ix(a) >= ap), { limites: demandaFluxo, rotuloNo: rotulo, mesmoPeriodo: false, modoLigacao: modoLigacaoConector(nome), ...opts });
  const r = f.resultado;
  md.push(`\n### ${titulo}\n`);
  md.push(`Períodos: ${r.periodos.map((p) => p.rotulo).join(", ")} | confiança do forecast: ${r.confianca}${r.alternativo ? " | ligações DESCONHECIDAS: principal = lote, alternativo = contínuo" : ""}\n`);
  r.ligacoes.forEach((l, i) => {
    md.push("- " + linhaFluxo(l, r.periodos));
    if (l.incerta && r.alternativo) md.push(`    - cenário CONTÍNUO desta ligação: ${linhaFluxo(r.alternativo.ligacoes[i], r.periodos)}${l.divergeEntreCenarios ? "  ⚠ DIVERGE entre os cenários (incerteza)" : "  (mesmo resultado)"}`);
  });
  return f;
}
const tab = (f: ReturnType<typeof rodar>) => f.resultado.ligacoes.map((l, i) => ({
  ligacao: l.rotulo, modo: l.transferencia, incerta: l.incerta, diverge: l.divergeEntreCenarios, saldoInicial: l.saldoInicial.map(Math.round), entrada: l.entradaNoPeriodo.map(Math.round), saida: l.saidaNoPeriodo.map(Math.round), taxaLiquida: l.taxaLiquida.map(Math.round), saldoFinal: l.saldoFinal.map(Math.round), alternativo: f.resultado.alternativo ? { ruptura: f.resultado.alternativo.ligacoes[i].rupturaPrevista, saldoFinal: f.resultado.alternativo.ligacoes[i].saldoFinal.map(Math.round), pontoDePedido: f.resultado.alternativo.ligacoes[i].pontoDePedido.map(Math.round), acao: f.resultado.alternativo.ligacoes[i].acao.tipo, ligarEm: f.resultado.alternativo.ligacoes[i].acao.ligarEmRotulo, adicionar: f.resultado.alternativo.ligacoes[i].acao.adicionar.map(Math.round) } : null, wip: Math.round(l.wipInicial), confianca: l.confianca, compartilhada: l.compartilhada, consumoPrevisto: l.consumoPrevisto.map(Math.round), reposicaoPrevista: l.reposicaoPrevista.map(Math.round), saldoProjetado: l.saldoProjetado.map(Math.round),
  saldoSemReposicao: l.saldoSemReposicao.map(Math.round), coberturaPeriodos: l.coberturaSemReposicao.periodos, ruptura: l.rupturaPrevista, pontoDePedido: l.pontoDePedido.map(Math.round), gatilho: l.gatilhoPontoDePedido,
  acao: { ...l.acao, adicionar: l.acao.adicionar.map(Math.round) }, saldoComAcao: l.saldoComAcao.map(Math.round), rupturaComAcao: l.rupturaComAcao, picoWipComAcao: Math.round(l.picoWipComAcao), excedeTeto: l.excedeTeto,
}));

// (1) plano em vigor em PROD, produtividade = meta × f do motor (como o simulador)
const fMeta = rodar("Plano em vigor em PROD · produtividade = meta × f do motor", vig, {});
out.cenarios.vigente_meta = tab(fMeta);
// (2) plano em vigor, produtividade do posto pelo histórico (janela curta) — confiança menor (janela escolhida olhando o teste)
const fHist = rodar(`Plano em vigor em PROD · produtividade do posto pelo histórico (${JANELA} dias, n mín. ${NMIN})`, vig, { estimador });
out.cenarios.vigente_historico = tab(fHist);
// (3) idem com fator de reposição medido (p20 ÷ mediana)
const fCons = rodar(`Plano em vigor · histórico + fator de reposição conservador medido (${fm.fator.toFixed(3)})`, vig, { estimador, fatorReposicao: fm.fator });
out.cenarios.vigente_historico_conservador = tab(fCons);
// (4) plano que o motor gera hoje (planejarComFluxo)
const off = r0.resultado.alocacoes.filter((a) => ix(a) >= ap);
const fOff = rodar("Plano do motor de hoje (planejarComFluxo) · histórico", off, { estimador });
out.cenarios.motor_historico = tab(fOff);

out.nosSemMaterial = fHist.resultado.nos.filter((n) => n.pecasSemMaterial.some((v) => v > 0)).map((n) => ({ no: n.rotulo, pecasSemMaterial: n.pecasSemMaterial.map(Math.round), postosSemMaterial: n.postosSemMaterial, desejado: n.producaoDesejada.map(Math.round), efetivo: n.producaoPlano.map(Math.round) }));
md.push("\n### Postos que ficarão sem material (plano em vigor, histórico)\n");
out.nosSemMaterial.forEach((n: any) => md.push(`- ${n.no}: desejado ${n.desejado.join("/")} | efetivo ${n.efetivo.join("/")} | peças sem material ${n.pecasSemMaterial.join("/")} | postos-equivalentes ${n.postosSemMaterial.join("/")}`));
// ---- o motor de hoje (regra global) × o mesmo motor conhecendo o modo de cada aresta ----
{
  const fb = forecastDoPlano(ctx, vig, { limites: demandaFluxo, mesmoPeriodo: false, modoLigacao: modoLigacaoConector(nome), rotuloNo: rotulo });
  const lags = { cons: transferenciaPorArestaDe(fb.entrada, "conservador"), cont: transferenciaPorArestaDe(fb.entrada, "continuo") };
  const resumo = (pl: AlocacaoEscala[], c: "cons" | "cont") => { const av = avaliarPlano(ent, dados, [...ent.congeladas, ...pl], { ...opcoes, fluxoMesmoPeriodo: false, limitesRemPorPool: rem, transferenciaPorAresta: lags[c] }); return { finalLo: Math.round(av.totais.finalEntregueLo), receitaLo: receita(ent, av), wipFinalLo: Math.round(av.totais.wipFinalLo) }; };
  out.motorPorAresta = {};
  (["cons", "cont"] as const).forEach((c) => {
    const rr = planejarComFluxo(ent, dados, { ...opcoes, transferenciaPorAresta: lags[c] });
    const pl = rr.resultado.alocacoes.filter((a) => ix(a) >= ap);
    out.motorPorAresta[c] = { escolhido: rr.diagnostico.planoEscolhido, planoEmVigorNesseMundo: resumo(vig, c), planoDeHojeNesseMundo: resumo(off, c), planoDoMotorComModos: resumo(pl, c), postosDoMotorComModos: resumoPostos(pl) };
  });
}
// ---- pessoas × postos T1–T3 (plano em vigor) ----
function resumoPostos(pl: AlocacaoEscala[]) {
  return ["t1", "t2", "t3"].map((p) => ({ periodo: p, postos: pl.filter((a) => a.data === "2026-10-30" && a.periodoId === p && a.maquinaId).map((a) => `${nome(a.maquinaId)} ${nome(a.etapaId)} ${nome(a.produtoId).replace('Conector 3/4" - Maquina Automatica', "Con3/4 Autom").replace('Conector 3/4"', "Con3/4")}`).sort() }));
}
out.postosVigente = resumoPostos(vig);

// ---- fonte alternativa: Máquina 8 × cadeia convencional, sobre o destino fundido (Etiquetar Conector 3/4) ----
const destino = Object.values(ctx.grafo.nos).find((n) => n.membros.length > 1 && ctx.grafo.entradas[n.id].length > 1);
if (destino) {
  const f = fHist;
  const lig = f.resultado.ligacoes.filter((l) => l.destino === destino.id);
  const H = f.resultado.periodos.length;
  const consTot = Array.from({ length: H }, (_, k) => lig.reduce((q, l) => q + l.consumoRequerido[k], 0));
  const s0 = lig.reduce((q, l) => q + l.wipInicial, 0);
  // reposição líquida necessária ao destino (ALAP, sem limite de capacidade): o que as fontes juntas precisam entregar
  const cap = new Array(H).fill(Number.POSITIVE_INFINITY).map(() => 1e9);
  const nec = agendarMontante(consTot.reduce<number[]>((a, v) => [...a, (a[a.length - 1] ?? 0) + v], []), s0, cap, new Array(H).fill(0), false);
  const restricoes: Record<string, string[]> = {};
  // revezamento: quem fez cada operação em M3 (bloqueada para a mesma pessoa em T1 pela ponte M3→T1)
  const m3 = planoAtual.filter((a) => a.data === "2026-10-30" && a.periodoId === "m3" && a.maquinaId);
  const porOp = new Map<string, number>();
  m3.forEach((a) => porOp.set(nome(a.operacaoId), (porOp.get(nome(a.operacaoId)) ?? 0) + 1));
  lig.forEach((l) => {
    const ops = f.entrada.nos.filter((n) => true && l.origem === n.id).map((n) => n.rotulo);
    restricoes[l.ligacaoId] = [`pessoas em M3 por operação (bloqueadas para a MESMA operação em T1): ${[...porOp.entries()].map(([k, v]) => `${k} ${v}`).join("; ")}`, ...ops];
  });
  const fontes: ReturnType<typeof fontesDoNo> = fontesDoNo(f, destino.id, restricoes);
  const comp = compararFontes(nec.producao, fontes, { mesmoPeriodo: false });
  const necPor = (frac: number) => nec.producao.map((v) => v * frac);
  out.fonteAlternativa = { destino: rotulo(destino.id), necessidadeLiquidaPorPeriodo: nec.producao.map(Math.round), inevitavelDoDestino: nec.inevitavel, estoqueTotal: Math.round(s0), consumoRequeridoPorPeriodo: consTot.map(Math.round), comparacao: comp, tambemComFracaoDaNecessidade: { metade: compararFontes(necPor(0.5), fontes, { mesmoPeriodo: false }).fontes.map((x) => ({ id: x.id, cobre: x.cobre, pessoasPeriodo: x.pessoasPeriodo })) } };
  md.push(`\n### Fonte alternativa de reposição para ${rotulo(destino.id)} (relatório, sem decisão)\n`);
  md.push(`Estoque total das origens ${Math.round(s0)} | consumo requerido por período ${consTot.map(Math.round).join(" / ")} | reposição líquida necessária (ALAP, conservador) ${nec.producao.map(Math.round).join(" / ")}${nec.inevitavel > 0 ? ` | inevitável antes do horizonte ${Math.round(nec.inevitavel)}` : ""}\n`);
  comp.fontes.forEach((x) => md.push(`- ${x.rotulo}: cobre=${x.cobre} déficit=${Math.round(x.deficit)} entregue=${Math.round(x.entregue)} pessoas-período=${x.pessoasPeriodo} (${x.pessoasPorMilPecas ?? "-"} por mil pç) WIP a montante consumido=${Math.round(x.wipConsumido)} estágios: ${x.porEstagio.map((e) => `${e.rotulo} ${e.producao.map(Math.round).join("/")} (${e.pessoasPeriodo} p-p)`).join("; ")}`));
  const rot = new Map(fontes.map((x) => [x.id, x.rotulo]));
  md.push(`Ordem sugerida (informativa): ${comp.ordemSugerida.map((i) => rot.get(i)).join(" > ")} — ${comp.criterio}`);
  // estresse: se o destino precisasse de N peças entregues no período seguinte ao 1º (entrega em T2), como cada fonte responderia?
  // Rosquear→Parafusar é DESCONHECIDO: o estresse é calculado nos dois cenários (entre estágios: lote × contínuo)
  const estresse = [1500, 3000, 6000].flatMap((N) => ["lote", "continuo"].map((cen) => {
    const necessidade = [0, N, 0];
    const c = compararFontes(necessidade, fontes, { mesmoPeriodo: cen === "continuo" });
    return { N, cen, fontes: c.fontes.map((x) => ({ fonte: x.rotulo, cobre: x.cobre, deficit: Math.round(x.deficit), pessoasPeriodo: x.pessoasPeriodo, wipConsumido: Math.round(x.wipConsumido), porEstagio: x.porEstagio.map((e) => `${e.rotulo} ${e.producao.map(Math.round).join("/")} (${e.pessoasPeriodo})`) })) };
  }));
  out.fonteAlternativa.estresse = estresse;
  md.push("\nEstresse (entrega de N peças em T2): ");
  estresse.forEach((e) => md.push(`- N=${e.N} [${e.cen}]: ` + e.fontes.map((x) => `${x.fonte} → cobre=${x.cobre}${x.deficit ? ` déficit ${x.deficit}` : ""}, ${x.pessoasPeriodo} p-p, WIP consumido ${x.wipConsumido} [${x.porEstagio.join("; ")}]`).join(" | ")));
}

// ---- ON (simulação) para hoje: mínimo de reposição nos períodos indicados ----
const avalia = (pl: AlocacaoEscala[], r: Record<string, number>, mesmo = false) => {
  const av = avaliarPlano(ent, dados, [...ent.congeladas, ...pl], { ...opcoes, fluxoMesmoPeriodo: mesmo, limitesRemPorPool: r });
  return { finalLo: Math.round(av.totais.finalEntregueLo), receitaLo: receita(ent, av), wipFinalLo: Math.round(av.totais.wipFinalLo), faltaLo: Math.round(av.totais.faltaFinalLo) };
};
const rp = reposicaoMinimaDe(fHist);
const remGer: Record<string, number> = { ...(r0.entradaFluxo.remPorPool ?? {}) };
Object.entries(rp.remExtra).forEach(([k, v]) => (remGer[k] = (remGer[k] ?? 0) + v));
const on = gerarEscala({ ...r0.entradaFluxo, reposicaoMinima: rp.reposicaoMinima, remPorPool: remGer }).alocacoes.filter((a) => ix(a) >= ap);
const offRegen = gerarEscala(r0.entradaFluxo).alocacoes.filter((a) => ix(a) >= ap);
out.simulacaoHoje = { reposicaoMinima: rp.reposicaoMinima, off: avalia(off, rem), offRegen: avalia(offRegen, rem), on: avalia(on, { ...rem, ...Object.fromEntries(Object.entries(rp.remExtra).map(([k, v]) => [k, (rem[k] ?? 0) + v])) }) };
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(out, null, 1));
if (process.env.MD) fs.writeFileSync(process.env.MD, md.join("\n") + "\n");

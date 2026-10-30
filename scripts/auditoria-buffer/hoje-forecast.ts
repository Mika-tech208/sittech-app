/* eslint-disable @typescript-eslint/no-explicit-any */
// DIAGNÓSTICO DO FORECAST DE BUFFER para HOJE (30/10, T1–T3, após as contagens pós-M3) — SOMENTE LEITURA (cache de SELECTs em PROD); nada é gravado nem publicado.
// Env: OUT=arquivo.json  MD=arquivo.md  JANELA=14  NMIN=3
import * as fs from "node:fs";
import * as path from "node:path";
import { abrir, estadoEm, receita } from "./comum";
import { CACHE } from "./carga";
import { avaliarPlano, planejarComFluxo } from "@/features/escala/fluxo";
import { forecastDoPlano, fontesDoNo, reposicaoMinimaDe } from "@/features/escala/fluxo/forecastBufferPlano";
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

function rodar(titulo: string, plano: AlocacaoEscala[], opts: any) {
  const f = forecastDoPlano(ctx, plano.filter((a) => ix(a) >= ap), { limites: demandaFluxo, rotuloNo: rotulo, mesmoPeriodo: false, ...opts });
  const r = f.resultado;
  md.push(`\n### ${titulo}\n`);
  md.push(`Períodos: ${r.periodos.map((p) => p.rotulo).join(", ")} | confiança do forecast: ${r.confianca} | menor cobertura sem reposição: ${r.menorCobertura === null ? "cobre o horizonte" : r.menorCobertura.toFixed(2) + " períodos"}\n`);
  r.ligacoes.forEach((l) => md.push("- " + formatarDiagnosticoLigacao(l, r.periodos) + (l.compartilhada ? " [estoque compartilhado: 2+ origens]" : "")));
  return f;
}
const tab = (f: ReturnType<typeof rodar>) => f.resultado.ligacoes.map((l) => ({
  ligacao: l.rotulo, wip: Math.round(l.wipInicial), confianca: l.confianca, compartilhada: l.compartilhada, consumoPrevisto: l.consumoPrevisto.map(Math.round), reposicaoPrevista: l.reposicaoPrevista.map(Math.round), saldoProjetado: l.saldoProjetado.map(Math.round),
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
// ---- pessoas × postos T1–T3 (plano em vigor) ----
const resumoPostos = (pl: AlocacaoEscala[]) => ["t1", "t2", "t3"].map((p) => ({ periodo: p, postos: pl.filter((a) => a.data === "2026-10-30" && a.periodoId === p && a.maquinaId).map((a) => `${nome(a.maquinaId)} ${nome(a.etapaId)} ${nome(a.produtoId).replace('Conector 3/4" - Maquina Automatica', "Con3/4 Autom").replace('Conector 3/4"', "Con3/4")}`).sort() }));
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
  const estresse = [1500, 3000, 6000].map((N) => {
    const necessidade = [0, N, 0];
    const c = compararFontes(necessidade, fontes, { mesmoPeriodo: false });
    return { N, fontes: c.fontes.map((x) => ({ fonte: x.rotulo, cobre: x.cobre, deficit: Math.round(x.deficit), pessoasPeriodo: x.pessoasPeriodo, wipConsumido: Math.round(x.wipConsumido), porEstagio: x.porEstagio.map((e) => `${e.rotulo} ${e.producao.map(Math.round).join("/")} (${e.pessoasPeriodo})`) })) };
  });
  out.fonteAlternativa.estresse = estresse;
  md.push("\nEstresse (entrega de N peças em T2): ");
  estresse.forEach((e) => md.push(`- N=${e.N}: ` + e.fontes.map((x) => `${x.fonte} → cobre=${x.cobre}${x.deficit ? ` déficit ${x.deficit}` : ""}, ${x.pessoasPeriodo} p-p, WIP consumido ${x.wipConsumido} [${x.porEstagio.join("; ")}]`).join(" | ")));
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

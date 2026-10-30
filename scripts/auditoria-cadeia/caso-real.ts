/* eslint-disable @typescript-eslint/no-explicit-any */
// CASO REAL 30/10 (item 18): quanto cada buffer DURA, quando Rosquear/Parafusar/M8 deveriam ser (re)ligados — puro, sem dados de PROD (parâmetros do chão).
// Cadeia do Conector 3/4: Rosquear(ROS) → Parafusar(PAF) → Etiquetar(ETQ) → Embalar(EMB); Máquina 8 (M8) → Etiquetar (fonte alternativa). Lote de 1 período em todas.
import * as fs from "node:fs";
import type { EntradaForecast, LigacaoForecast, NoForecast } from "@/features/escala/fluxo/forecastBuffer";
import { fontesAlternativas, necessidadeRetropropagada, repararCadeia, validarCadeia } from "@/features/escala/fluxo/planejamentoCadeia";

const ROT = ["T1", "T2", "T3", "ter M1", "ter M2", "ter M3", "ter T1", "ter T2", "ter T3", "qua M1", "qua M2", "qua M3"];
const n0 = (v: number) => Math.round(v).toLocaleString("pt-BR");

interface Cen { nome: string; ros: number; paf: number; etq: number; m8cap: number; rate: number; horizonte: number; capRos: number; capPaf: number; comTer: boolean }
function entrada(c: Cen): EntradaForecast {
  const H = c.horizonte;
  const s = (v: number) => new Array<number>(H).fill(v);
  const nos: NoForecast[] = [
    { id: "ROS", rotulo: "Rosquear", producaoPrevista: s(0), capacidadeMaxima: s(c.capRos), pecasPorPosto: s(1453), postosPrevistos: s(0) },
    { id: "PAF", rotulo: "Parafusar", producaoPrevista: s(0), capacidadeMaxima: s(c.capPaf), pecasPorPosto: s(1138), postosPrevistos: s(0) },
    { id: "M8", rotulo: "Máquina 8", producaoPrevista: s(0), capacidadeMaxima: s(c.m8cap), pecasPorPosto: s(c.m8cap), postosPrevistos: s(0) },
    { id: "ETQ", rotulo: "Etiquetar", producaoPrevista: s(c.rate), capacidadeMaxima: s(3022), pecasPorPosto: s(3022), postosPrevistos: s(1) },
    { id: "EMB", rotulo: "Embalar", producaoPrevista: s(c.rate), capacidadeMaxima: s(4500), pecasPorPosto: s(4500), postosPrevistos: s(1) },
  ];
  const lig = (o: string, d: string, wip: number, rot: string): LigacaoForecast => ({ id: `${o}>${d}`, origem: o, destino: d, wipInicial: wip, confianca: "baixa", rotulo: rot });
  return { periodos: ROT.slice(0, H).map((rotulo) => ({ rotulo, duracaoMin: 80 })), nos, ligacoes: [lig("ROS", "PAF", c.ros, "Rosquear→Parafusar"), lig("PAF", "ETQ", c.paf, "Parafusar→Etiquetar"), lig("M8", "ETQ", 0, "Máquina 8→Etiquetar"), lig("ETQ", "EMB", c.etq, "Etiquetar→Embalar")] };
}

const out: any = { cenarios: [] };
const md: string[] = [];
const cenarios: Cen[] = [];
for (const [nomeWip, ros, paf, etq] of [["A: saldos físicos das 12:00 (6.000/6.000/3.600)", 6000, 6000, 3600], ["B: estoque efetivo observado (Parafusar→Etiquetar ≈1.050 no início de T2 ⇒ 3.700 no início de T1; discrepância 2.300)", 6000, 3700, 3600]] as [string, number, number, number][])
  for (const rate of [2650, 3010]) cenarios.push({ nome: `${nomeWip} · Etiquetadora ${n0(rate)}/período`, ros, paf, etq, m8cap: 996, rate, horizonte: 12, capRos: 2906, capPaf: 2276, comTer: false });

for (const c of cenarios) {
  const e = entrada(c);
  const r = necessidadeRetropropagada(e);
  const lig = (id: string) => r.ligacoes.find((l) => l.ligacaoId === id)!;
  const linha = (id: string) => {
    const l = lig(id);
    return { ligacao: l.rotulo, wip: l.wipInicial, consumo: Math.round(l.consumoRequerido[0]), duraPeriodos: l.cobertura.periodos === null ? null : Math.round(l.cobertura.periodos * 100) / 100, rupturaEm: l.periodoDaRupturaRotulo, minuto: l.minutoDaRuptura === null ? null : Math.round(l.minutoDaRuptura), ligarOrigemEm: l.ultimoPeriodoSeguroLigarRotulo, producaoNecessariaOrigem: l.producaoNecessariaOrigem.slice(0, 8).map(Math.round), inevitavel: Math.round(l.inevitavel), postos: l.postosNecessarios.slice(0, 8) };
  };
  const alt = fontesAlternativas(e, "ETQ", {});
  // plano da época: ETQ e EMB ativos, ROS/PAF/M8 desligados nos 3 primeiros períodos (como o motor fez); validação sobre o horizonte T1..T3 + ter M1
  const e4 = entrada({ ...c, horizonte: 3 });
  const prox = { rotulo: "ter M1", duracaoMin: 80, producaoPorNo: { ETQ: c.rate, EMB: c.rate } };
  const val = validarCadeia(e4, undefined, { proximoDia: prox });
  const rep = repararCadeia(e4, undefined, { proximoDia: prox });
  const row = {
    cenario: c.nome,
    ligacoes: ["ETQ>EMB", "PAF>ETQ", "ROS>PAF"].map(linha),
    m8: linha("M8>ETQ"),
    fontes: alt.map((a) => ({ fonte: a.rotulo, cobre: a.cobre, inevitavel: Math.round(a.inevitavel), pessoasPeriodo: a.pessoasPeriodo, wipMontanteConsumido: Math.round(a.wipMontanteConsumido), ligarEm: a.ligarEmRotulo, porEtapa: a.producaoPorEtapa.map((p) => `${p.rotulo} ${p.producao.slice(0, 8).map(Math.round).join("/")}`) })),
    planoDaEpoca_T1_T3_terM1: { valido: val.valido, violacoes: val.violacoes.map((v) => ({ no: v.rotulo, periodo: v.periodoRotulo, desejada: Math.round(v.desejada), disponivel: Math.round(v.disponivel), falta: Math.round(v.falta), minuto: v.minuto === null ? null : Math.round(v.minuto) })) },
    reparo: { candidatos: rep.candidatos.map((k) => ({ id: k.id, tipo: k.tipo, descricao: k.descricao, valida: k.valida, violacoes: k.violacoesRestantes, pecasFinais: Math.round(k.pecasFinais), terM1: Math.round(k.pecasProximoDia), desejadas: Math.round(k.pecasFinaisDesejadas), pessoasPeriodoExtra: k.pessoasPeriodoExtra, extra: Object.fromEntries(Object.entries(k.extra).filter(([, v]) => v.some((x) => x > 0)).map(([n, v]) => [n, v.map(Math.round)])) })), escolhido: rep.escolhido.id },
  };
  out.cenarios.push(row);
  md.push(`\n### ${c.nome}\n`);
  row.ligacoes.forEach((l) => md.push(`- ${l.ligacao}: WIP ${n0(l.wip)}, consumo ${n0(l.consumo)}/período ⇒ DURA ${l.duraPeriodos === null ? "∞" : l.duraPeriodos.toFixed(2)} períodos, rompe em ${l.rupturaEm ?? "—"}${l.minuto !== null ? ` (~min ${l.minuto})` : ""}; origem precisa estar produzindo até **${l.ligarOrigemEm ?? "não precisa no horizonte de 12 períodos"}**; produção necessária da origem ${l.producaoNecessariaOrigem.join("/")} (postos ${l.postos.join("/")})${l.inevitavel ? `; inevitável ${n0(l.inevitavel)}` : ""}`));
  md.push(`- Fontes de reposição do Etiquetar (cada uma sozinha): ` + row.fontes.map((f) => `${f.fonte}: cobre=${f.cobre}${f.inevitavel ? ` (inevitável ${n0(f.inevitavel)})` : ""}, ${f.pessoasPeriodo} pessoas-período em 12 períodos, WIP montante consumido ${n0(f.wipMontanteConsumido)}, ligar em ${f.ligarEm ?? "—"} [${f.porEtapa.join("; ")}]`).join(" | "));
  md.push(`- Plano da época (ETQ+EMB ativos, ROS/PAF/M8 off) em T1–T3 + ter M1: ${row.planoDaEpoca_T1_T3_terM1.valido ? "VÁLIDO" : "INVÁLIDO"}; violações: ${row.planoDaEpoca_T1_T3_terM1.violacoes.map((v) => `${v.no} ${v.periodo}: quer ${n0(v.desejada)}, material ${n0(v.disponivel)} (falta ${n0(v.falta)}${v.minuto !== null ? `, ~min ${v.minuto}` : ""})`).join("; ") || "nenhuma"}`);
  md.push(`- Candidatos de reparo: ` + row.reparo.candidatos.map((k) => `${k.id}${k.id === row.reparo.escolhido ? " ★" : ""} [${k.descricao}] válida=${k.valida}, finais T1–T3 ${n0(k.pecasFinais)}/${n0(k.desejadas)} + ter M1 ${n0(k.terM1)} (R$ ${(k.terM1*0.1825).toFixed(0)}), +${k.pessoasPeriodoExtra} p-p, extra ${JSON.stringify(k.extra)}`).join(" | "));
}
fs.writeFileSync(process.env.OUT ?? "/dev/stdout", JSON.stringify(out, null, 1));
if (process.env.MD) fs.writeFileSync(process.env.MD, md.join("\n") + "\n");

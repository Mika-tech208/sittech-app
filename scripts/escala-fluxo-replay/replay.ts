/* eslint-disable @typescript-eslint/no-explicit-any */
// CLI do harness de replay da Escala Inteligente (fluxo).  Uso:
//   npx tsx --tsconfig <tsconfig> scripts/escala-fluxo-replay/replay.ts <comando> [--offset=2] [--so-fechamentos]
// Comandos: fechamentos | encadeado | theta | sensibilidade | tudo
import * as fs from "node:fs";
import * as path from "node:path";
import { carregarApontamentos, carregarDecisoes, carregarParadasReais, DIR } from "./dados";
import { montarCenario } from "./montar";
import { rodarCenario, type Rodada } from "./rodar";
import { resumir } from "./resumo";
import { extrasDe } from "./extras";
import { PARES_LEGADO_PROD } from "./paresLegado";

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("--")) ?? "fechamentos";
const flag = (n: string, d?: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const OFFSET = Number(flag("offset", "2"));
export const OUT = path.join(DIR, "out" + (OFFSET === 2 ? "" : `_off${OFFSET}`));
fs.mkdirSync(OUT, { recursive: true });

const decisoes = carregarDecisoes();
const apontamentos = carregarApontamentos();
const paradas = carregarParadasReais();

// decisões obsoletas: revisões gravadas depois do fechamento do período seguinte (c defasado em relação ao corte)
export function obsoleta(d: (typeof decisoes)[number]) {
  const slots = montarCenario(d, apontamentos).entrada.slots;
  const proximo = slots[d.entrada.c + 1];
  return !!proximo && d.corteMs >= proximo.fimMs + 10 * 60_000;
}

export function escrever(nome: string, obj: unknown) { fs.writeFileSync(path.join(OUT, nome), JSON.stringify(obj)); }

export function rodarTodas(sel: (d: (typeof decisoes)[number]) => boolean, extra: { opcoes?: Parameters<typeof rodarCenario>[2]; semLegado?: boolean } = {}) {
  const out: { r: Rodada; dec: (typeof decisoes)[number] }[] = [];
  for (const d of decisoes.filter(sel)) {
    const cen = montarCenario(d, apontamentos, { offset: OFFSET, paresLegado: extra.semLegado ? undefined : PARES_LEGADO_PROD });
    try { out.push({ r: rodarCenario(cen, paradas, extra.opcoes), dec: d }); } catch (e) { console.log("ERRO", d.id.slice(0, 8), d.data, d.periodoId, (e as Error).message); out.push({ r: { cen, erro: (e as Error).stack } as unknown as Rodada, dec: d }); }
  }
  return out;
}

async function main() {
  const todos = cmd === "tudo";
  let resumos: any[] = [];
  if (cmd === "fechamentos" || todos) {
    const rs = rodarTodas(() => true);
    resumos = rs.map(({ r, dec }) => (r.erro ? { id: dec.id, data: dec.data, periodoId: dec.periodoId, rev: dec.revisao, erro: r.erro } : { ...resumir(r), obsoleta: obsoleta(dec), extras: extrasDe(r) }));
    escrever("fechamentos.json", resumos);
    console.log("fechamentos:", resumos.length, "erros:", resumos.filter((x) => x.erro).length);
    resumos.forEach((y) => {
      if (y.erro) return;
      console.log(y.data, y.periodoId, "rev", y.rev, y.modo === "sombra" ? "sombra" : "restr", "c", y.c, "ap", y.aPartirDe, y.planoEscolhido, "falta vig", y.falta.vigente.join("/"), "base", y.falta.baseRegen.join("/"), "fluxo", y.falta.fluxo.join("/"), "A", y.violacoes.A, "B", y.violacoes.B, "C", y.violacoes.C, "D", y.violacoes.D, "nuc", y.violacoes.nucleo, "det", y.determinismo, y.ms + "ms", y.obsoleta ? "(obsoleta)" : "");
    });
    const { backtestWip } = await import("./backtest");
    const bt = backtestWip(resumos);
    escrever("backtest.json", bt);
    console.log("backtest WIP:", bt.dentro, "/", bt.n, "dentro da faixa");
  }
  if (cmd === "encadeado" || todos) {
    const { replayEncadeado } = await import("./encadeado");
    const e1 = replayEncadeado(OFFSET);
    const e2 = replayEncadeado(OFFSET);
    const h1 = JSON.stringify(e1), h2 = JSON.stringify(e2);
    escrever("encadeado.json", { linhas: e1, deterministico: h1 === h2 });
    console.log("encadeado:", e1.length, "fechamentos; determinístico:", h1 === h2);
  }
  if (cmd === "theta" || todos) {
    const { varrerTheta } = await import("./theta");
    const t = varrerTheta(OFFSET);
    escrever("theta.json", t);
    t.forEach((x) => console.log("θ", x.theta, "falta Σ", x.faltaLo, "linhas med/p90", x.medianaLinhas, x.p90Linhas, "trocas med/p90", x.medianaTrocas, x.p90Trocas, "1º período med/p90", x.medianaPrimeiro, x.p90Primeiro, JSON.stringify(x.escolha)));
  }
  if (cmd === "sensibilidade" || todos) {
    const { sensibilidade } = await import("./sensibilidade");
    const s = sensibilidade(OFFSET);
    escrever("sensibilidade.json", s);
    s.forEach((x) => console.log(x.ok ? "OK  " : "FALHA", x.nome, x.excecao ?? JSON.stringify(x.detalhes).slice(0, 220)));
  }
  if (cmd === "estabilizacao" || todos) {
    const { experimentoEstabilizacao } = await import("./estabilizacao");
    const e = experimentoEstabilizacao(OFFSET);
    escrever("estabilizacao.json", e);
    (e as any[]).forEach((x) => console.log(x.rotulo, "θ0+est:", JSON.stringify(x.theta0), "θpadrão+est 1ºper:", x.thetaPadrao.linhasPrimeiro, "| linhas", x.linhasAntes, "→", x.linhasDepois, "| produtivas", x.produtivasAntes, "→", x.produtivasDepois, "| falta", x.faltaAntes, "→", x.faltaDepois, "| viol", x.violacoesDepois, x.estabilizou ? "" : "(não estabilizou)"));
  }
  if (cmd === "auditoria" || todos) {
    const { auditarEstado } = await import("./auditoria");
    const a = auditarEstado();
    escrever("auditoria.json", a);
    console.log("auditoria do estado:", a.conferidos, "itens conferidos;", a.divergencias.length, "divergências");
    a.divergencias.slice(0, 40).forEach((x) => console.log("  ", x.fechamento, x.item, "esperado", x.esperado, "núcleo", x.nucleo));
  }
  if (cmd === "contrafactual" || todos) {
    const { contrafactualCX } = await import("./contrafactual");
    const cf = contrafactualCX(OFFSET, [{ data: "2026-10-26", periodoId: "m1" }, { data: "2026-10-27", periodoId: "m1" }, { data: "2026-10-27", periodoId: "m2" }, { data: "2026-10-27", periodoId: "m3" }, { data: "2026-10-27", periodoId: "t1" }, { data: "2026-10-27", periodoId: "t2" }, { data: "2026-10-27", periodoId: "t3" }]);
    escrever("contrafactual.json", cf);
    (cf as any[]).forEach((x) => { console.log(x.rotulo, JSON.stringify(x.wipE16Montagem)); x.variantes.forEach((v: any) => console.log("   ", v.nome.padEnd(32), "CX final", v.cxFinal?.join("/"), "falta tot", v.faltaTotal.join("/"), "E16", v.E16pecas, v.postosE, "Mont", v.Mpecas, v.postosM)); });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

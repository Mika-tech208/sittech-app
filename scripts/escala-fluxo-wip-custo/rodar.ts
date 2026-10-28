// Ferramenta de análise do CUSTO OPERACIONAL DO WIP (somente leitura; só SELECT em PROD). Uso (ver docs/escala-fluxo-wip-custo.md):
//   ts.sh scripts/escala-fluxo-wip-custo/rodar.ts [--agora 2026-10-28T09:05:00-03:00] [--fechamento M1 [--data 2026-10-28] [--antes-ate ISO]] [--cache] [--semana 2026-10-26] [--so A,B,D] [--out arq.md]
import * as fs from "node:fs";
import { buscar, carregar } from "./carga";
import { montarEstado, dataSP, slotsDa } from "./estado";
import { analisarPlano, type Nomeador } from "./analise";
import { detalhePar, tabela, tabelaA, tabelaD, n0 } from "./render";
import { relatorioFechamento } from "./fechamento";
import { verificarRestricoesDuras } from "@/features/escala/fluxo";

const arg = (k: string) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? (process.argv[i + 1]?.startsWith("--") ? "1" : process.argv[i + 1] ?? "1") : undefined; };
const semana = arg("semana") ?? "2026-10-26";
const agoraMs = arg("agora") ? Date.parse(arg("agora") as string) : Date.now();
if (!Number.isFinite(agoraMs)) throw new Error("--agora inválido (use ISO com fuso, ex.: 2026-10-28T09:05:00-03:00)");
const fech = arg("fechamento");
const data = arg("data") ?? dataSP(agoraMs);
const antesIso = arg("antes-ate") ?? `${data}T08:50:00-03:00`;
const depoisIso = arg("depois-ate") ?? "2999-01-01T00:00:00Z";
const so = (arg("so") ?? "A,B,C,D,E").split(",").map((s) => s.trim().toUpperCase());

const bruto = buscar({ semana, antesIso, depoisIso, usarCache: process.argv.includes("--cache") });
const d = carregar(bruto);

const opPorEtapa = new Map(d.decisao.entrada.pools.map((p) => [p.etapaId, p.operacaoId]));
const nm: Nomeador = {
  produto: (id) => (d.nomes[id] ?? id.slice(0, 8)).trim().replace('Conector 3/4" - Maquina Automatica', "Conector 3/4 Autom.").replace('Conector 3/4"', "Conector 3/4 Conv."),
  etapa: (id) => { const op = opPorEtapa.get(id); return op ? (d.nomes[op] ?? op.slice(0, 8)).trim() : id.slice(0, 8); },
  maquina: (id) => (d.nomes[id] ?? id.slice(0, 8)).trim(),
};

const L: string[] = [];
const hora = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
const slots = slotsDa(d);

if (!fech || so.some((s) => "ABCD".includes(s))) {
  const e = montarEstado(d, agoraMs, d.planoAtual);
  const ps = analisarPlano(e, d.planoAtual, nm);
  const diaRef = dataSP(agoraMs);
  const ultAp = d.apontamentos.reduce((m, a) => Math.max(m, a.lancadoEmMs), 0);
  L.push(`# Custo operacional do WIP — semana ${semana}`);
  L.push(`Gerado com agora = **${hora(agoraMs)}** (SP). Último período fechado: ${e.ufech >= 0 ? `${slots[e.ufech].data} ${slots[e.ufech].periodoId.toUpperCase()}` : "nenhum"}; primeiro período aberto (início da simulação): **${slots[e.aPartirDe].data} ${slots[e.aPartirDe].periodoId.toUpperCase()}**. Apontamentos da semana: ${d.apontamentos.length} (último lançado ${hora(ultAp)}). Plano vigente: ${d.planoAtual.length} linhas de escala_producao_alocacoes (${slots[0].data}..${slots[slots.length - 1].data}). Modo do fluxo: ${d.cfg.modo}; contagens físicas válidas lidas: ${d.cfg.contagensFisicas.length}.`);
  const usadas = e.ctx.diagnosticos.filter((x) => x.codigo === "CONTAGEM_FISICA_USADA").length;
  L.push(`Contagens físicas aplicadas pelo núcleo: ${usadas}; ignoradas: ${e.ctx.diagnosticos.filter((x) => x.codigo === "CONTAGEM_FISICA_IGNORADA").length}. f de desempenho embutido: ${Object.keys(e.fator).length} pool(s).`);
  const violAtual = verificarRestricoesDuras(e.entrada, d.planoAtual.filter((x) => (slots.find((s) => s.data === x.data && s.periodoId === x.periodoId)?.indice ?? -1) >= e.aPartirDe));
  L.push(`Sanidade: violações de restrição dura do plano vigente (de ${slots[e.aPartirDe].data} ${slots[e.aPartirDe].periodoId.toUpperCase()} em diante) contra a entrada reconstruída: **${violAtual.length}**${violAtual.length ? " (a entrada reconstruída pode estar defasada: ausências/paradas posteriores ao último snapshot não são vistas)" : ""}. Limite: ausências e paradas são as do último snapshot de decisão (${d.decisao.data} ${d.decisao.periodoId.toUpperCase()} rev ${d.decisao.revisao}).`);
  L.push("");
  const comWip = ps.filter((p) => p.w0.hi > 1 || p.picoSemana.hi > 1);
  const semWip = ps.filter((p) => !comWip.includes(p));
  if (so.includes("A")) {
    L.push("## A) Estado por par (plano vigente × estado de produção atual)");
    L.push("Pares com WIP (> 0 agora ou em algum ponto até sexta). WIP em PERÍODOS = WIP ÷ produção planejada de 1 período do upstream (UP) / ÷ capacidade planejada de 1 período do downstream (DOWN). Pico = máximo do cenário otimista de produção (pior caso de acúmulo); lo–hi = faixa por produção não confirmada.");
    L.push("");
    L.push(tabelaA(comWip));
    if (semWip.length) L.push(`\nPares sem WIP agora nem previsto: ${semWip.map((p) => p.rotulo).join("; ")}.`);
    L.push("");
    comWip.forEach((p) => { L.push(detalhePar(p, diaRef)); L.push(""); });
  }
  if (so.includes("B") || so.includes("C")) {
    L.push("## B/C) Pares com contagem física confirmada — respostas diretas");
    ps.filter((p) => p.contagem).forEach((p) => {
      L.push(`### ${p.rotulo}`);
      L.push(`1. Saldo físico agora: **${n0(p.w0.hi)}**; saldo no 1º período em que o downstream (${p.maquinasDown.join(", ")}) é escalado${p.primeiroPostoDown ? ` (**${p.primeiroPostoDown.rotulo}**)` : ""}: **${p.saldoNoPrimeiroPostoDown ? (Math.abs(p.saldoNoPrimeiroPostoDown.hi - p.saldoNoPrimeiroPostoDown.lo) < 1 ? n0(p.saldoNoPrimeiroPostoDown.hi) : `${n0(p.saldoNoPrimeiroPostoDown.lo)}–${n0(p.saldoNoPrimeiroPostoDown.hi)}`) : "downstream não escalado até sexta"}**.`);
      L.push(`2. O plano começa a consumir em: **${p.primeiroConsumo ? p.primeiroConsumo.rotulo : "(nenhum período até sexta)"}**.`);
      L.push(`3. Pico previsto de WIP: dia **${n0(p.picoDia.hi)}** (${p.picoDia.rotulo}); semana **${n0(p.picoSemana.hi)}** (${p.picoSemana.rotulo}).`);
      L.push(`4. Volta a zero/≈0 (≤ 5% do pico): ${p.vemDeZero ? "não há WIP" : p.volta ? `**${p.volta.rotulo}**` : "**não volta até sexta**"}. Saldo atual totalmente consumido (FIFO): ${p.saldoInicialConsumido ? p.saldoInicialConsumido.rotulo : "não até sexta"}.`);
      L.push(`5. Margem de capacidade do downstream após o pico: **ociosa ${n0(p.livre.estritaAposPico)} pç**, teórica ${n0(p.livre.teoricaAposPico)} pç (total até sexta desde o período aberto: ociosa ${n0(p.livre.estritaTotal)}, teórica ${n0(p.livre.teoricaTotal)}). Por período (planejado; livre ociosa / teórica):`);
      L.push(tabela(["Período", "Planejado", "Livre ociosa", "Livre teór."], p.livre.porSlot.filter((s) => s.estrita > 0 || s.teorica > 0 || s.planejado > 0).map((s) => [s.rotulo, n0(s.planejado), n0(s.estrita), n0(s.teorica)])));
      L.push("");
    });
  }
  if (so.includes("D")) {
    L.push("## D) Limite operacional de WIP — o que cada definição daria × pico do plano atual (semana)");
    L.push(`Definições: (i) X períodos de produção do upstream; (ii) X períodos de consumo do downstream; (iii) tempo máximo de fila × consumo médio por hora útil do downstream (4 h / 1 turno / 1 dia útil); (iv) % da demanda restante do nó destino. Nenhuma é implementada no motor; só análise.`);
    L.push("");
    L.push(tabelaD(ps));
    L.push("");
  }
  if (so.includes("A")) {
    L.push("### Parâmetros usados (por par): produção upstream/período, capacidade downstream/período, demanda restante");
    L.push(tabela(["Par", "Prod. UP/per. (plano)", "Cons. DOWN/per. (plano)", "Máx. técnico DOWN/per.", "Cap. técnica 1 dia", "Cons. médio/h útil", "Demanda restante destino"], comWip.map((p) => [p.rotulo, n0(p.prodUpPeriodo), n0(p.consDownPlanoPeriodo), n0(p.consDownTecnicoPeriodo), n0(p.capDiaTecnico), n0(p.consumoMedioPorHora), n0(p.demandaRestanteDestino)])));
    L.push("");
  }
}
if (fech && so.includes("E")) L.push(relatorioFechamento({ d, nm, agoraMs, fech, data, usarVersaoDepois: !!arg("depois-ate"), slots }));
const txt = L.join("\n");
if (arg("out")) fs.writeFileSync(arg("out") as string, txt); else console.log(txt);

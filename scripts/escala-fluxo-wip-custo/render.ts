import type { AnalisePar } from "./analise";

export const n0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString("pt-BR") : "∞");
export const n1 = (v: number) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "∞");
export const n2 = (v: number) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "∞");
export const faixa = (lo: number, hi: number) => (Math.abs(hi - lo) < 1 ? n0(hi) : `${n0(lo)}–${n0(hi)}`);
export const tabela = (cab: string[], linhas: string[][]) => [`| ${cab.join(" | ")} |`, `|${cab.map(() => "---").join("|")}|`, ...linhas.map((l) => `| ${l.join(" | ")} |`)].join("\n");
const mark = { baixo: "baixo", medio: "MÉDIO", alto: "ALTO" } as const;

export function tabelaA(ps: AnalisePar[]): string {
  return tabela(
    ["Par", "WIP atual (lo–hi)", "Estado", "WIP em per. UP", "WIP em per. DOWN", "Pico dia", "Pico semana", "Volta a ~0", "Ociosa pós-pico / pico", "Risco físico", "Folga", "RISCO"],
    ps.map((p) => [
      p.rotulo, faixa(p.w0.lo, p.w0.hi), `${p.estadoAtual.origem}${p.contagem ? " (contagem)" : ""}, conf. ${p.estadoAtual.confianca}`,
      n1(p.wip0EmPeriodosUp), n1(p.wip0EmPeriodosDown), `${faixa(p.picoDia.lo, p.picoDia.hi)} (${p.picoDia.rotulo})`, `${faixa(p.picoSemana.lo, p.picoSemana.hi)} (${p.picoSemana.rotulo})`,
      p.vemDeZero ? "sem WIP" : p.volta ? `${p.volta.rotulo} (${p.volta.periodos} per., ${n1(p.volta.horas)} h)` : "NÃO volta até sexta",
      p.razaoFolga === null ? "—" : `${n2(p.razaoFolga)} (${n0(p.livre.estritaAposPico)}/${n0(p.picoSemana.hi)})`, mark[p.risco.nivelFisico], p.risco.nivelFolga, `**${mark[p.risco.nivel]}**`,
    ])
  );
}

export function detalhePar(p: AnalisePar, diaRef: string): string {
  const L: string[] = [];
  L.push(`### ${p.rotulo}`);
  L.push(`Origem: ${p.origemRotulo}; destino: ${p.destinoRotulo}; máquinas do downstream: ${p.maquinasDown.join(", ")}.`);
  L.push(`- WIP atual: **${faixa(p.w0.lo, p.w0.hi)}** (${p.estadoAtual.origem}, fonte ${p.estadoAtual.fonte}, confiança ${p.estadoAtual.confianca}); em **${n1(p.wip0EmPeriodosUp)}** período(s) de produção do upstream (${n0(p.prodUpPeriodo)} pç/per. no plano) e **${n1(p.wip0EmPeriodosDown)}** período(s) de consumo do downstream (${n0(p.consDownRef)} pç/per., ${p.consDownRefFonte}; máx. técnico ${n0(p.consDownTecnicoPeriodo)} pç/per.).`);
  L.push(`- Pico no dia ${diaRef.slice(8)}/${diaRef.slice(5, 7)}: **${faixa(p.picoDia.lo, p.picoDia.hi)}** (${p.picoDia.rotulo}); pico até sexta: **${faixa(p.picoSemana.lo, p.picoSemana.hi)}** (${p.picoSemana.rotulo}) = ${n1(p.picoEmPeriodosUp)} per. UP / ${n1(p.picoEmPeriodosDown)} per. DOWN.`);
  L.push(`- 1º período com posto no downstream: ${p.primeiroPostoDown ? `**${p.primeiroPostoDown.rotulo}** (saldo no início desse período: **${faixa(p.saldoNoPrimeiroPostoDown!.lo, p.saldoNoPrimeiroPostoDown!.hi)}**)` : "**nenhum até sexta**"}; 1º consumo efetivo na simulação: ${p.primeiroConsumo ? `**${p.primeiroConsumo.rotulo}**` : "nenhum"}.`);
  L.push(`- Saldo atual consumido (FIFO): ${p.saldoInicialConsumido ? `${p.saldoInicialConsumido.rotulo} (${p.saldoInicialConsumido.periodos} per., ${n1(p.saldoInicialConsumido.horas)} h úteis)` : "não é totalmente consumido até sexta"}. WIP volta a ≤ 5% do pico: ${p.vemDeZero ? "sem WIP" : p.volta ? `**${p.volta.rotulo}** (${p.volta.periodos} per., ${n1(p.volta.horas)} h úteis desde o início do período aberto)` : "**não volta até sexta**"}.`);
  L.push(`- Capacidade livre do downstream (pós-pico): **ociosa ${n0(p.livre.estritaAposPico)} pç** (máquinas disponíveis sem posto no plano × meta), teórica ${n0(p.livre.teoricaAposPico)} pç (máquinas disp. × meta − planejado; inclui máquinas hoje usadas por outro produto), garantida por pessoas ${n0(p.livre.garantidaAposPico)} pç (só conta pessoas SEM posto no plano). Razão ociosa/pico = **${p.razaoFolga === null ? "—" : n2(p.razaoFolga)}** (${p.risco.nivelFolga}); teórica/pico = ${p.razaoFolgaTeorica === null ? "—" : n2(p.razaoFolgaTeorica)}. Total até sexta (desde o período aberto): ociosa ${n0(p.livre.estritaTotal)}, teórica ${n0(p.livre.teoricaTotal)}.`);
  L.push(`- Risco: **${mark[p.risco.nivel]}** (físico/fila: ${mark[p.risco.nivelFisico]}; folga de recuperação: ${p.risco.nivelFolga}) — pico/capacidade técnica de 1 dia = ${n2(p.risco.razaoDia)}; fila = ${n1(p.risco.filaHoras)} h úteis (${n1(p.risco.filaTurnos)} turno(s)); ${p.risco.motivos.length ? p.risco.motivos.join("; ") : "sem gatilho de risco"}.`);
  const diaSlots = p.traj.filter((t) => t.rotulo.startsWith(diaRef.slice(8) + "/" + diaRef.slice(5, 7)));
  L.push("");
  L.push("Trajetória do dia (WIP ao FIM de cada período; produção upstream e consumo downstream simulados, cenário otimista de produção = pior caso de acúmulo):");
  L.push(tabela(["Período", "Prod. UP", "Cons. DOWN", "WIP fim (hi)", "WIP fim (lo)"], diaSlots.map((t) => [t.rotulo, n0(t.up), n0(t.cons), n0(t.hi), n0(t.lo)])));
  const sem = p.traj.filter((t) => !diaSlots.includes(t));
  L.push("");
  L.push("Demais períodos até sexta (WIP fim hi/lo; cons. DOWN; livre ociosa/teórica do downstream):");
  const livreDe = new Map(p.livre.porSlot.map((s) => [s.slot, s]));
  L.push(tabela(["Período", "Prod. UP", "Cons. DOWN", "WIP fim (hi)", "WIP fim (lo)", "Livre ociosa", "Livre teór."], sem.map((t) => [t.rotulo, n0(t.up), n0(t.cons), n0(t.hi), n0(t.lo), n0(livreDe.get(t.slot)?.estrita ?? 0), n0(livreDe.get(t.slot)?.teorica ?? 0)])));
  return L.join("\n");
}

export function tabelaD(ps: AnalisePar[]): string {
  const alvo = ps.filter((p) => p.picoSemana.hi > 1 || p.w0.hi > 1);
  if (alvo.length === 0) return "_Nenhum par com WIP._";
  const nomes = alvo[0].limites.map((l) => l.nome);
  const cab = ["Par", "Pico semana", ...nomes];
  const linhas = alvo.map((p) => [p.rotulo, n0(p.picoSemana.hi), ...p.limites.map((l) => `${n0(l.valor)} ${l.ok ? "OK" : `**viola +${n0(l.excesso)} (+${n0(l.excessoPct)}%)**`}`)]);
  const resumo = nomes.map((nome, i) => {
    const ok = alvo.filter((p) => p.limites[i].ok).length;
    return `- ${nome}: respeitado em ${ok}/${alvo.length} pares${ok < alvo.length ? ` (viola: ${alvo.filter((p) => !p.limites[i].ok).map((p) => p.rotulo.split(":")[0] + ":" + p.rotulo.split(":")[1]).join("; ")})` : ""}`;
  });
  return tabela(cab, linhas) + "\n\nResumo por definição:\n" + resumo.join("\n");
}

// Replanejamento restrito — semana 26/10 PERÍODO A PERÍODO, 5 cenários (somente leitura em PROD; NADA é gravado).
import { gerarEscala } from "@/features/escala/gerarEscala";
import { hashAlocacoes } from "@/features/escala/horizonte";
import { simularSemanaRestrita, type ResultadoSimulacao } from "@/features/escala/simulacaoRestrita";
import { calcularDinamica } from "@/features/escala/gargaloDinamico";
import { chavePool, type AlocacaoEscala } from "@/features/escala/types";
import { readFileSync, writeFileSync } from "node:fs";

const J = JSON.parse(readFileSync(process.env.ESTADO as string, "utf8"));
const f = (n: number, c = 0) => n.toLocaleString("pt-BR", { maximumFractionDigits: c });
const SEMANA = J.semanaInicio as string;
async function main() {
  const K = Number(process.env.VIAVEL ?? 1);
  const base0 = J.base as import("@/features/escala/types").EntradaEscala;
  // VIAVEL=k: mesma semana, máquinas, pessoas e WIP flexível programado, mas com o PREVISTO × k (carga viável: mostra a dinâmica sem a saturação da origem)
  const base = K === 1 ? base0 : { ...base0, pools: base0.pools.map((p) => ({ ...p, quantidade: Math.round(p.quantidade * K) })) };
  const nomeM = (id: string) => (J.nomesMaquinas?.[id] ?? id.slice(0, 6)).trim();
  const nomeP = (id: string) => (J.nomesProdutos?.[id] ?? id.slice(0, 6)).trim();
  const nomeOp = (etapaId: string) => J.nomesOperacao[J.etapaOp[etapaId] ?? ""] ?? etapaId.slice(0, 6);
  const oficial = (K === 1 ? J.oficial : gerarEscala(base).alocacoes) as AlocacaoEscala[];
  const regen = gerarEscala(base).alocacoes;
  console.log(`semana ${SEMANA}: ${base.slots.length} períodos, ${base.funcionarios.length} pessoas, ${base.pools.length} pools | plano oficial ${oficial.length} linhas hash ${hashAlocacoes(oficial).slice(0, 12)} | motor reproduz ${regen.length} linhas hash ${hashAlocacoes(regen).slice(0, 12)}`);
  const wipTotal = (rows: AlocacaoEscala[]) => rows.reduce((s, a) => s + (a.maquinaId ? a.pecasAdicional ?? 0 : 0), 0);
  console.log(`WIP no plano oficial: ${f(wipTotal(oficial))} pç | ociosos ${oficial.filter((a) => !a.maquinaId).length}`);

  // tabela inicial (dinâmica no início da semana, nada realizado)
  const rest0 = Object.fromEntries(base.pools.map((p) => [chavePool(p.produtoId, p.etapaId), p.quantidade]));
  const d0 = calcularDinamica({ entrada: base, originais: base.pools, restante: rest0, desempenho: {}, c: -1 });
  console.log("\nRECURSOS por pressão (início, restante = previsto, metas originais):");
  d0.gargalo.recursos.slice(0, 8).forEach((r) => console.log(`  ${r.maquinas.map(nomeM).join("+")} [${r.produtos.map(nomeP).join(", ")}]: pressão ${f(r.pressaoOriginal, 2)} (necessário ${f(r.necessarioOriginal, 1)} / disponível ${f(r.disponivel)})`));
  const opDeRecurso = (r: { maquinas: string[] }) => { const p = base.pools.find((x) => x.maquinasIds.some((m) => r.maquinas.includes(m))); return p ? nomeOp(p.etapaId) : "?"; };

  const gargaloInicial = d0.gargalo.principal;
  const opGargalo = gargaloInicial ? opDeRecurso(gargaloInicial) : "Embalar";
  const outro = d0.gargalo.recursos.find((r) => opDeRecurso(r) !== opGargalo && r.pressaoOriginal > 0.3);
  const opOutro = outro ? opDeRecurso(outro) : "Montar";
  console.log(`\nGargalo inicial: ${opGargalo}; operação alternativa p/ cenário 4: ${opOutro}`);

  const cenarios: { id: string; nome: string; rend: (op: string) => number; aplicar: boolean }[] = [
    { id: "0", nome: "REFERÊNCIA (plano oficial estático, produção = plano)", rend: () => 1, aplicar: false },
    { id: "1", nome: "1) realizado = planejado", rend: () => 1, aplicar: true },
    { id: "2", nome: `2) ${opGargalo} +18% (consistente)`, rend: (op) => (op === opGargalo ? 1.18 : 1), aplicar: true },
    { id: "2e", nome: `2e) ${opGargalo} +18% — SEM replanejar (estático)`, rend: (op) => (op === opGargalo ? 1.18 : 1), aplicar: false },
    { id: "3", nome: `3) ${opGargalo} −20%`, rend: (op) => (op === opGargalo ? 0.8 : 1), aplicar: true },
    { id: "3e", nome: `3e) ${opGargalo} −20% — SEM replanejar (estático)`, rend: (op) => (op === opGargalo ? 0.8 : 1), aplicar: false },
    { id: "4", nome: `4) ${opOutro} −30% (outra operação vira gargalo)`, rend: (op) => (op === opOutro ? 0.7 : 1), aplicar: true },
    { id: "4e", nome: `4e) ${opOutro} −30% — SEM replanejar (estático)`, rend: (op) => (op === opOutro ? 0.7 : 1), aplicar: false },
    { id: "5", nome: "5) produção geral +12%", rend: () => 1.12, aplicar: true },
    { id: "5e", nome: "5e) produção geral +12% — SEM replanejar (estático)", rend: () => 1.12, aplicar: false },
  ];
  const linhas: string[] = [];
  const falta = (r: ResultadoSimulacao) => {
    // previsto − boas reais do ACABADO (última etapa de cada produto), só positivo
    let tot = 0;
    const porProduto = new Map<string, typeof base.pools>();
    base.pools.forEach((p) => porProduto.set(p.produtoId, [...(porProduto.get(p.produtoId) ?? []), p]));
    porProduto.forEach((etapas) => { const u = [...etapas].sort((a, b) => b.ordemEtapa - a.ordemEtapa)[0]; const boas = r.apontamentos.filter((a) => a.produtoId === u.produtoId && a.etapaId === u.etapaId).reduce((s, a) => s + a.boas, 0); tot += Math.max(0, u.quantidade - boas); });
    return tot;
  };
  for (const c of cenarios) {
    const t0 = Date.now();
    const r = simularSemanaRestrita({ base, planoInicial: oficial, rendimento: ({ pool }) => c.rend(nomeOp(pool.etapaId)), aplicar: c.aplicar });
    const mud = r.cortes.filter((x) => x.aplicado);
    const viol = r.cortes.reduce((s, x) => s + x.violacoes.length, 0);
    const recusadas = r.cortes.filter((x) => x.veredito === "recusar");
    linhas.push(`\n=== ${c.nome} === (${f((Date.now() - t0) / 1000, 1)}s)`);
    linhas.push(`  falta final do acabado (previsto − boas): ${f(falta(r))} pç | WIP final no plano: ${f(wipTotal(r.planoFinal))} pç | ociosos no plano: ${r.planoFinal.filter((a) => !a.maquinaId).length} | repetições de operação: ${r.repeticoes} | cortes aplicados: ${mud.length}/${r.cortes.length} | recusados: ${recusadas.length} | violações: ${viol}`);
    const ap = r.cortes.filter((x) => x.aplicado);
    const somar = (f: (x: (typeof r.cortes)[number]) => number) => ap.reduce((s, x) => s + f(x), 0);
    linhas.push(`  CHURN (cortes aplicados): linhas alteradas ${somar((x) => x.mudancas)} = produtivas ${somar((x) => x.produtivas)} + trocas equivalentes ${somar((x) => x.trocasEquivalentes)} | poupadas pela estabilidade ${somar((x) => x.poupadasPelaEstabilidade)} | revertidas no corte seguinte ${somar((x) => x.revertidasDaAnterior)} | média/aplicação ${ap.length ? f(somar((x) => x.mudancas) / ap.length, 1) : 0}`);
    linhas.push(`  WIP: Δ líquido aplicado ${f(somar((x) => x.wipDelta))} pç | pessoa-horas de WIP ACRESCIDAS ${f(somar((x) => x.wipHorasAcrescidas), 1)} h (todas em pessoas que ficariam ociosas) | pessoa-horas de WIP na região ${f(somar((x) => x.wipPessoaHoras), 1)} h | WIP sem ociosidade (proibido) ${r.cortes.reduce((s, x) => s + x.wipSemOciosidade, 0)}`);
    linhas.push("  corte        veredito  mud(prod/eq)  WIP−  WIP+  rev  WIPfut(antes→depois)  falta(of→som)  ociosos  gargalo(evol)");
    r.cortes.forEach((x) => linhas.push(`  ${x.rotulo.padEnd(11)} ${(x.aplicado ? "APLICA" : x.veredito).padEnd(9)} ${(String(x.mudancas) + "(" + x.produtivas + "/" + x.trocasEquivalentes + ")").padStart(12)} ${String(x.wipRemovido).padStart(5)} ${String(x.wipAdicionado).padStart(5)} ${String(x.revertidasDaAnterior).padStart(4)}  ${(f(x.wipFuturoAntes) + "→" + f(x.wipFuturoDepois)).padEnd(21)} ${(f(x.faltaOficial) + "→" + f(x.faltaSombra)).padEnd(13)} ${String(x.ociososFuturos).padStart(7)}  ${x.gargalo ? `${x.gargalo.situacao} ${x.gargalo.maquinas.map(nomeM).join("+").slice(0, 22)} p=${f(x.gargalo.pressaoOriginal, 2)}→${f(x.gargalo.pressaoAjustada, 2)} (${x.evolucaoGargalo})` : "—"}${x.violacoes.length ? "  ⚠ " + x.violacoes.slice(0, 2).join("; ") : ""}`));
    if (["2", "3", "4", "5"].includes(c.id)) {
      const ult = r.cortes[Math.floor(r.cortes.length / 2)];
      linhas.push(`  ritmo no corte ${ult.rotulo} (meta × real): ` + ult.ritmo.filter((x) => x.n > 0).map((x) => `${nomeOp(x.poolKey.split("|")[1])}/${nomeP(x.poolKey.split("|")[0]).slice(0, 10)} n=${x.n} f=${f(x.f, 3)} cap ${f(x.capacidadeOriginal)}→${f(x.capacidadeAjustada)}`).join(" | "));
    }
  }
  const out = linhas.join("\n");
  console.log(out);
  writeFileSync(process.env.SAIDA ?? "/tmp/sim_restrito_2610.txt", out);
}
main().catch((e) => { console.error(e); process.exit(1); });

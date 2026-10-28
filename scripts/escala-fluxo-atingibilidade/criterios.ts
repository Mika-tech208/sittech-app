// Replay das decisões gravadas (critérios A–J do fluxo) com a regra de atingibilidade LIGADA × DESLIGADA, no mesmo estado. Somente leitura.
// Uso: FREPLAY_DIR=<dir com q_dec/q_apont/...> ts.sh scripts/escala-fluxo-atingibilidade/criterios.ts [--offset=2] [--out arq.json]
import * as fs from "node:fs";
import { carregarApontamentos, carregarDecisoes, carregarParadasReais } from "../escala-fluxo-replay/dados";
import { montarCenario } from "../escala-fluxo-replay/montar";
import { rodarCenario } from "../escala-fluxo-replay/rodar";
import { resumir } from "../escala-fluxo-replay/resumo";
import { PARES_LEGADO_PROD } from "../escala-fluxo-replay/paresLegado";

const flag = (n: string, d?: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const OFFSET = Number(flag("offset", "2"));
const dec = carregarDecisoes();
const ap = carregarApontamentos();
const paradas = carregarParadasReais();
const linhas: any[] = [];
for (const d of dec) {
  const cen = montarCenario(d, ap, { offset: OFFSET, paresLegado: PARES_LEGADO_PROD });
  try {
    const off = rodarCenario(cen, paradas, {}, true);
    const on = rodarCenario(cen, paradas, { preservarAtingibilidade: true }, true);
    const so = resumir(off), sn = resumir(on);
    const at = on.res.diagnostico.atingibilidade;
    const atV = on.avVigente.atingibilidade; // vigente avaliado COM a régua nova (opcoes do `on` não são usadas em avVigente? usa opcoes de rodarCenario)
    linhas.push({
      id: d.id.slice(0, 8), data: d.data, periodoId: d.periodoId, rev: d.revisao, c: cen.c, aPartirDe: cen.aPartirDe,
      off: { escolhido: so.planoEscolhido, falta: so.falta.fluxo[0], final: so.final.fluxo[0], violA: so.violacoes.A, violD: so.violacoes.D, nuc: so.violacoes.nucleo, det: so.determinismo, ms: so.ms, linhas: (so.churnNucleo as any).linhasAlteradas, wip: so.wipFinal.fluxo[0], excesso: so.excessoWip.fluxo },
      on: { escolhido: sn.planoEscolhido, falta: sn.falta.fluxo[0], final: sn.final.fluxo[0], violA: sn.violacoes.A, violD: sn.violacoes.D, nuc: sn.violacoes.nucleo, det: sn.determinismo, ms: sn.ms, linhas: (sn.churnNucleo as any).linhasAlteradas, wip: sn.wipFinal.fluxo[0], excesso: sn.excessoWip.fluxo },
      vigente: { falta: so.falta.vigente[0] },
      ating: at ? { antes: at.antes.atingiveisPerdidas, depois: at.depois.atingiveisPerdidas, deficitAntes: at.antes.deficitRelativo, deficitDepois: at.depois.deficitRelativo, grupos: at.depois.grupos.map((g) => ({ meta: g.meta, max: g.maximoPossivel, final: g.finalPrevisto, st: g.status })) } : null,
      atVigenteAvaliado: atV ? atV.atingiveisPerdidas : null,
      cobertura: { off: so.coberturaDecisoes, on: sn.coberturaDecisoes }, recon: { off: so.reconciliacao.residuo, on: sn.reconciliacao.residuo },
      piorQueBaseOn: sn.falta.fluxo[0] > sn.falta.baseRegen[0] + 1,
    });
    process.stdout.write(".");
  } catch (e) { linhas.push({ id: d.id.slice(0, 8), data: d.data, periodoId: d.periodoId, erro: (e as Error).message }); process.stdout.write("E"); }
}
console.log();
fs.writeFileSync(flag("out", "/dev/stdout") as string, JSON.stringify(linhas));

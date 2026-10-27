// Efeito da estabilização de pessoas (H): o MESMO fechamento com e sem `estabilizarPessoas`. Mesmos postos, mesma falta, menos linhas alteradas contra o vigente.
import { classificarMudancas } from "@/features/escala/estabilidade";
import { fechamentos, rodar } from "./comum";
import { churnIndependente } from "./independente";

export function experimentoEstabilizacao(offset = 2) {
  const linhas: unknown[] = [];
  for (const d of fechamentos) {
    const com = rodar(d, { offset });
    const sem = rodar(d, { offset }, { estabilizarPessoas: false });
    const cen = com.cen, slots = cen.entrada.slots, ap = cen.aPartirDe;
    const idx = (a: { data: string; periodoId: string }) => slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId);
    const vigFut = cen.planoVigente.filter((a) => idx(a) >= ap);
    const chSem = churnIndependente(cen.entrada, sem.planoFluxoFuturo, vigFut), chCom = churnIndependente(cen.entrada, com.planoFluxoFuturo, vigFut);
    const cSem = classificarMudancas(vigFut, sem.planoFluxoFuturo, slots, chSem.trocasPosto), cCom = classificarMudancas(vigFut, com.planoFluxoFuturo, slots, chCom.trocasPosto);
    linhas.push({
      rotulo: `${d.data.slice(5)} ${d.periodoId}`, plano: com.res.diagnostico.planoEscolhido, planoSemEstab: sem.res.diagnostico.planoEscolhido, estabilizou: com.res.diagnostico.estabilizacao.aplicada, periodosAjustados: com.res.diagnostico.estabilizacao.periodosAjustados,
      linhasAntes: chSem.trocasPosto, linhasDepois: chCom.trocasPosto, primeiroAntes: chSem.trocasPrimeiro, primeiroDepois: chCom.trocasPrimeiro, soPecasDepois: chCom.linhasSoPecas,
      produtivasAntes: cSem.produtivas, trocasEquivalentesAntes: cSem.trocasEquivalentes, produtivasDepois: cCom.produtivas, trocasEquivalentesDepois: cCom.trocasEquivalentes,
      faltaAntes: Math.round(sem.avFluxo.totais.faltaFinalLo), faltaDepois: Math.round(com.avFluxo.totais.faltaFinalLo), violacoesDepois: com.viol.filter((v) => !v.aviso).length,
    });
  }
  return linhas;
}

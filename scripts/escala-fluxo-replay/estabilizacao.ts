// Experimento (H): o plano de fluxo muda QUEM ocupa cada posto em quase todas as linhas. Aplica a re-atribuição de pessoas já existente no repositório
// (`estabilizarPessoas`, usada no replanejamento restrito) sobre o plano de fluxo — mesmos postos, menos trocas de pessoa — e confere que nada piora.
import { estabilizarPessoas, } from "@/features/escala/estabilidade";
import { classificarMudancas } from "@/features/escala/estabilidade";
import { avaliarPlano } from "@/features/escala/fluxo";
import { fechamentos, rodar } from "./comum";
import { churnIndependente, verificarIndependente } from "./independente";
import type { AlocacaoEscala } from "@/features/escala/types";

export function experimentoEstabilizacao(offset = 2) {
  const linhas: unknown[] = [];
  for (const d of fechamentos) {
    const r = rodar(d, { offset });
    const r0 = rodar(d, { offset }, { limiarEstabilidadePecas: 0 });
    const cen = r.cen, slots = cen.entrada.slots, ap = cen.aPartirDe;
    const idx = (a: { data: string; periodoId: string }) => slots.findIndex((s) => s.data === a.data && s.periodoId === a.periodoId);
    const vigFut = cen.planoVigente.filter((a) => idx(a) >= ap);
    const antes = [...cen.entrada.congeladas];
    const est = estabilizarPessoas(r.planoFluxoFuturo as AlocacaoEscala[], vigFut, antes, slots);
    const novo = est.linhas;
    const av = avaliarPlano(cen.entrada, cen.dados, [...cen.entrada.congeladas, ...novo], cen.opcoes);
    const viol = verificarIndependente(cen.entrada, novo, { planoVigente: cen.planoVigente }).filter((v) => !v.aviso);
    const antesCh = churnIndependente(cen.entrada, r.planoFluxoFuturo, vigFut), depoisCh = churnIndependente(cen.entrada, novo, vigFut);
    const classAntes = classificarMudancas(vigFut, r.planoFluxoFuturo, slots, antesCh.linhas), classDepois = classificarMudancas(vigFut, novo, slots, depoisCh.linhas);
    // variante θ = 0 + estabilização de pessoas
    const est0 = estabilizarPessoas(r0.planoFluxoFuturo as AlocacaoEscala[], vigFut, antes, slots);
    const av0 = avaliarPlano(cen.entrada, cen.dados, [...cen.entrada.congeladas, ...est0.linhas], cen.opcoes);
    const ch0 = churnIndependente(cen.entrada, est0.linhas, vigFut);
    const viol0 = verificarIndependente(cen.entrada, est0.linhas, { planoVigente: cen.planoVigente }).filter((v) => !v.aviso);
    linhas.push({
      theta0: { falta: Math.round(av0.totais.faltaFinalLo), linhas: ch0.linhas, linhasPrimeiro: ch0.linhasPrimeiro, viol: viol0.length }, thetaPadrao: { linhasPrimeiro: depoisCh.linhasPrimeiro },
      rotulo: `${d.data.slice(5)} ${d.periodoId}`, estabilizou: est.estabilizou, periodosAjustados: est.periodosAjustados,
      linhasAntes: antesCh.linhas, linhasDepois: depoisCh.linhas, produtivasAntes: classAntes.produtivas, trocasEquivalentesAntes: classAntes.trocasEquivalentes, produtivasDepois: classDepois.produtivas, trocasEquivalentesDepois: classDepois.trocasEquivalentes,
      faltaAntes: Math.round(r.avFluxo.totais.faltaFinalLo), faltaDepois: Math.round(av.totais.faltaFinalLo), violacoesDepois: viol.length,
    });
  }
  return linhas;
}

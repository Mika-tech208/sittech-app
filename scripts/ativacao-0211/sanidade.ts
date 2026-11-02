// Sanidade OFFLINE do Mundo em memória com o planejador de corte (estatísticas do plano gerado).
import { lerParametros } from "@/features/escala/parametros";
import { epochMsNoFuso } from "@/features/escala/tempo";
import { Mundo, estadoDeTeste } from "@/lib/escala/__tests__/bancoMemoria";

async function main() {
  const m = new Mundo(estadoDeTeste("2026-11-02", ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"], { pessoas: 10 }));
  m.editar((e) => {
    e.parametros = { ...lerParametros([]), revezamentoModo: "duro", revezamentoEscopo: "bloco", revezamentoPonteM3T1: true };
    e.producaoReal = { modoEfetivo: "ativo", limiar: null, paresLegado: [], apontamentos: [], mesmoPeriodo: false };
    e.planejadorCorte = { config: { objetivo: "EQUILIBRIO", busca: { iter: 30000, reinicios: 1 } }, vigenteDoPlanejador: false, distribuicaoSuportada: true };
  });
  const t = Date.now();
  const r = await m.recalcular(epochMsNoFuso("2026-11-02", "18:00"), true);
  console.log("status", r.status, "ms", Date.now() - t, "linhas", m.alocacoes.length, "com posto", m.alocacoes.filter((a) => a.maquinaId).length, "compartilhadas", m.alocacoes.filter((a) => a.distribuicao).length);
  const reg = m.registrosFluxo[m.registrosFluxo.length - 1];
  console.log(JSON.stringify((reg.avaliacaoFluxo as any).porProduto), JSON.stringify((reg.avaliacaoFluxo as any).checagens));
  console.log("tentativas", JSON.stringify((reg.avaliacaoFluxo as any).tentativas));
}
main();

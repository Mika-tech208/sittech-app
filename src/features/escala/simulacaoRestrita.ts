// SIMULAÇÃO PERÍODO A PERÍODO do replanejamento restrito — núcleo PURO (sem banco, sem relógio). Serve aos testes e à simulação da semana real:
// a cada período fechado, gera a produção real (plano × rendimento do cenário), executa o corte, constrói a proposta e — se ela for válida —
// a APLICA ao plano (exatamente a região que a gravação oficial regravaria). Assim se enxerga como a Escala aprende e se corrige ao longo da semana.

import { repeticoesPorBloco } from "./exposicaoBloco";
import { gerarEscala } from "./gerarEscala";
import type { DinamicaCorte, EvolucaoGargalo } from "./gargaloDinamico";
import { evolucaoDoGargalo } from "./gargaloDinamico";
import { construirProposta, diagnosticarOciosidade, type CausaOciosidade, type PropostaRestrita } from "./replanejamentoRestrito";
import type { ApontamentoReal } from "./producaoReal";
import { executarCorteSombra, type DecisaoCorte } from "./sombraCorte";
import { chavePool, type AlocacaoEscala, type EntradaEscala, type IndisponibilidadeRecursoEscala, type JanelaAusenciaEscala, type PoolEscala, type SlotEscala } from "./types";

export interface InfoRendimento { pool: PoolEscala; linha: AlocacaoEscala; slot: SlotEscala }
export interface OpcoesSimulacao {
  base: EntradaEscala; // semana inteira, sem ausências/indisponibilidades
  planoInicial?: AlocacaoEscala[];
  rendimento: (i: InfoRendimento) => number; // produção real ÷ planejada de cada posto (1 = como planejado)
  aplicar?: boolean; // false = só sombra (mede o que o plano oficial estático faria)
  cortes?: number[]; // períodos de referência (padrão: do primeiro ao antepenúltimo)
  eventos?: (c: number) => { ausencias?: JanelaAusenciaEscala[]; indisponibilidades?: IndisponibilidadeRecursoEscala[] } | undefined; // fatos que passam a valer no corte c
}

export interface CorteSimulado {
  c: number;
  rotulo: string;
  veredito: PropostaRestrita["veredito"];
  aplicado: boolean;
  reparo: boolean;
  mudancas: number;
  wipRemovido: number;
  wipAdicionado: number;
  previstoMovido: number; // linhas de previsto realocadas/adicionadas/removidas
  violacoes: string[];
  faltaOficial: number; // plano vigente antes do corte
  faltaSombra: number; // plano proposto
  wipFuturoAntes: number; // peças de WIP planejadas de c+1 em diante ANTES e DEPOIS do corte
  wipFuturoDepois: number;
  ociososFuturos: number;
  causasOciosidade: Partial<Record<CausaOciosidade, number>>;
  gargalo: { situacao: string; maquinas: string[]; pressaoOriginal: number; pressaoAjustada: number } | null;
  evolucaoGargalo: EvolucaoGargalo;
  ritmo: { poolKey: string; n: number; f: number; capacidadeOriginal: number; capacidadeAjustada: number; restante: number }[];
  produtivas: number; // das linhas alteradas: mudança real de posto/peças/WIP
  trocasEquivalentes: number; // só troca de pessoa no mesmo posto
  poupadasPelaEstabilidade: number;
  revertidasDaAnterior: number; // linhas que voltam ao valor que tinham ANTES da aplicação do corte anterior
  wipDelta: number;
  wipPessoaHoras: number;
  wipHorasAcrescidas: number;
  ociososEvitados: number;
  wipSemOciosidade: number;
  congeladoIntacto: boolean; // nenhuma linha de período ≤ c mudou
  comprometidoIntacto: boolean; // nenhuma linha de c+1 mudou (a menos que o reparo mínimo tenha agido)
  hashDecisao: string;
}
export interface ResultadoSimulacao { planoFinal: AlocacaoEscala[]; cortes: CorteSimulado[]; apontamentos: ApontamentoReal[]; repeticoes: number }

const wipPecas = (rows: AlocacaoEscala[]) => Math.round(rows.reduce((s, a) => s + (a.maquinaId ? a.pecasAdicional ?? 0 : 0), 0));

export function contarRepeticoes(plano: AlocacaoEscala[], slots: SlotEscala[], escopo: "consecutivo" | "bloco" = "consecutivo", equivalencias?: Record<string, string[]>, ponteM3T1 = false): number {
  if (escopo === "bloco") return repeticoesPorBloco(plano, slots, equivalencias, ponteM3T1).reduce((s, r) => s + r.excesso, 0);
  const idx = (a: AlocacaoEscala) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1;
  const por = new Map<string, Map<number, AlocacaoEscala>>();
  plano.forEach((a) => { if (!por.has(a.funcionarioId)) por.set(a.funcionarioId, new Map()); por.get(a.funcionarioId)!.set(idx(a), a); });
  let n = 0;
  por.forEach((m) => m.forEach((a, i) => { const ant = m.get(i - 1); if (ant && !slots[i]?.primeiroDoDia && a.maquinaId && ant.maquinaId && a.operacaoId && a.operacaoId === ant.operacaoId) n++; }));
  return n;
}

export function simularSemanaRestrita(o: OpcoesSimulacao): ResultadoSimulacao {
  const slots = o.base.slots;
  let plano = (o.planoInicial ?? gerarEscala(o.base).alocacoes).map((a) => ({ ...a }));
  const idx = (a: { data: string; periodoId: string }) => slots.find((s) => s.data === a.data && s.periodoId === a.periodoId)?.indice ?? -1;
  const poolDe = (a: AlocacaoEscala) => o.base.pools.find((p) => p.produtoId === a.produtoId && p.etapaId === a.etapaId);
  const apont: ApontamentoReal[] = [];
  const ausencias: JanelaAusenciaEscala[] = [];
  const indisp: IndisponibilidadeRecursoEscala[] = [];
  const cortes: CorteSimulado[] = [];
  // fator f com que cada linha foi PLANEJADA (metas × f): a produção real de um posto é a meta × rendimento, não (peças planejadas × rendimento)
  const fUsado = new Map<string, number>();
  let ultimaAplicacao = new Map<string, { antes: string; depois: string }>();
  const postoTxt = (a: AlocacaoEscala | undefined) => (a && a.maquinaId ? `${a.maquinaId}|${a.produtoId}|${a.etapaId}|${Math.round(a.pecas)}|${Math.round(a.pecasAdicional ?? 0)}` : "ocioso");
  const chaveLinha = (a: AlocacaoEscala) => `${a.data}|${a.periodoId}|${a.funcionarioId}`;
  const lista = o.cortes ?? Array.from({ length: Math.max(0, slots.length - 2) }, (_, i) => i);
  let anterior: DinamicaCorte["gargalo"] | null = null;
  for (const c of lista) {
    const slot = slots[c];
    // produção real do período c, conforme o plano VIGENTE
    plano.filter((a) => idx(a) === c && a.maquinaId && a.produtoId && a.etapaId).forEach((a) => {
      const pool = poolDe(a);
      if (!pool) return;
      const planejado = a.pecas + (a.pecasAdicional ?? 0);
      const g = o.rendimento({ pool, linha: a, slot });
      const nominal = planejado / (fUsado.get(chaveLinha(a)) ?? 1); // o que o posto produziria na meta original
      apont.push({ data: a.data, periodoId: a.periodoId, funcionarioId: a.funcionarioId, maquinaId: a.maquinaId, produtoId: a.produtoId, etapaId: a.etapaId, operacaoId: a.operacaoId, boas: Math.round(nominal * g), refugo: 0, meta: Math.round(nominal), status: "produzindo", motivo: null, lancadoEmMs: slot.fimMs + 60_000 });
    });
    const ev = o.eventos?.(c);
    if (ev?.ausencias) ausencias.push(...ev.ausencias);
    if (ev?.indisponibilidades) indisp.push(...ev.indisponibilidades);
    const par = { base: o.base, ausencias, indisponibilidades: indisp, apontamentos: apont, planoOficial: plano, c, corteMs: slot.fimMs + 5 * 60_000, impossivelNaOrigem: false, restrito: true };
    const dec: DecisaoCorte = executarCorteSombra(par);
    const prop = construirProposta(par, dec);
    const oc = diagnosticarOciosidade(par, dec);
    const causas: Partial<Record<CausaOciosidade, number>> = {};
    oc.forEach((x) => (causas[x.causa] = (causas[x.causa] ?? 0) + 1));
    const futAntes = plano.filter((a) => idx(a) > c);
    const antesPlano = plano;
    let aplicado = false;
    let revertidas = 0;
    if (o.aplicar !== false && prop.veredito === "aplicar" && prop.aPartirSlot !== null) {
      plano = [...plano.filter((a) => idx(a) < (prop.aPartirSlot as number)), ...prop.linhas.map((a) => ({ ...a }))];
      prop.linhas.forEach((a) => { if (a.maquinaId && a.produtoId && a.etapaId) fUsado.set(chaveLinha(a), dec.desempenho[chavePool(a.produtoId, a.etapaId)]?.f ?? 1); });
      aplicado = true;
      const atual = new Map<string, { antes: string; depois: string }>();
      prop.mudancas.forEach((m) => { const k = `${m.data}|${m.periodoId}|${m.funcionarioId}`; atual.set(k, { antes: m.antes ? postoTxt({ maquinaId: m.antes.maquinaId, produtoId: m.antes.produtoId, etapaId: m.antes.etapaId, pecas: m.antes.pecas, pecasAdicional: m.antes.pecasAdicional } as AlocacaoEscala) : "ocioso", depois: m.depois ? postoTxt({ maquinaId: m.depois.maquinaId, produtoId: m.depois.produtoId, etapaId: m.depois.etapaId, pecas: m.depois.pecas, pecasAdicional: m.depois.pecasAdicional } as AlocacaoEscala) : "ocioso" }); });
      atual.forEach((v, k) => { const u = ultimaAplicacao.get(k); if (u && u.antes === v.depois && u.depois === v.antes) revertidas++; });
      ultimaAplicacao = atual;
    }
    const futDepois = plano.filter((a) => idx(a) > c);
    const assin = (rows: AlocacaoEscala[], pred: (i: number) => boolean) => JSON.stringify(rows.filter((a) => pred(idx(a))).map((a) => [a.data, a.periodoId, a.funcionarioId, a.maquinaId, a.produtoId, a.etapaId, Math.round(a.pecas), Math.round(a.pecasAdicional ?? 0)]).sort());
    const g = dec.dinamica.gargalo;
    cortes.push({
      c, rotulo: `${slot.data.slice(8)}/${slot.data.slice(5, 7)} ${slot.periodoId.toUpperCase()}`, veredito: prop.veredito, aplicado, reparo: prop.reparoDoComprometido, mudancas: prop.mudancas.length,
      wipRemovido: prop.resumo.wipRemovido, wipAdicionado: prop.resumo.wipAdicionado, previstoMovido: prop.mudancas.filter((m) => m.natureza === "realocado" || m.natureza === "previsto_adicionado" || m.natureza === "previsto_removido" || m.natureza === "mudou_peca").length,
      violacoes: prop.violacoes, faltaOficial: Math.round(dec.faltaOficial.total), faltaSombra: Math.round(dec.faltaSombra.total), wipFuturoAntes: wipPecas(futAntes), wipFuturoDepois: wipPecas(futDepois),
      ociososFuturos: oc.length, causasOciosidade: causas,
      gargalo: g.principal ? { situacao: g.situacao, maquinas: g.principal.maquinas, pressaoOriginal: g.principal.pressaoOriginal, pressaoAjustada: g.principal.pressaoAjustada } : null,
      evolucaoGargalo: evolucaoDoGargalo(anterior, g),
      ritmo: dec.dinamica.capacidade.map((x) => ({ poolKey: x.poolKey, n: x.n, f: x.f, capacidadeOriginal: x.capacidadeFuturaOriginal, capacidadeAjustada: x.capacidadeFuturaAjustada, restante: x.restante })),
      produtivas: prop.churn.produtivas, trocasEquivalentes: prop.churn.trocasEquivalentes, poupadasPelaEstabilidade: prop.churn.poupadasPelaEstabilidade, revertidasDaAnterior: revertidas, wipDelta: prop.wip.delta, wipPessoaHoras: prop.wip.pessoaHorasWip, wipHorasAcrescidas: prop.wip.horasAcrescidas, ociososEvitados: prop.wip.ociososEvitados, wipSemOciosidade: prop.wip.semOciosidade.length,
      congeladoIntacto: assin(antesPlano, (i) => i <= c) === assin(plano, (i) => i <= c), comprometidoIntacto: assin(antesPlano, (i) => i === c + 1) === assin(plano, (i) => i === c + 1),
      hashDecisao: dec.hashDecisao,
    });
    anterior = g;
  }
  return { planoFinal: plano, cortes, apontamentos: apont, repeticoes: contarRepeticoes(plano, slots) };
}
export { chavePool };

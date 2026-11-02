// ADAPTADOR MOTOR <-> PRODUTO CANÔNICO (PURO, sem IO). Semanas >= cutover chegam ao motor com UM item (produto canônico, 5 etapas, grafo com convergência).
// O planejador de corte da Frente E (feat/conector-unico-motor, `produtoUnico: true`) pensa em "rotas = cadeias de produto": este módulo DESDOBRA o canônico em duas cadeias
// virtuais e RECOMPÕE a saída no canônico. Nada é gravado aqui e nada disso é lido com `produto_unico_cutover` = null.
//
//   canônico P*: M8* ─────────────┐
//                Rosquear* → Parafusar* ┴→ Etiquetar* → Embalar*
//   virtual V_CONV: Rosquear* → Parafusar* → Etiquetar* → Embalar*      (demanda = TOTAL; é a cadeia "principal")
//   virtual V_AUTO: M8* → Etiquetar*@A → Embalar*@A                     (demanda = 0; só a etapa M8* é exclusiva; o trecho comum é cópia com id sufixado `@A`)
//   ParLegado: trecho comum = (Etiquetar*, Etiquetar*@A) e (Embalar*, Embalar*@A) — o motor funde o trecho num recurso/estoque único.
// Volta: V_CONV|V_AUTO -> P*; `@A` removido; as linhas saem com o produto canônico e SEM `distribuicao`.
// Máquinas da Previsão continuam absolutas: pool sem máquina -> `poolsSemMaquina` (a rota fica indisponível, nunca "pula" a etapa).
import type { AlocacaoEscala, EntradaEscala, PoolEscala } from "@/features/escala/types";
import type { ContagemFisicaPar, DadosProducaoReal, ParLegado } from "@/features/escala/fluxo/tipos";
import type { ApontamentoReal } from "@/features/escala/producaoReal";
import type { ModeloCanonico } from "./tipos";

export const SUFIXO_AUTO = "@A";

export interface Desdobramento {
  /** ids virtuais das duas cadeias */
  vConv: string;
  vAuto: string;
  par: ParLegado;
  entrada: EntradaEscala;
  /** tradução (produto, etapa) virtual/canônico -> canônico (idempotente) */
  paraCanonico: (produtoId: string | null, etapaId: string | null) => { produtoId: string | null; etapaId: string | null };
  /** (produto canônico, etapa canônica) -> virtual (p/ dados reais: apontamentos, linhas vigentes, contagens) */
  paraVirtual: (produtoId: string | null, etapaId: string | null) => { produtoId: string | null; etapaId: string | null };
  /** etapas do modelo por papel (úteis p/ testes e diagnósticos) */
  etapas: { m8: string; exclusivasConv: string[]; comuns: string[] };
}

interface Papeis { m8: string; excl: string[]; comuns: string[] }

function papeis(m: ModeloCanonico): Papeis | { erro: string } {
  const convRota = m.rotas.find((r) => r.tipo === "convencional");
  const autoRota = m.rotas.find((r) => r.tipo === "automatica");
  if (!convRota || !autoRota) return { erro: "modelo sem as rotas convencional e automática" };
  const exAuto = m.etapas.filter((e) => e.rotaId === autoRota.id);
  if (exAuto.length !== 1) return { erro: "a rota automática deve ter exatamente 1 etapa exclusiva (Máquina 8) nesta versão" };
  // etapas exclusivas da convencional na ordem do grafo (origem -> destino)
  const exConv = m.etapas.filter((e) => e.rotaId === convRota.id).map((e) => e.etapaId);
  const proximo = (id: string) => m.arestas.find((a) => a.origemEtapaId === id)?.destinoEtapaId;
  const primeira = exConv.find((id) => !m.arestas.some((a) => a.destinoEtapaId === id && exConv.includes(a.origemEtapaId)));
  const ordenadas: string[] = [];
  for (let id: string | undefined = primeira; id && exConv.includes(id); id = proximo(id)) ordenadas.push(id);
  if (ordenadas.length !== exConv.length || ordenadas.length === 0) return { erro: "trecho exclusivo da rota convencional não é uma cadeia linear" };
  // trecho comum: a partir da convergência até o FINAL, em ordem do grafo
  const comuns: string[] = [];
  for (let id: string | undefined = proximo(ordenadas[ordenadas.length - 1]); id; id = proximo(id)) comuns.push(id);
  const final = m.etapas.find((e) => e.papel === "FINAL");
  if (!final || comuns[comuns.length - 1] !== final.etapaId) return { erro: "o trecho comum não termina na etapa FINAL" };
  if (proximo(exAuto[0].etapaId) !== comuns[0]) return { erro: "as rotas não convergem na mesma etapa" };
  return { m8: exAuto[0].etapaId, excl: ordenadas, comuns };
}

/** Desdobra a entrada do motor de um produto canônico em duas cadeias virtuais. Devolve `{erro}` quando o modelo/entrada não permite (o chamador mantém o motor atual). */
export function desdobrarCanonico(entrada: EntradaEscala, modelo: ModeloCanonico): Desdobramento | { erro: string } {
  const p = papeis(modelo);
  if ("erro" in p) return p;
  const CAN = modelo.produtoCanonicoId;
  const vConv = `${CAN}#CONV`, vAuto = `${CAN}#AUTO`;
  const todos = [...entrada.pools, ...(entrada.poolsSemMaquina ?? [])].filter((x) => x.produtoId === CAN);
  const porEtapa = new Map(todos.map((x) => [x.etapaId, x]));
  const sem = new Set((entrada.poolsSemMaquina ?? []).filter((x) => x.produtoId === CAN).map((x) => x.etapaId));
  for (const id of [p.m8, ...p.excl, ...p.comuns]) if (!porEtapa.has(id)) return { erro: `etapa canônica ${id} ausente da entrada (o produto único não está na Previsão desta semana?)` };
  const total = Math.max(0, porEtapa.get(p.comuns[p.comuns.length - 1])!.quantidade);

  const clone = (x: PoolEscala, produtoId: string, etapaId: string, ordemEtapa: number, quantidade: number): PoolEscala => ({ ...x, produtoId, etapaId, ordemEtapa, quantidade });
  const poolsConv: PoolEscala[] = [...p.excl, ...p.comuns].map((id, i) => clone(porEtapa.get(id)!, vConv, id, i + 1, total));
  const poolsAuto: PoolEscala[] = [
    clone(porEtapa.get(p.m8)!, vAuto, p.m8, 1, 0),
    ...p.comuns.map((id, i) => clone(porEtapa.get(id)!, vAuto, `${id}${SUFIXO_AUTO}`, 2 + i, 0)),
  ];
  const virtuais = [...poolsConv, ...poolsAuto];
  const outros = entrada.pools.filter((x) => x.produtoId !== CAN);
  const outrosSem = (entrada.poolsSemMaquina ?? []).filter((x) => x.produtoId !== CAN);
  const comMaq = (x: PoolEscala) => !sem.has(x.etapaId.replace(SUFIXO_AUTO, ""));
  const par: ParLegado = {
    id: `${modelo.codigo.toLowerCase()}-canonico`, produtoConvencionalId: vConv, produtoAutomaticaId: vAuto,
    etapasComuns: p.comuns.map((id, i) => ({ rotulo: i === 0 ? "Etiquetar" : i === p.comuns.length - 1 ? "Embalar" : `Comum ${i + 1}`, etapaConvencionalId: id, etapaAutomaticaId: `${id}${SUFIXO_AUTO}` })),
  };

  const paraCanonico: Desdobramento["paraCanonico"] = (produtoId, etapaId) => ({
    produtoId: produtoId === vConv || produtoId === vAuto ? CAN : produtoId,
    etapaId: etapaId && etapaId.endsWith(SUFIXO_AUTO) ? etapaId.slice(0, -SUFIXO_AUTO.length) : etapaId,
  });
  const paraVirtual: Desdobramento["paraVirtual"] = (produtoId, etapaId) => {
    if (produtoId !== CAN && produtoId !== vConv && produtoId !== vAuto) return { produtoId, etapaId };
    if (!etapaId) return { produtoId, etapaId };
    return { produtoId: etapaId === p.m8 ? vAuto : vConv, etapaId };
  };
  const entradaV: EntradaEscala = {
    ...entrada,
    pools: [...outros, ...virtuais.filter(comMaq)],
    poolsSemMaquina: [...outrosSem, ...virtuais.filter((x) => !comMaq(x))],
    congeladas: entrada.congeladas.map((a) => ({ ...a, ...paraVirtualLinha(a, paraVirtual) })),
    ...(entrada.trocasManuais ? { trocasManuais: entrada.trocasManuais.map((a) => ({ ...a, ...paraVirtualLinha(a, paraVirtual) })) } : {}),
  };
  return { vConv, vAuto, par, entrada: entradaV, paraCanonico, paraVirtual, etapas: { m8: p.m8, exclusivasConv: p.excl, comuns: p.comuns } };
}

function paraVirtualLinha(a: AlocacaoEscala, f: Desdobramento["paraVirtual"]): Pick<AlocacaoEscala, "produtoId" | "etapaId"> {
  const r = f(a.produtoId, a.etapaId);
  return { produtoId: r.produtoId, etapaId: r.etapaId };
}

/** Dados reais (apontamentos, plano vigente, contagens) do espaço canônico para o virtual. Dados ainda em ids LEGADOS devem passar antes por `canonizar*` (mapeamento.ts). */
export function dadosParaVirtual(dados: DadosProducaoReal, d: Desdobramento): DadosProducaoReal {
  const ap = (a: ApontamentoReal): ApontamentoReal => { const r = d.paraVirtual(a.produtoId, a.etapaId); return { ...a, produtoId: r.produtoId, etapaId: r.etapaId }; };
  const linha = (a: AlocacaoEscala): AlocacaoEscala => ({ ...a, ...paraVirtualLinha(a, d.paraVirtual) });
  const m8 = d.etapas.m8, primeiraComum = d.etapas.comuns[0];
  const contagem = (c: ContagemFisicaPar): ContagemFisicaPar => {
    const virt = d.paraVirtual(c.produtoId, c.etapaOrigemId);
    // M8 -> Etiquetar: pertence à cadeia automática, cujo trecho comum tem ids sufixados
    if (c.etapaOrigemId === m8 && c.etapaSeguinteId === primeiraComum) return { ...c, produtoId: d.vAuto, etapaOrigemId: m8, etapaSeguinteId: `${primeiraComum}${SUFIXO_AUTO}` };
    return { ...c, produtoId: virt.produtoId ?? c.produtoId };
  };
  return { ...dados, apontamentos: dados.apontamentos.map(ap), planoVigente: dados.planoVigente.map(linha), ...(dados.contagensFisicas ? { contagensFisicas: dados.contagensFisicas.map(contagem) } : {}) };
}

/** Saída do planejador (linhas virtuais) -> linhas do produto canônico, sem `distribuicao`. Idempotente; linhas de outros produtos passam intactas. */
export function recomporAlocacoes(linhas: AlocacaoEscala[], d: Desdobramento): AlocacaoEscala[] {
  return linhas.map((a) => {
    const r = d.paraCanonico(a.produtoId, a.etapaId);
    if (r.produtoId === a.produtoId && r.etapaId === a.etapaId && !a.distribuicao) return a;
    const { distribuicao: _d, ...resto } = a;
    void _d;
    return { ...resto, produtoId: r.produtoId, etapaId: r.etapaId };
  });
}
